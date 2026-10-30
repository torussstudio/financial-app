import { FolderKanban, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function ProjectsPage({ ctx }: Props) {
  const { page, data, money, Empty, Badge, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "projects" && <div className="project-grid">
      {data.projects.map((p: Row) => <section className="panel project-card" key={p.id}>
        <div className="panel-heading">
          <span className="round-icon"><FolderKanban size={20}/></span>
          <Badge>Active</Badge>
        </div>
        <h2>{p.name}</h2>
        <p className="muted">{p.party_name || "Internal project"}</p>
        <div className="project-stats">
          <div><small>Revenue</small><strong>{money(p.revenue)}</strong></div>
          <div><small>Direct costs</small><strong>{money(p.cost)}</strong></div>
        </div>
        <div className="project-result"><span>Direct profit</span><strong>{money(p.profit)}</strong></div>
        <small className="muted">Shared overheads are not allocated.</small>
      </section>)}
      {!data.projects.length && <section className="panel"><Empty label="Create your first project"/></section>}
    </div>}</>;
}
