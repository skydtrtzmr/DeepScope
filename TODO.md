# DeepScope 功能问题与优化计划

> 生成时间：2026-05-16
> 最后更新：2026-05-17
> 审阅范围：graph-store.ts、graph-container.tsx、graph-controls.tsx、node-detail-card.tsx、App.tsx、api.ts、graph.ts

---

## 现存 Bug

### BUG-1. 探索按钮状态计算失效

**文件**：`graph-store.ts`（`getExploreButtonState`、`expandNode`）

**现象**：
- 明明某一层已经全部加载完毕，点击"探索此节点"无反应（实际返回空数据被提前 return），但按钮状态仍显示"探索此节点"，没有切换为"已全部探索"
- **高频复现场景**：对某一节点使用 `n>1`（多深度）进行探索后，按钮状态最容易异常

**分析**：
- `getExploreButtonState` 依赖 `expansionStates` 中记录的 `loadedDirectCount` vs `totalDirectCount`，以及 `maxDepthExplored` vs `exploreConfig.n`
- `countLoadedDirectNeighbors` 统计的是 `fullData.edges` 中与当前节点直接相连的邻居数，但全量返回方案下后端可能返回已在画布上的节点，前端去重后 `loadedDirectCount` 的计算与后端 `totalNeighbors` 可能口径不一致
- 多级探索场景下，展开节点 B 时加载了 A，A 的直接邻居被加入了 `fullData.edges`。之后再统计节点 C 的邻居时，如果 C 与 A 之间有边且该边已被 B 的展开加载，`countLoadedDirectNeighbors` 可能多算
- **`n>1` 时的问题更突出**：当 `maxDepthExplored` 被记录为 `exploreConfig.n`（如 2），但实际 BFS 第 2 层返回的节点可能大部分已在画布上（被前端去重掉），导致虽然"深度 2 已探索"，但直接邻居并未全部加载。此时按钮既不显示"加载更多"（因为 `maxDepthExplored >= exploreConfig.n`），也可能因深度调低后又调高而出现"已全部探索"的误判
- 另一种可能：`expansionStates` 中的 `totalDirectCount` 记录的是某次 expand 时后端返回的 `totalNeighbors`（后端自身 BFS 中的直接邻居总数），但前端去重逻辑导致实际可加载的邻居数少于这个值，使得 `loadedDirectCount < totalDirectCount` 永远成立，按钮永远不会显示"已全部探索"

**待验证**：
- 确认 `totalNeighbors` 的计算口径（后端 `_get_neighbor_ids_sorted(conn, node_id, set(), domain)` 在 exclude 为空时的行为）
- 确认前端去重后是否会出现 `loadedDirectCount` 永远无法达到 `totalDirectCount` 的情况

---

### BUG-2. 画布闪烁与 d3-force 性能问题

**文件**：`graph-container.tsx`（G6 d3-force 布局配置）

**现象**：
- 操作过程中画面偶尔闪烁
- 节点达到 ~120 个时明显卡顿
- d3-force 布局在节点较多时动画持续很久，节点长时间自行移动

**分析**：
- d3-force 的 `alphaDecay: 0.02`（默认值 0.0228）使得布局收敛较慢
- 每次增量渲染（`addData + render`）会重新触发力模拟，已定位的节点也会被扰动
- 力导向布局复杂度 O(n²)，120+ 节点时每帧计算量显著增加

**可能优化方向**：
- 增大 `alphaDecay` 加速收敛（如 0.05~0.1）
- 增量渲染时固定已有节点位置，仅对新节点施加力
- 大规模节点时切换到预计算布局（如 dagre / fruchterman）
- 关闭或减弱 `manyBody.strength` 减少全局排斥计算

---

## 功能改进建议

### IMPROVE-1. 探索深度调节与探索完成状态互斥

**现象**：当前"探索深度"滑块与"探索完成状态"（探索此节点 / 加载更多 / 已全部探索）共存，逻辑上不协调——用户可以来回调深度，但按钮状态基于上次 expand 时的深度记录，容易出现"深度调高了但按钮还显示'已全部探索'"或"深度调低了但按钮仍要求'加载更多'"等矛盾情况。

**建议**：
- 方案 A：探索深度改为全局配置，每次 explore 以当前深度为准，不记录历史深度。按钮状态仅判断"是否还有未加载的直接邻居"，去掉"探索更深"这个中间状态
- 方案 B：一旦节点开始探索，深度配置锁定不可调（或调后清空该节点的探索历史重新开始）

---

## 后续功能规划

### FEAT-1. 关联节点按聚合字段分组（树状结构）

**描述**：在右侧面板的"关联节点"列表中，按后端配置的聚合字段（如按 category、按 depth 等）将关联节点分组展示，形成树状折叠结构。

**实现思路**：
- 后端在域配置中定义聚合规则（类似现有 backlinks 的 aggregation 配置）
- 前端获取聚合规则后，对 `relatedNodes` 进行分组渲染
- UI 上每组可折叠/展开，组头显示分类名和节点数量

---

### FEAT-2. 核心节点配置与相邻节点条件聚合

**描述**：支持配置"核心节点"筛选条件（如 category=项目、rank>阈值），符合条件的节点作为主节点突出展示。核心节点的相邻节点支持按条件聚合（如按类型折叠为单个聚合节点）。

**实现思路**：
- 后端配置核心节点筛选规则（类似现有 graph.coreNodeFilter）
- 前端根据规则高亮核心节点，非核心节点降低视觉权重
- 聚合功能：将符合条件的邻居节点折叠为一个虚拟节点，展开时再加载明细

**潜在冲突**：与现有"按指定数量探索"功能存在矛盾——聚合后一个虚拟节点代表 N 个实际节点，此时 `m`（每层加载邻居数）应该算虚拟节点还是展开后的实际节点？需提前明确交互语义，否则用户设置的 `m=5` 可能实际加载了 50 个节点。

---

| 优先级 | 编号 | 问题 | 状态 |
|--------|------|------|------|
| P1 | BUG-1 | 探索按钮状态计算失效 | 待修复 |
| P1 | BUG-2 | 画布闪烁与 d3-force 性能 | 待优化 |
| P2 | IMPROVE-1 | 探索深度与完成状态互斥 | 待设计 |
| P3 | FEAT-1 | 关联节点聚合树状结构 | 规划中 |
| P3 | FEAT-2 | 核心节点配置与条件聚合 | 规划中 |
| ~~P3~~ | ~~#9~~ | ~~滑块频繁重算~~ | ~~待处理~~ |
| ~~P3~~ | ~~#10~~ | ~~切换模式丢失历史~~ | ~~待处理~~ |
