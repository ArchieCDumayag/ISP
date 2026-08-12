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
- Firebase Admin, Nodemailer, Puppeteer, MikroTik RouterOS client, XLSX, Archiver, local Tesseract.js OCR, and optional OpenAI-compatible Vision AI integrations

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

- `Features/modules/technician/backend`: tickets, canonical dispatch workflow/events, jobs, job numbering, technician assignments/offline sync, and installation/provisioning implementation
- `Features/modules/technician/web`: the Admin dispatch dashboard plus tickets, job history, and technician customer-draft pages/assets mounted at unchanged root URLs
- Dispatch work orders retain customer/location/plan snapshots, appointment windows, SLA, structured field evidence, optimistic versions, and append-only events. Technician APIs return only assigned work and accept retry-safe offline mutation batches.
- A future Android technician app is a separate package/project from the Collector app and must use the Technician APIs and its own local/offline storage.
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
- Dashboard `/api/export/customers-full` produces a schema-versioned backup with metadata, customer-name/balance/list/full-data views, canonical customers, plans, payment entries, all branch tickets/jobs (including dispatch snapshots, workflow state, evidence metadata, and record versions), SMS messages, SMS automation runs, flattened PON/NAP connections, and chunked branch PON state. Export removes exact duplicate canonical rows and stops if one stable identity contains conflicting data. `/api/import/customers-full` restores the canonical sheets (derived customer views are regenerated), upserts stable IDs, skips exact duplicates, rejects conflicting identities before any write, and prevents payments with a new ID from reusing an existing fingerprint or Xendit ID. JSON mode preserves unrelated data without requesting MySQL; MySQL mode retains its relational transaction and returns a configuration-focused `503` when unavailable. Import responses report per-table and total duplicate counts. Empty-sheet `note: No records` placeholders are ignored. Append-only technician job events are not yet included in this workbook and remain a documented Technician follow-up.
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
- Shared `public/js/tabler-enhance.js` enforces explicit modal dismissal across module pages: Escape and backdrop/outside clicks do not close an open modal, while interactive Close/Cancel controls and successful completed actions continue to close it. Interactive controls are excluded from modal-root detection so names such as `close-modal` cannot be mistaken for a backdrop. Enhanced Bootstrap modals also receive static-backdrop and keyboard-disabled settings. Temp's standalone native dialogs independently follow the same behavior.
- Module pages and API prefixes are recorded in each `Module_context.md` and `module.json`.
- `/api/payment-records` is the canonical cross-page billing read model. Each record includes a versioned backend-only `billingSummary`; Payments, Customers, Payment History, and Payment Breakdown require this response and do not fall back to browser billing calculations. `/api/payment-records/reconciliation/report` recalculates branch records and reports duplicate cycles, missing calculated charges, invalid advances/carry-over, missing current cycles, and ending-balance mismatches.
- Customer GCash proof is a three-module contract: the Customer App owns `/customer-payment-proof.html`; Customer Management derives the authenticated account, exact current balance, and Admin-configured merchant details at `/api/customers/payments/proof/context`, provides customer-session-only analysis preview at `/api/customers/payments/proof/analyze`, and independently analyzes accepted evidence at `/api/customers/payments/proof`; Billing stores pending evidence, sanitized extracted fields/checks/provenance, official-history results, and duplicate reference/image results. OCR runs locally first with Tesseract.js and packaged English data. An optional OpenAI-compatible Vision AI endpoint is disabled by default and runs only for incomplete/low-confidence OCR after explicit environment opt-in; it fills missing fields without overwriting local reads, stores no endpoint/key/raw provider response, and exposes AI-only provenance as advisory. Both analyzers compare amount/reference/date/recipient/status with the invoice, merchant, and imported history. Screenshots, OCR, AI, and matches never post payment. Only staff **Approve & Post** creates the ledger credit and invokes receipt/service-restoration behavior; reliable contradictions require new evidence.
- Official GCash history verification is a Billing/Admin integration contract. Admin manually uploads the password-protected email PDF at the Payment Confirmation Queue. Billing stores only branch-scoped normalized rows, batch/file hashes, and sanitized claimed/posted allocations in `gcash_transaction_history`, then compares pending proofs by reference, incoming credit, exact amount, date, Admin-configured recipient, and available sender/customer-mobile evidence. Every match remains Pending Review. Approval locks the submitted amount/reference, requires explicit customer-and-bill confirmation, claims one imported transaction for exactly one submission/account before posting, and finalizes that allocation with the payment entry; wrong-customer or reused claims fail closed. Only explicit Admin approval reaches the existing ledger, receipt, and MikroTik restoration path. Admin Clear All Data removes imported history while preserving integration configuration.
- Effective plan changes are a Billing/Customer Management contract. Billing validates the plan against the canonical plan store, owns the effective-date audit/history and open-cycle recalculation, preserves finalized bill rows, and carries paid-cycle differences once as a debit or credit. Customer Management persists the current subscriber plan and router-specific PPPoE profile or an explicit future scheduled snapshot; the Billing scheduler applies/retries future snapshots. Direct browser-authored plan amounts are rejected. Prepaid/postpaid type transitions remain a subscriber-editor workflow, and the isolated Temp workspace is not involved.
- Referrals are a Customer Management/Billing/Admin contract. Customer Management owns the branch-scoped `referral_registry`, create/edit/approval/cancellation state, locked approval amounts, optional audited `applyFromMonth`, unlimited FIFO queue, and audit history; Admin approval is sufficient and no referred-client payment is required. Blank `applyFromMonth` means next available, while a selected current/future month is the earliest eligible billing month; active applications are locked until reversed. Canonical payment-record reads automatically apply the two oldest eligible queued customer referrals to the latest generated unpaid month without exceeding its remaining charge, then carry all excess or future-scheduled records forward. Applications are single-use; reversals skip their original month and return to the later queue. Manual/browser-authored referral application amounts are rejected. Admin Clear All Data resets the registry. Temp remains untouched.
- Complimentary accounts are a Billing-owned cross-module policy, not a zero-price plan. An audited current/future period suppresses recurring charges, billing/due reminders, referral consumption, and credit-limit disconnection while keeping service eligible and preserving the subscriber's real plan, history, and either the existing balance or an explicitly captured one-time write-off. Payments, Payment Breakdown, Customers, and Collector client review display the canonical flag; finite periods resume on the next prepaid first-of-month or postpaid month-end cycle without back-billing. Direct client-authored periods are rejected. Temp remains untouched.
- Stopped-billing reconnection is a Billing-owned audited settlement instead of a status toggle. It never back-bills the disconnected interval; it snapshots and separately retains, writes off, or installments the previous balance, then starts new billing with a remaining-days proration, a complete-plan full-month charge, or the next regular prepaid first-day/postpaid month-end cycle. Either immediate charge advances the following regular cycle and is rejected if the current month already has a generated bill. Immediate and collected-payment-gated service activation are supported; pending requests create no charge, and delayed payment restarts dates from the actual service activation day. Continue-billing disconnections retain their existing cycles. Temp remains untouched.
- Any change to shared navigation, route mounts, common middleware, auth/session contracts, storage contracts, or cross-module response shapes is integration work.
- `/temp.html` and `/api/temp` are protected for Admin sessions and deliberately have no sidebar/dashboard link. They form a standalone secondary-location workspace and never read, write, embed, or call the canonical Customer Management/Billing stores, pages, or APIs.
- `/api/admin-data-reset` and the Data Reset section in `/accounts.html` provide the global destructive reset workflow. Preview is read-only; execution requires an authenticated Admin's current password, the exact `CLEAR ALL DATA` phrase, irreversible acknowledgement, and final browser confirmation. It clears operational records in all modules and branches, including Temp, generated backups/cache, and payment proofs, while preserving Admin access, branches, business/system configuration, integrations, app downloads, MySQL configuration, and source code. Tests use injected in-memory stores and never execute the live reset.

