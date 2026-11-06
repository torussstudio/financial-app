import { day, foreignOutstandingOf, money, outstandingOf, type Row } from "../../lib/format";
// Allocation of one amount (a payment plus any TDS, or an available advance) across a party's open invoices or vendor bills.
// INR documents take an INR amount ("alloc-<documentId>"). A foreign-currency invoice takes the amount settled in its own
// currency ("falloc-<documentId>"); the API converts it at the invoice's rate and books the exchange difference.
const cents = (v: any) => Math.round(Number(v || 0) * 100);
const fmt = (currency: string, v: any) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(v || 0));
export function AllocationTable({ docs, values, onChange, amount, remainderLabel, noun }: {
  docs: Row[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  amount: number;
  remainderLabel: string;
  noun: "invoices" | "bills";
}) {
  const inrDocs = docs.filter(d => foreignOutstandingOf(d) === null), foreignDocs = docs.filter(d => foreignOutstandingOf(d) !== null);
  const anyForeign = foreignDocs.some(d => Number(values[d.id]) > 0);
  const allocated = inrDocs.reduce((s, d) => s + cents(values[d.id]), 0) / 100;
  const remainder = Math.round((amount - allocated) * 100) / 100;
  // Oldest due first, never more than each document's balance or the amount available. Foreign invoices are left to the user.
  const autoAllocate = () => {
    let left = cents(amount);
    const next: Record<string, string> = {};
    for (const d of [...inrDocs].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))) {
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
      <button type="button" className="link small" onClick={autoAllocate} disabled={amount <= 0 || !inrDocs.length}>Auto-allocate (oldest first)</button>
      <button type="button" className="link small" onClick={() => onChange({})}>Clear</button>
    </div>
    <div className="table-scroll">
      <table className="allocation-grid">
        <thead><tr><th>Document</th><th>Due</th><th className="right">Balance</th><th className="right">Allocate</th></tr></thead>
        <tbody>
          {docs.map(d => {
            const foreign = foreignOutstandingOf(d);
            return <tr key={d.id}>
              <td><strong>{d.number}</strong>{d.reference ? <small>Supplier bill {d.reference}</small> : <small>{d.kind === "SALES_DEBIT_NOTE" ? "Debit note · " : ""}{day(d.issue_date)}</small>}</td>
              <td className="nowrap">{day(d.due_date)}</td>
              <td className="right amount">{foreign === null ? money(outstandingOf(d)) : <>{fmt(d.currency, foreign)}<small>carried at {money(outstandingOf(d))}</small></>}</td>
              <td className="right">
                <input className="allocation-input" aria-label={"Allocate to " + d.number + (foreign === null ? "" : " in " + d.currency)}
                  name={(foreign === null ? "alloc-" : "falloc-") + d.id} type="number" min="0" step=".01"
                  max={foreign ?? outstandingOf(d)} value={values[d.id] || ""} placeholder={foreign === null ? "0.00" : d.currency}
                  onChange={e => onChange({ ...values, [d.id]: e.target.value })}/>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {anyForeign
      ? <div className="allocation-summary"><span>Foreign-currency settlement</span><span>No advance can be kept from it; the exchange difference is booked on save.</span></div>
      : <div className={"allocation-summary" + (remainder < 0 ? " over" : "")}>
        <span>Allocated <strong>{money(allocated)}</strong></span>
        <span>{remainder < 0 ? <>Over-allocated by <strong>{money(-remainder)}</strong></> : remainder > 0 ? <>Remaining <strong>{money(remainder)}</strong> {remainderLabel}</> : "Fully allocated"}</span>
      </div>}
  </div>;
}
