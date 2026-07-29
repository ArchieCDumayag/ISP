# ISP Multi-Codex Coordination Rules

This repository is developed in one shared working tree by multiple Codex sessions. Every session may work full-stack, but it must coordinate ownership before editing.

The coordination command is:

```bash
python3 scripts/ai_coord.py
```

Never manually edit `.ai_coord/`. It is generated runtime state and is ignored by Git.

## Required startup flow

Every new Codex session must do the following before work:

1. Read `AGENTS.md` and `Project_Context.md` completely.
2. If assigned to a business module, read its `Features/modules/<module>/README.md`, `module.json`, and `Module_context.md` completely.
3. Register once and keep the returned identity for that terminal:

   ```bash
   python3 scripts/ai_coord.py register "short purpose of this Codex session"
   ```

4. Review coordination and Git state:

   ```bash
   python3 scripts/ai_coord.py status
   python3 scripts/ai_coord.py modules
   git status --short
   git branch --show-current
   ```

5. Announce the task:

   ```bash
   python3 scripts/ai_coord.py start <agent> "<task-name>" "<work being started>"
   ```

Do not invent or reuse another session's identity. Retire a permanent session when it is no longer used:

```bash
python3 scripts/ai_coord.py retire <agent>
```

## Lock before editing

Immediately before editing, always check recent activity and locks, then lock every path you will change:

```bash
python3 scripts/ai_coord.py recent
python3 scripts/ai_coord.py locks
python3 scripts/ai_coord.py lock <path> <agent> "<task-name>" "<reason>"
```

Locks cover both parent and child paths. A lock on `Features/modules/billing` conflicts with locks anywhere below that directory. Never edit a path locked by another Codex.

For module files, lock the canonical path under `Features/modules/`; for shared shell, runtime, scripts, or configuration, lock the actual shared path. Use the module's `module.json` as the ownership map.

If a needed path is locked, work on other unlocked parts first. If nothing else can proceed, use:

```bash
python3 scripts/ai_coord.py wait-lock <path> <agent> "<task-name>" "<reason>" --timeout 600
```

Do not bypass locks. `force-unlock` is only for abandoned locks after confirming the owning session is gone.

## Module ownership model

Business ownership lives under:

```text
Features/modules/
  customer-management/
  billing/
  network/
  collector/
  technician/
  finance/
  customer-app/
  admin/
```

Each module contains:

```text
README.md          purpose, scope, integration boundaries
module.json        machine-readable ownership and entry-point map
Module_context.md  durable, current module memory
```

The 12-phase physical refactor is complete. All eight business modules run from canonical paths under `Features/modules/`; their former root backend shims are retired, and unchanged browser URLs are served through manifest-driven web roots. Shared composition, common frontend, scripts, installer, and configuration are Integration Codex ownership.

New module-specific code should be created inside its module folder when practical:

```text
Features/modules/<module>/backend/
Features/modules/<module>/web/
Features/modules/<module>/tests/
```

A module declares `runtime.backend` and `runtime.web` in `module.json`. Import shared infrastructure from canonical `core/` paths and other business code from canonical module paths; never recreate repository-root backend aliases.

An Integration Codex owns the wiring into `server.js`, shared navigation, shared static delivery, and shared configuration. A module Codex must not change those shared areas unless its task explicitly includes integration and it has locked them.

Shared/integration-owned areas include:

```text
core/
server.js
package.json
package-lock.json
public/index.html
public/app.js
public/api.js
public/layout.js
public/sidebar.html
public/topbar.html
public/styles.css
public/css/tabler-app.css
scripts/
Project_Context.md
AGENTS.md
```

Module code must import shared infrastructure from canonical `core/` paths. Root-level business or Core JavaScript aliases are prohibited; `server.js` is the only JavaScript composition file at the repository root.

Cross-module tasks must lock every affected source path and every affected module context. Shared contracts and wiring should be handled by an explicitly assigned Integration Codex.

## Mandatory Module_context.md updates

`Module_context.md` is the current, durable memory for a module. Every task that changes module behavior, API contracts, data structures, UI workflows, configuration, tests, risks, or owned source layout must update that module's `Module_context.md` in the same task.

