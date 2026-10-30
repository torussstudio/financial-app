# Company Accounts — Development Blueprint
Version 1.1 • 27 October 2026

Status: requirements and implementation design. No application, database, tax filing integration or deployment has been created by this document.

## 1. Confirmed scope

Build a company accounting application with a Next.js frontend, separate Node.js backend and PostgreSQL database. Include every feature discussed: document templates, GST/non-GST handling, daily vouchers, income and expenses, capital contributions and returns, investments, client and expense reporting, recurring entries, receivables/payables, advances and partial payments, bank reconciliation, opening balances/import, project profitability, attachments, audit history, roles, period closing, backups, budgets, reminders and an advanced template editor.

Phases below define implementation order, not removed features.

Confirmed by the user: exactly one company, GST registered. GST and non-GST handling is for different transactions of that same company. Use one company profile, one accounting ledger and consolidated reports; do not build a company switcher or separate books for GST and non-GST transactions.

Proposed starting defaults, subject to configuration: INR base currency, English interface, Asia/Kolkata business timezone, April–March financial year, accrual accounting with a separate cash movement report, and Admin/Accountant/Viewer roles. The specific GST regime, registration details and supply types still need configuration. Company-scoped records remain useful for ownership and data integrity even though multiple companies are out of scope.

## 2. Navigation and functional requirements

| Section | Scope |
| --- | --- |
| Dashboard | Earned income, expenses, profit/loss, receipts, payments, cash/bank balances, outstanding receivables/payables, overdue alerts and comparative monthly charts. |
| Documents & Templates | Quotations, proforma invoices, invoices, applicable bills of supply, payment receipts, credit/debit notes, reusable layouts, PDF preview/export/print, branding, signature image, payment terms and bank details. |
| Daily Vouchers | Receipt, payment, sales, purchase, contra/transfer and journal entries; date, party, account, category, project, reference, description and attachment; searchable day book. |
| Income & Expenses | Categorised ledger views, bill entry, payment tracking, recurring drafts, receipts and supporting documents; optional client/project attribution. |
| Capital, Loans & Investments | Contributor/partner balances, contributions, withdrawals/returns, loans and principal repayments, interest separately, company investments and refunds/deposits. |
| Clients & Vendors | Contacts, address, tax details when applicable, opening balance, invoices/bills, allocations, advances, statement of account and ageing. |
| Projects | Client-linked projects, revenue and direct costs, profitability, explicit optional overhead allocation, project budgets and actuals. |
| Bank & Cash | Multiple bank accounts, cash book, petty cash, transfers, statement CSV import, matching and reconciliation status. |
| Reports | P&L, balance sheet, trial balance, general ledger, cash movement, receivables/payables ageing, client/vendor statements, project profitability, expense breakdown, capital and tax summaries. |
| Settings & Administration | Company profile, financial years, chart of accounts, categories, products/services, tax codes, numbering series, templates, users/roles, opening balances, period locks and backup settings. |

Report filters must combine, where meaningful: month, financial year, custom date range, client, vendor, project, expense category, account, GST treatment, document status and payment status. Clicking a chart segment should open its supporting entries.

Balances use an explicit “as of” date; movements and profit use a date range. Show the date basis on each report. Distinguish earned revenue, invoiced value and collected cash. Include the selected filters in exports.

## 3. Documents, templates and tax handling

### Document behaviour

- Separate document lists and configurable numbering series by document type and financial year.
- Quotation lifecycle: draft, issued, accepted/rejected/expired, superseded revision.
- Proforma is a payment request; it does not post earned revenue by itself.
- Convert a quotation or proforma into a draft invoice while preserving source references; prevent accidental duplicate conversion.
- Invoice lifecycle: draft, posted/issued, adjusted/reversed. Derive unpaid/part-paid/paid/overdue from allocations and due dates rather than an independently editable flag.
- Preserve issued document data and its template version so a later logo, address, item or template edit does not silently change historical PDFs.
- Link receipts to the payment event. Reprinting a receipt never creates another payment.
- Credit/debit notes reference affected documents and apply accounting/tax adjustments through the posting service.
- Keep a distinct advance-receipt workflow, including applicable tax treatment, rather than treating all receipts as ordinary invoice settlements.

### Template capabilities

Start with clean branded presets; include the advanced editor in the later phase. Allow controlled editing of logo, colours, typography, header/footer, columns, bank details, notes, terms and signatures. Financial totals and applicable required tax fields are computed/validated by the backend. Support long descriptions, multi-page documents, repeated table headers and page numbering.

### GST and non-GST

