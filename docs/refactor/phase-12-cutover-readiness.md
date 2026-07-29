# Phase 12: Final Regression and Cutover Readiness

## Goal

Run the full canonical-runtime regression, reconcile the durable project/module documentation, validate the distributable package, and separate architectural completion from production deployment approval.

## Result

Completed on 2026-07-29.

- The 12-phase physical refactor is complete.
- All eight business modules have canonical backend/web runtimes, ownership manifests, and current module contexts.
- `server.js` is the only repository-root JavaScript composition file.
- The shared working-tree lock/context workflow is ready for multiple Codex sessions.
- Existing production under `/opt/isp-billing` was not edited, restarted, or redeployed.

## Automated evidence

- `npm test` runs the complete Phase 11 structural, Core, eight-module, integration, security, and isolated HTTP suite, followed by the Phase 12 package/cutover validator.
- The structural inventory validates 347 files, 321 local CommonJS dependency edges, 427 browser script/stylesheet references, all 165 current JavaScript files, and tracked/current JSON syntax.
- All eight manifest backend descriptors and web roots load from canonical module paths.
- The isolated smoke runtime exercises 152 HTTP checks on ports `3190` and `4190`, including authentication/feature boundaries and negative source-exposure checks.
- `npm pack --dry-run --json --ignore-scripts` validates a 346-file canonical package containing the runtime/module assets while excluding secrets, runtime data, coordination state, dependencies, logs, and backups.
- `bash -n scripts/install-ubuntu.sh` and the installer help path pass without changing the system.

## Readiness classification

| Area | Status | Meaning |
| --- | --- | --- |
| Modular architecture | Ready | Canonical ownership and runtime boundaries are complete and regression-tested. |
| Multiple Codex sessions | Ready | Per-module contexts, manifests, exact locks, shared integration ownership, and startup guidance are in place. |
| Source-control cutover | Awaiting explicit approval | The complete refactor is local and uncommitted; review, commit, and push were not requested. |
| Production deployment | Not performed | `/opt/isp-billing` and `isp-billing.service` remain untouched. |
| Production release | Conditional | Resolve or explicitly accept the conditions below and complete authenticated staging/manual checks first. |

## Production-release conditions

These do not block module development or multiple Codex use, but they should be handled before treating the checkout as production-release ready:

1. On 2026-07-29, `npm audit --omit=dev` reports 28 dependency findings: 2 low, 12 moderate, 12 high, and 2 critical. The direct `xlsx` dependency includes high-severity findings for which npm reports no fix; dependency remediation needs a separate compatibility/security task.
2. `@jobuntux/psgc@0.2.1` declares Node.js 22 or newer, while this server and the Ubuntu installer currently use Node.js 20. The full smoke suite passes on Node.js 20, but the declared-engine mismatch should be deliberately resolved.
3. Fixed bootstrap account credentials still exist in the install/runtime workflow. Generate deployment-specific credentials and rotate all bootstrap accounts without recording their values in repository context files.
4. The automated smoke suite intentionally avoids authenticated, state-changing, external-provider, network-device, billing, payroll, and destructive data operations. Exercise those flows with safe staging accounts/data before deployment.

## Manual confirmation checklist

Directory review:

- Confirm `server.js` is the only root `*.js` file.
- Confirm each folder under `Features/modules/` has `README.md`, `module.json`, `Module_context.md`, `backend/index.js`, and `web/`.
- Confirm shared infrastructure is under `core/`, shared browser shell assets are under `public/`, and refactor validators are under `scripts/refactor/`.

UI review on the development server (`http://localhost:3100`):

- Log in with a safe development account and confirm the dashboard/sidebar load.
- Open one representative page from each enabled module: Customers, Billing/Payments, PPPoE or PON, Collector history, Technician jobs, Expenses/Payroll, Customer App, and Accounts/Admin.
- Confirm protected pages redirect when signed out and public application/legal pages still load.
- Use staging data for any create/update/payment/device/provider action; do not use production data or live network targets for confirmation.

## Final commands

```bash
npm test
npm run refactor:cutover
```

Production deployment, dependency upgrades, credential rotation, commit, and push remain separately authorized operations.
