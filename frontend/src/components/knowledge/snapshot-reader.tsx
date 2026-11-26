import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root, Parent, PhrasingContent } from 'mdast';
import { ExplorerCanvas } from '../aggregate/aggregation-explorer';
import type { Projection } from '@/lib/aggregation/explorer';
import {
  address, base, fresh, isFolderPath, Link, navigate, neighborsQuery, pageQuery,
  read, resolvePageId, restoreScroll, useLocation, type Body,
} from './util';
import { DirectoryTree } from './directory-tree';
import { FolderListing } from './folder-listing';
import './snapshot-reader.css';

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
const Article = memo(function Article({ source, domain, link }: { source: string; domain: string; link: (href: string) => string }) {
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={{
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

function Related({ domain, page }: { domain: string; page: Body }) {
  const [selected, select] = useState<string | null>(null);
  const query = useInfiniteQuery(neighborsQuery(domain, page.id));
  useEffect(() => { select(null); }, [page.id]);
  const view = useMemo<Projection>(() => {
    const pages = query.data?.pages ?? [];
    const nodes = [page, ...pages.flatMap(p => p.nodes)].map(n => ({ id: n.id, label: n.title, kind: 'entity' as const, depth: n.id === page.id ? 0 : 1, entity: { id: n.id, label: n.title, type: n.type, properties: {} } }));
    return { nodes, rootId: page.id, total: nodes.length, edges: pages.flatMap(p => p.edges).map(e => ({ ...e, id: JSON.stringify([e.source, e.target, e.type]), kind: 'relation' as const })) };
  }, [query.data, page]);
  // Draw once the first batch of neighbours is in: drawing the root alone and then adding the rest
  // runs a second layout pass that made the graph jump after the body had already settled.
  const loaded = query.data !== undefined || query.error !== null;
  return <section><h2>关联图谱</h2>{query.error && <p role="alert">{query.error.message}</p>}
    <div className="knowledge-graph">{loaded && <ExplorerCanvas contextId={domain + ':' + page.id} view={view} selectedId={selected} onSelect={n => select(n.id)} onToggle={n => select(n.id)} onClear={() => select(null)} />}</div>
    {selected && selected !== page.id && <Link domain={domain} to={address(domain, selected)}>探索「{view.nodes.find(n => n.id === selected)?.label}」</Link>}
    {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>加载更多关联</button>}
  </section>;
}

function Reader({ domain }: { domain: string }) {
  const location = useLocation();
  const folder = !location.page;
  const id = (folder ? location.folder : location.page) || '/';
  // Show the previous page until the next one arrives instead of flashing a loading state.
  const body = useQuery({ ...pageQuery(domain, folder, id), placeholderData: keepPreviousData });
  const page = body.data;
  const loading = body.isPlaceholderData;
  const activeFolder = folder ? id : (page?.folder_id ?? null);
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
  return <div className="knowledge-layout">
    <aside aria-label="知识目录">
      <DirectoryTree domain={domain} activeFolder={activeFolder} activePage={folder ? null : id} isFolderPage={folder} />
    </aside>
    <main ref={main} aria-busy={loading}>
      {body.error ? <p role="alert">{body.error.message}</p> : !page ? <p>正在读取知识页…</p> : <>
        <h1>{page.title}</h1>
        <article>
          <Article source={page.body_md || (folder ? '该目录暂无说明。' : page.type === 'virtual' ? '此链接指向的页面尚未生成。' : '')} domain={domain} link={link} />
        </article>
        {folder ? <FolderListing domain={domain} folderId={id} /> : !body.isPlaceholderData && <Related domain={domain} page={page} />}
      </>}
    </main>
  </div>;
}

export function SnapshotReader() {
  const location = useLocation();
  const domains = useQuery({ queryKey: ['snapshot-domains'], staleTime: fresh, queryFn: ({ signal }) => read<string[]>(base, signal) });
  const domain = location.knowledge || domains.data?.[0];
  return <div className="knowledge-reader">
    <header>
      <strong>DeepScope 知识库</strong>
      <select aria-label="业务域" value={domain || ''} onChange={e => navigate(address(e.target.value, '/', true))}>{domains.data?.map(d => <option key={d}>{d}</option>)}</select>
      <a href="?aggregation=live">业务数据图谱</a>
    </header>
    {domains.error ? <p role="alert">{domains.error.message}</p> : domain ? <Reader domain={domain} /> : <p>{domains.isLoading ? '正在读取业务域…' : '暂无已构建的知识库。'}</p>}
  </div>;
}
