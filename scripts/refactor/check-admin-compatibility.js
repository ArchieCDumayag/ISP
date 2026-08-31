#!/usr/bin/env node

const assert = require('assert');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));
const { resetPool } = require(path.join(projectRoot, 'core/data/db'));

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
  ['collector-app-updates.js', 'collector-app-updates'],
  ['auth.js', 'auth'],
  ['business-profile.js', 'business-profile'],
  ['factory-reset.js', 'factory-reset'],
  ['info-api.js', 'info-api'],
  ['integration-settings.js', 'integration-settings'],
  ['setup-installer.js', 'setup-installer'],
  ['system-backup-service.js', 'system-backup-service'],
  ['system-backup.js', 'system-backup'],
  ['system-update-local-changes.js', 'system-update-local-changes']
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

const integrationSettings = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/integration-settings'
));
const ipBrowserFixture = {
  ipBrowser: {
    autoLoginEnabled: true,
    username: 'fallback-admin',
    password: 'fallback-secret',
    profiles: [
      {
        id: 'north-range',
        label: 'North range',
        matches: ['10.20.0.0/16'],
        username: 'north-admin',
        password: 'north-secret'
      },
      {
        id: 'wildcard-range',
        label: 'Wildcard range',
        matches: ['192.168.50.*'],
        username: 'wild-admin',
        password: 'wild-secret'
      },
      {
        id: 'exact-router',
        label: 'Exact router',
        matches: ['10.20.30.40:8080'],
        username: 'exact-admin',
        password: 'exact-secret'
      }
    ]
  }
};
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, 'http://10.20.30.40:8080/')?.id,
  'exact-router',
  'Exact IP:port profile must outrank a matching CIDR profile'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, '10.20.99.8')?.id,
  'north-range',
  'CIDR profile must match an assigned IP in its subnet'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, 'http://192.168.50.77/')?.id,
  'wildcard-range',
  'Wildcard profile must match an assigned IP'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, '192.168.60.77'),
  null,
  'Unmatched IPs must retain the legacy default credential fallback'
);
const sanitizedIpBrowser = integrationSettings.sanitizeIntegrationSettingsForClient(ipBrowserFixture).ipBrowser;
assert.strictEqual(sanitizedIpBrowser.password, '', 'Default IP Browser password must be redacted');
assert.strictEqual(sanitizedIpBrowser.passwordSet, true, 'Default password presence must be reported without disclosure');
assert.strictEqual(sanitizedIpBrowser.profiles[0].username, '', 'Profile username must be redacted');
assert.strictEqual(sanitizedIpBrowser.profiles[0].usernameSet, true, 'Profile username presence must be reported');
assert.strictEqual(sanitizedIpBrowser.profiles[0].password, '', 'Profile password must be redacted');
assert.strictEqual(sanitizedIpBrowser.profiles[0].passwordSet, true, 'Profile password presence must be reported');
const preservedIpBrowserProfiles = integrationSettings.preserveIpBrowserProfileSecrets(
  [{ id: 'north-range', label: 'Renamed', matches: ['10.20.0.0/16'], username: '', password: '' }],
  ipBrowserFixture.ipBrowser.profiles
);
assert.strictEqual(preservedIpBrowserProfiles[0].username, 'north-admin', 'Blank profile username update must retain saved value');
assert.strictEqual(preservedIpBrowserProfiles[0].password, 'north-secret', 'Blank profile password update must retain saved value');
console.log('PASS IP Browser router profile matching and secret redaction');

const webRoot = getModuleWebRoot('admin', { required: true });
const webFiles = [
  'accounts.html',
  'accounts.js',
  'collector-app-update.html',
  'collector-app-update.js',
  'css/accounts.css',
  'css/factory-reset.css',
  'css/login.css',
  'install-guide.html',
  'js/factory-reset.js',
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

const collectorUpdateModule = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/collector-app-updates'
));
const collectorUpdateHtml = fs.readFileSync(path.join(webRoot, 'collector-app-update.html'), 'utf8');
const collectorUpdateJs = fs.readFileSync(path.join(webRoot, 'collector-app-update.js'), 'utf8');
assert.strictEqual(collectorUpdateModule.PACKAGE_NAME, 'com.example.myapplication');
assert.strictEqual(collectorUpdateModule.MAX_APK_BYTES, 80 * 1024 * 1024);
assert.strictEqual(typeof collectorUpdateModule.publicRouter, 'function');
assert.strictEqual(typeof collectorUpdateModule.adminRouter, 'function');
assert(collectorUpdateHtml.includes('id="collectorUpdateForm"'));
assert(collectorUpdateHtml.includes('accept=".apk,application/vnd.android.package-archive"'));
assert(collectorUpdateJs.includes("fetch('/api/collector-app-updates'"));
assert(collectorUpdateJs.includes("fetch(`/api/collector-app-updates/publish?${query.toString()}`"));
assert(collectorUpdateJs.includes('window.appConfirm'));
console.log('PASS Collector Android OTA manifest, guarded Admin publishing, and upload page contract');

