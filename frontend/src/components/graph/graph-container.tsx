import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData, type GraphData as G6GraphData, type BaseNodeStyleProps, type BaseEdgeStyleProps } from '@antv/g6';

/** G6 spec 层的 NodeStyle/EdgeStyle 未导出，用 Base*StyleProps + 索引签名等价还原 */
type G6NodeStyle = Partial<BaseNodeStyleProps> & { [key: string]: unknown };
type G6EdgeStyle = Partial<BaseEdgeStyleProps> & { [key: string]: unknown };
import { useGraphStore } from '@/lib/stores/graph-store';
import { useAggregateStore } from '@/lib/stores/aggregate-store';
import { GraphControl } from './graph-control';
import type { GraphNode, GraphEdge, DisplaySettings } from '@/types/graph';
import { getNodeColor, buildCategoryColorMap } from '@/lib/graph-color';

interface GraphContainerProps {
  className?: string;
}

// ── 聚合层样式常量 ────────────────────────────────────────
const AGG_NODE_FILL = '#EEF2FF';      // 聚合节点底色（indigo-50）
const AGG_NODE_STROKE = '#6366F1';    // 聚合节点描边（indigo-500）
const AGG_ANCHOR_FILL = '#F8FAFC';    // 范围锚点底色（slate-50）
const AGG_ANCHOR_STROKE = '#94A3B8';  // 范围锚点描边（slate-400）
const AGG_EDGE_STROKE = '#A5B4FC';    // 聚合显示边（indigo-300）
const AGG_MEMBER_EDGE_STROKE = '#C7D2FE'; // 成员边（更浅的 indigo-200）

/** 判断 G6 NodeData 是否属于聚合层（kind 路由依据） */
function isAggregateNodeData(d: NodeData): boolean {
  const kind = d.data?.kind as string | undefined;
  return kind === 'aggregate' || kind === 'scope';
}

/** 判断 G6 EdgeData 是否属于聚合层 */
function isAggregateEdgeData(d: EdgeData): boolean {
  // 聚合层边带 data.kind='aggregate'；真实层边无此标记
  return (d.data?.kind as string | undefined) === 'aggregate';
}

/** 聚合分组节点的徽标文本（单指标摘要） */
function getAggBadgeText(d: NodeData): string {
  const data = d.data as Record<string, unknown> | undefined;
  const status = data?.metricStatus as string | undefined;
  if (status === 'failed') return '!';
  if (status === 'running') return '⋯';
  const metrics = data?.metrics as Record<string, number | null> | undefined;
  if (!metrics) return '';
  const first = Object.values(metrics)[0];
  if (first == null) return '—';
  return String(first);
}

/** 根据 displaySettings 计算节点 labelText（含可选的类别前缀）；聚合节点走独立样式 */
function getLabelText(d: NodeData, showCategoryLabel: boolean): string {
  if (isAggregateNodeData(d)) {
    return (d.data?.label as string) || d.id; // 聚合节点 label 已含 count，不加类别前缀
  }
  const label = (d.data?.label as string) || d.id;
  const cat = d.data?.category as string | undefined;
  return showCategoryLabel && cat ? `${cat}：${label}` : label;
}

/** hover-activate 的 enable 回调事件对象 */
interface G6PointerEvent {
  targetType: 'node' | 'edge' | 'canvas';
}

/** 构建节点全局样式配置（用于 createGraph 和 displaySettings effect，保持一份定义） */
function getNodeStyleConfig(
  displaySettings: DisplaySettings,
  categoryColorMapRef: React.MutableRefObject<Map<string, string>>,
): Record<string, unknown> {
  return {
    type: (d: NodeData) => (isAggregateNodeData(d) ? 'rect' : 'circle'),
    labelText: (d: NodeData) => getLabelText(d, displaySettings.showCategoryLabel),
    labelPlacement: 'bottom',
    labelFontSize: 11,
    labelFill: '#0f172a',
    labelWordWrap: true,
    labelMaxWidth: '400%',
    labelMaxLines: 3,
    labelBackground: true,
    labelBackgroundFill: '#ffffff',
    labelBackgroundOpacity: 0.6,
    labelBackgroundRadius: 4,
    labelPadding: [2, 6],
    fill: (d: NodeData) => {
      const kind = (d.data?.kind as string | undefined);
      if (kind === 'aggregate') return AGG_NODE_FILL;
      if (kind === 'scope') return AGG_ANCHOR_FILL;
      const explicit = (d.style as Record<string, unknown>)?.fill as string | undefined;
      if (explicit) return explicit;
      const cat = d.data?.category as string | undefined;
      if (!cat) return '#94a3b8';
      return categoryColorMapRef.current.get(cat) || getNodeColor(cat);
    },
    size: (d: NodeData) => {
      const kind = (d.data?.kind as string | undefined);
      if (kind === 'aggregate') return [120, 44];  // rect: [width, height]
      if (kind === 'scope') return 36;
      return ((d.style as Record<string, unknown>)?.radius as number) || 28;
    },
    // 聚合节点徽标（右上角指标摘要：⋯ / ! / — / 数值）
    badge: true,
    badgeText: (d: NodeData) => (isAggregateNodeData(d) ? getAggBadgeText(d) : ''),
    badgePlacement: 'righttop',
    badgeOffsetX: -4,
    badgeOffsetY: 4,
    badgeFontSize: 10,
    badgeFill: (d: NodeData) => {
      const status = (d.data as Record<string, unknown> | undefined)?.metricStatus as string | undefined;
      if (status === 'failed') return '#EF4444';
      return '#475569';
    },
    badgeBackground: '#F1F5F9',
    badgePadding: [2, 4],
    badgeRadius: 4,
    stroke: (d: NodeData) => {
      const kind = (d.data?.kind as string | undefined);
      if (kind === 'aggregate') return AGG_NODE_STROKE;
      if (kind === 'scope') return AGG_ANCHOR_STROKE;
      return '#334155';
    },
    lineWidth: (d: NodeData) => {
      const kind = (d.data?.kind as string | undefined);
      if (kind === 'aggregate') return 2;
      return 2;
    },
    // 聚合节点虚线描边（语义区分于真实实体节点）
    lineDash: (d: NodeData) => (isAggregateNodeData(d) ? [6, 4] : []),
    radius: (d: NodeData) => (isAggregateNodeData(d) ? 8 : undefined), // rect 圆角
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowColor: 'rgba(0,0,0,0.08)',
    shadowBlur: 4,
    cursor: 'grab',
  };
}


