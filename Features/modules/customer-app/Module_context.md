# Customer App Module Context

Last reviewed: 2026-07-29
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Authenticate customers and present customer portal/app experiences.
- Show customer account, notification, reminder, and modem-related information.
- Register FCM tokens and maintain a customer notification inbox.
- Configure, schedule, run, and test push notification/reminder behavior.
- Send SMS, retain history, manage templates/schedules/automations, and dispatch through configured providers.
- Handle Messenger verification/messages and provide a local customer upstream stub in development.
- Present customer-facing privacy, terms, and company information.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/customer-app-api.js`: customer/public and staff-protected routers under `/api/customer-app`, including popup reminders, FCM tokens, inbox state, push configuration, and push rules.
- Customer login/me/modem/payment-related handlers remain composed with Customer Management, Billing, Network, and shared `server.js` handlers.
- `backend/customer-fcm-tokens.js` and `backend/customer-notification-inbox.js`: JSON-backed customer notification state used directly by Customer Management.
- `backend/firebase-push.js`: Firebase Admin integration with credential paths anchored to the repository root.
- `backend/sms.js`, `backend/sms-delivery.js`, `backend/sms-scheduler.js`, and `backend/sms-schema.js`: `/api/sms`, provider dispatch, schedules, automations, and relational schema.
- `backend/messenger-bot.js`: verification and delivery under `/webhooks/messenger`.
- `backend/customer-upstream.js`: development stub, normally port `4101` in this checkout; production remains opt-in through `ENABLE_CUSTOMER_UPSTREAM_STUB=true`.
- The former ten repository-root backend shims were retired in Phase 11.

All API prefixes, authentication requirements, feature gates, scheduler startup conditions, response contracts, provider behavior, and stored-data keys remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`: eight HTML entry points, five CSS files, and five JavaScript files.
- Existing customer URLs remain `/customer-login.html`, `/customer-portal.html`, `/customer-app.html`, and `/customer-app-popup-reminder.html` with their existing customer/admin guards and redirects.
- SMS remains protected at `/sms.html`; company information, privacy, and terms pages remain public at their existing root and friendly URLs.
- Existing CSS/JavaScript URLs, including root `/sms.js`, remain unchanged through module static composition.
- All 18 moved browser files are byte-identical to their pre-migration versions.

## Data and dependencies

- Canonical shared storage, database, relational-readiness, password, role, storage-mode, and project-path imports come from `core/`.
- Customer Management provides customer identity, credentials, customer sessions, status, and contact records; its customer backend imports FCM/inbox helpers directly from this module.
- Billing provides balances, payment confirmations, receipts, statements, and quick-payment contracts through unchanged APIs and shared composition.
- Network provides modem/GenieACS and WiFi operations through Customer Management and shared handlers.
- Admin provides integration settings, business profile, staff authorization, SMS/email provider configuration, and protected secrets.
- JSON keys include `customer_app_settings`, `customer_fcm_tokens`, and `customer_notification_inbox`; dashboard backup/restore also preserves archived `sms_messages` and `sms_automation_runs` arrays in JSON mode. Interactive SMS tools still require MySQL and their existing relational schema.
- Push, SMS, email, and Messenger credentials must never be recorded in this context.

## Known risks and follow-up

- Customer authentication and staff authentication must remain isolated.
- Notification delivery is externally stateful; retry/idempotency and audit behavior need tests.
- Shared customer/modem/payment handlers in `server.js` require Integration Codex coordination.
- The local upstream stub must not collide with production or be unintentionally enabled in production.
- Repository-root backend aliases must not be recreated.
- Add authenticated customer login/authorization, notification persistence, scheduler, provider-adapter, signature, and retry tests before changing behavior.

## Validation

- `npm run refactor:customer-app` verifies the descriptor, retirement of ten root entries, 18 web files, server wiring, canonical cross-module dependencies, repository-root Firebase paths, routers, and pure FCM/inbox/SMS contracts.
- `npm run refactor:phase10` runs inventory, every module compatibility suite, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged public/legal/customer/SMS pages and assets, customer/admin guards, upstream isolation, and unauthenticated Customer App/SMS denials on ports `3190`/`4190`.
- Acceptance checks do not authenticate as a real customer, write notification/token state, run schedulers, send provider messages, or call Messenger/Firebase/SMS/email services.

## Latest meaningful changes

- 2026-07-29: Dashboard full backup/restore now round-trips SMS message history and automation-run records through archive JSON keys when JSON storage is selected; provider delivery and interactive SMS behavior remain MySQL-only.
- 2026-07-29: Phase 12 revalidated Customer App through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all ten Customer App root shims; shared composition and security checks now load its manifest runtime directly.
- 2026-07-29: Physically migrated ten backend implementations and 18 browser files into the Customer App module, added root compatibility shims and module-loader/static wiring, converted dependencies to canonical paths, preserved repository-root Firebase credential lookup, and added Phase 10 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
