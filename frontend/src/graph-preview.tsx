import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExplorerCanvas } from './components/graph/explorer-canvas';
import { aggregateLocalGraph, MEMBER_PAGE_SIZE, type LocalGraph } from './lib/local-aggregation';
import type { ViewNode } from './types/graph-view';
import './index.css';

function Preview() {
  const [graph, setGraph] = useState<LocalGraph | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState('');
  const context = useRef('');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'knowledge-graph:data') return;
      const next = event.data.view as LocalGraph;
      if (context.current !== next.rootId) {
        context.current = next.rootId;
        setExpanded(new Set()); setLimits({}); setSelected('');
      }
      setGraph(next);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') window.parent.postMessage({ type: 'knowledge-graph:close' }, location.origin); };
    window.addEventListener('keydown', escape);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'knowledge-graph:ready' }, location.origin);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('keydown', escape); };
  }, []);
  const view = useMemo(() => graph && aggregateLocalGraph(graph, expanded, limits), [graph, expanded, limits]);
  const group = graph?.groups?.find(item => item.id === selected) ?? graph?.groups?.[0];
  const shown = group && view?.nodes.find(node => node.id === group.id)?.shown || 0;
  const toggle = (node: Pick<ViewNode, 'id'>) => {
    setSelected(node.id);
    setExpanded(old => { const next = new Set(old); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
  };
  return <main style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {view && <ExplorerCanvas controls selectedId={selected || null} onClear={() => setSelected('')} view={view} contextId={view.rootId} onToggle={toggle} onSelect={node => {
        setSelected(node.id);
        if (node.kind !== 'group' && node.id !== view.rootId) window.parent.postMessage({ type: 'knowledge-graph:select', id: node.id }, location.origin);
      }} />}
    </div>
    {group && <section style={{ padding: '6px 8px', borderTop: '1px solid #e0e8f2', fontSize: 12, background: 'white' }}>
      <select aria-label="关系分组" value={group.id} onChange={event => setSelected(event.target.value)} style={{ width: '100%', border: '1px solid #e0e8f2', padding: 3 }}>
        {graph?.groups?.map(item => <option key={item.id} value={item.id}>{item.label} · {item.total}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        <button onClick={() => toggle(group)}>{expanded.has(group.id) ? '收起分组' : '展开分组'}</button>
        {expanded.has(group.id) && shown < new Set(group.memberIds).size && <button onClick={() => setLimits(old => ({ ...old, [group.id]: shown + MEMBER_PAGE_SIZE }))}>加载更多</button>}
        <span>已展示 {shown} / {group.total}</span>
      </div>
      {group.total > new Set(group.memberIds).size && <p style={{ margin: '4px 0 0', color: '#667b95' }}>当前载入 {new Set(group.memberIds).size} 条，其余记录尚未载入。</p>}
    </section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
