# Collector

Owns field collection operations: collector-area assignment, collector authentication-dependent workflows, payment capture, receipt reprints, approval queues, remittances, and collection reporting.

## Runtime entry points

- Backend descriptor: `backend/index.js`
- Canonical backend implementations: `backend/collector-next-due.js`, `backend/collector-payments.js`, `backend/collectors.js`, and `backend/routes/collectors.js`
- Canonical pages and browser assets: `web/`
- Admin pages: collector assignments/approvals and collection history
- Main APIs: `/api/collectors`, `/api/collector/payments`, plus collector session endpoints under `/api/auth`

## Boundaries

- Billing owns canonical payment entries, numbering, balances, and account records.
- Customer Management owns customer/account identity and service area.
- Admin owns accounts, roles, authentication, and sessions.
- Finance may reconcile collection/remittance results but does not own capture workflows.

The former root and `routes/` backend shims were retired in Phase 11; canonical imports now point here while existing page, asset, and API URLs remain unchanged. New Collector code belongs in this folder. Update `Module_context.md` with every lasting change.
