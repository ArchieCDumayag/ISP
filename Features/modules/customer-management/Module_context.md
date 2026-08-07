# Customer Management Module Context

Last reviewed: 2026-08-07
Status: Physically modularized and loaded through the runtime module manifest.

## Purpose and current scope

- Create, view, update, search, import, archive, restore, and delete customer records.
- Review CLIENTS LIST import warnings in an editable modal and retry only corrected skipped rows without re-importing successful records.
- Manage account numbers, identity/contact details, service addresses, coordinates, plan/service metadata, PPPoE linkage, status, and billing dates.
- Accept public applications and place them into the customer draft review workflow.
- Maintain coverage areas and public Philippine address lookup flows.
- Track customer referrals and related options/ledger presentation.

## Canonical runtime layout

- `backend/index.js` is the lazy Customer Management descriptor loaded from `module.json`.
- `backend/customers.js`: `/api/customers`, customer sessions/helpers, record lifecycle, import, archive orchestration, and cross-domain enrichment.
- `backend/customer-draft-submissions.js` and `backend/customer-draft-submissions-store.js`: Admin and Technician draft workflows.
- `backend/customer-archive-store.js`: archive retention, restore, and permanent deletion persistence.
- `backend/customer-full-json-import.js`: storage-aware merge/persistence for full customer exports when JSON storage is selected.
- `backend/api_coverage.js`: authenticated `/api/coverage` CRUD and reusable coverage reads.
- `backend/referrals.js` and `backend/referral-engine.js`: `/api/referrals`, options, and ledger calculations.
- `backend/philippines-addresses.js`: repository package-backed province, municipality, and barangay lookup.
- `web/` contains Customer Management pages and assets mounted at unchanged root URLs.

The eight former root backend shims were retired in Phase 11. Existing API prefixes and browser URLs did not change.

## Browser entry points

- `/customers.html` → `web/customers.html`
- `/customer-draft-queue.html` → `web/customer-draft-queue.html`
- `/customer-archive.html` → `web/customer-archive.html`
- `/coverage.html` → `web/coverage.html`
- `/apply-now.html` → `web/apply-now.html`
- `/referrals.html` → `web/referrals.html`

Module-owned CSS and JavaScript retain URLs such as `/css/customers.css`, `/js/apply-now.js`, `/coverage.css`, and `/coverage.js`. Shared shell/vendor assets fall through to `public/`. Network-owned coverage-map pages continue consuming `/coverage.css` through the module web mount.

Customers and Customer Draft Queue modal close controls use the shared Tabler outline-secondary icon-button contract with real `ti-x` icons; the formerly empty Customer view close button now uses the same markup.

## Data and dependencies

- Canonical storage, database, password, session, role, and path imports come from `core/`.
- Authentication, account storage, and integration settings use the migrated Admin implementation directly.
- Billing, Network, and Customer App dependencies resolve directly from their migrated module backends.
- Customer upload cleanup explicitly resolves beneath repository `public/uploads` using `PUBLIC_ROOT`.
- Cloudflared hostname discovery explicitly resolves from repository `.cloudflared` using `PROJECT_ROOT`.
- Philippine address data resolves from repository `node_modules/@jobuntux/psgc` using `PROJECT_ROOT`.
- Billing owns plans, payments, confirmations, balances, and referral discount inputs.
- The Customers table loads Billing payment records before rendering cycle state and requires backend `billingSummary` version 2 for prepaid/postpaid cycle dates, status, and reactivation balance checks. It displays Billing unavailable rather than calculating from stored customer dates or balances; postpaid generation remains month-end only.
- The shared `/api/import/customers-full` route delegates JSON-mode restoration to this module for plans, customers, payment history, tickets, jobs, SMS messages, SMS automation runs, and PON state/connections. Records are upserted by stable IDs, exact duplicate rows are collapsed, conflicting rows sharing an identity are rejected before writes, and payment fingerprint/Xendit identities cannot be reused under a different payment ID. Duplicate totals are returned to the shared UI. Unrelated data and other-branch customers are preserved, PON topology is restored before its connections, and empty-sheet `note: No records` placeholders are ignored.
- `POST /api/customers/import-clients` now returns `warningRecords` with the skipped row, editable source record, affected fields, and issue details. `POST /api/customers/import-client-corrections` validates and retries at most 100 corrected rows in the current Admin branch, using the same create/update and plan-resolution path as the original import.
- Network owns MikroTik, PPPoE, PON, GenieACS, and coverage-map consumers.
- Technician consumes customer draft, archive, customer, and coverage contracts.
- Customer App consumes customer sessions, identity, FCM tokens, and notification contracts.

