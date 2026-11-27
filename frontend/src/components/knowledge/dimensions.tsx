import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExplorerCanvas } from '../aggregate/aggregation-explorer';
import { ClassificationContents } from './folder-listing';
import type { Projection, ViewNode } from '@/lib/aggregation/explorer';
import { address, classificationAddress, dimensionAddress, dimensionValueQuery, Link, navigate, type DimensionPath } from './util';


/** scope 转展示名：取路径最后一段（“任务/年度” → “年度”）。 */
function scopeTitle(scope: string): string {
  return scope.split('/').filter(Boolean).pop() ?? scope;
}

/** 维度值页：计数 + scope 说明（含清除）+ 关系子图 + 按目录分组的实体列表。 */
export function DimensionValue({ domain, field, value, scope, path, matchFirstAny = false }: { domain: string; field: string; value: string; scope: string; path: DimensionPath; matchFirstAny?: boolean }) {
  const query = useQuery(dimensionValueQuery(domain, field, value, scope, path, matchFirstAny));
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
      {path.length > 0 && <nav className="breadcrumb" aria-label="分类路径">
        <Link domain={domain} to={address(domain, scope ? '/' + scope : '/', true)}>{scope || '根目录'}</Link>
        {path.map(([key, entry], i) => <span key={i} className="breadcrumb-seg">
          <span aria-hidden="true">›</span>
          {i === path.length - 1 ? <span aria-current="page">{key} · {entry}</span> :
            <Link domain={domain} to={classificationAddress(domain, scope, path.slice(0, i + 1), matchFirstAny)}>{key} · {entry}</Link>}
        </span>)}
      </nav>}
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
            {data.subgraph.truncated && <span className="dim-truncated">图谱展示前 {data.subgraph.nodes.length} 个节点</span>}
          </div>

          {data.count > 0 && (
            <div className="graph-outer dim-subgraph">
              <div className="knowledge-graph">
                <ExplorerCanvas
                  frameBeforeEntry
                  key={JSON.stringify([domain, field, value, scope, path])}
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
            {path.length > 0 ? (
              <ClassificationContents domain={domain} folderId={scope ? '/' + scope : '/'} path={path} matchFirstAny={matchFirstAny} />
            ) : data.groups.map(group => (
              <section className="dim-group" key={group.folder}>
                <h3 className="dim-group-title">
                  {group.title}
                  <span className="dim-group-count">{group.pages.length}</span>
                </h3>
                <ClassificationContents domain={domain} folderId={group.folder} path={[[field, value]]} matchFirstAny />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
