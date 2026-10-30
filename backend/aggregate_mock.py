"""知识图谱聚合接口 v1 —— Mock 实现（内存固定样例，不查数据库、不真正计算指标）

协议来源：《知识图谱聚合接口 v1》（2026-10-30）。真实后端（另一个 agent 开发，
基址 http://127.0.0.1:28085/api/graph）就绪后，前端只需替换 apiBaseUrl。

本模块提供五条路由（前缀 /api/graph）：
- POST /aggregate            查询分组（scope 内存 LRU ≤128，局部/全局分组 ID 前缀不同）
- GET  /aggregate/{scope}    轮询指标（running→complete；scope 过期 410）
- POST /aggregate/expand     分页读取某个聚合节点的真实成员
- GET  /aggregation/views    配置选择数据
- GET  /instances            根主体实例搜索

固定验收样例（与协议联调验收用例一致）：
1. E001 按项目分组 => 总数 12，P_A=8、P_B=4
2. 相同日期范围全局查询 => 总数 40，P_A=30、P_B=10；聚合节点 ID 与局部不同
3. 展开局部 P_A => 8 条，全部 employee_id=E001、project_id=P_A
4. limit=3 分页 => 3、3、2 条，无重复，最后 has_more=false

测试开关：
- group="__many__"            => 422 模拟超过 100 个分组
- group 非 project_id/status   => 422 不支持的分组字段
- metrics 含 "__fail__"        => metric_status=failed（记录数与成员查询仍可用）
- expand offset=999            => 一次性 500（验证前端失败重试不跳页，第二次成功）
- 日期范围选无数据年份          => groups=[] 空态
"""
from __future__ import annotations

import hashlib
import json
import uuid
from collections import OrderedDict
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/graph", tags=["aggregate-mock"])

# ── 内存固定样例数据 ──────────────────────────────────────

EMPLOYEES: dict[str, dict] = {
    "E001": {"employee_id": "E001", "employee_name": "张三"},
    "E002": {"employee_id": "E002", "employee_name": "李四"},
    "E003": {"employee_id": "E003", "employee_name": "王五"},
}

PROJECTS: dict[str, dict] = {
    "P_A": {"project_id": "P_A", "project_name": "智慧生产管控平台"},
    "P_B": {"project_id": "P_B", "project_name": "产线数据治理"},
}

# 任务标签模板（按序取用，超出后带序号）
_TASK_LABELS_A = [
    "生产数据接入开发", "实时看板接口联调", "告警规则引擎优化", "权限体系重构",
    "报表导出性能优化", "大屏可视化适配", "接口监控埋点", "数据补录工具开发",
]
_TASK_LABELS_B = ["产线主数据清洗", "设备编码标准化", "质检数据对账", "历史数据归档"]
_STATUSES = ["进行中", "已完成", "待启动"]


def _task_label(project: str, seq: int) -> str:
    base = _TASK_LABELS_A if project == "P_A" else _TASK_LABELS_B
    if seq < len(base):
        return base[seq]
    return f"{base[seq % len(base)]}（{seq // len(base) + 1}）"


def _make_task(key: str, employee: str, project: str, seq: int, status: str, date: str) -> dict:
    return {
        "key": key,
        "label": _task_label(project, seq),
        "employee_id": employee,
        "project_id": project,
        "status": status,
        "created_date": date,
    }


def _build_tasks() -> list[dict]:
    tasks: list[dict] = []
    # 日期全部落在 2026 年内（合法日期），保证「相同日期范围」过滤下全局 total=40
    def _date(seq: int) -> str:
        return f"2026-{(seq % 12) + 1:02d}-{(seq % 28) + 1:02d}"

    # E001：P_A 8 条（T001-T008）+ P_B 4 条（T009-T012）= 12 条
    for i in range(8):
        tasks.append(_make_task(f"T{i+1:03d}", "E001", "P_A", i, _STATUSES[i % 3], _date(i)))
    for i in range(4):
        tasks.append(_make_task(f"T{i+9:03d}", "E001", "P_B", i, _STATUSES[(i + 1) % 3], _date(i + 4)))
    # E002：P_A 17 条（T101-T117）+ P_B 5 条（T118-T122）= 22 条
    for i in range(17):
        tasks.append(_make_task(f"T{i+101:03d}", "E002", "P_A", i, _STATUSES[i % 3], _date(i + 8)))
    for i in range(5):
        tasks.append(_make_task(f"T{i+118:03d}", "E002", "P_B", i, _STATUSES[(i + 2) % 3], _date(i + 2)))
    # E003：P_A 5 条（T201-T205）+ P_B 1 条（T206）= 6 条
    for i in range(5):
        tasks.append(_make_task(f"T{i+201:03d}", "E003", "P_A", i, _STATUSES[(i + 1) % 3], _date(i + 6)))
    tasks.append(_make_task("T206", "E003", "P_B", 4, "已完成", "2026-11-05"))
    # 全局合计：P_A 8+17+5=30，P_B 4+5+1=10，总数 40
    return tasks


