import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExplorerCanvas } from '../graph/explorer-canvas';
import { useAggregationOrders, useSubjectColors } from './aggregation-preferences';
import { ClassificationContents } from './folder-listing';
import type { Projection, ViewNode } from '@/types/graph-view';
import { address, base, classificationAddress, dimensionAddress, dimensionValueQuery, Link, navigate, read, subjectKey, type DimensionPath, type ScopeGraphResponse } from './util';


/** scope 转展示名：取路径最后一段（“任务/年度” → “年度”）。 */
function scopeTitle(scope: string): string {
  return scope.split('/').filter(Boolean).pop() ?? scope;
}

function ScopeGraph({ data, domain, contextId, path, matchFirstAny }: {
  data: ScopeGraphResponse; domain: string; contextId: string; path: DimensionPath; matchFirstAny: boolean;
}) {
  const colors = useSubjectColors(domain);
  const [selected, select] = useState<string | null>(null);

  const view = useMemo<Projection>(() => {
    const nodes: ViewNode[] = data.subgraph.nodes.map(n => n.classification ? ({
      id: n.id, label: n.title + '（' + n.classification.count + '）',
      kind: 'group', depth: 1, count: n.classification.count,
    }) : ({
      id: n.id, label: n.title, kind: 'entity', depth: 1,
      entity: { id: n.id, label: n.title, type: subjectKey(n), properties: {} },
    }));
    const edges = data.subgraph.edges.map(e => ({
      id: JSON.stringify([e.source, e.target]), source: e.source, target: e.target, kind: 'relation' as const,
    }));
    return { nodes, edges, total: nodes.length, rootId: '' };
  }, [data]);

  const selectedNode = selected ? view.nodes.find(n => n.id === selected) : undefined;

  function nodeAddress(node: ViewNode) {
    const group = data.subgraph.nodes.find(n => n.id === node.id)?.classification;
    return group ? classificationAddress(domain, group.folder,
      [...path, [group.field, group.value]], matchFirstAny) : address(domain, node.id);
  }

  return <>
    {data.count > 0 && (
      <div className="graph-outer dim-subgraph">
        <div className="knowledge-graph">
          <ExplorerCanvas
            categoryColors={colors} frameBeforeEntry
            key={contextId}
            contextId={contextId}
            view={view}
            selectedId={selected}
            onSelect={(node: ViewNode) => select(node.id)}
            onToggle={node => navigate(nodeAddress(node))}
            onClear={() => select(null)}
          />
        </div>
      </div>
    )}
    {data.subgraph.nodes.some(node => node.classification) && <p className="dim-status">图谱覆盖 {data.subgraph.represented ?? data.subgraph.nodes.length} / {data.count} 个实体</p>}
    {selectedNode && (
      <p className="dim-selected-hint">
        已选中「{selectedNode.label}」 · <Link domain={domain} to={nodeAddress(selectedNode)}>{selectedNode.kind === 'group' ? '打开子分类' : '打开页面'}</Link>
      </p>
    )}
  </>;
}

export function FolderScopeGraph({ domain, folderId }: { domain: string; folderId: string }) {
  const orders = useAggregationOrders();
  const params = new URLSearchParams({ folder: folderId, graph_orders: JSON.stringify(orders) });
  const query = useQuery({
    queryKey: ['folder-graph', domain, folderId, orders],
    queryFn: ({ signal }) => read<ScopeGraphResponse>(base + '/' + encodeURIComponent(domain) + '/folder-graph?' + params, signal),
  });
  if (!query.data && !query.error) return null;
  if (query.data?.count === 0) return null;
  return <section aria-label="范围图谱" className="folder-scope-graph">
    <h2 className="folder-group-title">范围图谱</h2>
    {query.error ? <p role="alert">{query.error.message}</p> : query.data && <>
      {query.data.subgraph.truncated && <p className="dim-truncated">图谱展示前 {query.data.subgraph.nodes.length} 个节点</p>}
      <ScopeGraph data={query.data} domain={domain} contextId={JSON.stringify([domain, folderId, orders])} path={[]} matchFirstAny={false} />
    </>}
  </section>;
}

/** 维度值页：计数 + scope 说明（含清除）+ 关系子图 + 按目录分组的实体列表。 */
export function DimensionValue({ domain, field, value, scope, path, matchFirstAny = false }: { domain: string; field: string; value: string; scope: string; path: DimensionPath; matchFirstAny?: boolean }) {
  const orders = useAggregationOrders();
  const query = useQuery(dimensionValueQuery(domain, field, value, scope, path, matchFirstAny, orders));
  const data = query.data;
  return (
    <div className="dim-value">
      {path.length > 0 && <nav className="breadcrumb" aria-label="分类路径">
        <Link domain={domain} to={address(domain, scope ? '/' + scope : '/', true)}>{scope || '根目录'}</Link>
        {path.map(([key, entry], i) => <span key={i} className="breadcrumb-seg">
          <span aria-hidden="true">›</span>
          {i === path.length - 1 ? <span aria-current="page">{entry} <span className="classification-field">{key}</span></span> :
            <Link domain={domain} to={classificationAddress(domain, scope, path.slice(0, i + 1), matchFirstAny)}>{entry} <span className="classification-field">{key}</span></Link>}
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

          <ScopeGraph data={data} domain={domain} contextId={JSON.stringify([domain, field, value, scope, path, orders])}
            path={path.length ? path : [[field, value]]} matchFirstAny={!path.length || matchFirstAny} />

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
