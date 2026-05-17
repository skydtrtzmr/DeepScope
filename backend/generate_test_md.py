#!/usr/bin/env python3
"""
批量生成测试 Markdown 文件（含 Obsidian 风格 wikilink 引用关系）

用途：在 input/{domain}/ 下生成测试文件，覆盖排序、聚合、反向链接、图谱等功能验证。

执行方式：
    python scripts/generate_test_md.py --domain demo-region --profile region
    python scripts/generate_test_md.py --domain demo-core --profile core

可选参数：
    --clean    清空目标目录后重新生成
"""

import os
import random
import argparse
import shutil
import json
from datetime import datetime, timedelta

# ============ 配置 ============

# 数量分布：组织 < 人员 < 项目 < 任务 < 问答
FOLDER_CONFIGS = [
    {"name": "组织", "prefix": "org",   "count": 40},
    {"name": "人员", "prefix": "person","count": 200},
    {"name": "项目", "prefix": "proj",  "count": 60},
    {"name": "任务", "prefix": "task",  "count": 700},
    {"name": "问答", "prefix": "qa",    "count": 1000},
]

# 字段缺失率（用于测试聚合"有则有效无则跳过"）
MISSING_RATE = {
    "type": 0.10,
    "priority": 0.20,
    "status": 0.15,
    "tags": 0.25,
    "category": 0.30,
    "organization": 0.05,   # 人员所属组织（极少缺失）
    "project": 0.10,        # 任务所属项目
    "owner": 0.15,          # 项目负责人
    "related": 0.40,        # 问答关联对象
}

# 各分类的枚举值池
TYPE_POOLS = {
    "组织": ["部门", "小组", "虚拟团队", "委员会", "专项组"],
    "人员": ["工程师", "产品经理", "设计师", "运营", "测试", "架构师"],
    "项目": ["产品研发", "基础设施建设", "市场推广", "运营支撑", "技术预研"],
    "任务": ["开发", "测试", "文档", "评审", "调研", "部署"],
    "问答": ["技术问题", "业务问题", "流程问题", "使用问题", "方案咨询"],
}

STATUS_POOLS = {
    "组织": ["活跃", "休眠", "已解散", "筹备中", "重组中"],
    "人员": ["在职", "离职", "实习", "外包", "借调"],
    "项目": ["规划中", "进行中", "已完成", "已暂停", "已取消"],
    "任务": ["待处理", "进行中", "已完成", "已取消", "阻塞中"],
    "问答": ["待回复", "已回复", "已解决", "已关闭", "待补充"],
}

CATEGORY_POOLS = {
    "组织": ["一级部门", "二级部门", "项目组", "职能组", "临时组"],
    "人员": ["研发部", "产品部", "设计部", "运营部", "测试部", "管理部"],
    "项目": ["技术", "业务", "管理", "战略"],
    "任务": ["紧急", "普通", "低优先级", "例行"],
    "问答": ["前端", "后端", "运维", "产品", "数据", "算法"],
}

TAGS_POOLS = {
    "组织": ["核心部门", "支持部门", "创新单元", "成本中心", "利润中心", "矩阵", "扁平"],
    "人员": ["专家", "骨干", "新人", "导师", "远程", "全职", "兼职", "Leader"],
    "项目": ["核心", "关键路径", "跨部门", "长期", "短期", "高风险", "高投入", "ROI"],
    "任务": ["前端", "后端", "数据库", "API", "UI", "安全", "性能", "兼容"],
    "问答": ["Bug", "最佳实践", "架构", "排障", "配置", "权限", "迁移", "优化"],
}

# 日期范围
DATE_START = datetime(2020, 1, 1)
DATE_END = datetime(2025, 12, 31)

# 正文模板段落
LOREM_SENTENCES = [
    "这是一个用于测试的示例段落，包含基本的文本内容。",
    "在实际业务场景中，该文档会包含更详细的描述和说明。",
    "通过批量生成大量文件，可以验证系统在大数据量下的性能和稳定性。",
    "排序功能支持自然排序、字典序、日期和数值等多种方式。",
    "聚合功能支持按文件夹、字段和日期等多种维度进行分组。",
    "每个文件都可以设置不同的 frontmatter 属性，以实现差异化的排序和聚合效果。",
    "系统会自动处理缺失字段的情况，确保聚合和排序的鲁棒性。",
    "构建过程采用增量更新机制，可以有效减少大规模站点的构建时间。",
    "建议在实际使用前，先用测试数据集验证配置是否符合预期。",
    "本文档由自动化脚本生成，仅用于功能测试和性能基准测试。",
]

