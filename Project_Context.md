# ISP Project Context

This is the durable project-wide memory for all Codex sessions. Read it with `AGENTS.md` before starting. Keep module-local details in the matching `Features/modules/<module>/Module_context.md`.

## Repository

- Working tree: `/home/archiecd/ISP`
- GitHub remote: `git@github.com:ArchieCDumayag/ISP.git`
- Main branch: `main`, tracking `origin/main`
- Multi-Codex coordination: `node scripts/ai_coord.js` (selects the installed Windows `py -3` or Linux `python3` launcher automatically)
- Coordination state: `.ai_coord/` (ignored; never edit manually)

## Runtime and deployment

- Development checkout uses `.env`, JSON storage, app port `3100`, and customer-upstream port `4101`.
- Start development with `npm start` or `node server.js` from `/home/archiecd/ISP`.
- Existing production runs separately from `/opt/isp-billing` as `isp-billing.service` on ports `3000` and `4001`.
- The Windows test origin at `http://localhost:3000` is assigned to the locally managed `thre3j-billing` Cloudflare Tunnel for the requested `3jtestserver.com` hostname. Public DNS remains pending until the domain is registered in the Cloudflare account.
- The confirmed Windows LAN server at `http://192.168.100.9:3000` locally restores the Admin-managed THRE3J Collector OTA channel. Its ignored `.env` explicitly enables the default-off, non-production feature and its ignored `data/collector-updates` manifest/APK are served only to direct private requests for the approved LAN host or loopback requests for localhost; Cloudflare/forwarded ingress fails closed. The separate Ubuntu/public production deployment is unchanged.
- The Ubuntu installer validates the canonical Customer App `company-info.html` runtime before dependency installation and explicitly restarts an existing systemd service after Git updates, preventing stale pre-module routes from remaining active.
- Admin System Update preserves tracked and untracked production hotfixes instead of disabling **Apply New Update** on a dirty checkout. It stashes them temporarily, compatibility-checks them in an isolated worktree at the exact incoming commit, fast-forwards only on success, restores them before dependency installation/restart, and leaves the branch/worktree unchanged when a real conflict is detected.
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

- `core/config`: environment loading and storage-mode selection
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

- `Features/modules/network/backend`: MikroTik connection/operations/auditing, PPPoE helpers, PON management, nearest-NAP serviceability, atomic port reservations, and stale-snapshot revision guards
- `Features/modules/network/web`: PPPoE, PON, GenieACS, and coverage-map pages/assets mounted at unchanged root URLs
- Former Network root backend aliases: retired in Phase 11

Canonical Collector runtime structure:

- `Features/modules/collector/backend`: assignment, next-due, field payment, approval, reprint, and remittance implementation
- `Features/modules/collector/web`: assignment/approval and collection-history pages/assets mounted at unchanged root URLs
- Former Collector root and `routes/` backend aliases: retired in Phase 11

Canonical Technician runtime structure:

- `Features/modules/technician/backend`: tickets and linked work orders, canonical dispatch workflow/events, job numbering, technician assignments/offline sync, field inventory custody, and installation/provisioning implementation
- `Features/modules/technician/web`: the Admin dispatch dashboard plus tickets, job history, and technician customer-draft pages/assets mounted at unchanged root URLs
- Dispatch work orders retain customer/location/plan snapshots, appointment windows, SLA, structured field evidence, optimistic versions, and append-only events. Technician APIs return only assigned work and accept retry-safe offline mutation batches.
- The standalone `THRE3J Jobs` Android technician app is a separate package/project from the Collector app. It targets only `https://3jinternet.com` or the explicit LAN testing server, consumes Technician/Customer Draft/PON/Inventory APIs, and keeps encrypted caches/drafts plus its Room offline queue partitioned by server and technician identity.
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

Shared code includes `server.js`, database/storage helpers, environment loading, role/password/session helpers, package files, common public shell assets, and repository scripts. Changes to shared code require an integration task, explicit locks, cross-module review, and a `Project_Context.md` update when the contract changes.

## Storage and secrets

