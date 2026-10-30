// 知识图谱聚合接口 v1 协议类型（对应 backend/aggregate_mock.py / 真实后端 28085）
import type { GraphNode, GraphEdge } from './graph';

/** 聚合查询条件（POST /aggregate 请求体） */
export interface AggregateQuery {
  domain: string;
  source: string;
  /** null = 全局查询；指定时 relation 是来源主体的外键字段 */
  root: { relation: string; key: string } | null;
  group: string;
  start?: string;
  end?: string;
  /** 已保存的指标 ID，最多 8 个；空数组只查分组记录数 */
  metrics: string[];
}

/** 聚合分组（不透明 ID，原样保存并传回，前端不得拆解） */
export interface AggregateGroup {
  id: string;
  key: string;
  label: string;
  count: number;
  metrics: Record<string, number | null>;
}

/** 指标定义（顶层 metrics） */
export interface AggregateMetricDef {
  id: string;
  name: string;
  unit?: string;
}

/** 聚合查询响应根节点：kind=entity 真实主体；kind=scope 全局范围锚点（非真实实体） */
export interface AggregateRootNode {
  id: string;
  label: string;
  category?: string;
  data: {
    kind: 'entity' | 'scope';
    subject?: string;
    key?: string;
    domain?: string;
    source?: string;
    properties?: Record<string, unknown>;
  };
}

/** POST /aggregate 与 GET /aggregate/{scope} 共用响应结构 */
export interface AggregateResponse {
  scope: string;
  root: AggregateRootNode;
  groups: AggregateGroup[];
  total: number;
  metrics: AggregateMetricDef[];
  metric_status: 'running' | 'complete' | 'failed';
  metric_error: string | null;
  context: AggregateQuery;
  data_source?: string;
}

/** 成员分页响应（POST /aggregate/expand） */
export interface MemberPage {
  nodes: GraphNode[];
  /** source=聚合节点 ID，label="分组成员"；边 id 去重 */
  edges: GraphEdge[];
  total: number;
  offset: number;
  has_more: boolean;
}

/** views 配置：分组字段选项 */
export interface ViewGroupField {
  field: string;
  name: string;
}

/** views 配置：根主体选项 */
export interface ViewRootField {
  field: string;
  subject: string;
  name: string;
}

/** views 配置：单个主体视图 */
export interface AggregateView {
  id: string;
  name: string;
  groups: ViewGroupField[];
  roots: ViewRootField[];
  time?: string;
  metrics: AggregateMetricDef[];
}

/** GET /aggregation/views 响应 */
export interface AggregationViews {
  domain: { id: string; name: string };
  views: AggregateView[];
}

/** GET /instances 响应（真实节点结构，取 node.data.key 作为 root.key） */
export interface InstanceSearchResult {
  nodes: GraphNode[];
  limit: number;
}

/** bucket 分页状态（前端侧） */
export interface BucketPageState {
  version: number;   // bucket 级竞态守卫：展开/收起/切查询时自增使旧回调失效
  loading: boolean;  // 请求在途，防重复点击
  expanded: boolean;
  loaded: number;    // 服务端记录数进度（非 G6 新增节点数）
  offset: number;    // 下次请求 offset（仅成功后推进）
  total: number;
  hasMore: boolean;
}
