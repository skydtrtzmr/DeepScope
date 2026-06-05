# 前端

开发模式部署到指定ip；

```
npm run dev
```

在vite.config.ts里配置server。

## icon

https://lucide.dev/icons/

## 关于高亮节点

BFS 高亮邻居选取顺序：当 `directRelations`（每层邻居上限）小于节点实际邻居总数时，BFS 按邻接表顺序取前 N 个。邻接表由 `fullData.edges` 数组顺序构建，无额外排序，即与导出的 JSON 图谱文件中 edge 列表的顺序一致。

## 高亮