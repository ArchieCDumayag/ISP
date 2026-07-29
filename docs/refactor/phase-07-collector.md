# Phase 7: Collector Migration

## Goal

Move Collector backend and browser implementations into `Features/modules/collector` without changing assignment, payment capture, approval, receipt, remittance, authentication, feature-gate, storage, or browser contracts.

## Runtime structure

```text
Features/modules/collector/
  backend/
    index.js
    collector-next-due.js
    collector-payments.js
    collectors.js
    routes/
      collectors.js
  web/
    collectors.html
    collectors-history.html
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Collector through `core/runtime/module-loader`, mounts its routers at the existing API paths, and serves its web root after the existing page guards.

## Compatibility strategy

- Four former root/`routes` backend paths remain one-line CommonJS shims that export the exact canonical module instances.
- Seven browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- Canonical Collector dependencies use `core/`, Admin, and Billing paths directly.
- Admin collector login and information flows now resolve the next-due helper directly from the Collector backend.
- The dormant `routes/collectors.js` implementation remains unmounted, as before, but both its canonical and legacy import paths are preserved.
- Collector authentication/session endpoints continue living in Admin `auth.js`; server composition and page guards retain their existing behavior.

## Completion evidence

Completed on 2026-07-29.

- Four backend implementations and seven public files physically migrated.
- Collector descriptor, manifest, shims, web root, server wiring, canonical dependencies, dormant route, and next-due behavior verified by `npm run refactor:collector`.
- All seven migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 388 files, 367 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 214 current JavaScript files.
- Security module loading passed.
- Eighty-five isolated HTTP checks passed for migrated Admin, Customer Management, Billing, Network, and Collector resources, page guards, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Tests did not submit, approve, reject, reprint, or remit any payment.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 8 physically migrates Technician while retaining root shims and all existing ticket, job, assignment, installation, and provisioning contracts.
