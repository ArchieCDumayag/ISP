# ISP Modules

Available ownership modules:

- `customer-management`
- `billing`
- `network`
- `collector`
- `technician`
- `finance`
- `customer-app`
- `admin`

Every module contains a human-readable `README.md`, a machine-readable `module.json`, and a mandatory `Module_context.md`. The context file must be updated whenever owned behavior or source changes.

The folders are runtime and coordination boundaries. `ownedPaths` now points to canonical module files only (plus the Admin-owned root configuration files); repository-root business backend shims were retired in Phase 11.
