import type { GraphData, GraphNode, RelatedNodeDetail } from '@/types/graph';

// BFS 算法：获取指定深度内的关联节点
export function getRelatedNodes(
  data: GraphData,
  startNodeId: string,
  maxDirect: number,
  depth: number
): { visibleData: GraphData; relatedNodes: RelatedNodeDetail[]; treeEdgeIds: Set<string> } {
  const visitedNodes = new Set<string>();
  const visibleNodeIds = new Set<string>();
  const visibleEdgeIds = new Set<string>();
  const treeEdgeIds = new Set<string>();
  const relatedNodes: RelatedNodeDetail[] = [];

  const adjacency = new Map<string, { nodeId: string; edgeId: string; label?: string }[]>();
  data.edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ nodeId: edge.target, edgeId: edge.id, label: edge.label });
    adjacency.get(edge.target)!.push({ nodeId: edge.source, edgeId: edge.id, label: edge.label });
  });

  const nodeMap = new Map<string, GraphNode>();
  data.nodes.forEach((node) => nodeMap.set(node.id, node));

  visitedNodes.add(startNodeId);
  visibleNodeIds.add(startNodeId);

  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth: curDepth } = queue.shift()!;
    if (curDepth >= depth) continue;

    const neighbors = adjacency.get(nodeId) || [];
    let addedCount = 0;

    for (const neighbor of neighbors) {
      if (addedCount >= maxDirect) break;

      if (!visitedNodes.has(neighbor.nodeId)) {
        visitedNodes.add(neighbor.nodeId);
        visibleNodeIds.add(neighbor.nodeId);
        visibleEdgeIds.add(neighbor.edgeId);
        treeEdgeIds.add(neighbor.edgeId);

        const node = nodeMap.get(neighbor.nodeId);
        if (node) {
          relatedNodes.push({
            id: node.id,
            label: node.label,
            category: node.category,
            description: node.description,
            style: node.style,
            relationLabel: neighbor.label,
            depth: curDepth + 1,
            data: node.data,
          });
        }

        queue.push({ nodeId: neighbor.nodeId, depth: curDepth + 1 });
        addedCount++;
      } else {
        visibleEdgeIds.add(neighbor.edgeId);
      }
    }
  }

  const visibleData: GraphData = {
    nodes: data.nodes.filter((n) => visibleNodeIds.has(n.id)),
    edges: data.edges.filter((e) => visibleEdgeIds.has(e.id)),
  };

  relatedNodes.sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label, 'zh'));

  return { visibleData, relatedNodes, treeEdgeIds };
}