/** 构建节点全局 state 配置（用于 createGraph 和 displaySettings effect，保持一份定义） */
function getNodeStateConfig() {
  return {
    selected: { stroke: '#6366f1', lineWidth: 4 },
    highlighted: {
      stroke: '#6366f1',
      lineWidth: 3,
      halo: true,
      haloLineWidth: 16,
      haloStroke: '#6366f1',
      haloStrokeOpacity: 0.15,
    },
    hovered: {
      stroke: '#6366f1',
      lineWidth: 3,
      halo: true,
      haloLineWidth: 16,
      haloStroke: '#6366f1',
      haloStrokeOpacity: 0.15,
    },
  };
}

// 创建图谱实例并绑定事件
function createGraph(
  container: HTMLElement,
  fullDataRef: React.MutableRefObject<unknown>,
  isDraggingRef: React.MutableRefObject<boolean>,
  applyNodeStatesRef: React.MutableRefObject<() => void>,
  graphReadyRef: React.MutableRefObject<boolean>,
  selectNode: (nodeId: string | null) => void,
  bfsExpandNode: (nodeId: string) => void,
  dblClickExpandingRef: React.MutableRefObject<boolean>,
  g6Data: Record<string, unknown>,
  displaySettings: DisplaySettings,
  categoryColorMapRef: React.MutableRefObject<Map<string, string>>,
) {
  const options: GraphOptions = {
    container,
    padding: 40,
    behaviors: [
      'drag-canvas',
      'zoom-canvas',
      { type: 'drag-element-force', fixed: true }, {
        type: 'hover-activate',
        state: 'hovered',      // 悬浮时给元素设置 'hovered' 状态
        inactiveState: 'dim',  // 非悬浮元素设置 'dim' 状态（可选，用于淡化其他节点）
        degree: 0,             // 0 = 只高亮当前节点，不扩散到邻居
        enable: (e: G6PointerEvent) => e.targetType === 'node',  // 只对节点生效
      },
    ],
    layout: {
      type: 'd3-force',
      link: { distance: 180, strength: 0.6 },
      manyBody: { strength: -80 },
      collide: { radius: 100, strength: 1 },
      center: { strength: 0.1 },
      alphaMin: 0.002,
      alphaDecay: 0.05,
      // 收敛衰减率，值越小，图节点越有足够时间完成布局
      velocityDecay: 0.5,
    },
    node: {
      type: 'circle',
      style: getNodeStyleConfig(displaySettings, categoryColorMapRef),
      state: getNodeStateConfig(),
    },
    edge: {
      type: 'line',
      style: {
        stroke: (d: EdgeData) => {
          if (isAggregateEdgeData(d)) {
            // 成员边（source 为聚合节点）更浅
            const src = d.source as string;
            return src.startsWith('agg::') ? AGG_MEMBER_EDGE_STROKE : AGG_EDGE_STROKE;
          }
          return (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8';
        },
        lineWidth: (d: EdgeData) => {
          if (isAggregateEdgeData(d)) return 1;
          return ((d.style as Record<string, unknown>)?.lineWidth as number) || 1;
        },
        lineDash: (d: EdgeData) => (isAggregateEdgeData(d) ? [4, 4] : []),
        lineCap: 'butt',
        lineJoin: 'miter',
        endArrow: displaySettings.showEdgeArrows,
        endArrowSize: 6,
        endArrowFill: (d: EdgeData) => (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8',
        labelText: displaySettings.showEdgeLabels ? (d: EdgeData) => (d.data?.label as string) || '' : () => '',
        labelFontSize: 9,
        labelFill: '#64748b',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 0.6,
      },
      state: {
        active: { stroke: '#6366f1', lineWidth: 2 },
      },
    },
  };

  const graph = new Graph(options);

  // 展开处理函数（双击/右键共用）
  const handleExpand = (nodeId: string) => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      pendingClickNodeId = null;
    }

    // ── 聚合节点：双击 = 展开/收起成员（切换） ──
    const nodeData = graph.getNodeData(nodeId) as NodeData | undefined;
    if (nodeData && isAggregateNodeData(nodeData)) {
      const kind = nodeData.data?.kind;
      if (kind === 'aggregate') {
        const bucketId = nodeData.data?.bucketId as string | undefined;
        if (!bucketId) return;
        const aggStore = useAggregateStore.getState();
        const st = aggStore.getBucketState(bucketId);
        // 展开在途时忽略（防竞态）；已展开 → 收起；未展开 → 展开
        if (st?.loading) return;
        if (st?.expanded) {
          aggStore.collapseBucket(bucketId);
        } else {
          aggStore.selectBucket(bucketId);
          aggStore.expandBucket(bucketId);
        }
        return;
      }
      // kind=scope 范围锚点：不展开
      return;
    }

    // ── 真实节点：原 BFS 展开逻辑（零改动） ──
    // 标记展开中，让 selectedNodeId useEffect 跳过立即聚焦
    dblClickExpandingRef.current = true;
    const currentSelected = useGraphStore.getState().selectedNodeId;
    if (currentSelected !== nodeId) {
      selectNode(nodeId);
    }
    bfsExpandNode(nodeId);
  };

  const needsDblClickTimer =
    displaySettings.expandTrigger === 'dblclick' ||
    displaySettings.expandTrigger === 'both';

  // 单击/双击区分：仅在 dblclick/both 模式下使用延迟判定
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingClickNodeId: string | null = null;

  graph.on('node:click', (event) => {
    const nodeId = (event as { target: { id: string } }).target.id;
    if (!graph.getNodeData(nodeId)) return;

    // ── 聚合节点：走 aggregate-store 的选中逻辑，不进 graph-store 的 BFS（会全图暗化） ──
    const nodeData = graph.getNodeData(nodeId) as NodeData | undefined;
    if (nodeData && isAggregateNodeData(nodeData)) {
      if (nodeData.data?.kind === 'aggregate') {
        const bucketId = nodeData.data?.bucketId as string | undefined;
        if (bucketId) useAggregateStore.getState().selectBucket(bucketId);
      } else {
        useAggregateStore.getState().selectBucket(null); // 锚点：取消选中
      }
      return;
    }

    if (needsDblClickTimer) {
      // dblclick/both 模式：延迟判定，给双击让路
      if (clickTimer && pendingClickNodeId === nodeId) {
        clearTimeout(clickTimer);
        clickTimer = null;
        pendingClickNodeId = null;
        return;
      }
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      pendingClickNodeId = nodeId;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        pendingClickNodeId = null;
        selectNode(nodeId);
      }, 150);
    } else {
      // rightclick/none 模式：直接选中，无延迟
      selectNode(nodeId);
    }
  });

  // 双击展开
  if (needsDblClickTimer) {
    graph.on('node:dblclick', (event) => {
      const nodeId = (event as { target: { id: string } }).target.id;
      if (!graph.getNodeData(nodeId)) return;
      handleExpand(nodeId);
    });
  }

  // 右键展开
  if (
    displaySettings.expandTrigger === 'rightclick' ||
    displaySettings.expandTrigger === 'both'
  ) {
    graph.on('node:contextmenu', (event) => {
      const nodeId = (event as { target: { id: string } }).target.id;
      if (!graph.getNodeData(nodeId)) return;
      handleExpand(nodeId);
    });
  }

  graph.on('node:dragstart', () => {
    isDraggingRef.current = true;
    const data = fullDataRef.current as { nodes: { id: string }[]; edges: { id: string }[] } | null;
    if (data) {
      data.nodes.forEach((n) => {
        if (graph.getNodeData(n.id)) {
          try { graph.setElementState(n.id, []); } catch { /* ignore */ }
          try { graph.updateNodeData([{ id: n.id, style: { opacity: 1 } }]); } catch { /* ignore */ }
        }
      });
      data.edges.forEach((e) => {
        if (graph.getEdgeData(e.id)) {
          try { graph.setElementState(e.id, []); } catch { /* ignore */ }
          try { graph.updateEdgeData([{ id: e.id, style: { opacity: 1 } }]); } catch { /* ignore */ }
        }
      });
    }
  });

  graph.on('node:dragend', () => {
    isDraggingRef.current = false;
    if (graphReadyRef.current) applyNodeStatesRef.current();
  });

  graph.setData(g6Data);

  // 选中节点通过 d3-force fx/fy 固定在画布中心，不参与力导向计算
  const containerWidth = container.clientWidth || 800;
  const containerHeight = container.clientHeight || 600;
  const centerX = containerWidth / 2;
  const centerY = containerHeight / 2;
  const curSelectedId = useGraphStore.getState().selectedNodeId;
  if (curSelectedId) {
    try {
      (graph as any).updateNodeData([{ id: curSelectedId, fx: centerX, fy: centerY }]);
    } catch { /* ignore */ }
  }

  // render 是异步的（d3-force 布局模拟可能数秒），但 canvas 上下文在 render 开始后很快初始化
  // 用 requestAnimationFrame 提前标记 ready，不等 render 完全结束，让高亮/暗化尽早可用
  const renderPromise = graph.render();
  requestAnimationFrame(() => {
    graphReadyRef.current = true;
    console.log('[graph] render 首帧后标记 graphReady=true');
    if (!isDraggingRef.current) {
      applyNodeStatesRef.current();
      // 选中节点以画布中心为初始位置，首帧即可精准聚焦
      const currentId = useGraphStore.getState().selectedNodeId;
      if (currentId && useGraphStore.getState().displaySettings.trackSelectedNode) {
        try { graph.focusElement(currentId, { duration: 200, easing: 'ease-in-out' }); } catch { /* ignore */ }
      }
    }
  });

  return { graph, renderPromise };
}

