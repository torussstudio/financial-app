// GSTR-1 / GSTR-3B working exports and the IRP e-invoice JSON — every GSTN / IRP field mapping lives in this one module.
//
// WORKING DRAFTS FOR ACCOUNTANT REVIEW — NOTHING HERE IS FILED. No call is made to the GST portal, GSTN, an IRP or a GSP.
// Field names follow the GSTN offline-tool GSTR-1 JSON and the e-invoice (IRP) schema version 1.1 as understood when this was
// written. Where a name or format is not certain it is listed in UNCERTAIN below (shown in the UI with every export) and marked
// "UNSURE" in a comment beside it. Verify against the current GSTN offline tool / e-invoice schema before uploading anything.
import { D } from "./accounting.js";
import type { Decimal } from "decimal.js";
import type { Queryable, Row } from "./db.js";
import { one } from "./db.js";

export const DRAFT_NOTE = "Working draft for accountant review — not filed";

export const UNCERTAIN = [
  "GSTR-1 JSON: top-level 'version' and 'hash' keys are omitted; the offline tool may expect them (e.g. version \"GST3.x\").",
  "GSTR-1 JSON: itms[].num is a running serial (1, 2, 3…). Some tools emit rate-coded numbers (e.g. 1801); check what the offline tool accepts.",
  "GSTR-1 JSON: dates (idt, nt_dt) are DD-MM-YYYY. CSVs use the same format; the offline-tool Excel template expects dd-mmm-yy.",
  "GSTR-1 CDNR/CDNUR: the original invoice number/date are not part of the current note JSON (removed in the revised format) — they are kept in the CSV only.",
  "GSTR-1 EXP: 'rt' for exports under LUT (WOPAY) carries the line's GST rate with iamt 0; shipping bill fields (sbpcode, sbnum, sbdt) are left blank because this build does not record them.",
  "GSTR-1 B2CS: credit and sales debit notes to unregistered recipients (other than B2CL/exports) are netted into B2CS by place of supply and rate; a negative net row may be rejected and needs manual adjustment.",
  "GSTR-1 HSN: split into hsn_b2b / hsn_b2c (the 2025 Phase-III format). UQC is 'NA' for SAC codes (starting 99) and 'OTH' otherwise, because document lines do not store a unit code.",
  "GSTR-1 Documents issued (Table 13): doc_num 1 = invoices for outward supply, 2 = invoices for inward supply from unregistered persons (self-invoices), 4 = debit notes, 5 = credit notes.",
  "GSTR-1 B2CL threshold: the default 2,50,000 comes from this build's settings; the limit for invoices issued from 1 August 2024 was reduced to 1,00,000 (Notification 12/2024-CT). Confirm and set it in Settings.",
  "GSTR-1 NIL: payment receipts (non-GST documents) and Outside-GST invoices are reported as non-GST supplies (ngsup_amt).",
  "GSTR-3B 4(A)/4(B): ITC on bills marked 'ITC blocked' is shown in 4(A) and reversed in 4(B)(1), following the post-2022 presentation; 4(D) and 4(B)(2) are not computed.",
  "GSTR-3B 5: inward bills with no GST charged cannot be told apart as exempt/nil/composition or non-GST, so all are shown as exempt/nil/composition.",
  "Place-of-supply code 96 (foreign country) is used for exports; 97 is 'Other Territory'.",
  "E-invoice: Buyer Pin and Loc are taken from the address text (a 6-digit PIN and the last address line); Unit is 'NOS' for goods and omitted for services; IsServc is 'Y' when the HSN/SAC starts with 99.",
  "E-invoice: SupTyp for exports is EXPWP/EXPWOP and for SEZ recipients SEZWP/SEZWOP (a zero-rated invoice to a GSTIN holder is treated as a SEZ supply). Exports use Gstin \"URP\", Pos/Stcd 96 and Pin 999999; ExpDtls.CntCode (country) is left blank because this build does not record it.",
  "Reports use each document's current status: a sales debit note cancelled after its month is excluded from that month's working."
];

export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "96": "Foreign Country", "97": "Other Territory"
};

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const Z = () => new D(0);
const m2 = (v: Decimal) => v.toFixed(2);
// JSON exports carry numbers; values are produced from exact decimals rounded to paise, never from float arithmetic.
const n2 = (v: Decimal | string) => Number(new D(v).toFixed(2));
const gstinOf = (d: Row) => String(d.client_snapshot?.gstin || "").trim().toUpperCase();
const ddmmyyyy = (iso: string, sep = "-") => { const [y, m, d] = iso.slice(0, 10).split("-"); return d + sep + m + sep + y; };

