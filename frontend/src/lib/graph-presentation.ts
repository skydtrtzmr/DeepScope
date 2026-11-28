import type { GraphData } from '@/types/graph';
import type { Projection, ViewNode } from '@/types/graph-view';

export function projectGraphData(data: GraphData, overlay?: GraphData): Projection {
  const rootId = data.nodes[0]?.id ?? '';
  const nodes = [...data.nodes, ...(overlay?.nodes ?? [])].map((n): ViewNode => ({
    id: n.id, label: n.label, style: n.style, depth: 0,
    kind: n.data?.kind === 'aggregate' ? 'group' : n.id === rootId ? 'anchor' : 'entity',
    entity: { id: n.id, label: n.label, type: n.category ?? '', properties: {} },
  }));
  return { rootId, nodes, total: data.nodes.length, edges: [
    ...data.edges.map(e => ({ ...e, kind: 'relation' as const })),
    ...(overlay?.edges ?? []).map(e => ({ ...e, kind: 'membership' as const })),
  ] };
}

/** One set of states for the canvas, derived from the same traversal as the inspector. */
export function selectionStates(data: GraphData, selected: string | null, hover: string | null,
  visible: GraphData | null, treeEdges: Set<string> | undefined, categories: string[]) {
  const active = new Set((visible ?? data).nodes
    .filter(n => n.id === selected || !categories.length || categories.includes(n.category ?? ''))
    .map(n => n.id));
  const states: Record<string, string[]> = {};
  for (const n of data.nodes) {
    states[n.id] = n.id === selected ? ['selected'] : !active.has(n.id) ? ['muted'] : n.id === hover ? ['highlighted'] : [];
  }
  for (const e of data.edges) {
    const included = active.has(e.source) && active.has(e.target);
    states[e.id] = selected ? [included && treeEdges?.has(e.id) ? 'related' : 'muted'] : included ? [] : ['muted'];
  }
  return states;
}
