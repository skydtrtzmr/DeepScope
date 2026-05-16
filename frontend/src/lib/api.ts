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
  // const { data } = await api.get<GraphData>('/api/graph/initial');
  // return data;

  // 模拟 API 延迟
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    nodes: DEMO_GRAPH_DATA.nodes.slice(0, 8),
    edges: DEMO_GRAPH_DATA.edges.filter(
      (e) =>
        DEMO_GRAPH_DATA.nodes.slice(0, 8).some((n) => n.id === e.source) &&
        DEMO_GRAPH_DATA.nodes.slice(0, 8).some((n) => n.id === e.target)
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

export async function expandGraph(params: ExpandGraphParams): Promise<ExpandGraphResponse> {
  // TODO: 替换为真实后端接口
  // const { data } = await api.post<ExpandGraphResponse>('/api/graph/expand', params);
  // return data;

  // 模拟 API 延迟
  await new Promise((resolve) => setTimeout(resolve, 600));

  const { nodeId, m, offset = 0 } = params;

  // 从 demo 数据中查找该节点的关联边
  const relatedEdges = DEMO_GRAPH_DATA.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId
  );

  // 获取直接邻居节点（去重）
  const neighborIds = relatedEdges.map((e) => (e.source === nodeId ? e.target : e.source));
  const uniqueNeighborIds = [...new Set(neighborIds)];

  // 分页
  const paginatedIds = uniqueNeighborIds.slice(offset, offset + m);
  const nodes = DEMO_GRAPH_DATA.nodes.filter(
    (n) => paginatedIds.includes(n.id) && !params.excludeExistingIds.includes(n.id)
  );

  const edges = relatedEdges.filter(
    (e) =>
      paginatedIds.includes(e.source === nodeId ? e.target : e.source) &&
      !params.excludeExistingIds.includes(e.source === nodeId ? e.target : e.source)
  );

  return {
    nodes,
    edges,
    totalNeighbors: uniqueNeighborIds.length,
  };
}
