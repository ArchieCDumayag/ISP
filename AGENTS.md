# AGENTS.md - Billing System (JSON-first local storage)

This file documents how to work on this codebase and the critical operational rules.

## Project Overview
- Node/Express billing system with JSON file storage by default.
- Local admin UI served from `public/`.
- Optional MySQL config + schema updates are still available from the hidden owner page.

## Hard Requirements (Do Not Skip)
- **JSON storage is the default.** Set `STORAGE_DRIVER=json` to save runtime data in `data/*.json`.
- **MySQL is optional.** Set `STORAGE_DRIVER=mysql` only when using the relational schema.
- **CONFIG_MASTER_KEY is required** to encrypt/decrypt sensitive config (integrations).
- **Owner-only pages** are restricted to `localhost` + `STRUCTURE_OWNER_ID`.

## Quick Start (Local)
1. Start server locally (no tunnel):
   - `npm start`
2. Log in as Admin.
3. Open owner page: `http://localhost:3000/update-download`
4. JSON mode will create local files in `data/` automatically.
5. For optional MySQL mode only, set MySQL config + master key and run **Schema Update**.

## Critical Files
- `server.js` - server routes, auth guards, owner-only protections
- `setup-installer.js` - owner UI APIs (MySQL config, master key, schema)
- `scripts/migrate-json-to-schema.js` - schema update script (no data migration)
- `scripts/schema.sql` - relational schema
- `data-store.js` - JSON file storage and optional MySQL app_store storage
- `storage-mode.js` - selects `json` or `mysql` storage driver
- `db-secrets.js` - master key handling, encrypted config

## Owner / Admin Accounts
- **Primary admin**: ID `1` (hidden from accounts list UI)
- **Backup admin**:
  - ID: `backup-admin`
  - Default username/password: `admin` / `admin`
  - Cannot be deleted
  - On login, user is forced to change username/password
- Owner-only routes are guarded by:
  - `STRUCTURE_OWNER_ID` (default `1`)
  - Localhost request only

## Secrets
- Master key is saved in `data/master-key.json` (plaintext). Protect this file.
- JSON runtime data is saved in `data/*.json`.
- Master key is saved in `data/master-key.json` if generated from installer. Protect this file.
- MySQL config is saved in `data/mysql-config.json` only when MySQL mode is used.
- Avoid committing runtime files in `data/` to source control.

## Storage + Schema
- Default storage mode is JSON file storage and does not require a database account.
- Schema is in `scripts/schema.sql` (tables: branches, users, customers, plans, coverage_areas, collector_assignments, payment_entries, tickets, jobs, activity_logs, business_profiles, integration_settings, sessions, app_store).
- Schema tools are only needed when `STORAGE_DRIVER=mysql`.
- UI triggers:
  - **Run Schema Update** (owner page).
  - **Run JSON Migration** (owner page, optional for importing legacy `data/*.json`).
- CLI alternative:
  - `node scripts/migrate-json-to-schema.js`
  - Requires MySQL config (CONFIG_MASTER_KEY still required for integrations).
- JSON migration CLI:
  - `node scripts/migrate-json-to-relational.js`
  - Requires MySQL config and CONFIG_MASTER_KEY.

## Commands
- Start local server: `npm start`
- Start named flavor manually: `npm run flavor:start -- dante-fiber --no-tunnel`
- MySQL backup: `npm run backup:mysql`

## UI Notes
- `public/update-download.html` - owner page (MySQL config, master key, schema)
- `public/login.html` - login with forced change modal for backup admin
- `public/accounts.js` - account list (primary hidden, backup shown as ADMIN)

## Changes with Safety Impact
If you touch these, re-check auth + guards:
- `auth.js` (login + sessions)
- `accounts.js` and `accounts-store.js` (admin protections)
- `server.js` (localhost owner-only checks)
- `data-store.js` and `storage-mode.js` (JSON/MySQL storage behavior)
