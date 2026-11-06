import { Controller, Get, Post, Patch, Delete, Body, Req, Res, Param, Query, Inject } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Database } from "./db.js";
import { one } from "./db.js";
import {
  id,
  need,
  D,
  audit,
  idempotent,
  postVoucher,
  createDocument,
  updateDocument,
  issueDocument,
  postPayment,
  writeJournal,
  reverseJournal,
  issueCreditNote,
  cancelDocument,
  applyAdvance,
  businessToday,
  addDays,
  daysBetween,
  issueDebitNote,
  issueSalesDebitNote,
  postTdsDeposit,
  recordEinvoice,
  TDS_SECTIONS,
  TDS_PAYABLE,
  TDS_RECEIVABLE,
  FX_GAIN,
  FX_LOSS
} from "./accounting.js";
import { writer, admin, verifyPassword, hashPassword, login, digest, tokenFrom } from "./auth.js";
import { getReport } from "./reports.js";
import { buildGstReturns, buildEinvoice, periodRange } from "./gst-returns.js";
const amount = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Use an amount with at most two decimal places.");
const date = z.iso.date(), optionalId = z.string().min(1).nullable().optional();
const voucher = z.object({
  kind: z.enum([
    "INCOME",
    "EXPENSE",
    "CAPITAL_IN",
    "CAPITAL_RETURN",
    "LOAN_IN",
    "LOAN_REPAY",
    "INVESTMENT",
    "TRANSFER",
    "ASSET",
    "REIMBURSEMENT"
  ]),
  date,
  amount,
  description: z.string().min(2).max(300),
  cashAccount: z.string(),
  account: z.string().optional(),
  destinationAccount: z.string().optional(),
  partyId: optionalId,
  projectId: optionalId
});
const docSchema = z.object({
  kind: z.enum(["QUOTATION", "PROFORMA", "INVOICE", "BILL", "PURCHASE"]),
  // Vendor bills: the supplier's own bill number, and whether its GST can be claimed as input tax credit.
  reference: z.string().max(80).optional(),
  itcEligible: z.boolean().optional(),
  number: z.string().min(1).max(80).optional(),
  partyId: z.string(),
  projectId: optionalId,
  date,
  dueDate: date,
  taxTreatment: z.enum(["TAXABLE", "NIL_RATED", "EXEMPT", "OUTSIDE_GST", "ZERO_RATED"]),
  // ZERO_RATED: export / SEZ supply under LUT (no IGST) or with payment of IGST (refund route).
  zeroRatedType: z.enum(["LUT", "WITH_IGST"]).optional(),
  // Vendor bills only: the supplier charged no GST and the company pays it under reverse charge.
  reverseCharge: z.boolean().optional(),
  taxReason: z.string().max(500).optional(),
  placeOfSupply: z.string().regex(/^\d{2}$/),
  interstate: z.boolean().optional(),
  expenseAccount: z.string().optional(),
  incomeAccount: z.string().optional(),
  advanceAccount: z.string().optional(),
  paymentMethod: z.enum(["Cash", "Bank Transfer", "Cheque"]).optional(),
  notes: z.string().max(3000).optional(),
  currency: z.enum(["INR", "USD", "EUR", "GBP", "AED", "CAD", "AUD", "SGD"]).default("INR"),
  advanceAmount: amount.default("0"),
  advanceStatus: z.enum(["NOT_RECEIVED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED"]).default("NOT_RECEIVED"),
  client: z.object({
    name: z.string().max(150).optional(),
    address: z.string().max(500).optional(),
    gstin: z.string().max(15).optional(),
    contactName: z.string().max(150).optional(),
    phone: z.string().max(30).optional()
  }).optional(),
  company: z.object({
    name: z.string().max(150).optional(),
    address: z.string().max(500).optional(),
    address_line2: z.string().max(500).optional(),
    city: z.string().max(150).optional(),
    state_name: z.string().max(150).optional(),
    state_code: z.string().max(2).optional(),
    pin_code: z.string().max(20).optional(),
    contact_number: z.string().max(30).optional(),
    account_holder_name: z.string().max(150).optional(),
    bank_name: z.string().max(150).optional(),
    account_number: z.string().max(80).optional(),
    ifsc_code: z.string().max(20).optional(),
    branch_name: z.string().max(150).optional(),
    bank_details: z.string().max(1000).optional(),
    gst_logo: z.string().max(1_500_000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/).optional(),
    non_gst_logo: z.string().max(1_500_000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/).optional(),
    // Which company profile (GST or non-GST) a payment receipt was made under; receipts themselves stay non-GST.
    profile: z.enum(["TAXABLE", "OUTSIDE_GST"]).optional()
  }).optional(),
  lines: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/),
    price: amount,
    taxRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
    hsn: z.string().max(12).optional()
  })).min(1).max(100)
});
const payment = z.object({
  direction: z.enum(["RECEIPT", "PAYMENT"]),
  date,
  partyId: z.string(),
  cashAccount: z.string(),
  amount,
  number: z.string().max(80).optional(),
  client: z.object({
    name: z.string().max(150).optional(),
    address: z.string().max(500).optional(),
    gstin: z.string().max(15).optional(),
    contactName: z.string().max(150).optional(),
    phone: z.string().max(30).optional()
  }).optional(),
  description: z.string().min(2).max(300),
  // An INR document is settled by `amount`; a foreign-currency invoice by `foreignAmount` in its own currency.
  allocations: z.array(z.object({ documentId: z.string(), amount: amount.optional(), foreignAmount: amount.optional() })).max(100),
  // Receipts: TDS the client deducted. The money received is `amount`; the invoices settled may total amount + TDS.
  tdsAmount: amount.optional(),
  // Vendor payments: TDS we deducted. `amount` is the net paid from the bank; the bills settled may total amount + TDS.
  tds: z.object({
    section: z.enum(TDS_SECTIONS),
    rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, "TDS rate is a percentage with at most four decimals."),
    amount
  }).optional()
}).refine(b => b.direction === "RECEIPT" ? !b.tds : b.tdsAmount === undefined, "TDS fields do not match the payment direction.");
const tdsDeposit = z.object({
  date,
  cashAccount: z.string(),
  amount,
  section: z.enum(TDS_SECTIONS),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM."),
  challan: z.string().trim().min(3).max(60),
  description: z.string().max(300).optional()
});
const exchangeRate = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/, "Exchange rate: INR per unit with at most six decimals.");
const returnPeriod = z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/, "Return period must be MMYYYY.");
function actor(req: any) {
  return req.user;
}
@Controller("api")
export class ApiController {
  constructor(
  @Inject("DB")
  private db: Database) { }
  @Get("health")
  health() {
    return { ok: true, service: "company-accounts" }
  }
  @Get("auth/mode")
  mode() {
    return { demoLogin: process.env.DEV_DEMO_LOGIN === "1" && process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true" }
  }
  @Post("auth/login")
  async signin(
    @Body()
  body: unknown,
    @Res({ passthrough: true })
  res: Response
  ) {
    const b = z.object({ email: z.email(), password: z.string().min(1).max(256) }).parse(body);
    const u = await one(this.db, "SELECT * FROM users WHERE lower(email)=$1 AND active=true", [b.email.toLowerCase()]);
    need(u && verifyPassword(b.password, u.password_hash), "Email or password is incorrect.", 401);
    return login(this.db, res, u);
  }
  @Post("auth/demo")
  async demo(
  @Res({ passthrough: true })
  res: Response) {
    need(this.mode().demoLogin, "Demo login is disabled.", 404);
    const u = await one(this.db, "SELECT * FROM users WHERE role='ADMIN' AND active=true LIMIT 1");
    return login(this.db, res, u);
  }
  @Get("auth/me")
  me(
  @Req()
  req: any) {
    const { csrf, ...user } = req.user;
    return { user, csrf };
  }
  @Post("auth/logout")
  async logout(
    @Req()
  req: Request,
    @Res({ passthrough: true })
  res: Response
  ) {
    await this.db.query("DELETE FROM sessions WHERE id=$1", [digest(tokenFrom(req) || "")]);
    res.clearCookie("accounts_session", { path: "/" });
    return { ok: true };
  }
  @Get("overview")
  overview(
  @Query()
  raw: any) {
    const now = businessToday();
    const f = z.object({
      from: date.default(now.slice(0, 7) + "-01"),
      to: date.default(now),
      partyId: z.string().optional(),
      projectId: z.string().optional(),
      account: z.string().optional()
    }).parse(raw);
    need(f.from <= f.to, "Start date must precede the end date.");
    return getReport(this.db, f);
  }
  @Post("parties")
  async party(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      name: z.string().min(2).max(150),
      contactName: z.string().max(150).optional().default(""),
      email: z.union([z.email(), z.literal("")]).default(""),
      phone: z.string().max(30).default(""),
      address: z.string().max(500).default(""),
      gstin: z.string().max(15).nullable().optional(),
      kind: z.enum(["CLIENT", "VENDOR", "BOTH"]),
      voucherCategoryKind: z.enum(["INCOME", "CAPITAL_IN", "CAPITAL_RETURN", "REIMBURSEMENT", "LOAN_IN", "LOAN_REPAY"]).optional()
    }).parse(raw);
    b.gstin = b.gstin?.trim().toUpperCase() || null;
    need(!b.gstin || GSTIN_FORMAT.test(b.gstin), "GSTIN must be a valid 15-character GSTIN, or left blank.");
    return this.db.tx(async q => {
      if (b.voucherCategoryKind) {
        // Tagging an existing contact for another category (e.g. an owner who both invests and claims reimbursements) avoids duplicates.
        const existing = await one(q, "SELECT id,voucher_category_kind FROM parties WHERE lower(trim(name))=lower(trim($1)) ORDER BY created_at LIMIT 1 FOR UPDATE", [b.name]);
        if (existing) {
          const tags = String(existing.voucher_category_kind || "").split(",").filter(Boolean);
          if (!tags.includes(b.voucherCategoryKind))
            await q.query("UPDATE parties SET voucher_category_kind=$2 WHERE id=$1", [existing.id, [...tags, b.voucherCategoryKind].join(",")]);
          await audit(q, actor(req), "party.tag", existing.id, { voucherCategoryKind: b.voucherCategoryKind });
          return { id: existing.id };
        }
      }
      const pid = id();
      await q.query(
        "INSERT INTO parties(id,name,email,phone,address,gstin,kind,contact_name,voucher_category_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [pid, b.name, b.email, b.phone, b.address, b.gstin || null, b.kind, b.contactName, b.voucherCategoryKind || ""]
      );
      await audit(q, actor(req), "party.create", pid);
      return { id: pid };
    });
  }
  @Post("accounts")
  async account(
  @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      name: z.string().min(2).max(150),
      kind: z.enum(["EXPENSE", "ASSET"]),
      voucherCategoryKind: z.enum(["EXPENSE", "ASSET", "INVESTMENT"]).optional().default("EXPENSE")
    }).parse(raw);
    return this.db.tx(async q => {
      need((b.voucherCategoryKind === "EXPENSE" && b.kind === "EXPENSE") || (["ASSET", "INVESTMENT"].includes(b.voucherCategoryKind) && b.kind === "ASSET"), "Category type does not match the account type.");
      // Each custom category owns a fixed code range, so it can never spill into another range or a system account.
      const [baseCode, lastCode] = b.voucherCategoryKind === "EXPENSE" ? [5800, 5999] : b.voucherCategoryKind === "ASSET" ? [1800, 1899] : [1900, 1999];
      await q.query("SELECT pg_advisory_xact_lock(hashtext('voucher-account-code'))");
      const row = await one(q, "SELECT MAX(code::integer) AS max_code FROM accounts WHERE code ~ '^[0-9]+$' AND code::integer BETWEEN $1 AND $2", [baseCode, lastCode]);
      const code = String(row?.max_code == null ? baseCode : Number(row.max_code) + 1);
      need(Number(code) <= lastCode, "No more account codes are available for this category.", 409);
      need(!(await one(q, "SELECT code FROM accounts WHERE lower(name)=lower($1)", [b.name])), "An account with this name already exists.", 409);
      await q.query("INSERT INTO accounts(code,name,kind,is_cash,voucher_category_kind) VALUES($1,$2,$3,false,$4)", [code, b.name, b.kind, b.voucherCategoryKind]);
      await audit(q, actor(req), "account.create", code, { kind: b.kind, voucherCategoryKind: b.voucherCategoryKind });
      return { code };
    });
  }
  @Post("projects")
  async project(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ name: z.string().min(2).max(150), partyId: optionalId, budget: amount.default("0") }).parse(raw);
    return this.db.tx(async q => {
      const pid = id();
      await q.query(
        "INSERT INTO projects(id,name,party_id,budget) VALUES($1,$2,$3,$4)",
        [pid, b.name, b.partyId || null, b.budget]
      );
      await audit(q, actor(req), "project.create", pid);
      return { id: pid };
    });
  }
  @Post("vouchers")
  async voucher(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = voucher.parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "voucher", b },
      q => postVoucher(q, actor(req), b)
    );
  }
  @Post("journals")
  async journal(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      date,
      description: z.string().min(3).max(300),
      partyId: optionalId,
      projectId: optionalId,
      lines: z.array(z.object({ account: z.string(), debit: amount.optional(), credit: amount.optional() })).min(2).max(100)
    }).parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "journal", b },
      q => writeJournal(q, actor(req), { ...b, kind: "JOURNAL" })
    );
  }
  @Post("vouchers/:id/reverse")
  async reverse(
    @Req()
  req: any,
    @Param("id")
  eid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ date, reason: z.string().min(3).max(300) }).parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "reverse", eid, b },
      q => reverseJournal(q, actor(req), eid, b.date, b.reason)
    );
  }
  @Post("documents")
  async document(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = docSchema.parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "document", b },
      q => createDocument(q, actor(req), b)
    );
  }
  @Patch("documents/:id")
  async updateDocument(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = docSchema.parse(raw);
    return this.db.tx(q => updateDocument(q, actor(req), did, b));
  }
  @Post("documents/:id/issue")
  async issue(
  @Req()
  req: any,
  @Param("id")
  did: string,
  @Body()
  raw: unknown) {
    writer(actor(req));
    // Issuing is naturally idempotent (an issued document is returned as it is). A foreign-currency invoice takes its rate here.
    const b = z.object({ exchangeRate: exchangeRate.optional() }).parse(raw ?? {});
    return this.db.tx(q => issueDocument(q, actor(req), did, b));
  }
  @Post("documents/:id/debit-note")
  async debitNote(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      date,
      reason: z.string().min(3).max(300),
      lines: z.array(z.object({ line: z.number().int().min(0), quantity: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/) })).min(1).max(100)
    }).parse(raw);
    return idempotent(this.db, actor(req), req.headers["idempotency-key"], { op: "debit-note", did, b }, q => issueDebitNote(q, actor(req), did, b));
  }
  @Post("documents/:id/sales-debit-note")
  async salesDebitNote(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      date,
      dueDate: date.optional(),
      reason: z.string().min(3).max(300),
      lines: docSchema.shape.lines
    }).parse(raw);
    return idempotent(this.db, actor(req), req.headers["idempotency-key"], { op: "sales-debit-note", did, b }, q => issueSalesDebitNote(q, actor(req), did, b));
  }
  @Post("tds/deposit")
  async tdsDeposit(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = tdsDeposit.parse(raw);
    return idempotent(this.db, actor(req), req.headers["idempotency-key"], { op: "tds-deposit", b }, q => postTdsDeposit(q, actor(req), b));
  }
  // ---- GST returns: working drafts only. Nothing is sent to the GST portal. ----
  @Get("gst-returns")
  async gstReturns(
  @Query()
  raw: any) {
    const { period } = z.object({ period: returnPeriod }).parse(raw);
    return buildGstReturns(this.db, period);
  }
  // Records that a return was filed on the portal (by the user, outside this app), optionally locking the month.
  @Post("gst-filings")
  async gstFiling(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({
      period: returnPeriod,
      returnType: z.enum(["GSTR1", "GSTR3B"]),
      arn: z.string().trim().regex(/^[A-Z0-9]{10,20}$/i, "Enter the ARN shown on the portal acknowledgement (letters and digits)."),
      filedOn: date,
      lockPeriod: z.boolean().default(false)
    }).parse(raw);
    return this.db.tx(async q => {
      const { to } = periodRange(b.period);
      need(b.filedOn >= to.slice(0, 8) + "01", "The filing date cannot precede the return period.");
      need(!(await one(q, "SELECT id FROM gst_filings WHERE period=$1 AND return_type=$2", [b.period, b.returnType])), "This return is already recorded as filed for " + b.period + ".", 409);
      const fid = id();
      await q.query(
        "INSERT INTO gst_filings(id,period,return_type,arn,filed_on,filed_by) VALUES($1,$2,$3,$4,$5,$6)",
        [fid, b.period, b.returnType, b.arn.toUpperCase(), b.filedOn, actor(req).id]
      );
      await audit(q, actor(req), "gst.filed", fid, { period: b.period, returnType: b.returnType, arn: b.arn.toUpperCase(), text: (b.returnType === "GSTR1" ? "GSTR-1" : "GSTR-3B") + " filed for " + b.period });
      // Reuses the accounting period lock: it only ever moves forward here, never reopens an already locked period.
      if (b.lockPeriod) {
        const old = await one(q, "SELECT closed_through::text FROM company WHERE id='company' FOR UPDATE");
        if (!old.closed_through || old.closed_through < to) {
          await q.query("UPDATE company SET closed_through=$1 WHERE id='company'", [to]);
          await audit(q, actor(req), "period.lock", "company", { previous: old.closed_through, through: to, reason: "GST return filed for " + b.period });
        }
      }
      return { id: fid };
    });
  }
  @Get("documents/:id/einvoice")
  async einvoice(
  @Param("id")
  did: string) {
    const d = await one(this.db, "SELECT *,issue_date::text FROM documents WHERE id=$1", [did]);
    need(d, "Document not found.", 404);
    const company = await one(this.db, "SELECT * FROM company WHERE id='company'");
    need(company.einvoice_enabled, "Turn on “E-invoicing applicable” in Settings to prepare e-invoice JSON.", 409);
    return buildEinvoice(d, company);
  }
  @Post("documents/:id/irn")
  async irn(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      irn: z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "The IRN is a 64-character hexadecimal value."),
      ackNo: z.string().trim().regex(/^\d{1,20}$/, "The acknowledgement number is numeric."),
      ackDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, "Enter the acknowledgement date as YYYY-MM-DD HH:MM:SS."),
      // The signed QR code is a JWS token returned by the IRP; it is printed as a QR image on the invoice.
      signedQr: z.string().trim().min(20).max(4000).regex(/^[\x21-\x7e]+$/, "Paste the signed QR code text exactly as returned (no spaces).")
    }).parse(raw);
    return this.db.tx(q => recordEinvoice(q, actor(req), did, b));
  }
  @Post("documents/:id/credit-note")
  async creditNote(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      date,
      reason: z.string().min(3).max(300),
      lines: z.array(z.object({ line: z.number().int().min(0), quantity: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/) })).min(1).max(100)
    }).parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "credit-note", did, b },
      q => issueCreditNote(q, actor(req), did, b)
    );
  }
  @Post("documents/:id/cancel")
  async cancel(
    @Req()
  req: any,
    @Param("id")
  did: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ date, reason: z.string().min(3).max(300) }).parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "cancel", did, b },
      q => cancelDocument(q, actor(req), did, b)
    );
  }
  @Get("documents/:id")
  async getDocument(
  @Param("id")
  did: string) {
    const d = await one(this.db, "SELECT *,issue_date::text,due_date::text FROM documents WHERE id=$1", [did]);
    need(d, "Document not found.", 404);
    // paid = everything that settled the document; credited = the part settled by credit notes rather than money.
    const paid = await one(
      this.db,
      "SELECT COALESCE(SUM(a.amount),0)::text AS paid,COALESCE(SUM(a.foreign_amount),0)::text AS foreign_paid,COALESCE(SUM(a.amount) FILTER (WHERE e.kind IN ('CREDIT_NOTE','DEBIT_NOTE')),0)::text AS credited FROM allocations a JOIN journal_entries e ON e.id=a.entry_id WHERE a.document_id=$1",
      [did]
    );
    const source = d.source_id ? await one(this.db, "SELECT number,kind,reference,issue_date::text FROM documents WHERE id=$1", [d.source_id]) : null;
    const companySnapshot = d.snapshot?.company || d.company_snapshot || {};
    const companyCurrent = await one(this.db, "SELECT * FROM company WHERE id='company'");
    return {
      ...d,
      paid: paid.paid,
      foreign_paid: paid.foreign_paid,
      credited: paid.credited,
      inr_total: d.total_inr ?? d.total,
      source_number: source?.number || null,
      source_kind: source?.kind || null,
      source_reference: source?.reference || null,
      source_date: source?.issue_date || null,
      company: {
        ...companyCurrent,
        ...companySnapshot,
        gst_logo: companySnapshot.gst_logo || companyCurrent.gst_logo,
        non_gst_logo: companySnapshot.non_gst_logo || companyCurrent.non_gst_logo
      },
      party: d.snapshot?.party || d.client_snapshot || await one(this.db, "SELECT * FROM parties WHERE id=$1", [d.party_id])
    };
  }
  @Get("receipts/:id")
  async receipt(
  @Param("id")
  eid: string) {
    const e = await one(
      this.db,
      "SELECT *,entry_date::text FROM journal_entries WHERE id=$1 AND kind IN ('RECEIPT','PAYMENT')",
      [eid]
    );
    need(e, "Receipt not found.", 404);
    const paid = await one(
      this.db,
      "SELECT COALESCE(SUM(l.debit+l.credit) FILTER (WHERE a.is_cash),0)::text AS amount,COALESCE(SUM(l.debit+l.credit) FILTER (WHERE l.account_code IN ($2,$3)),0)::text AS tds,COALESCE(SUM(l.credit-l.debit) FILTER (WHERE l.account_code IN ($4,$5)),0)::text AS fx FROM journal_lines l JOIN accounts a ON a.code=l.account_code WHERE l.entry_id=$1",
      [eid, TDS_RECEIVABLE, TDS_PAYABLE, FX_GAIN, FX_LOSS]
    );
    return {
      ...e,
      amount: paid.amount,
      // TDS withheld (by the client on a receipt, by us on a vendor payment) and any realised exchange gain (+) or loss (−).
      tds_amount: paid.tds,
      tds_detail: e.tds,
      fx_difference: paid.fx,
      gross_amount: new D(paid.amount).add(paid.tds).toFixed(2),
      company: e.snapshot?.company || await one(this.db, "SELECT * FROM company"),
      party: e.snapshot?.party || await one(this.db, "SELECT * FROM parties WHERE id=$1", [e.party_id]),
      allocations: (await this.db.query(
        "SELECT d.number,d.currency,a.amount::text,a.foreign_amount::text FROM allocations a JOIN documents d ON d.id=a.document_id WHERE a.entry_id=$1",
        [eid]
      )).rows
    };
  }
  @Post("documents/:id/convert")
  async convert(
    @Req()
  req: any,
    @Param("id")
  did: string
  ) { writer(actor(req)); return this.db.tx(async q => { const d = await one(q, "SELECT *,issue_date::text,due_date::text FROM documents WHERE id=$1 FOR UPDATE", [did]); need(
        d && ["QUOTATION", "PROFORMA"].includes(d.kind) && d.status !== "CANCELLED",
        "Only active quotations and proformas can be converted."
      ); const old = await one(q, "SELECT id,number FROM documents WHERE source_id=$1 AND kind='INVOICE' AND status<>'CANCELLED'", [did]); if (old)
    return old; const issueDate = businessToday(), c = d.client_snapshot || {}; return createDocument(
        q,
        actor(req),
        {
        kind: "INVOICE",
        partyId: d.party_id,
        projectId: d.project_id,
        // The invoice is raised now; keep the quotation's payment window rather than its validity date.
        date: issueDate,
        dueDate: addDays(issueDate, Math.max(0, daysBetween(d.issue_date, d.due_date))),
        taxTreatment: d.tax_treatment,
        taxReason: d.tax_reason,
        placeOfSupply: d.place_of_supply,
        interstate: d.interstate,
        currency: d.currency,
        paymentMethod: d.payment_method || undefined,
        client: { name: c.name, address: c.address, gstin: c.gstin ?? undefined, contactName: c.contact_name, phone: c.phone },
        company: d.company_snapshot || undefined,
        lines: d.lines,
        notes: d.notes,
        sourceId: did
      }
      ); }); }
  @Post("payments")
  async pay(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = payment.parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "payment", b },
      q => postPayment(q, actor(req), b)
    );
  }
  @Patch("company")
  async company(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({
      name: z.string().min(2).max(150),
      address: z.string().max(1000),
      addressLine2: z.string().max(500).optional().default(""),
      city: z.string().max(120).optional().default(""),
      stateName: z.string().max(120).optional().default(""),
      pinCode: z.string().max(20).optional().default(""),
      contactNumber: z.string().max(40).optional().default(""),
      gstin: z.union([z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/), z.literal("")]),
      stateCode: z.string().regex(/^\d{2}$/),
      accountHolderName: z.string().max(150).optional().default(""),
      bankName: z.string().max(150).optional().default(""),
      accountNumber: z.string().max(80).optional().default(""),
      ifscCode: z.string().max(20).optional().default(""),
      branchName: z.string().max(150).optional().default(""),
      bankDetails: z.string().max(1000).optional().default(""),
      gstLogo: z.string().max(1_500_000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/).optional().default(""),
      nonGstLogo: z.string().max(1_500_000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/).optional().default(""),
      nonGstName: z.string().max(150).optional().default(""),
      nonGstAddress: z.string().max(1000).optional().default(""),
      nonGstAddressLine2: z.string().max(500).optional().default(""),
      nonGstCity: z.string().max(120).optional().default(""),
      nonGstStateName: z.string().max(120).optional().default(""),
      nonGstStateCode: z.string().regex(/^$|^\d{2}$/).optional().default(""),
      nonGstPinCode: z.string().max(20).optional().default(""),
      nonGstContactNumber: z.string().max(40).optional().default(""),
      nonGstAccountHolderName: z.string().max(150).optional().default(""),
      nonGstBankName: z.string().max(150).optional().default(""),
      nonGstAccountNumber: z.string().max(80).optional().default(""),
      nonGstIfscCode: z.string().max(20).optional().default(""),
      nonGstBranchName: z.string().max(150).optional().default(""),
      nonGstBankDetails: z.string().max(1000).optional().default(""),
      terms: z.string().max(2000),
      // GST & compliance settings. Left out = unchanged, so an older form never clears them.
      tan: z.union([z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{4}\d{5}[A-Z]$/, "TAN must be 4 letters, 5 digits and a letter (e.g. TVDA12345B).")), z.literal("")]).optional(),
      lutNumber: z.string().trim().max(40).optional(),
      lutValidFrom: z.union([date, z.literal("")]).optional(),
      lutValidTo: z.union([date, z.literal("")]).optional(),
      b2clThreshold: amount.optional(),
      einvoiceEnabled: z.boolean().optional()
    }).parse(raw);
    need(!b.lutValidFrom || !b.lutValidTo || b.lutValidFrom <= b.lutValidTo, "The LUT validity end date cannot precede its start date.");
    need(b.b2clThreshold === undefined || new D(b.b2clThreshold).gt(0), "The B2CL threshold must be greater than zero.");
    return this.db.tx(async q => {
      await q.query(
        "UPDATE company SET tan=COALESCE($1,tan),lut_number=COALESCE($2,lut_number),lut_valid_from=CASE WHEN $3::text IS NULL THEN lut_valid_from ELSE NULLIF($3::text,'')::date END,lut_valid_to=CASE WHEN $4::text IS NULL THEN lut_valid_to ELSE NULLIF($4::text,'')::date END,b2cl_threshold=COALESCE($5::numeric,b2cl_threshold),einvoice_enabled=COALESCE($6::boolean,einvoice_enabled) WHERE id='company'",
        [b.tan ?? null, b.lutNumber ?? null, b.lutValidFrom ?? null, b.lutValidTo ?? null, b.b2clThreshold ?? null, b.einvoiceEnabled ?? null]
      );
      await q.query(
        "UPDATE company SET name=$1,address=$2,address_line2=$3,city=$4,state_name=$5,pin_code=$6,gstin=$7,state_code=$8,contact_number=$9,account_holder_name=$10,bank_name=$11,account_number=$12,ifsc_code=$13,branch_name=$14,bank_details=$15,terms=$16,gst_logo=$17,non_gst_logo=$18,non_gst_name=$19,non_gst_address=$20,non_gst_address_line2=$21,non_gst_city=$22,non_gst_state_name=$23,non_gst_state_code=$24,non_gst_pin_code=$25,non_gst_contact_number=$26,non_gst_account_holder_name=$27,non_gst_bank_name=$28,non_gst_account_number=$29,non_gst_ifsc_code=$30,non_gst_branch_name=$31,non_gst_bank_details=$32 WHERE id='company'",
        [
        b.name,
        b.address,
        b.addressLine2,
        b.city,
        b.stateName,
        b.pinCode,
        b.gstin || null,
        b.stateCode,
        b.contactNumber,
        b.accountHolderName,
        b.bankName,
        b.accountNumber,
        b.ifscCode,
        b.branchName,
        b.bankDetails,
        b.terms,
        b.gstLogo,
        b.nonGstLogo,
        b.nonGstName,
        b.nonGstAddress,
        b.nonGstAddressLine2,
        b.nonGstCity,
        b.nonGstStateName,
        b.nonGstStateCode,
        b.nonGstPinCode,
        b.nonGstContactNumber,
        b.nonGstAccountHolderName,
        b.nonGstBankName,
        b.nonGstAccountNumber,
        b.nonGstIfscCode,
        b.nonGstBranchName,
        b.nonGstBankDetails
      ]
      );
      await audit(q, actor(req), "company.update", "company");
      return { ok: true };
    });
  }
  @Post("period-close")
  async close(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({ through: date.nullable(), reason: z.string().min(3).max(300) }).parse(raw);
    return this.db.tx(async q => {
      const old = await one(q, "SELECT closed_through::text FROM company WHERE id='company' FOR UPDATE");
      await q.query("UPDATE company SET closed_through=$1 WHERE id='company'", [b.through]);
      await audit(
        q,
        actor(req),
        "period.lock",
        "company",
        { previous: old.closed_through, through: b.through, reason: b.reason }
      );
      return { ok: true };
    });
  }
  @Get("users")
  async users(
  @Req()
  req: any) {
    admin(actor(req));
    return (await this.db.query("SELECT id,name,email,role,active FROM users ORDER BY name")).rows;
  }
  @Post("users")
  async user(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({
      name: z.string().min(2).max(100),
      email: z.email(),
      password: z.string().min(12).max(256),
      role: z.enum(["ADMIN", "ACCOUNTANT", "VIEWER"])
    }).parse(raw);
    return this.db.tx(async q => {
      const uid = id();
      await q.query(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [uid, b.name, b.email.toLowerCase(), hashPassword(b.password), b.role]
      );
      await audit(q, actor(req), "user.create", uid, { role: b.role });
      return { id: uid };
    });
  }
  @Post("budgets")
  async budget(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), account: z.string(), amount }).parse(raw);
    return this.db.tx(async q => {
      need(
        (await one(q, "SELECT kind FROM accounts WHERE code=$1", [b.account]))?.kind === "EXPENSE",
        "Budget must use an expense account."
      );
      await q.query(
        "INSERT INTO budgets(id,month,account_code,amount) VALUES($1,$2,$3,$4) ON CONFLICT(month,account_code) DO UPDATE SET amount=excluded.amount",
        [id(), b.month, b.account, b.amount]
      );
      await audit(q, actor(req), "budget.save", b.month + ":" + b.account);
      return { ok: true };
    });
  }
  @Post("recurring")
  async recurring(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      name: z.string().min(2).max(150),
      kind: z.enum(["INCOME", "EXPENSE"]),
      account: z.string(),
      cashAccount: z.string(),
      amount,
      day: z.number().int().min(1).max(28)
    }).parse(raw);
    return this.db.tx(async q => {
      need(new D(b.amount).gt(0), "Amount must be positive.");
      need(
        (await one(q, "SELECT kind FROM accounts WHERE code=$1", [b.account]))?.kind === b.kind,
        "Account category mismatch."
      );
      need(
        (await one(q, "SELECT is_cash FROM accounts WHERE code=$1", [b.cashAccount]))?.is_cash,
        "Choose a bank account."
      );
      const rid = id();
      await q.query(
        "INSERT INTO recurring_rules(id,name,kind,account_code,cash_account,amount,day) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [rid, b.name, b.kind, b.account, b.cashAccount, b.amount, b.day]
      );
      await audit(q, actor(req), "recurring.create", rid);
      return { id: rid };
    });
  }
  @Post("recurring/:id/confirm")
  async confirmRecurring(
    @Req()
  req: any,
    @Param("id")
  rid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(raw);
    return this.db.tx(async q => {
      const r = await one(q, "SELECT * FROM recurring_rules WHERE id=$1 AND active=true FOR UPDATE", [rid]);
      need(r, "Recurring entry not found.");
      need(
        !(await one(q, "SELECT id FROM recurring_occurrences WHERE rule_id=$1 AND month=$2", [rid, b.month])),
        "Already confirmed for this month.",
        409
      );
      const e = await postVoucher(
        q,
        actor(req),
        {
        kind: r.kind,
        account: r.account_code,
        cashAccount: r.cash_account,
        amount: r.amount,
        date: b.month + "-" + String(r.day).padStart(2, "0"),
        description: r.name + " · " + b.month
      }
      );
      await q.query(
        "INSERT INTO recurring_occurrences(id,rule_id,month,entry_id) VALUES($1,$2,$3,$4)",
        [id(), rid, b.month, e.id]
      );
      return e;
    });
  }
  @Post("bank/import")
  async bankImport(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) { writer(actor(req)); const b = z.object({
      account: z.string(),
      lines: z.array(z.object({
        date,
        reference: z.string().min(1).max(200),
        description: z.string().max(500),
        amount: z.string().regex(/^-?\d{1,13}(\.\d{1,2})?$/)
      })).min(1).max(2000)
    }).parse(raw); return this.db.tx(async q => { need(
        (await one(q, "SELECT is_cash FROM accounts WHERE code=$1", [b.account]))?.is_cash,
        "Choose a bank account."
      ); let added = 0; const occurrences = new Map<string, number>(); for (const l of b.lines) {
    need(!new D(l.amount).eq(0), "Bank amount cannot be zero.");
    // Repeated identical rows in one statement are distinct transactions; numbering them keeps re-imports idempotent.
    const key = [l.date, l.reference, new D(l.amount).toFixed(2)].join("|"), occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    added += (await q.query(
          "INSERT INTO bank_statement_lines(id,account_code,entry_date,reference,description,amount,occurrence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_code,reference,entry_date,amount,occurrence) DO NOTHING RETURNING id",
          [id(), b.account, l.date, l.reference, l.description, l.amount, occurrence]
        )).rows.length;
  } await audit(q, actor(req), "bank.import", b.account, { added, skipped: b.lines.length - added }); return { added, skipped: b.lines.length - added }; }); }
  @Post("bank/:id/match")
  async match(
    @Req()
  req: any,
    @Param("id")
  bid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ entryId: z.string() }).parse(raw);
    return this.db.tx(async q => {
      const line = await one(q, "SELECT * FROM bank_statement_lines WHERE id=$1 FOR UPDATE", [bid]);
      need(line && !line.matched_entry_id, "Choose an unmatched bank line.");
      const entry = await one(
        q,
        "SELECT e.id,e.reversal_of,(SELECT r.id FROM journal_entries r WHERE r.reversal_of=e.id) AS reversed_by FROM journal_entries e WHERE e.id=$1 FOR UPDATE",
        [b.entryId]
      );
      need(entry, "Entry not found.", 404);
      need(!entry.reversal_of && !entry.reversed_by, "Reversed entries and reversals cannot be matched to a bank line.");
      const sum = await one(
        q,
        "SELECT COALESCE(SUM(debit-credit),0)::text AS amount FROM journal_lines WHERE entry_id=$1 AND account_code=$2",
        [b.entryId, line.account_code]
      );
      need(new D(sum.amount).eq(line.amount), "Entry amount does not match this bank line.");
      need(
        !(await one(
        q,
        "SELECT id FROM bank_statement_lines WHERE matched_entry_id=$1 AND account_code=$2",
        [b.entryId, line.account_code]
      )),
        "Entry already matched for this account."
      );
      await q.query("UPDATE bank_statement_lines SET matched_entry_id=$1 WHERE id=$2", [b.entryId, bid]);
      await audit(q, actor(req), "bank.match", bid, { entryId: b.entryId });
      return { ok: true };
    });
  }
  // ---- Editing and archiving masters. Issued documents keep their own snapshots, so edits never rewrite history. ----
  @Patch("parties/:id")
  async editParty(
    @Req()
  req: any,
    @Param("id")
  pid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      name: z.string().trim().min(2).max(150),
      contactName: z.string().max(150).default(""),
      email: z.union([z.email(), z.literal("")]).default(""),
      phone: z.string().max(30).default(""),
      address: z.string().max(500).default(""),
      gstin: z.string().trim().toUpperCase().max(15).default(""),
      kind: z.enum(["CLIENT", "VENDOR", "BOTH"]),
      archived: z.boolean().default(false)
    }).parse(raw);
    need(!b.gstin || GSTIN_FORMAT.test(b.gstin), "GSTIN must be a valid 15-character GSTIN, or left blank.");
    return this.db.tx(async q => {
      const old = await one(q, "SELECT * FROM parties WHERE id=$1 FOR UPDATE", [pid]);
      need(old, "Contact not found.", 404);
      if (old.kind !== b.kind && b.kind !== "BOTH") {
        // A contact with bills on the other side must stay usable for them.
        const other = b.kind === "CLIENT" ? "PURCHASE" : "INVOICE";
        need(
          !(await one(q, "SELECT id FROM documents WHERE party_id=$1 AND kind=$2 AND status<>'CANCELLED' LIMIT 1", [pid, other])),
          "This contact has " + (other === "PURCHASE" ? "vendor bills" : "invoices") + ". Use “Client & vendor” instead.",
          409
        );
      }
      await q.query(
        "UPDATE parties SET name=$2,contact_name=$3,email=$4,phone=$5,address=$6,gstin=$7,kind=$8,archived=$9 WHERE id=$1",
        [pid, b.name, b.contactName, b.email, b.phone, b.address, b.gstin || null, b.kind, b.archived]
      );
      const changed = ["name", "contact_name", "email", "phone", "address", "gstin", "kind", "archived"]
        .filter(k => String(old[k] ?? "") !== String(({ ...b, contact_name: b.contactName, gstin: b.gstin || null } as any)[k] ?? ""));
      await audit(q, actor(req), b.archived && !old.archived ? "party.archive" : !b.archived && old.archived ? "party.restore" : "party.update", pid, { changed });
      return { id: pid };
    });
  }
  @Patch("projects/:id")
  async editProject(
    @Req()
  req: any,
    @Param("id")
  pid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({ name: z.string().trim().min(2).max(150), partyId: optionalId, budget: amount.default("0"), archived: z.boolean().default(false) }).parse(raw);
    return this.db.tx(async q => {
      const old = await one(q, "SELECT * FROM projects WHERE id=$1 FOR UPDATE", [pid]);
      need(old, "Project not found.", 404);
      await q.query("UPDATE projects SET name=$2,party_id=$3,budget=$4,archived=$5 WHERE id=$1", [pid, b.name, b.partyId || null, b.budget, b.archived]);
      await audit(q, actor(req), b.archived && !old.archived ? "project.archive" : !b.archived && old.archived ? "project.restore" : "project.update", pid, { budget: b.budget });
      return { id: pid };
    });
  }
  // ---- Products & services master: defaults for document lines; documents copy the values, so later edits never change them. ----
  @Post("items")
  async createItem(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = itemSchema.parse(raw);
    return this.db.tx(async q => {
      need(!(await one(q, "SELECT id FROM items WHERE lower(name)=lower($1)", [b.name])), "An item with this name already exists.", 409);
      const iid = id();
      await q.query(
        "INSERT INTO items(id,name,description,hsn,unit,rate,tax_rate,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [iid, b.name, b.description, b.hsn, b.unit, b.rate, b.taxRate, b.kind]
      );
      await audit(q, actor(req), "item.create", iid, { name: b.name });
      return { id: iid };
    });
  }
  @Patch("items/:id")
  async editItem(
    @Req()
  req: any,
    @Param("id")
  iid: string,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = itemSchema.extend({ archived: z.boolean().default(false) }).parse(raw);
    return this.db.tx(async q => {
      const old = await one(q, "SELECT * FROM items WHERE id=$1 FOR UPDATE", [iid]);
      need(old, "Item not found.", 404);
      need(!(await one(q, "SELECT id FROM items WHERE lower(name)=lower($1) AND id<>$2", [b.name, iid])), "An item with this name already exists.", 409);
      await q.query(
        "UPDATE items SET name=$2,description=$3,hsn=$4,unit=$5,rate=$6,tax_rate=$7,kind=$8,archived=$9 WHERE id=$1",
        [iid, b.name, b.description, b.hsn, b.unit, b.rate, b.taxRate, b.kind, b.archived]
      );
      await audit(q, actor(req), "item.update", iid, { name: b.name, archived: b.archived });
      return { id: iid };
    });
  }
  // ---- User management and passwords ----
  @Patch("users/:id")
  async editUser(
    @Req()
  req: any,
    @Param("id")
  uid: string,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({ name: z.string().trim().min(2).max(100), role: z.enum(["ADMIN", "ACCOUNTANT", "VIEWER"]), active: z.boolean() }).parse(raw);
    return this.db.tx(async q => {
      await q.query("SELECT pg_advisory_xact_lock(hashtext('user-admins'))");
      const old = await one(q, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [uid]);
      need(old, "User not found.", 404);
      if (uid === actor(req).id)
        need(b.role === old.role && b.active, "You cannot change your own role or disable your own account.", 409);
      if (old.role === "ADMIN" && old.active && (b.role !== "ADMIN" || !b.active)) {
        const admins = await one(q, "SELECT COUNT(*)::int AS n FROM users WHERE role='ADMIN' AND active=true AND id<>$1", [uid]);
        need(admins.n > 0, "At least one active administrator is required.", 409);
      }
      await q.query("UPDATE users SET name=$2,role=$3,active=$4 WHERE id=$1", [uid, b.name, b.role, b.active]);
      // A disabled user is signed out everywhere at once.
      if (!b.active)
        await q.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(q, actor(req), !b.active && old.active ? "user.disable" : b.active && !old.active ? "user.enable" : "user.update", uid, { role: b.role, previousRole: old.role });
      return { id: uid };
    });
  }
  @Post("users/:id/password")
  async resetPassword(
    @Req()
  req: any,
    @Param("id")
  uid: string,
    @Body()
  raw: unknown
  ) {
    admin(actor(req));
    const b = z.object({ password: z.string().min(12).max(256) }).parse(raw);
    need(uid !== actor(req).id, "Use “Change my password” for your own account.", 409);
    return this.db.tx(async q => {
      const u = await one(q, "SELECT id FROM users WHERE id=$1 FOR UPDATE", [uid]);
      need(u, "User not found.", 404);
      await q.query("UPDATE users SET password_hash=$2 WHERE id=$1", [uid, hashPassword(b.password)]);
      await q.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await audit(q, actor(req), "user.password.reset", uid);
      return { ok: true };
    });
  }
  @Post("auth/password")
  async changePassword(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    const b = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).parse(raw);
    need(b.currentPassword !== b.newPassword, "Choose a new password that differs from the current one.");
    return this.db.tx(async q => {
      const u = await one(q, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [actor(req).id]);
      need(u && verifyPassword(b.currentPassword, u.password_hash), "Your current password is incorrect.", 400);
      await q.query("UPDATE users SET password_hash=$2 WHERE id=$1", [u.id, hashPassword(b.newPassword)]);
      // Keep this session; sign out every other device.
      await q.query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [u.id, digest(tokenFrom(req) || "")]);
      await audit(q, actor(req), "user.password.change", u.id);
      return { ok: true };
    });
  }
  // ---- Applying advances already received from clients / paid to vendors ----
  @Post("advances/apply")
  async advance(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      direction: z.enum(["RECEIPT", "PAYMENT"]),
      partyId: z.string(),
      date,
      description: z.string().max(300).optional(),
      allocations: z.array(z.object({ documentId: z.string(), amount })).min(1).max(100)
    }).parse(raw);
    return idempotent(
      this.db,
      actor(req),
      req.headers["idempotency-key"],
      { op: "advance", b },
      q => applyAdvance(q, actor(req), b)
    );
  }
  // ---- Attachments: bills, receipts and other evidence for documents and ledger entries ----
  @Get("attachments")
  async attachments(
    @Query()
  raw: any) {
    const b = z.object({ entityType: z.enum(["DOCUMENT", "ENTRY"]), entityId: z.string().min(1) }).parse(raw);
    return (await this.db.query(
      "SELECT a.id,a.file_name,a.content_type,a.size,a.created_at,u.name AS uploaded_by FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.entity_type=$1 AND a.entity_id=$2 ORDER BY a.created_at",
      [b.entityType, b.entityId]
    )).rows;
  }
  @Post("attachments")
  async upload(
    @Req()
  req: any,
    @Body()
  raw: unknown
  ) {
    writer(actor(req));
    const b = z.object({
      entityType: z.enum(["DOCUMENT", "ENTRY"]),
      entityId: z.string().min(1),
      fileName: z.string().min(1).max(200),
      contentType: z.enum(Object.keys(ATTACHMENT_TYPES) as [string, ...string[]]),
      data: z.string().min(1).max(Math.ceil(MAX_ATTACHMENT / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Attachment data must be base64.")
    }).parse(raw);
    const bytes = Buffer.from(b.data, "base64");
    need(bytes.length > 0 && bytes.length <= MAX_ATTACHMENT, "Attachments can be at most " + MAX_ATTACHMENT / 1024 / 1024 + " MB.");
    // Trust the file's own signature, not the browser-supplied type.
    need(ATTACHMENT_TYPES[b.contentType](bytes), "The file content does not match its type. Upload a PDF, PNG, JPEG or WebP file.");
    const fileName = b.fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "attachment";
    return this.db.tx(async q => {
      const target = b.entityType === "DOCUMENT"
        ? await one(q, "SELECT id FROM documents WHERE id=$1", [b.entityId])
        : await one(q, "SELECT id FROM journal_entries WHERE id=$1", [b.entityId]);
      need(target, "The document or entry to attach to was not found.", 404);
      const count = await one(q, "SELECT COUNT(*)::int AS n FROM attachments WHERE entity_type=$1 AND entity_id=$2", [b.entityType, b.entityId]);
      need(count.n < 20, "At most 20 attachments can be added to one record.", 409);
      const aid = id();
      await q.query(
        "INSERT INTO attachments(id,entity_type,entity_id,file_name,content_type,size,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [aid, b.entityType, b.entityId, fileName, b.contentType, bytes.length, bytes, actor(req).id]
      );
      await audit(q, actor(req), "attachment.add", aid, { entityType: b.entityType, entityId: b.entityId, fileName, size: bytes.length });
      return { id: aid, fileName };
    });
  }
  @Get("attachments/:id")
  async download(
    @Param("id")
  aid: string,
    @Res()
  res: Response) {
    const a = await one(this.db, "SELECT file_name,content_type,data FROM attachments WHERE id=$1", [aid]);
    need(a, "Attachment not found.", 404);
    const bytes = Buffer.from(a.data);
    res.setHeader("Content-Type", a.content_type);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(a.file_name));
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.end(bytes);
  }
  @Delete("attachments/:id")
  async removeAttachment(
    @Req()
  req: any,
    @Param("id")
  aid: string) {
    writer(actor(req));
    return this.db.tx(async q => {
      const a = await one(q, "SELECT id,entity_type,entity_id,file_name FROM attachments WHERE id=$1 FOR UPDATE", [aid]);
      need(a, "Attachment not found.", 404);
      await q.query("DELETE FROM attachments WHERE id=$1", [aid]);
      await audit(q, actor(req), "attachment.remove", aid, { entityType: a.entity_type, entityId: a.entity_id, fileName: a.file_name });
      return { ok: true };
    });
  }
}
const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const itemSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().max(500).default(""),
  hsn: z.string().trim().max(12).default(""),
  unit: z.string().trim().max(20).default(""),
  rate: amount.default("0"),
  taxRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine(v => Number(v) <= 100, "GST rate cannot exceed 100%.").default("18"),
  kind: z.enum(["SERVICE", "GOODS"]).default("SERVICE")
});
export const MAX_ATTACHMENT = 4 * 1024 * 1024;
const ATTACHMENT_TYPES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": b => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": b => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"
};
