# Phase 6: Network Migration

## Goal

Move Network backend and browser implementations into `Features/modules/network` without changing RouterOS, PPPoE, PON, GenieACS, direct-device, coverage-map, authentication, feature-gate, or browser contracts.

## Runtime structure

```text
Features/modules/network/
  backend/
    index.js
    mikrotik-audit-log.js
    mikrotik-client.js
    mikrotik-endpoint.js
    mikrotik.js
    pon-management-api.js
    pppoe-account-utils.js
  web/
    pppoe.html
    pon-management.html
    genieacs.html
    coverage-map.html
    coverage-map-app.html
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Network through `core/runtime/module-loader`, mounts its routers at the existing API paths, and serves its web root after the existing page guards.

## Compatibility strategy

- Six former root backend files remain one-line CommonJS shims that export the exact canonical module instances.
- Eleven browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- Canonical Network dependencies use `core/`, Admin, Customer Management, and Billing paths directly.
- Already-migrated Admin, Customer Management, and Billing consumers now resolve Network dependencies directly. Unmigrated Technician code temporarily retains root compatibility imports.
- Shared Admin styles, Customer Management coverage styles, Billing current-bill helpers, shell assets, and vendor assets continue resolving at their existing URLs.
- Shared GenieACS, direct-device, and public coverage-map handlers remain in `server.js`; explicit Network page handlers now resolve templates from the Network web root.

## Completion evidence

Completed on 2026-07-29.

- Six backend implementations and 11 public files physically migrated.
- Network descriptor, manifest, shims, web root, server wiring, canonical cross-module imports, and representative helper contracts verified by `npm run refactor:network`.
- All 11 migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 381 files, 365 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 208 current JavaScript files.
- Security module loading passed.
- Seventy-two isolated HTTP checks passed for migrated Admin, Customer Management, Billing, and Network resources, page guards, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Tests did not connect to or mutate any live network device.
- Production files, service, ports, environment, data, and devices were not changed.

## Historical next phase

Phase 7 physically migrates Collector while retaining root shims and all existing assignment, collection, approval, receipt, and remittance contracts.
