import { useState } from "react";
import { Paperclip, Search } from "lucide-react";
import { ActionButton } from "../../components/action-button";
import { moneySub, type Row } from "../../lib/format";
type Props = {
  ctx: any
};
// Vendor bills (PURCHASE documents): draft → post (expense/asset + input GST against payables) → pay or apply an advance.
export function PurchasesPage({ ctx }: Props) {
  const { data, metric, money, day, fail, documentStatus, canWrite, open, Empty, search, setSearch, perform, api, Badge, to, attach } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  const [tab, setTab] = useState("OPEN");
  const bills: Row[] = data.documents.filter((d: Row) => d.kind === "PURCHASE");
  const due = (d: Row) => Number(moneySub(d.total, d.paid));
  const open_ = bills.filter(d => d.status === "ISSUED" && due(d) > 0);
  const overdue = open_.filter(d => d.due_date < to);
  const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + Math.round(f(r) * 100), 0) / 100;
  const shown = filter(bills).filter(d =>
    tab === "ALL" ? true
    : tab === "OPEN" ? d.status === "ISSUED" && due(d) > 0
    : tab === "PAID" ? d.status === "ISSUED" && due(d) <= 0
    : d.status === "DRAFT");
  const advanceVendors = data.parties.filter((p: Row) => Number(p.advance_paid) > 0);
  const counts = data.attachmentCounts || {};
  return <>
    <div className="kpi-grid">
      {[
        ["Payable to vendors", metric.payables, open_.length + " open bill" + (open_.length === 1 ? "" : "s") + " · ledger balance as of " + day(to)],
        ["Overdue bills", sum(overdue, due), overdue.length ? overdue.length + " past their due date" : "Nothing overdue"],
        ["Vendor advances", metric.vendorAdvances, "Paid ahead, not yet applied to bills"],
        ["Input GST (ITC)", metric.inputTax, "Claimable GST on posted bills, as of " + day(to)]
      ].map(([label, value, note]) => <div className="kpi" key={String(label)}>
        <span className="kpi-label">{label}</span>
        <strong>{money(value)}</strong>
        <small>{note}</small>
      </div>)}
    </div>
    <section className="panel">
      <div className="panel-toolbar">
        <div className="tabs" role="tablist">
          {[["OPEN", "To pay", open_.length], ["DRAFT", "Drafts", bills.filter(d => d.status === "DRAFT").length], ["PAID", "Paid", null], ["ALL", "All bills", null]].map(([key, label, count]) =>
            <button key={String(key)} role="tab" aria-selected={tab === key} className={tab === key ? "selected" : ""} onClick={() => setTab(String(key))}>
              {label}{count !== null && <span className="count">{count}</span>}
            </button>)}
        </div>
        <div className="searchbox">
          <Search size={15}/>
          <input placeholder="Search bills…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
        {canWrite && <><button className="btn small-btn" onClick={() => open("payment", { direction: "PAYMENT" })}>Pay vendor</button>
          {advanceVendors.length > 0 && <button className="btn small-btn" onClick={() => open("advance", { direction: "PAYMENT" })}>Apply vendor advance</button>}</>}
      </div>
      {shown.length ? <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Bill</th>
              <th>Vendor</th>
              <th>Bill date</th>
              <th>Due</th>
              <th>Status</th>
              <th className="right">Total</th>
              <th className="right">Balance</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(d => {
              const status = documentStatus(d), vendor = data.parties.find((p: Row) => p.id === d.party_id);
              return <tr key={d.id}>
                <td><strong>{d.reference || "—"}</strong><small>{d.number}{d.tax_treatment === "TAXABLE" ? (d.itc_eligible ? " · ITC" : " · ITC blocked") : " · no GST"}</small></td>
                <td>{d.party_name}</td>
                <td className="muted nowrap">{day(d.issue_date)}</td>
                <td className="nowrap">{day(d.due_date)}</td>
                <td><Badge tone={status === "Overdue" ? "red" : ["Draft", "Cancelled"].includes(status) ? "gray" : status === "Paid" ? "" : "amber"}>{status}</Badge></td>
                <td className="right amount">{money(d.total)}</td>
                <td className="right amount">{d.status === "ISSUED" ? money(due(d)) : "—"}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn attach-btn" title="Attachments" onClick={() => attach("DOCUMENT", d.id, d.reference || d.number)}>
                      <Paperclip size={15}/>{counts[d.id] ? <span>{counts[d.id]}</span> : null}
                    </button>
                    {canWrite && d.status === "DRAFT" && <ActionButton className="link small"
                      onClick={() => api("documents/" + d.id).then((document: Row) => open("purchase", { document })).catch(fail("Couldn't open the bill"))}>Edit</ActionButton>}
                    {canWrite && d.status === "DRAFT" && <ActionButton className="link small" loadingText="Posting…"
                      onClick={() => perform("documents/" + d.id + "/issue", {}, "POST", (r: Row) => ({ title: "Vendor bill posted", description: (r?.number || "") + " · " + money(d.total) + " payable to " + d.party_name + "." }), "Couldn't post the bill").catch(() => {})}>Post</ActionButton>}
                    {canWrite && d.status === "ISSUED" && due(d) > 0 && <button className="link small" onClick={() => open("payment", { direction: "PAYMENT", document: d })}>Pay</button>}
                    {canWrite && d.status === "ISSUED" && due(d) > 0 && Number(vendor?.advance_paid) > 0 && <button className="link small" onClick={() => open("advance", { direction: "PAYMENT", partyId: d.party_id })}>Use advance</button>}
                    {canWrite && (d.status === "DRAFT" || (d.status === "ISSUED" && Number(d.paid) === 0)) && <button className="link small" onClick={() => open("cancel", { document: d })}>Cancel</button>}
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <Empty label={tab === "OPEN" ? "No bills to pay" : "No vendor bills in this view"} detail="Enter a supplier's bill to track what you owe and the GST you can claim."/>}
      <div className="panel-note">Posting a bill records the expense (or fixed asset), eligible GST as input tax credit and the payable. Payments and advances settle the balance; a bill with nothing paid can be cancelled, which posts a reversal.</div>
    </section>
  </>;
}