## Known risks

- All eight business modules have physical filesystem/runtime boundaries and canonical-only dependency paths; shared `server.js` composition remains a deliberate integration boundary.
- `server.js` is large and is a frequent cross-module integration point.
- The general repository-root static fallback was removed; shared assets must live in `public/` and module assets in module `web/` roots.
- Temp is a deliberately lightweight isolated ledger and does not inherit the main Billing scheduler, network enforcement, tickets, SMS, collector, or customer-portal automations.
- Enabling GCash Vision AI sends unclear payment screenshots to the operator-configured external endpoint. It remains disabled by default; deployments that opt in must protect credentials and review the provider's privacy, retention, and residency terms.
- On 2026-08-10, `npm audit --omit=dev` reports 29 dependency findings (2 low, 12 moderate, 13 high, and 2 critical); `pdfjs-dist` is not identified in those findings, while the direct `xlsx` dependency still has high-severity findings for which npm reports no fix. Remediation requires a separate compatibility/security task.
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
- The HTTP smoke child process forces the default isolated feature profile and ignores live `data/flavor-features.json`, `ACTIVE_FLAVOR_NAME`, and inherited `FLAVOR_FEATURES`, so feature-gate assertions are deterministic without changing the operator's enabled pages.

## Latest integration changes

- 2026-08-12: Isolated the HTTP smoke server from live flavor settings. The suite now clears any active flavor and supplies the default feature profile explicitly, so locally enabled Payment Confirmation Queue pages cannot change the expected default-profile `404` checks.
- 2026-08-11: Removed Gmail-based GCash history automation and the Android GCash notification bridge from runtime, APIs, queues, proof analysis, and shared composition. Manual official-history PDF import remains the sole record-match source, and only explicit Admin **Approve & Post** can create a ledger payment or restore service.
- 2026-08-10: Added a disabled-by-default, OpenAI-compatible Vision AI fallback to the three-module GCash proof contract. It runs only after incomplete/low-confidence local OCR, supplements missing fields with provenance and visible warnings, exposes sanitized source/status in customer and Admin review, and cannot bypass imported-history matching, immutable allocation, or explicit Admin approval.
- 2026-08-10: Added immutable GCash transaction allocation. Imported references now show Available, Reserved, or Assigned and Posted state; GCash approval locks submitted fields, blocks reliable screenshot contradictions, flags sender/customer-mobile mismatch, requires explicit Admin customer/bill confirmation, and records one durable reference-to-submission/account/payment assignment before any ledger or MikroTik effect.
- 2026-08-10: Added local GCash screenshot OCR to the customer proof contract. The upload preview and final submission extract and compare payment fields, persist review metadata in JSON or MySQL, expose it to the Admin queue, and retain the independent official-history plus explicit-approval gates.
- 2026-08-10: Added official GCash Transaction History PDF import and proof matching. Admin can import the encrypted email statement without Xendit; normalized branch data supports queue badges and a fail-closed approval gate, but no parsed match can automatically confirm or post a payment.
- 2026-08-10: Added the customer GCash proof-submission contract across Customer App, Customer Management, Billing, schema, and shared page protection. Default JSON and optional MySQL storage retain payment date plus screenshot SHA-256; all accepted evidence remains Pending Review, and only Admin approval posts the canonical payment and runs existing paid-service restoration.
- 2026-08-08: Added the field-service dispatch foundation without changing the Collector app. The Technician module now owns a canonical work-order lifecycle, customer/location snapshots, appointment/SLA fields, structured evidence, append-only audit events, optimistic concurrency, technician-scoped offline sync, workload/CSV APIs, and a map-based Admin dashboard. Dispatch staff currently use an Admin account because the shared authentication model has no separate Dispatcher/Supervisor role. MySQL deployments must run the additive schema migration before restart; the future Android technician client remains a separate app.
- 2026-08-07: Standardized modal dismissal across the project. Shared module modals and standalone Temp dialogs now ignore Escape and backdrop/outside clicks while retaining explicit Close/Cancel controls and successful action completion; interactive controls are excluded from root detection so `close-modal` buttons remain clickable.
- 2026-08-07: Added **Full Month Now** to the audited Billing reconnection settlement. The backend creates one complete-plan reconnection row, advances the next regular prepaid/postpaid cycle, blocks current-month duplicates, and preserves existing balance and activation safeguards. Temp remains unchanged.
- 2026-08-07: Added audited stopped-billing reconnection settlement in the full Payment Breakdown page and canonical Billing backend. Previous balance, new service charge, and future recurring cycle remain separate; stopped months never regenerate; payment-gated activation creates no early charge and recalculates from the actual activation date. Continue-billing behavior, postpaid month-end generation, and Temp remain unchanged.
- 2026-08-07: Added Billing-owned Complimentary Accounts across Billing, Customer Management, Collector, and Customer App. Admins manage audited effective periods and balance treatment from Payment Breakdown; the canonical status suppresses recurring bills, automated billing reminders, referral allocation, and credit-limit collection/disconnection while retaining service and the actual plan. Finite periods resume without back-billing, postpaid remains month-end, and Temp is unchanged.
- 2026-08-07: Added audited referral application scheduling. Admin may choose an optional current/future **Apply From Month** during approval or reschedule an approved referral with no active application; Billing waits until that earliest month, then retains FIFO, the two-per-month cap, and automatic carryover. Temp remains unchanged.
- 2026-08-07: Changed referral eligibility to Admin approval and added unlimited FIFO carryover. Billing automatically applies at most two locked referrals per generated unpaid month, retains excess for later months, and returns reversals to the later queue without depending on the referred client's payment. Temp remains unchanged.
- 2026-08-07: Centralized the referral workflow across Customer Management, Billing, and Admin. Referrals now use an audited branch registry with Pending/Eligible/Applied/Reversed/Cancelled states; Payment Breakdown applies backend-owned amounts only to validated billing months, and factory reset clears the registry. Temp remains unchanged.
- 2026-08-07: Added backend-owned effective plan changes across Billing and Customer Management. The full Payment Breakdown page now supports audited past/current/future upgrades or downgrades, paid bill protection with debit/credit carry adjustments, subscriber plan history, immediate current PPPoE profile synchronization, and retry-safe future scheduling. Temp remains unchanged.
- 2026-08-07: Standardized shared `.close-modal` controls as Tabler outline-secondary icon buttons with real `ti-x` glyphs, including the formerly empty Customer view close control. Shared sizing, contrast, hover, and focus behavior now follow Tabler variables in both themes.
- 2026-08-06: Added the global Admin factory-reset workflow in Admin Settings. It uses read-only preview, current-password and typed-phrase authorization, JSON rollback or a MySQL transaction, preserves Admin/configuration state, clears operational module/Temp records plus generated record files, and is covered without executing the live reset.
- 2026-08-06: Completed the backend-only Billing read cutover. Version 2 of `/api/payment-records` supplies rows, current/next cycles, status, due date, balance, advance, and reconciliation results; the four Billing/Customer pages show an unavailable state instead of recalculating in the browser. Postpaid generation remains month-end only, and the isolated Temp module is unchanged.
