# Development status — v0.1

Single-company scope is retained. This milestone supplies working core screens and accounting transactions; it is not the completed product or a production launch.

| Area | Available in this build | Remaining work |
| --- | --- | --- |
| Dashboard | Ledger-derived KPIs; monthly chart; expense chart; date/client filters | Saved views and larger-data performance testing |
| Documents | Quotation, proforma, invoice, payment receipt and credit note documents; draft edit and cancellation; tax-treatment filters; source conversion; preview/print | Advanced template editor; logo/signature; discount/rounding options; custom panel quotation layout |
| GST | Demo output tax calculations; intra/inter-state components; specific non-taxable reasons; draft/issued labels | Company-specific tax validation; compliant live issuance; GST purchase/ITC; reverse charge; compliant live credit notes; debit notes; return exports/filing; e-invoice/e-way bill where applicable |
| Daily vouchers | Income, expense, capital in/return, investment, loans, transfers; balanced journal API | Friendly journal line editor; bulk imports; custom chart-of-accounts UI; approval queue |
| Ledger integrity | Decimal arithmetic; atomic postings; retry keys; balanced SQL constraints; immutable posted records; ordinary voucher reversals | Concurrent-request/load tests on server PostgreSQL; restricted DB roles; full versioned migration tooling |
| Payments | Partial allocation; outstanding balances; receipt reversal (re-opens the invoice balance); receipt/payment print view; frozen party/company snapshots | Vendor bills and vendor payments against them; apply existing advances later; vendor advances; refund payments; multi-invoice allocation UI |
| Contacts/projects | Create/list contacts; client activity; project revenue, direct cost and profit | Contact/project edit/archive; complete statement exports; shared-overhead allocation |
| Reports | P&L, trial balance, balance sheet, ageing, output-tax working summary | Full paginated exports; formal cash-flow statement; accountant sign-off |
| Capital | Owner capital, returns, loan principal and investments separated from operating profit | Owner-wise balances; investment sales/returns; interest schedules |
| Bank | Statement CSV paste/import; dedupe; one-to-one exact-value matching | File upload parser; split/combined matching; unmatch workflow; bank feeds |
| Recurring | Expense schedule UI; income/expense API; explicit monthly confirmation | Edit/pause UI; background schedule worker; notifications |
| Budgets | Monthly expense budgets versus selected-period actuals | Budget revisions/history; forecast views |
| Access/control | Administrator/accountant/viewer; hashed-password sessions; CSRF; audited period closing | Password reset/change; user disable/edit; MFA; distributed rate limits; production security review |
| Opening balances | Balanced journal entry facility | Guided opening-balance importer; historical invoice allocation migration |
| Attachments | Not implemented | Receipt/bill uploads, storage, access controls and scanning |
| Audit/backups | Append-only audit events; manual backup instructions | Automated encrypted backups, restore drill, audit export/retention |
| Reminders | Outstanding-invoice screen | Email/WhatsApp integrations and scheduled reminder sending |
| Deployment | Source, lockfile, Dockerfiles and PostgreSQL Compose configuration | Actual PostgreSQL/Docker integration run, staging deployment, HTTPS and operational monitoring |

## Current boundaries

- Live invoice issuance is blocked when the company is not a demo. Do not bypass this guard as a shortcut to production. Complete and test the actual tax/document requirements first.
- Preview invoices are watermarked and use fictional data. The output-tax report is a working summary, not a filed return or net tax-payable report.
- The `BILL` document type is the non-GST **Payment Receipt**: issuing it posts the amount received to Petty cash (Cash) or Operating bank (Bank Transfer/Cheque) against the chosen income account. Vendor bills, GST purchase/ITC posting and vendor payments against bills are not implemented; record vendor payments as expense vouchers. Payment receipts issued by earlier builds were posted as Rent expense / Accounts payable and need an accountant-reviewed correcting journal.
- Invoices and payment receipts get their series number when issued (drafts show a `DRAFT-` reference), so abandoned drafts leave no gaps. Automatic numbering skips numbers already used manually.
- Foreign-currency documents can be drafted and previewed, but cannot be issued until exchange-rate conversion exists. An advance entered on an invoice is posted as a receipt allocated to that invoice when it is issued.
- Unallocated client advances are demo-only. Existing advances cannot yet be allocated to invoices, and vendor advances/refunds are not supported.
- Corrections never delete or edit posted records. Vouchers and receipts are reversed (a reversed receipt adds negative allocations dated on the reversal, so the invoice becomes outstanding again). Issued invoices are corrected with credit notes: line quantities at the invoice's own rates and tax, limited to the outstanding balance; if money was refunded, reverse the receipt first. Credit notes are demo-gated together with live invoice issuance. Drafts, quotations/proformas and payment receipts can be cancelled; cancelling an issued payment receipt posts a reversal. Issued invoices and credit notes cannot be cancelled.
- The day book and CSV export show at most the latest 250 selected entries. Bank lines are limited to 250 and audit events to 100. Totals are calculated from the underlying matching ledger, not only visible rows. Full exports/pagination are needed before operational scale.
- Cash/bank, trial balance and balance sheet are company-wide as of the end date; activity charts/P&L use the selected date range and client/category filters. Project profit includes direct postings, without allocation of shared costs.
- Recurring confirmation is manual and produces an actual posted entry; no unattended scheduler runs. Budgets and recurring confirmations use the month containing the selected end date (the current month by default); budget actuals are all postings in that month. Reversing a recurring entry frees that month for confirmation again and removes any bank match.
- Authentication and financial rules have tests, but this is not an independent security audit. Mobile breakpoints are implemented; device-specific QA and accessibility testing remain.

## Next implementation order

1. Run PostgreSQL 17/Docker integration and concurrency tests; introduce versioned migrations and separate runtime permissions.
2. Finish document editing/cancellation, tax validation and credit/debit-note/payment-adjustment workflows; agree the company's exact invoice and panel quotation formats.
3. Add opening-balance imports, attachments, complete exports and user management.
4. Add template editing, reminder/background jobs, automated backups and staging acceptance testing.

No accepted blueprint feature has been silently removed; incomplete work is explicitly tracked above.