// 将业务节点/边数据转换为 G6 格式（过滤掉悬空边）
function toG6Nodes(nodes: GraphNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    style: (node.style || {}) as G6NodeStyle,
    data: {
      label: node.label,
      category: node.category,
      description: node.description,
      ...node.data,
    } as Record<string, unknown>,
  }));
}

function toG6Edges(edges: GraphEdge[], nodeIdSet: Set<string>) {
  return edges
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: (edge.style || {}) as G6EdgeStyle,
      data: {
        label: edge.label,
        ...edge.data,
      } as Record<string, unknown>,
    }));
}

/** 业务节点 → G6 节点 data 字段（与 toG6Nodes 保持一致的结构） */
function toG6Data(node: GraphNode): Record<string, unknown> {
  return {
    label: node.label,
    category: node.category,
    description: node.description,
    ...node.data,
  } as Record<string, unknown>;
}

/** 聚合层新增数据的 G6 格式：聚合层边统一打 data.kind='aggregate' 标记，
 *  新增节点以锚点为圆心散布初始位置（复用真实层 pendingAddition 的预置位置模式） */
function buildAggG6Data(nodes: GraphNode[], edges: GraphEdge[], anchorX: number, anchorY: number): G6GraphData {
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const g6Nodes = nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * 2 * Math.PI;
    const radius = 90 + Math.random() * 50;
    return {
      id: n.id,
      style: {
        ...((n.style || {}) as G6NodeStyle),
        x: anchorX + Math.cos(angle) * radius,
        y: anchorY + Math.sin(angle) * radius,
      } as G6NodeStyle,
      data: toG6Data(n),
    };
  });
  const g6Edges = edges
    .filter((e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: (edge.style || {}) as G6EdgeStyle,
      data: {
        label: edge.label,
        kind: 'aggregate',
        ...edge.data,
      } as Record<string, unknown>,
    }));
  return { nodes: g6Nodes, edges: g6Edges };
}

