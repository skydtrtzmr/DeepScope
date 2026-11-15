import { useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@antv/g6';
import { SINGLE_NODE_FORCE_DRAG } from '@/lib/single-node-force-drag';
import { Button } from '@/components/ui/button';
import { getNodeColor } from '@/lib/graph-color';
import demo from '@/lib/aggregation/demo.json';
import { collapseBranch, contextKey, project, mergeProjections, type Context, type Dimension, type Projection, type ViewNode } from '@/lib/aggregation/explorer';

const category: Dimension = { id: 'project.category', label: '项目类别', relation: 'project', field: 'category' };
const status: Dimension = { id: 'status', label: '任务状态', field: 'status' };
const inputClass = 'border rounded px-2 py-1.5 bg-background text-sm w-full';

/** Separate preview route: validates the new semantics without invoking v1 APIs. */
export function AggregationExplorer() {
  const [mode, setMode] = useState<'related' | 'collection'>('related');
  const [anchorId, setAnchorId] = useState('person:zhang');
  const [relation, setRelation] = useState('assigned');
  const [region, setRegion] = useState('');
  const [order, setOrder] = useState('category');
  const [sessions, setSessions] = useState<Record<string, { expanded: Set<string>; limits: Record<string, number> }>>({});
  const [pinned, setPinned] = useState<Record<string, { context: Context; dimensions: Dimension[]; label: string }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dimensions = useMemo(() => order === 'category' ? [category] : order === 'status' ? [status] : order === 'category-status' ? [category, status] : [status, category], [order]);
  const context: Context = mode === 'related'
    ? { mode, anchorId, relation, targetType: 'task' }
    : { mode, label: region ? `${region}任务` : '全部任务', targetType: 'task', region: region || undefined };
  const key = contextKey(context, dimensions);
  const session = sessions[key] ?? { expanded: new Set<string>(), limits: {} };
  const view = useMemo(() => project(demo, context, dimensions, session.expanded, session.limits), [key, sessions]);
  const views = useMemo(() => Object.entries(pinned).filter(([id]) => id !== key).map(([id, item]) => ({
    id, view: project(demo, item.context, item.dimensions, sessions[id]?.expanded ?? new Set(), sessions[id]?.limits),
  })).concat({ id: key, view }), [pinned, key, sessions, view]);
  const canvasView = useMemo(() => mergeProjections(demo, views.map(item => item.view)), [views]);
  const selected = canvasView.nodes.find(n => n.id === selectedId);
  const update = (expanded: Set<string>, limits = session.limits) => setSessions(old => ({ ...old, [key]: { expanded, limits } }));
  const toggle = (node: ViewNode) => {
    setSelectedId(node.id);
    if (node.kind !== 'group') return;
    const owner = views.find(item => item.view.nodes.some(n => n.id === node.id));
    if (!owner) return;
    setSessions(old => {
      const state = old[owner.id] ?? { expanded: new Set<string>(), limits: {} };
      return { ...old, [owner.id]: { ...state, expanded: node.expanded
        ? collapseBranch(node.id, owner.view, state.expanded) : new Set([...state.expanded, node.id]) } };
    });
  };
  const back = new URL(window.location.href);
  back.searchParams.delete('aggregation');
  const person = demo.entities.find(e => e.id === anchorId)!;
  const description = mode === 'related'
    ? `${person.label}${relation === 'assigned' ? '负责' : '参与'}的任务`
    : `${region || '全局'}范围内的任务`;

  return <div className="h-screen flex flex-col bg-background text-foreground">
    <header className="border-b px-4 py-3 flex items-center gap-4 bg-card">
      <h2 className="font-semibold text-base shrink-0">知识图谱</h2><span className="text-xs text-muted-foreground">{canvasView.nodes.length} 节点 / {canvasView.edges.length} 边 · 聚合示例</span>
      <a className="ml-auto text-sm underline" href="?graph=subjects-preview">主体关系验证</a>
      <a className="text-sm underline" href={back.href}>返回原图谱</a>
    </header>
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
      <main className="order-first flex-1 min-w-0 min-h-[50vh] lg:min-h-0 relative border-b lg:border-b-0 lg:border-r">
        <ExplorerCanvas view={canvasView} contextId={Object.keys(pinned).length ? "shared" : key} onSelect={node => setSelectedId(node.id)} onToggle={toggle} />
        {view.total === 0 && <div className="absolute top-5 left-5 rounded border bg-background p-4">当前范围没有任务，可切换主体或关系。</div>}
      </main>
      <aside className="w-full lg:w-80 xl:w-96 shrink-0 p-3 overflow-auto space-y-4 h-[40vh] lg:h-full bg-card">
        {selected ? <section className="border-b pb-3 space-y-2 text-xs">
          <h3 className="font-semibold text-sm">{selected.label}</h3>
          <p className="text-muted-foreground">{selected.kind === 'group' ? `所属范围：${pinned[views.find(item => item.view.nodes.some(n => n.id === selected.id))?.id ?? ""]?.label ?? description}` : selected.kind === 'entity' ? '任务详情' : description}</p>
          {selected.entity && Object.entries(selected.entity.properties).map(([field, value]) => <p key={field}>{field === 'status' ? '状态' : field === 'region' ? '区域' : field}：{value ?? '未分类'}</p>)}
          {selected.kind === 'group' && <Button size="sm" variant="outline" onClick={() => toggle(selected)}>{selected.expanded ? '收起分组' : '展开分组'}</Button>}
          {selected.shown !== undefined && <p>已展示 {selected.shown} / {selected.memberIds?.length} 个任务</p>}
          {selected.memberIds && (selected.shown ?? 0) < selected.memberIds.length && <Button size="sm" variant="outline" onClick={() => {
            const owner = views.find(item => item.view.nodes.some(n => n.id === selected.id && n.memberIds));
            if (owner) setSessions(old => {
              const state = old[owner.id] ?? { expanded: new Set<string>(), limits: {} };
              return { ...old, [owner.id]: { ...state, limits: { ...state.limits, [selected.id]: (selected.shown ?? 0) + 3 } } };
            });
          }}>加载更多</Button>}
        </section> : <p className="text-xs text-muted-foreground border-b pb-3">点击图谱中的节点查看详情；选中分组后可展开或收起。</p>}
        <section className="space-y-2 border-b pb-3">
          <h3 className="text-sm font-semibold">保留在画布中的探索</h3>
          <Button variant="outline" disabled={!!pinned[key]} onClick={() => setPinned(old => ({ ...old, [key]: { context, dimensions, label: description + ' · ' + dimensions.map(d => d.label).join(' → ') } }))}>
            {pinned[key] ? '当前探索已保留' : '保留当前探索'}
          </Button>
          <p className="text-xs text-muted-foreground">保留后可切换主体或范围，在同一画布比较；共享实体只展示一次。</p>
          {Object.entries(pinned).map(([id, item]) => <div key={id} className="flex items-center gap-2 text-xs">
            <span className="flex-1 break-words">{item.label}</span>
            <Button variant="ghost" aria-label={`取消保留 ${item.label}`} onClick={() => setPinned(old => {
              const next = { ...old }; delete next[id]; return next;
            })}>取消保留</Button>
          </div>)}
        </section>
        <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">聚合对象</legend>
          <label className="flex gap-2 text-sm"><input type="radio" checked={mode === 'related'} onChange={() => setMode('related')} />主体的相关实体</label>
          <label className="flex gap-2 text-sm"><input type="radio" checked={mode === 'collection'} onChange={() => setMode('collection')} />范围内的实体集合</label>
        </fieldset>
        {mode === 'related' ? <>
          <label className="block text-sm space-y-2"><span>针对谁</span><select className={inputClass} value={anchorId} onChange={e => setAnchorId(e.target.value)}>
            <option value="person:zhang">张三</option><option value="person:li">李四</option>
          </select></label>
          <label className="block text-sm space-y-2"><span>查看什么关系</span><select className={inputClass} value={relation} onChange={e => setRelation(e.target.value)}>
            <option value="assigned">负责的任务</option><option value="participates">参与的任务</option>
          </select></label>
        </> : <label className="block text-sm space-y-2"><span>任务所在范围</span><select className={inputClass} value={region} onChange={e => setRegion(e.target.value)}>
          <option value="">全局</option><option>华东</option><option>华南</option>
        </select></label>}
        <label className="block text-sm space-y-2"><span>分组顺序</span><select className={inputClass} value={order} onChange={e => setOrder(e.target.value)}>
          <option value="category">项目类别 → 任务</option><option value="status">任务状态 → 任务</option>
          <option value="category-status">项目类别 → 任务状态 → 任务</option><option value="status-category">任务状态 → 项目类别 → 任务</option>
        </select></label>
        <p className="text-sm leading-6 rounded bg-muted p-3">{description}<br />共 {view.total} 个任务，按{dimensions.map(d => d.label).join(' → ')}分组。</p>
        <button className="border rounded px-3 py-1.5 text-sm" onClick={() => update(new Set(), {})}>收起当前探索</button>
        <p className="text-xs text-muted-foreground leading-5">单击节点查看详情，双击分组展开或收起，也可使用详情中的按钮。虚线表示分组归属，实线表示真实关系。支持拖动节点与画布、滚轮缩放。</p>
        <details className="text-xs"><summary className="cursor-pointer">可见节点列表（也可点击）</summary><div className="mt-2 space-y-1">
          {canvasView.nodes.map(n => <button key={n.id} className="block text-left hover:underline" style={{ paddingLeft: n.depth * 10 }} onClick={() => toggle(n)}>{n.kind === 'group' ? n.expanded ? '− ' : '+ ' : ''}{n.label}</button>)}
        </div></details>
      </aside>
    </div>
  </div>;
}

export function ExplorerCanvas({ view, contextId, onSelect, onToggle }: { view: Projection; contextId: string; onSelect: (node: ViewNode) => void; onToggle: (node: ViewNode) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const current = useRef({ view, onSelect, onToggle });
  current.current = { view, onSelect, onToggle };
  const [error, setError] = useState('');
  const ready = useRef(false);
  const lastContext = useRef('');
  useEffect(() => {
    if (!container.current) return;
    const instance = new Graph({ container: container.current, autoResize: true, animation: { duration: 250 },
      behaviors: ['drag-canvas', 'zoom-canvas', { type: SINGLE_NODE_FORCE_DRAG, fixed: false }],
      layout: {
        type: 'd3-force',
        link: { distance: 170, strength: 0.6 },
        manyBody: { strength: -180 },
        collide: { radius: 68, strength: 1 },
        center: { strength: 0.1 },
        alphaMin: 0.002, alphaDecay: 0.05, velocityDecay: 0.5,
      },
      node: { type: 'circle', style: { size: 28, labelText: d => String(d.data?.label ?? ''), labelPlacement: 'bottom', labelFill: '#0f172a', labelFontSize: 11, labelBackground: true, labelBackgroundFill: '#ffffff', labelBackgroundOpacity: 0.6, labelPadding: [2, 6], shadowColor: 'rgba(0,0,0,0.08)', shadowBlur: 4, cursor: 'grab' }, state: { selected: { stroke: '#6366f1', lineWidth: 4 } } },
      edge: { type: d => String(d.type ?? 'line') },
    });
    graph.current = instance;
    instance.on('beforerender', () => { ready.current = true; });
    instance.on('node:click', event => {
      if (!('target' in event) || !event.target || !('id' in event.target)) return;
      const id = event.target.id;
      const node = current.current.view.nodes.find(n => n.id === id);
      void instance.setElementState(Object.fromEntries(instance.getNodeData().map(n => [n.id, n.id === id ? ['selected'] : []])));
      if (node) current.current.onSelect(node);
    });
    instance.on('node:dblclick', event => {
      if (!('target' in event) || !event.target || !('id' in event.target)) return;
      const id = event.target.id;
      const node = current.current.view.nodes.find(n => n.id === id);
      if (node?.kind === 'group') current.current.onToggle(node);
    });
    return () => { graph.current = null; ready.current = false; instance.destroy(); };
  }, []);
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    if (ready.current) instance.stopLayout();
    let cancelled = false;
    // Coalesce same-turn changes, without waiting for previous entry/exit animations or layout.
    void Promise.resolve().then(() => {
      if (cancelled || graph.current !== instance) return;
      // Preserve visible nodes; seed new children near their parent before force simulation.
      const positions = new Map<string, { x: number; y: number }>();
      const changedContext = lastContext.current !== contextId;
      if (!changedContext) for (const node of instance.getNodeData()) {
        const x = Number(node.style?.x), y = Number(node.style?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) positions.set(node.id, { x, y });
      }
      const center = { x: (container.current?.clientWidth ?? 800) / 2, y: (container.current?.clientHeight ?? 600) / 2 };
      for (const node of view.nodes) {
        if (positions.has(node.id)) continue;
        const parent = positions.get(node.parentId ?? '') ?? center;
        const siblings = view.nodes.filter(n => n.parentId === node.parentId);
        const angle = siblings.indexOf(node) * Math.PI * 2 / Math.max(1, siblings.length);
        positions.set(node.id, node.id === view.rootId ? center : { x: parent.x + Math.cos(angle) * 100, y: parent.y + Math.sin(angle) * 100 });
      }
      lastContext.current = contextId;
      instance.setData({ nodes: view.nodes.map(n => ({ id: n.id, data: { label: n.label }, style: {
        x: positions.get(n.id)!.x, y: positions.get(n.id)!.y,
        size: n.kind === 'group' ? 40 : n.kind === 'anchor' || n.kind === 'scope' ? 36 : 28,
        fill: n.kind === 'group' ? '#eef2ff' : getNodeColor(n.entity?.type === 'employee' || n.kind === 'anchor' ? '人员' : n.kind === 'scope' ? '范围' : '任务'),
        stroke: n.kind === 'group' ? '#6366f1' : '#334155', lineWidth: 2,
        lineDash: n.kind === 'group' ? [4, 3] : [],
      } })), edges: view.edges.map(e => {
        const parallels = view.edges.filter(other => (other.source === e.source && other.target === e.target) || (other.source === e.target && other.target === e.source));
        const offset = (parallels.indexOf(e) - (parallels.length - 1) / 2) * 48;
        return { id: e.id, source: e.source, target: e.target, type: parallels.length > 1 ? 'quadratic' : 'line', style: {
        curveOffset: offset * (e.source < e.target ? 1 : -1),
        labelText: e.label ?? '', labelBackground: true, labelBackgroundFill: '#ffffff', labelPadding: [2, 4], labelFontSize: 12,
        stroke: e.kind === 'membership' ? '#a5b4fc' : '#64748b', lineDash: e.kind === 'membership' ? [5, 4] : [], endArrow: e.kind === 'relation',
      } }; }) });
      // G6 render starts entry/exit animation and force layout together. Do not await
      // its completion here: the next interaction must be free to interrupt the layout.
      void instance.render().catch(e => {
        if (!cancelled && graph.current === instance) setError(e instanceof Error ? e.message : '渲染失败');
      });
      if (!cancelled) setError('');
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '画布渲染失败'); });
    return () => { cancelled = true; };
  }, [view, contextId]);
  return <><div ref={container} className="w-full h-full" />{error && <div role="alert" className="absolute bottom-4 left-4 bg-background border p-3 text-sm">{error}</div>}</>;
}
