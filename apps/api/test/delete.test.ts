import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import { id, createDocument, issueDocument, postPayment, postVoucher, reverseJournal } from "../src/accounting.js";
import { ApiController } from "../src/api.js";

let db: Database, actor: any, pid: string, api: ApiController, req: any;
const count = async (sql: string, args: any[] = []) => Number((await one(db, sql, args)).n);

before(async () => {
  db = await createDatabase({ embedded: true });
  await migrate(db);
  await bootstrap(db, { demo: true, seed: false, email: "delete@example.com", password: "test-password-long" });
  actor = await one(db, "SELECT id,role FROM users");
  pid = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Delete client','CLIENT')", [pid]);
  api = new ApiController(db);
  req = { user: actor, headers: {} };
});
after(async () => { await db?.close(); });

test("deleting a voucher removes it, its reversal and its lines; protection is back afterwards", async () => {
  const v = await db.tx(q => postVoucher(q, actor, { kind: "EXPENSE", date: "2026-11-20", amount: "750", cashAccount: "1000", account: "5100", description: "Test expense" }));
  const r = await db.tx(q => reverseJournal(q, actor, v.id, "2026-11-21", "test"));
  await api.purgeEntry(req, r.id);
  assert.equal(await count("SELECT count(*) n FROM journal_entries WHERE id=ANY($1)", [[v.id, r.id]]), 0);
  assert.equal(await count("SELECT count(*) n FROM journal_lines WHERE entry_id=ANY($1)", [[v.id, r.id]]), 0);
  // Ordinary deletes are still blocked once the purge is done.
  const other = await db.tx(q => postVoucher(q, actor, { kind: "EXPENSE", date: "2026-11-22", amount: "10", cashAccount: "1000", account: "5100", description: "Stays" }));
  await assert.rejects(() => db.query("DELETE FROM journal_lines WHERE entry_id=$1", [other.id]), /immutable/);
});

test("an entry posted by a document can only go with the document; deleting the document keeps the receipt as an advance", async () => {
  const d = await db.tx(q => createDocument(q, actor, {
    kind: "INVOICE", partyId: pid, date: "2026-11-02", dueDate: "2026-11-16", taxTreatment: "TAXABLE", placeOfSupply: "32",
    lines: [{ description: "Design", quantity: "1", price: "1000", taxRate: "18" }]
  }));
  await db.tx(q => issueDocument(q, actor, d.id));
  const posted = await one(db, "SELECT id FROM journal_entries WHERE document_id=$1", [d.id]);
  const receipt = await db.tx(q => postPayment(q, actor, {
    direction: "RECEIPT", partyId: pid, date: "2026-11-05", amount: "500", cashAccount: "1000", description: "Part",
    allocations: [{ documentId: d.id, amount: "500" }]
  }));
  await assert.rejects(() => api.purgeEntry(req, posted.id), /Delete that document/);
  await api.purgeDocument(req, d.id);
  assert.equal(await count("SELECT count(*) n FROM documents WHERE id=$1", [d.id]), 0);
  assert.equal(await count("SELECT count(*) n FROM journal_entries WHERE id=$1", [posted.id]), 0);
  assert.equal(await count("SELECT count(*) n FROM journal_entries WHERE id=$1", [receipt.id]), 1);
  assert.equal(await count("SELECT count(*) n FROM allocations WHERE entry_id=$1", [receipt.id]), 0);
  // The receipt itself can then be deleted, which leaves the contact free to delete too.
  await api.purgeEntry(req, receipt.id);
  await api.removeParty(req, pid);
  assert.equal(await count("SELECT count(*) n FROM parties WHERE id=$1", [pid]), 0);
});

test("only administrators can delete", async () => {
  await assert.rejects(() => api.purgeEntry({ user: { ...actor, role: "ACCOUNTANT" }, headers: {} }, "x"), /Administrator/);
});
