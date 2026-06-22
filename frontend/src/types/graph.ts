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

// 显示配置（控制 G6 渲染样式，不改变数据和可见范围）
export interface DisplaySettings {
  showEdgeArrows: boolean;    // 是否显示边箭头
  showEdgeLabels: boolean;    // 是否显示边标签
  trackSelectedNode: boolean; // 是否自动跟踪聚焦选中节点
  expandTrigger: 'dblclick' | 'rightclick' | 'both' | 'none'; // 节点展开触发方式
  showCategoryLabel: boolean; // 是否在节点标签前显示类别
}

// 图谱配置（高亮范围：控制 BFS 从已加载数据中筛选可见节点）
export interface GraphConfig {
  directRelations: number; // 每节点每层展开邻居上限 m
  depth: number; // BFS 深度 n
}

// 滑块上限配置
export interface SliderLimits {
  exploreMMax: number;             // 多层展开：每层分支上限
  exploreNMax: number;             // 多层展开：深度上限
  batchLoadPageSizeMax: number;    // 分批加载：每批数量上限
  highlightDirectRelationsMax: number; // 高亮：每层邻居上限滑块 max
  highlightDepthMax: number;       // 高亮：深度上限滑块 max
}

// 多层展开配置（控制 BFS API 参数）
export interface ExploreConfig {
  m: number; // 每节点每层展开邻居上限
  n: number; // 探索深度
}

// 分批加载配置（控制 neighbors API 参数）
export interface BatchLoadConfig {
  pageSize: number; // 每批直接邻居数量
}

// 加载更多邻居按钮状态
export interface NeighborButtonState {
  loaded: number;
  total: number;
  hasTotal: boolean;  // total 是否已知（即已展开过至少一次）
}

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


