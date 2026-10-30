import { Landmark, Download, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function BankPage({ ctx }: Props) {
  const { page, data, money, day, canWrite, open, Empty, to, Badge, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "bank" && <><div className="kpi-grid three">
        {data.balances.filter((a: Row) => a.is_cash).map((a: Row) => <div className="kpi bank-card" key={a.code}>
          <div className="kpi-label">{a.name}<Landmark size={18}/></div>
          <strong>{money(a.balance)}</strong>
          <small>Ledger balance · as of {day(to)}</small>
        </div>)}
      </div><section className="panel">
        <div className="panel-heading">
          <div><h2>Bank reconciliation</h2><p>Statement matches never create duplicate entries</p></div>
          {canWrite && <button className="btn" onClick={() => open("import")}><Download size={15}/>Import CSV</button>}
        </div>
        {data.bankLines.length ? <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Account</th>
                <th>Date</th>
                <th className="right">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.bankLines.map((b: Row) => <tr key={b.id}>
                <td><strong>{b.description}</strong><small>{b.reference}</small></td>
                <td>{b.account_name}</td>
                <td>{day(b.entry_date)}</td>
                <td className="right amount">{money(b.amount)}</td>
                <td>
                  <Badge tone={b.matched_entry_id ? "" : "amber"}>
                    {b.matched_entry_id ? "Matched" : "Unmatched"}
                  </Badge>
                </td>
                <td>
                  {canWrite && !b.matched_entry_id && <button className="link" onClick={() => open("match", { line: b })}>Match entry</button>}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div> : <Empty label="Your bank statement belongs here"
    detail="Import a CSV to match statement lines against your posted entries."/>}
      </section></>}</>;
}
