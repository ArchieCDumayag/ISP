# Technician Module Context

Last reviewed: 2026-08-08
Status: Canonical module runtime with an Admin field-service dispatch foundation; the standalone Android technician app is intentionally deferred.

## Purpose and current scope

- Create repair, installation, outage, maintenance, and other field work orders.
- Assign or reassign technicians, prioritize work, schedule appointment windows, and track SLA deadlines.
- Snapshot the canonical customer account, contact, address, coordinates, and plan on each work order so field details remain auditable.
- Track the canonical workflow: `unassigned -> assigned -> accepted -> traveling -> on_site -> completed`, with rejected, failed, rescheduled, needs-team, and cancelled outcomes.
- Record diagnosis, work performed, signal readings, speed tests, equipment, materials, photo references, signatures, completion confirmation, and outcome reasons.
- Show open jobs with valid coordinates on a Leaflet map, identify jobs missing GPS, open the affected work order directly for location correction, open Google Maps or Waze, review technician workload, filter jobs, and export the dispatch list as CSV.
- Maintain existing support-ticket, customer-installation, PON, PPPoE, job-numbering, and job-history behavior.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/tickets.js` owns public/customer and authenticated ticket operations under `/api/tickets`.
- `backend/jobs.js` owns Admin dispatch CRUD and reporting under `/api/jobs`.
- `backend/dispatch-workflow.js` is the shared normalization, validation, transition, structured-payload, and audit-event contract.
- `backend/job-events.js` persists append-only dispatch events with branch-scoped offline idempotency keys.
- `backend/technician-assignments.js` exposes only the authenticated technician's assigned jobs/tickets under `/api/technician`.
- `backend/technician-installations.js` retains technician customer/PON/PPPoE installation workflows under `/api/technician/installations`.
- `backend/job-numbering.js` retains manual job-number schema, backfill, formatting, and fallback helpers.

Dispatch endpoints:

- `GET /api/jobs`: canonical branch work orders.
- `GET /api/jobs/dispatch-summary`: status metrics and technician workload.
- `GET /api/jobs/export.csv`: current branch dispatch report.
- `GET /api/jobs/:id/events`: append-only work-order audit timeline.
- `POST /api/jobs`: create a work order; customer snapshots are resolved on the backend.
- `PATCH /api/jobs/:id`: edit or reassign a work order.
- `PATCH /api/jobs/:id/status`: Admin status override with optimistic version checks.
- `GET /api/technician/jobs`: only jobs assigned to the authenticated technician.
- `PATCH /api/technician/jobs/:id/status`: validated technician status transition.
- `POST /api/technician/jobs/sync`: ordered offline mutation batch, limited to 100 changes, using retry-safe `clientEventId` values.
- Existing done/undo/assign/delete endpoints remain available. Existing one-tap technician completion remains compatible from assigned, accepted, or traveling states.

Customer Management supplies customer snapshots, canonical customer coordinates used to resolve NAP links, and technician login/session records. Admin supplies account roles. Network supplies branch-scoped `/api/pon/state` data for the Job Map's NAP and link overlays and retains installation provisioning dependencies. Billing retains its installation dependencies.

## Frontend entry points

- `/technicians.html` is the Admin dispatch dashboard. A dispatcher currently operates it through an Admin account because the shared authentication model has no separate Dispatcher or Supervisor role.
- It contains Tabler-native KPI cards, search/filter controls, a paginated work-order table, technician workload list, Leaflet job-map card, create/edit form modal, operational evidence cards, status override, and audit timeline. Module CSS is limited to dispatch-specific layout, map sizing/overlay behavior, Leaflet integration, and explicit modal visibility rather than recreating Tabler components.
- The map uses center-anchored transparent Tabler job and NAP markers so work-order links terminate at each icon's visual center, plus separate **Work Orders**, **Used NAPs**, and **Work Order Links** switches. It consumes canonical branch PON state but renders only open work-order routes: one route per customer, only NAPs used by those routes, and only assigned NAP ports related to the displayed jobs. Assigned routes are solid green; unassigned customers use a dashed orange nearest-NAP fallback. Links appear at zoom 14 or higher, and repair/installation details emphasize the selected route. Network layers default off on small screens unless the user has saved a preference.
- Job Map continues to report missing work-order coordinates, show actionable empty/offline states, and open the first affected job's Map Pin field through **Add job location** or **Review**. The work-order Map Pin defaults from the selected customer, accepts decimal or DMS coordinates, normalizes them to decimal latitude/longitude, and can be corrected for that job.
- Work-order details provide call, SMS, Google Maps, and Waze links when customer data is available.
- `/tickets.html`, `/job-history.html`, and `/technician-customer-drafts.html` retain their existing responsibilities and URLs.
- Dispatch dialogs ignore backdrop and Escape dismissal; users close them through explicit Close/Cancel controls or a successful action.

## Data and persistence

- JSON mode stores work orders in `jobs` and audit events in `technician_job_events`.
- Relational mode adds appointment end, SLA due, canonical workflow status, customer snapshot, coordinates, plan snapshot, structured dispatch JSON, and record version columns to `jobs`.
- Relational audit events live in `technician_job_events`; the `(branch_id, client_event_id)` unique key makes offline retries idempotent.
- The migration is additive and backfills legacy scheduled/in-progress/done jobs into the canonical workflow without deleting existing job data.
- Full project backup already exports/imports the expanded `jobs` row fields. The append-only `technician_job_events` table is not yet part of the full backup workbook and must be added before audit-history backup is advertised as complete.

## Android boundary

- The planned Android technician app must be a separate project/package from the Collector app, with separate local storage, offline queue, and app identity.
- It should consume `/api/technician/jobs`, `/api/technician/jobs/:id/status`, and `/api/technician/jobs/sync` rather than duplicating dispatch rules locally.
- Camera upload transport, binary photo storage, barcode/ONU scanning, push notifications, customer OTP confirmation, and device-level offline database work are deferred to that app phase. Current work orders store safe metadata/references for these fields.

## Known risks and follow-up

- Run the additive schema migration before starting a MySQL deployment with this code.
- Leaflet map tiles require internet access; the table and workload views remain usable if tiles are unavailable.
- Job Map link overlays appear only at zoom 14 or higher. Multiple open work orders for the same customer share one route; unmatched work orders are reported in the summary, and nearest-NAP fallbacks are explicitly labeled rather than presented as assigned ports.
- Installation actions may change live PON/PPPoE state; preserve existing validation and audit behavior.
- Add audit-event export/import before promising restorable immutable history.
- Add binary evidence storage, signed upload URLs, malware/type/size validation, push delivery, and OTP verification with the standalone Android app.
- Treat `clientEventId` as a stable per-device mutation UUID and `record_version` as the conflict boundary for offline synchronization.

## Validation

- `npm run refactor:technician` verifies dispatch normalization, legacy mappings, transitions, event idempotency contracts, schema/migration fields, dashboard assets, admin APIs, and technician sync APIs.
- The Technician compatibility gate also enforces the Tabler dashboard contracts and rejects the retired custom card, button, table, and modal-shell classes.
- The 2026-08-08 Tabler conversion passed JavaScript syntax validation, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 Job Map network-layer addition passed live JSON-shape/match checks, JavaScript syntax validation, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 work-order-only map refinement passed a current-data route audit, JavaScript syntax validation, unique-ID and diff checks, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 route-endpoint alignment passed JavaScript syntax validation, the center-anchor compatibility contract, `npm run refactor:technician`, `git diff --check`, and the full `npm test` Phase 12 gate.
- `npm run refactor:customer-management` verifies full project job import preserves dispatch fields.
- `npm run refactor:phase12` remains the final cross-module structural, integration, security, HTTP, and package gate.
- Automated acceptance checks use isolated stores and do not modify live tickets, jobs, customers, PON, PPPoE, MikroTik, or installation data.

## Latest meaningful changes

- 2026-08-08: Center-anchored both Job Map endpoint icons so every work-order link meets the visual center of the NAP and job markers.
- 2026-08-08: Restricted Job Map network overlays to open work orders, deduplicated customer routes, hid unrelated customer links and unused NAPs, and reduced NAP popups to ports used by the displayed jobs with job/customer references.
- 2026-08-08: Added Job Map NAP and customer-link overlays from canonical `/api/pon/state`, Tabler layer switches, coverage-style NAP/link popups, visible-layer fitting, mobile defaults, quality summaries, and assigned/nearest NAP highlighting for repair and installation work orders.
- 2026-08-08: Replaced Leaflet's default blue image marker with a transparent, background-free Tabler map-pin icon while preserving marker anchors, popups, and work-order navigation.
- 2026-08-08: Added DMS Map Pin support for legacy/customer coordinates such as `17°58'6.21"N121°45'30.43"E`; the work-order form and backend now validate and normalize DMS to decimal coordinates before mapping.
- 2026-08-08: Rebuilt `/technicians.html` with native Tabler page headers, KPI cards, responsive grid, filters, table, buttons, badges, workload list, map/empty states, toast, forms, modals, job-detail cards, field evidence, and audit history while preserving every dispatch ID and workflow action.
- 2026-08-08: Made Job Map failures actionable: it now distinguishes no open jobs, missing GPS, and unavailable map tiles; counts unmapped jobs; links directly to location editing; auto-copies the customer Map Pin; accepts an audited per-job correction; and rejects invalid coordinates in both browser and backend job writes.
- 2026-08-08: Added the canonical field-service dispatch model, structured work evidence, immutable event history, optimistic concurrency, offline idempotency, technician-scoped sync APIs, workload/SLA summaries, CSV reporting, and a Tabler-style Admin dispatch dashboard with map and navigation links.
- 2026-08-08: Preserved legacy job statuses, done/undo/assignment endpoints, manual job numbering, ticket relationships, installation workflows, and full project job backup compatibility. The standalone Android technician app remains separate and deferred.
- 2026-07-29: Phase 12 revalidated Technician through the canonical runtime and final package gate.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
