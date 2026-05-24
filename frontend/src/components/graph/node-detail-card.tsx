
import { Badge } from '@/components/ui/badge';
import Markdown from 'react-markdown';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';

export function NodeDetail() {
  const {
    fullData, selectedNodeId
  } = useGraphStore();

  if (!selectedNodeId || !fullData) return null;

  const node = fullData.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

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
            style={{ backgroundColor: (node.style?.fill as string) || getNodeColor(node.category) }}
          />
          <h3 className="font-semibold text-m">{node.label}</h3>
        </div>
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
      </div>
    </div>
  );
}
