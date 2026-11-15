import test from 'node:test';
import assert from 'node:assert/strict';
import { entityId, relationEdgeId, localGraph, mergeFragments, graphFromModelRows, relationName } from '../src/lib/aggregation/subject-graph.ts';

const node = (subjectId, key, label) => {
  const ref = { subjectId, key };
  return { id: entityId(ref), ref, label, properties: {} };
};
const zhang = node('employee', '001', '张三');
const li = node('employee', '002', '李四');
const task = node('task', '001', '任务一');
const isolated = node('task', 'empty', '孤立任务');
const edge = (field, target) => {
  const relation = { subjectId: 'task', field };
  return { id: relationEdgeId(relation, task.id, target.id), relation, source: task.id, target: target.id, label: field };
};
const data = { nodes: [zhang, li, task, isolated], edges: [edge('owner_id', zhang), edge('reviewer_id', zhang), edge('participant_id', li)] };

test('模型和原始键共同决定身份，分隔符与前导零不发生碰撞', () => {
  assert.notEqual(zhang.id, task.id);
  assert.notEqual(entityId({ subjectId: 'a::b', key: 'c' }), entityId({ subjectId: 'a', key: 'b::c' }));
  assert.notEqual(zhang.id, entityId({ subjectId: 'employee', key: '1' }));
});
test('局部图谱同时保留正反关系与同目标的不同业务角色', () => {
  const incoming = localGraph(data, zhang.ref);
  assert.equal(incoming.nodes.length, 2);
  assert.equal(incoming.edges.length, 2);
  assert.ok(incoming.edges.every(e => e.source === task.id && e.target === zhang.id));
  assert.equal(localGraph(data, task.ref).edges.length, 3);
  assert.deepEqual(localGraph(data, isolated.ref), { nodes: [isolated], edges: [] });
  assert.throws(() => localGraph(data, { subjectId: 'task', key: 'missing' }), /不存在/);
});
test('多个知识页聚合共享实例但不合并业务关系；移除一页保留另一页引用', () => {
  const a = localGraph(data, zhang.ref), b = localGraph(data, li.ref);
  const merged = mergeFragments([a, b, a]);
  assert.equal(merged.nodes.length, 3);
  assert.equal(merged.edges.length, 3);
  assert.equal(merged.nodes.filter(n => n.id === task.id).length, 1);
  assert.ok(mergeFragments([b]).nodes.some(n => n.id === task.id));
  assert.deepEqual(mergeFragments([]), { nodes: [], edges: [] });
});

test('关联名称来自现有实体描述，目标按配置字段匹配，身份仍取主键', () => {
  const fields = [{ FIELD: 'id', ENTITYTYPE: 'primary' }, { FIELD: 'owner', ENTITYTYPE: 'foreign', ENTITYDESC: '负责人', TARGET: 'person', TARGETFIELD: 'code' }];
  const result = graphFromModelRows([
    { ID: 'task', NAME: '任务', items: fields },
    { ID: 'person', NAME: '人员', items: [{ FIELD: 'id', ENTITYTYPE: 'primary' }, { FIELD: 'code' }] },
  ], { task: [{ id: '1', owner: 'A' }], person: [{ id: '001', code: 'A' }] });
  assert.equal(result.edges[0].label, '负责人');
  assert.equal(result.edges[0].target, entityId({ subjectId: 'person', key: '001' }));
  assert.equal(relationName({ FIELD: 'owner', LABEL: '经理' }), '经理');
  assert.equal(relationName({ FIELD: 'owner' }), 'owner');
});
