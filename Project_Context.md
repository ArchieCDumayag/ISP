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
- `public/` contains the shared shell and integration-owned browser assets; all eight business modules own canonical module web roots.
- `Features/modules/` is the authoritative module ownership layer for parallel Codex work.
- Module manifests map canonical ownership and declare live backend/web runtime entries for all eight business modules; `server.js` composes all runtimes from this registry.
- Runtime files must only be physically moved in a dedicated compatibility migration.

Canonical shared runtime structure:

- `core/config`: environment loading, storage-mode selection, and feature/flavor configuration
- `core/data`: JSON/MySQL persistence, relational readiness, and protected database configuration
- `core/security`: passwords, roles, rate limiting, and session primitives
- `core/runtime`: canonical project paths, module manifest registry, guarded module entry loader, and complete runtime composition
- Root Core aliases are retired and must not be recreated.

Canonical Admin runtime structure:

- `Features/modules/admin/backend`: authentication, accounts, activity, profile, integrations, information, downloads, and setup/update implementation
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

- `Features/modules/customer-app/backend`: customer app, FCM/inbox, Firebase, Messenger, SMS, scheduler, schema, and customer-upstream implementation
- `Features/modules/customer-app/web`: customer login/portal/app, SMS, public legal/company pages, and assets mounted at unchanged root URLs
- Former Customer App root backend aliases: retired in Phase 11
- Customer Management consumes canonical Customer App FCM/inbox helpers directly; shared customer/modem/payment composition remains in `server.js`

## Modules

| Module | Ownership folder | Primary scope |
| --- | --- | --- |
| Customer Management | `Features/modules/customer-management` | Customer records, drafts, archive, coverage, public applications, referrals |
| Billing | `Features/modules/billing` | Plans, billing cycles, balances, payments, confirmations, statements, disconnections |
| Network | `Features/modules/network` | MikroTik, PPPoE, PON, GenieACS, network/serviceability maps |
| Collector | `Features/modules/collector` | Collector assignments, collection entry, receipts, approvals, remittances |
| Technician | `Features/modules/technician` | Tickets, jobs, assignments, installation and provisioning workflows |
| Finance | `Features/modules/finance` | Expenses and payroll |
| Customer App | `Features/modules/customer-app` | Customer portal/app, notifications, Firebase, Messenger, SMS |
| Admin | `Features/modules/admin` | Authentication, accounts, business profile, integrations, activity, updates/downloads |

Each module contains `README.md`, `module.json`, and `Module_context.md`. The manifest's `ownedPaths` field is the machine-readable source-ownership map.

## Shared integration-owned code

Shared code includes `server.js`, database/storage helpers, environment loading, role/password/session helpers, feature/flavor plumbing, package files, common public shell assets, and repository scripts. Changes to shared code require an integration task, explicit locks, cross-module review, and a `Project_Context.md` update when the contract changes.

## Storage and secrets

- Default: `STORAGE_DRIVER=json`
- JSON runtime data: `data/*.json`
- Optional relational mode: `STORAGE_DRIVER=mysql`
- Sensitive integration configuration depends on `CONFIG_MASTER_KEY`.
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
npm run refactor:phase11
npm run refactor:phase12
npm test
```

The local development login page is `http://localhost:3100/login.html` when the development server is running.

## Shared API and UI composition

- Express routers are mounted centrally in `server.js`.
- The shared static shell comes from `public/index.html`, `public/layout.js`, `public/sidebar.html`, `public/topbar.html`, `public/styles.css`, and related common assets.
- Module pages and API prefixes are recorded in each `Module_context.md` and `module.json`.
- Any change to shared navigation, route mounts, common middleware, auth/session contracts, storage contracts, or cross-module response shapes is integration work.

## Known risks

- All eight business modules have physical filesystem/runtime boundaries and canonical-only dependency paths; shared `server.js` composition remains a deliberate integration boundary.
- `server.js` is large and is a frequent cross-module integration point.
- The general repository-root static fallback was removed; shared assets must live in `public/` and module assets in module `web/` roots.
- On 2026-07-29, `npm audit --omit=dev` reports 28 dependency findings (2 low, 12 moderate, 12 high, and 2 critical); the direct `xlsx` dependency has high-severity findings for which npm reports no fix. Remediation requires a separate compatibility/security task.
- `@jobuntux/psgc` declares Node.js 22 or newer, while this server currently runs Node.js 20; smoke testing succeeds, but the engine mismatch remains.
- Fixed bootstrap account credentials must be generated/rotated per production deployment and never copied into context files.
- The completed refactor remains local and uncommitted; commit, push, and production deployment require explicit approval.
- The production deployment is separate from this checkout and does not include the local refactor.

## Multi-Codex decision

Use one shared working tree and the coordination script. Agents lock exact files/folders, update their module context with every module change, and reserve shared wiring for an Integration Codex. The authoritative workflow is in `AGENTS.md` and `start_codex.md`.

## Physical module refactor

- The physical migration is divided into 12 ordered phases documented in `docs/refactor/PHASES.md`.
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
