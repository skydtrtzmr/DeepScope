import { createContext, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { buildCategoryColorMap } from '@/lib/graph-color';
import { dimensionsQuery, useChildren } from './util';

const DEFAULT_EXPANSION_THRESHOLD = '10';

const Preferences = createContext<{ relatedThreshold: string; setRelatedThreshold: (value: string) => void; showFiles: boolean; setShowFiles: (show: boolean) => void; orders: Record<string, string[]>; save: (scope: string, order?: string[]) => void }>({ relatedThreshold: DEFAULT_EXPANSION_THRESHOLD, setRelatedThreshold: () => {}, showFiles: true, setShowFiles: () => {}, orders: {}, save: () => {} });

export function AggregationPreferences({ domain, children }: { domain: string; children: ReactNode }) {
  const key = 'deepscope:dimension-order:' + domain;
  const filesKey = 'deepscope:directory-files:' + domain;
  const thresholdKey = 'deepscope:related-expand-threshold:' + domain;
  const [relatedThreshold, setRelatedThreshold] = useState(() => {
    const saved = localStorage.getItem(thresholdKey);
    return saved && /^\d+$/.test(saved) ? saved : DEFAULT_EXPANSION_THRESHOLD;
  });
  useEffect(() => {
    if (relatedThreshold !== '') localStorage.setItem(thresholdKey, relatedThreshold);
  }, [thresholdKey, relatedThreshold]);
  const [showFiles, setShowFiles] = useState(() => localStorage.getItem(filesKey) !== 'false');
  useEffect(() => { localStorage.setItem(filesKey, String(showFiles)); }, [filesKey, showFiles]);
  const [orders, setOrders] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') ?? {}; } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(orders)); }, [key, orders]);
  const save = (scope: string, order?: string[]) => setOrders(current => {
    const next = { ...current };
    if (order === undefined) delete next[scope]; else next[scope] = order;
    return next;
  });
  return <Preferences.Provider value={{ orders, save, showFiles, setShowFiles, relatedThreshold, setRelatedThreshold }}>{children}</Preferences.Provider>;
}

export function useRelatedExpansionThreshold() {
  const { relatedThreshold } = useContext(Preferences);
  return Number(relatedThreshold || DEFAULT_EXPANSION_THRESHOLD);
}

export function useAggregationOrders() {
  return useContext(Preferences).orders;
}

export function useDirectoryVisibility() {
  const { showFiles, setShowFiles } = useContext(Preferences);
  return { showFiles, setShowFiles };
}

export function useAggregation(domain: string, folder: string, enabled = true) {
  const scope = folder.replace(/^\/+|\/+$/g, '');
  const query = useQuery({ ...dimensionsQuery(domain, scope), enabled });
  const allowed = query.data?.chain ?? [];
  const { orders, save } = useContext(Preferences);
  const saved = orders[scope];
  const order = Array.isArray(saved) ? saved.filter(field => allowed.includes(field)) : allowed;
  return { allowed, order, query, save: (next?: string[]) => save(scope, next) };
}

export function useSubjectColors(domain: string) {
  const { order } = useAggregation(domain, '/');
  const directory = useChildren(domain, '/', order);
  const folders = directory.data?.pages[0]?.folders;
  return useMemo(() => buildCategoryColorMap((folders ?? []).map(f => f.id)), [folders]);
}

export function AggregationPanel({ domain, folder }: { domain: string; folder: string }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const { showFiles, setShowFiles } = useDirectoryVisibility();
  const { relatedThreshold, setRelatedThreshold } = useContext(Preferences);
  const { allowed, order, query, save } = useAggregation(domain, folder);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (panel.current?.open && !panel.current.contains(event.target as Node)) panel.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel.current?.open) {
        panel.current.open = false;
        panel.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  function move(i: number, step: number) {
    const next = [...order];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    save(next);
  }
  return <details ref={panel} className="knowledge-aggregation-panel">
    <summary title="聚合维度"><SlidersHorizontal size={16} aria-hidden="true" /><span className="sr-only">聚合维度</span></summary>
    <div className="knowledge-aggregation-options">
      <div className="aggregation-panel-title">
        <strong>聚合维度</strong>
        <span title={folder}>{folder === '/' ? '根目录' : folder.split('/').pop()}</span>
      </div>
      {query.error ? <p role="alert">{query.error.message}</p> : query.isPending ? <p>正在加载维度…</p> :
        allowed.length === 0 ? <p>工作台尚未配置可用维度。</p> : <>
          <p className="aggregation-panel-hint">从上到下按顺序分组</p>
          <div className="aggregation-field-list">
          {[...order, ...allowed.filter(field => !order.includes(field))].map(field => {
            const i = order.indexOf(field);
            return <div key={field} className="aggregation-field-row">
              <label><input type="checkbox" checked={i >= 0} onChange={e => save(e.target.checked ? [...order, field] : order.filter(f => f !== field))} /> <span>{field}</span></label>
              {i >= 0 && <span className="aggregation-order-actions">
                <button type="button" aria-label={'上移 ' + field} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                <button type="button" aria-label={'下移 ' + field} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
              </span>}
            </div>;
          })}
          </div>
          <div className="aggregation-panel-footer">
            <span>已启用 {order.length} / {allowed.length}</span>
            <button type="button" onClick={() => save()}>恢复默认</button>
          </div>
        </>}
      <label className="aggregation-directory-files">
        <input type="checkbox" checked={showFiles} onChange={e => setShowFiles(e.target.checked)} /> 目录树显示文件
      </label>
      <div className="related-expansion-setting">
        <label htmlFor="related-expansion-threshold">关联页面自动展开阈值</label>
        <input id="related-expansion-threshold" type="number" min={0} step={1} inputMode="numeric"
          value={relatedThreshold} aria-describedby="related-expansion-hint"
          onChange={e => { if (/^\d*$/.test(e.target.value)) setRelatedThreshold(e.target.value); }}
          onBlur={() => { if (relatedThreshold === '') setRelatedThreshold(DEFAULT_EXPANSION_THRESHOLD); }} />
        <small id="related-expansion-hint">关联数低于阈值时展开全部分组，0 表示关闭。</small>
      </div>
    </div>
  </details>;
}