export function periodRange(period: string) {
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(period)) throw new Error("Return period must be MMYYYY.");
  const m = Number(period.slice(0, 2)), y = Number(period.slice(2));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = y + "-" + String(m).padStart(2, "0");
  return { from: month + "-01", to: month + "-" + String(last).padStart(2, "0"), month };
}

type Tax = { txval: Decimal; iamt: Decimal; camt: Decimal; samt: Decimal; csamt: Decimal };
const zeroTax = (): Tax => ({ txval: Z(), iamt: Z(), camt: Z(), samt: Z(), csamt: Z() });
const addTax = (a: Tax, b: Tax, sign = 1) => {
  a.txval = a.txval.add(b.txval.mul(sign)); a.iamt = a.iamt.add(b.iamt.mul(sign));
  a.camt = a.camt.add(b.camt.mul(sign)); a.samt = a.samt.add(b.samt.mul(sign)); a.csamt = a.csamt.add(b.csamt.mul(sign));
  return a;
};
const taxJson = (t: Tax) => ({ txval: n2(t.txval), iamt: n2(t.iamt), camt: n2(t.camt), samt: n2(t.samt), csamt: n2(t.csamt) });
const taxText = (t: Tax) => ({ txval: m2(t.txval), iamt: m2(t.iamt), camt: m2(t.camt), samt: m2(t.samt), csamt: m2(t.csamt) });

// One document line in INR, split the same way the ledger splits it (half of each line's tax to CGST, the rest to SGST).
function lineTax(l: Row, interstate: boolean): Tax {
  const txval = new D(l.baseInr ?? l.base), tax = new D(l.taxInr ?? l.tax ?? 0);
  if (interstate) return { txval, iamt: tax, camt: Z(), samt: Z(), csamt: Z() };
  const camt = tax.div(2).toDP(2);
  return { txval, iamt: Z(), camt, samt: tax.sub(camt), csamt: Z() };
}
// Rate-wise item rows of a document (GSTR-1 itms[] are per rate, not per line).
function rateWise(d: Row) {
  const byRate = new Map<string, Tax>();
  for (const l of d.lines as Row[]) {
    const rt = new D(l.taxRate || 0).toString();
    byRate.set(rt, addTax(byRate.get(rt) || zeroTax(), lineTax(l, d.interstate)));
  }
  return [...byRate.entries()].sort((a, b) => new D(a[0]).cmp(b[0])).map(([rt, t]) => ({ rt, ...t }));
}
const docTax = (d: Row) => rateWise(d).reduce((s, r) => addTax(s, r), zeroTax());
const valueOf = (d: Row) => new D(d.total_inr ?? d.total);

// Where an outward document belongs in GSTR-1, judged from the invoice (a note is judged by its original invoice).
type Bucket = "B2B" | "B2CL" | "B2CS" | "EXP" | "NIL";
function bucketOf(inv: Row, threshold: Decimal): Bucket {
  const registered = GSTIN.test(gstinOf(inv));
  if (inv.kind === "BILL" || ["NIL_RATED", "EXEMPT", "OUTSIDE_GST"].includes(inv.tax_treatment)) return "NIL";
  if (inv.tax_treatment === "ZERO_RATED") return registered ? "B2B" : "EXP";
  if (registered) return "B2B";
  return inv.interstate && valueOf(inv).gt(threshold) ? "B2CL" : "B2CS";
}
// B2B invoice type: R = regular; SEZ supplies with / without payment of IGST.
const invType = (inv: Row) => inv.tax_treatment === "ZERO_RATED" ? (inv.zero_rated_type === "WITH_IGST" ? "SEWP" : "SEWOP") : "R";
const expType = (inv: Row) => inv.zero_rated_type === "WITH_IGST" ? "WPAY" : "WOPAY";

