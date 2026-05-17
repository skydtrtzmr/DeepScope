import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData } from '@antv/g6';
import { useGraphStore } from '@/lib/stores/graph-store';
import { NodeDetailCard } from './node-detail-card';
import type { GraphNode, GraphEdge } from '@/types/graph';

interface GraphContainerProps {
  className?: string;
}

// 创建图谱实例并绑定事件
function createGraph(
  container: HTMLElement,
  fullDataRef: React.MutableRefObject<unknown>,
  isDraggingRef: React.MutableRefObject<boolean>,
  applyNodeStatesRef: React.MutableRefObject<() => void>,
  graphReadyRef: React.MutableRefObject<boolean>,
  selectNode: (nodeId: string | null) => void,
  g6Data: Record<string, unknown>,
) {
  const options: GraphOptions = {
    container,
    padding: 40,
    behaviors: [
      'drag-canvas',
      'zoom-canvas',
      { type: 'drag-element-force', fixed: false },
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
        size: 28,
        labelText: (d: NodeData) => (d.data?.label as string) || d.id,
        labelPlacement: 'bottom',
        labelFontSize: 11,
        labelFill: '#0f172a',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 0.6,
        labelBackgroundRadius: 4,
        labelPadding: [2, 6],
        fill: (d: NodeData) => (d.style as Record<string, unknown>)?.fill as string || '#94a3b8',
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
        selected: { stroke: '#6366f1', lineWidth: 4, shadowColor: '#6366f1', shadowBlur: 10 },
        highlighted: { stroke: '#6366f1', lineWidth: 3 },
        inactive: { opacity: 0.3 },
      },
    },
    edge: {
      type: 'line',
      style: {
        stroke: '#94a3b8',
        lineWidth: 1,
        lineDash: [],
        lineCap: 'butt',
        lineJoin: 'miter',
        endArrow: true,
        endArrowSize: 6,
        endArrowFill: '#94a3b8',
        labelText: (d: EdgeData) => (d.data?.label as string) || '',
        labelFontSize: 9,
        labelFill: '#64748b',
        labelBackground: true,
        labelBackgroundFill: '#ffffff',
        labelBackgroundOpacity: 0.6,
      },
      state: {
        active: { stroke: '#6366f1', lineWidth: 2 },
        inactive: { opacity: 0.2 },
      },
    },
  };

  const graph = new Graph(options);

  graph.on('node:click', (event) => {
    // G6 v5 事件对象：event.target 是触发事件的元素，.id 为节点 ID
    const nodeId = (event as { target: { id: string } }).target.id;
    if (!graph.getNodeData(nodeId)) return; // 防御：确保 id 是有效节点
    selectNode(nodeId);
  });

  graph.on('node:dragstart', () => {
    isDraggingRef.current = true;
    const data = fullDataRef.current as { nodes: { id: string }[]; edges: { id: string }[] } | null;
    if (data) {
      data.nodes.forEach((n) => {
        if (graph.getNodeData(n.id)) try { graph.setElementState(n.id, []); } catch { /* ignore */ }
      });
      data.edges.forEach((e) => {
        if (graph.getEdgeData(e.id)) try { graph.setElementState(e.id, []); } catch { /* ignore */ }
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
    style: node.style || {},
    data: {
      label: node.label,
      category: node.category,
      description: node.description,
      ...node.data,
    },
  }));
}

function toG6Edges(edges: GraphEdge[], nodeIdSet: Set<string>) {
  return edges
    .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: edge.style || {},
      data: {
        label: edge.label,
        ...edge.data,
      },
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
    selectNode, pendingAddition, commitAddition, rebuildTrigger,
  } = useGraphStore();

  // 应用节点/边的选中高亮状态
  // graphReadyRef 在 render 首帧后标记（不等布局收敛），setElementState 加 try/catch 防护
  const applyNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !fullData || !visibleData) return;
    if (!graphReadyRef.current) return;

    const visibleNodeIds = new Set(visibleData.nodes.map((n) => n.id));

    fullData.nodes.forEach((node) => {
      if (!graph.getNodeData(node.id)) return;
      const states: string[] = [];
      if (node.id === selectedNodeId) {
        states.push('selected');
      } else if (node.id === highlightedNodeId) {
        states.push('highlighted');
      } else if (selectedNodeId && !visibleNodeIds.has(node.id)) {
        states.push('inactive');
      }
      try { graph.setElementState(node.id, states); } catch { /* canvas 尚未就绪，下次重试 */ }
    });

    fullData.edges.forEach((edge) => {
      if (!graph.getEdgeData(edge.id)) return;
      // 边高亮条件：必须是 BFS 树边（depth d → d+1 的最短路径边）
      const isActive = selectedNodeId && highlightedEdgeIds.has(edge.id);
      try { graph.setElementState(edge.id, isActive ? ['active'] : []); } catch { /* canvas 尚未就绪，下次重试 */ }
    });
  }, [fullData, visibleData, selectedNodeId, highlightedNodeId, highlightedEdgeIds]);

  // 保持最新引用，供事件回调使用
  const applyNodeStatesRef = useRef(applyNodeStates);
  applyNodeStatesRef.current = applyNodeStates;

  const fullDataRef = useRef(fullData);
  fullDataRef.current = fullData;

  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  // 增量渲染：pendingAddition 变化时，用 G6 addData + render 追加节点
  // 注意：commitAddition 会更新 fullData 但不递增 rebuildTrigger，因此不会触发重建
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !pendingAddition) return;

    // nodeIdSet 必须包含已有 + 新增节点，否则连接新旧节点的边会被过滤
    const existingNodeIds = fullData ? fullData.nodes.map((n) => n.id) : [];
    const allNodeIds = [...existingNodeIds, ...pendingAddition.nodes.map((n) => n.id)];
    const nodeIdSet = new Set(allNodeIds);
    const g6Data = {
      nodes: toG6Nodes(pendingAddition.nodes),
      edges: toG6Edges(pendingAddition.edges, nodeIdSet),
    };

    console.log(
      `[graph] 增量渲染 → addData ${pendingAddition.nodes.length} 节点, ${pendingAddition.edges.length} 边（rebuildTrigger=${rebuildTrigger}）`
    );

    graph.addData(g6Data);
    const gen = graphGenerationRef.current;
    graph.render();
    // 增量渲染同样用首帧即可，不等力导向布局完全收敛
    requestAnimationFrame(() => {
      if (graphGenerationRef.current !== gen) return;
      graphReadyRef.current = true;
      if (!isDraggingRef.current) applyNodeStatesRef.current();
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
      g6Data,
    );
    graphRef.current = graph;

    return () => {
      graphGenerationRef.current = gen + 1; // 使所有进行中的 .then() 回调失效
      graphReadyRef.current = false;
      graph.destroy();
      graphRef.current = null;
    };
  }, [rebuildTrigger]);

  // React 状态变化时更新节点状态（拖拽期间跳过，由 dragend 处理）
  useEffect(() => {
    if (isDraggingRef.current) return;
    applyNodeStates();
  }, [applyNodeStates]);

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
      <NodeDetailCard />
    </div>
  );
}
