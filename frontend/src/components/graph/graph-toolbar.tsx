import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useGraphStore } from '@/lib/stores/graph-store';
import { Download, Upload, Settings } from 'lucide-react';
import { DocHelpButton } from './doc-viewer';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

interface GraphToolbarProps {
  onImportData?: () => void;
  onExportData?: () => void;
}

export function GraphToolbar({ onImportData, onExportData }: GraphToolbarProps) {
  const { fullData, domains, currentDomain, setCurrentDomain, displaySettings, updateDisplaySettings } = useGraphStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭设置面板
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

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

        <div className="relative" ref={settingsRef}>
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(!settingsOpen)} title="显示设置">
            <Settings className="h-4 w-4" />
          </Button>

          {settingsOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-card shadow-lg z-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">显示设置</p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground/80">节点</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs">跟踪选中节点</span>
                  <ToggleSwitch
                    checked={displaySettings.trackSelectedNode}
                    onCheckedChange={(checked) => updateDisplaySettings({ trackSelectedNode: checked })}
                    id="toggle-track-selected"
                    label="选中节点时自动聚焦到该节点"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground/80">边</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs">显示箭头</span>
                  <ToggleSwitch
                    checked={displaySettings.showEdgeArrows}
                    onCheckedChange={(checked) => updateDisplaySettings({ showEdgeArrows: checked })}
                    id="toggle-edge-arrows"
                    label="显示边箭头"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">显示标签</span>
                  <ToggleSwitch
                    checked={displaySettings.showEdgeLabels}
                    onCheckedChange={(checked) => updateDisplaySettings({ showEdgeLabels: checked })}
                    id="toggle-edge-labels"
                    label="显示边标签"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

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
