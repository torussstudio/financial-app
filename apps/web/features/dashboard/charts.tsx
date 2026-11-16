import type { Row } from "../../lib/format";
import { ArrowUpRight } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from "recharts";
// Loaded on demand so the charting library stays out of the first page load.
export default function DashboardCharts({ ctx }: { ctx: any }) {
  const { data, metric, money, short, palette, accounts, go, setAccountFilter } = ctx;
  return <>
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
  </>;
}
