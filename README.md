# ISP Billing System

Local-first ISP billing and operations system for subscriber management, billing, payments, collectors, network tools, tickets, and customer service workflows.

Repository: https://github.com/ArchieCDumayag/ISP

## One-Line Install in Ubuntu Server

Run this on a fresh Ubuntu server with `sudo` access:

```bash
curl -fsSL https://raw.githubusercontent.com/ArchieCDumayag/ISP/main/scripts/install-ubuntu.sh | sudo bash
```

The installer will:

- Install Node.js 20 LTS, Git, build tools, and browser libraries needed for PDF/statement rendering.
- Clone the repo into `/opt/isp-billing`.
- Install Node dependencies with `npm ci --omit=dev`.
- Configure JSON file storage by default.
- Generate `SESSION_TOKEN_SECRET` and `CONFIG_MASTER_KEY`.
- Create `/etc/isp-billing/isp.env`.
- Register and start a systemd service named `isp-billing`.
- Open the app on port `3000`.

After installation, open:

```text
http://YOUR_SERVER_IP:3000/login.html
```

Default admin accounts:

- Primary admin: ``
- Backup admin: `admin / admin`

Change the default passwords immediately after first login.

## Ubuntu Install Options

You can override installer settings with environment variables:

```bash
curl -fsSL https://raw.githubusercontent.com/ArchieCDumayag/ISP/main/scripts/install-ubuntu.sh | sudo env PORT=8080 ISP_APP_DIR=/opt/my-isp ISP_SERVICE_NAME=my-isp bash
```

Common options:

- `PORT`: app port, default `3000`.
- `PUBLIC_BASE_URL`: public URL used by the app, default `http://SERVER_IP:PORT`.
- `ISP_APP_DIR`: install directory, default `/opt/isp-billing`.
- `ISP_BRANCH`: Git branch, default `main`.
- `ISP_SERVICE_NAME`: systemd service name, default `isp-billing`.
- `ISP_USER`: Linux service user, default `ispbilling`.

Useful service commands:

```bash
sudo systemctl status isp-billing --no-pager
sudo systemctl restart isp-billing
sudo journalctl -u isp-billing -f
```

Important paths:

- App files: `/opt/isp-billing`
- Runtime data: `/opt/isp-billing/data`
- Logs: `/opt/isp-billing/logs`
- Environment file: `/etc/isp-billing/isp.env`
- Service file: `/etc/systemd/system/isp-billing.service`

## Storage

The default storage mode is local JSON file storage:

```env
STORAGE_DRIVER=json
```

Runtime records are saved in `data/*.json`. MySQL is optional and should only be enabled when the relational schema and database credentials are configured:

```env
STORAGE_DRIVER=mysql
```

## System Features

### Core Administration

- Admin login with protected dashboard pages.
- Primary admin account and backup admin account.
- Accounts and role-aware access controls.
- Business profile settings used across receipts, statements, and branded pages.
- Owner-only structure/update tools restricted to localhost and the configured owner ID.
- Feature flags for enabling or hiding modules per deployment flavor.

### Customer Management

- Add, edit, search, and archive subscribers.
- Customer fields for account number, activation date, plan type, status, plan, contact details, address, area/cluster, coordinates, PPPoE, referral source, billing date, credit limit, and Facebook username.
- Customer archive with restore and permanent delete workflow.
- Customer draft/application queue for new applications.
- Client Excel export and import support.
- Duplicate-name handling through account number and address/location details.

### Plans, Coverage, and Public Application Flow

- Plan catalog management for prepaid and postpaid offerings.
- Coverage table and coverage map pages.
- Public application pages with public plan and coverage APIs.
- Philippine province, municipality/city, and barangay lookup APIs.

### Billing and Payments

- Payment dashboard for subscriber balances.
- Monthly billing support for prepaid and postpaid plans.
- First-bill proration support.
- Payment recording with cash/GCash methods and reference numbers.
- Current balance, previous balance, advance payment, due, and payment breakdown tracking.
- Payment breakdown page per subscriber.
- Billing statement, account statement, receipt, and thermal receipt pages.
- Payment history import/export for Excel.
- Unmatched imported payment review and binding workflow.
- Bulk delete and selected transaction delete workflows.

### Referrals and Discounts

- Referral tracking between existing customers and referred subscribers.
- Referral discounts in payment breakdown rows.
- Successful referral handling after referred customer billing/payment requirements are met.
- Referral page for reviewing referral activity.

### Disconnections and Credit Limit Workflow

- Disconnection queue for subscribers who reach credit-limit conditions.
- Admin decision flow to continue or cancel disconnection.
- Disconnected status display in payment breakdown for the current month.
- Billing policy choice for disconnected subscribers: stop billing next month or continue billing.
- Reconnect workflow.

