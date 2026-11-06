// Priority 2 — GST & compliance: TDS, debit notes, reverse charge, zero-rated/export and foreign-currency posting,
// GSTR-1/3B working exports, e-invoice preparation. Every posting path asserts its exact journal lines and has a
// reversal/cancellation that returns its balances to zero; the trial balance is checked after every test.
import "reflect-metadata";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import {
  id,
  createDocument,
  issueDocument,
  postPayment,
  reverseJournal,
  cancelDocument,
  issueCreditNote,
  issueDebitNote,
  issueSalesDebitNote,
  postTdsDeposit,
  tdsPayableSummary,
  writeJournal
} from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { ApiController } from "../src/api.js";
import { buildGstReturns, setOff } from "../src/gst-returns.js";
import { D } from "../src/accounting.js";

const COMPANY_GSTIN = "32AAACN1234A1Z5";
let db: Database, actor: any, api: ApiController, req: any;
const P: Record<string, string> = {};

async function freshBooks() {
  const d = await createDatabase({ embedded: true });
  await migrate(d);
  await bootstrap(d, { demo: true, seed: false, email: "gst@example.com", password: "test-password-long" });
  await d.query("UPDATE company SET gstin=$1,state_code='32',address='MG Road, Kochi',pin_code='682016'", [COMPANY_GSTIN]);
  const parties: Record<string, string> = {};
  for (const [key, name, kind, gstin, address] of [
    ["r32", "Kochi Media", "CLIENT", "32AABCK1234L1Z2", "Panampilly Nagar, Kochi 682036"],
    ["r29", "Bengaluru Labs", "CLIENT", "29AABCB5678M1Z9", "Indiranagar, Bengaluru 560038"],
    ["ur", "Walk-in Buyer", "CLIENT", null, "Thrissur"],
    ["foreign", "Austin Ventures", "CLIENT", null, "12 Main St, Austin TX, USA"],
    ["tdsClient", "TDS Client", "CLIENT", "32AAECT4321K1Z3", "Kakkanad, Kochi"],
    ["vend", "Registered Supplies", "VENDOR", "32AAFCV1111Q1Z7", "Aluva"],
    ["urVend", "Local Advocate", "VENDOR", null, "Ernakulam"],
    ["tdsVend", "Freelance Studio", "VENDOR", "32AAGFF2222R1Z1", "Kochi"]
  ] as const) {
    parties[key] = id();
    await d.query("INSERT INTO parties(id,name,kind,gstin,address) VALUES($1,$2,$3,$4,$5)", [parties[key], name, kind, gstin, address]);
  }
  const user = await one(d, "SELECT id,role,name,email FROM users");
  return { d, parties, user };
}
const linesOf = async (where: string, args: any[], on: Database = db) => (await on.query(
  "SELECT l.account_code,l.debit::text,l.credit::text FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE " + where + " ORDER BY l.account_code,l.debit,l.credit",
  args
)).rows;
const docEntry = async (docId: string) => (await one(db, "SELECT id FROM journal_entries WHERE document_id=$1", [docId])).id;
// Net movement per account of an entry and its reversal (zero for every account once reversed).
const netWithReversal = async (entryId: string) => (await db.query(
  "SELECT l.account_code,SUM(l.debit-l.credit)::text AS net FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.id=$1 OR e.reversal_of=$1 GROUP BY l.account_code ORDER BY l.account_code",
  [entryId]
)).rows;
const assertAllZero = (rows: any[]) => { assert(rows.length > 0); for (const r of rows) assert.equal(r.net, "0.00", "account " + r.account_code + " did not return to zero"); };
// Outstanding = total − allocations, in INR and (for a foreign-currency document) in its own currency.
const due = async (docId: string, on: Database = db) => {
  const r = await one(
    on,
    "SELECT (COALESCE(d.total_inr,d.total)-COALESCE((SELECT SUM(amount) FROM allocations WHERE document_id=d.id),0))::text AS inr,(d.total-COALESCE((SELECT SUM(foreign_amount) FROM allocations WHERE document_id=d.id),0))::text AS fc FROM documents d WHERE d.id=$1",
    [docId]
  );
  return { inr: r.inr, foreign: r.fc };
};
const balance = async (code: string) => (await one(db, "SELECT COALESCE(SUM(debit-credit),0)::text AS b FROM journal_lines WHERE account_code=$1", [code])).b;
async function assertTrialBalance(on: Database) {
  const t = await one(on, "SELECT COALESCE(SUM(debit),0)::text AS dr,COALESCE(SUM(credit),0)::text AS cr FROM journal_lines");
  assert.equal(t.dr, t.cr, "trial balance does not balance");
  const r = await getReport(on, { from: "2026-04-01", to: "2027-03-31" });
  const net = r.balances.reduce((s: any, a: any) => s.add(a.balance), new D(0));
  assert.equal(net.toFixed(2), "0.00", "trial balance report does not net to zero");
}
const invoice = (over: Record<string, any> = {}) => ({
  kind: "INVOICE", partyId: P.r32, date: "2026-12-02", dueDate: "2026-12-20", taxTreatment: "TAXABLE", placeOfSupply: "32",
  lines: [{ description: "Design work", quantity: "1", price: "10000", taxRate: "18", hsn: "998391" }], ...over
});
const bill = (over: Record<string, any> = {}) => ({
  kind: "PURCHASE", partyId: P.vend, reference: "SUP-" + id().slice(0, 8), date: "2026-12-03", dueDate: "2026-12-30", taxTreatment: "TAXABLE",
  placeOfSupply: "32", expenseAccount: "5300", lines: [{ description: "Consulting", quantity: "1", price: "1000", taxRate: "18" }], ...over
});
async function issue(input: Record<string, any>, opts: { exchangeRate?: string } = {}, on: Database = db, who: any = actor) {
  const d = await on.tx(q => createDocument(q, who, input));
  const r: any = await on.tx(q => issueDocument(q, who, d.id, opts));
  return { ...r, id: d.id };
}
const pay = (b: Record<string, any>, on: Database = db, who: any = actor) => on.tx(q => postPayment(q, who, { cashAccount: "1000", description: "Bank transfer", ...b }));

before(async () => {
  const f = await freshBooks();
  db = f.d;
  Object.assign(P, f.parties);
  actor = f.user;
  api = new ApiController(db);
  req = { user: actor, headers: {} };
});
after(async () => {
  await db?.close();
});
afterEach(async () => {
  await assertTrialBalance(db);
});