const accountsHtml = fs.readFileSync(path.join(webRoot, 'accounts.html'), 'utf8');
const accountsJs = fs.readFileSync(path.join(webRoot, 'accounts.js'), 'utf8');
const systemUpdateServerSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(accountsHtml.includes('id="ip-browser-profile-body"'));
assert(accountsHtml.includes('id="ipBrowserProfileModal"'));
assert(accountsHtml.includes('Gateway / assigned IP matches'));
assert(accountsHtml.includes('id="settings-tab-gcash"'));
assert(accountsHtml.includes('data-settings-tab-target="gcash"'));
assert(accountsHtml.includes('id="gcash" class="settings-panel tab-pane fade"'));
assert(!accountsHtml.includes('id="gcash" class="settings-panel settings-panel--hidden-in-tabs"'));
assert(accountsJs.includes('const normalizeIpBrowserMatchList = (value) => {'));
assert(accountsJs.includes('profiles: ipBrowserProfiles.map((profile) => ({'));
assert(accountsJs.includes("button.dataset.ipBrowserProfileAction === 'remove'"));
console.log('PASS IP Browser profile editor and visible GCash settings tab structure');

assert(accountsHtml.includes('id="system-update-warning" role="status" aria-live="polite"'));
assert(accountsHtml.includes('accounts.js?v=4.1'));
assert(accountsJs.includes('const confirmed = window.confirm('));
assert(accountsJs.includes("fetch('/api/system-update/run'"));
assert(accountsJs.includes('expectedRemoteHash'));
assert(systemUpdateServerSource.includes("app.get('/api/system-update/run'"));
assert(systemUpdateServerSource.includes('req.body?.confirmed !== true'));
assert(systemUpdateServerSource.includes('systemUpdateApplyRequestActive || systemUpdateRunState.running'));
assert(systemUpdateServerSource.includes("['merge-base', '--is-ancestor', originalHead, fetchedRemoteHash]"));
assert(systemUpdateServerSource.includes("['update-ref', backupRef, safeHead]"));
assert(systemUpdateServerSource.includes("['reset', '--hard', originalHead]"));
assert(systemUpdateServerSource.includes("['install', '--omit=dev', '--no-package-lock']"));
assert(systemUpdateServerSource.includes("app.use('/collector-updates', collectorAppUpdates.publicRouter)"));
assert(systemUpdateServerSource.includes("'/api/collector-app-updates'"));
assert(systemUpdateServerSource.includes('collectorAppUpdateLimiter'));
assert(systemUpdateServerSource.includes('application/vnd.android.package-archive'));
console.log('PASS Admin system update confirmation, progress, fast-forward, recovery, and rollback safeguards');
assert(accountsHtml.includes('id="system-update-check"'));
assert(accountsJs.includes('systemUpdateCheckBtn.disabled = isRunning || !isEnabled || unableToVerify || hasDiverged || !hasUpdate;'));
assert(accountsJs.includes('the updater will preserve, compatibility-check, and restore them automatically.'));
console.log('PASS System Update action remains available with preservable local changes');

const factoryReset = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/factory-reset'
));
assert.strictEqual(factoryReset.CONFIRMATION_PHRASE, 'CLEAR ALL DATA');
assert.strictEqual(factoryReset.shouldResetStoreKey('customers'), true);
assert.strictEqual(factoryReset.shouldResetStoreKey('referral_registry'), true);
assert.strictEqual(factoryReset.shouldResetStoreKey('gcash_transaction_history'), true);
assert.strictEqual(factoryReset.shouldResetStoreKey('finance_expenses_branch_1'), true);
assert.strictEqual(factoryReset.shouldResetStoreKey('integrations'), false);
assert(accountsHtml.includes('id="settings-tab-data-reset"'));
assert(accountsHtml.includes('id="factory-reset-password"'));
assert(accountsHtml.includes('id="factory-reset-confirmation"'));
assert(accountsHtml.includes('id="factory-reset-acknowledge"'));
assert(accountsHtml.includes('id="factory-reset-submit"'));
assert(accountsHtml.includes('js/factory-reset.js?v=1.0'));

