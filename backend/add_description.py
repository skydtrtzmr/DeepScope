#!/usr/bin/env python3
"""
为所有 *.db 文件的 nodes 表添加 description 列，并批量生成 markdown 格式的描述。

用法:
    python add_description.py

逻辑:
    1. ALTER TABLE nodes ADD COLUMN description TEXT DEFAULT ''
    2. 遍历每个节点，根据 frontmatter 中的字段生成结构化 markdown 描述
    3. UPDATE nodes SET description = ? WHERE id = ?
"""

import json
import os
import sqlite3
from pathlib import Path


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = SCRIPT_DIR


def build_description(fm: dict, node_id: str, category: str) -> str:
    """根据 frontmatter 字段生成 markdown 描述。"""
    lines = []

    # 解析 node_id 中的分类（如 "人员/person-00001"）
    folder = ""
    if "/" in node_id:
        folder = node_id.split("/")[0]

    # 基本信息
    info_parts = []
    if fm.get("type"):
        info_parts.append(f"- **类型**: {fm['type']}")
    if fm.get("status"):
        info_parts.append(f"- **状态**: {fm['status']}")
    if fm.get("category"):
        info_parts.append(f"- **部门/类别**: {fm['category']}")
    if fm.get("priority") is not None:
        info_parts.append(f"- **优先级**: {fm['priority']}")
    if info_parts:
        lines.append("## 基本信息\n")
        lines.extend(info_parts)
        lines.append("")

    # 标签
    tags = fm.get("tags")
    if tags and isinstance(tags, list) and len(tags) > 0:
        lines.append("## 标签\n")
        tag_str = " ".join(f"`{t}`" for t in tags)
        lines.append(tag_str)
        lines.append("")

    # 关联关系（去除 wikilink 格式 [[...]]）
    relations = []
    relation_labels = {
        "组织": "所属组织",
        "负责人": "负责人",
        "项目": "关联项目",
        "任务": "关联任务",
        "相关人员": "相关人员",
    }
    for key, label in relation_labels.items():
        val = fm.get(key)
        if val:
            # 去除 [[...]] wikilink 包裹
            clean = val.replace("[[", "").replace("]]", "")
            # 去除可能的 alias 写法 [[target|alias]]
            if "|" in clean:
                clean = clean.split("|")[0]
            relations.append(f"- **{label}**: {clean}")

    if relations:
        lines.append("## 关联\n")
        lines.extend(relations)
        lines.append("")

    # 日期
    date_parts = []
    if fm.get("date"):
        date_parts.append(f"- **日期**: {fm['date']}")
    if fm.get("created"):
        date_parts.append(f"- **创建**: {fm['created']}")
    if fm.get("modified"):
        date_parts.append(f"- **修改**: {fm['modified']}")
    if date_parts:
        lines.append("## 时间\n")
        lines.extend(date_parts)
        lines.append("")

    return "\n".join(lines).strip()


def process_db(db_path: str):
    """为单个 DB 添加 description 列并填充数据。"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 检查是否已有 description 列
    cols = [row[1] for row in cursor.execute("PRAGMA table_info(nodes)").fetchall()]
    if "description" not in cols:
        cursor.execute("ALTER TABLE nodes ADD COLUMN description TEXT DEFAULT ''")
        print(f"  [schema] 已添加 description 列")

    # 读取所有节点
    rows = cursor.execute("SELECT id, frontmatter, category FROM nodes").fetchall()
    total = len(rows)
    updated = 0

    for node_id, fm_str, category in rows:
        fm = {}
        if fm_str:
            try:
                fm = json.loads(fm_str)
            except (json.JSONDecodeError, TypeError):
                pass

        desc = build_description(fm, node_id, category or "")
        if desc:
            cursor.execute("UPDATE nodes SET description = ? WHERE id = ?", (desc, node_id))
            updated += 1

    conn.commit()
    conn.close()
    print(f"  [done] {db_path}: {updated}/{total} 个节点已写入 description")
    return updated


def main():
    db_files = sorted(Path(DATA_DIR).glob("*.db"))
    if not db_files:
        print("[warn] 未找到 *.db 文件")
        return

    print(f"[start] 发现 {len(db_files)} 个 DB 文件")
    for db_path in db_files:
        print(f"[processing] {db_path.name}")
        process_db(str(db_path))
    print("[finish] 全部完成")


if __name__ == "__main__":
    main()
