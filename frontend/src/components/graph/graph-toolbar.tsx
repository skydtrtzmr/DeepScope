import { Button } from '@/components/ui/button';
import { useGraphStore } from '@/lib/stores/graph-store';
import { Download, Upload} from 'lucide-react';
import { DocHelpButton } from './doc-viewer';

interface GraphToolbarProps {
  onImportData?: () => void;
  onExportData?: () => void;
}

export function GraphToolbar({ onImportData, onExportData }: GraphToolbarProps) {
  const { fullData, domains, currentDomain, setCurrentDomain } = useGraphStore();

  const nodeCount = fullData?.nodes.length ?? 0;
  const edgeCount = fullData?.edges.length ?? 0;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-card gap-2">
      <div className="flex items-center gap-4 min-w-0">
        <h2 className="font-semibold text-sm shrink-0">知识图谱</h2>

        {/* 域选择器 */}
        {domains.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">业务域</span>
            <select
              value={currentDomain}
              onChange={(e) => setCurrentDomain(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-background text-foreground max-w-40 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {domains.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.nodeCount})
                </option>
              ))}
            </select>
          </div>
        )}

        {fullData && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <span>{nodeCount} 节点</span>
            <span>/</span>
            <span>{edgeCount} 边</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DocHelpButton />

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
