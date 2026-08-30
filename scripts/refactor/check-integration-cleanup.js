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
  'technician',
  'temp'
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
console.log('PASS nine complete manifest-driven module runtimes and canonical ownership maps');

[
  'api.js',
  'app.js',
  'dashboard-v2.html',
  'dashboard-v2.js',
  'index.html',
  'layout.js',
  'sidebar.html',
  'styles.css',
  'theme-init.js',
  'theme.js',
  'topbar.html',
  'css/dashboard-v2.css',
  'vendor/tabler/css/tabler.min.css',
  'vendor/tabler/js/tabler.min.js'
].forEach((relativePath) => {
  assert(fs.existsSync(path.join(PUBLIC_ROOT, relativePath)), `Missing shared frontend file: public/${relativePath}`);
});
console.log('PASS shared frontend shell remains canonical under public/');

const dashboardV2Html = fs.readFileSync(path.join(PUBLIC_ROOT, 'dashboard-v2.html'), 'utf8');
const dashboardV2Js = fs.readFileSync(path.join(PUBLIC_ROOT, 'dashboard-v2.js'), 'utf8');
const dashboardV2Css = fs.readFileSync(path.join(PUBLIC_ROOT, 'css', 'dashboard-v2.css'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(PUBLIC_ROOT, 'sidebar.html'), 'utf8');
assert(dashboardV2Html.includes('<h1>Dashboard Version 2</h1>'));
assert(dashboardV2Html.includes('vendor/tabler/css/tabler.min.css'));
assert(dashboardV2Html.includes('id="dashboardV2CollectionChart"'));
assert(dashboardV2Html.includes('id="dashboardV2WorkQueue"'));
assert(dashboardV2Html.includes('id="dashboardV2RecentPayments"'));
assert(dashboardV2Js.includes("fetchJson('/api/payment-records')"));
assert(dashboardV2Js.includes("fetchJson('/api/jobs')"));
assert(dashboardV2Js.includes("fetchJson('/api/tickets?includeArchived=0')"));
assert(dashboardV2Css.includes('.dashboard-v2-primary-grid'));
assert(sidebarSource.includes('href="dashboard-v2.html"'));
console.log('PASS compact Tabler Dashboard V2 shell, canonical data sources, and navigation');

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

const tablerEnhanceSource = fs.readFileSync(path.join(PUBLIC_ROOT, 'js', 'tabler-enhance.js'), 'utf8');
[
  'const blockImplicitModalDismissal =',
  'const isInteractiveModalControl =',
  'if (isInteractiveModalControl(element)) return false',
  "document.addEventListener('keydown', blockImplicitModalDismissal, true)",
  "document.addEventListener('mousedown', blockImplicitModalDismissal, true)",
  "document.addEventListener('click', blockImplicitModalDismissal, true)",
  "modal.setAttribute('data-bs-backdrop', 'static')",
  "modal.setAttribute('data-bs-keyboard', 'false')",
  "modal.setAttribute('data-modal-dismiss-policy', 'explicit')"
].forEach((expected) => {
  assert(tablerEnhanceSource.includes(expected), `Shared modal policy is missing ${expected}`);
});
assert(tablerEnhanceSource.includes("'button, a, input, select, textarea, label, [role=\"button\"]'"));
console.log('PASS shared modals require an explicit close, cancel, or completed action');

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
assert(serverSource.includes("'dashboard-v2.html'"));
assert(!serverSource.includes('__dirname'));
assert(!serverSource.includes('const rootPath ='));
assert(!serverSource.includes('return res.sendFile(rootPath)'));
console.log('PASS shared server composition uses canonical Core/module/static paths only');

assert(serverSource.includes('if (isServerError) {'));
assert(serverSource.includes('console.error(err?.stack || err);'));
assert(!serverSource.includes('console.error(err.stack);'));
console.log('PASS expected HTTP client errors do not emit server stack traces');

const installerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/setup-installer.js'),
  'utf8'
);
assert(installerSource.includes("'Features/modules/admin/backend/setup-installer.js'"));
assert(installerSource.includes("'Features/modules/admin/web/update-download.html'"));
assert(!installerSource.includes("  'setup-installer.js',"));
console.log('PASS structure package contract requires canonical Admin installer paths');

const sourceChecks = [
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
[
  'core/config/flavor-features.js',
  'scripts/apply-flavor.js',
  'scripts/check-flavors.js',
  'scripts/create-flavor.js',
  'scripts/flavor-tools.js',
  'scripts/generate-flavor-launcher.js',
  'scripts/start-flavor.js'
].forEach((relativePath) => {
  assert(!fs.existsSync(path.join(projectRoot, relativePath)), `${relativePath} must remain retired`);
});
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
assert(!Object.keys(packageJson.scripts || {}).some((name) => name.startsWith('flavor:')));
assert(!serverSource.includes('requireFeature('));
assert(!serverSource.includes('/api/flavor'));
assert.strictEqual(DATA_DIR, path.join(projectRoot, 'data'));
console.log('PASS operational scripts and cross-module dependencies use canonical paths');
console.log('INTEGRATION CLEANUP PASSED');