# 两个业务域的 layout 配置模板
LAYOUT_TEMPLATES = {
    "region": {
        "explorer": {
            "sort": {"type": "natural", "order": "asc", "field": ""}
        },
        "folderPage": {
            "sort": {"type": "natural", "order": "asc", "field": ""}
        },
        "backlinks": {
            "hideWhenEmpty": False,
            "aggregation": [
                {"type": "folder", "depth": 1},
                {"type": "field", "field": "type"},
                {"type": "date", "field": "date", "granularity": "year"}
            ]
        },
        "graph": {
            "coreNodeFilter": [
                {"type": "folder", "depth": 1, "values": ["项目"]}
            ],
            "coreNodeLimit": 50,
            "regionRules": [{"type": "field", "field": "type"}],
            "aggregation": [
                {"type": "folder", "depth": 1},
                {"type": "field", "field": "type"},
                {"type": "date", "field": "date", "granularity": "year"}
            ]
        }
    },
    "core": {
        "explorer": {
            "sort": {"type": "date", "order": "desc", "field": "date"}
        },
        "folderPage": {
            "sort": {"type": "date", "order": "desc", "field": "date"}
        },
        "backlinks": {
            "hideWhenEmpty": False,
            "sort": {"type": "priority", "order": "desc", "field": "priority"},
            "aggregation": [
                {"type": "folder", "depth": 1},
                {"type": "field", "field": "status"}
            ]
        },
        "graph": {
            "coreNodeFilter": [
                {
                    "type": "folder",
                    "depth": 1,
                    "values": [
                    "项目"
                    ]
                }
            ],
            "coreNodeLimit": 30,
            "aggregation": [
                {"type": "folder", "depth": 1},
                {"type": "field", "field": "status"}
            ]
        }
    }
}

# 在这里修改生成业务域的默认配置！
DEFAULT_CONFIG = {
    "pageTitle": "",
    "baseUrl": "",
    "graph": {
        "precomputeLocal": True,
        "localDepth": 1,
        "fallbackToBfs": True
    }
}


def random_date() -> str:
    delta = DATE_END - DATE_START
    random_days = random.randint(0, delta.days)
    d = DATE_START + timedelta(days=random_days)
    return d.strftime("%Y-%m-%d")


def maybe(value, missing_rate: float):
    if random.random() < missing_rate:
        return None
    return value


def build_frontmatter_lines(title: str, folder_name: str, extra_fields: dict) -> list:
    lines = ["---", f'title: "{title}"']

    # date: 所有文件都有
    lines.append(f"date: {random_date()}")

    # type
    val = maybe(random.choice(TYPE_POOLS[folder_name]), MISSING_RATE["type"])
    if val:
        lines.append(f'type: "{val}"')

    # priority: 用于 numeric 排序（1-100）
    val = maybe(random.randint(1, 100), MISSING_RATE["priority"])
    if val is not None:
        lines.append(f"priority: {val}")

    # status
    val = maybe(random.choice(STATUS_POOLS[folder_name]), MISSING_RATE["status"])
    if val:
        lines.append(f'status: "{val}"')

    # category
    val = maybe(random.choice(CATEGORY_POOLS[folder_name]), MISSING_RATE["category"])
    if val:
        lines.append(f'category: "{val}"')

    # tags
    val = maybe(None, MISSING_RATE["tags"])
    if val is not None:
        tag_count = random.randint(1, 3)
        tags = random.sample(TAGS_POOLS[folder_name], min(tag_count, len(TAGS_POOLS[folder_name])))
        if len(tags) == 1:
            lines.append(f'tags: ["{tags[0]}"]')
        else:
            lines.append(f'tags: ["' + '", "'.join(tags) + '"]')

    # extra_fields（引用关系字段，值使用 [[wikilink]] 格式）
    for k, v in extra_fields.items():
        if v is not None and not isinstance(v, list):
            lines.append(f'{k}: "[[{v}]]"')

    lines.append("---")
    return lines


