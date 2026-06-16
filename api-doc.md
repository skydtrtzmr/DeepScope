# DeepScope API 文档

本文档描述 DeepScope 后端需实现的全部 HTTP 接口、数据模型及前端 URL 入参规范。

> 前端配置相关（`apiBaseUrl`、探索/高亮/显示默认值等）请参见 [`frontend/Readme.md`](./frontend/Readme.md)。

---

## 1. 接口总览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/domains` | 获取可用业务域列表 |
| GET | `/api/graph/initial` | 初始图谱加载（后端决定返回的子图） |
| POST | `/api/graph/expand` | 【探索节点】多层节点展开 |
| POST | `/api/graph/neighbors` | 【探索节点】分页加载邻居 |
| GET | `/api/graph/nodes` | 按 ID 查询节点 |

> 说明：两个节点探索 API 本身都是**幂等**的（相同请求体始终返回相同结果）。区别在于前端按钮行为：
> - **多层展开按钮**：`m`/`n` 不变的情况下，每次发相同参数，适合首屏触发和 URL 指定
> - **更多邻居按钮**：每次需要前端根据已加载数据计算 `excludeIds`，参数随状态变化，适合针对直接关联邻居较多的节点，分批加载邻居

所有图谱数据接口统一使用 **子图 JSON**（`nodes` + `edges`）格式。

---

## 2. 接口详情

> 以下示例假设后端运行在 `http://localhost:8002`，domain 使用 `demo-core`。
> 每个接口末尾附有对应的 [Bruno](https://www.usebruno.com/) 测试文件路径，可直接导入使用。

### 2.1 GET `/api/domains`

获取后端可用的业务域（domain）列表。

**请求**：

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| URL | `http://localhost:8002/api/domains` |

**响应**：
```json
[
  {
    "name": "demo-core",
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

> Bruno 测试：`请求所有域.bru`

---

### 2.2 GET `/api/graph/initial`

初始加载图谱数据，完全由后端决定展示哪些节点，不受 `m`/`n` 影响。

**请求**：

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| URL | `http://localhost:8002/api/graph/initial` |

**Query 参数**：

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
      "data": {},
      "style": { "stroke": "#999", "lineWidth": 2 }
    }
  ]
}
```

> Bruno 测试：`请求初始节点.bru`

---

### 2.3 POST `/api/graph/expand`

【探索节点】多层展开（BFS）：从根节点出发，每层每个节点取前 `m` 个直接邻居，迭代 `n` 层。API 本身幂等，前端`m`/`n` 不变的情况下，前端按钮每次发相同参数请求。适合首屏触发和 URL 指定节点。

**请求**：

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| URL | `http://localhost:8002/api/graph/expand` |
| Content-Type | `application/json` |

**请求体**（JSON）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | 是 | 被展开的节点 ID |
| `m` | int | 是 | 每个节点每层最多取几个新邻居 |
| `n` | int | 是 | 最大深度（迭代层数） |
| `domain` | string | 否 | 查询的 domain |

```json
{
    "nodeId": "项目/proj-00093",
    "m": 5,
    "n": 2,
    "domain": "demo-core"
}
```

**响应**：
```json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "totalNeighbors": 23
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodes` | array | 新增节点列表 |
| `edges` | array | 新增边列表 |
| `totalNeighbors` | int | 根节点的**全部直接邻居总数** |

> Bruno 测试：`节点展开.bru`

---

### 2.4 POST `/api/graph/neighbors`

【探索节点】分页加载邻居，可实现自动多层递进。API 本身幂等（相同 `excludeIds` 相同结果），但前端按钮每次点击会传入不同的 `excludeIds`（由已加载数据计算得来），因此按钮行为是状态依赖的、非幂等的。

**请求**：

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| URL | `http://localhost:8002/api/graph/neighbors` |
| Content-Type | `application/json` |

**请求体**（JSON）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeId` | string | 是 | 被查询的节点 ID |
| `limit` | int | 是 | 本批次最多返回几个新节点（跨层全局计数） |
| `excludeIds` | string[] | 否 | 已加载的节点 ID 列表，后端响应中跳过这些（但作为 BFS 前沿继续遍历）。首次请求传空列表 `[]`，后续请求传入已加载邻居的 ID |
| `domain` | string | 否 | 查询的 domain，如未指定则由后端确认默认 domain |

**首次请求**（无排除）：
```json
{
    "nodeId": "人员/person-00778",
    "limit": 5,
    "excludeIds": [],
    "domain": "demo-core"
}
```

**继续加载**（排除已加载的 5 个邻居）：
```json
{
    "nodeId": "人员/person-00778",
    "limit": 5,
    "excludeIds": [
        "组织/org-00159",
        "问答/qa-00502",
        "问答/qa-00786",
        "项目/proj-00093",
        "项目/proj-00170"
    ],
    "domain": "demo-core"
}
```

**响应**：
```json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "totalNeighbors": 6
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodes` | array | 本批次新增节点列表 |
| `edges` | array | 本批次新增边列表 |
| `totalNeighbors` | int | 根节点的**直接邻居总数**（仅层1），不受排除影响。前端用 `(已加载 / totalNeighbors)` 计算按钮显示文案并判断是否禁用 |

#### 多层递进行为（规划）

> **⚠️ 以下为未来多层邻居支持的接口扩展方案，当前未实现。** 当前后端仅实现了单层分页（`_paginate_direct_neighbors`），`totalNeighbors` = 仅层1的直接邻居数。

计划扩展：

- **概念扩展**：`totalNeighbors` 从"层1直接邻居总数"扩展为"后端 BFS 范围内的全部可达邻居总数"。后端决定探索几层，`totalNeighbors` 就反映那个范围内的总数。前端无需感知层数变化。
- 后端 BFS 自动多层递进：当层1直接邻居全部排除后，自动进入层2，以此类推
- 每批次返回 `limit` 个新节点（跨层累计），前端按钮始终显示 `(已加载 / totalNeighbors)`

规划示例：
```
person-00778 有 6 个直接邻居（层1），每个层1邻居各有 4 个层2邻居

