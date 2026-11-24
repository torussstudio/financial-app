import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronsUpDown, Download, Eye, MoreHorizontal, Paperclip, Plus, RefreshCw, Search, X } from "lucide-react";
import { useTable } from "../../lib/use-table";
import { Pager } from "../../components/pager";
import { ActionButton } from "../../components/action-button";
import { Money } from "../../components/money";
import { DateRangePicker } from "../../components/date-range-picker";
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

const KIND_LABEL: Record<string, string> = { BILL: "Payment Receipt", SALES_DEBIT_NOTE: "Debit note" };
const KIND_CODE: Record<string, string> = { INVOICE: "IN", BILL: "PR", PROFORMA: "PF", QUOTATION: "QT", CREDIT_NOTE: "CN", SALES_DEBIT_NOTE: "DN" };
const TABS: [string, string][] = [["ALL", "All documents"], ["GST", "GST"], ["ZERO_RATED", "Zero-rated / export"], ["NON_GST", "Non-GST"]];
const TYPES = ["ALL", "QUOTATION", "PROFORMA", "INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE", "BILL"];
// One colour per status, used by the row pills and the hero's status mix.
const STATUS_TONE: Record<string, string> = {
  Draft: "draft", Issued: "issued", Received: "received", Paid: "received", "Part paid": "partial", Unpaid: "unpaid",
  Overdue: "overdue", Credited: "credited", Cancelled: "cancelled"
};
const STATUS_ORDER = ["Draft", "Issued", "Unpaid", "Part paid", "Overdue", "Paid", "Received", "Credited", "Cancelled"];

const initials = (name = "") => {
  const words = name.replace(/[(),.&]/g, " ").split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
};
const round2 = (v: number) => Math.round(v * 100) / 100;
// Totals per currency, INR first, so a dollar quotation is never silently added to rupee figures.
function sumByCurrency(rows: Row[]) {
  const out: Record<string, number> = {};
  for (const d of rows) { const c = d.currency || "INR"; out[c] = round2((out[c] || 0) + Number(d.total || 0)); }
  return out;
}

