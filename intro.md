# DeepScope 设计文档（最终版）

启动后端：
```
uv run uvicorn server:app --host 0.0.0.0 --port 8002
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
  - 支持对同一节点分批加载更多直接邻居（通过“加载更多”按钮，仅广度，不触发深度）。
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

## 3. 数据接口规范

后端需提供两个接口，返回 **子图 JSON**（节点 + 边）。

### 3.1 初始加载接口
- **请求**：`GET /api/graph/initial` 或 `POST /api/graph/initial`（具体由后端定义）
- **响应**：
```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```
- **说明**：初始加载不受 `m`/`n` 影响，完全由后端决定展示哪些节点。

### 3.3 节点查询接口（按 ID 查询）
- **请求**：`GET /api/graph/nodes`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ids` | string | 是 | 逗号分隔的节点 ID 列表（当前仅支持单个） |
| `domain` | string | 否 | 查询的 domain，默认取首个可用 domain |

- **响应**：
```json
{
  "nodes": [ { "id": "人员/person-00022", ... } ],
  "edges": []
}
```
- **说明**：仅返回指定节点本身，不返回边和邻居。用于通过 URL 参数直接定位首屏节点。

### 3.2 节点展开接口（累积增长 + 分页加载更多）
- **请求**：`POST /api/graph/expand`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | 是 | 当前点击的节点 ID |
| `m` | int | 是 | 本次请求希望获取的直接邻居数量（即 `limit`） |
| `n` | int | 是 | 间接层数（仅当 `offset=0` 时有效；`offset>0` 时后端应强制按 `n=1` 处理） |
| `offset` | int | 否 | 直接邻居偏移量，默认为 0 |
| `excludeExistingIds` | string[] | 是 | 当前画布已存在的节点 ID 列表（用于去重） |

- **响应**：
```json
{
  "nodes": [...],
  "edges": [...],
  "totalNeighbors": 123
}
```
- `totalNeighbors` 始终为当前节点的**全部直接邻居总数**（不受分页影响）。

- **行为规则**：
  1. **首次点击（`offset=0`）**：按 `m`、`n` 返回子图，`totalNeighbors` 返回直接邻居总数。
  2. **加载更多（`offset>0`）**：后端忽略 `n`（即 `n=1`），只返回下一批直接邻居及其与当前节点的边。
  3. **去重**：返回的节点和边应排除 `excludeExistingIds` 中已存在的节点和边。

## 4. 数据模型

### 4.1 节点字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 |
| `label` | string | 是 | 显示文本 |
| `type` | string | 否 | 类型（如 `person`, `company`） |
| `url` | string | 否 | 跳转链接（新标签页打开） |
| `description` | string | 否 | 详情描述 |
| `style` | object | 否 | 遵循 G6 节点样式规范（如 `size`, `fill`, `stroke` 等） |

### 4.2 边字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `source` | string | 是 | 源节点 id |
| `target` | string | 是 | 目标节点 id |
| `label` | string | 否 | 关系描述 |
| `type` | string | 否 | 关系类型 |
| `style` | object | 否 | 遵循 G6 边样式规范（如 `stroke`, `lineWidth`, `endArrow` 等） |

- **边去重策略**：前端按 `source+target` 合并，同一对节点之间只保留一条边（多重边暂不支持，后续可启用 G6 `multiEdge`）。



## 11. 测试指南

### 11.1 URL 首屏节点参数测试

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

---

**文档版本**：1.2  
**最后更新**：2026-06-07  