- Default: `STORAGE_DRIVER=json`; missing or blank storage configuration resolves to JSON, only an explicit `mysql` value enables relational mode, and unsupported values are rejected.
- JSON runtime data: `data/*.json`
- Temp secondary-location records use the exclusive `temp_workspace_isolated_v1` store key (`data/temp_workspace_isolated_v1.json` in JSON mode or a distinct `app_store` row in MySQL mode) and never share the canonical customer/payment stores.
- Temp customers may carry coordinates and a branch-local NAP/port reference. Shared composition validates the selection against canonical PON state, then exposes it to Network only as a sanitized read-only provider. PON `/overview` and the administrative Coverage Map merge these records for port occupancy, pins, and links, but `/api/pon/state`, PON revisions, `pon_nap_connections`, canonical Customer Management/Billing, and the public map remain unchanged.
- Optional relational mode: `STORAGE_DRIVER=mysql`
- `npm run migrate:mysql` copies every top-level, non-sensitive `data/*.json` application store into MySQL `app_store`; runtime sessions, master-key files, MySQL connection files, and service-account credentials are excluded. Invalid JSON fails the migration instead of being silently skipped.
- Relational JSON cutover skips legacy collector-area assignments whose collector ID has no matching user in the target branch, reports the orphan count, and continues migrating valid records without weakening the database foreign key.
- Admin `/api/system-backup/export` produces one schema-versioned `isp-full-system-backup` ZIP for complete server recovery. It dynamically includes every eligible JSON application store or every MySQL application table, plus `data/uploads` and `public/uploads`; this covers accounts/users, all customer/payment/billing/GCash/Collector/Technician/Finance/Network/Customer App/Temp records, business and protected integration settings, activity/audit data, and stored app-download data. Before download, the completed ZIP is reopened and passed through the same manifest, checksum, storage-driver, Admin-record, upload-root, and MySQL schema validation used by Import; successful responses include the exact archive length and snapshot ID. Runtime sessions, `CONFIG_MASTER_KEY`, MySQL/Firebase/service-account credentials, environment/source/log data, generated caches, and older backup directories are excluded. Restored encrypted integrations on another server require the same externally managed `CONFIG_MASTER_KEY`.
- `/api/system-backup/preview` stages an uploaded archive for 15 minutes and verifies its kind/version, path safety, declared sizes, SHA-256 checksums, complete upload roots, Admin account, and compatible storage/schema path before any record write. Same-driver restore remains supported, and a JSON archive may additionally target a MySQL server after deterministic record mapping plus required InnoDB table/column checks; MySQL-to-JSON conversion remains blocked. `/api/system-backup/restore` requires the current Admin password, exact `RESTORE ALL DATA` phrase, and replacement acknowledgement; it pauses API/shared background mutations, drains queued JSON writes, creates a recoverable `data/backups/pre-import-system-backup-*.isp-backup.zip`, replaces eligible records/uploads with JSON rollback or one InnoDB transaction, and invalidates all sessions after success.
- The legacy `/api/export/customers-full` workbook remains a customer-focused reporting/merge format. Schema version 3 includes metadata, customer views, canonical customers, plans, payment entries, branch-scoped first-bill Previous Balance/Advance adjustments, all branch tickets/jobs, SMS history/runs, and PON data. `/api/import/customers-full` continues to upsert stable IDs, skip exact duplicates, and reject conflicting identities before any write; recognized legacy first-bill fields migrate only into missing adjustment fields, so newer Billing adjustments and unrelated plan/referral/complimentary history are preserved. It is not the complete server-recovery archive; the shared toolbar still accepts old `.xlsx`, `.xls`, and `.json` workbook imports for compatibility.
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
node scripts/ai_coord.js status
node scripts/ai_coord.js modules
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
- Generic HTTP error handling returns normal JSON errors for expected `4xx` authentication, authorization, not-found, validation, and conflict responses without printing misleading server stack traces. Unexpected `5xx` failures still log their stacks, and production responses continue masking internal messages.
- The shared static shell comes from `public/index.html`, `public/layout.js`, `public/sidebar.html`, `public/topbar.html`, `public/styles.css`, and related common assets.
- `/dashboard-v2.html` is a separate Admin-protected, action-first operations dashboard linked beside the existing dashboard. Six priority KPIs, a consolidated action queue, and workflow cards cover manual pending GCash, collector approvals/schedules/remittances, customer drafts/disconnections, and open tickets/jobs; secondary sections show the latest five customers and latest ten effective Cash/GCash payments. The shared area filter scopes records that carry an area or map to an area-scoped account, while official GCash PDF coverage and remittance status remain clearly labeled branch-wide. It reads canonical module APIs, links into the existing write workflows, preserves authoritative draft totals and marks capped approval/action counts as partial, excludes pending/rejected/cancelled/void payment rows from collection totals/history, and does not submit mutations itself. Missing PDF coverage or import timestamps require review instead of being labeled current.
- `/collector-app-update.html` is a default-off, direct-LAN-only, Admin-protected Windows publisher. `/api/collector-app-updates` accepts only authenticated Admins and publishes one validated local or approved-repository APK atomically; phones read the unauthenticated current manifest and versioned APK from the hard-pinned `http://192.168.100.9:3000/collector-updates` origin and independently verify package, version, SHA-256, size, and signing identity. Cloudflare/forwarded requests and non-LAN source addresses receive `404` before authentication or file delivery. Decoded, lowercase filename checks and Windows-unsafe path rejection run before case-insensitive static resolution so mixed-case, encoded-separator, NTFS ADS, 8.3, illegal-character, or trailing-dot/space page/controller aliases cannot bypass the same LAN and Admin guards.
- Shared `public/css/tabler-app.css` applies Tabler's installed default sans-serif stack (`Inter Var`, `Inter`, then system fallbacks) to all rendered UI text across every module page; code-like elements retain Tabler's monospace stack and icon-font classes retain their dedicated fonts.
- Shared `.close-modal` controls use actual Tabler `btn btn-icon btn-outline-secondary` markup with the `ti-x` icon. `public/css/tabler-app.css` keeps their Tabler sizing, variables, contrast, hover, and focus treatment consistent in light and dark themes without changing modal JavaScript.
- Shared `public/js/tabler-enhance.js` enforces explicit modal dismissal across module pages: Escape and backdrop/outside clicks do not close an open modal, while interactive Close/Cancel controls and successful completed actions continue to close it. Interactive controls are excluded from modal-root detection so names such as `close-modal` cannot be mistaken for a backdrop. Enhanced Bootstrap modals also receive static-backdrop and keyboard-disabled settings. Temp's standalone native dialogs independently follow the same behavior.
- Shared `public/js/customer-name-case.js` auto-formats first/middle/last customer-name inputs on blur and submit. The matching canonical Core normalizer is authoritative for API writes, imports, existing record reads, Customer Management drafts/archives, and the isolated Temp workspace; it uses Title Case rather than all-uppercase storage and preserves suffixes, Roman numerals, apostrophes, hyphens, and intentional mixed-case spellings.
- Module pages and API prefixes are recorded in each `Module_context.md` and `module.json`.
- `/api/payment-records` is the canonical cross-page billing read model. Each record includes a versioned backend-only `billingSummary`; Payments, Customers, Payment History, and Payment Breakdown require this response and do not fall back to browser billing calculations. `/api/payment-records/reconciliation/report` recalculates branch records and reports duplicate cycles, missing calculated charges, invalid advances/carry-over, missing current cycles, and ending-balance mismatches.
- Customer GCash proof is a three-module contract: the Customer App owns `/customer-payment-proof.html`; Customer Management derives the authenticated account, exact current balance, and Admin-configured merchant details at `/api/customers/payments/proof/context`, provides customer-session-only analysis preview at `/api/customers/payments/proof/analyze`, and independently analyzes accepted evidence at `/api/customers/payments/proof`; Billing stores pending evidence, sanitized extracted fields/checks/provenance, official-history results, and duplicate reference/image results. OCR runs locally first with Tesseract.js and packaged English data. An optional OpenAI-compatible Vision AI endpoint is disabled by default and runs only for incomplete/low-confidence OCR after explicit environment opt-in; it fills missing fields without overwriting local reads, stores no endpoint/key/raw provider response, and exposes AI-only provenance as advisory. Both analyzers compare amount/reference/date/recipient/status with the invoice, merchant, and imported history. Screenshots, OCR, AI, and matches never post payment. Only staff **Approve & Post** creates the ledger credit and invokes receipt/service-restoration behavior; reliable contradictions require new evidence.
- Official GCash history verification is a Billing/Admin integration contract. Admin manually uploads the password-protected email PDF at **GCash Transactions** (`/gcash-transaction.html`). Billing stores branch-scoped normalized rows, batch/file hashes, active Temp pending-reference reservations, and sanitized claimed/posted allocations in `gcash_transaction_history`, then compares pending proofs by reference, incoming credit, exact amount, date, Admin-configured recipient, and available sender/customer-mobile evidence. Every match remains Pending Review. A Temp reservation may exist before the PDF and blocks Main/manual/import/direct-history/Collector reuse; it becomes an assignment only for its exact incoming reference, amount, calendar date, and locked Temp customer. Main proof, direct-history, Excel, Collector, and hidden Temp workflows must claim this same assignment before making a payment effective and finalize it with the existing/new ledger entry IDs; a reference owned by another workflow fails closed. Collector submissions remain pending and unclaimed until Admin approval, and deterministic retry completes an interrupted final bind without inserting another payment. Admin Clear All Data removes imported history while preserving integration configuration.
- Effective plan changes are a Billing/Customer Management contract. Billing validates the plan against the canonical plan store, owns the effective-date audit/history and open-cycle recalculation, preserves finalized bill rows, and carries paid-cycle differences once as a debit or credit. Customer Management persists the current subscriber plan and router-specific PPPoE profile or an explicit future scheduled snapshot; the Billing scheduler applies/retries future snapshots. Direct browser-authored plan amounts are rejected. Prepaid/postpaid type transitions remain a subscriber-editor workflow, and the isolated Temp workspace is not involved.
- Referrals are a Customer Management/Billing/Admin contract. Customer Management owns the branch-scoped `referral_registry`, create/edit/approval/cancellation state, locked approval amounts, optional audited `applyFromMonth`, unlimited FIFO queue, and audit history; Admin approval is sufficient and no referred-client payment is required. Blank `applyFromMonth` means next available, while a selected current/future month is the earliest eligible billing month; active applications are locked until reversed. Canonical payment-record reads automatically apply the two oldest eligible queued customer referrals to the latest generated unpaid month without exceeding its remaining charge, then carry all excess or future-scheduled records forward. Applications are single-use; reversals skip their original month and return to the later queue. Manual/browser-authored referral application amounts are rejected. Admin Clear All Data resets the registry. Temp remains untouched.
- Complimentary accounts are a Billing-owned cross-module policy, not a zero-price plan. An audited current/future period suppresses recurring charges, billing/due reminders, referral consumption, and credit-limit disconnection while keeping service eligible and preserving the subscriber's real plan, history, and either the existing balance or an explicitly captured one-time write-off. Payments, Payment Breakdown, Customers, and Collector client review display the canonical flag; finite periods resume on the next prepaid first-of-month or postpaid month-end cycle without back-billing. Direct client-authored periods are rejected. Temp remains untouched.
- Collector client exclusions are a Collector-owned, branch-scoped visibility overlay stored in `collector_client_exclusions`. Admins may select multiple accounts for bulk exclusion or restoration without typing a reason; the server automatically audits the Admin identity, action, accounts, and time. Admin authentication applies the active set to Collector login/sync customer payloads, while Collector schedules use identifier-only tombstones to remove stale device rows. Neither action deletes or edits canonical customer, billing, payment, schedule, or priority records, and offline submissions remain accepted so captured field records are not lost.
- Android NAP selection is a Technician/Network/Customer Management contract. Explicit `coverageMap=true` works before a server account exists and returns all coordinate-valid branch NAPs within 600 meters with numbered port status. Android lets the technician choose a currently available port but records only an advisory request; it creates no reservation, hold, or expiry. Customer Draft Queue loads live availability and lets Admin change NAP/port. Approval acquires Network's branch lock and atomically creates the canonical assignment only if the reviewed port remains free; otherwise Admin selects another. Legacy reservations remain compatibility-only.
- Android installation completion is a Technician/Customer Management contract. The app retains customer, billing, GPS, requested NAP/port, and ONU locally until one final `POST /api/customer-drafts`. That request creates internal `in-progress` intake and immediately compare-and-sets immutable completion to Admin-visible `pending`. If an interrupted earlier request left one matching incomplete row, the same technician's retry updates that row in place and completes the transition instead of reporting a generic duplicate. Admin's Customer Draft Queue defaults to Pending review but has an explicit Incomplete drafts filter for inspection/deletion. The server normalizes the ONU serial and preserves rich evidence only for legacy clients. Admin review exposes and may edit every business field and requested port; only approval promotes the ONU and creates canonical PON state.
- Android first-bill collection is a Customer Management/Billing contract. The technician enters the exact non-negative amount received; Customer Management recomputes the trusted prorated bill, derives unpaid/partial/paid/advance status, and preserves old paid-checkbox drafts as a full collection. Admin approval posts one idempotent Billing credit for the entire amount received, so any excess remains customer advance credit; no technician entry becomes official before approval.
- Stopped-billing reconnection is a Billing-owned audited settlement instead of a status toggle. It never back-bills the disconnected interval; it snapshots and separately retains, writes off, or installments the previous balance, then starts new billing with a remaining-days proration, a complete-plan full-month charge, or the next regular prepaid first-day/postpaid month-end cycle. Either immediate charge advances the following regular cycle and is rejected if the current month already has a generated bill. Immediate and collected-payment-gated service activation are supported; pending requests create no charge, and delayed payment restarts dates from the actual service activation day. Continue-billing disconnections retain their existing cycles. Temp remains untouched.
- Any change to shared navigation, route mounts, common middleware, auth/session contracts, storage contracts, or cross-module response shapes is integration work.
- The shared toolbar Export action downloads the complete full-system archive. Import routes `.isp-backup.zip` files through validation/preview/complete restore and retains the former customer workbook merge importer for older spreadsheet/JSON files.
- `/temp.html` and `/api/temp` are protected for Admin sessions and deliberately have no sidebar/dashboard link. Customer, ledger, backup, and report data remain physically isolated from canonical Customer Management and Billing. Network integration is display/inventory-only: Temp owns its coordinate/NAP fields, validates ports from canonical PON, and Network consumes sanitized assignments as read-only overview data. Official Temp GCash posting is the narrow Billing exception: Temp can capture GCash as a shared non-ledger pending reservation before PDF import, and a lightweight Billing lookup detects collected or pending Main references plus exact official credits mislabeled Cash/blank. Pending creates no balance, receipt, income, or service effect; exact PDF reference/amount/date and Admin confirmation are required to post. A valid collected same-date Main subtotal below an unreserved credit can be linked by its existing entry IDs while Temp records only the exact remainder; both finalize as one shared assignment. Temp manual CRUD/import rejects cross-method reuse, Collector approval uses the same assignment authority, and rejection resolves canonical padded references before releasing an owned unposted claim. Temp never writes or exports a Main customer/payment row.
- `/api/admin-data-reset` and the Data Reset section in `/accounts.html` provide the global destructive reset workflow. Preview is read-only; execution requires an authenticated Admin's current password, the exact `CLEAR ALL DATA` phrase, irreversible acknowledgement, and final browser confirmation. It clears operational records in all modules and branches, including Temp, generated backups/cache, and payment proofs, while preserving Admin access, branches, business/system configuration, integrations, app downloads, MySQL configuration, and source code. Tests use injected in-memory stores and never execute the live reset.
- `/api/system-update/status`, `/api/system-update/run`, and `/api/system-update/check-and-apply` form the Admin-only deployment update contract. Apply permits one server-side request at a time and requires explicit confirmation of the exact remote commit shown by Status, a clean supported checkout, valid package metadata, and a verified fast-forward path. The server refetches and rejects a changed target, creates a Git recovery ref, reports lightweight progress, installs production dependencies, and restarts only after success; a post-merge failure resets the previous source and restores its dependency set, while a rollback failure reports the recovery ref for manual repair.