TASKS: list[dict] = _build_tasks()
TASKS_BY_KEY: dict[str, dict] = {t["key"]: t for t in TASKS}

METRIC_DEFS: list[dict] = [{"id": "task_count", "name": "任务数量", "unit": "条"}]

# 支持的分组字段：字段名 -> (显示名, 取值函数, 值→显示标签函数)
GROUP_FIELDS: dict[str, tuple[str, object, object]] = {
    "project_id": ("项目 ID", lambda t: t["project_id"], lambda v: PROJECTS.get(v, {}).get("project_name", v)),
    "status": ("任务状态", lambda t: t["status"], lambda v: v),
}

# ── 节点构造（与协议的真实节点结构一致） ──────────────────


def employee_node(key: str) -> dict:
    emp = EMPLOYEES[key]
    return {
        "id": f"kb_dim_employee::{key}",
        "label": emp["employee_name"],
        "category": "员工",
        "data": {"kind": "entity", "subject": "kb_dim_employee", "key": key, "properties": dict(emp)},
    }


def project_node(key: str) -> dict:
    proj = PROJECTS[key]
    return {
        "id": f"kb_dim_project::{key}",
        "label": proj["project_name"],
        "category": "项目",
        "data": {"kind": "entity", "subject": "kb_dim_project", "key": key, "properties": dict(proj)},
    }


def task_node(task: dict) -> dict:
    return {
        "id": f"kb_dwd_task::{task['key']}",
        "label": task["label"],
        "category": "任务",
        "data": {
            "kind": "entity",
            "subject": "kb_dwd_task",
            "key": task["key"],
            "properties": {
                "task_id": task["key"],
                "task_name": task["label"],
                "project_id": task["project_id"],
                "employee_id": task["employee_id"],
                "status": task["status"],
                "created_date": task["created_date"],
            },
        },
    }


# initial 图谱演示节点：员工/项目/少量任务（T001-T003 与局部 P_A 成员天然重叠，
# 用于验证「成员已存在于真实图谱」时前端防重复添加/防误删）
AGGREGATE_DEMO_NODES: list[dict] = [
    employee_node("E001"),
    project_node("P_A"),
    project_node("P_B"),
    task_node(TASKS_BY_KEY["T001"]),
    task_node(TASKS_BY_KEY["T002"]),
    task_node(TASKS_BY_KEY["T003"]),
]

AGGREGATE_DEMO_EDGES: list[dict] = [
    # 员工 → 任务（负责）
    *[
        {
            "id": f"demo-agg-emp-task::{k}",
            "source": "kb_dim_employee::E001",
            "target": f"kb_dwd_task::{k}",
            "label": "负责",
        }
        for k in ("T001", "T002", "T003")
    ],
    # 任务 → 项目（所属项目）
    *[
        {
            "id": f"demo-agg-task-proj::{k}",
            "source": f"kb_dwd_task::{k}",
            "target": "kb_dim_project::P_A",
            "label": "所属项目",
        }
        for k in ("T001", "T002", "T003")
    ],
]

# ── scope 存储（内存 LRU，最多 128 个，协议 410 语义） ────


class _ScopeCtx:
    def __init__(self, context: dict, tasks: list[dict], groups: list[dict], metric_ids: list[str]):
        self.context = context
        self.tasks = tasks  # 当前范围内全部成员任务（已按主体/日期过滤）
        self.groups = groups  # [{id, key, label, count, metrics}]
        self.metric_ids = metric_ids
        self.poll_count = 0
        self.force_failed = "__fail__" in metric_ids
        self.expand_fail_once: set[str] = set()  # 一次性失败开关（bucket 集合）


_SCOPES: "OrderedDict[str, _ScopeCtx]" = OrderedDict()
_MAX_SCOPES = 128


def _ctx_hash(context: dict) -> str:
    raw = json.dumps(context, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:8]


def _put_scope(ctx: _ScopeCtx) -> str:
    scope = f"scope-{uuid.uuid4().hex[:12]}"
    _SCOPES[scope] = ctx
    while len(_SCOPES) > _MAX_SCOPES:
        _SCOPES.popitem(last=False)
    return scope


def _get_scope(scope: str) -> _ScopeCtx:
    ctx = _SCOPES.get(scope)
    if ctx is None:
        raise HTTPException(status_code=410, detail="查询范围已过期或服务已重启，请重新查询")
    _SCOPES.move_to_end(scope)  # LRU 触碰
    return ctx


# ── 请求模型 ──────────────────────────────────────────────


class AggregateRootRef(BaseModel):
    relation: str
    key: str


