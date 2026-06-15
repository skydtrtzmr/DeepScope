---
name: "feat: 前端 URL 参数支持指定后端 API 地址"
overview: 新增前端 URL 参数 `?api=`，允许外部跳转时动态指定后端接口地址，覆盖 `app-config.json` 中的默认配置。
todos:
  - id: modify-app-tsx
    content: 在 src/App.tsx 第一个 useEffect 中增加 ?api= URL 参数检测，使其优先级高于 app-config.json 的 apiBaseUrl
    status: completed
  - id: update-api-doc
    content: 在 api-doc.md 第4节 URL 参数表中补充 ?api= 参数说明及使用示例
    status: completed
    dependencies:
      - modify-app-tsx
---

## 需求概述

在当前纯前端项目中，后端接口地址（`apiBaseUrl`）目前仅在 `public/app-config.json` 中硬编码配置。外部页面跳转到 DeepScope 时无法指定使用哪个后端服务。

新增 `?api=` URL 参数，允许外部通过 URL 动态指定不同的后端接口地址，实现多场景嵌入。

## 核心功能

1. **新增 `?api=` URL 参数**：动态指定后端 API 地址，如 `?api=https://my-backend.com`
2. **优先级规则**：`?api=` 参数优先级高于 `app-config.json` 中的 `apiBaseUrl`
3. **向后兼容**：不传 `?api=` 时行为完全不变，走 `app-config.json` 默认配置
4. **文档更新**：在 `api-doc.md` 第 4 节 URL 参数表中补充 `api` 参数说明

## 技术方案

### 方案概述

在 `App.tsx` 的配置加载阶段（第 28-86 行的第一个 `useEffect`），读取 `app-config.json` 中的 `apiBaseUrl` 之后、调用 `setApiBaseUrl()` 之前，检查 URL 参数 `?api=`。如果存在则以 URL 参数为准覆盖 `apiBaseUrl`，否则使用配置文件中的值。

当前代码已有足够的基建，改动极小：

| 已有能力 | 位置 | 说明 |
| --- | --- | --- |
| `URLSearchParams` | `App.tsx` L104 | 已用于解析 `node`/`domain`/`data`/`expand`/`m`/`n` |
| `setApiBaseUrl()` | `src/lib/api.ts` L11-L13 | 已提供动态设置 baseURL 的函数 |
| `api.interceptors.request` | `src/lib/api.ts` L15-L20 | 已自动为请求添加 `baseURL` |


### 实现要点

1. **修改位置**：`src/App.tsx` 第 34-38 行（`cfg?.apiBaseUrl` 判断块）
2. **修改方式**：在 `if (cfg?.apiBaseUrl) { setApiBaseUrl(cfg.apiBaseUrl); }` 之后追加 `?api=` URL 参数检测，若存在则调用 `setApiBaseUrl()` 覆盖
3. **日志**：复用 `console.log('[config]'` 风格，输出 URL 参数覆盖来源
4. **不修改 `api.ts`**：现有 `setApiBaseUrl()` 函数已足够
5. **不引入路由库**：当前无 React Router，直接使用 `URLSearchParams`

### 设计决策

- **放在第一个 useEffect 中处理**（而不是第二个）：因为 `api` 参数必须在第一个 API 调用（第 2 个 useEffect 的 `fetchDomains`）之前生效，URL 参数在页面生命周期内不变，直接读取即可

### 变更文件清单

| 文件 | 操作 | 说明 |
| --- | --- | --- |
| `src/App.tsx` | 修改 | 在配置加载中增加 `?api=` URL 参数检测与优先级覆盖 |
| `api-doc.md` | 修改 | 在第 4 节 URL 参数表中补充 `api` 参数说明及示例 |