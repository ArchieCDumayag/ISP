# Finance Module Context

Last reviewed: 2026-08-07
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Create, list, update, filter, approve, and delete standardized operating-expense records.
- Create, list, update, and delete payroll records.
- Present finance-oriented dashboard reports and collection trends using shared Billing/Collector data.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/expenses.js`: branch-scoped expense CRUD, including bulk deletion, under `/api/expenses`.
- `backend/expense-record.js`: canonical expense normalization, validation, legacy defaults, status rules, and actor audit-field construction shared by JSON and MySQL persistence.
- `backend/payroll.js`: branch-scoped payroll, attendance, debt, submission, and deletion operations under `/api/payroll`.
- Both routers retain Admin-role and branch-assignment enforcement after the shared session guard.
- The former two repository-root backend shims were retired in Phase 11.
- `/api/dashboard/collection-breakdown` remains a shared authenticated handler in `server.js`.

All API prefixes, authorization requirements, feature gates, response contracts, and JSON/MySQL storage keys remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: two HTML entry points, three stylesheets, and four JavaScript files.
- Existing page URLs remain `/expenses.html`, `/payroll.html`, `/expenses`, and `/payroll` with the same admin session and feature guards.
- Existing Finance/reporting asset URLs remain `/css/finance.css`, `/css/monthly-collection-trend.css`, `/css/reports.css`, `/js/expenses.js`, `/js/monthly-collection-trend.js`, `/js/payroll.js`, and `/reports.js`.
- The deprecated reports page remains absent; its retained reporting assets continue to consume existing Billing and Collector API URLs.
- The Expenses form captures category, vendor/payee, amount, payment method, reference number, status, optional receipt link/path, and description. The current-month and history views display the canonical vendor, payment, and status values.

## Data and dependencies

- Canonical shared database, storage-mode, and role imports come from `core/`.
- JSON keys remain `finance_expenses_branch_<branchId>` and `finance_payroll_branch_<branchId>`; relational tables remain `finance_expenses` and `finance_payroll`.
- Expense records use schema version `1` and persist branch, date, category, canonical `vendor`, compatibility `payee`, description, amount, payment method, reference number, receipt URL/name, workflow status, timestamps, and creator/updater/approver identities.
- Legacy expenses are normalized on read with `vendor` copied from `payee`, `paymentMethod: other`, and `status: paid`; this keeps old records visible without changing their historical meaning. Editing a legacy record requires a vendor/payee.
- MySQL schema migration adds the standardized fields and a branch/status/date index, then backfills legacy vendor, payment-method, and status values safely.
- Admin supplies accounts, roles, sessions, branch identity, and business profile data.
- Retained reporting assets consume Billing payment-record and Collector assignment/account APIs through their unchanged browser endpoints.

## Known risks and follow-up

- Bulk expense deletion is destructive and requires confirmation/authorization checks.
- Receipt handling currently records a URL or stored file path plus filename; binary upload/storage remains a separate follow-up.
- Expense statuses provide record state and approval audit metadata but do not yet implement multi-user approval permissions or notifications.
- Payroll contains sensitive financial/personnel information; avoid logging values unnecessarily.
- Shared dashboard report handlers and shell UI require Integration Codex coordination.
- Repository-root backend aliases must not be recreated.
- Add authenticated totals, filtering, mutation, authorization, JSON, and MySQL regression tests before changing Finance behavior.

## Validation

- `npm run refactor:finance` verifies the descriptor, retirement of two root entries, nine web files, standardized expense normalization/audits/legacy defaults, schema migration, admin form, server wiring, canonical Core dependencies, route definitions, and retained reporting-asset contracts.
- `npm run refactor:phase9` runs inventory, Core, Admin, Customer Management, Billing, Network, Collector, Technician, Finance, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Finance asset/page URLs, page guards, pretty routes, and unauthenticated expense/payroll denials on ports `3190`/`4190`.
- Acceptance checks do not create, update, submit, or delete expense/payroll data and do not read protected financial records.

## Latest meaningful changes

- 2026-08-07: Standardized expense records across JSON and MySQL, added vendor/payment/reference/receipt/status and creator/updater/approver audit fields, preserved the `payee` compatibility alias, upgraded the admin form/table/history views, and added schema migration plus Finance compatibility coverage.
- 2026-07-29: Phase 12 revalidated Finance through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired both Finance root shims; shared composition loads Finance only through its manifest runtime.
- 2026-07-29: Physically migrated two backend implementations and nine browser files into the Finance module, added root compatibility shims and module-loader/static wiring, converted dependencies to canonical Core paths, and added Phase 9 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
