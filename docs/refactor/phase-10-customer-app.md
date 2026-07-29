# Phase 10: Customer App and Communications Migration

## Goal

Move Customer App and communications backend/browser implementations into `Features/modules/customer-app` without changing portal, authentication, notification, Firebase, Messenger, SMS, scheduler, upstream, storage, provider, or browser contracts.

## Runtime structure

```text
Features/modules/customer-app/
  backend/
    index.js
    customer-app-api.js
    customer-fcm-tokens.js
    customer-notification-inbox.js
    customer-upstream.js
    firebase-push.js
    messenger-bot.js
    sms-delivery.js
    sms-scheduler.js
    sms-schema.js
    sms.js
  web/
    company-info.html
    customer-app-popup-reminder.html
    customer-app.html
    customer-login.html
    customer-portal.html
    privacy-terms.html
    sms.html
    sms.js
    terms-of-use.html
    css/
    js/
```

`module.json` declares both runtime entries. `server.js` loads Customer App through `core/runtime/module-loader`, mounts its routers/webhook at the existing paths, starts the same conditional background services, and serves its web root through existing static and explicit route guards.

## Compatibility strategy

- Ten former root backend paths remain one-line CommonJS shims that export the exact canonical module instances.
- Eighteen browser files moved from `public/` without content changes; their existing root URLs remain unchanged.
- Canonical dependencies use `core/`, Admin, and Customer Management paths directly; Customer Management now consumes canonical FCM and inbox helpers.
- Relative Firebase credential discovery was explicitly re-anchored to `PROJECT_ROOT`, preserving all pre-migration candidate and configured paths.
- Customer upstream, push scheduler, SMS scheduler, webhook, feature-gate, authentication, JSON/relational, and provider contracts remain unchanged.
- No external message, scheduler, authenticated customer, or stored-state mutation was used for acceptance testing.

## Completion evidence

Completed on 2026-07-29.

- Ten backend implementations and 18 public files physically migrated.
- Customer App descriptor, manifest, shims, web root, server wiring, canonical dependencies, Firebase paths, routers, and pure helper contracts verified by `npm run refactor:customer-app`.
- All 18 migrated browser files are byte-identical to their versions at the start of the phase.
- Current inventory validates 414 files, 374 local CommonJS dependency edges, and 427 HTML script/stylesheet references.
- Syntax validation passed for all 233 current JavaScript files.
- Security module loading passed.
- One hundred forty-six isolated HTTP checks passed across all module resources, page guards, public APIs, and unauthenticated API denials on ports `3190`/`4190`.
- Tests did not authenticate as a real customer, write notification/token state, run schedulers, or call Firebase, Messenger, SMS, or email providers.
- Production files, service, ports, environment, and data were not changed.

## Subsequent phase

Phase 11 subsequently cleaned shared `server.js` composition, common frontend, scripts, installer, configuration, and compatibility shims while preserving every module contract and production separation.
