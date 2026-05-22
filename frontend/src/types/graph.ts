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
  category?: string;
  url?: string;
  type?: string;
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
  category?: string;
  description?: string;
  style?: NodeStyle;
  relationLabel?: string; // 与当前节点的关系标签
  depth: number; // 关联深度 (1 = 直接关联)
  data?: Record<string, unknown>;
}

// Domain 信息
export interface DomainItem {
  name: string;
  nodeCount: number;
  edgeCount: number;
}

// 节点类别颜色映射（中文 key，与后端 category 对齐）
export const NODE_TYPE_COLORS: Record<string, string> = {
  '默认': '#94a3b8',
  '组织': '#6366f1',
  '人员': '#f59e0b',
  '项目': '#10b981',
  '任务': '#ef4444',
  '问答': '#8b5cf6',
};

// 获取节点颜色
export function getNodeColor(category?: string): string {
  return NODE_TYPE_COLORS[category || '默认'] || NODE_TYPE_COLORS['默认'];
}
