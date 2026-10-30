// 聚合层状态管理：独立于 graph-store 的 fullData/BFS/历史/节点计数（协议要求）
// 核心机制：
// - seqId（查询级守卫）：新查询自增，旧查询的异步回调（响应/轮询/expand）一律丢弃
// - bucketVersion（bucket 级守卫）：展开在途时收起 → version 自增，旧 expand 响应丢弃
// - 节点归属：memberRegistry 记录成员被哪些 bucket 引用 + 是否为真实图谱已有节点；
//   收起 bucket 只删成员边，仅删除「聚合层引入 && 无其他 bucket 引用 && 不在真实层」的节点
// - 渲染由 graph-container 订阅 layerRevision 增量同步到 G6，本 store 不持有 G6 引用
import { create } from 'zustand';
import { toast } from 'sonner';
import type { GraphNode, GraphEdge } from '@/types/graph';
import type {
  AggregateQuery,
  AggregateResponse,
  AggregateGroup,
  AggregateMetricDef,
  AggregateRootNode,
  BucketPageState,
  MemberPage,
} from '@/types/aggregate';
import {
  fetchAggregate,
  pollAggregate,
  expandMembers,
  extractAggError,
} from '@/lib/api/aggregate';
import { useGraphStore } from '@/lib/stores/graph-store';

/** 聚合层节点（聚合分组节点 / 范围锚点），通过 data.kind 区分 */
export interface AggregateLayerNode extends GraphNode {
  data: {
    kind: 'aggregate' | 'scope';
    bucketId?: string;         // kind=aggregate 时对应 groups[].id
    groupKey?: string;
    groupLabel?: string;
    count?: number;
    metrics?: Record<string, number | null>;
    metricStatus?: 'running' | 'complete' | 'failed';
    scope?: string;
  };
}

/** 成员注册表条目：引用计数 + 归属 */
export interface MemberEntry {
  node: GraphNode;
  buckets: Set<string>;   // 引用该成员的 bucket 集合
  ownedByReal: boolean;   // 首次加载时是否已存在于真实图谱
}

export type AggregateMode = 'scoped' | 'global';

interface AggregateState {
  // ── 查询与状态 ──
  seqId: number;                        // 查询级守卫
  scope: string | null;
  context: AggregateQuery | null;
  groups: AggregateGroup[];
  metricDefs: AggregateMetricDef[];
  metricStatus: 'idle' | 'running' | 'complete' | 'failed';
  metricError: string | null;
  isQuerying: boolean;

  // ── 图数据（聚合层） ──
  anchorNode: AggregateLayerNode | null; // 范围锚点（全局）或 null（局部用真实锚点）
  realAnchorNodeId: string | null;       // 局部查询锚定的真实节点 ID
  layerNodes: AggregateLayerNode[];      // 聚合分组节点
  displayEdges: GraphEdge[];             // 锚点→聚合节点 显示边
  memberRegistry: Map<string, MemberEntry>;
  memberEdges: Map<string, GraphEdge>;   // edgeId → edge（含成员边）

  // ── bucket 分页状态 ──
  bucketStates: Map<string, BucketPageState>;

  // ── UI 状态 ──
  panelOpen: boolean;
  selectedBucketId: string | null;
  layerRevision: number;                // graph-container 订阅此值增量同步 G6
  memberPageSize: number;               // 首批/每页成员数（默认 20，演示可配 3）
  maxAggregateLayerNodes: number;       // 聚合层可视节点上限（默认 300）

  // ── Actions ──
  runAggregate: (query: AggregateQuery) => Promise<void>;
  switchGroup: (field: string) => Promise<void>;
  expandBucket: (bucketId: string) => Promise<void>;
  loadMoreMembers: (bucketId: string) => Promise<void>;
  collapseBucket: (bucketId: string) => void;
  selectBucket: (bucketId: string | null) => void;
  clearLayer: () => void;
  /** G6 实例重建后强制重放聚合层（graph-container 调用） */
  requestSync: () => void;
  setPanelOpen: (open: boolean) => void;
  setMemberPageSize: (n: number) => void;
  setMaxAggregateLayerNodes: (n: number) => void;
  getBucketState: (bucketId: string) => BucketPageState | undefined;
  /** 当前聚合层总可视节点数（锚点+聚合节点+已展开成员） */
  getVisibleLayerNodeCount: () => number;
}

const AGG_CATEGORY = '聚合分组';
const AGG_ANCHOR_EDGE_PREFIX = 'agg-display::';
const METRIC_POLL_INTERVAL = 1000;

let _pollTimer: ReturnType<typeof setTimeout> | null = null;

