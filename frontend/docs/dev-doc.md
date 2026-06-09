# 开发文档 

## 3. 技术栈

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

## 5. 前端核心交互设计

### 5.1 状态管理分工
- **Zustand**：管理图谱数据（`nodes` Map, `edges` Map）、当前选中节点、每个节点的已加载直接邻居 ID 列表及 `totalNeighbors`、`pendingAddition`（待渲染的增量数据）。
- **TanStack Query**：管理 API 请求的 loading/error/cache，请求成功后调用 Zustand actions 更新数据。

### 5.2 初始加载
- 使用 `useQuery` 调用 `GET /api/graph/initial`，数据返回后渲染并布局（力导向布局）。

### 5.3 节点多层展开（BFS 累积增长）
- 读取当前 `m`、`n`，调用 `POST /api/graph/expand`（参数：`nodeId`, `m`, `n`, `domain`）。
- 后端全量返回 BFS 发现的所有节点和边（不接收 `excludeIds`），前端 `mergeExpansionResult` 负责去重。
- 成功后合并到 fullData，并调用 G6 增量添加。
- 新节点布局：保持原有节点位置不变，新节点围绕点击节点做放射状分布（角度均分，半径约 100px）。
- 自动轻度平移/缩放，使新节点可见。

### 5.4 加载更多（分页加载直接邻居）
- 详情列表底部显示"加载更多"按钮（`已加载直接邻居数 < totalNeighbors`）。
- 调用 `POST /api/graph/neighbors`（参数：`nodeId`, `limit`, `excludeIds`, `domain`）。
- `excludeIds` 为已加载的直接邻居 ID 列表，后端排除后返回下一批未加载邻居。
- `limit` 取自 `batchLoadConfig.limit`（前端可配置，默认 5）。
- 成功后仅追加新节点和边，不影响已有节点位置。
- 与 BFS 多层展开（expand）互不干扰，两个按钮独立调用。

### 5.5 详情列表
- 数据源：当前选中节点的**已加载直接邻居**（从 Zustand 中获取）。
- 虚拟滚动：使用 `@tanstack/react-virtual`。
- 每项展示 `label` 和 `description`，若存在 `url` 则显示跳转图标。
- 点击列表项：若有 `url` 则新标签页跳转；否则高亮图谱中对应节点（`graph.setItemState`）。
- 高亮清除：点击其他节点时高亮转移；点击画布空白区域清除。

### 5.6 m/n 控件
- 提供滑动条或数字输入框，范围 m: 1-20，n: 1-3。
- 默认值：`m=5`, `n=2`（前端常量可配置）。
- 控件位置：顶部工具栏或右侧边栏。

### 5.6.1 显示设置（工具栏 Settings 面板）
顶部工具栏右侧的 **Settings** 按钮打开浮动面板，提供以下开关：

| 开关 | 默认 | 说明 |
|------|------|------|
| 跟踪选中节点 | 开启 | 选中节点时是否自动聚焦到该节点。关闭后，点击节点仅高亮和展开，不会移动画布视口 |
| 显示箭头 | 关闭 | 是否在所有边上绘制方向箭头 |
| 显示标签 | 关闭 | 是否显示边的文本标签 |

- 关闭**跟踪选中节点**后，可通过鼠标滚轮/拖拽自由浏览，选中节点不再打断当前视野
- 切换显示设置时仅调用 `graph.setEdge()` + `graph.draw()`，不重建图、不重排布局

### 5.7 重置功能
- "重置"按钮：清空 Zustand 和图谱；重新请求初始数据；重置画布视图；清空选中节点和列表。
- 无需二次确认。

### 5.8 加载状态与错误处理
- 请求期间禁用对应按钮并显示 loading 图标（可使用 TanStack Query 的 `isLoading`）。
- 错误时显示 Toast 提示，用户可重试。

### 5.9 孤立节点处理
- 若 `totalNeighbors === 0`，点击节点后不发起请求，提示"该节点无关联节点"，列表清空。

### 5.10 URL 首屏节点参数
前端支持通过 URL 查询参数直接指定首屏初始节点，无需使用 `?data=` 传入完整 JSON。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `node` | string | 是 | 首屏要高亮并展开的中心节点 ID（如 `人员/person-00022`） |
| `expand` | string | 否 | `1` 或不传时自动展开邻居；`0` 时仅选中中心节点，不展开 |
| `m` | int | 否 | 初始展开的广度（每层邻居数），独立于 UI 滑块配置 |
| `n` | int | 否 | 初始展开的深度（间接层数），独立于 UI 滑块配置 |
| `domain` | string | 否 | 指定 domain，不传时使用默认首个 domain |

> **`m`/`n` 与 UI 滑块的分离设计**：URL 的 `m`/`n` 仅影响首屏初始展开，与操作界面中的可调滑块互不干扰。URL 未传 `m`/`n` 时，展开展走 UI 滑块配置；传了则用 URL 参数，后续用户的按钮/双击/右键探索仍走 UI 滑块配置。

**首屏加载流程**：
1. 若 URL 存在 `?node=`，前端调用 `GET /api/graph/nodes?ids=...&domain=...` 获取节点
2. `setGraphData` 渲染中心节点
3. 等待 G6 渲染完成后（约 300ms）自动 `selectNode`
4. 若 `expand !== '0'` 或 URL 含 `m`/`n`，自动调用 `POST /api/graph/expand`（BFS 多层展开）

## 6. 布局策略

- **初始布局**：G6 力导向布局（`type: 'force'`）。
- **增量布局**：新增节点时，保持旧节点位置，新节点围绕其父节点（被点击的节点）随机放射状排列（半径 120px，角度均匀）。若父节点位置不存在（初次渲染），则使用画布中心。
- **用户拖拽**：支持拖拽节点，拖拽后的位置在当前会话中保持。
- **自动视野**：调用 `graph.fitView` 但仅当新节点位于视口外时才轻微调整，避免频繁移动。

## 7. 与外部系统集成

- 通过 **iframe** 嵌入 U3 系统，无额外通信需求。
- 外部系统无法直接传参，DeepScope 独立运行。

## 8. 错误与边界处理

- 网络错误：显示"网络请求失败，请重试"。
- 数据格式错误：console.error 并提示"数据格式无效"。
- m/n 控件非法值：前端钳制到有效范围。
- 节点展开超时：使用 TanStack Query 的 `timeout` 配置或手动处理。

## 9. 后续扩展方向（不在当前版本）

- 多重边支持（启用 G6 multiEdge）。
- 节点搜索/定位。
- 导出画布为图片。
- 撤销/重做。
- 按节点类型过滤。
- 主题切换。
- neighbors 支持多层深度。

## 10. 附录：G6 样式参考

节点 `style` 常用属性（G6 3.x/4.x 通用）：
- `size`: 30
- `fill`: '#1890ff'
- `stroke`: '#000'
- `lineWidth`: 1

边 `style` 常用属性：
- `stroke`: '#999'
- `lineWidth`: 2
- `lineDash`: [5, 5]
- `endArrow`: true