export async function buildGstReturns(q: Queryable, period: string) {
  const { from, to, month } = periodRange(period);
  const company = await one(q, "SELECT * FROM company WHERE id='company'");
  const threshold = new D(company.b2cl_threshold || 250000);
  // Outward documents dated in the month. Cancelled ones only matter for the documents-issued count (posted, then cancelled).
  const outward = (await q.query(
    "SELECT d.*,d.issue_date::text,EXISTS(SELECT 1 FROM journal_entries e WHERE e.document_id=d.id) AS posted FROM documents d WHERE d.issue_date BETWEEN $1::date AND $2::date AND d.kind IN ('INVOICE','CREDIT_NOTE','SALES_DEBIT_NOTE','BILL') AND d.status IN ('ISSUED','CANCELLED') ORDER BY d.issue_date,d.number",
    [from, to]
  )).rows;
  const sourceIds = [...new Set(outward.filter(d => d.source_id && d.kind !== "INVOICE").map(d => d.source_id))];
  const sources = new Map<string, Row>((sourceIds.length ? (await q.query("SELECT *,issue_date::text FROM documents WHERE id = ANY($1)", [sourceIds])).rows : []).map(r => [r.id, r]));
  const inward = (await q.query(
    "SELECT d.*,d.issue_date::text,s.reverse_charge AS source_rcm,s.itc_eligible AS source_itc FROM documents d LEFT JOIN documents s ON s.id=d.source_id WHERE d.issue_date BETWEEN $1::date AND $2::date AND d.kind IN ('PURCHASE','DEBIT_NOTE') AND d.status='ISSUED' ORDER BY d.issue_date,d.number",
    [from, to]
  )).rows;

  const live = outward.filter(d => d.status === "ISSUED");
  const b2b = new Map<string, Row[]>(), b2cl = new Map<string, Row[]>(), exp = new Map<string, Row[]>();
  const b2cs = new Map<string, Row>(), cdnr = new Map<string, Row[]>(), cdnur: Row[] = [];
  const nil = new Map<string, { nil: Decimal; expt: Decimal; ngsup: Decimal }>();
  const hsn = { B2B: new Map<string, Row>(), B2C: new Map<string, Row>() };
  const csv: Record<string, Row[]> = { b2b: [], b2cl: [], b2cs: [], exp: [], cdnr: [], cdnur: [], nil: [], hsn_b2b: [], hsn_b2c: [], docs: [] };
  const out31 = { a: zeroTax(), b: zeroTax(), c: zeroTax(), e: zeroTax() };

  for (const d of live) {
    const note = d.kind === "CREDIT_NOTE" || d.kind === "SALES_DEBIT_NOTE";
    const inv = note ? sources.get(d.source_id) || d : d;
    const bucket = bucketOf(inv, threshold), sign = d.kind === "CREDIT_NOTE" ? -1 : 1;
    const items = rateWise(d), tax = docTax(d), gstin = gstinOf(inv), pos = d.place_of_supply;
    // GSTR-3B 3.1: outward supplies by nature, credit notes reduce and sales debit notes add.
    if (d.kind === "BILL" || d.tax_treatment === "OUTSIDE_GST") addTax(out31.e, tax, sign);
    else if (d.tax_treatment === "ZERO_RATED") addTax(out31.b, tax, sign);
    else if (["NIL_RATED", "EXEMPT"].includes(d.tax_treatment)) addTax(out31.c, tax, sign);
    else addTax(out31.a, tax, sign);
    // HSN summary (Table 12): goods and services supplied, notes netted; non-GST supplies are not included.
    if (d.kind !== "BILL" && d.tax_treatment !== "OUTSIDE_GST") {
      const table = GSTIN.test(gstin) ? hsn.B2B : hsn.B2C;
      for (const l of d.lines as Row[]) {
        const code = String(l.hsn || "").trim() || "NOT-ENTERED", rt = new D(l.taxRate || 0).toString(), key = code + "|" + rt;
        const row = table.get(key) || { hsn_sc: code, desc: String(l.description || "").slice(0, 30), uqc: code.startsWith("99") ? "NA" : "OTH", qty: Z(), rt, ...zeroTax() };
        row.qty = row.qty.add(new D(l.quantity || 0).mul(sign));
        addTax(row as any, lineTax(l, d.interstate), sign);
        table.set(key, row);
      }
    }
    if (bucket === "NIL") {
      const key = (d.interstate ? "INTR" : "INTRA") + (GSTIN.test(gstin) ? "B2B" : "B2C");
      const row = nil.get(key) || { nil: Z(), expt: Z(), ngsup: Z() };
      const amount = tax.txval.mul(sign);
      if (d.kind !== "BILL" && d.tax_treatment === "NIL_RATED") row.nil = row.nil.add(amount);
      else if (d.kind !== "BILL" && d.tax_treatment === "EXEMPT") row.expt = row.expt.add(amount);
      else row.ngsup = row.ngsup.add(amount);
      nil.set(key, row);
      continue;
    }
    if (bucket === "B2CS") {
      // B2CS is reported in aggregate by supply type, place of supply and rate; notes to such recipients are netted here.
      for (const it of items) {
        const sply = d.interstate ? "INTER" : "INTRA", key = sply + "|" + pos + "|" + it.rt;
        const row = b2cs.get(key) || { sply_ty: sply, pos, rt: it.rt, ...zeroTax() };
        addTax(row as any, it, sign);
        b2cs.set(key, row);
      }
      continue;
    }
    if (note) {
      const noteRow = {
        ntty: d.kind === "CREDIT_NOTE" ? "C" : "D", nt_num: d.number, nt_dt: ddmmyyyy(d.issue_date), val: valueOf(d), pos, items,
        original: inv.number, originalDate: inv.issue_date ? ddmmyyyy(inv.issue_date) : ""
      };
      if (bucket === "B2B") {
        cdnr.set(gstin, [...(cdnr.get(gstin) || []), { ...noteRow, inv_typ: invType(inv), name: inv.client_snapshot?.name || "" }]);
        for (const it of items) csv.cdnr.push({
          "GSTIN/UIN of Recipient": gstin, "Receiver Name": inv.client_snapshot?.name || "", "Note Number": d.number, "Note Date": noteRow.nt_dt,
          "Note Type": noteRow.ntty, "Place Of Supply": pos + "-" + (STATE_NAMES[pos] || ""), "Reverse Charge": "N", "Note Supply Type": invType(inv) === "R" ? "Regular B2B" : invType(inv),
          "Note Value": m2(noteRow.val), "Rate": it.rt, "Taxable Value": m2(it.txval), "Integrated Tax": m2(it.iamt), "Central Tax": m2(it.camt), "State/UT Tax": m2(it.samt), "Cess Amount": "0.00",
          "Original Invoice Number": inv.number, "Original Invoice Date": noteRow.originalDate
        });
      }
      else {
        const typ = bucket === "B2CL" ? "B2CL" : inv.zero_rated_type === "WITH_IGST" ? "EXPWP" : "EXPWOP";
        cdnur.push({ ...noteRow, typ });
        for (const it of items) csv.cdnur.push({
          "UR Type": typ, "Note Number": d.number, "Note Date": noteRow.nt_dt, "Note Type": noteRow.ntty,
          "Place Of Supply": typ === "B2CL" ? pos + "-" + (STATE_NAMES[pos] || "") : "", "Note Value": m2(noteRow.val), "Rate": it.rt,
          "Taxable Value": m2(it.txval), "Integrated Tax": m2(it.iamt), "Cess Amount": "0.00", "Original Invoice Number": inv.number, "Original Invoice Date": noteRow.originalDate
        });
      }
      continue;
    }
    const invRow = { inum: d.number, idt: ddmmyyyy(d.issue_date), val: valueOf(d), pos, items, name: d.client_snapshot?.name || "" };
    if (bucket === "B2B") {
      b2b.set(gstin, [...(b2b.get(gstin) || []), { ...invRow, inv_typ: invType(d) }]);
      for (const it of items) csv.b2b.push({
        "GSTIN/UIN of Recipient": gstin, "Receiver Name": invRow.name, "Invoice Number": d.number, "Invoice date": invRow.idt,
        "Invoice Value": m2(invRow.val), "Place Of Supply": pos + "-" + (STATE_NAMES[pos] || ""), "Reverse Charge": "N", "Invoice Type": invType(d) === "R" ? "Regular B2B" : invType(d),
        "Rate": it.rt, "Taxable Value": m2(it.txval), "Integrated Tax": m2(it.iamt), "Central Tax": m2(it.camt), "State/UT Tax": m2(it.samt), "Cess Amount": "0.00"
      });
    }
    else if (bucket === "B2CL") {
      b2cl.set(pos, [...(b2cl.get(pos) || []), invRow]);
      for (const it of items) csv.b2cl.push({
        "Invoice Number": d.number, "Invoice date": invRow.idt, "Invoice Value": m2(invRow.val), "Place Of Supply": pos + "-" + (STATE_NAMES[pos] || ""),
        "Rate": it.rt, "Taxable Value": m2(it.txval), "Integrated Tax": m2(it.iamt), "Cess Amount": "0.00"
      });
    }
    else {
      const t = expType(d);
      exp.set(t, [...(exp.get(t) || []), invRow]);
      for (const it of items) csv.exp.push({
        "Export Type": t, "Invoice Number": d.number, "Invoice date": invRow.idt, "Invoice Value": m2(invRow.val),
        "Port Code": "", "Shipping Bill Number": "", "Shipping Bill Date": "", "Rate": it.rt, "Taxable Value": m2(it.txval), "Integrated Tax": m2(it.iamt), "Cess Amount": "0.00"
      });
    }
  }
  for (const r of b2cs.values()) csv.b2cs.push({
    "Type": "OE", "Place Of Supply": r.pos + "-" + (STATE_NAMES[r.pos] || ""), "Supply Type": r.sply_ty, "Rate": r.rt,
    "Taxable Value": m2(r.txval), "Integrated Tax": m2(r.iamt), "Central Tax": m2(r.camt), "State/UT Tax": m2(r.samt), "Cess Amount": "0.00"
  });
  const nilKinds = ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"];
  const nilRows = nilKinds.map(k => ({ sply_ty: k, ...(nil.get(k) || { nil: Z(), expt: Z(), ngsup: Z() }) }));
  for (const r of nilRows) csv.nil.push({
    "Description": ({ INTRB2B: "Inter-State supplies to registered persons", INTRAB2B: "Intra-State supplies to registered persons", INTRB2C: "Inter-State supplies to unregistered persons", INTRAB2C: "Intra-State supplies to unregistered persons" } as Row)[r.sply_ty],
    "Nil Rated Supplies": m2(r.nil), "Exempted (other than nil rated/non-GST supply)": m2(r.expt), "Non-GST Supplies": m2(r.ngsup)
  });
  const hsnRows = (table: Map<string, Row>) => [...table.values()].sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || new D(a.rt).cmp(b.rt));
  for (const [key, table] of [["hsn_b2b", hsn.B2B], ["hsn_b2c", hsn.B2C]] as const)
    for (const r of hsnRows(table)) csv[key].push({
      "HSN": r.hsn_sc, "Description": r.desc, "UQC": r.uqc, "Total Quantity": r.qty.toString(), "Rate": r.rt,
      "Taxable Value": m2(r.txval), "Integrated Tax Amount": m2(r.iamt), "Central Tax Amount": m2(r.camt), "State/UT Tax Amount": m2(r.samt), "Cess Amount": "0.00"
    });

  // Documents issued in the month (Table 13), per series. A series is the number up to its last "/" or "-".
  const series = (num: string) => num.replace(/[/-][^/-]*$/, "") || num;
  const selfInvoices = inward.filter(d => d.kind === "PURCHASE" && d.self_invoice_number).map(d => ({ number: d.self_invoice_number, cancelled: false }));
  const docGroups: [number, string, { number: string; cancelled: boolean }[]][] = [
    [1, "Invoices for outward supply", outward.filter(d => d.kind === "INVOICE" && d.posted).map(d => ({ number: d.number, cancelled: d.status === "CANCELLED" }))],
    [2, "Invoices for inward supply from unregistered person", selfInvoices],
    [4, "Debit Note", outward.filter(d => d.kind === "SALES_DEBIT_NOTE" && d.posted).map(d => ({ number: d.number, cancelled: d.status === "CANCELLED" }))],
    [5, "Credit Note", outward.filter(d => d.kind === "CREDIT_NOTE" && d.posted).map(d => ({ number: d.number, cancelled: d.status === "CANCELLED" }))]
  ];
  const docDetail = docGroups.filter(([, , list]) => list.length).map(([docNum, nature, list]) => {
    const bySeries = new Map<string, { number: string; cancelled: boolean }[]>();
    for (const x of list) bySeries.set(series(x.number), [...(bySeries.get(series(x.number)) || []), x]);
    const docs = [...bySeries.values()].map(xs => {
      const sorted = xs.map(x => x.number).sort();
      const cancel = xs.filter(x => x.cancelled).length;
      return { from: sorted[0], to: sorted.at(-1)!, totnum: xs.length, cancel, net_issue: xs.length - cancel };
    });
    for (const s of docs) csv.docs.push({ "Nature of Document": nature, "Sr. No. From": s.from, "Sr. No. To": s.to, "Total Number": s.totnum, "Cancelled": s.cancel });
    return { doc_num: docNum, nature, docs };
  });

  // ---- GSTR-3B ----
  // 3.1(d) inward supplies liable to reverse charge, and Table 4 ITC, from posted vendor bills less purchase debit notes.
  const rcm31d = zeroTax(), itc = { rcm: zeroTax(), other: zeroTax(), blocked: zeroTax() };
  const exemptInward = { inter: Z(), intra: Z() };
  for (const d of inward) {
    const sign = d.kind === "DEBIT_NOTE" ? -1 : 1;
    const rcm = d.kind === "DEBIT_NOTE" ? d.source_rcm === true : d.reverse_charge === true;
    const eligible = d.kind === "DEBIT_NOTE" ? d.source_itc !== false : d.itc_eligible !== false;
    if (d.tax_treatment !== "TAXABLE") {
      if (d.interstate) exemptInward.inter = exemptInward.inter.add(new D(d.subtotal).mul(sign));
      else exemptInward.intra = exemptInward.intra.add(new D(d.subtotal).mul(sign));
      continue;
    }
    const t = docTax(d);
    if (rcm) addTax(rcm31d, t, sign);
    const credit = { ...t, txval: Z() };
    addTax(rcm ? itc.rcm : itc.other, credit, sign);
    if (!eligible) addTax(itc.blocked, credit, sign);
  }
  const itcAvailable = addTax(addTax(zeroTax(), itc.rcm), itc.other);
  const itcNet = addTax(addTax(zeroTax(), itcAvailable), itc.blocked, -1);
  const liability = { igst: out31.a.iamt.add(out31.b.iamt), cgst: out31.a.camt, sgst: out31.a.samt };
  const setoff = setOff(liability, { igst: itcNet.iamt, cgst: itcNet.camt, sgst: itcNet.samt });

  const gstr3b = {
    "3.1(a)": taxText(out31.a), "3.1(b)": taxText(out31.b), "3.1(c)": taxText(out31.c), "3.1(d)": taxText(rcm31d), "3.1(e)": taxText(out31.e),
    "4(A)(3)": taxText(itc.rcm), "4(A)(5)": taxText(itc.other), "4(A)": taxText(itcAvailable), "4(B)(1)": taxText(itc.blocked), "4(C)": taxText(itcNet),
    "5": { inter: m2(exemptInward.inter), intra: m2(exemptInward.intra) },
    setoff,
    // RCM tax cannot be paid from ITC; it is paid in cash (and then claimed as ITC in 4(A)(3) when eligible).
    rcmCash: { igst: m2(rcm31d.iamt), cgst: m2(rcm31d.camt), sgst: m2(rcm31d.samt) }
  };

  const itemsJson = (items: Row[], withCgst = true) => items.map((it, i) => ({
    num: i + 1, // UNSURE: running serial vs rate-coded
    itm_det: withCgst ? { rt: n2(it.rt), ...taxJson(it as Tax) } : { rt: n2(it.rt), txval: n2(it.txval), iamt: n2(it.iamt), csamt: n2(it.csamt) }
  }));
  const json: Row = {
    gstin: company.gstin || "", // supplier GSTIN
    fp: period, // return period MMYYYY
    b2b: [...b2b.entries()].map(([ctin, invs]) => ({
      ctin, // recipient GSTIN
      inv: invs.map(v => ({ inum: v.inum, idt: v.idt, val: n2(v.val), pos: v.pos, rchrg: "N", inv_typ: v.inv_typ, itms: itemsJson(v.items) }))
    })),
    b2cl: [...b2cl.entries()].map(([pos, invs]) => ({ pos, inv: invs.map(v => ({ inum: v.inum, idt: v.idt, val: n2(v.val), itms: itemsJson(v.items, false) })) })),
    b2cs: [...b2cs.values()].map(r => ({ sply_ty: r.sply_ty, pos: r.pos, typ: "OE", rt: n2(r.rt), txval: n2(r.txval), iamt: n2(r.iamt), camt: n2(r.camt), samt: n2(r.samt), csamt: n2(r.csamt) })),
    exp: [...exp.entries()].map(([exp_typ, invs]) => ({
      exp_typ, // WPAY = with payment of IGST, WOPAY = under LUT/bond
      inv: invs.map(v => ({ inum: v.inum, idt: v.idt, val: n2(v.val), sbpcode: "", sbnum: "", sbdt: "", itms: v.items.map((it: Row) => ({ rt: n2(it.rt), txval: n2(it.txval), iamt: n2(it.iamt), csamt: 0 })) }))
    })),
    cdnr: [...cdnr.entries()].map(([ctin, nts]) => ({
      ctin, nt: nts.map(v => ({ ntty: v.ntty, nt_num: v.nt_num, nt_dt: v.nt_dt, val: n2(v.val), pos: v.pos, rchrg: "N", inv_typ: v.inv_typ, itms: itemsJson(v.items) }))
    })),
    cdnur: cdnur.map(v => ({ typ: v.typ, ntty: v.ntty, nt_num: v.nt_num, nt_dt: v.nt_dt, val: n2(v.val), ...(v.typ === "B2CL" ? { pos: v.pos } : {}), itms: itemsJson(v.items, false) })),
    nil: { inv: nilRows.map(r => ({ sply_ty: r.sply_ty, nil_amt: n2(r.nil), expt_amt: n2(r.expt), ngsup_amt: n2(r.ngsup) })) },
    hsn: Object.fromEntries((["hsn_b2b", "hsn_b2c"] as const).map(k => [k, hsnRows(k === "hsn_b2b" ? hsn.B2B : hsn.B2C).map((r, i) => ({
      num: i + 1, hsn_sc: r.hsn_sc, desc: r.desc, uqc: r.uqc, qty: Number(r.qty.toString()), rt: n2(r.rt), ...taxJson(r as any)
    }))])),
    doc_issue: { doc_det: docDetail.map(g => ({ doc_num: g.doc_num, docs: g.docs.map((s, i) => ({ num: i + 1, from: s.from, to: s.to, totnum: s.totnum, cancel: s.cancel, net_issue: s.net_issue })) })) }
  };
  const sectionTotals = (rows: Row[]) => rows.reduce((t: Tax, r: Row) => addTax(t, { txval: new D(r["Taxable Value"] || 0), iamt: new D(r["Integrated Tax"] || r["Integrated Tax Amount"] || 0), camt: new D(r["Central Tax"] || r["Central Tax Amount"] || 0), samt: new D(r["State/UT Tax"] || r["State/UT Tax Amount"] || 0), csamt: Z() }), zeroTax());
  return {
    period, month, from, to, note: DRAFT_NOTE, uncertain: UNCERTAIN,
    company: { name: company.name, gstin: company.gstin || "", b2clThreshold: m2(threshold) },
    gstr1: {
      totals: Object.fromEntries(["b2b", "b2cl", "b2cs", "exp", "cdnr", "cdnur", "hsn_b2b", "hsn_b2c"].map(k => [k, taxText(sectionTotals(csv[k]))])),
      csv,
      docs: docDetail
    },
    gstr3b,
    json: { ...json, _note: DRAFT_NOTE }
  };
}

