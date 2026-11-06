import { useState } from "react";
import { Search, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import { moneySub, type Row } from "../../lib/format";
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
  const [incomeTab, setIncomeTab] = useState("RECEIVED");
  const byDate = (key: string) => (a: Row, b: Row) => String(a[key]).localeCompare(String(b[key]));
  // Received: money that actually came into bank or cash from clients — direct income, payment receipts and invoice receipts.
  const received: Row[] = filter(data.entries)
    .filter((e: Row) => ["INCOME", "BILL", "RECEIPT"].includes(e.kind) && !e.reversed_by && Number(e.cash_in) > 0)
    .sort(byDate("entry_date"));
  // Receivable: issued invoices with money still to come in, as of the end of the selected range.
  const receivable: Row[] = filter(data.documents)
    .filter((d: Row) => d.kind === "INVOICE" && d.status === "ISSUED" && Number(moneySub(d.total, d.paid)) > 0)
    .sort(byDate("issue_date"));
  const showCredits = receivable.some(d => Number(d.credited) > 0);
  const sum = (rows: Row[], value: (r: Row) => any) => rows.reduce((t, r) => t + Math.round(Number(value(r) || 0) * 100), 0) / 100;
  const receivedTotal = sum(received, e => e.cash_in);
  const incomeTabs = <div className="tabs" role="tablist">
    {[["RECEIVED", "Received", received.length], ["RECEIVABLE", "Receivable", receivable.length], ["ALL", "All entries", null]].map(([key, label, count]) => <button key={String(key)} role="tab" aria-selected={incomeTab === key} className={incomeTab === key ? "selected" : ""} onClick={() => setIncomeTab(String(key))}>
      {label}{count !== null && <span className="count">{count}</span>}
    </button>)}
  </div>;
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
      </div>}{page === "income" && <div className="kpi-grid">
        {[
    ["Received", receivedTotal, "Money in from clients in this range"],
    ["Receivable", sum(receivable, d => moneySub(d.total, d.paid)), "Still due on issued invoices as of " + day(to)],
    ["Operating expenses", metric.expenses, "Selected date range and filters"],
    ["Net profit", metric.profit, "Selected date range and filters"]
  ].map(([name, v, note]) => <div className="kpi" key={name}>
          <span className="kpi-label">{name}</span>
          <strong>{money(v)}</strong>
          <small>{note}</small>
        </div>)}
      </div>}{page === "income" && incomeTab !== "ALL" ? <section className="panel">
        <div className="panel-toolbar">
          {incomeTabs}
          <div className="searchbox">
            <Search size={15}/>
            <input placeholder={incomeTab === "RECEIVED" ? "Search receipts…" : "Search invoices…"} value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
        </div>
        {incomeTab === "RECEIVED" ? (received.length ? <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th>Mode</th><th className="right">Amount</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {received.map((e: Row) => <tr key={e.id}>
                <td className="muted nowrap">{day(e.entry_date)}</td>
                <td><strong>{e.party_name || e.description}</strong>{e.party_name && <small>{e.description}</small>}</td>
                <td className="nowrap">{e.number}<small>{e.kind === "RECEIPT" ? "Invoice receipt" : e.kind === "BILL" ? "Payment receipt" : "Direct income"}</small></td>
                <td className="nowrap">{e.cash_account || "—"}</td>
                <td className="right amount">{money(e.cash_in)}</td>
                <td className="right">{e.kind === "RECEIPT" && <button className="link small" onClick={() => viewReceipt(e.id)}>View</button>}</td>
              </tr>)}
              <tr className="total-row"><td colSpan={4}>Total received</td><td className="right amount">{money(receivedTotal)}</td><td /></tr>
            </tbody>
          </table>
        </div> : <div className="panel-note">No money received in the selected period.</div>) : (receivable.length ? <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Client</th><th>Due date</th><th className="right">Invoice amount</th><th className="right">Received</th>{showCredits && <th className="right">Credit notes</th>}<th className="right">Balance due</th></tr></thead>
            <tbody>
              {receivable.map((d: Row) => <tr key={d.id}>
                <td className="muted nowrap">{day(d.issue_date)}</td>
                <td className="nowrap"><strong>{d.number}</strong></td>
                <td>{d.party_name}</td>
                <td className="nowrap">{day(d.due_date)}{d.due_date < to && <small>Overdue</small>}</td>
                <td className="right amount">{money(d.total)}</td>
                <td className="right amount">{money(moneySub(d.paid, d.credited))}</td>
                {showCredits && <td className="right amount">{money(d.credited)}</td>}
                <td className="right amount">{money(moneySub(d.total, d.paid))}</td>
              </tr>)}
              <tr className="total-row">
                <td colSpan={4}>Total receivable</td>
                <td className="right amount">{money(sum(receivable, d => d.total))}</td>
                <td className="right amount">{money(sum(receivable, d => moneySub(d.paid, d.credited)))}</td>
                {showCredits && <td className="right amount">{money(sum(receivable, d => d.credited))}</td>}
                <td className="right amount">{money(sum(receivable, d => moneySub(d.total, d.paid)))}</td>
              </tr>
            </tbody>
          </table>
        </div> : <div className="panel-note">Nothing is outstanding on issued invoices.</div>)}
        <div className="panel-note">{incomeTab === "RECEIVED"
          ? "Money that reached bank or cash from direct income vouchers, payment receipts and receipts against invoices, from the latest 250 entries in the selected period. Reversed entries are left out."
          : "Issued invoices with a balance still due as of " + day(to) + ". Received includes invoice advances; credit notes reduce what is due without money coming in."}</div>
      </section> : <section className="panel">
        <div className="panel-toolbar">
          {page === "income" ? incomeTabs : <h2>
            {page === "capital" ? "Funding movements" : "Day book"}
          </h2>}
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
          {canWrite && page === "vouchers" && <><button className="btn small-btn" onClick={() => open("payment")}>Record receipt</button><button className="btn small-btn" onClick={() => open("payment", { direction: "PAYMENT" })}>Pay vendor</button><button className="btn small-btn" onClick={() => open("journal")}>Journal entry</button></>}
        </div>
        <EntryTable rows={txs}
    canWrite={canWrite}
    onReceipt={viewReceipt}
    onReverse={(entry: Row) => open("reverse", { entry })}
    onAttach={(entry: Row) => entry.document_id ? ctx.attach("DOCUMENT", entry.document_id, entry.number) : ctx.attach("ENTRY", entry.id, entry.number)}
    attachmentCounts={data.attachmentCounts}/>
        <div className="panel-note">Latest 250 entries in the selected period. Posted amounts include applicable tax; operating totals above exclude output GST.</div>
      </section>}</>}</>;
}
