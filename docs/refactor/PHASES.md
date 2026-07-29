# Modular Refactor Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Baseline tests, dependency map, ownership inventory, and acceptance gates | Complete |
| 2 | Target runtime architecture, module loader, compatibility paths, and shared core | Complete |
| 3 | Admin/auth module physical migration | Complete |
| 4 | Customer Management physical migration | Complete |
| 5 | Billing physical migration | Complete |
| 6 | Network physical migration | Complete |
| 7 | Collector physical migration | Complete |
| 8 | Technician physical migration | Complete |
| 9 | Finance physical migration | Complete |
| 10 | Customer App and communications physical migration | Complete |
| 11 | `server.js`, shared frontend, scripts, installer, and configuration cleanup | Complete |
| 12 | Full regression verification, documentation reconciliation, and cutover readiness | Complete |

Refactor status: **Complete.** Production deployment remains a separate, explicitly authorized operation.

## Phase acceptance rule

A phase is complete only when:

1. owned files and contexts are updated;
2. `npm run refactor:verify` passes;
3. relevant syntax/security checks pass;
4. `npm run refactor:smoke` passes after runtime changes;
5. no coordination locks remain;
6. the user is told what UI or directory checks are useful.
