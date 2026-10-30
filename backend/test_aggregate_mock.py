# -*- coding: utf-8 -*-
"""聚合 mock 接口自测脚本：覆盖协议验收用例与错误场景（仅开发验证用，可删除）"""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8002/api/graph"


def call(method: str, path: str, body: dict | None = None):
    url = f"{BASE}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


def check(name: str, cond: bool, extra: str = ""):
    print(f"{'PASS' if cond else 'FAIL'}  {name} {extra}")
    return cond


ok = True

# 1. 局部查询：E001 按项目分组 => 12, P_A=8, P_B=4, running
st, r = call("POST", "/aggregate", {
    "domain": "domain1", "source": "kb_dwd_task",
    "root": {"relation": "employee_id", "key": "E001"},
    "group": "project_id", "start": "2026-01-01", "end": "2026-12-31", "metrics": ["task_count"],
})
ok &= check("局部查询", st == 200 and r["total"] == 12
            and [g["count"] for g in r["groups"]] == [8, 4]
            and r["metric_status"] == "running", f"total={r['total']}")
scope, local_pa = r["scope"], r["groups"][0]["id"]

# 2. 轮询：前 2 次 running，第 3 次 complete，指标值 = count
st1, p1 = call("GET", f"/aggregate/{scope}")
st2, p2 = call("GET", f"/aggregate/{scope}")
st3, p3 = call("GET", f"/aggregate/{scope}")
ok &= check("指标轮询 running→complete", p1["metric_status"] == "running"
            and p2["metric_status"] == "running"
            and p3["metric_status"] == "complete"
            and p3["groups"][0]["metrics"]["task_count"] == 8)

# 3. 全局查询：total=40, P_A=30, P_B=10，kind=scope，分组 ID 与局部不同
st, g = call("POST", "/aggregate", {
    "domain": "domain1", "source": "kb_dwd_task", "root": None,
    "group": "project_id", "start": "2026-01-01", "end": "2026-12-31", "metrics": [],
})
ok &= check("全局查询", st == 200 and g["total"] == 40
            and [x["count"] for x in g["groups"]] == [30, 10]
            and g["root"]["data"]["kind"] == "scope"
            and g["groups"][0]["id"] != local_pa, f"total={g['total']}")

# 4. expand 分页：limit=3 => 3、3、2，无重复，has_more
seen: set[str] = set()
pages = []
for off in (0, 3, 6):
    st, e = call("POST", "/aggregate/expand", {"scope": scope, "bucket": local_pa, "offset": off, "limit": 3})
    pages.append((len(e["nodes"]), e["has_more"], st))
    for n in e["nodes"]:
        seen.add(n["id"])
ok &= check("分页 3/3/2", [p[0] for p in pages] == [3, 3, 2]
            and pages[-1][1] is False and len(seen) == 8)
st, e = call("POST", "/aggregate/expand", {"scope": scope, "bucket": local_pa, "offset": 0, "limit": 100})
all_e001_pa = all(n["data"]["properties"]["employee_id"] == "E001"
                  and n["data"]["properties"]["project_id"] == "P_A" for n in e["nodes"])
ok &= check("成员条件（E001+P_A）", e["total"] == 8 and all_e001_pa)

# 5. 指标 failed：metrics 含 __fail__，记录数仍可用
st, f = call("POST", "/aggregate", {
    "source": "kb_dwd_task", "root": {"relation": "employee_id", "key": "E001"},
    "group": "project_id", "metrics": ["__fail__"],
})
ok &= check("指标 failed", f["metric_status"] == "failed"
            and f["metric_error"] and f["total"] == 12)
st, e = call("POST", "/aggregate/expand", {"scope": f["scope"], "bucket": f["groups"][0]["id"], "offset": 0, "limit": 3})
ok &= check("failed 后成员仍可用", st == 200 and len(e["nodes"]) == 3)

# 6. 410：不存在的 scope
st, _ = call("GET", "/aggregate/not-exist")
ok &= check("410 过期 scope", st == 410)
st, _ = call("POST", "/aggregate/expand", {"scope": "not-exist", "bucket": "x", "offset": 0, "limit": 3})
ok &= check("410 过期 scope(expand)", st == 410)

# 7. 422：不支持的分组字段 / 超过 100 分组 / limit 越界
st, err = call("POST", "/aggregate", {"source": "kb_dwd_task", "group": "bad_field"})
ok &= check("422 分组字段", st == 422 and bool(err.get("detail")))
st, err = call("POST", "/aggregate", {"source": "kb_dwd_task", "group": "__many__"})
ok &= check("422 分组过多", st == 422)
st, err = call("POST", "/aggregate/expand", {"scope": scope, "bucket": local_pa, "offset": 0, "limit": 0})
ok &= check("422 limit 越界", st == 422)
st, err = call("POST", "/aggregate", {"source": "kb_dwd_task", "root": {"relation": "bad", "key": "E001"}, "group": "project_id"})
ok &= check("422 关联字段", st == 422)

# 8. 空分组：无数据日期区间
st, empty = call("POST", "/aggregate", {
    "source": "kb_dwd_task", "root": {"relation": "employee_id", "key": "E001"},
    "group": "project_id", "start": "2025-01-01", "end": "2025-12-31", "metrics": [],
})
ok &= check("空分组", st == 200 and empty["groups"] == [] and empty["total"] == 0)

# 9. 一次性失败重试：offset=999 第一次 500，第二次成功
st1, _ = call("POST", "/aggregate/expand", {"scope": scope, "bucket": local_pa, "offset": 999, "limit": 3})
st2, e2 = call("POST", "/aggregate/expand", {"scope": scope, "bucket": local_pa, "offset": 999, "limit": 3})
ok &= check("一次性失败重试", st1 == 500 and st2 == 200 and len(e2["nodes"]) == 0)

# 10. views / instances
st, v = call("GET", "/aggregation/views?domain=domain1")
ok &= check("views", st == 200 and v["views"][0]["id"] == "kb_dwd_task"
            and [x["field"] for x in v["views"][0]["groups"]] == ["project_id", "status"])
st, i = call("GET", "/instances?domain=domain1&subject=kb_dim_employee&search=E001")
ok &= check("instances 搜索", st == 200 and len(i["nodes"]) == 1
            and i["nodes"][0]["data"]["key"] == "E001")
st, i2 = call("GET", "/instances?domain=domain1&subject=kb_dim_employee")
ok &= check("instances 全量", len(i2["nodes"]) == 3 and i2["limit"] == 100)

# 11. initial 含演示节点（员工/项目/T001-T003）
st, init = call("GET", "/initial?domain=" + "demo-core")
ids = {n["id"] for n in init["nodes"]}
ok &= check("initial 演示节点", "kb_dim_employee::E001" in ids and "kb_dwd_task::T001" in ids
            and "kb_dim_project::P_A" in ids, f"nodes={len(ids)}")

# 12. 切换分组字段 status：分组数与值正确
st, s = call("POST", "/aggregate", {
    "source": "kb_dwd_task", "root": {"relation": "employee_id", "key": "E001"},
    "group": "status", "metrics": [],
})
counts = sorted(g["count"] for g in s["groups"])
ok &= check("按状态分组", st == 200 and s["total"] == 12 and len(s["groups"]) == 3 and counts == [3, 4, 5],
            f"counts={counts}")

print("\n结果:", "ALL PASS" if ok else "存在 FAIL")
raise SystemExit(0 if ok else 1)
