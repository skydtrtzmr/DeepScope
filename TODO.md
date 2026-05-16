# DeepScope 功能问题与优化计划

> 生成时间：2026-05-16
> 最后更新：2026-05-16
> 审阅范围：graph-store.ts、graph-container.tsx、graph-controls.tsx、node-detail-card.tsx、App.tsx、api.ts、graph.ts

---

## 设计问题

### 4. ~~`rebuildTrigger` + `skipFullDataEffectRef` 时序依赖脆弱~~ ✅ 已修复

**文件**：`graph-container.tsx`、`graph-store.ts`

**根因**：两个问题叠加：
1. `graph.render()` 返回 `Promise<void>`（异步），但 `applyNodeStates` React effect 在 render 完成前就同步调用 `graph.setElementState()`，此时 G6 内部 canvas context 尚未就绪 → `Cannot read properties of undefined (reading 'draw')`
2. 旧 graph 的 `render().then()` 回调在 graph 被 `destroy()` 后仍 resolve，对已销毁的图调用 `setElementState`

**修复方案**：
- 新增 `graphReadyRef`：标记当前 graph 是否已完成首次 `render()`。`applyNodeStates` 入口处检查，未就绪则跳过
- 新增 `graphGenerationRef`：每次销毁重建 graph 时递增。所有 `render().then()` 回调在执行前校验 generation，过期则丢弃
- cleanup 中递增 generation + 重置 `graphReadyRef`，确保旧回调全部失效

**验证方式**：打开浏览器控制台：
- 初始加载 → `[graph] 全量重建` → `[graph] render 完成，标记 graphReady=true`，**不应出现** `Cannot read properties of undefined` 错误
- 点击"探索此节点" → `[graph] 增量渲染` → `[graph] render 完成`，不应出现错误
- 快速连续点击不同节点的"探索"按钮 → 不应出现错误，控制台可能出现"过期回调（generation 不匹配），跳过"日志

---

### 5. `appendGraphData` 与 `commitAddition` 功能重复

**文件**：`graph-store.ts` L179 (`appendGraphData`)、L409 (`commitAddition`)

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

**文件**：`graph-container.tsx` L94, L95

**现象**：通过 `(event as unknown as { target: { id: string } }).target.id` 获取节点 ID，类型强转不够安全，且在某些 G6 版本下可能获取到 canvas 元素 ID 而非节点 ID。

**处理方案**：
- 改用 G6 v5 标准事件属性 `event.targetID` 或 `event.itemId`
- 验证属性是否为有效节点 ID（检查 `graph.getNodeData(id)` 是否存在）

---

### 8. 展开后画布未聚焦到新节点

**文件**：`graph-container.tsx`

**现象**：`expandNode` 追加邻居节点后，画布不会自动平移到新节点区域，用户可能看不到新增的节点。

**处理方案**：
- 在 `pendingAddition` effect 中，`addData + render` 完成后调用 `graph.focusElement(newNodeIds)` 或手动计算新节点的中心坐标执行 `graph.translateTo` / `graph.zoomTo`

---

### 9. `updateConfig` 滑块拖动时频繁触发 BFS 重算

**文件**：`graph-store.ts` L267-282

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

| 优先级 | 编号 | 问题 | 状态 |
|--------|------|------|------|
| ~~P0~~ | ~~#1~~ | ~~expandNode 并发竞态~~ | ✅ 已修复 |
| ~~P0~~ | ~~#3~~ | ~~click/dblclick 事件冲突~~ | ✅ 已修复（删除 dblclick） |
| ~~P1~~ | ~~#2~~ | ~~selectNode 覆盖 visibleData~~ | ✅ 已修复 |
| ~~P1~~ | ~~#4~~ | ~~rebuildTrigger 时序脆弱~~ | ✅ 已修复 |
| P2 | #5 | appendGraphData 冗余 | 待处理 |
| P2 | #6 | 模式逻辑混用 | 待处理 |
| P3 | #7 | event.target.id 不准确 | 待处理 |
| P3 | #8 | 展开后未聚焦 | 待处理 |
| P3 | #9 | 滑块频繁重算 | 待处理 |
| P3 | #10 | 切换模式丢失历史 | 待处理 |
