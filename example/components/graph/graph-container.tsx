'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Graph, type GraphOptions, type NodeData, type EdgeData } from '@antv/g6';
import { useGraphStore } from '@/lib/stores/graph-store';
import { getNodeColor } from '@/types/graph';

interface GraphContainerProps {
  className?: string;
}

export function GraphContainer({ className }: GraphContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  const { visibleData, selectedNodeId, highlightedNodeId, selectNode } = useGraphStore();

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
        nodeStrength: -300,
        linkDistance: 150,
      },
      node: {
        style: {
          size: 40,
          labelText: (d: NodeData) => (d.data?.label as string) || d.id,
          labelPlacement: 'bottom',
          labelFontSize: 12,
          labelFill: 'var(--foreground)',
          labelBackground: true,
          labelBackgroundFill: 'var(--background)',
          labelBackgroundOpacity: 0.8,
          labelBackgroundRadius: 4,
          labelPadding: [2, 6],
          fill: (d: NodeData) => getNodeColor(d.data?.type as string),
          stroke: 'var(--border)',
          lineWidth: 2,
        },
        state: {
          selected: {
            stroke: 'var(--primary)',
            lineWidth: 4,
            shadowColor: 'var(--primary)',
            shadowBlur: 10,
          },
          highlighted: {
            stroke: 'var(--primary)',
            lineWidth: 3,
          },
          inactive: {
            opacity: 0.3,
          },
        },
      },
      edge: {
        style: {
          stroke: 'var(--muted-foreground)',
          lineWidth: 1,
          endArrow: true,
          endArrowSize: 8,
          labelText: (d: EdgeData) => (d.data?.label as string) || '',
          labelFontSize: 10,
          labelFill: 'var(--muted-foreground)',
          labelBackground: true,
          labelBackgroundFill: 'var(--background)',
          labelBackgroundOpacity: 0.8,
        },
        state: {
          active: {
            stroke: 'var(--primary)',
            lineWidth: 2,
          },
          inactive: {
            opacity: 0.2,
          },
        },
      },
      animation: {
        duration: 300,
      },
    };

    const graph = new Graph(options);
    graphRef.current = graph;

    // 节点点击事件
    graph.on('node:click', (event) => {
      const nodeId = event.target.id as string;
      selectNode(nodeId);
    });

    // 画布点击事件（取消选中）
    graph.on('canvas:click', () => {
      selectNode(null);
    });

    // 初始渲染
    graph.render();

    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [selectNode]);

  // 数据更新
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !visibleData) return;

    // 转换数据格式为 G6 格式
    const g6Data = {
      nodes: visibleData.nodes.map((node) => ({
        id: node.id,
        data: {
          label: node.label,
          type: node.type,
          description: node.description,
          ...node.data,
        },
      })),
      edges: visibleData.edges.map((edge) => ({
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
  }, [visibleData]);

  // 更新节点状态
  const updateNodeStates = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || !visibleData) return;

    visibleData.nodes.forEach((node) => {
      const states: string[] = [];

      if (node.id === selectedNodeId) {
        states.push('selected');
      } else if (node.id === highlightedNodeId) {
        states.push('highlighted');
      } else if (selectedNodeId && node.id !== selectedNodeId) {
        // 检查是否是选中节点的直接关联
        const isRelated = visibleData.edges.some(
          (e) =>
            (e.source === selectedNodeId && e.target === node.id) ||
            (e.target === selectedNodeId && e.source === node.id)
        );
        if (!isRelated) {
          states.push('inactive');
        }
      }

      graph.setElementState(node.id, states);
    });

    // 更新边状态
    visibleData.edges.forEach((edge) => {
      const isActive =
        selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      graph.setElementState(edge.id, isActive ? ['active'] : []);
    });
  }, [visibleData, selectedNodeId, highlightedNodeId]);

  useEffect(() => {
    updateNodeStates();
  }, [updateNodeStates]);

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
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
    />
  );
}
