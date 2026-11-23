import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLocalGraph } from '../src/lib/local-aggregation.ts';
const nodes = [{ id: 'root', label: '人员', kind: 'anchor', depth: 0 }, ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, label: `任务${i}`, kind: 'entity', depth: 1 }))];
const edges = nodes.slice(1).map(n => ({ id: `e${n.id}`, source: n.id, target: 'root', kind: 'relation', label: '负责人' }));
const group = { id: 'group:owner', label: '负责的任务', total: 100, memberIds: nodes.slice(1).map(n => n.id), edgeIds: edges.map(e => e.id) };
const graph = { rootId: 'root', total: 13, nodes, edges, groups: [group] };
test('starts collapsed and retains full count rather than loaded count', () => {
 const view = aggregateLocalGraph(graph, new Set(), {});
 assert.equal(view.nodes.length, 2);
 assert.equal(view.nodes[1].count, 100);
 assert.equal(view.nodes[1].shown, 0);
 assert.equal(view.edges.length, 1);
});
test('expands five at a time, preserves incoming relation direction and caps at loaded members', () => {
 const open = new Set([group.id]);
 const first = aggregateLocalGraph(graph, open, {});
 assert.equal(first.nodes.length, 7);
 assert.equal(first.edges.find(e => e.kind === 'relation').target, group.id);
 const next = aggregateLocalGraph(graph, open, { [group.id]: 10 });
 assert.equal(next.nodes.length, 12);
 const all = aggregateLocalGraph(graph, open, { [group.id]: 100 });
 assert.equal(all.nodes.length, 14);
 assert.equal(all.nodes.find(n => n.id === group.id).shown, 12);
});
test('shared members survive collapsing another relationship without duplicate entities', () => {
 const second = { ...group, id: 'group:reviewer', label: '审核的任务' };
 const shared = { ...graph, groups: [group, second] };
 const both = aggregateLocalGraph(shared, new Set([group.id, second.id]), {});
 assert.equal(both.nodes.filter(n => n.id === 'n0').length, 1);
 const one = aggregateLocalGraph(shared, new Set([second.id]), {});
 assert.ok(one.nodes.some(n => n.id === 'n0'));
 assert.ok(!one.edges.some(e => e.kind === 'relation' && e.target === group.id));
 const closed = aggregateLocalGraph(shared, new Set(), {});
 assert.equal(closed.nodes.length, 3);
});
