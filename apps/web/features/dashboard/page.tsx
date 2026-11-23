import type { ReactNode } from "react";
import { ArrowRight, Download, Equal, Minus, Plus, RefreshCw } from "lucide-react";
import { DateRangePicker } from "../../components/date-range-picker";
import { Money } from "../../components/money";
import { outstandingOf, pretty, type Row } from "../../lib/format";

type Props = {
  ctx: any
};
const OUT_KINDS = ["EXPENSE", "REIMBURSEMENT", "ASSET", "PAYMENT", "CREDIT_NOTE", "PURCHASE"];
const TYPE_TONE: Record<string, string> = { EXPENSE: "#c08a3e", REIMBURSEMENT: "#a98a5a", ASSET: "#5d6db3", PURCHASE: "#c08a3e", PAYMENT: "#a98a5a", INVESTMENT: "#2e8a62", INCOME: "#2e8a62", INVOICE: "#2e8a62", BILL: "#2e8a62", RECEIPT: "#2e8a62" };
const num = (v: any) => Number(v || 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : 0;

function Foreign({ amount, currency }: { amount: number; currency: string }) {
  return <>{new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount)}</>;
}
function Section({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={"ov-sheet " + className}>
    <div className="ov-sec-h"><h2>{title}</h2>{aside}</div>
    {children}
  </section>;
}

type Point = { label: string; inflow: number; outflow: number; balance: number };
// Money in and out per day (or per month across long ranges), with the running cash balance worked back from today's balance.
function cashSeries(entries: Row[], closing: number, day: (s: string) => string): { points: Point[]; byMonth: boolean } {
  const moving = entries.filter(e => num(e.cash_in) !== 0);
  const days = new Set(moving.map(e => String(e.entry_date).slice(0, 10)));
  const byMonth = days.size > 31;
  const key = (e: Row) => String(e.entry_date).slice(0, byMonth ? 7 : 10);
  const buckets = new Map<string, { inflow: number; outflow: number }>();
  for (const e of moving) {
    const b = buckets.get(key(e)) || { inflow: 0, outflow: 0 };
    const c = num(e.cash_in);
    if (c > 0) b.inflow += c; else b.outflow += -c;
    buckets.set(key(e), b);
  }
  const keys = [...buckets.keys()].sort();
  let after = 0;
  const balances: number[] = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    balances[i] = round2(closing - after);
    const b = buckets.get(keys[i])!;
    after += b.inflow - b.outflow;
  }
  return { byMonth, points: keys.map((k, i) => ({
    label: byMonth ? new Date(k + "-01T12:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : day(k).replace(/ \d{4}$/, ""),
    inflow: round2(buckets.get(k)!.inflow), outflow: round2(buckets.get(k)!.outflow), balance: balances[i]
  })) };
}
function niceStep(span: number) {
  const raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
}
function CashChart({ points, short, money }: { points: Point[]; short: (v: number) => string; money: (v: any) => string }) {
  const W = 820, H = 236, L = 56, R = 16, T = 14, B = 34;
  const pw = W - L - R, ph = H - T - B;
  const hi = Math.max(1, ...points.flatMap(p => [p.inflow, p.outflow, p.balance]));
  const lo = Math.min(0, ...points.map(p => p.balance));
  const step = niceStep(hi - lo);
  const yMax = Math.ceil(hi / step) * step, yMin = Math.floor(lo / step) * step;
  const y = (v: number) => T + ph - ((v - yMin) / (yMax - yMin)) * ph;
  const ticks: number[] = [];
  for (let t = yMin; t <= yMax + 1e-6; t += step) ticks.push(t);
  const slot = pw / Math.max(points.length, 1), bw = Math.max(6, Math.min(34, slot * 0.3));
  const cx = (i: number) => L + slot * i + slot / 2;
  const last = points[points.length - 1];
  const summary = points.map(p => `${p.label}: in ${money(p.inflow)}, out ${money(p.outflow)}, balance ${money(p.balance)}`).join("; ");
  return <svg className="ov-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={"Cash movement. " + summary}>
    {ticks.map(t => <g key={t}>
      <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#dfe5e1" : "#eef1ee"}/>
      <text x={L - 10} y={y(t) + 4} textAnchor="end" className="ov-axis">{t === 0 ? "₹0" : (t < 0 ? "−" : "") + short(Math.abs(t))}</text>
    </g>)}
    {points.map((p, i) => <g key={p.label}>
      <rect x={cx(i) - bw - 3} y={y(Math.max(p.inflow, 0))} width={bw} height={Math.max(y(0) - y(p.inflow), 2)} rx={Math.min(4, bw / 3)} className={p.inflow ? "ov-bar-in" : "ov-bar-none"}><title>{p.label} · money in {money(p.inflow)}</title></rect>
      <rect x={cx(i) + 3} y={y(Math.max(p.outflow, 0))} width={bw} height={Math.max(y(0) - y(p.outflow), 2)} rx={Math.min(4, bw / 3)} className={p.outflow ? "ov-bar-out" : "ov-bar-none"}><title>{p.label} · money out {money(p.outflow)}</title></rect>
      {(points.length <= 16 || i % Math.ceil(points.length / 12) === 0) && <text x={cx(i)} y={H - 10} textAnchor="middle" className="ov-axis ink">{p.label}</text>}
    </g>)}
    <polyline className="ov-line" points={points.map((p, i) => `${cx(i)},${y(p.balance)}`).join(" ")}/>
    {points.map((p, i) => <circle key={p.label} cx={cx(i)} cy={y(p.balance)} r={4} className="ov-dot"><title>{p.label} · balance {money(p.balance)}</title></circle>)}
    {last && <g>
      <rect x={cx(points.length - 1) - 104} y={y(last.balance) - 11} width={92} height={22} rx={5} className="ov-chip"/>
      <text x={cx(points.length - 1) - 58} y={y(last.balance) + 4} textAnchor="middle" className="ov-chip-t">{money(last.balance)}</text>
    </g>}
  </svg>;
}

export function DashboardPage({ ctx }: Props) {
  const {
    page, data, metric, money, short, day, go, setDocKind, setReport, outstanding, billsDue, canWrite, viewDoc, open, from, to,
    setFrom, setTo, datePresets, partyFilter, setPartyFilter, loading, refresh, exportVisible, documentStatus,
  } = ctx;
  if (page !== "dashboard") return null;
  const filter: (rows: Row[]) => Row[] = ctx.filter;
  const income = num(metric.income), expenses = num(metric.expenses), profit = num(metric.profit);
  const margin = pct(profit, income), costShare = pct(expenses, income);
  const inRange = (d: Row) => d.issue_date >= from && d.issue_date <= to;
  const docs: Row[] = filter(data.documents);

  const { points: series, byMonth } = cashSeries(filter(data.entries), num(metric.cash), day);
  const cashAccounts: Row[] = (data.balances as Row[]).filter(b => b.is_cash && (num(b.balance) !== 0 || ["1000", "1010", "1020"].includes(b.code)))
    .sort((a, b) => num(b.balance) - num(a.balance));
  const maxAbs = Math.max(1, ...cashAccounts.map(b => Math.abs(num(b.balance))));
  const belowZero = cashAccounts.filter(b => num(b.balance) < 0);

  const collect = [...outstanding].sort((a: Row, b: Row) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")));
  const overdue = collect.filter((d: Row) => d.due_date && d.due_date < to).reduce((t: number, d: Row) => t + outstandingOf(d), 0);
  const receivables = num(metric.receivables), notDue = Math.max(0, receivables - overdue);
  const bills = [...billsDue].sort((a: Row, b: Row) => String(a.due_date || "9").localeCompare(String(b.due_date || "9")));

  const issuedTax = (kinds: string[]) => docs.filter(d => kinds.includes(d.kind) && d.status === "ISSUED" && inRange(d)).reduce((t, d) => t + num(d.inr_tax ?? d.tax), 0);
  const outputGst = issuedTax(["INVOICE", "SALES_DEBIT_NOTE"]), creditGst = issuedTax(["CREDIT_NOTE"]);
  const filings = (data.gstFilings || []) as Row[];

  const byClient = new Map<string, number>();
  for (const l of filter(data.categoryLines || []).filter((l: Row) => l.category === "INCOME")) {
    const k = l.party_name || "No client";
    byClient.set(k, round2((byClient.get(k) || 0) + num(l.in) - num(l.out)));
  }
  const clients = [...byClient.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const topClient = clients[0]?.[1] || 1;
  const categories = [...(data.expenseBreakdown as Row[])].sort((a, b) => num(b.value) - num(a.value));
  const topCategory = num(categories[0]?.value) || 1;

  const converted = new Set(docs.filter(x => x.kind === "INVOICE" && x.source_id && x.status !== "CANCELLED").map(x => x.source_id));
  const openQuotes = docs.filter(d => ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status === "ISSUED" && !converted.has(d.id));
  const quoteINR = openQuotes.filter(d => (d.currency || "INR") === "INR").reduce((t, d) => t + num(d.total), 0);
  const quoteForeign = Object.entries(openQuotes.filter(d => d.currency && d.currency !== "INR").reduce((m: Record<string, number>, d) => ({ ...m, [d.currency]: (m[d.currency] || 0) + num(d.total) }), {}));
  const drafts = docs.filter(d => d.status === "DRAFT" && !["PURCHASE", "DEBIT_NOTE"].includes(d.kind));
  const draftINR = drafts.reduce((t, d) => t + num(d.inr_total ?? d.total), 0);
  const projects = (data.projects as Row[]).filter(p => !p.archived && (num(p.revenue) || num(p.cost)));
  const projectProfit = projects.reduce((t, p) => t + num(p.profit), 0);
  const recurring = ((data.recurring || []) as Row[]).filter(r => r.active && !r.posted_entry);
  const recurringTotal = recurring.reduce((t, r) => t + num(r.amount), 0);

  const activePreset = (datePresets as Row[]).find(p => { const [f, t] = p.range(); return f === from && t === to; })?.label;
  const goCollect = () => { go("documents"); setDocKind("INVOICE"); };
  const goGst = () => { go("reports"); setReport("GST returns"); };
  const link = (label: string, onClick: () => void) => <button className="ov-link" onClick={onClick}>{label}<ArrowRight size={14}/></button>;
  const muted = (text: string) => <span className="ov-aside">{text}</span>;

  return <div className="ov">
    <header className="ov-head">
      <div className="ov-head-row">
        <div><h1>Business overview</h1><p>A little clarity for every business decision.</p></div>
        <div className="ov-actions">
          <button className="btn" onClick={exportVisible}><Download size={15}/>Export</button>
          {canWrite && <button className="btn primary" onClick={() => open("voucher")}><Plus size={16}/>New voucher</button>}
        </div>
      </div>
      <div className="ov-bar">
        <div className="ov-seg" role="group" aria-label="Period">
          {(datePresets as Row[]).map(p => <button key={p.label} aria-pressed={activePreset === p.label} className={activePreset === p.label ? "on" : ""} onClick={p.apply}>{p.label}</button>)}
        </div>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} day={day}/>
        <label className="docs-control select"><select aria-label="Filter by client or vendor" value={partyFilter} onChange={e => setPartyFilter(e.target.value)}>
          <option value="">All clients & vendors</option>
          {data.parties.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <button className={"icon-btn " + (loading ? "spinning" : "")} aria-label="Refresh data" disabled={loading} onClick={refresh}><RefreshCw size={15}/></button>
        <span className="ov-basis"><i/>Accrual basis</span>
      </div>
    </header>

    <section className="ov-sheet ov-pl">
      <div className="ov-sec-h"><h2>Profit &amp; loss</h2>{link("View report", () => go("reports"))}</div>
      <div className="ov-eq">
        <div className="ov-term"><small>Earned income</small><Money value={income}/><p>Revenue, excluding GST</p></div>
        <div className="ov-op" aria-label="minus"><Minus size={20} strokeWidth={1.6}/></div>
        <div className="ov-term"><small>Total expenses</small><Money value={expenses}/><p>Operating costs in this period</p></div>
        <div className="ov-op" aria-label="equals"><Equal size={20} strokeWidth={1.6}/></div>
        <div className={"ov-term ov-net" + (profit < 0 ? " loss" : "")}><small>{profit < 0 ? "Net loss" : "Net profit"}</small><Money value={profit}/>
          <p>{income > 0 ? (profit >= 0 ? margin + "% of earned income kept as profit" : "Expenses exceeded income") : "No income posted in this period"}</p></div>
      </div>
      {income > 0 && <div className="ov-split">
        <div className="ov-split-bar" role="img" aria-label={`Expenses ${costShare}%, profit ${Math.max(0, margin)}% of earned income`}>
          <i className="exp" style={{ flex: Math.min(costShare, 100) }}/>{margin > 0 && <i className="pro" style={{ flex: margin }}/>}
        </div>
        <div className="ov-split-k"><span><i className="exp"/>Expenses <b>{costShare}%</b></span><span>of every ₹100 earned</span><span><i className="pro"/>Profit <b>{Math.max(0, margin)}%</b></span></div>
      </div>}
    </section>

    <div className="ov-row r-8-4">
      <Section title="Cash movement" aside={muted(series.length ? series.length + " " + (byMonth ? "month" : "day") + (series.length === 1 ? "" : "s") + " with cash activity" : "No cash activity")}>
        <div className="ov-flow">
          <div className="in"><small>Money in</small><Money value={metric.receipts}/></div>
          <div><small>Money out</small><Money value={metric.payments}/></div>
          <div className={num(metric.receipts) - num(metric.payments) >= 0 ? "in" : ""}><small>Net change</small><Money value={round2(num(metric.receipts) - num(metric.payments))}/></div>
        </div>
        {series.length ? <><div className="ov-chart-wrap"><CashChart points={series} short={short} money={money}/></div>
          <div className="ov-legend"><span><i className="in"/>Money in</span><span><i className="out"/>Money out</span><span><i className="ln"/>Running cash balance</span></div></>
          : <p className="ov-empty">No money moved in or out in this period. Receipts and payments you post will show here day by day.</p>}
      </Section>

      <Section title="Cash & bank" aside={link("Bank & cash", () => go("bank"))}>
        {cashAccounts.map(b => <div className="ov-acct" key={b.code}>
          <div><b>{b.name}</b><small>{b.code}</small></div><Money value={b.balance}/>
          <div className="ov-track"><i className={num(b.balance) < 0 ? "neg" : ""} style={{ width: Math.max(1, Math.abs(num(b.balance)) / maxAbs * 100) + "%" }}/></div>
        </div>)}
        <div className="ov-acct total"><b>Total cash &amp; bank</b><Money value={metric.cash}/></div>
        {belowZero.length > 0 && <p className="ov-warn">{belowZero.map(b => b.name).join(" and ")} {belowZero.length === 1 ? "is" : "are"} below zero in the books. Check which account your receipts and payments were posted to.</p>}
      </Section>
    </div>

    <div className="ov-row r-3">
      <Section title="Money to collect" aside={link("Invoices", goCollect)}>
        <div className="ov-big"><Money value={receivables}/><p>{collect.length} unpaid invoice{collect.length === 1 ? "" : "s"} · as of {day(to)}</p></div>
        {receivables > 0 && <><div className="ov-age"><i className="ok" style={{ flex: notDue }}/>{overdue > 0 && <i className="late" style={{ flex: overdue }}/>}</div>
          <div className="ov-age-k"><span>Not yet due <Money value={notDue}/></span><span className={overdue > 0 ? "late" : ""}>Overdue <Money value={overdue}/></span></div></>}
        {collect.slice(0, 4).map((d: Row) => <button className="ov-li" key={d.id} onClick={() => viewDoc(d.id)}>
          <b title={d.party_name}>{d.party_name}</b><Money value={outstandingOf(d)}/>
          <small>{d.number}</small><span className={"ov-due" + (d.due_date && d.due_date < to ? " late" : "")}>{documentStatus(d) === "Overdue" ? "Overdue · " : "Due "}{day(d.due_date).replace(/ \d{4}$/, "")}</span>
        </button>)}
        {!collect.length && <p className="ov-empty">All caught up. No unpaid invoices in this view.</p>}
        {canWrite && collect.length > 0 && <div className="ov-foot-act"><button className="btn primary" onClick={() => open("payment")}>Record a receipt</button></div>}
      </Section>

      <Section title="Bills to pay" aside={link("Purchases", () => go("purchases"))}>
        <div className="ov-big"><Money value={metric.payables}/><p>{bills.length} vendor bill{bills.length === 1 ? "" : "s"} with a balance</p></div>
        {bills.slice(0, 3).map((d: Row) => <button className="ov-li" key={d.id} onClick={() => viewDoc(d.id)}>
          <b title={d.number + " · " + d.party_name}>{d.number} · {d.party_name}</b><Money value={outstandingOf(d)}/>
          <small>Billed {day(d.issue_date).replace(/ \d{4}$/, "")}</small><span className={"ov-due" + (d.due_date && d.due_date < to ? " late" : "")}>Due {day(d.due_date).replace(/ \d{4}$/, "")}</span>
        </button>)}
        {num(metric.vendorAdvances) > 0 && <div className="ov-li static"><b>Advances paid to vendors</b><Money value={metric.vendorAdvances}/><small>Not yet set against a bill</small><span/></div>}
        {num(metric.clientAdvances) > 0 && <div className="ov-li static"><b>Advances from clients</b><Money value={metric.clientAdvances}/><small>Not yet set against an invoice</small><span/></div>}
        {!bills.length && num(metric.vendorAdvances) <= 0 && <p className="ov-empty">No vendor bills waiting to be paid.</p>}
      </Section>

      <Section title="GST & TDS" aside={link("GST returns", goGst)}>
        <dl className="ov-dl">
          <div><dt>Output GST on issued invoices</dt><dd><Money value={outputGst}/></dd></div>
          {creditGst > 0 && <div><dt>Less GST on credit notes</dt><dd><Money value={-creditGst}/></dd></div>}
          <div><dt>Input tax credit on bills</dt><dd><Money value={metric.inputTax}/></dd></div>
          <div><dt>TDS receivable</dt><dd><Money value={data.tds?.receivableBalance}/></dd></div>
          <div><dt>TDS payable</dt><dd><Money value={data.tds?.payableDue}/></dd></div>
          <div><dt>GST returns filed</dt><dd>{filings.length ? filings.length + " filed" : "None yet"}</dd></div>
        </dl>
      </Section>
    </div>

    <div className="ov-row r-7-5">
      <Section title="Where your money goes" aside={muted(categories.length + " categor" + (categories.length === 1 ? "y" : "ies"))}>
        {categories.length ? <table className="ov-table">
          <thead><tr><th>Category</th><th className="share-h">Share of expenses</th><th className="r">Amount</th></tr></thead>
          <tbody>{categories.map(c => <tr key={c.name}>
            <td>{c.name}</td>
            <td><div className="ov-share"><span className="ov-track"><i className="exp" style={{ width: Math.max(1, num(c.value) / topCategory * 100) + "%" }}/></span><span className="p">{pct(num(c.value), expenses)}%</span></div></td>
            <td className="r"><Money value={c.value}/></td>
          </tr>)}</tbody>
          <tfoot><tr><td>Total expenses</td><td/><td className="r"><Money value={expenses}/></td></tr></tfoot>
        </table> : <p className="ov-empty">No expenses posted in this period.</p>}
      </Section>

      <Section title="Income by client" aside={muted(clients.length + " client" + (clients.length === 1 ? "" : "s"))}>
        {clients.slice(0, 6).map(([name, value]) => <div className="ov-client" key={name}>
          <b title={name}>{name}</b><Money value={value}/>
          <div className="ov-share"><span className="ov-track"><i style={{ width: Math.max(1, value / topClient * 100) + "%" }}/></span><span className="p">{pct(value, income)}%</span></div>
        </div>)}
        {clients.length ? <div className="ov-acct total"><b>Earned income</b><Money value={income}/></div> : <p className="ov-empty">No income posted in this period.</p>}
      </Section>
    </div>

    <Section title="In the pipeline" className="ov-pipe-s" aside={link("Documents", () => go("documents"))}>
      <div className="ov-pipe">
        <div><small>Open quotes &amp; proformas</small><Money value={quoteINR}/>
          <p>{quoteForeign.map(([c, v]) => <span key={c}>+ <Foreign amount={v as number} currency={c}/> · </span>)}{openQuotes.length} not yet converted{openQuotes.length ? ": " + openQuotes.slice(0, 2).map(d => d.number).join(", ") + (openQuotes.length > 2 ? "…" : "") : ""}</p></div>
        <div><small>Drafts waiting to issue</small><Money value={draftINR}/><p>{drafts.length} document{drafts.length === 1 ? "" : "s"}{drafts.length ? ": " + drafts.slice(0, 2).map(d => d.number).join(", ") + (drafts.length > 2 ? "…" : "") : ""}</p></div>
        <div><small>{projects.length === 1 ? "Project · " + projects[0].name : "Projects"}</small><Money value={projectProfit}/>
          <p>{projects.length ? (projects.length === 1 ? <><Money value={projects[0].revenue}/> revenue, <Money value={projects[0].cost}/> cost</> : projects.length + " projects with activity") : "No project activity yet"}</p></div>
        <div><small>Recurring still to confirm</small><Money value={recurringTotal}/><p>{recurring.length ? recurring.length + " scheduled entr" + (recurring.length === 1 ? "y" : "ies") + " this month" : "Nothing scheduled this month"}</p></div>
      </div>
    </Section>

    <Section title="Recent activity" aside={link("View all", () => go("vouchers"))}>
      {data.entries.length ? <table className="ov-table ov-act">
        <thead><tr><th>Date</th><th>Transaction</th><th>Type</th><th className="r">Amount</th></tr></thead>
        <tbody>{filter(data.entries).slice(0, 6).map((e: Row) => {
          // Cash direction from the ledger wins; entries that move no cash (bills, invoices) fall back to their kind.
          const out = num(e.cash_in) !== 0 ? num(e.cash_in) < 0 : OUT_KINDS.includes(e.kind);
          const label = e.reversed_by ? "Reversed" : e.kind === "PURCHASE" ? "Vendor bill" : e.kind === "PAYMENT" ? "Vendor payment" : pretty(e.kind);
          return <tr key={e.id}>
            <td className="d">{day(e.entry_date)}</td>
            <td><b>{e.description}</b><small>{e.number}{e.party_name ? " · " + e.party_name : ""}</small></td>
            <td><span className="ov-type"><i style={{ background: TYPE_TONE[e.kind] || "#8a958f" }}/>{label}</span></td>
            <td className={"r amt" + (out ? "" : " in")}>{out ? "− " : "+ "}<Money value={e.amount}/></td>
          </tr>;
        })}</tbody>
      </table> : <p className="ov-empty">No transactions posted yet.</p>}
    </Section>
  </div>;
}