class AggregateRequest(BaseModel):
    domain: str = "domain1"
    source: str
    root: Optional[AggregateRootRef] = None
    group: str
    start: Optional[str] = ""
    end: Optional[str] = ""
    metrics: list[str] = []


class ExpandMembersRequest(BaseModel):
    scope: str
    bucket: str
    offset: int = 0
    limit: int = 20


# ── 响应构造 ──────────────────────────────────────────────


def _build_root_node(req: AggregateRequest) -> dict:
    if req.root is None:
        return {
            "id": f"scope::{req.domain}::{req.source}",
            "label": "全局 · 任务",
            "category": "范围",
            "data": {"kind": "scope", "domain": req.domain, "source": req.source},
        }
    emp = EMPLOYEES[req.root.key]
    return employee_node(req.root.key)


def _build_response(scope: str, ctx: _ScopeCtx, root_node: dict, metric_status: str, metric_error: Optional[str]) -> dict:
    groups = [dict(g) for g in ctx.groups]  # 浅拷贝，避免轮询污染
    if metric_status == "complete" and ctx.metric_ids:
        # complete：指标值 = 分组记录数（mock 约定，真实后端由指标服务返回）
        for g in groups:
            g["metrics"] = {mid: g["count"] for mid in ctx.metric_ids}
    return {
        "scope": scope,
        "root": root_node,
        "groups": groups,
        "total": sum(g["count"] for g in ctx.groups),
        "metrics": [m for m in METRIC_DEFS if m["id"] in ctx.metric_ids],
        "metric_status": metric_status,
        "metric_error": metric_error,
        "context": ctx.context,
        "data_source": "Mock(内存样例)",
    }


# ── 路由：查询分组 ────────────────────────────────────────


@router.post("/aggregate")
async def aggregate(req: AggregateRequest):
    # 校验：来源主体
    if req.source != "kb_dwd_task":
        raise HTTPException(status_code=422, detail=f"不支持的被分组主体：{req.source}（mock 仅支持 kb_dwd_task 任务）")
    # 校验：指标数量 ≤8
    if len(req.metrics) > 8:
        raise HTTPException(status_code=422, detail="指标最多选择 8 个")
    # 校验：根主体关联（局部查询）
    if req.root is not None:
        if req.root.relation != "employee_id":
            raise HTTPException(status_code=422, detail=f"不支持的关联字段：{req.root.relation}（mock 仅支持 employee_id）")
        if req.root.key not in EMPLOYEES:
            raise HTTPException(status_code=422, detail=f"根主体实例不存在：{req.root.key}")

    # 过滤任务范围：局部 / 全局
    if req.root is not None:
        tasks = [t for t in TASKS if t["employee_id"] == req.root.key]
    else:
        tasks = list(TASKS)

    # 日期范围过滤（闭区间，按来源主体的首个时间维度 created_date）
    if req.start:
        tasks = [t for t in tasks if t["created_date"] >= req.start]
    if req.end:
        tasks = [t for t in tasks if t["created_date"] <= req.end]

    # 分组
    if req.group == "__many__":
        raise HTTPException(status_code=422, detail="分组数超过 100，请先缩小查询范围")
    field_def = GROUP_FIELDS.get(req.group)
    if field_def is None:
        raise HTTPException(status_code=422, detail=f"不支持的分组字段：{req.group}（mock 仅支持 project_id / status）")
    _, get_value, get_label = field_def

    buckets: "OrderedDict[str, list[dict]]" = OrderedDict()
    for t in sorted(tasks, key=lambda x: x["key"]):
        buckets.setdefault(get_value(t), []).append(t)
    if len(buckets) > 100:
        raise HTTPException(status_code=422, detail="分组数超过 100，请先缩小查询范围")

    context = {
        "domain": req.domain,
        "source": req.source,
        "root": req.root.model_dump() if req.root else None,
        "group": req.group,
        "start": req.start or "",
        "end": req.end or "",
        "metrics": req.metrics,
    }
    ctx_hash = _ctx_hash(context)
    prefix = "local" if req.root else "global"  # 局部/全局分组 ID 前缀不同，保证不撞

    groups = []
    for value, members in buckets.items():
        groups.append({
            "id": f"agg::{prefix}-{ctx_hash}::{value}",
            "key": value,
            "label": get_label(value),
            "count": len(members),
            "metrics": {mid: None for mid in req.metrics},
        })

    ctx = _ScopeCtx(context=context, tasks=tasks, groups=groups, metric_ids=req.metrics)
    scope = _put_scope(ctx)

    if ctx.force_failed:
        metric_status, metric_error = "failed", "指标计算失败（模拟）：指标服务超时"
    elif req.metrics:
        metric_status, metric_error = "running", None
    else:
        metric_status, metric_error = "complete", None

    print(f"[aggregate-mock] scope={scope} {'局部' if req.root else '全局'} group={req.group} "
          f"分组数={len(groups)} total={sum(g['count'] for g in groups)} status={metric_status}")
    return _build_response(scope, ctx, _build_root_node(req), metric_status, metric_error)


