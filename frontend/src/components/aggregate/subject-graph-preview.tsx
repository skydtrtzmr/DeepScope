import { useMemo, useState } from 'react';
import { ExplorerCanvas } from './aggregation-explorer';
import { subjectDemo } from '@/lib/aggregation/subject-demo';
import { localGraph, mergeFragments } from '@/lib/aggregation/subject-graph';
import type { Projection, ViewNode } from '@/lib/aggregation/explorer';
import { Button } from '@/components/ui/button';

export function SubjectGraphPreview() {
  const [selected, setSelected] = useState('');
  const [anchors, setAnchors] = useState(['001']);
  const graph = useMemo(() => mergeFragments(anchors.map(key => localGraph(subjectDemo, { subjectId: 'employee', key }))), [anchors]);
  const view: Projection = { total: graph.nodes.length, rootId: graph.nodes[0]?.id ?? '',
    nodes: graph.nodes.map(n => ({ id: n.id, label: n.label, kind: 'entity', depth: 0,
      entity: { id: n.id, label: n.label, type: n.ref.subjectId, properties: Object.fromEntries(Object.entries(n.properties).map(([k, v]) => [k, v == null ? null : String(v)])) } })),
    edges: graph.edges.map(e => ({ ...e, kind: 'relation' })),
  };
  const choose = (node: ViewNode) => setSelected(node.id);
  const current = graph.nodes.find(n => n.id === selected);
  return <div className="h-screen flex flex-col bg-background text-foreground">
    <header className="flex flex-wrap items-center gap-3 border-b p-4">
      <h1 className="font-semibold">主体关系场景验证</h1>
      <span className="text-sm text-muted-foreground">模拟数据 · {graph.nodes.length} 节点 / {graph.edges.length} 关系</span>
      <a href="?aggregation=preview" className="ml-auto underline text-sm">聚合探索预览</a>
    </header>
    <div className="flex flex-col lg:flex-row flex-1 min-h-0">
      <main className="relative flex-1 min-h-[50vh] lg:min-h-0 min-w-0">
        <ExplorerCanvas selectedId={selected} onClear={() => setSelected('')} view={view} contextId="subject-scenes" onSelect={choose} onToggle={choose} />
      </main>
      <aside className="lg:w-96 p-4 border-t lg:border-t-0 lg:border-l space-y-4 overflow-auto">
        <h2 className="font-semibold">场景</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAnchors(['001'])}>张三局部图</Button>
          <Button variant="outline" onClick={() => setAnchors(['002'])}>李四局部图</Button>
          <Button variant="outline" onClick={() => setAnchors(['001', '002'])}>两主体聚合</Button>
        </div>
        <p className="text-sm leading-6">边名称来自示例字段的现有 ENTITYDESC。共享任务只显示一次；同一人负责并审核时保留两条字段关系。</p>
        <h2 className="font-semibold">关系清单</h2>
        <ul className="space-y-2 text-sm">{graph.edges.map(e => <li key={e.id}>
          {graph.nodes.find(n => n.id === e.source)?.label} → {e.label} → {graph.nodes.find(n => n.id === e.target)?.label}
        </li>)}</ul>
        {current && <section className="border-t pt-3 text-sm space-y-2"><h2 className="font-semibold">{current.label}</h2>
          {Object.entries(current.properties).map(([k, v]) => <p key={k}>{k}：{String(v ?? '空')}</p>)}
        </section>}
        <p className="text-xs text-muted-foreground">仅验证局部与多主体合并，不连接查询后端。关联方向保持来源记录指向目标记录。</p>
      </aside>
    </div>
  </div>;
}
