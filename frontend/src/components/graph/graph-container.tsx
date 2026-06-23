import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData, type GraphData as G6GraphData, type BaseNodeStyleProps, type BaseEdgeStyleProps } from '@antv/g6';

/** G6 spec 层的 NodeStyle/EdgeStyle 未导出，用 Base*StyleProps + 索引签名等价还原 */
type G6NodeStyle = Partial<BaseNodeStyleProps> & { [key: string]: unknown };
type G6EdgeStyle = Partial<BaseEdgeStyleProps> & { [key: string]: unknown };
import { useGraphStore } from '@/lib/stores/graph-store';
import { GraphControl } from './graph-control';
import type { GraphNode, GraphEdge, DisplaySettings } from '@/types/graph';
import { getNodeColor, buildCategoryColorMap } from '@/lib/graph-color';

interface GraphContainerProps {
  className?: string;
}

/** 根据 displaySettings 计算节点 labelText（含可选的类别前缀） */
function getLabelText(d: NodeData, showCategoryLabel: boolean): string {
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
      const explicit = (d.style as Record<string, unknown>)?.fill as string | undefined;
      if (explicit) return explicit;
      const cat = d.data?.category as string | undefined;
      if (!cat) return '#94a3b8';
      return categoryColorMapRef.current.get(cat) || getNodeColor(cat);
    },
    size: (d: NodeData) => ((d.style as Record<string, unknown>)?.radius as number) || 28,
    stroke: '#334155',
    lineWidth: 2,
    lineDash: [],
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
      link: { distance: 250, strength: 0.6 },
      manyBody: { strength: -80 },
      collide: { radius: 120, strength: 1 },
      center: { strength: 0.05 },
      alphaMin: 0.002,
      alphaDecay: 0.03,
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
        stroke: (d: EdgeData) => (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8',
        lineWidth: (d: EdgeData) => ((d.style as Record<string, unknown>)?.lineWidth as number) || 1,
        lineDash: [],
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

  graph.on('canvas:click', () => {
    selectNode(null);
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
    displaySettings,
  } = useGraphStore();

  // 应用节点/边的选中高亮状态
  // 不使用 G6 state 的 opacity，改为用 updateNodeData/updateEdgeData 显式设置
  // 批量收集后一次性调用，避免逐节点/逐边触发多次重绘
  const applyNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !fullData || !visibleData) return;
    if (!graphReadyRef.current) return;

    const visibleNodeIds = new Set(visibleData.nodes.map((n) => n.id));
    const hasSelection = !!selectedNodeId;

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
      const dimmed = hasSelection && !visibleNodeIds.has(node.id);
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
      const isActive = selectedNodeId && highlightedEdgeIds.has(edge.id);
      edgeStateUpdates.push({ id: edge.id, states: isActive ? ['active'] : [] });
      // 设置非高亮边透明度
      const dimmed = hasSelection && !isActive;
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

    // nodeIdSet 必须包含已有 + 新增节点，否则连接新旧节点的边会被过滤
    const existingNodeIds = fullData ? fullData.nodes.map((n) => n.id) : [];
    const allNodeIds = [...existingNodeIds, ...pendingAddition.nodes.map((n) => n.id)];
    const nodeIdSet = new Set(allNodeIds);
    const g6Data: G6GraphData = {
      nodes: toG6Nodes(pendingAddition.nodes),
      edges: toG6Edges(pendingAddition.edges, nodeIdSet),
    };

    console.log(
      `[graph] 增量渲染 → addData ${pendingAddition.nodes.length} 节点, ${pendingAddition.edges.length} 边（rebuildTrigger=${rebuildTrigger}）`
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
        stroke: (d: EdgeData) => (d.style as Record<string, unknown>)?.stroke as string || '#94a3b8',
        lineWidth: (d: EdgeData) => ((d.style as Record<string, unknown>)?.lineWidth as number) || 1,
        lineDash: [],
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