Use one GST-registered company profile. Provide All, GST and Non-GST document views, detailed tax-treatment filters and appropriate formats for the company's different transactions. All views read the same underlying documents and ledger. Tax treatment must follow the company's registration/regime and the transaction; do not implement an unrestricted switch that simply removes tax.

Model tax treatment explicitly: taxable, nil-rated, exempt, outside GST, zero-rated/export when applicable, and the relevant registration regime. These are not interchangeable. Customer GSTIN absence alone does not determine whether a supply attracts GST.

Keep accounting category and supply/tax treatment as separate fields. Pure cash capital contributions, loan-principal movements and transfers between the company's own accounts are non-supply money movements; exclude them from sales registers rather than labelling them as non-GST sales. Preserve the detailed treatment behind any simplified GST/Non-GST display filter.

| Screen behaviour | Confirmed design |
| --- | --- |
| Company settings | One GST-registered company; no company switcher. |
| Documents | All / GST / Non-GST views, with granular treatment and document-type filters. |
| Document creation | Select document type and transaction details; resolve applicable tax treatment, required fields and format. |
| Daily vouchers | One day book; category, party/project, account and relevant supply/tax treatment recorded independently. |
| Dashboard | Consolidated company figures by default; filter supporting transactions without creating separate financial books. |
| GST reports | Include the relevant supply/tax categories; reconcile to ledger accounts rather than bank inflows alone. |
| Client statements | One statement per client across applicable document types; invoices, payments, credits and outstanding balance remain linked. |

Store applicable company/recipient GSTIN, HSN/SAC, place of supply, inclusive/exclusive pricing, taxable value, effective tax rates and tax-component amounts. Configure CGST/SGST/UTGST/IGST as applicable, with effective-dated rules. A bill of supply must have its appropriate context and format; do not use that label for every non-GST commercial invoice.

Keep output GST, eligible input GST and non-recoverable tax separate in the ledger. Do not treat all tax charged on a purchase as eligible credit. Add TDS receivable/payable and settlement support if applicable so an invoice can be settled through cash plus withholding.

Tax summaries and accountant exports are included. Government portal filing, e-invoicing/IRN generation and other statutory API integrations remain conditional integration scope: determine applicability before launch and implement any legally necessary integration for the chosen deployment. A locally generated PDF alone is not a government e-invoice.

## 4. Shared accounting engine

All document, voucher and income/expense screens use one posting service and one double-entry general ledger. Screens can have different forms without keeping duplicate financial records.

### Required classifications

| Event | Default accounting direction |
| --- | --- |
| Earned service revenue | Income, with bank or receivable counterpart as appropriate. |
| Current-period rent/subscriptions/utilities | Expense; distinguish unpaid bills and prepaid portions. |
| Owner capital contribution | Equity increase, not operating income. |
| Owner capital return/withdrawal | Equity decrease, not operating expense; legal form governs available workflows. |
| Borrowing / principal repayment | Liability increase/decrease; interest accounted separately. |
| Company acquisition of an investment | Investment asset, not ordinary operating expense. |
| Refundable security deposit paid | Deposit asset. |
| Client advance before earning revenue | Advance liability, with applicable tax handling. |
| Transfer between own accounts | Asset-to-asset transfer; excluded from income and expense totals. |
| Fixed-asset purchase | Asset where appropriate; depreciation handled separately under configured policy. |

Investor funding is classified from its actual agreement as equity or debt. “Capital returned” means returned principal; investment returns such as interest or gains use different accounts.

### Posting rules

- Every posted journal balances: total debits equal total credits.
- Save source document, journal, allocations and audit event atomically.
- Use PostgreSQL exact decimal columns and decimal-safe backend arithmetic; no floating-point money calculations.
- Carry currency, precision and rounding policy explicitly; support only confirmed currencies.
- Generate document numbers safely under concurrency and retain cancelled/void references.
- Prevent duplicate payment/posting requests with idempotency keys and uniqueness constraints.
- Drafts are editable; posted records are corrected through traceable reversals/adjustments.
- Period locks apply in the backend to every write path, including imports and scheduled jobs.
- Restrict posting to the authenticated company and approved accounts/parties.
- Record issue date, accounting date, service period, due date and payment date separately where needed.
- Do not use a manually editable dashboard total or stored “client balance” as the accounting source of truth.

## 5. Important workflows

### Sales and payment

Quotation → accepted quotation → optional proforma → invoice → one or more payment allocations → receipt. Steps are optional where appropriate; direct invoicing is supported.

A payment may settle multiple invoices. One invoice may have multiple receipts. Excess payment remains an unapplied credit/advance; allocating it later does not create additional income. Refunds and credit notes must update the remaining balance consistently.

