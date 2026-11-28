import { useEffect, useMemo } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { projectGraphData, selectionStates } from '@/lib/graph-presentation';
import { ExplorerCanvas } from './explorer-canvas';
import { GraphControl } from './graph-control';

export function GraphContainer({ forceLayout }: { forceLayout: boolean }) {
  const { fullData, visibleData, selectedNodeId, highlightedNodeId, highlightedEdgeIds, highlightNode,
    selectNode, bfsExpandNode, pendingAddition, commitAddition, rebuildTrigger, displaySettings, categoryFilter } = useGraphStore();
  useEffect(() => {
    if (pendingAddition && pendingAddition === useGraphStore.getState().pendingAddition) {
      commitAddition(pendingAddition.nodes, pendingAddition.edges);
    }
  }, [pendingAddition, commitAddition]);
  const view = useMemo(() => fullData && projectGraphData(fullData), [fullData]);
  const states = useMemo(() => fullData && selectionStates(fullData, selectedNodeId, highlightedNodeId,
    visibleData, highlightedEdgeIds, categoryFilter), [fullData, visibleData, selectedNodeId, highlightedNodeId, highlightedEdgeIds, categoryFilter]);
  if (!view || !states) return null;
  function explore(id: string) {
    if (useGraphStore.getState().selectedNodeId !== id) selectNode(id);
    void bfsExpandNode(id);
  }
  return <div className="relative w-full h-full">
    <ExplorerCanvas view={view} contextId={String(rebuildTrigger)} layout={forceLayout ? 'force' : 'hierarchy'}
      frameBeforeEntry selectedId={selectedNodeId} elementStates={states} display={displaySettings}
      trackSelection={displaySettings.trackSelectedNode} onHover={highlightNode} onClear={() => selectNode(null)}
      onSelect={n => selectNode(n.id)} onExplore={n => explore(n.id)} onToggle={n => explore(n.id)} />
    {displaySettings.showNodePopup && <GraphControl />}
  </div>;
}
