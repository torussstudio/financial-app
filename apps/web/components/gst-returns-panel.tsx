import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, FileJson } from "lucide-react";
import { ActionButton } from "./action-button";
import { Badge, Empty } from "./ui";
import { day, money, type Row } from "../lib/format";
// GSTR-1 / GSTR-3B working exports for one return period. Everything here is a draft for the accountant; nothing is filed.
const SECTIONS: [string, string, string][] = [
  ["b2b", "B2B", "Invoices to GSTIN holders, invoice-wise and rate-wise (including SEZ)"],
  ["b2cl", "B2CL", "Inter-state invoices to unregistered recipients above the B2CL threshold"],
  ["b2cs", "B2CS", "Other supplies to unregistered recipients, by place of supply and rate (notes netted)"],
  ["exp", "EXP", "Exports with (WPAY) and without (WOPAY) payment of IGST"],
  ["cdnr", "CDNR", "Credit and debit notes to registered recipients"],
  ["cdnur", "CDNUR", "Credit and debit notes on B2CL and export invoices"],
  ["nil", "NIL", "Nil-rated, exempt and non-GST supplies"],
  ["hsn_b2b", "HSN · B2B", "HSN-wise summary of supplies to registered recipients"],
  ["hsn_b2c", "HSN · B2C", "HSN-wise summary of supplies to unregistered recipients"],
  ["docs", "Documents", "Documents issued in the period, by series"]
];
const csvText = (rows: Row[], note: string) => {
  const keys = Object.keys(rows[0] || {});
  const cell = (v: any) => { const s = String(v ?? ""); return '"' + (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'; };
  return "﻿" + [cell(note), "", keys.map(cell).join(","), ...rows.map(r => keys.map(k => cell(r[k])).join(","))].join("\r\n");
};
const B3B_ROWS: [string, string][] = [
  ["3.1(a)", "Outward taxable supplies (other than zero-rated, nil-rated and exempted)"],
  ["3.1(b)", "Outward taxable supplies (zero-rated)"],
  ["3.1(c)", "Other outward supplies (nil-rated, exempted)"],
  ["3.1(d)", "Inward supplies liable to reverse charge"],
  ["3.1(e)", "Non-GST outward supplies"],
  ["4(A)(3)", "ITC available · inward supplies liable to reverse charge"],
  ["4(A)(5)", "ITC available · all other ITC (less purchase debit notes)"],
  ["4(B)(1)", "ITC reversed · blocked credits (bills marked ITC blocked)"],
  ["4(C)", "Net ITC available (4A − 4B)"]
];
export function GstReturnsPanel({ ctx }: { ctx: any }) {
  const { api, to, notify, fail, open, session, data, downloadFile } = ctx;
  const [month, setMonth] = useState(String(to).slice(0, 7));
  const [result, setResult] = useState<Row | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [section, setSection] = useState("b2b");
  const period = month.slice(5, 7) + month.slice(0, 4);
  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    try { setResult(await api("gst-returns?period=" + month.slice(5, 7) + month.slice(0, 4))); setError(""); }
    catch (e: any) { setError(e.message); setResult(null); }
    finally { setLoading(false); }
  }, [api, month]);
  // Reload when the month changes or the ledger is refreshed (data changes after every save).
  useEffect(() => { load(); }, [load, data]);
  const filings: Row[] = (data.gstFilings || []).filter((g: Row) => g.period === period);
  const csvRows: Row[] = result?.gstr1.csv[section] || [];
  const totals = result?.gstr1.totals[section];
  const b3 = result?.gstr3b;
  return <div className="report-body">
    <div className="panel-toolbar">
      <label className="field"><span>Return period</span><input type="month" value={month} onChange={e => setMonth(e.target.value)}/></label>
      <span className="muted">Period code {period}</span>
      {result && <><ActionButton className="btn small-btn" onClick={async () => {
        downloadFile(JSON.stringify(result.json, null, 2), "GSTR1-" + period + "-WORKING-DRAFT.json", "application/json");
        notify({ title: "GSTR-1 JSON downloaded", description: result.note + ". Remove the “_note” key before importing it into the GSTN offline tool." });
      }}><FileJson size={15}/>GSTR-1 JSON</ActionButton>
        {session.user.role === "ADMIN" && <button className="btn small-btn" onClick={() => open("gstFiling", { period })}>Record filing</button>}</>}
    </div>
    <div className="error" role="note"><AlertTriangle size={16}/><span><strong>{result?.note || "Working draft for accountant review — not filed"}.</strong> Figures come from documents dated in the month. Nothing is filed or sent to the GST portal from here.</span></div>
    {error && <div className="error" role="alert">{error}</div>}
    {filings.length > 0 && <div className="panel-note">{filings.map(g => (g.return_type === "GSTR1" ? "GSTR-1" : "GSTR-3B") + " filed for " + g.period + " on " + day(g.filed_on) + " · ARN " + g.arn + (g.filed_by_name ? " · recorded by " + g.filed_by_name : "")).join(" · ")}. Edits dated in this month ask for confirmation.</div>}
    {loading && !result && <p className="fine">Preparing the working…</p>}
    {result && <>
      <div className="report-title"><h2>GSTR-1</h2><p>{result.company.name} · GSTIN {result.company.gstin || "not set"} · B2CL threshold {money(result.company.b2clThreshold)}</p></div>
      <div className="tabs">{SECTIONS.map(([key, label]) => <button key={key} className={section === key ? "selected" : ""} onClick={() => setSection(key)}>
        {label}<span className="count">{(result.gstr1.csv[key] || []).filter((r: Row) => key !== "nil" || Object.values(r).slice(1).some(v => Number(v) !== 0)).length}</span>
      </button>)}</div>
      <p className="fine">{SECTIONS.find(s => s[0] === section)?.[2]}</p>
      {csvRows.length && (section !== "nil" || csvRows.some(r => Object.values(r).slice(1).some(v => Number(v) !== 0))) ? <>
        <div className="table-scroll"><table>
          <thead><tr>{Object.keys(csvRows[0]).map(k => <th key={k} className={/Value|Tax|Amount|Quantity|Rate|Supplies|Number$|Cancelled/.test(k) ? "right" : ""}>{k}</th>)}</tr></thead>
          <tbody>{csvRows.map((r, i) => <tr key={i}>{Object.entries(r).map(([k, v]) => <td key={k} className={/Value|Tax|Amount|Quantity|Rate|Supplies|Number$|Cancelled/.test(k) ? "right" : ""}>{String(v)}</td>)}</tr>)}</tbody>
        </table></div>
        {totals && <div className="statement-row total"><span>Section total · taxable value {money(totals.txval)}</span><strong>IGST {money(totals.iamt)} · CGST {money(totals.camt)} · SGST {money(totals.samt)}</strong></div>}
        <button className="btn small-btn" onClick={() => {
          downloadFile(csvText(csvRows, result.note), "GSTR1-" + period + "-" + section + "-WORKING-DRAFT.csv", "text/csv;charset=utf-8;");
          notify({ title: "CSV downloaded", description: SECTIONS.find(s => s[0] === section)?.[1] + " · " + result.note + "." });
        }}><Download size={15}/>Download {SECTIONS.find(s => s[0] === section)?.[1]} CSV</button>
      </> : <Empty label={"Nothing to report in " + SECTIONS.find(s => s[0] === section)?.[1] + " for " + period}/>}

      <div className="report-title"><h2>GSTR-3B</h2><p>Summary working for {period}</p></div>
      <div className="table-scroll"><table>
        <thead><tr><th>Table</th><th>Nature</th><th className="right">Taxable value</th><th className="right">IGST</th><th className="right">CGST</th><th className="right">SGST</th></tr></thead>
        <tbody>
          {B3B_ROWS.map(([key, label]) => <tr key={key} className={key === "4(C)" ? "total-row" : ""}>
            <td className="nowrap">{key}</td><td>{label}</td>
            <td className="right">{key.startsWith("4") ? "—" : money(b3[key].txval)}</td>
            <td className="right">{money(b3[key].iamt)}</td><td className="right">{money(b3[key].camt)}</td><td className="right">{money(b3[key].samt)}</td>
          </tr>)}
          <tr><td>5</td><td>Exempt, nil-rated and non-GST inward supplies (inter-state · intra-state)</td><td className="right" colSpan={4}>{money(b3["5"].inter)} · {money(b3["5"].intra)}</td></tr>
        </tbody>
      </table></div>
      <h3>Net tax payable (set-off working)</h3>
      <div className="table-scroll"><table>
        <thead><tr><th>Tax</th><th className="right">Liability</th><th className="right">Paid from IGST credit</th><th className="right">Paid from CGST credit</th><th className="right">Paid from SGST credit</th><th className="right">Payable in cash</th><th className="right">Credit carried forward</th></tr></thead>
        <tbody>
          {b3.setoff.map((r: Row) => <tr key={r.head}>
            <td>{r.head}</td><td className="right">{money(r.liability)}</td><td className="right">{money(r.paidIgst)}</td><td className="right">{money(r.paidCgst)}</td><td className="right">{money(r.paidSgst)}</td>
            <td className="right">{Number(r.cash) > 0 ? <Badge tone="amber">{money(r.cash)}</Badge> : money(r.cash)}</td><td className="right">{money(r.creditLeft)}</td>
          </tr>)}
          <tr><td>RCM</td><td className="right" colSpan={4}>Reverse-charge tax is paid in cash and cannot be set off against ITC</td><td className="right">{money(Number(b3.rcmCash.igst) + Number(b3.rcmCash.cgst) + Number(b3.rcmCash.sgst))}</td><td /></tr>
        </tbody>
      </table></div>
      <p className="fine">Set-off order: IGST credit first against IGST and then — before any CGST/SGST credit is used — against CGST and SGST (covering what their own credit cannot); CGST credit against CGST then IGST; SGST credit against SGST then IGST. CGST and SGST credit are never used against each other. Interest, late fee and cess are not computed.</p>
      <details className="panel-note">
        <summary>Field mappings to verify before upload ({result.uncertain.length})</summary>
        <ul>{result.uncertain.map((u: string) => <li key={u}>{u}</li>)}</ul>
      </details>
    </>}
  </div>;
}
