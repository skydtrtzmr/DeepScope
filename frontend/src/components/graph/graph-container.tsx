import { useEffect, useRef } from 'react';
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

  const { fullData, visibleData, selectedNodeId, highlightedNodeId, selectNode } = useGraphStore();

  // 初始化图谱
  useEffect(() => {
    if (!containerRef.current || graphRef.current) return;

    const container = containerRef.current;

    const options: GraphOptions = {
      container,
      autoFit: 'view',
      padding: 40,
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 50,
        nodeStrength: -600,
        linkDistance: 160,
        edgeStrength: 0.3,
        collideStrength: 1,
        animated: false,
        maxIterations: 500,
        maxSpeed: 200,
        alphaDecay: 0.05,
        alphaMin: 0.001,
      },
      node: {
        type: 'circle',
        style: {
          size: 40,
          labelText: (d: NodeData) => (d.data?.label as string) || d.id,
          labelPlacement: 'bottom',
          labelFontSize: 12,
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
          lineWidth: 1.5,
          lineDash: [],
          lineCap: 'butt',
          lineJoin: 'miter',
          endArrow: true,
          endArrowSize: 8,
          endArrowFill: '#94a3b8',
          labelText: (d: EdgeData) => (d.data?.label as string) || '',
          labelFontSize: 10,
          labelFill: '#64748b',
          labelBackground: true,
          labelBackgroundFill: '#ffffff',
          labelBackgroundOpacity: 0.9,
        },
        state: {
          active: {
            stroke: '#6366f1',
            lineWidth: 2.5,
          },
          inactive: {
            opacity: 0.2,
          },
        },
      },
      animation: false,
    };

    const graph = new Graph(options);
    graphRef.current = graph;

    // 节点点击事件
    graph.on('node:click', (event) => {
      const nodeId = (event as unknown as { target: { id: string } }).target.id;
      selectNode(nodeId);
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

  // 更新节点状态（选中/高亮/非活跃）
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !visibleData) return;

    const visibleNodeIds = new Set(visibleData.nodes.map((n) => n.id));

    fullData?.nodes.forEach((node) => {
      const states: string[] = [];

      if (node.id === selectedNodeId) {
        states.push('selected');
      } else if (node.id === highlightedNodeId) {
        states.push('highlighted');
      } else if (selectedNodeId && node.id !== selectedNodeId) {
        // 不在当前 visibleData 中的节点标记为 inactive
        if (!visibleNodeIds.has(node.id)) {
          states.push('inactive');
        }
      }

      graph.setElementState(node.id, states);
    });

    // 更新边状态
    fullData?.edges.forEach((edge) => {
      const isActive =
        selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      graph.setElementState(edge.id, isActive ? ['active'] : []);
    });
  }, [selectedNodeId, highlightedNodeId, visibleData, fullData]);

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
