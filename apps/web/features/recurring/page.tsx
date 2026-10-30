import { EntryTable } from "../../components/entry-table";
import { ActionButton } from "../../components/action-button";
import { Report } from "../../components/financial-views";
import type { Row } from "../../lib/format";
type Props = {
  ctx: any
};
export function RecurringPage({ ctx }: Props) {
  const { page, data, money, pretty, busy, canWrite, Empty, perform, to, Badge, } = ctx;
  const month: string = data.month || to.slice(0, 7);
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  return <> {page === "recurring" && <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Scheduled entries</h2>
          <p>Reviewing {month} (the month of the selected end date). Confirm only after money is actually received or paid.</p>
        </div>
      </div>
      {data.recurring.length ? <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Type</th>
              <th>Day of month</th>
              <th className="right">Amount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.recurring.map((r: Row) => <tr key={r.id}>
              <td><strong>{r.name}</strong></td>
              <td>{pretty(r.kind)}</td>
              <td>{r.day}</td>
              <td className="right amount">{money(r.amount)}</td>
              <td>
                <Badge tone={r.posted_entry ? "" : "amber"}>
                  {r.posted_entry ? "Confirmed" : "Awaiting confirmation"}
                </Badge>
              </td>
              <td>
                {canWrite && !r.posted_entry && <ActionButton loading={busy} loadingText="Confirming…"
    className="link"
    onClick={() => perform(
    "recurring/" + r.id + "/confirm",
    { month },
    "POST",
    (e: Row) => ({
      title: "Payment confirmed",
      description: [e?.number, r.name, money(r.amount)].filter(Boolean).join(" · ") + " posted for " + month + "."
    }),
    "Couldn't confirm " + r.name
  ).catch(() => { })}>Confirm payment</ActionButton>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <Empty label="Create your first recurring entry"/>}
      <div className="panel-note">This milestone generates reviewable occurrences on demand. Automatic background scheduling and external reminders are planned.</div>
    </section>}</>;
}