// ---------------------------------------------------------------- 1. TDS
test("schema version 4 is recorded and the new accounts exist with the right types", async () => {
  assert.ok(await one(db, "SELECT 1 FROM schema_versions WHERE version=4"));
  const accounts = (await db.query("SELECT code,kind FROM accounts WHERE code IN ('1250','2130','2140','2150','2400','4200','5700') ORDER BY code")).rows;
  assert.deepEqual(accounts, [
    { code: "1250", kind: "ASSET" }, { code: "2130", kind: "LIABILITY" }, { code: "2140", kind: "LIABILITY" }, { code: "2150", kind: "LIABILITY" },
    { code: "2400", kind: "LIABILITY" }, { code: "4200", kind: "INCOME" }, { code: "5700", kind: "EXPENSE" }
  ]);
  // Migration and bootstrap are idempotent.
  await migrate(db);
  await bootstrap(db, { demo: true, seed: false, email: "gst@example.com", password: "test-password-long" });
  // A database that already uses a new code for a different kind of account refuses to start instead of misposting.
  const clash = await createDatabase({ embedded: true });
  try {
    await migrate(clash);
    await clash.query("INSERT INTO accounts(code,name,kind) VALUES('2400','Old deposits','ASSET')");
    await assert.rejects(() => bootstrap(clash, { demo: true, seed: false, email: "c@example.com", password: "test-password-long" }), /reserved for TDS payable/);
  }
  finally {
    await clash.close();
  }
});
test("a receipt with client TDS posts bank + TDS receivable against receivables, and reverses to zero", async () => {
  const inv = await issue(invoice({ partyId: P.tdsClient }));
  await assert.rejects(() => pay({ direction: "RECEIPT", partyId: P.tdsClient, date: "2026-12-10", amount: "500", tdsAmount: "50", allocations: [] }), /at least one allocated invoice/);
  await assert.rejects(() => pay({ direction: "RECEIPT", partyId: P.tdsClient, date: "2026-12-10", amount: "100", tdsAmount: "200", allocations: [{ documentId: inv.id, amount: "100" }] }), /cannot exceed the amount allocated/);
  await assert.rejects(() => pay({ direction: "RECEIPT", partyId: P.tdsClient, date: "2026-12-10", amount: "10000", tdsAmount: "1000", allocations: [{ documentId: inv.id, amount: "11800" }] }), /exceed the payment amount plus TDS/);
  const receipt = await pay({ direction: "RECEIPT", partyId: P.tdsClient, date: "2026-12-10", amount: "10800", tdsAmount: "1000", description: "NEFT less TDS 194J", allocations: [{ documentId: inv.id, amount: "11800" }] });
  assert.deepEqual(await linesOf("e.id=$1", [receipt.id]), [
    { account_code: "1000", debit: "10800.00", credit: "0.00" },
    { account_code: "1100", debit: "0.00", credit: "11800.00" },
    { account_code: "1250", debit: "1000.00", credit: "0.00" }
  ]);
  assert.deepEqual((await one(db, "SELECT tds FROM journal_entries WHERE id=$1", [receipt.id])).tds, { direction: "RECEIVABLE", amount: "1000.00" });
  assert.equal((await due(inv.id)).inr, "0.00");
  let report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  const row = report.tds.receivable.find((r: any) => r.party_id === P.tdsClient);
  assert.deepEqual([row.in_range, row.balance, row.receipts], ["1000.00", "1000.00", 1]);
  // The receipt and allocation views show the TDS line.
  const view = await api.receipt(receipt.id);
  assert.deepEqual([view.amount, view.tds_amount, view.gross_amount], ["10800.00", "1000.00", "11800.00"]);
  // Reversal reverses the TDS line through postReversal and re-opens the invoice.
  const rev = await db.tx(q => reverseJournal(q, actor, receipt.id, "2026-12-11", "Cheque bounced"));
  assert.deepEqual(await linesOf("e.id=$1", [rev.id]), [
    { account_code: "1000", debit: "0.00", credit: "10800.00" },
    { account_code: "1100", debit: "11800.00", credit: "0.00" },
    { account_code: "1250", debit: "0.00", credit: "1000.00" }
  ]);
  assertAllZero(await netWithReversal(receipt.id));
  assert.equal((await due(inv.id)).inr, "11800.00");
  report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(report.tds.receivable.find((r: any) => r.party_id === P.tdsClient), undefined);
  // TDS fields must match the payment direction.
  await assert.rejects(() => api.pay({ ...req, headers: { "idempotency-key": "tds-dir-check-01" } }, {
    direction: "RECEIPT", partyId: P.tdsClient, date: "2026-12-10", cashAccount: "1000", amount: "10", description: "Wrong",
    tds: { section: "194J", rate: "10", amount: "1" }, allocations: [{ documentId: inv.id, amount: "10" }]
  }), /TDS fields do not match/);
});
test("a vendor payment with TDS posts gross payable against net bank and TDS payable; deposits and reversals stay within what is due", async () => {
  const billId = (await issue(bill({ partyId: P.tdsVend, expenseAccount: "5300", lines: [{ description: "Design retainer", quantity: "1", price: "50000", taxRate: "18" }] }))).id;
  await assert.rejects(() => pay({ direction: "PAYMENT", partyId: P.tdsVend, date: "2026-12-10", amount: "54000", tds: { section: "194X", rate: "10", amount: "5000" }, allocations: [{ documentId: billId, amount: "59000" }] }), /TDS section/);
  const payment = await api.pay({ ...req, headers: { "idempotency-key": "tds-vendor-pay-0001" } }, {
    direction: "PAYMENT", partyId: P.tdsVend, date: "2026-12-10", cashAccount: "1000", amount: "54000", description: "NEFT net of TDS",
    tds: { section: "194J", rate: "10", amount: "5000" }, allocations: [{ documentId: billId, amount: "59000" }]
  });
  assert.deepEqual(await linesOf("e.id=$1", [payment.id]), [
    { account_code: "1000", debit: "0.00", credit: "54000.00" },
    { account_code: "2000", debit: "59000.00", credit: "0.00" },
    { account_code: "2400", debit: "0.00", credit: "5000.00" }
  ]);
  assert.deepEqual((await one(db, "SELECT tds FROM journal_entries WHERE id=$1", [payment.id])).tds, { direction: "PAYABLE", section: "194J", rate: "10", amount: "5000.00" });
  assert.equal((await due(billId)).inr, "0.00");
  const view = await api.receipt(payment.id);
  assert.deepEqual([view.amount, view.tds_amount, view.gross_amount, view.tds_detail.section], ["54000.00", "5000.00", "59000.00", "194J"]);
  const summary = async () => (await tdsPayableSummary(db)).find(r => r.section === "194J" && r.period === "2026-12");
  assert.deepEqual(await summary(), { section: "194J", period: "2026-12", deducted: "5000.00", deposited: "0.00", due: "5000.00", dueBy: "2027-01-07" });
  const depositReq = { ...req, headers: { "idempotency-key": "tds-deposit-key-0001" } };
  await assert.rejects(() => db.tx(q => postTdsDeposit(q, actor, { date: "2027-01-05", cashAccount: "1000", amount: "6000", section: "194J", period: "2026-12", challan: "0510308-05012027-00012" })), /Only 5000.00/);
  await assert.rejects(() => db.tx(q => postTdsDeposit(q, actor, { date: "2026-11-30", cashAccount: "1000", amount: "100", section: "194J", period: "2026-12", challan: "0510308-x" })), /not after the deposit date/);
  const deposit = await api.tdsDeposit(depositReq, { date: "2027-01-05", cashAccount: "1000", amount: "3000", section: "194J", period: "2026-12", challan: "0510308-05012027-00012" });
  // Retrying with the same key returns the same voucher.
  assert.equal((await api.tdsDeposit(depositReq, { date: "2027-01-05", cashAccount: "1000", amount: "3000", section: "194J", period: "2026-12", challan: "0510308-05012027-00012" })).id, deposit.id);
  assert.deepEqual(await linesOf("e.id=$1", [deposit.id]), [
    { account_code: "1000", debit: "0.00", credit: "3000.00" },
    { account_code: "2400", debit: "3000.00", credit: "0.00" }
  ]);
  assert.equal((await one(db, "SELECT tds->>'challan' AS c FROM journal_entries WHERE id=$1", [deposit.id])).c, "0510308-05012027-00012");
  assert.deepEqual([(await summary())!.deposited, (await summary())!.due], ["3000.00", "2000.00"]);
  const report = await getReport(db, { from: "2026-12-01", to: "2027-01-31" });
  assert.equal(report.tds.payable.find((r: any) => r.section === "194J" && r.period === "2026-12").due, "2000.00");
  // The deduction cannot be reversed beneath a deposit; reverse the deposit first, then the payment.
  await assert.rejects(() => db.tx(q => reverseJournal(q, actor, payment.id, "2027-01-06", "Paid twice")), /Reverse that TDS deposit first/);
  await db.tx(q => reverseJournal(q, actor, deposit.id, "2027-01-06", "Wrong challan"));
  assertAllZero(await netWithReversal(deposit.id));
  const rev = await db.tx(q => reverseJournal(q, actor, payment.id, "2027-01-06", "Paid twice"));
  assert.deepEqual(await linesOf("e.id=$1", [rev.id]), [
    { account_code: "1000", debit: "54000.00", credit: "0.00" },
    { account_code: "2000", debit: "0.00", credit: "59000.00" },
    { account_code: "2400", debit: "5000.00", credit: "0.00" }
  ]);
  assertAllZero(await netWithReversal(payment.id));
  assert.deepEqual([(await summary())!.deducted, (await summary())!.due], ["0.00", "0.00"]);
  assert.equal((await due(billId)).inr, "59000.00");
});

