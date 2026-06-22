# DeepScope 前端

> 纯前端通用图谱可视化组件，基于 React + AntV G6 + Zustand + Tailwind CSS。

## 1. 快速开始

### 开发

```
npm install
npm run dev
```

开发模式下 Vite proxy 自动将 `/api` 请求转发至 `vite.config.ts` 中配置的后端地址（默认 `localhost:8002`）。

### 生产构建

```
npm run build    # 输出到 dist/
npm run preview  # 预览构建产物
```

生产部署时将 `dist/` 托管至 nginx 等静态服务器即可。

### 图标

使用 [Lucide](https://lucide.dev/icons/) 图标库。

---

## 2. 配置文件 `app-config.json`

前端运行时加载同目录下的 `app-config.json`。部署时可直接修改，无需重新构建。所有字段均为可选，缺失时使用代码默认值。

| 场景 | 路径 |
|------|------|
| 开发 | `public/app-config.json` |
| 生产 | `dist/app-config.json`（与 `index.html` 同目录） |

### 完整示例

```json
{
  "apiBaseUrl": "http://localhost:8002",
  "apiEndpoints": {
    "domains": "/api/domains",
    "initial": "/api/graph/initial",
    "expand": "/api/graph/expand",
    "neighbors": "/api/graph/neighbors",
    "nodes": "/api/graph/nodes"
  },
  "auth": {
    "enabled": true,
    "tokenEndpoint": "/api/Auth/replaceToken",
    "tokenParam": "token",
    "refreshGraceSeconds": 300
  },
  "explore": {
    "m": 5,
    "n": 3,
    "mMax": 20,
    "nMax": 6
  },
  "highlight": {
    "directRelations": 5,
    "depth": 1,
    "directRelationsMax": 20,
    "depthMax": 3
  },
  "display": {
    "showEdgeArrows": true,
    "showEdgeLabels": false,
    "trackSelectedNode": true,
    "expandTrigger": "rightclick",
    "showCategoryLabel": true
  },
  "batchLoad": {
    "pageSize": 5,
    "pageSizeMax": 10
  },
  "categoryColors": {
    "usePalette": true,
    "paletteThreshold": 20
  },
  "maxTotalNodes": 100
}
```

### 2.1 `apiBaseUrl` — 后端地址

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiBaseUrl` | string | `""` | 后端 API 根地址，含协议和端口 |

| 值 | 行为 |
|----|------|
| `""`（空） | 使用相对路径。开发时经 Vite proxy 转发；生产时要求前后端同域 |
| `"http://192.168.1.7:8002"` | 所有 API 请求直连该地址（需后端支持 CORS） |

> 应用初始化时最先加载该字段，后续所有 API 请求均使用此地址。

### 2.2 `explore` — 多层展开设置

控制"多层展开"按钮的 BFS 深度/广度，以及 UI 滑块的可调范围。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `m` | int | 5 | 每层直接邻居数量上限 |
| `n` | int | 1 | 间接层数（深度） |
| `mMax` | int | 20 | UI 滑块中 `m` 的可调上限 |
| `nMax` | int | 5 | UI 滑块中 `n` 的可调上限 |

### 2.3 `batchLoad` — 更多邻居设置

控制"更多邻居"按钮每批请求的直接邻居数量。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pageSize` | int | 10 | 每次"更多邻居"请求几个直接邻居 |
| `pageSizeMax` | int | 30 | UI 滑块中 `pageSize` 的可调上限 |

### 2.4 `highlight` — 高亮设置

控制选中节点时 BFS 高亮的可见范围。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `directRelations` | int | 5 | BFS 每层邻居数 |
| `depth` | int | 1 | BFS 深度 |
| `directRelationsMax` | int | 20 | UI 滑块中该值的上限 |
| `depthMax` | int | 3 | UI 滑块中该值的上限 |

### 2.5 `display` — 显示设置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `showEdgeArrows` | boolean | false | 是否显示边箭头 |
| `showEdgeLabels` | boolean | false | 是否显示边标签 |
| `trackSelectedNode` | boolean | true | 选中节点时是否自动聚焦 |
| `showCategoryLabel` | boolean | true | 是否在节点标签前显示类别（格式：`类别：名称`） |
| `expandTrigger` | string | `"dblclick"` | 节点展开触发方式 |

`expandTrigger` 可选值：

| 值 | 双击 | 右键 | 说明 |
|----|------|------|------|
| `"dblclick"` | 展开 | — | 默认 |
| `"rightclick"` | — | 展开 | 阻止浏览器右键菜单 |
| `"both"` | 展开 | 展开 | 阻止浏览器右键菜单 |
| `"none"` | — | — | 仅按钮触发 |

### 2.6 `maxTotalNodes` — 节点上限

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxTotalNodes` | int | `0`（不限制） | 节点总数上限，超限后不再追加 |

> 设为 `0` 或不传则不限制。生产建议设置合理上限（如 200），防止画布性能问题。

### 2.6 `auth` — Token 认证配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auth.enabled` | boolean | `false` | 是否启用 Bearer Token 认证 |
| `auth.tokenEndpoint` | string | `"/api/Auth/replaceToken"` | Token 刷新端点路径（POST），用于 token 即将过期时主动换新 |
| `auth.tokenParam` | string | `"token"` | URL 参数名，外部跳转时通过该参数传入 JWT token |
| `auth.refreshGraceSeconds` | int | `300` | Token 过期前多少秒开始主动刷新（设为 `0` 禁用主动刷新，仅保留 401 保底） |

**认证流程**：
1. Token 可通过 URL 参数（如 `?token=xxx`）传入，前端会自动携带 `Authorization: Bearer <token>` 请求头
2. **主动刷新**：每次请求前解析 JWT 的 `exp` 字段，若剩余时间 < `refreshGraceSeconds`（默认 300 秒 = 5 分钟），则提前调用 `tokenEndpoint` 换取新 token，确保请求始终携带有效 token
3. 并发请求仅触发一次刷新，其余排队等待
4. **被动保底**：若主动刷新未覆盖到（如无 `exp` 字段的 token），收到 401 时仍会触发刷新并重试

> 若 `enabled: false`（默认），则所有认证逻辑跳过，与现有行为一致。

### 2.7 配置生效方式

| 操作 | 生效 |
|------|------|
| 修改 `public/app-config.json` | 需重新 `vite build` |
| 修改 `dist/app-config.json` | 刷新浏览器即生效 |

