import { useEffect, useMemo, useRef, useState } from 'react';
import { getNodeColor } from '@/lib/graph-color';
import './live-explorer.css';
import { ExplorerCanvas } from './aggregation-explorer';
import type { Projection, ViewEdge, ViewNode } from '@/lib/aggregation/explorer';

type Choice = { id: string; name: string };
type View = Choice & { groups: { field: string; name: string }[]; roots: { field: string; subject: string; name: string }[] };
type Entity = { id: string; label: string; data: { key?: string; kind?: string } };
type Result = { scope: string; root: Entity; total: number; groups: { id: string; label: string; count: number }[] };
type Members = { nodes: Entity[]; edges: ViewEdge[]; has_more: boolean; offset: number };
type Bucket = { open: boolean; nodes: Entity[]; edges: ViewEdge[]; more: boolean; offset: number };
const empty: Bucket = { open: false, nodes: [], edges: [], more: true, offset: 0 };
const domain = new URLSearchParams(location.search).get('domain') || 'domain1';

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch('/api/graph/' + path, {
    signal, method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body && JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || '图谱查询失败');
  return data;
}

function useQuery<T>(path: string, payload?: string, attempt = 0) {
  const [state, setState] = useState<{key: string; data?: T; error?: string}>();
  const key = JSON.stringify([path, payload, attempt]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    request<T>(path, controller.signal, payload && JSON.parse(payload))
      .then(data => { if (!controller.signal.aborted) setState({key, data}); })
      .catch(e => { if (!controller.signal.aborted) setState({key, error: e.message}); });
    return () => controller.abort();
  }, [path, payload, key]);
  return state?.key === key ? state : undefined;
}

function Results({ result }: { result: Result }) {
  const [buckets, setBuckets] = useState<Record<string, Bucket>>({});
  const [selected, select] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(new Map<string, AbortController>());
  useEffect(() => () => { for (const c of pending.current.values()) c.abort(); }, []);
  async function load(id: string) {
    const old = buckets[id] ?? empty;
    if (pending.current.has(id) || !old.more) return;
    const controller = new AbortController();
    pending.current.set(id, controller);
    setError('');
    try {
      const page = await request<Members>('aggregate/expand', controller.signal,
        {scope: result.scope, bucket: id, offset: old.offset, limit: 3});
      if (!controller.signal.aborted) setBuckets(prev => ({ ...prev, [id]: {
        open: true, more: page.has_more, offset: page.offset + page.nodes.length,
        nodes: [...old.nodes, ...page.nodes], edges: [...old.edges, ...page.edges],
      }}));
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (pending.current.get(id) === controller) pending.current.delete(id); }
  }
  function toggle(id: string) {
    select(id);
    if (!result.groups.some(g => g.id === id)) return;
    pending.current.get(id)?.abort();
    pending.current.delete(id);
    const old = buckets[id];
    if (old) setBuckets(prev => ({ ...prev, [id]: {...old, open: !old.open} }));
    else void load(id);
  }
  const view = useMemo<Projection>(() => {
    const root = result.root;
    const nodes = new Map<string, ViewNode>([[root.id, {id: root.id, label: root.label, kind: root.data.kind === 'scope' ? 'scope' : 'anchor', depth: 0}]]);
    const edges = new Map<string, ViewEdge>();
    for (const group of result.groups) {
      const bucket = buckets[group.id];
      nodes.set(group.id, {id: group.id, label: group.label + ' · ' + group.count, kind: 'group', depth: 1, parentId: root.id});
      const id = JSON.stringify([root.id, group.id]);
      edges.set(id, {id, source: root.id, target: group.id, kind: 'membership'});
      if (!bucket?.open) continue;
      for (const n of bucket.nodes) if (!nodes.has(n.id)) nodes.set(n.id, {id: n.id, label: n.label, kind: 'entity', depth: 2, parentId: group.id});
      for (const e of bucket.edges) edges.set(e.id, {...e, kind: 'membership'});
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], total: result.total, rootId: root.id };
  }, [result, buckets]);
  const active = result.groups.find(g => g.id === selected);
  const bucket = buckets[selected];
  return <div className="flex flex-1 min-h-0">
    <main className="relative flex-1 min-w-0"><ExplorerCanvas selectedId={selected} onClear={() => select('')} view={view} contextId={result.scope} onSelect={n => select(n.id)} onToggle={n => toggle(n.id)} /></main>
    <aside className="w-64 border-l overflow-auto p-4 space-y-3">
      <p>{result.total} 条记录 · {result.groups.length} 个分组</p>
      {result.groups.map(g => <button className="block underline" key={g.id} onClick={() => toggle(g.id)}>{g.label}（{g.count}）</button>)}
      {active && <><p>{active.label} · 已展示 {bucket?.open ? bucket.offset : 0} / {active.count}</p>
        <button onClick={() => toggle(selected)}>{bucket?.open ? '收起分组' : '展开分组'}</button>
        {bucket?.open && bucket.more && <button className="ml-3" onClick={() => void load(selected)}>加载更多</button>}</>}
      {error && <p role="alert">{error}</p>}
    </aside></div>;
}

type OverviewNode = { id: string; label: string; category: string; data: { subject: string; key: string } };
type OverviewData = {domain: string; nodes: OverviewNode[]; edges: ViewEdge[]; per_subject: number};

