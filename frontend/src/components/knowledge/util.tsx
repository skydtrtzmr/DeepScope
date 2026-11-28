import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

export type Page = { id: string; title: string; folder_id: string; date?: string; tags?: string[] };
export type Folder = { id: string; title: string; parent_id: string | null; kind?: string };
export type Body = { id: string; title: string; type: string; body_md: string | null; folder_id?: string; frontmatter?: Record<string, unknown>; display_fields?: string[] | null };
export type NeighborNode = Body & { subject?: { id: string; title: string } | null };
export function subjectKey(page: { folder_id?: string; type?: string; subject?: NeighborNode['subject'] }) {
  if (page.subject) return page.subject.id;
  if (page.folder_id) return '/' + (page.folder_id.split('/').filter(Boolean)[0] ?? '');
  return page.type ?? 'entity';
}
export type NeighborPage = { nodes: NeighborNode[]; edges: { source: string; target: string; type: string }[]; more: boolean; total?: number };
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
export type ScopeGraphResponse = {
  count: number;
  subgraph: { nodes: { id: string; title: string; folder_id?: string; classification?: { folder: string; field: string; value: string; count: number } }[]; represented?: number; edges: { source: string; target: string }[]; truncated: boolean };
};
export type DimensionValueResponse = ScopeGraphResponse & {
  field: string;
  value: string;
  scope: string;
  groups: { folder: string; title: string; pages: { id: string; title: string; date?: string | null }[] }[];
};
export type DimensionPath = [field: string, value: string][];
export type Location = { knowledge: string | null; folder: string | null; page: string | null; dimension: string | null; value: string | null; scope: string | null; path: DimensionPath; matchFirstAny: boolean; key: string; canGoBack: boolean; canGoForward: boolean };

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

type HistoryEntry = { trail: string; index: number; id: string };
const historyKey = 'deepscopeKnowledge';
const listeners = new Set<() => void>();
const scrollPositions = new Map<string, number>();
const makeId = () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');

function ensureHistoryEntry(): HistoryEntry {
  const marker = history.state?.[historyKey] as HistoryEntry | undefined;
  if (marker) return marker;
  const id = makeId();
  const first = { trail: id, index: 0, id };
  history.replaceState({ ...history.state, [historyKey]: first }, '');
  return first;
}

function storedLastIndex(marker: HistoryEntry) {
  try {
    return Math.max(marker.index, Number(sessionStorage.getItem(historyKey + ':' + marker.trail)) || 0);
  } catch {
    return marker.index;
  }
}

let entry = ensureHistoryEntry();
let lastIndex = storedLastIndex(entry);
history.scrollRestoration = 'manual';

function readLocation(): Location {
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
    key: entry.id,
    canGoBack: entry.index > 0,
    canGoForward: entry.index < lastIndex,
  };
}

let currentLocation = readLocation();
function publishLocation() {
  currentLocation = readLocation();
  listeners.forEach(fn => fn());
}

function saveScroll() {
  const main = document.querySelector('.knowledge-layout main');
  if (main) scrollPositions.set(entry.id, main.scrollTop);
}

window.addEventListener('popstate', () => {
  saveScroll();
  const next = ensureHistoryEntry();
  if (next.trail !== entry.trail) lastIndex = storedLastIndex(next);
  entry = next;
  publishLocation();
});

export function navigate(to: string) {
  const destination = new URL(to, location.href);
  if (destination.href === location.href) return;
  saveScroll();
  const next = { trail: entry.trail, index: entry.index + 1, id: makeId() };
  history.pushState({ ...history.state, [historyKey]: next }, '', destination);
  entry = next;
  lastIndex = next.index;
  try { sessionStorage.setItem(historyKey + ':' + entry.trail, String(lastIndex)); } catch { /* keep the in-memory trail */ }
  publishLocation();
}

export function stepHistory(direction: -1 | 1) {
  if (direction < 0 ? currentLocation.canGoBack : currentLocation.canGoForward) history.go(direction);
}

function subscribeLocation(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLocation() {
  return useSyncExternalStore(subscribeLocation, () => currentLocation);
}

export function restoreScroll(key: string, element: HTMLElement | null) {
  if (!element) return;
  const saved = scrollPositions.get(key);
  if (saved === undefined && location.hash) {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      const heading = element.querySelector('#' + CSS.escape(id));
      if (heading) {
        heading.scrollIntoView({ block: 'start' });
        return;
      }
    } catch { /* malformed hash */ }
  }
  element.scrollTop = saved ?? 0;
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
  const internal = to.startsWith('?') || to.startsWith('#');
  const warm = () => { if (to.startsWith('?')) prefetch(queryClient, domain, to); };
  return <a {...rest} href={to} onMouseEnter={warm} onFocus={warm} onClick={e => {
    if (!internal || rest.download || (rest.target && rest.target !== '_self') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }} />;
}
