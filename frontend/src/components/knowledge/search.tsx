import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { address, navigate, pageQuery, searchQuery, type SearchHit } from './util';

// The backend wraps matched spans with these control characters; slicing keeps rendering
// injection-safe (no innerHTML) while <mark> carries the Quartz highlight look.
const START = '\x01';
const END = '\x02';
const CJK_SOURCE = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uac00-\\ud7af]+';
const CJK = new RegExp(CJK_SOURCE, 'g');

// Query terms for client-side preview highlighting: CJK runs as whole substrings + ASCII words.
function termsOf(query: string): string[] {
  const terms = query.match(CJK) ?? [];
  return [...terms, ...query.replace(new RegExp(CJK_SOURCE, 'g'), ' ').split(/\s+/).filter(Boolean)];
}

// Wrap case-insensitive term occurrences with the same control-char markers the backend uses.
function markText(text: string, terms: string[]): string {
  if (!text) return text;
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let start = lower.indexOf(needle);
    while (start !== -1) {
      const end = start + needle.length;
      if (ranges.every(([s, e]) => end <= s || start >= e)) ranges.push([start, end]);
      start = lower.indexOf(needle, start + 1);
    }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let position = 0;
  for (const [start, end] of ranges) {
    out += text.slice(position, start) + START + text.slice(start, end) + END;
    position = end;
  }
  return out + text.slice(position);
}

export function Marked({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let plain = '';
    let i = 0;
    while (i < text.length) {
      if (text[i] === START) {
        const end = text.indexOf(END, i + 1);
        if (end === -1) break;
        if (plain) { out.push(plain); plain = ''; }
        out.push(<mark key={i}>{text.slice(i + 1, end)}</mark>);
        i = end + 1;
      } else {
        plain += text[i];
        i += 1;
      }
    }
    if (plain) out.push(plain);
    return out;
  }, [text]);
  return <>{parts}</>;
}

// Sidebar trigger: Quartz-style quiet search bar with the shortcut hint.
// onClick wraps the handler so the click event is never passed on as a query.
export function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="search-bar" onClick={() => onOpen()}>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <span>搜索知识库</span>
      <kbd>Ctrl K</kbd>
    </button>
  );
}

// Plain-text preview of the selected hit, highlighted with the query terms.
function Preview({ domain, hit, terms }: { domain: string; hit: SearchHit | null; terms: string[] }) {
  const body = useQuery({ ...pageQuery(domain, hit?.kind === 'folder', hit?.id ?? ''), enabled: !!hit });
  if (!hit) return <div className="search-preview" aria-hidden="true" />;
  const raw = body.data?.body_md ?? '';
  return (
    <div className="search-preview">
      <span className={'search-badge ' + hit.kind}>{hit.kind === 'folder' ? '目录' : '页面'}</span>
      <h4>{hit.title}</h4>
      {body.isLoading ? <p className="search-hint">正在加载预览…</p>
        : raw ? <p className="search-preview-body"><Marked text={markText(raw.slice(0, 1500), terms)} /></p>
        : <p className="search-hint">该目录暂无说明。</p>}
    </div>
  );
}

export function SearchOverlay({ domain, initialQuery, onClose }: { domain: string; initialQuery?: string; onClose: () => void }) {
  const [raw, setRaw] = useState(initialQuery ?? '');
  const [debounced, setDebounced] = useState((initialQuery ?? '').trim());
  const [selected, setSelected] = useState(0);
  const [limit, setLimit] = useState(12);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(raw.trim()), 300);
    return () => clearTimeout(timer);
  }, [raw]);
  useEffect(() => { setSelected(0); setLimit(12); }, [debounced]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const query = useQuery({ ...searchQuery(domain, debounced, limit), enabled: debounced !== '', placeholderData: keepPreviousData });
  const results = debounced === '' ? [] : query.data?.results ?? [];
  const total = query.data?.total ?? 0;
  const terms = useMemo(() => termsOf(debounced), [debounced]);

  useEffect(() => {
    (list.current?.querySelectorAll('.search-item')[selected] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);

  const open = (hit: SearchHit) => {
    navigate(address(domain, hit.id, hit.kind === 'folder'));
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = results[selected]; if (hit) open(hit); }
  };

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label="知识库搜索" onKeyDown={onKeyDown}>
      <div className="search-backdrop" onClick={onClose} />
      <div className="search-space">
        <div className="search-input-row">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={input}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="搜索知识库：关键词、#标签、@属性:值、-排除"
            aria-label="搜索知识库"
            spellCheck={false}
          />
          <button type="button" className="search-close" onClick={onClose}>Esc</button>
        </div>
        <div className="search-panel">
          <ul className="search-results" ref={list}>
            {debounced === '' ? <li className="search-hint">输入关键词开始搜索</li>
              : query.isError ? <li className="search-empty" role="alert">{query.error.message}</li>
              : results.length === 0 ? query.isFetching ? <li className="search-hint">正在搜索…</li> : <li className="search-empty">未找到匹配</li>
              : <>
                {total > 0 && <li className="search-stats" aria-live="polite">显示 {results.length} / 共 {total} 条{total >= 1000 ? '+' : ''}</li>}
                {results.map((hit, i) => (
                  <li
                    key={hit.kind + ':' + hit.id}
                    className={i === selected ? 'search-item selected' : 'search-item'}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => open(hit)}
                  >
                    <span className={'search-badge ' + hit.kind}>{hit.kind === 'folder' ? '目录' : '页面'}</span>
                    <span className="search-item-title"><Marked text={hit.title_marked} /></span>
                    {hit.excerpt && <span className="search-item-excerpt"><Marked text={hit.excerpt} /></span>}
                  </li>
                ))}
                {results.length < total && results.length < 100 && (
                  <li
                    className="search-load-more"
                    role="button"
                    tabIndex={0}
                    onClick={() => setLimit(l => Math.min(l + 12, 100))}
                  >
                    加载更多搜索结果（还有 {total - results.length} 条）
                  </li>
                )}
              </>}
          </ul>
          <Preview domain={domain} hit={results[selected] ?? null} terms={terms} />
        </div>
        <p className="search-syntax">语法：<code>#标签</code> · <code>@属性:值</code> · <code>@属性</code> · <code>@:值</code> · <code>-排除</code>（多条件组合搜索）</p>
      </div>
    </div>
  );
}
