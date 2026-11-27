import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, createElement, type ReactNode } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root, Parent, PhrasingContent } from 'mdast';
import { ExplorerCanvas } from '../aggregate/aggregation-explorer';
import type { Projection, ViewNode } from '@/lib/aggregation/explorer';
import {
  address, backlinksQuery, base, dimensionAddress, dimensionsQuery, fresh, isFolderPath, Link, navigate, neighborsQuery, pageQuery,
  read, resolvePageId, restoreScroll, useLocation, type Body,
} from './util';
import { DirectoryTree } from './directory-tree';
import { FolderListing } from './folder-listing';
import { DimensionValue } from './dimensions';
import { SearchButton, SearchOverlay } from './search';
import './snapshot-reader.css';

type TocEntry = { depth: number; text: string; id: string };

// Visible text of a Markdown heading line, without inline markers.
function inlineText(line: string): string {
  return line
    .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_m, url: string, label?: string) => label ?? url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

// A page title heading is rendered separately, so drop a matching leading Markdown H1,
// exactly as the Quartz page renderer does.
function stripTitle(source: string, title: string): string {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const match = lines[i].match(/^#\s+(.+?)\s*#*\s*$/);
    if (match && inlineText(match[1]) === title.trim()) {
      lines.splice(i, 1);
      return lines.join('\n');
    }
    return source;
  }
  return source;
}

// Table of contents entries plus the heading-text -> anchor-id map used when rendering headings.
function buildToc(source: string): { entries: TocEntry[]; ids: Map<string, string> } {
  const entries: TocEntry[] = [];
  const ids = new Map<string, string>();
  const used = new Set<string>();
  let fence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = inlineText(match[2]);
    if (!text) continue;
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'h';
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    entries.push({ depth: match[1].length, text, id });
    ids.set(text, id);
  }
  return { entries, ids };
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  return '';
}

// Convert Wiki links in Markdown text nodes, preserving fenced code and inline code.
function wikiLinks() {
  return (tree: Root) => {
    function walk(parent: Parent) {
      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i];
        if (node.type === 'link' || node.type === 'linkReference') continue;
        if ('children' in node) { walk(node); continue; }
        if (node.type !== 'text') continue;
        const parts: PhrasingContent[] = [];
        let end = 0;
        for (const match of node.value.matchAll(/\[\[([^\[\]\n]+)\]\]/g)) {
          const [url, label] = match[1].split('|');
          parts.push({ type: 'text', value: node.value.slice(end, match.index) }, { type: 'link', url: url.trim(), children: [{ type: 'text', value: label || url }] });
          end = match.index! + match[0].length;
        }
        if (parts.length) {
          parts.push({ type: 'text', value: node.value.slice(end) });
          parent.children.splice(i, 1, ...parts);
          i += parts.length - 1;
        }
      }
    }
    walk(tree);
  };
}
const remarkPlugins = [remarkGfm, wikiLinks];

function Chart({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setError('');
    async function draw() {
      const option = JSON.parse(source);
      if (!option || typeof option !== 'object' || Array.isArray(option)) throw new Error('配置应为 JSON 对象');
      const echarts = await import('echarts');
      if (disposed || !host.current) return;
      const chart = echarts.init(host.current);
      const observer = new ResizeObserver(() => chart.resize());
      cleanup = () => { observer.disconnect(); chart.dispose(); };
      chart.setOption(option);
      observer.observe(host.current);
    }
    draw().catch(e => { if (!disposed) setError(String(e.message)); });
    return () => { disposed = true; cleanup(); };
  }, [source]);
  return <figure>{error && <p role="alert">图表配置错误 · {error}</p>}<div hidden={!!error} ref={host} className="knowledge-chart" aria-label="ECharts 图表" /></figure>;
}

// Markdown parsing is the costliest render step: skip it unless the text or link resolution changes.
const Article = memo(function Article({ source, domain, link, ids }: { source: string; domain: string; link: (href: string) => string; ids: Map<string, string> }) {
  const heading = (tag: string) => ({ children }: { children?: ReactNode }) =>
    createElement(tag, { id: ids.get(textOf(children)) }, children);
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={{
    h1: heading('h1'), h2: heading('h2'), h3: heading('h3'), h4: heading('h4'),
    a: ({ href, children }) => <Link domain={domain} to={link(href || '')}>{children}</Link>,
    pre: ({ node, children }) => {
      const code = node?.children[0];
      if (code?.type === 'element' && code.tagName === 'code' && Array.isArray(code.properties.className) && code.properties.className.includes('language-echarts')) {
        return <Chart source={code.children.map(c => c.type === 'text' ? c.value : '').join('')} />;
      }
      return <pre>{children}</pre>;
    },
  }}>{source}</ReactMarkdown>;
});

