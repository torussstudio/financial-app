import { Decimal } from "decimal.js";
import { randomUUID, createHash } from "node:crypto";
import type { Database, Queryable } from "./db.js";
import { one } from "./db.js";
export const D = Decimal;
export type D = Decimal;
export const id = () => randomUUID();
export const money = (v: Decimal.Value) => new D(v).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
export function need(ok: any, message: string, status = 400): asserts ok { if (!ok)
  throw new AppError(status, message); }
export type Actor = {
  id: string;
  role: string;
  name?: string;
  email?: string
};
export async function audit(
  q: Queryable,
  actor: Actor,
  action: string,
  entity: string,
  detail: unknown = {}
) {
  await q.query(
    "INSERT INTO audit_events(id,actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)",
    [id(), actor.id, action, entity, JSON.stringify(detail)]
  );
}
export const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "Asia/Kolkata";
export const businessToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
export function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
// Posting documents (invoices, payment receipts) receive their series number only when issued, so abandoned drafts leave no gaps.
export const DRAFT_PREFIX = "DRAFT-";
// Each kind has its own number series per financial year (see nextFreeNumber).
const DOCUMENT_PREFIX: Record<string, string> = {
  QUOTATION: "QT", PROFORMA: "PF", INVOICE: "INV", BILL: "BILL", PURCHASE: "PB", CREDIT_NOTE: "CN", DEBIT_NOTE: "DN", SALES_DEBIT_NOTE: "SDN"
};
// PURCHASE is a vendor bill: it is numbered and posted (expense/asset + input tax against accounts payable) when issued.
const POSTING_DOCUMENTS = ["INVOICE", "BILL", "PURCHASE"];
const OUTPUT_TAX = { cgst: "2100", sgst: "2110", igst: "2120" }, INPUT_TAX = { cgst: "1200", sgst: "1210", igst: "1220" };
// Reverse charge: tax the company owes on a supplier's bill. It is paid in cash and cannot be set off against ITC.
export const RCM_TAX = { cgst: "2130", sgst: "2140", igst: "2150" };
export const CLIENT_ADVANCES = "2300", VENDOR_ADVANCES = "1300", RECEIVABLES = "1100", PAYABLES = "2000";
export const TDS_RECEIVABLE = "1250", TDS_PAYABLE = "2400", FX_GAIN = "4200", FX_LOSS = "5700";
// Documents a client receipt can settle: invoices and sales debit notes (an under-charge billed separately).
export const RECEIVABLE_KINDS = ["INVOICE", "SALES_DEBIT_NOTE"];
export const TDS_SECTIONS = ["194C", "194J", "194I", "194H", "194Q", "OTHER"] as const;
// GST is charged on taxable supplies and on zero-rated supplies made on payment of IGST (the refund route).
export const charged = (treatment: string, zeroRatedType?: string | null) =>
  treatment === "TAXABLE" || (treatment === "ZERO_RATED" && zeroRatedType === "WITH_IGST");
export function fiscalYear(date: string) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return String(start).slice(2) + String(start + 1).slice(2);
}
export async function number(
  q: Queryable,
  prefix: string,
  date: string
) {
  const fy = fiscalYear(date);
  const r = await one(
    q,
    "INSERT INTO sequences(prefix,fy,next_value) VALUES($1,$2,2) ON CONFLICT(prefix,fy) DO UPDATE SET next_value=sequences.next_value+1 RETURNING next_value-1 AS n",
    [prefix, fy]
  );
  return prefix + "/" + fy + "/" + String(r.n).padStart(5, "0");
}
// Skips sequence values already taken by a manually entered number instead of failing on them forever.
async function nextFreeNumber(
  q: Queryable,
  prefix: string,
  date: string,
  table: "documents" | "journal_entries",
  column: "number" | "self_invoice_number" = "number"
) {
  for (;;) {
    const candidate = await number(q, prefix, date);
    if (!(await one(q, `SELECT id FROM ${table} WHERE ${column}=$1`, [candidate])))
      return candidate;
  }
}
export async function periodOpen(
  q: Queryable,
  date: string
) {
  const c = await one(q, "SELECT closed_through::text FROM company WHERE id='company' FOR UPDATE");
  need(!c?.closed_through || date > c.closed_through, "This accounting period is closed.", 409);
}
export async function writeJournal(
  q: Queryable,
  actor: Actor,
  input: {
  date: string;
  kind: string;
  description: string;
  partyId?: string | null;
  partySnapshot?: any;
  projectId?: string | null;
  documentId?: string;
  reversalOf?: string;
  number?: string;
  // TDS particulars (section, rate, challan…) kept with the entry; amounts live on the 1250/2400 lines.
  tds?: Record<string, string> | null;
  lines: {
    account: string;
    debit?: string;
    credit?: string
  }[]
}
) {
  await periodOpen(q, input.date);
  let debit = new D(0), credit = new D(0);
  for (const l of input.lines) {
    const d = new D(l.debit || 0), c = new D(l.credit || 0);
    need(
      d.gte(0) && c.gte(0) && d.eq(d.toDP(2)) && c.eq(c.toDP(2)) && ((d.gt(0) && c.eq(0)) || (c.gt(0) && d.eq(0))),
      "Each line needs one positive debit or credit, with at most two decimals."
    );
    debit = debit.add(d);
    credit = credit.add(c);
  }
  need(input.lines.length >= 2 && debit.eq(credit), "Journal is not balanced.");
  const baseParty = input.partyId ? await one(q, "SELECT * FROM parties WHERE id=$1", [input.partyId]) : null;
  const snapshot = ["RECEIPT", "PAYMENT"].includes(input.kind) ? {
    company: await one(q, "SELECT * FROM company"),
    party: baseParty ? (input.partySnapshot ? { ...baseParty, ...input.partySnapshot } : baseParty) : null
  } : null;
  const entryId = id();
  let entryNumber: string;
  if (input.number) {
    entryNumber = input.number.trim();
    need(entryNumber.length > 0, "Receipt number is required.");
    await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["entry-number:" + entryNumber]);
    need(
      !(await one(q, "SELECT id FROM journal_entries WHERE number=$1", [entryNumber])),
      "This receipt number is already in use.",
      409
    );
  }
  else
    entryNumber = await nextFreeNumber(q, "JV", input.date, "journal_entries");
  await q.query(
    "INSERT INTO journal_entries(id,number,entry_date,kind,description,party_id,project_id,document_id,reversal_of,created_by,snapshot,tds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
    entryId,
    entryNumber,
    input.date,
    input.kind,
    input.description,
    input.partyId || null,
    input.projectId || null,
    input.documentId || null,
    input.reversalOf || null,
    actor.id,
    snapshot ? JSON.stringify(snapshot) : null,
    input.tds ? JSON.stringify(input.tds) : null
  ]
  );
  for (const l of input.lines)
    await q.query(
    "INSERT INTO journal_lines(id,entry_id,account_code,debit,credit) VALUES($1,$2,$3,$4,$5)",
    [id(), entryId, l.account, l.debit || "0", l.credit || "0"]
  );
  await audit(
    q,
    actor,
    "journal.post",
    entryId,
    { number: entryNumber, kind: input.kind, amount: debit.toFixed(2) }
  );
  return { id: entryId, number: entryNumber };
}
export async function idempotent<T>(
  db: Database,
  actor: Actor,
  key: string,
  payload: unknown,
  fn: (q: Queryable) => Promise<T>
): Promise<T> {
  need(key && key.length >= 10 && key.length <= 160, "A valid Idempotency-Key header is required.");
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return db.tx(async q => {
    await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const old = await one(q, "SELECT * FROM idempotency WHERE key=$1", [key]);
    if (old) {
      need(
        old.actor_id === actor.id && old.fingerprint === fingerprint,
        "Idempotency key was already used for another request.",
        409
      );
      return old.response;
    }
    const r = await fn(q);
    await q.query(
      "INSERT INTO idempotency(key,actor_id,fingerprint,response) VALUES($1,$2,$3,$4)",
      [key, actor.id, fingerprint, JSON.stringify(r)]
    );
    return r;
  });
}
export async function postVoucher(
  q: Queryable,
  actor: Actor,
  b: any
) {
  const amount = money(b.amount), cash = b.cashAccount || "1000";
  need(new D(amount).gt(0), "Amount must be greater than zero.");
  const ca = await one(q, "SELECT * FROM accounts WHERE code=$1", [cash]);
  need(ca?.is_cash, "Choose a cash or bank account.");
  let debit = cash, credit = "4000";
  switch (b.kind) {
    case "INCOME":
      credit = b.account || "4000";
      break;
    case "EXPENSE":
      debit = b.account || "5100";
      credit = cash;
      break;
    case "REIMBURSEMENT":
      debit = b.account;
      credit = cash;
      break;
    case "ASSET":
      debit = b.account;
      credit = cash;
      break;
    case "CAPITAL_IN":
      credit = "3000";
      break;
    case "CAPITAL_RETURN":
      debit = "3000";
      credit = cash;
      break;
    case "LOAN_IN":
      credit = "2200";
      break;
    case "LOAN_REPAY":
      debit = "2200";
      credit = cash;
      break;
    case "INVESTMENT":
      debit = b.account || "1400";
      credit = cash;
      break;
    case "TRANSFER":
      debit = b.destinationAccount;
      credit = cash;
      need(debit && debit !== cash, "Choose a different destination account.");
      need(
    (await one(q, "SELECT is_cash FROM accounts WHERE code=$1", [debit]))?.is_cash,
    "Destination must be a cash or bank account."
  );
      break;
    default: throw new AppError(400, "Unsupported voucher type.");
  }
  if (["INCOME", "EXPENSE", "REIMBURSEMENT", "ASSET", "INVESTMENT"].includes(b.kind)) {
    const acc = await one(q, "SELECT code,kind,is_cash,voucher_category_kind FROM accounts WHERE code=$1", [b.kind === "INCOME" ? credit : debit]);
    const expectedKind = ["ASSET", "INVESTMENT"].includes(b.kind) ? "ASSET" : b.kind === "REIMBURSEMENT" ? "EXPENSE" : b.kind;
    // Asset vouchers may only use fixed-asset/deposit or investment accounts, never control accounts such as receivables.
    const categoryOk = b.kind === "INVESTMENT" ? acc?.code.startsWith("14") || acc?.voucher_category_kind === "INVESTMENT"
      : b.kind === "ASSET" ? /^1[56]/.test(acc?.code || "") || acc?.voucher_category_kind === "ASSET"
      : true;
    need(acc?.kind === expectedKind && !acc.is_cash && categoryOk, "Account does not match the voucher category.");
  }
  return writeJournal(
    q,
    actor,
    {
    date: b.date,
    kind: b.kind,
    description: b.description,
    partyId: b.partyId,
    projectId: b.projectId,
    lines: [{ account: debit, debit: amount }, { account: credit, credit: amount }]
  }
  );
}
export function calculateDocument(b: any) {
  let subtotal = new D(0), tax = new D(0);
  const lines = b.lines.map((l: any) => {
    const qty = new D(l.quantity), rate = new D(l.price);
    need(qty.gt(0) && rate.gte(0), "Quantity must be positive and price non-negative.");
    const base = qty.mul(rate).toDP(2);
    const percentage = new D(l.taxRate || 0);
    need(percentage.gte(0) && percentage.lte(100), "Invalid tax rate.");
    const appliedPercentage = charged(b.taxTreatment, b.zeroRatedType) ? percentage : new D(0);
    const t = base.mul(appliedPercentage).div(100).toDP(2);
    subtotal = subtotal.add(base);
    tax = tax.add(t);
    return {
      ...l,
      quantity: qty.toString(),
      price: rate.toFixed(2),
      taxRate: percentage.toString(),
      base: base.toFixed(2),
      tax: t.toFixed(2)
    };
  });
  need(subtotal.gt(0), "Document must have a positive subtotal.");
  return { lines, subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: subtotal.add(tax).toFixed(2) };
}
// GST lines split per line like the printed document: output tax for an invoice (credit) or a credit note against it (debit),
// input tax for a vendor bill (debit). Zero components are left out because every journal line must carry an amount.
function taxLines(
  d: Record<string, any>,
  side: "debit" | "credit",
  accounts: { cgst: string; sgst: string; igst: string } = OUTPUT_TAX
) {
  if (!new D(d.tax).gt(0))
    return [];
  if (d.interstate)
    return [{ account: accounts.igst, [side]: new D(d.tax).toFixed(2) }];
  let cgst = new D(0), sgst = new D(0);
  for (const l of d.lines) {
    const half = new D(l.tax || 0).div(2).toDP(2);
    cgst = cgst.add(half);
    sgst = sgst.add(new D(l.tax || 0).sub(half));
  }
  return [{ account: accounts.cgst, [side]: cgst.toFixed(2) }, { account: accounts.sgst, [side]: sgst.toFixed(2) }]
    .filter(l => new D(l[side]).gt(0));
}
const outputTaxLines = (d: Record<string, any>, side: "debit" | "credit") => taxLines(d, side, OUTPUT_TAX);
// INR equivalents of a foreign-currency document at one exchange rate. Each line is converted and rounded to paise, so the
// CGST/SGST split and rate-wise return figures add up to the document's INR totals exactly.
export function toInr(
  sums: { lines: any[] },
  rate: Decimal.Value
) {
  let subtotal = new D(0), tax = new D(0);
  const lines = sums.lines.map(l => {
    const baseInr = new D(l.base).mul(rate).toDP(2, D.ROUND_HALF_UP), taxInr = new D(l.tax || 0).mul(rate).toDP(2, D.ROUND_HALF_UP);
    subtotal = subtotal.add(baseInr);
    tax = tax.add(taxInr);
    return { ...l, baseInr: baseInr.toFixed(2), taxInr: taxInr.toFixed(2) };
  });
  return { lines, subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: subtotal.add(tax).toFixed(2) };
}
// Amounts the ledger posts for a document: the INR equivalents for a foreign-currency document, otherwise its own amounts.
const postedAmounts = (d: Record<string, any>) => d.total_inr != null
  ? { subtotal: d.subtotal_inr, tax: d.tax_inr, total: d.total_inr, lines: (d.lines as any[]).map(l => ({ ...l, tax: l.taxInr })) }
  : { subtotal: d.subtotal, tax: d.tax, total: d.total, lines: d.lines };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// Particulars a live invoice must carry before it is issued (for GST invoices, the tax-invoice details from Settings and the draft).
