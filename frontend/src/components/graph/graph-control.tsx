import { useCallback, useEffect, useRef, useState } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ChevronLeft, RotateCcw, Minus, X, Plus, Loader2, Compass } from 'lucide-react';

/** 滑块拖动时的 debounce 间隔（ms） */
const SLIDER_DEBOUNCE_MS = 200;

function useDebouncedSlider(key: 'directRelations' | 'depth', delay: number) {
  const config = useGraphStore((s) => s.config);
  const updateConfig = useGraphStore((s) => s.updateConfig);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localValue, setLocalValue] = useState(config[key]);

  useEffect(() => {
    setLocalValue(config[key]);
  }, [config[key]]);

  const onSliderChange = useCallback(
    (value: number) => {
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => updateConfig({ [key]: value }), delay);
    },
    [updateConfig, key, delay],
  );

  const updateDirect = useCallback(
    (value: number) => {
      updateConfig({ [key]: value });
      setLocalValue(value);
    },
    [updateConfig, key],
  );

  return { localValue, onSliderChange, updateDirect };
}

export function GraphControl() {


  const {
    fullData, goBack, reset, nodeHistory, selectNode, selectedNodeId,
    updateExploreConfig, exploreConfig, updateBatchLoadConfig, batchLoadConfig, sliderLimits,
    bfsExpandNode, loadMoreNeighbors, getNeighborButtonState, isLoading,
  } = useGraphStore();

  const mSlider = useDebouncedSlider('directRelations', SLIDER_DEBOUNCE_MS);
  const nSlider = useDebouncedSlider('depth', SLIDER_DEBOUNCE_MS);

  if (!selectedNodeId || !fullData) return null;

  const neighborState = getNeighborButtonState(selectedNodeId);

  const node = fullData.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  return (
    <div className="absolute top-4 left-4 z-10 w-64 bg-card border rounded-lg shadow-lg p-4 space-y-3">
      {/* 探索控件 */}
      <div className="mb-3 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">探索设置</h3>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 每层加载数量 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">每层加载数量</Label>
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
              max={sliderLimits.exploreMMax}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-6 p-0"
              onClick={() => updateExploreConfig({ m: Math.min(sliderLimits.exploreMMax, exploreConfig.m + 1) })}
              disabled={exploreConfig.m >= sliderLimits.exploreMMax}
            >
              <Plus className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>

        {/* 探索深度 */}
        <div className="space-y-2">
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
              max={sliderLimits.exploreNMax}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-6 p-0"
              onClick={() => updateExploreConfig({ n: Math.min(sliderLimits.exploreNMax, exploreConfig.n + 1) })}
              disabled={exploreConfig.n >= sliderLimits.exploreNMax}
            >
              <Plus className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>

        {/* 多层展开按钮 */}
        <Button
          size="sm"
          variant="default"
          className="w-full gap-1.5"
          onClick={() => bfsExpandNode(selectedNodeId)}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Compass className="h-3 w-3" />
          )}
          多层展开
        </Button>

        {/* ── 分割线 ── */}
        <div className="border-t pt-3" />

        {/* 分批加载：每批数量滑块 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">每批数量</Label>
            <span className="text-xs font-medium tabular-nums">{batchLoadConfig.pageSize}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="size-6 p-0"
              onClick={() => updateBatchLoadConfig({ pageSize: Math.max(1, batchLoadConfig.pageSize - 1) })}
              disabled={batchLoadConfig.pageSize <= 1}
            >
              <Minus className="h-2.5 w-2.5" />
            </Button>
            <Slider
              value={[batchLoadConfig.pageSize]}
              onValueChange={([value]) => updateBatchLoadConfig({ pageSize: value })}
              min={1}
              max={sliderLimits.batchLoadPageSizeMax}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-6 p-0"
              onClick={() => updateBatchLoadConfig({ pageSize: Math.min(sliderLimits.batchLoadPageSizeMax, batchLoadConfig.pageSize + 1) })}
              disabled={batchLoadConfig.pageSize >= sliderLimits.batchLoadPageSizeMax}
            >
              <Plus className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>

        {/* 分批加载按钮 */}
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1.5"
          onClick={() => loadMoreNeighbors(selectedNodeId)}
          disabled={neighborState.hasTotal && neighborState.loaded >= neighborState.total || isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span className="text-sm">分批加载</span>
          )}
          {neighborState.hasTotal && (
            <span className="opacity-70 text-xs">({neighborState.loaded}/{neighborState.total})</span>
          )}
        </Button>


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
      </div>
      {/* 高亮范围 */}
      <div className="space-y-3 border-t ">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">高亮设置</h3>
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
              max={sliderLimits.highlightDirectRelationsMax}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => mSlider.updateDirect(Math.min(sliderLimits.highlightDirectRelationsMax, mSlider.localValue + 1))}
              disabled={mSlider.localValue >= sliderLimits.highlightDirectRelationsMax}
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
              max={sliderLimits.highlightDepthMax}
              step={1}
              className="flex-1"
            />
            <Button
              variant="outline" size="sm" className="size-7 p-0"
              onClick={() => nSlider.updateDirect(Math.min(sliderLimits.highlightDepthMax, nSlider.localValue + 1))}
              disabled={nSlider.localValue >= sliderLimits.highlightDepthMax}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>


      {/* 展开中提示 */}
      {/* {isLoading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载邻居节点...
        </div>
      )} */}

      {/* 当前选中提示 */}
      {/* {selectedNodeId && (
        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          当前选中: <span className="font-medium text-foreground">{selectedNodeId}</span>
        </div>
      )} */}
    </div>
  );
}
