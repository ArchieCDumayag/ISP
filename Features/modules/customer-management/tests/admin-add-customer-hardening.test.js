const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const customerBackend = require('../backend/customers');
const { buildCustomerFullJsonImport } = require('../backend/customer-full-json-import');
const { buildPaymentRecord } = require('../../billing/backend/payment-records');

const {
  buildOpeningAdjustmentEntry,
  findCustomerCreateDuplicate,
  findCustomerOnuSerialDuplicate,
  generateAccountNumber,
  generateTemporaryPortalPassword,
  mapArchivedCustomerPayloadForJson,
  normalizeOnuSerialNumber,
  persistCustomerMysqlValuesByAccount,
  sanitizeCustomerForAdmin,
  validateAdminCustomerCreatePayload
} = customerBackend;

const validCreatePayload = Object.freeze({
  firstName: 'Maria',
  lastName: 'Santos',
  mobileRaw: '09171234567',
  email: 'maria.santos@example.test',
  street: '12 Mabini Street',
  barangay: 'San Antonio',
  municipality: 'Makati City',
  province: 'Metro Manila',
  area: 'Central',
  mapPin: '14.559500, 121.020000',
  planId: 'plan-fiber-100',
  planName: 'Fiber 100',
  planCategory: 'postpaid',
  loginUsername: 'maria.santos',
  activationDate: '2026-08-17',
  billDate: '2026-08-31',
  dueOffset: 5,
  customerStartType: 'new',
  openingPreviousBalance: 0,
  openingAdvancePayment: 0
});

const validate = (overrides = {}, existingCustomers = []) =>
  validateAdminCustomerCreatePayload(
    { ...validCreatePayload, ...overrides },
    existingCustomers
  );

const assertValidationError = (overrides, messagePattern, existingCustomers = []) => {
  assert.throws(
    () => validate(overrides, existingCustomers),
    (error) => {
      assert.ok([400, 409].includes(Number(error?.status || error?.statusCode)));
      assert.match(String(error?.message || ''), messagePattern);
      return true;
    }
  );
};

const formatLocalDateOnly = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');

test('admin create helpers remain explicit public contracts', () => {
  assert.equal(typeof validateAdminCustomerCreatePayload, 'function');
  assert.equal(typeof findCustomerCreateDuplicate, 'function');
  assert.equal(typeof generateAccountNumber, 'function');
  assert.equal(typeof generateTemporaryPortalPassword, 'function');
  assert.equal(typeof sanitizeCustomerForAdmin, 'function');
});

test('server create validation requires identity, service address, and valid contact data', () => {
  const normalized = validate();
  assert.equal(normalized.status, 'inactive');

  assertValidationError({ firstName: '' }, /first name/i);
  assertValidationError({ lastName: '' }, /last name/i);
  assertValidationError({ mobileRaw: '12345' }, /mobile|contact/i);
  assertValidationError({ email: 'not-an-email' }, /email/i);
  assertValidationError({ barangay: '' }, /barangay|address/i);
  assertValidationError({ municipality: '' }, /municipality|city|address/i);
  assertValidationError({ province: '' }, /province|address/i);
  assertValidationError({ area: '' }, /area|cluster|coverage/i);
  assertValidationError({ planId: '', planName: '' }, /plan/i);
  assertValidationError({ activationDate: '2026-02-31' }, /valid activation date/i);
  assert.doesNotThrow(() => validate({ activationDate: '2026-07-20', billDate: '2026-07-31' }));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assertValidationError({ activationDate: formatLocalDateOnly(tomorrow) }, /activation date.*later than today/i);
  assertValidationError({ billDate: '2026-13-01' }, /valid next bill date/i);
  assertValidationError({ billDate: '2026-08-30' }, /last day of the activation month/i);
  assertValidationError({ planCategory: 'prepaid', billDate: '2026-08-02' }, /first day of the activation month/i);
  assertValidationError({ dueOffset: 1.5 }, /due-after days/i);
  assertValidationError({ customerStartType: 'unknown' }, /customer type/i);
  assertValidationError({ creditLimit: -1 }, /credit limit/i);
  assertValidationError({ openingPreviousBalance: -1 }, /previous balance/i);
});

