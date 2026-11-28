import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectGraphData, selectionStates } from '../src/lib/graph-presentation.ts';

const a = { id: 'a', label: '人员甲', category: '员工', style: { fill: '#339966' } };
const b = { id: 'b', label: '设备乙', category: '设备' };
const c = { id: 'c', label: '工单丙', category: '工单' };
const data = { nodes: [a,b,c], edges: [
  { id: 'ab', source: 'b', target: 'a', label: '负责人' },
  { id: 'bc', source: 'b', target: 'c', label: '报修' },
] };

test('模型和预览沿用实体 ID、主体色、真实边方向及额外聚合节点', () => {
  const view = projectGraphData(data, { nodes: [{id:'g', label:'设备组', data:{kind:'aggregate'}}],
    edges: [{id:'ag', source:'a', target:'g'}] });
  assert.deepEqual(view.nodes.map(n => n.kind), ['anchor','entity','entity','group']);
  assert.equal(view.nodes[0].style.fill, a.style.fill);
  assert.equal(view.nodes[1].entity.type, '设备');
  assert.deepEqual(view.edges[0], {...data.edges[0], kind:'relation'});
  assert.equal(view.edges[2].kind, 'membership');
});

test('选中、深度、类别筛选和悬停作用于同一批节点与边，取消选中恢复', () => {
  const tree = new Set(['ab', 'bc']);
  assert.deepEqual(selectionStates(data,'a','b',data,tree,['设备']), {
    a:['selected'], b:['highlighted'], c:['muted'], ab:['related'], bc:['muted'],
  });
  assert.deepEqual(selectionStates(data,'a',null,{ nodes:[a,b], edges:[] },new Set(['ab']),[]).c,['muted']);
  assert.deepEqual(selectionStates(data,null,null,data,undefined,[]), {a:[],b:[],c:[],ab:[],bc:[]});
});
