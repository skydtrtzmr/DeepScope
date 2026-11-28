import { entityGraph, subjectTitle, edgeKey, type Edge, type Batch } from './graph-data';
import { GraphWorkspace } from '../graph/graph-workspace';
import { EntityDetail } from '../graph/entity-detail';
import { selectionStates } from '@/lib/graph-presentation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Network, X } from 'lucide-react';
import { RelatedNodeList } from '../graph/associated-node--list';
import { getRelatedNodes } from '@/lib/related-nodes';
import type { DisplaySettings, GraphData } from '@/types/graph';
import { ExplorerCanvas } from '../graph/explorer-canvas';
import { getNodeColor } from '@/lib/graph-color';
import type { Projection, ViewNode } from '@/types/graph-view';
import { address, subjectKey, neighborsQuery, pageQuery, Link, type NeighborNode } from './util';

type GraphSettings = {
  highlight?: { depth: number; depthMax: number; directRelations: number; directRelationsMax: number };
  explore?: { m: number; n: number; mMax: number; nMax: number };
  display?: Partial<DisplaySettings>;
  batchLoad?: { pageSize: number; pageSizeMax: number };
  maxTotalNodes?: number;
};

function NumberSetting({ label, min, max, value, change }: {
  label: string; min: number; max: number; value: number; change: (n: number) => void;
}) {
  return <label>{label}<input type="number" min={min} max={max} value={value}
    onChange={e => change(Math.min(max, Math.max(min, Math.floor(Number(e.target.value)))))} /></label>;
}

function Dot({ node, colors }: { node: ViewNode; colors: Map<string, string> }) {
  return <span aria-hidden="true" className="local-graph-dot" style={{ backgroundColor: node.kind === 'group' ? '#818cf8' : colors.get(node.entity?.type ?? '') ?? getNodeColor(node.entity?.type) }} />;
}

