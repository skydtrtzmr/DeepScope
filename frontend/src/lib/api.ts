import axios from 'axios';
import type { GraphData, GraphNode, GraphEdge } from '@/types/graph';

const api = axios.create({
  timeout: 10000,
});

// 获取可用 domain 列表
export interface DomainItem {
  name: string;
  nodeCount: number;
  edgeCount: number;
}

export async function fetchDomains(): Promise<DomainItem[]> {
  const { data } = await api.get('/api/domains');
  return Array.isArray(data) ? data : [];
}

// 初始加载
export async function fetchInitialGraph(domain: string): Promise<GraphData> {
  const { data } = await api.get('/api/graph/initial', { params: { domain } });
  return data;
}

// 节点展开接口参数
export interface ExpandGraphParams {
  nodeId: string;
  m: number;
  n: number;
  offset?: number;
  excludeIds: string[];
  domain: string;
}

// 节点展开接口响应
export interface ExpandGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNeighbors: number;
}

// 节点展开（POST）
export async function expandGraph(params: ExpandGraphParams): Promise<ExpandGraphResponse> {
  const { data } = await api.post('/api/graph/expand', {
    nodeId: params.nodeId,
    m: params.m,
    n: params.n,
    offset: params.offset ?? 0,
    excludeIds: params.excludeIds,
    domain: params.domain,
  });
  return data;
}
