# Temp Workspace Module Context

Last reviewed: 2026-07-30
Status: Hidden auxiliary module with isolated secondary-location customer and billing storage.

## Purpose and current scope

- Provide one Admin-only page at `/temp.html` for a secondary location's customers and billing ledger.
- Keep the workspace absent from the shared sidebar, dashboard, and all visible navigation.
- Keep every Temp customer, balance, charge, payment, rebate, discount, statement, import, and export separate from the main location.
- Support customer search/filter, create/edit/delete, plan/rate/billing details, opening balances, ledger transactions, calculated balances, printable statements, and Temp-only JSON backup/restore.

## Canonical runtime layout

- `backend/index.js` exposes the `workspace` router entry through the module runtime.
- `backend/workspace-router.js` owns authenticated `/api/temp` request/response handling.
- `backend/workspace-store.js` owns validation, account/receipt numbering, balance calculations, serialized mutations, persistence, and Temp export/import validation.
- `web/temp.html` is the module's only browser entry point and contains the combined Customer and Billing panels and dialogs.
- `web/temp.css` uses Tabler's default font variable and owns the responsive standalone layout.
- `web/temp.js` calls only `/api/temp`, renders both panels, and handles CRUD, statements, filtering, backup, and restore.
- `module.json` declares `/api/temp` and the single `/temp.html` entry point.

## Data and API contracts

- The exclusive storage key is `temp_workspace_isolated_v1`. JSON mode writes `data/temp_workspace_isolated_v1.json`; MySQL mode uses a separate `app_store` row with that key.
- Temp never reads or writes the canonical `customers`, `payments`, or `plans` keys/tables.
- `GET /api/temp/workspace` returns Temp customers, ledger transactions, calculated balances, and summary totals.
- `POST/PUT/DELETE /api/temp/customers` manages only Temp customers. Customers with ledger transactions cannot be deleted until those Temp transactions are removed.
- `POST/PUT/DELETE /api/temp/payments` manages only Temp ledger entries. Charges increase balances; payments, rebates, and discounts reduce balances.
- `GET /api/temp/export` downloads a `isp-temp-workspace-export` JSON file. `POST /api/temp/import` accepts only that file kind and replaces only the Temp workspace after strict validation.
- Temp account numbers default to `TMP` plus six digits; receipt numbers default to `TMP-` plus seven digits.

## Access and integration contracts

- Shared `server.js` lists `temp.html` in `PROTECTED_PAGES`, loads `tempBackend.load('workspace')`, and mounts it at `/api/temp` behind `requireAuth`.
- Both the page and API require an Admin session. Signed-out page requests redirect to `/login.html`; signed-out API requests return `401`.
- No Temp link exists in `public/sidebar.html`, `public/topbar.html`, `public/index.html`, or business-module pages.
- The Temp UI contains no iframe, link, or API call to `/customers.html`, `/payments.html`, `/api/customers`, or `/api/payments`.
- Customer Management and Billing source and records are unchanged by this module.

## Validation

- `npm run refactor:temp` verifies the runtime descriptor, distinct storage key, in-memory isolation from canonical store sentinels, balance behavior, Temp-only export/import contract, standalone page assets, absence of canonical page/API references, hidden navigation, and Admin guards.
- `npm run refactor:smoke` verifies `/temp.html` redirects unauthenticated users, Temp CSS/JS assets resolve, and `/api/temp/workspace` denies unauthenticated requests.
- `npm run refactor:phase12` is the complete cross-module, security, HTTP, package, and cutover gate.
- On 2026-07-30, focused isolation checks, HTML/JavaScript structural checks, authenticated read-only API verification, HTTP smoke, and the complete `npm test` suite passed. Interactive browser inspection was unavailable in the session.

## Known risks and follow-up

- Temp is intentionally a separate lightweight ledger; it does not run the canonical monthly billing scheduler, MikroTik disconnection automation, tickets, SMS, collector, or customer-portal workflows.
- Import replaces the complete Temp workspace and requires an explicit browser confirmation; export a current backup first when retaining existing Temp records matters.
- The URL is unlisted rather than secret. Admin authentication is the security boundary.

## Latest meaningful changes

- 2026-07-30: Replaced the shared Customer/Billing iframes with a standalone Temp workspace, dedicated `/api/temp` router, isolated storage key, customer and ledger CRUD, balances/statements, and Temp-only backup/restore.
- 2026-07-30: Initially created the hidden Admin-only `/temp.html` workspace.

## Context update rule

Update this file in the same task whenever access rules, data isolation, APIs, persistence, UI behavior, tests, or source ownership changes.
