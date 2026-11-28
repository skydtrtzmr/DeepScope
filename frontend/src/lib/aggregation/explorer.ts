import type { Entity, Projection, ViewNode, ViewEdge } from '../../types/graph-view';
export type { Entity, Projection, ViewNode, ViewEdge } from '../../types/graph-view';

export interface Relation { id: string; source: string; target: string; type: string }
export interface Dataset { entities: Entity[]; relations: Relation[] }
export interface Dimension { id: string; label: string; relation?: string; field: string }
export type Context =
  | { mode: 'related'; anchorId: string; relation: string; targetType: string }
  | { mode: 'collection'; label: string; targetType: string; region?: string };

/** Merge visible paths only; a shared entity survives while any path references it. */
export function mergeProjections(data: Dataset, projections: Projection[]): Projection {
  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();
  for (const view of projections) {
    for (const node of view.nodes) {
      if (!nodes.has(node.id) || node.kind === 'anchor') nodes.set(node.id, node);
    }
    for (const edge of view.edges) edges.set(edge.id, edge);
  }
  // Include relations between entities revealed by different contexts.
  for (const relation of data.relations) {
    if (nodes.has(relation.source) && nodes.has(relation.target)) {
      edges.set(relation.id, { ...relation, kind: 'relation' });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()],
    total: nodes.size, rootId: projections[0]?.rootId ?? '' };
}

export function contextKey(context: Context, dimensions: Dimension[]): string {
  return JSON.stringify([context, dimensions.map(d => d.id)]);
}

/** Resolve the candidate set before grouping. Relation direction is explicit. */
export function candidates(data: Dataset, context: Context): Entity[] {
  const ids = context.mode === 'related' ? new Set(data.relations
    .filter(r => r.source === context.anchorId && r.type === context.relation).map(r => r.target)) : null;
  return data.entities.filter(e => e.type === context.targetType &&
    (ids ? ids.has(e.id) : context.mode === 'collection' && (!context.region || e.properties.region === context.region)));
}

function dimensionValue(data: Dataset, entity: Entity, dimension: Dimension): string | null {
  if (!dimension.relation) return entity.properties[dimension.field] ?? null;
  const relatedIds = new Set(data.relations.filter(r => r.source === entity.id && r.type === dimension.relation).map(r => r.target));
  const values = [...new Set(data.entities.filter(e => relatedIds.has(e.id))
    .map(e => e.properties[dimension.field]).filter((v): v is string => !!v))];
  // Demo contract: a dimension path resolves to at most one distinct value.
  if (values.length > 1) throw new Error(`“${entity.label}”的“${dimension.label}”有多个值，需要明确多值分组规则`);
  return values[0] ?? null;
}

/** Pure projection: cached entities do not become visible until their path is open. */
export function project(data: Dataset, context: Context, dimensions: Dimension[], expanded: Set<string>, limits: Record<string, number> = {}, pageSize = 3): Projection {
  const members = candidates(data, context);
  const key = contextKey(context, dimensions);
  const anchor = context.mode === 'related' ? data.entities.find(e => e.id === context.anchorId) : undefined;
  if (context.mode === 'related' && !anchor) throw new Error('主体不存在');
  const rootId = anchor?.id ?? `scope:${key}`;
  const nodes = new Map<string, ViewNode>([[rootId, {
    id: rootId, label: anchor?.label ?? (context.mode === 'collection' ? context.label : ''),
    kind: anchor ? 'anchor' : 'scope', entity: anchor, depth: 0, count: members.length,
  }]]);
  const edges = new Map<string, ViewEdge>();
  const connect = (source: string, target: string) => {
    const id = JSON.stringify(['membership', source, target]);
    edges.set(id, { id, source, target, kind: 'membership' });
  };
  const visit = (items: Entity[], parentId: string, level: number, path: string[]) => {
    if (level >= dimensions.length) {
      const shown = items.slice(0, limits[parentId] ?? pageSize);
      const parent = nodes.get(parentId)!;
      parent.shown = shown.length;
      parent.memberIds = items.map(e => e.id);
      for (const entity of shown) {
        if (!nodes.has(entity.id)) nodes.set(entity.id, { id: entity.id, label: entity.label, kind: 'entity', entity, parentId, depth: path.length + 1 });
        connect(parentId, entity.id);
      }
      return;
    }
    const dimension = dimensions[level];
    const buckets = new Map<string | null, Entity[]>();
    for (const entity of items) {
      const value = dimensionValue(data, entity, dimension) || null;
      buckets.set(value, [...(buckets.get(value) ?? []), entity]);
    }
    // An entirely missing dimension adds no useful level.
    if (buckets.size === 1 && buckets.has(null)) { visit(items, parentId, level + 1, path); return; }
    for (const [value, bucket] of buckets) {
      const nextPath = [...path, JSON.stringify([dimension.id, value])];
      const id = `group:${JSON.stringify([key, nextPath])}`;
      const open = expanded.has(id);
      nodes.set(id, { id, label: `${value ?? '未分类'} · ${bucket.length}`, kind: 'group', count: bucket.length,
        parentId, depth: path.length + 1, expanded: open });
      connect(parentId, id);
      if (open) visit(bucket, id, level + 1, nextPath);
    }
  };
  visit(members, rootId, 0, []);
  for (const r of data.relations) {
    if (nodes.has(r.source) && nodes.has(r.target)) {
      // The anchor relation is already represented by its grouping path.
      if (context.mode === 'related' && r.source === context.anchorId && r.type === context.relation) continue;
      edges.set(r.id, { id: r.id, source: r.source, target: r.target, kind: 'relation' });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], total: members.length, rootId };
}

export function collapseBranch(id: string, projection: Projection, expanded: Set<string>): Set<string> {
  const result = new Set(expanded);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    result.delete(queue[i]);
    queue.push(...projection.nodes.filter(n => n.parentId === queue[i] && n.kind === 'group').map(n => n.id));
  }
  return result;
}
