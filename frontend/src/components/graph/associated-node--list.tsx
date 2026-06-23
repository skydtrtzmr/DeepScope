import { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor, buildCategoryColorMap } from '@/lib/graph-color';
import type { RelatedNodeDetail } from '@/types/graph';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ArrowUp, ArrowDown, Check, Filter } from 'lucide-react';

type SortField = 'depth' | 'label' | 'category';

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'depth', label: '按深度' },
  { value: 'label', label: '按名称' },
  { value: 'category', label: '按类别' },
];

function sortNodes(nodes: RelatedNodeDetail[], field: SortField, asc: boolean): RelatedNodeDetail[] {
  const sorted = [...nodes];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'depth':
        cmp = a.depth - b.depth || a.label.localeCompare(b.label, 'zh');
        break;
      case 'label':
        cmp = a.label.localeCompare(b.label, 'zh');
        break;
      case 'category':
        cmp = (a.category ?? 'zzz').localeCompare(b.category ?? 'zzz', 'zh') || a.label.localeCompare(b.label, 'zh');
        break;
    }
    return asc ? cmp : -cmp;
  });
  return sorted;
}

export function AssociatedNodeList() {
  const parentRef = useRef<HTMLDivElement>(null);
  const { fullData, relatedNodes, selectedNodeId, highlightedNodeId, selectNode, highlightNode, categoryFilter, setCategoryFilter } =
    useGraphStore();

  // 从全量数据构建无碰撞 category 颜色映射
  const categoryColorMap = useMemo(
    () => fullData ? buildCategoryColorMap(fullData.nodes.map((n) => n.category)) : new Map<string, string>(),
    [fullData]
  );

  // 从全量节点中提取所有不重复的类别（作为筛选选项，不因切节点而变化）
  const categoryOptions = useMemo(() => {
    if (!fullData) return [];
    const cats = new Set<string>();
    fullData.nodes.forEach((n) => { if (n.category) cats.add(n.category); });
    return [...cats].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [fullData]);

  const [sortField, setSortField] = useState<SortField>('depth');
  const [sortAsc, setSortAsc] = useState(true);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const catMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
      if (catMenuRef.current && !catMenuRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    }
    if (sortMenuOpen || catMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortMenuOpen, catMenuOpen]);

  // 过滤 + 排序
  const filteredNodes = useMemo(
    () => categoryFilter.length > 0 ? relatedNodes.filter((n) => n.category != null && categoryFilter.includes(n.category)) : relatedNodes,
    [relatedNodes, categoryFilter]
  );

  const sortedNodes = useMemo(
    () => sortNodes(filteredNodes, sortField, sortAsc),
    [filteredNodes, sortField, sortAsc]
  );

  const virtualizer = useVirtualizer({
    count: sortedNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleItemClick = useCallback(
    (node: RelatedNodeDetail) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const handleItemHover = useCallback(
    (nodeId: string | null) => {
      highlightNode(nodeId);
    },
    [highlightNode]
  );

  if (!selectedNodeId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        点击图谱中的节点查看关联节点
      </div>
    );
  }

  const SortIcon = sortAsc ? ArrowUp : ArrowDown;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <h3 className="font-semibold text-sm">关联节点 <span className="font-normal text-muted-foreground ml-4">数量：{filteredNodes.length}</span></h3>
        <div className="flex items-center gap-1.5">
          {/* 类别过滤 */}
          {categoryOptions.length > 1 && (
            <div className="relative" ref={catMenuRef}>
              <button
                className={cn(
                  'p-1 rounded-full border hover:bg-accent transition-colors',
                  categoryFilter.length > 0 && 'bg-primary/10 border-primary/30'
                )}
                onClick={() => setCatMenuOpen(!catMenuOpen)}
                title="按类别过滤（多选）"
              >
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {catMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 rounded-md border bg-card shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                  <button
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                      categoryFilter.length === 0 && 'font-medium'
                    )}
                    onClick={() => { setCategoryFilter([]); setCatMenuOpen(false); }}
                  >
                    <span className="w-3.5 flex items-center justify-center">
                      {categoryFilter.length === 0 && <Check className="h-3 w-3" />}
                    </span>
                    全部
                  </button>
                  {categoryOptions.map((cat) => {
                    const selected = categoryFilter.includes(cat);
                    return (
                      <button
                        key={cat}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                          selected && 'font-medium'
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = selected
                            ? categoryFilter.filter((c) => c !== cat)
                            : [...categoryFilter, cat];
                          setCategoryFilter(next);
                        }}
                      >
                        <span className="w-3.5 flex items-center justify-center">
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: categoryColorMap.get(cat) || getNodeColor(cat) }}
                        />
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <span className="text-xs text-muted-foreground">{SORT_OPTIONS.find(o => o.value === sortField)?.label}</span>

          <div className="relative" ref={sortMenuRef}>
            <button
              className="p-1 rounded-full border hover:bg-accent transition-colors"
              onClick={() => setSortMenuOpen(!sortMenuOpen)}
              title="排序方式"
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {sortMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-32 rounded-md border bg-card shadow-lg z-50 py-1">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                      sortField === opt.value && 'font-medium'
                    )}
                    onClick={() => {
                      setSortField(opt.value);
                      setSortMenuOpen(false);
                    }}
                  >
                    <span className="w-3.5 flex items-center justify-center">
                      {sortField === opt.value && <Check className="h-3 w-3" />}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            className="p-1 rounded-full border hover:bg-accent transition-colors"
            onClick={() => setSortAsc(!sortAsc)}
            title={sortAsc ? '升序' : '降序'}
          >
            <SortIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {sortedNodes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          当前节点没有关联节点
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = sortedNodes[virtualRow.index];
            const isHighlighted = highlightedNodeId === node.id;

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className={cn(
                    'p-3 mx-2 my-1 rounded-lg border cursor-pointer transition-all',
                    'hover:bg-accent hover:border-primary/30',
                    isHighlighted && 'bg-accent border-primary/50'
                  )}
                  onClick={() => handleItemClick(node)}
                  onMouseEnter={() => handleItemHover(node.id)}
                  onMouseLeave={() => handleItemHover(null)}
                >
                  <div className="flex items-start gap-3">
                    {/* 节点颜色指示器 */}
                    <div
                      className="w-3 h-3 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: (node.style?.fill as string) || categoryColorMap.get(node.category || '') || getNodeColor(node.category) }}
                    />

                    <div className="flex-1 min-w-0">
                      {/* 标题行 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{node.label}</span>
                        {node.category && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {node.category}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          深度 {node.depth}
                        </Badge>
                      </div>

                      {/* 关系标签 */}
                      {node.relationLabel && (
                        <div className="text-xs text-muted-foreground mt-1">
                          关系: {node.relationLabel}
                        </div>
                      )}

                      {/* 描述 */}
                      {node.description && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {node.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
