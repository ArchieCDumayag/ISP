# Phase 1: Baseline and Inventory

## Goal

Create a repeatable safety gate before moving runtime files. This phase does not alter API routes, browser URLs, storage behavior, or production deployment.

## Deliverables

- Machine-readable module/file/dependency inventory
- Validation for ownership collisions and missing module paths
- Validation for static local CommonJS dependencies
- Validation for local HTML script and stylesheet references
- Repeatable isolated HTTP smoke test on ports `3190` and `4190`
- NPM commands used by every later phase

## Commands

```bash
npm run refactor:inventory
npm run refactor:verify
npm run refactor:smoke
npm run refactor:phase1
```

## Completion evidence

Completed on 2026-07-29.

- Eight module manifests validated.
- 317 tracked or non-ignored project files inventoried.
- 329 static local CommonJS dependency edges resolved.
- 427 local HTML script/stylesheet references resolved.
- Zero ownership collisions, missing module paths, unowned domain files, missing local requires, or missing local HTML assets.
- Security module loading passed.
- Isolated HTTP smoke test passed on ports `3190`/`4190`:
  - `200 /login.html`
  - `200 /privacy-terms`
  - `200 /apply-now`
  - `200 /customer-login`
  - `200 /api/public/philippines/provinces`
  - `401 /api/auth/me`

No production files, services, ports, or data were modified.