当前: totalNeighbors = 6（仅层1）
  第1批 5/6 → 第2批 6/6 → 禁用

规划: totalNeighbors = 30（后端扩展 BFS 范围后）
  第1批 5/30 → 第2批 10/30 → ... → 第N批 30/30 → 禁用
```

> 前端完全不需要改动 — `totalNeighbors` 字段名不变，后端只需扩展其语义和 BFS 深度即可。

> Bruno 测试：`邻居分页.bru`

---

### 2.5 GET `/api/graph/nodes`

按节点 ID 查询，用于 URL 首屏节点定位。

**请求**：

| 项目 | 值 |
|------|-----|
| 方法 | `GET` |
| URL | `http://localhost:8002/api/graph/nodes` |

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ids` | string | 是 | 逗号分隔的节点 ID 列表（支持多个） |
| `domain` | string | 否 | 查询的 domain |

**单节点请求**：
```
GET /api/graph/nodes?ids=人员/person-00022&domain=demo-core
```

**多节点请求**：
```
GET /api/graph/nodes?ids=项目/proj-00093,项目/proj-00171,项目/proj-00172&domain=demo-core
```

**响应**：
```json
{
  "nodes": [
    { "id": "人员/person-00022", "label": "张三", "category": "人员" },
    { "id": "项目/proj-00093", "label": "项目-00093", "category": "项目" },
    { "id": "项目/proj-00171", "label": "项目-00171", "category": "项目" }
  ],
  "edges": []
}
```

> 说明：仅返回指定节点本身，不返回边和邻居。前端拿到后渲染所有节点，再根据 URL 参数决定是否调用 `POST /api/graph/expand`。
>
> Bruno 测试：`节点查询.bru`

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
| `description` | string | 否 | 详情描述（支持 Markdown） |
| `data` | object | 否 | 自定义扩展数据（如 `rank`、`domain`） |
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
| `id` | string | **是** | 边唯一标识 |
| `source` | string | **是** | 源节点 ID |
| `target` | string | **是** | 目标节点 ID |
| `label` | string | 否 | 关系描述文本 |
| `data` | object | 否 | 自定义扩展数据（如 `category`、`domain`） |
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

前端支持通过 URL 查询参数直接指定首屏节点。

### 4.1 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `node` | string | 是 | 首屏中心节点 ID（如 `人员/person-00022`） |
| `domain` | string | 否 | 指定业务域，不传使用默认首个 domain |
| `expand` | string | 否 | `0` 时仅选中不展开；默认展开 |
| `m` | int | 否 | 初始展开广度（每层邻居数），独立于 UI 滑块 |
| `n` | int | 否 | 初始展开深度（间接层数），独立于 UI 滑块 |
| `api` | string | 否 | 指定后端接口地址，优先级高于 `app-config.json` 中的 `apiBaseUrl`，如 `?api=http://other-server:9000` |

### 4.2 示例

```
# 完整示例：指定节点 + 广度 + 深度
http://localhost:4173/?domain=demo-region&node=人员/person-00022&m=10&n=2

# 仅指定节点（不展开，适合嵌入场景）
http://localhost:4173/?node=人员/person-00022&expand=0

# 仅指定广度，n 走默认
http://localhost:4173/?node=人员/person-00022&m=5

# 指定后端地址（覆盖 app-config.json 中的 apiBaseUrl）
http://localhost:4173/?api=http://localhost:8002

# 完整组合：指定节点 + 后端地址 + 展开参数
http://localhost:4173/?domain=demo-core&node=人员/person-00022&m=5&n=2&api=http://localhost:8002
```

### 4.3 首屏加载流程

1. URL 含 `?node=` → 前端调用 `GET /api/graph/nodes?ids=...` 获取节点
2. 渲染中心节点，约 300ms 后自动 `selectNode`
3. 若 `expand !== '0'` 或 URL 含 `m`/`n` → 调用 `POST /api/graph/expand`（BFS 多层展开）

> `m`/`n` 仅影响首屏初始展开，与操作界面中用户可调的滑块配置互不干扰。

---

## 5. 通用规则

- **去重**：`/api/graph/expand` 全量返回，由前端负责去重合并；`/api/graph/neighbors` 由后端根据 `excludeIds` 排除
- **总数**：`totalNeighbors`（当前实现）= 层1直接邻居总数，前端用 `(已加载 / totalNeighbors)` 显示和按钮禁用判断；未来多层支持后，该字段语义扩展为后端 BFS 范围内的全部可达邻居总数，字段名不变
- **分页**：`/api/graph/neighbors` 使用 `excludeIds` + `limit` 分页，当直接邻居耗尽后自动深入下一 BFS 层
- **Domain**：所有图谱接口支持可选的 `domain` 参数，用于多域场景
- **数据上限**：前端可配置 `maxTotalNodes` 截断，后端也可附加全局上限
