/** Draft wire contract; no production backend is assumed to implement it yet. */
export interface EntityRef { subjectId: string; key: string }
export interface RelationRef { subjectId: string; field: string }
export type Direction = 'out' | 'in';
export interface SubjectNode { id: string; ref: EntityRef; label: string; properties: Record<string, unknown> }
/** Mapping derived from existing subject fields; no additional model configuration. */
export interface RelationDefinition {
  ref: RelationRef;
  targetSubjectId: string;
  targetField: string;
  label: string;
}
export interface SubjectEdge { id: string; relation: RelationRef; source: string; target: string; label: string }
export interface GraphFragment { nodes: SubjectNode[]; edges: SubjectEdge[] }
export interface RelationPage extends GraphFragment {
  scopeId: string;
  revision: string;
  anchor: EntityRef;
  relation: RelationRef;
  direction: Direction;
  totalDistinctEntities: number;
  nextCursor: string | null;
}
export type QueryContext =
  | { kind: 'entity'; anchor: EntityRef; relation: RelationRef; direction: Direction }
  | { kind: 'selection'; entities: EntityRef[] };
export interface ScopeRequest {
  domainId: string;
  context: QueryContext;
  dimensionIds: string[];
  filters: { fieldId: string; operator: 'eq' | 'gte' | 'lte'; value: string | number | boolean | null }[];
  limit: number;
}

// IDs are opaque on the wire. Tuple encoding avoids delimiter collisions and
// preserves string keys such as "001" without coercing them to numbers.
export function entityId(ref: EntityRef): string {
  return JSON.stringify(['entity', ref.subjectId, ref.key]);
}
export function relationEdgeId(relation: RelationRef, source: string, target: string): string {
  return JSON.stringify(['relation', relation.subjectId, relation.field, source, target]);
}

/** For a finite mock dataset only. Production uses scoped, paginated responses. */
export function localGraph(data: GraphFragment, anchor: EntityRef): GraphFragment {
  const id = entityId(anchor);
  if (!data.nodes.some(node => node.id === id)) throw new Error('主体实例不存在');
  const edges = data.edges.filter(edge => edge.source === id || edge.target === id);
  const visible = new Set([id, ...edges.flatMap(edge => [edge.source, edge.target])]);
  const nodes = data.nodes.filter(node => visible.has(node.id));
  const available = new Set(nodes.map(node => node.id));
  if (edges.some(edge => !available.has(edge.source) || !available.has(edge.target))) {
    throw new Error('关联端点缺失');
  }
  return { nodes, edges };
}

/** Merge only supplied visible fragments; do not infer edges from page links. */
export function mergeFragments(fragments: GraphFragment[]): GraphFragment {
  const nodes = new Map<string, SubjectNode>();
  const edges = new Map<string, SubjectEdge>();
  for (const fragment of fragments) {
    for (const node of fragment.nodes) nodes.set(node.id, node);
    for (const edge of fragment.edges) edges.set(edge.id, edge);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Existing subject-model vocabulary. Rows below are finite mock input only. */
export interface ModelField {
  FIELD: string; LABEL?: string; ENTITYTYPE?: string; ENTITYDESC?: string;
  TARGET?: string; TARGETFIELD?: string;
}
export interface SubjectModel { ID: string; NAME: string; NAMETEMPLATE?: string; items: ModelField[] }
export function relationName(field: ModelField): string {
  return field.ENTITYDESC?.trim() || field.LABEL?.trim() || field.FIELD;
}
export function graphFromModelRows(models: SubjectModel[], rows: Record<string, Record<string, unknown>[]>): GraphFragment {
  const nodes: SubjectNode[] = [], edges: SubjectEdge[] = [];
  const keys = new Map<string, string>();
  for (const model of models) {
    const primary = model.items.filter(f => f.ENTITYTYPE === 'primary');
    if (primary.length !== 1) throw new Error(`${model.NAME}缺少单字段主实体键`);
    keys.set(model.ID, primary[0].FIELD);
    for (const row of rows[model.ID] ?? []) {
      const raw = row[primary[0].FIELD];
      if (raw === null || raw === undefined) throw new Error('主体实例键为空');
      const ref = { subjectId: model.ID, key: String(raw) };
      if (nodes.some(n => n.id === entityId(ref))) throw new Error('主体实例键重复');
      const label = (model.NAMETEMPLATE ?? '').replace(/{{\s*(\w+)\s*}}/g, (_, name) => String(row[name] ?? '')).trim();
      nodes.push({ id: entityId(ref), ref, label: label || ref.key, properties: row });
    }
  }
  for (const model of models) for (const field of model.items) {
    if (!field.TARGET || !field.TARGETFIELD || !keys.has(field.TARGET)) continue;
    const relation = { subjectId: model.ID, field: field.FIELD };
    for (const source of nodes.filter(n => n.ref.subjectId === model.ID)) {
      const value = source.properties[field.FIELD];
      if (value === null || value === undefined) continue;
      for (const target of nodes.filter(n => n.ref.subjectId === field.TARGET)) {
        const match = target.properties[field.TARGETFIELD];
        if (match === null || match === undefined || String(value) !== String(match)) continue;
        edges.push({ id: relationEdgeId(relation, source.id, target.id), relation,
          source: source.id, target: target.id, label: relationName(field) });
      }
    }
  }
  return { nodes, edges };
}
