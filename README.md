# Company Accounts — LedgerDesk

First development milestone for one GST-registered company's accounts. Next.js frontend, a separate NestJS/Node.js API, and PostgreSQL. “LedgerDesk” and “Northstar Studio” are replaceable demo branding, not the user's company identity.

This is a runnable development build. The complete blueprint remains the target; see [STATUS.md](STATUS.md) for implemented features, partial workflows, and remaining work. No public deployment or production finance approval is included.

## Start the demo

Requirements: Node.js 22 or newer and npm. Run commands from this directory.

```bash
npm ci
npm run demo
```

Open `http://localhost:3000`, then select **Open demo workspace**. This explicitly starts an embedded PostgreSQL engine (PGlite) with fictional sample data; it does not require a separately installed PostgreSQL server. No reusable demo password is shipped. Demo data persists under `apps/api/.data/preview`. Do not use this mode for real company records or expose it to the internet: its development-only button signs in as the demo administrator.

If the development compiler is unavailable in your environment, use the compiled demo:

```bash
npm run build
npm run demo:built
```

The web app runs on port 3000 and the API on port 4000. Stop both with Ctrl+C. Use a separate empty PostgreSQL database for real-company configuration; the application rejects switching an existing database between demo and non-demo modes.

## Run with PostgreSQL and Docker

Requires Docker Engine and Docker Compose. Docker was not available in the build environment; this path still needs an actual integration run.

1. Copy `.env.example` to `.env`.
2. Replace `POSTGRES_PASSWORD` with a strong URL-safe password and set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` of at least 12 characters. The connection string uses this password, so reserved URL characters must be encoded consistently if used.
3. For a fictional demonstration only, set both `DEMO_MODE=true` and `SEED_DEMO=true` before the database's first startup. Leave both false for a new real-company workspace. The one-click demo login is disabled in Docker production mode; use your configured credentials.
4. Start the services:

```bash
docker compose up --build
```

Open `http://localhost:3000`. PostgreSQL 17 persists in the `accounts-db` Docker volume. The API and database are not mapped to host ports. Do not remove the volume to update the app. The administrator credentials initialize an empty database; changing the environment password later does not reset an existing user's password.

For a PostgreSQL server you already run locally, set `DATABASE_URL` in `.env` to its connection string and use:

```bash
npm ci
npm run dev
```

The API applies the SQL baseline automatically at startup. `npm run db:migrate` also applies it. This is an idempotent initial schema, not a versioned upgrade framework; introduce numbered migrations before evolving a live installation.

## What to try

- Overview: change the dates/client, inspect monthly income and expenses, and drill into expense categories.
- Daily vouchers: enter an expense, capital contribution, investment, loan principal, or transfer. Direct income entries must not duplicate an already issued invoice.
- Documents: create a quotation/proforma/invoice draft, choose the specific tax treatment, add lines, preview, and print. Demo invoices can be issued and partially settled. Quotations/proformas never post income.
- Receipts: allocate money to an issued invoice and inspect the outstanding balance and printable receipt.
- Reports: P&L, trial balance, balance sheet, ageing, output-tax working summary, and audit events.
- Bank & cash: paste statement CSV with `date,reference,description,amount` columns. Receipts are positive, payments negative. Import deduplicates; matching links an existing exact-value entry and never creates another posting.
- Settings: change company details, create accountant/viewer accounts, and close/reopen periods with an audit reason.

The GST/non-GST UI preserves `TAXABLE`, `NIL_RATED`, `EXEMPT`, and `OUTSIDE_GST` as distinct treatments. Selecting a treatment is not a determination of its legal applicability. Non-taxable documents require a reason. Live invoice issuance and unallocated live advances remain intentionally gated until the company's tax workflow is implemented and validated. See STATUS for tax functionality still missing.

## Source layout

| Location | Purpose |
| --- | --- |
| `apps/web/app/page.tsx` | Dashboard, document/voucher forms, reports, print templates |
| `apps/web/app/globals.css` | Responsive styling and print layout |
| `apps/api/src/api.ts` | Validated HTTP endpoints and role checks |
| `apps/api/src/accounting.ts` | Exact decimal calculations and transactional posting |
| `apps/api/src/schema.sql` | PostgreSQL tables, constraints, immutable-record triggers |
| `apps/api/src/reports.ts` | Ledger-derived aggregates and filters |
| `apps/api/src/auth.ts` | Password hashing and server-side sessions |
| `apps/api/test/accounting.test.ts` | Accounting and integrity regression tests |
| `docs/Blueprint.md` | Agreed target scope and implementation plan |

The frontend calls same-origin `/api/*`; Next.js forwards these requests to the separate API. In Docker, the internal destination is set at frontend build time. Rebuild the frontend if this destination changes.

Implementation choices for this milestone: parameterized SQL with `pg` instead of Prisma, to keep accounting constraints and transaction behavior explicit; custom CSS instead of Tailwind/shadcn. The requested Next.js + Node.js + PostgreSQL architecture is retained. The UI is still concentrated in one page and should be split into modules as subsequent milestones grow.

## Validation

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Tests use a fresh, in-memory PGlite PostgreSQL database and do not touch the configured company database. See [VALIDATION.md](VALIDATION.md) for the verification record and limits. PGlite coverage is not a substitute for testing the deployed PostgreSQL server, concurrent requests, or disaster recovery.

## Operational setup still required

Before real use, complete the pending workflows in STATUS, deploy behind HTTPS, set `COOKIE_SECURE=true`, use a restricted runtime database role, separate migration permissions, configure backups/monitoring, and verify restore procedures. `.env` and database files are excluded from the source package. Do not commit secrets.

An example manual backup for the Docker database is:

```bash
docker compose exec -T db pg_dump -U accounts -Fc accounts > accounts-backup.dump
```

Store backups securely off-host and test restoration to a separate empty database. This build does not schedule backups or implement a restore UI. Avoid overwriting working books as a restore test.

