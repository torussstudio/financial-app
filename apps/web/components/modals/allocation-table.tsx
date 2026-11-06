import { day, money, outstandingOf, type Row } from "../../lib/format";
// Allocation of one amount (a payment, or an available advance) across a party's open invoices or vendor bills.
// Inputs are named "alloc-<documentId>" so the surrounding form submits them.
const cents = (v: any) => Math.round(Number(v || 0) * 100);
export function AllocationTable({ docs, values, onChange, amount, remainderLabel, noun }: {
  docs: Row[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  amount: number;
  remainderLabel: string;
  noun: "invoices" | "bills";
}) {
  const allocated = docs.reduce((s, d) => s + cents(values[d.id]), 0) / 100;
  const remainder = Math.round((amount - allocated) * 100) / 100;
  // Oldest due first, never more than each document's balance or the amount available.
  const autoAllocate = () => {
    let left = cents(amount);
    const next: Record<string, string> = {};
    for (const d of [...docs].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))) {
      const take = Math.min(left, cents(outstandingOf(d)));
      if (take > 0) next[d.id] = (take / 100).toFixed(2);
      left -= take;
    }
    onChange(next);
  };
  if (!docs.length) return <div className="form-note wide">No open {noun} for this party.{amount > 0 ? " The whole amount " + remainderLabel + "." : ""}</div>;
  return <div className="wide">
    <div className="allocation-head">
      <strong>Allocate to {noun}</strong>
      <button type="button" className="link small" onClick={autoAllocate} disabled={amount <= 0}>Auto-allocate (oldest first)</button>
      <button type="button" className="link small" onClick={() => onChange({})}>Clear</button>
    </div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Document</th><th>Due</th><th className="right">Balance</th><th className="right">Allocate</th></tr></thead>
        <tbody>
          {docs.map(d => <tr key={d.id}>
            <td><strong>{d.number}</strong>{d.reference ? <small>Supplier bill {d.reference}</small> : <small>{day(d.issue_date)}</small>}</td>
            <td className="nowrap">{day(d.due_date)}</td>
            <td className="right amount">{money(outstandingOf(d))}</td>
            <td className="right">
              <input className="allocation-input" aria-label={"Allocate to " + d.number} name={"alloc-" + d.id} type="number" min="0" step=".01"
                max={outstandingOf(d)} value={values[d.id] || ""} placeholder="0.00"
                onChange={e => onChange({ ...values, [d.id]: e.target.value })}/>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className={"allocation-summary" + (remainder < 0 ? " over" : "")}>
      <span>Allocated <strong>{money(allocated)}</strong></span>
      <span>{remainder < 0 ? <>Over-allocated by <strong>{money(-remainder)}</strong></> : remainder > 0 ? <>Remaining <strong>{money(remainder)}</strong> {remainderLabel}</> : "Fully allocated"}</span>
    </div>
  </div>;
}