test('generated account helper follows the sequential frontier without jumping to legacy random reservations', () => {
  assert.equal(
    generateAccountNumber(
      new Set(['321000001', '321000002', '321000003', '321580792', '100999999']),
      '321'
    ),
    '321000004'
  );
  assert.equal(
    generateAccountNumber(new Set(['321580792']), '321', '321000356'),
    '321000357'
  );
  assert.equal(
    generateAccountNumber(new Set(['321000357', '321580792']), '321', '321000356'),
    '321000358'
  );
  assert.equal(generateAccountNumber(new Set(), '321'), '321000001');
  assert.throws(
    () => generateAccountNumber(new Set(), '321', '321999999'),
    /sequence.*exhausted/i
  );
});

test('server duplicate checks normalize username, mobile, and email', () => {
  const existing = [{
    accountNumber: '100000111',
    branchId: 7,
    firstName: 'Existing',
    lastName: 'Customer',
    loginUsername: 'Maria.Santos',
    mobile: '+63 917 123 4567',
    email: 'MARIA.SANTOS@EXAMPLE.TEST',
    street: '99 Existing Street',
    barangay: 'Poblacion',
    municipality: 'Makati City',
    province: 'Metro Manila'
  }];

  assert.ok(findCustomerCreateDuplicate(validCreatePayload, existing));
  assert.ok(findCustomerCreateDuplicate({
    ...validCreatePayload,
    loginUsername: 'another-user',
    email: 'another@example.test'
  }, existing));
  assert.ok(findCustomerCreateDuplicate({
    ...validCreatePayload,
    loginUsername: 'another-user',
    mobileRaw: '09179999999'
  }, existing));
  assert.equal(findCustomerCreateDuplicate({
    ...validCreatePayload,
    loginUsername: 'unique-user',
    mobileRaw: '09179999999',
    email: 'unique@example.test'
  }, existing), null);

  assertValidationError({}, /already|duplicate|used|exists/i, existing);
});

test('ONU identity is canonical, branch-scoped, and not writable through ordinary Admin payloads', () => {
  assert.equal(normalizeOnuSerialNumber('  zte f680-ab 12  '), 'ZTEF680-AB12');
  assert.throws(
    () => normalizeOnuSerialNumber('x'.repeat(161)),
    /160 characters or fewer/
  );

  const customers = [
    { accountNumber: '700000001', branchId: 7, onuSerialNumber: 'ONU-ONE' },
    { accountNumber: '800000001', branchId: 8, onuSerialNumber: 'ONU-ONE' }
  ];
  assert.equal(
    findCustomerOnuSerialDuplicate(' onu-one ', customers, 7)?.accountNumber,
    '700000001'
  );
  assert.equal(
    findCustomerOnuSerialDuplicate(' onu-one ', customers, 7, '700000001'),
    null
  );
  assert.equal(
    findCustomerOnuSerialDuplicate('new-onu', customers, 7),
    null
  );
  assert.equal(
    findCustomerOnuSerialDuplicate('legacy-onu', [
      { accountNumber: '100000001', onuSerialNumber: 'LEGACY-ONU' }
    ], 1)?.accountNumber,
    '100000001'
  );

  const normalizedAdminPayload = validate({
    onuSerialNumber: 'ADMIN-INJECTED',
    onu_serial_number: 'ADMIN-INJECTED-SNAKE',
    onuSerial: 'ADMIN-INJECTED-ALIAS'
  });
  assert.equal(Object.hasOwn(normalizedAdminPayload, 'onuSerialNumber'), false);
  assert.equal(Object.hasOwn(normalizedAdminPayload, 'onu_serial_number'), false);
  assert.equal(Object.hasOwn(normalizedAdminPayload, 'onuSerial'), false);

  const adminView = sanitizeCustomerForAdmin({
    accountNumber: '700000001',
    onuSerialNumber: 'ONU-ONE'
  });
  assert.equal(adminView.onuSerialNumber, 'ONU-ONE');
});

