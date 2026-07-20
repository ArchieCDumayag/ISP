# Billing System - Fresh Install (Windows)

This guide installs the full system on a new PC **with default admins**:
- Primary admin (hidden): `archiecd / finley123!`
- Backup admin: `admin / admin` (forced change on first login)

> The **update/structure ZIP** is not a full installer.  
> Use the **full project folder** for a fresh install.

---

## 1) Prerequisites
- **Node.js** (LTS)
- Optional: **MySQL 8+** only if using `STORAGE_DRIVER=mysql`
- Optional: **DBeaver** (SQL GUI)

---

## 2) Storage
Default storage is local JSON files. No MySQL account is required.

Runtime data is saved under:

```text
data/*.json
```

---

## 3) Install dependencies
Open PowerShell inside the project folder:

```powershell
npm install
```

---

## 4) Run installer script (recommended)
For a flavor/copy setup, edit one file:

```powershell
copy .\flavor.config.example.json .\flavor.config.json
npm run flavor:apply
```

Use the `features` checklist inside `flavor.config.json` to choose which modules this copy includes.

In the default JSON mode, schema update is not required.

The older interactive installer is still available:

```powershell
powershell -ExecutionPolicy Bypass -File .\\scripts\\install.ps1
```

---

## 5) Login
Open:
```
http://localhost:3000/login.html
```

Accounts:
- **Primary admin (hidden)**: `archiecd / finley123!`
- **Backup admin**: `admin / admin` -> forced change username + password

---

## Notes
- JSON file storage is enabled by default.
- MySQL mode is optional and requires `STORAGE_DRIVER=mysql` plus MySQL config.
- `CONFIG_MASTER_KEY` is required (used to encrypt integration secrets).
- In production, `SESSION_TOKEN_SECRET` is required (server will exit if missing).
- Keep `data/` safe and backed up.

---

## Production Environment Checklist
Set these before running production:

```powershell
$env:NODE_ENV = 'production'
$env:SESSION_TOKEN_SECRET = '<64-char-random-hex>'
$env:CONFIG_MASTER_KEY = '<strong-master-key>'
$env:STORAGE_DRIVER = 'json'
$env:MYSQL_PASSWORD = '<mysql-password>'
$env:MYSQL_DATABASE = 'billing_system'
node server.js
```

Generate a strong session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
