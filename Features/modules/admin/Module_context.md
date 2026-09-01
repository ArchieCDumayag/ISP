# Admin Module Context

Last reviewed: 2026-09-01
Status: Physically modularized and loaded through the runtime module manifest.

## Purpose and current scope

- Authenticate staff, collectors, and technicians; create/verify sessions and enforce roles.
- Manage protected admin accounts and primary/backup admin safeguards.
- Maintain business profile, protected integration settings, activity logs, and app downloads.
- Publish permanent release-signed THRE3J Collector Android updates from one Admin-only page to the checksum-bound Windows LAN channel at `http://192.168.100.9:3000/collector-updates`.
- Provide an Admin-only, password-confirmed project factory reset for operational records across all modules and branches.
- Provide one Admin-only, versioned full-system backup archive and a checksum-validated complete restore for all application records and uploaded files.
- Provide an Admin-confirmed, exact-commit system update with live progress, fast-forward validation, a Git recovery point, and automatic source/dependency rollback on failure.
- Expose the information API plus owner-only setup, schema, and update tools.

## Canonical runtime layout

- `backend/index.js` is the lazy Admin backend descriptor loaded from `module.json`.
- `backend/auth.js`: `/api/auth` and shared Admin/Collector/Technician session contracts.
- Collector login, identity refresh, transaction refresh, payment-record lookup, and map payloads apply Collector-owned branch/account exclusions before returning assigned customers; Admin authentication and session behavior are unchanged.
- `backend/accounts.js` and `backend/accounts-store.js`: `/api/accounts` and protected accounts.
- `backend/activity-log.js` and `backend/activity-log-visibility.js`: audit persistence and visibility.
- `backend/business-profile.js`: `/api/business-profile`.
- `backend/factory-reset.js`: `/api/admin-data-reset` preview and reset operations. Reset requires the current Admin password, the exact `CLEAR ALL DATA` phrase, an irreversible-action acknowledgement, and a final browser confirmation.
- `backend/system-backup.js`: `/api/system-backup/export`, `/preview`, and `/restore`. Export reopens every generated ZIP and runs the complete Import validation contract before sending it with an exact content length and snapshot ID. Preview stages a selected ZIP for 15 minutes, verifies its manifest, paths, sizes, SHA-256 checksums, storage driver/conversion path, Admin-account presence, and MySQL schema compatibility without writing application records.
- `backend/system-backup-service.js`: creates/restores schema-versioned `isp-full-system-backup` archives, snapshots every eligible JSON store or MySQL table plus `data/uploads` and `public/uploads`, creates the automatic pre-import recovery archive, and rolls filesystem changes back on normal restore failures. MySQL restores use an InnoDB transaction; validated JSON archives may be converted into the current MySQL schema by `backend/json-to-mysql-restore.js` inside the same replacement transaction.
- `backend/integration-settings.js`: `/api/integrations` and protected settings.
- `backend/info-api.js`: `/api/info` aggregation.
- `backend/app-downloads.js` and `backend/app-downloads-store.js`: `/api/app-downloads`.
- `backend/collector-app-updates.js`: public `/collector-updates/update.json` and active versioned APK delivery plus Admin-only `/api/collector-app-updates` status/publish operations. The module and routes load only outside production when ignored local configuration sets `COLLECTOR_APP_UPDATES_LAN_ENABLED=true`; requests must arrive directly from a private address for the approved LAN host or from loopback for a localhost host, and Cloudflare/forwarded requests fail closed with `404`. Local uploads or repository-scoped `raw.githubusercontent.com/ArchieCDumayag/CollectorApp/` imports are capped at 80 MB, validated as APK ZIPs, named by version/checksum, written atomically, SHA-256 hashed, and activity-audited. APKs and the active manifest live under ignored `data/collector-updates`.
- `backend/setup-installer.js`: owner-only `/api/structure` and structure package operations.
- `web/` contains Admin-owned browser files. It is mounted after page authorization guards and before the shared `public/` fallback.
- Root browser-asset delivery checks shared `public/` and module web roots only, which keeps `/accounts.js` mapped to the Admin browser bundle without exposing repository source files.

The former eleven root backend shims were retired in Phase 11. Existing browser URLs and API prefixes did not change.

## Browser entry points

- `/collector-app-update.html` is served from `web/collector-app-update.html` only through the enabled direct-LAN gate; only an authenticated Admin may open it or call the publishing API. The form accepts either a local permanent release-signed APK or an approved CollectorApp raw GitHub source, requires version policy metadata and explicit confirmation, locks while publishing, restores keyboard focus after successful actions, clears stale refresh errors, and exposes the current manifest/APK details.

