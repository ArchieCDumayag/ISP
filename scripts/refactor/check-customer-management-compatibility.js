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
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length + 1);

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
assert(
  fs.existsSync(path.join(
    projectRoot,
    'Features/modules/customer-management/backend/customer-full-json-import.js'
  )),
  'Missing Customer Management JSON full-import backend'
);

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
assert(serverSource.includes("customerManagementBackend.load('customerFullJsonImport')"));
assert(serverSource.includes('const jsonResult = await importCustomerFullJsonData({ branchId, tables });'));
assert(serverSource.includes("readJson('tickets', [])"));
assert(serverSource.includes("readJson('jobs', [])"));
assert(serverSource.includes("readJson('sms_messages', [])"));
assert(serverSource.includes("readJson('sms_automation_runs', [])"));
assert(serverSource.includes("readJson('pon-state', {})"));
assert(serverSource.includes("appendSheet('pon_state', ponStateRows)"));
assert(serverSource.includes('CUSTOMER_MANAGEMENT_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-draft-queue.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-archive.html')"));
console.log('PASS Customer Management server loader and web routing');

const {
  buildCustomerFullJsonImport,
  filterCustomerFullImportRows
} = backend.load('customerFullJsonImport');
assert.deepStrictEqual(
  filterCustomerFullImportRows([
    { note: 'No records' },
    { NOTE: ' no RECORDS ' },
    { note: 'No records', id: 5 },
    { id: 7 }
  ]),
  [{ note: 'No records', id: 5 }, { id: 7 }]
);
const ponStateFixtureJson = JSON.stringify({
  olts: [{ id: 'olt-1', name: 'OLT 1', ponPorts: 1 }],
  naps: [{ id: 'nap-1', code: 'NAP-1', connections: [] }]
});
const ponStateFixtureSplit = Math.ceil(ponStateFixtureJson.length / 2);
const jsonImportResult = buildCustomerFullJsonImport({
  branchId: 1,
  now: new Date('2026-07-29T00:00:00.000Z'),
  stores: {
    plans: [{ id: 'plan-100', name: 'Old Plan', price: 100 }],
    customers: [
      { accountNumber: '100000001', branchId: 1, name: 'Old Name', customField: 'preserved' },
      { accountNumber: '200000001', branchId: 2, name: 'Other Branch' }
    ],
    payments: {
      100000001: {
        customerName: 'Old Name',
        history: [
          { id: 'payment-replaced', amount: 10, recordedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'payment-preserved', amount: 20, recordedAt: '2026-01-02T00:00:00.000Z' }
        ]
      }
    },
    tickets: [],
    jobs: [],
    sms_messages: [],
    sms_automation_runs: [],
    'pon-state': {}
  },
  tables: {
    plans: [
      { plan_id: 'plan-100', name: 'Updated Plan', price: 150 },
      { plan_id: 'plan-200', name: 'New Plan', price: 200 }
    ],
    customers: [
      { account_number: '100000001', name: 'Updated Name', plan_id: 'plan-100' },
      { account_number: '100000002', first_name: 'New', last_name: 'Customer', plan_id: 'plan-200' },
      { name: 'Missing Account' }
    ],
    payment_entries: [
      {
        id: 'payment-replaced',
        account_number: '100000001',
        amount: 75,
        kind: 'payment',
        recorded_at: '2026-07-29T08:00:00.000Z'
      },
      { id: 'payment-missing-customer', account_number: '999999999', amount: 50 }
    ],
    tickets: [{ id: 1, account_number: '100000001', subject: 'No Internet' }],
    jobs: [{ id: 2, ticket_id: 1, type: 'repair', status: 'open' }],
    sms_messages: [{
      id: 3,
      customer_account_number: '100000001',
      recipient: '09170000000',
      message_text: 'Service notice',
      status: 'sent'
    }],
    sms_automation_runs: [{
      id: 4,
      automation_id: 10,
      customer_account_number: '100000001',
      recipient: '09170000000',
      status: 'sent'
    }],
    pon_state: [
      {
        chunk_index: 1,
        chunk_count: 2,
        state_json_chunk: ponStateFixtureJson.slice(0, ponStateFixtureSplit)
      },
      {
        chunk_index: 2,
        chunk_count: 2,
        state_json_chunk: ponStateFixtureJson.slice(ponStateFixtureSplit)
      }
    ],
    pon_nap_connections: [{
      id: 'connection-1',
      nap_id: 'nap-1',
      customer_account_number: '100000001',
      customer_name: 'Updated Name',
      port: 1
    }]
  }
});
assert.strictEqual(jsonImportResult.imported.plans, 2);
assert.strictEqual(jsonImportResult.imported.customers, 2);
assert.strictEqual(jsonImportResult.imported.payment_entries, 1);
assert.strictEqual(jsonImportResult.imported.tickets, 1);
assert.strictEqual(jsonImportResult.imported.jobs, 1);
assert.strictEqual(jsonImportResult.imported.sms_messages, 1);
assert.strictEqual(jsonImportResult.imported.sms_automation_runs, 1);
assert.strictEqual(jsonImportResult.imported.pon_nap_connections, 1);
assert.deepStrictEqual(jsonImportResult.touchedKeys, [
  'plans',
  'customers',
  'payments',
  'tickets',
  'jobs',
  'sms_messages',
  'sms_automation_runs',
  'pon-state'
]);
const updatedCustomer = jsonImportResult.stores.customers.find((customer) => customer.accountNumber === '100000001');
assert.strictEqual(updatedCustomer.name, 'Updated Name');
assert.strictEqual(updatedCustomer.planId, 'plan-100');
assert.strictEqual(updatedCustomer.customField, 'preserved');
assert.strictEqual(
  jsonImportResult.stores.customers.find((customer) => customer.accountNumber === '200000001').branchId,
  2
);
const importedHistory = jsonImportResult.stores.payments['100000001'].history;
assert.strictEqual(importedHistory.filter((entry) => entry.id === 'payment-replaced').length, 1);
assert.strictEqual(importedHistory.find((entry) => entry.id === 'payment-replaced').amount, 75);
assert(importedHistory.some((entry) => entry.id === 'payment-preserved'));
assert.strictEqual(jsonImportResult.stores.tickets[0].ticketNumber, 'TKT-00000001');
assert.strictEqual(jsonImportResult.stores.jobs[0].ticketId, 1);
assert.strictEqual(jsonImportResult.stores.sms_messages[0].messageText, 'Service notice');
assert.strictEqual(jsonImportResult.stores.sms_automation_runs[0].automationId, 10);
assert.strictEqual(
  jsonImportResult.stores['pon-state'].branches['1'].naps[0].connections[0].customerId,
  '100000001'
);
assert(jsonImportResult.warnings.some((message) => message.includes('account number is missing')));
assert(jsonImportResult.warnings.some((message) => message.includes('999999999')));
console.log('PASS JSON full customer import merge and storage dispatch');

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
const layoutSource = fs.readFileSync(path.join(projectRoot, 'public/layout.js'), 'utf8');
assert(layoutSource.includes('SMS runs: ${Number(imported.sms_automation_runs || 0)}'));
assert(layoutSource.includes('PON: ${Number(imported.pon_nap_connections || 0)}'));
assert(layoutSource.includes('Full backup downloaded: customers, balances, plans, payments, tickets, jobs, SMS, and PON.'));
console.log('PASS web-app canonical Customer stylesheet reference');
console.log('CUSTOMER MANAGEMENT COMPATIBILITY PASSED');