## Known risks

- All eight business modules have physical filesystem/runtime boundaries and canonical-only dependency paths; shared `server.js` composition remains a deliberate integration boundary.
- `server.js` is large and is a frequent cross-module integration point.
- The general repository-root static fallback was removed; shared assets must live in `public/` and module assets in module `web/` roots.
- Temp is a deliberately lightweight isolated ledger and does not inherit the main Billing scheduler, live router enforcement, tickets, SMS, collector, or customer-portal automations. Its coordinates and NAP/port fields provide administrative inventory and map visibility only.
- One official GCash reference has one shared assignment with at most three allocations. It can belong wholly to Main, wholly to Temp, or reconcile already-effective Main entries plus an exact Temp remainder. The server re-derives the Main portion, requires the official date and exact combined total, creates no duplicate Main payment, stores only Temp rows, and keeps an uncertain claim reserved for deterministic retry.
- Before an official PDF row exists, Temp may hold one active branch-scoped pending reservation for a normalized GCash reference. That reservation is non-financial, is excluded from Temp-only workspace exports, blocks every competing Main/Temp/Collector use, and is either cancelled or atomically consumed by an exact one-customer Temp assignment.
- Enabling GCash Vision AI sends unclear payment screenshots to the operator-configured external endpoint. It remains disabled by default; deployments that opt in must protect credentials and review the provider's privacy, retention, and residency terms.
- On 2026-08-10, `npm audit --omit=dev` reports 29 dependency findings (2 low, 12 moderate, 13 high, and 2 critical); `pdfjs-dist` is not identified in those findings, while the direct `xlsx` dependency still has high-severity findings for which npm reports no fix. Remediation requires a separate compatibility/security task.
- `@jobuntux/psgc` declares Node.js 22 or newer, while this server currently runs Node.js 20; smoke testing succeeds, but the engine mismatch remains.
- Fixed bootstrap account credentials must be generated/rotated per production deployment and never copied into context files.
- The completed refactor remains local and uncommitted; commit, push, and production deployment require explicit approval.
- The production deployment is separate from this checkout and does not include the local refactor.
- Collector OTA source wiring and generated APK data are a LAN-only local overlay. The source defaults to disabled and the Windows `.env` is the only local enablement; host, private-address, and proxy-header checks fail closed. Do not commit, push, or enable the hard-pinned `192.168.100.9:3000` routes on public/Ubuntu production without explicit approval and a separate release design.

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
- The HTTP smoke child process uses `ISOLATED_RUNTIME_CONFIG=1` so it cannot inherit stored MySQL configuration; it exercises the full application surface without reading or mutating operator records.

