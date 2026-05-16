import { useEffect, useCallback, useState, useRef, Suspense } from 'react';
import { GraphContainer } from '@/components/graph/graph-container';
import { GraphControls } from '@/components/graph/graph-controls';
import { GraphToolbar } from '@/components/graph/graph-toolbar';
import { NodeDetailList } from '@/components/graph/node-detail-list';
import { useGraphStore } from '@/lib/stores/graph-store';
import { DEMO_GRAPH_DATA } from '@/lib/demo-data';
import type { GraphData } from '@/types/graph';
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
  const { setGraphData, fullData } = useGraphStore();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');
  const initializedRef = useRef(false);

  // 初始加载
  useEffect(() => {
    if (initializedRef.current) return;

    // 尝试从 URL 参数获取数据
    const params = new URLSearchParams(window.location.search);
    const dataParam = params.get('data');
    if (dataParam) {
      try {
        const data = JSON.parse(decodeURIComponent(dataParam)) as GraphData;
        setGraphData(data);
        initializedRef.current = true;
        return;
      } catch (e) {
        console.error('解析 URL 数据失败:', e);
      }
    }

    // 监听 postMessage
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GRAPH_DATA' && event.data.payload) {
        try {
          const data = event.data.payload as GraphData;
          if (data.nodes && data.edges) {
            setGraphData(data);
            initializedRef.current = true;
          }
        } catch (e) {
          console.error('处理 postMessage 数据失败:', e);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // 如果没有外部数据，加载示例数据
    if (!initializedRef.current) {
      setGraphData(DEMO_GRAPH_DATA);
      initializedRef.current = true;
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [setGraphData]);

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
    <div className="flex flex-col h-screen bg-background">
      {/* 工具栏 */}
      <GraphToolbar
        onImportData={() => setImportDialogOpen(true)}
        onExportData={handleExport}
      />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* 图谱区域 */}
        <div className="flex-1 min-h-[50vh] lg:min-h-0 border-b lg:border-b-0 lg:border-r">
          <GraphContainer className="w-full h-full" />
        </div>

        {/* 右侧面板 */}
        <div className="w-full lg:w-80 xl:w-96 flex flex-col h-[40vh] lg:h-full overflow-hidden">
          {/* 控制面板 */}
          <div className="shrink-0 p-3 border-b">
            <GraphControls />
          </div>

          {/* 详情列表 */}
          <div className="flex-1 overflow-hidden">
            <NodeDetailList />
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
    { "id": "1", "label": "节点1", "type": "person" }
  ],
  "edges": [
    { "id": "e1", "source": "1", "target": "2", "label": "关系" }
  ]
}`}
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              rows={12}
              className="font-mono text-sm"
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
        <Spinner size="lg" />
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