function _stopPolling() {
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
}

/** 构造聚合分组节点的 label */
function _aggNodeLabel(g: AggregateGroup): string {
  return `${g.label} (${g.count})`;
}

/** 单指标摘要（画布徽标用）：running→⋯，failed→!，null→—，值→数字 */
export function metricSummary(
  group: AggregateGroup,
  metricDefs: AggregateMetricDef[],
  status: string,
): string {
  if (status === 'failed') return '!';
  if (status === 'running') return '⋯';
  const first = metricDefs[0];
  if (!first) return '';
  const v = group.metrics?.[first.id];
  if (v == null) return '—';
  return String(v);
}

function _buildAggLayerNode(
  g: AggregateGroup,
  metricStatus: string,
): AggregateLayerNode {
  return {
    id: g.id,
    label: _aggNodeLabel(g),
    category: AGG_CATEGORY,
    data: {
      kind: 'aggregate',
      bucketId: g.id,
      groupKey: g.key,
      groupLabel: g.label,
      count: g.count,
      metrics: { ...g.metrics },
      metricStatus: metricStatus as 'running' | 'complete' | 'failed',
    },
  };
}

function _buildAnchorNode(root: AggregateRootNode): AggregateLayerNode {
  return {
    id: root.id,
    label: root.label,
    category: root.category || '范围',
    data: {
      kind: 'scope',
      scope: root.data.source,
    },
  };
}

/** 锚点→聚合节点的显示边（协议允许前端生成） */
function _buildDisplayEdges(
  anchorNodeId: string,
  groups: AggregateGroup[],
): GraphEdge[] {
  return groups.map((g) => ({
    id: `${AGG_ANCHOR_EDGE_PREFIX}${g.id}`,
    source: anchorNodeId,
    target: g.id,
    label: '聚合',
  }));
}

/** 通知 graph-container 层有变化 */
function _bumpRevision() {
  useAggregateStore.setState((s) => ({ layerRevision: s.layerRevision + 1 }));
}

/** 清空聚合层全部状态（新查询前/清除时） */
function _resetLayerState(): Partial<AggregateState> {
  _stopPolling();
  return {
    scope: null,
    context: null,
    groups: [],
    metricDefs: [],
    metricStatus: 'idle',
    metricError: null,
    anchorNode: null,
    realAnchorNodeId: null,
    layerNodes: [],
    displayEdges: [],
    memberRegistry: new Map(),
    memberEdges: new Map(),
    bucketStates: new Map(),
    selectedBucketId: null,
  };
}

