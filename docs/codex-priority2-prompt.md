# Task: Implement "Priority 2 — GST & compliance" in LedgerDesk

You are working in `company-accounts/`, an accounting app for ONE GST-registered Indian company (Kerala, state code 32 by default). Stack: Next.js 16 frontend (`apps/web`), NestJS API with raw parameterized SQL via `pg`/PGlite (`apps/api`), PostgreSQL. Read `README.md`, `STATUS.md` and `docs/Blueprint.md` first, then the files listed under "Where things live".

## Safety rules (read before running anything)

- `.env` points `DATABASE_URL` at a REAL PostgreSQL database. Do NOT run `npm run dev`, `npm run db:migrate` or anything else that connects to it. Do not edit `.env`.
- The API's `node --watch` restarts and runs the schema migration on startup. If a dev server is already running on ports 3000/4000, do not touch it.
- For manual testing, use an isolated embedded DB: start the API with `DEV_EMBEDDED_DB=1 DEV_EMBEDDED_DB_PATH=<temp dir> DEMO_MODE=true SEED_DEMO=true DEV_DEMO_LOGIN=1 ADMIN_EMAIL=demo@ledgerdesk.local ADMIN_PASSWORD=<random 24+ chars> API_PORT=4100`, and run the web app against it with `API_INTERNAL_URL=http://127.0.0.1:4100`.
- The project is not a git repository. Before changing anything, copy the source (excluding `node_modules`, `.next`, `apps/api/.data`, `dist`) to a backup folder outside the project.
- Schema changes must be additive and idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, constraint swaps guarded by `DO $$ … $$`. Append a `-- Version 4` block at the end of `apps/api/src/schema.sql` and record it with `INSERT INTO schema_versions(version) VALUES(4) ON CONFLICT DO NOTHING`. Never drop or rewrite existing data.

## Non-negotiable accounting conventions (already in the codebase — follow them)

- Double entry only through `writeJournal()` in `apps/api/src/accounting.ts`. Every journal balances. Every line has exactly one positive side. Skip zero-amount lines.
- Money is `decimal.js` (`D`) on the server and `numeric(18,2)` in SQL. Never use floats for money on the server.
- Posted journals, journal lines, allocations and audit events are immutable (DB triggers). Correct through reversals, credit notes and debit notes, never through UPDATE/DELETE.
- `periodOpen()` is enforced inside `writeJournal()`. Do not bypass it.
- Every write endpoint does three things:
  - calls `writer()` or `admin()`;
  - validates input with zod;
  - runs in `db.tx`.
  Posting endpoints are additionally wrapped in `idempotent()` (`Idempotency-Key` header). Every write calls `audit()`.
- Documents keep frozen snapshots (`client_snapshot`, `company_snapshot`, `snapshot`). Never recompute an issued document from current master data.
- Outstanding balance = `total − SUM(allocations.amount)`. Settlement of any kind (cash, credit note, TDS, advance) is an allocation row tied to the settling journal entry.
- Existing account codes are seeded in `apps/api/src/bootstrap.ts` (`ON CONFLICT DO NOTHING`, so adding rows there reaches existing databases).
  - Codes 5800–5999, 1800–1899 and 1900–1999 are reserved for user-created categories.
  - Before adding a code, check that it is unused.
- Live (non-demo) companies are stricter than demo: see `checkLiveInvoice()`. Keep live-mode validation strict and leave demo permissive.

## Where things live

| Location | Contents |
| --- | --- |
| `apps/api/src/accounting.ts` | Posting service: documents (QUOTATION, PROFORMA, INVOICE, BILL = non-GST payment receipt, CREDIT_NOTE, PURCHASE = vendor bill); `postPayment` (RECEIPT/PAYMENT with multi-allocation and advances to 2300/1300); `applyAdvance`; `issueCreditNote`; `cancelDocument`; `taxLines()` (CGST/SGST split per line, IGST when interstate; `OUTPUT_TAX` 2100/2110/2120, `INPUT_TAX` 1200/1210/1220) |
| `apps/api/src/api.ts` | Nest controller with all endpoints |
| `apps/api/src/reports.ts` | `getReport()`, the single overview payload the UI uses |
| `apps/api/test/*.test.ts` | `node:test` with an in-memory PGlite DB. Tests call accounting functions directly or `new ApiController(db)` with `req = { user: actor, headers: {} }`. Use `purchases-masters.test.ts` as the pattern |
| `apps/web/app/page.tsx` | App state, `open()`, `submit()` (switch on `modal.type`), `perform()`, and the `entryModalContext` / `pageContext` objects passed down |
| `apps/web/components/modals/workspace-entry-modal.tsx` | All dialog forms. `AllocationTable` and `AttachmentsPanel` live beside it |
| `apps/web/features/*/page.tsx` | Pages |
| `apps/web/components/financial-views.tsx` | `Report` (P&L, trial balance, balance sheet, ageing, payables ageing, GST summary with ITC) and `DocumentPreview` (printable documents) |
| `apps/web/components/layout/sidebar.tsx` | Navigation |
| `apps/web/app/globals.css` | Styles. Reuse existing classes (`panel`, `kpi-grid`, `form-grid`, `form-note`, `tabs`, `table-scroll`, `check-field`, `allocation-*`) |

