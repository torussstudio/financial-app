import { CATEGORY_REPORTS } from "../../components/financial-views";
import { GstReturnsPanel } from "../../components/gst-returns-panel";
type Props = {
  ctx: any
};
export function ReportsPage({ ctx }: Props) {
  const { page, data, from, to, report, setReport, Report, open, canWrite } = ctx;
  return <> {page === "reports" && <section className="panel">
      <div className="panel-toolbar">
        <div className="tabs">
          {["P&L", ...Object.keys(CATEGORY_REPORTS), "Trial balance", "Balance sheet", "Ageing", "Payables ageing", "GST summary", "GST returns", "TDS", "Audit"].map(t => <button key={t} className={report === t ? "selected" : ""} onClick={() => setReport(t)}>
            {t}
          </button>)}
        </div>
        {report === "TDS" && canWrite && <button className="btn small-btn" onClick={() => open("voucher", { tdsDeposit: true })}>Record TDS deposit</button>}
      </div>
      {report === "GST returns" ? <GstReturnsPanel ctx={ctx}/> : <Report data={data} type={report} to={to} from={from}/>}
    </section>}</>;
}
