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

// 图谱配置
export interface GraphConfig {
  maxDirectRelations: number; // 直接关联节点数量 m
  maxDepth: number; // 间接关联层数 n
}

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
