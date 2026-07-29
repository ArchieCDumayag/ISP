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
  ['expenses.js', 'expenses'],
  ['payroll.js', 'payroll']
];

const backend = loadModuleBackend('finance', { required: true, fresh: true });
assert.strictEqual(backend.id, 'finance');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/finance/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Finance backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Finance root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('finance', { required: true });
const webFiles = [
  'expenses.html',
  'payroll.html',
  'reports.js',
  'css/finance.css',
  'css/monthly-collection-trend.css',
  'css/reports.css',
  'js/expenses.js',
  'js/monthly-collection-trend.js',
  'js/payroll.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Finance web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Finance web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Finance web root (${webFiles.length} files)`);

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('finance')"));
assert(serverSource.includes("financeBackend.load('expenses')"));
assert(serverSource.includes("financeBackend.load('payroll')"));
assert(serverSource.includes('FINANCE_WEB_ROOT'));
assert(serverSource.includes("app.get('/api/dashboard/collection-breakdown', requireAuth"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'expenses.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'payroll.html')"));
console.log('PASS Finance server loader, page routing, and shared dashboard contract');

const sourceChecks = [
  ['Features/modules/finance/backend/expenses.js', '../../../../core/data/data-store'],
  ['Features/modules/finance/backend/expenses.js', '../../../../core/data/db-relational'],
  ['Features/modules/finance/backend/expenses.js', '../../../../core/security/role-utils'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/data/data-store'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/data/db'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/security/role-utils'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/config/storage-mode']
];
sourceChecks.forEach(([relativePath, expectedPath]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expectedPath), `${relativePath} must use canonical dependency ${expectedPath}`);
});
console.log('PASS canonical Core data, security, and configuration dependencies');

const routeContracts = (router) => router.stack
  .filter((layer) => layer.route)
  .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

assert.deepStrictEqual(routeContracts(backend.load('expenses')), [
  'GET /',
  'POST /',
  'PUT /:id',
  'DELETE /',
  'DELETE /:id'
]);
assert.deepStrictEqual(routeContracts(backend.load('payroll')), [
  'GET /',
  'POST /',
  'PUT /:id',
  'DELETE /:id'
]);

const reportsSource = fs.readFileSync(path.join(webRoot, 'reports.js'), 'utf8');
assert(reportsSource.includes("fetch('/api/payment-records'"));
assert(reportsSource.includes("fetch('/api/collectors'"));
const trendSource = fs.readFileSync(path.join(webRoot, 'js/monthly-collection-trend.js'), 'utf8');
assert(trendSource.includes("getElementById('monthlyTrendChart')"));
console.log('PASS expense, payroll, and reporting route/asset contracts');
console.log('FINANCE COMPATIBILITY PASSED');
