# Phase 5: Billing Migration

## Goal

Move Billing backend and browser implementations into `Features/modules/billing` without changing financial APIs, stored-data locations, authentication and feature gates, or existing browser URLs.

## Runtime structure

```text
Features/modules/billing/
  backend/
    index.js
    billing-scheduler.js
    disconnection-store.js
    disconnections.js
    payment-*.js
    payments.js
    plan-profile-utils.js
    plans.js
  web/
    plans.html
    payments.html
    payment-*.html
    disconnections.html
    account-statement.html
    billing-statement.html
    quick-payment.html
    thermal-print.html
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Billing through `core/runtime/module-loader`, mounts its routers at the existing API paths, and serves its web root after the existing page guards.

## Compatibility strategy

- Thirteen former root backend files remain one-line CommonJS shims that export the exact canonical module instances.
- Thirty-four browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- The static resolver serves module browser files before repository-root shims, preserving the `/payments.js` and `/plans.js` filename collisions.
- Canonical Billing dependencies use `core/`, Admin, and Customer Management paths directly. Unmigrated Network dependencies temporarily retain root compatibility paths.
- Proof uploads remain under `public/uploads`, payment backups remain under `data/payment-backups`, and Cloudflared configuration remains under `.cloudflared/`.
- Shared statement and receipt handlers continue to live in `server.js`, but now resolve templates from the Billing web root.

## Completion evidence

Completed on 2026-07-29.

- Thirteen backend implementations and 34 public files physically migrated.
- Billing descriptor, manifest, shims, web root, server wiring, storage/config paths, and representative helper behavior verified by `npm run refactor:billing`.
- All 34 migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 372 files, 362 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 200 current JavaScript files.
- Security module loading passed.
- Fifty-six isolated HTTP checks passed for migrated Admin, Customer Management, and Billing resources, protected/feature-gated pages, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 6 physically migrates Network while retaining root shims and all existing MikroTik, PPPoE, PON, GenieACS, and coverage-map contracts.
