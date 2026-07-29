# Billing

Owns plan configuration, billing cycles, balances, payment entry/history, statements and receipts, payment confirmation review, referrals' financial effects, and disconnection/reconnection billing policy.

## Runtime entry points

- Backend descriptor: `backend/index.js`
- Canonical backend implementations: `backend/*.js`
- Canonical pages and browser assets: `web/`
- Admin pages: plans, payments, payment history/breakdown, confirmation queues, disconnections, statements, and thermal print
- Public/customer payment pages: quick payment, receipt, account statement, and billing statement
- Main APIs: `/api/plans`, `/api/payments`, `/api/payment-records`, `/api/payment-confirmations*`, `/api/disconnections`, `/api/billing/*`, and statement/receipt endpoints

## Boundaries

- Customer Management owns customer identity and referral relationships; Billing owns monetary results.
- Collector owns field collection capture, approvals, and remittances but writes through Billing contracts.
- Network executes service state changes requested by billing/disconnection policy.
- Finance owns expenses and payroll, not subscriber billing.

The former root backend shims were retired in Phase 11; canonical imports now point here while existing page, asset, and API URLs remain unchanged. New Billing code belongs in this folder. Update `Module_context.md` with every lasting change.
