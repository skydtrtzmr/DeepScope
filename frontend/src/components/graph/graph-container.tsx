import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData } from '@antv/g6';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';
import { NodeDetailCard } from './node-detail-card';

interface GraphContainerProps {
  className?: string;
}

export function GraphContainer({ className }: GraphContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const isDraggingRef = useRef(false);

  const { fullData, visibleData, selectedNodeId, highlightedNodeId, selectNode } = useGraphStore();

  // 应用节点/边的选中高亮状态
  const applyNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !fullData || !visibleData) return;

    const visibleNodeIds = new Set(visibleData.nodes.map((n) => n.id));

    fullData.nodes.forEach((node) => {
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

  // 初始化图谱
  useEffect(() => {
    if (!containerRef.current || graphRef.current) return;

    const container = containerRef.current;

    const options: GraphOptions = {
      container,
      autoFit: 'view',
      padding: 40,
      behaviors: [
        'drag-canvas',
        'zoom-canvas',
        { type: 'drag-element-force', fixed: false },
      ],
      layout: {
        type: 'd3-force',
        link: {
          distance: 120,
          strength: 0.8,
        },
        manyBody: {
          strength: -50,
        },
        collide: {
          radius: 30,
          strength: 0.9,
        },
        center: {
          strength: 0.1,
        },
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
          labelBackgroundOpacity: 0.9,
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
          selected: {
            stroke: '#6366f1',
            lineWidth: 4,
            shadowColor: '#6366f1',
            shadowBlur: 10,
          },
          highlighted: {
            stroke: '#6366f1',
            lineWidth: 3,
          },
          inactive: {
            opacity: 0.3,
          },
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
          labelBackgroundOpacity: 0.9,
        },
        state: {
          active: {
            stroke: '#6366f1',
            lineWidth: 2,
          },
          inactive: {
            opacity: 0.2,
          },
        },
      },
    };

    const graph = new Graph(options);
    graphRef.current = graph;

    // 节点点击事件
    graph.on('node:click', (event) => {
      const nodeId = (event as unknown as { target: { id: string } }).target.id;
      selectNode(nodeId);
    });

    // 拖拽开始：清除所有 G6 元素状态，防止 inactive 与力导向冲突 + 防止多选拖拽
    graph.on('node:dragstart', () => {
      isDraggingRef.current = true;
      const data = fullDataRef.current;
      if (data) {
        data.nodes.forEach((n) => graph.setElementState(n.id, []));
        data.edges.forEach((e) => graph.setElementState(e.id, []));
      }
    });

    // 拖拽结束：恢复选中高亮状态
    graph.on('node:dragend', () => {
      isDraggingRef.current = false;
      applyNodeStatesRef.current();
    });

    // 画布点击事件（取消选中）
    graph.on('canvas:click', () => {
      selectNode(null);
    });

    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [selectNode]);

  // 数据更新：始终使用 fullData 渲染全部节点
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !fullData) return;

    const g6Data = {
      nodes: fullData.nodes.map((node) => ({
        id: node.id,
        data: {
          label: node.label,
          type: node.type,
          description: node.description,
          ...node.data,
        },
      })),
      edges: fullData.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          label: edge.label,
          ...edge.data,
        },
      })),
    };

    graph.setData(g6Data);
    graph.render();
  }, [fullData]);

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