test('ONU serial survives legacy full JSON import and reaches the billing read model', () => {
  const result = buildCustomerFullJsonImport({
    branchId: 7,
    tables: {
      customers: [{ account_number: '700000001', name: 'Updated Customer' }]
    },
    stores: {
      customers: [{
        accountNumber: '700000001',
        branchId: 7,
        name: 'Existing Customer',
        onuSerialNumber: 'ONU-KEEP-1'
      }],
      plans: [],
      payments: {},
      tickets: [],
      jobs: [],
      sms_messages: [],
      sms_automation_runs: [],
      'pon-state': {},
      payment_breakdown_adjustments: {},
      closed_customer_accounts: { version: 1, branches: {} }
    },
    now: new Date('2026-08-27T00:00:00.000Z')
  });
  const importedCustomer = result.stores.customers.find(
    (customer) => customer.accountNumber === '700000001'
  );
  assert.equal(importedCustomer.name, 'Updated Customer');
  assert.equal(importedCustomer.onuSerialNumber, 'ONU-KEEP-1');

  const paymentRecord = buildPaymentRecord({
    accountNumber: '700000001',
    branchId: 7,
    name: 'Customer',
    planCategory: 'postpaid',
    planAmount: 999,
    onuSerialNumber: 'ONU-KEEP-1'
  });
  assert.equal(paymentRecord.onuSerialNumber, 'ONU-KEEP-1');
});

test('full JSON import rejects duplicate ONU serials inside one branch', () => {
  assert.throws(
    () => buildCustomerFullJsonImport({
      branchId: 7,
      tables: {
        customers: [
          { account_number: '700000010', onu_serial_number: 'onu duplicate' },
          { account_number: '700000011', onuSerialNumber: 'ONU DUPLICATE' }
        ]
      },
      stores: { closed_customer_accounts: { version: 1, branches: {} } }
    }),
    (error) => error?.status === 409 && error?.code === 'CUSTOMER_FULL_IMPORT_CONFLICT'
  );
});