export function LocalGraphExplorer({ domain, page, related, relations, groupedView, initialId, toggleGroup, moreGroups, close, colors }: {
  colors: Map<string, string>; domain: string; page: NeighborNode; related: NeighborNode[]; relations: Edge[]; groupedView: Projection;
  moreGroups?: { loading: boolean; load: () => void };
  initialId: string | null; toggleGroup: (node: ViewNode) => void; close: () => void;
}) {
  const [grouped, setGrouped] = useState(() => groupedView.nodes.some(n => n.id === initialId && n.kind === 'group'));
  const [selection, select] = useState<string | null>(initialId ?? page.id);
  const [filter, setFilter] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const client = useQueryClient();
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [expanding, setExpanding] = useState(false);
  const [expandMessage, setExpandMessage] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [customDepth, setDepth] = useState<number>();
  const [customLimit, setLimit] = useState<number>();
  const [customBatch, setBatch] = useState<number>();
  const [customLayers, setLayers] = useState<number>();
  const [customBreadth, setBreadth] = useState<number>();
  const [customTrack, setTrack] = useState<boolean>();
  const config = useQuery({
    queryKey: ['deepscope-graph-settings'], staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const res = await fetch(new URL('app-config.json', document.baseURI), { signal });
      if (!res.ok) throw new Error('无法读取图谱设置');
      return await res.json() as GraphSettings;
    },
  }).data;
  const depth = customDepth ?? config?.highlight?.depth ?? 1;
  const limit = customLimit ?? config?.highlight?.directRelations ?? 5;
  const tracking = customTrack ?? config?.display?.trackSelectedNode ?? true;
  function choose(id: string | null, toggle = true) {
    setExpandMessage('');
    setHover(null);
    if (!id || (id === selection && toggle)) { select(null); setFilter([]); return; }
    if (selection && selection !== id) setHistory(prev => [...prev, selection]);
    select(id);
  }
  const [extra, setExtra] = useState<Batch[]>([]);
  const capacity = config?.maxTotalNodes === 0 ? Infinity : config?.maxTotalNodes ?? 100;
  const batchSize = customBatch ?? config?.batchLoad?.pageSize ?? 5;
  const graph = useMemo(() => {
    const nodes = related.slice(0, capacity - 1);
    const ids = new Set([page.id, ...nodes.map(n => n.id)]);
    const edges = relations.filter(e => ids.has(e.source) && ids.has(e.target));
    return entityGraph(page, [{ parent: page.id, nodes, edges }, ...extra]);
  }, [page, related, relations, extra, capacity]);
  const view = grouped ? groupedView : graph.view;
  const selected = view.nodes.find(n => n.id === selection);
  const record = selected && graph.records.get(selected.id);
  const detail = useQuery({ ...pageQuery(domain, false, selected?.id ?? ''), enabled: !!record });
  const neighborOptions = neighborsQuery(domain, selected?.id ?? '');
  const neighbors = useInfiniteQuery({ ...neighborOptions, queryKey: [...neighborOptions.queryKey, 'explorer'], enabled: !!record && !grouped });
  const visibleEdges = useMemo(() => new Set(view.edges.map(e => e.id)), [view]);
  const pending = neighbors.data?.pages.some(p => p.edges.some(e => !visibleEdges.has(edgeKey(e))));
  const data = useMemo<GraphData>(() => ({
    nodes: view.nodes.map(n => {
      const body = graph.records.get(n.id);
      return { id: n.id, label: n.label, category: body ? subjectTitle(body) : '聚合分类',
        style: { fill: body ? colors.get(subjectKey(body)) ?? getNodeColor(subjectKey(body)) : '#818cf8' } };
    }),
    edges: view.edges.map(e => ({ ...e, label: e.kind === 'membership' ? '聚合成员' : '引用' })),
  }), [view, graph.records, colors]);
  const range = useMemo(() => selected ? getRelatedNodes(data, selected.id, limit, depth) : null,
    [data, selected, limit, depth]);
  const colorsByName = useMemo(() => new Map(data.nodes.map(n => [n.category!, n.style!.fill!])), [data]);
  const categories = useMemo(() => [...colorsByName.keys()].sort((a,b) => a.localeCompare(b,'zh')), [colorsByName]);
  const elementStates = useMemo(() => selectionStates(data, selected?.id ?? null, hover,
    range?.visibleData ?? null, range?.treeEdgeIds, filter), [data, selected, hover, range, filter]);
  const relatedNodes = useMemo(() => {
    if (!selected || !range) return [];
    const direction = new Map<string, Set<string>>();
    for (const e of view.edges) {
      const outgoing = e.source === selected.id;
      if (!outgoing && e.target !== selected.id) continue;
      const peer = outgoing ? e.target : e.source;
      const labels = direction.get(peer) ?? new Set<string>();
      labels.add(e.kind === 'membership' ? '聚合成员' : outgoing ? '引用' : '被引用');
      direction.set(peer, labels);
    }
    return range.relatedNodes.map(n => ({ ...n, relationLabel: direction.has(n.id) ? [...direction.get(n.id)!].join('、') : n.relationLabel }));
  }, [range, selected, view]);
  const fm = detail.data?.frontmatter;
  const fields = (detail.data?.display_fields ?? Object.keys(fm ?? {})).filter(f => f !== 'title' && fm?.[f] != null);
  async function explore() {
    if (!selected || busy.current || graph.records.size >= capacity) return;
    busy.current = true;
    setExpanding(true);
    try {
      const pages = pending ? neighbors.data?.pages : (await neighbors.fetchNextPage()).data?.pages;
      if (!pages || !active.current) return;
      const knownPeers = new Set(view.edges.flatMap(e => e.source === selected.id ? [e.target] : e.target === selected.id ? [e.source] : []));
      const nodes = pages.flatMap(p => p.nodes).filter(n => !knownPeers.has(n.id)).slice(0, Math.min(batchSize, capacity - graph.records.size));
      const ids = new Set(nodes.map(n => n.id));
      const edges = pages.flatMap(p => p.edges).filter(e => ids.has(e.source) || ids.has(e.target));
      if (nodes.length) setExtra(prev => [...prev, { parent: selected.id, nodes, edges }]);
    } finally {
      busy.current = false;
      if (active.current) setExpanding(false);
    }
  }
  const layers = customLayers ?? config?.explore?.n ?? 1;
  const breadth = customBreadth ?? config?.explore?.m ?? 5;
  async function expandLayers(node: ViewNode) {
    choose(node.id, false);
    if (node.kind === 'group') { toggleGroup(node); return; }
    if (grouped || busy.current) return;
    busy.current = true;
    setExpanding(true);
    setExpandMessage('');
    try {
      const batches: Batch[] = [];
      const visited = new Set([node.id]);
      const onCanvas = new Set(graph.records.keys());
      const addedEdges = new Set(visibleEdges);
      let frontier = [node.id];
      for (let level = 0; level < layers && frontier.length; level++) {
        const next: string[] = [];
        for (const parent of frontier) {
          const query = neighborsQuery(domain, parent);
          const batch: Batch = { parent, nodes: [], edges: [] };
          let offset = 0;
          let traversed = 0;
          while (traversed < breadth && onCanvas.size < capacity) {
            const slice = await client.fetchQuery({
              queryKey: [...query.queryKey, 'batch', offset], staleTime: query.staleTime,
              queryFn: ({ signal }) => query.queryFn({ pageParam: offset, signal }),
            });
            if (!active.current) return;
            for (const peer of slice.nodes) {
              if (visited.has(peer.id)) continue;
              visited.add(peer.id);
              if (!onCanvas.has(peer.id)) batch.nodes.push(peer);
              onCanvas.add(peer.id);
              next.push(peer.id);
              traversed++;
              if (traversed === breadth || onCanvas.size >= capacity) break;
            }
            for (const e of slice.edges) {
              const key = edgeKey(e);
              if (onCanvas.has(e.source) && onCanvas.has(e.target) && !addedEdges.has(key)) {
                addedEdges.add(key);
                batch.edges.push(e);
              }
            }
            offset += slice.nodes.length;
            if (!slice.more || !slice.nodes.length) break;
          }
          if (batch.nodes.length || batch.edges.length) batches.push(batch);
          if (onCanvas.size >= capacity) break;
        }
        frontier = next;
        if (onCanvas.size >= capacity) break;
      }
      if (batches.length) setExtra(prev => [...prev, ...batches]);
      if (onCanvas.size >= capacity) setExpandMessage('已达到探索节点上限');
      else if (onCanvas.size === graph.records.size) setExpandMessage('此范围内的关联已经显示');
    } catch (error) {
      if (active.current) setExpandMessage(error instanceof Error ? error.message : '图谱展开失败');
    } finally {
      busy.current = false;
      if (active.current) setExpanding(false);
    }
  }
  function category(n: ViewNode) {
    const body = graph.records.get(n.id);
    return body ? subjectTitle(body) : '聚合分类';
  }
  return <>
    <div className="local-graph-heading">
      <Network size={19} aria-hidden="true" /><h2>{page.title}的关联图谱</h2>
      <button className="local-graph-close" aria-label="关闭图谱" onClick={close}><X size={18} /></button>
    </div>
    <div className="local-graph-toolbar">
      <span>{view.nodes.length} 个节点 / {view.edges.length} 条连线</span>
      {groupedView.nodes.some(n => n.kind === 'group') && <label><input type="checkbox" checked={grouped} onChange={e => { setGrouped(e.target.checked); choose(page.id, false); setHistory([]); setFilter([]); }} />按维度聚合</label>}
      <details className="local-graph-settings"><summary>图谱设置</summary><div>
        <NumberSetting label="高亮深度" min={0} max={config?.highlight?.depthMax ?? 3} value={depth} change={setDepth} />
        <NumberSetting label="每层邻居上限" min={0} max={config?.highlight?.directRelationsMax ?? 99} value={limit} change={setLimit} />
        <NumberSetting label="探索深度" min={1} max={config?.explore?.nMax ?? 6} value={layers} change={setLayers} />
        <NumberSetting label="每层加载数量" min={1} max={config?.explore?.mMax ?? 20} value={breadth} change={setBreadth} />
        <NumberSetting label="每批邻居数量" min={1} max={config?.batchLoad?.pageSizeMax ?? 30} value={batchSize} change={setBatch} />
        <label><input type="checkbox" checked={tracking} onChange={e => setTrack(e.target.checked)} />跟踪选中节点</label>
      </div></details>
      <button disabled={!history.length} onClick={() => { select(history[history.length - 1]); setHistory(prev => prev.slice(0, -1)); setHover(null); }}>上一节点</button>
      <button onClick={() => choose(page.id, false)}><Crosshair size={15} />选中中心节点</button>
    </div>
    <GraphWorkspace canvas={<ExplorerCanvas categoryColors={colors} frameBeforeEntry view={view} contextId={page.id}
        display={config?.display} elementStates={elementStates} trackSelection={tracking} selectedId={selected?.id ?? null} onHover={setHover} onSelect={n => choose(n.id)} onClear={() => choose(null)} onToggle={toggleGroup} onExplore={n => void expandLayers(n)} />}
      legend={<ul className="local-graph-legend" aria-label="主体图例">{[...colorsByName].map(([label, color]) =>
          <li key={label}><span className="local-graph-dot" style={{ backgroundColor: color }} />{label}</li>)}</ul>}
      detail={<>
          {selected ? <>
            {record ? <EntityDetail key={record.id} node={{ id: record.id, label: selected.label, category: category(selected), data: fm }}
              color={colors.get(subjectKey(record))} directNeighborCount={new Set(view.edges.filter(e => e.source === record.id || e.target === record.id).map(e => e.source === record.id ? e.target : e.source)).size} />
              : <h3><Dot colors={colors} node={selected} />{selected.label}</h3>}
            <dl>
              {fields.map(f => <div className="local-graph-field" key={f}><dt>{f}</dt><dd>{Array.isArray(fm![f]) ? (fm![f] as unknown[]).join('、') : typeof fm![f] === 'object' ? JSON.stringify(fm![f]) : String(fm![f])}</dd></div>)}
            </dl>
            {selected && record && !grouped && <button disabled={expanding} onClick={() => void expandLayers(selected)}>{expanding ? '正在展开…' : '多层展开'}</button>}
            {expandMessage && <p role="status">{expandMessage}</p>}
            {record && record.id !== page.id && <Link domain={domain} to={address(domain, record.id)}>打开知识页 ↗</Link>}
            {detail.error && record && <p role="alert">{detail.error.message}</p>}
            {selected.kind === 'group' && <button onClick={() => toggleGroup(selected)}>{selected.expanded ? '收起分类' : '展开分类'}</button>}
          </> : <p>选择节点，查看属性和关联范围。</p>}
        </>}
      related={<>
          <RelatedNodeList relatedNodes={relatedNodes} selectedNodeId={selected?.id ?? null} highlightedNodeId={hover}
            selectNode={choose} highlightNode={setHover} categoryFilter={filter} setCategoryFilter={setFilter}
            categoryOptions={categories} categoryColorMap={colorsByName} />
          {grouped && moreGroups && <button className="local-graph-more" disabled={moreGroups.loading}
            onClick={moreGroups.load}>加载更多关联</button>}
          {!grouped && record && (pending || neighbors.hasNextPage) && <button className="local-graph-more" disabled={neighbors.isFetching || expanding || graph.records.size >= capacity} onClick={() => void explore()}>探索更多关联</button>}
          {neighbors.error && !grouped && record && <p role="alert">{neighbors.error.message} <button onClick={() => void neighbors.refetch()}>重试</button></p>}
        </>} />
  </>;
}