## Latest integration changes

- 2026-09-01: Restored the missing Collector App Update page, Admin-only publisher, sidebar entry, and direct-LAN manifest/APK delivery on `192.168.100.9:3000`. The existing ignored v1.30/code-31 release remained checksum-valid; new isolated HTTP coverage prevents the page and successful OTA delivery contract from disappearing silently again. A default-off local enable flag plus private-address, approved-host, proxy-header, and normalized pre-static path guards block Cloudflare/public/encoded-path ingress; dedicated disabled-development and flag-enabled-production runtimes prove fail-closed behavior. Public/Ubuntu production was not changed.

- 2026-08-31: Rearranged Dashboard V2 into an action-first daily-operations view with customer, payment, manual pending-GCash, official-PDF freshness, disconnection, collector, remittance, schedule, ticket, and job queues. It adds latest-five customer and latest-ten effective Cash/GCash history, branch/area scope labeling, authoritative/capped-count handling, quick links into existing workflows, partial-source resilience, and a metadata-only side-effect-free Billing endpoint for sanitized GCash PDF coverage metadata.

- 2026-08-31: Added non-ledger pending GCash intake to the hidden Temp workspace. A shared Billing reservation protects the reference across Main, Temp, and Collector before PDF import; the Temp queue auto-compares official reference/amount/date and posts only after an exact Admin-confirmed match, with no pending-stage balance, receipt, service, or income effect.

