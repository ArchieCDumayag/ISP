#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { PUBLIC_ROOT, DATA_DIR } = require(path.join(projectRoot, 'core/runtime/paths'));
const { loadModuleRuntimes } = require(path.join(projectRoot, 'core/runtime/module-loader'));

const rootJavaScript = fs.readdirSync(projectRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name)
  .sort();
assert.deepStrictEqual(rootJavaScript, ['server.js']);
assert(!fs.existsSync(path.join(projectRoot, 'routes', 'collectors.js')));
assert(!fs.existsSync(path.join(projectRoot, 'styles.css')));
console.log('PASS repository root contains only shared server composition JavaScript');

const expectedModuleIds = [
  'admin',
  'billing',
  'collector',
  'customer-app',
  'customer-management',
  'finance',
  'network',
  'technician'
];
const runtimes = loadModuleRuntimes({ requireBackend: true, requireWeb: true, refresh: true });
assert.deepStrictEqual([...runtimes.keys()], expectedModuleIds);
runtimes.forEach((runtime) => {
  assert.strictEqual(typeof runtime.backend.load, 'function');
  assert(fs.statSync(runtime.webRoot).isDirectory());
  const ownedPaths = runtime.module.ownedPaths || [];
  assert.strictEqual(new Set(ownedPaths).size, ownedPaths.length, `${runtime.id} has duplicate ownedPaths`);
  ownedPaths.forEach((ownedPath) => {
    assert(
      ownedPath === `Features/modules/${runtime.id}/**`
        || (runtime.id === 'admin' && ['service-config.json', 'structure-manifest.json'].includes(ownedPath)),
      `${runtime.id} has obsolete ownership path: ${ownedPath}`
    );
  });
});
console.log('PASS eight complete manifest-driven module runtimes and canonical ownership maps');

[
  'api.js',
  'app.js',
  'index.html',
  'layout.js',
  'sidebar.html',
  'styles.css',
  'theme-init.js',
  'theme.js',
  'topbar.html',
  'vendor/tabler/css/tabler.min.css',
  'vendor/tabler/js/tabler.min.js'
].forEach((relativePath) => {
  assert(fs.existsSync(path.join(PUBLIC_ROOT, relativePath)), `Missing shared frontend file: public/${relativePath}`);
});
console.log('PASS shared frontend shell remains canonical under public/');

const tablerAppSource = fs.readFileSync(path.join(PUBLIC_ROOT, 'css', 'tabler-app.css'), 'utf8');
const sharedStylesSource = fs.readFileSync(path.join(PUBLIC_ROOT, 'styles.css'), 'utf8');
const webAppStylesSource = fs.readFileSync(
  path.join(projectRoot, 'web-app', 'src', 'styles', 'main.css'),
  'utf8'
);
const tablerSansFallback = '"Inter Var", Inter, -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
assert(tablerAppSource.includes(`--app-font-sans-serif: var(--tblr-font-sans-serif, ${tablerSansFallback})`));
assert(tablerAppSource.includes('body * {'));
assert(tablerAppSource.includes('font-family: var(--app-font-sans-serif) !important'));
assert(tablerAppSource.includes('font-family: var(--app-font-monospace) !important'));
assert(sharedStylesSource.includes(`font-family: var(--app-font-sans-serif, ${tablerSansFallback})`));
assert(webAppStylesSource.includes(`--app-font-sans-serif: var(--tblr-font-sans-serif, ${tablerSansFallback})`));
console.log('PASS shared and standalone web typography use the Tabler font stacks');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
[
  './core/config/env-loader',
  './core/runtime/module-loader',
  './core/runtime/paths',
  'const MODULE_RUNTIMES = loadModuleRuntimes({',
  '[...MODULE_RUNTIMES.values()]',
  'app.use(express.static(PUBLIC_ROOT, { index: false }))',
  'const PUBLIC_UPLOADS_DIR = path.join(PUBLIC_ROOT',
  'const LEGACY_UPLOADS_DIR = path.join(DATA_DIR'
].forEach((expected) => assert(serverSource.includes(expected), `server.js is missing ${expected}`));
assert(!serverSource.includes('__dirname'));
assert(!serverSource.includes('const rootPath ='));
assert(!serverSource.includes('return res.sendFile(rootPath)'));
console.log('PASS shared server composition uses canonical Core/module/static paths only');

const installerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/setup-installer.js'),
  'utf8'
);
assert(installerSource.includes("'Features/modules/admin/backend/setup-installer.js'"));
assert(installerSource.includes("'Features/modules/admin/web/update-download.html'"));
assert(!installerSource.includes("  'setup-installer.js',"));
console.log('PASS structure package contract requires canonical Admin installer paths');

const sourceChecks = [
  ['scripts/apply-flavor.js', '../core/config/flavor-features'],
  ['scripts/check-security-modules.js', '../core/runtime/module-loader'],
  ['scripts/migrate-json-to-relational.js', '../Features/modules/technician/backend/job-numbering'],
  ['scripts/migrate-json-to-relational.js', '../Features/modules/billing/backend/plan-profile-utils'],
  ['scripts/import-clients-from-cash-flow.js', '../Features/modules/customer-management/backend/customers'],
  ['Features/modules/admin/backend/auth.js', '../../billing/backend/payment-records'],
  ['Features/modules/customer-management/backend/customers.js', '../../billing/backend/payment-entry-normalizer']
];
sourceChecks.forEach(([relativePath, expected]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expected), `${relativePath} is missing canonical dependency ${expected}`);
});
assert.strictEqual(DATA_DIR, path.join(projectRoot, 'data'));
console.log('PASS operational scripts and cross-module dependencies use canonical paths');
console.log('INTEGRATION CLEANUP PASSED');
