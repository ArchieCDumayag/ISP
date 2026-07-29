# Network Module Context

Last reviewed: 2026-07-29
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
- `backend/mikrotik.js`: `/api/mikrotik` operations for tests, PPPoE, profiles, traffic, sync, and router information.
- `backend/mikrotik-client.js` and `backend/mikrotik-endpoint.js`: RouterOS connectivity and endpoint normalization.
- `backend/mikrotik-audit-log.js`: records network commands through the Admin activity log.
- `backend/pon-management-api.js`: `/api/pon/state`, `/api/pon/overview`, and PON state updates.
- `backend/pppoe-account-utils.js`: shared PPPoE normalization, merge, and deduplication helpers.
- The former six repository-root backend shims were retired in Phase 11; consumers use canonical Network paths or the module descriptor.
- GenieACS and direct-device handlers currently live in shared `server.js`.

All API prefixes, authorization requirements, feature gates, and response contracts remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: five HTML entry points, three stylesheets, and three JavaScript files.
- Existing URLs remain `/pppoe.html`, `/pon-management.html`, `/genieacs.html`, `/coverage-map.html`, and `/coverage-map-app.html`.
- PPPoE, PON, GenieACS, and the administrative coverage map retain shared feature and authentication guards.
- The application coverage map remains public at `/coverage-map-app.html` and `/coverage-map-app`.
- Network pages continue consuming shared Admin styles, Customer Management coverage styles, Billing current-bill helpers, and shared shell/vendor assets through their unchanged root URLs.
- All 11 moved browser files are byte-identical to their pre-migration versions.

## Data and dependencies

- Router, GenieACS, and mapping credentials/settings come from Admin-owned integration configuration.
- Canonical shared database and storage imports come from `core/`; migrated Admin, Customer Management, and Billing dependencies resolve directly from their module backends.
- Customer Management supplies customer identity, account number, coordinates, coverage, and PPPoE bindings.
- Billing supplies plan-profile intent and service enforcement triggers.
- Technician installation workflows consume the canonical Network PON, PPPoE, and MikroTik backends directly.
- Activity auditing crosses into Admin-owned logs.

## Known risks and follow-up

- Router changes affect live subscriber connectivity; testing should use explicit safe targets or mocks.
- Direct WiFi and PPPoE delete paths require strict auth, validation, and audit checks.
- GenieACS, direct-device, public coverage-map, route-mount, and static-delivery logic in `server.js` requires Integration Codex coordination.
- Do not place integration secrets in module context, logs, fixtures, or commits.
- Repository-root backend aliases must not be recreated.
- Add mocked RouterOS/GenieACS adapter tests and authenticated mutation tests before changing live network behavior.

## Validation

- `npm run refactor:network` verifies the descriptor, retirement of six root entries, 11 web files, server wiring, canonical cross-module dependencies, and representative endpoint/PPPoE/audit/client/PON helper behavior.
- `npm run refactor:phase6` runs inventory, Core, Admin, Customer Management, Billing, Network, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Network asset/page URLs, authentication and feature boundaries, public coverage-map data, and unauthenticated MikroTik/PON/GenieACS denials on ports `3190`/`4190`.
- No acceptance check connects to or mutates a router or GenieACS device.

## Latest meaningful changes

- 2026-07-29: Phase 12 revalidated Network through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all six Network root shims; runtime and scripts now resolve Network code only through canonical module paths.
- 2026-07-29: Updated the Technician provisioning dependency after Phase 8 to resolve canonical Network backends directly.
- 2026-07-29: Physically migrated six backend implementations and 11 browser files into the Network module, added root compatibility shims and module-loader/static wiring, converted migrated-module consumers to canonical imports, and added Phase 6 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
