# Collector Module Context

Last reviewed: 2026-07-29
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Assign collectors to service areas and report assignment/collection state.
- Provide collector-specific customer/payment options and next-due resolution.
- Capture field payments and support receipt reprinting.
- Manage approval queues and approve/reject collected entries.
- Create, confirm, and reject remittances.
- Present collection history and reports.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/collectors.js`: assignment CRUD/reporting under `/api/collectors`.
- `backend/collector-payments.js`: options, reprints, payment submission, approvals, and remittances under `/api/collector/payments`.
- `backend/collector-next-due.js`: resolves account collection timing and is consumed directly by Admin authentication/information flows.
- `backend/routes/collectors.js`: retained dormant relational route implementation; it is not mounted by `server.js` and is available only at its canonical module path.
- The former four repository-root/`routes` backend shims were retired in Phase 11.
- Collector login/session/map/transaction endpoints are implemented in Admin-owned `auth.js` under `/api/auth`.

All API prefixes, collector/admin authentication requirements, feature gates, and response contracts remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: two HTML entry points, three stylesheets, and two JavaScript files.
- Existing URLs remain `/collectors.html`, `/collectors-history.html`, `/collectors`, and `/collectors-history`.
- Both pages retain the shared Admin authentication and Collector feature guards.
- All seven moved browser files are byte-identical to their pre-migration versions.

## Data and dependencies

- Canonical storage, database, and role imports come from `core/`.
- Depends directly on migrated Admin accounts/roles and collector authentication.
- Depends on Customer Management for customer identity, area, and account number.
- Depends directly on migrated Billing for canonical payment records, entry numbering, balances, and service refresh.
- Remittance and approval data may be consumed by Finance reporting.

## Known risks and follow-up

- Payment capture and approval must remain idempotent and preserve entry numbering.
- Collector authentication routes live outside the module and require Admin/Integration coordination.
- Verify permissions for collector versus admin operations after any route change.
- Repository-root backend aliases must not be recreated.
- Add authenticated end-to-end capture, approval, rejection, remittance, reprint, and idempotency tests before changing financial behavior.

## Validation

- `npm run refactor:collector` verifies the descriptor, retirement of four root entries, seven web files, server wiring, canonical dependencies, the dormant canonical route, and representative next-due behavior.
- `npm run refactor:phase7` runs inventory, Core, Admin, Customer Management, Billing, Network, Collector, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Collector asset/page URLs and unauthenticated assignment, payment, and collector-session denials on ports `3190`/`4190`.
- Acceptance tests do not submit, approve, reject, reprint, or remit payments.

## Latest meaningful changes

- 2026-07-29: Phase 12 revalidated Collector through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all four Collector root/`routes` shims; the dormant relational router remains canonical and unmounted.
- 2026-07-29: Physically migrated four backend implementations and seven browser files into the Collector module, added compatibility shims and module-loader/static wiring, converted Admin next-due consumers to canonical imports, and added Phase 7 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
