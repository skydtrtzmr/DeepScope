import type { EdgeStyle, NodeStyle } from './graph';

export interface Entity {
  id: string;
  label: string;
  type: string;
  typeLabel?: string;
  properties: Record<string, string | null | undefined>;
}
export interface ViewNode {
  id: string; label: string; kind: 'anchor' | 'scope' | 'group' | 'entity';
  style?: NodeStyle;
  entity?: Entity; count?: number; shown?: number; expanded?: boolean;
  parentId?: string; depth: number; memberIds?: string[];
}
export interface ViewEdge { id: string; source: string; target: string; kind: 'membership' | 'relation'; label?: string; style?: EdgeStyle }
export interface Projection { nodes: ViewNode[]; edges: ViewEdge[]; total: number; rootId: string }

