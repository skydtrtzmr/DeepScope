import { useCallback, useEffect, useRef, useState } from 'react';
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

/** 滑块拖动时的 debounce 间隔（ms） */
const SLIDER_DEBOUNCE_MS = 200;

/**
 * 创建一个 debounce 版本的 updateConfig，用于滑块拖动。
 * 同时维护本地即时值，拖动时视觉立即响应，debounce 后同步到 store。
 */
function useDebouncedSlider(key: 'maxDirectRelations' | 'maxDepth', delay: number) {
  const config = useGraphStore((s) => s.config);
  const updateConfig = useGraphStore((s) => s.updateConfig);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 本地即时值，初始化为 store 值
  const [localValue, setLocalValue] = useState(config[key]);

  // 当 store 值变化时（例如 +/- 按钮或外部修改），同步本地值
  useEffect(() => {
    setLocalValue(config[key]);
  }, [config[key]]);

  // 滑块拖动：立即更新本地值，debounce 更新 store
  const onSliderChange = useCallback(
    (value: number) => {
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => updateConfig({ [key]: value }), delay);
    },
    [updateConfig, key, delay],
  );

  // +/- 按钮或外部直接更新：同时更新 store 和本地值
  const updateDirect = useCallback(
    (value: number) => {
      updateConfig({ [key]: value });
      setLocalValue(value);
    },
    [updateConfig, key],
  );

  return { localValue, onSliderChange, updateDirect };
}

export function GraphControls() {
  const {
    goBack, reset, nodeHistory, selectedNodeId, viewMode, setViewMode, isLoading,
  } = useGraphStore();

  // 滑块拖动用 debounce 版本（本地即时值保证视觉响应）；+/- 按钮直接更新 store
  const mSlider = useDebouncedSlider('maxDirectRelations', SLIDER_DEBOUNCE_MS);
  const nSlider = useDebouncedSlider('maxDepth', SLIDER_DEBOUNCE_MS);

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

      {/* 高亮范围 */}
      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">高亮范围</h3>
          <Button variant="ghost" size="sm" onClick={reset} title="重置">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* 高亮：每层展开邻居上限 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">每层邻居上限</Label>
            <span className="text-sm font-medium">{mSlider.localValue}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => mSlider.updateDirect(Math.max(0, mSlider.localValue - 1))}
              disabled={mSlider.localValue <= 0}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Slider
              value={[mSlider.localValue]}
              onValueChange={([value]) => mSlider.onSliderChange(value)}
              min={0}
              max={20}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => mSlider.updateDirect(Math.min(20, mSlider.localValue + 1))}
              disabled={mSlider.localValue >= 20}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* 高亮：关联深度 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">高亮深度</Label>
            <span className="text-sm font-medium">{nSlider.localValue}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => nSlider.updateDirect(Math.max(0, nSlider.localValue - 1))}
              disabled={nSlider.localValue <= 0}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Slider
              value={[nSlider.localValue]}
              onValueChange={([value]) => nSlider.onSliderChange(value)}
              min={0}
              max={3}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => nSlider.updateDirect(Math.min(3, nSlider.localValue + 1))}
              disabled={nSlider.localValue >= 3}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
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