- `/login.html` → `web/login.html`
- `/accounts.html` → `web/accounts.html`
- The System Update panel keeps **Apply New Update** available when an update exists even if the checkout has local tracked or untracked changes. The updater creates a temporary Git stash, applies it to an isolated worktree at the exact incoming commit as a compatibility check, fast-forwards only when that succeeds, restores the local changes before dependency installation/restart, and removes the temporary stash after verified restoration. A conflict fails without moving the production branch and restores the original working tree; a failed recovery retains the stash and reports its short identifier.
- The Accounts tab bar exposes GCash as a normal settings panel. Admins can view and edit the merchant account name, number, and QR code without relying on a hidden integration panel.
- The `Data Reset` section inside `/accounts.html` displays current record/file counts, deletion and preservation scope, an Android offline-data warning, and the guarded reset form.
- The shared toolbar Export button downloads the complete `.isp-backup.zip`; Import validates that archive, previews selected/current record and upload counts, labels an allowed `JSON -> MYSQL` conversion, and requires the current Admin password, `RESTORE ALL DATA`, and an explicit replacement acknowledgement. Legacy customer workbook imports remain available through the same picker for `.xlsx`, `.xls`, and `.json` files.
- The `System Update` section checks the tracked remote branch, requires an Admin confirmation for the displayed commit, reports each running step through `/api/system-update/run`, and leaves the Apply button disabled for an unverified, unsupported, current, or diverged checkout. Dirty checkouts remain eligible because their tracked and untracked changes are preserved and compatibility-checked before mutation.
- `/setup.html` → `web/setup.html`
- `/install-guide.html` → `web/install-guide.html`
- `/update-download.html` → `web/update-download.html`

Shared shell, vendor, branding, and Tabler assets continue to fall back to `public/`. `web/css/accounts.css` is also consumed by Network module pages through its unchanged `/css/accounts.css` URL.

## Data and dependencies