const memoryStores = {
  accounts: [
    { id: '1', username: 'owner', role: 'Admin', password: 'hashed-owner' },
    { id: '2', username: 'collector', role: 'Collector', password: 'hashed-collector' }
  ],
  customers: [{ accountNumber: '1001' }, { accountNumber: '1002' }],
  payments: { branch1: [{ id: 'p1' }, { id: 'p2' }] },
  plans: [{ id: 'plan-1' }],
  messenger_reminders: {
    version: 1,
    branches: { 1: { preferences: { 1001: {} }, reminders: { r1: {}, r2: {} } } }
  },
  referral_registry: {
    version: 1,
    branches: { 1: { records: [{ id: 'referral-1' }] } }
  },
  gcash_transaction_history: {
    version: 1,
    branches: { 1: { batches: [{ id: 'batch-1' }], transactions: [{ reference: '1234567890123' }] } }
  },
  finance_expenses_branch_1: [{ id: 'expense-1' }],
  sessions: {
    sessions: {
      adminSession: { userId: '1', createdAt: Date.now() },
      collectorSession: { userId: '2', createdAt: Date.now() }
    }
  },
  integrations: { xendit: { enabled: true } }
};
const factoryResetService = factoryReset.createFactoryResetService({
  readJson: async (key, fallback) => Object.prototype.hasOwnProperty.call(memoryStores, key)
    ? JSON.parse(JSON.stringify(memoryStores[key]))
    : fallback,
  writeJson: async (key, value) => {
    memoryStores[key] = JSON.parse(JSON.stringify(value));
  },
  loadAccounts: async () => JSON.parse(JSON.stringify(memoryStores.accounts)),
  saveAccounts: async (accounts) => {
    memoryStores.accounts = JSON.parse(JSON.stringify(accounts));
    return accounts;
  },
  isRelationalReady: async () => false,
  getStorageDriver: () => 'json',
  listJsonStoreKeys: async () => Object.keys(memoryStores),
  previewFiles: async () => [{ key: 'files:test', label: 'Test files', count: 3, bytes: 30 }],
  clearFiles: async () => ({ cleared: [{ label: 'Test files', count: 3 }], warnings: [] })
});

async function verifyFactoryResetContract() {
  const preview = await factoryResetService.preview();
  assert.strictEqual(preview.storageDriver, 'json');
  assert.strictEqual(preview.fileCount, 3);
  assert(preview.recordCount >= 10, 'Factory reset preview must count operational records and non-Admin users');
  const result = await factoryResetService.reset({ id: '1', username: 'owner', role: 'Admin' });
  assert.strictEqual(memoryStores.accounts.length, 1, 'Factory reset must remove non-Admin accounts');
  assert.strictEqual(memoryStores.accounts[0].role, 'Admin', 'Factory reset must preserve Admin access');
  assert.deepStrictEqual(memoryStores.customers, [], 'Factory reset must clear customers');
  assert.deepStrictEqual(memoryStores.payments, {}, 'Factory reset must clear payments');
  assert.deepStrictEqual(memoryStores.referral_registry, { version: 1, branches: {} }, 'Factory reset must clear referrals');
  assert.deepStrictEqual(memoryStores.gcash_transaction_history, { version: 1, branches: {} }, 'Factory reset must clear imported GCash history');
  assert.deepStrictEqual(memoryStores.finance_expenses_branch_1, [], 'Factory reset must clear dynamic Finance stores');
  assert.deepStrictEqual(memoryStores.integrations, { xendit: { enabled: true } }, 'Factory reset must preserve integrations');
  assert.deepStrictEqual(Object.keys(memoryStores.sessions.sessions), ['adminSession'], 'Factory reset must retain only Admin sessions');
  assert.strictEqual(result.filesCleared, 3);
  assert(memoryStores.factory_reset_audit?.lastReset?.resetAt, 'Factory reset must persist a non-secret audit marker');
  console.log('PASS Admin factory reset safeguards and JSON reset contract');
}

