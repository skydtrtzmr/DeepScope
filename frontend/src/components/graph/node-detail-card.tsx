import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Compass } from 'lucide-react';

export function NodeDetailCard() {
  const { fullData, selectedNodeId, selectNode, viewMode, expandNode, isLoading } = useGraphStore();

  if (!selectedNodeId || !fullData) return null;

  const node = fullData.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  // 统计直接关联节点数
  const directNeighborCount = fullData.edges.filter(
    (e) => e.source === selectedNodeId || e.target === selectedNodeId
  ).length;

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

      {/* 探索此节点按钮（仅 local 模式） */}
      {viewMode === 'local' && (
        <div className="mt-3 pt-3 border-t">
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={() => expandNode(selectedNodeId)}
            disabled={isLoading}
          >
            <Compass className="h-3.5 w-3.5" />
            {isLoading ? '加载中...' : '探索此节点'}
          </Button>
        </div>
      )}
    </div>
  );
}
