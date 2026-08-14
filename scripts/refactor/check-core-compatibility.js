#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

const retiredCompatibilityPaths = [
  ['env-loader.js', 'core/config/env-loader.js'],
  ['storage-mode.js', 'core/config/storage-mode.js'],
  ['data-store.js', 'core/data/data-store.js'],
  ['db.js', 'core/data/db.js'],
  ['db-relational.js', 'core/data/db-relational.js'],
  ['db-secrets.js', 'core/data/db-secrets.js'],
  ['passwords.js', 'core/security/passwords.js'],
  ['rate-limiter.js', 'core/security/rate-limiter.js'],
  ['role-utils.js', 'core/security/role-utils.js'],
  ['session-cache.js', 'core/security/session-cache.js']
];

retiredCompatibilityPaths.forEach(([legacyPath, canonicalPath]) => {
  assert(!fs.existsSync(path.join(projectRoot, legacyPath)), `Obsolete Core root entry remains: ${legacyPath}`);
  assert(fs.existsSync(path.join(projectRoot, canonicalPath)), `Missing canonical Core module: ${canonicalPath}`);
  require(path.join(projectRoot, canonicalPath));
  console.log(`PASS retired Core root entry ${legacyPath}`);
});

const storageMode = require(path.join(projectRoot, 'core/config/storage-mode'));
assert.strictEqual(storageMode.normalizeStorageDriver(), 'json');
assert.strictEqual(storageMode.normalizeStorageDriver(''), 'json');
assert.strictEqual(storageMode.normalizeStorageDriver('local-json'), 'json');
assert.strictEqual(storageMode.normalizeStorageDriver('MYSQL'), 'mysql');
assert.throws(() => storageMode.normalizeStorageDriver('unsupported'), /Unsupported storage driver/);
console.log('PASS JSON default and explicit MySQL storage selection');

const core = require(path.join(projectRoot, 'core'));
assert.strictEqual(core.paths.PROJECT_ROOT, projectRoot);
assert.strictEqual(core.paths.DATA_DIR, path.join(projectRoot, 'data'));
assert.strictEqual(core.paths.ENV_FILE, path.join(projectRoot, '.env'));
assert.throws(() => core.paths.resolveProjectPath('..', 'outside'), /escapes project root/);
console.log('PASS canonical project paths');

const modules = core.moduleRegistry.listModules({ refresh: true });
const expectedIds = [
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
assert.deepStrictEqual(modules.map((module) => module.id), expectedIds);
modules.forEach((module) => {
  assert(fs.existsSync(module.manifestPath), `Missing manifest for ${module.id}`);
  assert(
    fs.existsSync(path.join(projectRoot, module.contextFile)),
    `Missing context for ${module.id}`
  );
  const hasBackend = Boolean(module.runtime?.backend);
  const hasWeb = Boolean(module.runtime?.web);
  assert.strictEqual(
    Boolean(core.moduleLoader.loadModuleBackend(module.id)),
    hasBackend,
    `${module.id} backend loader state must match its manifest`
  );
  assert.strictEqual(
    Boolean(core.moduleLoader.getModuleWebRoot(module.id)),
    hasWeb,
    `${module.id} web loader state must match its manifest`
  );
});
assert.throws(
  () => core.moduleRegistry.resolveModulePath('billing', '..', 'admin'),
  /escapes module billing/
);
assert.throws(() => core.moduleRegistry.getModule('not-a-module'), /Unknown module/);
console.log(`PASS module registry (${modules.length} modules)`);
console.log('PASS manifest-driven module loader');
const runtimes = core.moduleLoader.loadModuleRuntimes({
  requireBackend: true,
  requireWeb: true
});
assert.deepStrictEqual([...runtimes.keys()], expectedIds);
runtimes.forEach((runtime, moduleId) => {
  assert.strictEqual(runtime.id, moduleId);
  assert.strictEqual(typeof runtime.backend.load, 'function');
  assert(fs.statSync(runtime.webRoot).isDirectory());
});
console.log('PASS complete manifest-driven runtime composition');
console.log('CORE INTEGRATION PASSED');
