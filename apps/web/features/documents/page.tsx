import { Search, Eye, } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { ActionButton } from "../../components/action-button";
import { Report } from "../../components/financial-views";
import { documentLabel, type Row } from "../../lib/format";
// What issuing does differs by type, so the confirmation says exactly what happened to the books.
const issuedNotice = (d: Row) => (r: Row) => ({
  title: documentLabel(d.kind) + " issued",
  description: (r?.number || d.number) + (d.kind === "BILL"
    ? " · " + (d.payment_method === "Cash" ? "Petty cash" : "Operating bank") + " and income updated."
    : d.kind === "INVOICE" ? " · posted to receivables and revenue." : " · final copy ready to send. Nothing posts to the ledger.")
});
type Props = {
  ctx: any
};
export function DocumentsPage({ ctx }: Props) {
  const {
    page,
    data,
    day,
    pretty,
    fail,
    documentStatus,
    canWrite,
    viewDoc,
    open,
    Empty,
    taxTab,
    setTaxTab,
    docKind,
    setDocKind,
    search,
    setSearch,
    filteredDocs,
    perform,
    api,
    Badge,
  } = ctx;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  const documentMoney = (
    value: any,
    currency = "INR"
  ) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  return <> {page === "documents" && <section className="panel">
      <div className="panel-toolbar">
        <div className="tabs">
          {["ALL", "GST", "NON_GST"].map(t => <button key={t} className={taxTab === t ? "selected" : ""} onClick={() => setTaxTab(t)}>
            {t === "ALL" ? "All documents" : t === "GST" ? "GST" : "Non-GST"}
          </button>)}
        </div>
        <select aria-label="Document type" value={docKind} onChange={e => setDocKind(e.target.value)}>
          {["ALL", "QUOTATION", "PROFORMA", "INVOICE", "CREDIT_NOTE", "BILL"].map(k => <option key={k} value={k}>
            {k === "ALL" ? "All types" : k === "BILL" ? "Payment Receipt" : pretty(k)}
          </option>)}
        </select>
        <div className="searchbox">
          <Search size={15}/>
          <input placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
      </div>
      {filteredDocs.length ? <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Client / vendor</th>
              <th>Date</th>
              <th>Tax treatment</th>
              <th>Status</th>
              <th className="right">Total</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDocs.map((d: Row) => <tr key={d.id}>
              <td>
                <strong>{d.number}</strong>
                <small>{d.kind === "BILL" ? "Payment Receipt" : pretty(d.kind)}</small>
              </td>
              <td>{d.party_name}</td>
              <td className="muted nowrap">{day(d.issue_date)}</td>
              <td><span className="tax-tag">{pretty(d.tax_treatment)}</span></td>
              <td>
                <Badge tone={documentStatus(d) === "Overdue" ? "red" : ["DRAFT", "CANCELLED"].includes(d.status) ? "gray" : ""}>
                  {documentStatus(d)}
                </Badge>
              </td>
              <td className="right amount">{documentMoney(d.total, d.currency || "INR")}</td>
              <td>
                <div className="row-actions">
                  <ActionButton className="icon-btn" title="Preview document" onClick={() => viewDoc(d.id)}>
                    <Eye size={16}/>
                  </ActionButton>
                  {canWrite && d.status === "DRAFT" && <ActionButton className="link small"
    onClick={() => api("documents/" + d.id).then((document: Row) => open("document", { document })).catch(fail("Couldn't open " + d.number + " for editing"))}>Edit</ActionButton>}
                  {canWrite && d.status === "DRAFT" && <ActionButton className="link small" loadingText="Issuing…"
    onClick={() => perform("documents/" + d.id + "/issue", {}, "POST", issuedNotice(d), "Couldn't issue " + d.number).catch(() => { })}>Issue</ActionButton>}
                  {canWrite && ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status !== "CANCELLED" && <ActionButton className="link small"
    onClick={() => {
      // Converting again returns the invoice made earlier rather than a new one; say so instead of "created".
      const existing = data.documents.find((x: Row) => x.kind === "INVOICE" && x.source_id === d.id && x.status !== "CANCELLED");
      return perform("documents/" + d.id + "/convert", {}, "POST", existing
        ? { tone: "info", title: "Already converted", description: "Opening " + existing.number + ", the invoice made from " + d.number + "." }
        : { title: "Invoice draft created", description: "From " + d.number + ". Review it, then issue when ready." },
      "Couldn't convert " + d.number).then((r: any) => viewDoc(r.id)).catch(() => { });
    }}>Convert</ActionButton>}
                  {canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && Number(d.total) > Number(d.paid) && <button className="link small"
    onClick={() => open("payment", { document: d })}>Record receipt</button>}
                  {canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && Number(d.total) > Number(d.paid) && <button className="link small"
    onClick={() => open("creditNote", { document: d })}>Credit note</button>}
                  {canWrite && (d.status === "DRAFT" || (d.status === "ISSUED" && ["QUOTATION", "PROFORMA", "BILL"].includes(d.kind))) && <button className="link small"
    onClick={() => open("cancel", { document: d })}>Cancel</button>}
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <Empty label="No documents in this view"/>}
      <div className="panel-note">Quotations and proformas do not affect revenue. Non-GST views retain the specific tax treatment.</div>
    </section>}</>;
}
