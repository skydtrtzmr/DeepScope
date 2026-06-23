# DeepScope 设计文档

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/skydtrtzmr/DeepScope)

## 1. 项目概述
- **产品名称**：DeepScope  
- **定位**：纯前端通用图谱可视化组件，支持累积式增长、可配置深度/广度、详情列表联动，可嵌入 U3 等外部系统。  
- **核心特性**：
  - 初始图谱由后端决定并返回核心节点及边。
  - 用户点击节点时，按可配置的 `m`（直接邻居数）和 `n`（间接层数）向后端请求新子图，并**追加**到现有画布（累积增长）。
  - 支持用户通过界面控件实时调整 `m`、`n` 值（默认 `m=5`，`n=2`，前端可配置初始值）。
  - 支持对同一节点分批加载更多直接邻居（通过"加载更多"按钮，仅广度，不触发深度）。
  - 图谱右侧提供详情列表，展示当前选中节点的**已加载**直接邻居，支持点击跳转或高亮图谱节点；列表采用虚拟滚动优化长列表性能。
  - 纯 iframe 嵌入，可通过URL传递首屏参数，不依赖外部系统通信。

## 2. 使用说明

### 启动后端

在后端目录下运行
```
uv run uvicorn server:app --host 0.0.0.0 --port 8002
```

### 启动前端

在前端目录下，
构建：
```
npm run build
```

运行预览：
```
npm run preview
```

前端配置文件：
`app-config.json`

## 3. 接口设计

后端提供 5 个 HTTP 接口，详细参数和模型定义见 [`api-doc.md`](./api-doc.md)。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/domains` | 获取可用业务域列表 |
| GET | `/api/graph/initial` | 初始图谱加载（由后端配置决定） |
| POST | `/api/graph/expand` | BFS 多层展开（后端全量返回，前端去重） |
| POST | `/api/graph/neighbors` | 分页加载直接邻居（后端排除 excludeIds） |
| GET | `/api/graph/nodes` | 按 ID 查询节点（URL 首屏定位用） |

### 节点探索 API（双版本）

202605 旧版本中只有一个节点探索接口，同时包含深度、广度指定和分批加载功能。
202606 经考虑，旧版本存在多级深度下的设计逻辑问题，将该接口拆分为两个独立版本：

> 两个 API 本身都是**幂等**的（相同请求体 = 相同响应）。区别在于**前端按钮**行为：
> - **多层展开按钮**：前端的 `m`、`n` 不变的情况下，每次发相同参数；适合首屏触发和 URL 指定
> - **更多邻居按钮**：每次需要前端根据已加载数据计算 `excludeIds`，参数随状态变化

- **expand**：后端根据 `m`（每层邻居数）、`n`（深度）参数，全量返回发现的所有节点和边，**不接收 `excludeIds`**，前端负责去重合并。避免跨节点展开时桥接边丢失。
- **neighbors**：后端接收 `excludeIds` 排除已加载邻居，根据 `limit`（每批数量）参数返回下一批。由于始终查询同一节点，排除不会导致边丢失。后端决定返回节点的范围（例如多层查询的层数限制）。

## 5. 测试指南

### 5.1 URL 首屏节点参数测试

假设前端运行在 `http://localhost:4173`，后端已启动并包含 `demo-region` domain：

1. **自动展开邻居（默认）**
   ```
   http://localhost:4173/?domain=demo-region&node=人员/person-00022
   ```
   - 预期：首屏只显示 `person-00022` 一个节点，然后高亮选中并自动展开邻居子图（展开参数走 UI 默认配置）。

2. **指定展开广度/深度（独立于 UI）**
   ```
   http://localhost:4173/?domain=demo-region&node=人员/person-00022&m=5&n=2
   ```
   - 预期：高亮选中后自动展开子图，m=10（每层 5 个邻居）、n=2（深度 2 层）。UI 滑块配置不受影响。

3. **仅指定广度**
   ```
   http://localhost:4173/?domain=demo-region&node=人员/person-00022&m=3
   ```
   - 预期：m=3（每层 3 个邻居），n 走 exploreConfig 默认值（通常 n=1）。

4. **仅渲染中心节点，不自动展开**
   ```
   http://localhost:4173/?domain=demo-region&node=人员/person-00022&expand=0
   ```
   - 预期：首屏只显示 `person-00022`，节点被选中，但不调用 `expandNode`，画布保持单节点状态。

5. **不指定 domain（使用默认）**
   ```
   http://localhost:4173/?node=人员/person-00022
   ```
   - 预期：使用首个可用 domain 查询节点。

6. **指定多个节点（逗号分隔）**
   ```
   http://localhost:4173/?domain=demo-region&node=项目/proj-00093,项目/proj-00171,项目/proj-00172
   ```
   - 预期：首屏同时显示三个项目节点，可分别点击展开各自的邻居。

7. **节点 ID 不存在**
   ```
   http://localhost:4173/?node=不存在的节点
   ```
   - 预期：`/api/graph/nodes` 返回空数组，画布无节点，显示空白或 loading 状态。

8. **通过 filter 参数传递筛选条件**
   ```
   http://localhost:4173/?filter=%7B%22project%22%3A%22aaa%22%2C%22type%22%3A%5B%22%E9%A1%B9%E7%9B%AE%22%5D%7D
   ```
   - 预期：页面加载后筛选条件解析存入全局状态，后续点击节点展开（`POST /api/graph/expand`）或加载更多邻居（`POST /api/graph/neighbors`）时，请求体自动附带 `filter` 字段。
   - 编码前 JSON：`{"project":"aaa","type":["项目"]}`

### 5.2 Bruno API 测试

项目内置 Bruno 测试集合，位于 `backend/bruno-api-test/DeepScope/`，覆盖所有 5 个接口。用 [Bruno](https://www.usebruno.com/) 打开该目录即可使用。

---

**文档版本**：2.0  
**最后更新**：2026-06-09  
