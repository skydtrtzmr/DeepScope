"""
DeepScope 图谱数据测试服务。

用法:
    uv run python server.py              # 默认端口 8002
    uv run python server.py 8003         # 自定义端口
    uv run python server.py --port 9000  # 指定端口（推荐）

依赖:
    uv pip install fastapi uvicorn
"""

import argparse
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, Query, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import jwt
from datetime import datetime, timedelta, timezone

# ── 配置 ────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = SCRIPT_DIR
INIT_CONFIG_PATH = os.path.join(SCRIPT_DIR, "mock_graph.json")

# Token 测试配置（仅测试用，生产环境请使用真实的签发服务）
AUTH_TEST_SECRET = "deepscope-test-key"
AUTH_ALGORITHM = "HS256"
AUTH_EXPIRY_HOURS = 24


def _discover_domains() -> dict[str, str]:
    """扫描 DATA_DIR 下所有 *.db 文件，文件名（去 .db 后缀）作为 domain，值为 DB 路径。"""
    domains: dict[str, str] = {}
    for p in Path(DATA_DIR).glob("*.db"):
        domain_name = p.stem  # e.g. "demo-core" from "demo-core.db"
        domains[domain_name] = str(p)
    return domains


DOMAIN_DB_MAP = _discover_domains()
DOMAIN_NAMES = sorted(DOMAIN_DB_MAP.keys())
DEFAULT_DOMAIN = DOMAIN_NAMES[0] if DOMAIN_NAMES else ""

