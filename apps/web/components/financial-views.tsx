import qrcode from "qrcode-generator";
import { Badge, Empty } from "./ui";
import { amountInWords, day, gstCharged, inrTotal, money, outstandingOf, pretty, RECEIVABLE_KINDS, treatmentLabel, type Row } from "../lib/format";
// The signed QR code returned by the IRP, drawn locally (no network) with qrcode-generator 1.4.4.
function SignedQr({ text }: { text: string }) {
  let src = "";
  for (const level of ["M", "L"] as const) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text);
      qr.make();
      src = qr.createDataURL(3, 2);
      break;
    } catch { /* Too long for this error-correction level; try the next. */ }
  }
  return src ? <img className="doc-qr" src={src} alt="Signed e-invoice QR code"/> : <p className="fine">Signed QR code is too long to draw.</p>;
}
// Report tabs built from the API's categoryLines; the keys match the categories assigned in reports.ts.
export const CATEGORY_REPORTS: Record<string, { key: string; title: string; inLabel: string; outLabel: string; creditSide: boolean; note: string }> = {
  Income: { key: "INCOME", title: "Income", inLabel: "Earned", outLabel: "Reduced", creditSide: true, note: "Income accounts, excluding output GST. Credit notes and reversals show as reductions." },
  Expenses: { key: "EXPENSE", title: "Expenses", inLabel: "Spent", outLabel: "Reduced", creditSide: false, note: "Expense accounts, including reimbursements." },
  Investments: { key: "INVESTMENT", title: "Investments", inLabel: "Invested", outLabel: "Withdrawn", creditSide: false, note: "Investment accounts such as FD and RD." },
  Capital: { key: "CAPITAL", title: "Capital", inLabel: "Capital in", outLabel: "Capital returned", creditSide: true, note: "Owner capital brought in and returned." },
  Loans: { key: "LOAN", title: "Loans", inLabel: "Loan received", outLabel: "Repaid", creditSide: true, note: "Loan principal received and repaid." },
  Assets: { key: "ASSET", title: "Assets", inLabel: "Purchased", outLabel: "Reduced", creditSide: false, note: "Fixed assets and deposits. Cash, bank, receivables and investments are not included here." }
};
export function Report({ data, type, to, from }: {
  data: Row;
  type: string;
  to: string;
  from: string;
}) {
  const balances = data.balances as Row[], m = data.metrics;
  if (type === "P&L")
    return <div className="report-body">
    <div className="report-title">
      <h2>Profit & loss</h2>
      <p>{day(from)} — {day(to)} · Accrual basis · Selected activity filters</p>
    </div>
    <div className="statement-row"><span>Earned income</span><strong>{money(m.income)}</strong></div>
    <div className="statement-row">
      <span>Operating expenses</span>
      <strong>{money(m.expenses)}</strong>
    </div>
    {data.expenseBreakdown.map((e: Row) => <div className="statement-row subrow" key={e.name}>
      <span>{e.name}</span>
      <span>{money(e.value)}</span>
    </div>)}
    <div className="statement-row total">
      <span>Net profit / loss</span>
      <strong>{money(m.profit)}</strong>
    </div>
    <p className="fine">Capital, loan principal, transfers and output GST are excluded from operating income and expenses.</p>
  </div>;
  if (type === "Trial balance") {
    const dr = balances.reduce((s, a) => s + Math.max(0, Number(a.balance)), 0),
      cr = balances.reduce((s, a) => s + Math.max(0, -Number(a.balance)), 0);
    return <><div className="panel-note">Company-wide balances as of {day(to)}. Party and category activity filters do not alter the trial balance.</div><div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Group</th>
              <th className="right">Debit</th>
              <th className="right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {balances.map(a => <tr key={a.code}>
              <td>{a.code}</td>
              <td>{a.name}</td>
              <td>{pretty(a.kind)}</td>
              <td className="right">{Number(a.balance) > 0 ? money(a.balance) : "—"}</td>
              <td className="right">{Number(a.balance) < 0 ? money(-Number(a.balance)) : "—"}</td>
            </tr>)}
            <tr className="total-row">
              <td colSpan={3}>Total</td>
              <td className="right">{money(dr)}</td>
              <td className="right">{money(cr)}</td>
            </tr>
          </tbody>
        </table>
      </div></>;
  }
  if (type === "Balance sheet") {
    const sum = (
      kind: string,
      sign: number
    ) => balances.filter(a => a.kind === kind).reduce((s, a) => s + Number(a.balance) * sign, 0);
    const earnings = sum("INCOME", -1) - sum("EXPENSE", 1);
    return <div className="report-body">
      <div className="report-title"><h2>Balance sheet</h2><p>Company-wide · as of {day(to)}</p></div>
      {["ASSET", "LIABILITY", "EQUITY"].map(kind => <div key={kind}>
        <h3>{pretty(kind)}</h3>
        {balances.filter(a => a.kind === kind && Number(a.balance) !== 0).map(a => <div className="statement-row" key={a.code}>
          <span>{a.name}</span>
          <strong>{money(Number(a.balance) * (kind === "ASSET" ? 1 : -1))}</strong>
        </div>)}
        {kind === "EQUITY" && <div className="statement-row">
          <span>Cumulative earnings</span>
          <strong>{money(earnings)}</strong>
        </div>}
      </div>)}
      <div className="statement-row total">
        <span>Total assets</span>
        <strong>{money(sum("ASSET", 1))}</strong>
      </div>
      <div className="statement-row total">
        <span>Total liabilities & equity</span>
        <strong>{money(sum("LIABILITY", -1) + sum("EQUITY", -1) + earnings)}</strong>
      </div>
    </div>;
  }
  if (type === "Ageing" || type === "Payables ageing") {
    const payables = type === "Payables ageing";
    const rows = data.documents.filter((d: Row) => (payables ? d.kind === "PURCHASE" : RECEIVABLE_KINDS.includes(d.kind)) && d.status === "ISSUED" && outstandingOf(d) > 0);
    return <><div className="panel-note">{payables ? "Unpaid vendor bills" : "Outstanding invoices"} as of {day(to)}; includes documents before the selected start date.</div><div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Party</th>
              <th>Due date</th>
              <th>Age bucket</th>
              <th className="right">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d: Row) => {
      const days = Math.floor((Date.parse(to) - Date.parse(d.due_date)) / 86400000);
      return <tr key={d.id}>
                <td>{d.number}{d.reference && <small>Supplier bill {d.reference}</small>}</td>
                <td>{d.party_name}</td>
                <td>{day(d.due_date)}</td>
                <td>
                  <Badge tone={days > 0 ? "red" : ""}>
                    {days <= 0 ? "Not due" : days <= 30 ? "1–30 days" : days <= 60 ? "31–60 days" : days <= 90 ? "61–90 days" : "90+ days"}
                  </Badge>
                </td>
                <td className="right amount">{money(outstandingOf(d))}</td>
              </tr>;
    })}
          </tbody>
        </table>
      </div>{!rows.length && <Empty label="No outstanding balances"/>}</>;
  }
  const category = CATEGORY_REPORTS[type];
  if (category) {
    const lines = (data.categoryLines as Row[]).filter(l => l.category === category.key);
    const cents = (v: any) => Math.round(Number(v || 0) * 100);
    const totalIn = lines.reduce((s, l) => s + cents(l.in), 0) / 100, totalOut = lines.reduce((s, l) => s + cents(l.out), 0) / 100;
    const byAccount = [...new Set(lines.map(l => l.code))].map(code => {
      const own = lines.filter(l => l.code === code);
      return {
        code,
        name: own[0].name,
        in: own.reduce((s, l) => s + cents(l.in), 0) / 100,
        out: own.reduce((s, l) => s + cents(l.out), 0) / 100,
        balance: Number(balances.find(a => a.code === code)?.balance || 0) * (category.creditSide ? -1 : 1)
      };
    });
    const showBalance = category.key !== "INCOME" && category.key !== "EXPENSE";
    return <div className="report-body">
      <div className="report-title">
        <h2>{category.title}</h2>
        <p>{day(from)} — {day(to)} · Selected date range and client / vendor filter</p>
      </div>
      {byAccount.map(a => <div className="statement-row" key={a.code}>
        <span>{a.name}{showBalance && <small className="muted"> · balance {money(a.balance)} as of {day(to)}</small>}</span>
        <strong>{money(a.in - a.out)}</strong>
      </div>)}
      <div className="statement-row total">
        <span>Net {category.title.toLowerCase()} for the period</span>
        <strong>{money(totalIn - totalOut)}</strong>
      </div>
      <h3>Transactions</h3>
      {lines.length ? <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Particulars</th>
              <th>Ref</th>
              <th>Account</th>
              <th className="right">{category.inLabel}</th>
              <th className="right">{category.outLabel}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => <tr key={l.entry_id + ":" + l.code + ":" + i}>
              <td className="muted nowrap">{day(l.entry_date)}</td>
              <td><strong>{l.party_name || l.description}</strong>{l.party_name && <small>{l.description}</small>}</td>
              <td className="nowrap">{l.number}<small>{pretty(l.kind)}</small></td>
              <td>{l.name}</td>
              <td className="right amount">{Number(l.in) > 0 ? money(l.in) : "—"}</td>
              <td className="right amount">{Number(l.out) > 0 ? money(l.out) : "—"}</td>
            </tr>)}
            <tr className="total-row">
              <td colSpan={4}>Total</td>
              <td className="right amount">{money(totalIn)}</td>
              <td className="right amount">{money(totalOut)}</td>
            </tr>
          </tbody>
        </table>
      </div> : <Empty label={"No " + category.title.toLowerCase() + " in this period"}/>}
      <p className="fine">{category.note} Balances are company-wide as of the end date; the period totals follow the date range and client / vendor filter.</p>
    </div>;
  }
  if (type === "TDS") {
    const tds = data.tds || { receivable: [], payable: [] };
    const receivable: Row[] = tds.receivable, payable: Row[] = tds.payable;
    const totals = (rows: Row[], key: string) => rows.reduce((s, r) => s + Math.round(Number(r[key]) * 100), 0) / 100;
    return <div className="report-body">
      <div className="report-title"><h2>TDS receivable</h2><p>Deducted by clients from their payments · {day(from)} — {day(to)} · balance as of {day(to)}</p></div>
      {receivable.length ? <div className="table-scroll"><table>
        <thead><tr><th>Client</th><th>GSTIN</th><th className="right">Receipts</th><th className="right">TDS in period</th><th className="right">Balance to recover</th></tr></thead>
        <tbody>
          {receivable.map(r => <tr key={r.party_id || "none"}><td>{r.party_name || "No client"}</td><td className="mono">{r.gstin || "—"}</td><td className="right">{r.receipts}</td><td className="right amount">{money(r.in_range)}</td><td className="right amount">{money(r.balance)}</td></tr>)}
          <tr className="total-row"><td colSpan={3}>Total</td><td className="right amount">{money(totals(receivable, "in_range"))}</td><td className="right amount">{money(totals(receivable, "balance"))}</td></tr>
        </tbody>
      </table></div> : <Empty label="No TDS deducted by clients in this period"/>}
      <p className="fine">Reconcile each client's figure with Form 26AS / AIS before claiming it in the income-tax return. Reversed receipts net out.</p>
      <div className="report-title"><h2>TDS payable</h2><p>Deducted from vendor payments, by section and month · as of {day(to)}</p></div>
      {payable.length ? <div className="table-scroll"><table>
        <thead><tr><th>Section</th><th>Month</th><th className="right">Deducted</th><th className="right">Deposited</th><th className="right">Due</th><th>Deposit by</th></tr></thead>
        <tbody>
          {payable.map(r => <tr key={r.section + r.period}>
            <td>{r.section}</td><td className="nowrap">{r.period}</td>
            <td className="right amount">{money(r.deducted)}</td><td className="right amount">{money(r.deposited)}</td>
            <td className="right amount">{Number(r.due) > 0 ? <Badge tone={r.dueBy < to ? "red" : "amber"}>{money(r.due)}</Badge> : money(r.due)}</td>
            <td className="nowrap">{Number(r.due) > 0 ? day(r.dueBy) : "—"}</td>
          </tr>)}
          <tr className="total-row"><td colSpan={2}>Total</td><td className="right amount">{money(totals(payable, "deducted"))}</td><td className="right amount">{money(totals(payable, "deposited"))}</td><td className="right amount">{money(totals(payable, "due"))}</td><td /></tr>
        </tbody>
      </table></div> : <Empty label="No TDS deducted on vendor payments"/>}
      <p className="fine">Deposit with a TDS deposit voucher (Daily vouchers → TDS deposit) quoting the challan. Due dates follow Rule 30 (7th of the next month; 30 April for March). Quarterly returns (24Q/26Q) and Form 16A are not prepared here.</p>
    </div>;
  }
  if (type === "GST summary") {
    // Credit notes reduce output tax (negative); sales debit notes add to it. Amounts are INR (a foreign invoice at its INR value).
    const rows = data.documents.filter((d: Row) => ["INVOICE", "CREDIT_NOTE", "SALES_DEBIT_NOTE"].includes(d.kind) && d.status === "ISSUED" && d.issue_date >= from);
    const sign = (d: Row) => d.kind === "CREDIT_NOTE" ? -1 : 1;
    const inr = (d: Row, field: "subtotal" | "tax") => d["inr_" + field] ?? d[field];
    const sum = (field: "subtotal" | "tax") => rows.reduce((s: number, d: Row) => s + sign(d) * Math.round(Number(inr(d, field)) * 100), 0) / 100;
    return <><div className="panel-note">Output tax working summary from issued invoices and sales debit notes, less credit notes, in INR. This is not a filed GST return — see GST returns for the GSTR-1 / GSTR-3B working.</div><div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th>Treatment</th>
              <th className="right">Base</th>
              <th className="right">Tax</th>
              <th>Supply</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d: Row) => <tr key={d.id}>
              <td>{d.number}{d.kind === "CREDIT_NOTE" ? <small>Credit note</small> : d.kind === "SALES_DEBIT_NOTE" ? <small>Debit note</small> : d.currency && d.currency !== "INR" ? <small>{d.currency} {d.total}</small> : null}</td>
              <td>{d.party_name}</td>
              <td>{treatmentLabel(d)}</td>
              <td className="right">{money(sign(d) * Number(inr(d, "subtotal")))}</td>
              <td className="right">{money(sign(d) * Number(inr(d, "tax")))}</td>
              <td>{d.tax_treatment === "ZERO_RATED" ? "Export / SEZ" : d.interstate ? "Inter-state" : "Intra-state"}</td>
            </tr>)}
            {rows.length > 0 && <tr className="total-row">
              <td colSpan={3}>Net</td>
              <td className="right">{money(sum("subtotal"))}</td>
              <td className="right">{money(sum("tax"))}</td>
              <td />
            </tr>}
          </tbody>
        </table>
      </div>
      {(() => {
        // Input tax from posted vendor bills (including reverse-charge bills) less purchase debit notes; ITC-blocked bills are shown but not counted.
        const bills = data.documents.filter((d: Row) => ["PURCHASE", "DEBIT_NOTE"].includes(d.kind) && d.status === "ISSUED" && d.tax_treatment === "TAXABLE" && d.issue_date >= from);
        const billSign = (d: Row) => d.kind === "DEBIT_NOTE" ? -1 : 1;
        const claim = bills.filter((d: Row) => d.itc_eligible !== false);
        const itc = claim.reduce((s: number, d: Row) => s + billSign(d) * Math.round(Number(d.tax) * 100), 0) / 100;
        // Reverse-charge tax is owed by the company and paid in cash; it is not reduced by ITC.
        const rcm = bills.filter((d: Row) => d.reverse_charge).reduce((s: number, d: Row) => s + billSign(d) * Math.round(Number(d.tax) * 100), 0) / 100;
        return <>
          <div className="report-title"><h2>Input tax credit (ITC)</h2><p>Posted vendor bills and debit notes from {day(from)} to {day(to)}</p></div>
          {bills.length ? <div className="table-scroll"><table>
            <thead><tr><th>Supplier bill</th><th>Vendor</th><th>Date</th><th className="right">Taxable value</th><th className="right">GST</th><th>Claim</th></tr></thead>
            <tbody>
              {bills.map((d: Row) => <tr key={d.id}>
                <td>{d.reference}<small>{d.number}{d.kind === "DEBIT_NOTE" ? " · debit note" : ""}{d.reverse_charge ? " · reverse charge" : ""}</small></td>
                <td>{d.party_name}</td>
                <td className="nowrap">{day(d.issue_date)}</td>
                <td className="right">{money(billSign(d) * Number(d.subtotal))}</td>
                <td className="right">{money(billSign(d) * Number(d.tax))}</td>
                <td>{d.itc_eligible !== false ? (d.interstate ? "IGST" : "CGST + SGST") : "Blocked"}</td>
              </tr>)}
              <tr className="total-row"><td colSpan={4}>Eligible input tax</td><td className="right">{money(itc)}</td><td /></tr>
            </tbody>
          </table></div> : <Empty label="No GST vendor bills in this period"/>}
          {rcm !== 0 && <div className="statement-row"><span>Tax payable under reverse charge (in cash; included in eligible ITC above where claimable)</span><strong>{money(rcm)}</strong></div>}
          <div className="statement-row total"><span>Output tax less eligible input tax (working figure)</span><strong>{money(sum("tax") - itc)}</strong></div>
          <p className="fine">A working comparison only. It is not reconciled with GSTR-2B and is not a filed return. GST returns applies the set-off order and shows the RCM cash liability.</p>
        </>;
      })()}</>;
  }
  return <><div className="panel-note">Latest 100 audit events, independent of the report date filter.</div><div className="table-scroll">
      <table>
        <thead><tr><th>Action</th><th>User</th><th>Time</th><th>Reference</th></tr></thead>
        <tbody>
          {data.audit.map((a: Row) => <tr key={a.id}>
            <td>{a.action}</td>
            <td>{a.actor_name || "System"}</td>
            <td>{new Date(a.created_at).toLocaleString("en-IN")}</td>
            <td className="muted mono">{a.entity_id.slice(0, 12)}</td>
          </tr>)}
        </tbody>
      </table>
    </div></>;
}
export function DocumentPreview({ d }: {
  d: Row
}) {
  const isReceipt = d.view === "receipt", isPaymentReceipt = !isReceipt && d.kind === "BILL";
  const isCreditNote = !isReceipt && d.kind === "CREDIT_NOTE";
  // A sales debit note prints like an invoice (it is billed to the client); a purchase debit note is addressed to the vendor.
  const isSalesDebit = !isReceipt && d.kind === "SALES_DEBIT_NOTE", isPurchaseDebit = !isReceipt && d.kind === "DEBIT_NOTE";
  const isInvoice = !isReceipt && (d.kind === "INVOICE" || isSalesDebit);
  // gstDoc: a GST document of the registered company (taxable or zero-rated); gst: GST is actually charged on it.
  const gstDoc = !isReceipt && !isPaymentReceipt && ["TAXABLE", "ZERO_RATED"].includes(d.tax_treatment),
    gst = gstDoc && gstCharged(d.tax_treatment, d.zero_rated_type);
  const company = d.company || {}, party = d.party || {}, lines: Row[] = d.lines || [];
  const documentLogo = isReceipt ? "" : gstDoc ? company.gst_logo : company.non_gst_logo;
  const docMoney = (value: any) => new Intl.NumberFormat(
    "en-IN",
    { style: "currency", currency: d.currency || "INR", maximumFractionDigits: 2 }
  ).format(Number(value || 0));
  const title = isReceipt ? (d.kind === "PAYMENT" ? "Payment voucher" : "Payment receipt") : isPaymentReceipt ? "PAYMENT RECEIPT"
    : isSalesDebit || isPurchaseDebit ? "DEBIT NOTE" : isInvoice ? "INVOICE" : pretty(d.kind);
  // An issued foreign-currency document is settled in its own currency; its INR equivalents are printed alongside.
  const foreignDoc = !isReceipt && d.total_inr != null && d.currency && d.currency !== "INR";
  const subtotal = Number(d.subtotal || 0),
    total = Number(d.total || 0),
    // Issued invoices show what was actually received (the advance is posted as an allocated receipt); drafts show the planned advance.
    credited = foreignDoc ? 0 : Math.max(0, Number(d.credited || 0)),
    settled = d.status === "ISSUED" ? Math.max(0, Number((foreignDoc ? d.foreign_paid : d.paid) || 0)) : Math.max(0, Number(d.advance_amount || 0)),
    // Money actually received excludes the part settled by credit notes.
    advance = Math.max(0, settled - (d.status === "ISSUED" ? credited : 0));
  let cgst = 0, sgst = 0;
  if (gst && !d.interstate)
    for (const line of lines) {
      const tax = Number(line.tax || 0), half = Math.round(tax / 2 * 100) / 100;
      cgst += half;
      sgst += tax - half;
    }
  const igst = gst && d.interstate ? Number(d.tax || 0) : 0, amount = Number(d.amount || 0);
  const splitBank = String(company.bank_details || "").split(/\r?\n/).filter(Boolean);
  const legacyBank = String(company.bank_details || "");
  const bankFields = [
    ["Account holder", company.account_holder_name],
    ["Bank", company.bank_name],
    ["Account number", company.account_number],
    ["IFSC", company.ifsc_code],
    ["Branch", company.branch_name]
  ].filter(([, value]) => Boolean(value));
  const legacyFields = ["Account Name", "Account Number", "IFSC"].map(label => [
    label,
    legacyBank.match(new RegExp("^\\s*" + label.replace(" ", "\\s+") + "\\s*:\\s*(.+)$", "im"))?.[1]?.trim()
  ]).filter(([, value]) => Boolean(value));
  const invoiceBankFields = bankFields.length ? bankFields : legacyFields;
  const companyAddress = [
    company.address,
    company.address_line2,
    [company.city, company.state_name || company.state, company.pin_code].filter(Boolean).join(", ")
  ].filter(Boolean);
  const receiptDate = (value: unknown) => {
    const [year, month, date] = String(value || "").slice(0, 10).split("-");
    return year && month && date ? `${date}/${month}/${year}` : day(String(value || ""));
  };
  const receiptBody = <><div className="receipt-amount">
      <small>AMOUNT {d.kind === "PAYMENT" ? "PAID" : "RECEIVED"}</small>
      <h1>{docMoney(amount)}</h1>
      <p>{d.description}</p>
    </div><table>
      <thead><tr><th>Applied to</th><th className="right">Amount</th></tr></thead>
      <tbody>
        {(d.allocations || []).map((a: Row) => <tr key={a.number}><td>{a.number}{a.foreign_amount && <small>{a.currency} {a.foreign_amount} settled</small>}</td><td className="right">{docMoney(a.amount)}</td></tr>)}
        {Number(d.tds_amount) > 0 && <>
          <tr><td>{d.kind === "PAYMENT"
            ? "TDS deducted" + (d.tds_detail?.section ? " u/s " + d.tds_detail.section + (d.tds_detail.rate ? " @ " + d.tds_detail.rate + "%" : "") : "") + " — deposited to the government on the vendor's behalf"
            : "TDS deducted by the client"}</td><td className="right">{docMoney(d.tds_amount)}</td></tr>
          <tr className="total-row"><td>Total settled ({d.kind === "PAYMENT" ? "paid" : "received"} + TDS)</td><td className="right">{docMoney(d.gross_amount)}</td></tr>
        </>}
        {Number(d.fx_difference) !== 0 && <tr><td>Foreign exchange {Number(d.fx_difference) > 0 ? "gain" : "loss"} on settlement</td><td className="right">{docMoney(Math.abs(Number(d.fx_difference)))}</td></tr>}
      </tbody>
    </table></>;
  const paymentReceiptBody = <div className="payment-receipt-content"><table className="payment-receipt-grid">
      <tbody>
        <tr><th colSpan={2}>PAYMENT RECEIPT</th></tr>
        <tr><td>Receipt No: {d.number}</td><td>Date: {receiptDate(d.issue_date)}</td></tr>
        <tr><td>Receipt date: {receiptDate(d.issue_date)}</td><td>Place: {[String(company.city || "").toLocaleUpperCase(), company.state_name].filter(Boolean).join(", ")}</td></tr>
        <tr><td>State: {company.state_name || ""}</td><td>Contact: {company.contact_number || company.contact || company.phone || ""}</td></tr>
        <tr><th>RECEIVED FROM</th><th /></tr>
        <tr><td>Name: {party.name || ""}</td><td /></tr>
        <tr><td>Address: {party.address || ""}</td><td /></tr>
      </tbody>
    </table><table className="payment-receipt-grid payment-receipt-lines">
      <thead><tr><th>S. No.</th><th>Product Description</th><th className="right">Amount Received<br/>(INR)</th></tr></thead>
      <tbody>
        {lines.map((
    line,
    i
  ) => <tr key={i}>
          <td>{i + 1}</td>
          <td>{line.description}</td>
          <td className="right">{Number(line.base || 0).toLocaleString("en-IN", { useGrouping: false, maximumFractionDigits: 2 })}</td>
        </tr>)}
      </tbody>
    </table><div className="payment-receipt-bottom"><table className="payment-receipt-grid">
      <tbody>
        <tr><th>Amount in Words</th></tr>
        <tr><td>{amountInWords(total)}</td></tr>
        <tr><th>Mode of Payment</th></tr>
        {["Cash", "Cheque", "Bank Transfer"].map(method => <tr key={method}><td>{method}<span className="payment-receipt-check">{d.payment_method === method ? "✓" : ""}</span></td></tr>)}
        <tr><td>Certified that the particulars given above are true and correct.</td></tr>
      </tbody>
    </table><div className="payment-receipt-blank" aria-hidden="true" /></div></div>;
  const invoiceRows = lines.map((
    line,
    i
  ) => {
    const tax = gst ? Number(line.tax || 0) : 0,
      half = Math.round(tax / 2 * 100) / 100,
      otherHalf = tax - half;
    return <tr key={i}>
      <td>{i + 1}</td>
      <td><strong>{line.description}</strong>{line.hsn && <small>HSN/SAC {line.hsn}</small>}</td>
      <td className="right">{line.quantity}</td>
      <td className="right">{docMoney(line.price)}</td>
      <td className="right">{docMoney(line.base)}</td>
      {gst && (d.interstate ? <td className="right">{docMoney(tax)}</td> : <><td className="right">{docMoney(half)}</td><td className="right">{docMoney(otherHalf)}</td></>)}
      <td className="right">{docMoney(Number(line.base || 0) + tax)}</td>
    </tr>;
  });
  const invoiceBody = <><div className="document-table-scroll">
      <table className="document-table">
        <thead>
          <tr>
            <th>SL</th>
            <th>Description</th>
            <th className="right">Qty</th>
            <th className="right">Rate</th>
            <th className="right">Line amount</th>
            {gst && (d.interstate ? <th className="right">IGST</th> : <><th className="right">CGST</th><th className="right">SGST</th></>)}
            <th className="right">Total</th>
          </tr>
        </thead>
        <tbody>{invoiceRows}</tbody>
      </table>
    </div><div className="doc-totals">
      <div><span>Subtotal</span><strong>{docMoney(subtotal)}</strong></div>
      {gst && (d.interstate ? <div><span>IGST</span><strong>{docMoney(igst)}</strong></div> : <><div><span>CGST</span><strong>{docMoney(cgst)}</strong></div><div><span>SGST</span><strong>{docMoney(sgst)}</strong></div></>)}
      <div><span>{d.status === "ISSUED" ? "Amount Received" : "Advance Paid"}</span><strong>{docMoney(advance)}</strong></div>
      {credited > 0 && <div><span>Credit notes</span><strong>{docMoney(credited)}</strong></div>}
      <div><span>Balance Payable</span><strong>{docMoney(Math.max(0, total - settled))}</strong></div>
      <div className="grand-total"><span>Total</span><strong>{docMoney(total)}</strong></div>
    </div>{gst && d.tax_reason && <p className="doc-note">Tax treatment basis: {d.tax_reason}</p>}</>;
  const standardBody = <><table className="document-table">
      <thead>
        <tr>
          <th>Description</th>
          <th className="right">Qty</th>
          <th className="right">Rate</th>
          {gst && <th className="right">GST</th>}
          <th className="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((
    line,
    i
  ) => <tr key={i}>
          <td><strong>{line.description}</strong>{line.hsn && <small>HSN/SAC {line.hsn}</small>}</td>
          <td className="right">{line.quantity}</td>
          <td className="right">{docMoney(line.price)}</td>
          {gst && <td className="right">{line.taxRate}%</td>}
          <td className="right">{docMoney(line.base)}</td>
        </tr>)}
      </tbody>
    </table><div className="doc-totals">
      <div><span>Subtotal</span><strong>{docMoney(subtotal)}</strong></div>
      {gst && Number(d.tax) > 0 && (d.interstate ? <div><span>IGST</span><strong>{docMoney(d.tax)}</strong></div> : <><div><span>CGST</span><strong>{docMoney(Math.round(Number(d.tax) * 50) / 100)}</strong></div><div>
          <span>SGST</span>
          <strong>{docMoney(Number(d.tax) - Math.round(Number(d.tax) * 50) / 100)}</strong>
        </div></>)}
      {/* Quotations and proformas never take payments, so their advance is just the amount saved on the document. */}
      {Number(d.advance_amount || 0) > 0 && <><div><span>Advance Paid</span><strong>{docMoney(d.advance_amount)}</strong></div>
        <div><span>Balance Payable</span><strong>{docMoney(Math.max(0, total - Number(d.advance_amount)))}</strong></div></>}
      <div className="grand-total"><span>Total</span><strong>{docMoney(total)}</strong></div>
    </div>{d.tax_reason && <p className="doc-note">Tax treatment basis: {d.tax_reason}</p>}{d.notes && <p className="doc-note">{d.notes}</p>}</>;
  // Statutory particulars printed under the totals: the zero-rated declaration, INR equivalents and the e-invoice IRN / QR.
  const sez = Boolean(String(party.gstin || "").trim());
  const declaration = d.tax_treatment !== "ZERO_RATED" ? ""
    : d.zero_rated_type === "WITH_IGST"
    ? (sez ? "Supply to SEZ unit / developer for authorised operations on payment of IGST" : "Supply meant for export on payment of IGST")
    : (sez ? "Supply to SEZ unit / developer for authorised operations under LUT without payment of IGST" : "Supply meant for export under LUT without payment of IGST")
      + (company.lut_number ? " · LUT / ARN " + company.lut_number : "");
  const inrSplit = (() => {
    if (!foreignDoc) return null;
    let c = 0, s = 0;
    for (const l of lines) { const t = Math.round(Number(l.taxInr || 0) * 100), h = Math.round(t / 2); c += h; s += t - h; }
    return { cgst: c / 100, sgst: s / 100 };
  })();
  const compliance = !isReceipt && !isPaymentReceipt && (declaration || foreignDoc || d.irn) ? <div className="doc-compliance">
    {declaration && <p className="doc-declaration">{declaration}</p>}
    {foreignDoc && <p className="doc-note">INR equivalent at ₹{Number(d.exchange_rate)} per {d.currency}: taxable value {money(d.subtotal_inr)}
      {Number(d.tax_inr) > 0 && (d.interstate ? " · IGST " + money(d.tax_inr) : " · CGST " + money(inrSplit!.cgst) + " · SGST " + money(inrSplit!.sgst))} · total {money(d.total_inr)}</p>}
    {d.irn && <div className="doc-irn">
      <div>
        <p><strong>IRN</strong><span className="mono">{d.irn}</span></p>
        <p><strong>Ack. No.</strong><span>{d.ack_no}</span></p>
        <p><strong>Ack. Date</strong><span>{d.ack_date}</span></p>
      </div>
      {d.signed_qr && <SignedQr text={d.signed_qr}/>}
    </div>}
  </div> : null;
  return <article className={"document-page" + (isPaymentReceipt ? " payment-receipt-preview" : "")}>
        {company.demo && <div className="document-watermark">DEMONSTRATION · NOT A LEGAL TAX DOCUMENT</div>}
        {isPaymentReceipt && <header className="payment-receipt-company"><h2>{company.name}</h2>{companyAddress.map((line: string, i: number) => <p key={i}>{line}</p>)}{company.profile === "TAXABLE" && company.gstin && <p>GSTIN: {company.gstin}</p>}<p>Contact: {company.contact_number || company.contact || company.phone || ""} / {company.email || ""}</p></header>}
        {!isPaymentReceipt && <div className="document-head">
      <div>
        {documentLogo ? <img className="doc-logo" src={documentLogo} alt={gstDoc ? "GST company logo" : "Non-GST company logo"}/> : <div className="doc-emblem">L.</div>}
        <h2>{company.name}</h2>
        {(companyAddress.length ? companyAddress : ["Company address not configured"]).map((line: string, i: number) => <p key={i}>{line}</p>)}
        {((isInvoice && gstDoc) || isPaymentReceipt) && company.state_code && <p>State code: {company.state_code}</p>}
        {gstDoc && company.gstin && <p>GSTIN: {company.gstin}</p>}
        {(isInvoice || isPaymentReceipt) && (company.contact_number || company.contact || company.phone) && <p>Contact: {company.contact_number || company.contact || company.phone}</p>}
      </div>
      <div className="document-title">
        <h1>{title}</h1>
        <strong>{d.number}</strong>
        {d.source_number && (isCreditNote || isSalesDebit) && <p>Against invoice {d.source_number}{d.source_date ? " dated " + day(d.source_date) : ""}</p>}
        {d.source_number && isPurchaseDebit && <p>Against your bill {d.source_reference || d.source_number}{d.source_date ? " dated " + day(d.source_date) : ""}</p>}
        <p>{day(isReceipt ? d.entry_date : d.issue_date)}</p>
        {!isReceipt && <span>{d.status === "DRAFT" ? "DRAFT" : d.status === "CANCELLED" ? "CANCELLED" : "ISSUED"}</span>}
      </div>
    </div>}
        {!isPaymentReceipt && <div className="document-parties">
      <div>
        <small>{isReceipt ? (d.kind === "PAYMENT" ? "PAID TO" : "RECEIVED FROM") : isPaymentReceipt ? "RECEIVED FROM" : isCreditNote ? "CREDIT TO" : isPurchaseDebit ? "DEBIT TO (SUPPLIER)" : "BILL TO"}</small>
        <h3>{party.name}</h3>
        {party.address && <p>{party.address}</p>}
        {party.contact_name && <p>Contact: {party.contact_name}</p>}
        {party.email && <p>{party.email}</p>}
        {party.phone && <p>Phone: {party.phone}</p>}
        {(gstDoc || isReceipt || isPaymentReceipt) && party.gstin && <p>GSTIN: {party.gstin}</p>}
      </div>
      <div>
        {!isReceipt && <>{!isCreditNote && !isPurchaseDebit && <><small>{isPaymentReceipt ? "RECEIPT DATE" : "DUE / VALID UNTIL"}</small><p>{day(isPaymentReceipt ? d.issue_date : d.due_date)}</p></>}{(isInvoice && gstDoc || !isInvoice && !isPaymentReceipt) && <><small>TAX TREATMENT</small><p>{treatmentLabel(d)}{d.reverse_charge ? " · reverse charge" : ""} · {d.tax_treatment === "ZERO_RATED" && !d.place_of_supply?.match(/^(0[1-9]|[12]\d|3[0-8])$/) ? "Place of supply outside India" : "State " + d.place_of_supply}</p></>}</>}
      </div>
    </div>}
        {isReceipt ? receiptBody : isPaymentReceipt ? paymentReceiptBody : isInvoice ? invoiceBody : standardBody}
        {compliance}
        {!isPaymentReceipt && <div className="doc-bottom">
      <div>
        <small>BANK DETAILS</small>
        {invoiceBankFields.length ? <div className="bank-fields">
          {invoiceBankFields.length ? invoiceBankFields.map((
    [label, value]: string[],
    i: number
  ) => <p key={i}><strong>{label}</strong><span>{value}</span></p>) : <p>Bank details not configured</p>}
          {bankFields.length === 0 && legacyBank && !legacyFields.length && <p>{legacyBank}</p>}
        </div> : isPaymentReceipt && splitBank.length ? <div className="bank-fields">
          {splitBank.map((line: string, i: number) => <p key={i}>{line}</p>)}
        </div> : <p>{company.bank_details || "Not configured"}</p>}
      </div>
      {!isPaymentReceipt && !isInvoice && !isCreditNote && <div><small>TERMS</small><p>{company.terms}</p></div>}
    </div>}
    {!isPaymentReceipt && <div className="document-end">Thank you for your business.<span>{company.name}</span></div>}
    </article>;
}
