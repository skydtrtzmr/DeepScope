/* ========== Category 颜色分配 ========== */

// 20 种视觉可区分的颜色（色相均匀分布在色环上）
const COLOR_PALETTE = [
  '#e74c3c', '#27ae60', '#3498db', '#f39c12', '#9b59b6',
  '#1abc9c', '#d35400', '#2ecc71', '#2980b9', '#f1c40f',
  '#8e44ad', '#16a085', '#e91e63', '#00bcd4', '#ff5722',
  '#3f51b5', '#4caf50', '#ff9800', '#795548', '#607d8b',
];
const PALETTE_SIZE = COLOR_PALETTE.length;

/** Category 颜色分配配置 */
export interface CategoryColorConfig {
  usePalette: boolean;       // 是否使用预设调色板（false = 始终使用 hash）
  paletteThreshold: number;  // 超过此数量的唯一 category 时退化到 hash（上限 = palette 大小 20）
}

let _config: CategoryColorConfig = { usePalette: true, paletteThreshold: PALETTE_SIZE };

/** 从外部设置颜色分配配置（如 app-config.json） */
export function setCategoryColorConfig(config: Partial<CategoryColorConfig>) {
  _config = { ..._config, ...config };
  // 阈值不可超过 palette 实际大小、不可小于 1
  if (_config.paletteThreshold < 1) _config.paletteThreshold = 1;
  if (_config.paletteThreshold > PALETTE_SIZE) _config.paletteThreshold = PALETTE_SIZE;
}

/** 获取当前颜色分配配置（调试用） */
export function getCategoryColorConfig(): CategoryColorConfig {
  return { ..._config };
}

/** 判断一个颜色字符串是否来自预设调色板 */
export function isPaletteColor(color: string): boolean {
  return COLOR_PALETTE.includes(color);
}

/**
 * 从一组 category 构建颜色映射表。
 * - usePalette=true 且唯一 category 数 ≤ paletteThreshold 时：每个 category 获得唯一 palette 颜色
 * - 否则退化为 FNV-1a 哈希映射（允许碰撞）
 */
export function buildCategoryColorMap(
  categories: (string | undefined)[]
): Map<string, string> {
  const unique = [...new Set(categories.filter(Boolean) as string[])];
  const map = new Map<string, string>();

  if (_config.usePalette && unique.length <= _config.paletteThreshold) {
    // 唯一分配：排序后依次取 palette 颜色
    unique.sort().forEach((cat, i) => map.set(cat, COLOR_PALETTE[i]));
  } else {
    // 超过阈值或禁用调色板 → 哈希取模（部分碰撞不可避免）
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
  return _hslToHex(hue, sat, light);
}

/** HSL → 十六进制颜色，与调色板格式统一 */
function _hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  const r = f(0), g = f(8), b = f(4);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}


/**
 * 获取单个 category 的颜色（哈希 fallback 版本）。
 * 建议优先使用 buildCategoryColorMap 构建的映射表以保证颜色不重复。
 */
export function getNodeColor(category?: string): string {
  if (!category) return '#94a3b8';
  return _hashColor(category);
}
