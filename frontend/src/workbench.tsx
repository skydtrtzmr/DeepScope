import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkbenchCanvas } from './components/graph/workbench-canvas';
import { useGraphStore } from './lib/stores/graph-store';
import type { GraphNode, GraphData } from './types/graph';
import './index.css';
import './workbench.css';

type Choice = {id:string;name:string};
type View = Choice & {groups:{field:string;name:string}[];roots:{field:string;subject:string;name:string}[];metrics:Choice[];time:string};
type Bucket = {id:string;key:unknown;label:string;count:number;metrics:Record<string,number|null>};
type Result = {scope:string;root:GraphNode;groups:Bucket[];total:number;metrics:{id:string;name:string;unit:string}[];metric_job?:string;metric_error?:string;context:unknown};
type Members = {nodes:GraphNode[];total:number;offset:number;has_more:boolean};
async function api<T>(path:string,body?:unknown):Promise<T> {
  const r = await fetch('/api/graph/'+path,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  const data = await r.json();
  if(!r.ok) throw new Error(data.detail || '查询失败');
  return data;
}
function Workbench() {
  const domain = new URLSearchParams(location.search).get('domain') || 'domain1';
  const [title,setTitle] = useState('知识图谱');
  const [views,setViews] = useState<View[]>([]);
  const [source,setSource] = useState('');
  const view = views.find(v=>v.id===source);
  const [group,setGroup] = useState('');
  const [relation,setRelation] = useState('');
  const [instances,setInstances] = useState<GraphNode[]>([]);
  const [root,setRoot] = useState('');
  const [start,setStart] = useState('');
  const [end,setEnd] = useState('');
  const [metrics,setMetrics] = useState<string[]>([]);
  const [result,setResult] = useState<Result|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [metricState,setMetricState] = useState('');
  const [bucket,setBucket] = useState<Bucket|null>(null);
  const [members,setMembers] = useState<Members|null>(null);
  const [memberBusy,setMemberBusy] = useState(false);
  const generation = useRef(0), memberGeneration = useRef(0);
  const setGraphData = useGraphStore(s=>s.setGraphData);
  const overlay = useMemo<GraphData>(()=>({nodes:result?.groups.map(b=>({id:b.id,category:'分组',label:b.label+'\n'+b.count+' 条记录'+result.metrics.map(m=>'\n'+m.name+'：'+(b.metrics[m.id] == null ? '—' : new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(b.metrics[m.id]!))+(m.unit||'')).join(''),data:{kind:'aggregate'}})) || [],edges:result?.groups.map(b=>({id:result.root.id+'->'+b.id,source:result.root.id,target:b.id,label:'分组'})) || []}),[result]);
  useEffect(()=>{
    useGraphStore.getState().updateDisplaySettings({expandTrigger:'none',showCategoryLabel:false,trackSelectedNode:false,showNodePopup:false});
    api<{domain:Choice;views:View[]}>('aggregation/views?domain='+encodeURIComponent(domain)).then(r=>{setTitle(r.domain.name);setViews(r.views);setSource(r.views.find(v=>v.id==='kb_dwd_task')?.id || r.views[0]?.id || '');}).catch(e=>setError(e.message));
    return ()=>{generation.current++;memberGeneration.current++;};
  },[domain]);
  useEffect(()=>{setGroup(view?.groups.find(g=>g.field==='project_id')?.field || view?.groups[0]?.field || '');setMetrics(view?.metrics.slice(0,2).map(m=>m.id)||[]);setRelation('');setRoot('');setInstances([]);},[source,views]);
  useEffect(()=>{
    const r = view?.roots.find(r=>r.field===relation);
    setInstances([]);setRoot('');
    if(!r)return;
    let current=true;
    api<{nodes:GraphNode[]}>('instances?domain='+encodeURIComponent(domain)+'&subject='+encodeURIComponent(r.subject)).then(r=>{if(current){setInstances(r.nodes);setRoot(r.nodes[0]?.data?.key as string || '');}}).catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[relation,source]);
  async function draw() {
    const own=++generation.current;
    memberGeneration.current++;setBusy(true);setError('');setMetricState('');setMembers(null);setBucket(null);setResult(null);
    try {
      const r=await api<Result>('aggregate',{domain,source,group,root:relation?{relation,key:root}:null,start,end,metrics});
      if(own!==generation.current)return;
      setGraphData({nodes:[r.root],edges:[]});setResult(r);setBusy(false);
      if(r.metric_error)setMetricState('指标未返回：'+r.metric_error);
      if(r.metric_job){
        setMetricState('正在计算指标…');
        for(;;){
          await new Promise(resolve=>setTimeout(resolve,700));
          if(own!==generation.current)return;
          const state=await api<Result&{status:string;error?:string}>('aggregate/'+r.scope+'/metrics');
          if(own!==generation.current)return;
          if(state.status==='complete'){setResult(state);setMetricState('指标已更新');break;}
          if(state.status==='failed'){setMetricState('指标未返回：'+state.error);break;}
        }
      }
    }catch(e){if(own===generation.current)setError((e as Error).message);}finally{if(own===generation.current)setBusy(false);}
  }
  async function openGroup(id:string,offset=0) {
    if(!result)return;
    const selected=result.groups.find(b=>b.id===id);if(!selected)return;
    const own=++memberGeneration.current;setBucket(selected);setMemberBusy(true);setError('');
    if(offset===0)setMembers(null);
    try {const page=await api<Members>('aggregate/expand',{scope:result.scope,bucket:id,offset,limit:20});if(own===memberGeneration.current)setMembers(page);}
    catch(e){if(own===memberGeneration.current)setError((e as Error).message);}
    finally{if(own===memberGeneration.current)setMemberBusy(false);}
  }
  return <div className="kb-graph">
    <header><strong>{title} · 知识图谱</strong><span>点击分组查看成员 · 拖动节点 / 滚轮缩放</span></header>
    <div className="kb-query">
      <label>查看什么<select value={source} onChange={e=>setSource(e.target.value)}>{views.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label>查询范围<select value={relation} onChange={e=>setRelation(e.target.value)}><option value="">全局</option>{view?.roots.map(r=><option key={r.field} value={r.field}>指定{r.name}（{view.groups.find(g=>g.field===r.field)?.name}）</option>)}</select></label>
      {relation&&<label>主体实例<select value={root} onChange={e=>setRoot(e.target.value)}>{instances.map(n=><option key={n.id} value={n.data?.key as string}>{n.label}</option>)}</select></label>}
      <label>分组方式<select value={group} onChange={e=>setGroup(e.target.value)}>{view?.groups.map(g=><option key={g.field} value={g.field}>{g.name}</option>)}</select></label>
      {view?.time&&<><label>开始日期<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束日期<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></>}
      <button onClick={draw} disabled={busy||!group||!!relation&&!root}>{busy?'查询中…':'绘制图谱'}</button>
    </div>
    <div className="kb-metrics"><span>展示指标</span>{view?.metrics.length ? view.metrics.map(m=><label key={m.id}><input type="checkbox" checked={metrics.includes(m.id)} onChange={e=>setMetrics(e.target.checked?[...metrics,m.id]:metrics.filter(id=>id!==m.id))}/>{m.name}</label>):<span>该主体尚无基础指标，显示记录数</span>}</div>
    {error&&<div role="alert" className="kb-error">{error}</div>}
    <div className="kb-body"><main>
      {result ? <WorkbenchCanvas overlay={overlay} onGroupClick={id=>void openGroup(id)}/> : <div className="kb-empty">选择查询范围和分组方式，点击“绘制图谱”</div>}
      {result&&<div className="kb-status">{result.root.label} · {result.total} 条记录 · {result.groups.length} 个分组 · 数据来自 ClickHouse{metricState&&' · '+metricState}</div>}
    </main><aside>
      <h3>{bucket?bucket.label+' · 分组成员':'分组与成员'}</h3>
      <p>分组保留本次查询的主体和时间范围，展开时继续使用该范围。</p>
      <div className="kb-buckets">{result?.groups.map(b=><button className={bucket?.id===b.id?'selected':''} key={b.id} onClick={()=>void openGroup(b.id)}>{b.label}<b>{b.count}</b></button>)}</div>
      {memberBusy&&<p>读取成员…</p>}
      {members&&<><p>共 {members.total} 条 · 当前 {members.offset+1}–{members.offset+members.nodes.length}</p><table><thead><tr><th>标识</th><th>名称</th></tr></thead><tbody>{members.nodes.map(n=><tr key={n.id}><td>{n.data?.key as string}</td><td>{n.label}</td></tr>)}</tbody></table><div className="kb-pages"><button disabled={!members.offset||memberBusy} onClick={()=>void openGroup(bucket!.id,Math.max(0,members.offset-20))}>上一页</button><button disabled={!members.has_more||memberBusy} onClick={()=>void openGroup(bucket!.id,members.offset+20)}>下一页</button></div></>}
    </aside></div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Workbench/>);
