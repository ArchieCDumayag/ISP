# Network

Owns ISP access-network operations: MikroTik connectivity, PPPoE accounts/profiles/traffic, PON topology and assignments, GenieACS device actions, direct WiFi/device operations, and network-oriented coverage maps.

## Runtime entry points

- Backend descriptor: `backend/index.js`
- Canonical backend implementations: `backend/*.js`
- Canonical pages and browser assets: `web/`
- Admin pages: PPPoE, PON Management, GenieACS, and the protected coverage map
- Public page: the application coverage map
- Main APIs: `/api/mikrotik`, `/api/pon`, `/api/genieacs/*`, and direct connected-device/WiFi handlers under `/api/customers/*`

## Boundaries

- Customer Management owns subscriber identity, address, and coverage-table records.
- Billing decides plan and service-policy intent; Network performs or audits router/service changes.
- Technician uses Network contracts for installation-time PON and PPPoE provisioning.
- Admin owns encrypted integration settings and credentials.

The former root backend shims were retired in Phase 11; canonical imports now point here while existing page, asset, and API URLs remain unchanged. New Network code belongs in this folder. Update `Module_context.md` with every lasting change.