## Verification contract

- `npm run refactor:customer-management` verifies the manifest loader, retirement of eight root entries, eighteen web files, server wiring, complete JSON full-import merge behavior (including Technician, SMS, and PON records), repository-root paths, Philippine dataset, and web-app stylesheet reference.
- The focused check also verifies correction-record normalization plus the warning-review button, modal, retry API call, and responsive modal styling contract.
- `npm run refactor:phase4` runs structural, core, Admin, Customer Management, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- HTTP coverage includes public application/address/coverage resources, protected-page redirects, and unauthenticated Customer Management API denial.

## Known risks and follow-up

- `backend/customers.js` remains large and crosses Billing, Network, Customer App, and Admin contracts.
- Public application and coverage-map handlers still partly live in shared `server.js`.
- `/coverage.css` is shared with Network module pages; preserve its unchanged root URL.
- Customer file cleanup is destructive by design; never test it against production data.
- Add authenticated CRUD, draft approval, archive restore/retention, dashboard export/download, and referral ledger integration tests.

## Latest meaningful changes

- 2026-08-07: Standardized Customers and Customer Draft Queue modal close controls as shared Tabler outline-secondary icon buttons and replaced the empty Customer view close control with a real `ti-x` icon; modal behavior is unchanged.
- 2026-08-06: Customers now requires backend-only `billingSummary` version 2 for prepaid/postpaid Billing Cycle display and postpaid reactivation balance checks. Stored customer dates/balances are no longer a browser fallback; postpaid generation remains month-end only and Temp remains unchanged.
- 2026-08-06: Aligned the Customers table prepaid Billing Cycle with Payments by showing the current first-of-month cycle and status plus the next first-of-month cycle, backed by the current payment-record ending balance. Postpaid and Temp remain unchanged.
- 2026-07-31: Added structured CLIENTS LIST warning records, an editable Customers-page warning modal, and a branch-scoped correction endpoint that retries only skipped rows after account or plan fixes.
- 2026-07-29: Completed the dashboard JSON backup round-trip: export now reads all branch ticket, job, SMS message/run, and PON stores, while import restores all canonical record sheets and preserves derived customer views through regeneration.
- 2026-07-29: Fixed five false warnings produced when empty ticket/job/SMS/automation/PON export sheets contributed `note: No records` placeholder rows; import parsing now removes only those placeholders before validation.
- 2026-07-29: Added storage-aware JSON restoration for `/api/import/customers-full`, covering plan/customer upserts and payment history while preserving unrelated data and returning explicit warnings for unsupported related-record tables.
- 2026-08-06: Made full backup restore idempotent across canonical sheets with exact-row deduplication, stable-identity conflict rejection, payment fingerprint/Xendit protection, and duplicate-count reporting.
- 2026-07-29: Phase 12 revalidated Customer Management through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all eight Customer Management root shims and moved Billing dependencies and data-import scripts to canonical module paths.
- 2026-07-29: Phase 10 switched FCM-token and customer-notification inbox consumers to canonical Customer App backend imports.
- 2026-07-29: Phase 4 moved eight backend implementations, one root stylesheet, and seventeen public files into this module; added manifest runtime entries, root shims, repository-safe paths, module static composition, and focused regression gates.
- 2026-07-29: Phase 6 switched MikroTik, PPPoE, and PON consumers to canonical Network backend imports while preserving all Customer Management contracts.
- 2026-07-29: Established ownership/context and moved the unreferenced compact UI screenshot into `assets/`.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
