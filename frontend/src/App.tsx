import { Suspense, lazy } from 'react';
import { Spinner } from '@/components/ui/spinner';

// Each entry is a separate chunk, chosen by URL: only the requested view is downloaded and executed.
const SnapshotReader = lazy(() => import('@/components/knowledge/snapshot-reader').then(m => ({ default: m.SnapshotReader })));
const LiveExplorer = lazy(() => import('@/components/aggregate/live-explorer').then(m => ({ default: m.LiveExplorer })));
const AggregationExplorer = lazy(() => import('@/components/aggregate/aggregation-explorer').then(m => ({ default: m.AggregationExplorer })));
const SubjectGraphPreview = lazy(() => import('@/components/aggregate/subject-graph-preview').then(m => ({ default: m.SubjectGraphPreview })));
const GraphApp = lazy(() => import('./app-content').then(m => ({ default: m.AppContent })));

function LoadingFallback({ label = '图谱' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="size-8" />
        <p className="text-muted-foreground">正在加载{label}...</p>
      </div>
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('knowledge')) return <Suspense fallback={<LoadingFallback label="知识库" />}><SnapshotReader /></Suspense>;
  if (params.get('aggregation') === 'live') return <Suspense fallback={<LoadingFallback />}><LiveExplorer /></Suspense>;
  if (params.get('graph') === 'subjects-preview') return <Suspense fallback={<LoadingFallback />}><SubjectGraphPreview /></Suspense>;
  if (params.get('aggregation') === 'preview') return <Suspense fallback={<LoadingFallback />}><AggregationExplorer /></Suspense>;

  return (
    <Suspense fallback={<LoadingFallback />}>
      <GraphApp />
    </Suspense>
  );
}
