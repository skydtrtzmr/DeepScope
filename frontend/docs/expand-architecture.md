# 节点展开与增量渲染架构

> 最后更新：2026-06-08

## 双 API 拆分设计

节点探索拆为两个独立接口，对应操作面板上的两个独立按钮：

| 按钮 | API | 参数 | 含义 |
|------|-----|------|------|
| **多层展开** | `POST /api/graph/expand` | `nodeId, m, n, domain` | BFS 多层，每节点每层最多 m 个新邻居，最大深度 n |
| **分批加载** | `POST /api/graph/neighbors` | `nodeId, limit, excludeIds, domain` | 单层分页，排除已有邻居后返回下一批 |

两个按钮共享的唯一状态是 `fullData`（节点/边合集），除此之外互不依赖。

## 数据流

```
                        ┌─────────────────────────┐
                        │      fullData            │
                        │  (nodes + edges)         │
                        │  唯一共享状态             │
                        └───────┬─────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   │                   ▼
   bfsExpandNode(nodeId)        │        loadMoreNeighbors(nodeId)
            │                   │                   │
            ▼                   │                   ▼
   POST /api/graph/expand       │        POST /api/graph/neighbors
   后端全量返回 BFS 发现         │        后端排除 excludeIds
   的所有节点和边               │        后返回下一批
            │                   │                   │
            ▼                   │                   ▼
   mergeExpansionResult('bfs', ...)        mergeExpansionResult('neighbors', ...)
            │                                        │
            └────────────────┬───────────────────────┘
                             ▼
                    pendingAddition
                    { nodes, edges }
                             │
                             ▼
                  graph.addData() + render()
                             │
                             ▼
                    commitAddition → 更新 fullData
```

## 前端去重逻辑（mergeExpansionResult）

两个 action 共用同一套去重流程，仅 toast 文案不同：

```typescript
// graph-store.ts — mergeExpansionResult(context, nodeId, result, ...)

// 1. 节点去重
const newNodes = result.nodes.filter((n) => !existingNodeIds.has(n.id));

// 2. 边去重 + 悬空边过滤
const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));
const allNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
const newEdges = result.edges.filter(
  (e) => !existingEdgeIds.has(e.id)
    && allNodeIds.has(e.source)
    && allNodeIds.has(e.target),
);

// 3. 上限截断
if (fullData.nodes.length + newNodes.length > maxTotalNodes) { /* 截断 */ }

// 4. 无新数据时 toast
//    context='bfs'      → "未加载到新节点，可调高参数后重试"
//    context='neighbors' → "直接邻居已全部加载，可尝试多层展开获取间接关联节点"
```

## 为什么 neighbors 可以安全使用 excludeIds？

对于 `neighbors` API，排除的是**同一节点的直接邻居**，不存在桥接边丢失问题：

```
person-00778 的直接邻居：A, B, C, D, E, F（共 6 个）
已加载：A, B, C, D → excludeIds = [A, B, C, D]
分批加载下一批 → 返回 E, F + 边 00778↔E、00778↔F

A↔B、C↔D 等边 → 之前已加载，不会丢失
E↔A 等"邻居间"边 → 不是 neighbors 的职责，
  后续探索 E 时会被 BFS 或分批加载自然发现
```

> **与旧设计的区别**：旧统一 `expand` 接口如果传全量 `excludeIds`（排除画布上所有已有节点），在跨节点展开时（先展开 B 再展开 C）会丢失 B↔C 桥接边。现在拆分为 `expand`（全量返回，前端去重）和 `neighbors`（单节点排除），两个场景互不干扰。

## expand 接口：后端全量返回，前端负责去重

`expand` 是 BFS 多层展开，后端不接收 `excludeIds`，将展开过程中发现的所有节点和边**全量返回**。节点去重、边去重、数据合并全部由前端处理。

### 为什么 expand 不做后端排除？

如果 `expand` 也将画布上所有已有节点 ID 放入 `excludeIds` 让后端排除，会导致**桥接边丢失**：

```
场景：A 同时连接 B 和 C
1. 展开 B → 加载 A、B，画布上绘制 A↔B
2. 展开 C → A 在 excludeIds 中，后端排除 A → C→A 的边丢失
```

正确做法：A 已经在画布上了，展开 C 时让后端正常返回 A 的数据和 C→A 的边，前端合并去重后自然就能连线。

## 增量渲染的边过滤（graph-container.tsx）

`toG6Edges` 用 `nodeIdSet`（已有 + 新增节点）过滤边，确保不会出现悬空边：

```typescript
const existingNodeIds = fullData ? fullData.nodes.map((n) => n.id) : [];
const allNodeIds = [...existingNodeIds, ...pendingAddition.nodes.map((n) => n.id)];
const nodeIdSet = new Set(allNodeIds);
// 桥接边（如 C→A）两端都在 nodeIdSet 中，不会被过滤
```

## 新增节点位置散布

首次展开时，新增节点围绕选中节点环形散布（半径 80~120px），避免默认 (0,0) 位置把力导向拽偏：

```typescript
const angle = (i / g6Data.nodes.length) * 2 * Math.PI;
const radius = 80 + Math.random() * 40;
// 新增节点散布在 anchorX / anchorY 周围
```

## 当前方案的取舍

| 方面 | 说明 |
|------|------|
| 优点 | 两个按钮语义独立，参数分开配置；neighbors 用 excludeIds 精确分页减少传输；expand 全量返回避免桥接边丢失 |
| 代价 | expand 后端可能返回重复节点/边，BFS 可能重复遍历已加载节点的邻居；neighbors 不负责邻居间的桥接边（由后续探索自然发现） |
| 适用 | mock 阶段数据量小，重复数据对性能无影响 |
| 后续优化 | 如数据量增大，可考虑给 expand 传 BFS visited 集合（仅排除已遍历节点，不含所有画布节点）以减少冗余返回 |
