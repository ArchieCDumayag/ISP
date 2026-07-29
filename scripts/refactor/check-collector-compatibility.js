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
