import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

export type Page = { id: string; title: string; folder_id: string; date?: string; tags?: string[] };
export type Folder = { id: string; title: string; parent_id: string | null; kind?: string };
export type Body = { id: string; title: string; type: string; body_md: string | null; folder_id?: string; frontmatter?: Record<string, unknown>; display_fields?: string[] | null };
export type NeighborPage = { nodes: Body[]; edges: { source: string; target: string; type: string }[]; more: boolean; total?: number };
export type ChildrenResponse = { folder: string; groups?: { value: string; count: number }[]; folders: Folder[]; pages: Page[]; page_total: number; page_has_more: boolean; sort?: { field: string; order: string } };
export type BacklinksResponse = { id: string; sources: { id: string; title: string; type: string }[] };
export type SearchHit = {
  kind: 'page' | 'folder';
  id: string;
  title: string;
  title_marked: string;
  excerpt: string;
  folder_id: string | null;
};
export type SearchResponse = { results: SearchHit[]; total: number };
export type DimensionsResponse = { scope: string; chain: string[]; min_group_size?: number; fields: { field: string; values: { value: string; count: number }[] }[] };
export type DimensionValueResponse = {
  field: string;
  value: string;
  scope: string;
  count: number;
  groups: { folder: string; title: string; pages: { id: string; title: string; date?: string | null }[] }[];
  subgraph: { nodes: { id: string; title: string; classification?: { folder: string; field: string; value: string; count: number } }[]; represented?: number; edges: { source: string; target: string }[]; truncated: boolean };
};
export type DimensionPath = [field: string, value: string][];
export type Location = { knowledge: string | null; folder: string | null; page: string | null; dimension: string | null; value: string | null; scope: string | null; path: DimensionPath; matchFirstAny: boolean; key: number };

export const base = '/api/knowledge/domains';
// Snapshot data only changes on rebuild, so revisits within one session are served from memory.
export const fresh = 60_000;
// Dimension config lives in config.db and takes effect on write (mtime invalidation), so only short-cache it.
export const dimensionFresh = 5_000;
export const PAGE_SIZE = 50;

export async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error((await response.json()).detail || '知识库读取失败');
  return response.json();
}

export function address(domain: string, id: string, folder = false) {
  return '?' + new URLSearchParams({ knowledge: domain, [folder ? 'folder' : 'page']: id });
}

export function dimensionAddress(domain: string, field: string, value: string, scope?: string, path: DimensionPath = [], matchFirstAny = false) {
  const params: Record<string, string> = { knowledge: domain, dimension: field, value };
  if (scope) params.scope = scope;
  if (path.length) params.path = JSON.stringify(path);
  if (matchFirstAny) params.match_first_any = 'true';
  return '?' + new URLSearchParams(params);
}

// In-app navigation: the URL stays shareable, but the document is never reloaded.
const listeners = new Set<() => void>();
const scrollPositions = new Map<number, number>();
let sequence = (history.state && (history.state as { key?: number }).key) || 0;

export function classificationAddress(domain: string, folder: string, path: DimensionPath, matchFirstAny = false) {
  const [field, value] = path[path.length - 1];
  return dimensionAddress(domain, field, value, folder.replace(/^\/+|\/+$/g, ''), path, matchFirstAny);
}

function readDimensionPath(raw: string | null): DimensionPath {
  try {
    const path = JSON.parse(raw ?? '[]');
    return Array.isArray(path) && path.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'string')) ? path : [];
  } catch { return []; }
}

export function readLocation(): Location {
  const params = new URLSearchParams(location.search);
  return {
    knowledge: params.get('knowledge'),
    folder: params.get('folder'),
    page: params.get('page'),
    dimension: params.get('dimension'),
    value: params.get('value'),
    scope: params.get('scope'),
    path: readDimensionPath(params.get('path')),
    matchFirstAny: params.get('match_first_any') === 'true',
    key: (history.state && (history.state as { key?: number }).key) || 0,
  };
}

export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
  const current = readLocation();
  scrollPositions.set(current.key, document.querySelector('.knowledge-layout main')?.scrollTop ?? 0);
  history.pushState({ key: ++sequence }, '', to);
  listeners.forEach(fn => fn());
}

