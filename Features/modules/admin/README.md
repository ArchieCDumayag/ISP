# Admin

Owns staff authentication and sessions, accounts/roles, business profile, integration configuration, activity logs, app downloads, the protected full-system backup/restore and project-data reset, information API, and owner-only setup/update tools.

## Runtime

- `module.json` declares `backend/index.js` and `web/` as the live runtime entries.
- `backend/index.js` lazily loads the Admin routers and services used by `server.js`.
- `backend/factory-reset.js` serves the protected `/api/admin-data-reset` preview and execution workflow used by the Data Reset section in `web/accounts.html`.
- `backend/system-backup.js` and `backend/system-backup-service.js` serve the Admin-only `/api/system-backup` export, validation preview, and guarded complete restore used by the shared toolbar.
- `web/` is mounted at the application root after authorization guards, so existing URLs such as `/login.html` and `/accounts.html` remain unchanged.
- Backend imports use this canonical folder; the former root backend shims were retired in Phase 11.
- Shared browser assets continue to come from the repository `public/` directory.

## Boundaries

- Admin owns identity, authorization, protected configuration, and governance—not each business module's CRUD.
- Shared `server.js`, canonical `core/`, package files, shell navigation, and deployment runtime remain Integration Codex ownership.
- Factory reset and full-system backup/restore are deliberate cross-module governance exceptions. Reset clears operational records under its preservation contract; backup/restore round-trips all application records and upload roots while excluding runtime sessions, server-local credentials/keys, caches, and older backups.
- Other modules depend on Admin contracts for roles, sessions, business identity, and integrations.
- Lock `Features/modules/admin` plus every affected shared integration file before changing them.

Run `npm run refactor:admin` for focused compatibility checks and update `Module_context.md` with every lasting change.
