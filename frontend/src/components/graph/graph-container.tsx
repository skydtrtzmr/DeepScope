import { useEffect, useRef, useCallback, useState } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData } from '@antv/g6';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';
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
  selectNode: (nodeId: string | null) => void,
  expandNode: (nodeId: string) => Promise<void>,
  viewModeRef: React.MutableRefObject<string>,
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
        fill: (d: NodeData) => getNodeColor(d.data?.type as string),
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
    const nodeId = (event as unknown as { target: { id: string } }).target.id;
    selectNode(nodeId);
  });

  graph.on('node:dblclick', async (event) => {
    const nodeId = (event as unknown as { target: { id: string } }).target.id;
    if (viewModeRef.current === 'local') {
      await expandNode(nodeId);
      selectNode(nodeId);
    }
  });

  graph.on('node:dragstart', () => {
    isDraggingRef.current = true;
    const data = fullDataRef.current as { nodes: { id: string }[]; edges: { id: string }[] } | null;
    if (data) {
      data.nodes.forEach((n) => {
        if (graph.getNodeData(n.id)) graph.setElementState(n.id, []);
      });
      data.edges.forEach((e) => {
        if (graph.getEdgeData(e.id)) graph.setElementState(e.id, []);
      });
    }
  });

  graph.on('node:dragend', () => {
    isDraggingRef.current = false;
    applyNodeStatesRef.current();
  });

  graph.on('canvas:click', () => {
    selectNode(null);
  });

  graph.setData(g6Data);
  graph.render().then(() => {
    if (!isDraggingRef.current) applyNodeStatesRef.current();
  });

  return graph;
}

// 将业务节点/边数据转换为 G6 格式
function toG6Nodes(nodes: GraphNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    data: {
      label: node.label,
      type: node.type,
      description: node.description,
      ...node.data,
    },
  }));
}

function toG6Edges(edges: GraphEdge[]) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
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
  // 递增计数器，仅变化时才真正销毁重建 G6 实例
  const [rebuildTrigger, setRebuildTrigger] = useState(0);
  const skipFullDataEffectRef = useRef(false);

  const {
    fullData, visibleData, selectedNodeId, highlightedNodeId,
    selectNode, viewMode, expandNode, pendingAddition, commitAddition,
  } = useGraphStore();

  // 应用节点/边的选中高亮状态
  const applyNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !fullData || !visibleData) return;

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
      graph.setElementState(node.id, states);
    });

    fullData.edges.forEach((edge) => {
      if (!graph.getEdgeData(edge.id)) return;
      const isActive =
        selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      graph.setElementState(edge.id, isActive ? ['active'] : []);
    });
  }, [fullData, visibleData, selectedNodeId, highlightedNodeId]);

  // 保持最新引用，供事件回调使用
  const applyNodeStatesRef = useRef(applyNodeStates);
  applyNodeStatesRef.current = applyNodeStates;

  const fullDataRef = useRef(fullData);
  fullDataRef.current = fullData;

  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  const expandNodeRef = useRef(expandNode);
  expandNodeRef.current = expandNode;

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // 增量渲染：pendingAddition 变化时，用 G6 addData + render 追加节点
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !pendingAddition) return;

    const g6Data = {
      nodes: toG6Nodes(pendingAddition.nodes),
      edges: toG6Edges(pendingAddition.edges),
    };

    graph.addData(g6Data);
    graph.render().then(() => {
      if (!isDraggingRef.current) applyNodeStatesRef.current();
    });

    // 标记下次 fullData 变化不触发重建
    skipFullDataEffectRef.current = true;
    // 提交增量数据到 store（更新 fullData，但不递增 rebuildTrigger）
    commitAddition(pendingAddition.nodes, pendingAddition.edges);
  }, [pendingAddition, commitAddition]);

  // fullData 变化时：决定是否需要重建图谱
  // 增量更新（commitAddition 触发）时跳过，仅模式切换/初始加载时才重建
  useEffect(() => {
    if (skipFullDataEffectRef.current) {
      skipFullDataEffectRef.current = false;
      return;
    }
    setRebuildTrigger((v) => v + 1);
  }, [fullData]);

  // rebuildTrigger 变化时：真正销毁旧图并重建
  useEffect(() => {
    if (!containerRef.current || !fullData) return;

    // 销毁旧图
    if (graphRef.current) {
      graphRef.current.destroy();
      graphRef.current = null;
    }

    const g6Data = {
      nodes: toG6Nodes(fullData.nodes),
      edges: toG6Edges(fullData.edges),
    };

    const graph = createGraph(
      containerRef.current,
      fullDataRef,
      isDraggingRef,
      applyNodeStatesRef,
      selectNodeRef.current,
      expandNodeRef.current,
      viewModeRef,
      g6Data,
    );
    graphRef.current = graph;

    return () => {
      graph.destroy();
      graphRef.current = null;
    };
  }, [rebuildTrigger]);

  // React 状态变化时更新节点状态（拖拽期间跳过，由 dragend 处理）
  useEffect(() => {
    if (isDraggingRef.current) return;
    applyNodeStates();
  }, [applyNodeStates]);

  // 窗口大小变化时调整图谱
  useEffect(() => {
    const handleResize = () => {
      const graph = graphRef.current;
      const container = containerRef.current;
      if (!graph || !container) return;

      const { width, height } = container.getBoundingClientRect();
      graph.resize(width, height);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full" style={{ minHeight: 400 }}>
      <div ref={containerRef} className={className} style={{ width: '100%', height: '100%' }} />
      <NodeDetailCard />
    </div>
  );
}
