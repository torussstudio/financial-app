import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, migrate, one, type Database } from "../src/db.js";
import { bootstrap } from "../src/bootstrap.js";
import {
  id,
  postVoucher,
  writeJournal,
  createDocument,
  updateDocument,
  issueDocument,
  postPayment,
  idempotent,
  reverseJournal,
  calculateDocument
} from "../src/accounting.js";
import { getReport } from "../src/reports.js";
import { verifyPassword, hashPassword, writer, admin } from "../src/auth.js";
let db: Database, actor: any, pid: string;
before(async () => {
  db = await createDatabase({ embedded: true });
  await migrate(db);
  await bootstrap(
    db,
    { demo: true, seed: false, email: "test@example.com", password: "test-password-long" }
  );
  actor = await one(db, "SELECT id,role FROM users");
  pid = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Test client','CLIENT')", [pid]);
});
after(async () => {
  await db?.close();
});
test(
  "password hashes use salts and reject an incorrect password",
  () => {
  const h = hashPassword("a long password");
  assert(verifyPassword("a long password", h));
  assert(!verifyPassword("wrong password", h));
  assert.notEqual(h, hashPassword("a long password"));
}
);
test(
  "decimal calculation is exact; proformas never post",
  async () => {
  const c = calculateDocument({ taxTreatment: "TAXABLE", lines: [{ quantity: "3", price: "0.10", taxRate: "18" }] });
  assert.equal(c.subtotal, "0.30");
  assert.equal(c.tax, "0.05");
  const multi = calculateDocument({
    taxTreatment: "EXEMPT",
    lines: [
      { description: "Ten units", quantity: "10", price: "1000", taxRate: "18" },
      { description: "Two units", quantity: "2", price: "50", taxRate: "18" }
    ]
  });
  assert.equal(multi.lines[0].base, "10000.00");
  assert.equal(multi.subtotal, "10100.00");
  const d = await db.tx(q => createDocument(
    q,
    actor,
    {
    kind: "PROFORMA",
    partyId: pid,
    date: "2026-10-01",
    dueDate: "2026-10-15",
    taxTreatment: "EXEMPT",
    taxReason: "Test exemption",
    placeOfSupply: "32",
    lines: [{ description: "Work", quantity: "1", price: "10000", taxRate: "0" }]
  }
  ));
  await db.tx(q => issueDocument(q, actor, d.id));
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM journal_entries")).n, 0);
}
);
test(
  "editable draft documents retain custom number, currency, client snapshot and bounded advance",
  async () => {
  const customParty = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Custom client','CLIENT')", [customParty]);
  const initial = {
    kind: "INVOICE",
    number: "CUSTOM-INV-42",
    partyId: customParty,
    date: "2026-10-10",
    dueDate: "2026-10-25",
    taxTreatment: "EXEMPT",
    taxReason: "Test exemption",
    placeOfSupply: "32",
    currency: "USD",
    advanceAmount: "50.00",
    advanceStatus: "PARTIALLY_RECEIVED",
    client: {
      name: "Client copy",
      address: "Client address",
      gstin: "",
      contactName: "Alex Contact",
      phone: "12345"
    },
    lines: [{ description: "Service", quantity: "2", price: "100", taxRate: "0" }]
  };
  const d = await db.tx(q => createDocument(q, actor, initial));
  let saved = await one(db, "SELECT * FROM documents WHERE id=$1", [d.id]);
  assert.equal(saved.number, "CUSTOM-INV-42");
  assert.equal(saved.currency, "USD");
  assert.equal(saved.advance_status, "PARTIALLY_RECEIVED");
  assert.equal(saved.client_snapshot.name, "Client copy");
  assert.equal(saved.lines[0].base, "200.00");
  const edited = {
    ...initial,
    number: "CUSTOM-INV-42",
    advanceAmount: "100.00",
    advanceStatus: "FULLY_RECEIVED",
    lines: [{ ...initial.lines[0], quantity: "1" }]
  };
  await db.tx(q => updateDocument(q, actor, d.id, edited));
  saved = await one(db, "SELECT * FROM documents WHERE id=$1", [d.id]);
  assert.equal(saved.total, "100.00");
  assert.equal(saved.number, "CUSTOM-INV-42");
  assert.equal(saved.advance_status, "FULLY_RECEIVED");
  await assert.rejects(() => db.tx(q => createDocument(q, actor, initial)), /already in use/);
  await assert.rejects(
    () => db.tx(q => updateDocument(
    q,
    actor,
    d.id,
    { ...edited, advanceAmount: "101", advanceStatus: "FULLY_RECEIVED" }
  )),
    /cannot exceed/
  );
  const issued = await db.tx(q => createDocument(
    q,
    actor,
    {
    ...initial,
    kind: "PROFORMA",
    number: "CUSTOM-PF-42",
    advanceAmount: "0",
    advanceStatus: "NOT_RECEIVED"
  }
  ));
  await db.query("UPDATE documents SET status='ISSUED' WHERE id=$1", [issued.id]);
  await assert.rejects(
    () => db.tx(q => updateDocument(
    q,
    actor,
    issued.id,
    { ...edited, kind: "PROFORMA", advanceAmount: "0", advanceStatus: "NOT_RECEIVED" }
  )),
    /Only draft documents/
  );
}
);
test(
  "invoice + partial receipt + capital + expense reconcile",
  async () => {
  await db.tx(q => postVoucher(
    q,
    actor,
    {
    date: "2026-10-01",
    kind: "CAPITAL_IN",
    amount: "100000",
    cashAccount: "1000",
    description: "Owner contribution"
  }
  ));
  const d = await db.tx(q => createDocument(
    q,
    actor,
    {
    kind: "INVOICE",
    partyId: pid,
    date: "2026-10-02",
    dueDate: "2026-10-20",
    taxTreatment: "EXEMPT",
    taxReason: "Illustrative test",
    placeOfSupply: "32",
    lines: [{ description: "Completed work", quantity: "1", price: "10000", taxRate: "0" }]
  }
  ));
  await db.tx(q => issueDocument(q, actor, d.id));
  await db.tx(q => issueDocument(q, actor, d.id));
  await db.tx(q => postPayment(
    q,
    actor,
    {
    date: "2026-10-03",
    direction: "RECEIPT",
    partyId: pid,
    cashAccount: "1000",
    amount: "5000",
    number: "CUSTOM-RCPT-5",
    client: { contactName: "Receipt contact" },
    description: "Partial receipt",
    allocations: [{ documentId: d.id, amount: "5000" }]
  }
  ));
  assert.equal(
    (await one(
    db,
    "SELECT number FROM journal_entries WHERE kind='RECEIPT' AND party_id=$1 ORDER BY created_at DESC LIMIT 1",
    [pid]
  )).number,
    "CUSTOM-RCPT-5"
  );
  await assert.rejects(
    () => db.tx(q => postPayment(
    q,
    actor,
    {
    date: "2026-10-03",
    direction: "RECEIPT",
    partyId: pid,
    cashAccount: "1000",
    amount: "100",
    number: "CUSTOM-RCPT-5",
    description: "Duplicate receipt number",
    allocations: []
  }
  )),
    /already in use/
  );
  await db.tx(q => postVoucher(
    q,
    actor,
    {
    date: "2026-10-04",
    kind: "EXPENSE",
    account: "5100",
    amount: "2000",
    cashAccount: "1000",
    description: "Rent"
  }
  ));
  const report = await getReport(db, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(report.metrics.income, "10000.00");
  assert.equal(report.metrics.receivables, "5000.00");
  assert.equal(report.metrics.cash, "103000.00");
  assert.equal(report.metrics.profit, "8000.00");
  await assert.rejects(
    () => db.tx(q => postPayment(
    q,
    actor,
    {
    date: "2026-10-04",
    direction: "RECEIPT",
    partyId: pid,
    cashAccount: "1000",
    amount: "6000",
    description: "Overpayment",
    allocations: [{ documentId: d.id, amount: "6000" }]
  }
  )),
    /exceeds/
  );
}
);
test(
  "transfers do not change total cash or profit; retries do not duplicate",
  async () => {
  const b = {
    date: "2026-10-05",
    kind: "TRANSFER",
    amount: "1000",
    cashAccount: "1000",
    destinationAccount: "1010",
    description: "Petty cash funding"
  };
  const a = await idempotent(db, actor, "test-unique-key-1", b, q => postVoucher(q, actor, b));
  const second = await idempotent(db, actor, "test-unique-key-1", b, q => postVoucher(q, actor, b));
  assert.deepEqual(a, second);
  await assert.rejects(
    () => idempotent(db, actor, "test-unique-key-1", { ...b, amount: "2000" }, q => postVoucher(q, actor, b)),
    /already used/
  );
  const r = await getReport(db, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(r.metrics.cash, "103000.00");
  assert.equal(r.metrics.profit, "8000.00");
}
);
test(
  "period lock applies to vouchers and posting; database also rejects unbalanced journals",
  async () => {
  await db.query("UPDATE company SET closed_through='2026-10-31'");
  await assert.rejects(
    () => db.tx(q => postVoucher(
    q,
    actor,
    {
    date: "2026-10-06",
    kind: "INCOME",
    amount: "20",
    account: "4000",
    cashAccount: "1000",
    description: "Locked"
  }
  )),
    /closed/
  );
  await db.query("UPDATE company SET closed_through=NULL");
  await assert.rejects(
    () => db.tx(q => writeJournal(
    q,
    actor,
    {
    date: "2026-11-01",
    kind: "JOURNAL",
    description: "Bad",
    lines: [{ account: "1000", debit: "1" }, { account: "3000", credit: "2" }]
  }
  )),
    /balanced/
  );
  await assert.rejects(
    () => db.tx(async q => {
    await q.query(
      "INSERT INTO journal_entries(id,number,entry_date,kind,description) VALUES($1,'BAD','2026-11-01','TEST','Empty journal')",
      [id()]
    );
  }),
    /balanced/
  );
}
);
test(
  "posted entries cannot be edited and reversal leaves audit trail",
  async () => {
  const e = await db.tx(q => postVoucher(
    q,
    actor,
    {
    date: "2026-11-01",
    kind: "EXPENSE",
    amount: "500",
    account: "5200",
    cashAccount: "1000",
    description: "Wrong expense"
  }
  ));
  await assert.rejects(
    () => db.query("UPDATE journal_entries SET description='Changed' WHERE id=$1", [e.id]),
    /immutable/
  );
  await db.tx(q => reverseJournal(q, actor, e.id, "2026-11-02", "Duplicate purchase"));
  await assert.rejects(
    () => db.tx(q => reverseJournal(q, actor, e.id, "2026-11-02", "Again")),
    /already reversed/
  );
  const r = await getReport(db, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(r.metrics.expenses, "0.00");
}
);
test(
  "unrelated party cannot pay another client's document",
  async () => {
  const other = id();
  await db.query("INSERT INTO parties(id,name,kind) VALUES($1,'Other client','CLIENT')", [other]);
  const doc = await one(db, "SELECT * FROM documents WHERE kind='INVOICE' LIMIT 1");
  await assert.rejects(
    () => db.tx(q => postPayment(
    q,
    actor,
    {
    date: "2026-11-03",
    direction: "RECEIPT",
    partyId: other,
    cashAccount: "1000",
    amount: "100",
    description: "Wrong client",
    allocations: [{ documentId: doc.id, amount: "100" }]
  }
  )),
    /does not match/
  );
}
);
test(
  "report cash uses payment date, not invoice date",
  async () => {
  const d = await one(db, "SELECT * FROM documents WHERE kind='INVOICE' AND status='ISSUED' LIMIT 1");
  await db.tx(q => postPayment(
    q,
    actor,
    {
    date: "2026-11-05",
    direction: "RECEIPT",
    partyId: pid,
    cashAccount: "1000",
    amount: "1000",
    description: "November instalment",
    allocations: [{ documentId: d.id, amount: "1000" }]
  }
  ));
  const oct = await getReport(db, { from: "2026-10-01", to: "2026-10-31" }),
    nov = await getReport(db, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(oct.metrics.receivables, "5000.00");
  assert.equal(nov.metrics.receivables, "4000.00");
  assert.equal(nov.metrics.income, "0.00");
}
);
test(
  "a later transaction cannot append balanced lines to a posted journal",
  async () => {
  const e = await one(db, "SELECT id FROM journal_entries LIMIT 1");
  await assert.rejects(
    () => db.tx(async q => {
    await q.query(
      "INSERT INTO journal_lines(id,entry_id,account_code,debit,credit) VALUES($1,$2,'1000',1,0),($3,$2,'3000',0,1)",
      [id(), e.id, id()]
    );
  }),
    /Cannot append/
  );
}
);
test(
  "receipt snapshots survive later party profile changes",
  async () => {
  const receipt = await one(db, "SELECT id,snapshot FROM journal_entries WHERE kind='RECEIPT' LIMIT 1");
  assert.equal(receipt.snapshot.party.name, "Test client");
  assert.equal(receipt.snapshot.party.contact_name, "Receipt contact");
  await db.query("UPDATE parties SET name='Updated client' WHERE id=$1", [pid]);
  const saved = await one(db, "SELECT snapshot FROM journal_entries WHERE id=$1", [receipt.id]);
  assert.equal(saved.snapshot.party.name, "Test client");
}
);
test(
  "roles reject viewer writes and accountant administration",
  () => {
  assert.throws(() => writer({ id: "viewer", role: "VIEWER" }), /read-only/);
  assert.throws(() => admin({ id: "accountant", role: "ACCOUNTANT" }), /Administrator/);
  assert.doesNotThrow(() => writer({ id: "accountant", role: "ACCOUNTANT" }));
  assert.doesNotThrow(() => admin(actor));
}
);
