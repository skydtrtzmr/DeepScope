import type { Projection, ViewNode } from './preview-types';

export interface RelationGroup {
  id: string; label: string; total: number; memberIds: string[]; edgeIds: string[];
}
export interface LocalGraph extends Projection { groups?: RelationGroup[] }
export const MEMBER_PAGE_SIZE = 5;

/** DeepScope's collapsed-group/limited-members projection, using saved relationships. */
export function aggregateLocalGraph(graph: LocalGraph, expanded: Set<string>, limits: Record<string, number>): Projection {
  if (!graph.groups) return graph;
  const root = graph.nodes.find(node => node.id === graph.rootId);
  const nodes = new Map<string, ViewNode>(root ? [[root.id, root]] : []);
  const edges: Projection['edges'] = [];
  const originals = new Map(graph.nodes.map(node => [node.id, node]));
  const originalEdges = new Map(graph.edges.map(edge => [edge.id, edge]));
  for (const group of graph.groups) {
    const members = [...new Set(group.memberIds)].filter(id => originals.has(id));
    const open = expanded.has(group.id);
    const shown = open ? members.slice(0, limits[group.id] ?? MEMBER_PAGE_SIZE) : [];
    nodes.set(group.id, { id: group.id, label: `${group.label} · ${group.total}`, kind: 'group',
      parentId: graph.rootId, depth: 1, count: group.total, memberIds: members, shown: shown.length, expanded: open });
    edges.push({ id: JSON.stringify(['group', group.id]), source: graph.rootId, target: group.id, kind: 'membership' });
    for (const id of shown) {
      if (id !== graph.rootId) nodes.set(id, { ...originals.get(id)!, parentId: group.id, depth: 2 });
    }
    for (const id of group.edgeIds) {
      const edge = originalEdges.get(id);
      if (!edge) continue;
      const member = edge.source === graph.rootId ? edge.target : edge.source;
      if (!shown.includes(member)) continue;
      edges.push({ ...edge, id: JSON.stringify([group.id, edge.id]),
        source: edge.source === graph.rootId ? group.id : edge.source,
        target: edge.target === graph.rootId ? group.id : edge.target });
    }
  }
  return { ...graph, nodes: [...nodes.values()], edges };
}
