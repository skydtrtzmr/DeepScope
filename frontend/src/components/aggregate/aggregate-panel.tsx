// 聚合配置面板：模式（选中主体/全局）、主体与分组字段（views 驱动）、根实例搜索、
// 日期范围、指标多选（≤8）、「查询聚合」/「清除聚合层」
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { useAggregateStore, type AggregateMode } from '@/lib/stores/aggregate-store';
import { fetchAggregationViews, fetchInstances } from '@/lib/api/aggregate';
import type { AggregateQuery, AggregateView } from '@/types/aggregate';
import type { GraphNode } from '@/types/graph';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Layers, X, Search, Globe, Focus } from 'lucide-react';
import { toast } from 'sonner';

interface AggregatePanelProps {
  /** 默认业务域（app-config 可配；mock 阶段用 domain1） */
  defaultDomain?: string;
}

const INPUT_CLS = 'w-full h-8 px-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring';

export function AggregatePanel({ defaultDomain = 'domain1' }: AggregatePanelProps) {
  const {
    isQuerying, context, scope, groups, metricStatus, runAggregate, clearLayer, setPanelOpen,
    memberPageSize, setMemberPageSize,
  } = useAggregateStore();
  const selectedRealNodeId = useGraphStore((s) => s.selectedNodeId);
  const fullData = useGraphStore((s) => s.fullData);

  const [views, setViews] = useState<AggregateView[]>([]);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [source, setSource] = useState('');
  const [groupField, setGroupField] = useState('');
  const [mode, setMode] = useState<AggregateMode>('scoped');
  const [rootKey, setRootKey] = useState('');
  const [rootLabel, setRootLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [metricIds, setMetricIds] = useState<string[]>([]);

  // 当前选中真实节点 → 自动识别为根实例（局部模式）
  const selectedNode = useMemo(() => {
    if (!fullData || !selectedRealNodeId) return null;
    return fullData.nodes.find((n) => n.id === selectedRealNodeId) ?? null;
  }, [fullData, selectedRealNodeId]);

  // 加载 views 配置
  useEffect(() => {
    let alive = true;
    fetchAggregationViews(defaultDomain)
      .then((v) => {
        if (!alive) return;
        setViews(v.views);
        if (v.views.length > 0) {
          setSource(v.views[0].id);
          setGroupField(v.views[0].groups[0]?.field ?? '');
        }
      })
      .catch((err) => {
        console.error('[aggregate-panel] views 加载失败:', err);
        toast.error('聚合配置（views）加载失败');
      })
      .finally(() => alive && setViewsLoading(false));
    return () => { alive = false; };
  }, [defaultDomain]);

  const currentView = views.find((v) => v.id === source);

  // 切换主体时重置分组字段与指标
  useEffect(() => {
    if (!currentView) return;
    setGroupField(currentView.groups[0]?.field ?? '');
    setMetricIds([]);
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中真实节点变化：若与当前视图的根主体 subject 匹配，自动填入
  useEffect(() => {
    if (!selectedNode || !currentView?.roots.length) return;
    const subject = currentView.roots[0].subject;
    if (selectedNode.id.startsWith(`${subject}::`)) {
      const key = (selectedNode.data as { key?: string } | undefined)?.key
        ?? selectedNode.id.split('::')[1];
      if (key) {
        setRootKey(key);
        setRootLabel(selectedNode.label);
        setMode('scoped');
      }
    }
  }, [selectedNode, currentView]);

  const handleQuery = useCallback(async () => {
    if (!source || !groupField) {
      toast.warning('请先选择主体与分组字段');
      return;
    }
    if (mode === 'scoped' && !rootKey) {
      toast.warning('局部模式需要先选择根主体实例（画布选中节点或在下方搜索）');
      return;
    }
    let root: AggregateQuery['root'] = null;
    if (mode === 'scoped' && currentView?.roots.length) {
      root = { relation: currentView.roots[0].field, key: rootKey };
    }
    await runAggregate({
      domain: defaultDomain,
      source,
      root,
      group: groupField,
      start: start || undefined,
      end: end || undefined,
      metrics: metricIds,
    });
  }, [source, groupField, mode, rootKey, currentView, start, end, metricIds, defaultDomain, runAggregate]);

  const toggleMetric = (id: string) => {
    setMetricIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 8) {
        toast.warning('指标最多选择 8 个');
        return prev;
      }
      return [...prev, id];
    });
  };

  if (viewsLoading) {
    return (
      <div className="p-3 border-b flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-4" />
        正在加载聚合配置...
      </div>
    );
  }

  if (views.length === 0) {
    return (
      <div className="p-3 border-b text-xs text-muted-foreground">
        聚合配置（views）为空，请检查后端 /aggregation/views 接口
      </div>
    );
  }

  return (
    <div className="border-b bg-card">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5">
          <Layers className="size-3.5 text-indigo-500" />
          <span className="text-xs font-semibold">聚合分析</span>
          {scope && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
              {context?.root ? '主体范围' : '全局'} · {groups.length} 组
            </span>
          )}
        </div>
        <button
          onClick={() => setPanelOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          title="收起面板"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* 模式切换 */}
        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-muted text-xs">
          <button
            onClick={() => setMode('scoped')}
            className={`flex items-center justify-center gap-1 h-7 rounded transition-colors cursor-pointer ${
              mode === 'scoped' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Focus className="size-3" />
            指定主体
          </button>
          <button
            onClick={() => setMode('global')}
            className={`flex items-center justify-center gap-1 h-7 rounded transition-colors cursor-pointer ${
              mode === 'global' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Globe className="size-3" />
            全局
          </button>
        </div>

        {/* 主体 */}
        <div>
          <label className="text-[11px] text-muted-foreground">被分组主体</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className={`${INPUT_CLS} mt-1 cursor-pointer`}
          >
            {views.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* 根实例（局部模式） */}
        {mode === 'scoped' && currentView?.roots.length ? (
          <div>
            <label className="text-[11px] text-muted-foreground">
              根主体（{currentView.roots[0].name}）
            </label>
            <div className="mt-1 space-y-1.5">
              <InstancePicker
                domain={defaultDomain}
                subject={currentView.roots[0].subject}
                selectedKey={rootKey}
                selectedLabel={rootLabel}
                onSelect={(key, label) => { setRootKey(key); setRootLabel(label); }}
              />
              {selectedNode && !rootKey && (
                <p className="text-[10px] text-muted-foreground">
                  提示：在画布选中一个{currentView.roots[0].name}节点可自动填入
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* 分组字段 */}
        <div>
          <label className="text-[11px] text-muted-foreground">分组字段</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {currentView?.groups.map((g) => (
              <button
                key={g.field}
                onClick={() => {
                  setGroupField(g.field);
                  // 已有查询结果时切换分组 = 重新查询
                  if (scope) {
                    const { context: ctx } = useAggregateStore.getState();
                    if (ctx) runAggregate({ ...ctx, group: g.field });
                  }
                }}
                className={`px-2 h-6 rounded-full border text-[11px] transition-colors cursor-pointer ${
                  groupField === g.field
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-background text-muted-foreground hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>

        {/* 日期范围 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-muted-foreground">开始日期</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={`${INPUT_CLS} mt-1`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">结束日期</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={`${INPUT_CLS} mt-1`} />
          </div>
        </div>

        {/* 指标多选 */}
        {currentView?.metrics.length ? (
          <div>
            <label className="text-[11px] text-muted-foreground">
              指标（可选，≤8）{metricStatus === 'running' && <span className="text-indigo-500 ml-1">计算中...</span>}
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {currentView.metrics.map((m) => (
                <button
                  key={m.id}
                  onClick={() => toggleMetric(m.id)}
                  className={`px-2 h-6 rounded-full border text-[11px] transition-colors cursor-pointer ${
                    metricIds.includes(m.id)
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-background text-muted-foreground hover:border-emerald-300 hover:text-emerald-600'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleQuery} disabled={isQuerying}>
            {isQuerying ? <Spinner className="size-3 mr-1" /> : null}
            查询聚合
          </Button>
          {scope && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearLayer}>
              清除聚合层
            </Button>
          )}
        </div>

        {/* 状态摘要 */}
        {scope && groups.length > 0 && (
          <div className="text-[10px] text-muted-foreground leading-relaxed pt-1 border-t">
            <div>scope: <span className="font-mono">{scope}</span></div>
            <div>共 {groups.reduce((s, g) => s + g.count, 0)} 条记录 · {groups.length} 个分组
              {metricStatus === 'running' && ' · 指标计算中'}
              {metricStatus === 'complete' && ' · 指标已就绪'}
              {metricStatus === 'failed' && ' · 指标失败'}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground/70">调试（分页大小）</summary>
              <div className="mt-1 flex items-center gap-2">
                <span>每页成员数:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={memberPageSize}
                  onChange={(e) => setMemberPageSize(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
                  className="w-16 h-6 px-1.5 text-[11px] rounded border border-input bg-background"
                />
                <span className="text-muted-foreground/60">（设为 3 可验证 3/3/2 分页）</span>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

/** 根实例搜索选择器：防抖搜索 instances 接口，取 node.data.key */
function InstancePicker({
  domain, subject, selectedKey, selectedLabel, onSelect,
}: {
  domain: string;
  subject: string;
  selectedKey: string;
  selectedLabel: string;
  onSelect: (key: string, label: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GraphNode[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // 防抖搜索
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      fetchInstances({ domain, subject, search })
        .then((r) => setResults(r.nodes))
        .catch((err) => console.error('[aggregate-panel] instances 搜索失败:', err))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search, open, domain, subject]);

  return (
    <div className="relative">
      <div className="flex gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
          <input
            value={open ? search : (selectedKey ? `${selectedLabel} (${selectedKey})` : '')}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="搜索根主体实例..."
            className={`${INPUT_CLS} pl-7`}
          />
        </div>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-md border bg-background shadow-lg">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Spinner className="size-3" /> 搜索中...
              </div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">无匹配实例</div>
            )}
            {!loading && results.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  const key = (n.data as { key?: string } | undefined)?.key ?? '';
                  onSelect(key, n.label);
                  setOpen(false);
                  setSearch('');
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent cursor-pointer flex justify-between gap-2 ${
                  (n.data as { key?: string } | undefined)?.key === selectedKey ? 'bg-accent/50' : ''
                }`}
              >
                <span>{n.label}</span>
                <span className="text-muted-foreground font-mono text-[10px]">{(n.data as { key?: string } | undefined)?.key}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
