// 聚合节点选中卡片：分组信息、指标列表（null→"—"）、「已加载 x/y」+「加载更多」+「收起成员」
// x = 服务端记录数进度（loaded），非 G6 实际新增节点数（去重后可能更少）
import { useAggregateStore } from '@/lib/stores/aggregate-store';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, AlertCircle, Box } from 'lucide-react';

export function AggregateMemberCard() {
  const {
    selectedBucketId, groups, metricDefs, metricStatus, metricError,
    bucketStates, loadMoreMembers, collapseBucket, maxAggregateLayerNodes,
    getVisibleLayerNodeCount,
  } = useAggregateStore();

  if (!selectedBucketId) return null;
  const group = groups.find((g) => g.id === selectedBucketId);
  if (!group) return null;

  const st = bucketStates.get(selectedBucketId);
  const visibleCount = getVisibleLayerNodeCount();
  const atLimit = maxAggregateLayerNodes > 0 && visibleCount >= maxAggregateLayerNodes;

  return (
    <div className="flex flex-col p-2 bg-card">
      {/* 标题 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-3 h-3 rounded border-2 border-dashed border-indigo-500 bg-indigo-50 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-m truncate">{group.label}</h3>
            <span className="text-[10px] text-muted-foreground font-mono break-all">{group.key}</span>
          </div>
        </div>
        <Badge variant="secondary" className="text-[10px] shrink-0 bg-indigo-50 text-indigo-600 border border-indigo-100">
          <Box className="size-2.5 mr-0.5" />
          聚合节点
        </Badge>
      </div>

      {/* 记录数 */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">记录数:</span>
        <span className="text-sm font-semibold">{group.count}</span>
        <span className="text-[10px] text-muted-foreground">条</span>
      </div>

      {/* 指标列表 */}
      {metricDefs.length > 0 && (
        <div className="mt-2 pt-2 border-t space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">指标</span>
            {metricStatus === 'running' && (
              <span className="flex items-center gap-1 text-[10px] text-indigo-500">
                <Spinner className="size-2.5" /> 计算中...
              </span>
            )}
            {metricStatus === 'failed' && (
              <span className="flex items-center gap-1 text-[10px] text-destructive">
                <AlertCircle className="size-2.5" /> 计算失败
              </span>
            )}
            {metricStatus === 'complete' && (
              <span className="text-[10px] text-emerald-600">已就绪</span>
            )}
          </div>
          {metricDefs.map((m) => {
            const v = group.metrics?.[m.id];
            return (
              <div key={m.id} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{m.name}</span>
                <span className="text-xs font-mono font-medium">
                  {metricStatus === 'running'
                    ? <span className="text-muted-foreground/60">⋯</span>
                    : metricStatus === 'failed'
                      ? <span className="text-destructive">—</span>
                      : v == null ? <span className="text-muted-foreground/60">—</span> : v}
                  {m.unit && v != null && <span className="text-muted-foreground ml-0.5">{m.unit}</span>}
                </span>
              </div>
            );
          })}
          {metricStatus === 'failed' && metricError && (
            <p className="text-[10px] text-destructive leading-relaxed pt-1 border-t border-dashed">
              {metricError}
            </p>
          )}
        </div>
      )}

      {/* 成员分页区 */}
      <div className="mt-3 pt-2 border-t space-y-2">
        {st?.expanded ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">已加载成员</span>
              <span>
                <span className="font-semibold">{st.loaded}</span>
                <span className="text-muted-foreground"> / {st.total}</span>
              </span>
            </div>
            {/* 进度条 */}
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${st.total > 0 ? Math.min(100, (st.loaded / st.total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex gap-2">
              {st.hasMore && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs"
                  disabled={st.loading || atLimit}
                  onClick={() => loadMoreMembers(selectedBucketId)}
                >
                  {st.loading ? <Spinner className="size-3 mr-1" /> : <ChevronDown className="size-3 mr-1" />}
                  {atLimit ? `已达可视上限 ${maxAggregateLayerNodes}` : '加载更多'}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-7 text-xs"
                onClick={() => collapseBucket(selectedBucketId)}
              >
                <ChevronUp className="size-3 mr-1" />
                收起成员
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            双击该聚合节点可展开成员；再次双击收起。
          </p>
        )}
      </div>
    </div>
  );
}
