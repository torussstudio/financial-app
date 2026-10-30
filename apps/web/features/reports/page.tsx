import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function ReportsPage({ ctx }: Props) {
  const { page, data, from, to, report, setReport, Report, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "reports" && <section className="panel">
      <div className="panel-toolbar">
        <div className="tabs">
          {["P&L", "Trial balance", "Balance sheet", "Ageing", "GST summary", "Audit"].map(t => <button key={t} className={report === t ? "selected" : ""} onClick={() => setReport(t)}>
            {t}
          </button>)}
        </div>
      </div>
      <Report data={data} type={report} to={to} from={from}/>
    </section>}</>;
}
