const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const customerBackend = require('../backend/customers');

const {
  buildOpeningAdjustmentEntry,
  findCustomerCreateDuplicate,
  generateAccountNumber,
  generateTemporaryPortalPassword,
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

test('admin create helpers remain explicit public contracts', () => {
  assert.equal(typeof validateAdminCustomerCreatePayload, 'function');
  assert.equal(typeof findCustomerCreateDuplicate, 'function');
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
  assertValidationError({ planId: '', planName: '' }, /plan/i);
  assertValidationError({ activationDate: '2026-02-31' }, /valid activation date/i);
  assertValidationError({ billDate: '2026-13-01' }, /valid next bill date/i);
  assertValidationError({ dueOffset: 1.5 }, /due-after days/i);
  assertValidationError({ customerStartType: 'unknown' }, /customer type/i);
  assertValidationError({ creditLimit: -1 }, /credit limit/i);
  assertValidationError({ openingPreviousBalance: -1 }, /previous balance/i);
});

test('generated account helper retries collisions and preserves the configured server prefix', () => {
  const originalRandom = Math.random;
  const randomValues = [111 / 1_000_000, 111 / 1_000_000, 112 / 1_000_000];
  Math.random = () => randomValues.shift() ?? (999999 / 1_000_000);
  try {
    assert.equal(
      generateAccountNumber(new Set(['321000111']), '321'),
      '321000112'
    );
  } finally {
    Math.random = originalRandom;
  }
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
  const createStart = backendSource.indexOf('const createCustomerRecordUnlocked = async');
  const createEnd = backendSource.indexOf('const updateCustomerRecord = async', createStart);
  const createSource = backendSource.slice(createStart, createEnd);
  const routeStart = backendSource.indexOf('// POST /api/customers - Add a new customer');
  const routeEnd = backendSource.indexOf('// PUT /api/customers/:id', routeStart);
  const routeSource = backendSource.slice(routeStart, routeEnd);

  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.match(backendSource, /const withCustomerCreateMutationLock =/);
  assert.match(backendSource, /withCustomerCreateMutationLock\(\(\) => createCustomerRecordUnlocked/);
  assert.match(createSource, /generateAccountNumber\(/);
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
  assert.match(createSource, /latestDuplicate = findCustomerCreateDuplicate/);
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
});

test('Add Customer uses guided steps, inline errors, review, and one atomic create request', () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, '../web/customers.html'),
    'utf8'
  );

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
  assert.match(page, /value=["'](?:existing|migrated)["']/i);
  assert.match(page, />Migrated customer</i);
  assert.match(page, /openingPreviousBalance\s*:/);
  assert.match(page, /openingAdvancePayment\s*:/);
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
