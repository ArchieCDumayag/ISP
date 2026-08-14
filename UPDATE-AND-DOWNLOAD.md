# Update and Download Package

This package contains the full app structure for deployment/update.
Runtime data (customer/payment records) is intentionally not included.

## Default Login (fresh structure)
- Username: archiecd
- Password: finley123!

## Quick Start
1. Copy files to your target server.
2. Run `npm install`.
3. Configure `.env` with the deployment URL, ports, storage driver, Admin bootstrap values, and required secrets.
4. Start the app with `npm start`.

Default storage is JSON file mode:

```env
STORAGE_DRIVER=json
```

Runtime data is saved in `data/*.json`.

All modules and routes are included in every deployment. Existing customer, billing, payment, and operational records remain under the configured storage driver and are not changed by application updates.
