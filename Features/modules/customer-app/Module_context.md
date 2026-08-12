# Customer App Module Context

Last reviewed: 2026-08-10
Status: Canonical module runtime; backend aliases are retired and browser URLs remain unchanged.

## Purpose and current scope

- Authenticate customers and present customer portal/app experiences.
- Show customer account, notification, reminder, and modem-related information.
- Register FCM tokens and maintain a customer notification inbox.
- Configure, schedule, run, and test push notification/reminder behavior.
- Send SMS, retain history, manage templates/schedules/automations, and dispatch through configured providers.
- Handle Messenger verification/messages and provide a local customer upstream stub in development.
- Prepare a consent-gated Messenger billing reminder queue for manual review and sending by admins or assigned collectors.
- Present customer-facing privacy, terms, and company information.
- Let authenticated customers view the configured GCash merchant details and exact current amount due, extract key fields from an uploaded screenshot through local OCR plus an optional ISP-configured Vision AI fallback, see official-history matching, submit evidence, and track its manual review result.

## Backend and APIs

- `backend/index.js` is the lazy module descriptor loaded by `server.js` through `core/runtime/module-loader`.
- `backend/customer-app-api.js`: customer/public and staff-protected routers under `/api/customer-app`, including popup reminders, FCM tokens, inbox state, push configuration, and push rules.
- Customer login/me/modem/payment-related handlers remain composed with Customer Management, Billing, Network, and shared `server.js` handlers.
- `backend/customer-fcm-tokens.js` and `backend/customer-notification-inbox.js`: JSON-backed customer notification state used directly by Customer Management.
- `backend/firebase-push.js`: Firebase Admin integration with credential paths anchored to the repository root.
- `backend/sms.js`, `backend/sms-delivery.js`, `backend/sms-scheduler.js`, and `backend/sms-schema.js`: `/api/sms`, provider dispatch, schedules, automations, and relational schema.
- `backend/messenger-bot.js`: verification and delivery under `/webhooks/messenger`.
- `backend/messenger-reminders.js`: `/api/messenger-reminders` queue generation from Billing's canonical payment records, branch/collector-area authorization, deterministic duplicate-resistant reminder keys, Messenger preferences/consent, manual open/copy/send auditing, skip/reopen history, and payment confirmations. Active Billing-owned Complimentary accounts are excluded. It never bulk-sends through the Meta API.
- `backend/customer-upstream.js`: development stub, normally port `4101` in this checkout; production remains opt-in through `ENABLE_CUSTOMER_UPSTREAM_STUB=true`.
- The former ten repository-root backend shims were retired in Phase 11.

All API prefixes, authentication requirements, feature gates, scheduler startup conditions, response contracts, provider behavior, and stored-data keys remain unchanged by the physical migration.

## Frontend entry points

- Canonical browser implementations live under `web/`; `messenger-reminders.html` with its owned CSS/JavaScript provides the reviewed queue, filters, consent editor, message preview, Meta Inbox link, and audit actions.
- Existing customer URLs remain `/customer-login.html`, `/customer-portal.html`, `/customer-app.html`, and `/customer-app-popup-reminder.html` with their existing guards and redirects. `/customer-payment-proof.html` is an additional customer-session-protected, `paymentConfirmationQueue`-gated Tabler page linked from the portal. After a screenshot is selected, it displays extracted amount, reference, date/time, recipient, status, official-history result, analyzer source, and warnings, and prefills detected reference/date values. It states that analysis and history matching cannot approve or post a payment. `/messenger-reminders.html` and `/messenger-reminders` allow Admin or Collector staff; collectors see only customers in their assigned areas.
- SMS remains protected at `/sms.html`; company information, privacy, and terms pages remain public at their existing root and friendly URLs.
- SMS modal close controls use the shared Tabler outline-secondary icon-button contract with real `ti-x` icons.
- Existing CSS/JavaScript URLs, including root `/sms.js`, remain unchanged through module static composition.
- Existing migrated browser files retain their original contracts; the Messenger reminder page is an additive module-owned entry point.

## Data and dependencies

