import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { ActionButton } from "../action-button";
import { ATTACHMENT_ACCEPT, foreignOutstandingOf, gstCharged, localDate, moneySub, outstandingOf, RECEIVABLE_KINDS, TDS_SECTIONS } from "../../lib/format";
import { AllocationTable } from "./allocation-table";
import { AttachmentsPanel } from "./attachments-panel";
type Row = Record<string, any>;
export function WorkspaceEntryModal({ context }: {
  context: any
}) {
  const {
    modal,
    setModal,
    modalRef,
    busy,
    error,
    submit,
    Field,
    bankSelect,
    partySelect,
    catSelect,
    voucherCategoryItems,
    addVoucherCategory,
    formKind,
    setFormKind,
    today,
    pretty,
    data,
    newDocKind,
    setNewDocKind,
    taxTreatment,
    setTaxTreatment,
    placeOfSupply,
    setPlaceOfSupply,
    manualSupplyMode,
    setManualSupplyMode,
    supplyStateKnown,
    draftInterstate,
    draftInvoiceTotals,
    draftPaymentTotal,
    amountInWords,
    money,
    paymentDoc,
    setPaymentDoc,
    accounts,
    from,
    docNumber,
    setDocNumber,
    docCurrency,
    setDocCurrency,
    advanceAmount,
    setAdvanceAmount,
    advanceValue,
    advanceStatus,
    setAdvanceStatus,
    clientInfo,
    setClientInfo,
    documentCompany,
    setDocumentCompany,
    companyDocumentProfile,
    docPartyId,
    setDocPartyId,
    selectableParties,
    uploadFile,
    downloadAttachment,
    api,
    notify,
    refresh,
    canWrite,
    session,
    zeroRatedType,
    setZeroRatedType,
    reverseCharge,
    setReverseCharge
  } = context;
  const [addingCategory, setAddingCategory] = useState(false),
    [categoryName, setCategoryName] = useState(""),
    [voucherCategoryValue, setVoucherCategoryValue] = useState("");
  // Payment / advance allocation state: the party, the amount being allocated and the amount per open document.
  const [payParty, setPayParty] = useState(""),
    [payAmount, setPayAmount] = useState(""),
    [alloc, setAlloc] = useState<Record<string, string>>({}),
    // TDS on a receipt (deducted by the client) or a vendor payment (deducted by us), and its section / rate.
    [tdsAmount, setTdsAmount] = useState(""),
    [tdsSection, setTdsSection] = useState(""),
    [tdsRate, setTdsRate] = useState(""),
    [issueRate, setIssueRate] = useState("");
  useEffect(() => {
    setAddingCategory(false);
    setCategoryName("");
    setVoucherCategoryValue("");
    setIssueRate("");
    setTdsAmount("");
    setTdsSection("");
    setTdsRate("");
    const d = modal?.document;
    if (modal?.type === "payment" && d) {
      // A foreign-currency invoice is settled in its own currency; the INR credited to the bank is entered separately.
      const foreign = foreignOutstandingOf(d);
      setPayParty(d.party_id);
      setPayAmount(foreign === null ? outstandingOf(d).toFixed(2) : "");
      setAlloc({ [d.id]: (foreign ?? outstandingOf(d)).toFixed(2) });
    }
    else if (modal?.type === "advance") {
      setPayParty(modal.partyId || d?.party_id || "");
      setPayAmount("");
      setAlloc({});
    }
    else {
      setPayParty("");
      setPayAmount("");
      setAlloc({});
    }
  }, [modal]);
  const items: Row[] = (data?.items || []).filter((i: Row) => !i.archived);
  // Picking a saved product/service fills its HSN/SAC, rate and GST; typing anything else keeps the text as entered.
  const withItem = (line: Row, description: string) => {
    const item = items.find(i => i.name.toLowerCase() === description.trim().toLowerCase());
    if (!item) return { ...line, description };
    return { ...line, description: item.name, hsn: item.hsn || line.hsn, price: Number(item.rate) > 0 ? String(Number(item.rate)) : line.price, taxRate: String(Number(item.tax_rate)) };
  };
  const paymentDirection = modal?.direction === "PAYMENT" ? "PAYMENT" : "RECEIPT";
  // Open documents a payment can settle: invoices and sales debit notes for a client, vendor bills for a vendor.
  const openDocsFor = (partyId: string, kind: string) => (data?.documents || [])
    .filter((d: Row) => (kind === "INVOICE" ? RECEIVABLE_KINDS.includes(d.kind) : d.kind === kind) && d.status === "ISSUED" && d.party_id === partyId && outstandingOf(d) > 0);
  const cents = (v: any) => Math.round(Number(v || 0) * 100);
  // Live figures for the payment dialog: what the allocations settle in INR, and the money that actually moves.
  const paymentFigures = (docs: Row[]) => {
    const inrAlloc = docs.filter(d => foreignOutstandingOf(d) === null).reduce((s, d) => s + cents(alloc[d.id]), 0) / 100;
    const foreignDocs = docs.filter(d => foreignOutstandingOf(d) !== null && Number(alloc[d.id]) > 0);
    // Carrying amount at the invoice's own rate; the API settles the last of a foreign balance at the whole INR balance.
    const carrying = foreignDocs.reduce((s, d) => {
      const f = Number(alloc[d.id]), fx = foreignOutstandingOf(d)!;
      return s + (Math.abs(f - fx) < 0.005 ? cents(outstandingOf(d)) : Math.round(f * Number(d.inr_total) / Number(d.total) * 100));
    }, 0) / 100;
    return { inrAlloc, foreignDocs, carrying };
  };
  const advanceOf = (p: Row | undefined, direction: string) => Number((direction === "PAYMENT" ? p?.advance_paid : p?.advance_received) || 0);
  const fixedAssetOrExpense = accounts.filter((a: Row) => !a.is_cash && (a.kind === "EXPENSE" || (a.kind === "ASSET" && (/^1[56]/.test(a.code) || a.voucher_category_kind === "ASSET"))));
  const isPartyVoucherCategory = ["INCOME", "CAPITAL_IN", "CAPITAL_RETURN", "REIMBURSEMENT", "LOAN_IN", "LOAN_REPAY"].includes(formKind);
  const categoryItems: Row[] = voucherCategoryItems(formKind);
  const categoryLabel = ({
    EXPENSE: "Expense account",
    INCOME: "Income account / client or vendor",
    CAPITAL_IN: "Category",
    CAPITAL_RETURN: "Category",
    INVESTMENT: "Investment category",
    ASSET: "Asset account",
    REIMBURSEMENT: "Category"
  } as Row)[formKind] || "Category";
  const docLines: Row[] = context.docLines;
  // Lines carry a GST rate on taxable and zero-rated documents (under LUT it is reported in GSTR-1 but not charged).
  const rateColumn = taxTreatment === "TAXABLE" || taxTreatment === "ZERO_RATED";
  const docMoney = (v: any) => new Intl.NumberFormat(
    "en-IN",
    { style: "currency", currency: docCurrency, maximumFractionDigits: 2 }
  ).format(Number(v || 0));
  const chooseDocumentParty = (p: Row | undefined) => {
    setDocPartyId(p?.id || "");
    setClientInfo({
      name: p?.name || "",
      address: p?.address || "",
      gstin: p?.gstin || "",
      contactName: p?.contact_name || "",
      phone: p?.phone || ""
    });
    const state = String(p?.gstin || "").slice(0, 2);
    setPlaceOfSupply(/^\d{2}$/.test(state) ? state : "")
  };
  const setDocLines: (lines: Row[]) => void = context.setDocLines;
  return <>
 {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy)
      setModal(null) }}>
      <div ref={modalRef}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    className={"modal " + (["document", "purchase", "salesDebitNote"].includes(modal.type) ? "large" : "")}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">WORKSPACE ENTRY</span>
            <h2 id="modal-title">
              {({
    party: modal.party ? "Edit contact" : "Add a contact",
    project: modal.project ? "Edit project" : "Create a project",
    item: modal.item ? "Edit product / service" : "Add a product or service",
    purchase: modal.document ? "Edit vendor bill" : "Enter a vendor bill",
    userEdit: "Edit team member",
    password: "Change your password",
    advance: paymentDirection === "PAYMENT" ? "Apply vendor advance" : "Apply client advance",
    attachments: "Attachments" + (modal.title ? " · " + modal.title : ""),
    voucher: "New daily voucher",
    capital: "Record funding movement",
    document: modal.document ? "Edit document" : "Create a document",
    payment: paymentDirection === "PAYMENT" ? "Pay a vendor" : "Record a receipt",
    budget: "Set a monthly budget",
    recurring: "New recurring entry",
    import: "Import bank statement",
    match: "Match a bank entry",
    reverse: "Reverse posted entry",
    creditNote: "Issue a credit note",
    debitNote: "Issue a debit note to the vendor",
    salesDebitNote: "Issue a debit note to the client",
    issue: "Issue foreign-currency invoice",
    irn: "Record e-invoice details",
    gstFiling: "Record a filed GST return",
    cancel: "Cancel document",
    close: "Manage period lock",
    user: "Add team member",
    journal: "Balanced journal entry"
  } as Row)[modal.type]}
            </h2>
          </div>
          <button className="icon-btn" aria-label="Close dialog" disabled={busy} onClick={() => setModal(null)}>
            <X size={20}/>
          </button>
        </div>
        {modal.type === "attachments" ? <>
          <AttachmentsPanel entityType={modal.entityType} entityId={modal.entityId} canWrite={canWrite} api={api}
            upload={uploadFile} download={downloadAttachment} notify={notify} onChanged={refresh}/>
          <div className="modal-actions"><button className="btn primary" type="button" onClick={() => setModal(null)}>Done <Check size={16}/></button></div>
        </> : <>
        {error && <div role="alert" className="error">{error}</div>}
        <datalist id="item-options">
          {items.map(i => <option key={i.id} value={i.name}>{[i.hsn && "HSN/SAC " + i.hsn, Number(i.rate) > 0 && money(i.rate), i.tax_rate + "% GST"].filter(Boolean).join(" · ")}</option>)}
        </datalist>
        <form onSubmit={submit}>
          <div className="form-grid">
 {modal.type === "party" && <><Field label="Client / vendor name" wide><input name="name" required minLength={2} defaultValue={modal.party?.name || ""}/></Field><Field label="Contact name"><input name="contactName" defaultValue={modal.party?.contact_name || ""}/></Field><Field label="Type">
                <select name="kind" defaultValue={modal.party?.kind || modal.kind || "CLIENT"}>
                  <option value="CLIENT">Client</option>
                  <option value="VENDOR">Vendor</option>
                  <option value="BOTH">Client & vendor</option>
                </select>
              </Field><Field label="Email"><input name="email" type="email" defaultValue={modal.party?.email || ""}/></Field><Field label="Phone"><input name="phone" defaultValue={modal.party?.phone || ""}/></Field><Field label="GSTIN (optional)"><input name="gstin" maxLength={15} pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]" title="15-character GSTIN" defaultValue={modal.party?.gstin || ""}/></Field><Field label="Address" wide><textarea name="address" defaultValue={modal.party?.address || ""}/></Field>
              {modal.party && <><label className="check-field wide"><input type="checkbox" name="archived" defaultChecked={Boolean(modal.party.archived)}/> Archived — hide from new documents, vouchers and payments</label>
              <div className="form-note wide">Issued documents keep the details they were issued with. Changes here apply to new documents.</div></>}</>}
 {modal.type === "project" && <><Field label="Project name" wide><input name="name" required minLength={2} defaultValue={modal.project?.name || ""}/></Field><Field label="Client">
                <select name="partyId" defaultValue={modal.project?.party_id || ""}>
                  <option value="">Internal project</option>
                  {selectableParties("CLIENT", modal.project?.party_id).map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field><Field label="Budget (₹)">
                <input name="budget" type="number" min="0" step=".01" defaultValue={modal.project ? String(Number(modal.project.budget)) : "0"} required/>
              </Field>{modal.project && <label className="check-field wide"><input type="checkbox" name="archived" defaultChecked={Boolean(modal.project.archived)}/> Archived — completed or on hold; hidden from new entries</label>}</>}
 {modal.type === "item" && <><Field label="Name" wide><input name="name" required minLength={2} maxLength={150} defaultValue={modal.item?.name || ""} placeholder="e.g. Brand identity design"/></Field><Field label="Type">
                <select name="kind" defaultValue={modal.item?.kind || "SERVICE"}><option value="SERVICE">Service (SAC)</option><option value="GOODS">Goods (HSN)</option></select>
              </Field><Field label="HSN / SAC"><input name="hsn" maxLength={12} defaultValue={modal.item?.hsn || ""}/></Field><Field label="Default rate (₹)">
                <input name="rate" type="number" min="0" step=".01" defaultValue={modal.item ? String(Number(modal.item.rate)) : ""}/>
              </Field><Field label="GST %"><input name="taxRate" type="number" min="0" max="100" step=".01" required defaultValue={modal.item ? String(Number(modal.item.tax_rate)) : "18"}/></Field><Field label="Unit"><input name="unit" maxLength={20} placeholder="hrs, nos, sq.ft…" defaultValue={modal.item?.unit || ""}/></Field><Field label="Description" wide><textarea name="description" maxLength={500} defaultValue={modal.item?.description || ""}/></Field>
              {modal.item && <label className="check-field wide"><input type="checkbox" name="archived" defaultChecked={Boolean(modal.item.archived)}/> Archived — no longer offered on new documents</label>}
              <div className="form-note wide">Typing this name on a document line fills the HSN / SAC, rate and GST %. Documents keep their own copy, so editing an item never changes saved documents.</div></>}
 {modal.type === "userEdit" && <><Field label="Full name" wide><input name="name" required minLength={2} defaultValue={modal.user.name}/></Field><Field label="Email"><input value={modal.user.email} disabled/></Field><Field label="Role">
                <select name="role" defaultValue={modal.user.role} disabled={modal.user.id === session?.user?.id}>
                  <option value="ACCOUNTANT">Accountant</option><option value="VIEWER">Viewer</option><option value="ADMIN">Admin</option>
                </select>
              </Field>{modal.user.id === session?.user?.id && <input type="hidden" name="role" value={modal.user.role}/>}
              {modal.user.id !== session?.user?.id ? <><label className="check-field wide"><input type="checkbox" name="active" defaultChecked={modal.user.active}/> Active — can sign in (disabling signs them out everywhere)</label>
              <Field label="Reset password (optional, at least 12 characters)" wide><input name="newPassword" type="password" minLength={12} autoComplete="new-password"/></Field></> : <><input type="hidden" name="active" value="on"/><div className="form-note wide">You can't change your own role or disable yourself. Use “Change my password” for your password.</div></>}</>}
 {modal.type === "password" && <><Field label="Current password" wide><input name="currentPassword" type="password" required autoComplete="current-password"/></Field><Field label="New password (at least 12 characters)"><input name="newPassword" type="password" minLength={12} required autoComplete="new-password"/></Field><Field label="Confirm new password"><input name="confirmPassword" type="password" minLength={12} required autoComplete="new-password"/></Field><div className="form-note wide">Your other signed-in devices will be signed out.</div></>}
 {["voucher", "capital"].includes(modal.type) && <><Field label="Entry type" wide>
                <select value={formKind} onChange={e => { setFormKind(e.target.value); setAddingCategory(false); setCategoryName(""); setVoucherCategoryValue("") }}>
                  {(modal.type === "capital" ? ["CAPITAL_IN", "CAPITAL_RETURN", "LOAN_IN", "LOAN_REPAY", "INVESTMENT"] : [
    "EXPENSE",
    "INCOME",
    "CAPITAL_IN",
    "CAPITAL_RETURN",
    "INVESTMENT",
    "ASSET",
    "REIMBURSEMENT",
    "TDS_DEPOSIT"
  ]).map(k => <option key={k} value={k}>{k === "ASSET" ? "Assets" : k === "REIMBURSEMENT" ? "Reimbursements" : k === "TDS_DEPOSIT" ? "TDS deposit (challan)" : pretty(k)}</option>)}
                </select>
              </Field><Field label={formKind === "TDS_DEPOSIT" ? "Deposit date" : "Accounting date"}>
                <input name="date" type="date" defaultValue={today()} required/>
              </Field><Field label="Amount (₹)">
                <input name="amount" type="number" min=".01" step=".01" required/>
              </Field><Field label="Bank / cash account">{formKind === "TDS_DEPOSIT" ? bankSelect("cashAccount") : bankSelect("cashAccount", modal.type === "voucher")}</Field>
              {formKind === "TDS_DEPOSIT" ? (() => {
                // Deposits are limited to what is still due for that section and month (from the TDS payable report).
                const dueRows: Row[] = (data.tds?.payable || []).filter((r: Row) => Number(r.due) > 0 && r.section !== "UNASSIGNED");
                return <><Field label="TDS section"><select name="section" required defaultValue={dueRows[0]?.section || ""}>
                    <option value="">Choose a section</option>
                    {TDS_SECTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select></Field>
                  <Field label="Month deducted"><input name="period" type="month" required defaultValue={dueRows[0]?.period || today().slice(0, 7)}/></Field>
                  <Field label="Challan no. (BSR code · date · serial / CIN)" wide><input name="challan" required minLength={3} maxLength={60} placeholder="e.g. 0510308 · 05/01/2027 · 00012"/></Field>
                  <Field label="Description (optional)" wide><input name="description" maxLength={300} placeholder="Defaults to section, month and challan"/></Field>
                  <Field label="Challan copy (optional)" wide><input name="attachment" type="file" accept={ATTACHMENT_ACCEPT}/></Field>
                  <div className="form-note wide">{dueRows.length
                    ? "Due now: " + dueRows.map(r => r.section + " · " + r.period + " " + money(r.due) + " (by " + r.dueBy + ")").join("; ") + "."
                    : "No TDS deducted on vendor payments is waiting to be deposited."} Posts Dr TDS payable / Cr bank. A deposit cannot exceed what is due for its section and month.</div></>;
              })() : <>
              {formKind === "INCOME" && <input type="hidden" name="account" value="4000"/>}
              <Field label={categoryLabel} wide>
                <div className="document-form-header" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select key={formKind} name={isPartyVoucherCategory ? "partyId" : "account"} required value={voucherCategoryValue} onChange={e => setVoucherCategoryValue(e.target.value)} style={{ flex: 1 }}>
                    <option value="">Choose a category</option>
                    {categoryItems.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <button className="btn small-btn" type="button" aria-label="Add custom category" title="Add custom category" onClick={() => setAddingCategory(v => !v)}><Plus size={16}/></button>
                </div>
                {addingCategory && <div className="document-form-header" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <input aria-label="Custom category name" value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="New category name" maxLength={150} style={{ flex: 1 }}/>
                  <ActionButton className="btn small-btn" type="button" loading={busy} loadingText="Adding…" disabled={categoryName.trim().length < 2} onClick={async () => {
                    try {
                      const added = await addVoucherCategory(formKind, categoryName.trim());
                      setVoucherCategoryValue(added.id || added.code);
                      setCategoryName("");
                      setAddingCategory(false);
                    } catch { /* The form displays the API error. */ }
                  }}>Add</ActionButton>
                  <button className="btn small-btn" type="button" onClick={() => { setCategoryName(""); setAddingCategory(false) }}>Cancel</button>
                </div>}
              </Field>{formKind === "REIMBURSEMENT" && <Field label="Expense account">
                <select name="account" required defaultValue="">
                  <option value="">Choose an expense account</option>
                  {voucherCategoryItems("EXPENSE").map((item: Row) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>}<Field label="Project">
                <select name="projectId" defaultValue={modal.document?.project_id || ""}>
                  <option value="">No project</option>
                  {data.projects.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field><Field label="Description" wide>
                <input name="description" required placeholder="What was this entry for?"/>
              </Field><Field label="Bill / receipt (optional)" wide>
                <input name="attachment" type="file" accept={ATTACHMENT_ACCEPT}/>
              </Field><div className="form-note wide">For an existing invoice or vendor bill, use Record receipt / Pay vendor to settle its balance. Direct income entries should not repeat invoiced revenue.</div></>}</>}
 {modal.type === "document" && <><div className="wide document-section-title">
                <span>01</span>
                <div><strong>Document information</strong><small>Recipient, dates and tax treatment</small></div>
              </div><Field label="Document type">
                <select value={newDocKind}
    disabled={Boolean(modal.document)}
    onChange={e => { setNewDocKind(e.target.value); if (e.target.value === "BILL") {
      setAdvanceAmount("0");
      setAdvanceStatus("NOT_RECEIVED")
    } if (e.target.value === "BILL") {
      setDocCurrency("INR");
      setTaxTreatment("OUTSIDE_GST");
      setDocumentCompany(companyDocumentProfile(data.company, "OUTSIDE_GST"));
    } }}>
                  {["INVOICE", "QUOTATION", "PROFORMA", "BILL"].map(k => <option key={k} value={k}>
                    {k === "BILL" ? "Payment Receipt" : k === "INVOICE" ? "Invoice" : pretty(k)}
                  </option>)}
                </select>
              </Field><Field label={newDocKind === "BILL" ? "Receipt No." : "Document number"}>
                <input value={docNumber}
    onChange={e => setDocNumber(e.target.value)}
    placeholder={["INVOICE", "BILL"].includes(newDocKind) ? "Assigned automatically when issued" : "Generated automatically on save"}
    maxLength={80}/>
              </Field>{newDocKind !== "BILL" && <Field label="Currency">
                <select value={docCurrency} onChange={e => setDocCurrency(e.target.value)}>
                  {[
    ["INR", "INR"],
    ["USD", "USD"],
    ["EUR", "EUR"],
    ["GBP", "GBP"],
    ["AED", "AED"],
    ["CAD", "CAD"],
    ["AUD", "AUD"],
    ["SGD", "SGD"]
  ].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </Field>}<div className="wide">
                <div className="document-section-title">
                  <span>02</span>
                  <div>
                    <strong>Company information</strong>
                    <small>{taxTreatment === "OUTSIDE_GST" ? "Edit the company details for this document" : "Managed in Settings · used consistently on saved documents"}</small>
                  </div>
                </div>
                {taxTreatment === "OUTSIDE_GST" ? <div className="form-grid">
                  <Field label="Company name"><input value={documentCompany.name || ""} onChange={e => setDocumentCompany({ ...documentCompany, name: e.target.value })}/></Field>
                  <Field label="Contact number"><input value={documentCompany.contact_number || ""} onChange={e => setDocumentCompany({ ...documentCompany, contact_number: e.target.value })}/></Field>
                  <Field label="Address line 1" wide><input value={documentCompany.address || ""} onChange={e => setDocumentCompany({ ...documentCompany, address: e.target.value })}/></Field>
                  <Field label="Address line 2" wide><input value={documentCompany.address_line2 || ""} onChange={e => setDocumentCompany({ ...documentCompany, address_line2: e.target.value })}/></Field>
                  <Field label="City"><input value={documentCompany.city || ""} onChange={e => setDocumentCompany({ ...documentCompany, city: e.target.value })}/></Field>
                  <Field label="State"><input value={documentCompany.state_name || ""} onChange={e => setDocumentCompany({ ...documentCompany, state_name: e.target.value })}/></Field>
                  <Field label="PIN code"><input value={documentCompany.pin_code || ""} onChange={e => setDocumentCompany({ ...documentCompany, pin_code: e.target.value })}/></Field>
                </div> : <div className="document-form-header">
                  <strong>{taxTreatment === "OUTSIDE_GST" ? documentCompany.name : data.company.name}</strong>
                  {[
    data.company.address,
    data.company.address_line2,
    [data.company.city, data.company.state_name || data.company.state, data.company.pin_code].filter(Boolean).join(", ")
  ].filter(Boolean).map((line: string, i: number) => <span key={i}>{line}</span>)}
                  {(newDocKind === "BILL" || taxTreatment === "TAXABLE") && data.company.state_code && <span>State code: {data.company.state_code}</span>}
                  {taxTreatment === "TAXABLE" && data.company.gstin && <span>GSTIN: {data.company.gstin}</span>}
                  {(data.company.contact_number || data.company.contact || data.company.phone) && <span>Contact: {data.company.contact_number || data.company.contact || data.company.phone}</span>}
                </div>}
              </div><Field label={newDocKind === "BILL" ? "Received from" : "Client / vendor"}>
                <select name="partyId"
    required
    value={docPartyId}
    onChange={e => chooseDocumentParty(data.parties.find((x: Row) => x.id === e.target.value))}>
                  <option value="">Select a client or vendor</option>
                  {selectableParties("", docPartyId).map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field><Field label={newDocKind === "BILL" ? "Name" : "Client name"}>
                <input value={clientInfo.name} onChange={e => setClientInfo({ ...clientInfo, name: e.target.value })}/>
              </Field><Field label="Address" wide>
                <textarea value={clientInfo.address}
    onChange={e => setClientInfo({ ...clientInfo, address: e.target.value })}/>
              </Field>{taxTreatment === "TAXABLE" && <Field label="GST Number / GSTIN">
                <input value={clientInfo.gstin}
    onChange={e => {
    setClientInfo({ ...clientInfo, gstin: e.target.value });
    const state = e.target.value.slice(0, 2);
    setPlaceOfSupply(/^\d{2}$/.test(state) ? state : "")
  }}/>
              </Field>}{newDocKind !== "BILL" && <><Field label="Contact name">
                <input value={clientInfo.contactName}
    onChange={e => setClientInfo({ ...clientInfo, contactName: e.target.value })}/>
              </Field><Field label="Phone number">
                <input value={clientInfo.phone} onChange={e => setClientInfo({ ...clientInfo, phone: e.target.value })}/>
              </Field></>}<Field label={newDocKind === "BILL" ? "Receipt date" : "Issue date"}>
                <input name="date" type="date" defaultValue={modal.document?.issue_date?.slice(0, 10) || today()} required/>
              </Field>{newDocKind !== "BILL" ? <Field label="Due / valid-until date">
                <input name="dueDate"
    type="date"
    defaultValue={modal.document?.due_date?.slice(0, 10) || localDate(15)}
    required/>
              </Field> : <input type="hidden"
    name="dueDate"
    value={modal.document?.due_date?.slice(0, 10) || localDate(15)}/>}<Field label={newDocKind === "BILL" ? "Company details" : newDocKind === "INVOICE" ? (taxTreatment === "TAXABLE" ? "GST Invoice treatment" : "Non-GST Invoice treatment") : "Tax treatment"}>
                {/* On a payment receipt this only picks the GST or non-GST company profile; the receipt itself never carries GST. */}
                <select value={taxTreatment} onChange={e => {
      setTaxTreatment(e.target.value);
      setDocumentCompany(companyDocumentProfile(data.company, e.target.value));
      // Exports are reported with place-of-supply code 96 (foreign country); a SEZ recipient keeps its own state code.
      if (e.target.value === "ZERO_RATED" && !String(clientInfo.gstin || "").trim()) setPlaceOfSupply("96");
    }}>
                  {(newDocKind === "BILL" ? ["TAXABLE", "OUTSIDE_GST"] : ["TAXABLE", "ZERO_RATED", "NIL_RATED", "EXEMPT", "OUTSIDE_GST"]).map(k => <option key={k} value={k}>{k === "ZERO_RATED" ? "Zero-rated (export / SEZ)" : pretty(k)}</option>)}
                </select>
              </Field>{newDocKind !== "BILL" && taxTreatment === "ZERO_RATED" && <><Field label="Zero-rated supply">
                  <select value={zeroRatedType} onChange={e => setZeroRatedType(e.target.value)}>
                    <option value="LUT">Under LUT / bond — no IGST charged</option>
                    <option value="WITH_IGST">With payment of IGST — refund route</option>
                  </select>
                </Field><Field label="Place of supply (96 = outside India)">
                  <input name="placeOfSupply" value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} pattern="[0-9]{2}" required/>
                </Field><div className="form-note wide">{zeroRatedType === "LUT"
                  ? "Printed as “Supply meant for export under LUT without payment of IGST”" + (data.company.lut_number ? " with LUT " + data.company.lut_number + "." : ". Add the LUT / ARN number in Settings before issuing in live books.")
                  : "IGST is charged at each line's rate and can be claimed back as a refund. Exports are always inter-state (IGST)."}</div></>}{newDocKind !== "BILL" && taxTreatment === "TAXABLE" && <><Field label="Place of supply (state code)">
                  <input name="placeOfSupply"
    value={placeOfSupply}
    onChange={e => setPlaceOfSupply(e.target.value)}
    pattern="[0-9]{2}"
    required/>
                </Field><Field label={supplyStateKnown ? "GST tax calculation (from place of supply)" : "GST tax calculation"}>
                  {/* With both state codes known the split is fixed by law (same state → CGST + SGST), so it is shown but not editable. */}
                  <select value={supplyStateKnown ? (draftInterstate ? "INTER" : "INTRA") : manualSupplyMode}
    required
    disabled={supplyStateKnown}
    onChange={e => setManualSupplyMode(e.target.value)}>
                    <option value="">Select tax calculation</option>
                    <option value="INTRA">CGST + SGST</option>
                    <option value="INTER">IGST</option>
                  </select>
                </Field></>}{newDocKind !== "BILL" && !["TAXABLE", "ZERO_RATED"].includes(taxTreatment) && <input type="hidden" name="placeOfSupply" value={placeOfSupply || data.company.state_code || "00"}/>}{newDocKind === "BILL" && <><input type="hidden" name="placeOfSupply" value={documentCompany.state_code || data.company.state_code}/><input type="hidden" name="taxReason" value="Payment receipt"/></>}{newDocKind !== "BILL" && !["TAXABLE", "ZERO_RATED"].includes(taxTreatment) && <Field label="Reason / basis for tax treatment" wide>
                <input name="taxReason"
    required
    defaultValue={modal.document?.tax_reason || ""}
    placeholder="Record the applicable reason"/>
              </Field>}{newDocKind === "BILL" && <><Field label="Mode of Payment">
                  <select name="paymentMethod" required defaultValue={modal.document?.payment_method || "Cash"}>
                    <option>Cash</option>
                    <option>Bank Transfer</option>
                    <option>Cheque</option>
                  </select>
                </Field><Field label="Income account">
                  <select name="incomeAccount" required defaultValue={modal.document?.income_account || "4000"}>
                    {accounts.filter((a: Row) => a.kind === "INCOME").map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}
                  </select>
                </Field><div className="form-note wide">Issuing posts the amount received to Petty cash (Cash) or Operating bank (Bank Transfer / Cheque) and to the selected income account.</div></>}{newDocKind !== "BILL" && <Field label="Project">
                <select name="projectId"
    defaultValue={modal.document?.project_id || ""}
    onChange={e => { const project = data.projects.find((p: Row) => p.id === e.target.value); if (project?.party_id)
      chooseDocumentParty(data.parties.find((p: Row) => p.id === project.party_id)) }}>
                  <option value="">No project</option>
                  {data.projects.map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>}<div className="wide line-items">
                <div className="document-section-title">
                  <span>03</span>
                  <div>
                    <strong>{newDocKind === "INVOICE" ? "Invoice items" : "Document items"}</strong>
                    <small>Add services or products and review each line amount</small>
                  </div>
                </div>
                <div className="line-labels"
    style={{ gridTemplateColumns: newDocKind === "BILL" ? "30px minmax(180px,3fr) 1fr 25px" : rateColumn ? "30px minmax(130px,3fr) .6fr .9fr .9fr .6fr 25px" : "30px minmax(130px,3fr) .6fr .9fr .9fr 25px" }}>
                  <span>SL</span>
                  <span>{newDocKind === "BILL" ? "Description" : "Description / HSN-SAC"}</span>
                  {newDocKind === "BILL" ? <span>Amount Received (INR)</span> : <><span>Qty</span><span>Rate ({docCurrency})</span><span>Amount ({docCurrency})</span>{rateColumn && <span>{taxTreatment === "ZERO_RATED" && zeroRatedType === "LUT" ? "GST % (not charged)" : "GST %"}</span>}</>}
                  <span />
                </div>
                {docLines.map((
    l,
    i
  ) => <div className="line-editor"
    key={i}
    style={{ gridTemplateColumns: newDocKind === "BILL" ? "30px minmax(180px,3fr) 1fr 25px" : rateColumn ? "30px minmax(130px,3fr) .6fr .9fr .9fr .6fr 25px" : "30px minmax(130px,3fr) .6fr .9fr .9fr 25px" }}>
                  <span className="line-serial">{i + 1}</span>
                  <div>
                    <input aria-label={"Line " + (i + 1) + " description"}
    placeholder={newDocKind === "BILL" ? "Payment description" : "Service or item — type to pick a saved one"}
    required
    list={newDocKind === "BILL" ? undefined : "item-options"}
    value={l.description}
    onChange={e => setDocLines(docLines.map((x, j) => j === i ? (newDocKind === "BILL" ? { ...x, description: e.target.value } : withItem(x, e.target.value)) : x))}/>
                    {newDocKind !== "BILL" && <input aria-label={"Line " + (i + 1) + " HSN SAC"}
    placeholder="HSN / SAC"
    value={l.hsn}
    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, hsn: e.target.value } : x))}/>}
                  </div>
                  {newDocKind === "BILL" ? <input aria-label={"Line " + (i + 1) + " payment amount"}
    type="number"
    step=".01"
    min="0"
    required
    value={l.price}
    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, quantity: "1", price: e.target.value, taxRate: "0" } : x))}/> : <>{["quantity", "price"].map(k => <input key={k}
    aria-label={"Line " + (i + 1) + " " + k}
    type="number"
    step={k === "quantity" ? ".0001" : ".01"}
    min={k === "quantity" ? ".0001" : "0"}
    required
    value={l[k]}
    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))}/>)}<span className="line-amount">
                      {docMoney(Math.round((Number(l.quantity) || 0) * (Number(l.price) || 0) * 100) / 100)}
                    </span>{rateColumn && <input aria-label={"Line " + (i + 1) + " taxRate"}
    type="number"
    step=".01"
    min="0"
    max="100"
    required
    value={l.taxRate}
    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, taxRate: e.target.value } : x))}/>}</>}
                  <button type="button"
    className="icon-btn"
    aria-label="Remove line"
    disabled={docLines.length === 1}
    onClick={() => setDocLines(docLines.filter((_, j) => j !== i))}>
                    <Trash2 size={15}/>
                  </button>
                </div>)}
                <button className="link"
    type="button"
    onClick={() => setDocLines([...docLines, { description: "", quantity: "1", price: "", taxRate: "18", hsn: "" }])}>
                  <Plus size={15}/>Add line item</button>
              </div>{newDocKind === "BILL" && <div className="wide form-note receipt-live-total">
                <strong>Amount Received: {money(draftPaymentTotal)}</strong>
                <span>Amount in Words: {amountInWords(draftPaymentTotal)}</span>
              </div>}{newDocKind !== "BILL" && <div className="wide">
                <div className="document-section-title">
                  <span>04</span>
                  <div>
                    <strong>{newDocKind === "INVOICE" ? "Invoice summary" : "Document summary"}</strong>
                    <small>Tax breakdown follows the selected GST treatment</small>
                  </div>
                </div>
                <div className="document-form-totals">
                  <div><span>Subtotal</span><strong>{docMoney(draftInvoiceTotals.subtotal)}</strong></div>
                  {gstCharged(taxTreatment, zeroRatedType) && (draftInterstate === true ? <div><span>IGST</span><strong>{docMoney(draftInvoiceTotals.igst)}</strong></div> : draftInterstate === false ? <><div><span>CGST</span><strong>{docMoney(draftInvoiceTotals.cgst)}</strong></div><div><span>SGST</span><strong>{docMoney(draftInvoiceTotals.sgst)}</strong></div></> : <div><span>GST</span><strong>Select a tax calculation</strong></div>)}
                  <div>
                    <span>Advance status</span>
                    <strong>
                      {advanceValue <= 0 ? "Not Received" : advanceValue >= draftInvoiceTotals.total ? "Fully Received" : "Partially Received"}
                    </strong>
                  </div>
                  <div><span>Advance Paid</span><strong>{docMoney(advanceValue)}</strong></div>
                  <div>
                    <span>Balance Payable</span>
                    <strong>{docMoney(Math.max(0, draftInvoiceTotals.total - advanceValue))}</strong>
                  </div>
                  <div className="grand-total">
                    <span>Total</span>
                    <strong>{docMoney(draftInvoiceTotals.total)}</strong>
                  </div>
                </div>
                <Field label="Advance Payment Status">
                  <select value={advanceStatus}
    onChange={e => { setAdvanceStatus(e.target.value); if (e.target.value === "NOT_RECEIVED")
      setAdvanceAmount("0");
    else if (e.target.value === "FULLY_RECEIVED")
      setAdvanceAmount(String(draftInvoiceTotals.total));
    else if (Number(advanceAmount) <= 0 || Number(advanceAmount) >= draftInvoiceTotals.total)
      setAdvanceAmount(String(Math.round(draftInvoiceTotals.total / 2 * 100) / 100)) }}>
                    <option value="NOT_RECEIVED">Not Received</option>
                    <option value="PARTIALLY_RECEIVED">Partially Received</option>
                    <option value="FULLY_RECEIVED">Fully Received</option>
                  </select>
                </Field>
                <Field label={"Advance paid (" + docCurrency + ")"}>
                  <input type="number"
    min="0"
    max={draftInvoiceTotals.total}
    step=".01"
    value={advanceAmount}
    onChange={e => {
    setAdvanceAmount(e.target.value);
    setAdvanceStatus(Number(e.target.value) <= 0 ? "NOT_RECEIVED" : Number(e.target.value) >= draftInvoiceTotals.total ? "FULLY_RECEIVED" : "PARTIALLY_RECEIVED")
  }}/>
                </Field>
                {newDocKind === "INVOICE" && advanceValue > 0 && <Field label="Advance received into">
                  <select name="advanceAccount" required defaultValue={modal.document?.advance_account || "1000"}>
                    {accounts.filter((a: Row) => a.is_cash).map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}
                  </select>
                </Field>}
                {advanceValue > 0 && <div className="form-note">{newDocKind === "INVOICE" ? "Issuing the invoice also records this advance as a receipt allocated to it." : "Shown on the document only. Quotations and proformas never post to the ledger, and converting to an invoice does not carry this advance over."}</div>}
                {newDocKind === "INVOICE" && docCurrency !== "INR" && <div className="form-note">Issuing asks for the exchange rate (INR per 1 {docCurrency}); the ledger posts the INR equivalent and the invoice prints both. Receipts are entered in {docCurrency} with the INR credited to the bank; the difference is a foreign exchange gain or loss. Record any advance as a receipt after issuing.</div>}
              </div>}{newDocKind !== "BILL" && <div className="wide">
                <div className="document-section-title">
                  <span>05</span>
                  <div>
                    <strong>Bank details</strong>
                    <small>{taxTreatment === "OUTSIDE_GST" ? "Edit bank details for this document" : "Configured in Settings and included on the invoice"}</small>
                  </div>
                </div>
                {taxTreatment === "OUTSIDE_GST" ? <div className="form-grid">
                  {[["account_holder_name", "Account holder"], ["bank_name", "Bank"], ["account_number", "Account number"], ["ifsc_code", "IFSC"], ["branch_name", "Branch"]].map(([key, label]) => <Field key={key} label={label}>
                    <input value={documentCompany[key] || ""} onChange={e => setDocumentCompany({ ...documentCompany, [key]: e.target.value })}/>
                  </Field>)}
                  <Field label="Additional bank details" wide><textarea value={documentCompany.bank_details || ""} onChange={e => setDocumentCompany({ ...documentCompany, bank_details: e.target.value })}/></Field>
                </div> : <div className="document-form-header bank-summary">
                  {[
    ["Account holder", data.company.account_holder_name],
    ["Bank", data.company.bank_name],
    ["Account number", data.company.account_number],
    ["IFSC", data.company.ifsc_code],
    ["Branch", data.company.branch_name]
  ].filter(([, value]) => Boolean(value)).map(([label, value]) => <span key={String(label)}><strong>{label}: </strong>{value}</span>)}
                  {!data.company.account_holder_name && !data.company.bank_name && !data.company.account_number && !data.company.ifsc_code && !data.company.branch_name && <span>{data.company.bank_details || "No bank details configured yet. Add them in Settings."}</span>}
                </div>}
              </div>}{newDocKind !== "INVOICE" && newDocKind !== "BILL" && <Field label="Notes" wide>
                <textarea name="notes"
    defaultValue={modal.document?.notes || ""}
    placeholder="Scope, payment terms or supporting notes"/>
              </Field>}<div className="form-note wide">Saved as a draft. Issuing an invoice or payment receipt posts to the ledger; quotations and proformas remain non-posting.</div></>}
 {modal.type === "payment" && paymentDirection === "PAYMENT" && <><div className="form-note wide">Money paid to a vendor. Allocate it to their posted bills; anything left over is kept as a vendor advance you can apply to a later bill.</div><Field label="Vendor" wide>
                <select name="partyId" required value={payParty} onChange={e => { setPayParty(e.target.value); setAlloc({}); }}>
                  <option value="">Choose a vendor</option>
                  {selectableParties("VENDOR", payParty).map((p: Row) => <option key={p.id} value={p.id}>{p.name}{Number(p.payable) > 0 ? " · payable " + money(p.payable) : ""}</option>)}
                </select>
              </Field><Field label="Payment date">
                <input name="date" type="date" defaultValue={today()} required/>
              </Field><Field label="Paid from bank (net of TDS, ₹)">
                <input name="amount" type="number" min=".01" step=".01" required value={payAmount} onChange={e => setPayAmount(e.target.value)}/>
              </Field><Field label="Paid from">{bankSelect()}</Field><Field label="Reference / description">
                <input name="description" required minLength={2} placeholder="UTR, cheque no. or note"/>
              </Field>{(() => {
                const docs: Row[] = openDocsFor(payParty, "PURCHASE"), { inrAlloc } = paymentFigures(docs);
                // TDS is normally worked out on the taxable value (excluding GST) of the bills being paid.
                const taxable = docs.reduce((s: number, d: Row) => s + (Number(alloc[d.id]) || 0) * Number(d.subtotal) / Number(d.total || 1), 0);
                const net = (cents(inrAlloc) - cents(tdsAmount)) / 100;
                return <><Field label="TDS section (if deducting)">
                    <select name="tdsSection" value={tdsSection} onChange={e => setTdsSection(e.target.value)}>
                      <option value="">No TDS</option>
                      {TDS_SECTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                    </select>
                  </Field>{tdsSection && <><Field label="TDS rate (%)">
                      <input name="tdsRate" type="number" min="0" max="100" step=".0001" value={tdsRate} onChange={e => setTdsRate(e.target.value)} placeholder="e.g. 10"/>
                    </Field><Field label="TDS deducted (₹)">
                      <div className="document-form-header" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input name="tdsAmount" type="number" min="0" step=".01" value={tdsAmount} onChange={e => setTdsAmount(e.target.value)} style={{ flex: 1 }}/>
                        <button type="button" className="btn small-btn" disabled={!Number(tdsRate) || taxable <= 0} onClick={() => setTdsAmount((Math.round(taxable * Number(tdsRate)) / 100).toFixed(2))}>
                          {Number(tdsRate) || 0}% of {money(taxable)}
                        </button>
                      </div>
                    </Field></>}
                  {payParty && <AllocationTable docs={docs} values={alloc} onChange={setAlloc} amount={((cents(payAmount) + cents(tdsSection ? tdsAmount : 0)) / 100)} remainderLabel="kept as a vendor advance" noun="bills"/>}
                  {tdsSection && Number(tdsAmount) > 0 && <div className="wide form-note receipt-live-total">
                    <strong>Bills settled {money(inrAlloc)} · TDS {money(tdsAmount)} · net paid from bank {money(net)}</strong>
                    <span>Posts Dr payables {money(inrAlloc)} / Cr bank / Cr TDS payable (deposit it by the 7th of next month).
                      {cents(payAmount) !== cents(net) && net > 0 && <> <button type="button" className="link small" onClick={() => setPayAmount(net.toFixed(2))}>Use {money(net)} as the bank amount</button></>}</span>
                  </div>}</>;
              })()}
              <Field label="Payment proof (optional)" wide><input name="attachment" type="file" accept={ATTACHMENT_ACCEPT}/></Field></>}
 {modal.type === "payment" && paymentDirection === "RECEIPT" && <><div className="form-note wide">Money received from a client. Allocate it to their issued invoices — one receipt can settle several.</div><Field label="Payment receipt number">
                <input name="number" maxLength={80} placeholder="Generated automatically on save"/>
              </Field><Field label="Client">
                <select name="partyId"
    required
    value={payParty}
    onChange={e => {
    const p = data.parties.find((x: Row) => x.id === e.target.value);
    setPayParty(e.target.value);
    setAlloc({});
    setClientInfo({
      name: p?.name || "",
      address: p?.address || "",
      gstin: p?.gstin || "",
      contactName: p?.contact_name || "",
      phone: p?.phone || ""
    })
  }}>
                  <option value="">Choose a client</option>
                  {selectableParties("CLIENT", payParty).map((p: Row) => <option key={p.id} value={p.id}>{p.name}{Number(p.receivable) > 0 ? " · due " + money(p.receivable) : ""}</option>)}
                </select>
              </Field><><Field label="Client name">
                  <input value={clientInfo.name} onChange={e => setClientInfo({ ...clientInfo, name: e.target.value })}/>
                </Field><Field label="Address" wide>
                  <textarea value={clientInfo.address}
    onChange={e => setClientInfo({ ...clientInfo, address: e.target.value })}/>
                </Field><Field label="GST Number / GSTIN">
                  <input value={clientInfo.gstin} onChange={e => setClientInfo({ ...clientInfo, gstin: e.target.value })}/>
                </Field><Field label="Contact name">
                  <input value={clientInfo.contactName}
    onChange={e => setClientInfo({ ...clientInfo, contactName: e.target.value })}/>
                </Field><Field label="Phone number">
                  <input value={clientInfo.phone} onChange={e => setClientInfo({ ...clientInfo, phone: e.target.value })}/>
                </Field></><Field label="Payment date">
                <input name="date" type="date" defaultValue={today()} required/>
              </Field><Field label="Amount credited to bank / cash (₹)">
                <input name="amount" type="number" min=".01" step=".01" required value={payAmount} onChange={e => setPayAmount(e.target.value)}/>
              </Field><Field label="Bank / cash">{bankSelect()}</Field><Field label="TDS deducted by client (₹, optional)">
                <input name="tdsAmount" type="number" min="0" step=".01" value={tdsAmount} onChange={e => setTdsAmount(e.target.value)} placeholder="0.00"/>
              </Field><Field label="Reference / description" wide>
                <input name="description" required placeholder="Bank reference or payment note"/>
              </Field>{payParty && (() => {
                const docs = openDocsFor(payParty, "INVOICE"), { inrAlloc, foreignDocs, carrying } = paymentFigures(docs);
                const fx = (cents(payAmount) - cents(inrAlloc) - cents(carrying)) / 100;
                return <><AllocationTable docs={docs} values={alloc} onChange={setAlloc} amount={(cents(payAmount) + cents(tdsAmount)) / 100}
                  remainderLabel={data.company.demo ? "kept as a client advance" : "unallocated — allocate it in full (live advances are not enabled yet)"} noun="invoices"/>
                  {Number(tdsAmount) > 0 && <div className="wide form-note receipt-live-total">
                    <strong>Invoices settled {money(inrAlloc)} · TDS {money(tdsAmount)} · money received {money((cents(inrAlloc) - cents(tdsAmount)) / 100)}</strong>
                    <span>The TDS is booked to TDS receivable for this client — check it against Form 26AS.
                      {cents(payAmount) !== cents(inrAlloc) - cents(tdsAmount) && cents(inrAlloc) > cents(tdsAmount) && <> <button type="button" className="link small" onClick={() => setPayAmount(((cents(inrAlloc) - cents(tdsAmount)) / 100).toFixed(2))}>Use {money((cents(inrAlloc) - cents(tdsAmount)) / 100)} as the amount received</button></>}</span>
                  </div>}
                  {foreignDocs.length > 0 && <div className={"wide form-note receipt-live-total" + (Number(payAmount) > 0 ? "" : " muted")}>
                    <strong>{foreignDocs.map(d => d.currency + " " + Number(alloc[d.id]).toFixed(2) + " on " + d.number).join(", ")} · carried at {money(carrying + inrAlloc)}</strong>
                    <span>{Number(payAmount) > 0
                      ? (fx >= 0 ? "Foreign exchange gain " : "Foreign exchange loss ") + money(Math.abs(fx)) + " — the INR credited to the bank less the invoice's INR value at its issue rate."
                      : "Enter the INR actually credited to the bank; the difference from the invoice's INR value is posted as an exchange gain or loss."}</span>
                  </div>}</>;
              })()}</>}
 {modal.type === "advance" && (() => {
    const kind = paymentDirection === "PAYMENT" ? "PURCHASE" : "INVOICE";
    const holders = data.parties.filter((p: Row) => advanceOf(p, paymentDirection) > 0 || p.id === payParty);
    const available = advanceOf(data.parties.find((p: Row) => p.id === payParty), paymentDirection);
    return <><div className="form-note wide">{paymentDirection === "PAYMENT"
      ? "Settles vendor bills from money already paid in advance. No cash moves and no expense is added again."
      : "Settles invoices from money the client already paid in advance. No cash moves and no income is added again."}</div><Field label={paymentDirection === "PAYMENT" ? "Vendor" : "Client"} wide>
                <select name="partyId" required value={payParty} onChange={e => { setPayParty(e.target.value); setAlloc({}); }}>
                  <option value="">Choose who paid the advance</option>
                  {holders.map((p: Row) => <option key={p.id} value={p.id}>{p.name} · advance {money(advanceOf(p, paymentDirection))}</option>)}
                </select>
              </Field><Field label="Date applied"><input name="date" type="date" defaultValue={today()} required/></Field><Field label="Advance available"><input value={money(available)} disabled/></Field>
              {payParty && <AllocationTable docs={openDocsFor(payParty, kind).filter((d: Row) => foreignOutstandingOf(d) === null)} values={alloc} onChange={setAlloc} amount={available} remainderLabel="stays as advance" noun={kind === "PURCHASE" ? "bills" : "invoices"}/>}
              {!holders.length && <div className="form-note wide">No {paymentDirection === "PAYMENT" ? "vendor" : "client"} has an unapplied advance as of the selected end date.</div>}</>;
  })()}
 {modal.type === "purchase" && <><div className="wide document-section-title">
                <span>01</span>
                <div><strong>Supplier bill</strong><small>Who billed you, their bill number and dates</small></div>
              </div><Field label="Vendor" wide>
                <select name="partyId" required value={docPartyId} onChange={e => {
    const p = data.parties.find((x: Row) => x.id === e.target.value);
    setDocPartyId(e.target.value);
    const state = String(p?.gstin || "").slice(0, 2);
    setPlaceOfSupply(/^\d{2}$/.test(state) ? state : data.company.state_code || "");
  }}>
                  <option value="">Choose a vendor</option>
                  {selectableParties("VENDOR", docPartyId).map((p: Row) => <option key={p.id} value={p.id}>{p.name}{p.gstin ? " · " + p.gstin : ""}</option>)}
                </select>
              </Field><Field label="Supplier's bill number"><input name="reference" required maxLength={80} defaultValue={modal.document?.reference || ""} placeholder="As printed on their bill"/></Field>
              <Field label="Bill date"><input name="date" type="date" required defaultValue={modal.document?.issue_date?.slice(0, 10) || today()}/></Field>
              <Field label="Due date"><input name="dueDate" type="date" required defaultValue={modal.document?.due_date?.slice(0, 10) || localDate(30)}/></Field>
              <Field label="Book to (expense or asset)">
                <select name="expenseAccount" required defaultValue={modal.document?.expense_account || ""}>
                  <option value="">Choose an account</option>
                  <optgroup label="Expenses">{fixedAssetOrExpense.filter((a: Row) => a.kind === "EXPENSE").map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}</optgroup>
                  <optgroup label="Fixed assets & deposits">{fixedAssetOrExpense.filter((a: Row) => a.kind === "ASSET").map((a: Row) => <option key={a.code} value={a.code}>{a.name}</option>)}</optgroup>
                </select>
              </Field><Field label="Project (optional)">
                <select name="projectId" defaultValue={modal.document?.project_id || ""}>
                  <option value="">No project</option>
                  {data.projects.filter((p: Row) => !p.archived || p.id === modal.document?.project_id).map((p: Row) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field><div className="wide document-section-title">
                <span>02</span>
                <div><strong>GST on this bill</strong><small>What the supplier charged, and whether you can claim it</small></div>
              </div><Field label="GST on this bill">
                <select value={taxTreatment === "TAXABLE" && reverseCharge ? "RCM" : taxTreatment} onChange={e => {
      setReverseCharge(e.target.value === "RCM");
      setTaxTreatment(e.target.value === "RCM" ? "TAXABLE" : e.target.value);
    }}>
                  <option value="TAXABLE">GST charged by the supplier</option>
                  <option value="RCM">Reverse charge — no GST on the bill; we pay it</option>
                  <option value="OUTSIDE_GST">No GST charged</option>
                </select>
              </Field>{reverseCharge && taxTreatment === "TAXABLE" && <div className="form-note wide">
                Enter the GST rates the company must pay. The supplier is owed only the taxable value; the tax is booked as RCM payable (paid in cash, not from ITC) and, if eligible, claimed as ITC.
                {!String(data.parties.find((p: Row) => p.id === docPartyId)?.gstin || "").trim() && " This vendor has no GSTIN, so posting assigns a self-invoice number (series SI)."}
              </div>}{taxTreatment === "TAXABLE" ? <><Field label="Supplier state code">
                  <input name="placeOfSupply" value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} pattern="[0-9]{2}" required placeholder="e.g. 32"/>
                </Field><Field label="Tax split">
                  <select value={supplyStateKnown ? (draftInterstate ? "INTER" : "INTRA") : manualSupplyMode} required disabled={supplyStateKnown} onChange={e => setManualSupplyMode(e.target.value)}>
                    <option value="">Select tax calculation</option>
                    <option value="INTRA">CGST + SGST</option>
                    <option value="INTER">IGST</option>
                  </select>
                </Field><label className="check-field wide"><input type="checkbox" name="itcEligible" defaultChecked={modal.document ? modal.document.itc_eligible !== false : true}/> Claim input tax credit (ITC) on this bill — untick for blocked credits such as food, personal use or motor vehicles</label></>
                : <input type="hidden" name="placeOfSupply" value={data.company.state_code || "00"}/>}
              <div className="wide line-items">
                <div className="document-section-title">
                  <span>03</span>
                  <div><strong>Bill items</strong><small>As listed on the supplier's bill</small></div>
                </div>
                <div className="line-labels" style={{ gridTemplateColumns: taxTreatment === "TAXABLE" ? "30px minmax(130px,3fr) .6fr .9fr .9fr .6fr 25px" : "30px minmax(130px,3fr) .6fr .9fr .9fr 25px" }}>
                  <span>SL</span><span>Description / HSN-SAC</span><span>Qty</span><span>Rate (₹)</span><span>Amount (₹)</span>{taxTreatment === "TAXABLE" && <span>GST %</span>}<span />
                </div>
                {docLines.map((l, i) => <div className="line-editor" key={i} style={{ gridTemplateColumns: taxTreatment === "TAXABLE" ? "30px minmax(130px,3fr) .6fr .9fr .9fr .6fr 25px" : "30px minmax(130px,3fr) .6fr .9fr .9fr 25px" }}>
                  <span className="line-serial">{i + 1}</span>
                  <div>
                    <input aria-label={"Line " + (i + 1) + " description"} required list="item-options" placeholder="Item or service" value={l.description}
                      onChange={e => setDocLines(docLines.map((x, j) => j === i ? withItem(x, e.target.value) : x))}/>
                    <input aria-label={"Line " + (i + 1) + " HSN SAC"} placeholder="HSN / SAC" value={l.hsn} onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, hsn: e.target.value } : x))}/>
                  </div>
                  {["quantity", "price"].map(k => <input key={k} aria-label={"Line " + (i + 1) + " " + k} type="number" step={k === "quantity" ? ".0001" : ".01"} min={k === "quantity" ? ".0001" : "0"} required value={l[k]}
                    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))}/>)}
                  <span className="line-amount">{money(Math.round((Number(l.quantity) || 0) * (Number(l.price) || 0) * 100) / 100)}</span>
                  {taxTreatment === "TAXABLE" && <input aria-label={"Line " + (i + 1) + " taxRate"} type="number" step=".01" min="0" max="100" required value={l.taxRate}
                    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, taxRate: e.target.value } : x))}/>}
                  <button type="button" className="icon-btn" aria-label="Remove line" disabled={docLines.length === 1} onClick={() => setDocLines(docLines.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
                </div>)}
                <button className="link" type="button" onClick={() => setDocLines([...docLines, { description: "", quantity: "1", price: "", taxRate: "18", hsn: "" }])}><Plus size={15}/>Add line item</button>
              </div>
              <div className="wide document-form-totals">
                <div><span>Taxable value</span><strong>{money(draftInvoiceTotals.subtotal)}</strong></div>
                {taxTreatment === "TAXABLE" && (draftInterstate === true ? <div><span>IGST</span><strong>{money(draftInvoiceTotals.igst)}</strong></div> : draftInterstate === false ? <><div><span>CGST</span><strong>{money(draftInvoiceTotals.cgst)}</strong></div><div><span>SGST</span><strong>{money(draftInvoiceTotals.sgst)}</strong></div></> : <div><span>GST</span><strong>Select a tax split</strong></div>)}
                {reverseCharge && taxTreatment === "TAXABLE"
                  ? <div className="grand-total"><span>Payable to supplier</span><strong>{money(draftInvoiceTotals.subtotal)}</strong></div>
                  : <div className="grand-total"><span>Bill total</span><strong>{money(draftInvoiceTotals.total)}</strong></div>}
              </div>
              <Field label="Notes" wide><textarea name="notes" defaultValue={modal.document?.notes || ""} placeholder="Optional"/></Field>
              <Field label="Scanned bill (optional)" wide><input name="attachment" type="file" accept={ATTACHMENT_ACCEPT}/></Field>
              <div className="form-note wide">Saved as a draft. Posting it records the expense (or asset), the claimable GST as input tax credit and the amount you owe the vendor.</div></>}
 {modal.type === "budget" && <><Field label="Month">
                <input name="month" type="month" defaultValue={data.month || from.slice(0, 7)} required/>
              </Field><Field label="Category">{catSelect()}</Field><Field label="Budget amount (₹)" wide>
                <input name="amount" type="number" min="0" step=".01" required/>
              </Field></>}
 {modal.type === "recurring" && <><Field label="Schedule name" wide><input name="name" required/></Field><input type="hidden" name="kind" value="EXPENSE"/><Field label="Expense category">{catSelect()}</Field><Field label="Payment account">{bankSelect()}</Field><Field label="Amount (₹)">
                <input name="amount" type="number" step=".01" min=".01" required/>
              </Field><Field label="Day of month (1–28)">
                <input name="day" type="number" min="1" max="28" defaultValue="5" required/>
              </Field></>}
 {modal.type === "import" && <><Field label="Bank account" wide>{bankSelect("account")}</Field><Field label="CSV contents" wide>
                <textarea className="code-area"
    name="csv"
    required
    placeholder={"date,reference,description,amount\n2026-10-20,REF-001,Client payment,15000.00"}/>
              </Field><div className="form-note wide">ISO dates, positive receipts and negative payments. Required columns: date, reference, description, amount. Duplicate rows are skipped. Import does not post to the ledger.</div></>}
 {modal.type === "match" && <><div className="form-note wide">{modal.line.description} · {money(modal.line.amount)}</div><Field label="Posted entry in the selected date range" wide>
                <select name="entryId" required>
                  <option value="">Choose matching entry</option>
                  {data.entries.map((e: Row) => <option value={e.id} key={e.id}>{e.number} · {e.description} · {money(e.amount)}</option>)}
                </select>
              </Field><p className="fine wide">The API checks that the exact amount matches this bank account. Split matching is planned.</p></>}
 {modal.type === "reverse" && <><div className="form-note wide">
                {modal.entry.number} · {modal.entry.description}
                <br />A new reversing entry will preserve the original record.{["RECEIPT", "PAYMENT"].includes(modal.entry.kind) && " Any invoice this receipt settled becomes outstanding again."}</div><Field label="Reversal date">
                <input name="date" type="date" defaultValue={today()} min={modal.entry.entry_date?.slice(0, 10)} required/>
              </Field><Field label="Reason"><input name="reason" required minLength={3}/></Field></>}
 {modal.type === "creditNote" && <><div className="form-note wide">
                Against {modal.document.number} · {modal.document.party_name} · outstanding {money(outstandingOf(modal.document))}{foreignOutstandingOf(modal.document) !== null && " (" + modal.document.currency + " " + foreignOutstandingOf(modal.document)!.toFixed(2) + ", credited at the invoice's own rate)"}.
                <br />Credits use the invoice's own rates and tax. If the money was already refunded, reverse that receipt first.</div><Field label="Credit note date">
                <input name="date" type="date" defaultValue={today()} min={modal.document.issue_date?.slice(0, 10)} required/>
              </Field><Field label="Reason"><input name="reason" required minLength={3} placeholder="e.g. Service not delivered"/></Field><div className="wide table-scroll">
                <table>
                  <thead><tr><th>Invoice line</th><th className="right">Invoiced qty</th><th className="right">Already credited</th><th className="right">Credit qty</th></tr></thead>
                  <tbody>
                    {(() => {
    const lines = modal.document.lines as Row[];
    const done = (i: number) => data.documents
      .filter((c: Row) => c.kind === "CREDIT_NOTE" && c.status === "ISSUED" && c.source_id === modal.document.id)
      .reduce((s: number, c: Row) => s + (c.lines as Row[]).filter(x => x.sourceLine === i).reduce((t, x) => t + Number(x.quantity), 0), 0);
    const remainingQty = lines.map((l, i) => Math.max(0, Math.round((Number(l.quantity) - done(i)) * 10000) / 10000));
    // Prefill everything that remains only when that whole credit fits the outstanding balance; otherwise start from zero.
    const remainingValue = lines.reduce((s, l, i) => s + remainingQty[i] / Number(l.quantity) * (Number(l.base) + Number(l.tax)), 0);
    const prefill = remainingValue <= (foreignOutstandingOf(modal.document) ?? outstandingOf(modal.document)) + 0.005;
    return lines.map((l, i) => ({ l, i, done: done(i), remaining: remainingQty[i], prefill }));
  })().map(({ l, i, done, remaining, prefill }) => {
    return <tr key={i}>
                      <td>{l.description}<small>{money(l.price)} · GST {l.taxRate}%</small></td>
                      <td className="right">{l.quantity}</td>
                      <td className="right">{done}</td>
                      <td className="right"><input aria-label={"Credit quantity for line " + (i + 1)} name={"qty-" + i} type="number" min="0" max={remaining} step=".0001" defaultValue={prefill ? String(remaining) : "0"} disabled={remaining <= 0}/></td>
                    </tr>;
  })}
                  </tbody>
                </table>
              </div></>}
 {modal.type === "debitNote" && (() => {
    const bill = modal.document, lines = bill.lines as Row[];
    const done = (i: number) => data.documents
      .filter((c: Row) => c.kind === "DEBIT_NOTE" && c.status === "ISSUED" && c.source_id === bill.id)
      .reduce((s: number, c: Row) => s + (c.lines as Row[]).filter(x => x.sourceLine === i).reduce((t, x) => t + Number(x.quantity), 0), 0);
    return <><div className="form-note wide">
                Against {bill.number} (supplier bill {bill.reference}) · {bill.party_name} · outstanding {money(outstandingOf(bill))}.
                <br />Goods returned or overbilling: quantities at the bill's own rates. It reduces the payable, the cost{bill.tax_treatment === "TAXABLE" && bill.itc_eligible !== false ? " and the input tax claimed (" + (bill.interstate ? "IGST" : "CGST + SGST") + ")" : ""}{bill.reverse_charge ? ", and the reverse-charge tax owed" : ""}. It cannot exceed what is still owed — if the vendor refunded money, reverse the payment first.</div>
              <Field label="Debit note date"><input name="date" type="date" defaultValue={today()} min={bill.issue_date?.slice(0, 10)} required/></Field>
              <Field label="Reason"><input name="reason" required minLength={3} placeholder="e.g. 2 chairs returned damaged"/></Field>
              <div className="wide table-scroll"><table>
                <thead><tr><th>Bill line</th><th className="right">Billed qty</th><th className="right">Already debited</th><th className="right">Debit qty</th></tr></thead>
                <tbody>{lines.map((l, i) => {
                  const remaining = Math.max(0, Math.round((Number(l.quantity) - done(i)) * 10000) / 10000);
                  return <tr key={i}>
                    <td>{l.description}<small>{money(l.price)} · GST {l.taxRate}%</small></td>
                    <td className="right">{l.quantity}</td><td className="right">{done(i)}</td>
                    <td className="right"><input aria-label={"Debit quantity for line " + (i + 1)} name={"qty-" + i} type="number" min="0" max={remaining} step=".0001" defaultValue="0" disabled={remaining <= 0}/></td>
                  </tr>;
                })}</tbody>
              </table></div></>;
  })()}
 {modal.type === "salesDebitNote" && (() => {
    const inv = modal.document, taxed = gstCharged(inv.tax_treatment, inv.zero_rated_type);
    const rows = docLines.map(l => {
      const base = Math.round((Number(l.quantity) || 0) * (Number(l.price) || 0) * 100) / 100;
      return { base, tax: taxed ? Math.round(base * (Number(l.taxRate) || 0)) / 100 : 0 };
    });
    const sub = rows.reduce((s, r) => s + Math.round(r.base * 100), 0) / 100, tax = rows.reduce((s, r) => s + Math.round(r.tax * 100), 0) / 100;
    return <><div className="form-note wide">
                Against {inv.number} · {inv.party_name}. For an amount the invoice under-charged: it is billed with the invoice's own treatment and supply type ({inv.interstate ? "IGST" : "CGST + SGST"}) and becomes a receivable that receipts settle.</div>
              <Field label="Debit note date"><input name="date" type="date" defaultValue={today()} min={inv.issue_date?.slice(0, 10)} required/></Field>
              <Field label="Due date"><input name="dueDate" type="date" defaultValue={localDate(15)} required/></Field>
              <Field label="Reason" wide><input name="reason" required minLength={3} placeholder="e.g. Additional hours not billed"/></Field>
              <div className="wide line-items">
                {docLines.map((l, i) => <div className="line-editor" key={i} style={{ gridTemplateColumns: "30px minmax(130px,3fr) .6fr .9fr .9fr .6fr 25px" }}>
                  <span className="line-serial">{i + 1}</span>
                  <div>
                    <input aria-label={"Line " + (i + 1) + " description"} required list="item-options" placeholder="What was under-charged" value={l.description} onChange={e => setDocLines(docLines.map((x, j) => j === i ? withItem(x, e.target.value) : x))}/>
                    <input aria-label={"Line " + (i + 1) + " HSN SAC"} placeholder="HSN / SAC" value={l.hsn} onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, hsn: e.target.value } : x))}/>
                  </div>
                  {["quantity", "price"].map(k => <input key={k} aria-label={"Line " + (i + 1) + " " + k} type="number" step={k === "quantity" ? ".0001" : ".01"} min={k === "quantity" ? ".0001" : "0"} required value={l[k]}
                    onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))}/>)}
                  <span className="line-amount">{money(rows[i]?.base)}</span>
                  <input aria-label={"Line " + (i + 1) + " taxRate"} type="number" step=".01" min="0" max="100" required value={l.taxRate} disabled={!taxed && inv.tax_treatment !== "ZERO_RATED"} onChange={e => setDocLines(docLines.map((x, j) => j === i ? { ...x, taxRate: e.target.value } : x))}/>
                  <button type="button" className="icon-btn" aria-label="Remove line" disabled={docLines.length === 1} onClick={() => setDocLines(docLines.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
                </div>)}
                <button className="link" type="button" onClick={() => setDocLines([...docLines, { description: "", quantity: "1", price: "", taxRate: docLines[0]?.taxRate || "18", hsn: "" }])}><Plus size={15}/>Add line item</button>
              </div>
              <div className="wide document-form-totals">
                <div><span>Taxable value</span><strong>{money(sub)}</strong></div>
                {taxed && <div><span>{inv.interstate ? "IGST" : "CGST + SGST"}</span><strong>{money(tax)}</strong></div>}
                <div className="grand-total"><span>Debit note total</span><strong>{money(Math.round((sub + tax) * 100) / 100)}</strong></div>
              </div></>;
  })()}
 {modal.type === "issue" && <><div className="form-note wide">
                {modal.document.number} · {modal.document.party_name} · {modal.document.currency} {Number(modal.document.total).toFixed(2)}.
                <br />The ledger posts the INR equivalent at this rate (each line converted and rounded to paise). The rate is fixed on the invoice; receipts later post any exchange gain or loss.</div>
              <Field label={"Exchange rate (INR per 1 " + modal.document.currency + ")"}>
                <input name="exchangeRate" required inputMode="decimal" pattern="\d{1,9}(\.\d{1,6})?" title="Up to 6 decimals, e.g. 83.123456" placeholder="e.g. 83.123456"
                  value={issueRate} onChange={e => setIssueRate(e.target.value)}/>
              </Field>
              <Field label="INR equivalent (approximate preview)"><input disabled value={Number(issueRate) > 0 ? money(Number(modal.document.total) * Number(issueRate)) : "—"}/></Field>
              <div className="form-note wide">Use the rate your accountant applies for GST valuation (for example the RBI reference rate or the bank's rate on the invoice date).</div></>}
 {modal.type === "irn" && <><div className="form-note wide">
                {modal.document.number} · {modal.document.party_name}. Paste the details the IRP (or your GSP) returned for this invoice. No connection is made to the IRP from here.
                <br /><strong>These details cannot be changed once saved.</strong> If an IRN was generated in error, cancel it on the IRP and correct the invoice with a credit note and a new invoice.</div>
              <Field label="IRN (64 characters)" wide><input name="irn" required pattern="[0-9a-fA-F]{64}" title="64 hexadecimal characters" className="mono" autoComplete="off"/></Field>
              <Field label="Acknowledgement number"><input name="ackNo" required pattern="\d{1,20}" inputMode="numeric"/></Field>
              <Field label="Acknowledgement date & time"><input name="ackDate" required placeholder="YYYY-MM-DD HH:MM:SS" pattern="\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?"/></Field>
              <Field label="Signed QR code (text)" wide><textarea name="signedQr" required minLength={20} maxLength={4000} className="code-area" placeholder="eyJhbGciOi…"/></Field></>}
 {modal.type === "gstFiling" && <><div className="form-note wide">Record a return you filed on the GST portal yourself. Nothing is filed from here. Entries dated in a filed month will ask for confirmation before saving.</div>
              <Field label="Return period (MMYYYY)"><input name="period" required pattern="(0[1-9]|1[0-2])\d{4}" defaultValue={modal.period || ""} placeholder="e.g. 112026"/></Field>
              <Field label="Return"><select name="returnType" defaultValue={modal.returnType || "GSTR1"}><option value="GSTR1">GSTR-1</option><option value="GSTR3B">GSTR-3B</option></select></Field>
              <Field label="ARN"><input name="arn" required pattern="[A-Za-z0-9]{10,20}" autoCapitalize="characters" placeholder="As on the acknowledgement"/></Field>
              <Field label="Filed on"><input name="filedOn" type="date" required defaultValue={today()}/></Field>
              <label className="check-field wide"><input type="checkbox" name="lockPeriod" defaultChecked/> Lock the accounting period through the end of this month (uses the period lock; reopening is audited)</label></>}
 {modal.type === "cancel" && <><div className="form-note wide">
                {modal.document.number} · {modal.document.party_name}
                <br />{modal.document.kind === "BILL" && modal.document.status === "ISSUED"
    ? "A reversing entry removes this receipt from cash/bank and income. The original entry and document stay in the audit trail."
    : ["PURCHASE", "DEBIT_NOTE", "SALES_DEBIT_NOTE"].includes(modal.document.kind) && modal.document.status === "ISSUED"
    ? "A reversing entry undoes its posting" + (modal.document.kind === "DEBIT_NOTE" ? " and the bill it reduced becomes outstanding again" : "") + ". The original entry and document stay in the audit trail."
    : "The document is kept for the record and marked cancelled. Nothing is posted to the ledger."}</div>{["BILL", "PURCHASE", "DEBIT_NOTE", "SALES_DEBIT_NOTE"].includes(modal.document.kind) && modal.document.status === "ISSUED" && <Field label="Reversal date">
                <input name="date" type="date" defaultValue={today()} min={modal.document.issue_date?.slice(0, 10)} required/>
              </Field>}<Field label="Reason" wide><input name="reason" required minLength={3}/></Field></>}
 {modal.type === "close" && <><Field label="Lock entries through (blank reopens periods)" wide>
                <input name="through" type="date" defaultValue={data.company.closed_through || ""}/>
              </Field><Field label="Reason for change" wide><input name="reason" required minLength={3}/></Field><div className="form-note wide">Changes are audited. Closing prevents new postings dated on or before this date.</div></>}
 {modal.type === "user" && <><Field label="Full name"><input name="name" required/></Field><Field label="Email"><input name="email" type="email" required/></Field><Field label="Initial password">
                <input name="password" type="password" minLength={12} required autoComplete="new-password"/>
              </Field><Field label="Role">
                <select name="role">
                  <option value="ACCOUNTANT">Accountant</option>
                  <option value="VIEWER">Viewer</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </Field></>}
 {modal.type === "journal" && <><Field label="Date"><input name="date" type="date" required defaultValue={today()}/></Field><Field label="Description"><input name="description" minLength={3} required/></Field><Field label="Debit / credit lines (JSON)" wide>
                <textarea className="code-area"
    name="lines"
    required
    defaultValue={'[\n  {"account":"1000","debit":"1000.00"},\n  {"account":"3000","credit":"1000.00"}\n]'}/>
              </Field><div className="form-note wide">Account codes: {accounts.map((a: Row) => a.code + " " + a.name).join(" · ")}. Debits must equal credits. Use accountant-reviewed entries for opening balances.</div></>}
 </div>
          <div className="modal-actions">
            <button className="btn" type="button" disabled={busy} onClick={() => setModal(null)}>{modal.type === "cancel" ? "Keep document" : "Cancel"}</button>
            <ActionButton className="btn primary" loading={busy} loadingText="Saving…">
              {busy ? "Saving…" : ["document", "purchase"].includes(modal.type) ? "Save draft" : modal.type === "import" ? "Import rows" : modal.type === "creditNote" ? "Issue credit note" : ["debitNote", "salesDebitNote"].includes(modal.type) ? "Issue debit note" : modal.type === "issue" ? "Issue invoice" : modal.type === "irn" ? "Record e-invoice details" : modal.type === "gstFiling" ? "Record filing" : modal.type === "cancel" ? "Cancel document" : modal.type === "advance" ? "Apply advance" : modal.type === "password" ? "Change password" : ["party", "project", "item", "userEdit"].includes(modal.type) ? (modal.party || modal.project || modal.item || modal.user ? "Save changes" : "Save") : "Save entry"}
              <Check size={16}/>
            </ActionButton>
          </div>
        </form></>}
      </div>
    </div>}
  </>;
}
