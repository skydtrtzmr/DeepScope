// 节点样式
export interface NodeStyle {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  radius?: number;
  opacity?: number;
}

// 边样式
export interface EdgeStyle {
  stroke?: string;
  lineWidth?: number;
  opacity?: number;
}

// 图谱节点
export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  url?: string;
  description?: string;
  data?: Record<string, unknown>;
  style?: NodeStyle;
}

// 图谱边
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  data?: Record<string, unknown>;
  style?: EdgeStyle;
}

// 图谱数据
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// 图谱配置（高亮范围：控制 BFS 从已加载数据中筛选可见节点）
export interface GraphConfig {
  maxDirectRelations: number; // 每节点每层展开邻居上限 m
  maxDepth: number; // BFS 深度 n
}

// 探索配置（控制 API 请求参数）
export interface ExploreConfig {
  m: number; // 每节点每层展开邻居上限
  n: number; // 探索深度
}

// 探索按钮状态
export type ExploreButtonState =
  | { type: 'explore'; label: '探索此节点' }
  | { type: 'deeper'; label: '探索更深' }
  | { type: 'more'; label: '加载更多'; loaded: number; total: number }
  | { type: 'done'; label: '已全部探索' };

// 关联节点详情（用于列表展示）
export interface RelatedNodeDetail {
  id: string;
  label: string;
  type?: string;
  description?: string;
  relationLabel?: string; // 与当前节点的关系标签
  depth: number; // 关联深度 (1 = 直接关联)
  data?: Record<string, unknown>;
}

// 节点类型颜色映射
export const NODE_TYPE_COLORS: Record<string, string> = {
  default: '#6366f1', // indigo
  person: '#10b981', // emerald
  organization: '#f59e0b', // amber
  event: '#ef4444', // red
  location: '#3b82f6', // blue
  concept: '#8b5cf6', // violet
  document: '#ec4899', // pink
};

// 获取节点颜色
export function getNodeColor(type?: string): string {
  return NODE_TYPE_COLORS[type || 'default'] || NODE_TYPE_COLORS.default;
}
