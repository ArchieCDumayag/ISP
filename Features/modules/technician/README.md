# Technician

Owns support tickets, field jobs, technician assignments, job history, installation execution, customer-draft installation review, and technician-side PON/PPPoE provisioning flows.

## Current runtime entry points

- Backend descriptor: `backend/index.js`
- Backend implementations: `backend/tickets.js`, `backend/jobs.js`, `backend/job-numbering.js`, `backend/technician-assignments.js`, and `backend/technician-installations.js`
- Browser implementations: `web/tickets.html`, `web/technicians.html`, `web/job-history.html`, and `web/technician-customer-drafts.html`, plus their module-owned CSS and JavaScript
- Main APIs: `/api/tickets`, `/api/jobs`, `/api/technician`, `/api/technician/installations`, and `/api/technician/customer-drafts`

`server.js` loads the backend descriptor and module web root through the manifest-driven runtime registry. The former five root backend shims were retired in Phase 11, and browser URLs remain unchanged.

## Boundaries

- Customer Management owns customer and application/draft records.
- Network owns canonical PON, PPPoE, MikroTik, and coverage contracts.
- Admin owns technician accounts, roles, authentication, and sessions.
- Billing owns charge/payment effects related to service work.

New Technician-specific code belongs under this folder and should import shared infrastructure from `core/` and other migrated modules through their canonical paths. Update `Module_context.md` with every lasting change.
