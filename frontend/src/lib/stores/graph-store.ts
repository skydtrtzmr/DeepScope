import { create } from 'zustand';
import type {
  GraphData, GraphNode, GraphEdge, GraphConfig, ExploreConfig,
  ExploreButtonState, RelatedNodeDetail,
} from '@/types/graph';
import { expandGraph } from '@/lib/api';

export type ViewMode = 'global' | 'local';

/** 每个节点的探索状态 */
interface NodeExpansionState {
  loadedDirectCount: number; // 已加载的直接邻居数（从 fullData 中实时计算）
  totalDirectCount: number; // 直接邻居总数（API 返回）
  maxDepthExplored: number; // 已探索过的最大 n 值（0 = 从未探索）
}

interface GraphState {
  // 数据
  fullData: GraphData | null;
  visibleData: GraphData | null;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  relatedNodes: RelatedNodeDetail[];
  // BFS 树边集合，用于边高亮（仅 depth d → d+1 的最短路径边）
  highlightedEdgeIds: Set<string>;

  // 高亮配置（BFS 过滤已加载数据）
  config: GraphConfig;

  // 探索配置（控制 API 请求参数）
  exploreConfig: ExploreConfig;

  // 追溯历史
  nodeHistory: string[];

  // 加载状态
  isLoading: boolean;

  // 视图模式：global 全局总览 | local 局部增长
  viewMode: ViewMode;

  // 每个节点的探索状态（用于累积增长 + 按钮状态判定）
  expansionStates: Map<string, NodeExpansionState>;

  // 当前正在展开的节点 ID（防并发重入）
  expandingNodeId: string | null;

  // G6 实例重建版本号：仅 setGraphData 时递增，commitAddition 不递增
  rebuildTrigger: number;

  // 待增量添加到 G6 的数据（非 null 时组件应调用 G6 addData + render）
  pendingAddition: { nodes: GraphNode[]; edges: GraphEdge[] } | null;

  // Actions
  setGraphData: (data: GraphData) => void;
  expandNode: (nodeId: string) => Promise<void>;
  commitAddition: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  selectNode: (nodeId: string | null) => void;
  highlightNode: (nodeId: string | null) => void;
  updateConfig: (config: Partial<GraphConfig>) => void;
  updateExploreConfig: (config: Partial<ExploreConfig>) => void;
  getExploreButtonState: (nodeId: string) => ExploreButtonState;
  goBack: () => void;
  reset: () => void;
  setViewMode: (mode: ViewMode) => void;
}

const DEFAULT_CONFIG: GraphConfig = {
  maxDirectRelations: 5,
  maxDepth: 2,
};

const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  m: 5,
  n: 2,
};

// BFS 算法：获取指定深度内的关联节点
// m 为每节点每层展开邻居上限（非仅 depth 0），n 为最大深度
function getRelatedNodes(
  data: GraphData,
  startNodeId: string,
  maxDirect: number,
  maxDepth: number
): { visibleData: GraphData; relatedNodes: RelatedNodeDetail[]; treeEdgeIds: Set<string> } {
  const visitedNodes = new Set<string>();
  const visibleNodeIds = new Set<string>();
  const visibleEdgeIds = new Set<string>();
  const treeEdgeIds = new Set<string>();
  const relatedNodes: RelatedNodeDetail[] = [];

  // 构建邻接表
  const adjacency = new Map<string, { nodeId: string; edgeId: string; label?: string }[]>();
  data.edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ nodeId: edge.target, edgeId: edge.id, label: edge.label });
    adjacency.get(edge.target)!.push({ nodeId: edge.source, edgeId: edge.id, label: edge.label });
  });

  const nodeMap = new Map<string, GraphNode>();
  data.nodes.forEach((node) => nodeMap.set(node.id, node));

  visitedNodes.add(startNodeId);
  visibleNodeIds.add(startNodeId);

  // BFS 遍历
  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = adjacency.get(nodeId) || [];
    let addedCount = 0;

    for (const neighbor of neighbors) {
      // 每个节点每层最多展开 maxDirect 个新邻居
      if (addedCount >= maxDirect) break;

      if (!visitedNodes.has(neighbor.nodeId)) {
        visitedNodes.add(neighbor.nodeId);
        visibleNodeIds.add(neighbor.nodeId);
        visibleEdgeIds.add(neighbor.edgeId);
        treeEdgeIds.add(neighbor.edgeId);

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
        addedCount++;
      } else {
        // 已访问节点的边仍然可见
        visibleEdgeIds.add(neighbor.edgeId);
      }
    }
  }

  const visibleData: GraphData = {
    nodes: data.nodes.filter((n) => visibleNodeIds.has(n.id)),
    edges: data.edges.filter((e) => visibleEdgeIds.has(e.id)),
  };

  relatedNodes.sort((a, b) => a.depth - b.depth);

  return { visibleData, relatedNodes, treeEdgeIds };
}

