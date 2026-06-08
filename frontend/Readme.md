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
  "apiBaseUrl": "http://localhost:8003",
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
    "expandTrigger": "dblclick"
  },
  "batchLoad": {
    "pageSize": 10,
    "pageSizeMax": 30
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
| `"http://192.168.1.7:8003"` | 所有 API 请求直连该地址（需后端支持 CORS） |

> 应用初始化时最先加载该字段，后续所有 API 请求均使用此地址。

### 2.2 `explore` — 多层展开设置

控制"多层展开"按钮的 BFS 深度/广度，以及 UI 滑块的可调范围。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `m` | int | 5 | 每层直接邻居数量上限 |
| `n` | int | 1 | 间接层数（深度） |
| `mMax` | int | 20 | UI 滑块中 `m` 的可调上限 |
| `nMax` | int | 5 | UI 滑块中 `n` 的可调上限 |

### 2.3 `batchLoad` — 分批加载设置

控制"分批加载"按钮每批请求的直接邻居数量。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `pageSize` | int | 10 | 每次"分批加载"请求几个直接邻居 |
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

### 2.6 配置生效方式

| 操作 | 生效 |
|------|------|
| 修改 `public/app-config.json` | 需重新 `vite build` |
| 修改 `dist/app-config.json` | 刷新浏览器即生效 |

