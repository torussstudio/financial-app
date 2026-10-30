# Validation record

Development milestone v0.1, verified 27 October 2026. All transactions below use fictional demo/test data.

| Check | Result |
| --- | --- |
| Clean installation with `npm ci` | Passed; lockfile installs successfully |
| API and web TypeScript checks | Passed |
| API and Next.js production build | Passed |
| Accounting regression suite | 11 passed, 0 failed |
| Runtime dependency audit | 0 known vulnerabilities reported by `npm audit --omit=dev` at verification time |
| Browser demo sign-in | Passed |
| Browser expense creation | Passed; saved ₹1,234.56 software expense and verified ledger row and KPI changes |
| Browser GST quotation draft | Passed; ₹10,000 base + ₹900 CGST + ₹900 SGST = ₹11,800; printable preview inspected |
| Browser trial balance | Passed; debit and credit totals both ₹21,20,870 after the sample voucher; the draft quotation does not post |

## Regression coverage

1. Password hashing uses distinct salts and rejects incorrect passwords.
2. Decimal arithmetic preserves small amounts and proformas do not post.
3. Invoice, partial receipt, capital and expense reconcile; duplicate issuance does not duplicate revenue; over-allocation fails.
4. Transfers leave total cash and profit unchanged; identical request retries reuse their result and changed-payload retries fail.
5. Period closing blocks postings; empty/unbalanced journals fail at the database layer.
6. Posted entries are immutable; reversal preserves the original and cannot be repeated.
7. Another party cannot settle a client's invoice.
8. Outstanding balances use payment dates, including cross-month settlements.
9. A later transaction cannot append even balanced lines to an already posted journal.
10. Receipt snapshots preserve the original party name after contact data changes.
11. Viewer writes and accountant-only attempts at administrator actions are rejected by role guards.

## Logic-fix update — 29 October 2026

`npm test` (26 passed, 0 failed), `npm run typecheck` and `npm run build` pass. The schema migration was also applied to a copy of an existing v0.1 demo database. Browser flows were not re-run for this update. New regression tests in `apps/api/test/logic-fixes.test.ts` cover:

- Payment receipts post cash/bank against income, never expense/payables; draft edits enforce the same document rules as creation.
- Manual document/journal numbers never block automatic numbering; abandoned invoice drafts leave no series gap.
- Foreign-currency invoices cannot be posted; invoice advances post as allocated receipts.
- Asset/investment vouchers cannot use control accounts; vendor payments are rejected until vendor bills exist.
- Budgets/recurring use the end-date month; reversal frees recurring months and bank matches; reversed entries cannot be matched.
- Repeated identical rows in one bank import are kept while re-imports are skipped; quotation conversion keeps details and dates the invoice today.
- Custom category codes stay inside their range; owner/reimbursement categories are tagged data, with a one-time migration for previously seeded names.

## Correction workflow update — 29 October 2026

`npm test` (32 passed, 0 failed), `npm run typecheck` and `npm run build` pass; the migration was re-applied (twice) to a copy of an existing v0.1 demo database. Browser flows were not run. `apps/api/test/corrections.test.ts` covers receipt reversal (balance, cash and as-of reporting), partial and inter-state credit notes, over-credit and outstanding limits, demo gating, cancellation of drafts/quotations/payment receipts, and re-conversion after a cancelled invoice draft.

## Limits

- Tests run against PGlite's embedded PostgreSQL engine, not a standalone PostgreSQL 17 service. Docker/server PostgreSQL deployment, multiple-process concurrency and load testing remain unverified.
- Browser checks cover the desktop demo flow. The print preview was inspected; a saved PDF and physical print were not verified. Mobile devices, all browser combinations, and full accessibility review remain pending.
- The audit is a point-in-time dependency check, not an application security audit. A root `multer` override pins 2.5.0 to address the advisory found during development. Some npm dependency-tree displays may flag Nest's original exact range even though the clean lockfile installation uses the patched version.
- The generated package excludes runtime credentials, database state, dependencies, and build outputs. The QA voucher/quotation are not part of the shipped seed dataset.
- No actual company financial records were imported, no GST return was filed, and no production site was published.