- 2026-08-30: Standardized customer names across Admin Customers, public applications, Customer Draft Queue, technician drafts, Temp customers, and Excel/full-JSON imports. Shared browser formatting provides immediate feedback, while server-side normalization covers direct API callers and renders existing canonical/Temp/draft/archive names consistently without a destructive database migration.

- 2026-08-30: Fixed matching incomplete intake blocking Android while the default Customer Draft Queue looked empty. The same technician's retry now recovers exactly one owned `in-progress` row and submits it for review; Admin can also switch to **Incomplete drafts** to inspect or delete orphan intake. Canonical customers, pending work, other technicians, and ambiguous multiple matches remain protected conflicts with actionable status/reference details.

- 2026-08-30: Superseded reservation-based Android new-customer onboarding. Map selection is local and advisory; customer, billing, GPS, requested NAP/port, and ONU submit together once to Customer Draft Queue. No reservation expires because none is created. Admin may edit all details and is the only actor that atomically assigns the final port. Legacy reservation routes remain for older installed-client/assigned-job compatibility.

- 2026-08-30: Extended mapped Temp NAP assignments into the Technician/Network serviceability boundary. Android coverage now shows and counts those ports as occupied, while reservation and finalization reject a Temp-owned port without changing Temp isolation or canonical PON persistence.

