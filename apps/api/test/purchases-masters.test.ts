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
  applyAdvance,
  cancelDocument,
  reverseJournal
} from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { verifyPassword, hashPassword } from "../src/auth.js";
import { ApiController } from "../src/api.js";
let db: Database, actor: any, vendor: string, client: string, api: ApiController, req: any;
const bill = (over: Record<string, any> = {}) => ({
  kind: "PURCHASE",
  partyId: vendor,
  reference: "SUP-" + id().slice(0, 6),
  date: "2026-12-02",
  dueDate: "2026-12-30",
  taxTreatment: "TAXABLE",
  placeOfSupply: "32",
  expenseAccount: "5300",
  lines: [{ description: "Consulting", quantity: "2", price: "500", taxRate: "18" }],
  ...over
});
const entryLines = async (where: string, args: any[]) => (await db.query(
  "SELECT l.account_code,l.debit::text,l.credit::text FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE " + where + " ORDER BY l.account_code",
  args
)).rows;
const outstanding = async (docId: string) => (await one(
  db,
  "SELECT (d.total-COALESCE((SELECT SUM(amount) FROM allocations WHERE document_id=d.id),0))::text AS due FROM documents d WHERE d.id=$1",
  [docId]
)).due;
const postBill = async (over: Record<string, any> = {}) => {
  const d = await db.tx(q => createDocument(q, actor, bill(over)));
  await db.tx(q => issueDocument(q, actor, d.id));
  return d.id;
};
before(async () => {
  db = await createDatabase({ embedded: true });
  await migrate(db);
  await bootstrap(db, { demo: true, seed: false, email: "p1@example.com", password: "test-password-long" });
  actor = await one(db, "SELECT id,role,name,email FROM users");
  vendor = id();
  client = id();
  await db.query("INSERT INTO parties(id,name,kind,gstin) VALUES($1,'Supply Co','VENDOR','32ABCDE1234F1Z5')", [vendor]);
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Buyer Ltd','CLIENT')", [client]);
  api = new ApiController(db);
  req = { user: actor, headers: {} };
});
after(async () => {
  await db?.close();
});
test("an intra-state vendor bill posts expense, input CGST/SGST and a payable", async () => {
  const d = await db.tx(q => createDocument(q, actor, bill({ reference: "SUP-001" })));
  assert.match(d.number, /^DRAFT-/);
  const issued = await db.tx(q => issueDocument(q, actor, d.id));
  assert.match(issued.number, /^PB\/2627\/\d{5}$/);
  assert.deepEqual(await entryLines("e.document_id=$1", [d.id]), [
    { account_code: "1200", debit: "90.00", credit: "0.00" },
    { account_code: "1210", debit: "90.00", credit: "0.00" },
    { account_code: "2000", debit: "0.00", credit: "1180.00" },
    { account_code: "5300", debit: "1000.00", credit: "0.00" }
  ]);
});
test("inter-state bills claim IGST; ineligible GST is part of the cost", async () => {
  const igst = await postBill({ placeOfSupply: "29" });
  assert.deepEqual((await entryLines("e.document_id=$1", [igst])).map(l => l.account_code), ["1220", "2000", "5300"]);
  const blocked = await postBill({ itcEligible: false });
  assert.deepEqual(await entryLines("e.document_id=$1", [blocked]), [
    { account_code: "2000", debit: "0.00", credit: "1180.00" },
    { account_code: "5300", debit: "1180.00", credit: "0.00" }
  ]);
});
test("vendor bills reject duplicates, clients, receivable accounts and missing bill numbers", async () => {
  await postBill({ reference: "DUP-9" });
  await assert.rejects(() => db.tx(q => createDocument(q, actor, bill({ reference: "dup-9" }))), /already entered/);
  await assert.rejects(() => db.tx(q => createDocument(q, actor, bill({ partyId: client }))), /Choose a vendor/);
  await assert.rejects(() => db.tx(q => createDocument(q, actor, bill({ expenseAccount: "1100" }))), /expense or fixed-asset/);
  await assert.rejects(() => db.tx(q => createDocument(q, actor, bill({ reference: " " }))), /bill number/);
  // A laptop bought on credit is a fixed asset, not an expense.
  const asset = await postBill({ expenseAccount: "1520" });
  assert((await entryLines("e.document_id=$1", [asset])).some(l => l.account_code === "1520"));
});
test("one vendor payment settles several bills and keeps the excess as a vendor advance", async () => {
  const a = await postBill(), b = await postBill();
  const pay = await db.tx(q => postPayment(q, actor, {
    direction: "PAYMENT", partyId: vendor, date: "2026-12-10", amount: "2000", cashAccount: "1000", description: "NEFT",
    allocations: [{ documentId: a, amount: "1180" }, { documentId: b, amount: "500" }]
  }));
  assert.deepEqual(await entryLines("e.id=$1", [pay.id]), [
    { account_code: "1000", debit: "0.00", credit: "2000.00" },
    { account_code: "1300", debit: "320.00", credit: "0.00" },
    { account_code: "2000", debit: "1680.00", credit: "0.00" }
  ]);
  assert.equal(await outstanding(a), "0.00");
  assert.equal(await outstanding(b), "680.00");
  await assert.rejects(
    () => db.tx(q => postPayment(q, actor, { direction: "PAYMENT", partyId: vendor, date: "2026-12-10", amount: "800", cashAccount: "1000", description: "Too much", allocations: [{ documentId: b, amount: "700" }] })),
    /outstanding balance/
  );
  // Apply the 320 advance to bill b; more than is available is refused.
  await assert.rejects(
    () => db.tx(q => applyAdvance(q, actor, { direction: "PAYMENT", partyId: vendor, date: "2026-12-11", allocations: [{ documentId: b, amount: "400" }] })),
    /Only 320.00/
  );
  const applied = await db.tx(q => applyAdvance(q, actor, { direction: "PAYMENT", partyId: vendor, date: "2026-12-11", allocations: [{ documentId: b, amount: "320" }] }));
  assert.deepEqual(await entryLines("e.id=$1", [applied.id]), [
    { account_code: "1300", debit: "0.00", credit: "320.00" },
    { account_code: "2000", debit: "320.00", credit: "0.00" }
  ]);
  assert.equal(await outstanding(b), "360.00");
  // The payment that created the advance cannot be reversed while the advance is applied.
  await assert.rejects(() => db.tx(q => reverseJournal(q, actor, pay.id, "2026-12-12", "Bank error")), /already been applied/);
  await db.tx(q => reverseJournal(q, actor, applied.id, "2026-12-12", "Wrong bill"));
  assert.equal(await outstanding(b), "680.00");
  await db.tx(q => reverseJournal(q, actor, pay.id, "2026-12-12", "Bank error"));
  assert.equal(await outstanding(a), "1180.00");
});
test("client advances are applied to invoices without creating income", async () => {
  const inv = await db.tx(q => createDocument(q, actor, { kind: "INVOICE", partyId: client, date: "2026-12-02", dueDate: "2026-12-16", taxTreatment: "TAXABLE", placeOfSupply: "32", lines: [{ description: "Work", quantity: "1", price: "1000", taxRate: "18" }] }));
  await db.tx(q => issueDocument(q, actor, inv.id));
  await db.tx(q => postPayment(q, actor, { direction: "RECEIPT", partyId: client, date: "2026-12-01", amount: "500", cashAccount: "1000", description: "Advance", allocations: [] }));
  const before = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  const applied = await db.tx(q => applyAdvance(q, actor, { direction: "RECEIPT", partyId: client, date: "2026-12-05", allocations: [{ documentId: inv.id, amount: "500" }] }));
  assert.deepEqual(await entryLines("e.id=$1", [applied.id]), [
    { account_code: "1100", debit: "0.00", credit: "500.00" },
    { account_code: "2300", debit: "500.00", credit: "0.00" }
  ]);
  const after = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(after.metrics.income, before.metrics.income);
  assert.equal(await outstanding(inv.id), "680.00");
  assert.equal(after.parties.find((p: any) => p.id === client).advance_received, "0.00");
});
test("a posted vendor bill is cancelled by reversal only while nothing is paid on it", async () => {
  const paid = await postBill();
  await db.tx(q => postPayment(q, actor, { direction: "PAYMENT", partyId: vendor, date: "2026-12-10", amount: "100", cashAccount: "1000", description: "Part", allocations: [{ documentId: paid, amount: "100" }] }));
  await assert.rejects(() => db.tx(q => cancelDocument(q, actor, paid, { date: "2026-12-12", reason: "Wrong" })), /Reverse them before/);
  const clean = await postBill({ reference: "CANCEL-ME" });
  await db.tx(q => cancelDocument(q, actor, clean, { date: "2026-12-12", reason: "Entered twice" }));
  const net = await one(db, "SELECT SUM(l.debit-l.credit)::text AS net FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='2000' AND (e.document_id=$1 OR e.reversal_of=(SELECT id FROM journal_entries WHERE document_id=$1))", [clean]);
  assert.equal(net.net, "0.00");
  // The cancelled bill frees its supplier bill number.
  await postBill({ reference: "CANCEL-ME" });
});
test("contacts and projects can be edited and archived; archived contacts cannot be used on new documents", async () => {
  const pid = (await api.party(req, { name: "Edit Me", kind: "CLIENT" })).id;
  await api.editParty(req, pid, { name: "Edited Name", kind: "BOTH", email: "x@example.com", gstin: "32abcde1234f1z5", archived: true });
  const p = await one(db, "SELECT * FROM parties WHERE id=$1", [pid]);
  assert.equal(p.name, "Edited Name");
  assert.equal(p.gstin, "32ABCDE1234F1Z5");
  assert.equal(p.archived, true);
  await assert.rejects(() => api.editParty(req, pid, { name: "Bad", kind: "BOTH", gstin: "NOTAGSTIN" }), /valid 15-character/);
  await assert.rejects(() => db.tx(q => createDocument(q, actor, { kind: "QUOTATION", partyId: pid, date: "2026-12-02", dueDate: "2026-12-16", taxTreatment: "TAXABLE", placeOfSupply: "32", lines: [{ description: "x", quantity: "1", price: "1", taxRate: "18" }] })), /archived/);
  // A vendor with bills cannot become client-only.
  await assert.rejects(() => api.editParty(req, vendor, { name: "Supply Co", kind: "CLIENT" }), /vendor bills/);
  const prj = (await api.project(req, { name: "Site build", partyId: null, budget: "100" })).id;
  await api.editProject(req, prj, { name: "Site build v2", partyId: client, budget: "250.50", archived: true });
  const saved = await one(db, "SELECT name,party_id,budget::text,archived FROM projects WHERE id=$1", [prj]);
  assert.deepEqual(saved, { name: "Site build v2", party_id: client, budget: "250.50", archived: true });
  const audit = await one(db, "SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='party.archive'", [pid]);
  assert.equal(audit.n, 1);
});
test("products and services are unique by name and appear in the overview", async () => {
  const item = await api.createItem(req, { name: "Logo design", hsn: "998391", rate: "15000", taxRate: "18" });
  await assert.rejects(() => api.createItem(req, { name: "logo DESIGN" }), /already exists/);
  await assert.rejects(() => api.createItem(req, { name: "Too taxed", taxRate: "101" }), /exceed 100/);
  await api.editItem(req, item.id, { name: "Logo design", hsn: "998391", rate: "16000", taxRate: "18", archived: true });
  const report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  const row = report.items.find((i: any) => i.id === item.id);
  assert.equal(row.rate, "16000.00");
  assert.equal(row.archived, true);
});
test("users can be edited and disabled, keeping one admin; passwords can be reset and changed", async () => {
  const accountant = (await api.user(req, { name: "Acc One", email: "acc@example.com", password: "accountant-pass-1", role: "ACCOUNTANT" })).id;
  await db.query("INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES('s-acc',$1,'c',now()+interval '1 hour')", [accountant]);
  await api.editUser(req, accountant, { name: "Acc Renamed", role: "VIEWER", active: false });
  assert.equal((await one(db, "SELECT COUNT(*)::int AS n FROM sessions WHERE user_id=$1", [accountant])).n, 0);
  await assert.rejects(() => api.editUser(req, actor.id, { name: "Me", role: "ACCOUNTANT", active: true }), /your own role/);
  await api.resetPassword(req, accountant, { password: "a-brand-new-password" });
  assert(verifyPassword("a-brand-new-password", (await one(db, "SELECT password_hash FROM users WHERE id=$1", [accountant])).password_hash));
  await assert.rejects(() => api.resetPassword(req, actor.id, { password: "another-password-1" }), /Change my password/);
  // Changing your own password needs the current one and signs out your other sessions.
  await db.query("UPDATE users SET password_hash=$2 WHERE id=$1", [actor.id, hashPassword("current-password-1")]);
  await db.query("INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES('s-other',$1,'c',now()+interval '1 hour')", [actor.id]);
  await assert.rejects(() => api.changePassword(req, { currentPassword: "wrong-password", newPassword: "next-password-12" }), /incorrect/);
  await api.changePassword(req, { currentPassword: "current-password-1", newPassword: "next-password-12" });
  assert(verifyPassword("next-password-12", (await one(db, "SELECT password_hash FROM users WHERE id=$1", [actor.id])).password_hash));
  assert.equal((await one(db, "SELECT COUNT(*)::int AS n FROM sessions WHERE id='s-other'")).n, 0);
});
test("attachments are checked by content, listed, downloaded and removed with an audit trail", async () => {
  const docId = await postBill();
  const pdf = Buffer.from("%PDF-1.4\n%test\n").toString("base64");
  const added = await api.upload(req, { entityType: "DOCUMENT", entityId: docId, fileName: "../bill?.pdf", contentType: "application/pdf", data: pdf });
  assert.equal(added.fileName, ".._bill_.pdf");
  await assert.rejects(
    () => api.upload(req, { entityType: "DOCUMENT", entityId: docId, fileName: "fake.png", contentType: "image/png", data: pdf }),
    /does not match its type/
  );
  await assert.rejects(
    () => api.upload(req, { entityType: "ENTRY", entityId: "missing", fileName: "x.pdf", contentType: "application/pdf", data: pdf }),
    /not found/
  );
  const list = await api.attachments({ entityType: "DOCUMENT", entityId: docId });
  assert.equal(list.length, 1);
  assert.equal(list[0].size, 15);
  const sent: Record<string, any> = {};
  await api.download(added.id, { setHeader: (k: string, v: string) => { sent[k] = v; }, end: (b: Buffer) => { sent.body = b; } } as any);
  assert.equal(sent["Content-Type"], "application/pdf");
  assert.match(sent["Content-Disposition"], /^attachment;/);
  assert.equal(Buffer.from(sent.body).toString("latin1").slice(0, 5), "%PDF-");
  const report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(report.attachmentCounts[docId], 1);
  await api.removeAttachment(req, added.id);
  assert.equal((await api.attachments({ entityType: "DOCUMENT", entityId: docId })).length, 0);
  assert.equal((await one(db, "SELECT COUNT(*)::int AS n FROM audit_events WHERE entity_id=$1", [added.id])).n, 2);
  const viewer = { user: { ...actor, role: "VIEWER" }, headers: {} };
  await assert.rejects(() => api.upload(viewer, { entityType: "DOCUMENT", entityId: docId, fileName: "x.pdf", contentType: "application/pdf", data: pdf }), /read-only/);
});
