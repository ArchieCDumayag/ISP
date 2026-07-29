# Admin

Owns staff authentication and sessions, accounts/roles, business profile, integration configuration, activity logs, app downloads, information API, owner-only setup/update tools, and deployment/flavor administration UI.

## Runtime

- `module.json` declares `backend/index.js` and `web/` as the live runtime entries.
- `backend/index.js` lazily loads the Admin routers and services used by `server.js`.
- `web/` is mounted at the application root after authorization guards, so existing URLs such as `/login.html` and `/accounts.html` remain unchanged.
- Backend imports use this canonical folder; the former root backend shims were retired in Phase 11.
- Shared browser assets continue to come from the repository `public/` directory.

## Boundaries

- Admin owns identity, authorization, protected configuration, and governance—not each business module's CRUD.
- Shared `server.js`, canonical `core/`, package files, shell navigation, and deployment runtime remain Integration Codex ownership.
- Other modules depend on Admin contracts for roles, sessions, business identity, and integrations.
- Lock `Features/modules/admin` plus every affected shared integration file before changing them.

Run `npm run refactor:admin` for focused compatibility checks and update `Module_context.md` with every lasting change.