export const useAggregateStore = create<AggregateState>((set, get) => ({
  seqId: 0,
  scope: null,
  context: null,
  groups: [],
  metricDefs: [],
  metricStatus: 'idle',
  metricError: null,
  isQuerying: false,
  anchorNode: null,
  realAnchorNodeId: null,
  layerNodes: [],
  displayEdges: [],
  memberRegistry: new Map(),
  memberEdges: new Map(),
  bucketStates: new Map(),
  panelOpen: false,
  selectedBucketId: null,
  layerRevision: 0,
  memberPageSize: 20,
  maxAggregateLayerNodes: 300,

  runAggregate: async (query) => {
    const seqId = get().seqId + 1;
    set({ ..._resetLayerState(), seqId, isQuerying: true });

    try {
      const resp = await fetchAggregate(query);
      if (get().seqId !== seqId) {
        console.log('[aggregate] 旧查询响应被丢弃（seqId 已变化）');
        return;
      }
      _applyAggregateResponse(resp, query);
    } catch (err) {
      if (get().seqId !== seqId) return;
      const { status, message } = extractAggError(err);
      set({ isQuerying: false });
      if (status === 410) {
        toast.error(`查询范围已过期（410）：${message}，请重新查询`);
      } else {
        toast.error(`聚合查询失败${status ? `（${status}）` : ''}：${message}`);
      }
      console.error('[aggregate] 查询失败:', err);
      return;
    }
    set({ isQuerying: false });

    // 指标 running → 启动轮询
    if (get().seqId === seqId && get().metricStatus === 'running' && get().scope) {
      _schedulePoll(get().scope!, seqId);
    }
  },

  switchGroup: async (field) => {
    const { context } = get();
    if (!context) return;
    await get().runAggregate({ ...context, group: field });
  },

  expandBucket: async (bucketId) => {
    const { scope, bucketStates, memberPageSize, seqId } = get();
    if (!scope) return;
    const st = bucketStates.get(bucketId);
    if (st?.loading) return; // 防重复请求

    // 已展开且有缓存 → 直接恢复（不发请求）
    if (st && st.expanded) {
      console.log(`[aggregate] bucket 已展开，跳过重复展开：${bucketId}`);
      return;
    }

    // 收起后重新展开：memberRegistry 里可能仍有该 bucket 的缓存成员
    const hasCache = [...get().memberRegistry.values()].some((m) => m.buckets.has(bucketId));
    const offset = st ? st.offset : 0;
    // 有缓存（此前展开过并收起，数据保留）→ 直接恢复展开态
    if (st && hasCache && st.loaded > 0) {
      const newStates = new Map(bucketStates);
      newStates.set(bucketId, { ...st, expanded: true, version: st.version + 1, loading: false });
      set({ bucketStates: newStates });
      _bumpRevision();
      console.log(`[aggregate] 恢复缓存展开 bucket=${bucketId} loaded=${st.loaded}/${st.total}`);
      return;
    }

    const version = (st?.version ?? 0) + 1;
    const newStates = new Map(bucketStates);
    newStates.set(bucketId, {
      version, loading: true, expanded: true,
      loaded: st?.loaded ?? 0, offset, total: st?.total ?? 0, hasMore: st?.hasMore ?? false,
    });
    set({ bucketStates: newStates });

    try {
      const page = await expandMembers({ scope, bucket: bucketId, offset, limit: memberPageSize });
      const cur = get().bucketStates.get(bucketId);
      // 双重守卫：查询已切换 或 bucket version 已变化（收起过）→ 丢弃
      if (get().seqId !== seqId || !cur || cur.version !== version) {
        console.log('[aggregate] expand 响应被丢弃（seqId/version 已变化）');
        return;
      }
      _applyMemberPage(bucketId, page, version);
    } catch (err) {
      const cur = get().bucketStates.get(bucketId);
      if (get().seqId !== seqId || !cur || cur.version !== version) return;
      // 失败：回滚 loading，offset 不推进（重试不跳页）
      const newStates = new Map(get().bucketStates);
      newStates.set(bucketId, { ...cur, loading: false });
      set({ bucketStates: newStates });
      const { status, message } = extractAggError(err);
      if (status === 410) {
        toast.error(`查询范围已过期（410）：${message}，请重新查询`);
        set({ ..._resetLayerState() });
        _bumpRevision();
        return;
      }
      toast.error(`成员加载失败${status ? `（${status}）` : ''}：${message}`);
      console.error('[aggregate] expand 失败:', err);
    }
  },

  loadMoreMembers: async (bucketId) => {
    const { scope, bucketStates, memberPageSize, seqId } = get();
    if (!scope) return;
    const st = bucketStates.get(bucketId);
    if (!st || st.loading || !st.hasMore) return;

    const version = st.version + 1;
    const newStates = new Map(bucketStates);
    newStates.set(bucketId, { ...st, version, loading: true });
    set({ bucketStates: newStates });

    try {
      const page = await expandMembers({ scope, bucket: bucketId, offset: st.offset, limit: memberPageSize });
      const cur = get().bucketStates.get(bucketId);
      if (get().seqId !== seqId || !cur || cur.version !== version) {
        console.log('[aggregate] loadMore 响应被丢弃（seqId/version 已变化）');
        return;
      }
      _applyMemberPage(bucketId, page, version);
    } catch (err) {
      const cur = get().bucketStates.get(bucketId);
      if (get().seqId !== seqId || !cur || cur.version !== version) return;
      const newStates = new Map(get().bucketStates);
      newStates.set(bucketId, { ...cur, loading: false });
      set({ bucketStates: newStates });
      const { status, message } = extractAggError(err);
      if (status === 410) {
        toast.error(`查询范围已过期（410）：${message}，请重新查询`);
        set({ ..._resetLayerState() });
        _bumpRevision();
        return;
      }
      toast.error(`加载更多失败${status ? `（${status}）` : ''}：${message}（不跳页，可重试）`);
      console.error('[aggregate] loadMore 失败:', err);
    }
  },

  collapseBucket: (bucketId) => {
    const { bucketStates } = get();
    const st = bucketStates.get(bucketId);
    if (!st || !st.expanded) return;

    // version 自增：进行中的 expand/loadMore 响应将被丢弃
    const newStates = new Map(bucketStates);
    newStates.set(bucketId, { ...st, version: st.version + 1, loading: false, expanded: false });
    set({ bucketStates: newStates });

    // 缓存保留：memberRegistry / memberEdges 原样保留（含跨 bucket 引用与真实层重叠成员）。
    // 画布上的成员移除由 graph-container 的 syncAggregateLayer 按 expanded 状态过滤自动完成；
    // 重新展开时 expandBucket 走缓存恢复路径（不发请求、不跳页），成员直接回到画布。
    _bumpRevision();
    console.log(`[aggregate] 收起 bucket=${bucketId}（缓存保留，loaded=${st.loaded}/${st.total}）`);
  },

  selectBucket: (bucketId) => {
    set({ selectedBucketId: bucketId });
  },

  clearLayer: () => {
    set({ ..._resetLayerState(), seqId: get().seqId + 1 });
    _bumpRevision();
    console.log('[aggregate] 聚合层已清除');
  },

  /** 图谱 rebuild（rebuildTrigger）后由 graph-container 调用：G6 实例重建完成，强制重放聚合层 */
  requestSync: () => {
    _bumpRevision();
  },

  setPanelOpen: (open) => set({ panelOpen: open }),

  setMemberPageSize: (n) => set({ memberPageSize: n > 0 ? n : 20 }),

  setMaxAggregateLayerNodes: (n) => set({ maxAggregateLayerNodes: n > 0 ? n : 300 }),

  getBucketState: (bucketId) => get().bucketStates.get(bucketId),

  getVisibleLayerNodeCount: () => {
    const { anchorNode, layerNodes, memberRegistry, bucketStates } = get();
    let expandedMembers = 0;
    for (const entry of memberRegistry.values()) {
      // 仅统计当前仍被某展开中 bucket 引用的成员
      let referenced = false;
      for (const b of entry.buckets) {
        if (bucketStates.get(b)?.expanded) { referenced = true; break; }
      }
      if (referenced) expandedMembers++;
    }
    return (anchorNode ? 1 : 0) + layerNodes.length + expandedMembers;
  },
}));

