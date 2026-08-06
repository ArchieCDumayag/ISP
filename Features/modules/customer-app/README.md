# Customer App

Owns customer-facing login/portal/app experiences, popup and push notifications, FCM tokens/inbox state, customer upstream stub, public legal/company pages, Messenger webhook behavior, and SMS communication workflows.

## Current runtime entry points

- Backend descriptor: `backend/index.js`
- Backend implementations: customer app/token/inbox/upstream, Firebase push, Messenger bot, semi-automated Messenger reminders, and SMS delivery/scheduler/schema/router files under `backend/`
- Customer and communication pages: `web/customer-login.html`, `web/customer-portal.html`, `web/customer-app.html`, `web/customer-app-popup-reminder.html`, `web/messenger-reminders.html`, and `web/sms.html`
- Public pages: `web/privacy-terms.html`, `web/terms-of-use.html`, and `web/company-info.html`
- Main APIs: `/api/customer-app`, `/api/messenger-reminders`, customer-authenticated `/api/customers/*` routes, `/api/sms`, and `/webhooks/messenger`

`server.js` loads the backend descriptor and module web root through the manifest-driven runtime registry. The former ten root backend shims were retired in Phase 11, and all browser URLs remain unchanged.

## Boundaries

- Customer Management owns canonical customer profiles and credentials stored on customer records.
- Billing owns balances, statements, quick payments, and payment confirmation review.
- Network owns modem/GenieACS/MikroTik actions exposed through customer app handlers.
- Admin owns business profile, integration settings, staff access, and protected configuration.

New Customer App-specific code belongs under this folder and should import shared infrastructure from `core/` and other modules through canonical paths. Update `Module_context.md` with every lasting change.
