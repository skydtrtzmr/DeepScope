# DeepScope 功能问题与优化计划

> 生成时间：2026-05-16
> 审阅范围：graph-store.ts、graph-container.tsx、graph-controls.tsx、node-detail-card.tsx、App.tsx、api.ts、graph.ts

---

## 严重问题

### 1. `expandNode` 并发竞态 — 可导致数据丢失

**文件**：`graph-store.ts` L323-390

**现象**：`expandNode` 是异步方法，无防重入机制。用户快速双击或连续点击"探索此节点"按钮时，多次 `expandGraph` 请求并发返回，后返回的结果可能覆盖先返回的 `pendingAddition`，导致部分邻居节点丢失。

**处理方案**：
- 在 store 中新增 `expandingNodeId: string | null` 状态
- `expandNode` 入口处判断：若 `expandingNodeId` 非空则直接 return（同一节点不重复展开）
- 也可考虑用请求序列号（requestId）丢弃过期响应

---

### 2. `selectNode` 在 local 模式下覆盖 `visibleData`，导致状态不一致

**文件**：`graph-store.ts` L210-246

**现象**：`selectNode` 基于 `fullData` 做 BFS 过滤生成新的 `visibleData`，受 `maxDirectRelations/maxDepth` 限制，会把不在 BFS 范围内的已展开节点从 `visibleData` 中移除。但 G6 画布实际渲染的是 `fullData`（重建时全量）或增量添加的节点，`visibleData` 的收缩对 G6 没有实际影响——这个逻辑在 local 模式下多余且产生视觉与状态不一致。

**处理方案**：
- `selectNode` 根据 `viewMode` 分支处理
- local 模式下仅设置 `selectedNodeId`，不重新计算 `visibleData`
- global 模式下保持现有 BFS 过滤逻辑

---

### 3. `node:click` 和 `node:dblclick` 事件冲突

**文件**：`graph-container.tsx` L96-107

**现象**：浏览器双击会先触发两次 click 再触发一次 dblclick，导致 `selectNode(null)` → `selectNode(id)` → `selectNode(id)` 状态频繁切换，可能触发多余渲染。`canvas:click` 的 `selectNode(null)` 也会与双击产生冲突。

**处理方案**：
- 使用 `setTimeout` 延迟 click 处理（约 200ms），若在延迟期间收到 dblclick 则取消 click 回调
- 或改用 G6 行为插件（如 `click-select`）统一管理选中状态，避免手动绑定

---

## 设计问题

### 4. `rebuildTrigger` + `skipFullDataEffectRef` 时序依赖脆弱

**文件**：`graph-container.tsx` L222-283

**现象**：`skipFullDataEffectRef` 方案依赖 React effect 的执行顺序——`pendingAddition` effect 先执行（设置 flag），`fullData` effect 后执行（读取并跳过）。在 React concurrent mode 下 effect 顺序不严格保证，若 `fullData` effect 先执行则触发不必要的重建。

**处理方案**：
- 将 `fullData` 变化的判断逻辑合并到 `pendingAddition` effect 中
- 或用 `useReducer` 替代多个 `useState + useRef` 的组合，用一个 `action` 消息区分"增量更新"和"全量重建"
- 或在 `commitAddition` 中不触发 `fullData` 引用变化（使用 `skipFullDataEffectRef` 的反向思路：用 `useRef` 记录上次 fullData 的引用，在 effect 中对比引用而非依赖数组）

---

### 5. `appendGraphData` 与 `commitAddition` 功能重复

**文件**：`graph-store.ts` L174 (`appendGraphData`)、L393 (`commitAddition`)

**现象**：两个方法都做数据合并，`appendGraphData` 更新 `expansionStates` 但无人调用（遗留代码），`commitAddition` 不更新 `expansionStates`（更新在 `expandNode` 中完成）。逻辑分散，容易混乱。

**处理方案**：
- 删除 `appendGraphData` 及其相关类型 `NodeExpansionState`
- 将 `expansionStates` 的更新集中到 `expandNode` 和 `commitAddition` 中

---

### 6. global 和 local 模式混用同一套 store 逻辑

**文件**：`graph-store.ts`

**现象**：`selectNode`、`updateConfig`、`goBack`、`reset` 在两种模式下行为应不同，但目前完全共用。例如 `updateConfig` 在 global 模式下重新 BFS 有意义，local 模式下则不需要。

**处理方案**：
- 在需要区分模式的方法中加 `viewMode` 分支判断
- local 模式下 `selectNode` 仅设 `selectedNodeId`；`updateConfig` 不重新计算 `visibleData`
- 或将两种模式的核心逻辑拆分为两个独立 store slice

---

## 次要问题

### 7. 事件处理中 `event.target.id` 不准确

**文件**：`graph-container.tsx` L97, L102

**现象**：通过 `(event as unknown as { target: { id: string } }).target.id` 获取节点 ID，类型强转不够安全，且在某些 G6 版本下可能获取到 canvas 元素 ID 而非节点 ID。

**处理方案**：
- 改用 G6 v5 标准事件属性 `event.targetID` 或 `event.itemId`
- 验证属性是否为有效节点 ID（检查 `graph.getNodeData(id)` 是否存在）

---

### 8. 双击展开后画布未聚焦到新节点

**文件**：`graph-container.tsx` L222-240

**现象**：`expandNode` 追加邻居节点后，画布不会自动平移到新节点区域，用户可能看不到新增的节点。

**处理方案**：
- 在 `pendingAddition` effect 中，`addData + render` 完成后调用 `graph.focusElement(newNodeIds)` 或手动计算新节点的中心坐标执行 `graph.translateTo` / `graph.zoomTo`

---

### 9. `updateConfig` 滑块拖动时频繁触发 BFS 重算

**文件**：`graph-store.ts` L254-269

**现象**：拖动滑块时 `onValueChange` 每帧触发 `updateConfig`，导致频繁的 `visibleData` 重新计算。global 模式下数据量大时可能有性能影响。

**处理方案**：
- 对 `updateConfig` 做 debounce（如 150ms）
- 或将 BFS 计算移到 `useMemo` / React 渲染层，仅在 final 值确认时更新

---

### 10. 切换模式时丢失展开历史

**文件**：`App.tsx` L49-71

**现象**：切换 `viewMode` 时直接 `setGraphData()` 加载新数据，`expansionStates` 和已展开的节点全部丢失。用户切到 global 再切回 local，之前的探索进度归零。

**处理方案**：
- 方案 A：保存 local 模式的 `fullData` 快照，切回时恢复
- 方案 B：切换模式时提示用户是否保留当前探索进度
- 方案 C：模式切换不重新加载数据，仅改变交互行为（需评估影响范围）

---

## 优先级排序

| 优先级 | 编号 | 问题 | 理由 |
|--------|------|------|------|
| P0 | #1 | expandNode 并发竞态 | 直接导致数据丢失 |
| P0 | #3 | click/dblclick 事件冲突 | 用户每次双击都能感知到 |
| P1 | #2 | selectNode 覆盖 visibleData | 状态不一致，影响后续功能扩展 |
| P1 | #4 | rebuildTrigger 时序脆弱 | 潜在的随机重建 bug |
| P2 | #5 | appendGraphData 冗余 | 代码维护负担 |
| P2 | #6 | 模式逻辑混用 | 影响 #2、#4 等问题的修复 |
| P3 | #7 | event.target.id 不准确 | 潜在运行时错误 |
| P3 | #8 | 展开后未聚焦 | 用户体验问题 |
| P3 | #9 | 滑块频繁重算 | 性能隐患 |
| P3 | #10 | 切换模式丢失历史 | 用户体验问题 |
