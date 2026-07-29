# Phase 9: Finance Migration

## Goal

Move Finance backend and browser implementations into `Features/modules/finance` without changing expense, payroll, reporting, authorization, feature-gate, storage, or browser contracts.

## Runtime structure

```text
Features/modules/finance/
  backend/
    index.js
    expenses.js
    payroll.js
  web/
    expenses.html
    payroll.html
    reports.js
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Finance through `core/runtime/module-loader`, mounts its routers at the existing API paths, and serves its web root through the existing static and explicit route guards.

## Compatibility strategy

- Two former root backend paths remain one-line CommonJS shims that export the exact canonical module instances.
- Nine browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- Canonical Finance dependencies use shared `core/` data, storage-mode, and role contracts directly.
- The authenticated collection-breakdown handler remains shared in `server.js`; retained report assets continue consuming Billing and Collector APIs through unchanged browser URLs.
- Expense and payroll Admin-role, branch, feature, JSON/MySQL, legacy-import, and response contracts remain unchanged.
- No financial mutation was used for acceptance testing.

## Completion evidence

Completed on 2026-07-29.

- Two backend implementations and nine public files physically migrated.
- Finance descriptor, manifest, shims, web root, server wiring, canonical dependencies, route definitions, and reporting-asset contracts verified by `npm run refactor:finance`.
- All nine migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 401 files, 368 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 221 current JavaScript files.
- Security module loading passed.
- One hundred eighteen isolated HTTP checks passed for migrated Admin, Customer Management, Billing, Network, Collector, Technician, and Finance resources, page guards, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Tests did not create, update, submit, or delete expense/payroll data and did not read protected financial records.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 10 physically migrates Customer App and communications while retaining root shims and all existing portal, notification, Firebase, Messenger, SMS, authentication, storage, and browser contracts.
