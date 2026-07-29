# Finance

Owns operating expenses, payroll records, and finance-oriented reporting assets outside subscriber billing and collector payment capture.

## Current runtime entry points

- Backend descriptor: `backend/index.js`
- Backend implementations: `backend/expenses.js` and `backend/payroll.js`
- Browser implementations: `web/expenses.html`, `web/payroll.html`, and the Finance/reporting CSS and JavaScript under `web/`
- Main APIs: `/api/expenses` and `/api/payroll`
- Shared reporting contract: `/api/dashboard/collection-breakdown` remains composed in `server.js`

`server.js` loads the backend descriptor and module web root through the manifest-driven runtime registry. The former two root backend shims were retired in Phase 11, and browser URLs remain unchanged.

## Boundaries

- Billing owns subscriber charges, payments, balances, receipts, and statements.
- Collector owns field collection capture, approvals, and remittances.
- Admin owns accounts, permissions, business profile, and shared activity logging.

New Finance-specific code belongs under this folder and should import shared infrastructure from `core/` and other modules through their canonical paths. Update `Module_context.md` with every lasting change.
