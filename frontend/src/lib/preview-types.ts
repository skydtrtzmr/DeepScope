export interface Entity {
  id: string;
  label: string;
  type: string;
  properties: Record<string, string | null | undefined>;
}
export interface Relation { id: string; source: string; target: string; type: string }
export interface Dataset { entities: Entity[]; relations: Relation[] }
export interface Dimension { id: string; label: string; relation?: string; field: string }
export type Context =
  | { mode: 'related'; anchorId: string; relation: string; targetType: string }
  | { mode: 'collection'; label: string; targetType: string; region?: string };
export interface ViewNode {
  id: string; label: string; kind: 'anchor' | 'scope' | 'group' | 'entity';
  entity?: Entity; count?: number; shown?: number; expanded?: boolean;
  parentId?: string; depth: number; memberIds?: string[];
}
export interface ViewEdge { id: string; source: string; target: string; kind: 'membership' | 'relation'; label?: string }
export interface Projection { nodes: ViewNode[]; edges: ViewEdge[]; total: number; rootId: string }

