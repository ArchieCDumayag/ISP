# Features

`Features/modules/` is the module ownership and durable-context layer for parallel Codex development.

The current application still runs from its established root-level CommonJS files and `public/` assets. Each module's `module.json` maps those paths to one owner while new module-specific code is added under the module folder. This prevents a risky all-at-once path migration and gives Codex sessions clear locking boundaries now.

See `AGENTS.md`, `Project_Context.md`, and `start_codex.md` before opening module sessions.