def build_content(title: str, body_links: list[str]) -> str:
    paragraphs = random.sample(LOREM_SENTENCES, k=random.randint(2, 4))
    body = "\n\n".join(paragraphs)

    # 正文中添加 wikilink 引用段落（用于多值关联等不适合 frontmatter 单值的情况）
    if body_links:
        link_sentences = []
        for link in body_links:
            templates = [
                f"相关内容请参见 [[{link}]]。",
                f"详细信息可参考 [[{link}|{link}]]。",
                f"如需了解背景，请查看 [[{link}]]。",
                f"关联文档：[[{link}|{link}]]。",
            ]
            link_sentences.append(random.choice(templates))
        body += "\n\n" + " ".join(random.sample(link_sentences, min(len(link_sentences), 3)))

    return f"# {title}\n\n{body}\n"


def generate_index_md(folder_path: str, folder_name: str):
    filepath = os.path.join(folder_path, "index.md")
    content = f"---\ntitle: \"{folder_name}\"\n---\n\n# {folder_name}\n\n该目录下包含大量测试文件，用于验证排序、聚合、反向链接与图谱功能。\n"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  [index] {filepath}")


def generate_root_index_md(target_dir: str, domain: str):
    """生成根目录的 index.md（Quartz 首页入口）"""
    filepath = os.path.join(target_dir, "index.md")
    
    # 计算统计
    total = sum(cfg["count"] for cfg in FOLDER_CONFIGS)
    
    # 各分类的文件夹链接
    folder_links = []
    for cfg in FOLDER_CONFIGS:
        folder_name = cfg["name"]
        count = cfg["count"]
        folder_links.append(f"- [[{folder_name}]] ({count} files)")
    
    # 文件数量分布表格
    folder_stats_lines = []
    for cfg in FOLDER_CONFIGS:
        folder_name = cfg["name"]
        count = cfg["count"]
        pct = (count / total * 100) if total > 0 else 0
        bar_len = int(pct / 5)  # 每5%一个字符
        bar = "█" * bar_len + "░" * (20 - bar_len)
        folder_stats_lines.append(f"| {folder_name} | {count:>6} | {pct:>5.1f}% | `{bar}` |")
    
    # 文件树（使用配置的 count 来生成）
    tree_lines = []
    for cfg in FOLDER_CONFIGS:
        folder_name = cfg["name"]
        prefix = cfg["prefix"]
        count = cfg["count"]
        tree_lines.append(f"{folder_name}/")
        tree_lines.append(f"├── index.md")
        # 根据数量决定显示方式
        if count > 7:
            for i in range(1, 4):
                tree_lines.append(f"├── {prefix}-{i:05d}.md")
            tree_lines.append(f"├── ... ({count - 6} more files) ...")
            for i in range(count - 2, count + 1):
                tree_lines.append(f"└── {prefix}-{i:05d}.md")
        else:
            for i in range(1, count + 1):
                prefix_char = "└── " if i == count else "├── "
                tree_lines.append(f"{prefix_char}{prefix}-{i:05d}.md")

    content = f"""---
title: "{domain}"
---

# {domain}

## 统计概览

| 指标 | 值 |
|------|-----|
| 总文件数 | {total} |
| 分类数量 | {len(FOLDER_CONFIGS)} |

## 文件分布

| 分类 | 文件数 | 占比 | 可视化 |
|------|--------|------|--------|
{chr(10).join(folder_stats_lines)}

## 分类目录

{chr(10).join(folder_links)}

## 文件树

```
.
{chr(10).join(tree_lines)}
```

## 功能说明

本文档用于测试 Quartz 构建系统的以下功能：

- **排序**：支持自然排序、字典序、日期排序、数值排序
- **聚合**：支持按文件夹、字段、日期等多种维度分组
- **反向链接**：自动收集引用当前文档的其他文档
- **图谱**：可视化文档间的关联关系

---
*此文件由自动生成，请勿手动修改*
"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  [index] {filepath}")


def write_domain_config(project_root: str, domain: str, profile: str):
    """生成业务域的配置文件"""
    settings_dir = os.path.join(project_root, "settings", domain)
    os.makedirs(settings_dir, exist_ok=True)

    # quartz.layout.json
    layout = LAYOUT_TEMPLATES.get(profile, LAYOUT_TEMPLATES["region"])
    layout_path = os.path.join(settings_dir, "quartz.layout.json")
    with open(layout_path, "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=2)
    print(f"  [config] {layout_path}")

    # quartz.config.json
    config = dict(DEFAULT_CONFIG)
    config["pageTitle"] = domain
    config["baseUrl"] = f"http://127.0.0.1:8766/{domain}"
    config_path = os.path.join(settings_dir, "quartz.config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"  [config] {config_path}")


def clean_old_domains(project_root: str, keep_domains: set):
    """清理 input、output、settings 下的旧业务域"""
    for base in ["input", "output", "settings"]:
        base_dir = os.path.join(project_root, base)
        if not os.path.exists(base_dir):
            continue
        for name in os.listdir(base_dir):
            if name not in keep_domains:
                path = os.path.join(base_dir, name)
                if os.path.isdir(path):
                    try:
                        shutil.rmtree(path)
                        print(f"[clean] 删除 {path}")
                    except PermissionError:
                        print(f"[skip] 权限不足，跳过删除 {path}")


def generate_domain(project_root: str, domain: str, profile: str, clean: bool):
    target_dir = os.path.join(project_root, "input", domain)

    if clean and os.path.exists(target_dir):
        shutil.rmtree(target_dir)
        print(f"[clean] 删除 {target_dir}")

    os.makedirs(target_dir, exist_ok=True)
    print(f"[target] {target_dir}")

    # ========== 生成根目录 index.md（Quartz 首页） ==========
    generate_root_index_md(target_dir, domain)

    # ========== 第一阶段：生成所有文件，记录文件名 ==========
    all_files = {}  # folder_name -> [filename, ...]
    file_records = {}  # folder_name -> [{num, filename, title}, ...]

    for cfg in FOLDER_CONFIGS:
        folder_name = cfg["name"]
        folder_path = os.path.join(target_dir, folder_name)
        os.makedirs(folder_path, exist_ok=True)
        generate_index_md(folder_path, folder_name)

        prefix = cfg["prefix"]
        count = cfg["count"]
        files = []
        records = []

        for i in range(count):
            file_num = i + 1
            filename = f"{prefix}-{file_num:05d}.md"
            title = f"{folder_name}-{file_num:05d}"
            files.append(filename)
            records.append({"num": file_num, "filename": filename, "title": title})

        all_files[folder_name] = files
        file_records[folder_name] = records
        print(f"  [prepare] {folder_name}: {count} files")

    # ========== 第二阶段：按依赖顺序生成内容（组织 → 人员 → 项目 → 任务 → 问答） ==========

    # 1. 组织（无外部依赖）
    org_records = file_records["组织"]
    org_path = os.path.join(target_dir, "组织")
    for rec in org_records:
        frontmatter = build_frontmatter_lines(rec["title"], "组织", {})
        body = build_content(rec["title"], [])
        with open(os.path.join(org_path, rec["filename"]), "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter))
            f.write("\n\n")
            f.write(body)
    print(f"  [done] 组织: {len(org_records)} files")

    # 2. 人员（依赖：所属组织）
    person_records = file_records["人员"]
    person_path = os.path.join(target_dir, "人员")
    org_filenames = all_files["组织"]
    for rec in person_records:
        org_file = maybe(random.choice(org_filenames), MISSING_RATE["organization"])
        extra = {}
        if org_file:
            org_name = org_file.replace(".md", "")
            extra["组织"] = org_name
        frontmatter = build_frontmatter_lines(rec["title"], "人员", extra)
        body = build_content(rec["title"], [])
        with open(os.path.join(person_path, rec["filename"]), "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter))
            f.write("\n\n")
            f.write(body)
    print(f"  [done] 人员: {len(person_records)} files")

    # 3. 项目（依赖：负责人/参与人员）
    proj_records = file_records["项目"]
    proj_path = os.path.join(target_dir, "项目")
    person_filenames = all_files["人员"]
    for rec in proj_records:
        owner_file = maybe(random.choice(person_filenames), MISSING_RATE["owner"])
        extra = {}
        if owner_file:
            owner_name = owner_file.replace(".md", "")
            extra["负责人"] = owner_name
        # 再随机引用 1-2 个参与人员（放入正文）
        body_links = []
        participant_count = random.randint(0, 2)
        for _ in range(participant_count):
            p = random.choice(person_filenames).replace(".md", "")
            if p not in body_links:
                body_links.append(p)
        frontmatter = build_frontmatter_lines(rec["title"], "项目", extra)
        body = build_content(rec["title"], body_links)
        with open(os.path.join(proj_path, rec["filename"]), "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter))
            f.write("\n\n")
            f.write(body)
    print(f"  [done] 项目: {len(proj_records)} files")

    # 4. 任务（依赖：所属项目）
    task_records = file_records["任务"]
    task_path = os.path.join(target_dir, "任务")
    proj_filenames = all_files["项目"]
    for rec in task_records:
        proj_file = maybe(random.choice(proj_filenames), MISSING_RATE["project"])
        extra = {}
        if proj_file:
            proj_name = proj_file.replace(".md", "")
            extra["项目"] = proj_name
        # 再随机引用 0-1 个关联人员（放入正文）
        body_links = []
        if random.random() < 0.3:
            p = random.choice(person_filenames).replace(".md", "")
            body_links.append(p)
        frontmatter = build_frontmatter_lines(rec["title"], "任务", extra)
        body = build_content(rec["title"], body_links)
        with open(os.path.join(task_path, rec["filename"]), "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter))
            f.write("\n\n")
            f.write(body)
    print(f"  [done] 任务: {len(task_records)} files")

    # 5. 问答（依赖：关联项目/任务/人员）
    qa_records = file_records["问答"]
    qa_path = os.path.join(target_dir, "问答")
    task_filenames = all_files["任务"]
    for rec in qa_records:
        extra = {}
        body_links = []

        # 关联项目
        if random.random() < 0.5:
            proj_file = random.choice(proj_filenames)
            proj_name = proj_file.replace(".md", "")
            extra["项目"] = proj_name

        # 关联任务
        if random.random() < 0.6:
            task_file = random.choice(task_filenames)
            task_name = task_file.replace(".md", "")
            extra["任务"] = task_name

        # 关联人员（提问者/回答者）
        if random.random() < 0.4:
            p = random.choice(person_filenames).replace(".md", "")
            extra["相关人员"] = p

        # 额外随机引用（放入正文，确保有足够链接密度）
        extra_refs = random.randint(0, 2)
        all_candidates = proj_filenames + task_filenames + person_filenames
        for _ in range(extra_refs):
            ref = random.choice(all_candidates).replace(".md", "")
            if ref not in body_links:
                body_links.append(ref)

        frontmatter = build_frontmatter_lines(rec["title"], "问答", extra)
        body = build_content(rec["title"], body_links)
        with open(os.path.join(qa_path, rec["filename"]), "w", encoding="utf-8") as f:
            f.write("\n".join(frontmatter))
            f.write("\n\n")
            f.write(body)
    print(f"  [done] 问答: {len(qa_records)} files")

    total = sum(cfg["count"] for cfg in FOLDER_CONFIGS)
    index_count = len(FOLDER_CONFIGS) + 1  # 各子目录 + 根目录
    print(f"[summary] 共生成 {total} 个 Markdown 文件（含 {index_count} 个 index.md: {index_count-1} 个子目录 + 1 个根目录）")
    print(f"[summary] 目标目录: {target_dir}")


def main():
    parser = argparse.ArgumentParser(description="批量生成测试 Markdown 文件")
    parser.add_argument("--domain", type=str, required=True, help="业务域名称，如 demo-region")
    parser.add_argument("--profile", type=str, choices=["region", "core"], required=True,
                        help="配置模板：region（大区模式）或 core（硬上限模式）")
    parser.add_argument("--clean", action="store_true", help="清空目标目录后重新生成")
    parser.add_argument("--clean-all", action="store_true",
                        help="清理所有旧业务域，只保留当前指定的业务域")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    # 清理所有旧业务域
    if args.clean_all:
        clean_old_domains(project_root, keep_domains={args.domain})

    # 生成配置文件
    write_domain_config(project_root, args.domain, args.profile)

    # 生成 Markdown 文件
    generate_domain(project_root, args.domain, args.profile, args.clean)


if __name__ == "__main__":
    main()