const systemBackupModule = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/system-backup-service'
));
const jsonToMysqlRestoreModule = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/json-to-mysql-restore'
));
assert.strictEqual(systemBackupModule.BACKUP_KIND, 'isp-full-system-backup');
assert.strictEqual(systemBackupModule.BACKUP_SCHEMA_VERSION, 1);
assert.strictEqual(systemBackupModule.RESTORE_CONFIRMATION_PHRASE, 'RESTORE ALL DATA');
assert.strictEqual(systemBackupModule.isSensitiveJsonFile('master-key.json'), true);
assert.strictEqual(systemBackupModule.isSensitiveJsonFile('firebase-service-account.json'), true);
assert.strictEqual(systemBackupModule.isSensitiveJsonFile('payments.json'), false);
assert.throws(() => systemBackupModule.assertSafeRelativePath('../outside.jpg'));
const maintenanceState = require(path.join(projectRoot, 'core/runtime/maintenance-state'));
const maintenanceToken = maintenanceState.beginMaintenance('backup compatibility test');
assert.strictEqual(maintenanceState.getMaintenance()?.kind, 'backup compatibility test');
assert.throws(() => maintenanceState.assertDataWritesAllowed(), /temporarily paused/);
assert.strictEqual(maintenanceState.endMaintenance(maintenanceToken), true);
maintenanceState.assertDataWritesAllowed();

async function verifyJsonToMysqlConversionContract() {
  const stores = new Map([
    ['accounts.json', [
      { id: '1', username: 'owner', role: 'Admin', password: 'owner-password', branchId: 1 },
      { id: '2', username: 'collector', role: 'Collector', password: 'collector-password', branchId: 1 }
    ]],
    ['customers.json', [{
      accountNumber: '100000001',
      branchId: 1,
      name: 'Converted Customer',
      planId: 'plan-800',
      planName: 'Plan 800',
      planAmount: 800,
      loginPassword: 'customer-password'
    }]],
    ['plans.json', [{ id: 'plan-800', name: 'Plan 800', price: 800 }]],
    ['collectors.json', { assignments: { Poblacion: ['2'] } }],
    ['payments.json', {
      100000001: {
        history: [{
          id: 'payment-1',
          amount: 800,
          date: '2026-08-24',
          kind: 'payment',
          direction: 'credit',
          reference: 'GCASH-1001'
        }]
      }
    }],
    ['pon-state.json', {
      branches: {
        1: {
          olts: [{ id: 'olt-1', name: 'OLT 1', technology: 'epon', ponPorts: 16 }],
          naps: [{
            id: 'nap-1',
            code: 'NAP-1',
            linkedOlt: 'OLT 1',
            ponRef: 'PON-1',
            splitter: '1:16',
            capacity: 16,
            connections: [{ port: 1, customerId: '100000001', customerName: 'Converted Customer' }]
          }]
        }
      }
    }]
  ]);
  const plan = jsonToMysqlRestoreModule.buildJsonToMysqlPlan(stores);
  assert.strictEqual(plan.sourceStorageDriver, 'json');
  assert.strictEqual(plan.targetStorageDriver, 'mysql');
  assert.strictEqual(plan.users.length, 2);
  assert.strictEqual(plan.customers.length, 1);
  assert.strictEqual(plan.plans.length, 1);
  assert.strictEqual(plan.payments.length, 1);
  assert.strictEqual(plan.collectorAssignments.length, 1);
  assert.strictEqual(plan.ponOlts.length, 1);
  assert.strictEqual(plan.ponNaps.length, 1);
  assert.strictEqual(plan.ponNaps[0].connections.length, 1);
  assert.strictEqual(plan.appStoreRows.length, stores.size, 'Every JSON store must remain preserved in app_store');
  assert.strictEqual(new Set(plan.payments.map((entry) => entry.id)).size, plan.payments.length);
  const requiredColumns = jsonToMysqlRestoreModule.getRequiredTableColumns(plan);
  assert(requiredColumns.app_store.includes('payload'));
  assert(requiredColumns.payment_entries.includes('fingerprint'));

  const queries = [];
  const connection = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      return [[], []];
    }
  };
  const minimalPlan = {
    ...plan,
    collectorAssignments: [],
    ponOlts: [],
    ponNaps: [],
    activityLogs: [],
    businessProfiles: [],
    integrationSettings: [],
    tickets: [],
    jobs: []
  };
  const applied = await jsonToMysqlRestoreModule.applyJsonToMysqlPlan(connection, minimalPlan);
  assert.strictEqual(applied.sourceStorageDriver, 'json');
  assert.strictEqual(applied.targetStorageDriver, 'mysql');
  assert(queries.some((entry) => entry.sql.includes('INSERT INTO `payment_entries`')));
  assert(queries.some((entry) => entry.sql.includes('INSERT INTO `app_store`')));
  assert(!queries.some((entry) => entry.sql.includes('INSERT INTO `sessions`')));
  console.log('PASS Admin JSON-to-MySQL full-backup conversion contract');
}

