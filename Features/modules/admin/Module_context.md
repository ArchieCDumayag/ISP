# Admin Module Context

Last reviewed: 2026-08-10
Status: Physically modularized and loaded through the runtime module manifest.

## Purpose and current scope

- Authenticate staff, collectors, and technicians; create/verify sessions and enforce roles.
- Manage protected admin accounts and primary/backup admin safeguards.
- Maintain business profile, protected integration settings, activity logs, and app downloads.
- Provide an Admin-only, password-confirmed project factory reset for operational records across all modules and branches.
- Expose the information API plus owner-only setup, schema, flavor, and update tools.

## Canonical runtime layout

- `backend/index.js` is the lazy Admin backend descriptor loaded from `module.json`.
- `backend/auth.js`: `/api/auth` and shared Admin/Collector/Technician session contracts.
- `backend/accounts.js` and `backend/accounts-store.js`: `/api/accounts` and protected accounts.
- `backend/activity-log.js` and `backend/activity-log-visibility.js`: audit persistence and visibility.
- `backend/business-profile.js`: `/api/business-profile`.
- `backend/factory-reset.js`: `/api/admin-data-reset` preview and reset operations. Reset requires the current Admin password, the exact `CLEAR ALL DATA` phrase, an irreversible-action acknowledgement, and a final browser confirmation.
- `backend/integration-settings.js`: `/api/integrations` and protected settings.
- `backend/info-api.js`: `/api/info` aggregation.
- `backend/app-downloads.js` and `backend/app-downloads-store.js`: `/api/app-downloads`.
- `backend/setup-installer.js`: owner-only `/api/structure` and structure package operations.
- `web/` contains Admin-owned browser files. It is mounted after page authorization guards and before the shared `public/` fallback.
- Root browser-asset delivery checks shared `public/` and module web roots only, which keeps `/accounts.js` mapped to the Admin browser bundle without exposing repository source files.

The former eleven root backend shims were retired in Phase 11. Existing browser URLs and API prefixes did not change.

## Browser entry points

- `/login.html` → `web/login.html`
- `/accounts.html` → `web/accounts.html`
- The Accounts tab bar exposes GCash as a normal settings panel. Admins can view and edit the merchant account name, number, and QR code without relying on a hidden integration panel.
- The `Data Reset` section inside `/accounts.html` displays current record/file counts, deletion and preservation scope, an Android offline-data warning, and the guarded reset form.
- `/flavors.html` → `web/flavors.html`
- `/setup.html` → `web/setup.html`
- `/install-guide.html` → `web/install-guide.html`
- `/update-download.html` → `web/update-download.html`

Shared shell, vendor, branding, and Tabler assets continue to fall back to `public/`. `web/css/accounts.css` is also consumed by Network module pages through its unchanged `/css/accounts.css` URL.

## Data and dependencies

- Canonical shared imports come from `core/data`, `core/security`, and `core/runtime`.
- MikroTik endpoint normalization and Billing dependencies resolve directly from canonical module backends; no module imports repository-root backend aliases.
- Repository-root configuration remains `service-config.json` and `structure-manifest.json`.
- Installer paths explicitly use `core/runtime/paths.PROJECT_ROOT`; moving the backend must never redirect releases, scripts, `.cloudflared`, or package operations into the module folder.
- Structure downloads and validation include the Admin backend/web paths, and page-scoped packages recognize module web pages.
- Every business module depends on Admin authentication/authorization contracts.
- Admin collector login and information flows resolve next-due calculations directly from the migrated Collector backend.
- Owner-only routes require localhost plus `STRUCTURE_OWNER_ID`.
- Sensitive integration data requires `CONFIG_MASTER_KEY`; production sessions require `SESSION_TOKEN_SECRET`.
- IP Browser integration settings support up to 100 enabled/disabled router profiles. Each profile stores a label, ordered exact IP/IP:port, IPv4 CIDR, or wildcard match rules, protected username/password data, optional page selectors, and submit delay. Exact host/port matches outrank host matches, which outrank CIDR and wildcard rules; profile order breaks ties.
- IP Browser profile credentials and usernames are redacted from `/api/integrations` responses and represented only by presence flags. Blank username/password values sent while editing an existing profile preserve the stored secrets. The legacy top-level IP Browser credentials remain the fallback when no profile matches.
- Factory reset deletes customers, plans, billing/payment history, imported GCash transaction history, the centralized referral registry/application audit, collector/technician accounts and assignments, schedules/reminders, tickets/jobs, PON/coverage state, Finance, SMS records/templates/automations, Temp workspace records, activity history, generated backups/cache, legacy record uploads, and payment proof files. It preserves Admin accounts/sessions, branches, business profile, account-number and Customer App/collector settings, integrations, app downloads, MySQL configuration, and source code. A non-secret last-reset audit marker is retained.
- JSON reset rewrites known business stores to empty canonical shapes with rollback on store-write failure. MySQL reset deletes business tables and business `app_store` keys in a transaction, retaining only Admin users/sessions and configuration tables/keys. Generated-file cleanup runs after the record transaction and reports any file warnings.

