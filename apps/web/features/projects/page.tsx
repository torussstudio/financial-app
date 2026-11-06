import { useState } from "react";
import { FolderKanban, } from "lucide-react";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function ProjectsPage({ ctx }: Props) {
  const { page, data, money, Empty, Badge, canWrite, open } = ctx;
  const [showArchived, setShowArchived] = useState(false);
  if (page !== "projects") return null;
  const archivedCount = data.projects.filter((p: Row) => p.archived).length;
  const projects: Row[] = data.projects.filter((p: Row) => showArchived || !p.archived);
  return <>
    {archivedCount > 0 && <label className="check-field page-toggle"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Show archived projects ({archivedCount})</label>}
    <div className="project-grid">
      {projects.map((p: Row) => {
        const budget = Number(p.budget), used = budget > 0 ? Math.round(Number(p.cost) / budget * 100) : null;
        return <section className={"panel project-card" + (p.archived ? " archived-row" : "")} key={p.id}>
        <div className="panel-heading">
          <span className="round-icon"><FolderKanban size={20}/></span>
          <Badge tone={p.archived ? "gray" : ""}>{p.archived ? "Archived" : "Active"}</Badge>
        </div>
        <h2>{p.name}</h2>
        <p className="muted">{p.party_name || "Internal project"}</p>
        <div className="project-stats">
          <div><small>Revenue</small><strong>{money(p.revenue)}</strong></div>
          <div><small>Direct costs</small><strong>{money(p.cost)}</strong></div>
        </div>
        <div className="project-result"><span>Direct profit</span><strong>{money(p.profit)}</strong></div>
        {used !== null && <small className={used > 100 ? "over-budget" : "muted"}>Budget {money(budget)} · {used}% used by direct costs</small>}
        <small className="muted">Shared overheads are not allocated.</small>
        {canWrite && <button className="link small" onClick={() => open("project", { project: p })}>Edit project</button>}
      </section>;
      })}
      {!projects.length && <section className="panel"><Empty label="Create your first project"/></section>}
    </div>
  </>;
}
