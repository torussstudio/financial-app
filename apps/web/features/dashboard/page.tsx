import { Wallet, ChartNoAxesCombined, Plus, ArrowUpRight, ArrowDownLeft, ArrowRight, } from "lucide-react";
import dynamic from "next/dynamic";
const DashboardCharts = dynamic(() => import("./charts"), { ssr: false, loading: () => <div className="chart-grid"><div className="panel"><div className="skeleton" style={{ height: 268, margin: 20 }} /></div><div className="panel"><div className="skeleton" style={{ height: 268, margin: 20 }} /></div></div> });
import { EntryTable } from "../../components/entry-table";
import { ActionButton } from "../../components/action-button";
import { Report } from "../../components/financial-views";
import { outstandingOf, type Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function DashboardPage({ ctx }: Props) {
  const {
    data,
    metric,
    money,
    short,
    day,
    palette,
    accounts,
    go,
    setAccountFilter,
    documentStatus,
    outstanding,
    canWrite,
    viewReceipt,
    viewDoc,
    open,
    Empty,
    to,
    EntryTable,
  } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> <div className="kpi-grid">
      {[
    {
      label: "Earned income",
      value: metric.income,
      foot: "Revenue, excluding GST",
      icon: ArrowDownLeft,
      tone: "green"
    },
    {
      label: "Total expenses",
      value: metric.expenses,
      foot: "Operating costs in this period",
      icon: ArrowUpRight,
      tone: "amber"
    },
    {
      label: "Net profit",
      value: metric.profit,
      foot: "Income less operating expenses",
      icon: ChartNoAxesCombined,
      tone: "blue"
    },
    {
      label: "Cash & bank balance",
      value: metric.cash,
      foot: "Company-wide · as of " + day(to),
      icon: Wallet,
      tone: "gray"
    }
  ].map(({ label, value, foot, icon: Icon, tone }) => <div className="kpi" key={label}>
        <div className="kpi-label">
          {label}
          <span className={"kpi-icon " + tone}><Icon size={17}/></span>
        </div>
        <strong>{money(value)}</strong>
        <small>{foot}</small>
      </div>)}
    </div>
      <DashboardCharts ctx={ctx} />
 <div className="bottom-grid">
      <section className="panel">
        <div className="panel-heading">
          <div><h2>Recent activity</h2><p>Your latest posted transactions</p></div>
          <button className="link" onClick={() => go("vouchers")}>View all <ArrowRight size={14}/></button>
        </div>
        <EntryTable rows={data.entries.slice(0, 5)}
    compact
    canWrite={canWrite}
    onReceipt={viewReceipt}
    onReverse={(entry: Row) => open("reverse", { entry })}/>
      </section>
      <section className="panel outstanding">
        <div className="panel-heading">
          <div><h2>Money to collect</h2><p>{outstanding.length} invoices with a balance</p></div>
          <span className="round-icon"><ArrowDownLeft size={18}/></span>
        </div>
        <div className="collect-total">
          {money(metric.receivables)}
          <small>Outstanding as of {day(to)}</small>
        </div>
        {[...outstanding].sort((a: Row, b: Row) => String(a.due_date || "9").localeCompare(String(b.due_date || "9"))).slice(0, 4).map((d: Row) => <ActionButton className="due-row" key={d.id} onClick={() => viewDoc(d.id)}>
          <span className="letter-avatar">{d.party_name[0]}</span>
          <span><strong>{d.party_name}</strong><small>{d.number} · {documentStatus(d)}</small></span>
          <b>{money(outstandingOf(d))}</b>
        </ActionButton>)}
        {!outstanding.length && <Empty label="All caught up" detail="No unpaid invoices in this view."/>}
        {canWrite && <button className="btn subtle full" onClick={() => open("payment")}>Record a receipt <Plus size={15}/>
        </button>}
      </section>
    </div></>;
}
