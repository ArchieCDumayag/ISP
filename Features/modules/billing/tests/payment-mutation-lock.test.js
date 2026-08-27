const assert = require('assert/strict');
const fs = require('fs');
const { EventEmitter } = require('events');

const {
  enqueuePaymentMutation,
  lockPaymentAccount,
  serializePaymentMutationRequest
} = require('../backend/payment-numbering');
const {
  EVIDENCE_CLOSED_ACCOUNT_COLLECTION,
  EVIDENCE_CLOSURE_WRITE_OFF,
  getClosedAccountPaymentEvidenceType
} = require('../backend/closed-account-payment-evidence');

async function run() {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = enqueuePaymentMutation(async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
  });
  const second = enqueuePaymentMutation(async () => {
    order.push('second-start');
    order.push('second-end');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start'], 'payment mutations must not overlap');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);

  await assert.rejects(
    enqueuePaymentMutation(async () => {
      throw new Error('expected queue failure');
    }),
    /expected queue failure/
  );
  let recovered = false;
  await enqueuePaymentMutation(async () => {
    recovered = true;
  });
  assert.equal(recovered, true, 'a failed mutation must not poison the shared queue');

  const response = new EventEmitter();
  response.writableFinished = false;
  response.end = function endResponse() {
    this.writableFinished = true;
    this.emit('finish');
  };
  let requestStarted = false;
  const heldRequest = serializePaymentMutationRequest(
    { method: 'POST' },
    response,
    (error) => {
      if (error) throw error;
      requestStarted = true;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestStarted, true);
  response.emit('close');
  let startedAfterAbort = false;
  const afterAbort = enqueuePaymentMutation(async () => {
    startedAfterAbort = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(startedAfterAbort, false, 'an early socket close must not release an active mutation');
  response.end();
  await Promise.all([heldRequest, afterAbort]);
  assert.equal(startedAfterAbort, true);

  const queries = [];
  const connection = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return [[]];
    }
  };
  await lockPaymentAccount(connection, 1, 'ACC-LOCKED');
  assert.ok(queries.some((entry) => /SELECT payload FROM app_store[\s\S]*FOR UPDATE/i.test(entry.sql)));
  assert.ok(queries.some((entry) => String(entry.params?.[0] || '').startsWith('lock:payment-account:1:')));
  assert.equal(
    getClosedAccountPaymentEvidenceType({
      kind: 'payment',
      direction: 'credit',
      description: 'Closed Account Collection | Closure ID: closure-1'
    }),
    EVIDENCE_CLOSED_ACCOUNT_COLLECTION
  );
  assert.equal(
    getClosedAccountPaymentEvidenceType({
      id: 'closure-writeoff-abc123',
      kind: 'discount',
      direction: 'credit',
      paymentMethod: 'Account Closure Adjustment'
    }),
    EVIDENCE_CLOSURE_WRITE_OFF
  );
  assert.equal(
    getClosedAccountPaymentEvidenceType({
      id: 'closure-writeoff-debit123',
      kind: 'charge',
      direction: 'debit',
      description: 'Account closure final-balance debit | Before PHP 500.00 | Final PHP 800.00',
      paymentMethod: 'Account Closure Adjustment'
    }),
    EVIDENCE_CLOSURE_WRITE_OFF
  );

  const billingSource = fs.readFileSync(require.resolve('../backend/payments'), 'utf8');
  const numberingSource = fs.readFileSync(require.resolve('../backend/payment-numbering'), 'utf8');
  const confirmationsSource = fs.readFileSync(require.resolve('../backend/payment-confirmations'), 'utf8');
  const schedulerSource = fs.readFileSync(require.resolve('../backend/billing-scheduler'), 'utf8');
  const collectorSource = fs.readFileSync(require.resolve('../../collector/backend/collector-payments'), 'utf8');
  const customerSource = fs.readFileSync(require.resolve('../../customer-management/backend/customers'), 'utf8');
  const serverSource = fs.readFileSync(require.resolve('../../../../server'), 'utf8');
  assert.match(billingSource, /router\.use\(serializePaymentMutationRequest\)/);
  assert.match(confirmationsSource, /router\.use\(serializePaymentMutationRequest\)/);
  assert.match(
    numberingSource,
    /await ensurePaymentNumberingStore\(connection\);\s*await connection\.beginTransaction\(\);/
  );
  assert.match(
    confirmationsSource,
    /await ensurePaymentNumberingStore\(connection\);\s*await connection\.beginTransaction\(\);/
  );
  assert.match(
    customerSource,
    /await ensurePaymentNumberingStore\(connection\);\s*await connection\.beginTransaction\(\);\s*await lockPaymentAccount\(connection, scopedBranchId, targetAccountNumber\);/
  );
  assert.match(
    serverSource,
    /await ensurePaymentNumberingStore\(connection\);\s*await connection\.beginTransaction\(\);\s*for \(const accountNumber of importedAccountNumbers\)/
  );
  assert.match(billingSource, /await lockPaymentAccount\(connection, branchId, accountNumber\)/);
  assert.match(collectorSource, /return enqueuePaymentMutation\(work\)/);
  assert.match(collectorSource, /await lockPaymentAccount\(connection, branchId, targetAccountNumber\)/);
  assert.match(
    schedulerSource,
    /runMonthlyBillingOnceForBranch[\s\S]*?return enqueuePaymentMutation\(\(\) => \([\s\S]*?runMonthlyBillingForBranch/
  );
  assert.match(
    schedulerSource,
    /enforcePppoeGracePeriodForBranch[\s\S]*?return enqueuePaymentMutation\(\(\) => enforcePppoeGracePeriodForBranchUnlocked/
  );
  assert.match(customerSource, /const deleteCustomerRecord = [\s\S]*?enqueuePaymentMutation/);
  assert.match(customerSource, /await lockPaymentAccount\(connection, scopedBranchId, targetAccountNumber\)/);
  assert.match(customerSource, /CUSTOMER_DELETE_PROTECTED_CLOSED_ACCOUNT_HISTORY/);
  assert.match(customerSource, /CUSTOMER_UPDATE_ACCOUNT_CLOSED/);
  assert.match(customerSource, /closed_account_protected/);
  assert.match(billingSource, /Closed-account collection and write-off records cannot be deleted/);
  const clearRouteSource = billingSource.slice(
    billingSource.indexOf("router.delete('/clear'"),
    billingSource.indexOf("router.post('/import-excel'")
  );
  assert.match(clearRouteSource, /assertClosedAccountPaymentEvidenceNotDeleted\(entries\)/);

  console.log('PASS shared payment mutation queue, scheduler serialization, relational account lock, and closed-account mutation guards');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