function DomainOverview({onExplore}: {onExplore: (source: string) => void}) {
  const response = useQuery<OverviewData>('overview?domain=' + encodeURIComponent(domain));
  const data = response?.data;
  const [selected, select] = useState('');
  const node = data?.nodes.find(n => n.id === selected);
  const view = useMemo<Projection | undefined>(() => data && ({
    rootId: '', total: data.nodes.length,
    nodes: data.nodes.map(n => ({id:n.id, label:n.label, depth:0, kind:'entity',
      entity:{id:n.id,label:n.label,type:n.category,properties:{}}})),
    edges: data.edges.map(e => ({...e, kind:'relation'})),
  }), [data]);
  if (!data || !view) return <p className="p-4" role="status">{response?.error || '正在读取业务域实例…'}</p>;
  const categories = [...new Set(data.nodes.map(n => n.category))];
  const links = data.edges.filter(e => e.source === selected || e.target === selected);
  return <div className="domain-overview">
    <aside><h2>{data.domain}</h2><p>按主体各取最多 {data.per_subject} 条真实记录，连线表示这些记录间已配置的关系。</p>
      <h3>图中主体 · {categories.length}</h3>
      <div className="domain-legend">{categories.map(c => <span key={c}><i style={{background:getNodeColor(c)}} />{c}</span>)}</div>
      <h3>{node ? node.category : '查看记录'}</h3>
      {node ? <><strong>{node.label}</strong><p>{node.data.key} · 图中有 {links.length} 条关联</p>
        <button onClick={() => onExplore(node.data.subject)}>按此主体分组 →</button></> : <p>点击图上的记录查看所属主体与关联数量。拖动节点调整位置，滚轮缩放。</p>}
    </aside><main><div className="domain-caption">{view.total} 个实例 · {view.edges.length} 条关系</div>
      <ExplorerCanvas selectedId={selected} onClear={() => select('')} view={view} contextId={domain} onSelect={n => select(n.id)} onToggle={() => {}} /></main></div>;
}

export function LiveExplorer() {
  const [mode, setMode] = useState<'overview' | 'groups'>('overview');
  const [initialSource, setInitialSource] = useState('kb_dwd_task');
  return <div className="live-explorer h-screen flex flex-col"><nav className="domain-nav">
    <strong>业务数据图谱</strong>{(['overview','groups'] as const).map(key =>
      <button key={key} aria-pressed={key === mode} onClick={() => setMode(key)}>{key === 'overview' ? '全局关系' : '主体分组'}</button>)}
    <a href="?knowledge">知识库</a><a href="?aggregation=preview">样例图谱</a></nav>
    {mode === 'overview' ? <DomainOverview onExplore={source => {setInitialSource(source); setMode('groups');}} /> : <GroupExplorer initialSource={initialSource} />}
  </div>;
}

function GroupExplorer({initialSource}: {initialSource: string}) {
  const views = useQuery<{views: View[]}>('aggregation/views?domain=' + encodeURIComponent(domain));
  const [source, setSource] = useState(initialSource);
  const view = views?.data?.views.find(v => v.id === source) ?? views?.data?.views[0];
  const [field, setField] = useState('project_id');
  const group = view?.groups.find(g => g.field === field) ?? view?.groups[0];
  const [relation, setRelation] = useState('');
  const root = view?.roots.find(r => r.field === relation);
  const instances = useQuery<{nodes: Entity[]}>(root ? 'instances?' + new URLSearchParams({domain, subject: root.subject}) : '');
  const [entity, setEntity] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, retry] = useState(0);
  const payload = JSON.stringify({domain, source: view?.id, group: group?.field, root: root ? {relation, key: entity} : null, metrics: []});
  const result = useQuery<Result>(query && query === payload ? 'aggregate' : '', query, attempt);
  return <div className="min-h-0 flex-1 flex flex-col">
    <header className="flex gap-4 items-center flex-wrap p-3 border-b">
      <label>主体 <select value={view?.id ?? ''} onChange={e => {setSource(e.target.value); setRelation(''); setEntity(''); setQuery('');}}>{views?.data?.views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label>范围 <select value={relation} onChange={e => {setRelation(e.target.value); setEntity(''); setQuery('');}}><option value="">全局</option>{view?.roots.map(r => <option key={r.field} value={r.field}>{r.name}（{r.field}）</option>)}</select></label>
      {root && <select aria-label="主体实例" value={entity} onChange={e => setEntity(e.target.value)}><option value="">选择实例</option>{instances?.data?.nodes.map(n => <option key={n.id} value={n.data.key}>{n.label}</option>)}</select>}
      <label>按 <select value={group?.field ?? ''} onChange={e => setField(e.target.value)}>{view?.groups.map(g => <option key={g.field} value={g.field}>{g.name}</option>)}</select> 分组</label>
      <button className="border rounded px-3 py-1" disabled={!group || (!!root && !entity)} onClick={() => {setQuery(payload); retry(n => n + 1);}}>查询</button>
      </header>
    {(views?.error || instances?.error || result?.error) && <p role="alert" className="p-4">{views?.error || instances?.error || result?.error}</p>}
    {result?.data && <Results key={result.data.scope} result={result.data} />}
    {!result && <p className="p-4">{query === payload ? '正在查询…' : '选择主体和分组字段，点击「查询」查看各组记录数。'}</p>}
  </div>;
}
