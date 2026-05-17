import axios from 'axios';
import type { GraphData, GraphNode, GraphEdge } from '@/types/graph';
import { DEMO_GRAPH_DATA } from './demo-data';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
});

// 初始加载接口
export async function fetchInitialGraph(): Promise<GraphData> {
  // TODO: 替换为真实后端接口
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    nodes: DEMO_GRAPH_DATA.nodes.slice(0, 8),
    edges: DEMO_GRAPH_DATA.edges.filter(
      (e) =>
        DEMO_GRAPH_DATA.nodes.slice(0, 8).some((n) => n.id === e.source) &&
        DEMO_GRAPH_DATA.nodes.slice(0, 8).some((n) => n.id === e.target),
    ),
  };
}

// 节点展开接口
export interface ExpandGraphParams {
  nodeId: string;
  m: number;
  n: number;
  offset?: number;
  excludeExistingIds: string[];
}

export interface ExpandGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNeighbors: number;
}

// 构建邻接表
function buildAdjacency(edges: GraphEdge[]) {
  const adjacency = new Map<string, { neighborId: string; edge: GraphEdge }[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ neighborId: edge.target, edge });
    adjacency.get(edge.target)!.push({ neighborId: edge.source, edge });
  }
  return adjacency;
}

// 多层 BFS 展开：每节点每层最多 m 个新邻居，最大深度 n
function bfsExpand(
  nodeId: string,
  m: number,
  n: number,
  excludeIds: Set<string>,
) {
  const adjacency = buildAdjacency(DEMO_GRAPH_DATA.edges);
  const nodeMap = new Map(DEMO_GRAPH_DATA.nodes.map((n) => [n.id, n]));

  const visited = new Set([...excludeIds, nodeId]);
  const resultNodes: GraphNode[] = [];
  const resultEdges: GraphEdge[] = [];
  const resultEdgeIds = new Set<string>();

  let currentLayer = [nodeId];

  for (let depth = 0; depth < n; depth++) {
    const nextLayer: string[] = [];

    for (const currentNodeId of currentLayer) {
      const neighbors = adjacency.get(currentNodeId) || [];
      let addedCount = 0;

      for (const { neighborId, edge } of neighbors) {
        if (addedCount >= m) break;
        if (visited.has(neighborId)) continue;

        visited.add(neighborId);
        nextLayer.push(neighborId);

        const node = nodeMap.get(neighborId);
        if (node && !resultEdgeIds.has(edge.id)) {
          resultNodes.push(node);
          resultEdges.push(edge);
          resultEdgeIds.add(edge.id);
        }

        addedCount++;
      }
    }

    if (nextLayer.length === 0) break;
    currentLayer = nextLayer;
  }

  return { nodes: resultNodes, edges: resultEdges };
}

// 分页加载直接邻居
function paginateDirectNeighbors(
  nodeId: string,
  m: number,
  offset: number,
  excludeIds: Set<string>,
) {
  const relatedEdges = DEMO_GRAPH_DATA.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
  const neighborIds = relatedEdges.map((e) => (e.source === nodeId ? e.target : e.source));
  const uniqueNeighborIds = [...new Set(neighborIds)];

  // totalNeighbors 始终返回直接邻居总数（不受 exclude 影响）
  const totalNeighbors = uniqueNeighborIds.length;

  // 分页：取 offset 到 offset+m 的邻居
  const paginatedIds = uniqueNeighborIds.slice(offset, offset + m);
  const nodeMap = new Map(DEMO_GRAPH_DATA.nodes.map((n) => [n.id, n]));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const id of paginatedIds) {
    if (excludeIds.has(id)) continue;
    const node = nodeMap.get(id);
    if (node) nodes.push(node);
  }

  const newNodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of relatedEdges) {
    const otherId = edge.source === nodeId ? edge.target : edge.source;
    if (newNodeIds.has(otherId)) edges.push(edge);
  }

  return { nodes, edges, totalNeighbors };
}

export async function expandGraph(params: ExpandGraphParams): Promise<ExpandGraphResponse> {
  // TODO: 替换为真实后端接口
  await new Promise((resolve) => setTimeout(resolve, 10));

  const { nodeId, m, n, offset = 0 } = params;
  const excludeSet = new Set(params.excludeExistingIds);

  // offset > 0：分页加载直接邻居（后端强制 n=1）
  if (offset > 0) {
    return paginateDirectNeighbors(nodeId, m, offset, excludeSet);
  }

  // offset === 0, n > 0：多层 BFS 展开
  const result = bfsExpand(nodeId, m, n, excludeSet);

  // totalNeighbors：返回该节点的直接邻居总数
  const relatedEdges = DEMO_GRAPH_DATA.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
  const neighborIds = relatedEdges.map((e) => (e.source === nodeId ? e.target : e.source));
  const totalNeighbors = new Set(neighborIds).size;

  return { ...result, totalNeighbors };
}
