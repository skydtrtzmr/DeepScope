import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExplorerCanvas } from '../aggregate/aggregation-explorer';
import type { Projection, ViewNode } from '@/lib/aggregation/explorer';
import { address, dimensionAddress, dimensionValueQuery, dimensionsQuery, Link, navigate } from './util';

/** scope 转展示名：取路径最后一段（“任务/年度” → “年度”）。 */
function scopeTitle(scope: string): string {
  return scope.split('/').filter(Boolean).pop() ?? scope;
}

/** 目录页「按维度」模式：聚合链逐字段分组，组卡 = 维度值 + 计数，点击进维度值页。 */
export function DimensionModeView({ domain, folderId }: { domain: string; folderId: string }) {
  const scope = folderId.replace(/^\/+|\/+$/g, '');
  const query = useQuery(dimensionsQuery(domain, scope));
  if (query.isLoading) return <p className="dim-status">正在统计维度分组…</p>;
  if (query.error) return <p role="alert">{(query.error as Error).message}</p>;
  if (!query.data?.fields.length) return <p className="dim-status">此目录暂无可用的维度配置。</p>;
  return (
    <div className="dim-groups">
      {query.data.fields.map(({ field, values }) => (
        <section className="dim-field" key={field}>
          <h3 className="dim-field-title">
            {field}
            <span className="dim-field-count">{values.length} 组</span>
          </h3>
          <div className="dim-value-list">
            {values.map(entry => (
              <Link
                key={entry.value}
                domain={domain}
                to={dimensionAddress(domain, field, entry.value, scope)}
                className="dim-value-card"
              >
                <span className="dim-value-name">{entry.value}</span>
                <span className="dim-value-count">{entry.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 维度值页：计数 + scope 说明（含清除）+ 关系子图 + 按目录分组的实体列表。 */
export function DimensionValue({ domain, field, value, scope }: { domain: string; field: string; value: string; scope: string }) {
  const query = useQuery(dimensionValueQuery(domain, field, value, scope));
  const [selected, select] = useState<string | null>(null);
  const data = query.data;

  const view = useMemo<Projection>(() => {
    if (!data) return { nodes: [], edges: [], total: 0, rootId: '' };
    const nodes = data.subgraph.nodes.map(n => ({
      id: n.id, label: n.title, kind: 'entity' as const, depth: 1,
      entity: { id: n.id, label: n.title, type: 'entity', properties: {} },
    }));
    const edges = data.subgraph.edges.map(e => ({
      id: JSON.stringify([e.source, e.target]), source: e.source, target: e.target, kind: 'relation' as const,
    }));
    return { nodes, edges, total: nodes.length, rootId: '' };
  }, [data]);

  const selectedNode = data && selected ? view.nodes.find(n => n.id === selected) : undefined;

  return (
    <div className="dim-value">
      <h1 className="page-title">
        {value}
        <span className="dim-field-badge">{field}</span>
      </h1>
      {query.error ? <p role="alert">{(query.error as Error).message}</p> : !data ? (
        <p className="dim-status">正在统计维度值…</p>
      ) : (
        <>
          <div className="dim-filter-bar">
            <span>共 {data.count} 个实体</span>
            {scope && (
              <span className="dim-scope-chip">
                来自 {scopeTitle(scope)}
                <button type="button" aria-label="清除范围" onClick={() => navigate(dimensionAddress(domain, field, value))}>×</button>
              </span>
            )}
            {data.subgraph.truncated && <span className="dim-truncated">子图过大，仅展示前 300 个节点</span>}
          </div>

          {data.count > 0 && (
            <div className="graph-outer dim-subgraph">
              <div className="knowledge-graph">
                <ExplorerCanvas
                  contextId={domain + ':dim:' + field + ':' + value + ':' + scope}
                  view={view}
                  selectedId={selected}
                  onSelect={(node: ViewNode) => select(node.id)}
                  onToggle={(node: ViewNode) => node.kind === 'entity' && navigate(address(domain, node.id))}
                  onClear={() => select(null)}
                />
              </div>
            </div>
          )}
          {selectedNode && (
            <p className="dim-selected-hint">
              已选中「{selectedNode.label}」，双击节点或
              <Link domain={domain} to={address(domain, selectedNode.id)}>打开页面</Link>
            </p>
          )}

          <div className="dim-group-list">
            {data.groups.map(group => (
              <section className="dim-group" key={group.folder}>
                <h3 className="dim-group-title">
                  {group.title}
                  <span className="dim-group-count">{group.pages.length}</span>
                </h3>
                <ul className="dim-pages">
                  {group.pages.map(p => (
                    <li key={p.id} className="dim-page">
                      <time className="dim-page-date">{p.date ?? ''}</time>
                      <Link domain={domain} to={address(domain, p.id)} className="dim-page-title">{p.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
