# Development status — v0.1

Single-company scope is retained. This milestone supplies working core screens and accounting transactions; it is not the completed product or a production launch.

| Area | Available in this build | Remaining work |
| --- | --- | --- |
| Dashboard | Ledger-derived KPIs; monthly chart; expense chart; date/client filters | Saved views and larger-data performance testing |
| Documents | Quotation, proforma, invoice, payment receipt and credit note documents; draft edit and cancellation; tax-treatment filters; source conversion; preview/print | Advanced template editor; logo/signature; discount/rounding options; custom panel quotation layout |
| GST | Demo output tax calculations; intra/inter-state components; specific non-taxable reasons; draft/issued labels; input tax credit from vendor bills (Input CGST/SGST/IGST, blocked-credit option) and an output-less-input working figure | Company-specific tax validation; compliant live issuance; GSTR-2B reconciliation; reverse charge; compliant live credit notes; debit notes; return exports/filing; e-invoice/e-way bill where applicable |
| Purchases | Vendor bills (draft → post): expense or fixed-asset account, supplier bill number with duplicate check, project link, ITC; payables ageing; cancel-by-reversal while unpaid | Debit notes; TDS on payments; recurring vendor bills |
| Daily vouchers | Income, expense, capital in/return, investment, loans, transfers; balanced journal API | Friendly journal line editor; bulk imports; custom chart-of-accounts UI; approval queue |
| Ledger integrity | Decimal arithmetic; atomic postings; retry keys; balanced SQL constraints; immutable posted records; ordinary voucher reversals | Concurrent-request/load tests on server PostgreSQL; restricted DB roles; full versioned migration tooling |
| Payments | Partial and multi-document allocation (receipts and vendor payments, auto-allocate oldest first); vendor advances; applying client/vendor advances to invoices/bills later (no cash or income/expense posted); receipt reversal (re-opens the balance; blocked while its advance is applied); receipt/payment print view; frozen party/company snapshots | Refund payments; live client advances (GST on advances) |
| Contacts/projects | Create, edit and archive contacts and projects (archived ones are hidden from new entries); client activity; project revenue, direct cost, profit and budget use | Complete statement exports; shared-overhead allocation |
| Products & services | Item master (HSN/SAC, rate, GST %, unit); typing an item name on a document or bill line fills its defaults | Price lists; inventory/stock |
| Reports | P&L, trial balance, balance sheet, ageing, output-tax working summary | Full paginated exports; formal cash-flow statement; accountant sign-off |
| Capital | Owner capital, returns, loan principal and investments separated from operating profit | Owner-wise balances; investment sales/returns; interest schedules |
| Bank | Statement CSV paste/import; dedupe; one-to-one exact-value matching | File upload parser; split/combined matching; unmatch workflow; bank feeds |
| Recurring | Expense schedule UI; income/expense API; explicit monthly confirmation | Edit/pause UI; background schedule worker; notifications |
| Budgets | Monthly expense budgets versus selected-period actuals | Budget revisions/history; forecast views |
| Access/control | Administrator/accountant/viewer; hashed-password sessions; CSRF; audited period closing; user edit/disable (signs them out; at least one active admin kept); admin password reset; change own password (signs out other devices) | Self-service forgotten-password email; MFA; distributed rate limits; production security review |
| Opening balances | Balanced journal entry facility | Guided opening-balance importer; historical invoice allocation migration |
| Attachments | PDF/PNG/JPEG/WebP up to 4 MB on documents, vendor bills and ledger entries (also when creating vouchers, bills and payments); type checked by file signature; stored in PostgreSQL so they are included in database backups; add/remove audited | Object storage for large volumes; malware scanning; retention rules |
| Audit/backups | Append-only audit events; manual backup instructions | Automated encrypted backups, restore drill, audit export/retention |
| Reminders | Outstanding-invoice screen | Email/WhatsApp integrations and scheduled reminder sending |
| Deployment | Source, lockfile, Dockerfiles and PostgreSQL Compose configuration | Actual PostgreSQL/Docker integration run, staging deployment, HTTPS and operational monitoring |

## Current boundaries

- Live (non-demo) invoices are checked on issue instead of blocked: company name and address and client name are required; GST invoices also need a valid company GSTIN whose first two digits match the company state code, the client address, a valid client GSTIN when one is given, an HSN/SAC on every line of a B2B invoice, and a number of at most 16 characters (letters, digits, `-`, `/`). Credit notes follow the same rule as their invoice. E-invoicing (IRN/QR) and e-way bills are not implemented; businesses that must e-invoice need that before relying on issued invoices. Unallocated live client advances remain gated.
- Preview invoices are watermarked and use fictional data. The output-tax report is a working summary, not a filed return or net tax-payable report.
- The `BILL` document type is the non-GST **Payment Receipt**: issuing it posts the amount received to Petty cash (Cash) or Operating bank (Bank Transfer/Cheque) against the chosen income account. Supplier bills are entered as the separate `PURCHASE` (Vendor bill) type under Purchases & bills; posting one debits the chosen expense/asset account and eligible input GST and credits Accounts payable. Payment receipts issued by earlier builds were posted as Rent expense / Accounts payable and need an accountant-reviewed correcting journal.
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
