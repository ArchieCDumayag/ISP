#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['mikrotik-audit-log.js', 'mikrotik-audit-log'],
  ['mikrotik-client.js', 'mikrotik-client'],
  ['mikrotik-endpoint.js', 'mikrotik-endpoint'],
  ['mikrotik.js', 'mikrotik'],
  ['pon-management-api.js', 'pon-management-api'],
  ['pon-serviceability.js', 'pon-serviceability'],
  ['pppoe-account-utils.js', 'pppoe-account-utils']
];

const backend = loadModuleBackend('network', { required: true, fresh: true });
assert.strictEqual(backend.id, 'network');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/network/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Network backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Network root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('network', { required: true });
const webFiles = [
  'coverage-map-app.html',
  'coverage-map.html',
  'genieacs.html',
  'pon-management.html',
  'pppoe.html',
  'css/genieacs.css',
  'css/leaflet-popups-tabler.css',
  'css/pon-management-tabler.css',
  'css/pon-management.css',
  'css/pppoe-tabler.css',
  'js/genieacs.js',
  'js/pon-management.js',
  'js/pppoe.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Network web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Network web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Network web root (${webFiles.length} files)`);

const coverageMapSource = fs.readFileSync(path.join(webRoot, 'coverage-map.html'), 'utf8');
const publicCoverageMapSource = fs.readFileSync(path.join(webRoot, 'coverage-map-app.html'), 'utf8');
const ponManagementHtmlSource = fs.readFileSync(path.join(webRoot, 'pon-management.html'), 'utf8');
const ponManagementJsSource = fs.readFileSync(path.join(webRoot, 'js', 'pon-management.js'), 'utf8');
const ponManagementBackendSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/network/backend/pon-management-api.js'),
  'utf8'
);
const ponServiceabilityBackendSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/network/backend/pon-serviceability.js'),
  'utf8'
);
const leafletPopupStyles = fs.readFileSync(path.join(webRoot, 'css', 'leaflet-popups-tabler.css'), 'utf8');
const pppoeHtmlSource = fs.readFileSync(path.join(webRoot, 'pppoe.html'), 'utf8');
const pppoeJsSource = fs.readFileSync(path.join(webRoot, 'js', 'pppoe.js'), 'utf8');
const pppoeTablerStyles = fs.readFileSync(path.join(webRoot, 'css', 'pppoe-tabler.css'), 'utf8');

[coverageMapSource, publicCoverageMapSource].forEach((source) => {
  assert(source.includes('css/leaflet-popups-tabler.css?v=1.1'));
  assert(source.includes("className: 'network-map-popup network-link-popup'"));
  assert(source.includes("className: 'network-map-popup customer-map-popup'"));
  assert(source.includes("className: 'network-map-popup nap-map-popup'"));
  assert(source.includes('class="card map-popup-card"'));
  assert(source.includes('progress progress-sm'));
  assert(source.includes('const statusBadgeClass ='));
});
assert(ponManagementHtmlSource.includes('css/leaflet-popups-tabler.css?v=1.1'));
assert(ponManagementHtmlSource.includes('js/pon-management.js?v=4.7'));
assert(ponManagementJsSource.includes('expectedRevision: syncState.revision'));
assert(ponManagementJsSource.includes('recoverFromPonRevisionConflict'));
assert(ponManagementJsSource.includes('applyBackendRevision(result)'));
assert(ponManagementBackendSource.includes("SELECT id FROM branches WHERE id = ? FOR UPDATE"));
assert(ponManagementBackendSource.includes('loadRelationalRevisionSnapshot(connection, branchId, { lockRows: true })'));
assert(ponManagementBackendSource.includes('assertExpectedPonRevision(payload?.expectedRevision, currentRevision)'));
const mysqlBranchLockIndex = ponManagementBackendSource.indexOf(
  "await connection.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId])"
);
const mysqlRevisionSnapshotIndex = ponManagementBackendSource.indexOf(
  'const currentState = await loadRelationalRevisionSnapshot(connection, branchId, { lockRows: true })'
);
const mysqlRevisionCompareIndex = ponManagementBackendSource.indexOf(
  'assertExpectedPonRevision(payload?.expectedRevision, currentRevision)',
  mysqlRevisionSnapshotIndex
);
assert(mysqlBranchLockIndex >= 0 && mysqlBranchLockIndex < mysqlRevisionSnapshotIndex);
assert(mysqlRevisionSnapshotIndex < mysqlRevisionCompareIndex);
assert.strictEqual(
  (ponServiceabilityBackendSource.match(/lockRelationalPonBranch\(connection, input\.branchId\)/g) || []).length,
  3
);
assert(ponManagementJsSource.includes("className: 'network-map-popup pon-reference-popup'"));
assert(ponManagementJsSource.includes('class="card map-popup-card"'));
[
  '.network-map-popup.leaflet-popup .leaflet-popup-content-wrapper',
  '.network-map-popup.leaflet-popup .leaflet-popup-content',
  '.network-map-popup.leaflet-popup .leaflet-popup-close-button',
  '.network-map-popup .map-popup-card.card',
  '.network-map-popup .map-popup-card__list.list-group',
  'var(--tblr-card-bg',
  'body.theme-dark .network-map-popup',
  '@media (max-width: 640px)'
].forEach((expected) => {
  assert(leafletPopupStyles.includes(expected), `Tabler Leaflet popup stylesheet is missing ${expected}`);
});
assert(leafletPopupStyles.includes('.leaflet-popup-close-button > span'));
assert(leafletPopupStyles.includes('content: none !important'));
assert(!leafletPopupStyles.includes('content: "\\00d7"'));
console.log('PASS coverage and PON Leaflet popups use shared Tabler card UI');

