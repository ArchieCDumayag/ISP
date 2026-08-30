const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const dbPath = require.resolve(path.join(projectRoot, 'core/data/db'));
const dataStorePath = require.resolve(path.join(projectRoot, 'core/data/data-store'));
const relationalPath = require.resolve(path.join(projectRoot, 'core/data/db-relational'));
const customersPath = require.resolve(path.join(
  projectRoot,
  'Features/modules/customer-management/backend/customers'
));
const draftStorePath = require.resolve(path.join(
  projectRoot,
  'Features/modules/customer-management/backend/customer-draft-submissions-store'
));

const clone = (value) => JSON.parse(JSON.stringify(value));
const stores = new Map();

require.cache[dataStorePath] = {
  id: dataStorePath,
  filename: dataStorePath,
  loaded: true,
  exports: {
    readJson: async (key, fallback) => clone(stores.has(key) ? stores.get(key) : fallback),
    writeJson: async (key, value) => {
      stores.set(key, clone(value));
    }
  }
};
require.cache[relationalPath] = {
  id: relationalPath,
  filename: relationalPath,
  loaded: true,
  exports: { isRelationalReady: async () => false }
};
require.cache[customersPath] = {
  id: customersPath,
  filename: customersPath,
  loaded: true,
  exports: {
    readCustomers: async () => [],
    resolveStoredAccountPrefixId: async () => 1,
    generateAccountNumber: () => '10000001'
  }
};
delete require.cache[draftStorePath];

const draftStore = require(draftStorePath);

const seedDraft = () => {
  const now = new Date().toISOString();
  stores.set('customer_draft_submissions', [{
    id: 'draft-1',
    branch_id: 1,
    submitted_by_user_id: 'tech-1',
    customer_name: 'Test Customer',
    draft_account_number: 'TEMP-1001',
    draft_json: JSON.stringify({ name: 'Test Customer' }),
    status: 'pending',
    submitted_at: now,
    created_at: now,
    updated_at: now
  }]);
};

const completion = (fingerprint, notes) => ({
  clientEventId: 'completion-event-1',
  fingerprint,
  onuSerialNumber: 'ONU-001',
  opticalSignal: '-18.4 dBm',
  notes
});