## Features to build (in this order)

### 1. TDS (Income-tax withholding) on receipts and payments

**Settings.** Add the company TAN (optional, format `^[A-Z]{4}\d{5}[A-Z]$`) to company settings.

**New accounts:**
- `1250 TDS receivable` (ASSET)
- `2400 TDS payable` (LIABILITY)

Confirm both codes are free first.

**Receipts (client deducted TDS).** Add an optional `tdsAmount` to receipt payments. The allocated total may equal cash + TDS. Posting:
- Dr bank (cash)
- Dr 1250 (TDS)
- Cr 1100 (allocated)
- Cr 2300 for any remainder

TDS must be > 0 only when at least one invoice is allocated, and it cannot exceed the allocated amount.

**Vendor payments (we deduct TDS).** Add an optional `tds: { section, rate, amount }` with sections `194C`, `194J`, `194I`, `194H`, `194Q` and `OTHER`. Posting:
- Dr 2000 (gross allocated)
- Cr bank (net)
- Cr 2400 (TDS)

Store the section, rate and amount on the journal entry. Add a `tds` jsonb column on `journal_entries`, or a `tds_deductions` table referencing the entry. Choose one and explain why in a comment.

**Deposit to government.** Add a "TDS deposit" voucher kind (Dr 2400 / Cr bank) with challan number and period (YYYY-MM).

**Reports:**
- TDS receivable by client, for reconciling with Form 26AS.
- TDS payable by section and month: deducted, deposited and due.

**UI.** Add TDS fields to the receipt and vendor-payment dialogs, and show the net bank amount live. Payment and receipt print views show the TDS line.

**Reversal.** Reversing a receipt or payment reverses its TDS lines automatically through `postReversal`. Add a test for this.

### 2. Debit notes

