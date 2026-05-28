import { create } from 'zustand';
import type {
  GraphData, GraphNode, GraphEdge, GraphConfig, ExploreConfig,
  ExploreButtonState, RelatedNodeDetail, DomainItem, DisplaySettings,
} from '@/types/graph';
import { expandGraph } from '@/lib/api';

/** 每个节点的探索状态 */
interface NodeExpansionState {
  loadedDirectCount: number;
  totalDirectCount: number;
  maxDepthExplored: number;
}

interface GraphState {
  // 数据
  fullData: GraphData | null;
  visibleData: GraphData | null;
  selectedNodeId: string | null;
  highlightedNodeId: string | null;
  relatedNodes: RelatedNodeDetail[];
  highlightedEdgeIds: Set<string>;

  // 高亮配置（BFS 过滤已加载数据）
  config: GraphConfig;

  // 探索配置（控制 API 请求参数）
  exploreConfig: ExploreConfig;

  // 显示配置（控制 G6 渲染样式）
  displaySettings: DisplaySettings;

  // 追溯历史
  nodeHistory: string[];

  // 加载状态
  isLoading: boolean;
  isInitialLoading: boolean;

  // 每个节点的探索状态
  expansionStates: Map<string, NodeExpansionState>;
  expandingNodeId: string | null;

  // G6 实例重建版本号
  rebuildTrigger: number;

  // 待增量添加到 G6 的数据
  pendingAddition: { nodes: GraphNode[]; edges: GraphEdge[] } | null;

  // Domain
  domains: DomainItem[];
  currentDomain: string;

  // Actions
  setGraphData: (data: GraphData) => void;
  expandNode: (nodeId: string) => Promise<void>;
  commitAddition: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  selectNode: (nodeId: string | null) => void;
  highlightNode: (nodeId: string | null) => void;
  updateConfig: (config: Partial<GraphConfig>) => void;
  updateDisplaySettings: (settings: Partial<DisplaySettings>) => void;
  updateExploreConfig: (config: Partial<ExploreConfig>) => void;
  getExploreButtonState: (nodeId: string) => ExploreButtonState;
  goBack: () => void;
  reset: () => void;
  setDomains: (domains: DomainItem[]) => void;
  setCurrentDomain: (domain: string) => void;
}

const DEFAULT_CONFIG: GraphConfig = {
  maxDirectRelations: 5,
  maxDepth: 1,
};

const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  m: 5,
  n: 1,
};

const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  showEdgeArrows: false,
  showEdgeLabels: false,
  trackSelectedNode: true,
};

// BFS 算法：获取指定深度内的关联节点
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

  const queue: { nodeId: string; depth: number }[] = [{ nodeId: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = adjacency.get(nodeId) || [];
    let addedCount = 0;

    for (const neighbor of neighbors) {
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
            category: node.category,
            description: node.description,
            style: node.style,
            relationLabel: neighbor.label,
            depth: depth + 1,
            data: node.data,
          });
        }

        queue.push({ nodeId: neighbor.nodeId, depth: depth + 1 });
        addedCount++;
      } else {
        visibleEdgeIds.add(neighbor.edgeId);
      }
    }
  }

  const visibleData: GraphData = {
    nodes: data.nodes.filter((n) => visibleNodeIds.has(n.id)),
    edges: data.edges.filter((e) => visibleEdgeIds.has(e.id)),
  };

  relatedNodes.sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label, 'zh'));

  return { visibleData, relatedNodes, treeEdgeIds };
}

function countLoadedDirectNeighbors(fullData: GraphData, nodeId: string): number {
  const ids = new Set<string>();
  fullData.edges.forEach((e) => {
    if (e.source === nodeId) ids.add(e.target);
    if (e.target === nodeId) ids.add(e.source);
  });
  ids.delete(nodeId);
  return ids.size;
}

