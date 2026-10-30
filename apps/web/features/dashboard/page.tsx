import { Wallet, ChartNoAxesCombined, Plus, ArrowUpRight, ArrowDownLeft, ArrowRight, } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
import { EntryTable } from "../../components/entry-table";
import { ActionButton } from "../../components/action-button";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
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
 <div className="chart-grid">
      <section className="panel revenue-panel">
        <div className="panel-heading">
          <div><h2>Income & expenses</h2><p>Your operating performance over time</p></div>
          <div className="chart-legend">
            <span><i className="green-dot"/>Income</span>
            <span><i className="sand-dot"/>Expenses</span>
          </div>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.monthly} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4b9485" stopOpacity={.18}/>
                  <stop offset="100%" stopColor="#4b9485" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e9eeeb"/>
              <XAxis dataKey="month"
    axisLine={false}
    tickLine={false}
    tick={{ fontSize: 11, fill: "#88918b" }}
    tickFormatter={m => new Date(m + "-01").toLocaleDateString("en", { month: "short" })}/>
              <YAxis axisLine={false}
    tickLine={false}
    tick={{ fontSize: 11, fill: "#88918b" }}
    tickFormatter={short}
    width={55}/>
              <Tooltip formatter={(v) => money(v)}
    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8e3", fontSize: 12 }}/>
              <Area type="monotone"
    name="Income"
    dataKey="income"
    stroke="#26756b"
    fill="url(#incomeFill)"
    strokeWidth={2.5}/>
              <Area type="monotone"
    name="Expenses"
    dataKey="expense"
    stroke="#c9aa72"
    fill="transparent"
    strokeWidth={2}
    strokeDasharray="5 4"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-footer">
          <span><span className="tiny-dot"/> Accrual view</span>
          <button className="link" onClick={() => go("reports")}>View report <ArrowUpRight size={14}/>
          </button>
        </div>
      </section>
 <section className="panel">
        <div className="panel-heading">
          <div><h2>Where your money goes</h2><p>Expenses by category</p></div>
        </div>
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height={195}>
            <PieChart>
              <Pie data={data.expenseBreakdown}
    dataKey="value"
    innerRadius={65}
    outerRadius={86}
    paddingAngle={3}
    stroke="none">
                {data.expenseBreakdown.map((d: Row, i: number) => <Cell key={d.name} fill={palette[i % palette.length]}/>)}
              </Pie>
              <Tooltip formatter={v => money(v)}/>
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-label">
            <span>Total spent</span>
            <strong>{short(Number(metric.expenses))}</strong>
          </div>
        </div>
        <div className="expense-legend">
          {data.expenseBreakdown.map((
    d: Row,
    i: number
  ) => <button key={d.name}
    onClick={() => {
    go("income");
    setAccountFilter(accounts.find((a: Row) => a.name === d.name)?.code || "")
  }}>
            <span><i style={{ background: palette[i % palette.length] }}/>{d.name}</span>
            <strong>{money(d.value)}</strong>
          </button>)}
        </div>
      </section>
    </div>
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
        {outstanding.slice(0, 3).map((d: Row) => <ActionButton className="due-row" key={d.id} onClick={() => viewDoc(d.id)}>
          <span className="letter-avatar">{d.party_name[0]}</span>
          <span><strong>{d.party_name}</strong><small>{d.number} · {documentStatus(d)}</small></span>
          <b>{money(Number(d.total) - Number(d.paid))}</b>
        </ActionButton>)}
        {!outstanding.length && <Empty label="All caught up" detail="No unpaid invoices in this view."/>}
        {canWrite && <button className="btn subtle full" onClick={() => open("payment")}>Record a receipt <Plus size={15}/>
        </button>}
      </section>
    </div></>;
}
