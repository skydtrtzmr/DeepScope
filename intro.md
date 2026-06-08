# DeepScope 设计文档

启动后端：
```
uv run python server.py
```

启动前端：
```
npm run build
npm run preview
```

## 1. 项目概述
- **产品名称**：DeepScope  
- **定位**：纯前端通用图谱可视化组件，支持累积式增长、可配置深度/广度、详情列表联动，可嵌入 U3 等外部系统。  
- **核心特性**：
  - 初始图谱由后端决定并返回核心节点及边。
  - 用户点击节点时，按可配置的 `m`（直接邻居数）和 `n`（间接层数）向后端请求新子图，并**追加**到现有画布（累积增长）。
  - 支持用户通过界面控件实时调整 `m`、`n` 值（默认 `m=5`，`n=2`，前端可配置初始值）。
  - 支持对同一节点分批加载更多直接邻居（通过"加载更多"按钮，仅广度，不触发深度）。
  - 图谱下方提供详情列表，展示当前选中节点的**已加载**直接邻居，支持点击跳转或高亮图谱节点；列表采用虚拟滚动优化长列表性能。
  - 纯 iframe 嵌入，不依赖外部系统通信。

## 2. 技术栈

| 类别 | 技术选型 |
|------|-----------|
| 框架 | React 18 + TypeScript |
| 图谱可视化 | AntV G6（样式完全遵循 G6 规范） |
| 状态管理 | Zustand |
| 数据请求 | axios + TanStack Query（@tanstack/react-query） |
| 虚拟滚动 | @tanstack/react-virtual |
| UI 组件库 | shadcn/ui |
| 构建工具 | Vite |
| 样式 | Tailwind CSS |

## 3. 接口设计

后端提供 5 个 HTTP 接口，详细参数和模型定义见 [`api-doc.md`](./api-doc.md)。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/domains` | 获取可用业务域列表 |
| GET | `/api/graph/initial` | 初始图谱加载（由后端配置决定） |
| POST | `/api/graph/expand` | BFS 多层展开（后端全量返回，前端去重） |
| POST | `/api/graph/neighbors` | 分页加载直接邻居（后端排除 excludeIds） |
| GET | `/api/graph/nodes` | 按 ID 查询节点（URL 首屏定位用） |

### 设计决策：为什么拆分为 expand + neighbors

- **expand（BFS 多层）**：后端全量返回发现的所有节点和边，**不接收 `excludeIds`**，前端负责去重合并。避免跨节点展开时桥接边丢失。
- **neighbors（单层分页）**：后端接收 `excludeIds` 精确排除已加载邻居，只返回下一批。由于始终查询同一节点，排除不会导致边丢失。

详见 [`frontend/docs/expand-architecture.md`](./frontend/docs/expand-architecture.md)。

### 边去重策略

前端按 `id` 去重。

## 4. 核心交互

详见 [`frontend/docs/dev-doc.md`](./frontend/docs/dev-doc.md)。

- **状态管理**：Zustand 管图谱数据，TanStack Query 管请求生命周期
- **增量渲染**：新增节点围绕选中节点环形散布，旧节点位置不变
- **URL 首屏参数**：支持 `?node=`、`?domain=`、`?expand=`、`?m=`、`?n=`
- **加载更多**：详情列表底部按钮，已加载数 < totalNeighbors 时可用

## 5. 测试指南

### 5.1 URL 首屏节点参数测试

假设前端运行在 `http://localhost:5173`，后端已启动并包含 `demo-region` domain：

1. **自动展开邻居（默认）**
   ```
   http://localhost:5173/?domain=demo-region&node=人员/person-00022
   ```
   - 预期：首屏只显示 `person-00022` 一个节点，约 300ms 后高亮选中并自动展开邻居子图（展开参数走 UI 默认配置）。

2. **指定展开广度/深度（独立于 UI）**
   ```
   http://localhost:5173/?domain=demo-region&node=人员/person-00022&m=10&n=2
   ```
   - 预期：高亮选中后自动展开子图，m=10（每层 10 个邻居）、n=2（深度 2 层）。UI 滑块配置不受影响。

3. **仅指定广度**
   ```
   http://localhost:5173/?domain=demo-region&node=人员/person-00022&m=3
   ```
   - 预期：m=3（每层 3 个邻居），n 走 exploreConfig 默认值（通常 n=1）。

4. **仅渲染中心节点，不自动展开**
   ```
   http://localhost:5173/?domain=demo-region&node=人员/person-00022&expand=0
   ```
   - 预期：首屏只显示 `person-00022`，节点被选中，但不调用 `expandNode`，画布保持单节点状态。

5. **不指定 domain（使用默认）**
   ```
   http://localhost:5173/?node=人员/person-00022
   ```
   - 预期：使用首个可用 domain 查询节点。

6. **节点 ID 不存在**
   ```
   http://localhost:5173/?node=不存在的节点
   ```
   - 预期：`/api/graph/nodes` 返回空数组，画布无节点，显示空白或 loading 状态。

### 5.2 Bruno API 测试

项目内置 Bruno 测试集合，位于 `backend/bruno-api-test/DeepScope/`，覆盖所有 5 个接口。用 [Bruno](https://www.usebruno.com/) 打开该目录即可使用。

---

**文档版本**：2.0  
**最后更新**：2026-06-08  
