import type { Database } from "./db.js";
import { one } from "./db.js";
import { hashPassword } from "./auth.js";
import { id, postVoucher, createDocument, issueDocument, postPayment } from "./accounting.js";
const accounts = [
  ["1000", "Operating bank", "ASSET", true],
  ["1010", "Petty cash", "ASSET", true],
  ["1020", "Reserve bank", "ASSET", true],
  ["1100", "Accounts receivable", "ASSET", false],
  ["1400", "Investments", "ASSET", false],
  ["1410", "FD", "ASSET", false],
  ["1420", "RD", "ASSET", false],
  ["1500", "Fixed assets", "ASSET", false],
  ["1510", "Furniture & fixtures", "ASSET", false],
  ["1520", "Computers and laptops", "ASSET", false],
  ["1530", "Office equipment", "ASSET", false],
  ["1600", "Refundable deposits", "ASSET", false],
  ["2000", "Accounts payable", "LIABILITY", false],
  ["2100", "Output CGST", "LIABILITY", false],
  ["2110", "Output SGST", "LIABILITY", false],
  ["2120", "Output IGST", "LIABILITY", false],
  ["2200", "Loans payable", "LIABILITY", false],
  ["2300", "Client advances", "LIABILITY", false],
  ["3000", "Owner capital", "EQUITY", false],
  ["4000", "Service revenue", "INCOME", false],
  ["4100", "Other income", "INCOME", false],
  ["5100", "Rent", "EXPENSE", false],
  ["5200", "Software & subscriptions", "EXPENSE", false],
  ["5300", "Professional fees", "EXPENSE", false],
  ["5400", "Travel & meetings", "EXPENSE", false],
  ["5500", "Utilities", "EXPENSE", false],
  ["5600", "Marketing and advertising", "EXPENSE", false],
  ["5610", "Subscriptions", "EXPENSE", false],
  ["5620", "Wages", "EXPENSE", false],
  ["5630", "Watercan", "EXPENSE", false],
  ["5640", "Stationary", "EXPENSE", false],
  ["5650", "Travelling expense", "EXPENSE", false],
  ["5660", "Salaries", "EXPENSE", false]
] as const;
export async function bootstrap(
  db: Database,
  config: {
  demo: boolean;
  seed: boolean;
  email: string;
  password: string
}
) {
  if (config.password.length < 12)
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
  await db.tx(async q => { await q.query(
      "INSERT INTO company(id,name,demo) VALUES('company',$1,$2) ON CONFLICT DO NOTHING",
      [config.demo ? "Northstar Studio" : "Your Company", config.demo]
    ); for (const a of accounts)
    await q.query(
      "INSERT INTO accounts(code,name,kind,is_cash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [...a]
    ); if (!(await one(q, "SELECT id FROM users LIMIT 1")))
    await q.query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Administrator',$3,'ADMIN')",
      [id(), config.email.toLowerCase(), hashPassword(config.password)]
    ); });
  const company = await one(db, "SELECT * FROM company");
  if (company?.demo !== config.demo)
    throw new Error("DEMO_MODE does not match this database. Use a separate empty database when switching environments.");
  if (config.demo && config.seed && !(await one(db, "SELECT id FROM journal_entries LIMIT 1"))) {
    await db.tx(async q => {
      const user = await one(q, "SELECT * FROM users WHERE role='ADMIN' LIMIT 1");
      const actor = { id: user.id, role: user.role };
      const partyIds: string[] = [];
      for (const name of ["Aster Labs", "Seabrook Foods", "Forma Design", "Kora Retail", "Maple Properties"]) {
        const pid = id();
        partyIds.push(pid);
        await q.query(
          "INSERT INTO parties(id,name,email,kind,address) VALUES($1,$2,$3,$4,'Sample address · Kerala')",
          [
          pid,
          name,
          name.split(" ")[0].toLowerCase() + "@example.com",
          name === "Maple Properties" ? "VENDOR" : "CLIENT"
        ]
        );
      }
      const project = id();
      await q.query(
        "INSERT INTO projects(id,name,party_id,budget) VALUES($1,'Brand & digital retainer',$2,250000)",
        [project, partyIds[0]]
      );
      const now = new Date(), year = now.getUTCFullYear(), month = now.getUTCMonth();
      const date = (
        offset: number,
        day: number
      ) => new Date(Date.UTC(year, month + offset, day)).toISOString().slice(0, 10);
      await postVoucher(
        q,
        actor,
        {
        date: date(-5, 1),
        kind: "CAPITAL_IN",
        description: "Initial owner contribution",
        amount: "650000",
        cashAccount: "1000"
      }
      );
      for (let i = -5; i <= 0; i++) {
        for (let k = 0; k < 3; k++) {
          const value = 42000 + (i + 5) * 6500 + k * 11000;
          const doc = await createDocument(
            q,
            actor,
            {
            kind: "INVOICE",
            partyId: partyIds[k],
            projectId: k === 0 ? project : undefined,
            date: date(i, 3 + k * 3),
            dueDate: date(i, 18 + k * 3),
            taxTreatment: "TAXABLE",
            taxReason: "",
            placeOfSupply: "32",
            lines: [{
                description: ["Brand strategy retainer", "Digital campaign services", "Design & production"][k],
                quantity: "1",
                price: String(value),
                taxRate: "18",
                hsn: "9983"
              }],
            notes: "Demonstration entry. Not a legal tax invoice."
          }
          );
          // Invoice numbers are assigned on issue; the draft number is only a placeholder.
          const issued = await issueDocument(q, actor, doc.id);
          const full = (await one(q, "SELECT total FROM documents WHERE id=$1", [doc.id])).total;
          const received = i === 0 ? (k === 0 ? full : "20000") : full;
          await postPayment(
            q,
            actor,
            {
            direction: "RECEIPT",
            partyId: partyIds[k],
            date: date(i, 12 + k * 3),
            amount: received,
            cashAccount: "1000",
            description: "Payment · " + issued.number,
            allocations: [{ documentId: doc.id, amount: received }]
          }
          );
        }
        for (const [account, amount, description] of [
          ["5100", "24000", "Studio rent"],
          ["5200", String(8500 + (i + 5) * 500), "Tools & subscriptions"],
          ["5300", String(22000 + (i + 5) * 1900), "Freelance production"],
          ["5400", String(3000 + (i + 5) * 300), "Client travel"],
          ["5500", "4800", "Utilities"]
        ])
          await postVoucher(
          q,
          actor,
          { date: date(i, 9), kind: "EXPENSE", account, amount, description, cashAccount: "1000" }
        );
      }
      await createDocument(
        q,
        actor,
        {
        kind: "QUOTATION",
        partyId: partyIds[3],
        date: date(0, 20),
        dueDate: date(1, 4),
        taxTreatment: "TAXABLE",
        placeOfSupply: "32",
        lines: [{
            description: "Brand identity & packaging",
            quantity: "1",
            price: "95000",
            taxRate: "18",
            hsn: "9983"
          }]
      }
      );
      await postVoucher(
        q,
        actor,
        {
        date: date(0, 15),
        kind: "TRANSFER",
        description: "Reserve allocation",
        amount: "80000",
        cashAccount: "1000",
        destinationAccount: "1020"
      }
      );
      await q.query(
        "INSERT INTO budgets(id,month,account_code,amount) VALUES($1,$2,'5100',25000),($3,$2,'5200',12000),($4,$2,'5300',35000)",
        [id(), date(0, 1).slice(0, 7), id(), id()]
      );
      await q.query(
        "INSERT INTO recurring_rules(id,name,kind,account_code,cash_account,amount,day) VALUES($1,'Monthly studio rent','EXPENSE','5100','1000',24000,5)",
        [id()]
      );
    });
  }
}
