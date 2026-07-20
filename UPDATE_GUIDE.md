# Safe Update Guide

Use this process when applying a bug fix from another copy/version of the billing system.

## Rule

Do not replace the whole system folder or whole files by default. Apply the smallest reviewed patch that fixes the bug.

## Before Updating

1. Confirm the current system runs.
2. Back up MySQL:

   ```powershell
   npm run backup:mysql
   ```

3. Check Git status:

   ```powershell
   git status
   ```

4. Commit or document any current local changes before applying the new fix.

## Applying A Bug Fix

1. Create a branch:

   ```powershell
   git checkout -b update/short-bug-name
   ```

2. Compare the fixed version against this system.
3. Copy only the related fix, not unrelated layout, account, auth, schema, or deployment changes.
4. If the fix touches schema, update `scripts/schema.sql` and run Schema Update from the owner page.
5. If the fix touches sensitive areas, re-check the guards listed below.

## Sensitive Areas

Use extra care when changing:

- `auth.js`
- `accounts.js`
- `accounts-store.js`
- `server.js`
- `data-store.js`
- `db-secrets.js`
- `setup-installer.js`
- `scripts/schema.sql`

For owner-only pages, confirm both protections still apply:

- localhost-only access
- `STRUCTURE_OWNER_ID`

## Smoke Test

After applying a fix, test these flows:

- Admin login
- Backup admin forced username/password change
- Customer list loads
- Customer create/edit
- Payment entry
- Billing/due date behavior related to the fix
- Owner page opens only on localhost
- Schema Update still works if schema was touched

## Commit

When testing passes:

```powershell
git status
git add .
git commit -m "Fix short bug description"
```

## Rollback

If the update breaks something before commit:

```powershell
git restore .
```

If it breaks after commit:

```powershell
git revert HEAD
```

## Update Note Template

```text
Update:
Date:
Source version/copy:
Bug:
Files changed:
Schema change: yes/no
Smoke test result:
Backup location:
```
