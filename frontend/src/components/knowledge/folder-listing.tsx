import { useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { address, classificationAddress, Link, useChildren, type DimensionPath } from './util';
import { useAggregation } from './aggregation-preferences';

export function FolderListing({ domain, folderId }: { domain: string; folderId: string }) {
  const { order, query } = useAggregation(domain, folderId);
  const segments = folderId.split('/').filter(Boolean);

  return (
    <div className="folder-listing">
      {segments.length > 0 && (
        <nav className="breadcrumb" aria-label="面包屑">
          <Link domain={domain} to={address(domain, '/', true)}>首页</Link>
          {segments.map((seg, i) => {
            const id = '/' + segments.slice(0, i + 1).join('/');
            return (
              <span className="breadcrumb-seg" key={id}>
                <ChevronRight size={13} />
                <Link domain={domain} to={address(domain, id, true)} aria-current={i === segments.length - 1 ? 'page' : undefined}>{seg}</Link>
              </span>
            );
          })}
        </nav>
      )}

      {!query.isPending && <FolderContents domain={domain} folderId={folderId} order={order} path={[]} />}
    </div>
  );
}

export function ClassificationContents({ domain, folderId, path, matchFirstAny = false }: {
  domain: string; folderId: string; path: DimensionPath; matchFirstAny?: boolean;
}) {
  const { order, query } = useAggregation(domain, folderId);
  if (query.isPending) return <p>正在读取分类…</p>;
  return <div className="folder-listing">
    <FolderContents {...{ domain, folderId, order, path, matchFirstAny }} />
  </div>;
}

function FolderContents({ domain, folderId, order, path, matchFirstAny = false }: {
  domain: string; folderId: string; order: string[]; path: DimensionPath; matchFirstAny?: boolean;
}) {
  const children = useChildren(domain, folderId, order, [], true, path, matchFirstAny);
  const first = children.data?.pages[0];
  const pages = children.data?.pages.flatMap(batch => batch.pages) ?? [];
  const field = order.find(key => !path.some(([used]) => used === key));
  if (children.error) return <p role="alert">{children.error.message}</p>;
  if (!first) return <p>正在读取目录…</p>;
  return <>
    {first.folders.length > 0 && <section className="folder-group">
      <h3 className="folder-group-title">子目录</h3>
      <div className="subfolder-list">{first.folders.map(folder => <Link key={folder.id} domain={domain}
        to={address(domain, folder.id, true)} className="subfolder-link"><Folder size={14} />{folder.title}</Link>)}</div>
    </section>}
    {field && first.groups?.map(group => {
      const next: DimensionPath = [...path, [field, group.value]];
      return <ClassificationCard key={classificationAddress(domain, folderId, next, matchFirstAny)} {...{ domain, folderId, order, matchFirstAny }} path={next} count={group.count} />;
    })}
    {pages.length > 0 && <section className="page-list">
      <h3 className="page-list-title">本层文档（{first.page_total}）</h3>
      <ul className="page-list-ul">{pages.map(page => <li key={page.id} className="page-item">
        <time className="page-date">{page.date ?? ''}</time>
        <Link domain={domain} to={address(domain, page.id)} className="page-item-title">{page.title}</Link>
      </li>)}</ul>
      {children.hasNextPage && <button type="button" className="dir-load-more" disabled={children.isFetchingNextPage}
        onClick={() => children.fetchNextPage()}>加载更多</button>}
    </section>}
    {!first.folders.length && !first.groups?.length && !pages.length && <p className="page-list-empty">此目录暂无文档。</p>}
  </>;
}

function ClassificationCard({ domain, folderId, order, path, count, matchFirstAny }: {
  domain: string; folderId: string; order: string[]; path: DimensionPath; count: number; matchFirstAny: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [field, value] = path[path.length - 1];
  return <details className="folder-classification" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><span>{field} · {value}</span><span className="dir-group-count">{count}</span></summary>
    {open && <div className="folder-classification-body">
      <Link domain={domain} to={classificationAddress(domain, folderId, path, matchFirstAny)}>打开分类页 ↗</Link>
      <FolderContents {...{ domain, folderId, order, path, matchFirstAny }} />
    </div>}
  </details>;
}
