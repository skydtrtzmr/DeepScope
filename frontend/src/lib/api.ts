import axios from 'axios';
import type { GraphData, GraphNode, GraphEdge } from '@/types/graph';

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
let _refreshGraceSeconds = 300; // token 过期前多少秒开始主动刷新
let _refreshPromise: Promise<string | null> | null = null;
let _onTokenExpiredCallback: (() => void) | null = null;

/** 注册 token 过期回调（刷新失败时触发，UI 层可用于显示提示） */
export function onTokenExpired(cb: () => void) {
  _onTokenExpiredCallback = cb;
}

export interface TokenConfig {
  enabled: boolean;
  tokenEndpoint?: string;
  /** token 过期前多少秒开始主动刷新，默认 300（5 分钟） */
  refreshGraceSeconds?: number;
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

/** 配置 token 认证（enabled + 可选端点路径 + 宽限期） */
export function setTokenConfig(config: TokenConfig) {
  _tokenEnabled = config.enabled;
  if (config.tokenEndpoint) {
    _tokenEndpoint = config.tokenEndpoint;
  }
  if (typeof config.refreshGraceSeconds === 'number' && config.refreshGraceSeconds >= 0) {
    _refreshGraceSeconds = config.refreshGraceSeconds;
  }
}

/** 从 JWT payload 解析 exp（秒级时间戳），解析失败返回 0 */
function _getJwtExp(token: string): number {
  try {
    const payload = token.split('.')[1];
    // JWT 使用 base64url（- → +, _ → /），atob 只能解析标准 base64，先转换
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64));
    const exp = decoded.exp;
    if (typeof exp === 'number') return exp;
    if (typeof exp === 'string') {
      const n = Number(exp);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** 检查 token 是否即将过期（剩余时间 < 宽限期），需要主动刷新 */
function _shouldRefresh(): boolean {
  if (!_token || !_tokenEnabled) return false;
  const exp = _getJwtExp(_token);
  const now = Math.floor(Date.now() / 1000);
  const remaining = exp - now;
  const needRefresh = exp !== 0 && remaining < _refreshGraceSeconds;
  console.log(`[auth] exp=${exp}, now=${now}, remaining=${remaining}s, grace=${_refreshGraceSeconds}s, refresh=${needRefresh}`);
  return needRefresh;
}

/** 刷新 token：POST 到 token 端点，用当前 token 换取新 token */
export async function refreshToken(): Promise<string | null> {
  if (!_token || !_tokenEnabled) return null;
  try {
    // 直接使用 raw axios（不走 api 的拦截器，避免循环死锁）
    const url = (_baseURL || '') + _tokenEndpoint;
    const { data } = await axios.post(url, null, {
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

// ========== 请求拦截器（主动刷新：过期前预先换 token） ==========

api.interceptors.request.use(async (config) => {
  if (_baseURL) {
    config.baseURL = _baseURL;
  }
  if (_token && _tokenEnabled) {
    // token 即将过期 → 主动刷新，确保请求始终带上有效 token
    if (_shouldRefresh()) {
      if (!_refreshPromise) {
        _refreshPromise = refreshToken().finally(() => {
          _refreshPromise = null;
        });
      }
      await _refreshPromise;
    }
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
        _onTokenExpiredCallback?.();
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
  initial: '/api/graph/initial',
  expand: '/api/graph/expand',
  neighbors: '/api/graph/neighbors',
  nodes: '/api/graph/nodes',
};

/** 批量设置端点路径（可从 app-config.json 或 URL 参数中读取） */
export function setEndpointPaths(paths: Record<string, string>) {
  Object.assign(_endpoints, paths);
}

// 初始加载
export async function fetchInitialGraph(domain?: string): Promise<GraphData> {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  const { data } = await api.get(_endpoints.initial, { params });
  return data;
}

// BFS 多层展开参数
export interface ExpandGraphParams {
  nodeId: string;
  m: number;
  n: number;
  domain?: string;
}

// 分页加载直接邻居参数
export interface NeighborParams {
  nodeId: string;
  limit: number;
  excludeIds: string[];
  domain?: string;
}

// 节点展开/邻居接口响应（共用）
export interface ExpandGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNeighbors: number;
}

// 按 ID 查询节点（仅返回节点，无边）
export async function fetchNodesByIds(ids: string[], domain?: string): Promise<GraphData> {
  const params: Record<string, string> = { ids: ids.join(',') };
  if (domain) params.domain = domain;
  const { data } = await api.get(_endpoints.nodes, { params });
  return data;
}

// BFS 多层展开（POST）
export async function expandGraph(params: ExpandGraphParams): Promise<ExpandGraphResponse> {
  const body: Record<string, unknown> = {
    nodeId: params.nodeId,
    m: params.m,
    n: params.n,
  };
  if (params.domain) body.domain = params.domain;
  const { data } = await api.post(_endpoints.expand, body);
  return data;
}

// 分页加载直接邻居（POST）
export async function fetchNeighbors(params: NeighborParams): Promise<ExpandGraphResponse> {
  const body: Record<string, unknown> = {
    nodeId: params.nodeId,
    limit: params.limit,
    excludeIds: params.excludeIds,
  };
  if (params.domain) body.domain = params.domain;
  const { data } = await api.post(_endpoints.neighbors, body);
  return data;
}