- Canonical shared imports come from `core/data`, `core/security`, and `core/runtime`.
- MikroTik endpoint normalization and Billing dependencies resolve directly from canonical module backends; no module imports repository-root backend aliases.
- Repository-root configuration remains `service-config.json` and `structure-manifest.json`.
- Installer paths explicitly use `core/runtime/paths.PROJECT_ROOT`; moving the backend must never redirect releases, scripts, `.cloudflared`, or package operations into the module folder.
- `backend/system-update-local-changes.js` owns local-change preservation, isolated incoming-commit compatibility checks, restoration, and temporary-stash cleanup for the shared `/api/system-update` implementation in `server.js`.
- Structure downloads and validation include the Admin backend/web paths, and page-scoped packages recognize module web pages.
- Every business module depends on Admin authentication/authorization contracts.
- Admin collector login and information flows resolve next-due calculations directly from the migrated Collector backend.
- Admin Collector authentication imports the canonical Collector exclusion filter. The exclusion store and management APIs remain Collector-owned; Admin only enforces the filter at the shared `/api/auth/collector-*` boundary.
- Owner-only routes require localhost plus `STRUCTURE_OWNER_ID`.
- Sensitive integration data requires `CONFIG_MASTER_KEY`; production sessions require `SESSION_TOKEN_SECRET`.
- Collector update metadata and APK URLs are deliberately pinned to `http://192.168.100.9:3000/collector-updates`. Android independently enforces that origin and verifies SHA-256, package ID, increasing version code, and the installed signing certificate before opening the installer.
- IP Browser integration settings support up to 100 enabled/disabled router profiles. Each profile stores a label, ordered exact IP/IP:port, IPv4 CIDR, or wildcard match rules, protected username/password data, optional page selectors, and submit delay. Exact host/port matches outrank host matches, which outrank CIDR and wildcard rules; profile order breaks ties.
- IP Browser profile credentials and usernames are redacted from `/api/integrations` responses and represented only by presence flags. Blank username/password values sent while editing an existing profile preserve the stored secrets. The legacy top-level IP Browser credentials remain the fallback when no profile matches.
- Factory reset deletes customers, plans, billing/payment history, imported GCash transaction history, the centralized referral registry/application audit, collector/technician accounts and assignments, Collector client exclusions and priority assignments, schedules/reminders, tickets/jobs, PON/coverage state, Finance, SMS records/templates/automations, Temp workspace records, activity history, generated backups/cache, legacy record uploads, and payment proof files. It preserves Admin accounts/sessions, branches, business profile, account-number and Customer App/collector settings, integrations, app downloads, MySQL configuration, and source code. A non-secret last-reset audit marker is retained.
- JSON reset rewrites known business stores to empty canonical shapes with rollback on store-write failure. MySQL reset deletes business tables and business `app_store` keys in a transaction, retaining only Admin users/sessions and configuration tables/keys. Generated-file cleanup runs after the record transaction and reports any file warnings.
- Full-system archives include accounts/users, customers, plans, all payment and billing stores, imported GCash rows and allocations, Collector/Technician/Finance/Network/Customer App/Temp records, business and encrypted integration settings, activity/audit data, app-download records, and both upload roots. The manifest discovers records dynamically so new JSON stores or MySQL tables are not silently omitted.
- Full-system archives intentionally exclude Admin/customer runtime sessions, `CONFIG_MASTER_KEY`, MySQL connection files, Firebase/service-account files, environment/source/log data, generated caches, and prior backup directories. Encrypted integration settings restored on another server require the same externally managed `CONFIG_MASTER_KEY`.
- Complete restore replaces eligible records/uploads rather than merging them. It blocks other API requests, activates the shared maintenance write gate for background JSON/shared-MySQL mutations, drains queued JSON writes, creates `data/backups/pre-import-system-backup-*.isp-backup.zip`, and invalidates every server session after success. JSON file/upload swaps retain rollback copies until installation succeeds. Same-driver MySQL archives still require an exact table/column match; JSON-to-MySQL restore requires the mapped target columns and transactional InnoDB tables, preserves supplemental JSON stores in `app_store`, hashes legacy plaintext passwords, normalizes canonical customer ONU serials, rejects branch-local ONU ownership conflicts and conflicting payment IDs, clears sessions, and rolls back database/upload replacement together on failure. MySQL-to-JSON conversion remains unsupported.
- System update execution permits only one server-side apply request at a time and requires an authenticated Admin, explicit confirmation, the exact 40-character remote commit shown in the UI, a supported Windows/Ubuntu host, valid remote package metadata, and a verified fast-forward path. It fetches once more, rejects a changed remote target, creates `refs/isp-update-backups/*`, preserves and preflights local changes, fast-forwards deterministically, installs production dependencies, restores local changes, and restarts only after success. A post-merge failure resets to the previous commit, restores the preserved checkout, and reinstalls its dependency set; rollback failure retains and reports the recovery references for manual repair.

## Verification contract

- `npm run refactor:admin` checks the manifest, loader, retirement of eleven root entries, eleven web files, server wiring, canonical installer paths, IP Browser match precedence, secret redaction/preservation, profile-editor structure, the visible GCash tab contract, and the System Update confirmation/progress/recovery/rollback wiring.
- `npm run refactor:phase3` runs structural, core, Admin, security, and isolated HTTP checks.
- `npm run refactor:phase12` is the final cross-module structural, module, integration, security, HTTP, and package gate.
- HTTP coverage includes public Admin files, protected-page redirects, owner-page denial, and unauthenticated API denial.
- Collector OTA coverage requires the canonical backend/page/controller, Admin module registration, default-off/non-production conditional loading, direct-LAN/proxy rejection guards, case-normalized and percent-decoded page/controller guarding before Windows static resolution, and rejection of backslash traversal, NTFS alternate streams, 8.3 aliases, illegal filename syntax, and trailing-dot/space aliases. It also covers protected page redirect or disabled `404`, unauthenticated API denial or disabled `404`, explicit Admin-role denial, and an isolated successful HTTP round trip for the LAN-pinned manifest plus byte-identical APK with its MIME type, length, disposition, and SHA-256 ETag. HTTP smoke always launches additional disabled-development and flag-enabled-production runtimes and requires every canonical/mixed-case/encoded/aliased OTA page, controller, API, and manifest path to fail closed.
- Admin compatibility tests exercise the JSON factory-reset service in memory, including Admin/session/configuration preservation, centralized referral-registry and imported GCash-history clearing, dynamic Finance-store clearing, audit creation, and UI/API wiring. Smoke coverage requires authentication for reset preview and confirms the new CSS/JavaScript assets are served.
- Admin compatibility tests create an isolated temporary full archive, require the generated download to pass the same validation used by Import, verify secret/session exclusions and both upload roots, mutate only temporary fixtures, restore the archive, confirm complete replacement/session invalidation, and verify that the automatic pre-import backup exists. HTTP smoke coverage keeps `/api/system-backup/export` protected.
- Admin compatibility tests also build and apply an isolated JSON-to-MySQL conversion plan, require every source store to remain represented, verify unique payment IDs and mapped Admin/customer/plan/Collector/PON records, and assert that runtime sessions are never inserted.
- Admin compatibility tests create temporary Git repositories to verify that System Update restores compatible tracked/untracked local changes after a fast-forward and that conflicting changes are restored on the original commit without leaving a stash behind.
- The 2026-08-14 flavor retirement passed JavaScript/JSON syntax checks, focused Admin/Integration/HTTP smoke validation, the complete `npm test` Phase 12 gate, and live browser checks confirming `/flavors` is gone while authenticated Payment Queue navigation remains available.
- The 2026-08-16 Collector exclusion integration passed Admin/Collector syntax, the focused exclusion lifecycle and existing Collector regression suites, `npm run refactor:admin`, `npm run refactor:collector`, and the complete `npm test` Phase 12 gate. Authentication filters exclusions before expensive assigned-customer payment payload construction and does not alter Admin sessions or canonical customer/payment records.
- The 2026-08-06 factory-reset change passed syntax checks, read-only live preview, `npm run refactor:admin`, isolated HTTP smoke tests, and the complete `npm test` Phase 12 suite. Local port 3000 serves the new assets and returns `401` for unauthenticated reset preview. In-app visual testing was unavailable because no browser session was connected.
- The 2026-07-30 IP Browser profile change passed JavaScript syntax checks, HTML structure parsing, `npm run refactor:admin`, and the complete `npm test` Phase 12 suite. Interactive browser-control verification was unavailable in that session.

