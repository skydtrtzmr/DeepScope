
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Markdown from 'react-markdown';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor, buildCategoryColorMap, isPaletteColor } from '@/lib/graph-color';

export function NodeDetail() {
  const [showDebug, setShowDebug] = useState(false);
  const {
    fullData, selectedNodeId
  } = useGraphStore();

  if (!selectedNodeId || !fullData) return null;

  const node = fullData.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  // 从全量数据构建无碰撞 category 颜色映射
  const categoryColorMap = buildCategoryColorMap(
    fullData.nodes.map((n) => n.category)
  );
  // 计算实际渲染颜色
  const explicitFill = node.style?.fill as string | undefined;
  const categoryColor = node.category
    ? (categoryColorMap.get(node.category) || getNodeColor(node.category))
    : '#94a3b8';
  const renderedColor = explicitFill || categoryColor;
  let colorSource: string;
  if (explicitFill) {
    colorSource = 'style.fill';
  } else if (!node.category) {
    colorSource = '默认灰色';
  } else {
    colorSource = isPaletteColor(categoryColor) ? '调色板' : 'FNV-1a 哈希';
  }

  // 统计直接关联节点数
  const directNeighborCount = fullData.edges.filter(
    (e) => e.source === selectedNodeId || e.target === selectedNodeId
  ).length;

  return (
    <div className="flex flex-col p-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: renderedColor }}
          />
          <h3 className="font-semibold text-m">{node.label}</h3>
        </div>
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0"
          title="显示调试信息"
        >
          调试
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {node.category && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">类别:</span>
            <Badge variant="secondary" className="text-xs">
              {node.category}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">ID:</span>
          <span className="text-xs font-mono">{node.id}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">关联数:</span>
          <span className="text-xs">{directNeighborCount}</span>
        </div>

        {node.description && (
          <div className="pt-2 border-t">
            <span className="text-xs text-muted-foreground">描述:</span>
            <div className="text-xs mt-1 leading-relaxed max-h-60 overflow-y-auto [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:ml-3 [&_li]:mt-0.5">
              <Markdown>{node.description}</Markdown>
            </div>
          </div>
        )}

        {/* 调试信息面板 */}
        {showDebug && (
          <div className="pt-2 border-t space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">调试信息</span>

            {/* 实际渲染颜色 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">渲染颜色:</span>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-full border border-border"
                  style={{ backgroundColor: renderedColor }}
                />
                <span className="text-xs font-mono">{renderedColor}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">颜色来源:</span>
              <span className="text-xs">{colorSource}</span>
            </div>

            {/* 原始属性 */}
            <DebugRow label="label" value={node.label} />
            <DebugRow label="category" value={node.category} />
            <DebugRow label="type" value={node.type} />
            <DebugRow label="url" value={node.url} />
            <DebugRow label="style" value={JSON.stringify(node.style)} />
            <DebugRow label="data" value={JSON.stringify(node.data)} />
            {node.description && (
              <DebugRow label="description" value={node.description.length > 80 ? node.description.slice(0, 80) + '...' : node.description} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 调试信息单行：键值对 */
function DebugRow({ label, value }: { label: string; value?: unknown }) {
  const display = value === undefined || value === null
    ? <span className="text-muted-foreground/50 italic">undefined</span>
    : <span className="font-mono">{String(value)}</span>;
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{label}:</span>
      <span className="text-[10px] break-all">{display}</span>
    </div>
  );
}
