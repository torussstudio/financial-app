import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import { id, createDocument, issueDocument, postPayment } from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { buildEinvoice } from "../src/gst-returns.js";
// Regressions found while testing the screens in the browser.
const dbs: Database[] = [];
after(async () => { for (const db of dbs) await db.close(); });
const fresh = async (seed: boolean) => {
  const db = await createDatabase({ embedded: true });
  dbs.push(db);
  await migrate(db);
  await bootstrap(db, { demo: true, seed, email: "fixes@example.com", password: "test-password-long" });
  return db;
};
test("documents report the all-time settled amount next to the as-of amount, so payment dialogs never offer a settled balance", async () => {
  const db = await fresh(false);
  const actor = await one(db, "SELECT id,role FROM users");
  const pid = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Later payer','CLIENT')", [pid]);
  const inv = await db.tx(q => createDocument(q, actor, { kind: "INVOICE", partyId: pid, date: "2026-11-02", dueDate: "2026-11-20", taxTreatment: "TAXABLE", placeOfSupply: "32", lines: [{ description: "Work", quantity: "1", price: "1000", taxRate: "18" }] }));
  await db.tx(q => issueDocument(q, actor, inv.id));
  await db.tx(q => postPayment(q, actor, { direction: "RECEIPT", partyId: pid, date: "2026-11-12", amount: "1180", cashAccount: "1000", description: "Later", allocations: [{ documentId: inv.id, amount: "1180" }] }));
  const asOf = (await getReport(db, { from: "2026-11-01", to: "2026-11-06" })).documents.find((d: any) => d.id === inv.id);
  assert.equal(Number(asOf.paid), 0);
  assert.equal(asOf.paid_all, "1180.00");
});
test("e-invoice preparation reports missing seller and buyer addresses", () => {
  const d = { kind: "INVOICE", status: "ISSUED", tax_treatment: "TAXABLE", interstate: false, number: "INV/1", issue_date: "2026-11-06", total: "1180.00", subtotal: "1000.00", tax: "180.00",
    lines: [{ description: "Work", quantity: "1", price: "1000.00", taxRate: "18", base: "1000.00", tax: "180.00", hsn: "998391" }],
    client_snapshot: { name: "Buyer", gstin: "32AAACK9876L1Z2", address: "" } };
  const { issues } = buildEinvoice(d, { name: "Seller", gstin: "32AABCN1234F1Z5", state_code: "32", address: "", city: "", pin_code: "682016" });
  assert(issues.some((i: string) => i.includes("SellerDtls.Addr1")));
  assert(issues.some((i: string) => i.includes("SellerDtls.Loc")));
  assert(issues.some((i: string) => i.includes("BuyerDtls.Addr1")));
});
test("the demo seed never posts an entry dated after today", async () => {
  const db = await fresh(true);
  const today = new Date().toISOString().slice(0, 10);
  const late = await one(db, "SELECT COUNT(*)::int AS n FROM journal_entries WHERE entry_date>$1::date", [today]);
  assert.equal(late.n, 0);
});