// ---------------------------------------------------------------- 2. Debit notes
test("a purchase debit note reverses cost and ITC on the bill's split, settles the bill, and cancels back to zero", async () => {
  const billId = (await issue(bill({ expenseAccount: "1510", lines: [
    { description: "Chairs", quantity: "4", price: "2500", taxRate: "18" },
    { description: "Desk", quantity: "1", price: "10000", taxRate: "12" }
  ] }))).id;
  assert.deepEqual(await linesOf("e.document_id=$1", [billId]), [
    { account_code: "1200", debit: "1500.00", credit: "0.00" },
    { account_code: "1210", debit: "1500.00", credit: "0.00" },
    { account_code: "1510", debit: "20000.00", credit: "0.00" },
    { account_code: "2000", debit: "0.00", credit: "23000.00" }
  ]);
  await pay({ direction: "PAYMENT", partyId: P.vend, date: "2026-12-05", amount: "5000", allocations: [{ documentId: billId, amount: "5000" }] });
  await assert.rejects(() => db.tx(q => issueDebitNote(q, actor, billId, { date: "2026-12-06", reason: "Return", lines: [{ line: 0, quantity: "5" }] })), /exceeds what remains/);
  const dn = await db.tx(q => issueDebitNote(q, actor, billId, { date: "2026-12-06", reason: "One chair returned damaged", lines: [{ line: 0, quantity: "1" }] }));
  assert.match(dn.number, /^DN\/2627\/\d{5}$/);
  const dnEntry = await docEntry(dn.id);
  assert.deepEqual(await linesOf("e.id=$1", [dnEntry]), [
    { account_code: "1200", debit: "0.00", credit: "225.00" },
    { account_code: "1210", debit: "0.00", credit: "225.00" },
    { account_code: "1510", debit: "0.00", credit: "2500.00" },
    { account_code: "2000", debit: "2950.00", credit: "0.00" }
  ]);
  const saved = await one(db, "SELECT kind,status,source_id,total::text FROM documents WHERE id=$1", [dn.id]);
  assert.deepEqual(saved, { kind: "DEBIT_NOTE", status: "ISSUED", source_id: billId, total: "2950.00" });
  assert.equal((await due(billId)).inr, "15050.00");
  // The remaining lines (20,050) are more than is still owed (15,050).
  await assert.rejects(() => db.tx(q => issueDebitNote(q, actor, billId, { date: "2026-12-06", reason: "All of it", lines: [{ line: 0, quantity: "3" }, { line: 1, quantity: "1" }] })), /outstanding balance/);
  await assert.rejects(() => db.tx(q => cancelDocument(q, actor, billId, { date: "2026-12-07", reason: "Wrong" })), /Reverse them before/);
  await db.tx(q => cancelDocument(q, actor, dn.id, { date: "2026-12-07", reason: "Vendor refused the return" }));
  assertAllZero(await netWithReversal(dnEntry));
  assert.equal((await due(billId)).inr, "18000.00");
  // A blocked-credit bill has no ITC to reverse: the whole note comes out of the cost.
  const blocked = (await issue(bill({ itcEligible: false }))).id;
  const dn2 = await db.tx(q => issueDebitNote(q, actor, blocked, { date: "2026-12-06", reason: "Overbilled", lines: [{ line: 0, quantity: "1" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [dn2.id]), [
    { account_code: "2000", debit: "1180.00", credit: "0.00" },
    { account_code: "5300", debit: "0.00", credit: "1180.00" }
  ]);
  // An inter-state bill reverses IGST.
  const igst = (await issue(bill({ placeOfSupply: "29" }))).id;
  const dn3 = await db.tx(q => issueDebitNote(q, actor, igst, { date: "2026-12-06", reason: "Overbilled", lines: [{ line: 0, quantity: "0.5" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [dn3.id]), [
    { account_code: "1220", debit: "0.00", credit: "90.00" },
    { account_code: "2000", debit: "590.00", credit: "0.00" },
    { account_code: "5300", debit: "0.00", credit: "500.00" }
  ]);
});
test("a sales debit note is its own receivable: posted like an invoice, settled by receipts, cancelled to zero while unsettled", async () => {
  const inv = await issue(invoice({ lines: [{ description: "Campaign", quantity: "1", price: "20000", taxRate: "18", hsn: "998361" }] }));
  const sdn = await db.tx(q => issueSalesDebitNote(q, actor, inv.id, { date: "2026-12-08", reason: "Extra hours not billed", lines: [{ description: "Extra hours", hsn: "998361", quantity: "2", price: "1500", taxRate: "18" }] }));
  assert.match(sdn.number, /^SDN\/2627\/\d{5}$/);
  const entry = await docEntry(sdn.id);
  assert.deepEqual(await linesOf("e.id=$1", [entry]), [
    { account_code: "1100", debit: "3540.00", credit: "0.00" },
    { account_code: "2100", debit: "0.00", credit: "270.00" },
    { account_code: "2110", debit: "0.00", credit: "270.00" },
    { account_code: "4000", debit: "0.00", credit: "3000.00" }
  ]);
  assert.deepEqual(await one(db, "SELECT kind,source_id,total::text FROM documents WHERE id=$1", [sdn.id]), { kind: "SALES_DEBIT_NOTE", source_id: inv.id, total: "3540.00" });
  const report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(report.documents.find((d: any) => d.id === sdn.id).inr_total, "3540.00");
  const receipt = await pay({ direction: "RECEIPT", partyId: P.r32, date: "2026-12-09", amount: "3540", allocations: [{ documentId: sdn.id, amount: "3540" }] });
  assert.equal((await due(sdn.id)).inr, "0.00");
  await assert.rejects(() => db.tx(q => cancelDocument(q, actor, sdn.id, { date: "2026-12-10", reason: "Raised in error" })), /receipts applied/);
  await db.tx(q => reverseJournal(q, actor, receipt.id, "2026-12-10", "Wrong document"));
  await db.tx(q => cancelDocument(q, actor, sdn.id, { date: "2026-12-10", reason: "Raised in error" }));
  assertAllZero(await netWithReversal(entry));
  await assert.rejects(() => db.tx(q => issueSalesDebitNote(q, actor, inv.id, { date: "2026-12-01", reason: "Too early", lines: [{ description: "x", quantity: "1", price: "1", taxRate: "18" }] })), /before its invoice/);
  // Separate number series per kind: a purchase debit note never takes an SDN number.
  const series = (await db.query("SELECT prefix FROM sequences WHERE prefix IN ('DN','SDN','CN') ORDER BY prefix")).rows.map(r => r.prefix);
  assert.ok(series.includes("SDN") && series.includes("DN"));
});

// ---------------------------------------------------------------- 3. Reverse charge
test("reverse-charge bills owe the supplier the taxable value, book RCM tax payable and ITC, and number self-invoices", async () => {
  await assert.rejects(() => db.tx(q => createDocument(q, actor, bill({ reverseCharge: true, taxTreatment: "OUTSIDE_GST" }))), /taxable supply/);
  await assert.rejects(() => db.tx(q => createDocument(q, actor, invoice({ reverseCharge: true }))), /vendor bills only/);
  const ur = await issue(bill({ partyId: P.urVend, reverseCharge: true, lines: [{ description: "Legal services", quantity: "1", price: "10000", taxRate: "18" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [ur.id]), [
    { account_code: "1200", debit: "900.00", credit: "0.00" },
    { account_code: "1210", debit: "900.00", credit: "0.00" },
    { account_code: "2000", debit: "0.00", credit: "10000.00" },
    { account_code: "2130", debit: "0.00", credit: "900.00" },
    { account_code: "2140", debit: "0.00", credit: "900.00" },
    { account_code: "5300", debit: "10000.00", credit: "0.00" }
  ]);
  const saved = await one(db, "SELECT total::text,tax::text,reverse_charge,self_invoice_number FROM documents WHERE id=$1", [ur.id]);
  assert.deepEqual(saved, { total: "10000.00", tax: "1800.00", reverse_charge: true, self_invoice_number: "SI/2627/00001" });
  assert.equal(ur.selfInvoiceNumber, "SI/2627/00001");
  assert.equal((await due(ur.id)).inr, "10000.00");
  // A registered supplier's RCM bill needs no self-invoice; inter-state uses IGST.
  const reg = await issue(bill({ reverseCharge: true, placeOfSupply: "29", lines: [{ description: "Transport", quantity: "1", price: "10000", taxRate: "18" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [reg.id]), [
    { account_code: "1220", debit: "1800.00", credit: "0.00" },
    { account_code: "2000", debit: "0.00", credit: "10000.00" },
    { account_code: "2150", debit: "0.00", credit: "1800.00" },
    { account_code: "5300", debit: "10000.00", credit: "0.00" }
  ]);
  assert.equal((await one(db, "SELECT self_invoice_number FROM documents WHERE id=$1", [reg.id])).self_invoice_number, null);
  // Without ITC the tax is part of the cost; the liability is the same. Cancelling reverses everything.
  const blocked = await issue(bill({ partyId: P.urVend, reverseCharge: true, itcEligible: false, lines: [{ description: "Catering", quantity: "1", price: "10000", taxRate: "18" }] }));
  const blockedEntry = await docEntry(blocked.id);
  assert.deepEqual(await linesOf("e.id=$1", [blockedEntry]), [
    { account_code: "2000", debit: "0.00", credit: "10000.00" },
    { account_code: "2130", debit: "0.00", credit: "900.00" },
    { account_code: "2140", debit: "0.00", credit: "900.00" },
    { account_code: "5300", debit: "11800.00", credit: "0.00" }
  ]);
  assert.equal(blocked.selfInvoiceNumber, "SI/2627/00002");
  await db.tx(q => cancelDocument(q, actor, blocked.id, { date: "2026-12-05", reason: "Duplicate entry" }));
  assertAllZero(await netWithReversal(blockedEntry));
  // A debit note on a reverse-charge bill gives back the RCM liability and the ITC; cancelling it restores both.
  const two = await issue(bill({ partyId: P.urVend, reverseCharge: true, lines: [{ description: "Advocate fees", quantity: "2", price: "5000", taxRate: "18" }] }));
  const dn = await db.tx(q => issueDebitNote(q, actor, two.id, { date: "2026-12-06", reason: "One hearing cancelled", lines: [{ line: 0, quantity: "1" }] }));
  const dnEntry = await docEntry(dn.id);
  assert.deepEqual(await linesOf("e.id=$1", [dnEntry]), [
    { account_code: "1200", debit: "0.00", credit: "450.00" },
    { account_code: "1210", debit: "0.00", credit: "450.00" },
    { account_code: "2000", debit: "5000.00", credit: "0.00" },
    { account_code: "2130", debit: "450.00", credit: "0.00" },
    { account_code: "2140", debit: "450.00", credit: "0.00" },
    { account_code: "5300", debit: "0.00", credit: "5000.00" }
  ]);
  assert.equal((await due(two.id)).inr, "5000.00");
  await db.tx(q => cancelDocument(q, actor, dn.id, { date: "2026-12-07", reason: "Hearing went ahead" }));
  assertAllZero(await netWithReversal(dnEntry));
  assert.equal((await due(two.id)).inr, "10000.00");
});

// ---------------------------------------------------------------- 4. Zero-rated / exports and foreign currency
test("zero-rated supplies: LUT charges no IGST, WITH_IGST charges IGST, and a credit note corrects to zero", async () => {
  await assert.rejects(() => db.tx(q => createDocument(q, actor, invoice({ partyId: P.foreign, taxTreatment: "ZERO_RATED", placeOfSupply: "96" }))), /under LUT/);
  const lut = await issue(invoice({ partyId: P.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "LUT", placeOfSupply: "96", lines: [{ description: "Brand design", quantity: "1", price: "100000", taxRate: "18", hsn: "998391" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [lut.id]), [
    { account_code: "1100", debit: "100000.00", credit: "0.00" },
    { account_code: "4000", debit: "0.00", credit: "100000.00" }
  ]);
  assert.deepEqual(await one(db, "SELECT tax::text,interstate,zero_rated_type FROM documents WHERE id=$1", [lut.id]), { tax: "0.00", interstate: true, zero_rated_type: "LUT" });
  const igst = await issue(invoice({ partyId: P.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "WITH_IGST", placeOfSupply: "96", lines: [{ description: "Brand design", quantity: "1", price: "100000", taxRate: "18", hsn: "998391" }] }));
  const igstEntry = await docEntry(igst.id);
  assert.deepEqual(await linesOf("e.id=$1", [igstEntry]), [
    { account_code: "1100", debit: "118000.00", credit: "0.00" },
    { account_code: "2120", debit: "0.00", credit: "18000.00" },
    { account_code: "4000", debit: "0.00", credit: "100000.00" }
  ]);
  const cn = await db.tx(q => issueCreditNote(q, actor, igst.id, { date: "2026-12-04", reason: "Order withdrawn", lines: [{ line: 0, quantity: "1" }] }));
  const net = (await db.query(
    "SELECT l.account_code,SUM(l.debit-l.credit)::text AS net FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.document_id IN ($1,$2) GROUP BY l.account_code ORDER BY l.account_code",
    [igst.id, cn.id]
  )).rows;
  assertAllZero(net);
  assert.equal((await due(igst.id)).inr, "0.00");
});
test("live LUT exports need the company LUT, valid on the invoice date", async () => {
  const saved = await one(db, "SELECT address,lut_number,lut_valid_from::text,lut_valid_to::text FROM company");
  await db.query("UPDATE company SET demo=false,address='MG Road, Kochi',lut_number='',lut_valid_from=NULL,lut_valid_to=NULL");
  try {
    const lut = (over: Record<string, any> = {}) => invoice({ partyId: P.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "LUT", placeOfSupply: "96", date: "2026-12-05", dueDate: "2026-12-20", ...over });
    const missing = await db.tx(q => createDocument(q, actor, lut()));
    await assert.rejects(() => db.tx(q => issueDocument(q, actor, missing.id)), /LUT \/ ARN number/);
    await db.query("UPDATE company SET lut_number='AD3203260012345',lut_valid_from='2026-04-01',lut_valid_to='2027-03-31'");
    const issued = await db.tx(q => issueDocument(q, actor, missing.id));
    assert.match(issued.number, /^INV\/2627\/\d{5}$/);
    const late = await db.tx(q => createDocument(q, actor, lut({ date: "2027-04-02", dueDate: "2027-04-20" })));
    await assert.rejects(() => db.tx(q => issueDocument(q, actor, late.id)), /not valid on 2027-04-02/);
    // Exports with IGST need no LUT.
    const withIgst = await db.tx(q => createDocument(q, actor, lut({ zeroRatedType: "WITH_IGST", date: "2027-04-02", dueDate: "2027-04-20" })));
    await db.tx(q => issueDocument(q, actor, withIgst.id));
  }
  finally {
    await db.query("UPDATE company SET demo=true,address=$1,lut_number=$2,lut_valid_from=$3,lut_valid_to=$4", [saved.address, saved.lut_number, saved.lut_valid_from, saved.lut_valid_to]);
  }
});
test("a foreign-currency invoice posts its INR equivalent; receipts post exact exchange gain, loss and partial settlement", async () => {
  const draft = await db.tx(q => createDocument(q, actor, invoice({
    partyId: P.foreign, currency: "USD", taxTreatment: "ZERO_RATED", zeroRatedType: "LUT", placeOfSupply: "96",
    lines: [{ description: "Design", quantity: "1", price: "1000", taxRate: "18", hsn: "998391" }, { description: "Support", quantity: "3", price: "333.33", taxRate: "18", hsn: "998391" }]
  })));
  await assert.rejects(() => db.tx(q => issueDocument(q, actor, draft.id)), /exchange rate \(INR per 1 USD/);
  await assert.rejects(() => db.tx(q => issueDocument(q, actor, draft.id, { exchangeRate: "83.1234567" })), /up to 6 decimals/);
  await db.tx(q => issueDocument(q, actor, draft.id, { exchangeRate: "83.123456" }));
  const inv = await one(db, "SELECT total::text,exchange_rate::text,subtotal_inr::text,tax_inr::text,total_inr::text,lines FROM documents WHERE id=$1", [draft.id]);
  assert.deepEqual(
    { total: inv.total, rate: inv.exchange_rate, subtotal: inv.subtotal_inr, tax: inv.tax_inr, totalInr: inv.total_inr },
    { total: "1999.99", rate: "83.123456", subtotal: "166246.08", tax: "0.00", totalInr: "166246.08" }
  );
  assert.deepEqual(inv.lines.map((l: any) => l.baseInr), ["83123.46", "83122.62"]);
  assert.deepEqual(await linesOf("e.document_id=$1", [draft.id]), [
    { account_code: "1100", debit: "166246.08", credit: "0.00" },
    { account_code: "4000", debit: "0.00", credit: "166246.08" }
  ]);
  const receipt = (b: Record<string, any>) => pay({ direction: "RECEIPT", partyId: P.foreign, description: "SWIFT inward", ...b });
  await assert.rejects(() => receipt({ date: "2026-12-15", amount: "84000", allocations: [{ documentId: draft.id, amount: "1000" }] }), /Enter the USD amount/);
  await assert.rejects(() => receipt({ date: "2026-12-15", amount: "84000", allocations: [{ documentId: draft.id, foreignAmount: "2000" }] }), /outstanding USD balance/);
  await assert.rejects(() => receipt({ date: "2026-12-15", amount: "84000", tdsAmount: "10", allocations: [{ documentId: draft.id, foreignAmount: "1000" }] }), /foreign-currency/);
  // Partial receipt at a better rate: carrying amount 1000 × 166246.08 / 1999.99 = 83123.46; gain 876.54.
  const first = await receipt({ date: "2026-12-15", amount: "84000.00", allocations: [{ documentId: draft.id, foreignAmount: "1000.00" }] });
  assert.deepEqual(await linesOf("e.id=$1", [first.id]), [
    { account_code: "1000", debit: "84000.00", credit: "0.00" },
    { account_code: "1100", debit: "0.00", credit: "83123.46" },
    { account_code: "4200", debit: "0.00", credit: "876.54" }
  ]);
  assert.deepEqual(await one(db, "SELECT amount::text,foreign_amount::text FROM allocations WHERE entry_id=$1", [first.id]), { amount: "83123.46", foreign_amount: "1000.00" });
  assert.deepEqual(await due(draft.id), { inr: "83122.62", foreign: "999.99" });
  // The rest at a worse rate clears the whole remaining INR balance (no paise left behind): loss 1122.62.
  const second = await receipt({ date: "2026-12-20", amount: "82000.00", allocations: [{ documentId: draft.id, foreignAmount: "999.99" }] });
  assert.deepEqual(await linesOf("e.id=$1", [second.id]), [
    { account_code: "1000", debit: "82000.00", credit: "0.00" },
    { account_code: "1100", debit: "0.00", credit: "83122.62" },
    { account_code: "5700", debit: "1122.62", credit: "0.00" }
  ]);
  assert.deepEqual(await due(draft.id), { inr: "0.00", foreign: "0.00" });
  const report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
  const row = report.documents.find((d: any) => d.id === draft.id);
  assert.deepEqual([row.inr_total, row.paid, row.foreign_paid], ["166246.08", "166246.08", "1999.99"]);
  const view = await api.receipt(first.id);
  assert.equal(view.fx_difference, "876.54");
  // Reversing the first receipt gives back both the INR and the foreign amount, and its gain.
  await db.tx(q => reverseJournal(q, actor, first.id, "2026-12-21", "Recalled by bank"));
  assertAllZero(await netWithReversal(first.id));
  assert.deepEqual(await due(draft.id), { inr: "83123.46", foreign: "1000.00" });
  // The issued foreign invoice is corrected with a credit note at its own rate: the remaining line clears it exactly.
  const cn = await db.tx(q => issueCreditNote(q, actor, draft.id, { date: "2026-12-22", reason: "Design not delivered", lines: [{ line: 0, quantity: "1" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [cn.id]), [
    { account_code: "1100", debit: "0.00", credit: "83123.46" },
    { account_code: "4000", debit: "83123.46", credit: "0.00" }
  ]);
  assert.deepEqual(await due(draft.id), { inr: "0.00", foreign: "0.00" });
  const receivable = await one(db, "SELECT SUM(l.debit-l.credit)::text AS net FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code='1100' AND e.party_id=$1", [P.foreign]);
  assert.equal(receivable.net, (await getReport(db, { from: "2026-12-01", to: "2027-12-31" })).parties.find((p: any) => p.id === P.foreign).receivable);
});
test("paise left by proportional foreign receipts are cleared to exchange difference by the final credit note", async () => {
  const inv = await issue(invoice({
    partyId: P.foreign, currency: "USD", taxTreatment: "ZERO_RATED", zeroRatedType: "LUT", placeOfSupply: "96",
    lines: [{ description: "A", quantity: "1", price: "100", taxRate: "18", hsn: "998391" }, { description: "B", quantity: "1", price: "100", taxRate: "18", hsn: "998391" }]
  }), { exchangeRate: "83.12345" });
  // Each line is 8312.345 → 8312.35; the invoice is carried at 16624.70.
  assert.equal((await due(inv.id)).inr, "16624.70");
  for (const date of ["2026-12-15", "2026-12-16"])
    await pay({ direction: "RECEIPT", partyId: P.foreign, date, amount: "8400.00", allocations: [{ documentId: inv.id, foreignAmount: "50.00" }] });
  // Two halves of line A at 4156.175 → 4156.18 each leave 8312.34 against line B's 8312.35.
  assert.deepEqual(await due(inv.id), { inr: "8312.34", foreign: "100.00" });
  const cn = await db.tx(q => issueCreditNote(q, actor, inv.id, { date: "2026-12-17", reason: "B cancelled", lines: [{ line: 1, quantity: "1" }] }));
  assert.deepEqual(await linesOf("e.document_id=$1", [cn.id]), [
    { account_code: "1100", debit: "0.00", credit: "8312.34" },
    { account_code: "4000", debit: "8312.35", credit: "0.00" },
    { account_code: "4200", debit: "0.00", credit: "0.01" }
  ]);
  assert.deepEqual(await due(inv.id), { inr: "0.00", foreign: "0.00" });
});

// ---------------------------------------------------------------- 6. E-invoice preparation
test("e-invoice JSON is prepared for B2B invoices; IRN details are recorded once and are immutable", async () => {
  const before = await issue(invoice());
  await assert.rejects(() => api.einvoice(before.id), /E-invoicing applicable/);
  await db.query("UPDATE company SET einvoice_enabled=true");
  try {
    const inv = await issue(invoice({ lines: [{ description: "Design work", quantity: "2", price: "500", taxRate: "18", hsn: "998391" }] }));
    const prepared: any = await api.einvoice(inv.id);
    assert.equal(prepared.json.Version, "1.1");
    assert.deepEqual(prepared.json.TranDtls, { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", EcmGstin: null, IgstOnIntra: "N" });
    assert.deepEqual(prepared.json.DocDtls, { Typ: "INV", No: inv.number, Dt: "02/12/2026" });
    assert.equal(prepared.json.SellerDtls.Gstin, COMPANY_GSTIN);
    assert.deepEqual([prepared.json.BuyerDtls.Gstin, prepared.json.BuyerDtls.Pin, prepared.json.BuyerDtls.Stcd], ["32AABCK1234L1Z2", 682036, "32"]);
    assert.deepEqual(prepared.json.ValDtls, { AssVal: 1000, CgstVal: 90, SgstVal: 90, IgstVal: 0, CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0, TotInvVal: 1180 });
    assert.equal(prepared.json.ItemList[0].IsServc, "Y");
    assert.deepEqual(prepared.issues, []);
    assert.match(prepared.note, /not filed/);
    const details = { irn: "ab".repeat(32), ackNo: "112010036563310", ackDate: "2026-12-02 12:30:00", signedQr: "eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiMSJ9.c2lnbmF0dXJl" };
    await assert.rejects(() => api.irn(req, inv.id, { ...details, irn: "not-an-irn" }), /64-character/);
    await api.irn(req, inv.id, details);
    assert.deepEqual(await one(db, "SELECT irn,ack_no,ack_date,signed_qr FROM documents WHERE id=$1", [inv.id]), { irn: details.irn, ack_no: details.ackNo, ack_date: details.ackDate, signed_qr: details.signedQr });
    await assert.rejects(() => api.irn(req, inv.id, { ...details, irn: "cd".repeat(32) }), /already recorded and cannot be changed/);
    await assert.rejects(() => db.query("UPDATE documents SET irn=$2 WHERE id=$1", [inv.id, "ef".repeat(32)]), /immutable/);
    await assert.rejects(() => db.query("UPDATE documents SET signed_qr=NULL WHERE id=$1", [inv.id]), /immutable/);
    // Live B2B issuance warns (never blocks) until the IRN is recorded; demo and B2C issue silently.
    assert.deepEqual((await issue(invoice())).warnings, []);
    await db.query("UPDATE company SET demo=false");
    try {
      const live = await issue(invoice({ lines: [{ description: "Design", quantity: "1", price: "1000", taxRate: "18", hsn: "998391" }] }));
      assert.equal(live.status, "ISSUED");
      assert.match(live.warnings[0], /E-invoicing is on/);
      assert.deepEqual((await issue(invoice({ partyId: P.ur }))).warnings, []);
    }
    finally {
      await db.query("UPDATE company SET demo=true");
    }
    // An export to an unregistered foreign buyer uses the export supply type.
    const exp = await issue(invoice({ partyId: P.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "WITH_IGST", placeOfSupply: "96" }));
    const expJson: any = await api.einvoice(exp.id);
    assert.deepEqual([expJson.json.TranDtls.SupTyp, expJson.json.BuyerDtls.Gstin, expJson.json.ValDtls.IgstVal], ["EXPWP", "URP", 1800]);
  }
  finally {
    await db.query("UPDATE company SET einvoice_enabled=false");
  }
});
test("company compliance settings validate TAN and LUT dates and are kept when a form leaves them out", async () => {
  const base = { name: "Northstar Studio", address: "MG Road, Kochi", gstin: COMPANY_GSTIN, stateCode: "32", pinCode: "682016", terms: "Due in 15 days" };
  await assert.rejects(() => api.company(req, { ...base, tan: "TVD12345B" }), /TAN must be/);
  await assert.rejects(() => api.company(req, { ...base, lutValidFrom: "2027-04-01", lutValidTo: "2026-04-01" }), /cannot precede/);
  await api.company(req, { ...base, tan: "tvda12345b", lutNumber: "AD3203260012345", lutValidFrom: "2026-04-01", lutValidTo: "2027-03-31", b2clThreshold: "100000", einvoiceEnabled: false });
  await api.company(req, base);
  const c = await one(db, "SELECT tan,lut_number,lut_valid_from::text,lut_valid_to::text,b2cl_threshold::text,einvoice_enabled FROM company");
  assert.deepEqual(c, { tan: "TVDA12345B", lut_number: "AD3203260012345", lut_valid_from: "2026-04-01", lut_valid_to: "2027-03-31", b2cl_threshold: "100000.00", einvoice_enabled: false });
  await api.company(req, { ...base, tan: "", lutValidTo: "" });
  assert.deepEqual(await one(db, "SELECT tan,lut_valid_to FROM company"), { tan: "", lut_valid_to: null });
  await api.company(req, { ...base, b2clThreshold: "250000" });
});

// ---------------------------------------------------------------- 5. GSTR-1 / GSTR-3B working exports
test("GST set-off: IGST credit first and fully, to CGST/SGST shortfalls before the rest; CGST and SGST never cross", () => {
  const n = (v: string) => new D(v);
  // IGST credit beyond IGST tax goes where own credit falls short, so no CGST credit is stranded.
  assert.deepEqual(setOff({ igst: n("100"), cgst: n("500"), sgst: n("500") }, { igst: n("400"), cgst: n("450"), sgst: n("200") }), [
    { head: "IGST", liability: "100.00", paidIgst: "100.00", paidCgst: "0.00", paidSgst: "0.00", cash: "0.00", creditLeft: "0.00" },
    { head: "CGST", liability: "500.00", paidIgst: "50.00", paidCgst: "450.00", paidSgst: "0.00", cash: "0.00", creditLeft: "0.00" },
    { head: "SGST", liability: "500.00", paidIgst: "250.00", paidCgst: "0.00", paidSgst: "200.00", cash: "50.00", creditLeft: "0.00" }
  ]);
  const crossed = setOff({ igst: n("0"), cgst: n("0"), sgst: n("100") }, { igst: n("0"), cgst: n("1000"), sgst: n("0") });
  assert.deepEqual(crossed.map(r => [r.head, r.cash, r.creditLeft]), [["IGST", "0.00", "0.00"], ["CGST", "0.00", "1000.00"], ["SGST", "100.00", "0.00"]]);
  // CGST/SGST credit left after their own heads goes to IGST.
  const toIgst = setOff({ igst: n("300"), cgst: n("100"), sgst: n("100") }, { igst: n("0"), cgst: n("250"), sgst: n("120") });
  assert.deepEqual(toIgst.map(r => [r.head, r.paidCgst, r.paidSgst, r.cash]), [["IGST", "150.00", "20.00", "130.00"], ["CGST", "100.00", "0.00", "0.00"], ["SGST", "0.00", "100.00", "0.00"]]);
});
test("GSTR-1 and GSTR-3B working figures cover every section, net credit notes and keep paise exact", async () => {
  const { d: g, parties: p, user } = await freshBooks();
  try {
    const on = (input: Record<string, any>) => issue({ date: "2027-01-05", dueDate: "2027-01-31", taxTreatment: "TAXABLE", ...input }, {}, g, user);
    const inv = (over: Record<string, any>) => on({ kind: "INVOICE", ...over });
    const purchase = (over: Record<string, any>) => on({ kind: "PURCHASE", partyId: p.vend, reference: "B-" + id().slice(0, 6), placeOfSupply: "32", expenseAccount: "5300", date: "2027-01-08", ...over });
    const line = (description: string, quantity: string, price: string, taxRate: string, hsn?: string) => ({ description, quantity, price, taxRate, ...(hsn ? { hsn } : {}) });
    // Outward supplies.
    const a = await inv({ partyId: p.r32, placeOfSupply: "32", lines: [line("A", "1", "10000", "18", "998311"), line("B", "2", "2500.50", "12", "998312"), line("C", "1", "100.05", "18", "998311")] });
    const b = await inv({ partyId: p.r29, placeOfSupply: "29", lines: [line("D", "1", "50000", "18", "998313")] });
    const c = await inv({ partyId: p.ur, placeOfSupply: "29", lines: [line("E", "1", "300000", "18", "998314")] });
    const dIntra = await inv({ partyId: p.ur, placeOfSupply: "32", lines: [line("F", "1", "20000", "18", "998315")] });
    await inv({ partyId: p.ur, placeOfSupply: "33", lines: [line("G", "1", "10000", "5", "998316")] });
    await inv({ partyId: p.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "LUT", placeOfSupply: "96", lines: [line("H", "1", "80000", "18", "998317")] });
    await inv({ partyId: p.foreign, taxTreatment: "ZERO_RATED", zeroRatedType: "WITH_IGST", placeOfSupply: "96", lines: [line("I", "1", "40000", "18", "998317")] });
    await inv({ partyId: p.ur, taxTreatment: "NIL_RATED", taxReason: "Nil-rated supply", placeOfSupply: "32", lines: [line("J", "1", "5000", "0", "998318")] });
    await inv({ partyId: p.r29, taxTreatment: "EXEMPT", taxReason: "Exempt service", placeOfSupply: "29", lines: [line("K", "1", "7000", "0", "998319")] });
    await inv({ partyId: p.ur, taxTreatment: "OUTSIDE_GST", taxReason: "Outside GST", placeOfSupply: "32", lines: [line("L", "1", "3000", "0")] });
    await on({ kind: "BILL", partyId: p.ur, taxTreatment: "OUTSIDE_GST", taxReason: "Payment receipt", paymentMethod: "Cash", placeOfSupply: "32", lines: [line("M", "1", "2000", "0")] });
    await g.tx(q => issueCreditNote(q, user, a.id, { date: "2027-01-20", reason: "Line B part", lines: [{ line: 1, quantity: "1" }] }));
    await g.tx(q => issueCreditNote(q, user, dIntra.id, { date: "2027-01-20", reason: "Half refunded", lines: [{ line: 0, quantity: "0.5" }] }));
    await g.tx(q => issueSalesDebitNote(q, user, c.id, { date: "2027-01-21", reason: "Freight", lines: [line("E-extra", "1", "1000", "18", "998314")] }));
    const cancelled = await g.tx(q => issueSalesDebitNote(q, user, b.id, { date: "2027-01-21", reason: "Wrong", lines: [line("D-extra", "1", "500", "18", "998313")] }));
    await g.tx(q => cancelDocument(q, user, cancelled.id, { date: "2027-01-22", reason: "Raised in error" }));
    // Inward supplies.
    await purchase({ partyId: p.urVend, reverseCharge: true, lines: [line("Legal", "1", "10000", "18")] });
    const k = await purchase({ lines: [line("Rent", "1", "30000", "18")] });
    await purchase({ placeOfSupply: "29", lines: [line("Hardware", "1", "20000", "18")] });
    await purchase({ itcEligible: false, lines: [line("Food", "1", "5000", "18")] });
    await g.tx(q => issueDebitNote(q, user, k.id, { date: "2027-01-25", reason: "Overbilled", lines: [{ line: 0, quantity: "0.5" }] }));
    await purchase({ taxTreatment: "OUTSIDE_GST", lines: [line("Exempt goods", "1", "4000", "0")] });
    // Outside the month: never reported.
    await issue({ kind: "INVOICE", partyId: p.r32, date: "2027-02-01", dueDate: "2027-02-10", taxTreatment: "TAXABLE", placeOfSupply: "32", lines: [line("Feb", "1", "999", "18", "998311")] }, {}, g, user);

    const r = await buildGstReturns(g, "012027");
    const j = r.json;
    assert.equal(r.note, "Working draft for accountant review — not filed");
    assert.equal(j._note, r.note);
    assert.deepEqual([j.gstin, j.fp], [COMPANY_GSTIN, "012027"]);
    const det = (rt: number, txval: number, iamt: number, camt: number, samt: number) => ({ rt, txval, iamt, camt, samt, csamt: 0 });
    // B2B: invoice-wise, rate-wise; 100.05 at 18% is 18.01 tax, split 9.01 CGST / 9.00 SGST.
    assert.deepEqual(j.b2b, [
      { ctin: "32AABCK1234L1Z2", inv: [{ inum: "INV/2627/00001", idt: "05-01-2027", val: 17519.18, pos: "32", rchrg: "N", inv_typ: "R", itms: [
        { num: 1, itm_det: det(12, 5001, 0, 300.06, 300.06) }, { num: 2, itm_det: det(18, 10100.05, 0, 909.01, 909) }
      ] }] },
      { ctin: "29AABCB5678M1Z9", inv: [{ inum: "INV/2627/00002", idt: "05-01-2027", val: 59000, pos: "29", rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: det(18, 50000, 9000, 0, 0) }] }] }
    ]);
    assert.deepEqual(j.b2cl, [{ pos: "29", inv: [{ inum: "INV/2627/00003", idt: "05-01-2027", val: 354000, itms: [{ num: 1, itm_det: { rt: 18, txval: 300000, iamt: 54000, csamt: 0 } }] }] }]);
    // B2CS nets the credit note on the intra-state B2C invoice.
    assert.deepEqual(j.b2cs, [
      { sply_ty: "INTRA", pos: "32", typ: "OE", rt: 18, txval: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 },
      { sply_ty: "INTER", pos: "33", typ: "OE", rt: 5, txval: 10000, iamt: 500, camt: 0, samt: 0, csamt: 0 }
    ]);
    assert.deepEqual(j.exp.map((e: any) => [e.exp_typ, e.inv[0].val, e.inv[0].itms[0].iamt, e.inv[0].itms[0].rt]), [["WOPAY", 80000, 0, 18], ["WPAY", 47200, 7200, 18]]);
    assert.deepEqual(j.cdnr, [{ ctin: "32AABCK1234L1Z2", nt: [{ ntty: "C", nt_num: "CN/2627/00001", nt_dt: "20-01-2027", val: 2800.56, pos: "32", rchrg: "N", inv_typ: "R", itms: [{ num: 1, itm_det: det(12, 2500.5, 0, 150.03, 150.03) }] }] }]);
    assert.deepEqual(j.cdnur, [{ typ: "B2CL", ntty: "D", nt_num: "SDN/2627/00001", nt_dt: "21-01-2027", val: 1180, pos: "29", itms: [{ num: 1, itm_det: { rt: 18, txval: 1000, iamt: 180, csamt: 0 } }] }]);
    assert.deepEqual(j.nil.inv, [
      { sply_ty: "INTRB2B", nil_amt: 0, expt_amt: 7000, ngsup_amt: 0 },
      { sply_ty: "INTRAB2B", nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      { sply_ty: "INTRB2C", nil_amt: 0, expt_amt: 0, ngsup_amt: 0 },
      { sply_ty: "INTRAB2C", nil_amt: 5000, expt_amt: 0, ngsup_amt: 5000 }
    ]);
    const hsn = (rows: any[]) => rows.map(h => [h.hsn_sc, h.rt, h.qty, h.txval, h.iamt, h.camt, h.samt]);
    assert.deepEqual(hsn(j.hsn.hsn_b2b), [
      ["998311", 18, 2, 10100.05, 0, 909.01, 909], ["998312", 12, 1, 2500.5, 0, 150.03, 150.03], ["998313", 18, 1, 50000, 9000, 0, 0], ["998319", 0, 1, 7000, 0, 0, 0]
    ]);
    assert.deepEqual(hsn(j.hsn.hsn_b2c), [
      ["998314", 18, 2, 301000, 54180, 0, 0], ["998315", 18, 0.5, 10000, 0, 900, 900], ["998316", 5, 1, 10000, 500, 0, 0], ["998317", 18, 2, 120000, 7200, 0, 0], ["998318", 0, 1, 5000, 0, 0, 0]
    ]);
    assert.deepEqual(j.doc_issue.doc_det, [
      { doc_num: 1, docs: [{ num: 1, from: "INV/2627/00001", to: "INV/2627/00010", totnum: 10, cancel: 0, net_issue: 10 }] },
      { doc_num: 2, docs: [{ num: 1, from: "SI/2627/00001", to: "SI/2627/00001", totnum: 1, cancel: 0, net_issue: 1 }] },
      { doc_num: 4, docs: [{ num: 1, from: "SDN/2627/00001", to: "SDN/2627/00002", totnum: 2, cancel: 1, net_issue: 1 }] },
      { doc_num: 5, docs: [{ num: 1, from: "CN/2627/00001", to: "CN/2627/00002", totnum: 2, cancel: 0, net_issue: 2 }] }
    ]);
    // CSV sections follow the same figures.
    assert.equal(r.gstr1.csv.b2b.length, 3);
    assert.deepEqual(r.gstr1.totals.b2b, { txval: "65101.05", iamt: "9000.00", camt: "1209.07", samt: "1209.06", csamt: "0.00" });
    assert.equal(r.gstr1.csv.cdnr[0]["Original Invoice Number"], "INV/2627/00001");
    // GSTR-3B.
    const t = (txval: string, iamt: string, camt: string, samt: string) => ({ txval, iamt, camt, samt, csamt: "0.00" });
    const b3 = r.gstr3b as any;
    assert.deepEqual(b3["3.1(a)"], t("383600.55", "63680.00", "1959.04", "1959.03"));
    assert.deepEqual(b3["3.1(b)"], t("120000.00", "7200.00", "0.00", "0.00"));
    assert.deepEqual(b3["3.1(c)"], t("12000.00", "0.00", "0.00", "0.00"));
    assert.deepEqual(b3["3.1(d)"], t("10000.00", "0.00", "900.00", "900.00"));
    assert.deepEqual(b3["3.1(e)"], t("5000.00", "0.00", "0.00", "0.00"));
    assert.deepEqual(b3["4(A)(3)"], t("0.00", "0.00", "900.00", "900.00"));
    assert.deepEqual(b3["4(A)(5)"], t("0.00", "3600.00", "1800.00", "1800.00"));
    assert.deepEqual(b3["4(B)(1)"], t("0.00", "0.00", "450.00", "450.00"));
    assert.deepEqual(b3["4(C)"], t("0.00", "3600.00", "2250.00", "2250.00"));
    assert.deepEqual(b3["5"], { inter: "0.00", intra: "4000.00" });
    assert.deepEqual(b3.setoff, [
      { head: "IGST", liability: "70880.00", paidIgst: "3600.00", paidCgst: "290.96", paidSgst: "290.97", cash: "66698.07", creditLeft: "0.00" },
      { head: "CGST", liability: "1959.04", paidIgst: "0.00", paidCgst: "1959.04", paidSgst: "0.00", cash: "0.00", creditLeft: "0.00" },
      { head: "SGST", liability: "1959.03", paidIgst: "0.00", paidCgst: "0.00", paidSgst: "1959.03", cash: "0.00", creditLeft: "0.00" }
    ]);
    assert.deepEqual(b3.rcmCash, { igst: "0.00", cgst: "900.00", sgst: "900.00" });
    // The API returns the same working and rejects a malformed period.
    assert.deepEqual((await new ApiController(g).gstReturns({ period: "012027" })).gstr3b, r.gstr3b);
    await assert.rejects(() => new ApiController(g).gstReturns({ period: "2027-01" }), /MMYYYY/);
    // An empty month is all zeros.
    const empty = await buildGstReturns(g, "032027");
    assert.deepEqual([empty.json.b2b, empty.json.b2cs, empty.gstr3b["3.1(a)"].txval], [[], [], "0.00"]);
    await assertTrialBalance(g);
  }
  finally {
    await g.close();
  }
});
test("a filed GST return is recorded with its ARN, locks the month on request and cannot be edited", async () => {
  const viewer = { user: { ...actor, role: "VIEWER" }, headers: {} };
  await assert.rejects(() => api.gstFiling(viewer, { period: "112026", returnType: "GSTR1", arn: "AA3211260000001", filedOn: "2026-12-11" }), /Administrator/);
  await api.gstFiling(req, { period: "112026", returnType: "GSTR1", arn: "aa3211260000001", filedOn: "2026-12-11", lockPeriod: true });
  try {
    assert.equal((await one(db, "SELECT closed_through::text AS c FROM company")).c, "2026-11-30");
    await assert.rejects(() => api.gstFiling(req, { period: "112026", returnType: "GSTR1", arn: "AA3211260000002", filedOn: "2026-12-12" }), /already recorded/);
    await assert.rejects(() => db.tx(q => writeJournal(q, actor, { date: "2026-11-15", kind: "JOURNAL", description: "Late", lines: [{ account: "1000", debit: "1.00" }, { account: "3000", credit: "1.00" }] })), /period is closed/);
    const filing = await one(db, "SELECT id,arn,return_type FROM gst_filings WHERE period='112026'");
    assert.deepEqual([filing.arn, filing.return_type], ["AA3211260000001", "GSTR1"]);
    await assert.rejects(() => db.query("DELETE FROM gst_filings WHERE id=$1", [filing.id]), /immutable/);
    const report = await getReport(db, { from: "2026-12-01", to: "2026-12-31" });
    assert.equal(report.gstFilings[0].period, "112026");
    assert.ok((await one(db, "SELECT 1 AS ok FROM audit_events WHERE action='gst.filed' AND detail->>'text'='GSTR-1 filed for 112026'")).ok);
    // Filing GSTR-3B without a lock leaves the period lock as it is.
    await api.gstFiling(req, { period: "112026", returnType: "GSTR3B", arn: "AB3211260000003", filedOn: "2026-12-20" });
    assert.equal((await one(db, "SELECT closed_through::text AS c FROM company")).c, "2026-11-30");
  }
  finally {
    await db.query("UPDATE company SET closed_through=NULL");
  }
});
