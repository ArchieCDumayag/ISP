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
  ['api_coverage.js', 'api_coverage'],
  ['customer-archive-store.js', 'customer-archive-store'],
  ['customer-draft-submissions-store.js', 'customer-draft-submissions-store'],
  ['customer-draft-submissions.js', 'customer-draft-submissions'],
  ['customers.js', 'customers'],
  ['philippines-addresses.js', 'philippines-addresses'],
  ['referral-engine.js', 'referral-engine'],
  ['referrals.js', 'referrals']
];

const backend = loadModuleBackend('customer-management', { required: true, fresh: true });
assert.strictEqual(backend.id, 'customer-management');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(
    projectRoot,
    'Features/modules/customer-management/backend',
    canonicalName
  );
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Customer Management backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Customer Management root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('customer-management', { required: true });
const webFiles = [
  'apply-now.html',
  'coverage.css',
  'coverage.html',
  'coverage.js',
  'customer-archive.html',
  'customer-draft-queue.html',
  'customers.css',
  'customers.html',
  'referrals.html',
  'css/coverage-tabler.css',
  'css/customer-archive.css',
  'css/customer-draft-queue.css',
  'css/customers.css',
  'css/referrals.css',
  'js/apply-now.js',
  'js/customer-archive.js',
  'js/customer-draft-queue.js',
  'js/referrals.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Customer Management web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Customer Management web asset must be removed: public/${relativePath}`
  );
});
assert(!fs.existsSync(path.join(projectRoot, 'customers.css')));
console.log(`PASS Customer Management web root (${webFiles.length} files)`);

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('customer-management')"));
assert(serverSource.includes("customerManagementBackend.load('customers')"));
assert(serverSource.includes("customerManagementBackend.load('customerDraftSubmissions')"));
assert(serverSource.includes('CUSTOMER_MANAGEMENT_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-draft-queue.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-archive.html')"));
console.log('PASS Customer Management server loader and web routing');

const customerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/customer-management/backend/customers.js'),
  'utf8'
);
assert(customerSource.includes('path.join(PUBLIC_ROOT, ...relativePath)'));
assert(customerSource.includes("path.join(PROJECT_ROOT, '.cloudflared', 'config.yml')"));
assert(customerSource.includes(['require', "('../../admin/backend/auth')"].join('')));
const addressSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/customer-management/backend/philippines-addresses.js'),
  'utf8'
);
assert(addressSource.includes("path.join(PROJECT_ROOT, 'node_modules', '@jobuntux', 'psgc', 'data')"));

const addresses = backend.load('philippinesAddresses');
assert(String(addresses.dataVersion || '').trim(), 'Philippine address dataset version is missing');
assert(addresses.listProvinces().length > 0, 'Philippine province dataset is empty');
console.log('PASS repository-root uploads, tunnel config, and Philippine dataset paths');

const webAppSource = fs.readFileSync(path.join(projectRoot, 'web-app/src/index.html'), 'utf8');
assert(webAppSource.includes('../../Features/modules/customer-management/web/css/customers.css'));
console.log('PASS web-app canonical Customer stylesheet reference');
console.log('CUSTOMER MANAGEMENT COMPATIBILITY PASSED');
