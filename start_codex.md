# Codex Startup Guide

Use this guide to open another Codex session for the ISP project. `AGENTS.md` contains the full rules.

## 1. Open the shared repository

```bash
cd /home/archiecd/ISP
export AI_COORD_STATE_DIR=/home/archiecd/ISP/.ai_coord
```

Use this shared working tree. Do not create a separate worktree or branch unless the user explicitly requests isolation.

## 2. Read required context

Read completely:

```text
AGENTS.md
Project_Context.md
Features/modules/<assigned-module>/README.md
Features/modules/<assigned-module>/module.json
Features/modules/<assigned-module>/Module_context.md
```

## 3. Register the terminal

```bash
node scripts/ai_coord.js register "<assigned module and purpose>"
```

Keep the returned `codex-N` identity for that terminal. Then inspect state:

```bash
node scripts/ai_coord.js status
node scripts/ai_coord.js modules
git status --short
git branch --show-current
```

The normal branch is `main`.

## 4. Start and lock the task

```bash
node scripts/ai_coord.js start <agent> "<task-name>" "<scope>"
node scripts/ai_coord.js recent
node scripts/ai_coord.js locks
node scripts/ai_coord.js lock <source-path> <agent> "<task-name>" "<reason>"
node scripts/ai_coord.js lock Features/modules/<module>/Module_context.md <agent> "<task-name>" "Update durable module context"
```

Use `module.json` to find the canonical owned paths for the assigned module. Lock every path before editing it. Do not touch shared code unless assigned integration work.

## 5. During work

Post meaningful updates:

```bash
node scripts/ai_coord.js update <agent> "<task-name>" "<progress>" --files <paths>
```

If another agent owns a required path, work elsewhere or use `wait-lock` after all other work is exhausted.

## 6. Runtime checks

Production uses `/opt/isp-billing` on ports `3000`/`4001`; do not touch it.

Development uses `/home/archiecd/ISP` on ports `3100`/`4101`. Before changing the development runtime:

```bash
node scripts/ai_coord.js lock runtime/server <agent> "<task-name>" "Start or restart development server"
npm start
node scripts/ai_coord.js unlock runtime/server <agent>
```

Read-only HTTP/process/log checks do not require the runtime lock.

For module-focused work, run the module's focused validator recorded in `Module_context.md`. For shared, cross-module, or release work, run the final gate:

```bash
npm test
```

## 7. Finish

Update the module's `Module_context.md`, validate it is included, review the diff, and release locks:

```bash
node scripts/ai_coord.js check-context --files <all-changed-files>
git status --short
git diff --name-only
node scripts/ai_coord.js update <agent> "<task-name>" "Task complete; releasing locks" --files <all-changed-files>
node scripts/ai_coord.js unlock-task <agent> "<task-name>"
node scripts/ai_coord.js done <agent> "<task-name>" "<summary and checks>" --files <all-changed-files>
```

Report the agent identity, changed paths, checks, context update, runtime action, remaining risks, and next step.