- 2026-08-30: Added coordinate plus branch-local NAP/port assignment to Temp schema-v5 customers. The Temp map picker shows NAPs and available ports; PON Management merges those assignments as read-only occupied ports, and the administrative Coverage Map shows orange Temp pins and links. Temp billing/customer storage, canonical PON persistence and revisions, canonical customers, and public coverage remain isolated.

- 2026-08-30: Added a separate Tabler Dashboard V2 page while retaining the chart-focused original dashboard. The new Admin-only operations view prioritizes four essential KPIs, quick actions, a compact billing/collection trend, urgent jobs and tickets, recent posted payments, and accounts needing attention, with one shared area filter and partial-source error reporting.

- 2026-08-30: Hardened Admin **Apply New Update** with exact-commit confirmation, live progress, diverged/stale-target/package validation, deterministic fast-forwarding, a Git recovery ref, and source/dependency rollback. Production hotfixes no longer disable Apply: tracked/untracked changes are stashed and preflighted against the exact incoming commit, compatible changes are restored before restart, and conflicts fail closed with the original deployment restored.

- 2026-08-29: Changed new Customer account closures to an authoritative Final Closed Customer Balance snapshot instead of a Billing adjustment. The Admin-entered value is stored with the canonical closure baseline, no Account Closure Adjustment is created, and later approved payments update the closed amount through the canonical delta. Customer Archive keeps the original Final Balance immutable and labels any changed current closed balance separately; Collector search/capture/approval/immutable receipts and Billing reconnection use the same lifecycle value. Reconnection uses capture-timestamped resets, preserves advance credit, and cannot be bypassed by customer/import, payment auto-enable, scheduler, Network, or Technician activation paths. Unmarked historical closures and their protected adjustment rows remain canonical and do not double-count.

- 2026-08-27: Reduced new technician installation completion to stable event plus normalized ONU serial while retaining legacy evidence history/replay compatibility. Approval-before-finalize and finalize-before-approval both reconcile the trusted serial onto the canonical customer; branch-local duplicate protection is enforced in JSON and MySQL, full export/import and JSON-to-MySQL restore preserve the field, and View Customer Account now shows it under always-visible Network Details.

