'use client';

import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useGraphStore } from '@/lib/stores/graph-store';
import { ChevronLeft, Maximize2, Layers, RotateCcw } from 'lucide-react';

export function GraphControls() {
  const { config, updateConfig, expandMore, expandDeeper, goBack, reset, nodeHistory, selectedNodeId } =
    useGraphStore();

  return (
    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-card">
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
        <div className="flex items-center gap-2">
          <Slider
            value={[config.maxDirectRelations]}
            onValueChange={([value]) => updateConfig({ maxDirectRelations: value })}
            min={1}
            max={50}
            step={1}
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={expandMore} title="增加 5 个">
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* 关联深度 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">关联深度 (n)</Label>
          <span className="text-sm font-medium">{config.maxDepth}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider
            value={[config.maxDepth]}
            onValueChange={([value]) => updateConfig({ maxDepth: value })}
            min={1}
            max={10}
            step={1}
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={expandDeeper} title="增加 1 层">
            <Layers className="h-3 w-3" />
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

      {/* 当前选中提示 */}
      {selectedNodeId && (
        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          当前选中: <span className="font-medium text-foreground">{selectedNodeId}</span>
        </div>
      )}
    </div>
  );
}
