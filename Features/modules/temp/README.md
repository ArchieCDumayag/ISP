# Temp Workspace

Provides one hidden, manually accessed Admin workspace for customers and billing at a secondary location. Temp records are intentionally isolated from the canonical Customer Management and Billing modules.

## Runtime

- `module.json` declares `backend/index.js`, the `web/` static root, and the dedicated `/api/temp` prefix.
- `/temp.html` is the only browser page and is protected by the shared Admin page guard.
- `backend/workspace-router.js` exposes Admin-only Temp customer/transaction CRUD, receipts, monthly payment-history export, official imported-GCash posting, clear-all, Collector Excel, JSON/Excel export, and JSON/Excel import endpoints.
- `backend/workspace-store.js` persists only through the distinct `temp_workspace_isolated_v1` key. JSON mode writes `data/temp_workspace_isolated_v1.json`; MySQL mode stores the same isolated key in `app_store`.
- `backend/billing-cycle.js` contains Temp-only Prepaid, Postpaid, and Billing-day Prorate calculations. It does not import or mutate the canonical Billing scheduler.
- `backend/workspace-excel.js` converts complete Temp exports to and from a strict workbook containing Metadata, Customers, and Transactions sheets and produces separate report-only Collector and monthly Temp Payment History workbooks.
- `web/temp.html`, `temp.css`, and `temp.js` provide standalone Customers, Billing & Payments, Payment History, and GCash Posting tabs without embedding or calling the main pages/APIs.

## Boundaries

- Temp customer, balance, import, and export operations never write the canonical `customers`, `payments`, or `plans` stores. Official GCash posting uses Billing's lightweight read-only lookup for collected or pending Main references—including customer display names and a Cash/blank-method credit only when its reference, amount, and date exactly identify the official credit—and the shared imported-history claim/finalize contract so the same reference cannot be posted twice.
- Temp never calls `/api/customers` or `/api/payments` and never embeds `/customers.html` or `/payments.html`.
- Customer Management and Billing remain unchanged and authoritative for the main location.
- Temp JSON and Excel backups contain the same complete isolated workspace and can only be restored through the Temp importer; their file kind is `isp-temp-workspace-export`.
- Official imported GCash rows are fully immutable, including exact stored reference/method text, receipt, timestamps, and audit metadata. Unverified legacy GCash rows cannot be edited or changed through import, including their audit timestamps; they can be deleted for correction or adopted into an exact one-to-three-account official group without reinsertion. Import and ordinary transaction CRUD reject Cash/blank or other credits that reuse an official/legacy GCash-owned reference. Exact retries return the same payment IDs, uncertain post-claim failures keep the reference reserved for retry, and clear-all cannot orphan a shared assignment.
- Manual GCash creation is blocked; Admin uses the GCash Posting tab after importing the official PDF. A manual Cash/blank-method credit whose reference matches an incoming imported credit is also blocked so mislabeling cannot bypass the official claim. When valid collected Main payments use only part of an official credit on the same date, GCash Posting locks those existing Main entry IDs, accepts only the exact remaining amount for one or more Temp customers, and finalizes both sides as one shared group without inserting another Main payment. Pending, wrong-date, duplicate-account, full-value, over-value, and more-than-three-combined-account cases fail closed.
- Clear all data requires browser confirmation and resets only the Temp customers, transactions, and Temp numbering sequences when no official GCash assignment would be orphaned.
- Collector Excel is a report-only workbook, not an import backup. Balance is the current ledger balance. Due stays equal to Balance before the next billing date; when the date is reached, the monthly rate is added once, with generated cycle charges detected to prevent double charging. Its report date uses Asia/Manila so it matches the Temp billing cycle around the UTC date boundary.
- Temp cycle catch-up runs only when the Temp workspace is loaded or exported. Active Prepaid and Postpaid customers receive full-rate automatic monthly charges; active Prorate customers receive a partial first charge only when using the monthly day-number schedule.
- Billing can start from an exact next-bill date or a recurring day number. Exact-date mode leaves the manually entered Opening balance untouched until that selected date, then continues with full monthly charges.
- Shared route protection and module composition remain Integration Codex ownership.
- `/temp.html` remains absent from every shared navigation surface and its API adds an explicit Admin-role check behind the shared session guard.
- A Temp-only export with official GCash rows depends on the matching shared imported-history assignment during restore; a full-system backup is required to recover both stores together.

Run `npm run refactor:temp` for focused isolation checks and update `Module_context.md` whenever this contract changes.