## Verification contract

- `npm run refactor:admin` checks the manifest, loader, retirement of eleven root entries, ten web files, server wiring, canonical installer paths, IP Browser match precedence, secret redaction/preservation, profile-editor structure, and the visible GCash tab contract.
- `npm run refactor:phase3` runs structural, core, Admin, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- HTTP coverage includes public Admin files, protected-page redirects, owner-page denial, and unauthenticated API denial.
- Admin compatibility tests exercise the JSON factory-reset service in memory, including Admin/session/configuration preservation, centralized referral-registry and imported GCash-history clearing, dynamic Finance-store clearing, audit creation, and UI/API wiring. Smoke coverage requires authentication for reset preview and confirms the new CSS/JavaScript assets are served.
- The 2026-08-06 factory-reset change passed syntax checks, read-only live preview, `npm run refactor:admin`, isolated HTTP smoke tests, and the complete `npm test` Phase 12 suite. Local port 3000 serves the new assets and returns `401` for unauthenticated reset preview. In-app visual testing was unavailable because no browser session was connected.
- The 2026-07-30 IP Browser profile change passed JavaScript syntax checks, HTML structure parsing, `npm run refactor:admin`, and the complete `npm test` Phase 12 suite. Interactive browser-control verification was unavailable in that session.

## Known risks and follow-up

- Auth/session/account changes are high risk and require negative authorization tests.
- Never expose secrets through API responses, logs, contexts, coordination updates, or commits.
- Overlapping IP Browser CIDR or wildcard profiles can both match the same target; the more specific score wins and profile order breaks equal-score ties. Keep match rules narrow and non-overlapping when practical.
- Owner-only route guards must preserve both localhost and owner checks.
- `auth.js` still contains Collector/Technician login contracts; coordinate those module migrations.
- Admin CSS is shared by Network pages; preserve its unchanged public URL.
- System update/setup behavior can affect deployment and schema state; never run production mutations without explicit approval.
- Factory reset is global, permanent, and intentionally does not create a backup. Android offline records exist outside the server and can upload again after Sync unless cleared on those devices.
- Add a fuller automated role matrix, session invalidation, protected-account, and authenticated owner-route suite.

## Latest meaningful changes

- 2026-08-10: Added Billing's `gcash_transaction_history` app-store key to the guarded Clear All Data contract and Admin compatibility coverage; integration settings and merchant details remain preserved.
- 2026-08-10: Exposed the existing GCash merchant integration as a visible Accounts settings tab, retaining the existing account-name, mobile-number, QR upload, status, validation, and save behavior.
- 2026-08-07: Added `referral_registry` to the protected project-data reset contract so Clear All Data also removes referral relationships and application audit records across branches.
- 2026-08-06: Added the Admin Settings Data Reset section and `/api/admin-data-reset`, with live deletion preview, current-password verification, exact confirmation phrase, irreversible acknowledgement, final UI confirmation, concurrency/rate limiting, JSON rollback, transactional MySQL deletion, retained Admin/configuration access, generated-file cleanup, and a non-secret audit marker. Validation never invokes the live reset.
- 2026-07-30: Added protected multi-router IP Browser profiles with exact IP/port, CIDR, and wildcard matching; Accounts now manages per-profile credentials/selectors/delay while keeping the former global login as the unmatched-device fallback.
- 2026-07-29: Phase 12 revalidated Admin through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all eleven Admin root shims, switched cross-module imports to canonical Billing paths, and changed structure-package requirements to the canonical Admin installer only.
- 2026-07-29: Phase 3 moved eleven backend implementations and ten web files into this module, added manifest runtime entries, preserved root imports and public URLs, made installer paths repository-root-safe, and added Admin regression gates.
- 2026-07-29: Phase 6 switched integration settings to the canonical Network endpoint normalizer after the Network migration.
- 2026-07-29: Phase 7 switched collector authentication and information flows to the canonical Collector next-due helper.
- 2026-07-29: Established Admin ownership manifest and durable module context.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
