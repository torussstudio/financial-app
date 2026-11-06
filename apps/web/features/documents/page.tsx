import { Search, Eye, Paperclip } from "lucide-react";
import { EntryTable } from "../../components/entry-table";
import { ActionButton } from "../../components/action-button";
import { Report } from "../../components/financial-views";
import { documentLabel, outstandingOf, RECEIVABLE_KINDS, treatmentLabel, type Row } from "../../lib/format";
// What issuing does differs by type, so the confirmation says exactly what happened to the books.
const issuedNotice = (d: Row) => (r: Row) => ({
  title: documentLabel(d.kind) + " issued",
  description: (r?.number || d.number) + (d.kind === "BILL"
    ? " · " + (d.payment_method === "Cash" ? "Petty cash" : "Operating bank") + " and income updated."
    : d.kind === "INVOICE" ? " · posted to receivables and revenue." : " · final copy ready to send. Nothing posts to the ledger.")
});
// Documents the IRP accepts: issued invoices and notes to GSTIN holders, and exports.
const einvoiceable = (d: Row) => ["INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE"].includes(d.kind) && d.status === "ISSUED"
  && ["TAXABLE", "ZERO_RATED"].includes(d.tax_treatment) && (Boolean(String(d.client_snapshot?.gstin || "").trim()) || d.tax_treatment === "ZERO_RATED");
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
          {["ALL", "GST", "ZERO_RATED", "NON_GST"].map(t => <button key={t} className={taxTab === t ? "selected" : ""} onClick={() => setTaxTab(t)}>
            {t === "ALL" ? "All documents" : t === "GST" ? "GST" : t === "ZERO_RATED" ? "Zero-rated / export" : "Non-GST"}
          </button>)}
        </div>
        <select aria-label="Document type" value={docKind} onChange={e => setDocKind(e.target.value)}>
          {["ALL", "QUOTATION", "PROFORMA", "INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE", "BILL"].map(k => <option key={k} value={k}>
            {k === "ALL" ? "All types" : k === "BILL" ? "Payment Receipt" : k === "SALES_DEBIT_NOTE" ? "Debit note" : pretty(k)}
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
                <small>{d.kind === "BILL" ? "Payment Receipt" : d.kind === "SALES_DEBIT_NOTE" ? "Debit note" : pretty(d.kind)}</small>
              </td>
              <td>{d.party_name}</td>
              <td className="muted nowrap">{day(d.issue_date)}</td>
              <td><span className="tax-tag">{treatmentLabel(d)}</span></td>
              <td>
                <Badge tone={documentStatus(d) === "Overdue" ? "red" : ["DRAFT", "CANCELLED"].includes(d.status) ? "gray" : ""}>
                  {documentStatus(d)}
                </Badge>
                {data.company.einvoice_enabled && einvoiceable(d) && !d.irn && <Badge tone="amber">IRN pending</Badge>}
              </td>
              <td className="right amount">{documentMoney(d.total, d.currency || "INR")}{d.currency && d.currency !== "INR" && d.total_inr != null && <small>{documentMoney(d.total_inr)}</small>}</td>
              <td>
                <div className="row-actions">
                  <ActionButton className="icon-btn" title="Preview document" onClick={() => viewDoc(d.id)}>
                    <Eye size={16}/>
                  </ActionButton>
                  <button className="icon-btn attach-btn" title="Attachments" onClick={() => ctx.attach("DOCUMENT", d.id, d.number)}>
                    <Paperclip size={15}/>{data.attachmentCounts?.[d.id] ? <span>{data.attachmentCounts[d.id]}</span> : null}
                  </button>
                  {canWrite && d.status === "DRAFT" && <ActionButton className="link small"
    onClick={() => api("documents/" + d.id).then((document: Row) => open("document", { document })).catch(fail("Couldn't open " + d.number + " for editing"))}>Edit</ActionButton>}
                  {canWrite && d.status === "DRAFT" && <ActionButton className="link small" loadingText="Issuing…"
    onClick={() => {
      // A foreign-currency invoice is issued with its exchange rate; everything else issues directly.
      if (d.kind === "INVOICE" && d.currency && d.currency !== "INR") return open("issue", { document: d });
      if (!ctx.confirmFiled(d.issue_date)) return;
      return perform("documents/" + d.id + "/issue", {}, "POST", (r: Row) => ctx.withWarnings(r, issuedNotice(d)(r)), "Couldn't issue " + d.number).catch(() => { });
    }}>Issue</ActionButton>}
                  {canWrite && ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status !== "CANCELLED" && <ActionButton className="link small"
    onClick={() => {
      // Converting again returns the invoice made earlier rather than a new one; say so instead of "created".
      const existing = data.documents.find((x: Row) => x.kind === "INVOICE" && x.source_id === d.id && x.status !== "CANCELLED");
      return perform("documents/" + d.id + "/convert", {}, "POST", existing
        ? { tone: "info", title: "Already converted", description: "Opening " + existing.number + ", the invoice made from " + d.number + "." }
        : { title: "Invoice draft created", description: "From " + d.number + ". Review it, then issue when ready." },
      "Couldn't convert " + d.number).then((r: any) => viewDoc(r.id)).catch(() => { });
    }}>Convert</ActionButton>}
                  {canWrite && RECEIVABLE_KINDS.includes(d.kind) && d.status === "ISSUED" && outstandingOf(d) > 0 && <button className="link small"
    onClick={() => open("payment", { document: d })}>Record receipt</button>}
                  {canWrite && RECEIVABLE_KINDS.includes(d.kind) && d.status === "ISSUED" && outstandingOf(d) > 0 && (!d.currency || d.currency === "INR") && Number(data.parties.find((p: Row) => p.id === d.party_id)?.advance_received) > 0 && <button className="link small"
    onClick={() => open("advance", { direction: "RECEIPT", partyId: d.party_id })}>Apply advance</button>}
                  {canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && outstandingOf(d) > 0 && <button className="link small"
    onClick={() => open("creditNote", { document: d })}>Credit note</button>}
                  {canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && (!d.currency || d.currency === "INR") && <button className="link small"
    onClick={() => open("salesDebitNote", { document: d })}>Debit note</button>}
                  {data.company.einvoice_enabled && einvoiceable(d) && <ActionButton className="link small" loadingText="Preparing…" onClick={() => ctx.downloadEinvoice(d)}>E-invoice JSON</ActionButton>}
                  {canWrite && data.company.einvoice_enabled && einvoiceable(d) && !d.irn && <button className="link small"
    onClick={() => open("irn", { document: d })}>Record IRN</button>}
                  {canWrite && (d.status === "DRAFT" || (d.status === "ISSUED" && (["QUOTATION", "PROFORMA", "BILL"].includes(d.kind) || (d.kind === "SALES_DEBIT_NOTE" && Number(d.paid) === 0)))) && <button className="link small"
    onClick={() => open("cancel", { document: d })}>Cancel</button>}
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <Empty label="No documents in this view"/>}
      <div className="panel-note">Quotations and proformas do not affect revenue. Non-GST views retain the specific tax treatment; zero-rated exports and SEZ supplies have their own view. Debit notes bill an under-charge on an issued invoice and are settled like invoices.{data.company.einvoice_enabled && " E-invoicing is on: download the IRP JSON for each B2B invoice, upload it on the IRP or through your GSP, then record the IRN here."}</div>
    </section>}</>;
}
