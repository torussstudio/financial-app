import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import {
  id,
  postVoucher,
  createDocument,
  updateDocument,
  issueDocument,
  postPayment,
  reverseJournal,
  businessToday
} from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { ApiController } from "../src/api.js";
let db: Database, actor: any, pid: string, api: ApiController, req: any;
const base = {
  partyId: "",
  date: "2026-12-02",
  dueDate: "2026-12-16",
  placeOfSupply: "32",
  lines: [{ description: "Work", quantity: "1", price: "1000", taxRate: "18" }]
};
const entryLines = async (where: string, args: any[]) => (await db.query(
  "SELECT l.account_code,l.debit::text,l.credit::text FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE " + where + " ORDER BY l.account_code",
  args
)).rows;
before(async () => {
  db = await createDatabase({ embedded: true });
  await migrate(db);
  await bootstrap(db, { demo: true, seed: false, email: "fixes@example.com", password: "test-password-long" });
  actor = await one(db, "SELECT id,role FROM users");
  pid = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Fix client','CLIENT')", [pid]);
  base.partyId = pid;
  api = new ApiController(db);
  req = { user: actor, headers: {} };
});
after(async () => {
  await db?.close();
});
test("a payment receipt posts cash/bank against income and is not a payable", async () => {
  const receipt = { ...base, kind: "BILL", taxTreatment: "OUTSIDE_GST", taxReason: "Payment receipt", paymentMethod: "Cash", lines: [{ description: "Cash sale", quantity: "1", price: "750", taxRate: "0" }] };
  const d = await db.tx(q => createDocument(q, actor, receipt));
  assert.match(d.number, /^DRAFT-/);
  const issued = await db.tx(q => issueDocument(q, actor, d.id));
  assert.match(issued.number, /^BILL\/2627\/\d{5}$/);
  assert.deepEqual(await entryLines("e.document_id=$1", [d.id]), [
    { account_code: "1010", debit: "750.00", credit: "0.00" },
    { account_code: "4000", debit: "0.00", credit: "750.00" }
  ]);
  const r = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(r.metrics.income, "750.00");
  assert.equal(r.metrics.expenses, "0.00");
  assert.equal(r.metrics.payables, "0.00");
  const bank = await db.tx(q => createDocument(q, actor, { ...receipt, paymentMethod: "Cheque", incomeAccount: "4100" }));
  await db.tx(q => issueDocument(q, actor, bank.id));
  assert.deepEqual((await entryLines("e.document_id=$1", [bank.id])).map(l => l.account_code), ["1000", "4100"]);
});
test("editing a draft applies the same rules as creating it", async () => {
  const d = await db.tx(q => createDocument(q, actor, { ...base, kind: "BILL", taxTreatment: "OUTSIDE_GST", taxReason: "Payment receipt", paymentMethod: "Cash" }));
  await assert.rejects(
    () => db.tx(q => updateDocument(q, actor, d.id, { ...base, kind: "BILL", taxTreatment: "TAXABLE", paymentMethod: "Cash" })),
    /non-GST/
  );
  await assert.rejects(
    () => db.tx(q => updateDocument(q, actor, d.id, { ...base, kind: "BILL", taxTreatment: "OUTSIDE_GST", taxReason: "Payment receipt", paymentMethod: "Cash", incomeAccount: "1000" })),
    /income account/
  );
  await assert.rejects(
    () => db.tx(q => createDocument(q, actor, { ...base, kind: "QUOTATION", taxTreatment: "TAXABLE", advanceAmount: "10" })),
    /Only invoices/
  );
});
test("a manual number ahead of the sequence never blocks automatic numbering", async () => {
  const invoice = { ...base, kind: "INVOICE", taxTreatment: "TAXABLE" };
  const manual = await db.tx(q => createDocument(q, actor, { ...invoice, number: "INV/2627/00002" }));
  await db.tx(q => issueDocument(q, actor, manual.id));
  const numbers: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = await db.tx(q => createDocument(q, actor, invoice));
    numbers.push((await db.tx(q => issueDocument(q, actor, d.id))).number);
  }
  assert.deepEqual(numbers, ["INV/2627/00001", "INV/2627/00003", "INV/2627/00004"]);
  const next = (await one(db, "SELECT next_value FROM sequences WHERE prefix='JV' AND fy='2627'")).next_value;
  const taken = "JV/2627/" + String(next).padStart(5, "0");
  await db.tx(q => postPayment(q, actor, { direction: "RECEIPT", partyId: pid, date: "2026-12-03", amount: "10", cashAccount: "1000", description: "Manual number", number: taken, allocations: [{ documentId: manual.id, amount: "10" }] }));
  const after = await db.tx(q => postVoucher(q, actor, { kind: "EXPENSE", account: "5200", amount: "5", cashAccount: "1000", date: "2026-12-03", description: "After manual JV" }));
  assert.notEqual(after.number, taken);
});
test("abandoned invoice drafts leave no gap in the invoice series", async () => {
  const invoice = { ...base, kind: "INVOICE", taxTreatment: "TAXABLE", date: "2027-04-02", dueDate: "2027-04-20" };
  await db.tx(q => createDocument(q, actor, invoice));
  const kept = await db.tx(q => createDocument(q, actor, invoice));
  assert.equal((await db.tx(q => issueDocument(q, actor, kept.id))).number, "INV/2728/00001");
});
test("foreign-currency invoices can be drafted but not posted", async () => {
  const d = await db.tx(q => createDocument(q, actor, { ...base, kind: "INVOICE", taxTreatment: "TAXABLE", currency: "USD" }));
  await assert.rejects(() => db.tx(q => issueDocument(q, actor, d.id)), /exchange-rate/);
  assert.equal((await one(db, "SELECT status FROM documents WHERE id=$1", [d.id])).status, "DRAFT");
});
test("an advance recorded on an invoice is posted as an allocated receipt", async () => {
  const invoice = { ...base, kind: "INVOICE", taxTreatment: "TAXABLE", advanceAmount: "500.00", advanceStatus: "PARTIALLY_RECEIVED" };
  const missing = await db.tx(q => createDocument(q, actor, invoice));
  await assert.rejects(() => db.tx(q => issueDocument(q, actor, missing.id)), /received the advance/);
  const d = await db.tx(q => createDocument(q, actor, { ...invoice, advanceAccount: "1000" }));
  await db.tx(q => issueDocument(q, actor, d.id));
  assert.equal((await one(db, "SELECT SUM(amount)::text AS paid FROM allocations WHERE document_id=$1", [d.id])).paid, "500.00");
  const r = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(r.documents.find(x => x.id === d.id)?.paid, "500.00");
});
test("asset vouchers cannot post to control accounts such as receivables", async () => {
  const asset = { kind: "ASSET", cashAccount: "1000", amount: "100", date: "2026-12-04", description: "Asset purchase" };
  await assert.rejects(() => db.tx(q => postVoucher(q, actor, { ...asset, account: "1100" })), /does not match/);
  await assert.rejects(() => db.tx(q => postVoucher(q, actor, { ...asset, kind: "INVESTMENT", account: "1520" })), /does not match/);
  await db.tx(q => postVoucher(q, actor, { ...asset, account: "1520" }));
  await db.tx(q => postVoucher(q, actor, { ...asset, kind: "INVESTMENT", account: "1410" }));
});
test("vendor payments are rejected until vendor bills exist", async () => {
  await assert.rejects(
    () => db.tx(q => postPayment(q, actor, { direction: "PAYMENT", partyId: pid, date: "2026-12-05", amount: "10", cashAccount: "1000", description: "Vendor", allocations: [] })),
    /expense vouchers/
  );
});
test("budgets and recurring schedules use the end-date month and whole-month actuals", async () => {
  await db.query("INSERT INTO budgets(id,month,account_code,amount) VALUES($1,'2026-12','5300',1000)", [id()]);
  await db.tx(q => postVoucher(q, actor, { kind: "EXPENSE", account: "5300", amount: "300", cashAccount: "1000", date: "2026-12-01", description: "Early month" }));
  await db.tx(q => postVoucher(q, actor, { kind: "EXPENSE", account: "5300", amount: "200", cashAccount: "1000", date: "2026-12-28", description: "Late month" }));
  const r = await getReport(db, { from: "2026-07-01", to: "2026-12-10" });
  assert.equal(r.month, "2026-12");
  assert.equal(r.budgets.find(b => b.account_code === "5300")?.actual, "500.00");
});
test("reversing an entry releases its recurring month and bank match", async () => {
  const rule = await api.recurring(req, { name: "Office rent", kind: "EXPENSE", account: "5100", cashAccount: "1000", amount: "900", day: 5 });
  const posted = await api.confirmRecurring(req, rule.id, { month: "2026-12" });
  await api.bankImport(req, { account: "1000", lines: [{ date: "2026-12-05", reference: "RENT-12", description: "Rent", amount: "-900.00" }] });
  const line = await one(db, "SELECT id FROM bank_statement_lines WHERE reference='RENT-12'");
  await api.match(req, line.id, { entryId: posted.id });
  const reversal = await db.tx(q => reverseJournal(q, actor, posted.id, "2026-12-06", "Posted twice"));
  assert.equal((await one(db, "SELECT matched_entry_id FROM bank_statement_lines WHERE id=$1", [line.id])).matched_entry_id, null);
  await assert.rejects(() => api.match(req, line.id, { entryId: posted.id }), /cannot be matched/);
  await assert.rejects(() => api.match(req, line.id, { entryId: reversal.id }), /cannot be matched/);
  const again = await api.confirmRecurring(req, rule.id, { month: "2026-12" });
  assert.notEqual(again.id, posted.id);
});
test("identical rows within one statement import are kept; re-imports are skipped", async () => {
  const lines = [
    { date: "2026-12-07", reference: "UPI", description: "Tea", amount: "-40.00" },
    { date: "2026-12-07", reference: "UPI", description: "Tea", amount: "-40.00" }
  ];
  assert.deepEqual(await api.bankImport(req, { account: "1010", lines }), { added: 2, skipped: 0 });
  assert.deepEqual(await api.bankImport(req, { account: "1010", lines }), { added: 0, skipped: 2 });
});
test("quotation conversion keeps document details and dates the invoice today", async () => {
  const q1 = await db.tx(q => createDocument(q, actor, {
    ...base,
    kind: "QUOTATION",
    taxTreatment: "TAXABLE",
    date: "2026-11-01",
    dueDate: "2026-11-11",
    currency: "USD",
    client: { name: "Quoted name", address: "Quoted address", contactName: "Quoted contact", phone: "999" }
  }));
  const inv = await api.convert(req, q1.id);
  const d = await one(db, "SELECT issue_date::text,due_date::text,currency,client_snapshot FROM documents WHERE id=$1", [inv.id]);
  assert.equal(d.issue_date, businessToday());
  assert.equal(Math.round((Date.parse(d.due_date) - Date.parse(d.issue_date)) / 86400000), 10);
  assert.equal(d.currency, "USD");
  assert.equal(d.client_snapshot.name, "Quoted name");
  assert.equal(d.client_snapshot.contact_name, "Quoted contact");
});
test("custom category codes stay inside their range", async () => {
  const codes: string[] = [];
  for (let i = 0; i < 3; i++)
    codes.push((await api.account(req, { name: "Deposit scheme " + i, kind: "ASSET", voucherCategoryKind: "INVESTMENT" })).code);
  assert.deepEqual(codes, ["1900", "1901", "1902"]);
  assert.equal((await api.account(req, { name: "Studio lights", kind: "ASSET", voucherCategoryKind: "ASSET" })).code, "1800");
  await db.query("INSERT INTO accounts(code,name,kind) VALUES('1999','Range end','ASSET')");
  await assert.rejects(() => api.account(req, { name: "One too many", kind: "ASSET", voucherCategoryKind: "INVESTMENT" }), /No more account codes/);
});
test("voucher categories are tagged data, and legacy seeded names are migrated once", async () => {
  const first = await api.party(req, { name: "Owner One", kind: "BOTH", voucherCategoryKind: "CAPITAL_IN" });
  const second = await api.party(req, { name: "owner one", kind: "BOTH", voucherCategoryKind: "REIMBURSEMENT" });
  assert.equal(second.id, first.id);
  assert.equal((await one(db, "SELECT voucher_category_kind FROM parties WHERE id=$1", [first.id])).voucher_category_kind, "CAPITAL_IN,REIMBURSEMENT");
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM parties WHERE lower(name) IN ('rohini','rohini k','sreejith')")).n, 0);
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Rohini','BOTH'),($2,'Rohini K','BOTH')", [id(), id()]);
  await db.query("DELETE FROM schema_versions WHERE version=2");
  await migrate(db);
  const tags = (await db.query("SELECT name,voucher_category_kind FROM parties WHERE name IN ('Rohini','Rohini K') ORDER BY name")).rows;
  assert.deepEqual(tags.map(t => t.voucher_category_kind), ["CAPITAL_IN,REIMBURSEMENT", "CAPITAL_RETURN"]);
});