- Canonical shared storage, database, relational-readiness, password, role, storage-mode, and project-path imports come from `core/`.
- Customer Management provides customer identity, credentials, customer sessions, status, and contact records; its customer backend imports FCM/inbox helpers directly from this module.
- Billing provides balances, payment confirmations, receipts, statements, and quick-payment contracts through unchanged APIs and shared composition.
- Customer payment proof uses Customer Management's customer-authenticated `/api/customers/payments/proof/context`, `/api/customers/payments/proof/analyze`, and `/api/customers/payments/proof` contracts. The browser cannot set another account, select/configure the AI provider, claim an imported transaction, or directly create a ledger payment; OCR, Vision AI, and history results are advisory and submission status begins as Pending Review.
- Billing/due SMS scheduler runs and Messenger queue generation honor Billing's canonical Complimentary flag and omit active exempt accounts; custom/non-billing communications remain available.
- Network provides modem/GenieACS and WiFi operations through Customer Management and shared handlers.
- Admin provides integration settings, business profile, staff authorization, SMS/email provider configuration, and protected secrets.
- JSON/app-store keys include `customer_app_settings`, `customer_fcm_tokens`, `customer_notification_inbox`, and branch-scoped `messenger_reminders`. The Messenger store retains preferences, affirmative-consent audit fields, deterministic reminder identities, status, and manual action history without storing Meta credentials. Dashboard backup/restore also preserves archived `sms_messages` and `sms_automation_runs` arrays in JSON mode. Interactive SMS tools still require MySQL and their existing relational schema.
- Push, SMS, email, and Messenger credentials must never be recorded in this context.

## Known risks and follow-up

- Customer authentication and staff authentication must remain isolated.
- Notification delivery is externally stateful; retry/idempotency and audit behavior need tests.
- Messenger reminder consent is explicit and defaults off. Opening a link or recording a sent action must never be treated as authorization for automatic delivery; Meta policy review is required before any future Send API expansion.
- Shared customer/modem/payment handlers in `server.js` require Integration Codex coordination.
- The local upstream stub must not collide with production or be unintentionally enabled in production.
- Repository-root backend aliases must not be recreated.
- OCR may return partial or conflicting fields for compressed, cropped, edited, or future GCash layouts. The page must keep those warnings visible and allow Admin manual review without claiming the screenshot is genuine.
- Vision AI status is displayed as analysis provenance, not as proof of settlement. The customer-facing disclosure must remain whenever external Vision AI processing can be enabled.
- Add authenticated customer login/authorization, notification persistence, scheduler, provider-adapter, signature, and retry tests before changing behavior.

## Validation

- `npm run refactor:customer-app` verifies the descriptor, retired root entries, module web files, server wiring, canonical cross-module dependencies, repository-root Firebase paths, routers, pure FCM/inbox/SMS contracts, and Messenger reminder date/identity/link behavior.
- The Customer App compatibility check verifies the portal link, proof form, OCR and official-history analysis panel, pending-review warning, customer proof APIs, and absence of a direct browser payment-posting call.
- `npm run refactor:phase10` runs inventory, every module compatibility suite, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- The HTTP suite covers unchanged public/legal/customer/SMS pages and assets, customer/admin guards, upstream isolation, and unauthenticated Customer App/SMS denials on ports `3190`/`4190`.
- Acceptance checks do not authenticate as a real customer, write notification/token state, run schedulers, send provider messages, or call Messenger/Firebase/SMS/email services.

## Latest meaningful changes

- 2026-08-11: Removed captured-app matching and reservation from Screenshot Analysis. The page continues to show official-history matching, extracted reference/date defaults, warnings, and Pending Review status without any payment-posting capability.
- 2026-08-10: Payment Information now identifies Local OCR, Local OCR + Vision AI, or Vision AI fallback as the analyzer source, displays AI confidence/status when used, and discloses optional external processing. The page still states that screenshot analysis cannot approve a payment.
- 2026-08-10: Added server-assisted screenshot analysis to the GCash proof page. Selecting an image now shows extracted amount, reference, date/time, recipient, transaction status, history match, and warnings; detected reference/date values assist the form, while every submission still requires Admin approval.
- 2026-08-10: Added the protected Tabler GCash proof page and portal shortcut. It shows Admin-configured merchant details and the backend-calculated amount due, accepts a GCash reference, payment date, and screenshot, and displays the customer's review history without ever confirming or posting payment in browser code.
- 2026-08-07: Billing/due SMS automation and Messenger reminder generation now suppress active Billing-owned Complimentary accounts while preserving custom communications and the existing manual Messenger audit workflow.
- 2026-08-07: Standardized all SMS modal close controls as shared Tabler outline-secondary icon buttons; modal behavior is unchanged.
- 2026-08-06: Added the semi-automated Messenger Reminder Queue for admins and assigned collectors, with backend-derived billing stages, current-month payment confirmations, deterministic duplicate-resistant keys, Messenger link/consent management, manual review/copy/open workflow, sent/skip/reopen audit history, and no automatic Meta delivery.
- 2026-07-29: Dashboard full backup/restore now round-trips SMS message history and automation-run records through archive JSON keys when JSON storage is selected; provider delivery and interactive SMS behavior remain MySQL-only.
- 2026-07-29: Phase 12 revalidated Customer App through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all ten Customer App root shims; shared composition and security checks now load its manifest runtime directly.
- 2026-07-29: Physically migrated ten backend implementations and 18 browser files into the Customer App module, added root compatibility shims and module-loader/static wiring, converted dependencies to canonical paths, preserved repository-root Firebase credential lookup, and added Phase 10 compatibility and HTTP coverage.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
