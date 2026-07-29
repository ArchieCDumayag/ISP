# Phase 8: Technician Migration

## Goal

Move Technician backend and browser implementations into `Features/modules/technician` without changing ticket, job, assignment, history, installation, provisioning, authentication, feature-gate, storage, or browser contracts.

## Runtime structure

```text
Features/modules/technician/
  backend/
    index.js
    job-numbering.js
    jobs.js
    technician-assignments.js
    technician-installations.js
    tickets.js
  web/
    job-history.html
    technician-customer-drafts.html
    technicians.html
    tickets.html
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Technician through `core/runtime/module-loader`, mounts its routers at the existing API paths, and serves its web root through the existing static and explicit route guards.

## Compatibility strategy

- Five former root backend paths remain one-line CommonJS shims that export the exact canonical module instances.
- Eleven browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- Canonical Technician dependencies use `core/`, Admin, Customer Management, Billing, and Network paths directly.
- Customer Management continues to own customer/application records and the technician-token routers; Admin continues to own account and role records.
- Shared migration scripts retain the root job-numbering compatibility path until the Phase 11 scripts cleanup.
- No route, feature flag, authentication boundary, stored-data key, or response contract was intentionally changed.

## Completion evidence

Completed on 2026-07-29.

- Five backend implementations and 11 public files physically migrated.
- Technician descriptor, manifest, shims, web root, server wiring, canonical dependencies, and representative helper/router contracts verified by `npm run refactor:technician`.
- All 11 migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 396 files, 368 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 217 current JavaScript files.
- Security module loading passed.
- One hundred five isolated HTTP checks passed for migrated Admin, Customer Management, Billing, Network, Collector, and Technician resources, page guards, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Tests did not create/update tickets or jobs, execute installation actions, or connect to/mutate PON, PPPoE, MikroTik, customer, or production data.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 9 physically migrates Finance while retaining root shims and all existing expense, payroll, dashboard, authorization, storage, and browser contracts.
