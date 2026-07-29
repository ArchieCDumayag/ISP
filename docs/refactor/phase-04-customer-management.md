# Phase 4: Customer Management Migration

## Goal

Move Customer Management backend and browser implementations into `Features/modules/customer-management` without changing customer/referral/coverage APIs, public application flows, protected page behavior, uploads, or browser URLs.

## Runtime structure

```text
Features/modules/customer-management/
  backend/
    index.js
    customers.js
    customer-draft-submissions*.js
    customer-archive-store.js
    api_coverage.js
    referrals.js
    referral-engine.js
    philippines-addresses.js
  web/
    customers.html
    customer-draft-queue.html
    customer-archive.html
    coverage.html
    apply-now.html
    referrals.html
    coverage.css
    coverage.js
    customers.css
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Customer Management through `core/runtime/module-loader` and serves all configured module web roots before the shared `public/` fallback.

## Compatibility strategy

- Eight former root backend files remain one-line CommonJS shims.
- Each shim exports the exact canonical module instance.
- Existing API prefixes and root page/asset URLs remain unchanged.
- Canonical shared dependencies come directly from `core/`.
- Migrated Admin dependencies resolve from `Features/modules/admin/backend`.
- Temporary dependencies on unmigrated Billing, Network, and Customer App files retain their root compatibility paths.
- Upload cleanup remains rooted at `public/uploads`; tunnel config and Philippine package data remain repository-rooted.
- The dormant `web-app` stylesheet reference now points to the canonical module asset.

## Completion evidence

Completed on 2026-07-29.

- Eight backend implementations, one root stylesheet, and seventeen public files physically migrated.
- Customer Management manifest, loader, shims, web root, server wiring, root-sensitive paths, address dataset, and web-app reference verified by `npm run refactor:customer-management`.
- Current inventory validates 356 files, 353 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 181 current JavaScript files.
- Security module loading passed.
- Thirty-one isolated HTTP checks passed for both migrated modules, public Customer resources, protected page redirects, and unauthenticated API denials on ports `3190`/`4190`.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 5 physically migrates Billing while retaining root shims and all existing financial API/UI contracts.
