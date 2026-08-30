#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
process.env.ISOLATED_RUNTIME_CONFIG = '1';
process.env.STORAGE_DRIVER = 'json';
require(path.join(projectRoot, 'core/config/env-loader'));

const runNodeTest = (relativePath) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isp-customer-test-'));
  const outputPath = path.join(outputDir, 'output.log');
  const outputFd = fs.openSync(outputPath, 'w');
  try {
    execFileSync(process.execPath, [
      '--test',
      path.join(projectRoot, relativePath)
    ], {
      stdio: ['ignore', outputFd, outputFd],
      env: {
        ...process.env,
        ISOLATED_RUNTIME_CONFIG: '1',
        STORAGE_DRIVER: 'json'
      }
    });
  } finally {
    fs.closeSync(outputFd);
    const output = fs.readFileSync(outputPath, 'utf8');
    if (output) process.stdout.write(output);
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
};

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
  ['referral-store.js', 'referral-store'],
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

const referralsPageSource = fs.readFileSync(path.join(webRoot, 'referrals.html'), 'utf8');
const referralsBrowserSource = fs.readFileSync(path.join(webRoot, 'js/referrals.js'), 'utf8');
const referralsBackendSource = fs.readFileSync(path.join(
  projectRoot,
  'Features/modules/customer-management/backend/referrals.js'
), 'utf8');
assert(referralsPageSource.includes('id="referralCreateModal"'));
assert(referralsPageSource.includes('id="referralStatusModal"'));
assert(referralsPageSource.includes('id="referralStatusApplyFromMonth"'));
assert(referralsBrowserSource.includes("method: editing ? 'PATCH' : 'POST'"));
assert(referralsBrowserSource.includes('data-referral-edit'));
assert(referralsBrowserSource.includes('data-referral-action="schedule"'));
assert(referralsBackendSource.includes("router.post('/',"));
assert(referralsBackendSource.includes("router.patch('/:referralId/status'"));
assert(referralsBackendSource.includes("router.patch('/:referralId/schedule'"));
assert(referralsBackendSource.includes("router.patch('/:referralId'"));
runNodeTest('Features/modules/customer-management/tests/referral-workflow.test.js');
runNodeTest('Features/modules/customer-management/tests/referral-queue.test.js');
runNodeTest('Features/modules/customer-management/tests/technician-draft-location.test.js');
runNodeTest('Features/modules/customer-management/tests/admin-add-customer-hardening.test.js');
console.log('PASS Customer Management centralized referral workflow contract');

const customerRouter = backend.load('customers');
assert.strictEqual(typeof customerRouter.normalizeImportedClientCorrectionRecord, 'function');
assert.strictEqual(typeof customerRouter.normalizeCustomerMapPin, 'function');
assert.strictEqual(customerRouter.normalizeCustomerMapPin('14.5995, 120.9842'), '14.599500, 120.984200');
assert.strictEqual(customerRouter.normalizeCustomerMapPin('https://maps.google.com/?q=14.5995,120.9842'), '14.599500, 120.984200');
assert.strictEqual(customerRouter.normalizeCustomerMapPin(`17°58'6.21"N121°45'30.43"E`), '17.968392, 121.758453');
assert.throws(() => customerRouter.normalizeCustomerMapPin('not a coordinate'), /valid latitude and longitude/);
const normalizedImportCorrection = customerRouter.normalizeImportedClientCorrectionRecord({
  rowNumber: 360,
  accountNumber: 100000360,
  firstName: 'iMPORT',
  middleName: 'dE la',
  lastName: 'wARNING jr',
  planType: 'postpaid',
  planName: 'Standard',
  monthlyRate: '1,000',
  billingCycle: 'last of the month'
});
assert.strictEqual(normalizedImportCorrection.rowNumber, 360);
assert.strictEqual(normalizedImportCorrection.accountNumber, '100000360');
assert.strictEqual(normalizedImportCorrection.planCategory, 'postpaid');
assert.strictEqual(normalizedImportCorrection.planValue, 'Standard');
assert.strictEqual(normalizedImportCorrection.planAmount, 1000);
assert.strictEqual(normalizedImportCorrection.firstName, 'Import');
assert.strictEqual(normalizedImportCorrection.middleName, 'De La');
assert.strictEqual(normalizedImportCorrection.lastName, 'Warning Jr.');

