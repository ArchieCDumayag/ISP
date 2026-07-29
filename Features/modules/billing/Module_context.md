# Billing Module Context

Last reviewed: 2026-07-29
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Manage prepaid/postpaid plans and MikroTik profile bindings.
- Generate monthly billing entries, proration, balances, advances, and credit-limit state.
- Record, import, export, normalize, number, adjust, and delete payment entries.
- Produce payment history, breakdowns, receipts, account statements, and billing statements.
- Review customer payment confirmations and unmatched imports.
- Drive disconnection, keep-active, reconnection, and disconnected billing-policy workflows.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- Thirteen implementations live under `backend/`: plans, payments, records, confirmations, disconnections, scheduler, numbering, normalization, balance, refresh, profile, and queue/store helpers.
- The former thirteen repository-root backend shims were retired in Phase 11; consumers use canonical Billing paths or the module descriptor.
- `/api/plans`: plan CRUD through `backend/plans.js`.
- `/api/payments`: payment listing, entry, import/export, delete, and payment-link flows through `backend/payments.js`.
- `/api/payment-records`: account payment history and adjustments.
- Payment confirmation routers are mounted at shared confirmation queue paths.
- `/api/disconnections`: queue and service-policy decisions.
- `/api/billing/run-once`: shared guarded billing trigger in `server.js`.
- Statement PDF and payment receipt handlers partly live in shared `server.js`.

All API prefixes and response contracts remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`, including twelve HTML entry points plus their root, `css/`, and `js/` assets.
- Existing root URLs such as `/plans.html`, `/payments.html`, `/quick-payment.html`, `/payment-receipt`, `/billing-statement.html`, and `/account-statement.html` are preserved through the configured module web root.
- `/payments.js` and `/plans.js` resolve from the Billing web root through shared static composition.
- Protected Billing pages retain the shared admin/customer authentication redirects.
- Payment confirmation queue pages retain their feature gates; both are disabled by the default feature profile.
- All 34 moved browser files are byte-identical to their pre-migration versions.

## Data and dependencies

- JSON is the default storage mode; optional relational paths use shared DB helpers.
- Payment confirmation proof paths remain rooted at shared `public/uploads` through `core/runtime/paths`.
- Payment backups remain rooted at `data/payment-backups`, and Cloudflared configuration remains rooted at `.cloudflared/config.yml`.
- Depends on Customer Management for customer identity, plan assignment, referral state, and archive visibility.
- Depends directly on the migrated Network backend for RouterOS connectivity, PPPoE normalization/auditing, and service enforcement; Network consumes Billing plan-profile intent.
- Collector submits payments, approvals, and remittances against Billing records.
- Customer App submits payment confirmations and displays customer balances/statements.
- Business profile and integration settings are Admin-owned shared inputs.

## Known risks and follow-up

- Billing and payment files are large and contain cross-module network/service effects; behavior changes require focused financial regression coverage.
- Scheduler changes can create duplicate or incorrectly timed charges; test Manila-time and idempotency behavior.
- Payment numbering and relational transactions are high-integrity paths.
- Shared receipt, statement, route-mount, and static-delivery logic in `server.js` requires Integration Codex locks.
- Repository-root backend aliases must not be recreated; scripts and cross-module consumers use canonical paths.
- Expand automated billing-cycle, relational transaction, and disconnection-policy tests before changing behavior.

## Validation

- `npm run refactor:billing` verifies the descriptor, retirement of thirteen root entries, 34 web files, server wiring, repository-root data paths, and representative normalization/profile/balance behavior.
- `npm run refactor:phase5` runs inventory, Core, Admin, Customer Management, Billing, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Billing asset/page URLs, feature/auth boundaries, the public plan API, and unauthenticated API denial on ports `3190`/`4190`.

## Latest meaningful changes

- 2026-07-29: Phase 12 revalidated Billing through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all thirteen Billing root shims and moved shared scripts plus Admin/Customer Management consumers to canonical Billing imports.
- 2026-07-29: Physically migrated thirteen backend implementations and 34 browser files into the Billing module, added root compatibility shims and module-loader/static wiring, preserved repository-root storage/config paths, and added Phase 5 compatibility and HTTP coverage.
- 2026-07-29: Phase 6 replaced temporary root Network imports with canonical Network backend dependencies in scheduler, disconnection, and payment flows.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