const execGit = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
      return;
    }
    resolve(String(stdout || '').trim());
  });
});

async function createSystemUpdateFixture(rootPath, { conflicting = false } = {}) {
  fs.mkdirSync(rootPath, { recursive: true });
  await execGit(rootPath, ['init', '--initial-branch=main']);
  await execGit(rootPath, ['config', 'user.email', 'system-update-test@example.invalid']);
  await execGit(rootPath, ['config', 'user.name', 'System Update Test']);
  fs.writeFileSync(path.join(rootPath, 'app.txt'), 'base\n');
  await execGit(rootPath, ['add', 'app.txt']);
  await execGit(rootPath, ['commit', '-m', 'base']);
  const baseCommit = await execGit(rootPath, ['rev-parse', 'HEAD']);
  await execGit(rootPath, ['checkout', '-b', 'incoming-update']);
  if (conflicting) {
    fs.writeFileSync(path.join(rootPath, 'app.txt'), 'incoming\n');
  } else {
    fs.writeFileSync(path.join(rootPath, 'release.txt'), 'incoming\n');
  }
  await execGit(rootPath, ['add', '.']);
  await execGit(rootPath, ['commit', '-m', 'incoming update']);
  const updateCommit = await execGit(rootPath, ['rev-parse', 'HEAD']);
  await execGit(rootPath, ['checkout', 'main']);
  fs.writeFileSync(path.join(rootPath, 'app.txt'), 'local hotfix\n');
  if (!conflicting) {
    fs.writeFileSync(path.join(rootPath, 'local-note.txt'), 'untracked local file\n');
  }
  return { baseCommit, updateCommit };
}