// GST set-off of output liability with ITC (CGST Act s.49 and rule 88A):
//   IGST credit is used first against IGST, and must be exhausted before CGST/SGST credit; any balance goes to CGST and then
//   SGST — first to the part each cannot cover from its own credit, then to the rest. CGST credit goes against CGST, then
//   IGST; SGST credit against SGST, then IGST. CGST credit is never used against SGST or vice versa.
export function setOff(
  liability: { igst: Decimal; cgst: Decimal; sgst: Decimal },
  credit: { igst: Decimal; cgst: Decimal; sgst: Decimal }
) {
  const due = { igst: D.max(liability.igst, 0), cgst: D.max(liability.cgst, 0), sgst: D.max(liability.sgst, 0) };
  const left = { igst: D.max(credit.igst, 0), cgst: D.max(credit.cgst, 0), sgst: D.max(credit.sgst, 0) };
  const used: Record<string, Record<string, Decimal>> = {
    igst: { igst: Z(), cgst: Z(), sgst: Z() }, cgst: { igst: Z(), cgst: Z(), sgst: Z() }, sgst: { igst: Z(), cgst: Z(), sgst: Z() }
  };
  const use = (from: "igst" | "cgst" | "sgst", against: "igst" | "cgst" | "sgst", cap?: Decimal) => {
    const take = D.min(left[from], due[against], cap ?? due[against]);
    if (take.lte(0)) return;
    left[from] = left[from].sub(take); due[against] = due[against].sub(take); used[from][against] = used[from][against].add(take);
  };
  use("igst", "igst");
  // Shortfalls CGST/SGST credit cannot cover; IGST credit covers those first so no own credit is stranded.
  use("igst", "cgst", D.max(due.cgst.sub(left.cgst), 0));
  use("igst", "sgst", D.max(due.sgst.sub(left.sgst), 0));
  use("igst", "cgst");
  use("igst", "sgst");
  use("cgst", "cgst"); use("cgst", "igst");
  use("sgst", "sgst"); use("sgst", "igst");
  return (["igst", "cgst", "sgst"] as const).map(head => ({
    head: head.toUpperCase(), liability: m2(D.max(liability[head], 0)),
    paidIgst: m2(used.igst[head]), paidCgst: m2(used.cgst[head]), paidSgst: m2(used.sgst[head]),
    cash: m2(due[head]), creditLeft: m2(left[head])
  }));
}

