# ISP Project Context

This is the durable project-wide memory for all Codex sessions. Read it with `AGENTS.md` before starting. Keep module-local details in the matching `Features/modules/<module>/Module_context.md`.

## Repository

- Working tree: `/home/archiecd/ISP`
- GitHub remote: `git@github.com:ArchieCDumayag/ISP.git`
- Main branch: `main`, tracking `origin/main`
- Multi-Codex coordination: `python3 scripts/ai_coord.py`
- Coordination state: `.ai_coord/` (ignored; never edit manually)

## Runtime and deployment

- Development checkout uses `.env`, JSON storage, app port `3100`, and customer-upstream port `4101`.
- Start development with `npm start` or `node server.js` from `/home/archiecd/ISP`.
- Existing production runs separately from `/opt/isp-billing` as `isp-billing.service` on ports `3000` and `4001`.
- The Windows test origin at `http://localhost:3000` is assigned to the locally managed `thre3j-billing` Cloudflare Tunnel for the requested `3jtestserver.com` hostname. Public DNS remains pending until the domain is registered in the Cloudflare account.
- The Ubuntu installer validates the canonical Customer App `company-info.html` runtime before dependency installation and explicitly restarts an existing systemd service after Git updates, preventing stale pre-module routes from remaining active.
- Never modify or restart production unless the user explicitly requests it.
- Lock `runtime/server` before changing the development runtime.

## Technology

- Node.js/CommonJS and Express 5
- Static HTML, CSS, and browser JavaScript under module `web/` roots and shared `public/`
- JSON file storage by default under ignored `data/`
- Optional MySQL through `mysql2` and the relational helpers
- Firebase Admin, Nodemailer, Puppeteer, MikroTik RouterOS client, XLSX, and Archiver integrations

## Architecture

The current application is a manifest-driven modular monolith:

- `server.js` is the only repository-root JavaScript composition file and owns route mounts plus remaining cross-module handlers.
- Business implementations live only under `Features/modules/*/backend`; the former root CommonJS aliases were retired in Phase 11.
- Shared infrastructure lives only under canonical `core/` paths.
- `public/` contains the shared shell and integration-owned browser assets; eight business modules plus the hidden Temp auxiliary module own canonical module web roots.
- `Features/modules/` is the authoritative module ownership layer for parallel Codex work.
- Module manifests map canonical ownership and declare live backend/web runtime entries for all eight business modules plus Temp; `server.js` composes all nine runtimes from this registry.
- Runtime files must only be physically moved in a dedicated compatibility migration.

Canonical shared runtime structure:

- `core/config`: environment loading, storage-mode selection, and feature/flavor configuration
- `core/data`: JSON/MySQL persistence, relational readiness, and protected database configuration
- `core/security`: passwords, roles, rate limiting, and session primitives
- `core/runtime`: canonical project paths, module manifest registry, guarded module entry loader, and complete runtime composition
- Root Core aliases are retired and must not be recreated.

Canonical Admin runtime structure:

- `Features/modules/admin/backend`: authentication, accounts, activity, profile, integrations, information, downloads, protected project-data reset, and setup/update implementation
- `Features/modules/admin/web`: Admin-owned pages and assets mounted at unchanged root URLs
- Former Admin root backend aliases: retired in Phase 11

Canonical Customer Management runtime structure:

- `Features/modules/customer-management/backend`: customers, drafts, archives, coverage, referrals, and Philippine address data
- `Features/modules/customer-management/web`: customer administration and public application pages/assets mounted at unchanged root URLs
- Former Customer Management root backend aliases: retired in Phase 11

Canonical Billing runtime structure:

- `Features/modules/billing/backend`: plans, payments, billing scheduler/helpers, records, confirmations, and disconnection implementation
- `Features/modules/billing/web`: Billing pages and assets mounted at unchanged root URLs
- Former Billing root backend aliases: retired in Phase 11

Canonical Network runtime structure:

