import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidates, project, collapseBranch, mergeProjections } from '../src/lib/aggregation/explorer.ts';
const data = JSON.parse(readFileSync(new URL('../src/lib/aggregation/demo.json', import.meta.url)));
const category = { id: 'project.category', label: '项目类别', relation: 'project', field: 'category' };
const status = { id: 'status', label: '任务状态', field: 'status' };
const zhang = { mode: 'related', anchorId: 'person:zhang', relation: 'assigned', targetType: 'task' };
test('主体、关系和区域确定集合，分组前先过滤', () => {
  assert.equal(candidates(data, zhang).length, 6);
  assert.deepEqual(candidates(data, { ...zhang, relation: 'participates' }).map(e => e.id), ['task:5', 'task:8']);
  assert.equal(candidates(data, { mode: 'collection', label: '华东', targetType: 'task', region: '华东' }).length, 6);
  assert.equal(candidates(data, { mode: 'collection', label: '全部', targetType: 'task' }).length, 8);
});
test('关联字段分组、未分类与分页保持完整计数', () => {
  const initial = project(data, zhang, [category], new Set());
  const group = initial.nodes.find(n => n.label === '研发类 · 4');
  assert.ok(group);
  assert.ok(initial.nodes.some(n => n.label === '未分类 · 1'));
  assert.equal(initial.nodes.filter(n => n.kind === 'entity').length, 0);
  const expanded = new Set([group.id]);
  const page = project(data, zhang, [category], expanded);
  assert.equal(page.nodes.find(n => n.id === group.id).shown, 3);
  assert.equal(page.nodes.find(n => n.id === group.id).count, 4);
  const all = project(data, zhang, [category], expanded, { [group.id]: 6 });
  assert.equal(all.nodes.filter(n => n.kind === 'entity').length, 4);
  assert.ok(all.edges.some(e => e.kind === 'relation'));
  const closed = project(data, zhang, [category], collapseBranch(group.id, all, expanded));
  assert.equal(closed.nodes.filter(n => n.kind === 'entity').length, 0);
});
test('多级收起清理后代展开状态；主体和规则隔离分组身份', () => {
  const initial = project(data, zhang, [category, status], new Set());
  const group = initial.nodes.find(n => n.label === '研发类 · 4');
  const expanded = new Set([group.id]);
  const second = project(data, zhang, [category, status], expanded);
  const child = second.nodes.find(n => n.parentId === group.id);
  expanded.add(child.id);
  const third = project(data, zhang, [category, status], expanded);
  assert.ok(third.nodes.some(n => n.kind === 'entity'));
  assert.equal(collapseBranch(group.id, third, expanded).size, 0);
  const li = project(data, { ...zhang, anchorId: 'person:li' }, [category, status], expanded);
  assert.equal(li.nodes.filter(n => n.kind === 'entity').length, 0);
  assert.equal(li.total, 3);
});
test('同一任务可属于两个主体，实体 ID 不变；重复关系不重复计数', () => {
  const duplicate = { ...data, relations: [...data.relations, { id: 'duplicate', source: 'person:zhang', target: 'task:2', type: 'assigned' }] };
  assert.equal(candidates(duplicate, zhang).length, 6);
  const a = candidates(data, zhang).find(e => e.id === 'task:2');
  const b = candidates(data, { ...zhang, anchorId: 'person:li' }).find(e => e.id === 'task:2');
  assert.equal(a.id, b.id);
});
test('空集合、完全缺失字段和非法多值维度有明确行为', () => {
  assert.equal(project(data, { ...zhang, relation: 'unknown' }, [category], new Set()).nodes.length, 1);
  const missing = project(data, zhang, [{ id: 'missing', label: '缺失', field: 'missing' }], new Set());
  assert.equal(missing.nodes.filter(n => n.kind === 'group').length, 0);
  assert.equal(missing.nodes.find(n => n.id === missing.rootId).shown, 3);
  const multiple = { ...data, relations: [...data.relations, { id: 'extra', source: 'task:1', target: 'project:delivery', type: 'project' }] };
  assert.throws(() => project(multiple, zhang, [category], new Set()), /多个值/);
});

test('共享画布按可见路径保留实体，收起最后一条路径才移除', () => {
  const li = { ...zhang, anchorId: 'person:li' };
  const open = context => {
    const base = project(data, context, [category], new Set());
    return project(data, context, [category], new Set(base.nodes.filter(n => n.kind === 'group').map(n => n.id)), {}, 100);
  };
  const a = open(zhang), b = open(li);
  const merged = mergeProjections(data, [a, b]);
  assert.equal(merged.nodes.filter(n => n.id === 'task:2').length, 1);
  assert.equal(new Set(merged.edges.map(e => e.id)).size, merged.edges.length);
  const closedA = project(data, zhang, [category], new Set());
  const surviving = mergeProjections(data, [closedA, b]);
  assert.ok(surviving.nodes.some(n => n.id === 'task:2'));
  const closedB = project(data, li, [category], new Set());
  const closed = mergeProjections(data, [closedA, closedB]);
  assert.ok(!closed.nodes.some(n => n.id === 'task:2'));
  for (const edge of surviving.edges) {
    assert.ok(surviving.nodes.some(n => n.id === edge.source));
    assert.ok(surviving.nodes.some(n => n.id === edge.target));
  }
});