const customerDraftRouter = backend.load('customerDraftSubmissions');
const normalizedDraftName = customerDraftRouter.normalizeDraftPayload({
  firstName: 'jUAN',
  middleName: 'dELA',
  lastName: "o'BRIEN iii"
});
assert.strictEqual(normalizedDraftName.firstName, 'Juan');
assert.strictEqual(normalizedDraftName.middleName, 'Dela');
assert.strictEqual(normalizedDraftName.lastName, "O'Brien III");
assert.strictEqual(normalizedDraftName.name, "Juan Dela O'Brien III");

const customersPageSource = fs.readFileSync(path.join(webRoot, 'customers.html'), 'utf8');
const applyNowPageSource = fs.readFileSync(path.join(webRoot, 'apply-now.html'), 'utf8');
const draftQueuePageSource = fs.readFileSync(path.join(webRoot, 'customer-draft-queue.html'), 'utf8');
const customersCssSource = fs.readFileSync(path.join(webRoot, 'css/customers.css'), 'utf8');
assert(customersPageSource.includes('/js/customer-name-case.js?v=1.0'));
assert(applyNowPageSource.includes('/js/customer-name-case.js?v=1.0'));
assert(draftQueuePageSource.includes('/js/customer-name-case.js?v=1.0'));
assert(customersPageSource.includes('id="importWarningReviewBtn"'));
assert(customersPageSource.includes('id="importWarningModal"'));
assert(customersPageSource.includes("fetch('/api/customers/import-client-corrections'"));
assert(customersPageSource.includes('renderImportWarningRows(warningRecords)'));
assert(customersPageSource.includes("const parsedCustomerMapPin = rawCustomerMapPin ? parseCoordinateValue(rawCustomerMapPin) : null;"));
assert(customersPageSource.includes('mapPin: normalizedCustomerMapPin'));
assert(customersCssSource.includes('.import-warning-modal .modal-content'));
assert(customersCssSource.includes('.import-warning-review-btn[hidden]'));
console.log('PASS CLIENTS LIST import warning review and correction UI contract');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('customer-management')"));
assert(serverSource.includes("customerManagementBackend.load('customers')"));
assert(serverSource.includes("customerManagementBackend.load('customerDraftSubmissions')"));
assert(serverSource.includes("customerManagementBackend.load('customerFullJsonImport')"));
assert(serverSource.includes('const jsonResult = await importCustomerFullJsonData({ branchId, tables });'));
assert(serverSource.includes('workflow_status = VALUES(workflow_status)'));
assert(serverSource.includes('dispatch_payload_json = VALUES(dispatch_payload_json)'));
assert(serverSource.includes('record_version = VALUES(record_version)'));
assert(serverSource.includes("readJson('tickets', [])"));
assert(serverSource.includes("readJson('jobs', [])"));
assert(serverSource.includes("readJson('sms_messages', [])"));
assert(serverSource.includes("readJson('sms_automation_runs', [])"));
assert(serverSource.includes("readJson('pon-state', {})"));
assert(serverSource.includes("appendSheet('pon_state', ponStateRows)"));
assert(serverSource.includes("appendSheet('payment_breakdown_adjustments', firstBillAdjustmentRows)"));
assert(serverSource.includes('const exportIntegrity = deduplicateCustomerFullTables({'));
assert(serverSource.includes('backup_schema_version: 3'));
assert(serverSource.includes('duplicatesSkipped.payment_entries += 1'));
assert(serverSource.includes('CUSTOMER_MANAGEMENT_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-draft-queue.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'customer-archive.html')"));
console.log('PASS Customer Management server loader and web routing');

const {
  buildCustomerFullJsonImport,
  deduplicateCustomerFullTables,
  filterCustomerFullImportProtectedRows,
  filterCustomerFullImportRows,
  findCustomerFullImportClosedAccountConflicts,
  getCustomerFullImportAccountNumbers,
  getCustomerFullImportPaymentIds,
  isCustomerFullImportBlockingConflict
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
const deduplicatedImport = deduplicateCustomerFullTables({
  customers: [
    { account_number: '100000001', name: 'Same Customer' },
    { account_number: '100000001', name: 'Same Customer' }
  ],
  payment_entries: [
    {
      id: 'payment-a',
      account_number: '100000001',
      amount: 1000,
      kind: 'payment',
      fingerprint: '100000001|REFERENCE-1|payment|1000.00'
    },
    {
      id: 'payment-b',
      account_number: '100000001',
      amount: 1000,
      kind: 'payment',
      fingerprint: '100000001|REFERENCE-1|payment|1000.00'
    }
  ]
});
assert.strictEqual(deduplicatedImport.tables.customers.length, 1);
assert.strictEqual(deduplicatedImport.tables.payment_entries.length, 1);
assert.strictEqual(deduplicatedImport.duplicatesSkipped.customers, 1);
assert.strictEqual(deduplicatedImport.duplicatesSkipped.payment_entries, 1);
assert.strictEqual(deduplicatedImport.conflictCount, 0);

const conflictingImport = deduplicateCustomerFullTables({
  customers: [
    { account_number: '100000001', name: 'First Customer' },
    { account_number: '100000001', name: 'Conflicting Customer' }
  ]
});
assert.strictEqual(conflictingImport.conflictCount, 1);
assert.deepStrictEqual(conflictingImport.conflicts[0], {
  table: 'customers',
  identityType: 'account_number',
  firstRow: 2,
  conflictingRow: 3
});
console.log('PASS full customer import duplicate and conflict detection');
assert.deepStrictEqual(
  getCustomerFullImportAccountNumbers({
    customers: [{ account_number: '100000001' }],
    payment_entries: [{ accountNumber: '100000002' }],
    payment_breakdown_adjustments: [{ account_number: '100000003' }],
    pon_nap_connections: [{ customer_account_number: '100000004' }]
  }),
  ['100000001', '100000002', '100000003', '100000004']
);
assert.deepStrictEqual(
  findCustomerFullImportClosedAccountConflicts({
    branchId: 1,
    tables: {
      customers: [{ account_number: '100000001' }, { account_number: '100000002' }]
    },
    closedAccountRecords: [{ accountNumber: '100000001', active: false }],
    currentPayments: {
      100000002: {
        history: [{
          kind: 'payment',
          direction: 'credit',
          description: 'Closed Account Collection | Closure ID: closure-2'
        }]
      }
    }
  }),
  [
    { accountNumber: '100000001', reasons: ['closed_account_history'] },
    { accountNumber: '100000002', reasons: ['protected_closed_collection_payment'] }
  ]
);
assert.deepStrictEqual(
  getCustomerFullImportPaymentIds({
    payment_entries: [{ id: 'payment-z' }, { payment_id: 'payment-a' }]
  }),
  ['payment-a', 'payment-z']
);
assert.deepStrictEqual(
  findCustomerFullImportClosedAccountConflicts({
    tables: {
      payment_entries: [{ id: 'protected-payment', account_number: '100000099' }]
    },
    currentPayments: {
      100000001: {
        history: [{
          id: 'protected-payment',
          kind: 'payment',
          direction: 'credit',
          description: 'Closed Account Collection | Closure ID: closure-1'
        }]
      }
    }
  }),
  [{
    accountNumber: '100000001',
    reasons: ['protected_closed_collection_payment_id_moved'],
    paymentIds: ['protected-payment']
  }]
);
assert.deepStrictEqual(
  findCustomerFullImportClosedAccountConflicts({
    branchId: 1,
    tables: {
      payment_entries: [{ id: 'ordinary-payment', account_number: 'OPEN' }]
    },
    closedAccountRecords: [{ accountNumber: 'CLOSED', branchId: 1 }],
    currentPayments: {
      CLOSED: {
        history: [{ id: 'ordinary-payment', kind: 'payment', direction: 'credit' }]
      }
    }
  }),
  [{
    accountNumber: 'CLOSED',
    reasons: ['protected_payment_id_moved'],
    paymentIds: ['ordinary-payment']
  }]
);
assert.deepStrictEqual(
  findCustomerFullImportClosedAccountConflicts({
    branchId: 1,
    tables: {
      payment_entries: [{ id: 'other-branch-payment', account_number: '100000099' }]
    },
    currentPayments: [{
      id: 'other-branch-payment',
      branchId: 2,
      accountNumber: '200000001',
      kind: 'payment',
      direction: 'credit'
    }]
  }),
  [{
    accountNumber: '200000001',
    reasons: ['cross_branch_payment_id'],
    paymentIds: ['other-branch-payment']
  }]
);
assert.deepStrictEqual(
  findCustomerFullImportClosedAccountConflicts({
    branchId: 1,
    tables: {
      customers: [{ account_number: '200000001' }]
    },
    currentCustomers: [{ accountNumber: '200000001', branchId: 2 }]
  }),
  [{
    accountNumber: '200000001',
    reasons: ['cross_branch_customer_account']
  }]
);
const protectedRoundTripResult = buildCustomerFullJsonImport({
    branchId: 1,
    stores: {
      customers: [{ accountNumber: '100000001', branchId: 1 }],
      payments: {},
      closed_customer_accounts: {
        version: 1,
        branches: {
          1: { records: [{ accountNumber: '100000001', active: false }] }
        }
      }
    },
    tables: {
      customers: [{ account_number: '100000001', name: 'Unsafe overwrite' }]
    }
  });
assert.equal(protectedRoundTripResult.imported.customers, 0);
assert.equal(protectedRoundTripResult.stores.customers[0].name, undefined);
assert.ok(protectedRoundTripResult.warnings.some((warning) => warning.includes('Preserved protected closed-account records')));
const preservedRows = filterCustomerFullImportProtectedRows({
  tables: {
    customers: [{ account_number: '100000001' }, { account_number: '100000002' }],
    payment_entries: [{ id: 'protected', account_number: '100000001' }],
    pon_state: [{ chunk_index: 1, state_json_chunk: '{"naps":[]}' }]
  },
  conflicts: [{ accountNumber: '100000001', reasons: ['closed_account_history'] }]
});
assert.deepStrictEqual(preservedRows.tables.customers, [{ account_number: '100000002' }]);
assert.deepStrictEqual(preservedRows.tables.payment_entries, []);
assert.deepStrictEqual(preservedRows.tables.pon_state, []);
assert.equal(isCustomerFullImportBlockingConflict({
  reasons: ['protected_closed_collection_payment_id_moved']
}), true);
assert.equal(isCustomerFullImportBlockingConflict({ reasons: ['closed_account_history'] }), false);
assert.deepStrictEqual(
  getCustomerFullImportAccountNumbers({
    pon_state: [{
      state_json: JSON.stringify({
        naps: [{ id: 'nap-nested', connections: [{ customerId: '100000777', port: 1 }] }]
      })
    }]
  }),
  ['100000777']
);
const protectedPonStateResult = buildCustomerFullJsonImport({
  branchId: 1,
  stores: {
    customers: [{ accountNumber: 'CLOSED', branchId: 1 }],
    payments: {},
    tickets: [],
    jobs: [],
    sms_messages: [],
    sms_automation_runs: [],
    'pon-state': {
      branches: {
        1: {
          naps: [{
            id: 'nap-protected',
            connections: [{ id: 'connection-protected', customerId: 'CLOSED', port: 1 }]
          }]
        }
      }
    },
    closed_customer_accounts: {
      version: 1,
      branches: { 1: { records: [{ accountNumber: 'CLOSED', branchId: 1 }] } }
    }
  },
  tables: {
    pon_state: [{ state_json: JSON.stringify({ naps: [] }) }]
  }
});
assert.equal(
  protectedPonStateResult.stores['pon-state'].branches['1'].naps[0].connections[0].customerId,
  'CLOSED'
);
assert.ok(protectedPonStateResult.warnings.some((warning) => warning.includes('Preserved protected closed-account records')));

['tickets', 'jobs', 'sms_messages', 'sms_automation_runs'].forEach((tableName) => {
  const collision = findCustomerFullImportClosedAccountConflicts({
    branchId: 1,
    tables: { [tableName]: [{ id: 7, customer_account_number: 'OPEN' }] },
    closedAccountRecords: [{ accountNumber: 'CLOSED', branchId: 1 }],
    currentRelatedRecords: {
      [tableName]: [{ id: 7, branchId: 1, customerAccountNumber: 'CLOSED' }]
    }
  });
  assert.ok(collision.some((entry) => (
    entry.accountNumber === 'CLOSED'
    && entry.reasons.includes(`protected_${tableName}_id_moved`)
    && isCustomerFullImportBlockingConflict(entry)
  )), `${tableName} stable ID must not move away from a protected closed account`);
});
assert.throws(
  () => buildCustomerFullJsonImport({
    branchId: 1,
    stores: {
      customers: [
        { accountNumber: 'CLOSED', branchId: 1 },
        { accountNumber: 'OPEN', branchId: 1 }
      ],
      payments: {},
      tickets: [{ id: 7, branchId: 1, accountNumber: 'CLOSED' }],
      jobs: [],
      sms_messages: [],
      sms_automation_runs: [],
      'pon-state': {},
      closed_customer_accounts: {
        version: 1,
        branches: { 1: { records: [{ accountNumber: 'CLOSED', branchId: 1 }] } }
      }
    },
    tables: { tickets: [{ id: 7, account_number: 'OPEN' }] }
  }),
  (error) => (
    error?.code === 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT'
    && error.conflicts?.some((entry) => entry.reasons.includes('protected_tickets_id_moved'))
  )
);
const protectedLinkedJobResult = buildCustomerFullJsonImport({
  branchId: 1,
  stores: {
    customers: [{ accountNumber: 'CLOSED', branchId: 1 }],
    payments: {},
    tickets: [{ id: 7, branchId: 1, accountNumber: 'CLOSED' }],
    jobs: [],
    sms_messages: [],
    sms_automation_runs: [],
    'pon-state': {},
    closed_customer_accounts: {
      version: 1,
      branches: { 1: { records: [{ accountNumber: 'CLOSED', branchId: 1 }] } }
    }
  },
  tables: { jobs: [{ id: 8, ticket_id: 7, type: 'repair' }] }
});
assert.equal(protectedLinkedJobResult.imported.jobs, 0);
assert.equal(protectedLinkedJobResult.stores.jobs.length, 0);
assert.ok(protectedLinkedJobResult.warnings.some((warning) => warning.includes('Preserved protected closed-account records')));
const caseInsensitivePaymentIdResult = buildCustomerFullJsonImport({
  branchId: 1,
  stores: {
    customers: [{ accountNumber: 'OPEN', branchId: 1 }],
    payments: { OPEN: { history: [{ id: 'PAY-1', amount: 100 }] } },
    tickets: [],
    jobs: [],
    sms_messages: [],
    sms_automation_runs: [],
    'pon-state': {},
    closed_customer_accounts: { version: 1, branches: {} }
  },
  tables: {
    payment_entries: [{ id: 'pay-1', account_number: 'OPEN', amount: 200 }]
  }
});
assert.equal(caseInsensitivePaymentIdResult.stores.payments.OPEN.history.length, 1);
assert.equal(caseInsensitivePaymentIdResult.stores.payments.OPEN.history[0].id, 'pay-1');
assert.equal(caseInsensitivePaymentIdResult.stores.payments.OPEN.history[0].amount, 200);

const protectedPonPortCollision = findCustomerFullImportClosedAccountConflicts({
  branchId: 1,
  tables: {
    pon_nap_connections: [{ id: 'connection-open', nap_id: 'nap-protected', port: 1, customer_account_number: 'OPEN' }]
  },
  closedAccountRecords: [{ accountNumber: 'CLOSED', branchId: 1 }],
  currentPonState: {
    branches: {
      1: {
        naps: [{
          id: 'nap-protected',
          connections: [{ id: 'connection-closed', customerId: 'CLOSED', port: 1 }]
        }]
      }
    }
  }
});
assert.ok(protectedPonPortCollision.some((entry) => (
  entry.accountNumber === 'CLOSED'
  && entry.reasons.includes('protected_pon_nap_connections_port_moved')
  && isCustomerFullImportBlockingConflict(entry)
)));
const protectedPonCodeAliasCollision = findCustomerFullImportClosedAccountConflicts({
  branchId: 1,
  tables: {
    pon_nap_connections: [{
      id: 'connection-open',
      nap_code: 'NAP-01',
      port: 1,
      customer_account_number: 'OPEN'
    }]
  },
  closedAccountRecords: [{ accountNumber: 'CLOSED', branchId: 1 }],
  currentPonState: {
    branches: {
      1: {
        naps: [{
          id: 'nap-uuid',
          code: 'NAP-01',
          connections: [{ id: 'connection-closed', customerId: 'CLOSED', port: 1 }]
        }]
      }
    }
  }
});
assert.ok(protectedPonCodeAliasCollision.some((entry) => (
  entry.reasons.includes('protected_pon_nap_connections_port_moved')
  && isCustomerFullImportBlockingConflict(entry)
)));
const crossBranchTicketCollision = findCustomerFullImportClosedAccountConflicts({
  branchId: 1,
  tables: { tickets: [{ id: 8, account_number: 'OPEN' }] },
  currentRelatedRecords: { tickets: [{ id: 8, branchId: 2, accountNumber: 'OTHER' }] }
});
assert.ok(crossBranchTicketCollision.some((entry) => (
  entry.reasons.includes('cross_branch_tickets_id')
  && isCustomerFullImportBlockingConflict(entry)
)));
assert(serverSource.includes('serializePaymentMutationRequest,'));
assert(serverSource.includes("code: 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT'"));
assert(serverSource.includes('await lockPaymentAccount(connection, branchId, accountNumber);'));
assert(serverSource.includes('const lockedRelatedRecords = {'));
assert(serverSource.includes('currentRelatedRecords: lockedRelatedRecords'));
assert(serverSource.includes('if (lockedClosedAccountConflicts.length)'));
console.log('PASS full customer import closed-account preservation contract');
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
    'pon-state': {},
    payment_breakdown_adjustments: {
      1: {
        100000001: {
          firstBill: { previousBalance: 900 },
          planChanges: [{ effectiveMonth: '2026-08', planAmount: 1200 }],
          updatedAt: '2026-08-01T00:00:00.000Z'
        }
      }
    }
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
    payment_breakdown_adjustments: [
      {
        account_number: '100000001',
        first_bill_previous_balance: 500,
        first_bill_advance: 25
      },
      {
        account_number: '100000002',
        previous_balance: 150,
        advance_payment: 40
      }
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
assert.strictEqual(jsonImportResult.imported.payment_breakdown_adjustments, 2);
assert.deepStrictEqual(jsonImportResult.touchedKeys, [
  'plans',
  'customers',
  'payments',
  'tickets',
  'jobs',
  'sms_messages',
  'sms_automation_runs',
  'pon-state',
  'payment_breakdown_adjustments'
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
assert.strictEqual(
  jsonImportResult.stores.payment_breakdown_adjustments['1']['100000001'].firstBill.previousBalance,
  900
);
assert.strictEqual(
  jsonImportResult.stores.payment_breakdown_adjustments['1']['100000001'].firstBill.advance,
  25
);
assert.strictEqual(
  jsonImportResult.stores.payment_breakdown_adjustments['1']['100000001'].planChanges[0].planAmount,
  1200
);
assert.deepStrictEqual(
  jsonImportResult.stores.payment_breakdown_adjustments['1']['100000002'].firstBill,
  { previousBalance: 150, advance: 40 }
);
assert(jsonImportResult.warnings.some((message) => message.includes('account number is missing')));
assert(jsonImportResult.warnings.some((message) => message.includes('999999999')));

const repeatedJsonImportResult = buildCustomerFullJsonImport({
  branchId: 1,
  now: new Date('2026-07-30T00:00:00.000Z'),
  stores: jsonImportResult.stores,
  tables: {
    customers: [{ account_number: '100000001', name: 'Updated Name', plan_id: 'plan-100' }],
    payment_entries: [{
      id: 'payment-replaced',
      account_number: '100000001',
      amount: 75,
      kind: 'payment',
      recorded_at: '2026-07-29T08:00:00.000Z'
    }],
    payment_breakdown_adjustments: [
      {
        account_number: '100000001',
        first_bill_previous_balance: 500,
        first_bill_advance: 25
      },
      {
        account_number: '100000002',
        previous_balance: 150,
        advance_payment: 40
      }
    ]
  }
});
assert.strictEqual(
  repeatedJsonImportResult.stores.customers.filter((customer) => customer.accountNumber === '100000001').length,
  1
);
assert.strictEqual(
  repeatedJsonImportResult.stores.payments['100000001'].history.filter((entry) => entry.id === 'payment-replaced').length,
  1
);
assert.strictEqual(repeatedJsonImportResult.imported.payment_breakdown_adjustments, 0);
assert.strictEqual(repeatedJsonImportResult.duplicatesSkipped.payment_breakdown_adjustments, 2);

const adjustmentTransfer = loadModuleBackend('billing', { required: true, fresh: true })
  .load('firstBillAdjustmentTransfer');
assert.deepStrictEqual(
  adjustmentTransfer.extractLegacyFirstBillAdjustmentRows([{
    accountNumber: '100000003',
    firstBillAdjustment: { previousBalance: '320.50', advance: '80' }
  }]),
  [{
    account_number: '100000003',
    first_bill_previous_balance: 320.5,
    first_bill_advance: 80
  }]
);
assert.deepStrictEqual(
  adjustmentTransfer.buildFirstBillAdjustmentExportRows({
    branchId: 1,
    accountNumbers: ['100000001'],
    adjustments: jsonImportResult.stores.payment_breakdown_adjustments
  }).map((row) => ({
    account_number: row.account_number,
    first_bill_previous_balance: row.first_bill_previous_balance,
    first_bill_advance: row.first_bill_advance
  })),
  [{
    account_number: '100000001',
    first_bill_previous_balance: 900,
    first_bill_advance: 25
  }]
);

const existingPaymentDuplicateResult = buildCustomerFullJsonImport({
  branchId: 1,
  stores: {
    customers: [{ accountNumber: '100000001', branchId: 1, name: 'Customer' }],
    plans: [],
    payments: {
      100000001: {
        history: [{
          id: 'existing-payment',
          accountNumber: '100000001',
          amount: 1000,
          kind: 'payment',
          fingerprint: '100000001|REFERENCE-2|payment|1000.00'
        }]
      }
    }
  },
  tables: {
    payment_entries: [{
      id: 'duplicate-payment-with-new-id',
      account_number: '100000001',
      amount: 1000,
      kind: 'payment',
      fingerprint: '100000001|REFERENCE-2|payment|1000.00'
    }]
  }
});
assert.strictEqual(existingPaymentDuplicateResult.imported.payment_entries, 0);
assert.strictEqual(existingPaymentDuplicateResult.duplicatesSkipped.payment_entries, 1);
assert.strictEqual(existingPaymentDuplicateResult.stores.payments['100000001'].history.length, 1);
assert(existingPaymentDuplicateResult.warnings.some((message) => message.includes('duplicate payment')));
console.log('PASS JSON full customer import merge and storage dispatch');

const customerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/customer-management/backend/customers.js'),
  'utf8'
);
assert(customerSource.includes("router.post('/import-client-corrections'"));
assert(customerSource.includes('warningRecords: Array.from(warningDetailsByRow.values())'));
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
assert(layoutSource.includes('First-bill adjustments: ${Number(imported.payment_breakdown_adjustments || 0)}'));
assert(layoutSource.includes('PON: ${Number(imported.pon_nap_connections || 0)}'));
assert(layoutSource.includes('Duplicates skipped: ${duplicateCount}'));
assert(layoutSource.includes("fetch('/api/system-backup/export'"));
assert(layoutSource.includes("fetch('/api/import/customers-full'"));
assert(layoutSource.includes('Full-system backup downloaded: all application records and uploaded files are in one archive.'));
console.log('PASS web-app canonical Customer stylesheet reference');
console.log('CUSTOMER MANAGEMENT COMPATIBILITY PASSED');
