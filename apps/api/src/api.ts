import { Controller, Get, Post, Patch, Body, Req, Res, Param, Query, Inject } from "@nestjs/common";
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
  businessToday,
  addDays,
  daysBetween
} from "./accounting.js";
import { writer, admin, verifyPassword, hashPassword, login, digest, tokenFrom } from "./auth.js";
import { getReport } from "./reports.js";
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
  kind: z.enum(["QUOTATION", "PROFORMA", "INVOICE", "BILL"]),
  number: z.string().min(1).max(80).optional(),
  partyId: z.string(),
  projectId: optionalId,
  date,
  dueDate: date,
  taxTreatment: z.enum(["TAXABLE", "NIL_RATED", "EXEMPT", "OUTSIDE_GST"]),
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
    non_gst_logo: z.string().max(1_500_000).regex(/^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/).optional()
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
  allocations: z.array(z.object({ documentId: z.string(), amount })).max(100)
});
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
  did: string) {
    writer(actor(req));
    return this.db.tx(q => issueDocument(q, actor(req), did));
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
      "SELECT COALESCE(SUM(a.amount),0)::text AS paid,COALESCE(SUM(a.amount) FILTER (WHERE e.kind='CREDIT_NOTE'),0)::text AS credited FROM allocations a JOIN journal_entries e ON e.id=a.entry_id WHERE a.document_id=$1",
      [did]
    );
    const source = d.source_id ? await one(this.db, "SELECT number,kind FROM documents WHERE id=$1", [d.source_id]) : null;
    const companySnapshot = d.snapshot?.company || d.company_snapshot || {};
    const companyCurrent = await one(this.db, "SELECT * FROM company WHERE id='company'");
    return {
      ...d,
      paid: paid.paid,
      credited: paid.credited,
      source_number: source?.number || null,
      source_kind: source?.kind || null,
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
      "SELECT COALESCE(SUM(l.debit+l.credit),0)::text AS amount FROM journal_lines l JOIN accounts a ON a.code=l.account_code WHERE l.entry_id=$1 AND a.is_cash=true",
      [eid]
    );
    return {
      ...e,
      amount: paid.amount,
      company: e.snapshot?.company || await one(this.db, "SELECT * FROM company"),
      party: e.snapshot?.party || await one(this.db, "SELECT * FROM parties WHERE id=$1", [e.party_id]),
      allocations: (await this.db.query(
        "SELECT d.number,a.amount::text FROM allocations a JOIN documents d ON d.id=a.document_id WHERE a.entry_id=$1",
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
      terms: z.string().max(2000)
    }).parse(raw);
    return this.db.tx(async q => {
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
}
