import { useMemo } from 'react';
import { useGraphStore } from '@/lib/stores/graph-store';
import { ExplorerCanvas } from './explorer-canvas';
import type { GraphData } from '@/types/graph';
import type { Projection } from '@/lib/preview-types';

/** Keep workbench query semantics while sharing DeepScope's preview renderer. */
export function WorkbenchCanvas({ overlay, onGroupClick }: { overlay: GraphData; onGroupClick: (id: string) => void }) {
  const data = useGraphStore(state => state.fullData);
  const view = useMemo<Projection>(() => {
    const nodes = [...(data?.nodes ?? []), ...overlay.nodes];
    return {
      rootId: data?.nodes[0]?.id ?? '', total: nodes.length,
      nodes: nodes.map(node => ({ id: node.id, label: node.label, depth: 0,
        kind: node.data?.kind === 'aggregate' ? 'group' : 'anchor',
        entity: { id: node.id, label: node.label, type: node.category || '实体', properties: {} } })),
      edges: [...(data?.edges ?? []), ...overlay.edges].map(edge => ({ ...edge, kind: 'membership' })),
    };
  }, [data, overlay]);
  return <ExplorerCanvas view={view} contextId={view.rootId} onSelect={node => onGroupClick(node.id)} onToggle={node => onGroupClick(node.id)} />;
}

