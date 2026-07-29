# Customer Management

Owns the subscriber lifecycle: public applications, customer profiles, addresses, service coverage, draft review, archive/restore, and referrals.

## Runtime

- `module.json` declares `backend/index.js` and `web/` as live runtime entries.
- `backend/index.js` lazily exposes customer, draft, archive, coverage, referral, and address services to `server.js`.
- `web/` is mounted at the application root after page authorization guards, preserving existing page and asset URLs.
- The former eight root CommonJS shims were retired in Phase 11; all dependencies use canonical module paths.
- Shared shell/vendor assets continue to come from `public/`.

## Boundaries

- Billing owns plans, balances, payments, statements, and disconnection policy.
- Network owns MikroTik/PPPoE/PON/GenieACS and coverage-map behavior.
- Technician owns installation execution and field jobs.
- Customer App owns customer-facing portal presentation and notifications.
- Admin owns staff authentication, accounts, roles, and protected integrations.
- Shared route mounting, middleware, navigation, and storage helpers remain Integration Codex work.

Lock `Features/modules/customer-management` plus affected shared files before changes. Run `npm run refactor:customer-management` and update `Module_context.md` with every lasting change.