type Props = {
  ctx: any
};
export function DocumentsPage({ ctx }: Props) {
  const {
    page, data, day, pretty, fail, documentStatus, canWrite, viewDoc, open, Empty, taxTab, setTaxTab, docKind, setDocKind,
    search, setSearch, filteredDocs, perform, api, docsAnyTab, inTaxTab, datePresets, from, to, setFrom, setTo,
    partyFilter, setPartyFilter, loading, refresh, exportVisible,
  } = ctx;
  const documentMoney = (
    value: any,
    currency = "INR"
  ) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
  const docs: Row[] = filteredDocs || [];
  const t = useTable(docs, 25);
  // undefined = follow the first row; null = the reader closed the panel.
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const convertedFrom = useMemo(() => new Set((data.documents as Row[]).filter(x => x.kind === "INVOICE" && x.source_id && x.status !== "CANCELLED").map(x => x.source_id)), [data.documents]);
  const selected: Row | undefined = selectedId === null ? undefined : docs.find(d => d.id === selectedId) || (selectedId === undefined ? t.rows[0] : undefined);

  // Hero figures follow exactly what the list shows (tab, type, dates, client and search).
  const received = docs.filter(d => d.kind === "BILL" && d.status === "ISSUED");
  const drafts = docs.filter(d => d.status === "DRAFT");
  const openQuotes = docs.filter(d => ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status === "ISSUED" && !convertedFrom.has(d.id));
  const statusCounts: Record<string, number> = {};
  for (const d of docs) { const s = documentStatus(d); statusCounts[s] = (statusCounts[s] || 0) + 1; }
  const mix = STATUS_ORDER.filter(s => statusCounts[s]).map(s => [s, statusCounts[s]] as [string, number]);

  const awaiting = docs.filter(d => RECEIVABLE_KINDS.includes(d.kind) && d.status === "ISSUED" && outstandingOf(d) > 0);
  const overdueCount = awaiting.filter(d => documentStatus(d) === "Overdue").length;
  // One stage of the flow: the INR total in front, any other currency and the count underneath.
  const stage = (label: string, rows: Row[], noun: string, amount = (d: Row) => Number(d.total || 0), extra = "") => {
    const inr = rows.filter(d => (d.currency || "INR") === "INR").reduce((t, d) => t + amount(d), 0);
    const others = Object.entries(sumByCurrency(rows.filter(d => d.currency && d.currency !== "INR"))).map(([c, v]) => "+ " + documentMoney(v, c));
    return <div className="docs-stage">
      <small>{label}</small>
      <Money value={inr}/>
      <p>{[...others, rows.length + " " + noun + (rows.length === 1 ? "" : "s"), extra].filter(Boolean).join(" · ")}</p>
    </div>;
  };
  const arrow = <span className="docs-flow-arrow" aria-hidden="true"><ArrowRight size={16} strokeWidth={1.6}/></span>;

  // Sorting by anything other than date breaks the day grouping, so the list goes flat and shows the date per row.
  const grouped = !t.sort || t.sort.key === "issue_date";
  const sortHead = (label: string, k: string, className = "") => {
    const on = t.sort?.key === k;
    return <button className={"docs-sort " + className} aria-sort={on ? (t.sort!.dir === "asc" ? "ascending" : "descending") : "none"} onClick={() => t.toggle(k)}>
      {label}{on ? (t.sort!.dir === "asc" ? <ArrowUp size={12}/> : <ArrowDown size={12}/>) : <ChevronsUpDown size={12}/>}
    </button>;
  };
  const pick = (d: Row) => setSelectedId(d.id);
  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, d: Row) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(d); } };
  const statusPill = (d: Row) => {
    const s = documentStatus(d);
    return <span className={"docs-pill " + (STATUS_TONE[s] || "draft")}><i/>{s}</span>;
  };

  const rows: ReactNode[] = [];
  let lastDate = "";
  t.rows.forEach((d: Row) => {
    if (grouped && d.issue_date !== lastDate) {
      lastDate = d.issue_date;
      const n = t.rows.filter((x: Row) => x.issue_date === d.issue_date).length;
      rows.push(<div className="docs-group" key={"g" + d.issue_date}><b>{day(d.issue_date)}</b><span>{n} document{n === 1 ? "" : "s"}</span></div>);
    }
    const kind = KIND_LABEL[d.kind] || pretty(d.kind);
    rows.push(<div key={d.id} role="button" tabIndex={0} aria-pressed={selected?.id === d.id}
      className={"docs-row" + (selected?.id === d.id ? " selected" : "") + (d.status === "CANCELLED" ? " cancelled" : "")}
      onClick={() => pick(d)} onKeyDown={e => onRowKey(e, d)}>
      <div className="docs-doc"><span className={"docs-kind k-" + (KIND_CODE[d.kind] || "DOC")}>{KIND_CODE[d.kind] || "DOC"}</span>
        <div><b>{d.number}</b><small>{kind}{grouped ? "" : " · " + day(d.issue_date)}</small></div></div>
      <div className="docs-party"><span className="docs-avatar">{initials(d.party_name)}</span><span title={d.party_name}>{d.party_name}</span></div>
      <div className="docs-tax">{treatmentLabel(d)}</div>
      <div className="docs-status">{statusPill(d)}{data.company.einvoice_enabled && einvoiceable(d) && !d.irn && <span className="docs-pill partial"><i/>IRN pending</span>}</div>
      <div className="docs-amount">{documentMoney(d.total, d.currency || "INR")}{d.currency && d.currency !== "INR" && d.total_inr != null && <small>{documentMoney(d.total_inr)}</small>}</div>
      <span className="docs-more" aria-hidden="true"><MoreHorizontal size={16}/></span>
    </div>);
  });

  // Every action the old row offered, now in the side panel.
  function actions(d: Row) {
    const list: ReactNode[] = [];
    if (canWrite && d.status === "DRAFT") list.push(<ActionButton key="edit" className="docs-act"
      onClick={() => api("documents/" + d.id).then((document: Row) => open("document", { document })).catch(fail("Couldn't open " + d.number + " for editing"))}>Edit</ActionButton>);
    if (canWrite && d.status === "DRAFT") list.push(<ActionButton key="issue" className="docs-act strong" loadingText="Issuing…"
      onClick={() => {
        // A foreign-currency invoice is issued with its exchange rate; everything else issues directly.
        if (d.kind === "INVOICE" && d.currency && d.currency !== "INR") return open("issue", { document: d });
        if (!ctx.confirmFiled(d.issue_date)) return;
        return perform("documents/" + d.id + "/issue", {}, "POST", (r: Row) => ctx.withWarnings(r, issuedNotice(d)(r)), "Couldn't issue " + d.number).catch(() => { });
      }}>Issue</ActionButton>);
    if (canWrite && ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status !== "CANCELLED") list.push(<ActionButton key="convert" className="docs-act strong"
      onClick={() => {
        // Converting again returns the invoice made earlier rather than a new one; say so instead of "created".
        const existing = data.documents.find((x: Row) => x.kind === "INVOICE" && x.source_id === d.id && x.status !== "CANCELLED");
        return perform("documents/" + d.id + "/convert", {}, "POST", existing
          ? { tone: "info", title: "Already converted", description: "Opening " + existing.number + ", the invoice made from " + d.number + "." }
          : { title: "Invoice draft created", description: "From " + d.number + ". Review it, then issue when ready." },
        "Couldn't convert " + d.number).then((r: any) => viewDoc(r.id)).catch(() => { });
      }}>{convertedFrom.has(d.id) ? "Open invoice" : "Convert to invoice"}</ActionButton>);
    const receivableOpen = canWrite && RECEIVABLE_KINDS.includes(d.kind) && d.status === "ISSUED" && outstandingOf(d) > 0;
    if (receivableOpen) list.push(<button key="receipt" className="docs-act strong" onClick={() => open("payment", { document: d })}>Record receipt</button>);
    if (receivableOpen && (!d.currency || d.currency === "INR") && Number(data.parties.find((p: Row) => p.id === d.party_id)?.advance_received) > 0)
      list.push(<button key="advance" className="docs-act" onClick={() => open("advance", { direction: "RECEIPT", partyId: d.party_id })}>Apply advance</button>);
    if (canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && outstandingOf(d) > 0) list.push(<button key="cn" className="docs-act" onClick={() => open("creditNote", { document: d })}>Credit note</button>);
    if (canWrite && d.kind === "INVOICE" && d.status === "ISSUED" && (!d.currency || d.currency === "INR")) list.push(<button key="dn" className="docs-act" onClick={() => open("salesDebitNote", { document: d })}>Debit note</button>);
    if (data.company.einvoice_enabled && einvoiceable(d)) list.push(<ActionButton key="einv" className="docs-act" loadingText="Preparing…" onClick={() => ctx.downloadEinvoice(d)}>E-invoice JSON</ActionButton>);
    if (canWrite && data.company.einvoice_enabled && einvoiceable(d) && !d.irn) list.push(<button key="irn" className="docs-act" onClick={() => open("irn", { document: d })}>Record IRN</button>);
    if (ctx.isAdmin) list.push(<button key="delete" className="docs-act danger-link" onClick={() => ctx.removeDocument(d)}>Delete</button>);
    return list;
  }
  const cancellable = (d: Row) => canWrite && (d.status === "DRAFT" || (d.status === "ISSUED" && (["QUOTATION", "PROFORMA", "BILL"].includes(d.kind) || (d.kind === "SALES_DEBIT_NOTE" && Number(d.paid) === 0))));

  // Where the document is in its life, from draft to its final state.
  function lifecycle(d: Row): [string, "done" | "current" | "todo" | "stopped"][] {
    const s = documentStatus(d), issued = d.status !== "DRAFT";
    if (d.status === "CANCELLED") return [["Created", "done"], ["Cancelled", "stopped"]];
    if (d.kind === "BILL") return [["Draft", "done"], ["Received", issued ? "done" : "todo"]];
    if (["QUOTATION", "PROFORMA"].includes(d.kind)) return [["Draft", "done"], ["Issued", issued ? "done" : "todo"], ["Converted", convertedFrom.has(d.id) ? "done" : issued ? "current" : "todo"]];
    if (RECEIVABLE_KINDS.includes(d.kind)) {
      const settled = ["Paid", "Credited"].includes(s);
      return [["Draft", "done"], ["Issued", issued ? "done" : "todo"], [s === "Credited" ? "Credited" : "Paid", settled ? "done" : issued ? "current" : "todo"]];
    }
    return [["Draft", "done"], ["Issued", issued ? "done" : "todo"]];
  }

  const panel = selected && (() => {
    const d = selected, label = KIND_LABEL[d.kind] || pretty(d.kind), code = KIND_CODE[d.kind] || "DOC";
    const foreign = d.currency && d.currency !== "INR";
    const steps = lifecycle(d), more = actions(d), files = data.attachmentCounts?.[d.id] || 0;
    const receivable = RECEIVABLE_KINDS.includes(d.kind) && d.status === "ISSUED";
    return <aside className="docs-panel" aria-label={label + " " + d.number}>
      <div className="docs-panel-head">
        <div className="docs-panel-top">
          <span className="docs-panel-kind"><span className={"docs-kind k-" + code}>{code}</span>{label.toUpperCase()}</span>
          <button className="icon-btn" aria-label="Close details" onClick={() => setSelectedId(null)}><X size={16}/></button>
        </div>
        <h3>{d.number}</h3>
        <p>{d.party_name}</p>
        <div className="docs-panel-amount">{documentMoney(d.total, d.currency || "INR")}</div>
        {foreign && d.total_inr != null && <div className="docs-panel-inr">{documentMoney(d.total_inr)} in INR</div>}
        {statusPill(d)}
      </div>
      <button className="docs-thumb" onClick={() => viewDoc(d.id)} aria-label={"Open full preview of " + d.number}>
        <span className="docs-a4">
          <b>{label.toUpperCase()}</b>
          <em>{d.number} · {day(d.issue_date)}</em>
          <i>{d.kind === "BILL" ? "RECEIVED FROM" : "BILL TO"}</i>
          <em>{d.party_name}</em>
          <span className="docs-a4-lines"><s/><s/><s/></span>
          <span className="docs-a4-total"><span>{d.kind === "BILL" ? "Amount Received" : "Total"}</span><span>{documentMoney(d.total, d.currency || "INR")}</span></span>
        </span>
        <span className="docs-thumb-hint"><Eye size={13}/>Open full preview</span>
      </button>
      <div className="docs-panel-sec">
        <h4>PROGRESS</h4>
        <ol className="docs-steps">{steps.map(([name, state], i) => <li key={name} className={state + (i > 0 && state !== "todo" ? " linked" : "")}>
          <i>{state === "done" ? <Check size={11} strokeWidth={3}/> : state === "stopped" ? <X size={11} strokeWidth={3}/> : null}</i><span>{name}</span>
        </li>)}</ol>
      </div>
      <div className="docs-panel-sec">
        <h4>DETAILS</h4>
        <dl className="docs-dl">
          <div><dt>Date</dt><dd>{day(d.issue_date)}</dd></div>
          {d.kind !== "BILL" && d.due_date && <div><dt>{["QUOTATION", "PROFORMA"].includes(d.kind) ? "Valid until" : "Due date"}</dt><dd>{day(d.due_date)}</dd></div>}
          <div><dt>Tax treatment</dt><dd>{treatmentLabel(d)}</dd></div>
          {receivable && <div><dt>Received</dt><dd>{documentMoney(d.paid)}</dd></div>}
          {receivable && <div><dt>Outstanding</dt><dd className={outstandingOf(d) > 0 ? "due" : ""}>{documentMoney(outstandingOf(d))}</dd></div>}
          {d.irn && <div><dt>IRN</dt><dd className="mono" title={d.irn}>{String(d.irn).slice(0, 14)}…</dd></div>}
          <div><dt>Attachments</dt><dd><button className="link" onClick={() => ctx.attach("DOCUMENT", d.id, d.number)}>{files ? files + " file" + (files === 1 ? "" : "s") : "Add files"}</button></dd></div>
        </dl>
      </div>
      <div className="docs-panel-actions">
        <ActionButton className="docs-act primary" onClick={() => viewDoc(d.id)}><Eye size={15}/>Preview</ActionButton>
        <button className="docs-act" onClick={() => ctx.attach("DOCUMENT", d.id, d.number)}><Paperclip size={15}/>Attach</button>
        {more}
        {cancellable(d) && <button className="docs-act danger" onClick={() => open("cancel", { document: d })}>Cancel {label.toLowerCase()}</button>}
      </div>
    </aside>;
  })();

  if (page !== "documents") return null;
  const tabCount = (k: string) => (docsAnyTab || []).filter((d: Row) => inTaxTab(d, k)).length;
  return <>
    <header className="ov-head docs-headbar">
      <div className="ov-head-row">
        <div><h1>Documents</h1><p>From the first proposal to the final payment.</p></div>
        <div className="ov-actions">
          <button className="btn" onClick={exportVisible}><Download size={15}/>Export visible</button>
          {canWrite && <button className="btn primary" onClick={() => open("document")}><Plus size={16}/>New document</button>}
        </div>
      </div>
      <div className="ov-bar">
        <div className="ov-seg" role="tablist" aria-label="GST view">
          {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={taxTab === k} className={taxTab === k ? "on" : ""} onClick={() => setTaxTab(k)}>
            {label}<em className="docs-count">{tabCount(k)}</em>
          </button>)}
        </div>
        <div className="docs-filters">
          <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} presets={datePresets} day={day}/>
          <label className="docs-control select"><select aria-label="Document type" value={docKind} onChange={e => setDocKind(e.target.value)}>
            {TYPES.map(k => <option key={k} value={k}>{k === "ALL" ? "All types" : k === "BILL" ? "Payment Receipt" : k === "SALES_DEBIT_NOTE" ? "Debit note" : pretty(k)}</option>)}
          </select><ChevronDown size={13}/></label>
          <label className="docs-control select"><select aria-label="Filter by client or vendor" value={partyFilter} onChange={e => setPartyFilter(e.target.value)}>
            <option value="">All clients & vendors</option>
            {data.parties.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select><ChevronDown size={13}/></label>
          <label className="docs-control docs-search"><Search size={14}/><input placeholder="Search number, client…" aria-label="Search documents" value={search} onChange={e => setSearch(e.target.value)}/></label>
          <button className={"icon-btn " + (loading ? "spinning" : "")} aria-label="Refresh data" disabled={loading} onClick={refresh}><RefreshCw size={15}/></button>
        </div>
      </div>
    </header>

    <section className="ov-sheet docs-flow" aria-label="Document flow">
      <div className="ov-sec-h"><h2>Document flow</h2><span className="ov-aside">{docs.length} document{docs.length === 1 ? "" : "s"} in this view</span></div>
      <div className="docs-flow-row">
        {stage("Open quotes & proformas", openQuotes, "document")}
        {arrow}
        {stage("Drafts waiting to issue", drafts, "document", d => Number(d.inr_total ?? d.total ?? 0))}
        {arrow}
        {stage("Awaiting payment", awaiting, "invoice", d => outstandingOf(d), overdueCount ? overdueCount + " overdue" : "none overdue")}
        {arrow}
        {stage("Payments received", received, "receipt")}
      </div>
      <div className="docs-flow-mix">
        <div className="docs-mixbar" role="img" aria-label={"Status mix: " + (mix.map(([s, n]) => s + " " + n).join(", ") || "no documents")}>
          {mix.length ? mix.map(([s, n]) => <i key={s} className={STATUS_TONE[s]} style={{ flex: n }}/>) : <i className="empty" style={{ flex: 1 }}/>}
        </div>
        <div className="docs-mixkey">{mix.map(([s, n]) => <span key={s}><i className={STATUS_TONE[s]}/>{s}<b>{n}</b></span>)}</div>
      </div>
    </section>

    <div className={"docs-split" + (panel ? "" : " solo")}>
      <section className="docs-list">
        {docs.length ? <>
          <div className="docs-head">
            {sortHead("Document", "number")}
            {sortHead("Client / vendor", "party_name")}
            <span>Tax treatment</span>
            <span>Status</span>
            {sortHead("Total", "total", "right")}
            <span/>
          </div>
          {rows}
          <div className="docs-foot"><span>Showing {t.rows.length} of {docs.length} document{docs.length === 1 ? "" : "s"}</span>{!grouped && <span>Click the sorted column until it clears to group by date again</span>}</div>
          <Pager {...t}/>
        </> : <Empty label="No documents in this view" detail={search ? "Nothing matches “" + search + "”. Clear the search or widen the dates." : "Change the tab, type or date range, or create a new document."}/>}
        <div className="panel-note">Quotations and proformas do not affect revenue. Non-GST views retain the specific tax treatment; zero-rated exports and SEZ supplies have their own view. Debit notes bill an under-charge on an issued invoice and are settled like invoices.{data.company.einvoice_enabled && " E-invoicing is on: download the IRP JSON for each B2B invoice, upload it on the IRP or through your GSP, then record the IRN here."}</div>
      </section>
      {panel}
    </div>
  </>;
}