### Expense and payment

Enter vendor bill/expense → attach evidence → post → record payment or leave payable → reconcile with bank statement. A later payment settles the payable instead of creating the expense twice.

### Capital

Choose contributor, equity/debt classification, amount, bank/cash account, date and reference → post → update capital/loan ledger and cash movement. Contributions and returned principal stay outside operating P&L.

### Recurring entries

Schedules generate identifiable drafts for rent, subscriptions, retainers and other recurring items. Actual payments are confirmed separately. Each scheduled occurrence has a unique key to prevent duplicate generation.

### Bank reconciliation

Import statement with preview and mapping → deduplicate lines → suggest matches against existing ledger entries → user confirms matches → unresolved lines remain visible. Matching a bank line never silently reposts an already recorded payment. Support split payments, fees, partial and many-to-one matches.

### Budgeting and reminders

Budgets by month/category/project; compare actual posted amounts on a consistent basis. Show overdue/upcoming alerts in the app. External email/WhatsApp reminders need configured channels, recipients, schedules and templates; prevent duplicate sends and retain delivery history. No live external messaging is authorised merely by this blueprint.

## 6. Technical design

Frontend: Next.js App Router + TypeScript, Tailwind CSS, shadcn/ui, Recharts, server-side pagination and accessible forms/tables.

Backend: Node.js + NestJS + TypeScript, versioned REST API, central validation, authentication, permission checks, accounting services and OpenAPI documentation.

Data: PostgreSQL + Prisma migrations. Use explicit database constraints and transactions, including SQL migrations where ORM declarations are insufficient.

Files: private object storage for bill attachments and generated documents; PostgreSQL stores metadata. Authorise each download and use short-lived signed URLs where applicable.

Background processing: a worker for recurring drafts, PDF generation, imports and reminder jobs. Add a queue service when implementation needs it; do not prematurely split the accounting system into microservices.

Deployment: separate Next.js and API/worker runtimes plus managed PostgreSQL, private storage, HTTPS, secrets management, automated migrations and monitored backups. Hosting provider, costs and production domain are not selected.

Suggested workspace:
- apps/web — Next.js interface
- apps/api — NestJS modules and posting service
- apps/worker — scheduled/background jobs
- packages/contracts — shared API types and validation
- packages/database — Prisma schema and migrations
- docs — workflows, accounting decisions and deployment runbook

### Core data groups

| Group | Proposed entities |
| --- | --- |
| Organisation/access | companies, users, memberships, roles, permissions, financial_years, accounting_periods |
| Masters | accounts, parties, party_contacts, categories, projects, items, tax_codes, tax_rates |
| Documents | documents, document_lines, document_tax_lines, document_revisions, number_sequences, template_versions |
| Accounting | journal_entries, journal_lines, payment_allocations, opening_balance_batches |
| Bank/cash | bank_accounts, bank_imports, bank_statement_lines, reconciliation_matches |
| Funding | funding_agreements, investments, fixed_assets, asset_schedules; monetary movements remain ledger-backed |
| Operations | recurring_rules, recurring_occurrences, budgets, budget_lines, reminder_rules, notification_deliveries |
| Evidence/control | attachments, audit_events, idempotency_records, import_batches, import_rows, export_jobs |

Separate party types/roles so the same contact may be both a client and vendor. Include company scope in constraints/relationships to prevent cross-company references. Ledger lines must retain party/project/category links needed for reporting. Do not maintain independent capital balances that can drift from the ledger.

### Representative API groups

