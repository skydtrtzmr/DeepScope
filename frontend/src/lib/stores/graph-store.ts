import { create } from 'zustand';
import type { GraphData, GraphNode, GraphEdge, GraphConfig, RelatedNodeDetail } from '@/types/graph';
import { expandGraph } from '@/lib/api';

export type ViewMode = 'global' | 'local';

interface NodeExpansionState {
  loadedNeighborIds: string[];
  totalNeighbors: number;
}

interface GraphState {
  // 数据
  fullData: GraphData | null;
  visibleData: GraphData | null;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  relatedNodes: RelatedNodeDetail[];

  // 配置
  config: GraphConfig;

  // 追溯历史
  nodeHistory: string[];

  // 加载状态
  isLoading: boolean;

  // 视图模式：global 全局总览 | local 局部增长
  viewMode: ViewMode;

  // 每个节点的展开状态（用于累积增长）
  expansionStates: Map<string, NodeExpansionState>;

  // 当前正在展开的节点 ID（防并发重入）
  expandingNodeId: string | null;

  // G6 实例重建版本号：仅 setGraphData 时递增，commitAddition 不递增
  // 组件据此决定是否销毁重建 G6，彻底消除 effect 时序依赖
  rebuildTrigger: number;

  // 待增量添加到 G6 的数据（非 null 时组件应调用 G6 addData + render）
  pendingAddition: { nodes: GraphNode[]; edges: GraphEdge[] } | null;

  // Actions
  setGraphData: (data: GraphData) => void;
  appendGraphData: (nodeId: string, data: GraphData, totalNeighbors: number) => void;
  expandNode: (nodeId: string) => Promise<void>;
  commitAddition: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  selectNode: (nodeId: string | null) => void;
  highlightNode: (nodeId: string | null) => void;
  updateConfig: (config: Partial<GraphConfig>) => void;
  expandMore: () => void;
  expandDeeper: () => void;
  goBack: () => void;
  reset: () => void;
  setViewMode: (mode: ViewMode) => void;
}