- `Features/modules/network/backend`: MikroTik connection/operations/auditing, PPPoE helpers, and PON management implementation
- `Features/modules/network/web`: PPPoE, PON, GenieACS, and coverage-map pages/assets mounted at unchanged root URLs
- Former Network root backend aliases: retired in Phase 11

Canonical Collector runtime structure:

- `Features/modules/collector/backend`: assignment, next-due, field payment, approval, reprint, and remittance implementation
- `Features/modules/collector/web`: assignment/approval and collection-history pages/assets mounted at unchanged root URLs
- Former Collector root and `routes/` backend aliases: retired in Phase 11

Canonical Technician runtime structure:

- `Features/modules/technician/backend`: tickets, jobs, job numbering, technician assignments, and installation/provisioning implementation
- `Features/modules/technician/web`: tickets, technician jobs, job history, and technician customer-draft pages/assets mounted at unchanged root URLs
- Former Technician root backend aliases: retired in Phase 11

Canonical Finance runtime structure:

- `Features/modules/finance/backend`: branch-scoped expense and payroll implementation
- `Features/modules/finance/web`: expense, payroll, and retained reporting assets mounted at unchanged root URLs
- Former Finance root backend aliases: retired in Phase 11
- Shared dashboard collection-breakdown composition remains in `server.js`

Canonical Customer App runtime structure:

- `Features/modules/customer-app/backend`: customer app, FCM/inbox, Firebase, Messenger webhook, semi-automated Messenger billing reminders, SMS, scheduler, schema, and customer-upstream implementation
- `Features/modules/customer-app/web`: customer login/portal/app, Messenger reminder queue, SMS, public legal/company pages, and assets mounted at root URLs
- Former Customer App root backend aliases: retired in Phase 11
- Customer Management consumes canonical Customer App FCM/inbox helpers directly; shared customer/modem/payment composition remains in `server.js`
- `/api/messenger-reminders` and `/messenger-reminders.html` provide a branch-scoped, semi-automated payment reminder queue derived from Billing's backend payment records. Admins see their branch; collectors see assigned areas only. Reminder identities are deterministic per account/cycle/stage or payment, consent defaults off, queue regeneration is idempotent, and staff must review/open Messenger and explicitly mark each message sent. The feature never automatically delivers billing reminders through Meta.

Canonical Temp auxiliary runtime structure:

- `Features/modules/temp/backend`: dedicated `/api/temp` customer/ledger router and isolated `temp_workspace_isolated_v1` persistence used only by the secondary-location workspace.
- `Features/modules/temp/web`: hidden Admin-only `/temp.html` standalone Customer and Billing UI plus its CSS/JavaScript assets; it never embeds or calls the main-location pages/APIs.
- Temp is intentionally absent from shared navigation. The direct URL is unlisted, not public; shared Admin authentication remains the security boundary.

## Modules

| Module | Ownership folder | Primary scope |
| --- | --- | --- |
| Customer Management | `Features/modules/customer-management` | Customer records, drafts, archive, coverage, public applications, referrals |
| Billing | `Features/modules/billing` | Plans, billing cycles, balances, payments, confirmations, statements, disconnections |
| Network | `Features/modules/network` | MikroTik, PPPoE, PON, GenieACS, network/serviceability maps |
| Collector | `Features/modules/collector` | Collector assignments, collection entry, receipts, approvals, remittances |
| Technician | `Features/modules/technician` | Tickets, jobs, assignments, installation and provisioning workflows |
| Finance | `Features/modules/finance` | Expenses and payroll |
| Customer App | `Features/modules/customer-app` | Customer portal/app, notifications, Firebase, Messenger webhook/reminder queue, SMS |
| Admin | `Features/modules/admin` | Authentication, accounts, business profile, integrations, activity, updates/downloads |
| Temp Workspace | `Features/modules/temp` | Hidden secondary-location customer and billing ledger with isolated data, API, and backup files |

