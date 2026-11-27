import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { dimensionsQuery } from './util';

const Preferences = createContext<{ orders: Record<string, string[]>; save: (scope: string, order?: string[]) => void }>({ orders: {}, save: () => {} });

export function AggregationPreferences({ domain, children }: { domain: string; children: ReactNode }) {
  const key = 'deepscope:dimension-order:' + domain;
  const [orders, setOrders] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') ?? {}; } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(orders)); }, [key, orders]);
  const save = (scope: string, order?: string[]) => setOrders(current => {
    const next = { ...current };
    if (order === undefined) delete next[scope]; else next[scope] = order;
    return next;
  });
  return <Preferences.Provider value={{ orders, save }}>{children}</Preferences.Provider>;
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

export function AggregationPanel({ domain, folder }: { domain: string; folder: string }) {
  const panel = useRef<HTMLDetailsElement>(null);
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
    </div>
  </details>;
}