export function useLocation() {
  const [state, setState] = useState(readLocation);
  useEffect(() => {
    if (!history.state) history.replaceState({ key: ++sequence }, '');
    const update = () => setState(readLocation());
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  return state;
}

export function restoreScroll(key: number, element: HTMLElement | null) {
  if (element) element.scrollTop = scrollPositions.get(key) ?? 0;
}

export function pageQuery(domain: string, folder: boolean, id: string) {
  return {
    queryKey: ['page', domain, folder, id], staleTime: fresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<Body>(base + '/' + encodeURIComponent(domain) + '/page?' + new URLSearchParams({ id, folder: String(folder) }), signal),
  };
}

export function neighborsQuery(domain: string, id: string) {
  return {
    queryKey: ['snapshot-neighbors', domain, id], initialPageParam: 0, staleTime: fresh,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      read<NeighborPage>(base + '/' + encodeURIComponent(domain) + '/neighbors?' + new URLSearchParams({ id, offset: String(pageParam) }), signal),
    getNextPageParam: (last: NeighborPage, all: NeighborPage[]) => last.more ? all.reduce((n, p) => n + p.nodes.length, 0) : undefined,
  };
}

export function backlinksQuery(domain: string, id: string) {
  return {
    queryKey: ['backlinks', domain, id], staleTime: fresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<BacklinksResponse>(base + '/' + encodeURIComponent(domain) + '/backlinks?' + new URLSearchParams({ id }), signal),
  };
}

export function searchQuery(domain: string, q: string, limit = 12) {
  return {
    queryKey: ['search', domain, q, limit], staleTime: fresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<SearchResponse>(base + '/' + encodeURIComponent(domain) + '/search?' + new URLSearchParams({ q, limit: String(limit) }), signal),
  };
}

export function childrenQuery(domain: string, folderId: string, order: string[] = [], branch: string[] = [], path: DimensionPath = [], matchFirstAny = false) {
  return {
    queryKey: ['children', domain, folderId, order, branch, path, matchFirstAny], initialPageParam: 0, staleTime: fresh,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      read<ChildrenResponse>(base + '/' + encodeURIComponent(domain) + '/children?' + new URLSearchParams({ folder: folderId, order: JSON.stringify(order), branch: JSON.stringify(branch), path: path.length ? JSON.stringify(path) : '', match_first_any: String(matchFirstAny), offset: String(pageParam), limit: String(PAGE_SIZE) }), signal),
    getNextPageParam: (last: ChildrenResponse, all: ChildrenResponse[]) => last.page_has_more ? all.reduce((n, p) => n + p.pages.length, 0) : undefined,
  };
}

export function dimensionsQuery(domain: string, scope: string) {
  return {
    queryKey: ['dimensions', domain, scope], staleTime: dimensionFresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<DimensionsResponse>(base + '/' + encodeURIComponent(domain) + '/dimensions?' + new URLSearchParams({ scope }), signal),
  };
}

export function dimensionValueQuery(domain: string, field: string, value: string, scope: string, path: DimensionPath = [], matchFirstAny = false, graphOrders: Record<string, string[]> = {}) {
  return {
    queryKey: ['dimension-value', domain, field, value, scope, path, matchFirstAny, graphOrders], staleTime: dimensionFresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<DimensionValueResponse>(base + '/' + encodeURIComponent(domain) + '/dimension-value?' + new URLSearchParams({ field, value, scope, path: path.length ? JSON.stringify(path) : '', match_first_any: String(matchFirstAny), graph_orders: JSON.stringify(graphOrders) }), signal),
  };
}

// Incremental name index, fed by every children fetch. Lets wiki/internal links resolve without
// loading the whole directory; unknown names fall back to the page id (which equals the filename stem).
const pageNames = new Map<string, string>();
const folderPaths = new Set<string>();

export function registerChildren(res: ChildrenResponse) {
  for (const f of res.folders) folderPaths.add(f.id);
  for (const p of res.pages) pageNames.set(p.id.toLowerCase(), p.id);
}

export function useChildren(domain: string, folderId: string, order: string[] = [], branch: string[] = [], enabled = true, path: DimensionPath = [], matchFirstAny = false) {
  const query = useInfiniteQuery({ ...childrenQuery(domain, folderId, order, branch, path, matchFirstAny), enabled });
  useEffect(() => {
    for (const res of query.data?.pages ?? []) registerChildren(res);
  }, [query.data]);
  return query;
}

export function resolvePageId(name: string): string | undefined {
  return pageNames.get(name.toLowerCase());
}

export function isFolderPath(path: string): boolean {
  return folderPaths.has(path);
}

// Warm the cache while the pointer rests on a link, so the click itself is instant.
export function prefetch(queryClient: ReturnType<typeof useQueryClient>, domain: string, to: string) {
  const params = new URLSearchParams(to);
  const field = params.get('dimension'), value = params.get('value');
  if (field && value !== null) {
    void queryClient.prefetchQuery(dimensionValueQuery(domain, field, value, params.get('scope') ?? '', readDimensionPath(params.get('path')), params.get('match_first_any') === 'true'));
    return;
  }
  const folder = !params.has('page');
  const id = params.get(folder ? 'folder' : 'page');
  if (!id) return;
  void queryClient.prefetchQuery(pageQuery(domain, folder, id));
  if (folder) void queryClient.prefetchInfiniteQuery(childrenQuery(domain, id));
  else void queryClient.prefetchInfiniteQuery(neighborsQuery(domain, id));
}

export function Link({ to, domain, ...rest }: { to: string; domain: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const queryClient = useQueryClient();
  return <a {...rest} href={to} onMouseEnter={() => prefetch(queryClient, domain, to)} onFocus={() => prefetch(queryClient, domain, to)} onClick={e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }} />;
}
