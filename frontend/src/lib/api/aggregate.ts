// 聚合接口 API 层（协议 v1）：复用 api.ts 的 axios 实例与 token 拦截链路
import { api } from '@/lib/api';
import type {
  AggregateQuery,
  AggregateResponse,
  MemberPage,
  AggregationViews,
  InstanceSearchResult,
} from '@/types/aggregate';

// 可配置端点路径（app-config.json apiEndpoints 可覆盖，键名与 graph 端点风格一致）
const _aggEndpoints: Record<string, string> = {
  aggregate: '/api/graph/aggregate',
  aggregatePoll: '/api/graph/aggregate', // GET /aggregate/{scope}
  aggregateExpand: '/api/graph/aggregate/expand',
  aggregationViews: '/api/graph/aggregation/views',
  instances: '/api/graph/instances',
};

/** 批量设置聚合端点路径（App.tsx 配置加载时调用） */
export function setAggregateEndpointPaths(paths: Record<string, string>) {
  Object.assign(_aggEndpoints, paths);
}

/** 从 axios 错误中提取可展示信息（协议 {detail} 优先） */
export function extractAggError(err: unknown): { status: number; message: string } {
  const e = err as { response?: { status?: number; data?: { detail?: string } }; message?: string };
  const status = e?.response?.status ?? 0;
  const detail = e?.response?.data?.detail;
  const message = detail || e?.message || '请求失败';
  return { status, message };
}

/** POST /aggregate 查询分组 */
export async function fetchAggregate(query: AggregateQuery): Promise<AggregateResponse> {
  const { data } = await api.post<AggregateResponse>(_aggEndpoints.aggregate, {
    domain: query.domain,
    source: query.source,
    root: query.root,
    group: query.group,
    start: query.start || '',
    end: query.end || '',
    metrics: query.metrics,
  });
  return data;
}

/** GET /aggregate/{scope} 轮询指标结果 */
export async function pollAggregate(scope: string): Promise<AggregateResponse> {
  const { data } = await api.get<AggregateResponse>(`${_aggEndpoints.aggregatePoll}/${encodeURIComponent(scope)}`);
  return data;
}

/** POST /aggregate/expand 分页读取某个聚合节点的真实成员 */
export async function expandMembers(params: {
  scope: string;
  bucket: string;
  offset: number;
  limit: number;
}): Promise<MemberPage> {
  const { data } = await api.post<MemberPage>(_aggEndpoints.aggregateExpand, params);
  return data;
}

/** GET /aggregation/views 配置选择数据 */
export async function fetchAggregationViews(domain?: string): Promise<AggregationViews> {
  const params: Record<string, string> = {};
  if (domain) params.domain = domain;
  const { data } = await api.get<AggregationViews>(_aggEndpoints.aggregationViews, { params });
  return data;
}

/** GET /instances 根主体实例搜索 */
export async function fetchInstances(params: {
  domain: string;
  subject: string;
  search?: string;
}): Promise<InstanceSearchResult> {
  const { data } = await api.get<InstanceSearchResult>(_aggEndpoints.instances, { params });
  return data;
}
