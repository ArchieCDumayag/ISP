# Technician Module Context

Last reviewed: 2026-08-29
Status: Canonical module runtime with Admin ticket triage/linked dispatch, least-privilege field installation APIs, atomic PON reservations, and a technician inventory ledger consumed by the standalone THRE3J Jobs Android client.

## Purpose and current scope

- Create repair, installation, outage, maintenance, and other field work orders.
- Assign or reassign technicians, prioritize work, schedule appointment windows, and track SLA deadlines.
- Snapshot the canonical customer account, contact, address, coordinates, and plan on each work order so field details remain auditable.
- Track the canonical workflow: `unassigned -> assigned -> accepted -> traveling -> on_site -> completed`, with rejected, failed, rescheduled, needs-team, and cancelled outcomes.
- Record diagnosis, work performed, signal readings, speed tests, equipment, materials, photo references, signatures, completion confirmation, and outcome reasons.
- Triage tickets through open, in-progress, waiting-for-customer, escalated, resolved, and cancelled states; create at most one active real work order per ticket; and archive/restore tickets without deleting their records.
- Let a technician work only with their own pending customer drafts or canonical customers on their assigned open jobs; this boundary applies to installation customer lists, PON serviceability/assignment, and PPPoE generation.
- Rank nearby online NAPs with exact free ports or load every NAP within the technician coverage radius, reserve one available port temporarily, release it, and finalize the reserved assignment without replacing an occupied port, moving an existing subscriber, or rewriting the full PON state.
- Maintain branch- and technician-scoped field stock plus append-only warehouse issue and technician use/return transactions, assigned-job linkage, serialized equipment identities, retry-safe client event IDs, and non-negative balances.
- Show open jobs with valid coordinates on a Leaflet map, identify jobs missing GPS, open the affected work order directly for location correction, open Google Maps or Waze, review technician workload, filter jobs, and export the dispatch list as CSV.
- Maintain existing support-ticket, customer-installation, PON, PPPoE, job-numbering, and job-history behavior.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/tickets.js` owns public/customer and authenticated ticket operations under `/api/tickets`.
- `backend/jobs.js` owns Admin dispatch CRUD and reporting under `/api/jobs`.
- `backend/dispatch-workflow.js` is the shared normalization, validation, transition, structured-payload, and audit-event contract.
- `backend/job-events.js` persists append-only dispatch events with branch-scoped offline idempotency keys.
- `backend/technician-assignments.js` exposes only the authenticated technician's assigned jobs/tickets under `/api/technician`.
- `backend/technician-inventory.js` owns the authenticated inventory ledger mounted at `/api/technician/inventory`; it is also declared as the `technicianInventory` backend entry.
- `backend/technician-installations.js` retains technician customer/PON/PPPoE installation workflows under `/api/technician/installations`. PPPoE generation is serialized with Billing's lifecycle boundary and rechecks both the current Customer closure overlay and any unconsumed closed-balance/pending-payment reconnection decision, so an assigned or previously cached job cannot provision a closed or merely reopened subscriber before Billing settlement.
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
- `GET /api/technician/inventory` and `/stock`: list only the authenticated technician's branch stock.
- `GET /api/technician/inventory/transactions`: list the technician's ledger, optionally filtered by type or assigned `jobId`.
- `POST /api/technician/inventory/use`: consume stock against a real job assigned to the technician; free-form job references never authorize use.
- `POST /api/technician/inventory/return`: remove unused stock returned from the technician kit, with optional assigned-job linkage.
- `POST /api/technician/inventory/transactions`: generic technician use/return entry point. Every mutation requires a stable `clientEventId`; a replay returns the original transaction, while payload reuse fails with `409`. Technician-authenticated requests cannot self-issue stock; issuance is reserved for a future Admin/warehouse workflow.
- `GET /api/tickets?includeArchived=1`: Admin ticket queue including reversible archives and the latest linked-work-order summary; other authenticated callers retain the non-archived view.
- `POST /api/tickets/:id/work-order`: Admin-only creation of a real `ticket_work_order`; ticket-row locking in MySQL and a process-local JSON mutation lock return `409` when an active linked work order already exists.
- `PATCH /api/tickets/:id/archive` and `/restore`: reversible archive controls. Legacy `DELETE /api/tickets/:id` is retained as a deprecated non-destructive archive alias.
- Ticket status input accepts legacy aliases and stores canonical `open`, `in-progress`, `waiting-customer`, `escalated`, `resolved`, or `cancelled` values. Completing a linked work order resolves its ticket and re-opening that work order reopens the ticket; no synthetic `ticket` history job is created for linked dispatch work.
- Ticket and linked-work-order assignees are one canonical value: ticket edit/assignment updates the active work order, while job edit/assignment updates the linked ticket. JSON performs each paired mutation under the shared Technician mutation queue; MySQL locks and updates both records in one transaction.
- `GET /api/technician/installations/pon/overview?customerAccountNumber=...`: JSON/MySQL-aware, customer-scoped PON overview that retains occupancy while redacting every other subscriber's identity, optical reading, and PPPoE username.
- `GET /api/technician/installations/pon/nearby?customerAccountNumber=...&latitude=...&longitude=...`: nearest online serviceable NAPs with exact available port numbers. Adding `coverageMap=true` returns every coordinate-valid branch NAP within a server-enforced 600-meter radius, including full/offline NAPs, and its complete port roster; a client-supplied larger radius cannot broaden this map. Occupied/reserved rows may include only sanitized customer name/account labels for the technician map; available rows never expose a client label, and the legacy nearby response remains client-redacted.
- `POST /api/technician/installations/pon/reservations`: reserve an exact NAP port for the authorized customer (`/pon/reserve` is a compatibility alias).
- `DELETE /api/technician/installations/pon/reservations/:reservationId` or `POST .../:reservationId/release`: release the authenticated technician's customer-bound reservation (`/pon/release` is an alias).
- `POST /api/technician/installations/pon/reservations/:reservationId/finalize`: atomically assign the reserved port (`/pon/assignments` and legacy `/pon/assign` are aliases). Finalize and release pass the authorized customer account into Network before mutation, and replace/move/force/override flags are rejected.
- New `installationCompletion` submissions require only their own stable `clientEventId` and ONU serial number. The server strips serial whitespace, uppercases it, and retains older brand/MAC/signal/cable/material/note fields only when a legacy client supplies them, so historical rich completion records remain readable and replay-compatible without requiring new evidence. The submitting technician may attach the first completion before or after Admin approval; a draft compare-and-set preserves one immutable event, approval promotes its ONU serial to the canonical customer, and an approval-first finalize reconciles the approved customer immediately. Canonical branch duplicate checks run before PON finalization and the Customer store's unique constraint remains the concurrent-write backstop.
- Existing done/undo/assign/delete endpoints remain available. Existing one-tap technician completion remains compatible from assigned, accepted, or traveling states.

Customer Management supplies customer snapshots, owned pending drafts, canonical customer coordinates, and technician login/session records. Admin supplies account roles. Network supplies branch-scoped `/api/pon/state` data for the Job Map plus the `pon-serviceability.js` nearby/reserve/release/finalize primitives used by Technician. Technician never accepts a client-authored customer identity outside an owned pending draft or assigned open work order. Billing retains installation dependencies.

## Frontend entry points

- `/technicians.html` is the Admin dispatch dashboard. A dispatcher currently operates it through an Admin account because the shared authentication model has no separate Dispatcher or Supervisor role.
- It contains Tabler-native KPI cards, search/filter controls, a paginated work-order table, technician workload list, Leaflet job-map card, create/edit form modal, operational evidence cards, status override, and audit timeline. Module CSS is limited to dispatch-specific layout, map sizing/overlay behavior, Leaflet integration, and explicit modal visibility rather than recreating Tabler components.
- The map uses center-anchored transparent Tabler job and NAP markers so work-order links terminate at each icon's visual center, plus separate **Work Orders**, **Used NAPs**, and **Work Order Links** switches. It consumes canonical branch PON state but renders only open work-order routes: one route per customer, only NAPs used by those routes, and only assigned NAP ports related to the displayed jobs. Assigned routes are solid green; unassigned customers use a dashed orange nearest-NAP fallback. Links appear at zoom 14 or higher, and repair/installation details emphasize the selected route. Network layers default off on small screens unless the user has saved a preference.
- Job Map continues to report missing work-order coordinates, show actionable empty/offline states, and open the first affected job's Map Pin field through **Add job location** or **Review**. The work-order Map Pin defaults from the selected customer, accepts decimal or DMS coordinates, normalizes them to decimal latitude/longitude, and can be corrected for that job.
- Work-order details provide call, SMS, Google Maps, and Waze links when customer data is available.
- `/tickets.html` is a native Tabler support workspace with KPI cards, searchable/paginated status tabs, status and assignment actions, a guided linked-work-order dialog, work-order summaries, customer details, responsive tables, and an Archived/Restore view. Permanent delete is absent from the UI.
- `/job-history.html` and `/technician-customer-drafts.html` retain their existing responsibilities and URLs.
- Dispatch dialogs ignore backdrop and Escape dismissal; users close them through explicit Close/Cancel controls or a successful action.

## Data and persistence

- JSON mode stores work orders in `jobs` and audit events in `technician_job_events`.
- JSON tickets retain `archivedAt`/`archivedBy` and linked work-order references in the existing `tickets` store. Relational mode uses nullable `tickets.archived_at` and `tickets.archived_by`; the canonical schema/migration adds them and the module defensively performs an additive runtime ensure for older deployments.
- JSON ticket/job reads and mutations require an exact stored `branchId`; branchless legacy rows are not exposed or mutable through branch-scoped APIs, and every newly created ticket or job persists its resolved branch. Whole-store writes retain records owned by other branches.
- Real ticket dispatch rows use `jobs.origin = ticket_work_order`, receive normal job numbers, and remain distinct from legacy completed synthetic rows with `origin = ticket`.
- Field inventory uses the `technician-inventory` application store. In JSON mode it is `data/technician-inventory.json`; relational mode uses the shared `app_store` adapter. The versioned store contains branch records, per-technician stock, and append-only transactions.
- Inventory SKUs accept `sku` or Android-compatible `itemId`; serialized mutations accept `serialNumbers` or a single `serialNumber`. Serialized identities are unique within a branch while on hand. Internal/warehouse `issue` entries increase technician stock; technician `use` and `return` entries decrease it, and no transaction may produce a negative balance.
- Inventory writes use a process-local store mutation queue so concurrent requests in the modular monolith cannot overwrite each other. `clientEventId` is unique per branch technician and preserves offline retry idempotency.
- Installation completion history uses the Customer Draft store's atomic compare-and-set contract. JSON serializes the complete shared draft-file mutation, and MySQL locks the selected branch/account draft row before comparing the completion event and fingerprint. The canonical customer stores only normalized `onuSerialNumber`; an owned approved-draft retry must match the stored event once one exists.
- Technician PPPoE patches use that same JSON draft-store mutation lock. In MySQL they select the eligible pending draft `FOR UPDATE` and repeat the allowed-status predicate on update, preserving installation evidence and preventing a concurrent Admin approval from being overwritten.
- Relational mode adds appointment end, SLA due, canonical workflow status, customer snapshot, coordinates, plan snapshot, structured dispatch JSON, and record version columns to `jobs`.
- Relational audit events live in `technician_job_events`; the `(branch_id, client_event_id)` unique key makes offline retries idempotent.
- The migration is additive and backfills legacy scheduled/in-progress/done jobs into the canonical workflow without deleting existing job data.
- Full project backup already exports/imports the expanded `jobs` row fields. The append-only `technician_job_events` table is not yet part of the full backup workbook and must be added before audit-history backup is advertised as complete.

## Android boundary

- The built THRE3J Jobs Android technician app remains a separate project/package from the Collector app, with separate local storage, offline queue, and app identity.
- It consumes `/api/technician/jobs`, `/api/technician/jobs/:id/status`, `/api/technician/jobs/sync`, customer drafts, the customer-bound PON routes, and the inventory ledger rather than duplicating server authorization or dispatch rules locally.
- Android must retain one UUID-like `clientEventId` for every queued PON reservation/finalize or inventory mutation until the server acknowledges it. New installation completion UI sends only the ONU serial plus the stable completion event; legacy evidence fields remain server-compatible but are no longer required. Material use sends a canonical `jobId`, never a label or free-form reference.
- The Android client keeps encrypted, technician-and-environment-scoped caches/drafts plus a Room/WorkManager mutation queue. Camera upload transport, binary photo storage, barcode/ONU scanning, push notifications, and customer OTP confirmation remain deferred. Current work orders and installation drafts store safe structured metadata/references for these fields.

## Known risks and follow-up

- Run the additive schema migration before starting a MySQL deployment with this code.
- Leaflet map tiles require internet access; the table and workload views remain usable if tiles are unavailable.
- Job Map link overlays appear only at zoom 14 or higher. Multiple open work orders for the same customer share one route; unmatched work orders are reported in the summary, and nearest-NAP fallbacks are explicitly labeled rather than presented as assigned ports.
- Installation actions may change live PON/PPPoE state; preserve existing validation and audit behavior.
- PON reservations expire after the Network-owned TTL. Android must refresh coverage-map availability and create a new reservation after expiry; it must not attempt an override. The server revalidates the exact selected port atomically even though the map marks only currently available ports as selectable.
- The inventory ledger records field custody but does not yet provide an Admin warehouse issuance/approval UI, cross-technician transfer workflow, or stock-count reconciliation. Until that Admin workflow exists, technicians can view existing custody and record use/return but cannot add stock to their own kits.
- Add audit-event export/import before promising restorable immutable history.
- Add binary evidence storage, signed upload URLs, malware/type/size validation, push delivery, and OTP verification with the standalone Android app.
- Treat `clientEventId` as a stable per-device mutation UUID and `record_version` as the conflict boundary for offline synchronization.
- MySQL workflow transitions lock the job row and include its current `record_version` in the `UPDATE` predicate; simultaneous requests using the same expected version produce one commit and one `409` stale-write response.
- A ticket with an active linked work order cannot be resolved directly or archived; complete or cancel the work order first so Ticket and Jobs state cannot silently diverge.

## Validation

- `npm run refactor:technician` verifies dispatch normalization, legacy mappings, transitions, event idempotency contracts, schema/migration fields, dashboard assets, admin APIs, and technician sync APIs.
- The Technician compatibility gate also enforces the Tabler dashboard contracts and rejects the retired custom card, button, table, and modal-shell classes.
- The 2026-08-08 Tabler conversion passed JavaScript syntax validation, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 Job Map network-layer addition passed live JSON-shape/match checks, JavaScript syntax validation, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 work-order-only map refinement passed a current-data route audit, JavaScript syntax validation, unique-ID and diff checks, `npm run refactor:technician`, and the full `npm test` Phase 12 gate.
- The 2026-08-08 route-endpoint alignment passed JavaScript syntax validation, the center-anchor compatibility contract, `npm run refactor:technician`, `git diff --check`, and the full `npm test` Phase 12 gate.
- The 2026-08-16 PON/inventory API addition passed JavaScript syntax checks, 16 focused Network/Technician tests, `git diff --check`, and `npm run refactor:technician`. Tests use injected inventory stores and pure PON access/sanitization helpers, so they do not modify live stock, customers, jobs, reservations, or PON assignments.
- The 2026-08-16 completion-CAS regression uses an isolated JSON draft store to prove that concurrent altered evidence produces one winner and one `409`, exact replay returns the first record, and rejected drafts are never updated. Its mocked-MySQL PPPoE regression verifies row locking, status-constrained persistence, and preservation of the trusted completion record.
- The 2026-08-16 ticket/linked-work-order update passed backend and browser JavaScript syntax checks, focused JSON API tests for Admin authorization, concurrent duplicate prevention, completion/reopen lifecycle, bidirectional assignee synchronization, exact branch isolation, archive/restore, and the legacy DELETE alias; a mocked MySQL concurrency test verifies row locking plus the atomic version predicate. The static Tabler UI contract, unique-ID validation, `git diff --check`, and `npm run refactor:technician` also pass.
- `npm run refactor:customer-management` verifies full project job import preserves dispatch fields.
- `npm run refactor:phase12` remains the final cross-module structural, integration, security, HTTP, and package gate.
- Automated acceptance checks use isolated stores and do not modify live tickets, jobs, customers, PON, PPPoE, MikroTik, or installation data.

## Latest meaningful changes

- 2026-08-29: Extended technician PPPoE generation protection through Customer Archive Reopen. An assigned retained job cannot enable service until Billing consumes the Final Closed Customer Balance or pending-payment reconnection settlement.

- 2026-08-26: Blocked technician PPPoE generation for permanently closed customer accounts under the shared Billing mutation boundary. This keeps retained-balance Collector payments from implicitly reopening service or provisioning.

- 2026-08-25: Reworked Android installation evidence around the ONU brand dropdown and meter-roll workflow. The client and technician API now validate the supported brand list, compute drop-cable length from start/end readings, and persist IOO, patch-cord type/quantity, SC connector, C-Clip, cable clip, cable tie, and F-Clamp usage; new submissions omit MAC while legacy replay compatibility remains intact.
- 2026-08-25: Added the technician-only NAP coverage response used by Android exact-port selection and constrained it to every mapped NAP within 600 meters of the customer. The map displays all numbered ports and limited client labels on occupied/reserved rows inside that radius, while legacy nearby calls stay redacted and reservation-time availability remains authoritative.
- 2026-08-16: Made installation-completion persistence an atomic JSON/MySQL compare-and-set, preserving the first trusted field record across concurrent offline retries and rejecting altered evidence without a last-writer-wins overwrite. PPPoE draft patches now share the JSON mutation lock and use a status-guarded MySQL row transaction so they cannot erase that record or overwrite a concurrent approval.
- 2026-08-16: Hardened ticket/job integration with exact JSON branch ownership, preservation of other-branch rows during writes, serialized JSON linked mutations, transactional MySQL linked updates, bidirectional canonical assignee synchronization, and atomic `record_version` conflict detection.
- 2026-08-16: Rebuilt Tickets with native Tabler components and canonical triage tabs/actions; added Admin-only real linked work-order creation, active duplicate prevention, completion-driven ticket resolution without synthetic duplicates, and reversible JSON/MySQL archive/restore with a non-destructive legacy DELETE alias.
- 2026-08-16: Added JSON/MySQL-aware, customer-bound PON overview/nearby/reserve/release/finalize APIs. Other subscriber identities are redacted, only owned pending drafts or assigned open-job customers are eligible, reservation customer binding is validated before mutation, occupied-port replacement and subscriber moves are forbidden, and normal assignment no longer performs a whole-state save.
- 2026-08-16: Added replay-safe structured installation-completion evidence to PON finalization so ONU, signal, cable, material, and completion-note data remains on the technician's pending client draft for Admin review.
- 2026-08-16: Added the `technician-inventory` app-store ledger with per-branch/per-technician stock, issue/use/return entries, serialized item custody, assigned-job material use, offline `clientEventId` idempotency, and non-negative stock enforcement under the existing `/api/technician` mount.
- 2026-08-08: Center-anchored both Job Map endpoint icons so every work-order link meets the visual center of the NAP and job markers.
- 2026-08-08: Restricted Job Map network overlays to open work orders, deduplicated customer routes, hid unrelated customer links and unused NAPs, and reduced NAP popups to ports used by the displayed jobs with job/customer references.
- 2026-08-08: Added Job Map NAP and customer-link overlays from canonical `/api/pon/state`, Tabler layer switches, coverage-style NAP/link popups, visible-layer fitting, mobile defaults, quality summaries, and assigned/nearest NAP highlighting for repair and installation work orders.
- 2026-08-08: Replaced Leaflet's default blue image marker with a transparent, background-free Tabler map-pin icon while preserving marker anchors, popups, and work-order navigation.
- 2026-08-08: Added DMS Map Pin support for legacy/customer coordinates such as `17°58'6.21"N121°45'30.43"E`; the work-order form and backend now validate and normalize DMS to decimal coordinates before mapping.
- 2026-08-08: Rebuilt `/technicians.html` with native Tabler page headers, KPI cards, responsive grid, filters, table, buttons, badges, workload list, map/empty states, toast, forms, modals, job-detail cards, field evidence, and audit history while preserving every dispatch ID and workflow action.
- 2026-08-08: Made Job Map failures actionable: it now distinguishes no open jobs, missing GPS, and unavailable map tiles; counts unmapped jobs; links directly to location editing; auto-copies the customer Map Pin; accepts an audited per-job correction; and rejects invalid coordinates in both browser and backend job writes.
- 2026-08-08: Added the canonical field-service dispatch model, structured work evidence, immutable event history, optimistic concurrency, offline idempotency, technician-scoped sync APIs, workload/SLA summaries, CSV reporting, and a Tabler-style Admin dispatch dashboard with map and navigation links.
- 2026-08-08: Preserved legacy job statuses, done/undo/assignment endpoints, manual job numbering, ticket relationships, installation workflows, and full project job backup compatibility. The standalone Android technician app was kept separate and has since been built as THRE3J Jobs.
- 2026-07-29: Phase 12 revalidated Technician through the canonical runtime and final package gate.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