/** 应用聚合查询响应：构造聚合节点/锚点/显示边，bumpRevision */
function _applyAggregateResponse(resp: AggregateResponse, query: AggregateQuery) {
  const isGlobal = query.root == null;
  const anchorNode = isGlobal ? _buildAnchorNode(resp.root) : null;
  const realAnchorNodeId = isGlobal ? null : resp.root.id;

  // 局部查询：锚点必须是图上真实节点（若不在当前图上，仍用响应 root.id，
  // graph-container 渲染时按 fullData 判断真实存在性）
  const layerNodes = resp.groups.map((g) => _buildAggLayerNode(g, resp.metric_status));

  // 显示边：局部=真实锚点→聚合节点；全局=锚点节点→聚合节点
  const anchorId = realAnchorNodeId ?? anchorNode!.id;
  const displayEdges = _buildDisplayEdges(anchorId, resp.groups);

  useAggregateStore.setState({
    scope: resp.scope,
    context: { ...query },
    groups: resp.groups,
    metricDefs: resp.metrics,
    metricStatus: resp.metric_status,
    metricError: resp.metric_error,
    anchorNode,
    realAnchorNodeId,
    layerNodes,
    displayEdges,
    memberRegistry: new Map(),
    memberEdges: new Map(),
    bucketStates: new Map(),
    isQuerying: false,
  });
  _bumpRevision();

  const scopeLabel = isGlobal ? '全局' : `主体 ${resp.root.label}`;
  console.log(`[aggregate] 查询成功 [${scopeLabel}] scope=${resp.scope} 分组数=${resp.groups.length} total=${resp.total} 指标=${resp.metric_status}`);

  if (resp.groups.length === 0) {
    toast.info('当前查询范围内没有分组数据');
  }
  if (resp.metric_status === 'failed' && resp.metric_error) {
    toast.error(`指标计算失败：${resp.metric_error}`);
  }
}

