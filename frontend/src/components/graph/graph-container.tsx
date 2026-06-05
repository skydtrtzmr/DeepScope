import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData, type GraphData as G6GraphData, type BaseNodeStyleProps, type BaseEdgeStyleProps } from '@antv/g6';

/** G6 spec 层的 NodeStyle/EdgeStyle 未导出，用 Base*StyleProps + 索引签名等价还原 */
type G6NodeStyle = Partial<BaseNodeStyleProps> & { [key: string]: unknown };
type G6EdgeStyle = Partial<BaseEdgeStyleProps> & { [key: string]: unknown };
import { useGraphStore } from '@/lib/stores/graph-store';
import { GraphControl } from './graph-control';
import type { GraphNode, GraphEdge, DisplaySettings } from '@/types/graph';
import { getNodeColor } from '@/types/graph';

interface GraphContainerProps {
  className?: string;
}

// 第 6 行之后插入
/** hover-activate 的 enable 回调事件对象 */
interface G6PointerEvent {
  targetType: 'node' | 'edge' | 'canvas';
}


// 创建图谱实例并绑定事件
function createGraph(
  container: HTMLElement,
  fullDataRef: React.MutableRefObject<unknown>,
  isDraggingRef: React.MutableRefObject<boolean>,
  applyNodeStatesRef: React.MutableRefObject<() => void>,
  graphReadyRef: React.MutableRefObject<boolean>,
  selectNode: (nodeId: string | null) => void,
  expandNode: (nodeId: string) => void,
  dblClickExpandingRef: React.MutableRefObject<boolean>,
  g6Data: Record<string, unknown>,
  displaySettings: DisplaySettings,
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
      collide: { radius: 40, strength: 1 },
      center: { strength: 0.05 },
      alphaDecay: 0.02,
      velocityDecay: 0.3,
    },
    node: {
      type: 'circle',
      style: {
        labelText: (d: NodeData) => (d.data?.label as string) || d.id,
        labelPlacement: 'bottom',
        labelFontSize: 11,
        labelFill: '#0f172a',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 0.6,
        labelBackgroundRadius: 4,
        labelPadding: [2, 6],
        fill: (d: NodeData) => (d.style as Record<string, unknown>)?.fill as string || getNodeColor(d.data?.category as string),
        size: (d: NodeData) => ((d.style as Record<string, unknown>)?.radius as number) || 28,
        stroke: '#334155',
        lineWidth: 2,
        lineDash: [],
        lineCap: 'butt',
        lineJoin: 'miter',
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowBlur: 4,
        cursor: 'grab',
      },
      state: {
        selected: { stroke: '#6366f1', lineWidth: 4 },
        // 注意：在 G6 的默认主题文件 base.ts 中（第 122-131 行），selected 状态的内置主题样式定义如下：
        // selected: {
        //   halo: true,
        //   haloLineWidth: 24,
        //   haloStrokeOpacity: nodeHaloStrokeOpacitySelected,
        //   labelFontSize: 12,
        //   labelFontWeight: 'bold',
        //   lineWidth: 4,
        //   stroke: nodeStroke,
        // },
        // themeStateStyle 是主题内置的状态样式，它包含了 halo: true, haloLineWidth: 24。
        // 所以如果要关掉Halo，则需要显式设置 halo: false。

        highlighted: {
          stroke: '#6366f1',
          lineWidth: 3,
          halo: true,
          haloLineWidth: 16,           // 调整光晕宽度
          haloStroke: '#6366f1',       // 光晕颜色
          haloStrokeOpacity: 0.15,
        },
        hovered: {
          stroke: '#6366f1',
          lineWidth: 3,
          halo: true,
          haloLineWidth: 16,           // 调整光晕宽度
          haloStroke: '#6366f1',       // 光晕颜色
          haloStrokeOpacity: 0.15,
        },
      },
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

  // 单击/双击区分：延迟单击判定，250ms 内有第二次 click 则视为双击
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingClickNodeId: string | null = null;

  graph.on('node:click', (event) => {
    const nodeId = (event as { target: { id: string } }).target.id;
    if (!graph.getNodeData(nodeId)) return;

    // 如果本次 click 与上一次 click 同一节点且在等待期内 → 双击的第二次 click，取消定时器
    if (clickTimer && pendingClickNodeId === nodeId) {
      clearTimeout(clickTimer);
      clickTimer = null;
      pendingClickNodeId = null;
      return; // 由 dblclick handler 统一处理
    }

    // 点击了不同节点，取消之前的定时器（立即切换）
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }

    // 延迟 250ms 执行单击逻辑，等待可能的双击
    pendingClickNodeId = nodeId;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      pendingClickNodeId = null;
      selectNode(nodeId);
    }, 250);
  });

  graph.on('node:dblclick', (event) => {
    const nodeId = (event as { target: { id: string } }).target.id;
    if (!graph.getNodeData(nodeId)) return;

    // 清除可能残留的单击定时器
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      pendingClickNodeId = null;
    }

    // 标记双击展开中，让 selectedNodeId useEffect 跳过立即聚焦
    // 聚焦统一由 afterlayout（有新数据）或 isLoading 兜底（无新数据）处理
    dblClickExpandingRef.current = true;

    // 确保节点处于选中状态（避免 toggle 已选中节点导致取消选中）
    const currentSelected = useGraphStore.getState().selectedNodeId;
    if (currentSelected !== nodeId) {
      selectNode(nodeId);
    }

    expandNode(nodeId);
  });

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
  // render 是异步的（d3-force 布局模拟可能数秒），但 canvas 上下文在 render 开始后很快初始化
  // 用 requestAnimationFrame 提前标记 ready，不等 render 完全结束，让高亮/暗化尽早可用
  graph.render();
  requestAnimationFrame(() => {
    graphReadyRef.current = true;
    console.log('[graph] render 首帧后标记 graphReady=true');
    if (!isDraggingRef.current) applyNodeStatesRef.current();
  });

  return graph;
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
    selectNode, expandNode, pendingAddition, commitAddition, rebuildTrigger,
    displaySettings,
  } = useGraphStore();

  // 应用节点/边的选中高亮状态
  // 不使用 G6 state 的 opacity（清除后不恢复），改为用 updateNodeData/updateEdgeData 显式设置
  // 优化：批量收集后一次性调用，避免逐节点/逐边触发多次重绘
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

      // 淡化：不在 BFS 可见范围内的节点设为低 opacity，其余完全不透明
      const dimmed = hasSelection && !visibleNodeIds.has(node.id);
      nodeStyleUpdates.push({ id: node.id, style: { opacity: dimmed ? 0.5 : 1 } });
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

      // 淡化：非高亮边在选中时设为低 opacity，其余完全不透明
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

  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  const expandNodeRef = useRef(expandNode);
  expandNodeRef.current = expandNode;

  // 双击展开中标记：dblclick 设为 true，阻止 selectedNodeId useEffect 立即聚焦
  // 由 afterlayout（有新数据）或 isLoading 兜底（无新数据）统一聚焦
  const dblClickExpandingRef = useRef(false);

  // 增量渲染布局是否进行中：pendingAddition 处理时设为 true，afterlayout 后清为 false
  const hasPendingLayoutRef = useRef(false);

  // 增量渲染聚焦延时定时器，用于在 generation 变化时清理
  const focusTimerRef = useRef<number | null>(null);

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

    graph.stopLayout();
    graph.addData(g6Data);
    const gen = graphGenerationRef.current;
    hasPendingLayoutRef.current = true;
    graph.render();

    // 延时 200ms 后聚焦：不等力导向完全收敛（afterlayout 太慢），只等初步稳定即可
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      if (graphGenerationRef.current !== gen) return;
      hasPendingLayoutRef.current = false;
      dblClickExpandingRef.current = false;
      graphReadyRef.current = true;
      if (!isDraggingRef.current) {
        applyNodeStatesRef.current();
        const currentNodeId = useGraphStore.getState().selectedNodeId;
        if (currentNodeId && useGraphStore.getState().displaySettings.trackSelectedNode) {
          try { graph.focusElement(currentNodeId, { duration: 400, easing: 'ease-in-out' }); } catch { /* ignore */ }
        }
      }
      focusTimerRef.current = null;
    }, 200);

    // 首帧也先标记 ready（万一 afterlayout 不触发），但不聚焦
    requestAnimationFrame(() => {
      if (graphGenerationRef.current !== gen) return;
      if (!graphReadyRef.current) {
        graphReadyRef.current = true;
        if (!isDraggingRef.current) applyNodeStatesRef.current();
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
    const g6Data = {
      nodes: toG6Nodes(fullData.nodes),
      edges: toG6Edges(fullData.edges, nodeIdSet),
    };

    const graph = createGraph(
      containerRef.current,
      fullDataRef,
      isDraggingRef,
      applyNodeStatesRef,
      graphReadyRef,
      selectNodeRef.current,
      expandNodeRef.current,
      dblClickExpandingRef,
      g6Data,
      displaySettings,
    );
    graphRef.current = graph;

    return () => {
      graphGenerationRef.current = gen + 1; // 使所有进行中的 .then() 回调失效
      graphReadyRef.current = false;
      graph.destroy();
      graphRef.current = null;
    };
  }, [rebuildTrigger]);

  // displaySettings 变化时动态更新所有边的箭头和标签样式（不重建图）
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!graphReadyRef.current) return;

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
      graph.focusElement(selectedNodeId, { duration: 400, easing: 'ease-in-out' });
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
        try { graph.focusElement(selectedNodeId, { duration: 400, easing: 'ease-in-out' }); } catch { /* ignore */ }
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

  return (
    <div className="relative w-full h-full" style={{ minHeight: 400 }}>
      <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />
      <GraphControl />
    </div>
  );
}