[
  'vendor/tabler/css/tabler.min.css',
  'css/tabler-app.css?v=3.1',
  'css/pppoe-tabler.css?v=1.3',
  'class="page-body pppoe-page"',
  'class="row row-deck row-cards g-3 mb-3 pppoe-summary-strip"',
  'class="pppoe-table table table-sm table-vcenter table-hover card-table mb-0"',
  '<col class="pppoe-col-customer">',
  '<col class="pppoe-col-username">',
  '<option value="50" selected>50</option>',
  'class="modal-overlay tabler-form-modal"'
].forEach((expected) => {
  assert(pppoeHtmlSource.includes(expected), `PPPoE Tabler page is missing ${expected}`);
});
assert(!pppoeHtmlSource.includes('css/accounts.css'));
assert(!pppoeHtmlSource.includes('css/account-view-shared.css'));
assert(!pppoeHtmlSource.includes('<th>Caller ID</th>'));
assert(!pppoeHtmlSource.includes('pppoe-col-caller-id'));
assert(!pppoeJsSource.includes('fa-solid'));
assert(pppoeHtmlSource.includes('data-pppoe-disabled-message'));
assert(pppoeHtmlSource.includes('class="alert alert-warning align-items-start gap-2 mb-0 pppoe-disabled-notice" hidden'));
assert(pppoeJsSource.includes('const hideIntegrationDisabled = () => {'));
assert(pppoeJsSource.includes('if (isConnected) {\n      hideIntegrationDisabled();'));
assert(pppoeJsSource.includes("const pageSizeStorageKey = 'pppoePageSizeCompact';"));
assert(pppoeJsSource.includes("(pageSizeSelect ? pageSizeSelect.value : '50')"));
[
  '.pppoe-toolbar',
  '.pppoe-table',
  'table-layout: fixed',
  '.pppoe-disabled-notice[hidden]',
  '.pppoe-col-username { width: 22%; }',
  '.pppoe-col-actions',
  '.pppoe-customer-search-results',
  '.pppoe-traffic-panel canvas',
  '#pppoe-edit-modal',
  'var(--tblr-primary'
].forEach((expected) => {
  assert(pppoeTablerStyles.includes(expected), `PPPoE Tabler stylesheet is missing ${expected}`);
});
console.log('PASS PPPoE uses Network-owned Tabler UI without legacy Admin styles');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('network')"));
assert(serverSource.includes("networkBackend.load('ponManagement')"));
assert(serverSource.includes("networkBackend.load('mikrotik')"));
assert(serverSource.includes("networkBackend.load('pppoeAccountUtils')"));
assert(serverSource.includes('NETWORK_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'coverage-map-app.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'pppoe.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'genieacs.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'pon-management.html')"));
console.log('PASS Network server loader and web routing');

const sourceChecks = [
  ['Features/modules/admin/backend/integration-settings.js', '../../network/backend/mikrotik-endpoint'],
  ['Features/modules/customer-management/backend/customers.js', '../../network/backend/mikrotik-client'],
  ['Features/modules/customer-management/backend/customer-draft-submissions.js', '../../network/backend/pon-management-api'],
  ['Features/modules/billing/backend/billing-scheduler.js', '../../network/backend/pppoe-account-utils'],
  ['Features/modules/billing/backend/disconnections.js', '../../network/backend/mikrotik-audit-log'],
  ['Features/modules/billing/backend/payments.js', '../../network/backend/mikrotik-client']
];
sourceChecks.forEach(([relativePath, expectedPath]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expectedPath), `${relativePath} must use canonical Network dependency ${expectedPath}`);
});
const technicianSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/technician/backend/technician-installations.js'),
  'utf8'
);
assert(technicianSource.includes('../../network/backend/pon-management-api'));
console.log('PASS migrated-module canonical Network imports');

