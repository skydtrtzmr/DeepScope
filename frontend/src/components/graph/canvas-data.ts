import type { GraphData } from '@antv/g6';
import type { DisplaySettings } from '@/types/graph';
import type { Projection } from '@/types/graph-view';
import { getNodeColor } from '@/lib/graph-color';

type Point = { x: number; y: number };
function groupBy<T>(items: T[], key: (item: T) => string | undefined) {
  const groups = new Map<string | undefined, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

export function canvasData(view: Projection, positions: Map<string, Point>, center: Point,
  colors: Map<string, string>, states: Record<string, string[]>, layout: 'force' | 'hierarchy',
  display?: Partial<DisplaySettings>): GraphData {
  const siblings = groupBy(view.nodes, node => node.parentId);
  const angles = new Map<string, number>();
  for (const family of siblings.values()) {
    family.forEach((node, index) => angles.set(node.id, index * Math.PI * 2 / family.length));
  }
  const nodes = view.nodes.map(node => {
    const group = node.kind === 'group';
    const category = node.entity?.type;
    let position = positions.get(node.id);
    if (!position) {
      const parent = positions.get(node.parentId ?? '') ?? center;
      const angle = angles.get(node.id)!;
      position = node.id === view.rootId ? center : { x: parent.x + Math.cos(angle) * 100, y: parent.y + Math.sin(angle) * 100 };
      positions.set(node.id, position);
    }
    const size = group ? 40 : node.kind === 'anchor' || node.kind === 'scope' ? 36 : 28;
    const fill = group ? '#eef2ff' : colors.get(category ?? '') ?? getNodeColor(category);
    const categoryLabel = node.entity?.typeLabel ?? category;
    return {
      id: node.id, states: states[node.id],
      data: { label: display?.showCategoryLabel && categoryLabel ? categoryLabel + '：' + node.label : node.label },
      style: { ...position, labelWordWrap: true, labelMaxWidth: 180, labelMaxLines: 3,
        size: node.style?.radius ?? size, fill: node.style?.fill ?? fill,
        stroke: node.style?.stroke ?? (group ? '#6366f1' : '#334155'),
        lineWidth: node.style?.lineWidth ?? 2, lineDash: group ? [4, 3] : [],
      },
    };
  });

  // Keep parallel relations visible, including two relations with opposite directions.
  const curves = new Map<string, number>();
  const pairs = groupBy(view.edges, edge => JSON.stringify([edge.source, edge.target].sort()));
  for (const pair of pairs.values()) {
    if (pair.length > 1) pair.forEach((edge, i) => curves.set(edge.id, (i - (pair.length - 1) / 2) * 48));
  }
  const edges = view.edges.map(edge => {
    const offset = curves.get(edge.id);
    const membership = edge.kind === 'membership';
    return { id: edge.id, states: states[edge.id], source: edge.source, target: edge.target,
      type: offset !== undefined ? 'quadratic' : layout === 'hierarchy' ? 'cubic-horizontal' : 'line',
      style: {
        curveOffset: (offset ?? 0) * (edge.source < edge.target ? 1 : -1),
        labelText: display?.showEdgeLabels === false ? '' : edge.label ?? '',
        labelBackground: true, labelBackgroundFill: '#ffffff', labelPadding: [2, 4], labelFontSize: 12,
        stroke: edge.style?.stroke ?? (membership ? '#a5b4fc' : '#64748b'), lineWidth: edge.style?.lineWidth ?? 1,
        lineDash: membership ? [5, 4] : [], endArrow: display?.showEdgeArrows !== false && !membership,
      },
    };
  });
  return { nodes, edges };
}