Each module contains `README.md`, `module.json`, and `Module_context.md`. The manifest's `ownedPaths` field is the machine-readable source-ownership map.

## Shared integration-owned code

Shared code includes `server.js`, database/storage helpers, environment loading, role/password/session helpers, feature/flavor plumbing, package files, common public shell assets, and repository scripts. Changes to shared code require an integration task, explicit locks, cross-module review, and a `Project_Context.md` update when the contract changes.

## Storage and secrets

- Default: `STORAGE_DRIVER=json`; missing or blank storage configuration resolves to JSON, only an explicit `mysql` value enables relational mode, and unsupported values are rejected.
- JSON runtime data: `data/*.json`
- Temp secondary-location records use the exclusive `temp_workspace_isolated_v1` store key (`data/temp_workspace_isolated_v1.json` in JSON mode or a distinct `app_store` row in MySQL mode) and never share the canonical customer/payment stores.
- Optional relational mode: `STORAGE_DRIVER=mysql`
- Dashboard `/api/export/customers-full` produces a schema-versioned backup with metadata, customer-name/balance/list/full-data views, canonical customers, plans, payment entries, all branch tickets/jobs, SMS messages, SMS automation runs, flattened PON/NAP connections, and chunked branch PON state. Export removes exact duplicate canonical rows and stops if one stable identity contains conflicting data. `/api/import/customers-full` restores the canonical sheets (derived customer views are regenerated), upserts stable IDs, skips exact duplicates, rejects conflicting identities before any write, and prevents payments with a new ID from reusing an existing fingerprint or Xendit ID. JSON mode preserves unrelated data without requesting MySQL; MySQL mode retains its relational transaction and returns a configuration-focused `503` when unavailable. Import responses report per-table and total duplicate counts. Empty-sheet `note: No records` placeholders are ignored.
- Sensitive integration configuration depends on `CONFIG_MASTER_KEY`.
- IP Browser auto-login supports protected per-router profiles stored inside each branch's integration settings. Profiles select credentials from the assigned-IP target using exact host/port, exact host, IPv4 CIDR, or wildcard rules in specificity order; unmatched targets continue using the legacy default IP Browser credentials. The same resolver is used by proxied browser pages, direct WiFi changes, and connected-device scans.
- Production requires a strong `SESSION_TOKEN_SECRET`.
- `.env`, `data/`, logs, backups, Firebase/service-account files, and `.ai_coord/` are ignored.
- Do not record secret values in any context or coordination update.

## Important commands

```bash
npm ci
npm start
node server.js
python3 scripts/ai_coord.py status
python3 scripts/ai_coord.py modules
npm run check:security
npm run refactor:phase3
npm run refactor:phase4
npm run refactor:phase5
npm run refactor:phase6
npm run refactor:phase7
npm run refactor:phase8
npm run refactor:phase9
npm run refactor:phase10
npm run refactor:temp
npm run refactor:phase11
npm run refactor:phase12
npm test
```

The local development login page is `http://localhost:3100/login.html` when the development server is running.

## Shared API and UI composition

