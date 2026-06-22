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

/* ========== Category 颜色分配 ========== */

// 20 种视觉可区分的颜色（色相均匀分布在色环上）
const COLOR_PALETTE = [
  '#e74c3c', '#27ae60', '#3498db', '#f39c12', '#9b59b6',
  '#1abc9c', '#d35400', '#2ecc71', '#2980b9', '#f1c40f',
  '#8e44ad', '#16a085', '#e91e63', '#00bcd4', '#ff5722',
  '#3f51b5', '#4caf50', '#ff9800', '#795548', '#607d8b',
];
const PALETTE_SIZE = COLOR_PALETTE.length;

/**
 * 从一组 category 构建无碰撞的颜色映射表。
 * - 当唯一 category 数量 ≤ palette 大小时，每个 category 获得唯一颜色（按字母序依次分配）
 * - 超过时退化为 FNV-1a 哈希映射（允许碰撞）
 */
export function buildCategoryColorMap(
  categories: (string | undefined)[]
): Map<string, string> {
  const unique = [...new Set(categories.filter(Boolean) as string[])];
  const map = new Map<string, string>();

  if (unique.length <= PALETTE_SIZE) {
    // 唯一分配：排序后依次取 palette 颜色
    unique.sort().forEach((cat, i) => map.set(cat, COLOR_PALETTE[i]));
  } else {
    // 超过 palette 容量 → 哈希取模（部分碰撞不可避免）
    unique.forEach((cat) => map.set(cat, _hashColor(cat)));
  }
  return map;
}

/** FNV-1a 哈希 → 三位 HSL 颜色（备用/劣化方案） */
function _hashColor(category: string): string {
  let hash = 2166136261;
  for (let i = 0; i < category.length; i++) {
    hash ^= category.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash = hash >>> 0;
  const hue = hash % 360;
  const sat = 55 + ((hash >>> 8) % 25);
  const light = 48 + ((hash >>> 16) % 22);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/**
 * 获取单个 category 的颜色（哈希 fallback 版本）。
 * 建议优先使用 buildCategoryColorMap 构建的映射表以保证颜色不重复。
 */
export function getNodeColor(category?: string): string {
  if (!category) return '#94a3b8';
  return _hashColor(category);
}
