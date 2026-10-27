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

