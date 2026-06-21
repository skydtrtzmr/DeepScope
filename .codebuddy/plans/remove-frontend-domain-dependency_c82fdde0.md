---
name: remove-frontend-domain-dependency
overview: 移除前端对 domain 的强制依赖：删除下拉选择器、停止启动时获取 domain 列表、API 调用不再传递 domain、简化初始图谱加载流程。
todos:
  - id: cleanup-types
    content: 移除 types/graph.ts 中的 DomainItem 接口
    status: completed
  - id: refactor-api-layer
    content: 重构 api.ts：删除 fetchDomains，domain 参数可选化且不传递
    status: completed
    dependencies:
      - cleanup-types
  - id: refactor-store
    content: 重构 graph-store.ts：移除 domains/currentDomain 状态及 actions，API 不传 domain
    status: completed
    dependencies:
      - cleanup-types
  - id: refactor-app-init
    content: 重构 App.tsx：删除 domain 启动流程，configReady 直接加载图谱
    status: completed
    dependencies:
      - refactor-api-layer
      - refactor-store
  - id: remove-domain-selector
    content: 移除 graph-toolbar.tsx 中的 domain 下拉选择器 UI
    status: completed
    dependencies:
      - refactor-store
---

## 需求分析

移除前端对 domain 的强制依赖。

### 用户决策要点

1. 完全移除工具栏中 domain 下拉选择器，前端未来应可搭配任意后端
2. API 参数定义暂时保留但标记为可选，前端不再主动传递 domain
3. 初始图谱加载改为无参 fetchInitialGraph()，后端使用默认 domain；URL 参数 ?node=xxx 是主要初始加载方式
4. URL 中的 ?domain= 变为可选，有则传、无则不传

### 核心变更范围（5 个前端文件）

- **types/graph.ts**：移除 DomainItem 接口
- **api.ts**：移除 fetchDomains()，移除 domain 端点路径，API domain 参数改为可选且不再传递
- **graph-store.ts**：移除 domains[] 和 currentDomain 状态及相关 action
- **App.tsx**：删除 fetchDomains 启动流程，初始加载从 currentDomain 改为 configReady 触发
- **graph-toolbar.tsx**：移除 domain 下拉选择器 UI

## 技术方案

### 技术栈

- 沿用现有栈：React + TypeScript + Zustand + Tailwind CSS，无需新增依赖

### 实施策略详解

#### 1. 类型定义精简

- 删除 `types/graph.ts` 第 98-103 行的 `DomainItem` 接口

#### 2. API 层改造 (`api.ts`)

- **端点路径**：从 `_endpoints` 对象中移除 `domains: '/api/domains'`（第 192 行）
- **删除**：`fetchDomains()` 函数（第 207-210 行）及 `export type { DomainItem }`（第 205 行）
- **移除 import**：第 2 行的 `DomainItem`
- **fetchInitialGraph**：签名从 `(domain: string)` 改为 `(domain?: string)`，params 中不再传递 domain
- **ExpandGraphParams**：`domain` 从 `string` 改为 `domain?: string`，post body 中不传
- **NeighborParams**：`domain` 从 `string` 改为 `domain?: string`，post body 中不传
- **fetchNodesByIds**：签名从 `(ids: string[], domain: string)` 改为 `(ids: string[], domain?: string)`，params 中不传

#### 3. Store 层改造 (`graph-store.ts`)

- **移除状态**：`domains: DomainItem[]`（第 54 行）和 `currentDomain: string`（第 55 行）
- **移除初始值**：`domains: []`（第 311 行）和 `currentDomain: ''`（第 312 行）
- **移除 action**：`setDomains`（第 79 行）和 `setCurrentDomain`（第 80 行）的类型声明
- **移除 action 实现**：`setDomains`（第 542-543 行）和 `setCurrentDomain`（第 546-547 行）
- **移除 import**：第 5 行的 `DomainItem`
- **bfsExpandNode**：第 429 行不再解构 `currentDomain`，第 441 行 API 调用不传 domain
- **loadMoreNeighbors**：第 451 行不再解构 `currentDomain`，第 471 行 API 调用不传 domain

#### 4. App 启动流程改造 (`App.tsx`)

- **删除 import**：第 7 行的 `fetchDomains`（从 api import 中移除），第 20 行的 `setDomains, setCurrentDomain, currentDomain`（从 store destructuring 中移除）
- **删除端点**：第 62 行 `endpointNames` 中移除 `'domains'`
- **删除 useEffect #2**：第 141-149 行的 "加载 domain 列表" block
- **改造 useEffect #3**（初始加载）：
- 触发条件从 `[currentDomain, ...]` 改为 `[configReady, ...]`
- 删除第 153 行 `if (!currentDomain) return;`
- `fetchInitialGraph()` 不带参数
- `fetchNodesByIds([nodeParam])` 不带 domain
- **注意**：第 177 行的 `fetchNodesByIds([nodeParam], currentDomain)` 改为 `fetchNodesByIds([nodeParam])`

#### 5. 工具栏改造 (`graph-toolbar.tsx`)

- **store 解构**：第 14 行移除 `domains, currentDomain, setCurrentDomain`
- **移除 JSX**：第 40-55 行的 domain 选择器 block

### 影响分析

- **启动时序简化**：`configReady -> 直接加载图谱`，不再串行等待 domain 请求
- **后端兼容**：后端所有 API 中 domain 参数有 `DEFAULT_DOMAIN`，不传参自动使用默认值，完全兼容
- **保留扩展性**：API 参数类型标记为可选，外部调用者仍可显式传入 domain（如通过 app-config.json 定制）
- **无后端变更**：纯前端任务，backend/server.py 等无需修改

### 修改文件清单

```
frontend/src/
├── types/
│   └── graph.ts              # 移除 DomainItem 接口
├── lib/
│   └── api.ts                # 移除 fetchDomains、domain 端点、domain 参数可选化
├── lib/stores/
│   └── graph-store.ts        # 移除 domains/currentDomain 状态和 actions
├── App.tsx                   # 删除 domain 启动流程，简化初始加载
└── components/graph/
    └── graph-toolbar.tsx     # 移除 domain 下拉选择器
```