# ── 路由：轮询指标结果 ────────────────────────────────────


@router.get("/aggregate/{scope}")
async def poll_aggregate(scope: str):
    ctx = _get_scope(scope)
    root_node = _build_root_node(AggregateRequest(**ctx.context))
    if ctx.force_failed:
        return _build_response(scope, ctx, root_node, "failed", "指标计算失败（模拟）：指标服务超时")
    if not ctx.metric_ids:
        return _build_response(scope, ctx, root_node, "complete", None)
    ctx.poll_count += 1
    # 第 1、2 次轮询 running，第 3 次起 complete（约 3 秒，便于观察加载态）
    if ctx.poll_count >= 3:
        return _build_response(scope, ctx, root_node, "complete", None)
    print(f"[aggregate-mock] 轮询 scope={scope} 第 {ctx.poll_count} 次 → running")
    return _build_response(scope, ctx, root_node, "running", None)


# ── 路由：分页读取成员 ────────────────────────────────────
# 与 GET /aggregate/{scope} 路径形似但方法不同（POST vs GET），Starlette 按
# path+method 完全匹配，不会被路径参数 {scope} 吞掉
@router.post("/aggregate/expand")
async def expand_members(req: ExpandMembersRequest):
    ctx = _get_scope(req.scope)
    group = next((g for g in ctx.groups if g["id"] == req.bucket), None)
    if group is None:
        raise HTTPException(status_code=422, detail=f"聚合节点不存在或不属于当前查询：{req.bucket}")

    if not (1 <= req.limit <= 100):
        raise HTTPException(status_code=422, detail=f"limit 必须在 1-100 之间，当前 {req.limit}")

    total = group["count"]

    # 一次性失败开关：offset=999 模拟请求失败（验证前端失败重试不跳页）。
    # 首次调用 500；重试同一 offset 返回空页成功（魔法值不参与越界校验）。
    if req.offset == 999:
        if req.bucket not in ctx.expand_fail_once:
            ctx.expand_fail_once.add(req.bucket)
            print(f"[aggregate-mock] expand 模拟一次性失败 bucket={req.bucket}")
            raise HTTPException(status_code=500, detail="模拟成员加载失败（一次性），请重试")
        return {
            "nodes": [],
            "edges": [],
            "total": total,
            "offset": req.offset,
            "has_more": False,
        }

    if total > 0 and req.offset > total:
        raise HTTPException(status_code=422, detail=f"offset 越界：{req.offset} > total {total}")

    # 沿用原主体及时间范围（ctx.tasks 已过滤），再叠加分组条件；按主实体键稳定排序
    field_def = GROUP_FIELDS[ctx.context["group"]]
    get_value = field_def[1]
    members = [t for t in ctx.tasks if get_value(t) == group["key"]]
    members.sort(key=lambda t: t["key"])

    page = members[req.offset : req.offset + req.limit]
    nodes = [task_node(t) for t in page]
    edges = [
        {
            "id": f"member-edge::{req.bucket}::{t['key']}",
            "source": req.bucket,
            "target": f"kb_dwd_task::{t['key']}",
            "label": "分组成员",
        }
        for t in page
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "total": total,
        "offset": req.offset,
        "has_more": req.offset + len(page) < total,
    }


# ── 路由：配置选择数据 ────────────────────────────────────


@router.get("/aggregation/views")
async def aggregation_views(domain: str = Query(default="domain1")):
    return {
        "domain": {"id": domain, "name": "项目管理与内部运营"},
        "views": [
            {
                "id": "kb_dwd_task",
                "name": "任务",
                "groups": [
                    {"field": "project_id", "name": "项目 ID"},
                    {"field": "status", "name": "任务状态"},
                ],
                "roots": [{"field": "employee_id", "subject": "kb_dim_employee", "name": "员工"}],
                "time": "创建日期",
                "metrics": [{"id": "task_count", "name": "任务数量"}],
            }
        ],
    }


# ── 路由：根主体实例搜索 ──────────────────────────────────


@router.get("/instances")
async def search_instances(
    domain: str = Query(default="domain1"),
    subject: str = Query(default="kb_dim_employee"),
    search: str = Query(default=""),
):
    if subject != "kb_dim_employee":
        raise HTTPException(status_code=422, detail=f"不支持的根主体：{subject}（mock 仅支持 kb_dim_employee 员工）")
    keyword = (search or "").strip()
    matched = [
        employee_node(k)
        for k, emp in EMPLOYEES.items()
        if not keyword or keyword in emp["employee_name"] or keyword in k
    ]
    return {"nodes": matched[:100], "limit": 100}
