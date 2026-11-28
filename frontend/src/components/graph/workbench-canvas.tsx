import { useMemo, useState } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { ExplorerCanvas } from './explorer-canvas';
import type { GraphData } from '@/types/graph';
import { projectGraphData } from '@/lib/graph-presentation';

/** Keep workbench query semantics while sharing DeepScope's preview renderer. */
export function WorkbenchCanvas({ overlay, onGroupClick }: { overlay: GraphData; onGroupClick: (id: string) => void }) {
  const data = useGraphStore(state => state.fullData);
  const [selected, select] = useState<string | null>(null);
  const view = useMemo(() => projectGraphData(data ?? { nodes: [], edges: [] }, overlay), [data, overlay]);
  return <ExplorerCanvas controls view={view} contextId={view.rootId} selectedId={selected} onClear={() => select(null)}
    onSelect={node => { select(node.id); onGroupClick(node.id); }} onToggle={node => onGroupClick(node.id)} />;
}
