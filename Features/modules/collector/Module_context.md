# Collector Module Context

Last reviewed: 2026-08-07
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Assign collectors to service areas and report assignment/collection state.
- Provide collector-specific customer/payment options and next-due resolution.
- Capture field payments and support receipt reprinting.
- Persist Android collector reschedules, retain their schedule history, and provide branch-scoped Admin create/edit/delete management that syncs to the assigned collector device.
- Manage approval queues and approve/reject collected entries.
- Create, confirm, and reject remittances.
- Present collection history and reports.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/collectors.js`: assignment CRUD/reporting under `/api/collectors`.
- `backend/collector-payments.js`: options, reprints, payment submission, approvals, and remittances under `/api/collector/payments`.
- `backend/collector-reschedules.js`: authenticated reschedule upload/list/paid-resolution and Admin schedule CRUD mounted under `/api/collector/payments/reschedules`. Collector uploads are idempotent by collector/client record ID, validated against customer-area assignments, and never trust a collector identity from the request body. Admin `POST` requires an active Collector account assigned to the selected customer area; Admin `PUT`/`PATCH /:id` changes schedule details without reassigning customer/collector; Admin `DELETE /:id` creates a `Deleted` history tombstone so Android Sync can clear cached active reminders.
- `backend/collector-next-due.js`: resolves account collection timing and is consumed directly by Admin authentication/information flows.
- `backend/routes/collectors.js`: retained dormant relational route implementation; it is not mounted by `server.js` and is available only at its canonical module path.
- The former four repository-root/`routes` backend shims were retired in Phase 11.
- Collector login/session/map/transaction endpoints are implemented in Admin-owned `auth.js` under `/api/auth`.

All API prefixes, collector/admin authentication requirements, feature gates, and response contracts remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: two HTML entry points, three stylesheets, and two JavaScript files.
- Existing URLs remain `/collectors.html`, `/collectors-history.html`, `/collectors`, and `/collectors-history`.
- `collectors.html` presents Collector Assignment and Rescheduled Clients side by side in a responsive Tabler layout, with Pending Payments spanning the full width below them. The layout stacks Assignment, Rescheduled Clients, then Pending Payments on narrower screens. The Rescheduled Clients section retains active/history and collector filters, adds an Admin Create Schedule modal, and exposes edit/delete actions for active records.
- Both pages retain the shared Admin authentication and Collector feature guards.
- Browser URLs and shared-shell integration remain unchanged; Collector-owned browser files now include post-migration reschedule and Tabler workflow enhancements.

## Data and dependencies

- Canonical storage, database, and role imports come from `core/`.
- Reschedules use the `collector_followups` data-store key, which writes `data/collector_followups.json` in JSON mode and the protected `app_store` row in MySQL mode.
- A reschedule stores its server/client IDs, branch, customer/account/area, assigned collector identity, visit result, schedule date/time, notes, lifecycle status, source, creator/updater/deleter audit fields, and timestamps. A newer schedule archives the prior active schedule for that account; paid resolution and Admin deletion archive active schedules. Deleted records remain history tombstones for Android reconciliation.
- Depends directly on migrated Admin accounts/roles and collector authentication.
- Depends on Customer Management for customer identity, area, and account number.
- Depends directly on migrated Billing for canonical payment records, entry numbering, balances, and service refresh.
- Collector client review uses Billing's canonical Complimentary flag: active exempt subscribers are labeled Complimentary and excluded from area unpaid totals so they are not treated as collection targets. Other collector payment/reschedule contracts are unchanged.
- Remittance and approval data may be consumed by Finance reporting.

## Known risks and follow-up

- Payment capture and approval must remain idempotent and preserve entry numbering.
- Collector authentication routes live outside the module and require Admin/Integration coordination.
- Android releases older than version 1.1 keep reschedules only on-device and cannot populate the Admin table. Version 1.1 uploads immediately when online and retries pending records during assigned-record synchronization.
- The Android offline queue remains device-local until connectivity and a valid collector token are available.
- Admin-created changes appear on Android only after the assigned collector logs in or taps Sync; deleting the server tombstone before that reconciliation would leave stale device state, so tombstones are retained in schedule history.
- Verify permissions for collector versus admin operations after any route change.
- Repository-root backend aliases must not be recreated.
- Add authenticated end-to-end capture, approval, rejection, remittance, reprint, and idempotency tests before changing financial behavior.

## Validation

- `npm run refactor:collector` verifies the descriptor, retirement of four root entries, seven web files, server wiring, canonical dependencies, the dormant canonical route, and representative next-due behavior.
- `npm run refactor:phase7` runs inventory, Core, Admin, Customer Management, Billing, Network, Collector, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Collector asset/page URLs and unauthenticated assignment, payment, and collector-session denials on ports `3190`/`4190`.
- Acceptance tests do not submit, approve, reject, reprint, or remit payments.
- 2026-08-04 focused validation covered router load/date normalization and an in-memory HTTP flow for authenticated create, duplicate idempotency, automatic history, Admin/collector listing, and paid resolution. Android `assembleDebug` and `testDebugUnitTest`, Collector compatibility, and the full `npm test` package/smoke gate passed.
- 2026-08-05 frontend validation covered the Collector compatibility check, unique IDs, required workflow hooks, absence of hidden tab panels, and focused responsive/dark-mode stylesheet review. Interactive browser review was unavailable because no browser instance was connected.
- `node Features/modules/collector/tests/collector-reschedules-admin.test.js` covers JSON and relational Admin creation paths, assignment/branch enforcement, collector visibility, Admin-only editing, updated collector download, audited deletion, and active-to-history tombstone synchronization with isolated storage.
- 2026-08-05 Admin schedule CRUD validation passed JavaScript syntax and HTML structure/hook checks, the focused lifecycle test, `npm run refactor:collector`, and the full `npm test` security/module/package/isolated-HTTP gate.
- 2026-08-05 responsive layout validation covered the two-column grid areas, stacked breakpoint, HTML structure, unique IDs, and the Collector compatibility check.

## Latest meaningful changes

- 2026-08-07: Collector client review now labels active Billing-owned Complimentary accounts and excludes them from unpaid area totals; subscriber plans, payment history, and collector reschedules remain unchanged.
- 2026-08-05: Added a responsive right-side Rescheduled Clients column beside Collector Area Assignment, while Pending Collector Payments remains full-width below both cards; narrower screens preserve the one-page workflow by stacking all sections.
- 2026-08-05: Added branch-scoped Admin create/edit/delete schedule management in `collectors.html` and `/api/collector/payments/reschedules`; schedules target assigned collectors and create/update/delete lifecycle changes reconcile into Android version 1.1 on Sync.
- 2026-08-05: Reorganized `collectors.html` into three stacked Tabler cards so area assignments, pending payment approvals, and rescheduled clients remain visible together on one page; existing data rendering, filters, actions, and API contracts remain unchanged.
- 2026-08-04: Added server-backed collector reschedules, Android immediate/offline-retry sync and server download, paid reminder resolution, and the filterable Rescheduled Clients table in `collectors.html`.
- 2026-07-29: Phase 12 revalidated Collector through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all four Collector root/`routes` shims; the dormant relational router remains canonical and unmounted.
- 2026-07-29: Physically migrated four backend implementations and seven browser files into the Collector module, added compatibility shims and module-loader/static wiring, converted Admin next-due consumers to canonical imports, and added Phase 7 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