/** 过滤掉 source/target 不在节点列表中的悬空边 */
function sanitizeGraphData(data: GraphData): GraphData {
  const nodeIdSet = new Set(data.nodes.map((n) => n.id));
  return {
    nodes: data.nodes,
    edges: data.edges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)),
  };
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
  displaySettings: DEFAULT_DISPLAY_SETTINGS,
  nodeHistory: [],
  isLoading: false,
  isInitialLoading: false,
  expansionStates: new Map(),
  pendingAddition: null,
  expandingNodeId: null,
  rebuildTrigger: 0,
  domains: [],
  currentDomain: '',

  setGraphData: (data) => {
    const clean = sanitizeGraphData(data);
    console.log(`[store] setGraphData → ${clean.nodes.length} 节点, ${clean.edges.length} 边（过滤前 ${data.edges.length} 边）`);
    set({
      fullData: clean,
      visibleData: clean,
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
    const { fullData, config, selectedNodeId, nodeHistory } = get();

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

    // BFS 过滤生成 visibleData + 关联节点列表
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

  updateConfig: (newConfig) => {
    const { fullData, selectedNodeId, config } = get();
    const updatedConfig = { ...config, ...newConfig };
    set({ config: updatedConfig });

    if (selectedNodeId && fullData) {
      const { relatedNodes, treeEdgeIds, visibleData } = getRelatedNodes(
        fullData, selectedNodeId, updatedConfig.maxDirectRelations, updatedConfig.maxDepth,
      );
      set({ visibleData, relatedNodes, highlightedEdgeIds: treeEdgeIds });
    }
  },

  updateDisplaySettings: (newSettings) => {
    const { displaySettings } = get();
    set({ displaySettings: { ...displaySettings, ...newSettings } });
  },

  updateExploreConfig: (newConfig) => {
    const { exploreConfig } = get();
    set({ exploreConfig: { ...exploreConfig, ...newConfig } });
  },

  getExploreButtonState: (nodeId) => {
    const { fullData, exploreConfig, expansionStates } = get();
    const state = expansionStates.get(nodeId);

    if (!state) {
      return { type: 'explore', label: '探索此节点' };
    }

    const loadedDirectCount = fullData ? countLoadedDirectNeighbors(fullData, nodeId) : 0;

    if (exploreConfig.n > state.maxDepthExplored) {
      return { type: 'deeper', label: '探索更深' };
    }

    if (loadedDirectCount < state.totalDirectCount) {
      return { type: 'more', label: '加载更多', loaded: loadedDirectCount, total: state.totalDirectCount };
    }

    return { type: 'done', label: '已全部探索' };
  },

  expandNode: async (nodeId) => {
    const { fullData, expansionStates, exploreConfig, expandingNodeId, currentDomain } = get();
    if (!fullData) return;
    if (expandingNodeId === nodeId) return;

    const buttonState = get().getExploreButtonState(nodeId);
    if (buttonState.type === 'done') return;

    set({ isLoading: true, expandingNodeId: nodeId });

    const existingNodeIds = new Set(fullData.nodes.map((n) => n.id));

    try {
      let result;

      if (buttonState.type === 'more') {
        const loadedDirectCount = countLoadedDirectNeighbors(fullData, nodeId);
        result = await expandGraph({
          nodeId,
          m: exploreConfig.m,
          n: 1,
          offset: loadedDirectCount,
          domain: currentDomain,
        });
      } else {
        result = await expandGraph({
          nodeId,
          m: exploreConfig.m,
          n: exploreConfig.n,
          offset: 0,
          domain: currentDomain,
        });
      }

      // 即使没有新节点，也要记录该节点的探索状态（邻居可能已作为其他节点探索的副作用加载）
      const newExpansionStates = new Map(expansionStates);
      const loadedDirect = fullData ? countLoadedDirectNeighbors(fullData, nodeId) : 0;
      newExpansionStates.set(nodeId, {
        loadedDirectCount: loadedDirect,
        totalDirectCount: result.totalNeighbors,
        maxDepthExplored: exploreConfig.n,
      });

      if (result.nodes.length === 0) {
        set({ isLoading: false, expandingNodeId: null, expansionStates: newExpansionStates });
        return;
      }

      const newNodes = result.nodes.filter((n) => !existingNodeIds.has(n.id));
      const newNodeIds = new Set(newNodes.map((n) => n.id));
      const existingEdgeIds = new Set(fullData.edges.map((e) => e.id));
      const allNodeIds = new Set([...existingNodeIds, ...newNodeIds]);
      const newEdges = result.edges.filter(
        (e) => !existingEdgeIds.has(e.id) && allNodeIds.has(e.source) && allNodeIds.has(e.target),
      );

      if (newNodes.length === 0 && newEdges.length === 0) {
        set({ isLoading: false, expandingNodeId: null, expansionStates: newExpansionStates });
        return;
      }

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
    const { fullData, selectedNodeId, config } = get();
    if (!fullData) return;

    const mergedData: GraphData = {
      nodes: [...fullData.nodes, ...nodes],
      edges: [...fullData.edges, ...edges],
    };

    console.log(`[store] commitAddition → 追加 ${nodes.length} 节点, ${edges.length} 边`);

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
    const { nodeHistory, fullData, config } = get();
    if (nodeHistory.length === 0) return;

    const newHistory = [...nodeHistory];
    const previousNodeId = newHistory.pop()!;
    if (!fullData) return;

    const { relatedNodes, treeEdgeIds, visibleData } = getRelatedNodes(
      fullData, previousNodeId, config.maxDirectRelations, config.maxDepth,
    );
    set({
      selectedNodeId: previousNodeId,
      visibleData,
      relatedNodes,
      highlightedEdgeIds: treeEdgeIds,
      nodeHistory: newHistory,
    });
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

  setDomains: (domains) => {
    set({ domains });
  },

  setCurrentDomain: (domain) => {
    set({ currentDomain: domain });
  },
}));
