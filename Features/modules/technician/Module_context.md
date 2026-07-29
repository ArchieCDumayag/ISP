# Technician Module Context

Last reviewed: 2026-07-29
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Create, assign, update, resolve, reopen, and delete tickets and jobs.
- Convert or relate support work to field operations.
- Provide technician-scoped job and ticket views/actions.
- Review customer installation drafts and complete provisioning.
- Assign PON resources and generate PPPoE details during installation.
- Maintain manual job numbering and job history.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/tickets.js`: public/customer and authenticated ticket operations under `/api/tickets`.
- `backend/jobs.js`: job CRUD, assignment, completion, undo, and delete under `/api/jobs`.
- `backend/technician-assignments.js`: technician-scoped jobs/tickets and state changes under `/api/technician`.
- `backend/technician-installations.js`: technician customer/PON/PPPoE installation workflows under `/api/technician/installations`.
- `backend/job-numbering.js`: manual job-number schema, backfill, formatting, and fallback helpers.
- Customer Management's draft-submission backend supplies the technician login/session and `/api/technician/customer-drafts` routers; Admin supplies the underlying technician account and role records.
- The former five repository-root backend shims were retired in Phase 11.

All API prefixes, authorization requirements, feature gates, response contracts, and stored-data keys remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: four HTML entry points, three stylesheets, and four JavaScript files.
- Existing URLs remain `/tickets.html`, `/technicians.html`, `/job-history.html`, and `/technician-customer-drafts.html`; the explicit `/tickets` and `/technician-customer-drafts` routes are also preserved.
- Ticket, technician, and job-history pages retain their admin session guards. The customer-draft page retains its own technician login workflow.
- All 11 moved browser files are byte-identical to their pre-migration versions.

## Data and dependencies

- Canonical shared database and storage imports come from `core/`.
- Dashboard full backups export all branch JSON-mode `tickets` and `jobs`; full import upserts both arrays by ID and restores available ticket relationships before jobs.
- Admin provides technician account/role records and integration settings.
- Customer Management provides customer records, application drafts, coverage, and technician-token authentication helpers.
- Network provides canonical PON state, MikroTik access, PPPoE normalization/generation, and active-account lookup contracts.
- Billing provides plan-profile resolution used during router provisioning.

## Known risks and follow-up

- Installation actions may change live PON/PPPoE state; preserve validation and audit behavior.
- Ticket public/customer auth and technician/admin auth have different trust boundaries.
- Job numbering must remain unique in both JSON and relational modes.
- Shared migration scripts resolve job numbering directly from the canonical Technician backend.
- Add isolated workflow tests for ticket-to-job, assignment, completion/undo, and mocked installation provisioning before changing behavior.

## Validation

- `npm run refactor:technician` verifies the descriptor, retirement of five root entries, 11 web files, server wiring, canonical cross-module imports, job numbering, and router/helper contracts.
- `npm run refactor:phase8` runs inventory, Core, Admin, Customer Management, Billing, Network, Collector, Technician, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged Technician asset/page URLs, page guards, public ticket categories, and unauthenticated denials for ticket, job, assignment, installation, and customer-draft APIs on ports `3190`/`4190`.
- Acceptance checks do not create or update tickets/jobs and do not connect to or mutate PON, PPPoE, MikroTik, customer, or installation data.

## Latest meaningful changes

- 2026-07-29: Added the shared dashboard backup/restore contract for JSON ticket and ticket-linked job records without changing Technician API URLs or workflow behavior.
- 2026-07-29: Phase 12 revalidated Technician through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all five Technician root shims and switched migration/schema scripts to canonical job-numbering imports.
- 2026-07-29: Physically migrated five backend implementations and 11 browser files into the Technician module, added root compatibility shims and module-loader/static wiring, converted dependencies to canonical module paths, and added Phase 8 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
