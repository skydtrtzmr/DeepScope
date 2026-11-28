import type { NeighborNode } from './util';

export type RelatedDirectory = {
  pages: NeighborNode[];
  groups: RelatedDirectoryGroup[];
};

type RelatedDirectoryGroup = {
  id: string;
  title: string;
  field?: string;
  count: number;
  children: RelatedDirectory;
};

const UNCLASSIFIED = '未分类';
const MAX_DIMENSION_LEVELS = 2;
const collator = new Intl.Collator('zh-CN', { numeric: true });

export function relatedDimensionValue(raw: unknown): string {
  const values = Array.isArray(raw) ? raw : [raw];
  const value = values.find(item => item != null && String(item).trim() !== '');
  return value == null ? UNCLASSIFIED : String(value);
}

function dimensions(pages: NeighborNode[], fields: string[], minimum: number, depth: number): RelatedDirectory {
  if (pages.length < 2 || depth === MAX_DIMENSION_LEVELS) return { pages, groups: [] };

  for (const [index, field] of fields.entries()) {
    const buckets = new Map<string, NeighborNode[]>();
    for (const page of pages) {
      const key = relatedDimensionValue(page.frontmatter?.[field]);
      const members = buckets.get(key) ?? [];
      members.push(page);
      buckets.set(key, members);
    }
    // A constant or wholly missing field creates a redundant level.
    if (buckets.size < 2) continue;

    const groups: RelatedDirectoryGroup[] = [];
    const loose: NeighborNode[] = [];
    for (const [value, members] of buckets) {
      if (members.length < (value === UNCLASSIFIED ? 2 : minimum)) {
        loose.push(...members);
        continue;
      }
      groups.push({ id: JSON.stringify([field, value]), title: value, field, count: members.length,
        children: dimensions(members, fields.slice(index + 1), minimum, depth + 1) });
    }
    if (groups.length === 0) continue;

    groups.sort((a, b) => Number(a.title === UNCLASSIFIED) - Number(b.title === UNCLASSIFIED) ||
      collator.compare(a.title, b.title));
    return { pages: loose, groups };
  }
  return { pages, groups: [] };
}

export function relatedDirectory(pages: NeighborNode[], fields: string[], minimum: number): RelatedDirectory {
  const buckets = new Map<string, { title: string; pages: NeighborNode[] }>();
  for (const page of pages) {
    const fallback = page.type === 'tag' ? '标签' : page.type === 'virtual' ? '未生成页面' : '其他关联';
    const id = page.subject?.id ?? fallback;
    const group = buckets.get(id) ?? { title: page.subject?.title ?? fallback, pages: [] };
    group.pages.push(page);
    buckets.set(id, group);
  }
  return {
    pages: [],
    groups: [...buckets].map(([id, group]) => ({
      id, title: group.title, count: group.pages.length,
      children: dimensions(group.pages, fields, Math.max(2, minimum), 0),
    })).sort((a, b) => Number(!a.id.startsWith('/')) - Number(!b.id.startsWith('/')) ||
      collator.compare(a.title, b.title)),
  };
}
