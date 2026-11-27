import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, Layers } from 'lucide-react';
import { address, classificationAddress, Link, useChildren, type DimensionPath, type Folder as FolderNode, type Page } from './util';

import { useAggregation, useDirectoryVisibility } from './aggregation-preferences';

const ActiveClassification = createContext<{ folder: string | null; path: DimensionPath }>({ folder: null, path: [] });

const storageKey = (domain: string) => `deepscope:dir-open:${domain}`;

function loadOpen(domain: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(domain)) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function ancestors(folder: string): string[] {
  const parts: string[] = [];
  let current = folder;
  while (current && current !== '/') {
    parts.push(current);
    const next = current.slice(0, current.lastIndexOf('/')) || '/';
    current = next;
  }
  return parts;
}

interface BranchProps {
  domain: string;
  folder: FolderNode;
  depth: number;
  openSet: Set<string>;
  onToggle: (id: string) => void;
  activeFolder: string | null;
  activePage: string | null;
  isFolderPage: boolean;
}

function FolderBranch({ domain, folder, depth, openSet, onToggle, activeFolder, activePage, isFolderPage }: BranchProps) {
  const { showFiles } = useDirectoryVisibility();
  const open = openSet.has(folder.id);
  const { order } = useAggregation(domain, folder.id, open);
  const children = useChildren(domain, folder.id, order, [], open);
  const subfolders = children.data?.pages[0]?.folders ?? [];
  const pages = useMemo(() => children.data?.pages.flatMap(r => r.pages) ?? [], [children.data]);
  const total = children.data?.pages[0]?.page_total ?? 0;
  const remaining = Math.max(0, total - pages.length);

  return (
    <>
      <div className="dir-row" style={{ paddingLeft: depth * 14 }}>
        <button type="button" className="dir-chevron" aria-expanded={open} onClick={() => onToggle(folder.id)} aria-label={open ? '折叠目录' : '展开目录'}>
          <ChevronRight size={15} strokeWidth={2.4} className={open ? 'dir-chevron-open' : undefined} />
        </button>
        <Link domain={domain} to={address(domain, folder.id, true)} className="dir-link dir-link-folder dir-row-link" aria-current={isFolderPage && activeFolder === folder.id ? 'page' : undefined}>
          <Folder className="dir-icon" size={15} aria-hidden="true" /><span>{folder.title}</span>
        </Link>
      </div>
      {open && (
        <div className="dir-children" style={{ '--dir-guide': `${depth * 14 + 9}px` } as React.CSSProperties}>
          {subfolders.map(f => (
            <FolderBranch key={f.id} domain={domain} folder={f} depth={depth + 1} openSet={openSet} onToggle={onToggle} activeFolder={activeFolder} activePage={activePage} isFolderPage={isFolderPage} />
          ))}
          {children.data?.pages[0]?.groups?.map(g => <GroupBranch key={g.value} {...{ domain, order, activePage, isFolderPage }} folder={folder.id} branch={[g.value]} count={g.count} depth={depth + 1} />)}
          {showFiles && pages.map(p => (
            <PageRow key={p.id} domain={domain} page={p} depth={depth + 1} activePage={activePage} isFolderPage={isFolderPage} />
          ))}
          {showFiles && remaining > 0 && (
            <button type="button" className="dir-load-more" style={{ paddingLeft: (depth + 1) * 14 + 16 }} onClick={() => children.fetchNextPage()} disabled={children.isFetchingNextPage}>
              {children.isFetchingNextPage ? '加载中…' : `加载更多（${remaining}）`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function GroupBranch({ domain, folder, order, branch, count, depth, activePage, isFolderPage }: {
  domain: string; folder: string; order: string[]; branch: string[]; count: number;
  depth: number; activePage: string | null; isFolderPage: boolean;
}) {
  const { showFiles } = useDirectoryVisibility();
  const active = useContext(ActiveClassification);
  const path: DimensionPath = branch.map((value, i) => [order[i], value]);
  const ancestor = active.folder === folder && path.every(([field, value], i) =>
    active.path[i]?.[0] === field && active.path[i]?.[1] === value);
  const current = ancestor && active.path.length === path.length;
  const revealChild = ancestor && !current;
  const [open, setOpen] = useState(revealChild);
  useEffect(() => { if (revealChild) setOpen(true); }, [revealChild]);
  const children = useChildren(domain, folder, order, branch, open);
  const data = children.data?.pages[0];
  return <>
    <div className="dir-row dir-group-row" style={{ paddingLeft: depth * 14 }}>
      <button type="button" className="dir-chevron" aria-label={(open ? '收起 ' : '展开 ') + branch[branch.length - 1]} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={15} className={open ? 'dir-chevron-open' : undefined} />
      </button>
      <Link domain={domain} to={classificationAddress(domain, folder, path)} className="dir-link dir-row-link" aria-current={current ? 'page' : undefined}>
        <Layers className="dir-icon dir-group-icon" size={14} aria-hidden="true" />
        <span>{branch[branch.length - 1]}</span>
        <span className="dir-group-count" aria-label={count + ' 个条目'}>{count}</span>
      </Link>
    </div>
    {open && <div className="dir-children" style={{ '--dir-guide': `${depth * 14 + 9}px` } as React.CSSProperties}>
      {children.error && <p role="alert">{children.error.message}</p>}
      {data?.groups?.map(g => <GroupBranch key={g.value} {...{ domain, folder, order, activePage, isFolderPage }} branch={[...branch, g.value]} count={g.count} depth={depth + 1} />)}
      {showFiles && children.data?.pages.flatMap(batch => batch.pages).map(page => <PageRow key={page.id} {...{ domain, page, activePage, isFolderPage }} depth={depth + 1} />)}
      {showFiles && children.hasNextPage && <button className="dir-load-more" disabled={children.isFetchingNextPage} onClick={() => children.fetchNextPage()}>加载更多</button>}
    </div>}
  </>;
}

function PageRow({ domain, page, depth, activePage, isFolderPage }: { domain: string; page: Page; depth: number; activePage: string | null; isFolderPage: boolean }) {
  return (
    <div className="dir-row" style={{ paddingLeft: depth * 14 }}>
      <span className="dir-chevron-placeholder" />
      <FileText className="dir-icon" size={15} />
      <Link domain={domain} to={address(domain, page.id)} className="dir-link" aria-current={!isFolderPage && activePage === page.id ? 'page' : undefined}>{page.title}</Link>
    </div>
  );
}

export function DirectoryTree({ domain, activeFolder, activePage, isFolderPage, activePath }: { activePath: DimensionPath; domain: string; activeFolder: string | null; activePage: string | null; isFolderPage: boolean }) {
  const [openSet, setOpenSet] = useState<Set<string>>(() => loadOpen(domain));
  const { order } = useAggregation(domain, '/');
  const { showFiles } = useDirectoryVisibility();
  const root = useChildren(domain, '/', order);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey(domain), JSON.stringify([...openSet]));
  }, [openSet, domain]);

  // Auto-expand the ancestors of the folder currently being viewed.
  useEffect(() => {
    if (!activeFolder) return;
    const need = ancestors(activeFolder).slice(isFolderPage ? 1 : 0);
    setOpenSet(prev => {
      if (need.every(id => prev.has(id))) return prev;
      const next = new Set(prev);
      need.forEach(id => next.add(id));
      return next;
    });
  }, [activeFolder, isFolderPage]);

  // Keep the current item in view after the tree re-renders.
  useEffect(() => {
    const current = container.current?.querySelector('[aria-current]');
    if (current) (current as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [activePage, activeFolder]);

  const toggle = (id: string) => setOpenSet(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const rootFolders = root.data?.pages[0]?.folders ?? [];
  const rootPages = useMemo(() => root.data?.pages.flatMap(r => r.pages) ?? [], [root.data]);
  const rootTotal = root.data?.pages[0]?.page_total ?? 0;
  const rootRemaining = Math.max(0, rootTotal - rootPages.length);

  return (
    <ActiveClassification.Provider value={{ folder: activeFolder, path: activePath }}><div ref={container} className="dir-tree" aria-label="知识目录">
      {rootFolders.map(f => (
        <FolderBranch key={f.id} domain={domain} folder={f} depth={0} openSet={openSet} onToggle={toggle} activeFolder={activeFolder} activePage={activePage} isFolderPage={isFolderPage} />
      ))}
      {root.data?.pages[0]?.groups?.map(g => <GroupBranch key={g.value} {...{ domain, order, activePage, isFolderPage }} folder="/" branch={[g.value]} count={g.count} depth={0} />)}
      {showFiles && rootPages.map(p => (
        <PageRow key={p.id} domain={domain} page={p} depth={0} activePage={activePage} isFolderPage={isFolderPage} />
      ))}
      {showFiles && rootRemaining > 0 && (
        <button type="button" className="dir-load-more" style={{ paddingLeft: 16 }} onClick={() => root.fetchNextPage()} disabled={root.isFetchingNextPage}>
          {root.isFetchingNextPage ? '加载中…' : `加载更多（${rootRemaining}）`}
        </button>
      )}
    </div></ActiveClassification.Provider>
  );
}