- Express routers are mounted centrally in `server.js`.
- The shared static shell comes from `public/index.html`, `public/layout.js`, `public/sidebar.html`, `public/topbar.html`, `public/styles.css`, and related common assets.
- Shared `public/css/tabler-app.css` applies Tabler's installed default sans-serif stack (`Inter Var`, `Inter`, then system fallbacks) to all rendered UI text across every module page; code-like elements retain Tabler's monospace stack and icon-font classes retain their dedicated fonts.
- Shared `.close-modal` controls use actual Tabler `btn btn-icon btn-outline-secondary` markup with the `ti-x` icon. `public/css/tabler-app.css` keeps their Tabler sizing, variables, contrast, hover, and focus treatment consistent in light and dark themes without changing modal JavaScript.
- Module pages and API prefixes are recorded in each `Module_context.md` and `module.json`.
- `/api/payment-records` is the canonical cross-page billing read model. Each record includes a versioned backend-only `billingSummary`; Payments, Customers, Payment History, and Payment Breakdown require this response and do not fall back to browser billing calculations. `/api/payment-records/reconciliation/report` recalculates branch records and reports duplicate cycles, missing calculated charges, invalid advances/carry-over, missing current cycles, and ending-balance mismatches.
- Effective plan changes are a Billing/Customer Management contract. Billing validates the plan against the canonical plan store, owns the effective-date audit/history and open-cycle recalculation, preserves finalized bill rows, and carries paid-cycle differences once as a debit or credit. Customer Management persists the current subscriber plan and router-specific PPPoE profile or an explicit future scheduled snapshot; the Billing scheduler applies/retries future snapshots. Direct browser-authored plan amounts are rejected. Prepaid/postpaid type transitions remain a subscriber-editor workflow, and the isolated Temp workspace is not involved.
- Referrals are a Customer Management/Billing/Admin contract. Customer Management owns the branch-scoped `referral_registry`, create/edit/approval/cancellation state, locked approval amounts, optional audited `applyFromMonth`, unlimited FIFO queue, and audit history; Admin approval is sufficient and no referred-client payment is required. Blank `applyFromMonth` means next available, while a selected current/future month is the earliest eligible billing month; active applications are locked until reversed. Canonical payment-record reads automatically apply the two oldest eligible queued customer referrals to the latest generated unpaid month without exceeding its remaining charge, then carry all excess or future-scheduled records forward. Applications are single-use; reversals skip their original month and return to the later queue. Manual/browser-authored referral application amounts are rejected. Admin Clear All Data resets the registry. Temp remains untouched.
- Any change to shared navigation, route mounts, common middleware, auth/session contracts, storage contracts, or cross-module response shapes is integration work.
- `/temp.html` and `/api/temp` are protected for Admin sessions and deliberately have no sidebar/dashboard link. They form a standalone secondary-location workspace and never read, write, embed, or call the canonical Customer Management/Billing stores, pages, or APIs.
- `/api/admin-data-reset` and the Data Reset section in `/accounts.html` provide the global destructive reset workflow. Preview is read-only; execution requires an authenticated Admin's current password, the exact `CLEAR ALL DATA` phrase, irreversible acknowledgement, and final browser confirmation. It clears operational records in all modules and branches, including Temp, generated backups/cache, and payment proofs, while preserving Admin access, branches, business/system configuration, integrations, app downloads, MySQL configuration, and source code. Tests use injected in-memory stores and never execute the live reset.

## Known risks

- All eight business modules have physical filesystem/runtime boundaries and canonical-only dependency paths; shared `server.js` composition remains a deliberate integration boundary.
- `server.js` is large and is a frequent cross-module integration point.
- The general repository-root static fallback was removed; shared assets must live in `public/` and module assets in module `web/` roots.
- Temp is a deliberately lightweight isolated ledger and does not inherit the main Billing scheduler, network enforcement, tickets, SMS, collector, or customer-portal automations.
- On 2026-07-29, `npm audit --omit=dev` reports 28 dependency findings (2 low, 12 moderate, 12 high, and 2 critical); the direct `xlsx` dependency has high-severity findings for which npm reports no fix. Remediation requires a separate compatibility/security task.
- `@jobuntux/psgc` declares Node.js 22 or newer, while this server currently runs Node.js 20; smoke testing succeeds, but the engine mismatch remains.
- Fixed bootstrap account credentials must be generated/rotated per production deployment and never copied into context files.
- The completed refactor remains local and uncommitted; commit, push, and production deployment require explicit approval.
- The production deployment is separate from this checkout and does not include the local refactor.

## Multi-Codex decision

Use one shared working tree and the coordination script. Agents lock exact files/folders, update their module context with every module change, and reserve shared wiring for an Integration Codex. The authoritative workflow is in `AGENTS.md` and `start_codex.md`.

## Physical module refactor