async function verifySystemUpdateLocalChangesContract() {
  const systemUpdateModule = require(path.join(
    projectRoot,
    'Features/modules/admin/backend/system-update-local-changes'
  ));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-update-contract-'));
  const readFixtureText = (rootPath, fileName) => fs
    .readFileSync(path.join(rootPath, fileName), 'utf8')
    .replace(/\r\n/g, '\n');
  try {
    const compatibleRoot = path.join(tempRoot, 'compatible');
    const compatible = await createSystemUpdateFixture(compatibleRoot);
    const compatibleManager = systemUpdateModule.createSystemUpdateLocalChangesManager({
      runGitStep: (_label, args) => execGit(compatibleRoot, args),
      runGitCommand: (args) => execGit(compatibleRoot, args),
      tempRoot
    });
    const preservation = await compatibleManager.prepare({
      targetRef: compatible.updateCommit,
      changedFileCount: 2
    });
    assert.strictEqual(readFixtureText(compatibleRoot, 'app.txt'), 'base\n');
    assert(!fs.existsSync(path.join(compatibleRoot, 'local-note.txt')));
    await execGit(compatibleRoot, ['merge', '--ff-only', compatible.updateCommit]);
    await compatibleManager.restore(preservation);
    assert.strictEqual(readFixtureText(compatibleRoot, 'app.txt'), 'local hotfix\n');
    assert.strictEqual(readFixtureText(compatibleRoot, 'release.txt'), 'incoming\n');
    assert.strictEqual(readFixtureText(compatibleRoot, 'local-note.txt'), 'untracked local file\n');
    assert.strictEqual(await execGit(compatibleRoot, ['stash', 'list']), '');

    const conflictingRoot = path.join(tempRoot, 'conflicting');
    const conflicting = await createSystemUpdateFixture(conflictingRoot, { conflicting: true });
    const conflictingManager = systemUpdateModule.createSystemUpdateLocalChangesManager({
      runGitStep: (_label, args) => execGit(conflictingRoot, args),
      runGitCommand: (args) => execGit(conflictingRoot, args),
      tempRoot
    });
    await assert.rejects(
      conflictingManager.prepare({ targetRef: conflicting.updateCommit, changedFileCount: 1 }),
      (error) => error?.code === 'SYSTEM_UPDATE_LOCAL_CHANGES_CONFLICT'
    );
    assert.strictEqual(await execGit(conflictingRoot, ['rev-parse', 'HEAD']), conflicting.baseCommit);
    assert.strictEqual(readFixtureText(conflictingRoot, 'app.txt'), 'local hotfix\n');
    assert.strictEqual(await execGit(conflictingRoot, ['stash', 'list']), '');
    console.log('PASS System Update preserves compatible changes and restores conflicts without moving HEAD');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function verifyFullSystemBackupContract() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-system-backup-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const publicRoot = path.join(tempRoot, 'public');
  const stagingRoot = path.join(dataDir, 'backups', '.staging');
  const backupRoot = path.join(dataDir, 'backups');
  const writeJson = (fileName, value) => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(value, null, 2));
  };
  try {
    writeJson('accounts.json', [{ id: '1', username: 'owner', role: 'Admin', password: 'hashed' }]);
    writeJson('customers.json', [{ id: 'customer-1', accountNumber: '100000001' }]);
    writeJson('payments.json', { 1: [{ id: 'payment-1', accountNumber: '100000001' }] });
    writeJson('integrations.json', { encrypted: { data: 'ciphertext-only' } });
    writeJson('sessions.json', { sessions: { live: { userId: '1' } } });
    writeJson('customer_sessions.json', { sessions: { customer: { accountNumber: '100000001' } } });
    writeJson('master-key.json', { value: 'must-never-enter-an-archive' });
    fs.mkdirSync(path.join(dataDir, 'uploads', 'documents'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'uploads', 'documents', 'record.txt'), 'official-record');
    fs.mkdirSync(path.join(publicRoot, 'uploads', 'payment-proofs'), { recursive: true });
    fs.writeFileSync(path.join(publicRoot, 'uploads', 'payment-proofs', 'proof.jpg'), 'proof-image');

    const service = systemBackupModule.createSystemBackupService({
      dataDir,
      publicRoot,
      stagingRoot,
      backupRoot,
      getStorageDriver: () => 'json',
      isRelationalReady: async () => false
    });
    const exported = await service.createTemporaryArchive();
    const generatedValidation = await service.validateGeneratedArchive(exported);
    assert.strictEqual(
      generatedValidation.manifest.snapshotId,
      exported.manifest.snapshotId,
      'Export must pass the same archive validation used by Import before download'
    );
    assert.strictEqual(generatedValidation.summary.recordCount, 4);
    assert.strictEqual(generatedValidation.summary.uploadFileCount, 2);
    const uploadStream = fs.createReadStream(exported.destinationPath);
    uploadStream.headers = { 'content-length': String(fs.statSync(exported.destinationPath).size) };
    const received = await service.receiveArchive(uploadStream);
    const prepared = await service.validateArchive(received);
    const archivedStoreNames = prepared.manifest.records.jsonStores.map((store) => store.fileName);
    assert(archivedStoreNames.includes('customers.json'), 'Full backup must include customer records');
    assert(archivedStoreNames.includes('payments.json'), 'Full backup must include payment records');
    assert(archivedStoreNames.includes('integrations.json'), 'Full backup must include protected integration settings');
    assert(!archivedStoreNames.includes('sessions.json'), 'Full backup must exclude runtime Admin sessions');
    assert(!archivedStoreNames.includes('customer_sessions.json'), 'Full backup must exclude customer sessions');
    assert(!archivedStoreNames.includes('master-key.json'), 'Full backup must exclude the encryption master key');
    assert.strictEqual(prepared.summary.uploadFileCount, 2, 'Full backup must include both upload roots');

    writeJson('customers.json', [{ id: 'changed-customer' }]);
    writeJson('stale-store.json', [{ id: 'remove-me' }]);
    writeJson('master-key.json', { value: 'current-secret-stays-local' });
    writeJson('sessions.json', { sessions: { stale: { userId: '1' } } });
    fs.writeFileSync(path.join(dataDir, 'uploads', 'documents', 'record.txt'), 'changed-record');
    fs.writeFileSync(path.join(dataDir, 'uploads', 'documents', 'stale.txt'), 'remove-me');

    const restored = await service.restorePrepared(prepared);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'customers.json'), 'utf8')),
      [{ id: 'customer-1', accountNumber: '100000001' }],
      'Restore must replace changed customer records with the validated snapshot'
    );
    assert(!fs.existsSync(path.join(dataDir, 'stale-store.json')), 'Restore must remove stores absent from the complete snapshot');
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'master-key.json'), 'utf8')),
      { value: 'current-secret-stays-local' },
      'Restore must preserve the server-local encryption key'
    );
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8')).sessions,
      {},
      'Restore must invalidate stale Admin sessions'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(dataDir, 'uploads', 'documents', 'record.txt'), 'utf8'),
      'official-record',
      'Restore must round-trip uploaded records'
    );
    assert(!fs.existsSync(path.join(dataDir, 'uploads', 'documents', 'stale.txt')), 'Restore must remove uploads absent from the snapshot');
    assert(fs.existsSync(path.join(backupRoot, restored.preImportBackup.fileName)), 'Restore must create a pre-import recovery backup');

    await service.cleanupPrepared(prepared);
    await service.cleanupPrepared({ stageRoot: exported.tempRoot });
    console.log('PASS Admin full-system backup validation and JSON restore contract');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('admin')"));
