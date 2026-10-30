cd backend
uv run python server.py
# 默认端口 8002，如需指定：
uv run uvicorn server:app --host 0.0.0.0 --port 8002

## 测试业务域 `demo-defect`（缺陷处置中的关联知识应用）

数据由一个零依赖的 Node 脚本生成，产物为 `backend/demo-defect.db`（`server.py` 扫描 `*.db`，文件名即域名，服务端无需改动）：

```bash
node gen_demo_defect.mjs                 # 默认 small（103 节点 / 206 边，固定种子，可重复生成）
node gen_demo_defect.mjs --scale medium  # 长尾记录 ×3
node gen_demo_defect.mjs --scale large   # 长尾记录 ×50（规模/性能验证）
node gen_demo_defect.mjs --seed 123      # 换随机种子
```

脚本每次运行前重建库文件，并打印自检报告（节点/边计数、类别分布、孤立节点、入口可达性、重复 id/边、description 覆盖率、journal_mode）。

域内 12 类节点主体：机组、系统、区域、设备、部件、缺陷单、历史缺陷、检修工单、经验案例、人员、班组、专业。入口为缺陷单 `缺陷单/defect-0001`（1# 引风机 / 轴承温度异常 / 待处理）。

前端访问：

```
http://localhost:4173/?domain=demo-defect&node=缺陷单/defect-0001&m=5&n=2
```

### 把某个域设为默认域

前端当前不在请求中携带 `domain`（走后端默认域），可用环境变量 `DEEPSCOPE_DEFAULT_DOMAIN` 指定默认域，
不设置时回退为排序后的第一个域（`demo-core`）：

```powershell
$env:DEEPSCOPE_DEFAULT_DOMAIN = 'demo-defect'
uv run python server.py 8002
```

启动日志会打印 `默认域: demo-defect`；若指定的域不存在会告警并回退。
此时前端直接访问 `http://localhost:5173/` 即可浏览该域，右键节点（`display.expandTrigger` 默认 `rightclick`）展开关联。

## 知识图谱聚合接口 v1（Mock）

`aggregate_mock.py` 按协议《知识图谱聚合接口 v1》实现五条路由，随 `server.py` 一起挂载（内存固定样例，不查数据库、不真正计算指标）：

| 路由 | 说明 |
| --- | --- |
| `POST /api/graph/aggregate` | 查询分组。scope 内存 LRU ≤128；局部/全局分组 ID 前缀不同（`agg::local-*` / `agg::global-*`） |
| `GET /api/graph/aggregate/{scope}` | 轮询指标。前 2 次 `running`，第 3 次起 `complete`（指标值 = 分组 count）；scope 不存在 410 |
| `POST /api/graph/aggregate/expand` | 分页读取成员。按 task_id 稳定排序；边 id `member-edge::{bucket}::{taskId}` |
| `GET /api/graph/aggregation/views?domain=` | 配置选择数据（主体/分组字段/根主体/指标） |
| `GET /api/graph/instances?domain=&subject=&search=` | 根主体实例搜索（mock 仅 kb_dim_employee 员工） |

固定验收样例：E001 局部 total=12（P_A=8、P_B=4）；全局 total=40（P_A=30、P_B=10）；`/api/graph/initial` 追加了员工 E001/项目 P_A、P_B/任务 T001-T003 演示节点（T001-T003 与局部 P_A 聚合成员天然重叠，用于验证前端防重复添加/防误删）。

测试开关：

| 触发条件 | 效果 |
| --- | --- |
| `group="__many__"` | 422 分组数超 100 |
| `group` 非 `project_id`/`status` | 422 不支持的分组字段 |
| `metrics` 含 `"__fail__"` | metric_status=failed（记录数与成员查询仍可用） |
| `expand` `offset=999` | 首次 500（模拟失败重试不跳页），重试返回空页 200 |
| 日期范围选无数据年份（如 2025） | groups=[] 空态 |

自测：`uv run python test_aggregate_mock.py`（20 项断言，覆盖协议验收用例 1-7 与错误场景）。

### 端口约定

mock 使用默认端口 **8002**（`uv run python server.py --port 8002`）。**不要使用 28085/28086/28091**（真实工作台后端协议基址 28085 及相邻占用端口）。前端 dev server 的 vite proxy 已将 `/api` 代理到 `http://localhost:8002`。

### 切换到真实后端（28085）的前提清单

真实后端就绪后，前端将 `app-config.json` 的 `apiBaseUrl` 指向 `http://127.0.0.1:28085`（或 URL `?api=` 覆盖）。**仅改地址即可切换的前提**：

1. 五个接口路径、参数、响应结构与本 mock 一致（协议 v1）；
2. 真实后端提供相同语义的 `views` / `instances`；
3. 图谱上的真实节点 ID 能映射到 `root.relation` / `root.key`（如 `kb_dim_employee::E001` ↔ relation=employee_id, key=E001）；
4. 返回的成员节点/边符合前端 GraphNode/GraphEdge 规范；
5. 认证、跨域与错误响应（422/404/410 的 `detail`）处理兼容。

注意：mock 在 `/api/graph/initial` 中追加的员工/项目/任务演示节点属于 mock 演示场景，真实后端不必然存在这些数据——前端聚合面板全部由 views/instances 接口驱动，不写死任何主体/字段。