app = FastAPI(title="DeepScope Graph API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 加载初始节点配置 ────────────────────────────────────

def _load_initial_config() -> dict[str, list[str]]:
    """从配置文件读取按 domain 分组的初始节点 ID 列表。"""
    if os.path.exists(INIT_CONFIG_PATH):
        with open(INIT_CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        # 兼容旧格式（顶层 initialNodeIds）和新格式（按 domain 分）
        if "initialNodeIds" in cfg:
            return {"_default": cfg["initialNodeIds"]}
        return {k: v["initialNodeIds"] for k, v in cfg.items() if isinstance(v, dict) and "initialNodeIds" in v}
    return {}

INITIAL_CONFIG = _load_initial_config()


# ── 数据库连接 ──────────────────────────────────────────

def _get_db_path(domain: str) -> str:
    """根据 domain 名称返回对应的 DB 文件路径。"""
    path = DOMAIN_DB_MAP.get(domain)
    if not path:
        raise ValueError(f"Unknown domain: {domain}, available: {DOMAIN_NAMES}")
    return path


@contextmanager
def get_db(domain: str = ""):
    db_path = _get_db_path(domain or DEFAULT_DOMAIN)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()


# ── 响应模型（与前端 types/graph.ts 对齐） ─────────────

class GraphNode(BaseModel):
    id: str
    label: str
    category: Optional[str] = None
    description: Optional[str] = None
    data: Optional[dict] = None
    style: Optional[dict] = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None
    data: Optional[dict] = None
    style: Optional[dict] = None


class GraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class ExpandRequest(BaseModel):
    nodeId: str
    m: int = 5
    n: int = 2
    domain: str = DEFAULT_DOMAIN


class NeighborRequest(BaseModel):
    nodeId: str
    limit: int = 5
    excludeIds: list[str] = []
    domain: str = DEFAULT_DOMAIN


class ExpandResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    totalNeighbors: int


class DomainItem(BaseModel):
    name: str
    nodeCount: int
    edgeCount: int


# ── 行转前端模型 ─────────────────────────────────────────

def row_to_node(row: sqlite3.Row, domain: str = "") -> GraphNode:
    return GraphNode(
        id=row["id"],
        label=row["label"] or row["id"],
        category=row["category"],
        description=row["description"] or "",
        data={
            "rank": row["rank"],
            "domain": domain,
        },
        style={
            "fill": row["color"],
            "radius": row["size"],
        },
    )


def row_to_edge(row: sqlite3.Row, domain: str = "") -> GraphEdge:
    return GraphEdge(
        id=f"{row['source']}--{row['target']}--{row['type']}",
        source=row["source"],
        target=row["target"],
        label=row["label"],
        data={
            "category": row["category"],
            "domain": domain,
        },
        style={
            "stroke": row["color"],
            "lineWidth": _edge_width(row["weight"]),
        },
    )


def _edge_width(weight: float) -> float:
    """边粗细映射: weight 1~5 → lineWidth 1~4"""
    return min(max(weight * 0.8, 1), 4)


# ── 接口 ────────────────────────────────────────────────

@app.get("/api/domains", response_model=list[DomainItem])
async def list_domains():
    """扫描 backend 目录下 *.db 文件，文件名即 domain，返回各 domain 的节点/边数量。"""
    result = []
    for domain_name in DOMAIN_NAMES:
        db_path = DOMAIN_DB_MAP[domain_name]
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            node_count = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
            edge_count = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        finally:
            conn.close()
        result.append(DomainItem(name=domain_name, nodeCount=node_count, edgeCount=edge_count))
    return result


@app.get("/api/graph/initial", response_model=GraphData)
async def fetch_initial_graph(
    domain: str = Query(default=DEFAULT_DOMAIN),
):
    """
    初始加载：从配置文件读取 initialNodeIds，从对应 domain 的 DB 查询节点及它们之间的边。
    """
    if not INITIAL_CONFIG:
        return GraphData(nodes=[], edges=[])

    id_list = INITIAL_CONFIG.get(domain, INITIAL_CONFIG.get("_default", []))
    if not id_list:
        return GraphData(nodes=[], edges=[])

    with get_db(domain) as conn:
        ph = ",".join("?" * len(id_list))

        nodes = conn.execute(
            f"SELECT * FROM nodes WHERE id IN ({ph})",
            id_list,
        ).fetchall()

        found_ids = [r["id"] for r in nodes]
        if not found_ids:
            return GraphData(nodes=[], edges=[])

        edge_ph = ",".join("?" * len(found_ids))
        edge_rows = conn.execute(
            f"SELECT * FROM edges WHERE source IN ({edge_ph}) AND target IN ({edge_ph})",
            [*found_ids, *found_ids],
        ).fetchall()

        return GraphData(
            nodes=[row_to_node(r, domain) for r in nodes],
            edges=[row_to_edge(r, domain) for r in edge_rows],
        )


@app.get("/api/graph/nodes", response_model=GraphData)
async def fetch_nodes_by_ids(
    ids: str = Query(..., description="逗号分隔的节点 ID 列表"),
    domain: str = Query(default=DEFAULT_DOMAIN),
):
    """
    按 ID 查询节点：仅返回指定节点本身，不返回边和邻居。
    """
    id_list = [s.strip() for s in ids.split(",") if s.strip()]
    if not id_list:
        return GraphData(nodes=[], edges=[])

    with get_db(domain) as conn:
        ph = ",".join("?" * len(id_list))
        rows = conn.execute(
            f"SELECT * FROM nodes WHERE id IN ({ph})",
            id_list,
        ).fetchall()
        return GraphData(
            nodes=[row_to_node(r, domain) for r in rows],
            edges=[],
        )


@app.post("/api/graph/expand", response_model=ExpandResponse)
async def expand_graph(req: ExpandRequest):
    """
    节点 BFS 多层展开：每节点每层最多 m 个新邻居，最大深度 n。
    """
    domain = req.domain or DEFAULT_DOMAIN
    with get_db(domain) as conn:
        return _bfs_expand(conn, req.nodeId, req.m, req.n, domain)


@app.post("/api/graph/neighbors", response_model=ExpandResponse)
async def paginate_neighbors(req: NeighborRequest):
    """
    分页加载直接邻居：排除 excludeIds 中已有的邻居，返回 limit 个未加载的直接邻居。
    """
    domain = req.domain or DEFAULT_DOMAIN
    with get_db(domain) as conn:
        return _paginate_direct_neighbors(conn, req.nodeId, req.limit, req.excludeIds, domain)


# ── Token 测试端点（仅开发/测试用） ─────────────────────

@app.get("/api/Auth/testToken")
async def generate_test_token(
    minutes: int = Query(default=0, description="token 有效分钟数。传 0 或省略 = 24h；传 3 = 3 分钟后过期"),
    fail: bool = Query(default=False, description="设为 true 模拟 replaceToken 端点的 401 错误"),
):
    """生成一个测试用 JWT token，支持自定义有效期和模拟失败。"""
    if fail:
        # 直接返回一个非 JWT 字符串，让前端 replaceToken 调用失败
        return {"token": "INVALID_TOKEN_FOR_TESTING"}
    if minutes > 0:
        exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    else:
        exp = datetime.now(timezone.utc) + timedelta(hours=AUTH_EXPIRY_HOURS)
    payload = {"sub": "test-user", "iat": datetime.now(timezone.utc), "exp": exp}
    token = jwt.encode(payload, AUTH_TEST_SECRET, algorithm=AUTH_ALGORITHM)
    return {"token": token}


@app.post("/api/Auth/replaceToken")
async def replace_token(
    authorization: str = Header(...),
    fail: bool = Query(default=False, description="设为 true 模拟刷新失败（返回 401）"),
):
    """
    测试用 token 刷新端点。
    接受任意有效 JWT，用相同的 payload 签发一个新 token（延长过期时间）。
    传 ?fail=true 模拟刷新失败，用于测试前端 token 过期提示。
    """
    if fail:
        raise HTTPException(status_code=401, detail="Simulated refresh failure for testing")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        # 不验证签名，只读 payload（测试目的）
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    payload["exp"] = datetime.now(timezone.utc) + timedelta(hours=AUTH_EXPIRY_HOURS)
    new_token = jwt.encode(payload, AUTH_TEST_SECRET, algorithm=AUTH_ALGORITHM)
    return {"Success": True, "StatusCode": None, "Message": None, "Data": new_token}


# ── 内部函数 ────────────────────────────────────────────

def _get_neighbor_ids_sorted(
    conn: sqlite3.Connection,
    node_id: str,
    exclude: set[str],
    _domain: str,
) -> list[str]:
    """获取某节点的邻居 ID 列表，按邻居的 rank 排序。exclude 仅用于 BFS 防止回溯。"""
    rows = conn.execute(
        """
        SELECT CASE WHEN source = ? THEN target ELSE source END AS neighbor_id
        FROM edges WHERE source = ? OR target = ?
        """,
        (node_id, node_id, node_id),
    ).fetchall()
    neighbor_ids = [r["neighbor_id"] for r in rows if r["neighbor_id"] not in exclude]
    neighbor_ids = list(dict.fromkeys(neighbor_ids))

    if neighbor_ids:
        ph = ",".join("?" * len(neighbor_ids))
        rank_map: dict[str, int] = {}
        for r in conn.execute(
            f"SELECT id, rank FROM nodes WHERE id IN ({ph})",
            neighbor_ids,
        ).fetchall():
            rank_map[r["id"]] = r["rank"]
        neighbor_ids.sort(key=lambda nid: rank_map.get(nid, 999999))

    return neighbor_ids


def _paginate_direct_neighbors(
    conn: sqlite3.Connection,
    node_id: str,
    limit: int,
    exclude_ids: list[str],
    domain: str,
) -> ExpandResponse:
    all_neighbors = _get_neighbor_ids_sorted(conn, node_id, set(), domain)
    total_neighbors = len(all_neighbors)
    exclude_set = set(exclude_ids)
    page_ids = [nid for nid in all_neighbors if nid not in exclude_set][:limit]

    if not page_ids:
        return ExpandResponse(nodes=[], edges=[], totalNeighbors=total_neighbors)

    return _fetch_nodes_and_edges(conn, node_id, page_ids, domain, total_neighbors)


def _bfs_expand(
    conn: sqlite3.Connection,
    node_id: str,
    m: int,
    max_depth: int,
    domain: str,
) -> ExpandResponse:
    visited: set[str] = set([node_id])
    result_nodes: list[GraphNode] = []
    result_edges: list[GraphEdge] = []
    result_edge_keys: set[str] = set()
    current_layer = [node_id]

    for _ in range(max_depth):
        next_layer: list[str] = []

        for current_id in current_layer:
            neighbors = _get_neighbor_ids_sorted(conn, current_id, visited, domain)
            added = 0
            for neighbor_id in neighbors:
                if added >= m:
                    break
                visited.add(neighbor_id)
                next_layer.append(neighbor_id)
                added += 1

        if not next_layer:
            break

        layer_ids = list(dict.fromkeys(next_layer))
        layer_nodes = _fetch_nodes(conn, layer_ids, domain)
        layer_edges = _fetch_edges_between_layers(conn, current_layer, layer_ids, domain)

        for node in layer_nodes:
            result_nodes.append(node)
        for edge in layer_edges:
            if edge.id not in result_edge_keys:
                result_edge_keys.add(edge.id)
                result_edges.append(edge)

        current_layer = next_layer

    all_direct = _get_neighbor_ids_sorted(conn, node_id, set(), domain)
    total_neighbors = len(all_direct)

    return ExpandResponse(
        nodes=result_nodes, edges=result_edges, totalNeighbors=total_neighbors,
    )


def _fetch_nodes(conn: sqlite3.Connection, ids: list[str], domain: str) -> list[GraphNode]:
    if not ids:
        return []
    ph = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT * FROM nodes WHERE id IN ({ph})",
        ids,
    ).fetchall()
    return [row_to_node(r, domain) for r in rows]


def _fetch_edges_between_layers(
    conn: sqlite3.Connection,
    from_ids: list[str],
    to_ids: list[str],
    domain: str,
) -> list[GraphEdge]:
    if not from_ids or not to_ids:
        return []
    from_ph = ",".join("?" * len(from_ids))
    to_ph = ",".join("?" * len(to_ids))
    rows = conn.execute(
        f"""
        SELECT * FROM edges WHERE source IN ({from_ph}) AND target IN ({to_ph})
        UNION
        SELECT * FROM edges WHERE source IN ({to_ph}) AND target IN ({from_ph})
        """,
        [*from_ids, *to_ids, *to_ids, *from_ids],
    ).fetchall()
    return [row_to_edge(r, domain) for r in rows]


def _fetch_nodes_and_edges(
    conn: sqlite3.Connection,
    source_id: str,
    neighbor_ids: list[str],
    domain: str,
    total_neighbors: int,
) -> ExpandResponse:
    nodes = _fetch_nodes(conn, neighbor_ids, domain)
    edges = _fetch_edges_between_layers(conn, [source_id], neighbor_ids, domain)
    return ExpandResponse(nodes=nodes, edges=edges, totalNeighbors=total_neighbors)


# ── 启动 ────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DeepScope Graph Server")
    parser.add_argument("port", nargs="?", type=int, default=None, help="服务端口")
    parser.add_argument("--port", dest="port_kw", type=int, default=None, help="服务端口（推荐）")
    args = parser.parse_args()
    port = args.port or args.port_kw or 8002

    print(f"DeepScope Graph Server")
    print(f"端口: {port}")
    print(f"DB 目录: {DATA_DIR}")
    print(f"发现 domains: {DOMAIN_NAMES}")
    print(f"初始节点配置: {INIT_CONFIG_PATH}")
    uvicorn.run(app, host="0.0.0.0", port=port)