## Known risks and follow-up

- Auth/session/account changes are high risk and require negative authorization tests.
- Never expose secrets through API responses, logs, contexts, coordination updates, or commits.
- Overlapping IP Browser CIDR or wildcard profiles can both match the same target; the more specific score wins and profile order breaks equal-score ties. Keep match rules narrow and non-overlapping when practical.
- Owner-only route guards must preserve both localhost and owner checks.
- `auth.js` still contains Collector/Technician login contracts; coordinate those module migrations.
- Admin CSS is shared by Network pages; preserve its unchanged public URL.
- System update/setup behavior can affect deployment and schema state; never run production mutations without explicit approval.
- The Collector OTA overlay is default-off and enabled only by the confirmed Windows server's ignored `.env`. Its route, page, controller, and API guards accept only direct private/loopback traffic for the approved LAN or localhost host and reject Cloudflare/forwarded ingress. Do not commit, push, or enable it on the separate public/Ubuntu production deployment without a new explicit deployment decision.
- A source rollback cannot reverse application-data migrations performed by newly updated startup code. Schema/data migrations must remain backward compatible or carry their own recovery procedure, and production operators should retain a current full-system backup before applying an update that changes stored data.
- System Update cannot resolve a real source conflict automatically. Its preflight fails closed, leaves the branch unmoved, and restores the original local changes; operators must reconcile that conflict before retrying.
- Factory reset is global, permanent, and intentionally does not create a backup. Android offline records exist outside the server and can upload again after Sync unless cleared on those devices.
- A full-system restore is global and replaces current server records. The preview expires after 15 minutes. Same-driver restore remains the default; the only cross-driver path is JSON backup to MySQL, and it is rejected unless every required table/column is present and every eligible table is InnoDB. MySQL-to-JSON remains unsupported. Android offline storage is outside the archive and can sync again later.
- Full-system archives contain password hashes and protected business data even though raw server keys are excluded; store downloaded archives securely. Restored encrypted integrations depend on the same `CONFIG_MASTER_KEY`.
- Add a fuller automated role matrix, session invalidation, protected-account, and authenticated owner-route suite.

## Latest meaningful changes