Keep it concise and current. Record lasting facts, not a chat transcript. Update at least:

- current behavior and scope;
- frontend and backend entry points;
- APIs and stored data affected;
- cross-module contracts;
- validation performed;
- known issues and next work;
- the latest meaningful change entry.

The coordination script checks the `--files` list passed to `done`. If an owned module path is included without its context file, completion is rejected.

Check before finishing:

```bash
python3 scripts/ai_coord.py check-context --files <all-changed-files>
```

`Project_Context.md` is only for project-wide facts: architecture, shared contracts, runtime ports, storage, deployments, module boundaries, and integration status. Ordinary module progress belongs only in the module context.

## Progress and completion

Post updates after meaningful changes or discoveries:

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "<what changed>" --files <paths>
```

Before finishing:

1. Update each affected `Module_context.md`.
2. Run appropriate focused checks; use `npm test` for shared, cross-module, or release work.
3. Review `git status --short` and `git diff --name-only`.
4. Post a final update.
5. Release task locks.
6. Mark the task done with the complete changed-file list.

```bash
python3 scripts/ai_coord.py update <agent> "<task-name>" "Task complete; releasing locks" --files <paths>
python3 scripts/ai_coord.py unlock-task <agent> "<task-name>"
python3 scripts/ai_coord.py done <agent> "<task-name>" "<summary and checks>" --files <paths>
```

Do not silently stop with active locks.

## Runtime coordination

Two deployments exist on this server:

- Development checkout: `/home/archiecd/ISP`
- Existing production deployment: `/opt/isp-billing`

Production currently owns app port `3000` and customer-upstream port `4001`. The development `.env` uses ports `3100` and `4101`.

Do not edit `/opt/isp-billing`, restart `isp-billing.service`, alter production data, or take over production ports unless the user explicitly requests a production operation.

Before starting, stopping, building, or restarting the shared development runtime, lock:

```bash
python3 scripts/ai_coord.py lock runtime/server <agent> "<task-name>" "<runtime operation>"
```

Release `runtime/server` immediately after the operation and its basic verification. Read-only checks such as `curl`, `systemctl status`, `ps`, and log inspection do not require the runtime lock.

## Project operational requirements

- Node/Express serves module UI from configured `Features/modules/*/web` roots and the shared shell/integration assets from `public/`.
- JSON storage is the default. Use `STORAGE_DRIVER=json`; runtime data is written under ignored `data/`.
- MySQL is optional and must only be enabled deliberately with valid relational configuration.
- `CONFIG_MASTER_KEY` is required for protected integration settings.
- `SESSION_TOKEN_SECRET` is required in production.
- Owner-only structure/update pages require localhost access and `STRUCTURE_OWNER_ID`.
- Never commit `.env`, `data/`, logs, backups, tokens, service accounts, or credentials.
- Treat Admin auth/account logic, Customer Management record/file cleanup, Billing scheduler/payment/numbering/disconnection logic, Network device commands and credentials, Collector capture/approval/remittance logic, Technician installation/PON/PPPoE provisioning and job-numbering logic, Finance expense deletion/payroll/storage logic, Customer App authentication/provider/scheduler/upstream/notification logic, storage drivers, database code, `server.js`, package files, deployment scripts, and environment files as high-risk.
- When changing auth or owner protections, re-check authentication and authorization behavior.
- When changing storage code, verify JSON mode and do not silently enable MySQL.

## Git rules

`main` is the repository's main branch and tracks `origin/main`.

- Do not overwrite another Codex's changes in the shared working tree.
- Stage only paths owned and locked by your task.
- Do not commit or push unless the user explicitly requests it or assigns a release/integration task that includes it.
- Never force-push.
- Never use destructive Git cleanup commands without explicit user approval.
- Never commit coordination state or secrets.

## Safety

Do not run destructive filesystem, database, Git, or production commands without explicit approval. Do not delete runtime data, reset databases, overwrite environment files, or expose secret values.

The governing principle is simple: read shared memory, register, coordinate, lock exact ownership, make focused changes, update module memory, verify, release locks, and notify the other sessions.