const endpoint = backend.load('mikrotikEndpoint');
assert.deepStrictEqual(
  endpoint.normalizeMikrotikEndpoint('https://router.example:8729', 8728),
  {
    address: 'router.example',
    port: 8729,
    rawAddress: 'https://router.example:8729',
    hadEmbeddedPort: true
  }
);
assert.deepStrictEqual(endpoint.parseMikrotikAddress('[2001:db8::1]:8728'), {
  address: '2001:db8::1',
  port: 8728,
  hadEmbeddedPort: true
});

const pppoe = backend.load('pppoeAccountUtils');
const deduped = pppoe.dedupePppoeAccounts([
  { username: 'Subscriber', routerId: 'router-1', status: 'offline' },
  { username: 'subscriber', routerId: 'router-1', status: 'active' }
]);
assert.strictEqual(deduped.length, 1);
assert.strictEqual(deduped[0].status, 'online');
assert.strictEqual(pppoe.normalizePppoeUsernameKey(' Subscriber '), 'subscriber');

const audit = backend.load('mikrotikAuditLog');
assert.strictEqual(
  audit.describeCommand({ operation: 'set', selector: 'name=subscriber', payload: { disabled: 'yes' } }),
  '/ppp secret set where name=subscriber set disabled=yes'
);

const client = backend.load('mikrotikClient');
assert.strictEqual(client.normalizeMikrotikErrorCode({ code: 'ECONNREFUSED' }), 'ECONNREFUSED');
assert.strictEqual(client.isRetryableMikrotikError({ code: 'ECONNREFUSED' }), true);

const pon = backend.load('ponManagement');
assert.strictEqual(typeof pon.loadPonStateForBranch, 'function');
assert.strictEqual(typeof pon.savePonStateForBranch, 'function');
assert.strictEqual(typeof pon.createPonStateRevision, 'function');
assert.strictEqual(typeof pon.assertExpectedPonRevision, 'function');
assert.strictEqual(typeof pon.loadRelationalRevisionSnapshot, 'function');
const ponServiceability = backend.load('ponServiceability');
assert.strictEqual(typeof ponServiceability.findNearbyPonNaps, 'function');
assert.strictEqual(typeof ponServiceability.reservePonPort, 'function');
assert.strictEqual(typeof ponServiceability.releasePonPortReservation, 'function');
assert.strictEqual(typeof ponServiceability.finalizePonAssignment, 'function');
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/network/tests/pon-serviceability.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/network/tests/pon-state-revision.test.js')
], { stdio: 'inherit' });
const schemaSource = fs.readFileSync(path.join(projectRoot, 'scripts/schema.sql'), 'utf8');
assert(schemaSource.includes('pon_port_names_json LONGTEXT'));
assert(schemaSource.includes('CREATE TABLE IF NOT EXISTS pon_port_reservations'));
assert(schemaSource.includes('uniq_pon_reservation_active_port'));
const migrationSource = fs.readFileSync(path.join(projectRoot, 'scripts/migrate-json-to-schema.js'), 'utf8');
assert(migrationSource.includes('async function ensurePonPortNamesColumn()'));
assert(migrationSource.includes('await ensurePonPortNamesColumn();'));
console.log('PASS endpoint, PPPoE, audit, client-error, and PON helper contracts');
console.log('NETWORK COMPATIBILITY PASSED');
