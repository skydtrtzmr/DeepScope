# 修复：图谱加载后立刻探索导致节点/边闪烁

## 问题现象

图谱刚加载出来、力导向布局仍在进行时就双击节点探索，会出现**节点和边先出现在附近错误位置（颜色较浅），然后瞬间恢复到正确位置**的闪烁现象。

## 根因分析

### 1. d3-force 布局是持续迭代的

首次 `graph.render()` 会启动 d3-force 力导向模拟，节点位置在数秒内会持续微动，直到 `alpha` 衰减到阈值才停止。

```typescript
layout: {
  type: 'd3-force',
  link: { distance: 180, strength: 0.6 },
  manyBody: { strength: -80 },
  collide: { radius: 40, strength: 1 },
  center: { strength: 0.05 },
  alphaDecay: 0.02,
  velocityDecay: 0.3,
},
```

### 2. `graphReadyRef` 被过早标记为 true

`createGraph` 里用 `requestAnimationFrame` 在下一帧绘制后就标记 `graphReadyRef.current = true`，但此时 d3-force 的迭代布局远未结束。

### 3. 新旧布局冲突（核心原因）

当用户"刚加载没多久就双击探索"时：

1. 首次 `render()` 的力导向布局**仍在迭代中**
2. `pendingAddition` 的 `useEffect` 立即执行：

```typescript
graph.addData(g6Data);
hasPendingLayoutRef.current = true;
graph.render();
```

这里**没有停止旧布局**就直接调用了第二次 `render()`。根据 G6 v5 官方文档 (`docs/api/layout.zh.md`)：

> `stopLayout()` 适用于带有迭代动画的布局，目前有 `force` 属于此类布局。当布局计算时间过长时，可以手动停止迭代。

两次 `render()` 同时/重叠触发布局计算，导致已有节点位置被重新初始化再跳变到新位置，肉眼表现为**"闪烁"**。

### 时序图

```
用户          G6 Graph          d3-force布局
 │               │                  │
 │─页面加载─────▶│                  │
 │               │─setData()+render()│
 │               │─────────────────▶│
 │               │                  │─迭代进行中...
 │               │                  │  节点持续微动
 │─很快双击探索──▶│                  │
 │               │─addData()+render()│
 │               │  ❌ 没有stopLayout()│
 │               │                  │─旧布局迭代
 │               │                  │ +新布局计算冲突
 │               │                  │
 │◀─看到闪烁─────│                  │
```

## 修复方案

### 最小改动：探索前强制停止当前布局

在 `pendingAddition` 的 `useEffect` 中，`addData` 之前调用 `graph.stopLayout()`，确保旧布局迭代不会和新 `render()` 冲突。

```typescript
// frontend/src/components/graph/graph-container.tsx

console.log(
  `[graph] 增量渲染 → addData ${pendingAddition.nodes.length} 节点, ${pendingAddition.edges.length} 边（rebuildTrigger=${rebuildTrigger}）`
);

+ graph.stopLayout();
  graph.addData(g6Data);
  const gen = graphGenerationRef.current;
  hasPendingLayoutRef.current = true;
  graph.render();
```

## 验证结果

修改后，图谱加载完成后立刻双击节点探索，**不再出现节点/边位置跳变的闪烁现象**。

## 相关文档

- `docs/api/layout.zh.md` — `stopLayout()` 的 API 说明
- `docs/manual/layout/D3Force.zh.md` — d3-force 布局参数说明
- [expand-architecture.md](./expand-architecture.md) — 增量渲染架构