test('account-keyed MySQL persistence never upserts a different ONU owner', async () => {
  const rows = new Map([
    ['700000001', { accountNumber: '700000001', branchId: 7, onuSerialNumber: 'ONU-OWNER' }]
  ]);
  const sqlCalls = [];
  const executeQuery = async (sql, params = []) => {
    sqlCalls.push(sql);
    if (/^SELECT account_number, branch_id FROM customers/i.test(sql.trim())) {
      const row = rows.get(params[0]);
      return [row ? [{ account_number: row.accountNumber, branch_id: row.branchId }] : []];
    }
    if (/^INSERT INTO customers/i.test(sql.trim())) {
      const accountNumber = params[0];
      const branchId = params[1];
      const onuSerialNumber = params.at(-1);
      const owner = [...rows.values()].find((row) => (
        row.branchId === branchId && row.onuSerialNumber === onuSerialNumber
      ));
      if (owner) {
        const error = new Error("Duplicate entry for key 'uniq_customers_branch_onu_serial'");
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      rows.set(accountNumber, { accountNumber, branchId, onuSerialNumber });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const customerValues = Array(42).fill(null);
  customerValues[41] = 'ONU-OWNER';

  await assert.rejects(
    persistCustomerMysqlValuesByAccount({
      executeQuery,
      accountNumber: '700000002',
      branchId: 7,
      customerValues
    }),
    (error) => error?.code === 'ER_DUP_ENTRY'
  );
  assert.deepEqual(rows.get('700000001'), {
    accountNumber: '700000001',
    branchId: 7,
    onuSerialNumber: 'ONU-OWNER'
  });
  assert.equal(rows.has('700000002'), false);
  assert.equal(sqlCalls.some((sql) => /ON DUPLICATE KEY UPDATE/i.test(sql)), false);
});

test('JSON archive reopen preserves ONU identity and detects reassignment', () => {
  const restored = mapArchivedCustomerPayloadForJson({
    account_number: '700000020',
    branch_id: 7,
    name: 'Archived Customer',
    onu_serial_number: ' onu archived-20 '
  }, 7);
  assert.equal(restored.onuSerialNumber, 'ONUARCHIVED-20');

  const duplicate = findCustomerOnuSerialDuplicate(
    restored.onuSerialNumber,
    [{ accountNumber: '700000021', branchId: 7, onuSerialNumber: 'ONUARCHIVED-20' }],
    7,
    restored.accountNumber
  );
  assert.equal(duplicate?.accountNumber, '700000021');

  const backendSource = fs.readFileSync(
    path.resolve(__dirname, '../backend/customers.js'),
    'utf8'
  );
  const restoreStart = backendSource.indexOf('const restoreArchivedCustomerRecord = async');
  const customerRestoreStart = backendSource.indexOf('const customerRow =', restoreStart);
  const jsonRestoreSource = backendSource.slice(
    backendSource.indexOf("if (!(await isRelationalReady())) {", customerRestoreStart),
    backendSource.indexOf('const pool = await getPool()', customerRestoreStart)
  );
  assert.match(jsonRestoreSource, /withCustomerCreateMutationLock/);
  assert.match(jsonRestoreSource, /findCustomerOnuSerialDuplicate\(/);
  assert.match(jsonRestoreSource, /createOnuSerialDuplicateError/);
});

test('migrated customers accept an explicit zero opening balance', () => {
  assert.doesNotThrow(() => validate({
    customerStartType: 'migrated',
    openingPreviousBalance: 0,
    openingAdvancePayment: 0
  }));
  assert.doesNotThrow(() => validate({
    customerStartType: 'existing',
    openingPreviousBalance: '0',
    openingAdvancePayment: '0'
  }));
  assertValidationError({
    customerStartType: 'migrated',
    openingPreviousBalance: 100,
    openingAdvancePayment: 50
  }, /only one|mutually exclusive|previous balance.*advance|advance.*previous balance/i);
});

test('opening adjustment helper is deterministic and models debit or credit without writing data', () => {
  const base = {
    branchId: 7,
    accountNumber: '321000112',
    effectiveDate: '2026-08-17',
    actor: { id: 'admin-1', username: 'admin', name: 'Admin User', role: 'Admin' }
  };
  assert.equal(buildOpeningAdjustmentEntry(base), null);

  const debit = buildOpeningAdjustmentEntry({ ...base, previousBalance: 125.5 });
  assert.equal(debit.kind, 'charge');
  assert.equal(debit.direction, 'debit');
  assert.equal(debit.amount, 125.5);
  assert.equal(debit.accountNumber, '321000112');
  assert.equal(debit.recordedBy.username, 'admin');
  assert.equal(
    buildOpeningAdjustmentEntry({ ...base, previousBalance: 125.5 }).id,
    debit.id
  );

  const credit = buildOpeningAdjustmentEntry({ ...base, advancePayment: 75 });
  assert.equal(credit.kind, 'payment');
  assert.equal(credit.direction, 'credit');
  assert.equal(credit.amount, 75);
  assert.equal(credit.paymentMethod, 'Opening Balance');
  assert.throws(
    () => buildOpeningAdjustmentEntry({
      ...base,
      previousBalance: 100,
      advancePayment: 50
    }),
    /only one opening amount/i
  );
});

test('portal credentials use temporary secrets and admin responses never disclose hashes or passwords', () => {
  const first = generateTemporaryPortalPassword();
  const second = generateTemporaryPortalPassword();
  assert.ok(first.length >= 12);
  assert.match(first, /[a-z]/);
  assert.match(first, /[A-Z]/);
  assert.match(first, /\d/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /^\d{9}$/);

  const secret = 'scrypt$server-only-password-hash';
  const sanitized = sanitizeCustomerForAdmin({
    accountNumber: '100000222',
    loginUsername: 'customer-222',
    loginPassword: secret,
    login_password_hash: secret
  });
  assert.equal(Object.hasOwn(sanitized, 'loginPassword'), false);
  assert.equal(Object.hasOwn(sanitized, 'login_password_hash'), false);
  assert.equal(sanitized.loginPasswordSet, true);
  assert.equal(JSON.stringify(sanitized).includes(secret), false);

  const withoutPassword = sanitizeCustomerForAdmin({
    accountNumber: '100000223',
    loginPassword: ''
  });
  assert.equal(withoutPassword.loginPasswordSet, false);
  assert.equal(Object.hasOwn(withoutPassword, 'loginPassword'), false);
});

test('create allocation, onboarding rollback, audit, and relational schema hooks stay wired', () => {
  const backendSource = fs.readFileSync(
    path.resolve(__dirname, '../backend/customers.js'),
    'utf8'
  );
  const draftStoreSource = fs.readFileSync(
    path.resolve(__dirname, '../backend/customer-draft-submissions-store.js'),
    'utf8'
  );
  const createStart = backendSource.indexOf('const createCustomerRecordUnlocked = async');
  const createEnd = backendSource.indexOf('const updateCustomerRecordUnlocked = async', createStart);
  const createSource = backendSource.slice(createStart, createEnd);
  const routeStart = backendSource.indexOf('// POST /api/customers - Add a new customer');
  const routeEnd = backendSource.indexOf('// PUT /api/customers/:id', routeStart);
  const routeSource = backendSource.slice(routeStart, routeEnd);

  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.match(backendSource, /const withCustomerCreateMutationLock =/);
  assert.match(backendSource, /withCustomerCreateMutationLock\(\(\) => createCustomerRecordUnlocked/);
  assert.match(createSource, /await reserveNextAccountNumber\(/);
  assert.match(createSource, /await recordIssuedAccountNumber\(/);
  assert.match(backendSource, /customer_account_number_sequence/);
  assert.match(backendSource, /const withAccountNumberSequenceMutationLock =/);
  assert.match(backendSource, /collectAccountNumberReservations/);
  assert.match(backendSource, /reservedAccountNumbers/);
  assert.match(backendSource, /sourceVersion >= 2/);
  assert.match(backendSource, /previewNextAccountNumber/);
  assert.match(draftStoreSource, /await reserveNextAccountNumber\(reserved, prefixId\)/);
  assert.match(createSource, /insertOnly:\s*true/);
  assert.match(createSource, /isAccountNumberDuplicateError/);
  assert.match(createSource, /CUSTOMER_CREATE_MAX_RETRIES/);
  const duplicateHelperStart = backendSource.indexOf('const isAccountNumberDuplicateError =');
  const duplicateHelperEnd = backendSource.indexOf('const buildOpeningAdjustmentEntry =', duplicateHelperStart);
  const duplicateSandbox = {};
  new vm.Script(`${backendSource.slice(duplicateHelperStart, duplicateHelperEnd)}\nthis.checkDuplicate = isAccountNumberDuplicateError;`)
    .runInNewContext(duplicateSandbox);
  assert.equal(duplicateSandbox.checkDuplicate({
    code: 'ER_DUP_ENTRY',
    message: "Duplicate entry '321000112' for key 'customers.PRIMARY'",
    sql: 'INSERT INTO customers (account_number) VALUES (?)'
  }), true);
  assert.equal(duplicateSandbox.checkDuplicate({
    code: 'ER_DUP_ENTRY',
    message: "Duplicate entry 'entry-1' for key 'payment_entries.PRIMARY'",
    sql: 'INSERT INTO payment_entries (id) VALUES (?)'
  }), false);
  assert.match(createSource, /await connection\.beginTransaction\(\)/);
  assert.match(createSource, /await connection\.commit\(\)/);
  assert.match(createSource, /await connection\.rollback\(\)/);
  assert.match(createSource, /SELECT GET_LOCK\(/);
  assert.match(createSource, /latestDuplicate = findCustomerCreateBlockingDuplicate/);
  assert.match(createSource, /\{ allowDuplicateMobile \}/);
  assert.ok(createSource.indexOf('await connection.beginTransaction()')
    < createSource.indexOf('await writeCustomers([persistedCustomer]'));
  assert.ok(createSource.indexOf('await writeCustomers([persistedCustomer]')
    < createSource.indexOf('await connection.commit()'));
  assert.ok((createSource.match(/executor:\s*connection/g) || []).length >= 4);
  assert.match(backendSource, /const executeQuery = executor \? executor\.query\.bind\(executor\) : query/);
  assert.match(
    createSource,
    /const loginPassword = ensureHashedCustomerPassword\(suppliedLoginPassword \|\| temporaryPortalPassword\)/
  );
  assert.match(createSource, /recordCustomerOpeningAdjustment/);
  assert.match(backendSource, /const recordCustomerCreateAudit = async/);
  assert.match(createSource, /auditEntry = await recordCustomerCreateAudit/);
  assert.match(createSource, /syncCustomerNapAssignment/);
  assert.match(createSource, /removeOpeningAdjustmentForRollback/);
  assert.match(createSource, /removeCustomerForOnboardingRollback/);
  assert.match(routeSource, /enforceAdminValidation:\s*true/);
  assert.match(routeSource, /allowPastBillingDates:\s*true/);
  assert.match(routeSource, /defaultStatus:\s*STATUS_INACTIVE/);
  assert.match(routeSource, /actor:\s*req\.user/);
  assert.ok(createSource.indexOf('auditEntry = await recordCustomerCreateAudit')
    < createSource.indexOf('await connection.commit()'));
  assert.match(routeSource, /auditRecorded:\s*Boolean\(onboardingResult\.auditEntry\)/);
  assert.equal(routeSource.includes('appendActivityLog'), false);
  assert.match(routeSource, /Unable to enrich newly created customer response/);
  assert.match(routeSource, /portalSetup:\s*onboardingResult\.portalSetup/);

  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../scripts/schema.sql'),
    'utf8'
  );
  const migrationSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../scripts/migrate-json-to-schema.js'),
    'utf8'
  );
  assert.match(schemaSource, /customer_start_type\s+VARCHAR\(20\)/i);
  assert.match(migrationSource, /ALTER TABLE customers ADD COLUMN customer_start_type/i);
  assert.match(schemaSource, /onu_serial_number\s+VARCHAR\(160\)\s+NULL/i);
  assert.match(schemaSource, /UNIQUE KEY uniq_customers_branch_onu_serial\s*\(branch_id, onu_serial_number\)/i);
  assert.match(migrationSource, /ADD COLUMN onu_serial_number VARCHAR\(160\)/i);
  assert.match(migrationSource, /ADD UNIQUE KEY uniq_customers_branch_onu_serial/i);

  const relationalMigrationSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../scripts/migrate-json-to-relational.js'),
    'utf8'
  );
  const restoreSource = fs.readFileSync(
    path.resolve(__dirname, '../../admin/backend/json-to-mysql-restore.js'),
    'utf8'
  );
  const serverSource = fs.readFileSync(
    path.resolve(__dirname, '../../../../server.js'),
    'utf8'
  );
  assert.match(relationalMigrationSource, /onu_serial_number/);
  const relationalCustomerUpsert = relationalMigrationSource.slice(
    relationalMigrationSource.indexOf('async function upsertCustomer'),
    relationalMigrationSource.indexOf('async function upsertPlan')
  );
  assert.doesNotMatch(relationalCustomerUpsert, /ON DUPLICATE KEY UPDATE/);
  assert.match(relationalCustomerUpsert, /UPDATE customers/);
  assert.match(relationalCustomerUpsert, /WHERE account_number = \?/);
  assert.match(relationalCustomerUpsert, /INSERT INTO customers/);
  assert.match(restoreSource, /'onu_serial_number'/);
  assert.match(restoreSource, /customerOnuSerialOwners/);
  assert.match(serverSource, /normalizeCustomerOnuSerialNumber/);
  const serverCustomerImport = serverSource.slice(
    serverSource.indexOf('for (const row of importCustomers)'),
    serverSource.indexOf('const referencedAccounts = new Set()', serverSource.indexOf('for (const row of importCustomers)'))
  );
  assert.doesNotMatch(serverCustomerImport, /ON DUPLICATE KEY UPDATE/);
  assert.match(serverCustomerImport, /UPDATE customers SET/);
  assert.match(serverCustomerImport, /WHERE account_number = \?/);
  assert.match(serverCustomerImport, /INSERT INTO customers/);
  assert.match(backendSource, /onu_serial_number AS onuSerialNumber/);
  assert.match(backendSource, /isOnuSerialDuplicateError/);
  const writeCustomerSource = backendSource.slice(
    backendSource.indexOf('const persistCustomerMysqlValuesByAccount = async'),
    backendSource.indexOf('const writeCustomers = async')
  );
  assert.doesNotMatch(writeCustomerSource, /ON DUPLICATE KEY UPDATE/);
  assert.match(writeCustomerSource, /UPDATE customers/);
  assert.match(writeCustomerSource, /WHERE account_number = \?/);
  assert.match(writeCustomerSource, /INSERT INTO customers/);
});

test('customer edits bound MikroTik waits and skip unchanged PPPoE synchronization', () => {
  const backendSource = fs.readFileSync(
    path.resolve(__dirname, '../backend/customers.js'),
    'utf8'
  );
  const updateStart = backendSource.indexOf('const updateCustomerRecordUnlocked = async');
  const updateEnd = backendSource.indexOf('const assertCustomerDeletionHasNoClosedAccountHistory', updateStart);
  const updateSource = backendSource.slice(updateStart, updateEnd);

  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  assert.match(backendSource, /const CUSTOMER_PPPOE_OPERATION_TIMEOUT_MS = 8000;/);
  assert.match(backendSource, /const CUSTOMER_PPPOE_CLOSE_TIMEOUT_MS = 1500;/);
  assert.match(backendSource, /const withCustomerOperationTimeout =/);
  assert.match(backendSource, /secretMenu\.get\(\)\.catch\(\(\) => \[\]\)[\s\S]*CUSTOMER_PPPOE_OPERATION_TIMEOUT_MS/);
  assert.match(backendSource, /updateRouterSecretProfile\(secretMenu,[\s\S]*CUSTOMER_PPPOE_OPERATION_TIMEOUT_MS/);
  assert.match(backendSource, /client\.close\(\)\.catch\(\(\) => \{\}\)[\s\S]*CUSTOMER_PPPOE_CLOSE_TIMEOUT_MS/);
  assert.match(updateSource, /const customerPppoeSyncChanged = Boolean\(/);
  assert.match(updateSource, /normalizePlanId\(activePlanId\) !== normalizePlanId\(existing\?\.planId\)/);
  assert.match(updateSource, /normalizePppoeRouterId\(nextRouterId\) !== normalizePppoeRouterId\(existingRouterId\)/);
  assert.match(updateSource, /&& customerPppoeSyncChanged\s*&& !shouldQueuePrepaidPlanChange/);
});

test('Add Customer uses a Tabler horizontal wizard, inline errors, network review, and one atomic create request', () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, '../web/customers.html'),
    'utf8'
  );
  const modalStart = page.indexOf('<div id="customerModal"');
  const modalEnd = page.indexOf('<div id="portalSetupModal"', modalStart);
  const modalMarkup = page.slice(modalStart, modalEnd);

  assert.ok(modalStart >= 0 && modalEnd > modalStart);

  [
    'customerWizardProgress',
    'customerStepCustomer',
    'customerStepBilling',
    'customerStepReview',
    'customerFormErrorSummary',
    'customerReviewSummary',
    'customerStepBackBtn',
    'customerStepNextBtn',
    'accountAllocationStatus',
    'retryAccountAllocationBtn'
  ].forEach((id) => assert.match(page, new RegExp(`id=["']${id}["']`)));

  assert.match(page, /data-customer-step-target/);
  assert.match(page, /data-customer-step/);
  assert.match(page, /data-review-field/);
  assert.match(modalMarkup, /class=["'][^"']*\bsteps\b[^"']*\bsteps-counter\b/);
  assert.equal((modalMarkup.match(/class=["'][^"']*\bstep-item\b/g) || []).length, 3);
  assert.match(modalMarkup, /class=["'][^"']*\boverflow-x-auto\b[^"']*\bflex-shrink-0\b/);
  assert.equal((modalMarkup.match(/class=["']vstack gap-3["'][^>]*data-customer-step=["'][123]["']/g) || []).length, 3);
  ['card', 'row', 'col-md-', 'form-control', 'form-select', 'input-group', 'alert', 'modal-footer']
    .forEach((className) => assert.ok(modalMarkup.includes(className), `Missing Tabler ${className} class`));
  ['pppoeRouter', 'pppoeMode', 'pppoeAccount', 'pppoeUsername', 'pppoePassword']
    .forEach((id) => assert.match(modalMarkup, new RegExp(`id=["']${id}["']`)));
  [
    'customer-wizard-progress',
    'customer-form__body',
    'customer-form-step',
    'form-card',
    'form-section',
    'form-grid',
    'form-actions',
    'customer-review-card'
  ].forEach((legacyClass) => assert.equal(modalMarkup.includes(legacyClass), false));
  assert.match(page, /value=["'](?:existing|migrated)["']/i);
  assert.match(page, />Migrated customer</i);
  assert.match(page, /openingPreviousBalance\s*:/);
  assert.match(page, /openingAdvancePayment\s*:/);
  assert.match(page, /\.\.\.\(mikrotikEnabled \? \{\s*pppoeMode:/);
  assert.match(page, /setCustomerReviewField\(['"]router['"], routerText\)/);
  assert.match(page, /setCustomerReviewField\(['"]pppoe['"], pppoeText\)/);
  assert.match(page, /stepScroller\.scrollTo\(\{ left: Math\.max\(0, centeredStepLeft\), behavior: ['"]smooth['"] \}\)/);
  assert.match(page, /const DEFAULT_CUSTOMER_PROVINCE = ['"]Cagayan['"]/);
  assert.match(page, /const DEFAULT_CUSTOMER_MUNICIPALITY = ['"]Baggao['"]/);
  assert.match(page, /const DEFAULT_CREDIT_LIMIT_MONTHS = 3;/);
  assert.match(
    page,
    /const syncDefaultCreditLimitFromSelectedPlan = \(\) => \{\s*if \(!creditLimitInput \|\| isEditMode\(\)\) return;[\s\S]*selectedPlanAmount \* DEFAULT_CREDIT_LIMIT_MONTHS/
  );
  assert.match(page, /planSelect\.addEventListener\(['"]change['"], \(\) => \{\s*syncDefaultCreditLimitFromSelectedPlan\(\);/);
  assert.match(modalMarkup, /Defaults to three months of the selected plan and can be edited\./);
  assert.match(modalMarkup, /Select today or an earlier date\. Billing dates and first-bill proration update automatically\./);
  assert.match(page, /activationDateInput\.removeAttribute\(['"]min['"]\);/);
  assert.match(page, /activationDateInput\.max = getTodayDateInputValue\(\);/);
  assert.equal(page.includes('activationDateInput.min = getTodayDateInputValue()'), false);
  assert.match(
    page,
    /activationDateInput\.addEventListener\(['"]change['"], \(\) => \{\s*enforceActivationSafeBillDateSelection\(\);\s*recomputeDueDate\(\);/
  );
  assert.match(page, /const dueValue = getPlanTypeDueDateInputValue\(category, activationValue\);/);
  assert.match(page, /const proratedAmount = daysInMonth > 0 && selectedPlanAmount > 0/);
  assert.match(page, /function isDerivedActivationCycleBillDate\(\)/);
  assert.match(page, /canKeepActivationCycle = !isEditMode\(\) && isDerivedActivationCycleBillDate\(\)/);
  assert.match(modalMarkup, /id=["']area["'][^>]*name=["']area["'][^>]*required/);
  assert.match(page, /function findCoverageAreaName\(value\)/);
  assert.match(page, /function syncAreaFromSelectedBarangay\(/);
  assert.match(page, /customerBarangaySelect\?\.addEventListener\(['"]change['"],/);
  assert.match(page, /if \(!isEditMode\(\) && areaSelectField\) areaSelectField\.value = ['"]['"]/);
  assert.match(
    page,
    /startCustomerAddressPicker\(\{\s*province: DEFAULT_CUSTOMER_PROVINCE,\s*municipality: DEFAULT_CUSTOMER_MUNICIPALITY\s*\}\)/
  );
  assert.equal(page.includes('async function postOpeningPaymentEntries('), false);
  assert.equal(
    page.includes('Enter previous balance or advance payment for the existing customer.'),
    false
  );

  const inlineScripts = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);
  inlineScripts.forEach((source, index) => {
    new vm.Script(source, { filename: `customers-inline-${index + 1}.js` });
  });
});
