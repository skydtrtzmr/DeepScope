// Adapted from DeepScope frontend/src/components/aggregate/aggregation-explorer.tsx.
import { useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/g6';
import { SINGLE_NODE_FORCE_DRAG } from '@/lib/single-node-force-drag';
import { buildCategoryColorMap, getNodeColor } from '@/lib/graph-color';
import type { Projection, ViewNode } from '@/lib/preview-types';
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
    const instance = new Graph({ container: container.current, autoResize: true, padding: 28, zoomRange: [0.15, 1.5], animation: { duration: 250 },
      behaviors: ['drag-canvas', 'zoom-canvas', { type: SINGLE_NODE_FORCE_DRAG, fixed: false }],
      layout: {
        type: 'd3-force',
        link: { distance: 170, strength: 0.6 },
        manyBody: { strength: -180 },
        collide: { radius: 68, strength: 1 },
        center: { strength: 0.1 },
        alphaMin: 0.002, alphaDecay: 0.05, velocityDecay: 0.5,
      },
      node: { type: 'circle', style: { size: d => d.style?.size ?? 28, labelText: d => String(d.data?.label ?? ''), labelPlacement: 'bottom', labelFill: '#0f172a', labelFontSize: 11, labelWordWrap: true, labelMaxWidth: 180, labelMaxLines: 6, labelBackground: true, labelBackgroundFill: '#ffffff', labelBackgroundOpacity: 0.6, labelPadding: [2, 6], shadowColor: 'rgba(0,0,0,0.08)', shadowBlur: 4, cursor: 'grab' }, state: { selected: { stroke: '#6366f1', lineWidth: 4 } } },
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
      const colors = buildCategoryColorMap(view.nodes.map(n => n.entity?.type));
      instance.setData({ nodes: view.nodes.map(n => ({ id: n.id, type: 'circle', data: { label: n.label }, style: {
        x: positions.get(n.id)!.x, y: positions.get(n.id)!.y,
        size: n.kind === 'group' ? 40 : n.kind === 'anchor' || n.kind === 'scope' ? 36 : 28,
        labelPlacement: 'bottom',
        labelMaxWidth: 180,
        labelBackground: true,
        fill: n.kind === 'group' ? '#eef2ff' : colors.get(n.entity?.type ?? '') || getNodeColor(n.entity?.type),
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
      void instance.render().then(() => {
        if (changedContext && !cancelled && graph.current === instance) return instance.fitView();
      }).catch(e => {
        if (!cancelled && graph.current === instance) setError(e instanceof Error ? e.message : '渲染失败');
      });
      if (!cancelled) setError('');
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '画布渲染失败'); });
    return () => { cancelled = true; };
  }, [view, contextId]);
  return <><div ref={container} className="w-full h-full" /><div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, background: 'white', border: '1px solid #e0e8f2', borderRadius: 4, padding: 4 }}>
    <button aria-label="放大图谱" style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.zoomTo(graph.current.getZoom() * 1.2); }}>＋</button>
    <button aria-label="缩小图谱" style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.zoomTo(graph.current.getZoom() / 1.2); }}>−</button>
    <button style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.fitView(); }}>适应画布</button>
  </div>{error && <div role="alert" className="absolute bottom-4 left-4 bg-background border p-3 text-sm">{error}</div>}</>;
}
