# Temp Workspace Module Context

Last reviewed: 2026-08-07
Status: Hidden auxiliary module with isolated secondary-location customer and billing storage.

## Purpose and current scope

- Provide one Admin-only page at `/temp.html` for a secondary location's customers and billing ledger.
- Keep the workspace absent from the shared sidebar, dashboard, and all visible navigation.
- Keep every Temp customer, balance, charge, payment, rebate, discount, statement, import, and export separate from the main location.
- Support customer search/filter/sort, create/edit/delete, plan/rate/billing details, opening balances, ledger transaction search/filter/sort, calculated balances, printable customer ledgers with payment history, and complete Temp-only JSON/Excel backup and restore.
- Customer entry uses synchronized fixed plan/rate selectors: Old plan/700, Basic/800, Standard/1000, and Premium/1200.
- Service address entry is limited to the Poblacion and Masical dropdown choices, with Poblacion as the default for new customers and legacy unmatched values.
- Customer entry includes Prepaid, Postpaid, and Prorate plan types plus an Activation date. Billing schedule can use an exact next-bill date or a monthly day number. Opening balance remains a direct manual starting value and is never recalculated by the cycle engine.

## Canonical runtime layout

- `backend/index.js` exposes the `workspace` router entry through the module runtime.
- `backend/workspace-router.js` owns authenticated `/api/temp` request/response handling.
- `backend/workspace-store.js` owns validation, account/receipt numbering, balance calculations, serialized mutations, persistence, and Temp export/import validation.
- `backend/billing-cycle.js` owns pure Temp-only monthly date alignment and Billing-day proration calculations; it has no dependency on canonical Billing or Customer Management code.
- `backend/workspace-excel.js` owns the strict Metadata, Customers, and Transactions workbook contract and preserves every stored customer and transaction field.
- `web/temp.html` is the module's only browser entry point and contains the combined Customer and Billing panels and dialogs.
- `web/temp.css` uses Tabler's default font variable and owns the responsive standalone layout.
- `web/temp.js` calls only `/api/temp`, renders both panels, and handles CRUD, statements, filtering, backup, and restore.
- Native Temp dialogs ignore Escape and backdrop clicks. They close only through their explicit Close/Cancel controls or after a successful completed action.
- The plan and monthly-rate dropdowns synchronize in both directions so the stored plan/rate pair cannot disagree through normal form entry.
- The service-address dropdown stores only Poblacion or Masical through normal form entry.
- Each customer ledger dialog presents account details and totals first, a chronological debit/credit ledger with running balances, then a newest-first payments-only history with receipt, method, reference, recorder, and amount.
- Date schedule mode accepts an exact Next billing date, generates no automatic charge before it, charges the full monthly rate on that date, and then repeats monthly using that date's day. This prevents a duplicate initial bill when the current-month amount is already entered in Opening balance.
- Number schedule mode accepts day 1–31. Active Prepaid and Postpaid customers receive the full monthly rate on that day every month. Active Prorate customers receive one first charge based on the fraction from Activation date to the first Billing day, rounded to the nearest peso, then full monthly charges. Prorate with Date mode uses the exact-date full-charge rule.
- Temp cycle catch-up runs idempotently when `/api/temp/workspace` is loaded and before export. System charges use a unique account/date cycle key. Existing Prepaid records without a schedule migrate to the next future Billing day without historical back-billing.
- The customer list shows Plan type as its own color-coded Prepaid, Postpaid, or Prorate column. Sort icons beside the relevant table headers toggle direction and mark the active column with an arrow and accessible `aria-sort` state. Customer sorting covers name, account number, Poblacion/Masical address priority, plan rate, plan type, billing day, balance, and status; transaction sorting covers date, amount, receipt number, and customer name. Sorting applies after the current search and filter.
- `module.json` declares `/api/temp` and the single `/temp.html` entry point.

## Data and API contracts

- The exclusive storage key is `temp_workspace_isolated_v1`. JSON mode writes `data/temp_workspace_isolated_v1.json`; MySQL mode uses a separate `app_store` row with that key.
- Temp never reads or writes the canonical `customers`, `payments`, or `plans` keys/tables.
- `GET /api/temp/workspace` returns Temp customers, billing schedule mode/next date, ledger transactions, calculated balances, and summary totals.
- `POST/PUT/DELETE /api/temp/customers` manages only Temp customers. Customers with ledger transactions cannot be deleted until those Temp transactions are removed.
- `POST/PUT/DELETE /api/temp/payments` manages only Temp ledger entries. Charges increase balances; payments, rebates, and discounts reduce balances.
- `DELETE /api/temp/workspace` clears all Temp customers and transactions and resets Temp account/receipt sequences. The page requires explicit destructive confirmation and recommends exporting a backup first.
- `GET /api/temp/export?format=json|xlsx` downloads the same complete `isp-temp-workspace-export` backup as JSON or Excel. Excel contains Metadata, Customers, and Transactions sheets.
- `GET /api/temp/collector-export` downloads a report-only Collector workbook with Account, Customer, Service address, Plan, Plan type, Billing, current Balance, and Due. Due equals Balance before the next billing date; on/after that date it adds the monthly rate only if the automatic cycle charge is not already in Balance. The report date is resolved in Asia/Manila, matching the Temp cycle engine even while UTC is still on the prior calendar date.
- `POST /api/temp/import` retains the JSON API contract. `POST /api/temp/import-file` accepts exported JSON, XLSX, or XLS bytes, validates the complete file, and replaces only the isolated Temp workspace.
- Temp account numbers default to `TMP` plus six digits; receipt numbers default to `TMP-` plus seven digits.

