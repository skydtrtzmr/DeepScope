import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { X, Compass, Minus, Plus, Loader2 } from 'lucide-react';

export function NodeDetailCard() {
  const {
    fullData, selectedNodeId, selectNode, viewMode,
    expandNode, getExploreButtonState, isLoading,
    exploreConfig, updateExploreConfig,
  } = useGraphStore();

  if (!selectedNodeId || !fullData) return null;

  const node = fullData.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  // 统计直接关联节点数
  const directNeighborCount = fullData.edges.filter(
    (e) => e.source === selectedNodeId || e.target === selectedNodeId
  ).length;

  // 探索按钮状态（仅 local 模式）
  const buttonState = viewMode === 'local' ? getExploreButtonState(selectedNodeId) : null;

  return (
    <div className="absolute top-4 left-4 z-10 w-64 bg-card border rounded-lg shadow-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: getNodeColor(node.type) }}
          />
          <h3 className="font-semibold text-sm">{node.label}</h3>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {node.type && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">类型:</span>
            <Badge variant="secondary" className="text-xs">
              {node.type}
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
            <p className="text-xs mt-1 leading-relaxed">{node.description}</p>
          </div>
        )}

        {node.url && (
          <a
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline block pt-1"
          >
            查看详情 →
          </a>
        )}
      </div>

      {/* 探索控件（仅 local 模式） */}
      {buttonState && (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* 每次加载数量 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">每次加载数量</Label>
              <span className="text-xs font-medium tabular-nums">{exploreConfig.m}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="size-6 p-0"
                onClick={() => updateExploreConfig({ m: Math.max(1, exploreConfig.m - 1) })}
                disabled={exploreConfig.m <= 1}
              >
                <Minus className="h-2.5 w-2.5" />
              </Button>
              <Slider
                value={[exploreConfig.m]}
                onValueChange={([value]) => updateExploreConfig({ m: value })}
                min={1}
                max={20}
                step={1}
                className="flex-1"
              />
              <Button
                variant="outline" size="sm" className="size-6 p-0"
                onClick={() => updateExploreConfig({ m: Math.min(20, exploreConfig.m + 1) })}
                disabled={exploreConfig.m >= 20}
              >
                <Plus className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>

          {/* 探索深度 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">探索深度</Label>
              <span className="text-xs font-medium tabular-nums">{exploreConfig.n}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="size-6 p-0"
                onClick={() => updateExploreConfig({ n: Math.max(1, exploreConfig.n - 1) })}
                disabled={exploreConfig.n <= 1}
              >
                <Minus className="h-2.5 w-2.5" />
              </Button>
              <Slider
                value={[exploreConfig.n]}
                onValueChange={([value]) => updateExploreConfig({ n: value })}
                min={1}
                max={5}
                step={1}
                className="flex-1"
              />
              <Button
                variant="outline" size="sm" className="size-6 p-0"
                onClick={() => updateExploreConfig({ n: Math.min(5, exploreConfig.n + 1) })}
                disabled={exploreConfig.n >= 5}
              >
                <Plus className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>

          {/* 探索按钮 */}
          <Button
            size="sm"
            variant={buttonState.type === 'done' ? 'outline' : 'default'}
            className="w-full gap-1.5 text-xs"
            onClick={() => expandNode(selectedNodeId)}
            disabled={buttonState.type === 'done' || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Compass className="h-3 w-3" />
            )}
            {buttonState.label}
            {buttonState.type === 'more' && (
              <span className="opacity-70">({buttonState.loaded}/{buttonState.total})</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
