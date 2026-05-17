"""
初始化图谱可视化字段到 Quartz 缓存 SQLite 数据库。

用法: python init_graph_fields.py

功能:
  1. 为 nodes 表新增/更新: size, category, color, label, rank, domain
  2. 为 edges 表新增/更新: weight, category, color, label, domain
  3. 幂等执行，可重复运行
"""

import json
import os
import random
import sqlite3
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, ".quartz-cache.db")

# ── 域配置（测试用） ──────────────────────────────────────
# 按节点 ID hash 分配到不同域
TEST_DOMAINS = ["demo-region", "demo-core"]

# ── 颜色映射 ──────────────────────────────────────────────

# 节点类别 → 颜色（类别来自节点 ID 前缀：人员/组织/项目/任务/问答）
NODE_CATEGORY_COLORS: dict[str, str] = {
    "组织": "#6366f1",
    "人员": "#f59e0b",
    "项目": "#10b981",
    "任务": "#ef4444",
    "问答": "#8b5cf6",
    "默认": "#94a3b8",
}

# 边类别 → 颜色（类别来自两端节点的类别组合）
EDGE_CATEGORY_COLORS: dict[str, str] = {
    "人员-组织": "#818cf8",
    "人员-项目": "#34d399",
    "人员-任务": "#f87171",
    "人员-问答": "#c084fc",
    "人员-人员": "#fbbf24",
    "组织-项目": "#34d399",
    "组织-任务": "#f87171",
    "组织-组织": "#818cf8",
    "项目-任务": "#f87171",
    "项目-问答": "#c084fc",
    "任务-问答": "#c084fc",
    "默认": "#cbd5e1",
}

# ── 边关系映射 ────────────────────────────────────────────
# (源类别, 目标类别) → (边类别key, 边label)
# 双向关系只注册一次，脚本会自动匹配反向
EDGE_RELATIONSHIP_MAP: dict[tuple[str, str], tuple[str, str]] = {
    ("人员", "组织"): ("人员-组织", "所属组织"),
    ("人员", "项目"): ("人员-项目", "参与项目"),
    ("人员", "任务"): ("人员-任务", "负责任务"),
    ("人员", "问答"): ("人员-问答", "相关问答"),
    ("人员", "人员"): ("人员-人员", "关联人员"),
    ("组织", "项目"): ("组织-项目", "负责项目"),
    ("组织", "组织"): ("组织-组织", "关联组织"),
    ("项目", "任务"): ("项目-任务", "包含任务"),
    ("项目", "问答"): ("项目-问答", "相关问答"),
    ("任务", "问答"): ("任务-问答", "相关问答"),
}


# ── 节点字段推导 ──────────────────────────────────────────

def get_node_category(node_id: str, node_type: str) -> str:
    """从节点 ID 前缀推导类别（与 DB 的 type 列 entity/virtual 无关）。"""
    if node_type == "virtual":
        return node_id  # virtual 节点本身就是类别名
    if "/" in node_id:
        prefix = node_id.split("/", 1)[0]
        if prefix in NODE_CATEGORY_COLORS:
            return prefix
    return "默认"


def get_node_label(node_id: str, frontmatter: dict) -> str:
    """从 frontmatter title 提取显示名称，回退到 ID 末段。"""
    title = frontmatter.get("title", "")
    if title:
        return title
    if "/" in node_id:
        return node_id.split("/", 1)[1]
    return node_id


def compute_node_size(degree: int) -> int:
    """根据连接数计算节点大小 (20~50)。"""
    return 20 + min(degree * 2, 30)


# ── 边字段推导 ────────────────────────────────────────────

def get_edge_info(source_id: str, target_id: str) -> tuple[str, str, str]:
    """推导边字段 → (category, label, color)。"""
    src_cat = source_id.split("/", 1)[0] if "/" in source_id else source_id
    tgt_cat = target_id.split("/", 1)[0] if "/" in target_id else target_id

    # 正向 + 反向查找
    info = EDGE_RELATIONSHIP_MAP.get((src_cat, tgt_cat)) or EDGE_RELATIONSHIP_MAP.get(
        (tgt_cat, src_cat)
    )

    if info:
        cat, label = info
        return (cat, label, EDGE_CATEGORY_COLORS.get(cat, EDGE_CATEGORY_COLORS["默认"]))

    return ("默认", "关联", EDGE_CATEGORY_COLORS["默认"])


# ── 主流程 ────────────────────────────────────────────────