**Purchase debit note** (goods returned, or the vendor overbilled). Issue it against a posted `PURCHASE`, line-quantity based like `issueCreditNote`. Posting:
- Dr 2000 (total)
- Cr the bill's expense/asset account (subtotal)
- Cr input tax (reverse ITC, using the bill's interstate split), only if the bill claimed ITC; otherwise the whole amount credits the expense account

It settles the bill through an allocation. It cannot exceed the bill's outstanding balance. Kind: `DEBIT_NOTE`, prefix `DN`, with `source_id` pointing at the bill.

**Sales debit note** (an invoice was under-charged). Issue it against an issued `INVOICE` with new lines. Posting:
- Dr 1100
- Cr 4000
- Cr output tax

It becomes its own receivable document (kind `SALES_DEBIT_NOTE`, prefix `SDN`) that receipts can be allocated to.

**Shared requirements:**
- Use separate number series per kind and financial year (see `nextFreeNumber`).
- Show both note types in the GST summary with the correct sign.
- Add printable previews.

### 3. Reverse charge (RCM) on vendor bills

**Bill flag.** Add `reverse_charge boolean` to vendor bills. The supplier charges no GST, but the company owes it.

**New accounts:**
- `2130 RCM CGST payable`
- `2140 RCM SGST payable`
- `2150 RCM IGST payable`

**Posting** (rates entered per line):
- Dr expense (taxable value)
- Dr input tax (if ITC eligible; otherwise add the tax to the expense)
- Cr 2000 (taxable value only)
- Cr RCM payable (tax)

**Self-invoice.** A bill from an unregistered supplier under RCM gets a self-invoice number (series `SI`) assigned on posting.

**Reporting.** RCM liability appears in GSTR-3B 3.1(d), and its ITC in 4(A)(3).

### 4. Zero-rated / export invoices and multi-currency posting

**Tax treatment.** Add `ZERO_RATED` with sub-type `LUT` (no IGST charged) or `WITH_IGST` (IGST charged, refund route). Add the company LUT/ARN number and its validity to settings.
- A LUT export requires the LUT number to be set when issuing in live mode.
- `ZERO_RATED` must be a distinct treatment everywhere: filters, reports and preview labels ("Supply meant for export under LUT without payment of IGST").

**Foreign-currency invoices.** Today these cannot be issued. Allow issue with an `exchange_rate` (INR per unit, up to 6 decimals) entered on issue.
- Store the INR equivalents: `subtotal_inr`, `tax_inr`, `total_inr`.
- The journal posts in INR.
- Outstanding and allocations for foreign invoices are tracked in INR.
- The preview shows both currencies.

**Foreign receipts.** A receipt against a foreign invoice takes the foreign amount received and the INR credited to the bank.
- The difference between INR received and the invoice INR carrying amount for the settled portion is posted to:
  - `4200 Foreign exchange gain` (INCOME), or
  - `5700 Foreign exchange loss` (EXPENSE).
  Check that both codes are free.
- Use exact decimal math for this.
- Add tests for gain, loss and a partial receipt.

### 5. GSTR-1 and GSTR-3B working exports (no portal filing)

Add a "GST returns" tab under Reports with a month picker (return period `MMYYYY`).

**GSTR-1 sections**, built from issued documents dated in that month:
- B2B: invoices to GSTIN holders, invoice-wise, rate-wise
- B2CL: inter-state B2C invoices above the configured B2CL threshold; keep the threshold a setting, defaulting to 2,50,000
- B2CS: other B2C, aggregated by place of supply and rate
- EXP: zero-rated exports, split WPAY/WOPAY
- CDNR / CDNUR: credit notes and sales debit notes
- NIL: nil-rated, exempt and non-GST outward supplies, split inter/intra and registered/unregistered
- HSN summary: HSN-wise quantity, taxable value and tax; separate B2B and B2C tables
- Documents issued: series, from, to, total, cancelled

**GSTR-3B summary:**
- 3.1(a) outward taxable
- 3.1(b) zero-rated
- 3.1(c) nil/exempt
- 3.1(d) inward RCM
- 3.1(e) non-GST
- 4(A) ITC available: from vendor bills and RCM, less purchase debit notes
- 4(B) ITC reversed/ineligible: blocked bills
- 5 exempt inward
- Net tax payable working, per head (IGST/CGST/SGST), applying the GST set-off order (IGST credit first against IGST, then CGST, then SGST; CGST credit cannot be used against SGST and vice versa)

**Exports.** Offer downloads as CSV per section, plus one JSON file shaped like the GSTN offline-tool GSTR-1 JSON (`gstin`, `fp`, `b2b[].ctin`, `inv[].inum`, `idt`, `val`, `pos`, `rchrg`, `itms[].itm_det{txval, rt, iamt, camt, samt, csamt}`, and so on).
- Put the whole field mapping in ONE module (`apps/api/src/gst-returns.ts`), with comments citing the field names.
- If you are not certain of an exact GSTN field or format, say so in a comment and in the UI. Do not invent certainty.
- Every export carries a visible "Working draft for accountant review — not filed" note.

**Locking.** Optionally lock a filed month. Reuse the period lock, and record "GSTR-1 filed for MMYYYY" with the ARN in a new `gst_filings` table (period, return type, ARN, filed_on, filed_by). Show a warning before editing anything dated in a filed period.

**Tests:** build fixtures covering every section and assert totals, including credit-note netting and rounding.

### 6. E-invoice readiness (preparation only, NO government API calls)

- Add a company setting "E-invoicing applicable" (boolean).
- When it is on, B2B invoices can export the IRP JSON (schema version 1.1 fields: `Version`, `TranDtls`, `DocDtls`, `SellerDtls`, `BuyerDtls`, `ItemList`, `ValDtls`) for upload through the portal or a GSP.
- Store `irn`, `ack_no`, `ack_date` and `signed_qr` (text) entered or pasted back by the user. They are immutable once set; correcting them requires cancelling and re-issuing.
- The invoice preview prints the IRN, the ack number and a QR image rendered from `signed_qr`. Use an existing, well-known QR library pinned to an exact version, or a small vetted implementation.
- In live mode, issuing a B2B invoice while e-invoicing is on shows a warning (not a block) until the IRN is recorded.
- Do not implement any network call to the IRP or GSP.

## Acceptance criteria

- `npm test`, `npm run typecheck` and `npm run build` all pass from `company-accounts/`.
- Every new posting path has tests asserting exact journal lines (follow `entryLines()` in the existing tests).
- Every new posting path also has a reversal/cancellation test showing balances return to zero.
- The trial balance still balances after every scenario.
- Existing tests stay green. Change an existing test only when the behaviour change is intended, and explain the change in the test name.
- No float arithmetic for money on the server. UI previews may use the existing cent-rounding helpers.
- `STATUS.md` is updated: move the delivered items out of "Remaining work" and list what is still missing.
- Finish with a short report:
  - what was built;
  - new account codes and tables;
  - which GSTN/IRP field mappings you are unsure of;
  - anything you skipped and why.

## Out of scope

- Filing on the GST portal.
- Any calls to GSTN, IRP or GSP APIs.
- E-way bills.
- Payroll.
- Inventory.
- Changes to authentication.
