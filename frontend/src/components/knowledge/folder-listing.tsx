import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { address, Link, useChildren } from './util';
import { DimensionModeView } from './dimensions';

type ViewMode = 'directory' | 'dimension';
const MODE_KEY = 'folder-view-mode';

export function FolderListing({ domain, folderId }: { domain: string; folderId: string }) {
  const children = useChildren(domain, folderId);
  const pages = useMemo(() => children.data?.pages.flatMap(r => r.pages) ?? [], [children.data]);
  const subfolders = children.data?.pages[0]?.folders ?? [];
  const total = children.data?.pages[0]?.page_total ?? 0;
  const remaining = Math.max(0, total - pages.length);
  // 目录/按维度双视图（纯前端切换），选择记忆在 localStorage。
  const [mode, setMode] = useState<ViewMode>(() => localStorage.getItem(MODE_KEY) === 'dimension' ? 'dimension' : 'directory');
  useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);

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

      <div className="dim-view-toggle" role="tablist" aria-label="目录视图切换">
        <button type="button" role="tab" aria-selected={mode === 'directory'} className={mode === 'directory' ? 'active' : undefined} onClick={() => setMode('directory')}>目录</button>
        <button type="button" role="tab" aria-selected={mode === 'dimension'} className={mode === 'dimension' ? 'active' : undefined} onClick={() => setMode('dimension')}>按维度</button>
      </div>

      {mode === 'dimension' ? (
        <DimensionModeView domain={domain} folderId={folderId} />
      ) : <>
        {subfolders.length > 0 && (
          <section className="folder-group">
            <h3 className="folder-group-title">子目录</h3>
            <div className="subfolder-list">
              {subfolders.map(f => (
                <Link key={f.id} domain={domain} to={address(domain, f.id, true)} className="subfolder-link">
                  <Folder size={14} />{f.title}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="page-list">
          <h3 className="page-list-title">页面{total > 0 ? `（${total}）` : ''}</h3>
          <ul className="page-list-ul">
            {pages.map(p => (
              <li key={p.id} className="page-item">
                <time className="page-date">{p.date ?? ''}</time>
                <Link domain={domain} to={address(domain, p.id)} className="page-item-title">{p.title}</Link>
                {p.tags && p.tags.length > 0 && <span className="page-tags">{p.tags.join(' · ')}</span>}
              </li>
            ))}
          </ul>
          {pages.length === 0 && !children.isLoading && <p className="page-list-empty">此目录暂无子页面。</p>}
          {remaining > 0 && (
            <button type="button" className="dir-load-more" onClick={() => children.fetchNextPage()} disabled={children.isFetchingNextPage}>
              {children.isFetchingNextPage ? '加载中…' : `加载更多（${remaining}）`}
            </button>
          )}
        </section>
      </>}
    </div>
  );
}