def main():
    if not os.path.exists(DB_PATH):
        print(f"[错误] 数据库文件不存在: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ── 1. 新增列（已存在则跳过） ────────────────────────
    print("检查并新增列...")

    for col_name, col_def in [
        ("size", "INTEGER NOT NULL DEFAULT 20"),
        ("category", "TEXT NOT NULL DEFAULT '默认'"),
        ("color", "TEXT NOT NULL DEFAULT '#94a3b8'"),
        ("label", "TEXT NOT NULL DEFAULT ''"),
        ("rank", "INTEGER NOT NULL DEFAULT 0"),
        ("domain", "TEXT NOT NULL DEFAULT ''"),
    ]:
        existing = {r[1] for r in cur.execute("PRAGMA table_info(nodes)").fetchall()}
        if col_name not in existing:
            cur.execute(f"ALTER TABLE nodes ADD COLUMN {col_name} {col_def}")
            print(f"  + nodes.{col_name}")

    # 兼容旧列名 sort_order → rank
    existing = {r[1] for r in cur.execute("PRAGMA table_info(nodes)").fetchall()}
    if "sort_order" in existing and "rank" not in existing:
        cur.execute("ALTER TABLE nodes RENAME COLUMN sort_order TO rank")
        print("  ~ nodes: sort_order → rank")
    elif "sort_order" in existing and "rank" in existing:
        # 两列都存在，迁移数据后删除旧列
        cur.execute("UPDATE nodes SET rank = sort_order WHERE rank = 0")
        cur.execute("ALTER TABLE nodes DROP COLUMN sort_order")
        print("  ~ nodes: 合并 sort_order 到 rank 并删除旧列")

    for col_name, col_def in [
        ("weight", "REAL NOT NULL DEFAULT 1.0"),
        ("category", "TEXT NOT NULL DEFAULT '默认'"),
        ("color", "TEXT NOT NULL DEFAULT '#cbd5e1'"),
        ("label", "TEXT NOT NULL DEFAULT '关联'"),
        ("domain", "TEXT NOT NULL DEFAULT ''"),
    ]:
        existing = {r[1] for r in cur.execute("PRAGMA table_info(edges)").fetchall()}
        if col_name not in existing:
            cur.execute(f"ALTER TABLE edges ADD COLUMN {col_name} {col_def}")
            print(f"  + edges.{col_name}")

    # ── 2. 加载所有节点 ──────────────────────────────────
    print("加载节点数据...")
    node_rows = cur.execute("SELECT id, type, frontmatter FROM nodes").fetchall()

    # id → (type, frontmatter_dict)
    node_info: dict[str, tuple[str, dict]] = {}
    for node_id, node_type, fm_str in node_rows:
        fm: dict = {}
        if fm_str:
            try:
                fm = json.loads(fm_str)
            except json.JSONDecodeError:
                pass
        node_info[node_id] = (node_type, fm)

    # ── 2.5 分配 domain（固定种子保证幂等） ─────────────
    print("分配 domain...")
    node_domains: dict[str, str] = {}
    random.seed(42)
    for nid in node_info:
        node_domains[nid] = random.choice(TEST_DOMAINS)
    for dom in TEST_DOMAINS:
        cnt = sum(1 for v in node_domains.values() if v == dom)
        print(f"  {dom}: {cnt} nodes")

    # ── 3. 计算每个节点的度数 ────────────────────────────
    print("计算节点度数...")
    degrees: dict[str, int] = defaultdict(int)
    for source, target in cur.execute("SELECT source, target FROM edges").fetchall():
        degrees[source] += 1
        degrees[target] += 1

    # ── 4. 按 category 内度数排名计算 rank ─────────────
    print("计算 category 内排序...")
    category_nodes: dict[str, list[str]] = defaultdict(list)
    for node_id in node_info:
        cat = get_node_category(node_id, node_info[node_id][0])
        category_nodes[cat].append(node_id)

    # 每个 category 内按度数降序，度数相同则按 node_id 字典序
    ranks: dict[str, int] = {}
    for cat, ids in category_nodes.items():
        ids_sorted = sorted(ids, key=lambda nid: (-degrees.get(nid, 0), nid))
        for r, nid in enumerate(ids_sorted, start=1):
            ranks[nid] = r

    # ── 5. 更新节点 ──────────────────────────────────────
    print("更新节点字段...")
    count = 0
    for node_id, (node_type, fm) in node_info.items():
        category = get_node_category(node_id, node_type)
        label = get_node_label(node_id, fm)
        color = NODE_CATEGORY_COLORS.get(category, NODE_CATEGORY_COLORS["默认"])
        size = compute_node_size(degrees.get(node_id, 0))
        rank = ranks.get(node_id, 0)
        domain = node_domains[node_id]

        cur.execute(
            "UPDATE nodes SET size=?, category=?, color=?, label=?, rank=?, domain=? WHERE id=?",
            (size, category, color, label, rank, domain, node_id),
        )
        count += 1
    print(f"  已更新 {count} 个节点")

    # ── 6. 更新边（domain 跟随 source 节点） ─────────────
    print("更新边字段...")
    count = 0
    for source, target, edge_type in cur.execute(
        "SELECT source, target, type FROM edges"
    ).fetchall():
        cat, label, color = get_edge_info(source, target)
        domain = node_domains.get(source, TEST_DOMAINS[0])
        cur.execute(
            "UPDATE edges SET category=?, label=?, color=?, domain=? WHERE source=? AND target=? AND type=?",
            (cat, label, color, domain, source, target, edge_type),
        )
        count += 1
    print(f"  已更新 {count} 条边")

    conn.commit()
    conn.close()
    print("完成！")


if __name__ == "__main__":
    main()
