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
  ['accounts-store.js', 'accounts-store'],
  ['accounts.js', 'accounts'],
  ['activity-log-visibility.js', 'activity-log-visibility'],
  ['activity-log.js', 'activity-log'],
  ['app-downloads-store.js', 'app-downloads-store'],
  ['app-downloads.js', 'app-downloads'],
  ['auth.js', 'auth'],
  ['business-profile.js', 'business-profile'],
  ['info-api.js', 'info-api'],
  ['integration-settings.js', 'integration-settings'],
  ['setup-installer.js', 'setup-installer']
];

const backend = loadModuleBackend('admin', { required: true, fresh: true });
assert.strictEqual(backend.id, 'admin');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(
    projectRoot,
    'Features/modules/admin/backend',
    canonicalName
  );
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Admin backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Admin root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('admin', { required: true });
const webFiles = [
  'accounts.html',
  'accounts.js',
  'css/accounts.css',
  'css/login.css',
  'flavors.html',
  'install-guide.html',
  'js/install-guide.js',
  'login.html',
  'setup.html',
  'update-download.html'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Admin web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Admin web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Admin web root (${webFiles.length} files)`);

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('admin')"));
assert(serverSource.includes('const MODULE_WEB_ROOTS = Object.freeze('));
assert(serverSource.includes('MODULE_WEB_ROOTS.forEach((webRoot) => {'));
assert(serverSource.includes('.map((webRoot) => path.join(webRoot, filename))'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'login.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'update-download.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'flavors.html')"));
console.log('PASS Admin server loader and web routing');

const installerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/setup-installer.js'),
  'utf8'
);
assert(installerSource.includes("const rootDir = PROJECT_ROOT;"));
assert(!installerSource.includes("  'setup-installer.js',"));
assert(installerSource.includes("'Features/modules/admin/backend/setup-installer.js'"));
assert(installerSource.includes("'Features/modules/admin/web/update-download.html'"));
console.log('PASS Admin installer root and package paths');
console.log('ADMIN COMPATIBILITY PASSED');