/** 应用成员分页响应：注册成员、更新 bucket 进度、bumpRevision */
function _applyMemberPage(bucketId: string, page: MemberPage, version: number) {
  const store = useAggregateStore.getState();
  const { memberRegistry, memberEdges, bucketStates, maxAggregateLayerNodes } = store;

  const realIds = new Set((useGraphStore.getState().fullData?.nodes ?? []).map((n) => n.id));
  const newRegistry = new Map(memberRegistry);
  const newMemberEdges = new Map(memberEdges);

  // 可视上限校验（聚合层独立于 maxTotalNodes）
  const currentCount = store.getVisibleLayerNodeCount();
  let allowedNodes = page.nodes;
  if (maxAggregateLayerNodes > 0) {
    const allowed = Math.max(0, maxAggregateLayerNodes - currentCount);
    if (allowed < page.nodes.length) {
      allowedNodes = page.nodes.slice(0, allowed);
      toast.warning(`聚合层可视节点已达上限 ${maxAggregateLayerNodes}，本页仅入图 ${allowed} 条（加载进度仍推进）`);
    }
  }

  for (const node of page.nodes) {
    const existing = newRegistry.get(node.id);
    if (existing) {
      // 跨 bucket 去重：节点已在聚合层，仅添加引用
      existing.buckets.add(bucketId);
    } else if (realIds.has(node.id)) {
      // 真实图谱已有该节点：不 addData（graph-container 判定），仅加成员边
      newRegistry.set(node.id, {
        node,
        buckets: new Set([bucketId]),
        ownedByReal: true,
      });
      console.log(`[aggregate] 成员已存在于真实图谱，仅加边：${node.id}`);
    } else {
      newRegistry.set(node.id, {
        node,
        buckets: new Set([bucketId]),
        ownedByReal: false,
      });
    }
  }

  // 成员边去重（edge id）；真实图谱已有节点的成员边也保留（source=聚合节点）
  for (const edge of page.edges) {
    if (!newMemberEdges.has(edge.id)) {
      newMemberEdges.set(edge.id, edge);
    }
  }

  // 注意：即使本页部分节点因上限未入图（allowedNodes < page.nodes），
  // loaded/offset 仍按服务端返回推进（loaded 语义 = 服务端记录数进度）；
  // 被截断的节点已进入 registry（重展开或上限调大后可恢复渲染）
  const st = bucketStates.get(bucketId);
  const newStates = new Map(bucketStates);
  newStates.set(bucketId, {
    version,
    loading: false,
    expanded: true,
    loaded: Math.max(st?.loaded ?? 0, page.offset + page.nodes.length),
    offset: page.offset + page.nodes.length,
    total: page.total,
    hasMore: page.has_more,
  });

  useAggregateStore.setState({
    memberRegistry: newRegistry,
    memberEdges: newMemberEdges,
    bucketStates: newStates,
  });
  _bumpRevision();

  console.log(`[aggregate] 成员入图 bucket=${bucketId} 本页 ${page.nodes.length} 条（入图 ${allowedNodes.length}），进度 ${page.offset + page.nodes.length}/${page.total} has_more=${page.has_more}`);
}

// 调试辅助：控制台通过 __aggStore 可直接操作聚合层（如 __aggStore.getState().expandBucket(id)）
(globalThis as unknown as Record<string, unknown>).__aggStore = useAggregateStore;

/** 指标轮询：running 时每 1s 拉取；complete 仅更新指标数据（局部刷新）；failed 停止并提示 */
function _schedulePoll(scope: string, seqId: number) {
  _stopPolling();
  _pollTimer = setTimeout(async () => {
    try {
      const resp = await pollAggregate(scope);
      const state = useAggregateStore.getState();
      if (state.seqId !== seqId || state.scope !== scope) {
        console.log('[aggregate] 轮询响应被丢弃（查询已切换）');
        return;
      }
      if (resp.metric_status === 'running') {
        useAggregateStore.setState({ metricStatus: 'running' });
        _schedulePoll(scope, seqId);
        return;
      }
      if (resp.metric_status === 'complete') {
        // 仅更新指标：聚合节点的 metrics 数据 + revision（graph-container 用 updateNodeData+draw 局部刷新）
        const layerNodes = state.layerNodes.map((n) =>
          n.data.bucketId
            ? {
                ...n,
                data: {
                  ...n.data,
                  metrics: { ...(resp.groups.find((g) => g.id === n.data.bucketId)?.metrics ?? {}) },
                  metricStatus: 'complete' as const,
                },
              }
            : n,
        );
        useAggregateStore.setState({
          groups: resp.groups,
          metricStatus: 'complete',
          layerNodes,
        });
        _bumpRevision();
        console.log('[aggregate] 指标计算完成，已局部更新');
        return;
      }
      // failed
      useAggregateStore.setState({
        groups: resp.groups,
        metricStatus: 'failed',
        metricError: resp.metric_error,
      });
      if (resp.metric_error) {
        toast.error(`指标计算失败：${resp.metric_error}`);
      }
      console.log('[aggregate] 指标计算失败，已停止轮询');
    } catch (err) {
      const state = useAggregateStore.getState();
      if (state.seqId !== seqId || state.scope !== scope) return;
      const { status, message } = extractAggError(err);
      if (status === 410) {
        toast.error(`查询范围已过期（410）：${message}，请重新查询`);
        useAggregateStore.setState(_resetLayerState());
        _bumpRevision();
        return;
      }
      // 网络抖动等：1s 后重试一次轮询
      console.error('[aggregate] 轮询失败，稍后重试:', err);
      _schedulePoll(scope, seqId);
    }
  }, METRIC_POLL_INTERVAL);
}
