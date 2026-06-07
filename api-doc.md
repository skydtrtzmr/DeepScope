# DeepScope API 文档

> 版本：1.0  
> 最后更新：2026-06-07

本文档描述 DeepScope 后端需实现的全部 HTTP 接口、数据模型及前端 URL 入参规范。

> 前端配置相关（`apiBaseUrl`、探索/高亮/显示默认值等）请参见 [`frontend/Readme.md`](./frontend/Readme.md)。

---

## 1. 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/domains` | 获取可用业务域列表 |
| GET | `/api/graph/initial` | 初始图谱加载 |
| POST | `/api/graph/expand` | 节点展开（累积增长 + 分页） |
| GET | `/api/graph/nodes` | 按 ID 查询节点 |

所有图谱数据接口统一使用 **子图 JSON**（`nodes` + `edges`）格式。

---

## 2. 接口详情

### 2.1 GET `/api/domains`

获取后端可用的业务域（domain）列表。

**请求参数**：无

**响应**：
```json
[
  {
    "name": "demo-region",
    "nodeCount": 120,
    "edgeCount": 350
  }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | domain 唯一名称 |
| `nodeCount` | int | 该 domain 的节点总数 |
| `edgeCount` | int | 该 domain 的边总数 |

---

### 2.2 GET `/api/graph/initial`

初始加载图谱数据，完全由后端决定展示哪些节点，不受 `m`/`n` 影响。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `domain` | string | 否 | 指定 domain，不传则使用默认 domain |

**响应**：
```json
{
  "nodes": [
    {
      "id": "人员/person-00022",
      "label": "张三",
      "category": "人员",
      "type": "person",
      "url": "https://example.com/person/00022",
      "description": "某部门员工",
      "data": {},
      "style": { "fill": "#1890ff", "radius": 30 }
    }
  ],
  "edges": [
    {
      "id": "e-001",
      "source": "人员/person-00022",
      "target": "公司/company-003",
      "label": "任职于",
      "type": "works_at",
      "data": {},
      "style": { "stroke": "#999", "lineWidth": 2 }
    }
  ]
}
```

---

### 2.3 POST `/api/graph/expand`

节点展开接口，支持累积增长和分页加载更多直接邻居。

**请求体**（JSON）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | 是 | 被展开的节点 ID |
| `m` | int | 是 | 每层直接邻居数量上限 |
| `n` | int | 是 | 间接层数（`offset > 0` 时后端应强制 `n=1`） |
| `offset` | int | 否 | 直接邻居偏移量，默认为 0。`> 0` 表示分页加载更多 |
| `domain` | string | 否 | 查询的 domain |

**响应**：
```json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "totalNeighbors": 123
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodes` | array | 新增节点列表 |
| `edges` | array | 新增边列表 |
| `totalNeighbors` | int | 该节点的**全部直接邻居总数**（不受分页/offset 影响） |

**行为规则**：

| 场景 | 行为 |
|------|------|
| **首次展开（`offset=0`）** | 按 `m`、`n` 返回子图，`totalNeighbors` 返回直接邻居总数 |
| **加载更多（`offset>0`）** | 后端忽略 `n`（按 `n=1` 处理），只返回下一批直接邻居及其与当前节点的边 |
| **去重** | 返回的节点和边应排除当前画布已存在的 ID（前端在请求中不传 `excludeExistingIds`，由后端自行感知或由前端合并后去重） |

---

### 2.4 GET `/api/graph/nodes`

按节点 ID 查询，用于 URL 首屏节点定位。

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ids` | string | 是 | 逗号分隔的节点 ID 列表 |
| `domain` | string | 否 | 查询的 domain |

**响应**：
```json
{
  "nodes": [
    { "id": "人员/person-00022", "label": "张三", "category": "人员" }
  ],
  "edges": []
}
```

> 说明：仅返回指定节点本身，不返回边和邻居。前端拿到后渲染单节点，再根据 URL 参数决定是否调用 `/api/graph/expand`。

---

## 3. 数据模型

所有图谱接口共用以下节点/边结构。通用响应格式为：

```json
{
  "nodes": [ Node, ... ],
  "edges": [ Edge, ... ]
}
```

### 3.1 节点（Node）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | **是** | 唯一标识 |
| `label` | string | **是** | 显示文本 |
| `category` | string | 否 | 分类标签（用于自动着色和分组） |
| `type` | string | 否 | 节点类型（如 `person`、`company`） |
| `url` | string | 否 | 跳转链接（新标签页打开） |
| `description` | string | 否 | 详情描述（支持 Markdown） |
| `data` | object | 否 | 自定义扩展数据 |
| `style` | object | 否 | G6 节点样式覆盖 |

`style` 常用属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `fill` | string | 填充颜色 |
| `stroke` | string | 描边颜色 |
| `radius` | number | 节点半径（仅圆形节点） |
| `size` | number | 节点大小 |

---

### 3.2 边（Edge）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 否 | 边唯一标识 |
| `source` | string | **是** | 源节点 ID |
| `target` | string | **是** | 目标节点 ID |
| `label` | string | 否 | 关系描述文本 |
| `type` | string | 否 | 关系类型（如 `works_at`、`friend_of`） |
| `data` | object | 否 | 自定义扩展数据 |
| `style` | object | 否 | G6 边样式覆盖 |

`style` 常用属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `stroke` | string | 线条颜色 |
| `lineWidth` | number | 线条宽度 |
| `lineDash` | number[] | 虚线模式（如 `[5, 5]`） |

> **边去重**：前端按 `source+target` 合并，同一对节点之间只保留一条边。

---

## 4. 前端 URL 参数

前端支持通过 URL 查询参数直接指定首屏节点，实现"深链接"效果。

### 4.1 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `node` | string | 是 | 首屏中心节点 ID（如 `人员/person-00022`） |
| `domain` | string | 否 | 指定业务域，不传使用默认首个 domain |
| `expand` | string | 否 | `0` 时仅选中不展开；默认展开 |
| `m` | int | 否 | 初始展开广度（每层邻居数），独立于 UI 滑块 |
| `n` | int | 否 | 初始展开深度（间接层数），独立于 UI 滑块 |

### 4.2 示例

```
# 完整示例：指定节点 + 广度 + 深度
http://localhost:5173/?domain=demo-region&node=人员/person-00022&m=10&n=2

# 仅指定节点（不展开，适合嵌入场景）
http://localhost:5173/?node=人员/person-00022&expand=0

# 仅指定广度，n 走默认
http://localhost:5173/?node=人员/person-00022&m=5
```

### 4.3 首屏加载流程

1. URL 含 `?node=` → 前端调用 `GET /api/graph/nodes?ids=...` 获取节点
2. 渲染中心节点，约 300ms 后自动 `selectNode`
3. 若 `expand !== '0'` 或 URL 含 `m`/`n` → 调用 `POST /api/graph/expand` 展开邻居

> `m`/`n` 仅影响首屏初始展开，与操作界面中用户可调的滑块配置互不干扰。

---

## 5. 通用规则

- **去重**：`/api/graph/expand` 返回的节点和边应与画布已有数据去重
- **总数**：`totalNeighbors` 始终为直接邻居全量总数，不受分页 `offset` 影响
- **分页**：`offset > 0` 时，后端应按 `n=1`（仅直接邻居）处理，返回下一批直接邻居
- **Domain**：所有图谱接口支持可选的 `domain` 参数，用于多域场景
- **数据上限**：前端可配置 `maxTotalNodes` 截断，后端也可附加全局上限
