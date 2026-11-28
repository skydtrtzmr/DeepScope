import type { Projection, ViewNode } from '@/types/graph-view';
import { subjectKey, type NeighborPage, type NeighborNode } from './util';

export function subjectTitle(page: NeighborNode) {
  return page.subject?.title ?? ({ tag: '标签', virtual: '未生成页面', entity: '其他关联', '/': '根目录' }[subjectKey(page)] ?? subjectKey(page).replace(/^\//, ''));
}

export function pageNode(page: NeighborNode, depth: number, parentId?: string): ViewNode {
  return { id: page.id, label: page.title, kind: parentId ? 'entity' : 'anchor', depth, parentId,
    entity: { id: page.id, label: page.title, type: subjectKey(page), typeLabel: subjectTitle(page), properties: {} } };
}

export type Edge = NeighborPage['edges'][number];
export const edgeKey = (e: Edge) => JSON.stringify([e.source, e.target, e.type]);
export type Batch = { parent: string; nodes: NeighborNode[]; edges: Edge[] };

export function entityGraph(root: NeighborNode, batches: Batch[]) {
  const records = new Map([[root.id, root]]);
  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, Projection['edges'][number]>();
  function add(page: NeighborNode, parentId?: string) {
    if (nodes.has(page.id)) return;
    records.set(page.id, page);
    nodes.set(page.id, pageNode(page, parentId ? (nodes.get(parentId)?.depth ?? 0) + 1 : 0, parentId));
  }
  add(root);
  for (const batch of batches) {
    for (const page of batch.nodes) add(page, batch.parent);
    for (const e of batch.edges) {
      const id = edgeKey(e);
      edges.set(id, { id, source: e.source, target: e.target, kind: 'relation' });
    }
  }
  const view: Projection = { rootId: root.id, nodes: [...nodes.values()], edges: [...edges.values()], total: nodes.size };
  return { records, view };
}