- /v1/auth and /v1/company
- /v1/parties, /v1/projects, /v1/accounts and /v1/items
- /v1/documents, /v1/documents/:id/post, /v1/documents/:id/pdf
- /v1/vouchers, /v1/vouchers/:id/post, /v1/vouchers/:id/reverse
- /v1/payments and /v1/payment-allocations
- /v1/bank-imports and /v1/reconciliations
- /v1/reports/* and /v1/dashboard
- /v1/recurring-rules, /v1/budgets and /v1/reminder-rules
- /v1/periods/:id/close and /v1/audit-events

Endpoints are proposed API contracts, not implemented services.

## 7. Access, reliability and operating controls

- Admin: company settings, user access, sensitive configuration and controlled period reopening.
- Accountant: permitted documents, vouchers, imports and reconciliation.
- Viewer: explicitly allowed reports/documents; no write operations.
- An optional approval threshold can require a second authorised user before posting selected entries.
- Enforce permissions on the server, including exports, attachment URLs and job execution.
- Use secure sessions, password hashing or a trusted identity provider, login rate limits and appropriate CSRF protection.
- Avoid financial/personal data in routine application logs.
- Retain audit events showing actor, action, timestamp, source and changes.
- Encrypt backups, define retention, and test restoration of both database and attachments.
- Import with column mapping, preview, validation, duplicate detection and an import audit trail.
- Begin with balanced opening entries covering cash, bank, receivables, payables, capital and other opening balances; reconcile before live use.

## 8. Build order — all features retained

| Phase | Deliverable and completion condition |
| --- | --- |
| 1. Foundation | Company/settings, login/roles, chart of accounts, schema/migrations, posting engine and opening balances. Ledger tests pass before financial reporting is trusted. |
| 2. Core daily use | Clients/vendors, daily vouchers, bills/expenses, receipts/payments, capital/loans, bank/cash and evidence attachments. Entries persist and balances reconcile. |
| 3. Documents | Branded quotation/proforma/invoice/receipt/note presets, GST/non-GST treatment, conversions, partial payments/advances and verified print/PDF output. |
| 4. Reporting | Dashboard, combined filters, monthly/client/category/project charts, ageing, P&L, balance sheet, trial balance, account statements and exports. |
| 5. Extended operations | Bank imports/reconciliation, recurring entries, project budgets, budget-vs-actual, reminder configuration and advanced template editing. |
| 6. Release readiness | Period closing, audit review, backup/restore drill, permission and concurrency testing, accountant validation, required tax integrations and production deployment. |

Audit recording, server permissions and backup design are foundational; the final phase verifies them rather than introducing them for the first time.

## 9. Acceptance scenarios

These are tests to implement, not test results.

1. Completed-service invoice of INR 10,000, receipt of INR 5,000: earned revenue is 10,000, collection is 5,000 and receivable is 5,000. Tax is omitted only to simplify this test.
2. Add owner capital of 100,000 and a current expense paid of 2,000 to scenario 1, starting with no balances: closing bank is 103,000; P&L profit is 8,000; receivable is 5,000. Assets of 108,000 equal capital 100,000 plus profit 8,000.
3. A bank-to-bank transfer changes each account balance but does not change total cash, revenue, expenses or profit.
4. An October earned invoice paid in November appears in October accrual income and November cash collections.
5. Quotation/proforma conversion and receipt printing do not produce duplicate revenue or payments.
6. Repeating a payment request with the same idempotency key produces one payment.
7. Concurrent issuance produces unique numbers. A failed posting leaves no partial source/journal/allocation records.
8. Credit notes, refunds, advances and withholding settle balances correctly and never count income twice.
9. GST/non-GST classifications, rounding, document labels and inclusive/exclusive prices match accountant-approved examples.
10. Locked periods reject changes through UI, API, imports and background tasks.
11. Every dashboard figure drills down to entries whose total matches the displayed amount and exported report.
12. Statement re-import does not duplicate lines; matching does not duplicate ledger entries.
13. A viewer cannot post, change permissions or obtain unauthorised files.
14. A restored backup reproduces balances and retains accessible supporting documents.
15. Issued PDFs retain their historical data/template version; multi-page line items remain readable without clipped totals.
16. GST and non-GST document views reconcile to the same company's consolidated ledger; tax-specific reports retain detailed classifications and exclude non-supply cash capital/loan/transfer movements from sales.

## 10. Configuration still to resolve

These items do not block planning or neutral UI design, but must be resolved before live company accounts are activated:

- Company legal name, legal form, address, logo and financial year.
- GSTIN, specific GST regime, state, actual supply types and applicable TDS/tax workflows. GST registration and single-company scope are already confirmed.
- Whether “panel quotation” needs special item specifications, measurements or a supplied quotation layout.
- Opening date and verified opening balances.
- Named users and actual role/approval requirements.
- Whether foreign currencies, branches, full payroll or inventory are required; these additional modules are not assumed.
- Hosting/domain, backup retention and recovery objectives.
- Approved document templates and any required tax filing/e-invoice integration.

## Reference basis

- [Next.js App Router](https://nextjs.org/docs/app)
- [NestJS documentation](https://docs.nestjs.com/)
- [PostgreSQL exact numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [IFRS Conceptual Framework — income, expenses and owner contributions/distributions](https://www.ifrs.org/content/dam/ifrs/meetings/2018/october/wss/wss5b-conceptual-framework.pdf)
- [CBIC sectoral FAQs — invoice/bill of supply distinction](https://cbic-gst.gov.in/hindi/sectoral-faq.html)

This blueprint defines software behaviour; applicable tax and accounting configurations must be validated for the actual company and launch date.

