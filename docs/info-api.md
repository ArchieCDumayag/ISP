# Billing Info JSON API

The `/api/info` endpoint exposes the most requested billing datasets (customers, collectors, plans, and coverage) as JSON so other tools can consume them without scraping any HTML page.

## Authentication

- If you already have an authenticated browser session, the `sessionId` cookie will be reused automatically.
- For system-to-system use, you can send HTTP Basic credentials (`Authorization: Basic ...`) using any existing billing account. Example:

```bash
curl -u admin:admin123 "http://localhost:3000/api/info?sections=summary,customers"
```

When credentials are missing or invalid, the server returns `401` with the `WWW-Authenticate: Basic` challenge header.

## Query Parameters

| Name      | Description                                                                 | Default                    |
|-----------|-----------------------------------------------------------------------------|----------------------------|
| `sections`| Comma-separated list of sections to include. Allowed: `summary`, `customers`, `collectors`, `plans`, `coverage`, or `all`. | `summary,customers,collectors,plans,coverage` |

## Response Structure

```jsonc
{
  "ok": true,
  "generatedAt": "2025-11-13T04:18:12.112Z",
  "sections": ["summary", "customers"],
  "summary": {
    "totals": {
      "customers": 5,
      "activeCustomers": 5,
      "delinquentCustomers": 2,
      "coverageAreas": 3,
      "assignedAreas": 3
    },
    "recurringMonthlyValue": 11295,
    "billed": 15495,
    "collected": 5197,
    "outstandingBalance": 10300,
    "latestPayment": {
      "accountNumber": "10000005",
      "amount": 1999,
      "date": "2025-11-13T03:50:01.228Z",
      "recordedBy": {
        "id": "2",
        "username": "superadmin",
        "role": "Collector"
      }
    }
  },
  "customers": [
    {
      "accountNumber": "10000002",
      "name": "Maria Santos",
      "status": "active",
      "plan": {
        "name": "Home Fiber",
        "amount": 2199,
        "billing": "Monthly"
      },
      "billing": {
        "dueDate": "2025-11-05",
        "isPastDue": true,
        "daysPastDue": 8
      },
      "financials": {
        "billed": 4398,
        "collected": 3198,
        "balance": 1200,
        "lastPayment": {
          "amount": 1200,
          "date": "2025-11-13T02:37:22.015Z",
          "recordedBy": {
            "id": "1",
            "username": "admin",
            "role": "Admin"
          }
        }
      },
      "collector": {
        "id": "2",
        "username": "superadmin"
      }
    }
  ]
}
```

- `collectors.items[]` summarizes the assigned areas, portfolio value, and latest collection per collector account.
- `plans.items[]` is the full plan list (sorted by price) with a per-category count.
- `coverage.items[]` echoes the coverage entries with their current collector assignment (if any) and highlights assignments that point to an unknown area.

Use the `sections` query parameter if you only need a subset of the data to keep payloads light (`?sections=summary,collectors`).