// Local graph, top of the right sidebar (Quartz graph widget).
// Neighbours are aggregated (not filtered): grouped into one node per value of the
// aggregation chain's first field; a group click jumps to the dimension-value page.
function Related({ domain, page }: { domain: string; page: Body }) {
  const [selected, select] = useState<string | null>(null);
  const query = useInfiniteQuery(neighborsQuery(domain, page.id));
  useEffect(() => { select(null); }, [page.id]);
  const scope = (page.folder_id ?? '/').replace(/^\/+|\/+$/g, '');
  const dims = useQuery({ ...dimensionsQuery(domain, scope), enabled: query.data !== undefined });
  const chainField = dims.data?.chain?.[0];
  const GROUP_PREFIX = 'dim-group:';

  const view = useMemo<Projection>(() => {
    const pages = query.data?.pages ?? [];
    const neighbors = pages.flatMap(p => p.nodes);
    const nodes: ViewNode[] = [{
      id: page.id, label: page.title, kind: 'entity', depth: 0,
      entity: { id: page.id, label: page.title, type: page.type, properties: {} },
    }];
    const edges: Projection['edges'] = [];
    if (!chainField) {
      for (const n of neighbors) nodes.push({
        id: n.id, label: n.title, kind: 'entity', depth: 1,
        entity: { id: n.id, label: n.title, type: n.type, properties: {} },
      });
      return { nodes, edges: pages.flatMap(p => p.edges).map(e => ({ ...e, id: JSON.stringify([e.source, e.target, e.type]), kind: 'relation' as const })), total: nodes.length, rootId: page.id };
    }
    const buckets = new Map<string, Body[]>();
    const loose: Body[] = [];
    for (const n of neighbors) {
      const raw = n.frontmatter?.[chainField];
      const value = Array.isArray(raw) ? raw.find(v => v != null && v !== '') : raw;
      const key = value == null || value === '' ? null : String(value);
      if (key == null) loose.push(n);
      else buckets.set(key, [...(buckets.get(key) ?? []), n]);
    }
    for (const [key, members] of buckets) {
      const id = GROUP_PREFIX + JSON.stringify([chainField, key]);
      nodes.push({ id, label: `${key} · ${members.length}`, kind: 'group', count: members.length,
        depth: 1, parentId: page.id, memberIds: members.map(m => m.id) });
      edges.push({ id: JSON.stringify(['membership', page.id, id]), source: page.id, target: id, kind: 'membership' });
    }
    for (const n of loose) nodes.push({
      id: n.id, label: n.title, kind: 'entity', depth: 1, parentId: page.id,
      entity: { id: n.id, label: n.title, type: n.type, properties: {} },
    });
    const visible = new Set(nodes.map(n => n.id));
    for (const e of pages.flatMap(p => p.edges)) {
      if (visible.has(e.source) && visible.has(e.target)) {
        edges.push({ ...e, id: JSON.stringify([e.source, e.target, e.type]), kind: 'relation' });
      }
    }
    return { nodes, edges, total: nodes.length, rootId: page.id };
  }, [query.data, page, chainField]);

  const openGroup = (node: ViewNode) => {
    if (node.kind !== 'group' || !chainField) return;
    const value = JSON.parse(node.id.slice(GROUP_PREFIX.length))[1];
    navigate(dimensionAddress(domain, chainField, value, scope));
  };
  const selectedNode = selected ? view.nodes.find(n => n.id === selected) : undefined;
  const groupTarget = selectedNode?.kind === 'group' && chainField
    ? dimensionAddress(domain, chainField, JSON.parse(selectedNode.id.slice(GROUP_PREFIX.length))[1], scope)
    : null;
  // Draw once the first batch of neighbours is in: drawing the root alone and then adding the rest
  // runs a second layout pass that made the graph jump after the body had already settled.
  const loaded = query.error !== null || (query.data !== undefined && !dims.isPending);
  const count = query.data ? query.data.pages.reduce((n, p) => n + p.nodes.length, 0) : 0;
  return <div className="graph">
    <h3>关联图谱{count > 0 ? `（${count}）` : ''}</h3>
    {query.error && <p role="alert">{query.error.message}</p>}
    {dims.error && <p>维度分组不可用，邻居按实体平铺展示。</p>}
    <div className="graph-outer">
      <div className="knowledge-graph">{loaded && <ExplorerCanvas frameBeforeEntry key={JSON.stringify([domain, page.id, chainField])} contextId={domain + ':' + page.id + ':' + (chainField ?? '')} view={view} selectedId={selected} onSelect={n => select(n.id)} onToggle={openGroup} onClear={() => select(null)} />}</div>
    </div>
    <div className="graph-controls">
      {groupTarget && selectedNode && <Link domain={domain} to={groupTarget}>查看「{selectedNode.label.split(' · ')[0]}」维度值</Link>}
      {selectedNode?.kind === 'entity' && selectedNode.id !== page.id && <Link domain={domain} to={address(domain, selectedNode.id)}>探索「{selectedNode.label}」</Link>}
      {query.hasNextPage && <button type="button" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多关联</button>}
    </div>
  </div>;
}

