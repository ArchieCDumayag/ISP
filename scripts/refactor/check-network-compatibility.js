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
  ['mikrotik-audit-log.js', 'mikrotik-audit-log'],
  ['mikrotik-client.js', 'mikrotik-client'],
  ['mikrotik-endpoint.js', 'mikrotik-endpoint'],
  ['mikrotik.js', 'mikrotik'],
  ['pon-management-api.js', 'pon-management-api'],
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
const leafletPopupStyles = fs.readFileSync(path.join(webRoot, 'css', 'leaflet-popups-tabler.css'), 'utf8');

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
assert(ponManagementHtmlSource.includes('js/pon-management.js?v=4.6'));
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
console.log('PASS endpoint, PPPoE, audit, client-error, and PON helper contracts');
console.log('NETWORK COMPATIBILITY PASSED');
