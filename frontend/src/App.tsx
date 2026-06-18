import { useEffect, useCallback, useState, useRef, Suspense } from 'react';
import { GraphContainer } from '@/components/graph/graph-container';
import { NodeDetail } from '@/components/graph/node-detail-card';
import { GraphToolbar } from '@/components/graph/graph-toolbar';
import { AssociatedNodeList } from '@/components/graph/associated-node--list';
import { useGraphStore } from '@/lib/stores/graph-store';
import { fetchDomains, fetchInitialGraph, fetchNodesByIds, setApiBaseUrl, setEndpointPaths, setTokenConfig, setToken, onTokenExpired } from '@/lib/api';
import type { GraphData, SliderLimits } from '@/types/graph';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';

function AppContent() {
  const { setGraphData, fullData, setDomains, setCurrentDomain, currentDomain, selectNode, bfsExpandNode, updateExploreConfig, updateBatchLoadConfig, updateConfig, updateDisplaySettings, setMaxTotalNodes, setSliderLimits } = useGraphStore();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');
  const [configReady, setConfigReady] = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);
  const initializedRef = useRef(false);

  // 加载外部配置文件
  useEffect(() => {
    fetch('/app-config.json')
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((cfg) => {
        // —— 1. API base URL ——
        // 优先级：app-config.json → ?api=
        let baseUrl = cfg?.apiBaseUrl || '';
        if (cfg?.apiBaseUrl) {
          setApiBaseUrl(cfg.apiBaseUrl);
          console.log('[config] 已设置 API base URL:', cfg.apiBaseUrl);
        }
        const apiParam = new URLSearchParams(window.location.search).get('api');
        if (apiParam) {
          baseUrl = apiParam.replace(/\/+$/, '');
          // 自动补协议头（避免被浏览器当成相对路径）
          if (!/^https?:\/\//i.test(baseUrl)) {
            baseUrl = 'http://' + baseUrl;
          }
          setApiBaseUrl(baseUrl);
          console.log('[config] URL 参数 ?api= 覆盖 API base URL:', baseUrl);
        }

        // —— 2. 端点路径 ——
        // 优先级：代码默认值 → app-config.json apiEndpoints → URL 参数 ?api-xxx=
        if (cfg?.apiEndpoints) {
          setEndpointPaths(cfg.apiEndpoints);
          console.log('[config] 已加载 API 端点配置:', cfg.apiEndpoints);
        }
        const params = new URLSearchParams(window.location.search);
        const urlOverrides: Record<string, string> = {};
        const endpointNames = ['domains', 'initial', 'expand', 'neighbors', 'nodes'];
        for (const name of endpointNames) {
          const val = params.get(`api-${name}`);
          if (val) urlOverrides[name] = val;
        }
        if (Object.keys(urlOverrides).length > 0) {
          setEndpointPaths(urlOverrides);
          console.log('[config] URL 参数覆盖端点路径:', urlOverrides);
        }

        // —— 3. Token 认证 ——
        // 优先级：app-config.json auth → URL 参数 ?token=
        if (cfg?.auth) {
          setTokenConfig({
            enabled: cfg.auth.enabled !== false,
            tokenEndpoint: cfg.auth.tokenEndpoint,
            refreshGraceSeconds: cfg.auth.refreshGraceSeconds,
          });
          onTokenExpired(() => setTokenExpired(true));
          console.log('[config] 已加载 auth 配置:', cfg.auth);
        }
        const tokenParam = new URLSearchParams(window.location.search).get('token');
        if (tokenParam) {
          setToken(tokenParam);
          console.log('[config] URL 参数 ?token= 已设置');
        } else if (cfg?.auth?.enabled) {
          console.warn('[config] auth 已启用但未提供 token，请通过 ?token=<JWT> URL 参数传入');
        }

        if (cfg?.explore) {
          updateExploreConfig(cfg.explore);
          console.log('[config] 已加载探索配置:', cfg.explore);
        }
        if (cfg?.highlight) {
          updateConfig({
            directRelations: cfg.highlight.directRelations ?? undefined,
            depth: cfg.highlight.depth ?? undefined,
          });
          console.log('[config] 已加载高亮配置:', cfg.highlight);
        }
        if (typeof cfg?.maxTotalNodes === 'number') {
          setMaxTotalNodes(cfg.maxTotalNodes);
          console.log('[config] 已加载节点上限:', cfg.maxTotalNodes);
        }
        if (cfg?.display) {
          updateDisplaySettings(cfg.display);
          console.log('[config] 已加载显示配置:', cfg.display);
        }
        if (cfg?.batchLoad) {
          updateBatchLoadConfig({ pageSize: cfg.batchLoad.pageSize ?? undefined });
          console.log('[config] 已加载分批加载配置:', cfg.batchLoad);
        }
        // 滑块上限（从 explore、highlight、batchLoad 中提取上限字段）
        const limits: Partial<SliderLimits> = {};
        if (cfg.explore) {
          if (typeof cfg.explore.mMax === 'number') limits.exploreMMax = cfg.explore.mMax;
          if (typeof cfg.explore.nMax === 'number') limits.exploreNMax = cfg.explore.nMax;
        }
        if (cfg.highlight) {
          if (typeof cfg.highlight.directRelationsMax === 'number') limits.highlightDirectRelationsMax = cfg.highlight.directRelationsMax;
          if (typeof cfg.highlight.depthMax === 'number') limits.highlightDepthMax = cfg.highlight.depthMax;
        }
        if (cfg.batchLoad) {
          if (typeof cfg.batchLoad.pageSizeMax === 'number') limits.batchLoadPageSizeMax = cfg.batchLoad.pageSizeMax;
        }
        if (Object.keys(limits).length > 0) {
          setSliderLimits(limits);
          console.log('[config] 已加载滑块上限:', limits);
        }
        setConfigReady(true);
        console.log('[config] 配置加载完成，apiBaseUrl 已就绪');
      })
      .catch(() => {
        // 配置文件不存在或解析失败时也标记完成，使用代码默认值
        setConfigReady(true);
      });
  }, [updateExploreConfig]);

  // 加载 domain 列表（必须在配置加载完成后，确保 apiBaseUrl 已设置）
  useEffect(() => {
    if (!configReady) return;
    fetchDomains().then((domains) => {
      setDomains(domains);
      if (domains.length > 0) {
        setCurrentDomain(domains[0].name);
      }
    }).catch(console.error);
  }, [configReady, setDomains, setCurrentDomain]);

  // domain 变化时加载初始图谱数据
  useEffect(() => {
    if (!currentDomain) return;

    // 尝试从 URL 参数获取数据（仅首次）
    const params = new URLSearchParams(window.location.search);
    const dataParam = params.get('data');
    const nodeParam = params.get('node');

    if (dataParam && !initializedRef.current) {
      try {
        const data = JSON.parse(decodeURIComponent(dataParam)) as GraphData;
        setGraphData(data);
        initializedRef.current = true;
        return;
      } catch (e) {
        console.error('解析 URL 数据失败:', e);
      }
    }

    if (nodeParam && !initializedRef.current) {
      const shouldExpand = params.get('expand') !== '0';
      const urlM = params.get('m') ? parseInt(params.get('m')!, 10) : undefined;
      const urlN = params.get('n') ? parseInt(params.get('n')!, 10) : undefined;
      // URL 带 m/n → 必定展开（用 URL 参数）；无 m/n → 按 expand 标识决定
      const hasUrlOverride = urlM !== undefined || urlN !== undefined;
      fetchNodesByIds([nodeParam], currentDomain)
        .then((data) => {
          setGraphData(data);
          initializedRef.current = true;
          if (data.nodes.length > 0) {
            setTimeout(() => {
              selectNode(nodeParam);
              if (hasUrlOverride || shouldExpand) {
                bfsExpandNode(nodeParam, { m: urlM, n: urlN });
              }
            }, 300);
          }
        })
        .catch(console.error);
      return;
    }

    setGraphData({ nodes: [], edges: [] });
    fetchInitialGraph(currentDomain)
      .then((data) => {
        setGraphData(data);
        initializedRef.current = true;
      })
      .catch(console.error);
  }, [currentDomain, setGraphData, selectNode, bfsExpandNode]);

  // 导入数据
  const handleImport = useCallback(() => {
    setImportError('');
    try {
      const data = JSON.parse(importJson) as GraphData;
      if (!data.nodes || !data.edges) {
        throw new Error('数据格式错误：需要包含 nodes 和 edges 字段');
      }
      setGraphData(data);
      setImportDialogOpen(false);
      setImportJson('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '解析 JSON 失败');
    }
  }, [importJson, setGraphData]);

  // 导出数据
  const handleExport = useCallback(() => {
    if (!fullData) return;
    const json = JSON.stringify(fullData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph-data.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [fullData]);

  return (
    <div className="relative flex flex-col h-screen bg-background">
      {/* Token 过期提示 */}
      {tokenExpired && (
        <div className="bg-destructive/10 text-destructive text-sm text-center py-2 px-4 border-b border-destructive/20">
          Token 已过期，请关闭页面重新打开！
        </div>
      )}

      {/* 工具栏 */}
      <GraphToolbar
        onImportData={() => setImportDialogOpen(true)}
        onExportData={handleExport}
      />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* 图谱区域 */}
        <div className="flex-1 min-h-[50vh] lg:min-h-0 border-b lg:border-b-0 lg:border-r">
          {fullData && fullData.nodes.length > 0 ? (
            <GraphContainer className="w-full h-full" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-4">
                <Spinner className="size-8" />
                <p className="text-muted-foreground">正在加载图谱...</p>
              </div>
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        <div className="w-full lg:w-80 xl:w-96 flex flex-col h-[40vh] lg:h-full overflow-hidden">
          {/* 控制面板 */}
          <div className="flex-1 shrink-0 p-3 border-b">
            <NodeDetail />
          </div>

          {/* 详情列表 */}
          <div className="flex-1 overflow-hidden">
            <AssociatedNodeList />
          </div>
        </div>
      </div>

      {/* 导入对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入图谱数据</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder={`粘贴 JSON 数据，格式如下：
{
  "nodes": [
    { "id": "1", "label": "节点1", "category": "人员" }
  ],
  "edges": [
    { "id": "e1", "source": "1", "target": "2", "label": "关系" }
  ]
}`}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              rows={12}
              className="font-mono text-sm max-h-[60vh] overflow-y-auto resize-y"
            />
            {importError && <div className="text-sm text-destructive">{importError}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleImport}>导入</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="size-8" />
        <p className="text-muted-foreground">正在加载图谱...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AppContent />
    </Suspense>
  );
}
