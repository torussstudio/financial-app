import { Badge, Empty } from "./ui";
import { amountInWords, day, money, pretty, type Row } from "../lib/format";
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
  if (type === "Ageing") {
    const rows = data.documents.filter((d: Row) => d.kind === "INVOICE" && d.status === "ISSUED" && Number(d.total) > Number(d.paid));
    return <><div className="panel-note">Outstanding amounts as of {day(to)}; includes documents before the selected start date.</div><div className="table-scroll">
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
                <td>{d.number}</td>
                <td>{d.party_name}</td>
                <td>{day(d.due_date)}</td>
                <td>
                  <Badge tone={days > 0 ? "red" : ""}>
                    {days <= 0 ? "Not due" : days <= 30 ? "1–30 days" : days <= 60 ? "31–60 days" : days <= 90 ? "61–90 days" : "90+ days"}
                  </Badge>
                </td>
                <td className="right amount">{money(Number(d.total) - Number(d.paid))}</td>
              </tr>;
    })}
          </tbody>
        </table>
      </div>{!rows.length && <Empty label="No outstanding balances"/>}</>;
  }
  if (type === "GST summary") {
    // Credit notes reduce output tax, so they are listed with negative amounts.
    const rows = data.documents.filter((d: Row) => ["INVOICE", "CREDIT_NOTE"].includes(d.kind) && d.status === "ISSUED" && d.issue_date >= from);
    const sign = (d: Row) => d.kind === "CREDIT_NOTE" ? -1 : 1;
    const sum = (field: string) => rows.reduce((s: number, d: Row) => s + sign(d) * Math.round(Number(d[field]) * 100), 0) / 100;
    return <><div className="panel-note">Output tax working summary from issued invoices less credit notes. This is not a filed GST return or a net tax-payable calculation.</div><div className="table-scroll">
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
              <td>{d.number}{d.kind === "CREDIT_NOTE" && <small>Credit note</small>}</td>
              <td>{d.party_name}</td>
              <td>{pretty(d.tax_treatment)}</td>
              <td className="right">{money(sign(d) * Number(d.subtotal))}</td>
              <td className="right">{money(sign(d) * Number(d.tax))}</td>
              <td>{d.interstate ? "Inter-state" : "Intra-state"}</td>
            </tr>)}
            {rows.length > 0 && <tr className="total-row">
              <td colSpan={3}>Net</td>
              <td className="right">{money(sum("subtotal"))}</td>
              <td className="right">{money(sum("tax"))}</td>
              <td />
            </tr>}
          </tbody>
        </table>
      </div></>;
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
  const isInvoice = !isReceipt && d.kind === "INVOICE",
    gst = !isReceipt && !isPaymentReceipt && d.tax_treatment === "TAXABLE";
  const company = d.company || {}, party = d.party || {}, lines: Row[] = d.lines || [];
  const documentLogo = isReceipt ? "" : gst ? company.gst_logo : company.non_gst_logo;
  const docMoney = (value: any) => new Intl.NumberFormat(
    "en-IN",
    { style: "currency", currency: d.currency || "INR", maximumFractionDigits: 2 }
  ).format(Number(value || 0));
  const title = isReceipt ? (d.kind === "PAYMENT" ? "Payment voucher" : "Payment receipt") : isPaymentReceipt ? "PAYMENT RECEIPT" : isInvoice ? "INVOICE" : pretty(d.kind);
  const subtotal = Number(d.subtotal || 0),
    total = Number(d.total || 0),
    // Issued invoices show what was actually received (the advance is posted as an allocated receipt); drafts show the planned advance.
    credited = Math.max(0, Number(d.credited || 0)),
    settled = d.status === "ISSUED" ? Math.max(0, Number(d.paid || 0)) : Math.max(0, Number(d.advance_amount || 0)),
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
        {(d.allocations || []).map((a: Row) => <tr key={a.number}><td>{a.number}</td><td className="right">{docMoney(a.amount)}</td></tr>)}
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
      {gst && (d.interstate ? <td className="right">{docMoney(tax)}</td> : <><td className="right">{docMoney(otherHalf)}</td><td className="right">{docMoney(half)}</td></>)}
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
            {gst && (d.interstate ? <th className="right">IGST</th> : <><th className="right">SGST</th><th className="right">CGST</th></>)}
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
      <div className="grand-total"><span>Total</span><strong>{docMoney(total)}</strong></div>
    </div>{d.tax_reason && <p className="doc-note">Tax treatment basis: {d.tax_reason}</p>}{d.notes && <p className="doc-note">{d.notes}</p>}</>;
  return <article className={"document-page" + (isPaymentReceipt ? " payment-receipt-preview" : "")}>
        {company.demo && <div className="document-watermark">DEMONSTRATION · NOT A LEGAL TAX DOCUMENT</div>}
        {isPaymentReceipt && <header className="payment-receipt-company"><h2>{company.name}</h2>{companyAddress.map((line: string, i: number) => <p key={i}>{line}</p>)}<p>Contact: {company.contact_number || company.contact || company.phone || ""} / {company.email || ""}</p></header>}
        {!isPaymentReceipt && <div className="document-head">
      <div>
        {documentLogo ? <img className="doc-logo" src={documentLogo} alt={gst ? "GST company logo" : "Non-GST company logo"}/> : <div className="doc-emblem">L.</div>}
        <h2>{company.name}</h2>
        {(companyAddress.length ? companyAddress : ["Company address not configured"]).map((line: string, i: number) => <p key={i}>{line}</p>)}
        {((isInvoice && gst) || isPaymentReceipt) && company.state_code && <p>State code: {company.state_code}</p>}
        {gst && company.gstin && <p>GSTIN: {company.gstin}</p>}
        {(isInvoice || isPaymentReceipt) && (company.contact_number || company.contact || company.phone) && <p>Contact: {company.contact_number || company.contact || company.phone}</p>}
      </div>
      <div className="document-title">
        <h1>{title}</h1>
        <strong>{d.number}</strong>
        {d.source_number && d.kind === "CREDIT_NOTE" && <p>Against invoice {d.source_number}</p>}
        <p>{day(isReceipt ? d.entry_date : d.issue_date)}</p>
        {!isReceipt && <span>{d.status === "DRAFT" ? "DRAFT" : d.status === "CANCELLED" ? "CANCELLED" : "ISSUED"}</span>}
      </div>
    </div>}
        {!isPaymentReceipt && <div className="document-parties">
      <div>
        <small>{isReceipt || isPaymentReceipt ? "RECEIVED FROM" : isCreditNote ? "CREDIT TO" : "BILL TO"}</small>
        <h3>{party.name}</h3>
        {party.address && <p>{party.address}</p>}
        {party.contact_name && <p>Contact: {party.contact_name}</p>}
        {party.email && <p>{party.email}</p>}
        {party.phone && <p>Phone: {party.phone}</p>}
        {(gst || isReceipt || isPaymentReceipt) && party.gstin && <p>GSTIN: {party.gstin}</p>}
      </div>
      <div>
        {!isReceipt && <>{!isCreditNote && <><small>{isPaymentReceipt ? "RECEIPT DATE" : "DUE / VALID UNTIL"}</small><p>{day(isPaymentReceipt ? d.issue_date : d.due_date)}</p></>}{(isInvoice && gst || !isInvoice && !isPaymentReceipt) && <><small>TAX TREATMENT</small><p>{pretty(d.tax_treatment)} · State {d.place_of_supply}</p></>}</>}
      </div>
    </div>}
        {isReceipt ? receiptBody : isPaymentReceipt ? paymentReceiptBody : isInvoice ? invoiceBody : standardBody}
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
