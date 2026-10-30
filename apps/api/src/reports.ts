import type { Database, Row } from "./db.js";
import { D } from "./accounting.js";
export async function getReport(
  db: Database,
  f: {
  from: string;
  to: string;
  partyId?: string;
  projectId?: string;
  account?: string
}
) {
  // Budgets and recurring schedules review the whole month containing the end date (the current month by default).
  const month = f.to.slice(0, 7);
  const args: any[] = [f.from, f.to];
  let cond = "e.entry_date BETWEEN $1::date AND $2::date";
  if (f.partyId) {
    args.push(f.partyId);
    cond += " AND e.party_id=$" + args.length;
  }
  if (f.projectId) {
    args.push(f.projectId);
    cond += " AND e.project_id=$" + args.length;
  }
  if (f.account) {
    args.push(f.account);
    cond += " AND EXISTS(SELECT 1 FROM journal_lines x WHERE x.entry_id=e.id AND x.account_code=$" + args.length + ")";
  }
  const [
    lines,
    balances,
    entries,
    docs,
    parties,
    accounts,
    projects,
    company,
    budgets,
    recurring,
    bank,
    audit
  ] = await Promise.all([
    db.query(
      "SELECT e.id,e.entry_date::text,e.kind,e.party_id,e.project_id,a.code,a.name,a.kind AS account_kind,a.is_cash,l.debit::text,l.credit::text FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.code=l.account_code WHERE " + cond + " ORDER BY e.entry_date",
      args
    ),
    db.query(
      "SELECT a.*,COALESCE(SUM(CASE WHEN e.entry_date<=$1::date THEN l.debit-l.credit ELSE 0 END),0)::text AS balance FROM accounts a LEFT JOIN journal_lines l ON l.account_code=a.code LEFT JOIN journal_entries e ON e.id=l.entry_id GROUP BY a.code ORDER BY a.code",
      [f.to]
    ),
    db.query(
      "SELECT e.*,e.entry_date::text,p.name AS party_name,COALESCE(SUM(l.debit),0)::text AS amount,(SELECT r.id FROM journal_entries r WHERE r.reversal_of=e.id) AS reversed_by FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id LEFT JOIN parties p ON p.id=e.party_id WHERE " + cond + " GROUP BY e.id,p.name ORDER BY e.entry_date DESC,e.created_at DESC LIMIT 250",
      args
    ),
    db.query(
      "SELECT d.*,d.issue_date::text,d.due_date::text,p.name AS party_name,COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN journal_entries pe ON pe.id=a.entry_id WHERE a.document_id=d.id AND pe.entry_date<=$1::date),0)::text AS paid,COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN journal_entries pe ON pe.id=a.entry_id WHERE a.document_id=d.id AND pe.kind='CREDIT_NOTE' AND pe.entry_date<=$1::date),0)::text AS credited FROM documents d JOIN parties p ON p.id=d.party_id WHERE d.issue_date<=$1::date ORDER BY d.created_at DESC",
      [f.to]
    ),
    db.query(
      "SELECT p.*,COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.party_id=p.id AND l.account_code='1100' AND e.entry_date<=$1::date),0)::text AS receivable,COALESCE((SELECT SUM(l.credit-l.debit) FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.party_id=p.id AND l.account_code='2000' AND e.entry_date<=$1::date),0)::text AS payable FROM parties p ORDER BY name",
      [f.to]
    ),
    db.query("SELECT * FROM accounts ORDER BY code"),
    db.query("SELECT p.*,a.name AS party_name FROM projects p LEFT JOIN parties a ON a.id=p.party_id ORDER BY p.name"),
    db.query("SELECT *,closed_through::text FROM company WHERE id='company'"),
    db.query(
      "SELECT b.*,a.name,COALESCE((SELECT SUM(l.debit-l.credit) FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code=b.account_code AND to_char(e.entry_date,'YYYY-MM')=b.month),0)::text AS actual FROM budgets b JOIN accounts a ON a.code=b.account_code WHERE month=$1",
      [month]
    ),
    db.query(
      "SELECT r.*,(SELECT o.entry_id FROM recurring_occurrences o WHERE o.rule_id=r.id AND o.month=$1) AS posted_entry FROM recurring_rules r ORDER BY name",
      [month]
    ),
    db.query("SELECT b.*,b.entry_date::text,a.name AS account_name FROM bank_statement_lines b JOIN accounts a ON a.code=b.account_code ORDER BY b.entry_date DESC LIMIT 250"),
    db.query("SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100")
  ]);
  let income = new D(0), expense = new D(0), receipts = new D(0), payments = new D(0);
  const byMonth = new Map<string, {
    income: D;
    expense: D
  }>(), byExpense = new Map<string, D>();
  for (const l of lines.rows) {
    const d = new D(l.debit), c = new D(l.credit), m = l.entry_date.slice(0, 7);
    if (!byMonth.has(m))
      byMonth.set(m, { income: new D(0), expense: new D(0) });
    if (l.account_kind === "INCOME") {
      income = income.add(c.sub(d));
      byMonth.get(m)!.income = byMonth.get(m)!.income.add(c.sub(d));
    }
    if (l.account_kind === "EXPENSE") {
      expense = expense.add(d.sub(c));
      byMonth.get(m)!.expense = byMonth.get(m)!.expense.add(d.sub(c));
      byExpense.set(l.name, (byExpense.get(l.name) || new D(0)).add(d.sub(c)));
    }
    if (l.is_cash && l.kind !== "TRANSFER") {
      receipts = receipts.add(d);
      payments = payments.add(c);
    }
  }
  const filteredDocs = docs.rows.filter(d => (!f.partyId || d.party_id === f.partyId) && (!f.projectId || d.project_id === f.projectId));
  const outstanding: Row[] = filteredDocs.filter(d => d.kind === "INVOICE" && d.status === "ISSUED").map(d => ({ ...d, outstanding: new D(d.total).sub(d.paid).toFixed(2) }));
  const total = (xs: Row[], field: string) => xs.reduce((a, x) => a.add(x[field]), new D(0)).toFixed(2);
  const projectReports = projects.rows.map(p => { let revenue = new D(0), cost = new D(0); for (const l of lines.rows.filter(l => l.project_id === p.id)) {
    if (l.account_kind === "INCOME")
      revenue = revenue.add(new D(l.credit).sub(l.debit));
    if (l.account_kind === "EXPENSE")
      cost = cost.add(new D(l.debit).sub(l.credit));
  } return { ...p, revenue: revenue.toFixed(2), cost: cost.toFixed(2), profit: revenue.sub(cost).toFixed(2) }; });
  return {
    company: company.rows[0],
    metrics: {
      income: income.toFixed(2),
      expenses: expense.toFixed(2),
      profit: income.sub(expense).toFixed(2),
      receipts: receipts.toFixed(2),
      payments: payments.toFixed(2),
      cash: total(balances.rows.filter(a => a.is_cash), "balance"),
      receivables: total(outstanding, "outstanding"),
      // Payment receipts settle when issued and vendor bills are not a document type yet, so payables come from the ledger.
      payables: new D(balances.rows.find(a => a.code === "2000")?.balance || 0).neg().toFixed(2)
    },
    monthly: [...byMonth.entries()].map(([month, x]) => ({ month, income: x.income.toNumber(), expense: x.expense.toNumber() })),
    expenseBreakdown: [...byExpense.entries()].map(([name, value]) => ({ name, value: value.toNumber() })),
    entries: entries.rows,
    documents: filteredDocs,
    parties: parties.rows,
    accounts: accounts.rows,
    balances: balances.rows,
    projects: projectReports,
    budgets: budgets.rows,
    month,
    recurring: recurring.rows,
    bankLines: bank.rows,
    audit: audit.rows,
    range: f
  };
}
