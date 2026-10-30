import { EntryTable } from "../../components/entry-table";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function BudgetsPage({ ctx }: Props) {
  const { page, data, money, Empty, to, } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "budgets" && <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Budget vs actual</h2>
          <p>Budget month: {data.month || to.slice(0, 7)} (month of the selected end date) · Actuals are all postings in that month</p>
        </div>
      </div>
      {data.budgets.length ? <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Expense category</th>
              <th className="right">Budget</th>
              <th className="right">Actual</th>
              <th>Utilisation</th>
              <th className="right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {data.budgets.map((b: Row) => <tr key={b.id}>
              <td><strong>{b.name}</strong></td>
              <td className="right">{money(b.amount)}</td>
              <td className="right">{money(b.actual)}</td>
              <td>
                <div className="progress">
                  <i style={{
    width: Math.min(100, Number(b.actual) / Math.max(1, Number(b.amount)) * 100) + "%",
    background: Number(b.actual) > Number(b.amount) ? "#c78159" : undefined
  }}/>
                </div>
              </td>
              <td className="right amount">{money(Number(b.amount) - Number(b.actual))}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : <Empty label="Give your expenses a plan"
    detail="Set monthly budgets for the categories you want to track."/>}
    </section>}</>;
}
