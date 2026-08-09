#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['collector-next-due.js', 'collector-next-due'],
  ['collector-payments.js', 'collector-payments'],
  ['collectors.js', 'collectors'],
  ['routes/collectors.js', 'routes/collectors']
];

const backend = loadModuleBackend('collector', { required: true, fresh: true });
assert.strictEqual(backend.id, 'collector');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/collector/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Collector backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Collector root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('collector', { required: true });
const webFiles = [
  'collectors-history.html',
  'collectors.html',
  'css/collectors-history-tabler.css',
  'css/collectors-tabler.css',
  'css/collectors.css',
  'js/collectors-history.js',
  'js/collectors-page.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Collector web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Collector web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Collector web root (${webFiles.length} files)`);

const collectorsHtml = fs.readFileSync(path.join(webRoot, 'collectors.html'), 'utf8');
[
  'class="card collectors-kpi-grid"',
  'class="collectors-kpi-value"',
  'class="collectors-primary-column"',
  'class="collectors-side-column"',
  'id="collectorStatsPending"',
  'id="collectorStatsReschedules"',
  'id="collectorApprovalRefresh"',
  'id="collectorApprovalSearch"',
  'id="collectorApprovalCollectorFilter"',
  'id="collectorApprovalDateFilter"',
  'id="collectorApprovalClearFilters"',
  'id="collectorApprovalFiltersToggle"',
  'id="collectorApprovalFiltersPanel"',
  'id="collectorApprovalApproveSelected"',
  'id="collectorApprovalPagination"',
  'id="collectorRescheduleCreate"',
  'id="collectorRescheduleSearch"',
  'id="collectorRescheduleDateFilter"',
  'id="collectorRescheduleClearFilters"',
  'id="collectorRescheduleOverdueCount"',
  'id="collectorRescheduleTodayCount"',
  'id="collectorRescheduleUpcomingCount"',
  'id="collectorReschedulePagination"',
  'class="collector-assignment-list"',
  'id="assignmentSearch"',
  'id="newAssignmentBtn"'
].forEach((contract) => {
  assert(collectorsHtml.includes(contract), `Collector dashboard must include ${contract}`);
});
const collectorsPrimaryColumn = collectorsHtml.indexOf('class="collectors-primary-column"');
const collectorsSideColumn = collectorsHtml.indexOf('class="collectors-side-column"');
const collectorsPaymentsCard = collectorsHtml.indexOf('collectors-payments-card');
const collectorsRescheduleCard = collectorsHtml.indexOf('collectors-reschedule-card');
const collectorsAssignmentCard = collectorsHtml.indexOf('collectors-assignment-card');
assert(
  collectorsPrimaryColumn < collectorsRescheduleCard && collectorsRescheduleCard < collectorsSideColumn,
  'Collector primary column must contain Rescheduled Clients'
);
assert(
  collectorsSideColumn < collectorsPaymentsCard && collectorsPaymentsCard < collectorsAssignmentCard,
  'Collector side column must show Pending Collector Payments before Collector Assignment'
);
const collectorsClientSource = fs.readFileSync(path.join(webRoot, 'js/collectors-page.js'), 'utf8');
assert(collectorsClientSource.includes("document.getElementById('collectorStatsPending')"));
assert(collectorsClientSource.includes("document.getElementById('collectorStatsReschedules')"));
assert(collectorsClientSource.includes('const collectorApprovalPageSize = 5'));
assert(collectorsClientSource.includes('collectorApprovalSelectedIds'));
assert(collectorsClientSource.includes('data-collector-approval-toggle'));
assert(collectorsClientSource.includes('data-collector-approval-select'));
assert(collectorsClientSource.includes("document.getElementById('collectorApprovalFiltersToggle')"));
assert(collectorsClientSource.includes('collectorApprovalFiltersPanel.hidden = !willOpen'));
assert(collectorsClientSource.includes("tr.className = ['collector-reschedule-row'"));
assert(collectorsClientSource.includes("function collectorRescheduleUrgency(record = {})"));
assert(collectorsClientSource.includes('const collectorReschedulePageSize = 10'));
assert(collectorsClientSource.includes('const accountMeta ='));
assert(collectorsClientSource.includes('title="${escapeHtml(customerName)}"'));
assert(collectorsClientSource.includes("record?.accountNumber"));
assert(collectorsClientSource.includes('allCollectors.length <= 5'));
assert(collectorsClientSource.includes("card.className = `collector-assignment-item"));
assert(collectorsClientSource.includes('data-assign-action="view-collector-areas"'));
const collectorsLayoutSource = fs.readFileSync(path.join(webRoot, 'css/collectors-tabler.css'), 'utf8');
assert(collectorsLayoutSource.includes('grid-template-columns: minmax(0, 2fr) minmax(20rem, 1fr);'));
assert(collectorsLayoutSource.includes('.collectors-kpi-card:nth-child(-n + 2)'));
assert(collectorsLayoutSource.includes('.collectors-kpi-value strong'));
assert(collectorsLayoutSource.includes('body.layout-fluid-vertical .collectors-side-column {'));
assert(collectorsLayoutSource.includes('position: sticky;'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-assignment-list'));
assert(collectorsLayoutSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr));'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-assignment-item.is-unassigned'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-payment-summary'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-approval-group-card'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-approval-payment-item.is-old'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-payment-pagination'));
assert(collectorsLayoutSource.includes('.collectors-payments-card .collector-approval-action-menu__dropdown'));
assert(collectorsLayoutSource.includes('.collectors-payments-card .collector-payment-filters'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-row.is-overdue > td'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-row.is-upcoming > td'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-row.is-history'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-summary'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-pagination'));
assert(collectorsLayoutSource.includes('width: 26%;'));
assert(collectorsLayoutSource.includes('-webkit-line-clamp: 2;'));
assert(collectorsLayoutSource.includes('.collectors-board .collector-reschedule-compact-meta'));
assert(collectorsLayoutSource.includes('@media (max-width: 1100px)'));
assert(!collectorsLayoutSource.includes('grid-template-areas:'));
assert(!collectorsHtml.includes('collector-assignment-table'));
assert(!collectorsHtml.includes('assignmentsFooter'));
assert(!collectorsHtml.includes('id="collectorAreaAssignmentTitle"'));
assert(!collectorsHtml.includes('class="collector-payment-summary"'));
assert(!collectorsHtml.includes('<th>Paid Client</th>'));
console.log('PASS compact right-rail payment review, Collector assignment cards, and prioritized reschedule contracts');

const collectorHistoryHtml = fs.readFileSync(path.join(webRoot, 'collectors-history.html'), 'utf8');
[
  'class="card collection-history-kpi-grid"',
  'class="collection-history-kpi-value"',
  'class="collection-history-filter-grid"',
  'id="historyTotalCollected"',
  'id="historyPaymentCount"',
  'id="historyCollectorCount"',
  'id="historyAveragePayment"',
  'id="collectorFilter"',
  'id="areaFilter"',
  'id="historySearch"',
  'id="historyExportCsv"',
  'id="historyPrint"',
  'id="historyPageSize"',
  'data-history-sort="amount"',
  'modal-dialog modal-xl'
].forEach((contract) => {
  assert(collectorHistoryHtml.includes(contract), `Collector History must include ${contract}`);
});
const collectorHistoryClientSource = fs.readFileSync(path.join(webRoot, 'js/collectors-history.js'), 'utf8');
assert(collectorHistoryClientSource.includes('function buildCollectorPeriodStats(records = [])'));
assert(collectorHistoryClientSource.includes('function getFilteredHistoryEntries()'));
assert(collectorHistoryClientSource.includes('function sortHistoryEntries(entries = [])'));
assert(collectorHistoryClientSource.includes("new Blob([`\\uFEFF${lines.join('\\r\\n')}`]"));
assert(collectorHistoryClientSource.includes('setTimeout(() => window.print(), 0);'));
assert(!collectorHistoryClientSource.includes('if (e.target === modal) closeModal();'));
assert(!collectorHistoryClientSource.includes("if (e.key === 'Escape') closeModal();"));
const collectorHistoryLayoutSource = fs.readFileSync(path.join(webRoot, 'css/collectors-history-tabler.css'), 'utf8');
assert(collectorHistoryLayoutSource.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'));
assert(collectorHistoryLayoutSource.includes('.collection-history-kpi-card:nth-child(-n + 2)'));
assert(collectorHistoryLayoutSource.includes('.collection-history-kpi-value strong'));
assert(collectorHistoryLayoutSource.includes('position: sticky;'));
assert(collectorHistoryLayoutSource.includes('@media (max-width: 760px)'));
assert(collectorHistoryLayoutSource.includes('@media print'));
console.log('PASS Collector History Tabler KPIs, filters, sort, pagination, export, print, modal, and mobile-card contracts');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('collector')"));
assert(serverSource.includes("collectorBackend.load('collectors')"));
assert(serverSource.includes("collectorBackend.load('collectorPayments')"));
assert(serverSource.includes('COLLECTOR_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'collectors.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'collectors-history.html')"));
console.log('PASS Collector server loader and web routing');

const collectorPaymentsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/collector/backend/collector-payments.js'),
  'utf8'
);
assert(collectorPaymentsSource.includes('../../admin/backend/accounts-store'));
assert(collectorPaymentsSource.includes('../../billing/backend/payment-numbering'));
assert(collectorPaymentsSource.includes('../../billing/backend/payment-service-refresh'));
assert(collectorPaymentsSource.includes('../../billing/backend/payment-records'));
assert(collectorPaymentsSource.includes('../../../../core/data/data-store'));
assert(collectorPaymentsSource.includes('../../../../core/security/role-utils'));

const collectorsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/collector/backend/collectors.js'),
  'utf8'
);
assert(collectorsSource.includes('../../admin/backend/accounts-store'));
assert(collectorsSource.includes('../../../../core/data/db'));
const legacyRoutesSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/collector/backend/routes/collectors.js'),
  'utf8'
);
assert(legacyRoutesSource.includes('../../../../../core/data/db'));

['auth.js', 'info-api.js'].forEach((fileName) => {
  const source = fs.readFileSync(path.join(projectRoot, 'Features/modules/admin/backend', fileName), 'utf8');
  assert(source.includes('../../collector/backend/collector-next-due'));
});
console.log('PASS canonical Core, Admin, Billing, and Admin-to-Collector dependencies');

const { resolveCollectorNextDue } = backend.load('collectorNextDue');
assert.strictEqual(
  resolveCollectorNextDue(
    { planCategory: 'prepaid', dueDate: '2026-08-03' },
    new Date(2026, 6, 29)
  ),
  '2026-08-03'
);
assert.strictEqual(
  resolveCollectorNextDue(
    { planCategory: 'postpaid', billDate: 15, dueOffset: 5 },
    new Date(2026, 6, 29)
  ),
  '2026-08-20'
);
assert.strictEqual(typeof backend.load('collectors'), 'function');
assert.strictEqual(typeof backend.load('collectorPayments'), 'function');
assert.strictEqual(typeof backend.load('legacyCollectorsRoutes'), 'function');
console.log('PASS Collector next-due and router contracts');
console.log('COLLECTOR COMPATIBILITY PASSED');
