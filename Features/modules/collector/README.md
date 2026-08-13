# Collector

Owns field collection operations: collector-area assignment, collector authentication-dependent workflows, payment capture, receipt reprints, rescheduled-client follow-ups, approval queues, remittances, and collection reporting.

## Runtime entry points

- Backend descriptor: `backend/index.js`
- Canonical backend implementations: `backend/collector-next-due.js`, `backend/collector-payments.js`, `backend/collector-priorities.js`, `backend/collector-reschedules.js`, `backend/collectors.js`, and `backend/routes/collectors.js`
- Canonical pages and browser assets: `web/`
- Admin pages: collector assignments, Customer Payment Approval, Collector Cash Remittance, priority-client assignment, collector schedule management, and collection history
- Main APIs: `/api/collectors`, `/api/collector/payments` (including `/priorities` and `/reschedules`), plus collector session endpoints under `/api/auth`

## Boundaries

- Billing owns canonical payment entries, numbering, balances, and account records.
- Customer Management owns customer/account identity and service area.
- Admin owns accounts, roles, authentication, and sessions.
- Admin-created collector schedules must target an active Collector account already assigned to the selected customer's area; collectors receive schedule lifecycle changes through Android Sync.
- Active schedules are reconciled against Billing's canonical ending balance; zero-balance customers move to audited Paid history and disappear from active Admin and Android queues after sync.
- Admin-created priority assignments are branch-wide shared collection targets: Admin may select multiple unpaid clients in highest-balance order, every collector in the branch receives the queue on Sync, and one active assignment per client prevents duplicates. They affect collection ordering/visibility only; Billing remains canonical for balances and payment effectiveness.
- Customer Payment Approval and Collector Cash Remittance are separate controls. Cash confirmation never changes payment approval state and is unavailable until every payment in the batch has already been approved or rejected.
- Finance may reconcile collection/remittance results but does not own capture workflows.

The former root and `routes/` backend shims were retired in Phase 11; canonical imports now point here while existing page, asset, and API URLs remain unchanged. New Collector code belongs in this folder. Update `Module_context.md` with every lasting change.