- 2026-08-27: Replaced the Android technician first-bill checkbox with an amount-received contract. The app shows partial balances and advance credit immediately, while Customer Management validates/recalculates the allocation and Admin approval posts the entire collection as one idempotent Billing credit; legacy checkbox drafts remain compatible.

- 2026-08-27: Customer account closure first accepted an Admin-finalized non-negative balance through a deterministic protected Billing adjustment. The 2026-08-29 snapshot contract supersedes adjustment creation for new closures while preserving those historical rows and failed-retry compatibility.

- 2026-08-26: Added one cross-module closed-account mutation boundary. Closed subscribers remain absent from normal Billing and Collector queues but are searchable by assigned Android collectors for Cash-only retained-balance payments; capture, approval, Admin payment edits, GCash claims, scheduler/disconnection work, account close/reopen, PPPoE provisioning, and full-customer import serialize and revalidate the same closure/account state. Approved collection stays payment-only and cannot restart billing or service. Closure collections and historical final-balance adjustments are permanent audit evidence protected from delete/clear/import overwrite, while an unchanged exported customer package remains re-importable by preserving the server's canonical protected rows and warning about skipped closed-account data. MySQL lock-store schema setup occurs before transaction start, and full imports recheck stable payment/operational/PON ownership under transaction locks so a first-use DDL or concurrent restore cannot weaken rollback and duplicate protection.

