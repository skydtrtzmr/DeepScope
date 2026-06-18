import axios from 'axios';
import type { GraphData, GraphNode, GraphEdge, DomainItem } from '@/types/graph';

const api = axios.create({
  timeout: 10000,
});

// ========== Base URL ==========

let _baseURL = '';

/** 设置后端 API 的 base URL（可从 app-config.json 中配置 apiBaseUrl 字段） */
export function setApiBaseUrl(url: string) {
  _baseURL = url;
}

// ========== Token 认证 ==========

let _token = '';
let _tokenEnabled = false;
let _tokenEndpoint = '/api/Auth/replaceToken';

export interface TokenConfig {
  enabled: boolean;
  tokenEndpoint?: string;
}

/** 获取当前存储的 token */
export function getToken(): string {
  return _token;
}

/** 设置当前 token（从 URL 参数或 app-config.json 中获取） */
export function setToken(token: string) {
  _token = token;
}

/** 清空 token */
export function clearToken() {
  _token = '';
}

/** 配置 token 认证（enabled + 可选端点路径） */
export function setTokenConfig(config: TokenConfig) {
  _tokenEnabled = config.enabled;
  if (config.tokenEndpoint) {
    _tokenEndpoint = config.tokenEndpoint;
  }
}

/** 刷新 token：POST 到 token 端点，用当前 token 换取新 token */
export async function refreshToken(): Promise<string | null> {
  if (!_token || !_tokenEnabled) return null;
  try {
    const { data } = await api.post(_tokenEndpoint, null, {
      headers: { Authorization: `Bearer ${_token}` },
    });
    // 响应格式：{ Success, StatusCode, Message, Data }，Data 为新 token 字符串
    const newToken: string | undefined = data?.Data;
    if (newToken) {
      _token = newToken;
      console.log('[auth] token 已刷新');
      return _token;
    }
    console.warn('[auth] token 刷新响应中无 Data 字段:', data);
    return null;
  } catch (err) {
    console.error('[auth] token 刷新失败:', err);
    return null;
  }
}

// ========== 请求拦截器 ==========

api.interceptors.request.use((config) => {
  if (_baseURL) {
    config.baseURL = _baseURL;
  }
  if (_token && _tokenEnabled) {
    config.headers.Authorization = `Bearer ${_token}`;
    console.log('[api] 请求添加 Authorization 头, token 前缀:', _token.substring(0, 8));
  } else {
    console.log('[api] 未添加 Authorization, _token:', JSON.stringify(_token), '_tokenEnabled:', _tokenEnabled);
  }
  return config;
});

// ========== 响应拦截器（401 时自动刷新 token 并重试） ==========

let _isRefreshing = false;
let _pendingRequests: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // 仅当 token 认证启用、收到 401、且尚未重试过
    if (!_tokenEnabled || error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    if (_isRefreshing) {
      // 已有刷新中的请求，排队等待
      return new Promise((resolve) => {
        _pendingRequests.push((newToken: string) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          resolve(api(originalRequest));
        });
      });
    }

    _isRefreshing = true;
    try {
      const newToken = await refreshToken();
      if (!newToken) {
        _isRefreshing = false;
        _pendingRequests = [];
        return Promise.reject(error);
      }
      // 重试所有排队的请求
      _pendingRequests.forEach((cb) => cb(newToken));
      _pendingRequests = [];
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } finally {
      _isRefreshing = false;
    }
  }
);

// 调试辅助：在控制台输入 __getToken() 查看当前 token
(globalThis as any).__getToken = getToken;

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
