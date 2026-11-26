import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

export type Page = { id: string; title: string; folder_id: string; date?: string; tags?: string[] };
export type Folder = { id: string; title: string; parent_id: string | null; kind?: string };
export type Body = { id: string; title: string; type: string; body_md: string | null; folder_id?: string };
export type NeighborPage = { nodes: Body[]; edges: { source: string; target: string; type: string }[]; more: boolean };
export type ChildrenResponse = { folder: string; folders: Folder[]; pages: Page[]; page_total: number; page_has_more: boolean };
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
export type Location = { knowledge: string | null; folder: string | null; page: string | null; key: number };

export const base = '/api/knowledge/domains';
// Snapshot data only changes on rebuild, so revisits within one session are served from memory.
export const fresh = 60_000;
export const PAGE_SIZE = 50;

export async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error((await response.json()).detail || '知识库读取失败');
  return response.json();
}

export function address(domain: string, id: string, folder = false) {
  return '?' + new URLSearchParams({ knowledge: domain, [folder ? 'folder' : 'page']: id });
}

// In-app navigation: the URL stays shareable, but the document is never reloaded.
const listeners = new Set<() => void>();
const scrollPositions = new Map<number, number>();
let sequence = (history.state && (history.state as { key?: number }).key) || 0;

export function readLocation(): Location {
  const params = new URLSearchParams(location.search);
  return {
    knowledge: params.get('knowledge'),
    folder: params.get('folder'),
    page: params.get('page'),
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

export function searchQuery(domain: string, q: string) {
  return {
    queryKey: ['search', domain, q], staleTime: fresh,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      read<SearchResponse>(base + '/' + encodeURIComponent(domain) + '/search?' + new URLSearchParams({ q }), signal),
  };
}

export function childrenQuery(domain: string, folderId: string) {
  return {
    queryKey: ['children', domain, folderId], initialPageParam: 0, staleTime: fresh,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      read<ChildrenResponse>(base + '/' + encodeURIComponent(domain) + '/children?' + new URLSearchParams({ folder: folderId, offset: String(pageParam), limit: String(PAGE_SIZE) }), signal),
    getNextPageParam: (last: ChildrenResponse, all: ChildrenResponse[]) => last.page_has_more ? all.reduce((n, p) => n + p.pages.length, 0) : undefined,
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

export function useChildren(domain: string, folderId: string) {
  const query = useInfiniteQuery(childrenQuery(domain, folderId));
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