function checkLiveInvoice(
  d: Record<string, any>,
  company: Record<string, any>
) {
  const client = d.client_snapshot || {}, missing: string[] = [];
  if (!String(company.name || "").trim()) missing.push("company name");
  if (!String(company.address || "").trim()) missing.push("company address");
  if (!String(client.name || "").trim()) missing.push("client name");
  // A zero-rated supply (export, SEZ) is still a GST tax invoice of the registered company.
  if (d.tax_treatment === "TAXABLE" || d.tax_treatment === "ZERO_RATED") {
    const gstin = String(company.gstin || "").trim().toUpperCase(), clientGstin = String(client.gstin || "").trim().toUpperCase();
    need(GSTIN.test(gstin), "Add the company's 15-character GSTIN in Settings before issuing a GST invoice.");
    need(gstin.slice(0, 2) === String(company.state_code || ""), "The company state code in Settings must match the first two digits of its GSTIN.");
    need(!clientGstin || GSTIN.test(clientGstin), "The client GSTIN on this invoice is not a valid 15-character GSTIN.");
    if (!String(client.address || "").trim()) missing.push("client address");
    // B2B invoices (client has a GSTIN) need an HSN/SAC code on every line.
    if (clientGstin && (d.lines as any[]).some(l => !String(l.hsn || "").trim())) missing.push("HSN / SAC on every line");
  }
  need(!missing.length, "Add the " + missing.join(", ") + " before issuing this invoice.");
  // An export without payment of IGST is only valid under a Letter of Undertaking in force on the invoice date.
  if (d.tax_treatment === "ZERO_RATED" && d.zero_rated_type === "LUT") {
    need(String(company.lut_number || "").trim(), "Add the company's LUT / ARN number in Settings before issuing an export invoice under LUT.");
    const issued = String(d.issue_date || "").slice(0, 10), from = company.lut_valid_from ? isoDay(company.lut_valid_from) : "", to = company.lut_valid_to ? isoDay(company.lut_valid_to) : "";
    need((!from || issued >= from) && (!to || issued <= to), "The LUT recorded in Settings is not valid on " + issued + ". Update the LUT details or issue with IGST.");
  }
}
// Dates read from the company row may be Date objects (pg builds them at local midnight, so toISOString() could shift the day
// in IST) or text; read the local calendar date.
const isoDay = (v: any) => v instanceof Date
  ? [v.getFullYear(), String(v.getMonth() + 1).padStart(2, "0"), String(v.getDate()).padStart(2, "0")].join("-")
  : String(v).slice(0, 10);
