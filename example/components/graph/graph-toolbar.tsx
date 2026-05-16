'use client';

import { Button } from '@/components/ui/button';
import { useGraphStore } from '@/lib/stores/graph-store';
import { Download, Upload, ZoomIn, ZoomOut, Home } from 'lucide-react';

interface GraphToolbarProps {
  onImportData?: () => void;
  onExportData?: () => void;
}

export function GraphToolbar({ onImportData, onExportData }: GraphToolbarProps) {
  const { fullData, selectedNodeId, reset } = useGraphStore();

  const nodeCount = fullData?.nodes.length ?? 0;
  const edgeCount = fullData?.edges.length ?? 0;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-4">
        <h2 className="font-semibold">知识图谱</h2>
        {fullData && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{nodeCount} 节点</span>
            <span>/</span>
            <span>{edgeCount} 边</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {selectedNodeId && (
          <Button variant="ghost" size="sm" onClick={reset} title="显示全部">
            <Home className="h-4 w-4 mr-1" />
            全图
          </Button>
        )}

        {onImportData && (
          <Button variant="ghost" size="sm" onClick={onImportData} title="导入数据">
            <Upload className="h-4 w-4" />
          </Button>
        )}

        {onExportData && fullData && (
          <Button variant="ghost" size="sm" onClick={onExportData} title="导出数据">
            <Download className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