assert(serverSource.includes('const MODULE_WEB_ROOTS = Object.freeze('));
assert(serverSource.includes('MODULE_WEB_ROOTS.forEach((webRoot) => {'));
assert(serverSource.includes('.map((webRoot) => path.join(webRoot, filename))'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'login.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'update-download.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'flavors.html')"));
assert(!serverSource.includes("app.get('/flavors'"));
assert(!serverSource.includes("app.get('/api/flavor"));
assert(!serverSource.includes("app.get('/api/flavors"));
assert(!serverSource.includes("app.put('/api/flavors"));
assert(serverSource.includes('const { loadIntegrationSettings, resolveIpBrowserProfile } = integrationSettingsRouter;'));
assert(serverSource.includes('loadIpBrowserAutoLoginSettings(req, targetUrl)'));
assert(serverSource.includes('normalizeIpBrowserAutoLoginSettings(settings, targetUrl)'));
assert(serverSource.includes("adminBackend.load('factoryReset')"));
assert(serverSource.includes("adminBackend.load('systemBackup')"));
assert(serverSource.includes("req.method === 'POST' ? factoryResetLimiter(req, res, next) : next()"));
assert(serverSource.includes("app.use('/api/system-backup', requireAuth, systemBackupLimiter, systemBackupRouter)"));
const sharedLayoutSource = fs.readFileSync(path.join(projectRoot, 'public/layout.js'), 'utf8');
assert(sharedLayoutSource.includes("fetch('/api/system-backup/export'"));
assert(sharedLayoutSource.includes("fetch('/api/system-backup/preview'"));
assert(sharedLayoutSource.includes("fetch('/api/system-backup/restore'"));
assert(sharedLayoutSource.includes("fetch('/api/import/customers-full'"));
assert(sharedLayoutSource.includes('RESTORE ALL DATA'));
const systemBackupRouteSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/system-backup.js'),
  'utf8'
);
const systemBackupServiceSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/system-backup-service.js'),
  'utf8'
);
assert(systemBackupRouteSource.includes('service.validateGeneratedArchive(archive)'));
assert(systemBackupRouteSource.includes("'Content-Length': String(validation.bytes)"));
assert(systemBackupRouteSource.includes('conversionRequired'));
assert(systemBackupServiceSource.includes("driver === 'json' && currentDriver === 'mysql'"));
assert(systemBackupServiceSource.includes('restoreJsonToMysql'));
assert(sharedLayoutSource.includes('Storage conversion required'));
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
verifyFactoryResetContract()
  .then(verifyFullSystemBackupContract)
  .then(verifyJsonToMysqlConversionContract)
  .then(verifySystemUpdateLocalChangesContract)
  .then(async () => {
    console.log('ADMIN COMPATIBILITY PASSED');
    await resetPool();
  })
  .catch(async (error) => {
    console.error(error);
    await resetPool().catch(() => {});
    process.exitCode = 1;
  });