// Shared by create and edit so a draft can never be edited past the rules enforced at creation.
async function prepareDocument(
  q: Queryable,
  b: any
) {
  const party = await one(q, "SELECT * FROM parties WHERE id=$1", [b.partyId]);
  need(party, "Choose an existing client or vendor.");
  const company = await one(q, "SELECT * FROM company WHERE id='company'");
  need(!party.archived, "This contact is archived. Restore it in Clients & vendors to use it on a document.");
  need(b.dueDate >= b.date, "Due date cannot precede the issue date.");
  const purchase = b.kind === "PURCHASE";
  // On a vendor bill the treatment is what the supplier charged; it needs no separate justification.
  // A zero-rated supply carries its own statutory declaration (LUT or payment of IGST) instead of a free-text reason.
  if (!["TAXABLE", "ZERO_RATED"].includes(b.taxTreatment) && !purchase)
    need(b.taxReason?.trim().length >= 3, "Explain the non-taxable treatment.");
  const zeroRated = b.taxTreatment === "ZERO_RATED";
  if (zeroRated) {
    need(["INVOICE", "QUOTATION", "PROFORMA"].includes(b.kind), "Zero-rated treatment applies to invoices, quotations and proformas.");
    need(["LUT", "WITH_IGST"].includes(b.zeroRatedType), "Choose whether the zero-rated supply is under LUT (no IGST) or with payment of IGST.");
  }
  const reverseCharge = purchase && b.reverseCharge === true;
  need(!b.reverseCharge || purchase, "Reverse charge applies to vendor bills only.");
  if (reverseCharge)
    need(b.taxTreatment === "TAXABLE", "A reverse-charge bill is a taxable supply: enter the GST rates the company must pay.");
  const currency = b.currency || "INR";
  let reference = "";
  if (purchase) {
    need(["VENDOR", "BOTH"].includes(party.kind), "Choose a vendor for a vendor bill.");
    need(currency === "INR", "Vendor bills are recorded in INR.");
    reference = String(b.reference || "").trim();
    need(reference.length > 0, "Enter the supplier's bill number.");
    need(!new D(b.advanceAmount || 0).gt(0), "Record a vendor advance as a payment, not on the bill.");
    const acc = await one(q, "SELECT code,kind,is_cash,voucher_category_kind FROM accounts WHERE code=$1", [b.expenseAccount || "5100"]);
    // A bill is either an operating expense or the purchase of a fixed asset/deposit — never cash, receivables or tax accounts.
    need(
      acc && !acc.is_cash && (acc.kind === "EXPENSE" || (acc.kind === "ASSET" && (/^1[56]/.test(acc.code) || acc.voucher_category_kind === "ASSET"))),
      "Choose an expense or fixed-asset account for the vendor bill."
    );
  }
  let incomeAccount = "4000";
  if (b.kind === "BILL") {
    // A payment receipt records money received from the party: it posts cash/bank against income when issued.
    need(b.taxTreatment !== "TAXABLE", "Payment receipts are non-GST documents. Use a GST invoice for taxable supplies.");
    need(currency === "INR", "Payment receipts are recorded in INR.");
    need(b.paymentMethod, "Choose the mode of payment.");
    incomeAccount = b.incomeAccount || "4000";
    need(
      (await one(q, "SELECT kind FROM accounts WHERE code=$1", [incomeAccount]))?.kind === "INCOME",
      "Choose an income account for the payment receipt."
    );
  }
  const stateKnown = /^\d{2}$/.test(String(company.state_code || "")) && /^\d{2}$/.test(String(b.placeOfSupply || ""));
  need(
    b.taxTreatment !== "TAXABLE" || stateKnown || typeof b.interstate === "boolean",
    "Select CGST + SGST or IGST because supplier state information is unavailable."
  );
  // Exports and supplies to SEZ are inter-state supplies by law (IGST Act s.7(5)), whatever the place-of-supply code.
  const interstate = zeroRated ? true : stateKnown ? b.placeOfSupply !== company.state_code : b.interstate === true;
  const calculated = calculateDocument(b), advance = new D(b.advanceAmount || 0);
  // Under reverse charge the supplier is owed only the taxable value; the tax is the company's own liability.
  const sums = reverseCharge ? { ...calculated, total: calculated.subtotal } : calculated;
  need(advance.gte(0) && advance.lte(sums.total), "Advance paid cannot exceed the document total.");
  need(advance.eq(0) || b.kind !== "BILL", "Payment receipts cannot record an advance.");
  const status = advance.eq(0) ? "NOT_RECEIVED" : advance.eq(sums.total) ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
  need(
    !b.advanceStatus || b.advanceStatus === status,
    "Advance payment status does not match the amount received."
  );
  // Only an invoice posts its advance on issue; on a quotation or proforma it is shown on the document and nothing more.
  const advanceAccount = b.kind === "INVOICE" && advance.gt(0) && b.advanceAccount ? b.advanceAccount : null;
  if (advanceAccount)
    need(
      (await one(q, "SELECT is_cash FROM accounts WHERE code=$1", [advanceAccount]))?.is_cash,
      "Choose the bank or cash account that received the advance."
    );
  const client = {
    name: b.client?.name?.trim() || party.name,
    address: b.client?.address ?? party.address,
    gstin: b.client?.gstin ?? party.gstin,
    contact_name: b.client?.contactName ?? party.contact_name ?? "",
    phone: b.client?.phone ?? party.phone,
    email: party.email
  };
  const companySnapshot = b.company ? { ...b.company, gst_logo: "", non_gst_logo: "" } : null;
  const itcEligible = purchase ? b.itcEligible !== false : true;
  const zeroRatedType = zeroRated ? b.zeroRatedType : null;
  return { party, interstate, sums, currency, advance, status, advanceAccount, incomeAccount, client, companySnapshot, reference, itcEligible, zeroRatedType, reverseCharge };
}
// Friendly duplicate check before the database's unique index: one supplier bill number per vendor.
async function checkVendorReference(
  q: Queryable,
  partyId: string,
  reference: string,
  docId: string
) {
  if (!reference)
    return;
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["vendor-bill:" + partyId + ":" + reference.toLowerCase()]);
  const dup = await one(
    q,
    "SELECT number FROM documents WHERE kind='PURCHASE' AND status<>'CANCELLED' AND party_id=$1 AND lower(reference)=lower($2) AND id<>$3",
    [partyId, reference, docId]
  );
  need(!dup, "Bill " + reference + " from this vendor is already entered (" + dup?.number + ").", 409);
}
async function reserveDocumentNumber(
  q: Queryable,
  num: string,
  docId: string
) {
  need(num.length > 0, "Document number is required.");
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["document-number:" + num]);
  need(
    !(await one(q, "SELECT id FROM documents WHERE number=$1 AND id<>$2", [num, docId])),
    "This document number is already in use.",
    409
  );
}
export async function createDocument(
  q: Queryable,
  actor: Actor,
  b: any
) {
  const p = await prepareDocument(q, b), docId = id();
  const manual = b.number?.trim();
  const num = manual || (POSTING_DOCUMENTS.includes(b.kind)
    ? DRAFT_PREFIX + docId.slice(0, 8).toUpperCase()
    : await nextFreeNumber(q, DOCUMENT_PREFIX[b.kind], b.date, "documents"));
  await reserveDocumentNumber(q, num, docId);
  await checkVendorReference(q, b.partyId, p.reference, docId);
  await q.query(
    "INSERT INTO documents(id,number,kind,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,expense_account,subtotal,tax,total,lines,notes,payment_method,source_id,created_by,currency,advance_amount,advance_status,client_snapshot,company_snapshot,income_account,advance_account,reference,itc_eligible,zero_rated_type,reverse_charge) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)",
    [
    docId,
    num,
    b.kind,
    b.partyId,
    b.projectId || null,
    b.date,
    b.dueDate,
    b.taxTreatment,
    b.taxReason || "",
    b.placeOfSupply,
    p.interstate,
    b.expenseAccount || "5100",
    p.sums.subtotal,
    p.sums.tax,
    p.sums.total,
    JSON.stringify(p.sums.lines),
    b.notes || "",
    b.paymentMethod || null,
    b.sourceId || null,
    actor.id,
    p.currency,
    p.advance.toFixed(2),
    p.status,
    JSON.stringify(p.client),
    p.companySnapshot ? JSON.stringify(p.companySnapshot) : null,
    p.incomeAccount,
    p.advanceAccount,
    p.reference,
    p.itcEligible,
    p.zeroRatedType,
    p.reverseCharge
  ]
  );
  await audit(q, actor, "document.create", docId, { number: num });
  return { id: docId, number: num };
}
export async function updateDocument(
  q: Queryable,
  actor: Actor,
  docId: string,
  b: any
) {
  const d = await one(q, "SELECT * FROM documents WHERE id=$1 FOR UPDATE", [docId]);
  need(d, "Document not found.", 404);
  need(d.status === "DRAFT", "Only draft documents can be edited.", 409);
  need(d.kind === b.kind, "Document type cannot be changed.", 409);
  const p = await prepareDocument(q, b);
  const num = (b.number || d.number).trim();
  await reserveDocumentNumber(q, num, docId);
  await checkVendorReference(q, b.partyId, p.reference, docId);
  await q.query(
    "UPDATE documents SET number=$2,party_id=$3,project_id=$4,issue_date=$5,due_date=$6,tax_treatment=$7,tax_reason=$8,place_of_supply=$9,interstate=$10,expense_account=$11,subtotal=$12,tax=$13,total=$14,lines=$15,notes=$16,payment_method=$17,currency=$18,advance_amount=$19,advance_status=$20,client_snapshot=$21,company_snapshot=$22,income_account=$23,advance_account=$24,reference=$25,itc_eligible=$26,zero_rated_type=$27,reverse_charge=$28 WHERE id=$1",
    [
    docId,
    num,
    b.partyId,
    b.projectId || null,
    b.date,
    b.dueDate,
    b.taxTreatment,
    b.taxReason || "",
    b.placeOfSupply,
    p.interstate,
    b.expenseAccount || "5100",
    p.sums.subtotal,
    p.sums.tax,
    p.sums.total,
    JSON.stringify(p.sums.lines),
    b.notes || "",
    b.paymentMethod || null,
    p.currency,
    p.advance.toFixed(2),
    p.status,
    JSON.stringify(p.client),
    p.companySnapshot ? JSON.stringify(p.companySnapshot) : null,
    p.incomeAccount,
    p.advanceAccount,
    p.reference,
    p.itcEligible,
    p.zeroRatedType,
    p.reverseCharge
  ]
  );
  await audit(q, actor, "document.update", docId, { number: num });
  return { id: docId, number: num };
}
export async function issueDocument(
  q: Queryable,
  actor: Actor,
  docId: string,
  opts: { exchangeRate?: string } = {}
) {
  const d = await one(q, "SELECT *,issue_date::text,due_date::text FROM documents WHERE id=$1 FOR UPDATE", [docId]);
  need(d, "Document not found.", 404);
  if (d.status === "ISSUED")
    return d;
  need(d.status === "DRAFT", "A cancelled document cannot be issued.", 409);
  const companyDefaults = await one(q, "SELECT *,lut_valid_from::text,lut_valid_to::text FROM company WHERE id='company'"),
    company = { ...companyDefaults, ...(d.company_snapshot || {}) },
    party = await one(q, "SELECT * FROM parties WHERE id=$1", [d.party_id]);
  // A live invoice is a legal document, so it must carry the particulars a tax invoice requires; demo books stay permissive.
  if (d.kind === "INVOICE" && !company.demo)
    checkLiveInvoice(d, company);
  const warnings: string[] = [];
  // A foreign-currency invoice posts its INR equivalent at the rate entered on issue (INR per unit, up to 6 decimals).
  if (POSTING_DOCUMENTS.includes(d.kind) && d.currency !== "INR") {
    need(d.kind === "INVOICE", "Only invoices can be issued in a foreign currency.", 409);
    // The advance-on-issue receipt is an INR allocation; a foreign invoice is settled in its own currency instead.
    need(new D(d.advance_amount || 0).eq(0), "Set the advance to zero and record it as a receipt after issuing: foreign-currency invoices are settled in their own currency.", 409);
    const rate = new D(opts.exchangeRate || 0);
    need(rate.gt(0) && rate.eq(rate.toDP(6)), "Enter the exchange rate (INR per 1 " + d.currency + ", up to 6 decimals) to issue a foreign-currency invoice.");
    const inr = toInr({ lines: d.lines }, rate);
    Object.assign(d, { exchange_rate: rate.toFixed(6), lines: inr.lines, subtotal_inr: inr.subtotal, tax_inr: inr.tax, total_inr: inr.total });
    await q.query(
      "UPDATE documents SET exchange_rate=$2,lines=$3,subtotal_inr=$4,tax_inr=$5,total_inr=$6 WHERE id=$1",
      [d.id, d.exchange_rate, JSON.stringify(inr.lines), inr.subtotal, inr.tax, inr.total]
    );
  }
  else if (opts.exchangeRate)
    need(d.currency !== "INR", "An exchange rate applies only to foreign-currency documents.");
  // Preparation only: the IRN comes from the IRP, outside this app. Issue is allowed, with a reminder until it is recorded.
  if (d.kind === "INVOICE" && !company.demo && companyDefaults.einvoice_enabled && String(d.client_snapshot?.gstin || "").trim())
    warnings.push("E-invoicing is on: generate the IRN for this B2B invoice on the IRP (export the e-invoice JSON) and record the IRN, acknowledgement and signed QR here.");
  const advance = new D(d.advance_amount || 0);
  if (d.kind === "INVOICE" && advance.gt(0))
    need(d.advance_account, "Choose the bank or cash account that received the advance before issuing.");
  const num = d.number.startsWith(DRAFT_PREFIX)
    ? await nextFreeNumber(q, DOCUMENT_PREFIX[d.kind], d.issue_date, "documents")
    : d.number;
  // GST invoice serial numbers: at most 16 characters of letters, digits, "-" and "/".
  if (d.kind === "INVOICE" && d.tax_treatment === "TAXABLE" && !company.demo)
    need(/^[A-Za-z0-9/-]{1,16}$/.test(num), "A GST invoice number can have at most 16 characters: letters, digits, \"-\" and \"/\". Change the number on the draft.");
  let selfInvoice: string | null = null;
  if (POSTING_DOCUMENTS.includes(d.kind)) {
    let lines: any[];
    if (d.kind === "BILL")
      lines = [
        { account: d.payment_method === "Cash" ? "1010" : "1000", debit: d.total },
        { account: d.income_account || "4000", credit: d.total }
      ];
    else if (d.kind === "PURCHASE") {
      await checkVendorReference(q, d.party_id, d.reference, d.id);
      // Eligible GST goes to the input-tax (ITC) accounts; ineligible GST is part of the cost.
      const claim = d.itc_eligible && d.tax_treatment === "TAXABLE" ? taxLines(d, "debit", INPUT_TAX) : [];
      if (d.reverse_charge) {
        // Reverse charge: the supplier is owed the taxable value only; the tax is the company's RCM liability.
        // Dr expense (taxable value, plus the tax when ITC is not available) · Dr input tax (ITC) · Cr payables · Cr RCM payable.
        const cost = claim.length ? d.subtotal : new D(d.subtotal).add(d.tax).toFixed(2);
        lines = [{ account: d.expense_account, debit: cost }, ...claim, { account: PAYABLES, credit: d.subtotal }, ...taxLines(d, "credit", RCM_TAX)];
        // A supplier without a GSTIN cannot issue a tax invoice, so the company raises a self-invoice (series SI).
        if (!String(d.client_snapshot?.gstin || party.gstin || "").trim())
          selfInvoice = await nextFreeNumber(q, "SI", d.issue_date, "documents", "self_invoice_number");
      }
      else {
        const cost = claim.length ? d.subtotal : d.total;
        lines = [{ account: d.expense_account, debit: cost }, ...claim, { account: PAYABLES, credit: d.total }];
      }
    }
    else {
      const posted = postedAmounts(d);
      lines = [{ account: RECEIVABLES, debit: posted.total }, { account: "4000", credit: posted.subtotal }, ...outputTaxLines({ ...posted, interstate: d.interstate }, "credit")];
    }
    await writeJournal(
      q,
      actor,
      {
      date: d.issue_date,
      kind: d.kind,
      description: num + (d.reference ? " (" + d.reference + ")" : "") + " · " + party.name,
      partyId: d.party_id,
      projectId: d.project_id,
      documentId: d.id,
      lines
    }
    );
  }
  await q.query(
    "UPDATE documents SET status='ISSUED',number=$3,snapshot=$2,self_invoice_number=$4 WHERE id=$1",
    [docId, JSON.stringify({ company, party: d.client_snapshot || party, templateVersion: 1 }), num, selfInvoice]
  );
  // The advance shown on the invoice is real money: record it as a receipt allocated to this invoice.
  if (d.kind === "INVOICE" && advance.gt(0))
    await postPayment(
      q,
      actor,
      {
      direction: "RECEIPT",
      partyId: d.party_id,
      date: d.issue_date,
      amount: advance.toFixed(2),
      cashAccount: d.advance_account,
      description: "Advance received · " + num,
      allocations: [{ documentId: d.id, amount: advance.toFixed(2) }]
    }
    );
  await audit(q, actor, "document.issue", docId, { number: num, ...(d.exchange_rate ? { exchangeRate: d.exchange_rate } : {}), ...(selfInvoice ? { selfInvoice } : {}) });
  return { id: docId, status: "ISSUED", number: num, ...(selfInvoice ? { selfInvoiceNumber: selfInvoice } : {}), warnings };
}
export async function postPayment(
  q: Queryable,
  actor: Actor,
  b: any
) {
  const amount = new D(b.amount), allocs = b.allocations || [];
  need(amount.gt(0), "Payment must be positive.");
  const receipt = b.direction === "RECEIPT";
  need(receipt || b.direction === "PAYMENT", "Unsupported payment direction.");
  const party = await one(q, "SELECT kind FROM parties WHERE id=$1", [b.partyId]);
  need(party, "Choose an existing client or vendor.");
  // Vendor payments settle vendor bills (PURCHASE); client receipts settle invoices.
  if (!receipt)
    need(["VENDOR", "BOTH"].includes(party.kind), "Choose a vendor to record a vendor payment.");
  const bank = await one(q, "SELECT * FROM accounts WHERE code=$1", [b.cashAccount]);
  need(bank?.is_cash, "Choose a bank/cash account.");
  const checked = await checkAllocations(q, b.partyId, receipt ? RECEIVABLE_KINDS : ["PURCHASE"], allocs);
  const allocated = checked.total, foreign = checked.rows.some(r => r.foreignAmount);
  // TDS: on a receipt the client withheld part of what it owed (an asset we recover from the department via Form 26AS);
  // on a vendor payment we withheld it (a liability until deposited). Either way it settles the allocated documents
  // together with the money, so it cannot exist without an allocation or exceed it.
  const tds = new D(receipt ? b.tdsAmount || 0 : b.tds?.amount || 0);
  need(tds.gte(0) && tds.eq(tds.toDP(2)), "TDS must be a positive amount with at most two decimals.");
  if (tds.gt(0)) {
    need(allocated.gt(0), "TDS can only be recorded against at least one allocated " + (receipt ? "invoice." : "bill."));
    need(tds.lte(allocated), "TDS cannot exceed the amount allocated.");
    need(!foreign, "TDS on foreign-currency invoices is not supported.");
    if (!receipt) {
      need(TDS_SECTIONS.includes(b.tds.section), "Choose the TDS section.");
      const rate = new D(b.tds.rate ?? 0);
      need(rate.gte(0) && rate.lte(100), "TDS rate must be between 0 and 100%.");
    }
  }
  // Settled by money plus TDS: a receipt's cash + TDS, a payment's net bank amount + TDS (the gross owed to the vendor).
  const settledBy = amount.add(tds);
  let fx = new D(0), remainder: Decimal;
  if (foreign) {
    // A foreign-currency settlement: the bank receives INR at today's rate; the invoice is carried at its issue rate.
    // The difference on the settled portion is a realised exchange gain or loss. No advance can come out of it.
    need(receipt, "Foreign-currency settlements apply to client receipts.");
    fx = amount.sub(allocated);
    remainder = new D(0);
  }
  else {
    need(allocated.lte(settledBy), "Allocations exceed the payment amount" + (tds.gt(0) ? " plus TDS." : "."));
    remainder = settledBy.sub(allocated);
  }
  if (receipt && remainder.gt(0)) {
    const c = await one(q, "SELECT demo FROM company WHERE id='company'");
    need(
      c.demo,
      "Live advances require a verified GST advance workflow. Allocate against an issued invoice."
    );
  }
  let lines: any[] = [{ account: b.cashAccount, [receipt ? "debit" : "credit"]: amount.toFixed(2) }];
  if (tds.gt(0))
    lines.push(receipt ? { account: TDS_RECEIVABLE, debit: tds.toFixed(2) } : { account: TDS_PAYABLE, credit: tds.toFixed(2) });
  if (allocated.gt(0))
    lines.push({
    account: receipt ? RECEIVABLES : PAYABLES,
    [receipt ? "credit" : "debit"]: allocated.toFixed(2)
  });
  if (fx.gt(0))
    lines.push({ account: FX_GAIN, credit: fx.toFixed(2) });
  if (fx.lt(0))
    lines.push({ account: FX_LOSS, debit: fx.neg().toFixed(2) });
  // Money paid or received beyond the allocated bills stays as an advance for this party, to be applied later.
  if (remainder.gt(0))
    lines.push(receipt ? { account: CLIENT_ADVANCES, credit: remainder.toFixed(2) } : { account: VENDOR_ADVANCES, debit: remainder.toFixed(2) });
  const tdsDetail: Record<string, string> | null = tds.gt(0)
    ? receipt
      ? { direction: "RECEIVABLE", amount: tds.toFixed(2) }
      : { direction: "PAYABLE", section: b.tds.section, rate: new D(b.tds.rate ?? 0).toString(), amount: tds.toFixed(2) }
    : null;
  const supplied = b.client ? {
    name: b.client.name,
    address: b.client.address,
    gstin: b.client.gstin,
    contact_name: b.client.contactName,
    phone: b.client.phone
  } : {};
  const client = Object.fromEntries(Object.entries(supplied).filter(([, value]) => typeof value === "string" && value.length > 0));
  const entry = await writeJournal(
    q,
    actor,
    {
    date: b.date,
    kind: b.direction,
    description: b.description,
    partyId: b.partyId,
    partySnapshot: client,
    number: b.direction === "RECEIPT" ? b.number : undefined,
    tds: tdsDetail,
    lines
  }
  );
  for (const a of checked.rows)
    await q.query(
    "INSERT INTO allocations(id,entry_id,document_id,amount,foreign_amount) VALUES($1,$2,$3,$4,$5)",
    [id(), entry.id, a.documentId, a.amount, a.foreignAmount]
  );
  return entry;
}
// INR still outstanding on a document, and (for a foreign-currency document) what is outstanding in its own currency.
// Outstanding is always total − SUM(allocations); a foreign document's total is its INR equivalent.
async function outstandingOf(
  q: Queryable,
  d: Record<string, any>
) {
  const s = await one(
    q,
    "SELECT COALESCE(SUM(amount),0)::text AS paid,COALESCE(SUM(foreign_amount),0)::text AS foreign_paid FROM allocations WHERE document_id=$1",
    [d.id]
  );
  const foreign = d.total_inr != null;
  return {
    inr: new D(foreign ? d.total_inr : d.total).sub(s.paid),
    foreign: foreign ? new D(d.total).sub(s.foreign_paid) : null
  };
}
// Validates allocations against issued documents of one party and kinds, locking them in a stable order. An INR document is
// settled by an INR amount. A foreign-currency document is settled by an amount in its own currency; the INR it clears is its
// carrying amount at the issue rate (the whole remaining INR balance when the last of the foreign balance is settled, so no
// paise are left behind).
async function checkAllocations(
  q: Queryable,
  partyId: string,
  kinds: string[],
  allocs: { documentId: string; amount?: string; foreignAmount?: string }[]
) {
  let total = new D(0);
  const seen = new Set(), rows: { documentId: string; amount: string; foreignAmount: string | null }[] = [];
  const noun = kinds.includes("PURCHASE") ? "bill" : "invoice";
  for (const a of [...allocs].sort((x, y) => x.documentId.localeCompare(y.documentId))) {
    need(!seen.has(a.documentId), "Duplicate " + noun + " allocation.");
    seen.add(a.documentId);
    const d = await one(q, "SELECT * FROM documents WHERE id=$1 FOR UPDATE", [a.documentId]);
    need(
      d?.status === "ISSUED" && d.party_id === partyId && kinds.includes(d.kind),
      "Allocation does not match an issued document for this party."
    );
    const due = await outstandingOf(q, d);
    let inr: Decimal, foreignAmount: string | null = null;
    if (due.foreign) {
      need(a.foreignAmount != null && a.amount == null, "Enter the " + d.currency + " amount settled on " + d.number + ".");
      const f = new D(a.foreignAmount!);
      need(f.gt(0) && f.eq(f.toDP(2)) && f.lte(due.foreign), "Allocation exceeds the outstanding " + d.currency + " balance of " + d.number + ".");
      inr = f.eq(due.foreign) ? due.inr : f.mul(d.total_inr).div(d.total).toDP(2, D.ROUND_HALF_UP);
      need(inr.gt(0) && inr.lte(due.inr), "Allocation exceeds the outstanding balance of " + d.number + ".");
      foreignAmount = f.toFixed(2);
    }
    else {
      need(a.foreignAmount == null && a.amount != null, "Enter the amount allocated to " + d.number + ".");
      inr = new D(a.amount!);
      need(inr.gt(0) && inr.lte(due.inr), "Allocation exceeds the outstanding balance of " + d.number + ".");
    }
    rows.push({ documentId: a.documentId, amount: inr.toFixed(2), foreignAmount });
    total = total.add(inr);
  }
  return { total, rows };
}
// Advance still available for a party: client advances are a liability (credit balance), vendor advances an asset (debit balance).
export async function availableAdvance(
  q: Queryable,
  direction: "RECEIPT" | "PAYMENT",
  partyId: string,
  asOf?: string
) {
  const r = await one(
    q,
    "SELECT COALESCE(SUM(l.debit-l.credit),0)::text AS balance FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.party_id=$1 AND l.account_code=$2" + (asOf ? " AND e.entry_date<=$3::date" : ""),
    asOf ? [partyId, direction === "RECEIPT" ? CLIENT_ADVANCES : VENDOR_ADVANCES, asOf] : [partyId, direction === "RECEIPT" ? CLIENT_ADVANCES : VENDOR_ADVANCES]
  );
  const balance = new D(r.balance);
  return direction === "RECEIPT" ? balance.neg() : balance;
}
// Applies an advance received from a client to its invoices (Dr client advances / Cr receivables), or an advance paid to a
// vendor to its bills (Dr payables / Cr vendor advances). No cash moves and no income or expense is created.
export async function applyAdvance(
  q: Queryable,
  actor: Actor,
  b: {
  direction: "RECEIPT" | "PAYMENT";
  partyId: string;
  date: string;
  description?: string;
  allocations: { documentId: string; amount: string }[]
}
) {
  const receipt = b.direction === "RECEIPT";
  const party = await one(q, "SELECT name FROM parties WHERE id=$1", [b.partyId]);
  need(party, "Choose an existing client or vendor.");
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["advance:" + b.direction + ":" + b.partyId]);
  need(b.allocations.every(a => (a as any).foreignAmount == null), "Advances are held in INR; settle foreign-currency invoices with a receipt.");
  const { total, rows } = await checkAllocations(q, b.partyId, receipt ? RECEIVABLE_KINDS : ["PURCHASE"], b.allocations);
  need(total.gt(0), "Allocate the advance to at least one " + (receipt ? "invoice" : "bill") + ".");
  const available = await availableAdvance(q, b.direction, b.partyId, b.date);
  need(total.lte(available), "Only " + available.toFixed(2) + " of advance is available for " + party.name + " on this date.");
  const amount = total.toFixed(2);
  const entry = await writeJournal(
    q,
    actor,
    {
    date: b.date,
    kind: "ADVANCE_APPLIED",
    description: b.description?.trim() || (receipt ? "Client advance applied" : "Vendor advance applied") + " · " + party.name,
    partyId: b.partyId,
    lines: receipt
      ? [{ account: CLIENT_ADVANCES, debit: amount }, { account: RECEIVABLES, credit: amount }]
      : [{ account: PAYABLES, debit: amount }, { account: VENDOR_ADVANCES, credit: amount }]
  }
  );
  for (const a of rows)
    await q.query(
      "INSERT INTO allocations(id,entry_id,document_id,amount) VALUES($1,$2,$3,$4)",
      [id(), entry.id, a.documentId, a.amount]
    );
  return entry;
}
export async function reverseJournal(
  q: Queryable,
  actor: Actor,
  entryId: string,
  date: string,
  reason: string
) {
  const e = await one(q, "SELECT *,entry_date::text FROM journal_entries WHERE id=$1 FOR UPDATE", [entryId]);
  need(e, "Entry not found.", 404);
  need(
    !e.document_id && !e.reversal_of,
    "Correct document postings with a credit note (invoices) or cancellation (payment receipts and vendor bills)."
  );
  return postReversal(q, actor, e, date, reason);
}
// Posts the mirror image of an entry and undoes what it settled; the original stays untouched for the audit trail.
async function postReversal(
  q: Queryable,
  actor: Actor,
  e: any,
  date: string,
  reason: string
) {
  need(date >= e.entry_date, "A reversal cannot be dated before the original entry.");
  need(
    !(await one(q, "SELECT id FROM journal_entries WHERE reversal_of=$1", [e.id])),
    "Entry already reversed.",
    409
  );
  const lines = (await q.query(
    "SELECT account_code AS account,credit::text AS debit,debit::text AS credit FROM journal_lines WHERE entry_id=$1",
    [e.id]
  )).rows;
  // An advance that has since been applied to invoices/bills cannot be taken back until that application is reversed.
  if (e.party_id)
    for (const [account, direction] of [[CLIENT_ADVANCES, "RECEIPT"], [VENDOR_ADVANCES, "PAYMENT"]] as const) {
      const created = lines.filter(l => l.account === account)
        .reduce<D>((s, l) => s.add(direction === "RECEIPT" ? new D(l.debit).sub(l.credit) : new D(l.credit).sub(l.debit)), new D(0));
      if (created.gt(0))
        need(
          (await availableAdvance(q, direction, e.party_id)).gte(created),
          "Part of this advance has already been applied. Reverse the advance application first."
        );
    }
  // TDS already deposited for this deduction's section and month cannot be un-deducted underneath the deposit.
  if (e.tds?.direction === "PAYABLE") {
    const period = String(e.entry_date).slice(0, 7);
    const due = (await tdsPayableSummary(q)).find(r => r.section === e.tds.section && r.period === period);
    need(
      new D(due?.due || 0).gte(e.tds.amount),
      "TDS from this payment has already been deposited for " + e.tds.section + " · " + period + ". Reverse that TDS deposit first."
    );
  }
  const reversal = await writeJournal(
    q,
    actor,
    {
    date,
    kind: "REVERSAL",
    description: "Reversal " + e.number + ": " + reason,
    partyId: e.party_id,
    projectId: e.project_id,
    reversalOf: e.id,
    lines: lines as any
  }
  );
  // Allocations are immutable, so a reversed receipt is offset by negative allocations dated with the reversal.
  // A foreign-currency settlement also gives back its foreign amount. TDS, exchange-difference and RCM lines are reversed
  // with every other line above, so nothing is special-cased.
  const allocations = (await q.query("SELECT document_id,amount::text,foreign_amount::text FROM allocations WHERE entry_id=$1", [e.id])).rows;
  for (const a of allocations)
    await q.query(
      "INSERT INTO allocations(id,entry_id,document_id,amount,foreign_amount) VALUES($1,$2,$3,$4,$5)",
      [id(), reversal.id, a.document_id, new D(a.amount).neg().toFixed(2), a.foreign_amount == null ? null : new D(a.foreign_amount).neg().toFixed(2)]
    );
  // A reversed entry no longer represents a real movement: free its recurring month and bank match.
  const freedRecurring = (await q.query("DELETE FROM recurring_occurrences WHERE entry_id=$1 RETURNING rule_id,month", [e.id])).rows;
  const unmatchedBank = (await q.query("UPDATE bank_statement_lines SET matched_entry_id=NULL WHERE matched_entry_id=$1 RETURNING id", [e.id])).rows;
  if (freedRecurring.length || unmatchedBank.length || allocations.length)
    await audit(
      q,
      actor,
      "journal.reverse.release",
      e.id,
      { recurring: freedRecurring, bankLines: unmatchedBank.map(r => r.id), allocations }
    );
  return reversal;
}
// TDS payable by section and month, from the 2400 ledger lines: deducted on vendor payments (a reversal counts against the
// month of the payment it reverses), deposited by TDS deposit vouchers for the month they cover, and what is still due.
// Lines on 2400 without TDS particulars (e.g. a manual journal) are reported under section "UNASSIGNED".
export async function tdsPayableSummary(
  q: Queryable,
  asOf?: string
) {
  const rows = (await q.query(
    "SELECT COALESCE(o.tds,e.tds) AS meta,COALESCE(o.entry_date,e.entry_date)::text AS base_date,l.debit::text,l.credit::text FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN journal_entries o ON o.id=e.reversal_of WHERE l.account_code=$1" + (asOf ? " AND e.entry_date<=$2::date" : ""),
    asOf ? [TDS_PAYABLE, asOf] : [TDS_PAYABLE]
  )).rows;
  const map = new Map<string, { section: string; period: string; deducted: Decimal; deposited: Decimal }>();
  for (const r of rows) {
    const deposit = r.meta?.direction === "DEPOSIT";
    const section = r.meta?.section || "UNASSIGNED", period = deposit ? r.meta.period : r.base_date.slice(0, 7);
    const key = section + "|" + period;
    if (!map.has(key)) map.set(key, { section, period, deducted: new D(0), deposited: new D(0) });
    const m = map.get(key)!, net = new D(r.credit).sub(r.debit);
    if (deposit) m.deposited = m.deposited.sub(net);
    else m.deducted = m.deducted.add(net);
  }
  return [...map.values()]
    .sort((a, b) => a.period.localeCompare(b.period) || a.section.localeCompare(b.section))
    .map(m => {
      const [y, mo] = m.period.split("-").map(Number);
      // Rule 30: deposit by the 7th of the following month; for March deductions, by 30 April.
      const dueBy = mo === 3 ? y + "-04-30" : mo === 12 ? (y + 1) + "-01-07" : y + "-" + String(mo + 1).padStart(2, "0") + "-07";
      return { section: m.section, period: m.period, deducted: m.deducted.toFixed(2), deposited: m.deposited.toFixed(2), due: m.deducted.sub(m.deposited).toFixed(2), dueBy };
    });
}
// Deposit of TDS deducted to the government (challan / ITNS 281): Dr TDS payable, Cr bank. Limited to what is due for that
// section and month, so 2400 never shows more deposited than deducted.
export async function postTdsDeposit(
  q: Queryable,
  actor: Actor,
  b: { date: string; cashAccount: string; amount: string; section: string; period: string; challan: string; description?: string }
) {
  const amount = new D(b.amount);
  need(amount.gt(0) && amount.eq(amount.toDP(2)), "Deposit amount must be positive, with at most two decimals.");
  need(TDS_SECTIONS.includes(b.section as any), "Choose the TDS section.");
  need(/^\d{4}-(0[1-9]|1[0-2])$/.test(b.period) && b.period <= b.date.slice(0, 7), "Choose the month the TDS was deducted in (not after the deposit date).");
  const challan = String(b.challan || "").trim();
  need(challan.length >= 3, "Enter the challan number (BSR code, date and serial / CIN).");
  need((await one(q, "SELECT is_cash FROM accounts WHERE code=$1", [b.cashAccount]))?.is_cash, "Choose the bank account the deposit was paid from.");
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["tds-deposit:" + b.section + ":" + b.period]);
  const due = new D((await tdsPayableSummary(q)).find(r => r.section === b.section && r.period === b.period)?.due || 0);
  need(amount.lte(due), "Only " + due.toFixed(2) + " of TDS under " + b.section + " for " + b.period + " is due for deposit.");
  return writeJournal(q, actor, {
    date: b.date,
    kind: "TDS_DEPOSIT",
    description: b.description?.trim() || "TDS deposit · " + b.section + " · " + b.period + " · challan " + challan,
    tds: { direction: "DEPOSIT", section: b.section, period: b.period, challan, amount: amount.toFixed(2) },
    lines: [{ account: TDS_PAYABLE, debit: amount.toFixed(2) }, { account: b.cashAccount, credit: amount.toFixed(2) }]
  });
}
const sumAllocations = async (q: Queryable, documentId: string) => new D((await one(
  q,
  "SELECT COALESCE(SUM(amount),0)::text AS settled FROM allocations WHERE document_id=$1",
  [documentId]
)).settled);
export async function issueCreditNote(
  q: Queryable,
  actor: Actor,
  invoiceId: string,
  b: {
  date: string;
  reason: string;
  lines: {
    line: number;
    quantity: string
  }[]
}
) {
  const inv = await one(q, "SELECT *,issue_date::text FROM documents WHERE id=$1 FOR UPDATE", [invoiceId]);
  need(inv?.kind === "INVOICE" && inv.status === "ISSUED", "Credit notes can only be issued against an issued invoice.", 409);
  need(b.date >= inv.issue_date, "A credit note cannot be dated before its invoice.");
  need(b.reason?.trim().length >= 3, "Explain why the invoice is being credited.");
  // Quantities already credited per original line, so repeated credit notes can never exceed the invoice.
  const credited = new Map<number, D>();
  for (const cn of (await q.query("SELECT lines FROM documents WHERE kind='CREDIT_NOTE' AND status='ISSUED' AND source_id=$1", [invoiceId])).rows)
    for (const l of cn.lines)
      credited.set(l.sourceLine, (credited.get(l.sourceLine) || new D(0)).add(l.quantity));
  const seen = new Set<number>();
  const lines = b.lines.map(r => {
    const original = inv.lines[r.line];
    need(Number.isInteger(r.line) && original && !seen.has(r.line), "Choose lines from the original invoice.");
    seen.add(r.line);
    const qty = new D(r.quantity), remaining = new D(original.quantity).sub(credited.get(r.line) || 0);
    need(qty.gt(0) && qty.lte(remaining), "Credit quantity exceeds what remains on line " + (r.line + 1) + ".");
    return {
      description: original.description,
      hsn: original.hsn,
      quantity: qty.toString(),
      price: original.price,
      taxRate: original.taxRate,
      sourceLine: r.line
    };
  });
  need(lines.length > 0, "Choose at least one line to credit.");
  const sums = calculateDocument({ taxTreatment: inv.tax_treatment, zeroRatedType: inv.zero_rated_type, lines });
  const due = await outstandingOf(q, inv);
  const refundHint = " If the money was refunded, reverse the receipt first.";
  // A foreign-currency invoice is credited in its own currency, converted at the invoice's own rate. The credit clears its INR
  // equivalent from receivables; when it clears the last of the foreign balance it clears the whole INR balance, and the paise
  // left by proportional receipts go to exchange difference.
  let inr: ReturnType<typeof toInr> | null = null, settles = sums.total, fx = new D(0);
  if (due.foreign) {
    need(new D(sums.total).lte(due.foreign), "The credit exceeds the invoice's outstanding " + inv.currency + " balance." + refundHint);
    inr = toInr(sums, inv.exchange_rate);
    const clears = new D(sums.total).eq(due.foreign) ? due.inr : new D(inr.total);
    need(clears.gt(0) && clears.lte(due.inr), "The credit exceeds the invoice's outstanding balance." + refundHint);
    settles = clears.toFixed(2);
    fx = new D(inr.total).sub(clears);
  }
  else
    need(new D(sums.total).lte(due.inr), "The credit exceeds the invoice's outstanding balance." + refundHint);
  const docId = id(), num = await nextFreeNumber(q, "CN", b.date, "documents");
  await reserveDocumentNumber(q, num, docId);
  await q.query(
    "INSERT INTO documents(id,number,kind,status,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,subtotal,tax,total,lines,notes,source_id,created_by,currency,client_snapshot,company_snapshot,snapshot,zero_rated_type,exchange_rate,subtotal_inr,tax_inr,total_inr) VALUES($1,$2,'CREDIT_NOTE','ISSUED',$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$21,$17,$18,$19,$20,$22,$23,$24,$25)",
    [
    docId,
    num,
    inv.party_id,
    inv.project_id,
    b.date,
    inv.tax_treatment,
    inv.tax_reason,
    inv.place_of_supply,
    inv.interstate,
    sums.subtotal,
    sums.tax,
    sums.total,
    JSON.stringify(inr ? inr.lines : sums.lines),
    "Against " + inv.number + ": " + b.reason.trim(),
    inv.id,
    actor.id,
    inv.client_snapshot ? JSON.stringify(inv.client_snapshot) : null,
    inv.company_snapshot ? JSON.stringify(inv.company_snapshot) : null,
    inv.snapshot ? JSON.stringify(inv.snapshot) : null,
    inv.zero_rated_type,
    inv.currency,
    inr ? inv.exchange_rate : null,
    inr?.subtotal ?? null,
    inr?.tax ?? null,
    inr?.total ?? null
  ]
  );
  const party = await one(q, "SELECT name FROM parties WHERE id=$1", [inv.party_id]);
  const posted = inr ? { subtotal: inr.subtotal, tax: inr.tax, lines: inr.lines.map(l => ({ ...l, tax: l.taxInr })) } : sums;
  const entry = await writeJournal(
    q,
    actor,
    {
    date: b.date,
    kind: "CREDIT_NOTE",
    description: num + " · against " + inv.number + " · " + party.name,
    partyId: inv.party_id,
    projectId: inv.project_id,
    documentId: docId,
    lines: [
      { account: "4000", debit: posted.subtotal },
      ...outputTaxLines({ tax: posted.tax, interstate: inv.interstate, lines: posted.lines }, "debit"),
      { account: RECEIVABLES, credit: settles },
      ...(fx.gt(0) ? [{ account: FX_GAIN, credit: fx.toFixed(2) }] : fx.lt(0) ? [{ account: FX_LOSS, debit: fx.neg().toFixed(2) }] : [])
    ]
  }
  );
  // The credit settles part of the invoice exactly like a receipt would, so outstanding balances stay ledger-consistent.
  await q.query(
    "INSERT INTO allocations(id,entry_id,document_id,amount,foreign_amount) VALUES($1,$2,$3,$4,$5)",
    [id(), entry.id, inv.id, settles, inr ? sums.total : null]
  );
  await audit(q, actor, "document.credit", docId, { number: num, invoice: inv.number, total: sums.total, reason: b.reason });
  return { id: docId, number: num };
}
// Purchase debit note: goods returned or the vendor overbilled. Line quantities from the posted bill at the bill's own rates,
// like a credit note. It reduces what is owed (Dr payables), the cost (Cr expense/asset) and the input tax claimed on the
// bill (Cr ITC, using the bill's own CGST/SGST or IGST split); a reverse-charge bill also gives back its RCM liability.
// It settles the bill through an allocation, so it can never exceed the bill's outstanding balance.
export async function issueDebitNote(
  q: Queryable,
  actor: Actor,
  billId: string,
  b: { date: string; reason: string; lines: { line: number; quantity: string }[] }
) {
  const bill = await one(q, "SELECT *,issue_date::text FROM documents WHERE id=$1 FOR UPDATE", [billId]);
  need(bill?.kind === "PURCHASE" && bill.status === "ISSUED", "Debit notes can only be issued against a posted vendor bill.", 409);
  need(b.date >= bill.issue_date, "A debit note cannot be dated before its bill.");
  need(b.reason?.trim().length >= 3, "Explain why the bill is being reduced.");
  const debited = new Map<number, D>();
  for (const dn of (await q.query("SELECT lines FROM documents WHERE kind='DEBIT_NOTE' AND status='ISSUED' AND source_id=$1", [billId])).rows)
    for (const l of dn.lines)
      debited.set(l.sourceLine, (debited.get(l.sourceLine) || new D(0)).add(l.quantity));
  const seen = new Set<number>();
  const lines = b.lines.map(r => {
    const original = bill.lines[r.line];
    need(Number.isInteger(r.line) && original && !seen.has(r.line), "Choose lines from the original bill.");
    seen.add(r.line);
    const qty = new D(r.quantity), remaining = new D(original.quantity).sub(debited.get(r.line) || 0);
    need(qty.gt(0) && qty.lte(remaining), "Debit quantity exceeds what remains on line " + (r.line + 1) + ".");
    return { description: original.description, hsn: original.hsn, quantity: qty.toString(), price: original.price, taxRate: original.taxRate, sourceLine: r.line };
  });
  need(lines.length > 0, "Choose at least one line to debit.");
  const sums = calculateDocument({ taxTreatment: bill.tax_treatment, lines });
  const rcm = bill.reverse_charge === true;
  // Like the bill itself, a reverse-charge note reduces the payable by the taxable value only.
  const noteTotal = rcm ? sums.subtotal : sums.total;
  need(
    new D(noteTotal).lte(new D(bill.total).sub(await sumAllocations(q, billId))),
    "The debit note exceeds the bill's outstanding balance. Reverse the payment first if the vendor is refunding money."
  );
  const company = await one(q, "SELECT * FROM company WHERE id='company'");
  if (!company.demo && bill.tax_treatment === "TAXABLE")
    need(GSTIN.test(String(company.gstin || "")), "Add the company's 15-character GSTIN in Settings before issuing a GST debit note.");
  const docId = id(), num = await nextFreeNumber(q, "DN", b.date, "documents");
  await reserveDocumentNumber(q, num, docId);
  const vendor = await one(q, "SELECT * FROM parties WHERE id=$1", [bill.party_id]);
  await q.query(
    "INSERT INTO documents(id,number,kind,status,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,expense_account,subtotal,tax,total,lines,notes,source_id,created_by,currency,client_snapshot,snapshot,reference,itc_eligible,reverse_charge) VALUES($1,$2,'DEBIT_NOTE','ISSUED',$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'INR',$18,$19,$20,$21,$22)",
    [
      docId, num, bill.party_id, bill.project_id, b.date, bill.tax_treatment, bill.tax_reason, bill.place_of_supply, bill.interstate,
      bill.expense_account, sums.subtotal, sums.tax, noteTotal, JSON.stringify(sums.lines),
      "Against " + bill.number + (bill.reference ? " (supplier bill " + bill.reference + ")" : "") + ": " + b.reason.trim(),
      bill.id, actor.id, bill.client_snapshot ? JSON.stringify(bill.client_snapshot) : null,
      JSON.stringify({ company, party: bill.client_snapshot || vendor, templateVersion: 1 }), bill.reference, bill.itc_eligible, rcm
    ]
  );
  const taxed = { tax: sums.tax, interstate: bill.interstate, lines: sums.lines };
  const claim = bill.itc_eligible && bill.tax_treatment === "TAXABLE" ? taxLines(taxed, "credit", INPUT_TAX) : [];
  // The part of the tax that was not claimed as ITC sits in the cost, so it comes back out of the cost.
  const cost = claim.length ? sums.subtotal : rcm ? new D(sums.subtotal).add(sums.tax).toFixed(2) : sums.total;
  const entry = await writeJournal(q, actor, {
    date: b.date,
    kind: "DEBIT_NOTE",
    description: num + " · against " + bill.number + (bill.reference ? " (" + bill.reference + ")" : "") + " · " + vendor.name,
    partyId: bill.party_id,
    projectId: bill.project_id,
    documentId: docId,
    lines: [
      { account: PAYABLES, debit: noteTotal },
      ...(rcm ? taxLines(taxed, "debit", RCM_TAX) : []),
      { account: bill.expense_account, credit: cost },
      ...claim
    ]
  });
  await q.query("INSERT INTO allocations(id,entry_id,document_id,amount) VALUES($1,$2,$3,$4)", [id(), entry.id, bill.id, noteTotal]);
  await audit(q, actor, "document.debit", docId, { number: num, bill: bill.number, total: noteTotal, reason: b.reason });
  return { id: docId, number: num };
}
// Sales debit note: an issued invoice was under-charged. New lines at the invoice's tax treatment and supply type, posted
// like an invoice (Dr receivables, Cr revenue, Cr output tax). It is its own receivable document that receipts settle.
export async function issueSalesDebitNote(
  q: Queryable,
  actor: Actor,
  invoiceId: string,
  b: { date: string; dueDate?: string; reason: string; lines: { description: string; hsn?: string; quantity: string; price: string; taxRate: string }[] }
) {
  const inv = await one(q, "SELECT *,issue_date::text,due_date::text FROM documents WHERE id=$1 FOR UPDATE", [invoiceId]);
  need(inv?.kind === "INVOICE" && inv.status === "ISSUED", "Debit notes can only be issued against an issued invoice.", 409);
  need(inv.currency === "INR", "Debit notes against foreign-currency invoices are not supported yet.", 409);
  need(b.date >= inv.issue_date, "A debit note cannot be dated before its invoice.");
  need(b.reason?.trim().length >= 3, "Explain why the invoice is being debited.");
  const dueDate = b.dueDate || b.date;
  need(dueDate >= b.date, "Due date cannot precede the debit note date.");
  const sums = calculateDocument({ taxTreatment: inv.tax_treatment, zeroRatedType: inv.zero_rated_type, lines: b.lines.map(l => ({ ...l, hsn: l.hsn || "" })) });
  const companyDefaults = await one(q, "SELECT *,lut_valid_from::text,lut_valid_to::text FROM company WHERE id='company'");
  const docId = id(), num = await nextFreeNumber(q, "SDN", b.date, "documents");
  const note = { ...inv, kind: "SALES_DEBIT_NOTE", issue_date: b.date, lines: sums.lines };
  // The same particulars a live tax invoice needs (the note is a tax document to the same recipient).
  if (!companyDefaults.demo)
    checkLiveInvoice(note, { ...companyDefaults, ...(inv.company_snapshot || {}) });
  await reserveDocumentNumber(q, num, docId);
  await q.query(
    "INSERT INTO documents(id,number,kind,status,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,subtotal,tax,total,lines,notes,source_id,created_by,currency,client_snapshot,company_snapshot,snapshot,zero_rated_type) VALUES($1,$2,'SALES_DEBIT_NOTE','ISSUED',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'INR',$18,$19,$20,$21)",
    [
      docId, num, inv.party_id, inv.project_id, b.date, dueDate, inv.tax_treatment, inv.tax_reason, inv.place_of_supply, inv.interstate,
      sums.subtotal, sums.tax, sums.total, JSON.stringify(sums.lines), "Against " + inv.number + ": " + b.reason.trim(), inv.id, actor.id,
      inv.client_snapshot ? JSON.stringify(inv.client_snapshot) : null, inv.company_snapshot ? JSON.stringify(inv.company_snapshot) : null,
      inv.snapshot ? JSON.stringify(inv.snapshot) : null, inv.zero_rated_type
    ]
  );
  const party = await one(q, "SELECT name FROM parties WHERE id=$1", [inv.party_id]);
  await writeJournal(q, actor, {
    date: b.date,
    kind: "SALES_DEBIT_NOTE",
    description: num + " · against " + inv.number + " · " + party.name,
    partyId: inv.party_id,
    projectId: inv.project_id,
    documentId: docId,
    lines: [
      { account: RECEIVABLES, debit: sums.total },
      { account: "4000", credit: sums.subtotal },
      ...outputTaxLines({ tax: sums.tax, interstate: inv.interstate, lines: sums.lines }, "credit")
    ]
  });
  await audit(q, actor, "document.sales_debit", docId, { number: num, invoice: inv.number, total: sums.total, reason: b.reason });
  return { id: docId, number: num };
}
// E-invoice details generated on the IRP (outside this app) and pasted back. They can be recorded once and never changed: a
// database trigger also refuses any later change. A wrong or cancelled IRN is corrected on the IRP and with a new document.
export async function recordEinvoice(
  q: Queryable,
  actor: Actor,
  docId: string,
  b: { irn: string; ackNo: string; ackDate: string; signedQr: string }
) {
  const d = await one(q, "SELECT id,number,kind,status,irn FROM documents WHERE id=$1 FOR UPDATE", [docId]);
  need(d && ["INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE"].includes(d.kind) && d.status === "ISSUED", "Record e-invoice details on an issued invoice or note.", 409);
  need((await one(q, "SELECT einvoice_enabled FROM company WHERE id='company'")).einvoice_enabled, "Turn on “E-invoicing applicable” in Settings first.", 409);
  need(!d.irn, "E-invoice details for " + d.number + " are already recorded and cannot be changed. If the IRN was cancelled on the IRP, issue a credit note and a new invoice.", 409);
  await q.query("UPDATE documents SET irn=$2,ack_no=$3,ack_date=$4,signed_qr=$5 WHERE id=$1", [docId, b.irn.toLowerCase(), b.ackNo, b.ackDate, b.signedQr]);
  await audit(q, actor, "document.einvoice", docId, { number: d.number, irn: b.irn.toLowerCase(), ackNo: b.ackNo, ackDate: b.ackDate });
  return { id: docId, irn: b.irn.toLowerCase() };
}
export async function cancelDocument(
  q: Queryable,
  actor: Actor,
  docId: string,
  b: {
  date: string;
  reason: string
}
) {
  const d = await one(q, "SELECT * FROM documents WHERE id=$1 FOR UPDATE", [docId]);
  need(d, "Document not found.", 404);
  need(d.status !== "CANCELLED", "This document is already cancelled.", 409);
  need(b.reason?.trim().length >= 3, "Explain why the document is being cancelled.");
  if (d.status === "ISSUED") {
    need(d.kind !== "INVOICE", "An issued invoice is corrected with a credit note, not cancelled.", 409);
    need(d.kind !== "CREDIT_NOTE", "An issued credit note cannot be cancelled.", 409);
    if (d.kind === "PURCHASE")
      need(
        (await sumAllocations(q, docId)).eq(0),
        "This vendor bill has payments, advances or debit notes applied. Reverse them before cancelling the bill.",
        409
      );
    if (d.kind === "SALES_DEBIT_NOTE")
      need(
        (await sumAllocations(q, docId)).eq(0),
        "This debit note has receipts applied. Reverse them before cancelling it.",
        409
      );
    // Posting documents are cancelled by a reversal of their entry; a purchase debit note's reversal also adds a negative
    // allocation, so the bill it reduced is outstanding again.
    if (["BILL", "PURCHASE", "DEBIT_NOTE", "SALES_DEBIT_NOTE"].includes(d.kind)) {
      const e = await one(q, "SELECT *,entry_date::text FROM journal_entries WHERE document_id=$1 FOR UPDATE", [docId]);
      if (e)
        await postReversal(q, actor, e, b.date, "Cancelled " + d.number + ": " + b.reason.trim());
    }
  }
  await q.query("UPDATE documents SET status='CANCELLED' WHERE id=$1", [docId]);
  await audit(q, actor, "document.cancel", docId, { number: d.number, previousStatus: d.status, reason: b.reason });
  return { id: docId, status: "CANCELLED" };
}
