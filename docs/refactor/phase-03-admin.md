# Phase 3: Admin and Authentication Migration

## Goal

Move the Admin/authentication implementation and owned browser files into `Features/modules/admin` without changing CommonJS consumers, API prefixes, browser URLs, authorization guards, or repository-root installer behavior.

## Runtime structure

```text
Features/modules/admin/
  backend/
    index.js
    auth.js
    accounts*.js
    activity-log*.js
    app-downloads*.js
    business-profile.js
    info-api.js
    integration-settings.js
    setup-installer.js
  web/
    accounts.html
    accounts.js
    flavors.html
    install-guide.html
    login.html
    setup.html
    update-download.html
    css/
    js/
```

`module.json` now declares both runtime entries. `server.js` loads the Admin backend descriptor through `core/runtime/module-loader` and mounts the module web root after HTML authorization checks. Shared assets fall through to `public/`.

## Compatibility strategy

- Eleven former root backend filenames remain one-line CommonJS shims.
- Each shim exports the exact canonical Admin module instance.
- All existing `/api/*` prefixes and root browser URLs remain unchanged.
- Root asset resolution prefers the Admin web file before a same-named backend shim; `/accounts.js` therefore remains the browser bundle.
- Canonical Admin code imports shared primitives directly from `core/`.
- Temporary dependencies on unmigrated domains resolve through their existing root files.
- `service-config.json` and `structure-manifest.json` remain at the repository root.
- The installer uses `PROJECT_ROOT`, validates the migrated Admin package paths, and recognizes module pages in page-scoped update packages.

## Completion evidence

Completed on 2026-07-29.

- Eleven backend implementations and ten web files physically migrated.
- Admin module manifest, backend loader, web root, root shims, server wiring, and installer paths verified by `npm run refactor:admin`.
- Current inventory validates 345 files, 348 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 171 current JavaScript files.
- Shared asset references from migrated and legacy pages resolve through the mounted web roots.
- Security module loading passed.
- Isolated HTTP checks passed for Admin pages/assets, protected redirects, owner-route denial, and unauthenticated APIs on ports `3190`/`4190`.
- Production files, service, ports, environment, and data were not changed.

## Historical next phase

Phase 4 physically migrates Customer Management while retaining root shims and existing public/API contracts.