test('installation completion compare-and-set permits one winner and rejects altered concurrent evidence', async () => {
  seedDraft();
  const first = completion('a'.repeat(64), 'first evidence');
  const altered = completion('b'.repeat(64), 'altered evidence');
  const outcomes = await Promise.allSettled([
    draftStore.compareAndSetCustomerDraftInstallationCompletion(
      'TEMP-1001', 1, first, { statuses: ['pending', 'approved'] }
    ),
    draftStore.compareAndSetCustomerDraftInstallationCompletion(
      'TEMP-1001', 1, altered, { statuses: ['pending', 'approved'] }
    )
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal(rejected.reason.code, 'INSTALLATION_COMPLETION_CONFLICT');

  const storedRow = stores.get('customer_draft_submissions')[0];
  const persisted = JSON.parse(storedRow.draft_json).installationCompletion;
  assert.ok([first.fingerprint, altered.fingerprint].includes(persisted.fingerprint));

  const replay = await draftStore.compareAndSetCustomerDraftInstallationCompletion(
    'TEMP-1001', 1, persisted, { statuses: ['pending', 'approved'] }
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.installationCompletion.fingerprint, persisted.fingerprint);

  const conflicting = persisted.fingerprint === first.fingerprint ? altered : first;
  await assert.rejects(
    draftStore.compareAndSetCustomerDraftInstallationCompletion(
      'TEMP-1001', 1, conflicting, { statuses: ['pending', 'approved'] }
    ),
    (error) => error.statusCode === 409 && error.code === 'INSTALLATION_COMPLETION_CONFLICT'
  );
  assert.equal(
    JSON.parse(stores.get('customer_draft_submissions')[0].draft_json).installationCompletion.fingerprint,
    persisted.fingerprint
  );
});

test('installation completion compare-and-set ignores disallowed draft states', async () => {
  seedDraft();
  const rows = stores.get('customer_draft_submissions');
  rows[0].status = 'rejected';
  stores.set('customer_draft_submissions', rows);

  const result = await draftStore.compareAndSetCustomerDraftInstallationCompletion(
    'TEMP-1001',
    1,
    completion('c'.repeat(64), 'must not be stored'),
    { statuses: ['pending', 'approved'] }
  );
  assert.equal(result, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      JSON.parse(stores.get('customer_draft_submissions')[0].draft_json),
      'installationCompletion'
    ),
    false
  );
});

test('final technician submission atomically promotes an in-progress draft to the Admin queue', async () => {
  seedDraft();
  const rows = stores.get('customer_draft_submissions');
  rows[0].status = 'in-progress';
  stores.set('customer_draft_submissions', rows);
  const submitted = await draftStore.compareAndSetCustomerDraftInstallationCompletion(
    'TEMP-1001',
    1,
    completion('e'.repeat(64), 'submitted with durable port hold'),
    { statuses: ['in-progress', 'pending'], transitionToPending: true }
  );

  assert.equal(submitted.item.rawStatus, 'pending');
  assert.equal(stores.get('customer_draft_submissions')[0].status, 'pending');
  assert.equal(
    JSON.parse(stores.get('customer_draft_submissions')[0].draft_json)
      .installationCompletion.fingerprint,
    'e'.repeat(64)
  );
});

test('PPPoE draft patch locks and status-guards the MySQL row while preserving completion evidence', async () => {
  const originalDbCache = require.cache[dbPath];
  const originalRelationalCache = require.cache[relationalPath];
  const originalDraftStoreCache = require.cache[draftStorePath];
  const transactionEvents = [];
  const statements = [];
  const lockedRow = {
    id: 'draft-mysql-1',
    branch_id: 7,
    submitted_by_user_id: 'tech-7',
    customer_name: 'MySQL Customer',
    draft_account_number: 'TEMP-7001',
    draft_json: JSON.stringify({
      name: 'MySQL Customer',
      installationCompletion: completion('d'.repeat(64), 'trusted field record')
    }),
    status: 'pending',
    submitted_at: '2026-08-16 10:00:00'
  };
  const connection = {
    beginTransaction: async () => transactionEvents.push('begin'),
    commit: async () => transactionEvents.push('commit'),
    rollback: async () => transactionEvents.push('rollback'),
    release: () => transactionEvents.push('release'),
    query: async (sql, params = []) => {
      statements.push({ sql: String(sql), params: clone(params) });
      if (/^\s*SELECT \*/i.test(sql)) return [[clone(lockedRow)]];
      if (/^\s*UPDATE /i.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected transaction query: ${sql}`);
    }
  };

  try {
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        getPool: async () => ({ getConnection: async () => connection }),
        query: async () => [[]]
      }
    };
    require.cache[relationalPath] = {
      id: relationalPath,
      filename: relationalPath,
      loaded: true,
      exports: { isRelationalReady: async () => true }
    };
    delete require.cache[draftStorePath];
    const relationalStore = require(draftStorePath);

    const updated = await relationalStore.updateCustomerDraftSubmissionDraftDataByAccountNumber(
      'TEMP-7001',
      7,
      { pppoeUsername: 'field-user', pppoePassword: 'field-pass' },
      { statuses: ['pending'] }
    );

    assert.deepEqual(transactionEvents, ['begin', 'commit', 'release']);
    assert.equal(statements.length, 2);
    assert.match(statements[0].sql, /FOR UPDATE/i);
    assert.match(statements[0].sql, /status IN \(\?\)/i);
    assert.match(statements[1].sql, /status IN \(\?\)/i);
    assert.equal(statements[1].params.at(-1), 'pending');
    assert.equal(updated.draftData.pppoeUsername, 'field-user');
    assert.equal(updated.draftData.installationCompletion.fingerprint, 'd'.repeat(64));
  } finally {
    if (originalDbCache) require.cache[dbPath] = originalDbCache;
    else delete require.cache[dbPath];
    if (originalRelationalCache) require.cache[relationalPath] = originalRelationalCache;
    else delete require.cache[relationalPath];
    if (originalDraftStoreCache) require.cache[draftStorePath] = originalDraftStoreCache;
    else delete require.cache[draftStorePath];
  }
});