### Collectors and Field Operations

- Collector assignment and collector payment APIs.
- Collection history page.
- Technician pages and job history.
- Ticket creation, assignment, status changes, and job conversion workflows.
- Technician customer draft/installations workflow.

### Network Management

- PPPoE subscriber management.
- MikroTik PPPoE integration endpoints.
- Direct WiFi password and connected-device actions when enabled.
- PON management for OLT/NAP/port assignment workflows.
- GenieACS device status, device list, summon, and WiFi operations.

### Expenses, Payroll, and Business Tools

- Expense recording, editing, filtering, and delete-all support.
- Payroll page and payroll APIs.
- Dashboard collection breakdown.
- Activity log APIs and visibility controls.

### SMS, Customer App, and Notifications

- SMS send/history/template/schedule/automation APIs.
- Customer app and popup reminder pages.
- Customer notification inbox and FCM token support.
- Payment confirmation queue and queue history.
- Messenger webhook support.

## Local Development

### Multiple Codex sessions

This checkout supports parallel Codex work with module ownership, file/folder locks, shared activity updates, and mandatory module context updates.

Start with:

```bash
cd /home/archiecd/ISP
python3 scripts/ai_coord.py register "<module and task>"
python3 scripts/ai_coord.py status
python3 scripts/ai_coord.py modules
```

Read `AGENTS.md`, `Project_Context.md`, `start_codex.md`, and the assigned module's files under `Features/modules/` before editing. Every module change must update its `Module_context.md`.

The 12-phase physical module migration is complete and tracked in `docs/refactor/PHASES.md`. The project is ready for coordinated multiple-Codex module work. Run the final regression gate with:

```bash
npm test
npm run refactor:verify
npm run refactor:smoke
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
```

Shared runtime infrastructure has a canonical home under `core/`. Phase 11 retired the old root aliases; shared code must import `core/` directly.

The Phase 12 cutover assessment, remaining production-release conditions, and manual UI/directory checklist are in `docs/refactor/phase-12-cutover-readiness.md`. Refactor completion does not deploy or restart production.

Admin/authentication is physically located under `Features/modules/admin/backend`, with its owned pages and assets under `Features/modules/admin/web`. The module manifest drives server loading and static delivery; browser URLs remain unchanged.

Customer Management is physically located under `Features/modules/customer-management/backend`, with its customer, draft, archive, coverage, application, and referral browser files under `Features/modules/customer-management/web`. Existing APIs, uploads, and page URLs remain unchanged.

Billing is physically located under `Features/modules/billing/backend`, with its plan, payment, confirmation, statement, receipt, and disconnection browser files under `Features/modules/billing/web`. Existing financial APIs, stored-data paths, feature/auth gates, and page/asset URLs remain unchanged.

Network is physically located under `Features/modules/network/backend`, with its PPPoE, PON, GenieACS, and coverage-map browser files under `Features/modules/network/web`. Existing device APIs, cross-module consumers, authentication/feature gates, and page/asset URLs remain unchanged.

Collector is physically located under `Features/modules/collector/backend`, with its assignment, approval, and collection-history browser files under `Features/modules/collector/web`. Existing payment/remittance APIs, authentication/feature gates, storage behavior, and page/asset URLs remain unchanged.

Technician is physically located under `Features/modules/technician/backend`, with its ticket, job, history, assignment, and installation browser files under `Features/modules/technician/web`. Existing APIs, authentication/feature gates, provisioning dependencies, storage behavior, and page/asset URLs remain unchanged.

Finance is physically located under `Features/modules/finance/backend`, with its expense, payroll, and retained reporting browser files under `Features/modules/finance/web`. Existing APIs, authentication/feature gates, JSON/MySQL storage behavior, and page/asset URLs remain unchanged.

Customer App and communications are physically located under `Features/modules/customer-app/backend`, with customer portal/app, SMS, and public legal/company browser files under `Features/modules/customer-app/web`. Existing APIs, webhooks, authentication/feature gates, schedulers, upstream behavior, provider contracts, storage, and page/asset URLs remain unchanged.

Install dependencies:

```bash
npm install
```

Run directly with JSON storage:

```bash
STORAGE_DRIVER=json CONFIG_MASTER_KEY=dev-master-key SESSION_TOKEN_SECRET=dev-session-secret node server.js
```

Then open:

```text
http://localhost:3000/login.html
```

## Production Notes

- Always set `NODE_ENV=production`.
- Keep `SESSION_TOKEN_SECRET` and `CONFIG_MASTER_KEY` private.
- Back up `data/` regularly when using JSON storage.
- Put the app behind a reverse proxy such as Nginx when exposing it on the public internet.
- Use HTTPS for public deployments.
- Do not commit `.env`, `data/`, `logs/`, backups, or service account files.
