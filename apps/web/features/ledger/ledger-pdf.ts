import type { Row } from "../../lib/format";

type LedgerPdfInput = {
  company: Row;
  title: string;
  accountCode: string;
  allMode: boolean;
  partyName?: string;
  party?: Row | null;
  from: string;
  to: string;
  rows: Row[];
  opening: number; // cents
  closing: number; // cents
  debit: number; // cents
  credit: number; // cents
  money: (v: any) => string;
  day: (s: string) => string;
  fileName: string;
};

const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const cents = (v: any) => Math.round(Number(v || 0) * 100);
const oneLine = (v: any) => String(v || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean).join(", ");

export function exportLedgerPdf(p: LedgerPdfInput) {
  const { company: co, money, day } = p;
  const party = p.party || null;
  const amt = (c: number) => money(Math.abs(c) / 100);
  const side = (c: number) => c === 0 ? "" : c > 0 ? "Dr" : "Cr";
  const bal = (c: number) => `${amt(c)}${side(c) ? `<span class="side">${side(c)}</span>` : ""}`;
  const dash = `<span class="nil">—</span>`;
  const gstLabel = (t: any) => !t ? "" : t === "OUTSIDE_GST" ? "Non-GST" : "GST";

  const logo = co.gst_logo || co.non_gst_logo || "";
  const coAddress = [oneLine(co.address), oneLine(co.address_line2), [co.city, co.state_name || co.state, co.pin_code].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const coContact = [co.gstin && "GSTIN " + co.gstin, co.contact_number || co.phone, co.email].filter(Boolean).join("  ·  ");
  const partyAddress = party ? oneLine(party.address) : "";
  const partyLines = party ? [party.gstin && "GSTIN " + party.gstin, [party.contact_name, party.phone].filter(Boolean).join(" · "), party.email].filter(Boolean) : [];
  const issued = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const generated = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const period = `${day(p.from)} – ${day(p.to)}`;
  const accountLabel = p.allMode ? "All accounts" : `${p.accountCode} · ${p.title}`;
  const net = p.debit - p.credit;

  const body = p.rows.map((r, i) => {
    const gst = gstLabel(r.tax_treatment);
    const sub = p.allMode && r.account_name ? `${esc(r.account_code)} · ${esc(r.account_name)}` : !party && r.party_name ? esc(r.party_name) : "";
    return `<tr>
      <td class="c-sl">${String(i + 1)}</td>
      <td class="c-date">${esc(day(r.entry_date))}</td>
      <td class="c-doc">${esc(r.doc_number || r.number)}</td>
      <td class="c-gst">${gst ? `<span class="tag${gst === "GST" ? " gst" : ""}">${gst}</span>` : dash}</td>
      <td class="c-desc"><div class="d">${esc(r.description)}</div>${sub ? `<div class="s">${sub}</div>` : ""}</td>
      <td class="num">${cents(r.debit) ? esc(money(r.debit)) : dash}</td>
      <td class="num">${cents(r.credit) ? esc(money(r.credit)) : dash}</td>
      ${p.allMode ? "" : `<td class="num c-bal">${bal(r.running)}</td>`}
    </tr>`;
  }).join("");

  const figures = p.allMode
    ? [["Entries", String(p.rows.length)], ["Total debits", amt(p.debit)], ["Total credits", amt(p.credit)], ["Net balance", bal(net)]]
    : [["Opening balance", bal(p.opening)], ["Total debits", amt(p.debit)], ["Total credits", amt(p.credit)], ["Closing balance", bal(p.closing)]];

  const cols = p.allMode ? 7 : 8;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.fileName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  /* Zero page margin stops the browser printing its own date/URL header; spacing comes from the layout table below. */
  @page { size: A4; margin: 0; }
  :root { --ink: #22282b; --soft: #59626a; --muted: #9199a0; --rule: #eceef0; --wash: #f7f8f9; --accent: #3e6e66; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: #fff; }
  body { font: 8.6pt/1.55 Inter, "Segoe UI", system-ui, sans-serif; color: var(--ink); padding: 0 16mm; font-variant-numeric: tabular-nums; }
  table.sheet { width: 100%; border-collapse: collapse; }
  table.sheet > thead td { height: 15mm; padding: 0; }
  table.sheet > tfoot td { height: 18mm; padding: 0; }
  table.sheet > tbody > tr > td { padding: 0; }
  .running { position: fixed; left: 16mm; right: 16mm; bottom: 8mm; display: flex; justify-content: space-between; font-size: 7pt; color: var(--muted); }

  /* Masthead */
  .mast { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; padding-bottom: 7mm; border-bottom: .6pt solid var(--rule); }
  .issuer { display: flex; align-items: center; gap: 4mm; min-width: 0; }
  .issuer img { max-height: 12mm; max-width: 34mm; object-fit: contain; }
  .issuer .name { font-size: 13pt; font-weight: 600; line-height: 1.2; }
  .issuer .meta { margin-top: 1mm; font-size: 7.4pt; color: var(--soft); line-height: 1.6; max-width: 100mm; }
  .title { text-align: right; flex-shrink: 0; }
  .eyebrow { display: none; }
  .title h1 { margin: 0; font-size: 13pt; font-weight: 500; color: var(--soft); line-height: 1.2; }
  .rule { display: none; }

  /* Particulars */
  .parts { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12mm; padding: 7mm 0; }
  .parts .label { font-size: 7.2pt; color: var(--muted); margin-bottom: 1.5mm; }
  .parts .who { font-size: 12pt; font-weight: 600; line-height: 1.25; }
  .parts .lines { margin-top: 1mm; color: var(--soft); font-size: 7.8pt; line-height: 1.65; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 6mm; row-gap: 1.2mm; font-size: 8pt; }
  dt { color: var(--muted); }
  dd { margin: 0; text-align: right; }

  /* Figures */
  .figs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 8mm; }
  .fig { background: var(--wash); border-radius: 2mm; padding: 3.2mm 4mm; }
  .fig > span { display: block; font-size: 7.2pt; color: var(--muted); }
  .fig b { display: block; margin-top: .8mm; font-size: 11pt; font-weight: 600; white-space: nowrap; }
  .fig.key b { color: var(--accent); }

  /* Ledger table */
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines thead { display: table-header-group; }
  table.lines th { font-size: 7.2pt; font-weight: 500; color: var(--muted); text-align: left; padding: 0 1.8mm 2.2mm; border-bottom: .6pt solid var(--rule); white-space: nowrap; }
  table.lines td { padding: 2.4mm 1.8mm; border-bottom: .6pt solid var(--rule); vertical-align: top; }
  table.lines tr { break-inside: avoid; }
  table.lines th:first-child, table.lines td:first-child { padding-left: 0; }
  table.lines th:last-child, table.lines td:last-child { padding-right: 0; }
  .num { text-align: right !important; white-space: nowrap; }
  .c-sl { color: var(--muted); width: 7mm; }
  .c-date { white-space: nowrap; color: var(--soft); }
  .c-doc { white-space: nowrap; }
  .c-desc { width: 38%; }
  .c-desc .s { margin-top: .3mm; font-size: 7.2pt; color: var(--muted); }
  .c-bal { font-weight: 500; }
  .tag { font-size: 7.4pt; color: var(--soft); white-space: nowrap; }
  .tag.gst { color: var(--accent); }
  .nil { color: #cfd3d6; }
  .side { margin-left: 1mm; font-size: 6.8pt; color: var(--muted); font-weight: 400; }
  tr.band td { color: var(--soft); }
  tr.total td { border-bottom: 0; padding-top: 3mm; font-weight: 600; }
  tr.total td.lbl { color: var(--soft); font-weight: 500; }
  tr.closing td { border-bottom: 0; padding-top: .5mm; }
  tr.closing td.lbl { color: var(--soft); font-weight: 500; }
  tr.closing td.num b { font-size: 11pt; font-weight: 600; color: var(--accent); }
  .empty { padding: 8mm 0; text-align: center; color: var(--muted); }

  /* Close */
  .close { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; margin-top: 16mm; break-inside: avoid; }
  .close .note { font-size: 7.2pt; color: var(--muted); line-height: 1.7; max-width: 100mm; }
  .close .note b { font-weight: 500; color: var(--soft); }
  .sign { text-align: center; min-width: 50mm; }
  .sign .for { font-size: 7.4pt; color: var(--soft); margin-bottom: 12mm; }
  .sign .line { border-top: .6pt solid #c9ced2; padding-top: 1.6mm; font-size: 7.2pt; color: var(--muted); }
</style></head><body>
  <div class="running"><span>${esc(co.name || "")}  ·  Statement of account${party ? "  ·  " + esc(party.name) : ""}</span><span>${esc(period)}</span></div>
  <table class="sheet"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>

  <header class="mast">
    <div class="issuer">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div>
        <div class="name">${esc(co.name || "")}</div>
        ${!party && (coAddress || coContact) ? `<div class="meta">${coAddress ? esc(coAddress) + "<br>" : ""}${esc(coContact)}</div>` : ""}
      </div>
    </div>
    <div class="title"><h1>Statement of account</h1></div>
  </header>
  
  <section class="parts">
    <div>
      <div class="label">${party ? "Statement for" : "Account"}</div>
      <div class="who">${esc(party ? party.name : accountLabel)}</div>
      ${party ? `<div class="lines">${partyAddress ? esc(partyAddress) + "<br>" : ""}${partyLines.map(esc).join("<br>")}</div>` : ""}
    </div>
    <div>
      <div class="label">Statement details</div>
      <dl>
        <dt>Period</dt><dd>${esc(period)}</dd>
        <dt>Account</dt><dd>${esc(accountLabel)}</dd>
        ${p.allMode ? "" : `<dt>Entries</dt><dd>${p.rows.length}</dd>`}
        <dt>Issued on</dt><dd>${esc(issued)}</dd>
      </dl>
    </div>
  </section>

  <section class="figs">${figures.map(([k, v], i) => `<div class="fig${i === 3 ? " key" : ""}"><span>${k}</span><b>${v}</b></div>`).join("")}</section>

  <table class="lines">
    <thead><tr>
      <th>SL</th><th>Date</th><th>Invoice / Receipt</th><th>Type</th><th>Particulars</th>
      <th class="num">Debit</th><th class="num">Credit</th>${p.allMode ? "" : `<th class="num">Balance</th>`}
    </tr></thead>
    <tbody>
      ${p.allMode ? "" : `<tr class="band"><td colspan="${cols - 1}">Opening balance as of ${esc(day(p.from))}</td><td class="num">${bal(p.opening)}</td></tr>`}
      ${body || `<tr><td colspan="${cols}" class="empty">No entries in this period.</td></tr>`}
      <tr class="total"><td colspan="5" class="lbl">Period total</td><td class="num">${amt(p.debit)}</td><td class="num">${amt(p.credit)}</td>${p.allMode ? "" : "<td></td>"}</tr>
      <tr class="closing"><td colspan="${cols - 1}" class="lbl">${p.allMode ? "Net balance" : "Closing balance as of " + esc(day(p.to))}</td><td class="num"><b>${bal(p.allMode ? net : p.closing)}</b></td></tr>
    </tbody>
  </table>

  <section class="close">
    <div class="note"><b>Dr</b> denotes a debit balance and <b>Cr</b> a credit balance.<br>This is a computer-generated statement. Generated on ${esc(generated)}.</div>
    <div class="sign"><div class="for">For ${esc(co.name || "")}</div><div class="line">Authorised signatory</div></div>
  </section>

  </td></tr></tbody></table>
</body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  const win = frame.contentWindow!;
  const prevTitle = document.title;
  const cleanup = () => { document.title = prevTitle; setTimeout(() => frame.remove(), 500); };
  let started = false;
  const go = async () => {
    if (started) return; started = true;
    // Wait for the logo and web fonts (capped, so an offline machine still prints with the fallback fonts).
    await Promise.race([
      Promise.all([...Array.from(doc.images).map(img => img.decode().catch(() => {})), doc.fonts?.ready]),
      new Promise(r => setTimeout(r, 2500))
    ]);
    // Chrome uses the top document's title as the suggested PDF file name.
    document.title = p.fileName;
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    setTimeout(cleanup, 60000);
  };
  if (doc.readyState === "complete") go(); else frame.onload = () => go();
}
