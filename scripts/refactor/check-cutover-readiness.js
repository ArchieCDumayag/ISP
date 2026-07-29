'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
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
const phaseDocuments = [
  'phase-01-baseline.md',
  'phase-02-core-architecture.md',
  'phase-03-admin.md',
  'phase-04-customer-management.md',
  'phase-05-billing.md',
  'phase-06-network.md',
  'phase-07-collector.md',
  'phase-08-technician.md',
  'phase-09-finance.md',
  'phase-10-customer-app.md',
  'phase-11-integration-cleanup.md',
  'phase-12-cutover-readiness.md'
];

function projectPath(...segments) {
  return path.join(projectRoot, ...segments);
}

function read(relativePath) {
  return fs.readFileSync(projectPath(relativePath), 'utf8');
}

function pass(label) {
  process.stdout.write(`PASS ${label}\n`);
}

function assertFile(relativePath) {
  assert(fs.statSync(projectPath(relativePath)).isFile(), `Missing file: ${relativePath}`);
}

function assertDirectory(relativePath) {
  assert(fs.statSync(projectPath(relativePath)).isDirectory(), `Missing directory: ${relativePath}`);
}

const packageJson = JSON.parse(read('package.json'));
assert.strictEqual(packageJson.private, true, 'The application package must remain private');
assert.strictEqual(packageJson.main, 'server.js', 'package.json main must identify the runtime entry');
assert.strictEqual(packageJson.scripts.test, 'npm run refactor:phase12', 'npm test must run the final gate');
assert.strictEqual(
  packageJson.scripts['refactor:phase12'],
  'npm run refactor:phase11 && npm run refactor:cutover',
  'Phase 12 must retain the full Phase 11 regression before the cutover checks'
);
assertFile('server.js');
pass('package metadata and final test entry');

const rootJavaScript = fs.readdirSync(projectRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name)
  .sort();
assert.deepStrictEqual(rootJavaScript, ['server.js'], 'server.js must be the only root JavaScript file');
pass('canonical root runtime boundary');

const registryFile = projectPath('core', 'runtime', 'module-registry.js');
const registry = require(registryFile);
const modules = registry.listModules({ refresh: true });
assert.deepStrictEqual(modules.map((module) => module.id), expectedModuleIds, 'Unexpected module registry');

modules.forEach((module) => {
  const relativeRoot = path.relative(projectRoot, module.moduleRoot).split(path.sep).join('/');
  assert.strictEqual(relativeRoot, `Features/modules/${module.id}`, `Unexpected module root for ${module.id}`);
  assert.strictEqual(module.runtime.backend, 'backend/index.js', `Missing backend runtime for ${module.id}`);
  assert.strictEqual(module.runtime.web, 'web', `Missing web runtime for ${module.id}`);
  assert(Array.isArray(module.ownedPaths) && module.ownedPaths.length > 0, `Missing ownedPaths for ${module.id}`);
  assertFile(`${relativeRoot}/README.md`);
  assertFile(`${relativeRoot}/module.json`);
  assertFile(`${relativeRoot}/Module_context.md`);
  assertFile(`${relativeRoot}/backend/index.js`);
  assertDirectory(`${relativeRoot}/web`);
  assert(
    read(`${relativeRoot}/Module_context.md`).includes('npm run refactor:phase12'),
    `Final cross-module gate is missing from ${module.id} context`
  );
});
pass('eight canonical module ownership and runtime boundaries');

phaseDocuments.forEach((document) => assertFile(`docs/refactor/${document}`));
const phaseLedger = read('docs/refactor/PHASES.md');
for (let phase = 1; phase <= 12; phase += 1) {
  const phaseRow = phaseLedger.split('\n').find((line) => line.startsWith(`| ${phase} |`));
  assert(phaseRow && phaseRow.endsWith('| Complete |'), `Phase ${phase} is not complete in the ledger`);
}
assert(phaseLedger.includes('Refactor status: **Complete.**'), 'The phase ledger must declare completion');
assert(!read('start_codex.md').includes('legacy source paths'), 'Startup guide still references legacy sources');
pass('phase ledger, records, and multi-Codex startup guidance');

const gitignore = read('.gitignore');
const gitignoreEntries = gitignore.split(/\r?\n/);
['.env', 'data/', '.ai_coord/'].forEach((entry) => {
  assert(gitignoreEntries.includes(entry), `.gitignore must exclude ${entry}`);
});
const installer = read('scripts/install-ubuntu.sh');
assert(installer.includes('${APP_DIR}/server.js'), 'Installer must validate the canonical server entry');
assert(installer.includes('npm --prefix'), 'Installer must install against the application directory');
assert(installer.includes('NODE_ENV=production'), 'Installer must configure production mode');
pass('secret/runtime exclusions and installer canonical entry');

const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const npmArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npm', 'pack', '--dry-run', '--json', '--ignore-scripts']
  : ['pack', '--dry-run', '--json', '--ignore-scripts'];
const packOutput = childProcess.execFileSync(
  npmCommand,
  npmArgs,
  { cwd: projectRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
);
const packResult = JSON.parse(packOutput);
assert(Array.isArray(packResult) && packResult.length === 1, 'Unexpected npm pack result');
const packedFiles = packResult[0].files.map((file) => file.path);
[
  'server.js',
  'core/runtime/module-loader.js',
  'public/index.html',
  'docs/refactor/phase-12-cutover-readiness.md',
  ...expectedModuleIds.flatMap((moduleId) => [
    `Features/modules/${moduleId}/module.json`,
    `Features/modules/${moduleId}/backend/index.js`
  ])
].forEach((relativePath) => {
  assert(packedFiles.includes(relativePath), `npm package is missing ${relativePath}`);
});
expectedModuleIds.forEach((moduleId) => {
  assert(
    packedFiles.some((relativePath) => relativePath.startsWith(`Features/modules/${moduleId}/web/`)),
    `npm package is missing the ${moduleId} web runtime`
  );
});
const excludedPackPrefixes = ['data/', '.ai_coord/', 'node_modules/', 'logs/', 'backups/', 'releases/apply-backups/'];
packedFiles.forEach((relativePath) => {
  assert(relativePath !== '.env' && !relativePath.startsWith('.env.'), `Secret environment file packed: ${relativePath}`);
  assert(
    !excludedPackPrefixes.some((prefix) => relativePath.startsWith(prefix)),
    `Runtime-only path packed: ${relativePath}`
  );
});
pass(`npm package contains canonical runtime and excludes runtime state (${packedFiles.length} files)`);

process.stdout.write('CUTOVER READINESS CHECK PASSED\n');
