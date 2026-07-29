# Phase 11: Shared Integration Cleanup

## Goal

Finish the canonical module cutover for shared server composition, frontend delivery, operational scripts, installer packages, and configuration paths without changing API routes, browser URLs, storage defaults, authorization boundaries, or production state.

## Runtime cleanup

- `core/runtime/module-loader.js` now builds all eight configured backend/web runtimes from the module registry through `loadModuleRuntimes()`.
- `server.js` uses that runtime map for named module dependencies and static web roots.
- Shared environment, data, security, storage-mode, feature, and path dependencies resolve directly from `core/`.
- Repository paths in shared composition use `PROJECT_ROOT`, `PUBLIC_ROOT`, and `DATA_DIR` rather than `__dirname` reconstruction.
- Shared shell, layout, vendor, branding, and integration-owned browser files remain under `public/`; module files remain under their module `web/` roots.
- The general repository-root asset fallback was removed. It was no longer needed after all browser assets moved and could expose root JavaScript such as `/server.js`.

## Canonical dependency cutover

- Retired 11 Core root shims and 59 business-module root/`routes` shims after confirming every live consumer.
- Converted the remaining Admin and Customer Management Billing imports to canonical module paths.
- Converted schema, migration, maintenance, import, flavor, security, query, launcher, and helper scripts to canonical Core/module/path imports.
- Removed the obsolete root `styles.css`; the live shared stylesheet remains `public/styles.css` at the unchanged `/styles.css` URL.
- Simplified module `ownedPaths` to canonical module roots, retaining only the Admin-owned `service-config.json` and `structure-manifest.json` root configuration files.

## Installer and validation

- Structure ZIP validation and page downloads now require only `Features/modules/admin/backend/setup-installer.js`, not the retired root alias.
- Existing module checks now verify root-entry retirement as well as canonical backend, web, route, and helper contracts.
- `npm run refactor:integration` validates canonical-only root layout, eight manifest runtimes, shared frontend placement, server static isolation, installer paths, manifests, scripts, and cross-module imports.
- `npm run refactor:phase11` runs the complete Phase 11 structural, module, integration, security, and HTTP suite.

## Completion evidence

Completed on 2026-07-29.

- Current inventory validates 345 files, 321 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passes for all 164 current JavaScript files, and all tracked/current JSON files parse successfully.
- All eight module descriptors and web roots load through the manifest registry.
- Security module loading uses canonical Core/module paths and passes.
- One hundred fifty-two isolated HTTP checks pass on ports `3190`/`4190`, including shared assets, every module resource/guard/API boundary, and a negative `/server.js` source-exposure check.
- Existing production under `/opt/isp-billing`, systemd service `isp-billing`, ports `3000`/`4001`, environment, and data were not modified or restarted.

## Subsequent phase

Phase 12 subsequently performed the final full regression, reconciled historical/current documentation, and produced the cutover-readiness assessment.
