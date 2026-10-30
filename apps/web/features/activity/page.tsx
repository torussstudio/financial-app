import { Search, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function LedgerActivityPages({ ctx }: Props) {
  const {
    page,
    data,
    metric,
    money,
    day,
    accounts,
    setAccountFilter,
    canWrite,
    viewReceipt,
    open,
    search,
    setSearch,
    to,
    accountFilter,
    EntryTable,
    txs,
  } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {["vouchers", "income", "capital"].includes(page) && <>{page === "capital" && <div className="kpi-grid three">
        {[
    ["Owner capital", (a: Row) => a.code === "3000", -1],
    ["Loan principal", (a: Row) => a.code === "2200", -1],
    // Investment vouchers post to FD/RD and custom investment categories, not only the 1400 header account.
    ["Investments", (a: Row) => a.code.startsWith("14") || a.voucher_category_kind === "INVESTMENT", 1]
  ].map(([name, match, sign]: any[]) => <div className="kpi" key={name}>
          <span className="kpi-label">{name}</span>
          <strong>
            {money(data.balances.filter(match).reduce((s: number, a: Row) => s + Number(a.balance || 0), 0) * Number(sign))}
          </strong>
          <small>Company balance as of {day(to)}</small>
        </div>)}
      </div>}{page === "income" && <div className="kpi-grid three">
        {[
    ["Earned income", metric.income],
    ["Operating expenses", metric.expenses],
    ["Net profit", metric.profit]
  ].map(([name, v]) => <div className="kpi" key={name}>
          <span className="kpi-label">{name}</span>
          <strong>{money(v)}</strong>
          <small>Selected date range and filters</small>
        </div>)}
      </div>}<section className="panel">
        <div className="panel-toolbar">
          <h2>
            {page === "capital" ? "Funding movements" : page === "income" ? "Operating entries" : "Day book"}
          </h2>
          <div className="searchbox">
            <Search size={15}/>
            <input placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          {page === "income" && <select aria-label="Expense category"
    value={accountFilter}
    onChange={e => setAccountFilter(e.target.value)}>
            <option value="">All categories</option>
            {accounts.filter((a: Row) => ["INCOME", "EXPENSE"].includes(a.kind)).map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>}
          {canWrite && page === "vouchers" && <><button className="btn small-btn" onClick={() => open("payment")}>Record receipt</button><button className="btn small-btn" onClick={() => open("journal")}>Journal entry</button></>}
        </div>
        <EntryTable rows={txs}
    canWrite={canWrite}
    onReceipt={viewReceipt}
    onReverse={(entry: Row) => open("reverse", { entry })}/>
        <div className="panel-note">Latest 250 entries in the selected period. Posted amounts include applicable tax; operating totals above exclude output GST.</div>
      </section></>}</>;
}
