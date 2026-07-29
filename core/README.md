# Shared Core

`core/` contains project-wide infrastructure that business modules may depend on. It must not contain module-specific CRUD or UI behavior.

```text
core/
  config/    environment, storage mode, and feature configuration
  data/      JSON/MySQL persistence and protected database configuration
  runtime/   canonical paths, module registry, and module loader
  security/  passwords, roles, rate limits, and session primitives
```

Phase 11 retired the legacy root filenames after all consumers moved to canonical paths. Shared code must import `core/config`, `core/data`, `core/runtime`, or `core/security` directly; do not recreate root aliases.

Module manifests declare module-relative runtime entries:

```json
{
  "runtime": {
    "backend": "backend/index.js",
    "web": "web"
  }
}
```

The loader rejects paths that escape the module directory.
