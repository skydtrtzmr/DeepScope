import type { ReactNode } from 'react';
import './graph-workspace.css';

export function GraphWorkspace({ canvas, legend, detail, related }: {
  canvas: ReactNode; legend?: ReactNode; detail: ReactNode; related: ReactNode;
}) {
  return <div className="local-graph-workspace">
    <div className="local-graph-stage"><div className="knowledge-graph">{canvas}</div>{legend}</div>
    <section className="local-graph-inspector" aria-label="节点详情">
      <div className="local-graph-info">{detail}</div>
      {related && <div className="local-graph-list">{related}</div>}
    </section>
  </div>;
}