// ---- E-invoice (IRP) JSON, schema version 1.1 — preparation only; upload it on the IRP/GSP portal yourself. ----
const pinOf = (address: string) => Number(String(address || "").match(/\b(\d{6})\b/)?.[1] || 0) || null;
const lastLine = (address: string) => String(address || "").split(/\r?\n|,/).map(s => s.trim()).filter(Boolean).at(-1) || "";
export function buildEinvoice(d: Row, companyRow: Row) {
  const company = { ...companyRow, ...(d.snapshot?.company || d.company_snapshot || {}) };
  const buyer = d.snapshot?.party || d.client_snapshot || {};
  const buyerGstin = String(buyer.gstin || "").trim().toUpperCase();
  const issues: string[] = [];
  const zero = d.tax_treatment === "ZERO_RATED", registered = GSTIN.test(buyerGstin), exportSupply = zero && !registered;
  if (!["INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE"].includes(d.kind) || d.status !== "ISSUED") issues.push("Only issued invoices and notes can be e-invoiced.");
  if (!registered && !exportSupply) issues.push("The recipient has no valid GSTIN: e-invoicing applies to B2B, SEZ and export supplies.");
  if (!["TAXABLE", "ZERO_RATED"].includes(d.tax_treatment)) issues.push("Only taxable and zero-rated supplies are e-invoiced.");
  if (!GSTIN.test(String(company.gstin || ""))) issues.push("The company GSTIN in Settings is missing or invalid.");
  // Exports to an unregistered foreign buyer use GSTIN "URP", state code 96 and PIN 999999 (UNSURE: confirm against the schema notes).
  const supTyp = exportSupply ? (d.zero_rated_type === "WITH_IGST" ? "EXPWP" : "EXPWOP") : zero ? (d.zero_rated_type === "WITH_IGST" ? "SEZWP" : "SEZWOP") : "B2B";
  const sellerPin = Number(String(company.pin_code || "").trim()) || pinOf(company.address);
  const buyerPin = exportSupply ? 999999 : pinOf(buyer.address);
  if (!sellerPin) issues.push("Add the company PIN code in Settings (SellerDtls.Pin).");
  if (!buyerPin) issues.push("The recipient address has no 6-digit PIN code (BuyerDtls.Pin).");
  if ((d.lines as Row[]).some(l => !String(l.hsn || "").trim())) issues.push("Every line needs an HSN/SAC code (ItemList.HsnCd).");
  let ass = Z(), cg = Z(), sg = Z(), ig = Z();
  const items = (d.lines as Row[]).map((l, i) => {
    const t = lineTax(l, d.interstate);
    ass = ass.add(t.txval); cg = cg.add(t.camt); sg = sg.add(t.samt); ig = ig.add(t.iamt);
    const service = String(l.hsn || "").startsWith("99");
    return {
      SlNo: String(i + 1), PrdDesc: String(l.description || "").slice(0, 300), IsServc: service ? "Y" : "N", HsnCd: String(l.hsn || ""),
      Qty: Number(l.quantity), ...(service ? {} : { Unit: "NOS" }), UnitPrice: n2(new D(l.price).mul(d.exchange_rate || 1)),
      TotAmt: n2(t.txval), Discount: 0, AssAmt: n2(t.txval), GstRt: n2(l.taxRate || 0),
      IgstAmt: n2(t.iamt), CgstAmt: n2(t.camt), SgstAmt: n2(t.samt), CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0,
      StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0, OthChrg: 0, TotItemVal: n2(t.txval.add(t.iamt).add(t.camt).add(t.samt))
    };
  });
  const json = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supTyp, RegRev: "N", EcmGstin: null, IgstOnIntra: "N" },
    DocDtls: { Typ: d.kind === "CREDIT_NOTE" ? "CRN" : d.kind === "SALES_DEBIT_NOTE" ? "DBN" : "INV", No: d.number, Dt: ddmmyyyy(d.issue_date, "/") },
    SellerDtls: {
      Gstin: company.gstin || "", LglNm: company.name || "", TrdNm: company.name || "", Addr1: String(company.address || "").slice(0, 100),
      ...(company.address_line2 ? { Addr2: String(company.address_line2).slice(0, 100) } : {}), Loc: company.city || lastLine(company.address),
      Pin: sellerPin, Stcd: String(company.state_code || ""), ...(company.contact_number ? { Ph: String(company.contact_number).replace(/\D/g, "").slice(0, 12) } : {})
    },
    BuyerDtls: {
      Gstin: exportSupply ? "URP" : buyerGstin, LglNm: buyer.name || "", TrdNm: buyer.name || "", Pos: exportSupply ? "96" : d.place_of_supply,
      Addr1: String(buyer.address || "").split(/\r?\n/)[0].slice(0, 100), Loc: lastLine(buyer.address), Pin: buyerPin, Stcd: exportSupply ? "96" : buyerGstin.slice(0, 2),
      ...(buyer.phone ? { Ph: String(buyer.phone).replace(/\D/g, "").slice(0, 12) } : {}), ...(buyer.email ? { Em: buyer.email } : {})
    },
    ItemList: items,
    ValDtls: {
      AssVal: n2(ass), CgstVal: n2(cg), SgstVal: n2(sg), IgstVal: n2(ig), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0,
      TotInvVal: n2(ass.add(cg).add(sg).add(ig)), ...(d.currency !== "INR" ? { TotInvValFc: n2(d.total) } : {})
    },
    // Export details: shipping bill and port are not recorded in this build (UNSURE whether the IRP requires them for services).
    ...(exportSupply ? { ExpDtls: { ForCur: d.currency, CntCode: "" } } : {})
  };
  return { json, issues, note: DRAFT_NOTE, uncertain: UNCERTAIN.filter(u => u.startsWith("E-invoice") || u.startsWith("Place")) };
}
