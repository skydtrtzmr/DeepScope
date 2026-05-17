"""
DeepScope 图谱数据测试服务。

用法:
    uv run python server.py

依赖:
    uv pip install fastapi uvicorn
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── 配置 ────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, ".quartz-cache.db")
DEFAULT_DOMAIN = "demo-region"
INITIAL_NODE_COUNT = 15  # 初始加载的核心节点数

app = FastAPI(title="DeepScope Graph API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 数据库连接 ──────────────────────────────────────────

@contextmanager
def get_db():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
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
    offset: int = 0
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

def _parse_frontmatter(fm_str: Optional[str]) -> dict:
    if not fm_str:
        return {}
    try:
        return json.loads(fm_str)
    except (json.JSONDecodeError, TypeError):
        return {}


def _build_description(fm: dict) -> str:
    """从 frontmatter 提取关键信息拼成 description。"""
    parts = []
    if fm.get("type"):
        parts.append(fm["type"])
    if fm.get("status"):
        parts.append(fm["status"])
    if fm.get("tags") and isinstance(fm["tags"], list):
        parts.append(", ".join(fm["tags"][:3]))
    return " | ".join(parts) if parts else ""


def row_to_node(row: sqlite3.Row) -> GraphNode:
    fm = _parse_frontmatter(row["frontmatter"])
    return GraphNode(
        id=row["id"],
        label=row["label"] or row["id"],
        category=row["category"],
        description=_build_description(fm),
        data={
            "rank": row["rank"],
            "domain": row["domain"],
        },
        style={
            "fill": row["color"],
            "radius": row["size"],
        },
    )


def row_to_edge(row: sqlite3.Row) -> GraphEdge:
    return GraphEdge(
        id=f"{row['source']}--{row['target']}--{row['type']}",
        source=row["source"],
        target=row["target"],
        label=row["label"],
        data={
            "category": row["category"],
            "domain": row["domain"],
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
    """返回所有可用的 domain 及其数据量。"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT domain, COUNT(*) as cnt FROM nodes GROUP BY domain"
        ).fetchall()
        domains = []
        for r in rows:
            edge_count = conn.execute(
                "SELECT COUNT(*) FROM edges WHERE domain=?", (r["domain"],)
            ).fetchone()[0]
            domains.append(DomainItem(
                name=r["domain"], nodeCount=r["cnt"], edgeCount=edge_count,
            ))
        return domains


@app.get("/api/graph/initial", response_model=GraphData)
async def fetch_initial_graph(
    domain: str = Query(default=DEFAULT_DOMAIN),
):
    """
    初始加载：从 domain 内度数最高的实体节点出发 BFS 扩展，返回连通子图。
    """
    with get_db() as conn:
        seed_row = conn.execute(
            """
            SELECT n.id FROM nodes n
            JOIN edges e ON (e.source = n.id OR e.target = n.id) AND e.domain = n.domain
            WHERE n.domain = ? AND n.type = 'entity'
            GROUP BY n.id ORDER BY COUNT(e.rowid) DESC LIMIT 1
            """,
            (domain,),
        ).fetchone()

        if not seed_row:
            return GraphData(nodes=[], edges=[])

        # BFS 收集连通子图
        visited: set[str] = set()
        queue = [seed_row["id"]]
        visited.add(seed_row["id"])
        result_ids: list[str] = [seed_row["id"]]

        while queue and len(result_ids) < INITIAL_NODE_COUNT:
            current = queue.pop(0)
            neighbors = _get_neighbor_ids_sorted(conn, current, visited, domain)

            for nid in neighbors:
                if len(result_ids) >= INITIAL_NODE_COUNT:
                    break
                visited.add(nid)
                queue.append(nid)
                result_ids.append(nid)

        nodes = _fetch_nodes(conn, result_ids, domain)

        ph = ",".join("?" * len(result_ids))
        edge_rows = conn.execute(
            f"SELECT * FROM edges WHERE domain=? AND source IN ({ph}) AND target IN ({ph})",
            [domain, *result_ids, *result_ids],
        ).fetchall()
        edges = [row_to_edge(r) for r in edge_rows]

        return GraphData(nodes=nodes, edges=edges)


@app.post("/api/graph/expand", response_model=ExpandResponse)
async def expand_graph(req: ExpandRequest):
    """
    节点展开（POST）：
    - offset == 0: 多层 BFS 展开，每节点每层最多 m 个新邻居，最大深度 n
    - offset > 0:  分页加载直接邻居（n 强制为 1）
    - excludeIds: 已在画布上的节点 ID 列表，后端排除返回
    """
    exclude_set: set[str] = set(req.excludeIds)

    with get_db() as conn:
        if req.offset > 0:
            return _paginate_direct_neighbors(conn, req.nodeId, req.m, req.offset, exclude_set, req.domain)
        return _bfs_expand(conn, req.nodeId, req.m, req.n, exclude_set, req.domain)


# ── 内部函数 ────────────────────────────────────────────

def _get_neighbor_ids_sorted(
    conn: sqlite3.Connection,
    node_id: str,
    exclude: set[str],
    domain: str,
) -> list[str]:
    """获取某节点的邻居 ID 列表，按邻居的 rank 排序。"""
    rows = conn.execute(
        """
        SELECT CASE WHEN source = ? THEN target ELSE source END AS neighbor_id
        FROM edges WHERE domain = ? AND (source = ? OR target = ?)
        """,
        (node_id, domain, node_id, node_id),
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
    m: int,
    offset: int,
    exclude: set[str],
    domain: str,
) -> ExpandResponse:
    all_neighbors = _get_neighbor_ids_sorted(conn, node_id, set(), domain)
    total_neighbors = len(all_neighbors)
    page_ids = all_neighbors[offset : offset + m]
    page_ids = [nid for nid in page_ids if nid not in exclude]

    if not page_ids:
        return ExpandResponse(nodes=[], edges=[], totalNeighbors=total_neighbors)

    return _fetch_nodes_and_edges(conn, node_id, page_ids, domain, total_neighbors)


def _bfs_expand(
    conn: sqlite3.Connection,
    node_id: str,
    m: int,
    max_depth: int,
    exclude: set[str],
    domain: str,
) -> ExpandResponse:
    visited: set[str] = set([node_id, *exclude])
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
        f"SELECT * FROM nodes WHERE id IN ({ph}) AND domain=?",
        [*ids, domain],
    ).fetchall()
    return [row_to_node(r) for r in rows]


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
        SELECT * FROM edges WHERE domain=? AND source IN ({from_ph}) AND target IN ({to_ph})
        UNION
        SELECT * FROM edges WHERE domain=? AND source IN ({to_ph}) AND target IN ({from_ph})
        """,
        [domain, *from_ids, *to_ids, domain, *to_ids, *from_ids],
    ).fetchall()
    return [row_to_edge(r) for r in rows]


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
    print(f"DeepScope Graph Server")
    print(f"DB: {DB_PATH}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
