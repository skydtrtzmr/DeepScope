import { canvasData } from './canvas-data';
import { getRelatedNodes } from '@/lib/related-nodes';
import { selectionStates } from '@/lib/graph-presentation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Graph } from '@antv/g6';
import { SINGLE_NODE_FORCE_DRAG } from '@/lib/single-node-force-drag';
import { buildCategoryColorMap } from '@/lib/graph-color';
import type { Projection, ViewNode } from '@/types/graph-view';
import type { DisplaySettings } from '@/types/graph';

function highlightStates(view: Projection, selectedId: string | null) {
  const selection = selectedId && view.nodes.some(n => n.id === selectedId) ? selectedId : null;
  const range = selection ? getRelatedNodes(view, selection, Infinity, 1) : null;
  return selectionStates(view, selection, null, range?.visibleData ?? null, range?.treeEdgeIds, []);
}

// This G6 build fits "always" by default, which enlarges a sparse graph until it fills the canvas.
// Only shrink an oversized graph; never zoom in past the designed label size.
async function frame(instance: Graph, fitBothAxes = false) {
  await instance.fitView({ when: fitBothAxes ? 'always' : 'overflow' }, false);
  if (instance.getZoom() <= 1) return;
  await instance.zoomTo(1, false);
  await instance.fitCenter(false);
}

type CanvasProps = {
  view: Projection; contextId: string; selectedId: string | null;
  onClear: () => void; onSelect: (node: ViewNode) => void; onToggle: (node: ViewNode) => void;
  onExplore?: (node: ViewNode) => void; onHover?: (id: string | null) => void;
  categoryColors?: Map<string, string>; frameBeforeEntry?: boolean; fitUpdates?: boolean;
  controls?: boolean; layout?: 'force' | 'hierarchy';
  display?: Partial<DisplaySettings>;
  elementStates?: Record<string, string[]>; trackSelection?: boolean;
};

const forceLayout = {
  type: 'd3-force' as const,
  link: { distance: 170, strength: 0.6 }, manyBody: { strength: -180 },
  collide: { radius: 68, strength: 1 }, center: { strength: 0.1 },
  alphaMin: 0.002, alphaDecay: 0.05, velocityDecay: 0.5,
};

