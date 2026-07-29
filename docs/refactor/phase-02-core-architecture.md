# Phase 2: Core Architecture and Compatibility

## Goal

Create the stable runtime structure required for business-module migrations while preserving every existing root import path.

## Target structure

```text
core/
  config/    environment, storage mode, feature flags
  data/      JSON/MySQL storage and protected database configuration
  runtime/   project paths, module registry, module loader
  security/  passwords, roles, sessions, rate limiting

Features/modules/<module>/
  backend/   future module backend entry and implementation
  web/       future module static/UI assets
  tests/     module-focused regression checks
```

## Compatibility strategy

- Shared implementations move to `core/`.
- Existing root names remain thin CommonJS shims during Phases 3–10.
- Legacy modules continue importing root names without behavior changes.
- Migrated modules use canonical `core/` imports.
- Phase 11 removes shims only after the dependency inventory confirms no legacy consumers remain.

## Module runtime contract

The module registry reads `Features/modules/*/module.json`. A future migrated module may declare module-relative entries:

```json
{
  "runtime": {
    "backend": "backend/index.js",
    "web": "web"
  }
}
```

The loader resolves entries inside the owning module directory and rejects path traversal. Server composition will adopt these entries during each module migration.

## Moved shared implementations

- Config: environment loader, storage mode, flavor features
- Data: JSON store, database connector, relational readiness, protected database secrets
- Security: password hashing, rate limiter, role helpers, session cache

## Completion evidence

Completed on 2026-07-29.

- 11 shared implementations physically moved into canonical `core/` folders.
- 11 root compatibility shims verified to export the exact canonical module instances.
- Canonical `.env`, `data/`, `flavors/`, `public/`, scripts, features, and module paths established.
- Eight module manifests loaded by the new registry.
- Unconfigured module runtime entries correctly remain in compatibility mode.
- Project-root and module-root path traversal attempts rejected.
- 331 current project files, 342 local CommonJS dependency edges, and 427 HTML script/stylesheet references validated.
- Security module loading passed.
- Isolated HTTP smoke checks passed on ports `3190`/`4190`.
- Update/download packaging confirmed to recurse into the new `core/` directory.
- Production files, service, ports, and data remained unchanged.