const DEFAULT_CONFIG: GraphConfig = {
  maxDirectRelations: 5,
  maxDepth: 2,
};

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
        visibleEdgeIds.add(neighbor.edgeId);
      }
    }
  }

  const visibleData: GraphData = {
    nodes: data.nodes.filter((n) => visibleNodeIds.has(n.id)),
    edges: data.edges.filter((e) => visibleEdgeIds.has(e.id)),
  };

  relatedNodes.sort((a, b) => a.depth - b.depth);

  return { visibleData, relatedNodes };
}

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
  viewMode: 'global',
  expansionStates: new Map(),
  pendingAddition: null,
  expandingNodeId: null,
  rebuildTrigger: 0,

  // 设置图谱数据（初始加载）
  setGraphData: (data) => {
    console.log('[store] setGraphData → 递增 rebuildTrigger，触发 G6 全量重建');
    set({
      fullData: data,
      visibleData: data,
      selectedNodeId: null,
      highlightedNodeId: null,
      relatedNodes: [],
      nodeHistory: [],
      expansionStates: new Map(),
      pendingAddition: null,
      expandingNodeId: null,
      rebuildTrigger: get().rebuildTrigger + 1,
    });
  },

  // 追加图谱数据（累积增长）
  appendGraphData: (nodeId, data, totalNeighbors) => {
    const { fullData, expansionStates } = get();
    if (!fullData) return;

    // 合并新数据
    const existingNodeIds = new Set(fullData.nodes.map((n) => n.id));
    const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));

    const newNodes = data.nodes.filter((n) => !existingNodeIds.has(n.id));
    const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id));

    const mergedData: GraphData = {
      nodes: [...fullData.nodes, ...newNodes],
      edges: [...fullData.edges, ...newEdges],
    };

    // 更新展开状态
    const newExpansionStates = new Map(expansionStates);
    const currentState = newExpansionStates.get(nodeId);
    const newLoadedIds = [
      ...(currentState?.loadedNeighborIds || []),
      ...newNodes.map((n) => n.id),
    ];
    newExpansionStates.set(nodeId, {
      loadedNeighborIds: newLoadedIds,
      totalNeighbors,
    });

    set({
      fullData: mergedData,
      visibleData: mergedData,
      expansionStates: newExpansionStates,
    });
  },

  // 选择节点
  selectNode: (nodeId) => {
    const { fullData, config, selectedNodeId, nodeHistory, viewMode } = get();

    if (!nodeId || !fullData) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
      });
      return;
    }

    if (nodeId === selectedNodeId) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
      });
      return;
    }

    // local 模式：仅切换选中节点，不重算 visibleData（G6 画布保持全量）
    if (viewMode === 'local') {
      const newHistory = selectedNodeId ? [...nodeHistory, selectedNodeId] : nodeHistory;
      set({ selectedNodeId: nodeId, nodeHistory: newHistory });
      return;
    }

    // global 模式：BFS 过滤生成 visibleData
    const newHistory = selectedNodeId ? [...nodeHistory, selectedNodeId] : nodeHistory;

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

  // 展开节点（local 模式：加载未加载的邻居节点，设置 pendingAddition 供组件增量渲染）
  expandNode: async (nodeId) => {
    const { fullData, expansionStates, config, expandingNodeId } = get();
    if (!fullData) return;

    // 防并发：同一节点正在展开时不重复请求
    if (expandingNodeId === nodeId) return;

    const existingNodeIds = new Set(fullData.nodes.map((n) => n.id));

    // 计算当前已加载的邻居 ID（fullData 中与 nodeId 直接相连的节点）
    const loadedNeighborIds = new Set<string>();
    fullData.edges.forEach((e) => {
      if (e.source === nodeId) loadedNeighborIds.add(e.target);
      if (e.target === nodeId) loadedNeighborIds.add(e.source);
    });
    loadedNeighborIds.delete(nodeId);

    const state = expansionStates.get(nodeId);
    // 如果已加载的邻居数量等于总邻居数，说明没有更多邻居了
    if (state && loadedNeighborIds.size >= state.totalNeighbors) {
      return;
    }

    set({ isLoading: true, expandingNodeId: nodeId });

    try {
      const result = await expandGraph({
        nodeId,
        m: config.maxDirectRelations,
        n: config.maxDepth,
        offset: 0,
        excludeExistingIds: [...loadedNeighborIds],
      });

      if (result.nodes.length === 0) {
        set({ isLoading: false, expandingNodeId: null });
        return;
      }

      // 过滤出真正新的节点和边
      const newNodes = result.nodes.filter((n) => !existingNodeIds.has(n.id));
      const newNodeIds = new Set(newNodes.map((n) => n.id));
      const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));
      const allNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
      const newEdges = result.edges.filter(
        (e) => !existingEdgeIds.has(e.id) && allNodeIds.has(e.source) && allNodeIds.has(e.target)
      );

      if (newNodes.length === 0 && newEdges.length === 0) {
        set({ isLoading: false, expandingNodeId: null });
        return;
      }

      // 更新展开状态
      const newExpansionStates = new Map(expansionStates);
      const mergedNeighborIds = new Set([...loadedNeighborIds, ...newNodes.map((n) => n.id)]);
      newExpansionStates.set(nodeId, {
        loadedNeighborIds: [...mergedNeighborIds],
        totalNeighbors: result.totalNeighbors,
      });

      // 设置待增量渲染数据，通知组件调用 G6 addData
      set({
        pendingAddition: { nodes: newNodes, edges: newEdges },
        expansionStates: newExpansionStates,
      });
    } catch (err) {
      console.error('展开节点失败:', err);
      set({ isLoading: false, expandingNodeId: null });
    }
  },

  // 组件完成 G6 增量渲染后调用，更新 fullData
  commitAddition: (nodes, edges) => {
    const { fullData, rebuildTrigger } = get();
    if (!fullData) return;

    const mergedData: GraphData = {
      nodes: [...fullData.nodes, ...nodes],
      edges: [...fullData.edges, ...edges],
    };

    console.log(
      `[store] commitAddition → 追加 ${nodes.length} 节点, ${edges.length} 边, rebuildTrigger 保持 ${rebuildTrigger}（不递增，不触发重建）`
    );

    set({
      fullData: mergedData,
      visibleData: mergedData,
      pendingAddition: null,
      isLoading: false,
      expandingNodeId: null,
    });
  },

  // 切换视图模式
  setViewMode: (mode) => {
    set({ viewMode: mode });
  },
}));
