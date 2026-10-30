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
const DOCUMENT_PREFIX: Record<string, string> = { QUOTATION: "QT", PROFORMA: "PF", INVOICE: "INV", BILL: "BILL" };
const POSTING_DOCUMENTS = ["INVOICE", "BILL"];
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
  table: "documents" | "journal_entries"
) {
  for (;;) {
    const candidate = await number(q, prefix, date);
    if (!(await one(q, `SELECT id FROM ${table} WHERE number=$1`, [candidate])))
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
    "INSERT INTO journal_entries(id,number,entry_date,kind,description,party_id,project_id,document_id,reversal_of,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
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
    snapshot ? JSON.stringify(snapshot) : null
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
    const appliedPercentage = b.taxTreatment === "TAXABLE" ? percentage : new D(0);
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
// Output GST lines for an invoice (credit) or a credit note against it (debit), split per line like the printed document.
function outputTaxLines(
  d: Record<string, any>,
  side: "debit" | "credit"
) {
  if (!new D(d.tax).gt(0))
    return [];
  if (d.interstate)
    return [{ account: "2120", [side]: new D(d.tax).toFixed(2) }];
  let cgst = new D(0), sgst = new D(0);
  for (const l of d.lines) {
    const half = new D(l.tax || 0).div(2).toDP(2);
    cgst = cgst.add(half);
    sgst = sgst.add(new D(l.tax || 0).sub(half));
  }
  return [{ account: "2100", [side]: cgst.toFixed(2) }, { account: "2110", [side]: sgst.toFixed(2) }];
}
// Shared by create and edit so a draft can never be edited past the rules enforced at creation.
async function prepareDocument(
  q: Queryable,
  b: any
) {
  const party = await one(q, "SELECT * FROM parties WHERE id=$1", [b.partyId]);
  need(party, "Choose an existing client or vendor.");
  const company = await one(q, "SELECT * FROM company WHERE id='company'");
  need(b.dueDate >= b.date, "Due date cannot precede the issue date.");
  if (b.taxTreatment !== "TAXABLE")
    need(b.taxReason?.trim().length >= 3, "Explain the non-taxable treatment.");
  const currency = b.currency || "INR";
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
  const interstate = stateKnown ? b.placeOfSupply !== company.state_code : b.interstate === true;
  const sums = calculateDocument(b), advance = new D(b.advanceAmount || 0);
  need(advance.gte(0) && advance.lte(sums.total), "Advance paid cannot exceed the document total.");
  need(advance.eq(0) || b.kind === "INVOICE", "Only invoices can record an advance.");
  const status = advance.eq(0) ? "NOT_RECEIVED" : advance.eq(sums.total) ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED";
  need(
    !b.advanceStatus || b.advanceStatus === status,
    "Advance payment status does not match the amount received."
  );
  const advanceAccount = advance.gt(0) && b.advanceAccount ? b.advanceAccount : null;
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
  return { party, interstate, sums, currency, advance, status, advanceAccount, incomeAccount, client, companySnapshot };
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
  await q.query(
    "INSERT INTO documents(id,number,kind,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,expense_account,subtotal,tax,total,lines,notes,payment_method,source_id,created_by,currency,advance_amount,advance_status,client_snapshot,company_snapshot,income_account,advance_account) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)",
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
    p.advanceAccount
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
  await q.query(
    "UPDATE documents SET number=$2,party_id=$3,project_id=$4,issue_date=$5,due_date=$6,tax_treatment=$7,tax_reason=$8,place_of_supply=$9,interstate=$10,expense_account=$11,subtotal=$12,tax=$13,total=$14,lines=$15,notes=$16,payment_method=$17,currency=$18,advance_amount=$19,advance_status=$20,client_snapshot=$21,company_snapshot=$22,income_account=$23,advance_account=$24 WHERE id=$1",
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
    p.advanceAccount
  ]
  );
  await audit(q, actor, "document.update", docId, { number: num });
  return { id: docId, number: num };
}
export async function issueDocument(
  q: Queryable,
  actor: Actor,
  docId: string
) {
  const d = await one(q, "SELECT *,issue_date::text,due_date::text FROM documents WHERE id=$1 FOR UPDATE", [docId]);
  need(d, "Document not found.", 404);
  if (d.status === "ISSUED")
    return d;
  need(d.status === "DRAFT", "A cancelled document cannot be issued.", 409);
  const companyDefaults = await one(q, "SELECT * FROM company WHERE id='company'"),
    company = { ...companyDefaults, ...(d.company_snapshot || {}) },
    party = await one(q, "SELECT * FROM parties WHERE id=$1", [d.party_id]);
    // Production fiscal issue needs company-specific tax verification; preview never creates a legal tax document.
  if (d.kind === "INVOICE" && !company.demo)
    throw new AppError(
    409,
    "Live invoice issuance is gated until company tax configuration and required integrations are validated. Drafting and preview are available."
  );
  if (POSTING_DOCUMENTS.includes(d.kind))
    need(
      d.currency === "INR",
      "Foreign-currency documents cannot be posted yet because exchange-rate conversion is not implemented. Keep it as a quotation/proforma or issue it in INR.",
      409
    );
  const advance = new D(d.advance_amount || 0);
  if (d.kind === "INVOICE" && advance.gt(0))
    need(d.advance_account, "Choose the bank or cash account that received the advance before issuing.");
  const num = d.number.startsWith(DRAFT_PREFIX)
    ? await nextFreeNumber(q, DOCUMENT_PREFIX[d.kind], d.issue_date, "documents")
    : d.number;
  if (POSTING_DOCUMENTS.includes(d.kind)) {
    let lines: any[];
    if (d.kind === "BILL")
      lines = [
        { account: d.payment_method === "Cash" ? "1010" : "1000", debit: d.total },
        { account: d.income_account || "4000", credit: d.total }
      ];
    else
      lines = [{ account: "1100", debit: d.total }, { account: "4000", credit: d.subtotal }, ...outputTaxLines(d, "credit")];
    await writeJournal(
      q,
      actor,
      {
      date: d.issue_date,
      kind: d.kind,
      description: num + " · " + party.name,
      partyId: d.party_id,
      projectId: d.project_id,
      documentId: d.id,
      lines
    }
    );
  }
  await q.query(
    "UPDATE documents SET status='ISSUED',number=$3,snapshot=$2 WHERE id=$1",
    [docId, JSON.stringify({ company, party: d.client_snapshot || party, templateVersion: 1 }), num]
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
  await audit(q, actor, "document.issue", docId, { number: num });
  return { id: docId, status: "ISSUED", number: num };
}
export async function postPayment(
  q: Queryable,
  actor: Actor,
  b: any
) {
  const amount = new D(b.amount), allocs = b.allocations || [];
  need(amount.gt(0), "Payment must be positive.");
  // BILL documents are client payment receipts that settle on issue; there is no vendor-bill document to allocate against yet.
  need(
    b.direction === "RECEIPT",
    "Vendor bills are not enabled yet. Record vendor payments as expense vouchers."
  );
  const bank = await one(q, "SELECT * FROM accounts WHERE code=$1", [b.cashAccount]);
  need(bank?.is_cash, "Choose a bank/cash account.");
  let allocated = new D(0);
  const seen = new Set();
  for (const a of [...allocs].sort((x: any, y: any) => x.documentId.localeCompare(y.documentId))) {
    need(!seen.has(a.documentId), "Duplicate invoice allocation.");
    seen.add(a.documentId);
    const d = await one(q, "SELECT * FROM documents WHERE id=$1 FOR UPDATE", [a.documentId]);
    need(
      d?.status === "ISSUED" && d.party_id === b.partyId && d.kind === (b.direction === "RECEIPT" ? "INVOICE" : "BILL"),
      "Allocation does not match an issued document for this party."
    );
    const paid = await one(
      q,
      "SELECT COALESCE(SUM(amount),0)::text AS paid FROM allocations WHERE document_id=$1",
      [a.documentId]
    );
    need(
      new D(a.amount).gt(0) && new D(a.amount).lte(new D(d.total).sub(paid.paid)),
      "Allocation exceeds the outstanding balance."
    );
    allocated = allocated.add(a.amount);
  }
  need(allocated.lte(amount), "Allocations exceed the payment amount.");
  const remainder = amount.sub(allocated);
  if (b.direction === "PAYMENT")
    need(remainder.eq(0), "Vendor advances are not enabled; allocate the full payment to bills.");
  if (b.direction === "RECEIPT" && remainder.gt(0)) {
    const c = await one(q, "SELECT demo FROM company WHERE id='company'");
    need(
      c.demo,
      "Live advances require a verified GST advance workflow. Allocate against an issued invoice."
    );
  }
  let lines: any[] = [{ account: b.cashAccount, [b.direction === "RECEIPT" ? "debit" : "credit"]: amount.toFixed(2) }];
  if (allocated.gt(0))
    lines.push({
    account: b.direction === "RECEIPT" ? "1100" : "2000",
    [b.direction === "RECEIPT" ? "credit" : "debit"]: allocated.toFixed(2)
  });
  if (remainder.gt(0))
    lines.push({ account: "2300", credit: remainder.toFixed(2) });
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
    lines
  }
  );
  for (const a of allocs)
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
    "Correct document postings with a credit note (invoices) or cancellation (payment receipts)."
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
  const allocations = (await q.query("SELECT document_id,amount::text FROM allocations WHERE entry_id=$1", [e.id])).rows;
  for (const a of allocations)
    await q.query(
      "INSERT INTO allocations(id,entry_id,document_id,amount) VALUES($1,$2,$3,$4)",
      [id(), reversal.id, a.document_id, new D(a.amount).neg().toFixed(2)]
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
  const company = await one(q, "SELECT demo FROM company WHERE id='company'");
  if (!company.demo)
    throw new AppError(
    409,
    "Live credit notes are gated together with live invoice issuance until the company's GST workflow is validated."
  );
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
  const sums = calculateDocument({ taxTreatment: inv.tax_treatment, lines });
  need(
    new D(sums.total).lte(new D(inv.total).sub(await sumAllocations(q, invoiceId))),
    "The credit exceeds the invoice's outstanding balance. If the money was refunded, reverse the receipt first."
  );
  const docId = id(), num = await nextFreeNumber(q, "CN", b.date, "documents");
  await reserveDocumentNumber(q, num, docId);
  await q.query(
    "INSERT INTO documents(id,number,kind,status,party_id,project_id,issue_date,due_date,tax_treatment,tax_reason,place_of_supply,interstate,subtotal,tax,total,lines,notes,source_id,created_by,currency,client_snapshot,company_snapshot,snapshot) VALUES($1,$2,'CREDIT_NOTE','ISSUED',$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'INR',$17,$18,$19)",
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
    JSON.stringify(sums.lines),
    "Against " + inv.number + ": " + b.reason.trim(),
    inv.id,
    actor.id,
    inv.client_snapshot ? JSON.stringify(inv.client_snapshot) : null,
    inv.company_snapshot ? JSON.stringify(inv.company_snapshot) : null,
    inv.snapshot ? JSON.stringify(inv.snapshot) : null
  ]
  );
  const party = await one(q, "SELECT name FROM parties WHERE id=$1", [inv.party_id]);
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
      { account: "4000", debit: sums.subtotal },
      ...outputTaxLines({ tax: sums.tax, interstate: inv.interstate, lines: sums.lines }, "debit"),
      { account: "1100", credit: sums.total }
    ]
  }
  );
  // The credit settles part of the invoice exactly like a receipt would, so outstanding balances stay ledger-consistent.
  await q.query(
    "INSERT INTO allocations(id,entry_id,document_id,amount) VALUES($1,$2,$3,$4)",
    [id(), entry.id, inv.id, sums.total]
  );
  await audit(q, actor, "document.credit", docId, { number: num, invoice: inv.number, total: sums.total, reason: b.reason });
  return { id: docId, number: num };
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
    if (d.kind === "BILL") {
      const e = await one(q, "SELECT *,entry_date::text FROM journal_entries WHERE document_id=$1 FOR UPDATE", [docId]);
      if (e)
        await postReversal(q, actor, e, b.date, "Cancelled " + d.number + ": " + b.reason.trim());
    }
  }
  await q.query("UPDATE documents SET status='CANCELLED' WHERE id=$1", [docId]);
  await audit(q, actor, "document.cancel", docId, { number: d.number, previousStatus: d.status, reason: b.reason });
  return { id: docId, status: "CANCELLED" };
}
