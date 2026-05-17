import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useGraphStore } from '@/lib/stores/graph-store';
import type { ViewMode } from '@/lib/stores/graph-store';
import { ChevronLeft, RotateCcw, Globe, GitBranch, Loader2, Minus, Plus } from 'lucide-react';

const MODE_OPTIONS: { value: ViewMode; label: string; icon: typeof Globe }[] = [
  { value: 'global', label: '全局总览', icon: Globe },
  { value: 'local', label: '局部增长', icon: GitBranch },
];

export function GraphControls() {
  const { config, updateConfig, goBack, reset, nodeHistory, selectedNodeId, viewMode, setViewMode, isLoading } =
    useGraphStore();

  return (
    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-card">
      {/* 模式切换 */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">视图模式</Label>
        <div className="grid grid-cols-2 gap-1">
          {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={viewMode === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode(value)}
              className="gap-1.5 text-xs"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">关联控制</h3>
        <Button variant="ghost" size="sm" onClick={reset} title="重置">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* 直接关联数量 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">直接关联数量 (m)</Label>
          <span className="text-sm font-medium">{config.maxDirectRelations}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="sm" className="size-7 p-0"
            onClick={() => updateConfig({ maxDirectRelations: Math.max(0, config.maxDirectRelations - 1) })}
            disabled={config.maxDirectRelations <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Slider
            value={[config.maxDirectRelations]}
            onValueChange={([value]) => updateConfig({ maxDirectRelations: value })}
            min={0}
            max={20}
            step={1}
            className="flex-1"
          />
          <Button
            variant="outline" size="sm" className="size-7 p-0"
            onClick={() => updateConfig({ maxDirectRelations: Math.min(20, config.maxDirectRelations + 1) })}
            disabled={config.maxDirectRelations >= 20}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 关联深度 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">关联深度 (n)</Label>
          <span className="text-sm font-medium">{config.maxDepth}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="sm" className="size-7 p-0"
            onClick={() => updateConfig({ maxDepth: Math.max(0, config.maxDepth - 1) })}
            disabled={config.maxDepth <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Slider
            value={[config.maxDepth]}
            onValueChange={([value]) => updateConfig({ maxDepth: value })}
            min={0}
            max={3}
            step={1}
            className="flex-1"
          />
          <Button
            variant="outline" size="sm" className="size-7 p-0"
            onClick={() => updateConfig({ maxDepth: Math.min(3, config.maxDepth + 1) })}
            disabled={config.maxDepth >= 3}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 返回按钮 */}
      <Button
        variant="secondary"
        size="sm"
        onClick={goBack}
        disabled={nodeHistory.length === 0}
        className="w-full"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        返回上一节点
        {nodeHistory.length > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">({nodeHistory.length})</span>
        )}
      </Button>

      {/* 展开中提示 */}
      {isLoading && viewMode === 'local' && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载邻居节点...
        </div>
      )}

      {/* 当前选中提示 */}
      {selectedNodeId && (
        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          当前选中: <span className="font-medium text-foreground">{selectedNodeId}</span>
        </div>
      )}
    </div>
  );
}
