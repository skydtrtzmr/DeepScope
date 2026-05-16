'use client';

import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor, type RelatedNodeDetail } from '@/types/graph';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function NodeDetailList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const { relatedNodes, selectedNodeId, highlightedNodeId, selectNode, highlightNode } =
    useGraphStore();

  const virtualizer = useVirtualizer({
    count: relatedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleItemClick = useCallback(
    (node: RelatedNodeDetail) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const handleItemHover = useCallback(
    (nodeId: string | null) => {
      highlightNode(nodeId);
    },
    [highlightNode]
  );

  if (!selectedNodeId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        点击图谱中的节点查看关联详情
      </div>
    );
  }

  if (relatedNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        当前节点没有关联节点
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">关联节点</h3>
        <span className="text-xs text-muted-foreground">{relatedNodes.length} 个节点</span>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = relatedNodes[virtualRow.index];
            const isHighlighted = highlightedNodeId === node.id;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={cn(
                    'p-3 mx-2 my-1 rounded-lg border cursor-pointer transition-all',
                    'hover:bg-accent hover:border-primary/30',
                    isHighlighted && 'bg-accent border-primary/50'
                  )}
                  onClick={() => handleItemClick(node)}
                  onMouseEnter={() => handleItemHover(node.id)}
                  onMouseLeave={() => handleItemHover(null)}
                >
                  <div className="flex items-start gap-3">
                    {/* 节点颜色指示器 */}
                    <div
                      className="w-3 h-3 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: getNodeColor(node.type) }}
                    />

                    <div className="flex-1 min-w-0">
                      {/* 标题行 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{node.label}</span>
                        {node.type && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {node.type}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          深度 {node.depth}
                        </Badge>
                      </div>

                      {/* 关系标签 */}
                      {node.relationLabel && (
                        <div className="text-xs text-muted-foreground mt-1">
                          关系: {node.relationLabel}
                        </div>
                      )}

                      {/* 描述 */}
                      {node.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {node.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