export function ExplorerCanvas({ view, contextId, selectedId, onClear, onSelect, onToggle, onExplore, onHover,
  categoryColors, frameBeforeEntry = false, fitUpdates = false, elementStates, trackSelection = false, controls, layout = 'force', display }: CanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<Graph | null>(null);
  const states = useMemo(() => elementStates ?? highlightStates(view, selectedId), [elementStates, view, selectedId]);
  const colors = useMemo(() => categoryColors ?? buildCategoryColorMap(view.nodes.map(n => n.entity?.type)), [view, categoryColors]);
  const trigger = display?.expandTrigger ?? 'rightclick';
  const current = useRef({ view, states, onClear, onSelect, onToggle, onExplore, onHover, trigger });
  current.current = { view, states, onClear, onSelect, onToggle, onExplore, onHover, trigger };
  const dragging = useRef(false);
  const [error, setError] = useState('');
  const ready = useRef(false);
  const lastContext = useRef('');
  const drawnView = useRef<Projection | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const instance = new Graph({ container: container.current, autoResize: true, padding: frameBeforeEntry ? 20 : 0, animation: { duration: 250 },
      behaviors: ['drag-canvas', 'zoom-canvas', layout === 'force' ? { type: SINGLE_NODE_FORCE_DRAG, fixed: false } : 'drag-element'],
      layout: layout === 'hierarchy' ? { type: 'antv-dagre', rankdir: 'LR', ranksep: 140, nodesep: 40 } : { ...forceLayout, preLayout: frameBeforeEntry, animation: true },
      node: { type: 'circle', style: { size: 28, opacity: 1, halo: false, labelText: d => String(d.data?.label ?? ''), labelPlacement: 'bottom', labelFill: '#0f172a', labelFontSize: 11, labelBackground: true, labelBackgroundFill: '#ffffff', labelBackgroundOpacity: 0.6, labelPadding: [2, 6], shadowColor: 'rgba(0,0,0,0.08)', shadowBlur: 4, cursor: 'grab' }, state: { selected: { stroke: '#4338ca', lineWidth: 5 }, highlighted: { stroke: '#6366f1', lineWidth: 3, halo: true, haloLineWidth: 16, haloStroke: '#6366f1', haloStrokeOpacity: .15 }, related: { stroke: '#6366f1', lineWidth: 3 }, muted: { opacity: 0.2 } } },
      edge: { type: d => String(d.type ?? 'line'), style: { opacity: 1, lineWidth: 1 }, state: { related: { stroke: '#4f46e5', lineWidth: 3, labelFill: '#312e81' }, muted: { opacity: 0.12 } } },
    });
    instance.once('afterdraw', () => {
      if (!frameBeforeEntry && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        container.current?.animate([
          { opacity: 0, transform: 'scale(.92)' },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: 650, easing: 'ease-out' });
      }
    });
    graph.current = instance;
    instance.on('beforerender', () => { ready.current = true; });
    let suppressClickUntil = 0;
    let pendingClick: ReturnType<typeof setTimeout> | undefined;
    function cancelClick() { clearTimeout(pendingClick); pendingClick = undefined; }
    instance.on('node:pointerenter', event => {
      if (!dragging.current && 'target' in event && event.target && 'id' in event.target) current.current.onHover?.(String(event.target.id));
    });
    instance.on('node:pointerleave', () => current.current.onHover?.(null));
    instance.on('node:dragstart', () => {
      cancelClick();
      dragging.current = true;
      if (drawnView.current) void instance.setElementState(highlightStates(drawnView.current, null), false);
    });
    instance.on('node:dragend', () => {
      dragging.current = false;
      suppressClickUntil = performance.now() + 100;
      if (drawnView.current === current.current.view) void instance.setElementState(current.current.states, false);
    });
    instance.on('node:contextmenu', event => {
      if (!current.current.onExplore || !('target' in event) || !event.target || !('id' in event.target)) return;
      const id = event.target.id;
      const node = current.current.view.nodes.find(n => n.id === id);
      if (node && ['rightclick', 'both'].includes(current.current.trigger)) current.current.onExplore(node);
    });
    instance.on('node:click', event => {
      if (dragging.current || performance.now() < suppressClickUntil) return;
      if (!('target' in event) || !event.target || !('id' in event.target)) return;
      const id = event.target.id;
      const node = current.current.view.nodes.find(n => n.id === id);
      cancelClick();
      if (!node) return;
      if (node.kind === 'group' || (current.current.onExplore && ['both', 'dblclick'].includes(current.current.trigger))) {
        pendingClick = setTimeout(() => current.current.onSelect(node), 200);
      } else current.current.onSelect(node);
    });
    instance.on('canvas:click', () => { if (!dragging.current && performance.now() >= suppressClickUntil) current.current.onClear(); });
    instance.on('node:dblclick', event => {
      cancelClick();
      if (!('target' in event) || !event.target || !('id' in event.target)) return;
      const id = event.target.id;
      const node = current.current.view.nodes.find(n => n.id === id);
      if (node?.kind === 'group') current.current.onToggle(node);
      else if (node && ['both', 'dblclick'].includes(current.current.trigger)) current.current.onExplore?.(node);
    });
    return () => { cancelClick(); graph.current = null; ready.current = false; drawnView.current = null; lastContext.current = ''; instance.destroy(); };
  }, [layout, frameBeforeEntry]);
  useEffect(() => {
    const instance = graph.current;
    if (!instance) return;
    drawnView.current = null;
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
      lastContext.current = contextId;
      const statesAtRender = current.current.states;
      instance.setData(canvasData(view, positions, center, colors, statesAtRender, layout, display));
      // G6 render starts entry/exit animation and force layout together. Do not await
      // its completion here: the next interaction must be free to interrupt the layout.
      instance.once('afterdraw', () => {
        if (cancelled || graph.current !== instance) return;
        drawnView.current = view;
        if (!dragging.current && current.current.states !== statesAtRender) void instance.setElementState(current.current.states, false);
      });
      void instance.render().then(async () => {
        const host = container.current;
        if (!host || cancelled || graph.current !== instance) return;
        drawnView.current = view;
        if (!dragging.current && statesAtRender !== current.current.states) await instance.setElementState(current.current.states, false);
        if (!frameBeforeEntry) {
          if (changedContext) await frame(instance);
          return;
        }
        if (host.style.visibility !== 'hidden') {
          if (fitUpdates) await frame(instance, true);
          if (!cancelled && graph.current === instance && layout === 'force') await instance.layout({ ...forceLayout, alpha: 0.001, animation: true });
          return;
        }
        await frame(instance, true);
        if (cancelled || graph.current !== instance) return;
        const enableLiveDrag = () => {
          // G6 pre-layout runs without onTick. Start a settled live simulation so
          // restarting it during a drag actually updates the canvas on every tick.
          if (!cancelled && graph.current === instance && layout === 'force') return instance.layout({ ...forceLayout, alpha: 0.001, animation: true });
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          host.style.visibility = 'visible';
          return enableLiveDrag();
        }
        // Animate node positions inside the final frame; keep the camera stationary.
        const end: Record<string, [number, number]> = {};
        const start: Record<string, [number, number]> = {};
        const [cx, cy] = instance.getCanvasByViewport([host.clientWidth / 2, host.clientHeight / 2]);
        for (const { id } of view.nodes) {
          const [x, y] = instance.getElementPosition(id);
          end[id] = [x, y];
          start[id] = [cx + (x - cx) * .65, cy + (y - cy) * .65];
        }
        await instance.translateElementTo(start, false);
        if (cancelled || graph.current !== instance) return;
        host.style.visibility = 'visible';
        host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
        await instance.translateElementTo(end, true);
        await enableLiveDrag();
      }).catch(e => {
        if (!cancelled && graph.current === instance) setError(e instanceof Error ? e.message : '渲染失败');
      });
      if (!cancelled) setError('');
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '画布渲染失败'); });
    return () => { cancelled = true; };
  }, [view, contextId, frameBeforeEntry, fitUpdates, colors, layout, display]);
  useEffect(() => {
    const instance = graph.current;
    if (instance && !dragging.current && drawnView.current === current.current.view) {
      void instance.setElementState(states, false);
    }
  }, [states]);
  useEffect(() => {
    const instance = graph.current;
    if (trackSelection && selectedId && instance && drawnView.current === current.current.view && !dragging.current) {
      void instance.focusElement(selectedId, { duration: 200 });
    }
  }, [selectedId, trackSelection]);
  return <><div ref={container} onContextMenu={onExplore && ['both', 'rightclick'].includes(trigger) ? e => e.preventDefault() : undefined} style={frameBeforeEntry ? { visibility: 'hidden' } : undefined} className="w-full h-full" />{controls && <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, background: 'white', border: '1px solid #e0e8f2', borderRadius: 4, padding: 4 }}>
    <button aria-label="放大图谱" style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.zoomTo(graph.current.getZoom() * 1.2); }}>＋</button>
    <button aria-label="缩小图谱" style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.zoomTo(graph.current.getZoom() / 1.2); }}>−</button>
    <button style={{ padding: '4px 8px' }} onClick={() => { if (graph.current) void graph.current.fitView(); }}>适应画布</button>
  </div>}{error && <div role="alert" className="absolute bottom-4 left-4 bg-background border p-3 text-sm">{error}</div>}</>;
}
