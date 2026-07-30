# Temp Workspace

Provides one hidden, manually accessed Admin workspace for customers and billing at a secondary location. Temp records are intentionally isolated from the canonical Customer Management and Billing modules.

## Runtime

- `module.json` declares `backend/index.js`, the `web/` static root, and the dedicated `/api/temp` prefix.
- `/temp.html` is the only browser page and is protected by the shared Admin page guard.
- `backend/workspace-router.js` exposes Temp-only customer, transaction, export, and import endpoints.
- `backend/workspace-store.js` persists only through the distinct `temp_workspace_isolated_v1` key. JSON mode writes `data/temp_workspace_isolated_v1.json`; MySQL mode stores the same isolated key in `app_store`.
- `web/temp.html`, `temp.css`, and `temp.js` provide the standalone Customer and Billing tabs without embedding or calling the main pages/APIs.

## Boundaries

- Temp never reads or writes the canonical `customers`, `payments`, or `plans` stores.
- Temp never calls `/api/customers` or `/api/payments` and never embeds `/customers.html` or `/payments.html`.
- Customer Management and Billing remain unchanged and authoritative for the main location.
- Temp exports can only be imported by the Temp importer; their file kind is `isp-temp-workspace-export`.
- Shared route protection and module composition remain Integration Codex ownership.

Run `npm run refactor:temp` for focused isolation checks and update `Module_context.md` whenever this contract changes.
