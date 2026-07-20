# Update and Download Package

This package contains the full app structure for deployment/update.
Runtime data (customer/payment records) is intentionally not included.

## Default Login (fresh structure)
- Username: archiecd
- Password: finley123!

## Quick Start
1. Copy files to your target server.
2. Run `npm install`.
3. Copy `flavor.config.example.json` to `flavor.config.json`.
4. Edit only `flavor.config.json` for this copy's domain, storage driver, admin, secrets, and feature checklist.
5. Run `npm run flavor:apply`.
6. Start app with `npm start`.

Default storage is JSON file mode:

```json
"storage": {
  "driver": "json"
}
```

Runtime data is saved in `data/*.json`.

## Feature Checklist
Each flavor has a `features` object in `flavor.config.json`.

Set a feature to `false` to remove it from the sidebar for that flavor:

```json
"features": {
  "payroll": false,
  "sms": true
}
```

## Named Flavors
Create a local named flavor from the current config:

```powershell
npm run flavor:new -- acme-fiber
```

Apply a named flavor later:

```powershell
npm run flavor:use -- acme-fiber
```

List saved local flavors:

```powershell
npm run flavor:list
```

Check for unsafe conflicts:

```powershell
npm run flavor:check
```

Create a guided flavor:

```powershell
npm run flavor:create -- client-name
```

Generate a Desktop launcher:

```powershell
npm run flavor:launcher -- client-name
```