- 2026-08-25: Added one-reference **Main + Temp split** reconciliation. An existing valid same-date Main partial payment is linked without reinsertion, only the exact remainder is posted to Temp, and the shared assignment permanently records both ledgers' entry IDs under the official credit. Pending/conflicting Main rows and combined totals or account counts outside the contract fail closed; Main and Temp reports remain isolated.
- 2026-08-25: Expanded the hidden Admin-only Temp workspace with paginated customer/ledger views, individual receipts, a monthly Temp-only Payment History export, strict schema-v4 backup validation with schema-v3 compatibility, and duplicate-safe official GCash posting to one-to-three Temp accounts. Shared imported-history ownership now covers Main, Temp, and Collector approval; collected/pending Main rows plus exact official credits mislabeled Cash/blank block Temp, Temp manual/import flows reject cross-method GCash-reference reuse, Temp ownership blocks Collector, ambiguous claims stay reserved for deterministic retry, canonical leading-zero claims release safely after rejection, official/legacy import audit fields stay immutable, and the Main customer list plus official Main Payment History export remain unchanged.
- 2026-08-25: Replaced the Android installation MAC and free-form drop-cable length inputs with a supported ONU-brand dropdown and start/end meter readings. The technician completion contract now recomputes cable length server-side and records the IOO/patch-cord checklist plus connector, clip, tie, and clamp quantities while preserving legacy retry compatibility.
- 2026-08-25: Replaced the Android installation workflow's nearby-NAP cards and secondary port dialog with direct exact-port selection on a 600-meter coverage map. The supporting technician API exposes every mapped NAP inside that server-enforced radius and complete sanitized port status/client labels only in explicit coverage mode, while atomic reservation validation and legacy nearby privacy behavior remain unchanged.
- 2026-08-24: Added guarded JSON-full-backup import into MySQL. Preview now labels and validates the `JSON -> MYSQL` conversion, restore maps canonical relational records while retaining supplemental stores, rejects conflicting duplicate payment IDs, and rolls database/uploads back together after creating the automatic recovery archive. The supplied JSON export restored successfully, retained its imported GCash history, produced no duplicate ledger groups after scheduler startup, and the resulting MySQL export passed the same import validation.
- 2026-08-24: Made shared full-system Export fail closed by validating each generated archive through the complete Import-preview contract before download and returning its exact content length and snapshot ID. The active MySQL archive was exported and successfully revalidated without restoring or changing live records.
- 2026-08-17: Hardened Admin Add Customer across Customer Management, Billing, Network, Admin audit, and shared MySQL schema. The guided UI sends customer, optional NAP, and migrated Previous Balance/Advance data in one request and trusts the server-confirmed account. The backend validates and de-duplicates inputs, reserves concurrent account/username allocation, hashes portal credentials, persists `customers.customer_start_type`, and commits customer/NAP/payment-entry/activity-log rows in one MySQL transaction; JSON mode serializes creation and compensates related writes on failure. MySQL deployments must run the additive schema update before using the new flow.
- 2026-08-16: Added the installable THRE3J Jobs Android MVP with fixed production/testing server selection, assigned Jobs and Tickets, encrypted technician-scoped offline mutations with visible retry/discard review, client installation/GPS capture, nearest-NAP exact-port reservation and structured completion evidence, and field inventory use/return. Server support now includes full-dataset duplicate-safe technician drafts, atomic completion evidence, reservation-aware PON Admin saves, linked ticket work orders, reversible archives, and technician custody controls; the Collector app remains unchanged.
- 2026-08-16: Added reversible, audited Collector client exclusions with checkbox bulk exclusion/restoration and no manual reason field. The server records Admin/action/account/time metadata automatically; active exclusions disappear from Collector App login/sync work queues and stale schedules are removed with tombstones, while all canonical customer, billing, payment, schedule, priority, and offline-upload records remain intact and return to view after restoration where applicable.
- 2026-08-16: Added one Admin-only full-system backup/restore archive and made it the shared toolbar export. The versioned ZIP covers every eligible JSON/MySQL application record and both upload roots, validates hashes/paths/driver/schema before restore, previews replacement counts, requires fresh Admin authorization, creates an automatic pre-import recovery archive, uses rollback/transactions with a maintenance write gate, and invalidates sessions. Runtime secrets, caches, older backups, and Android-local data remain excluded; legacy customer workbook imports still work.
- 2026-08-15: Made the Multi-Codex coordination command cross-platform through `node scripts/ai_coord.js`. The launcher uses `py -3` on Windows and `python3` on Linux, while `scripts/ai_coord.py` now uses native Windows or POSIX file locking. This bypasses the broken Windows `python` app alias that opened the app picker without executing the coordination command.
- 2026-08-15: Renamed the authenticated imported-statement page and sidebar entry to **GCash Transactions** at `/gcash-transaction.html`. The former Payment Confirmation Queue URLs redirect there for compatibility; the unused Queue History HTML/JavaScript/CSS, sidebar entry, and routes were retired without changing or deleting any proof, imported transaction, payment, allocation, or audit data.
- 2026-08-14: Retired deployment flavors, feature-toggle files/scripts, the owner-only flavor page/APIs, and backend/sidebar feature gates. Every module is now available under its existing authentication and role boundaries; MikroTik/GenieACS visibility still follows live integration readiness. Existing ignored legacy configuration files are inert and left untouched, and no customer, billing, payment, or operational stores were migrated or deleted.
- 2026-08-12: Added deterministic feature-profile isolation to the HTTP smoke runtime; this mechanism was retired when deployment feature toggles were removed on 2026-08-14.
- 2026-08-11: Removed Gmail-based GCash history automation and the Android GCash notification bridge from runtime, APIs, queues, proof analysis, and shared composition. Manual official-history PDF import remains the sole record-match source, and only explicit Admin **Approve & Post** can create a ledger payment or restore service.
- 2026-08-10: Added a disabled-by-default, OpenAI-compatible Vision AI fallback to the three-module GCash proof contract. It runs only after incomplete/low-confidence local OCR, supplements missing fields with provenance and visible warnings, exposes sanitized source/status in customer and Admin review, and cannot bypass imported-history matching, immutable allocation, or explicit Admin approval.
- 2026-08-10: Added immutable GCash transaction allocation. Imported references now show Available, Reserved, or Assigned and Posted state; GCash approval locks submitted fields, blocks reliable screenshot contradictions, flags sender/customer-mobile mismatch, requires explicit Admin customer/bill confirmation, and records one durable reference-to-submission/account/payment assignment before any ledger or MikroTik effect.
- 2026-08-10: Added local GCash screenshot OCR to the customer proof contract. The upload preview and final submission extract and compare payment fields, persist review metadata in JSON or MySQL, expose it to the Admin queue, and retain the independent official-history plus explicit-approval gates.
- 2026-08-10: Added official GCash Transaction History PDF import and proof matching. Admin can import the encrypted email statement without Xendit; normalized branch data supports queue badges and a fail-closed approval gate, but no parsed match can automatically confirm or post a payment.
- 2026-08-10: Added the customer GCash proof-submission contract across Customer App, Customer Management, Billing, schema, and shared page protection. Default JSON and optional MySQL storage retain payment date plus screenshot SHA-256; all accepted evidence remains Pending Review, and only Admin approval posts the canonical payment and runs existing paid-service restoration.
- 2026-08-08: Added the field-service dispatch foundation without changing the Collector app. The Technician module now owns a canonical work-order lifecycle, customer/location snapshots, appointment/SLA fields, structured evidence, append-only audit events, optimistic concurrency, technician-scoped offline sync, workload/CSV APIs, and a map-based Admin dashboard. Dispatch staff currently use an Admin account because the shared authentication model has no separate Dispatcher/Supervisor role. MySQL deployments must run the additive schema migration before restart; the Android technician client remains a separate app.
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
