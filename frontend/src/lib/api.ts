import axios from 'axios';
import type { GraphData, GraphNode, GraphEdge, DomainItem } from '@/types/graph';

const api = axios.create({
  timeout: 10000,
});

let _baseURL = '';

/** 设置后端 API 的 base URL（可从 app-config.json 中配置 apiBaseUrl 字段） */
export function setApiBaseUrl(url: string) {
  _baseURL = url;
}

api.interceptors.request.use((config) => {
  if (_baseURL) {
    config.baseURL = _baseURL;
  }
  return config;
});

// 可配置端点路径（代码内默认值 → app-config.json → URL 参数覆盖）
const _endpoints: Record<string, string> = {
  domains: '/api/domains',
  initial: '/api/graph/initial',
  expand: '/api/graph/expand',
  neighbors: '/api/graph/neighbors',
  nodes: '/api/graph/nodes',
};

/** 批量设置端点路径（可从 app-config.json 或 URL 参数中读取） */
export function setEndpointPaths(paths: Record<string, string>) {
  Object.assign(_endpoints, paths);
}

// 获取可用 domain 列表
export type { DomainItem };

export async function fetchDomains(): Promise<DomainItem[]> {
  const { data } = await api.get(_endpoints.domains);
  return Array.isArray(data) ? data : [];
}

// 初始加载
export async function fetchInitialGraph(domain: string): Promise<GraphData> {
  const { data } = await api.get(_endpoints.initial, { params: { domain } });
  return data;
}

// BFS 多层展开参数
export interface ExpandGraphParams {
  nodeId: string;
  m: number;
  n: number;
  domain: string;
}

// 分页加载直接邻居参数
export interface NeighborParams {
  nodeId: string;
  limit: number;
  excludeIds: string[];
  domain: string;
}

// 节点展开/邻居接口响应（共用）
export interface ExpandGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNeighbors: number;
}

// 按 ID 查询节点（仅返回节点，无边）
export async function fetchNodesByIds(ids: string[], domain: string): Promise<GraphData> {
  const { data } = await api.get(_endpoints.nodes, {
    params: { ids: ids.join(','), domain },
  });
  return data;
}

// BFS 多层展开（POST）
export async function expandGraph(params: ExpandGraphParams): Promise<ExpandGraphResponse> {
  const { data } = await api.post(_endpoints.expand, {
    nodeId: params.nodeId,
    m: params.m,
    n: params.n,
    domain: params.domain,
  });
  return data;
}

// 分页加载直接邻居（POST）
export async function fetchNeighbors(params: NeighborParams): Promise<ExpandGraphResponse> {
  const { data } = await api.post(_endpoints.neighbors, {
    nodeId: params.nodeId,
    limit: params.limit,
    excludeIds: params.excludeIds,
    domain: params.domain,
  });
  return data;
}