export function GraphContainer({ className }: GraphContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const isDraggingRef = useRef(false);
  // 标记当前 graph 实例是否已完成首次 render（render 是异步的）
  const graphReadyRef = useRef(false);
  // 图谱代数，每次销毁重建时递增，用于丢弃过期 render().then() 回调
  const graphGenerationRef = useRef(0);

  const {
    fullData, visibleData, selectedNodeId, highlightedNodeId, highlightedEdgeIds,
    selectNode, bfsExpandNode, pendingAddition, commitAddition, rebuildTrigger,
    displaySettings, categoryFilter,
  } = useGraphStore();

  // 聚合层：订阅 layerRevision 触发 G6 增量同步
  const layerRevision = useAggregateStore((s) => s.layerRevision);

  // 应用节点/边的选中高亮状态
  // 不使用 G6 state 的 opacity，改为用 updateNodeData/updateEdgeData 显式设置
  // 批量收集后一次性调用，避免逐节点/逐边触发多次重绘
  const applyNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !fullData || !visibleData) return;
    if (!graphReadyRef.current) return;

    const visibleNodeIds = new Set(visibleData.nodes.map((n) => n.id));
    const hasSelection = !!selectedNodeId;

    // 类别过滤：当设置了 categoryFilter 时，仅选中节点和匹配类别的节点保持高亮
    const categoryFilter = useGraphStore.getState().categoryFilter;
    const nodeCategoryMap = new Map<string, string | undefined>();
    fullData.nodes.forEach((n) => nodeCategoryMap.set(n.id, n.category));

    const nodeStateUpdates: { id: string; states: string[] }[] = [];
    const nodeStyleUpdates: { id: string; style: { opacity: number } }[] = [];

    fullData.nodes.forEach((node) => {
      if (!graph.getNodeData(node.id)) return;
      const states: string[] = [];
      if (node.id === selectedNodeId) {
        states.push('selected');
      } else if (node.id === highlightedNodeId) {
        states.push('highlighted');
      }
      nodeStateUpdates.push({ id: node.id, states });
      // 设置非高亮节点透明度（越小越淡）
      const dimmedByBFS = hasSelection && !visibleNodeIds.has(node.id);
      const matchesCategory = categoryFilter.length === 0 || node.id === selectedNodeId || (node.category != null && categoryFilter.includes(node.category));
      const dimmed = dimmedByBFS || (!matchesCategory);
      nodeStyleUpdates.push({ id: node.id, style: { opacity: dimmed ? 0.2 : 1 } });
    });

    nodeStateUpdates.forEach(({ id, states }) => {
      try { graph.setElementState(id, states); } catch { /* ignore */ }
    });
    if (nodeStyleUpdates.length > 0) {
      try { graph.updateNodeData(nodeStyleUpdates); } catch { /* ignore */ }
    }

    const edgeStateUpdates: { id: string; states: string[] }[] = [];
    const edgeStyleUpdates: { id: string; style: { opacity: number } }[] = [];

    fullData.edges.forEach((edge) => {
      if (!graph.getEdgeData(edge.id)) return;
      let isActive = selectedNodeId && highlightedEdgeIds.has(edge.id);
      // 类别过滤下，仅另一端也在筛选列表中才保持边高亮
      if (isActive && categoryFilter.length > 0) {
        const otherId = edge.source === selectedNodeId ? edge.target : edge.source;
        const otherCat = nodeCategoryMap.get(otherId);
        isActive = otherCat != null && categoryFilter.includes(otherCat);
      }
      edgeStateUpdates.push({ id: edge.id, states: isActive ? ['active'] : [] });
      // 边暗化：BFS 不可见 或 类别过滤中任一端点不匹配（仅两端都高亮的边才保留）
      const dimmedByBFS = hasSelection && !isActive;
      const srcCatMatch = categoryFilter.length === 0 || edge.source === selectedNodeId || (nodeCategoryMap.get(edge.source) != null && categoryFilter.includes(nodeCategoryMap.get(edge.source)!));
      const tgtCatMatch = categoryFilter.length === 0 || edge.target === selectedNodeId || (nodeCategoryMap.get(edge.target) != null && categoryFilter.includes(nodeCategoryMap.get(edge.target)!));
      const dimmedByCategory = categoryFilter.length > 0 && (!srcCatMatch || !tgtCatMatch);
      const dimmed = dimmedByBFS || dimmedByCategory;
      edgeStyleUpdates.push({ id: edge.id, style: { opacity: dimmed ? 0.2 : 1 } });
    });

    edgeStateUpdates.forEach(({ id, states }) => {
      try { graph.setElementState(id, states); } catch { /* ignore */ }
    });
    if (edgeStyleUpdates.length > 0) {
      try { graph.updateEdgeData(edgeStyleUpdates); } catch { /* ignore */ }
    }
  }, [fullData, visibleData, selectedNodeId, highlightedNodeId, highlightedEdgeIds]);

  // 保持最新引用，供事件回调使用
  const applyNodeStatesRef = useRef(applyNodeStates);
  applyNodeStatesRef.current = applyNodeStates;

  const fullDataRef = useRef(fullData);
  fullDataRef.current = fullData;

  // Category 颜色映射表：随 fullData 更新，通过 ref 供 G6 渲染回调使用
  const categoryColorMapRef = useRef(new Map<string, string>());
  if (fullData) {
    categoryColorMapRef.current = buildCategoryColorMap(
      fullData.nodes.map((n) => n.category)
    );
  }

  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  const bfsExpandNodeRef = useRef(bfsExpandNode);
  bfsExpandNodeRef.current = bfsExpandNode;

  // 双击展开中标记：dblclick 设为 true，阻止 selectedNodeId useEffect 立即聚焦
  // 由 afterlayout（有新数据）或 isLoading 兜底（无新数据）统一聚焦
  const dblClickExpandingRef = useRef(false);

  // 增量渲染布局是否进行中：pendingAddition 处理时设为 true，afterlayout 后清为 false
  const hasPendingLayoutRef = useRef(false);

  // 增量渲染：pendingAddition 变化时，用 G6 addData + render 追加节点
  // 注意：commitAddition 会更新 fullData 但不递增 rebuildTrigger，因此不会触发重建
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !pendingAddition) return;

    // 过滤 G6 已存在的节点（聚合成员先被加载、后 BFS 重复加载的场景，防重复 id 报错）
    const g6ExistingIds = new Set(graph.getNodeData().map((n) => n.id as string));
    const newNodeList = pendingAddition.nodes.filter((n) => !g6ExistingIds.has(n.id));

    // nodeIdSet 必须包含已有 + 新增节点，否则连接新旧节点的边会被过滤
    const existingNodeIds = fullData ? fullData.nodes.map((n) => n.id) : [];
    const allNodeIds = [...existingNodeIds, ...newNodeList.map((n) => n.id)];
    const nodeIdSet = new Set(allNodeIds);
    const g6Data: G6GraphData = {
      nodes: toG6Nodes(newNodeList),
      edges: toG6Edges(pendingAddition.edges, nodeIdSet),
    };

    console.log(
      `[graph] 增量渲染 → addData ${newNodeList.length} 节点, ${pendingAddition.edges.length} 边（过滤 G6 已存在 ${pendingAddition.nodes.length - newNodeList.length} 个；rebuildTrigger=${rebuildTrigger}）`
    );

    // 将新增节点散布在选中节点周围，避免默认 (0,0) 把力导向拽偏
    const currentNodeId = useGraphStore.getState().selectedNodeId;
    let anchorX = 0;
    let anchorY = 0;
    if (currentNodeId) {
      try {
        const pos = graph.getElementPosition(currentNodeId);
        anchorX = pos[0];
        anchorY = pos[1];
      } catch { /* 节点可能尚未渲染 */ }
    }

    g6Data.nodes = (g6Data.nodes || []).map((n, i) => {
      const angle = (i / Math.max(1, g6Data.nodes?.length ?? 1)) * 2 * Math.PI;
      const radius = 80 + Math.random() * 40;
      return {
        ...n,
        style: {
          ...(n.style as Record<string, unknown>),
          x: anchorX + Math.cos(angle) * radius,
          y: anchorY + Math.sin(angle) * radius,
        },
      };
    });

    graph.stopLayout();
    graph.addData(g6Data);

    // 固定当前选中节点的位置（通过 fx/fy 告诉 d3-force 该节点不受力导向影响）
    if (currentNodeId) {
      try {
        const pos = graph.getElementPosition(currentNodeId);
        (graph as any).updateNodeData([{ id: currentNodeId, fx: pos[0], fy: pos[1] }]);
      } catch { /* 节点尚未渲染 */ }
    }

    const gen = graphGenerationRef.current;
    hasPendingLayoutRef.current = true;
    const renderPromise = graph.render();

    // 布局首帧后的聚焦（选中节点已固定，位置从首帧起即准确）
    renderPromise.then(() => {
      if (graphGenerationRef.current !== gen) return;
      hasPendingLayoutRef.current = false;
      dblClickExpandingRef.current = false;
      graphReadyRef.current = true;
      if (!isDraggingRef.current) {
        applyNodeStatesRef.current();
        const currentFocusId = useGraphStore.getState().selectedNodeId;
        if (currentFocusId && useGraphStore.getState().displaySettings.trackSelectedNode) {
          try { graph.focusElement(currentFocusId, { duration: 200, easing: 'ease-in-out' }); } catch { /* ignore */ }
        }
      }
    });

    // 首帧立即聚焦，不等布局收敛（选中节点已通过 fx/fy 固定，首帧位置即正确）
    requestAnimationFrame(() => {
      if (graphGenerationRef.current !== gen) return;
      dblClickExpandingRef.current = false;
      if (!isDraggingRef.current) {
        applyNodeStatesRef.current();
        const currentFocusId = useGraphStore.getState().selectedNodeId;
        if (currentFocusId && useGraphStore.getState().displaySettings.trackSelectedNode) {
          try { graph.focusElement(currentFocusId, { duration: 200, easing: 'ease-in-out' }); } catch { /* ignore */ }
        }
      }
    });

    commitAddition(pendingAddition.nodes, pendingAddition.edges);
  }, [pendingAddition, commitAddition, rebuildTrigger]);

  // ── 聚合层同步：订阅 layerRevision，将聚合节点/锚点/成员/成员边增量同步到 G6 ──
  // 与真实层（fullData/pendingAddition）完全隔离；rebuildTrigger 变化（图销毁重建）后
  // 首次同步走全量重放（G6 实例是新的，聚合层需要重新 addData）
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!graphReadyRef.current) return;
    if (layerRevision === 0) return;

    const agg = useAggregateStore.getState();
    const gen = graphGenerationRef.current;

    // 计算当前聚合层应呈现的完整数据集
    const layerNodes: GraphNode[] = [];
    if (agg.anchorNode) layerNodes.push(agg.anchorNode);
    layerNodes.push(...agg.layerNodes);

    // 成员：仅统计仍被「展开中 bucket」引用的成员；且真实层已拥有的节点跳过（不重复 addData）
    const realIds = new Set((useGraphStore.getState().fullData?.nodes ?? []).map((n) => n.id));
    const expandedBuckets = new Set(
      [...agg.bucketStates.entries()].filter(([, s]) => s.expanded).map(([id]) => id),
    );
    const memberNodes: GraphNode[] = [];
    for (const entry of agg.memberRegistry.values()) {
      const referenced = [...entry.buckets].some((b) => expandedBuckets.has(b));
      if (!referenced) continue;
      if (realIds.has(entry.node.id)) continue; // 真实层已有，只呈现成员边
      memberNodes.push(entry.node);
    }
    const memberEdges = [...agg.memberEdges.values()].filter((e) =>
      expandedBuckets.has(e.source),
    );

    // ── diff：对比 G6 当前数据与目标数据集，计算增删 ──
    const targetNodes = new Map<string, GraphNode>();
    for (const n of layerNodes) targetNodes.set(n.id, n);
    for (const n of memberNodes) targetNodes.set(n.id, n);

    const targetEdges = new Map<string, GraphEdge>();
    for (const e of agg.displayEdges) targetEdges.set(e.id, e);
    for (const e of memberEdges) targetEdges.set(e.id, e);

    const g6NodeIds = new Set(graph.getNodeData().map((n) => n.id as string));
    const g6EdgeIds = new Set(graph.getEdgeData().map((e) => e.id as string));

    // G6 中存在但不属于真实层（fullData）也不属于目标集 → 聚合层残留，需删
    const realNodeIds = new Set(realIds);
    const realEdgeIds = new Set((useGraphStore.getState().fullData?.edges ?? []).map((e) => e.id));
    const removeNodeIds: string[] = [];
    for (const id of g6NodeIds) {
      if (realNodeIds.has(id)) continue; // 真实层节点不动
      if (targetNodes.has(id)) continue;
      removeNodeIds.push(id);
    }
    const removeEdgeIds: string[] = [];
    for (const id of g6EdgeIds) {
      if (realEdgeIds.has(id)) continue;
      if (targetEdges.has(id)) continue;
      removeEdgeIds.push(id);
    }

    const addNodes = [...targetNodes.values()].filter((n) => !g6NodeIds.has(n.id));
    const addEdges = [...targetEdges.values()].filter((e) => !g6EdgeIds.has(e.id));

    // 指标/数量等数据变化（节点已存在但 data 变了）→ updateNodeData 局部刷新
    const updateNodes: { id: string; data: Record<string, unknown> }[] = [];
    for (const [id, node] of targetNodes) {
      if (!g6NodeIds.has(id)) continue;
      const cur = graph.getNodeData(id);
      if (cur && JSON.stringify(cur.data) !== JSON.stringify(toG6Data(node))) {
        updateNodes.push({ id, data: toG6Data(node) });
      }
    }

    const hasStructuralChange = removeNodeIds.length > 0 || removeEdgeIds.length > 0
      || addNodes.length > 0 || addEdges.length > 0;

    console.log(
      `[aggregate-sync] rev=${layerRevision} +${addNodes.length}n/+${addEdges.length}e -${removeNodeIds.length}n/-${removeEdgeIds.length}e ~${updateNodes.length}n`
    );

    try {
      if (removeNodeIds.length > 0 || removeEdgeIds.length > 0) {
        // G6 5.x removeData 接受 DataID：{ nodes: id[], edges: id[] }
        graph.removeData({ nodes: removeNodeIds, edges: removeEdgeIds });
      }
      if (addNodes.length > 0 || addEdges.length > 0) {
        // 新增节点以锚点（局部=真实锚点节点；全局=scope 锚点）为中心散布初始位置
        const anchorId = agg.realAnchorNodeId ?? agg.anchorNode?.id ?? null;
        let anchorX = 0, anchorY = 0;
        if (anchorId) {
          try {
            const pos = graph.getElementPosition(anchorId);
            anchorX = pos[0]; anchorY = pos[1];
          } catch { /* 锚点可能尚未渲染 */ }
        }
        const g6Data = buildAggG6Data(addNodes, addEdges, anchorX, anchorY);
        graph.addData(g6Data);
      }
      if (hasStructuralChange) {
        // 结构变化（成员增删）→ render 重跑布局（与真实层 pendingAddition 先例一致）
        // 已知限制：全局 d3-force 重算，真实节点位置可能移动
        hasPendingLayoutRef.current = true;
        graph.render().then(() => {
          if (graphGenerationRef.current !== gen) return;
          hasPendingLayoutRef.current = false;
          if (!isDraggingRef.current) applyNodeStatesRef.current();
        });
      } else if (updateNodes.length > 0) {
        // 纯数据更新（指标 complete）→ updateNodeData + draw 局部刷新，不重跑布局
        graph.updateNodeData(updateNodes);
        graph.draw();
      }
    } catch (err) {
      console.error('[aggregate-sync] G6 同步失败:', err);
    }
  }, [layerRevision, rebuildTrigger]);

  // rebuildTrigger 变化时：真正销毁旧图并重建（仅 setGraphData 递增此值）
  useEffect(() => {
    if (!containerRef.current || !fullData) return;

    console.log(
      `[graph] 全量重建 → rebuildTrigger=${rebuildTrigger}, 节点数=${fullData.nodes.length}, 边数=${fullData.edges.length}`
    );

    // 销毁旧图
    if (graphRef.current) {
      graphRef.current.destroy();
      graphRef.current = null;
    }
    graphReadyRef.current = false;
    dblClickExpandingRef.current = false;
    hasPendingLayoutRef.current = false;
    const aggHadLayer = useAggregateStore.getState().scope != null;

    const gen = ++graphGenerationRef.current;

    const nodeIdSet = new Set(fullData.nodes.map((n) => n.id));

    // 计算画布中心，用于节点初始位置散布
    const container = containerRef.current;
    const centerX = container ? container.clientWidth / 2 : 400;
    const centerY = container ? container.clientHeight / 2 : 300;

    // 构建节点：选中节点以画布中心为初始位置并固定 (fx/fy)，其他节点围绕中心预置初始位置
    const rawNodes = toG6Nodes(fullData.nodes);
    const g6Nodes = rawNodes.map((n, i) => {
      const id = n.id as string;
      const baseStyle = (n.style as Record<string, unknown>) || {};
      if (id === selectedNodeId) {
        return { ...n, style: { ...baseStyle, x: centerX, y: centerY } };
      }
      const angle = (i / Math.max(1, rawNodes.length - 1 || 1)) * 2 * Math.PI;
      const radius = 120 + Math.random() * 60;
      return { ...n, style: { ...baseStyle, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius } };
    });

    const g6Data = {
      nodes: g6Nodes,
      edges: toG6Edges(fullData.edges, nodeIdSet),
    };

    const { graph } = createGraph(
      containerRef.current,
      fullDataRef,
      isDraggingRef,
      applyNodeStatesRef,
      graphReadyRef,
      selectNodeRef.current,
      bfsExpandNodeRef.current,
      dblClickExpandingRef,
      g6Data,
      displaySettings,
      categoryColorMapRef,
    );
    graphRef.current = graph;

    // rebuild 后聚合层需要重放：syncAggregateLayer effect 因 graphReady=false 跳过，
    // 在首帧 ready 后强制同步一次（仅当聚合层存在时才会实际添加数据）
    if (aggHadLayer) {
      requestAnimationFrame(() => {
        useAggregateStore.getState().requestSync();
      });
    }

    return () => {
      graphGenerationRef.current = gen + 1; // 使所有进行中的 .then() 回调失效
      graphReadyRef.current = false;
      graph.destroy();
      graphRef.current = null;
    };
  }, [rebuildTrigger]);

  // displaySettings 变化时动态更新所有节点标签和边样式（不重建图）
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!graphReadyRef.current) return;

    // 更新节点标签（类别前缀开关）
    // 注意：setNode 是整体替换 style，使用共享配置函数保持完整
    graph.setNode({
      style: getNodeStyleConfig(displaySettings, categoryColorMapRef),
      state: getNodeStateConfig(),
    });

    // 使用 setEdge 更新全局边样式映射（优先级最高），
    // 再用 draw() 仅重绘不重排布局，让样式变更生效
    graph.setEdge({
      type: 'line',
      style: {
        stroke: (d: EdgeData) => {
          if (isAggregateEdgeData(d)) {
            const src = d.source as string;
            return src.startsWith('agg::') ? AGG_MEMBER_EDGE_STROKE : AGG_EDGE_STROKE;
          }
          return (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8';
        },
        lineWidth: (d: EdgeData) => {
          if (isAggregateEdgeData(d)) return 1;
          return ((d.style as Record<string, unknown>)?.lineWidth as number) || 1;
        },
        lineDash: (d: EdgeData) => (isAggregateEdgeData(d) ? [4, 4] : []),
        lineCap: 'butt',
        lineJoin: 'miter',
        endArrow: displaySettings.showEdgeArrows,
        endArrowSize: 6,
        endArrowFill: (d: EdgeData) => (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8',
        labelText: displaySettings.showEdgeLabels ? (d: EdgeData) => (d.data?.label as string) || '' : () => '',
        labelFontSize: 9,
        labelFill: '#64748b',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 0.6,
      },
      state: {
        active: { stroke: '#6366f1', lineWidth: 2 },
      },
    });
    graph.draw();

    // draw() 不会自动重设已有元素的 state 样式，需手动重新应用节点状态
    if (!isDraggingRef.current) {
      applyNodeStatesRef.current();
    }
  }, [displaySettings]);

  // React 状态变化时更新节点状态（拖拽期间跳过，由 dragend 处理）
  useEffect(() => {
    if (isDraggingRef.current) return;
    applyNodeStates();
  }, [applyNodeStates]);

  // categoryFilter 变化时重新应用节点/边状态（筛选不经过 applyNodeStates 的 deps，需要独立响应）
  useEffect(() => {
    if (isDraggingRef.current) return;
    applyNodeStatesRef.current();
  }, [categoryFilter]);

  // 选中节点变化时，自动将画布聚焦到该节点（双击展开时跳过，由 afterlayout 统一处理）
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !graphReadyRef.current || !selectedNodeId) return;
    if (dblClickExpandingRef.current) return; // 双击展开中，等待布局完成后再聚焦
    if (!useGraphStore.getState().displaySettings.trackSelectedNode) return;
    try {
      graph.focusElement(selectedNodeId, { duration: 200, easing: 'ease-in-out' });
    } catch { /* ignore */ }
  }, [selectedNodeId]);

  // 兜底：双击展开但无新数据时 afterlayout 不会触发，通过 isLoading 结束来聚焦
  const isLoading = useGraphStore((s) => s.isLoading);
  useEffect(() => {
    if (!isLoading && dblClickExpandingRef.current && !hasPendingLayoutRef.current) {
      // 展开结束、没有待处理布局 → afterlayout 不会来了，直接聚焦
      dblClickExpandingRef.current = false;
      const graph = graphRef.current;
      if (graph && graphReadyRef.current && selectedNodeId && useGraphStore.getState().displaySettings.trackSelectedNode) {
        try { graph.focusElement(selectedNodeId, { duration: 200, easing: 'ease-in-out' }); } catch { /* ignore */ }
      }
    }
  }, [isLoading, selectedNodeId]);

  // 容器大小变化时调整图谱（使用 ResizeObserver 替代 window.resize）
  // window.resize 无法感知 flex 容器尺寸变化（如 F12 开启 dock 时），且需要 debounce 避免频繁调用打断拖拽
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        // 拖拽期间跳过 resize，避免打断 drag-element-force 状态
        if (isDraggingRef.current) continue;
        // debounce 150ms，避免 F12 开启时连续触发
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const graph = graphRef.current;
          if (!graph) return;
          graph.resize(width, height);
          console.log(`[graph] ResizeObserver → resize(${Math.round(width)}, ${Math.round(height)})`);
        }, 150);
      }
    });

    observer.observe(container);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  // 根据 expandTrigger 配置阻止浏览器右键菜单（rightclick/both 模式下需要）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const needsPreventContextMenu =
      displaySettings.expandTrigger === 'rightclick' ||
      displaySettings.expandTrigger === 'both';

    if (!needsPreventContextMenu) return;

    const preventCtx = (e: MouseEvent) => e.preventDefault();
    container.addEventListener('contextmenu', preventCtx);
    return () => container.removeEventListener('contextmenu', preventCtx);
  }, [displaySettings.expandTrigger]);

  return (
    <div className="relative w-full h-full" style={{ minHeight: 400 }}>
      <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />
      {displaySettings.showNodePopup && <GraphControl />}
    </div>
  );
}
