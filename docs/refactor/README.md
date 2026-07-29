# ISP Modular Refactor

The refactor moves the working flat Express application into module-owned runtime folders without changing existing API routes, browser URLs, storage defaults, authentication boundaries, or production behavior.

## Rules

- Complete phases in order and keep the application runnable after every phase.
- Run `npm run refactor:verify` before and after every physical file move.
- Run `npm run refactor:smoke` after wiring changes.
- Preserve public URLs and API contracts unless the user explicitly approves a change.
- Update the affected module's `Module_context.md` during every module phase.
- Shared composition changes require an Integration Codex and exact locks.
- Production under `/opt/isp-billing` is outside this refactor unless explicitly requested.

The immutable Phase 1 reference inventory is `phase-01-inventory.json`. The current phase ledger is `PHASES.md`.

## Status and final gate

All 12 refactor phases are complete. The canonical module architecture and coordination workflow are ready for multiple Codex sessions. Production deployment is intentionally separate from refactor completion.

Run the complete release-readiness regression with:

```bash
npm test
```

`npm test` is an alias for `npm run refactor:phase12`; it runs every Phase 11 structural, module, security, and HTTP check before validating package/cutover invariants. See `phase-12-cutover-readiness.md` for the evidence, remaining production conditions, and manual review checklist.