// 从 fullData 中计算某节点的已加载直接邻居数
function countLoadedDirectNeighbors(fullData: GraphData, nodeId: string): number {
  const ids = new Set<string>();
  fullData.edges.forEach((e) => {
    if (e.source === nodeId) ids.add(e.target);
    if (e.target === nodeId) ids.add(e.source);
  });
  ids.delete(nodeId);
  return ids.size;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  fullData: null,
  visibleData: null,
  selectedNodeId: null,
  highlightedNodeId: null,
  relatedNodes: [],
  highlightedEdgeIds: new Set(),
  config: DEFAULT_CONFIG,
  exploreConfig: DEFAULT_EXPLORE_CONFIG,
  nodeHistory: [],
  isLoading: false,
  viewMode: 'global',
  expansionStates: new Map(),
  pendingAddition: null,
  expandingNodeId: null,
  rebuildTrigger: 0,

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

  selectNode: (nodeId) => {
    const { fullData, config, selectedNodeId, nodeHistory, viewMode } = get();

    if (!nodeId || !fullData) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
        highlightedEdgeIds: new Set(),
      });
      return;
    }

    if (nodeId === selectedNodeId) {
      set({
        selectedNodeId: null,
        visibleData: fullData,
        relatedNodes: [],
        highlightedEdgeIds: new Set(),
      });
      return;
    }

    const newHistory = selectedNodeId ? [...nodeHistory, selectedNodeId] : nodeHistory;

    // local 模式：BFS 高亮但不裁剪 visibleData（画布保持全量）
    if (viewMode === 'local') {
      const { relatedNodes, treeEdgeIds } = getRelatedNodes(
        fullData, nodeId, config.maxDirectRelations, config.maxDepth,
      );
      console.log(`[store] selectNode (local) → ${nodeId}, 关联节点数=${relatedNodes.length}`);
      set({ selectedNodeId: nodeId, relatedNodes, highlightedEdgeIds: treeEdgeIds, nodeHistory: newHistory });
      return;
    }

    // global 模式：BFS 过滤生成 visibleData
    const { visibleData, relatedNodes, treeEdgeIds } = getRelatedNodes(
      fullData, nodeId, config.maxDirectRelations, config.maxDepth,
    );
    set({
      selectedNodeId: nodeId,
      visibleData,
      relatedNodes,
      highlightedEdgeIds: treeEdgeIds,
      nodeHistory: newHistory,
    });
  },

  highlightNode: (nodeId) => {
    set({ highlightedNodeId: nodeId });
  },

  // 更新高亮配置（BFS 过滤参数）
  updateConfig: (newConfig) => {
    const { fullData, selectedNodeId, config, viewMode } = get();
    const updatedConfig = { ...config, ...newConfig };
    set({ config: updatedConfig });

    if (selectedNodeId && fullData) {
      const { relatedNodes, treeEdgeIds, visibleData } = getRelatedNodes(
        fullData, selectedNodeId, updatedConfig.maxDirectRelations, updatedConfig.maxDepth,
      );
      if (viewMode === 'local') {
        set({ relatedNodes, highlightedEdgeIds: treeEdgeIds });
      } else {
        set({ visibleData, relatedNodes, highlightedEdgeIds: treeEdgeIds });
      }
    }
  },

  // 更新探索配置（API 请求参数）
  updateExploreConfig: (newConfig) => {
    const { exploreConfig } = get();
    set({ exploreConfig: { ...exploreConfig, ...newConfig } });
  },

  // 计算探索按钮状态
  getExploreButtonState: (nodeId) => {
    const { fullData, exploreConfig, expansionStates } = get();
    const state = expansionStates.get(nodeId);

    // 从未探索过
    if (!state) {
      return { type: 'explore', label: '探索此节点' };
    }

    const loadedDirectCount = fullData ? countLoadedDirectNeighbors(fullData, nodeId) : 0;

    // 优先级：深度 > 广度 > 完成
    if (exploreConfig.n > state.maxDepthExplored) {
      return { type: 'deeper', label: '探索更深' };
    }

    if (loadedDirectCount < state.totalDirectCount) {
      return { type: 'more', label: '加载更多', loaded: loadedDirectCount, total: state.totalDirectCount };
    }

    return { type: 'done', label: '已全部探索' };
  },

  // 智能展开节点：根据状态自动选择"探索/加载更多/探索更深"
  expandNode: async (nodeId) => {
    const { fullData, expansionStates, exploreConfig, expandingNodeId } = get();
    if (!fullData) return;

    // 防并发
    if (expandingNodeId === nodeId) return;

    const buttonState = get().getExploreButtonState(nodeId);
    if (buttonState.type === 'done') return;

    set({ isLoading: true, expandingNodeId: nodeId });

    const existingNodeIds = new Set(fullData.nodes.map((n) => n.id));

    try {
      let result;

      if (buttonState.type === 'more') {
        // 加载更多：分页追加直接邻居，n 强制为 1
        const loadedDirectCount = countLoadedDirectNeighbors(fullData, nodeId);
        result = await expandGraph({
          nodeId,
          m: exploreConfig.m,
          n: 1,
          offset: loadedDirectCount,
          excludeExistingIds: [...existingNodeIds],
        });
      } else {
        // 首次探索 或 探索更深：全量 BFS
        // 首次探索：exclude 已有节点，避免重复
        // 探索更深：不 exclude，让后端完整 BFS 以便发现经由已加载中间节点可达的更深层节点
        const excludeIds = buttonState.type === 'explore' ? [...existingNodeIds] : [];
        result = await expandGraph({
          nodeId,
          m: exploreConfig.m,
          n: exploreConfig.n,
          offset: 0,
          excludeExistingIds: excludeIds,
        });
      }

      if (result.nodes.length === 0) {
        set({ isLoading: false, expandingNodeId: null });
        return;
      }

      // 过滤出真正新的节点和边（前端去重）
      const newNodes = result.nodes.filter((n) => !existingNodeIds.has(n.id));
      const newNodeIds = new Set(newNodes.map((n) => n.id));
      const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));
      const allNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
      const newEdges = result.edges.filter(
        (e) => !existingEdgeIds.has(e.id) && allNodeIds.has(e.source) && allNodeIds.has(e.target),
      );

      if (newNodes.length === 0 && newEdges.length === 0) {
        set({ isLoading: false, expandingNodeId: null });
        return;
      }

      // 更新探索状态
      const newExpansionStates = new Map(expansionStates);
      const prevState = expansionStates.get(nodeId);
      const newLoadedDirect = fullData
        ? countLoadedDirectNeighbors(
            { nodes: [...fullData.nodes, ...newNodes], edges: [...fullData.edges, ...newEdges] },
            nodeId,
          )
        : newNodes.length;
      newExpansionStates.set(nodeId, {
        loadedDirectCount: newLoadedDirect,
        totalDirectCount: result.totalNeighbors,
        maxDepthExplored: buttonState.type === 'more'
          ? (prevState?.maxDepthExplored ?? 1)
          : exploreConfig.n,
      });

      // 设置待增量渲染数据
      set({
        pendingAddition: { nodes: newNodes, edges: newEdges },
        expansionStates: newExpansionStates,
      });
    } catch (err) {
      console.error('展开节点失败:', err);
      set({ isLoading: false, expandingNodeId: null });
    }
  },

  commitAddition: (nodes, edges) => {
    const { fullData, rebuildTrigger, selectedNodeId, config } = get();
    if (!fullData) return;

    const mergedData: GraphData = {
      nodes: [...fullData.nodes, ...nodes],
      edges: [...fullData.edges, ...edges],
    };

    console.log(
      `[store] commitAddition → 追加 ${nodes.length} 节点, ${edges.length} 边`,
    );

    const result = selectedNodeId
      ? getRelatedNodes(mergedData, selectedNodeId, config.maxDirectRelations, config.maxDepth)
      : null;

    set({
      fullData: mergedData,
      visibleData: mergedData,
      pendingAddition: null,
      isLoading: false,
      expandingNodeId: null,
      relatedNodes: result?.relatedNodes ?? [],
      highlightedEdgeIds: result?.treeEdgeIds ?? new Set(),
    });
  },

  goBack: () => {
    const { nodeHistory, viewMode } = get();
    if (nodeHistory.length === 0) return;

    const newHistory = [...nodeHistory];
    const previousNodeId = newHistory.pop()!;

    const { fullData, config } = get();
    if (!fullData) return;

    const { relatedNodes, treeEdgeIds } = getRelatedNodes(
      fullData, previousNodeId, config.maxDirectRelations, config.maxDepth,
    );

    if (viewMode === 'local') {
      set({ selectedNodeId: previousNodeId, relatedNodes, highlightedEdgeIds: treeEdgeIds, nodeHistory: newHistory });
    } else {
      const { visibleData } = getRelatedNodes(
        fullData, previousNodeId, config.maxDirectRelations, config.maxDepth,
      );
      set({ selectedNodeId: previousNodeId, visibleData, relatedNodes, highlightedEdgeIds: treeEdgeIds, nodeHistory: newHistory });
    }
  },

  reset: () => {
    const { fullData } = get();
    set({
      visibleData: fullData,
      selectedNodeId: null,
      highlightedNodeId: null,
      relatedNodes: [],
      highlightedEdgeIds: new Set(),
      config: DEFAULT_CONFIG,
      exploreConfig: DEFAULT_EXPLORE_CONFIG,
      nodeHistory: [],
    });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },
}));