// Page outline, middle of the right sidebar (Quartz toc widget): collapsible, with scroll spy.
function PageToc({ entries, container }: { entries: TocEntry[]; container: React.RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = container.current;
    if (!el || entries.length === 0) return;
    const onScroll = () => {
      const base = el.getBoundingClientRect().top;
      const threshold = el.scrollTop + 100;
      let current: string | null = null;
      for (const entry of entries) {
        const heading = el.querySelector(`[id="${CSS.escape(entry.id)}"]`) as HTMLElement | null;
        if (!heading) continue;
        if (heading.getBoundingClientRect().top - base + el.scrollTop <= threshold) current = entry.id;
        else break;
      }
      setActive(current);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [entries, container]);
  if (entries.length === 0) return null;
  return (
    <div className="toc">
      <button type="button" className={collapsed ? 'toc-header collapsed' : 'toc-header'} aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>
        <h3>页面目录</h3>
        <svg className="fold" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      <ul className={collapsed ? 'toc-content collapsed' : 'toc-content'}>
        {entries.map(entry => (
          <li key={entry.id} className={`depth-${entry.depth - 1}`}>
            <a href={`#${entry.id}`} className={active === entry.id ? 'in-view' : undefined} onClick={e => {
              e.preventDefault();
              container.current?.querySelector(`[id="${CSS.escape(entry.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>{entry.text}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pages linking here, bottom of the right sidebar (Quartz backlinks widget). Hidden when empty.
function Backlinks({ domain, page }: { domain: string; page: Body }) {
  const query = useQuery(backlinksQuery(domain, page.id));
  const sources = query.data?.sources ?? [];
  if (sources.length === 0) return null;
  return <div className="backlinks">
    <h3>反向链接（{sources.length}）</h3>
    <ul className="backlinks-list">
      {sources.map(s => <li key={s.id}><Link domain={domain} to={address(domain, s.id)}>{s.title}</Link></li>)}
    </ul>
  </div>;
}

// Frontmatter property list under the page title (Quartz note-properties panel).
// Wiki links inside values reuse the page link resolver; tags open the search overlay as `#tag`.
// With a configured properties chain only those fields are shown, in chain order.
function NoteProperties({ frontmatter, displayFields, domain, link, onSearchTag }: {
  frontmatter: Record<string, unknown> | undefined;
  displayFields?: string[];
  domain: string;
  link: (href: string) => string;
  onSearchTag: (tag: string) => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const fields = frontmatter ?? {};
  const rows = displayFields
    ? displayFields.filter(field => field in fields).map(field => [field, fields[field]] as [string, unknown])
    : Object.entries(fields);
  if (rows.length === 0) return null;

  const renderText = (text: string): ReactNode => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g)) {
      if (match.index! > last) parts.push(text.slice(last, match.index));
      parts.push(<Link key={match.index} domain={domain} to={link(match[1].trim())}>{(match[2] ?? match[1]).trim()}</Link>);
      last = match.index! + match[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  };

  const renderValue = (key: string, value: unknown): ReactNode => {
    if (value == null) return <span className="note-properties-empty">—</span>;
    if (typeof value === 'boolean') return <input type="checkbox" checked={value} readOnly />;
    if (typeof value === 'number') return <code className="note-properties-number">{value}</code>;
    if (Array.isArray(value)) {
      if (key === 'tags') return <span className="note-properties-tags">{value.filter(t => typeof t === 'string').map((tag, i) => (
        <button type="button" key={i} className="prop-tag" onClick={() => onSearchTag(String(tag))}>{String(tag)}</button>
      ))}</span>;
      return value.map((item, i) => (
        <Fragment key={i}>{i > 0 && <span className="note-properties-separator">, </span>}{typeof item === 'string' ? renderText(item) : String(item)}</Fragment>
      ));
    }
    if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
    return renderText(String(value));
  };

  return (
    <details
      className="note-properties"
      ref={panel}
      open={localStorage.getItem('note-properties-collapsed') !== 'true'}
      onToggle={() => localStorage.setItem('note-properties-collapsed', String(!panel.current?.open))}
    >
      <summary className="note-properties-header">
        <span>属性</span>
        <span className="note-properties-count">{rows.length}</span>
      </summary>
      <table className="note-properties-table">
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key} className="note-properties-row">
              <td className="note-properties-key">{key}</td>
              <td className="note-properties-value">{renderValue(key, value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Reader({ domain, onOpenSearch }: { domain: string; onOpenSearch: (query?: string) => void }) {
  const location = useLocation();
  // 维度值页：?dimension=字段&value=值&scope=目录，主栏渲染维度视图，左侧目录树保留
  const dimensionView = !!(location.dimension && location.value);
  const folder = !dimensionView && !location.page;
  const dimensionScope = (location.scope || '').replace(/^\/+|\/+$/g, '');
  const id = dimensionView
    ? (dimensionScope ? '/' + dimensionScope : '/')
    : (folder ? location.folder : location.page) || '/';
  // Show the previous page until the next one arrives instead of flashing a loading state.
  const body = useQuery({ ...pageQuery(domain, folder, id), placeholderData: keepPreviousData, enabled: !dimensionView });
  const page = body.data;
  const loading = body.isPlaceholderData;
  const activeFolder = dimensionView || folder ? id : (page?.folder_id ?? null);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => { restoreScroll(location.key, main.current); }, [location.key]);
  const link = useCallback((href: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return href;
    const url = new URL(href, 'https://knowledge.local' + (activeFolder || '/').replace(/\/$/, '') + '/');
    const path = decodeURIComponent(url.pathname);
    const name = path.split('/').pop()?.replace(/\.(md|html)$/i, '') || '';
    const pageId = resolvePageId(name);
    if (pageId) return address(domain, pageId) + url.hash;
    const folderPath = path.replace(/\/index(?:\.md|\.html)?$|\/$/i, '') || '/';
    if (isFolderPath(folderPath)) return address(domain, folderPath, true);
    return address(domain, name);
  }, [domain, activeFolder]);
  const prepared = useMemo(() => {
    if (!page) return { source: '', entries: [] as TocEntry[], ids: new Map<string, string>() };
    const fallback = folder ? '该目录暂无说明。' : page.type === 'virtual' ? '此链接指向的页面尚未生成。' : '';
    const source = page.body_md ? stripTitle(page.body_md, page.title) : fallback;
    const { entries, ids } = buildToc(source);
    return { source, entries, ids };
  }, [page, folder]);
  const isEntity = !!page && page.type !== 'folder';
  const hasRight = !dimensionView && (!folder || prepared.entries.length > 0);
  return <div className="knowledge-layout" data-has-right={hasRight}>
    <aside className="sidebar left" aria-label="知识目录">
      <SearchButton onOpen={onOpenSearch} />
      <DirectoryTree domain={domain} activeFolder={activeFolder} activePage={folder ? null : id} isFolderPage={folder} />
    </aside>
    <main ref={main} aria-busy={loading}>
      {dimensionView ? (
        <DimensionValue domain={domain} field={location.dimension!} value={location.value!} scope={dimensionScope} />
      ) : body.error ? <p role="alert">{body.error.message}</p> : !page ? <p>正在读取知识页…</p> : <>
        <h1 className="page-title">{page.title}</h1>
        <NoteProperties frontmatter={page.frontmatter} displayFields={page.display_fields ?? undefined} domain={domain} link={link} onSearchTag={tag => onOpenSearch('#' + tag)} />
        <article>
          <Article source={prepared.source} domain={domain} link={link} ids={prepared.ids} />
        </article>
        {folder && <FolderListing domain={domain} folderId={id} />}
      </>}
    </main>
    {hasRight && (
      <aside className="sidebar right">
        {!folder && isEntity && page && <Related domain={domain} page={page} />}
        {page && <PageToc entries={prepared.entries} container={main} />}
        {!folder && isEntity && page && <Backlinks domain={domain} page={page} />}
      </aside>
    )}
  </div>;
}

export function SnapshotReader() {
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const domains = useQuery({ queryKey: ['snapshot-domains'], staleTime: fresh, queryFn: ({ signal }) => read<string[]>(base, signal) });
  const domain = location.knowledge || domains.data?.[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchQuery('');
        setSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const openSearch = (query?: string) => {
    // Runtime guard: a stray event object (e.g. passed through onClick) must not become the query.
    setSearchQuery(typeof query === 'string' ? query : '');
    setSearchOpen(true);
  };
  return <div className="knowledge-reader">
    <header>
      <strong>DeepScope 知识库</strong>
      <select aria-label="业务域" value={domain || ''} onChange={e => navigate(address(e.target.value, '/', true))}>{domains.data?.map(d => <option key={d}>{d}</option>)}</select>
      <a href="?aggregation=live">业务数据图谱</a>
    </header>
    {domains.error ? <p role="alert">{domains.error.message}</p> : domain ? <Reader domain={domain} onOpenSearch={openSearch} /> : <p>{domains.isLoading ? '正在读取业务域…' : '暂无已构建的知识库。'}</p>}
    {searchOpen && domain && <SearchOverlay domain={domain} initialQuery={searchQuery} onClose={() => setSearchOpen(false)} />}
  </div>;
}
