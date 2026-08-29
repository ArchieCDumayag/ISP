# Network Module Context

Last reviewed: 2026-08-29
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Configure and test MikroTik router connectivity.
- List, create, sync, inspect, and remove PPPoE accounts and profiles.
- Observe PPPoE active state and traffic.
- Maintain PON/NAP/port assignment state and overview data.
- Read and operate GenieACS-managed devices, including summon and WiFi actions.
- Support direct connected-device and WiFi-password operations.
- Display network/customer and PON state on coverage maps.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/mikrotik.js`: `/api/mikrotik` operations for tests, PPPoE, profiles, traffic, sync, and router information. Active PPPoE creation is serialized with Billing's customer/payment lifecycle boundary and rejects both an active permanent closure and an unconsumed closed-balance/pending-payment reconnection decision. When a cached PPPoE link lacks an account number, activation resolves the canonical customer by normalized PPPoE username before applying the same guard.
- `backend/mikrotik-client.js` and `backend/mikrotik-endpoint.js`: RouterOS connectivity and endpoint normalization.
- `backend/mikrotik-audit-log.js`: records network commands through the Admin activity log.
- `backend/pon-management-api.js`: `/api/pon/state`, `/api/pon/overview`, and PON state updates. State and overview reads expose an opaque `revision`; full-state `PUT /api/pon/state` requires the matching `expectedRevision`, returns the next revision, and rejects stale snapshots with `409 PON_STATE_CONFLICT` before changing records.
- `backend/pon-serviceability.js` supplies both the distance-limited online/free-port candidate contract and an expanded-limit coverage-map mode that still enforces its requested radius while retaining full or offline NAPs inside it, with a numbered `ports` roster. Each port is classified as `available`, `occupied`, `reserved`, or `unavailable`; only an online unoccupied/unreserved port is selectable. Customer labels remain internal until the Technician route applies its dedicated coverage-map sanitizer.
- PON revisions hash only persisted OLT, NAP, and port-assignment fields, excluding live/derived subscriber status. JSON comparisons run under the shared branch mutation lock. MySQL saves acquire the branch row and PON rows inside one transaction before comparing, and Technician reservation/finalization mutations acquire the same branch row so a later admin snapshot cannot overwrite a completed field assignment. Before either JSON or MySQL accepts a full Admin save, active reservations are also checked against the proposed topology: their NAP cannot be removed or reduced below the reserved port, and the held port cannot be assigned through PON Management.
- `backend/pppoe-account-utils.js`: shared PPPoE normalization, merge, and deduplication helpers.
- The former six repository-root backend shims were retired in Phase 11; consumers use canonical Network paths or the module descriptor.
- GenieACS and direct-device handlers currently live in shared `server.js`.

All API prefixes, authorization requirements, feature gates, and response contracts remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: five HTML entry points, five stylesheets, and three JavaScript files.
- Existing URLs remain `/pppoe.html`, `/pon-management.html`, `/genieacs.html`, `/coverage-map.html`, and `/coverage-map-app.html`.
- PPPoE, PON, GenieACS, and the administrative coverage map retain shared feature and authentication guards.
- The application coverage map remains public at `/coverage-map-app.html` and `/coverage-map-app`.
- `web/css/leaflet-popups-tabler.css` gives administrative/public coverage-map subscriber, NAP, and network-link popups plus PON coordinate reference popups one shared responsive Tabler card presentation with avatars, status badges, lists, progress, dark mode, and one Tabler-style close control. It styles Leaflet's native close glyph and suppresses generated pseudo-element glyphs to prevent duplicate close icons.
- `web/pppoe.html` uses Tabler page headers, cards, responsive grids, controls, tables, badges, progress bars, and modals while preserving every existing PPPoE DOM ID and action hook.
- `web/css/pppoe-tabler.css` is the only PPPoE-specific presentation layer. The page no longer loads Admin `accounts.css` or Customer account-view CSS; it retains the shared shell, Tabler vendor, `tabler-app.css`, and account browser-player JavaScript contract.
- `web/js/pppoe.js` renders Tabler icons and table components and spaces live-traffic chart samples across the available plot width; router, customer binding, sync, CRUD, traffic, and persistence APIs are unchanged.
- The PPPoE account list defaults to 50 rows per page and uses a compact eight-column fixed-layout Tabler table. Caller ID remains available in runtime data but is hidden from the list; Username receives the largest width, long values retain native title tooltips, and the table falls back to horizontal scrolling only below its 840px readable width.
- The missing-configuration alert uses a true `hidden` state that cannot be overridden by Tabler display utilities. An enabled integration hides the alert immediately, and any confirmed MikroTik connection also clears it while restoring the workbench.
- Other Network pages continue consuming their existing Customer Management coverage styles, Billing helpers, and shared shell/vendor assets through unchanged root URLs.
- `web/js/pon-management.js` retains the loaded PON revision, sends it with every debounced or immediate save, adopts the revision returned by a successful save, and reloads the latest server state on a conflict. If that reload fails, PON editing is disabled instead of retrying a stale full snapshot.

## Data and dependencies

- Router, GenieACS, and mapping credentials/settings come from Admin-owned integration configuration.
- Canonical shared database and storage imports come from `core/`; migrated Admin, Customer Management, and Billing dependencies resolve directly from their module backends.
- Customer Management supplies customer identity, account number, coordinates, coverage, and PPPoE bindings.
- Billing supplies plan-profile intent and service enforcement triggers.
- Technician installation workflows consume the canonical Network PON, PPPoE, and MikroTik backends directly.
- Activity auditing crosses into Admin-owned logs.
- Dashboard full backups serialize branch-scoped JSON PON state into Excel-safe chunks plus a flattened connection sheet; import restores topology first, then upserts customer connections by connection ID or port.

## Known risks and follow-up

- Router changes affect live subscriber connectivity; testing should use explicit safe targets or mocks.
- Direct WiFi and PPPoE delete paths require strict auth, validation, and audit checks.
- GenieACS, direct-device, public coverage-map, route-mount, and static-delivery logic in `server.js` requires Integration Codex coordination.
- JSON PON mutation serialization is process-local, so JSON deployments should keep a single application writer process; MySQL uses the database branch-row lock for cross-process serialization.
- Do not place integration secrets in module context, logs, fixtures, or commits.
- Repository-root backend aliases must not be recreated.
- Add mocked RouterOS/GenieACS adapter tests and authenticated mutation tests before changing live network behavior.

## Validation

- `npm run refactor:network` verifies the descriptor, retirement of six root entries, 13 web files, server wiring, canonical cross-module dependencies, representative endpoint/PPPoE/audit/client/PON helper behavior, shared Tabler Leaflet popup structure, and the PPPoE page's focused Tabler dependency and component contract.
- `npm run refactor:phase6` runs inventory, Core, Admin, Customer Management, Billing, Network, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Network asset/page URLs, authentication and feature boundaries, public coverage-map data, and unauthenticated MikroTik/PON/GenieACS denials on ports `3190`/`4190`.
- No acceptance check connects to or mutates a router or GenieACS device.
- 2026-08-14 PPPoE UI validation: `npm run refactor:network` and full `npm test` passed; authenticated browser checks confirmed the live summary/table, edit modal, customer assignment autocomplete, traffic modal/canvases, preserved 109-ID selector contract, focused stylesheet loading, and no console errors. Browser checks did not submit a form or mutate router/customer state.
- 2026-08-14 compact-table validation: JavaScript syntax and `npm run refactor:network` passed; an authenticated browser check confirmed 50 rendered rows, the `Showing 1-50 of 398` footer, eight pages, fixed aligned columns, and no record-changing action.
- 2026-08-14 warning/column validation: JavaScript syntax and `npm run refactor:network` passed; an authenticated browser check confirmed the connected-router warning is hidden, Caller ID is absent, all eight headers fit, Username is widened, and 50 rows still render without any record-changing action.
- 2026-08-16 PON revision validation: backend/UI/test JavaScript syntax passed, the focused revision regression proved a stale JSON admin snapshot cannot erase a technician-added connection, the existing six serviceability tests passed, and `npm run refactor:network` passed. MySQL compatibility additionally asserts the shared branch-row transaction lock and revision helper contract without connecting to a live database.
- 2026-08-16 reservation-save validation: the isolated JSON regression proves a pre-reservation Admin snapshot cannot assign a held port, while an unrelated topology edit still succeeds and preserves the reservation; the same compatibility helper runs against MySQL reservation rows locked inside the Admin transaction.
- 2026-08-25 coverage-map validation: focused serviceability tests prove full and offline NAPs inside 600 meters remain visible, farther NAPs are excluded, every numbered port has a deterministic status, occupied ports retain the internal client label, and only online free ports are marked available.

## Latest meaningful changes

- 2026-08-29: Extended PPPoE activation protection through Customer Archive Reopen. A reopened subscriber remains blocked while the Final Closed Customer Balance or pending-payment reconnection is unsettled, including username-only saves whose cached PPPoE row lacks an account link.

- 2026-08-26: Guarded active PPPoE creation with the shared Billing mutation boundary and current Customer closure overlay. Closed-account payments remain financial-only and cannot recreate or enable PPPoE service.

- 2026-08-25: Added expanded-limit coverage-map candidates to PON serviceability, then constrained the Android technician contract to all coordinate-valid NAPs within a server-enforced 600-meter radius. Complete port-status rosters remain available inside the radius while original nearby endpoint defaults remain unchanged.
- 2026-08-16: Added an active-reservation compatibility guard to JSON/MySQL full-state Admin saves so PON Management cannot remove a held NAP, shrink past its held port, or assign that port while a technician reservation is live.
- 2026-08-16: Added optimistic PON branch revisions to state/overview reads and full-state saves, required `expectedRevision`, serialized MySQL admin and Technician mutations on the same branch row, and made the PON browser reload authoritative state after a `409` conflict so a stale admin tab cannot erase a technician finalize.
- 2026-08-14: Fixed the false MikroTik warning by removing the conflicting Tabler display utility and synchronizing its hidden state with integration/connection success; removed Caller ID from the list, widened Username, and rebalanced all eight columns without changing stored PPPoE data.
- 2026-08-14: Compacted the PPPoE account table with Tabler `table-sm`, fixed column proportions, smaller cells/avatar/actions, ellipsis plus title tooltips, and a fresh default of 50 rows per page; PPPoE APIs and records are unchanged.
- 2026-08-14: Rebuilt `/pppoe.html` with Tabler page, card, metric, toolbar, table, form, progress, badge, and modal components; replaced the page-wide Admin/account-view CSS dependencies with Network-owned `web/css/pppoe-tabler.css`; retained all 109 DOM IDs and all existing router/customer/payment-independent behavior; improved live-chart time-label spacing; and added focused Network compatibility assertions.
- 2026-08-07: Removed the duplicate Leaflet popup close icon by retaining and styling only Leaflet's native close glyph; the popup card layout is unchanged.
- 2026-08-07: Replaced default/custom Leaflet popup content on both coverage maps and the PON coordinate picker with a shared responsive Tabler card UI, including status badges, icons, structured lists, NAP port progress, dark mode, and mobile sizing.
- 2026-07-29: Added branch-scoped PON topology and customer-connection round-trip behavior to the shared dashboard full backup/import workflow; live router operations are not invoked.
- 2026-07-29: Phase 12 revalidated Network through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all six Network root shims; runtime and scripts now resolve Network code only through canonical module paths.
- 2026-07-29: Updated the Technician provisioning dependency after Phase 8 to resolve canonical Network backends directly.
- 2026-07-29: Physically migrated six backend implementations and 11 browser files into the Network module, added root compatibility shims and module-loader/static wiring, converted migrated-module consumers to canonical imports, and added Phase 6 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