## Access and integration contracts

- Shared `server.js` lists `temp.html` in `PROTECTED_PAGES`, loads `tempBackend.load('workspace')`, and mounts it at `/api/temp` behind `requireAuth`.
- Both the page and API require an Admin session. Signed-out page requests redirect to `/login.html`; signed-out API requests return `401`.
- No Temp link exists in `public/sidebar.html`, `public/topbar.html`, `public/index.html`, or business-module pages.
- The Temp UI contains no iframe, link, or API call to `/customers.html`, `/payments.html`, `/api/customers`, or `/api/payments`.
- Customer Management and Billing source and records are unchanged by this module.

## Validation

- `npm run refactor:temp` verifies the runtime descriptor, distinct storage key, in-memory isolation from canonical store sentinels, balance behavior, exact JSON and Excel export/import round trips, workbook columns and sheets, standalone page assets, absence of canonical page/API references, hidden navigation, and Admin guards.
- The focused Temp check also verifies all four plan/rate dropdown pairs, their two-way synchronization hooks, the exact Poblacion/Masical service-address choices, all three plan types, Date/Number schedule behavior, automatic full-rate Prepaid/Postpaid charges, day-mode Prorate computation, legacy no-back-bill migration, idempotency, customer/transaction sortable headers, the arranged ledger/payment-history structure, and explicit-only native dialog dismissal.
- `npm run refactor:smoke` verifies `/temp.html` redirects unauthenticated users, Temp CSS/JS assets resolve, and `/api/temp/workspace` denies unauthenticated requests.
- `npm run refactor:phase12` is the complete cross-module, security, HTTP, package, and cutover gate.
- On 2026-07-30, focused isolation checks, HTML/JavaScript structural checks, authenticated read-only API verification, HTTP smoke, and the complete `npm test` suite passed. Interactive browser inspection was unavailable in the session.

## Known risks and follow-up

- Temp is intentionally a separate lightweight ledger. Its catch-up cycle runs on workspace access rather than a background timer, and it does not run the canonical monthly scheduler, MikroTik disconnection automation, tickets, SMS, collector, or customer-portal workflows.
- Import replaces the complete Temp workspace and requires an explicit browser confirmation; export a current backup first when retaining existing Temp records matters.
- Excel import is intentionally strict: missing sheets, changed column headings, count mismatches, or files not produced by the Temp exporter are rejected before storage replacement.
- The URL is unlisted rather than secret. Admin authentication is the security boundary.

## Latest meaningful changes

- 2026-08-07: Prevented native Temp dialogs from closing through Escape or backdrop clicks; explicit Close/Cancel controls and successful actions remain available.
- 2026-07-31: Corrected Collector Excel to use the same Asia/Manila calendar date as Temp billing, preventing due-date charges from disappearing during the UTC/local date boundary.
- 2026-07-30: Updated Collector Excel so Balance is current, Due stays unchanged before billing, and the monthly rate is generated only when billing is reached without double-counting automatic charges.
- 2026-07-30: Added a confirmed Clear data action that resets only the isolated Temp workspace and leaves canonical Customer Management and Billing storage untouched.
- 2026-07-30: Added an export-format confirmation dialog, complete JSON or Excel downloads, and strict JSON/XLSX/XLS restore with exact customer, billing-cycle, sequence, and transaction round-trip coverage.
- 2026-07-30: Added exact Date and monthly Number billing schedules; Date mode defers the first automatic full charge to the chosen next-bill date, and Prepaid now generates the full monthly rate automatically with safe next-future migration for existing records.
- 2026-07-30: Added a dedicated color-coded and sortable Plan type column to the Temp client list.
- 2026-07-30: Added isolated Prepaid/Postpaid/Prorate plan types, Activation date, safe legacy initialization, Billing-day Postpaid charges, first-cycle Prorate calculation, and idempotent Temp-only catch-up while preserving manual Opening balance.
- 2026-07-30: Replaced customer and transaction sort dropdowns with direct header icons that toggle direction, expose active state accessibly, and combine with existing search and filters; Service Address and Receipt now have dedicated columns.
- 2026-07-30: Rearranged the printable Temp customer ledger into account summary, debit/credit running ledger, and a dedicated payments-only history section.
- 2026-07-30: Replaced free-form Temp service-address entry with a Poblacion/Masical dropdown and a safe Poblacion fallback for new or unmatched records.
- 2026-07-30: Replaced free-form Temp plan/rate entry with synchronized dropdowns for Old plan/700, Basic/800, Standard/1000, and Premium/1200.
- 2026-07-30: Replaced the shared Customer/Billing iframes with a standalone Temp workspace, dedicated `/api/temp` router, isolated storage key, customer and ledger CRUD, balances/statements, and Temp-only backup/restore.
- 2026-07-30: Initially created the hidden Admin-only `/temp.html` workspace.

## Context update rule

Update this file in the same task whenever access rules, data isolation, APIs, persistence, UI behavior, tests, or source ownership changes.
