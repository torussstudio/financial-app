import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import {
  id,
  createDocument,
  issueDocument,
  postPayment,
  reverseJournal,
  issueCreditNote,
  cancelDocument
} from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { ApiController } from "../src/api.js";
let db: Database, actor: any, pid: string, api: ApiController, req: any;
const invoiceInput = (extra: any = {}) => ({
  kind: "INVOICE",
  partyId: pid,
  date: "2026-12-02",
  dueDate: "2026-12-16",
  taxTreatment: "TAXABLE",
  placeOfSupply: "32",
  lines: [
    { description: "Design", quantity: "2", price: "1000", taxRate: "18" },
    { description: "Print", quantity: "1", price: "500", taxRate: "18" }
  ],
  ...extra
});
const issueInvoice = async (extra: any = {}) => {
  const d = await db.tx(q => createDocument(q, actor, invoiceInput(extra)));
  await db.tx(q => issueDocument(q, actor, d.id));
  return d.id;
};
const lines = async (entryId: string) => (await db.query(
  "SELECT account_code,debit::text,credit::text FROM journal_lines WHERE entry_id=$1 ORDER BY account_code",
  [entryId]
)).rows;
const settled = async (docId: string) => (await one(db, "SELECT COALESCE(SUM(amount),0)::text AS s FROM allocations WHERE document_id=$1", [docId])).s;
const balance = async (code: string) => (await one(db, "SELECT COALESCE(SUM(debit-credit),0)::numeric(18,2)::text AS b FROM journal_lines WHERE account_code=$1", [code])).b;
before(async () => {
  db = await createDatabase({ embedded: true });
  await migrate(db);
  await bootstrap(db, { demo: true, seed: false, email: "corrections@example.com", password: "test-password-long" });
  actor = await one(db, "SELECT id,role FROM users");
  pid = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Correction client','CLIENT')", [pid]);
  api = new ApiController(db);
  req = { user: actor, headers: {} };
});
after(async () => {
  await db?.close();
});
test("reversing a receipt restores the invoice balance and cash, preserving history", async () => {
  const inv = await issueInvoice();
  const receipt = await db.tx(q => postPayment(q, actor, {
    direction: "RECEIPT", partyId: pid, date: "2026-12-05", amount: "500", cashAccount: "1000", description: "Part payment",
    allocations: [{ documentId: inv, amount: "500" }]
  }));
  assert.equal(await settled(inv), "500.00");
  await assert.rejects(() => db.tx(q => reverseJournal(q, actor, receipt.id, "2026-12-04", "Too early")), /before the original/);
  const reversal = await db.tx(q => reverseJournal(q, actor, receipt.id, "2026-12-08", "Cheque bounced"));
  assert.equal(await settled(inv), "0.00");
  assert.equal(await balance("1000"), "0.00");
  assert.deepEqual(await lines(reversal.id), [
    { account_code: "1000", debit: "0.00", credit: "500.00" },
    { account_code: "1100", debit: "500.00", credit: "0.00" }
  ]);
  const before = await getReport(db, { from: "2026-12-01", to: "2026-12-06" });
  const afterRev = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(before.documents.find(d => d.id === inv)?.paid, "500.00");
  assert.equal(afterRev.documents.find(d => d.id === inv)?.paid, "0.00");
  assert.ok((await one(db, "SELECT id FROM journal_entries WHERE id=$1", [receipt.id])));
  await assert.rejects(() => db.tx(q => reverseJournal(q, actor, receipt.id, "2026-12-09", "Again")), /already reversed/);
});
test("a partial credit note reverses revenue and output tax and settles the invoice", async () => {
  const inv = await issueInvoice();
  const cn = await db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-10", reason: "One design cancelled", lines: [{ line: 0, quantity: "1" }] }));
  assert.match(cn.number, /^CN\/2627\/\d{5}$/);
  const entry = await one(db, "SELECT id FROM journal_entries WHERE document_id=$1", [cn.id]);
  assert.deepEqual(await lines(entry.id), [
    { account_code: "1100", debit: "0.00", credit: "1180.00" },
    { account_code: "2100", debit: "90.00", credit: "0.00" },
    { account_code: "2110", debit: "90.00", credit: "0.00" },
    { account_code: "4000", debit: "1000.00", credit: "0.00" }
  ]);
  assert.equal(await settled(inv), "1180.00");
  await assert.rejects(
    () => db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-10", reason: "Too much", lines: [{ line: 0, quantity: "2" }] })),
    /exceeds what remains on line 1/
  );
  const r = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  const row = r.documents.find(d => d.id === inv)!;
  assert.equal(row.credited, "1180.00");
  assert.equal((await api.getDocument(cn.id)).source_number, (await one(db, "SELECT number FROM documents WHERE id=$1", [inv])).number);
});
test("credit notes cannot exceed the outstanding balance and keep inter-state tax", async () => {
  const inv = await issueInvoice({ placeOfSupply: "29" });
  await db.tx(q => postPayment(q, actor, {
    direction: "RECEIPT", partyId: pid, date: "2026-12-05", amount: "2000", cashAccount: "1000", description: "Most of it",
    allocations: [{ documentId: inv, amount: "2000" }]
  }));
  await assert.rejects(
    () => db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-10", reason: "Full credit", lines: [{ line: 0, quantity: "2" }, { line: 1, quantity: "1" }] })),
    /outstanding balance/
  );
  const cn = await db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-10", reason: "Print cancelled", lines: [{ line: 1, quantity: "1" }] }));
  const entry = await one(db, "SELECT id FROM journal_entries WHERE document_id=$1", [cn.id]);
  assert.deepEqual((await lines(entry.id)).map(l => l.account_code), ["1100", "2120", "4000"]);
  assert.equal(await settled(inv), "2590.00");
});
test("credit notes require an issued invoice, a valid date and demo-mode gating", async () => {
  const draft = await db.tx(q => createDocument(q, actor, invoiceInput()));
  await assert.rejects(() => db.tx(q => issueCreditNote(q, actor, draft.id, { date: "2026-12-10", reason: "Draft", lines: [{ line: 0, quantity: "1" }] })), /issued invoice/);
  const inv = await issueInvoice();
  await assert.rejects(() => db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-01", reason: "Early", lines: [{ line: 0, quantity: "1" }] })), /before its invoice/);
  await db.query("UPDATE company SET demo=false");
  try {
    await assert.rejects(() => db.tx(q => issueCreditNote(q, actor, inv, { date: "2026-12-10", reason: "Live", lines: [{ line: 0, quantity: "1" }] })), /gated/);
  }
  finally {
    await db.query("UPDATE company SET demo=true");
  }
  const entry = await one(db, "SELECT id FROM journal_entries WHERE document_id=$1", [inv]);
  await assert.rejects(() => db.tx(q => reverseJournal(q, actor, entry.id, "2026-12-10", "Direct")), /credit note/);
});
test("cancelling drafts, quotations and payment receipts", async () => {
  const draft = await db.tx(q => createDocument(q, actor, invoiceInput()));
  await db.tx(q => cancelDocument(q, actor, draft.id, { date: "2026-12-10", reason: "Raised by mistake" }));
  await assert.rejects(() => db.tx(q => issueDocument(q, actor, draft.id)), /cancelled/);
  await assert.rejects(() => db.tx(q => cancelDocument(q, actor, draft.id, { date: "2026-12-10", reason: "Again" })), /already cancelled/);
  const inv = await issueInvoice();
  await assert.rejects(() => db.tx(q => cancelDocument(q, actor, inv, { date: "2026-12-10", reason: "Wrong" })), /credit note/);
  const cashBefore = await balance("1010"), incomeBefore = await balance("4000");
  const receipt = await db.tx(q => createDocument(q, actor, {
    kind: "BILL", partyId: pid, date: "2026-12-03", dueDate: "2026-12-03", taxTreatment: "OUTSIDE_GST", taxReason: "Payment receipt",
    placeOfSupply: "32", paymentMethod: "Cash", lines: [{ description: "Cash sale", quantity: "1", price: "300", taxRate: "0" }]
  }));
  await db.tx(q => issueDocument(q, actor, receipt.id));
  await db.tx(q => cancelDocument(q, actor, receipt.id, { date: "2026-12-04", reason: "Entered twice" }));
  assert.equal(await balance("1010"), cashBefore);
  assert.equal(await balance("4000"), incomeBefore);
  assert.equal((await one(db, "SELECT status FROM documents WHERE id=$1", [receipt.id])).status, "CANCELLED");
});
test("a cancelled quotation cannot convert; a cancelled conversion frees the quotation", async () => {
  const quote = await db.tx(q => createDocument(q, actor, { ...invoiceInput(), kind: "QUOTATION" }));
  const first = await api.convert(req, quote.id);
  assert.equal((await api.convert(req, quote.id)).id, first.id);
  await db.tx(q => cancelDocument(q, actor, first.id, { date: "2026-12-10", reason: "Wrong rates" }));
  const second = await api.convert(req, quote.id);
  assert.notEqual(second.id, first.id);
  await db.tx(q => cancelDocument(q, actor, quote.id, { date: "2026-12-10", reason: "Client declined" }));
  const other = await db.tx(q => createDocument(q, actor, { ...invoiceInput(), kind: "QUOTATION" }));
  await db.tx(q => cancelDocument(q, actor, other.id, { date: "2026-12-10", reason: "Client declined" }));
  await assert.rejects(() => api.convert(req, other.id), /active quotations/);
});
