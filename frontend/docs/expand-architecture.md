# 节点展开与增量渲染架构

## 核心思路：后端全量返回，前端负责去重

后端 expand 接口不接收 `excludeIds` 参数，将展开节点的所有邻居节点和相关边**全量返回**。节点去重、边去重、数据合并全部由前端处理。

### 为什么后端不做排除？

早期方案将画布上所有已有节点 ID 放入 `excludeIds`，后端据此排除。但这会导致**桥接边丢失**：

```
场景：A 同时连接 B 和 C
1. 展开 B → 加载 A、B，画布上绘制 A↔B
2. 展开 C → A 在 excludeIds 中，后端排除 A → C→A 的边丢失
```

正确做法：A 已经在画布上了，展开 C 时让后端正常返回 A 的数据和 C→A 的边，前端合并去重后自然就能连线。

## 数据流

```
前端 expandNode(nodeId)
  │
  ▼
后端 POST /api/graph/expand
  │  全量返回所有邻居节点 + 所有相关边（含已加载节点的）
  ▼
前端 merge（graph-store.ts expandNode）
  ├─ newNodes = result.nodes 去重（排除 existingNodeIds）
  ├─ newEdges = result.edges 去重（排除 existingEdgeIds + 悬空边过滤）
  └─ pendingAddition = { nodes: newNodes, edges: newEdges }
       │
       ▼
  graph-container.tsx 增量渲染
       ├─ nodeIdSet = existingNodeIds ∪ newNodeIds
       ├─ toG6Edges 用 nodeIdSet 过滤悬空边
       └─ graph.addData() + render() 追加到画布
       │
       ▼
  commitAddition → 更新 fullData
```

## 前端去重逻辑（graph-store.ts）

```typescript
const existingNodeIds = new Set(fullData.nodes.map((n) => n.id));

// 节点去重：后端可能返回画布上已有的节点（如桥接节点 A），过滤掉
const newNodes = result.nodes.filter((n) => !existingNodeIds.has(n.id));

// 边去重：已存在的边不重复添加；两端节点都必须在 nodeIdSet 中才保留
const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));
const allNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
const newEdges = result.edges.filter(
  (e) => !existingEdgeIds.has(e.id) && allNodeIds.has(e.source) && allNodeIds.has(e.target),
);
```

## 增量渲染的边过滤（graph-container.tsx）

`toG6Edges` 用 `nodeIdSet`（包含已有 + 新增节点）过滤边，确保不会出现悬空边：

```typescript
const existingNodeIds = fullData ? fullData.nodes.map((n) => n.id) : [];
const allNodeIds = [...existingNodeIds, ...pendingAddition.nodes.map((n) => n.id)];
const nodeIdSet = new Set(allNodeIds);
// 桥接边（如 C→A）两端都在 nodeIdSet 中，不会被过滤
```

## 当前方案的取舍

| 方面 | 说明 |
|------|------|
| 优点 | 桥接边不会丢失，逻辑简单，前端完全掌控数据一致性 |
| 代价 | 后端可能返回重复节点/边，BFS 可能重复遍历已加载节点的邻居 |
| 适用 | mock 阶段数据量小，重复数据对性能无影响 |
| 后续优化 | 如数据量增大，可仅排除 BFS 需回溯的节点（visited 集合），而非全部已有节点 |
