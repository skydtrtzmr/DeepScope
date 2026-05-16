import { create } from 'zustand';
import type { GraphData, GraphNode, GraphConfig, RelatedNodeDetail } from '@/types/graph';

interface GraphState {
  // 数据
  fullData: GraphData | null; // 完整图谱数据
  visibleData: GraphData | null; // 当前可见数据
  selectedNodeId: string | null; // 选中的节点 ID
  highlightedNodeId: string | null; // 高亮的节点 ID（列表悬停）
  relatedNodes: RelatedNodeDetail[]; // 关联节点详情列表

  // 配置
  config: GraphConfig;

  // 追溯历史
  nodeHistory: string[]; // 节点访问历史栈

  // 加载状态
  isLoading: boolean;

  // Actions
  setGraphData: (data: GraphData) => void;
  selectNode: (nodeId: string | null) => void;
  highlightNode: (nodeId: string | null) => void;
  updateConfig: (config: Partial<GraphConfig>) => void;
  expandMore: () => void; // 加载更多（增加 m）
  expandDeeper: () => void; // 加载更深（增加 n）
  goBack: () => void; // 返回上一节点
  reset: () => void; // 重置状态
}

// BFS 算法：获取指定深度内的关联节点
function getRelatedNodes(
  data: GraphData,
  startNodeId: string,
  maxDirect: number,
  maxDepth: number
): { visibleData: GraphData; relatedNodes: RelatedNodeDetail[] } {
  const visitedNodes = new Set<string>();
  const visibleNodeIds = new Set<string>();
  const visibleEdgeIds = new Set<string>();
  const relatedNodes: RelatedNodeDetail[] = [];

  // 构建邻接表
  const adjacency = new Map<string, { nodeId: string; edgeId: string; label?: string }[]>();
  data.edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, []);
    }
    adjacency.get(edge.source)!.push({ nodeId: edge.target, edgeId: edge.id, label: edge.label });
    adjacency.get(edge.target)!.push({ nodeId: edge.source, edgeId: edge.id, label: edge.label });
  });

  // 节点 ID 到节点数据的映射
  const nodeMap = new Map<string, GraphNode>();
  data.nodes.forEach((node) => nodeMap.set(node.id, node));

  // 添加起始节点
  visibleNodeIds.add(startNodeId);
  visitedNodes.add(startNodeId);

  // BFS 遍历
  interface QueueItem {
    nodeId: string;
    depth: number;
  }
  const queue: QueueItem[] = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    if (depth >= maxDepth) continue;

    const neighbors = adjacency.get(nodeId) || [];
    let addedCount = 0;

    for (const neighbor of neighbors) {
      // 每层限制最大关联数
      if (depth === 0 && addedCount >= maxDirect) break;

      if (!visitedNodes.has(neighbor.nodeId)) {
        visitedNodes.add(neighbor.nodeId);
        visibleNodeIds.add(neighbor.nodeId);
        visibleEdgeIds.add(neighbor.edgeId);

        const node = nodeMap.get(neighbor.nodeId);
        if (node) {
          relatedNodes.push({
            id: node.id,
            label: node.label,
            type: node.type,
            description: node.description,
            relationLabel: neighbor.label,
            depth: depth + 1,
            data: node.data,
          });
        }

        queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
        if (depth === 0) addedCount++;
      } else {
        // 节点已访问，但边可能未添加
        visibleEdgeIds.add(neighbor.edgeId);
      }
    }
  }

  // 构建可见数据
  const visibleData: GraphData = {
    nodes: data.nodes.filter((n) => visibleNodeIds.has(n.id)),
    edges: data.edges.filter((e) => visibleEdgeIds.has(e.id)),
  };

  // 按深度排序
  relatedNodes.sort((a, b) => a.depth - b.depth);

  return { visibleData, relatedNodes };
}

const DEFAULT_CONFIG: GraphConfig = {
  maxDirectRelations: 10,
  maxDepth: 2,
};

export const useGraphStore = create<GraphState>((set, get) => ({
  // 初始状态
  fullData: null,
  visibleData: null,
  selectedNodeId: null,
  highlightedNodeId: null,
  relatedNodes: [],
  config: DEFAULT_CONFIG,
  nodeHistory: [],
  isLoading: false,

  // 设置图谱数据
  setGraphData: (data) => {
    set({
      fullData: data,
      visibleData: data, // 初始显示全部数据
      selectedNodeId: null,
      highlightedNodeId: null,
      relatedNodes: [],
      nodeHistory: [],
    });
  },

  // 选择节点
  selectNode: (nodeId) => {
    const { fullData, config, selectedNodeId, nodeHistory } = get();

    if (!nodeId || !fullData) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
      });
      return;
    }

    // 如果点击已选中的节点，取消选择
    if (nodeId === selectedNodeId) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
      });
      return;
    }

    // 添加到历史记录
    const newHistory = selectedNodeId ? [...nodeHistory, selectedNodeId] : nodeHistory;

    // 计算可见数据
    const { visibleData, relatedNodes } = getRelatedNodes(
      fullData,
      nodeId,
      config.maxDirectRelations,
      config.maxDepth
    );

    set({
      selectedNodeId: nodeId,
      visibleData,
      relatedNodes,
      nodeHistory: newHistory,
    });
  },

  // 高亮节点
  highlightNode: (nodeId) => {
    set({ highlightedNodeId: nodeId });
  },

  // 更新配置
  updateConfig: (newConfig) => {
    const { fullData, selectedNodeId, config } = get();
    const updatedConfig = { ...config, ...newConfig };

    set({ config: updatedConfig });

    // 如果有选中节点，重新计算可见数据
    if (selectedNodeId && fullData) {
      const { visibleData, relatedNodes } = getRelatedNodes(
        fullData,
        selectedNodeId,
        updatedConfig.maxDirectRelations,
        updatedConfig.maxDepth
      );
      set({ visibleData, relatedNodes });
    }
  },

  // 扩展更多（增加 m）
  expandMore: () => {
    const { config } = get();
    get().updateConfig({ maxDirectRelations: config.maxDirectRelations + 5 });
  },

  // 扩展更深（增加 n）
  expandDeeper: () => {
    const { config } = get();
    get().updateConfig({ maxDepth: config.maxDepth + 1 });
  },

  // 返回上一节点
  goBack: () => {
    const { nodeHistory } = get();
    if (nodeHistory.length === 0) return;

    const newHistory = [...nodeHistory];
    const previousNodeId = newHistory.pop()!;

    // 直接设置选中节点，不添加到历史
    const { fullData, config } = get();
    if (!fullData) return;

    const { visibleData, relatedNodes } = getRelatedNodes(
      fullData,
      previousNodeId,
      config.maxDirectRelations,
      config.maxDepth
    );

    set({
      selectedNodeId: previousNodeId,
      visibleData,
      relatedNodes,
      nodeHistory: newHistory,
    });
  },

  // 重置
  reset: () => {
    const { fullData } = get();
    set({
      visibleData: fullData,
      selectedNodeId: null,
      highlightedNodeId: null,
      relatedNodes: [],
      config: DEFAULT_CONFIG,
      nodeHistory: [],
    });
  },
}));