- The physical migration is divided into 12 ordered phases documented in `docs/refactor/PHASES.md`.
- On 2026-07-29, the four canonical storage modules under `core/data/` were restored after the broad `data/` ignore rule omitted them from the refactor commit. The ignore rules now explicitly re-include canonical `core/data/` source while runtime data directories remain ignored, and the cutover check accepts both LF and CRLF checkouts.
- Phase 1 is complete. It established the immutable legacy inventory and repeatable structural/runtime acceptance checks in `docs/refactor/` and `scripts/refactor/`.
- Phase 2 is complete. It introduced the runtime loader, guarded canonical paths, shared-core layout, and temporary migration shims; Phase 11 later retired those shims.
- Phases 3–10 are complete. They moved Admin, Customer Management, Billing, Network, Collector, Technician, Finance, and Customer App into canonical module runtimes while preserving their API and browser contracts.
- Phase 11 is complete. All 70 root backend/Core shims and one orphan root stylesheet are removed; server composition, scripts, security checks, installer package requirements, and cross-module imports use canonical paths.
- Phase 11 also removed repository-root static source fallback, retained shared shell assets under `public/`, and added `npm run refactor:integration` plus `npm run refactor:phase11`.
- Phase 12 is complete. It adds `npm test`/`npm run refactor:phase12`, validates the distributable canonical package, reconciles project and module guidance, and records production-release conditions in `docs/refactor/phase-12-cutover-readiness.md`.
- The modular architecture and shared-tree coordination workflow are ready for multiple Codex sessions. Production release remains conditional on the documented security/dependency/runtime/manual checks and is a separate operation.
- Run `npm run refactor:verify` before and after future physical file moves.
- Run `npm run refactor:smoke` after module wiring, shared routing, or static-delivery changes.
- The isolated smoke runtime uses ports `3190` and `4190`; normal development remains on `3100` and `4101`.

## Latest integration changes

- 2026-08-07: Added audited referral application scheduling. Admin may choose an optional current/future **Apply From Month** during approval or reschedule an approved referral with no active application; Billing waits until that earliest month, then retains FIFO, the two-per-month cap, and automatic carryover. Temp remains unchanged.
- 2026-08-07: Changed referral eligibility to Admin approval and added unlimited FIFO carryover. Billing automatically applies at most two locked referrals per generated unpaid month, retains excess for later months, and returns reversals to the later queue without depending on the referred client's payment. Temp remains unchanged.
- 2026-08-07: Centralized the referral workflow across Customer Management, Billing, and Admin. Referrals now use an audited branch registry with Pending/Eligible/Applied/Reversed/Cancelled states; Payment Breakdown applies backend-owned amounts only to validated billing months, and factory reset clears the registry. Temp remains unchanged.
- 2026-08-07: Added backend-owned effective plan changes across Billing and Customer Management. The full Payment Breakdown page now supports audited past/current/future upgrades or downgrades, paid bill protection with debit/credit carry adjustments, subscriber plan history, immediate current PPPoE profile synchronization, and retry-safe future scheduling. Temp remains unchanged.
- 2026-08-07: Standardized shared `.close-modal` controls as Tabler outline-secondary icon buttons with real `ti-x` glyphs, including the formerly empty Customer view close control. Shared sizing, contrast, hover, and focus behavior now follow Tabler variables in both themes.
- 2026-08-06: Added the global Admin factory-reset workflow in Admin Settings. It uses read-only preview, current-password and typed-phrase authorization, JSON rollback or a MySQL transaction, preserves Admin/configuration state, clears operational module/Temp records plus generated record files, and is covered without executing the live reset.
- 2026-08-06: Completed the backend-only Billing read cutover. Version 2 of `/api/payment-records` supplies rows, current/next cycles, status, due date, balance, advance, and reconciliation results; the four Billing/Customer pages show an unavailable state instead of recalculating in the browser. Postpaid generation remains month-end only, and the isolated Temp module is unchanged.