- 2026-09-01: Restored the Admin-managed Collector Android OTA page and delivery routes on the confirmed Windows LAN server after `main` cleanup had removed their source wiring while leaving the ignored v1.30 APK/manifest intact. Publishing is explicitly Admin-role-only, the UI locks/reports accessibly and preserves keyboard focus, metadata remains pinned to `192.168.100.9:3000`, isolated HTTP regression coverage exercises successful manifest/APK delivery, and a default-off runtime plus direct-LAN ingress gate prevents the local channel from following the source into Cloudflare or public production. Decoded/lowercased pre-static guards plus Windows-unsafe path rejection close mixed-case, encoded-separator, NTFS ADS, 8.3, and trailing-dot aliases; dedicated disabled-development plus enabled-production smoke runtimes prove the feature fails closed.
- 2026-08-30: Hardened **Apply New Update** around the exact Admin-reviewed remote commit while supporting deployments with local hotfixes. The server rejects stale confirmations, diverged/non-fast-forward checkouts, and invalid package metadata; preserves tracked/untracked changes; preflights them in an isolated worktree; exposes live progress; creates a Git recovery ref; fast-forwards deterministically; restores local changes; and rolls source, checkout state, and dependencies back after a post-merge failure. The UI confirms before mutation, displays precise progress/failure state, and stays locked through restart.
- 2026-08-24: Added fail-closed JSON-backup-to-MySQL restore. Preview validates a deterministic conversion plan and shows `JSON -> MYSQL`; restore creates the normal recovery archive, replaces mapped relational records and preserved supplemental stores in one InnoDB transaction, rejects conflicting payment IDs, restores uploads with rollback, and clears sessions. The supplied 21-store archive restored 356 customers and 465 source payment rows with no warnings; startup produced 970 unique ledger rows with zero logical duplicate groups while retaining 92 imported GCash transactions, and a fresh MySQL export revalidated successfully.
- 2026-08-24: Hardened full-system Export so a generated archive is reopened and passed through Import's manifest, checksum, storage-driver, Admin-record, upload-root, and MySQL schema checks before download. Successful responses now include the exact archive length and snapshot ID; invalid or incomplete archives are rejected instead of being offered to the Admin.
- 2026-08-16: Applied the Collector-owned excluded-client filter to every assigned-customer Collector authentication/refresh/map/payment-record response. Excluded accounts disappear from Android after a successful login or Sync, while Admin sessions, customers, payments, and offline-captured uploads remain intact; factory reset now clears the exclusion and existing priority stores.
- 2026-08-16: Replaced the shared toolbar's partial export with one versioned full-system ZIP covering all eligible JSON/MySQL application records and both upload roots. Import now validates/checksums and previews the archive, requires fresh Admin authorization, creates a pre-import recovery backup, replaces records with JSON rollback or an InnoDB transaction, pauses other record writes, and invalidates sessions. Legacy customer workbook merge import remains supported.
- 2026-08-14: Retired the owner-only flavor management page and APIs. All application modules are now present in every deployment; Admin authentication, roles, and integration readiness remain the access boundaries. No Admin accounts, sessions, integration settings, or business records were migrated or deleted.
- 2026-08-10: Added Billing's `gcash_transaction_history` app-store key to the guarded Clear All Data contract and Admin compatibility coverage; integration settings and merchant details remain preserved.
- 2026-08-10: Exposed the existing GCash merchant integration as a visible Accounts settings tab, retaining the existing account-name, mobile-number, QR upload, status, validation, and save behavior.
- 2026-08-07: Added `referral_registry` to the protected project-data reset contract so Clear All Data also removes referral relationships and application audit records across branches.
- 2026-08-06: Added the Admin Settings Data Reset section and `/api/admin-data-reset`, with live deletion preview, current-password verification, exact confirmation phrase, irreversible acknowledgement, final UI confirmation, concurrency/rate limiting, JSON rollback, transactional MySQL deletion, retained Admin/configuration access, generated-file cleanup, and a non-secret audit marker. Validation never invokes the live reset.
- 2026-07-30: Added protected multi-router IP Browser profiles with exact IP/port, CIDR, and wildcard matching; Accounts now manages per-profile credentials/selectors/delay while keeping the former global login as the unmatched-device fallback.
- 2026-07-29: Phase 12 revalidated Admin through the canonical runtime and final package gate; no owned behavior, API, or UI contract changed.
- 2026-07-29: Phase 11 retired all eleven Admin root shims, switched cross-module imports to canonical Billing paths, and changed structure-package requirements to the canonical Admin installer only.
- 2026-07-29: Phase 3 moved eleven backend implementations and ten web files into this module, added manifest runtime entries, preserved root imports and public URLs, made installer paths repository-root-safe, and added Admin regression gates.
- 2026-07-29: Phase 6 switched integration settings to the canonical Network endpoint normalizer after the Network migration.
- 2026-07-29: Phase 7 switched collector authentication and information flows to the canonical Collector next-due helper.
- 2026-07-29: Established Admin ownership manifest and durable module context.

## Context update rule

Update this file in the same task whenever owned behavior, APIs, data structures, UI workflow, tests, risks, dependencies, or source ownership changes.
