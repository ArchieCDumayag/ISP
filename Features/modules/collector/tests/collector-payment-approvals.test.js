const assert = require('assert/strict');
const crypto = require('crypto');
const express = require('express');
const { EventEmitter } = require('events');
const { isEffectivePaymentEntryStatus } = require('../../billing/backend/payment-entry-normalizer');

const ADMIN = {
  id: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'Admin',
  branchId: 'branch-1'
};
const COLLECTOR = {
  id: 'collector-1',
  username: 'collector.one',
  name: 'Collector One',
  role: 'Collector',
  branchId: 'branch-1'
};
const GCASH_ADMIN = {
  id: 'admin-gcash-1',
  username: 'admin.gcash',
  name: 'GCash Admin',
  role: 'Admin',
  branchId: 1
};
const GCASH_COLLECTOR = {
  id: 'collector-gcash-1',
  username: 'collector.gcash',
  name: 'GCash Collector',
  role: 'Collector',
  branchId: 1
};

const stores = {
  customers: [{
    accountNumber: 'ACC-100',
    name: 'Approval Test Client',
    area: 'North Area',
    branchId: 'branch-1',
    planName: 'Postpaid 1000',
    planAmount: 1000,
    planBilling: 'Postpaid'
  }, {
    accountNumber: 'ACC-GCASH',
    name: 'GCash Approval Client',
    area: 'GCash Area',
    branchId: 1,
    planName: 'Postpaid 1000',
    planAmount: 1000,
    planBilling: 'Postpaid'
  }, {
    accountNumber: 'ACC-PREPAID',
    name: 'Prepaid Approval Client',
    area: 'North Area',
    branchId: 'branch-1',
    planName: 'Prepaid 400',
    planAmount: 400,
    planBilling: 'Prepaid'
  }],
  collectors: {
    assignments: {
      'North Area': ['collector-1'],
      'GCash Area': ['collector-gcash-1']
    }
  },
  payments: {},
  collector_remittances: { records: [] },
  gcash_transaction_history: { version: 2, branches: {} }
};
let relationalReady = false;
const relationalPaymentRows = [];
const relationalReviewRows = [];
const relationalCorrectionRows = [];

async function relationalConnectionQuery(sql, params = []) {
  if (/FROM collector_payment_amount_corrections/i.test(sql)) {
    const [branchId, ...entryIds] = params;
    return [relationalCorrectionRows
      .filter((row) => String(row.branchId) === String(branchId))
      .filter((row) => entryIds.includes(row.paymentEntryId))
      .map((row) => ({
        correctionOrder: row.correctionOrder,
        correctionId: row.correctionId,
        paymentEntryId: row.paymentEntryId,
        previousAmount: row.previousAmount,
        correctedAmount: row.correctedAmount,
        correctionReason: row.reason,
        correctedAt: row.correctedAt,
        correctedByUserId: row.correctedById,
        correctedByUsername: 'admin',
        correctedByName: 'Admin User',
        correctedByRole: 'Admin'
      }))];
  }
  if (/SELECT[\s\S]+recorded_at AS recordedAt[\s\S]+FROM payment_entries[\s\S]+account_number = \?[\s\S]+direction[\s\S]+FOR UPDATE/i.test(sql)) {
    const [branchId, accountNumber, expectedStatus] = params;
    return [relationalPaymentRows
      .filter((row) => (
        String(row.branchId) === String(branchId)
        && String(row.accountNumber) === String(accountNumber)
        && String(row.status).toLowerCase() === String(expectedStatus).toLowerCase()
        && String(row.direction || '').toLowerCase() === 'debit'
      ))
      .map((row) => structuredClone(row))];
  }
  if (/SELECT account_number AS accountNumber[\s\S]+FROM payment_entries/i.test(sql)
      && !/FOR UPDATE/i.test(sql)) {
    const [branchId, entryId] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId) && String(item.id) === String(entryId)
    ));
    return [row ? [{ accountNumber: row.accountNumber }] : []];
  }
  if (/SELECT[\s\S]+FROM payment_entries[\s\S]+FOR UPDATE/i.test(sql)) {
    const [branchId, entryId] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId) && String(item.id) === String(entryId)
    ));
    return [row ? [structuredClone(row)] : []];
  }
  if (/UPDATE payment_entries[\s\S]+SET amount = \?, fingerprint = \?[\s\S]+AND id = \?/i.test(sql)) {
    const [amount, fingerprint, branchId, entryId, expectedStatus] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId)
      && String(item.id) === String(entryId)
      && String(item.status).toLowerCase() === String(expectedStatus).toLowerCase()
    ));
    if (!row) return [{ affectedRows: 0 }];
    row.amount = amount;
    row.fingerprint = fingerprint;
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE payment_entries[\s\S]+SET amount = \?,[\s\S]+fingerprint = CASE[\s\S]+AND account_number = \?[\s\S]+AND id = \?/i.test(sql)) {
    const [amount, fingerprint, branchId, accountNumber, entryId, expectedStatus] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId)
      && String(item.accountNumber) === String(accountNumber)
      && String(item.id) === String(entryId)
      && String(item.status).toLowerCase() === String(expectedStatus).toLowerCase()
      && String(item.direction || '').toLowerCase() === 'debit'
    ));
    if (!row) return [{ affectedRows: 0 }];
    row.amount = amount;
    if (!String(row.fingerprint || '').trim()) row.fingerprint = fingerprint;
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE payment_entries[\s\S]+SET amount = \?[\s\S]+AND fingerprint = \?[\s\S]+direction/i.test(sql)) {
    const [amount, branchId, accountNumber, fingerprint, expectedStatus] = params;
    let affectedRows = 0;
    relationalPaymentRows.forEach((row) => {
      if (
        String(row.branchId) === String(branchId)
        && String(row.accountNumber) === String(accountNumber)
        && String(row.fingerprint || '') === String(fingerprint || '')
        && String(row.status).toLowerCase() === String(expectedStatus).toLowerCase()
        && String(row.direction || '').toLowerCase() === 'debit'
      ) {
        row.amount = amount;
        affectedRows += 1;
      }
    });
    return [{ affectedRows }];
  }
  if (/UPDATE payment_entries[\s\S]+SET status = \?[\s\S]+AND account_number = \?[\s\S]+AND id = \?/i.test(sql)) {
    const [status, branchId, accountNumber, entryId, expectedStatus] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId)
      && String(item.accountNumber) === String(accountNumber)
      && String(item.id) === String(entryId)
      && String(item.status).toLowerCase() === String(expectedStatus).toLowerCase()
      && String(item.direction || '').toLowerCase() === 'debit'
    ));
    if (!row) return [{ affectedRows: 0 }];
    row.status = status;
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE payment_entries[\s\S]+AND id = \?/i.test(sql)) {
    const [status, branchId, entryId, expectedStatus] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId)
      && String(item.id) === String(entryId)
      && String(item.status).toLowerCase() === String(expectedStatus).toLowerCase()
    ));
    if (!row) return [{ affectedRows: 0 }];
    row.status = status;
    return [{ affectedRows: 1 }];
  }
  if (/UPDATE payment_entries[\s\S]+fingerprint = \?/i.test(sql)) {
    const [status, branchId, accountNumber, fingerprint, expectedStatus] = params;
    let affectedRows = 0;
    relationalPaymentRows.forEach((row) => {
      if (
        String(row.branchId) === String(branchId)
        && String(row.accountNumber) === String(accountNumber)
        && String(row.fingerprint || '') === String(fingerprint || '')
        && String(row.status).toLowerCase() === String(expectedStatus).toLowerCase()
      ) {
        row.status = status;
        affectedRows += 1;
      }
    });
    return [{ affectedRows }];
  }
  if (/INSERT INTO collector_payment_reviews/i.test(sql)) {
    relationalReviewRows.push({
      paymentEntryId: params[0],
      branchId: params[1],
      accountNumber: params[2],
      status: params[3],
      reason: params[4],
      reviewedById: params[6]
    });
    return [{ affectedRows: 1 }];
  }
  if (/INSERT INTO collector_payment_amount_corrections/i.test(sql)) {
    relationalCorrectionRows.push({
      correctionOrder: relationalCorrectionRows.length + 1,
      correctionId: params[0],
      paymentEntryId: params[1],
      branchId: params[2],
      accountNumber: params[3],
      previousAmount: params[4],
      correctedAmount: params[5],
      reason: params[6],
      correctedAt: params[7],
      correctedById: params[8]
    });
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected relational transaction query: ${sql}`);
}

function replaceModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
}

replaceModule('../../../../core/data/data-store', {
  readJson: async (key, fallback) => structuredClone(stores[key] ?? fallback),
  writeJson: async (key, payload) => {
    stores[key] = structuredClone(payload);
  }
});
replaceModule('../../../../core/data/db', {
  query: async (sql, params = []) => {
    if (relationalReady && /CREATE TABLE IF NOT EXISTS collector_payment_reviews/i.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    if (relationalReady && /CREATE TABLE IF NOT EXISTS collector_payment_amount_corrections/i.test(sql)) {
      assert.match(sql, /correction_order BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/i);
      assert.match(sql, /corrected_at DATETIME\(3\) NOT NULL/i);
      assert.match(sql, /FOREIGN KEY \(payment_entry_id\) REFERENCES payment_entries\(id\) ON DELETE CASCADE/i);
      assert.match(sql, /ENGINE=InnoDB/i);
      return [{ affectedRows: 0 }];
    }
    if (relationalReady && /FROM collector_payment_amount_corrections/i.test(sql)) {
      const [branchId, ...entryIds] = params;
      return [relationalCorrectionRows
        .filter((row) => String(row.branchId) === String(branchId))
        .filter((row) => entryIds.includes(row.paymentEntryId))
        .map((row) => ({
          correctionOrder: row.correctionOrder,
          correctionId: row.correctionId,
          paymentEntryId: row.paymentEntryId,
          previousAmount: row.previousAmount,
          correctedAmount: row.correctedAmount,
          correctionReason: row.reason,
          correctedAt: row.correctedAt,
          correctedByUserId: row.correctedById,
          correctedByUsername: 'admin',
          correctedByName: 'Admin User',
          correctedByRole: 'Admin'
        }))];
    }
    if (relationalReady && /FROM payment_entries pe[\s\S]+LEFT JOIN customers c/i.test(sql)) {
      const [branchId, status] = params;
      return [relationalPaymentRows
        .filter((row) => String(row.branchId) === String(branchId))
        .filter((row) => String(row.status).toLowerCase() === String(status).toLowerCase())
        .map((row) => ({
          ...structuredClone(row),
          customerName: row.accountNumber === 'ACC-GCASH' ? 'GCash Approval Client' : 'Approval Test Client',
          firstName: null,
          lastName: null,
          area: row.accountNumber === 'ACC-GCASH' ? 'GCash Area' : 'North Area'
        }))];
    }
    throw new Error(`Unexpected relational query: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalReady
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => [ADMIN, COLLECTOR, GCASH_ADMIN, GCASH_COLLECTOR]
});
replaceModule('../../billing/backend/payment-numbering', {
  assignEntryNumbers: async () => {},
  assertEntryNumbersAvailable: async () => {},
  enqueuePaymentMutation: async (work) => work(),
  lockPaymentAccount: async () => {},
  withTransaction: async (work) => {
    const paymentSnapshot = structuredClone(relationalPaymentRows);
    const reviewSnapshot = structuredClone(relationalReviewRows);
    const correctionSnapshot = structuredClone(relationalCorrectionRows);
    try {
      return await work({ query: relationalConnectionQuery });
    } catch (error) {
      relationalPaymentRows.splice(0, relationalPaymentRows.length, ...paymentSnapshot);
      relationalReviewRows.splice(0, relationalReviewRows.length, ...reviewSnapshot);
      relationalCorrectionRows.splice(0, relationalCorrectionRows.length, ...correctionSnapshot);
      throw error;
    }
  }
});
replaceModule('../../billing/backend/payment-service-refresh', {
  triggerBranchServiceRefresh: () => {}
});
replaceModule('../../billing/backend/payment-records', {
  buildPaymentRecordForAccount: async () => ({
    endingBalance: 1000,
    paymentBreakdownEndingBalance: 1000,
    currentBalance: 1000,
    history: []
  })
});

const gcashHistoryModulePath = require.resolve('../../billing/backend/gcash-transaction-history-store');
delete require.cache[gcashHistoryModulePath];
const actualGcashHistoryStore = require(gcashHistoryModulePath);
let failNextCollectorGcashFinalize = false;
replaceModule('../../billing/backend/gcash-transaction-history-store', {
  ...actualGcashHistoryStore,
  finalizeGcashTransactionAssignment: async (payload) => {
    if (failNextCollectorGcashFinalize) {
      failNextCollectorGcashFinalize = false;
      throw new Error('Simulated GCash finalization interruption');
    }
    return actualGcashHistoryStore.finalizeGcashTransactionAssignment(payload);
  }
});

const routerPath = require.resolve('../backend/collector-payments');
delete require.cache[routerPath];
const collectorPaymentsRouter = require(routerPath);

async function run() {
  const firstRemittanceResponse = new EventEmitter();
  firstRemittanceResponse.writableFinished = false;
  firstRemittanceResponse.end = function endResponse() {
    this.writableFinished = true;
    this.emit('finish');
  };
  const secondRemittanceResponse = new EventEmitter();
  secondRemittanceResponse.writableFinished = false;
  secondRemittanceResponse.end = function endResponse() {
    this.writableFinished = true;
    this.emit('finish');
  };
  let firstRemittanceStarted = false;
  let secondRemittanceStarted = false;
  const firstRemittanceMutation = collectorPaymentsRouter.serializeCollectorRemittanceMutationRequest(
    { method: 'POST' },
    firstRemittanceResponse,
    (error) => {
      if (error) throw error;
      firstRemittanceStarted = true;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(firstRemittanceStarted, true);
  firstRemittanceResponse.emit('close');
  const secondRemittanceMutation = collectorPaymentsRouter.serializeCollectorRemittanceMutationRequest(
    { method: 'POST' },
    secondRemittanceResponse,
    (error) => {
      if (error) throw error;
      secondRemittanceStarted = true;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    secondRemittanceStarted,
    false,
    'an early socket close must not release an active remittance mutation'
  );
  firstRemittanceResponse.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondRemittanceStarted, true);
  secondRemittanceResponse.end();
  await Promise.all([firstRemittanceMutation, secondRemittanceMutation]);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.get('x-test-actor');
    if (actor === 'admin') req.user = { ...ADMIN };
    else if (actor === 'admin-gcash') req.user = { ...GCASH_ADMIN };
    else if (actor === 'collector-gcash') req.collector = { ...GCASH_COLLECTOR };
    else req.collector = { ...COLLECTOR };
    next();
  });
  app.use('/payments', collectorPaymentsRouter);
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || null });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/payments`;

  async function request(path = '', options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    return {
      status: response.status,
      body: await response.json()
    };
  }

  const payment = {
    amount: 1000,
    date: '2026-08-09',
    recordedAt: '2026-08-09T09:30:00+08:00',
    reference: 'COL-REF-001',
    paymentMethod: 'Cash',
    kind: 'payment',
    clientPaymentId: 'local-payment-001'
  };

  try {
    const submitted = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify(payment)
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.status, 'pending_approval');
    assert.equal(submitted.body.created, true);
    assert.equal(isEffectivePaymentEntryStatus(submitted.body), false);

    const storedAfterSubmit = stores.payments['ACC-100'].history;
    assert.equal(storedAfterSubmit.length, 1);
    assert.equal(storedAfterSubmit[0].status, 'pending_approval');
    assert.equal(stores.collector_remittances.records.length, 1);
    assert.equal(stores.collector_remittances.records[0].status, 'pending');
    assert.equal(stores.collector_remittances.records[0].autoBatch, true);
    assert.equal(stores.collector_remittances.records[0].payments.length, 1);
    assert.equal(stores.collector_remittances.records[0].payments[0].paymentEntryId, submitted.body.id);

    const replay = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify(payment)
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.id, submitted.body.id);
    assert.equal(stores.payments['ACC-100'].history.length, 1);
    assert.equal(stores.collector_remittances.records[0].payments.length, 1);

    const conflictingDuplicate = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify({ ...payment, amount: 900 })
    });
    assert.equal(conflictingDuplicate.status, 409);
    assert.equal(stores.payments['ACC-100'].history.length, 1);

    const pending = await request('/approvals', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.records.length, 1);
    assert.equal(pending.body.records[0].id, submitted.body.id);
    assert.equal(pending.body.records[0].amountEditable, true);

    const collectorCannotCorrectAmount = await request(
      `/approvals/${encodeURIComponent(submitted.body.id)}/amount`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          expectedAmount: 1000,
          amount: 850,
          reason: 'Collector entered the wrong Cash amount.'
        })
      }
    );
    assert.equal(collectorCannotCorrectAmount.status, 403);

    const correctionNeedsReason = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/amount`, {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ expectedAmount: 1000, amount: 850 })
    });
    assert.equal(correctionNeedsReason.status, 400);

    const correctionRejectsFractionalCent = await request(
      `/approvals/${encodeURIComponent(submitted.body.id)}/amount`,
      {
        method: 'PATCH',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({
          expectedAmount: 1000,
          amount: '850.005',
          reason: 'Invalid precision must not be rounded silently.'
        })
      }
    );
    assert.equal(correctionRejectsFractionalCent.status, 400);

    const staleCorrection = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/amount`, {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 900,
        amount: 850,
        reason: 'Stale Admin view must not overwrite the current amount.'
      })
    });
    assert.equal(staleCorrection.status, 409);
    assert.equal(staleCorrection.body.code, 'COLLECTOR_PAYMENT_AMOUNT_STALE');

    const corrected = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/amount`, {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 1000,
        amount: 850,
        reason: 'Collector entered 1000 instead of the counted Cash amount.'
      })
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.record.amount, 850);
    assert.equal(corrected.body.record.status, 'pending_approval');
    assert.equal(corrected.body.record.amountCorrection.previousAmount, 1000);
    assert.equal(corrected.body.record.amountCorrection.correctedAmount, 850);
    assert.equal(corrected.body.record.amountCorrection.correctedBy.id, 'admin-1');
    assert.equal(corrected.body.record.amountCorrectionCount, 1);
    assert.equal(isEffectivePaymentEntryStatus(corrected.body.record), false);

    const correctedStored = stores.payments['ACC-100'].history.find((entry) => entry.id === submitted.body.id);
    assert.equal(correctedStored.amount, 850);
    assert.equal(correctedStored.status, 'pending_approval');
    assert.equal(correctedStored.fingerprint, 'acc-100|col-ref-001|payment|1000.00');
    assert.equal(correctedStored.amountCorrections.length, 1);
    assert.equal(correctedStored.amountCorrections[0].reason, 'Collector entered 1000 instead of the counted Cash amount.');

    const remittanceAfterCorrection = await request('/remittances', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(remittanceAfterCorrection.status, 200);
    assert.equal(remittanceAfterCorrection.body.records[0].paymentSummary.pendingAmount, 850);
    assert.equal(remittanceAfterCorrection.body.records[0].paymentSummary.totalAmount, 850);
    assert.equal(
      stores.collector_remittances.records[0].payments[0].amount,
      1000,
      'the captured remittance snapshot remains unchanged while hydration uses the correction'
    );

    const originalUploadRetryAfterCorrection = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify(payment)
    });
    assert.equal(originalUploadRetryAfterCorrection.status, 200);
    assert.equal(originalUploadRetryAfterCorrection.body.replayed, true);
    assert.equal(originalUploadRetryAfterCorrection.body.id, submitted.body.id);
    assert.equal(originalUploadRetryAfterCorrection.body.amount, 850);
    assert.equal(stores.payments['ACC-100'].history.length, 1);

    const pendingAfterCorrection = await request('/approvals', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(pendingAfterCorrection.status, 200);
    assert.equal(pendingAfterCorrection.body.records[0].amount, 850);
    assert.equal(pendingAfterCorrection.body.records[0].originalAmount, 1000);
    assert.equal(pendingAfterCorrection.body.records[0].amountCorrectionCount, 1);

    const collectorCannotApprove = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/approve`, {
      method: 'POST'
    });
    assert.equal(collectorCannotApprove.status, 403);

    const approved = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.record.status, 'approved');
    assert.equal(approved.body.record.reviewedBy.id, 'admin-1');
    assert.equal(stores.payments['ACC-100'].history[0].status, 'approved');
    assert.equal(isEffectivePaymentEntryStatus(stores.payments['ACC-100'].history[0]), true);

    const secondApproval = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(secondApproval.status, 409);

    const approvedAmountCannotChange = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/amount`, {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 850,
        amount: 800,
        reason: 'Approved payments must be immutable.'
      })
    });
    assert.equal(approvedAmountCannotChange.status, 409);
    assert.equal(approvedAmountCannotChange.body.code, 'COLLECTOR_PAYMENT_AMOUNT_NOT_PENDING');

    const rejectCandidate = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify({
        ...payment,
        reference: 'COL-REF-002',
        clientPaymentId: 'local-payment-002'
      })
    });
    assert.equal(rejectCandidate.status, 201);

    const rejectWithoutReason = await request(`/approvals/${encodeURIComponent(rejectCandidate.body.id)}/reject`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(rejectWithoutReason.status, 400);

    const rejected = await request(`/approvals/${encodeURIComponent(rejectCandidate.body.id)}/reject`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Reference could not be verified.' })
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.record.status, 'rejected');
    assert.equal(rejected.body.record.decisionReason, 'Reference could not be verified.');

    const rejectedEntry = stores.payments['ACC-100'].history.find((entry) => entry.id === rejectCandidate.body.id);
    assert.equal(rejectedEntry.status, 'rejected');
    assert.equal(rejectedEntry.reviewedBy.id, 'admin-1');
    assert.equal(rejectedEntry.decisionReason, 'Reference could not be verified.');
    assert.equal(isEffectivePaymentEntryStatus(rejectedEntry), false);

    const queueAfterDecisions = await request('/approvals', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(queueAfterDecisions.status, 200);
    assert.equal(queueAfterDecisions.body.records.length, 0);

    const combinedCandidate = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify({
        ...payment,
        reference: 'COL-REF-003',
        clientPaymentId: 'local-payment-003'
      })
    });
    assert.equal(combinedCandidate.status, 201);
    assert.equal(combinedCandidate.body.status, 'pending_approval');
    assert.equal(stores.collector_remittances.records.length, 1);
    assert.equal(stores.collector_remittances.records[0].payments.length, 3);

    const pendingRemittances = await request('/remittances', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(pendingRemittances.status, 200);
    assert.equal(pendingRemittances.body.records.length, 1);
    assert.equal(pendingRemittances.body.records[0].paymentSummary.pending, 1);
    assert.equal(pendingRemittances.body.records[0].paymentSummary.approved, 1);
    assert.equal(pendingRemittances.body.records[0].paymentSummary.rejected, 1);

    const remittanceId = pendingRemittances.body.records[0].id;
    const pendingCannotArchive = await request(`/remittances/${encodeURIComponent(remittanceId)}/archive`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(pendingCannotArchive.status, 409);
    assert.equal(stores.collector_remittances.records[0].archivedAt, undefined);

    const collectorCannotConfirm = await request(`/remittances/${encodeURIComponent(remittanceId)}/confirm`, {
      method: 'POST'
    });
    assert.equal(collectorCannotConfirm.status, 403);

    const blockedRemittance = await request(`/remittances/${encodeURIComponent(remittanceId)}/confirm`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ note: 'Daily cash verified.' })
    });
    assert.equal(blockedRemittance.status, 409);
    assert.match(blockedRemittance.body.error, /Complete Customer Payment Approval/i);
    const combinedBeforeApproval = stores.payments['ACC-100'].history.find((entry) => entry.id === combinedCandidate.body.id);
    assert.equal(combinedBeforeApproval.status, 'pending_approval');
    assert.equal(isEffectivePaymentEntryStatus(combinedBeforeApproval), false);
    assert.equal(stores.collector_remittances.records[0].status, 'pending');

    const separatelyApproved = await request(`/approvals/${encodeURIComponent(combinedCandidate.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(separatelyApproved.status, 200);
    assert.equal(separatelyApproved.body.record.status, 'approved');

    const confirmedRemittance = await request(`/remittances/${encodeURIComponent(remittanceId)}/confirm`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ note: 'Daily cash verified.' })
    });
    assert.equal(confirmedRemittance.status, 200);
    assert.equal(confirmedRemittance.body.record.status, 'remitted');
    assert.equal(confirmedRemittance.body.paymentApproval.approved, 0);
    assert.equal(confirmedRemittance.body.paymentApproval.alreadyApproved, 2);
    assert.equal(confirmedRemittance.body.paymentApproval.pending, 0);
    assert.equal(confirmedRemittance.body.record.totalAmount, 1850);
    assert.equal(confirmedRemittance.body.record.rejectedTotalAmount, 1000);
    assert.equal(confirmedRemittance.body.record.adminNote, 'Daily cash verified.');
    const combinedStored = stores.payments['ACC-100'].history.find((entry) => entry.id === combinedCandidate.body.id);
    assert.equal(combinedStored.status, 'approved');
    assert.equal(isEffectivePaymentEntryStatus(combinedStored), true);

    const confirmedReplay = await request(`/remittances/${encodeURIComponent(remittanceId)}/confirm`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(confirmedReplay.status, 200);
    assert.equal(confirmedReplay.body.replayed, true);

    const collectorCannotArchive = await request(`/remittances/${encodeURIComponent(remittanceId)}/archive`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.equal(collectorCannotArchive.status, 403);

    const archivedRemittance = await request(`/remittances/${encodeURIComponent(remittanceId)}/archive`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(archivedRemittance.status, 200);
    assert.equal(archivedRemittance.body.replayed, false);
    assert.equal(archivedRemittance.body.record.status, 'remitted');
    assert.ok(archivedRemittance.body.record.archivedAt);
    assert.equal(archivedRemittance.body.record.archivedBy.id, 'admin-1');
    assert.equal(archivedRemittance.body.record.totalAmount, 1850);
    assert.equal(archivedRemittance.body.record.payments.length, 3);
    assert.equal(archivedRemittance.body.record.archiveHistory.length, 1);
    assert.equal(archivedRemittance.body.record.archiveHistory[0].action, 'archived');

    const collectorArchivedList = await request('/remittances');
    assert.equal(collectorArchivedList.status, 200);
    assert.equal(collectorArchivedList.body.records.length, 0);
    const adminArchivedList = await request('/remittances', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(adminArchivedList.status, 200);
    assert.equal(adminArchivedList.body.records.length, 1);
    assert.ok(adminArchivedList.body.records[0].archivedAt);

    const archivedReplay = await request(`/remittances/${encodeURIComponent(remittanceId)}/archive`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(archivedReplay.status, 200);
    assert.equal(archivedReplay.body.replayed, true);
    assert.equal(archivedReplay.body.record.archiveHistory.length, 1);

    const restoredRemittance = await request(`/remittances/${encodeURIComponent(remittanceId)}/restore`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(restoredRemittance.status, 200);
    assert.equal(restoredRemittance.body.replayed, false);
    assert.equal(restoredRemittance.body.record.status, 'remitted');
    assert.equal(restoredRemittance.body.record.archivedAt, null);
    assert.equal(restoredRemittance.body.record.totalAmount, 1850);
    assert.equal(restoredRemittance.body.record.payments.length, 3);
    assert.equal(restoredRemittance.body.record.archiveHistory.length, 2);
    assert.equal(restoredRemittance.body.record.archiveHistory[1].action, 'restored');
    assert.equal(restoredRemittance.body.record.restoredBy.id, 'admin-1');

    const collectorRestoredList = await request('/remittances');
    assert.equal(collectorRestoredList.status, 200);
    assert.equal(collectorRestoredList.body.records.length, 1);

    const paymentsBeforeBatchDeletion = structuredClone(stores.payments);
    const activeCannotBeDeleted = await request(`/remittances/${encodeURIComponent(remittanceId)}/delete`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Old remittance batch cleanup.' })
    });
    assert.equal(activeCannotBeDeleted.status, 409);
    assert.match(activeCannotBeDeleted.body.error, /only an archived remittance/i);

    const archivedForDeletion = await request(`/remittances/${encodeURIComponent(remittanceId)}/archive`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(archivedForDeletion.status, 200);

    const collectorCannotDelete = await request(`/remittances/${encodeURIComponent(remittanceId)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Collector cannot delete this batch.' })
    });
    assert.equal(collectorCannotDelete.status, 403);

    const deletionReasonRequired = await request(`/remittances/${encodeURIComponent(remittanceId)}/delete`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(deletionReasonRequired.status, 400);
    assert.match(deletionReasonRequired.body.error, /deletion reason is required/i);

    const deletedRemittance = await request(`/remittances/${encodeURIComponent(remittanceId)}/delete`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Duplicate archived office copy.' })
    });
    assert.equal(deletedRemittance.status, 200);
    assert.equal(deletedRemittance.body.replayed, false);
    assert.equal(deletedRemittance.body.deletion.remittanceId, remittanceId);
    assert.equal(deletedRemittance.body.deletion.reason, 'Duplicate archived office copy.');
    assert.equal(deletedRemittance.body.deletion.deletedBy.id, 'admin-1');
    assert.equal(deletedRemittance.body.deletion.totalAmount, 1850);
    assert.equal(deletedRemittance.body.deletion.paymentCount, 3);
    assert.equal(stores.collector_remittances.records.length, 0);
    assert.equal(stores.collector_remittances.deletedRecords.length, 1);
    assert.deepEqual(stores.payments, paymentsBeforeBatchDeletion, 'deleting a batch must not modify customer payment history');

    const deletedList = await request('/remittances', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(deletedList.status, 200);
    assert.equal(deletedList.body.records.length, 0);

    const deletedReplay = await request(`/remittances/${encodeURIComponent(remittanceId)}/delete`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Duplicate archived office copy.' })
    });
    assert.equal(deletedReplay.status, 200);
    assert.equal(deletedReplay.body.replayed, true);
    assert.equal(stores.collector_remittances.deletedRecords.length, 1);

    const paymentRetryAfterBatchDeletion = await request('/ACC-100', {
      method: 'POST',
      body: JSON.stringify({
        ...payment,
        reference: 'COL-REF-003',
        clientPaymentId: 'local-payment-003'
      })
    });
    assert.equal(paymentRetryAfterBatchDeletion.status, 200);
    assert.equal(paymentRetryAfterBatchDeletion.body.replayed, true);
    assert.equal(stores.collector_remittances.records.length, 0, 'an exact payment retry must not recreate a deleted batch');

    const deletedPaymentCannotBeRemittedAgain = await request('/remittances', {
      method: 'POST',
      body: JSON.stringify({
        paymentEntryIds: [{
          paymentEntryId: combinedCandidate.body.id,
          accountNumber: 'ACC-100',
          reference: 'COL-REF-003',
          amount: 1000
        }]
      })
    });
    assert.equal(deletedPaymentCannotBeRemittedAgain.status, 409);
    assert.match(deletedPaymentCannotBeRemittedAgain.body.error, /deleted archived remittance/i);
    assert.equal(stores.collector_remittances.records.length, 0);
    assert.deepEqual(stores.payments, paymentsBeforeBatchDeletion);

    const prepaidPayment = {
      amount: 400,
      date: '2026-08-19',
      recordedAt: '2026-08-19T09:30:00+08:00',
      reference: 'PREPAID-CORRECTION-001',
      paymentMethod: 'Cash',
      kind: 'payment',
      clientPaymentId: 'prepaid-correction-001'
    };
    const prepaidSubmission = await request('/ACC-PREPAID', {
      method: 'POST',
      body: JSON.stringify(prepaidPayment)
    });
    assert.equal(prepaidSubmission.status, 201);
    const secondPrepaidPayment = {
      ...prepaidPayment,
      reference: 'PREPAID-CORRECTION-002',
      clientPaymentId: 'prepaid-correction-002'
    };
    const secondPrepaidSubmission = await request('/ACC-PREPAID', {
      method: 'POST',
      body: JSON.stringify(secondPrepaidPayment)
    });
    assert.equal(secondPrepaidSubmission.status, 201);
    assert.notEqual(secondPrepaidSubmission.body.id, prepaidSubmission.body.id);
    const prepaidHistory = stores.payments['ACC-PREPAID'].history;
    assert.equal(prepaidHistory.length, 4);
    let prepaidCredit = prepaidHistory.find((entry) => entry.id === prepaidSubmission.body.id);
    let prepaidCharge = prepaidHistory.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-001|charge|400.00'
    ));
    let secondPrepaidCredit = prepaidHistory.find((entry) => entry.id === secondPrepaidSubmission.body.id);
    let secondPrepaidCharge = prepaidHistory.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-002|charge|400.00'
    ));
    assert.ok(prepaidCharge);
    assert.ok(secondPrepaidCharge);
    assert.equal(prepaidCredit.amount, 400);
    assert.equal(prepaidCharge.amount, 400);
    assert.equal(secondPrepaidCredit.amount, 400);
    assert.equal(secondPrepaidCharge.amount, 400);
    assert.equal(prepaidCharge.recordedAt, secondPrepaidCharge.recordedAt);
    assert.notEqual(prepaidCharge.fingerprint, secondPrepaidCharge.fingerprint);

    const prepaidCorrection = await request(
      `/approvals/${encodeURIComponent(prepaidSubmission.body.id)}/amount`,
      {
        method: 'PATCH',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({
          expectedAmount: 400,
          amount: 350,
          reason: 'Counted Cash is lower than the Collector entry.'
        })
      }
    );
    assert.equal(prepaidCorrection.status, 200);
    assert.equal(prepaidCorrection.body.pairedChargeUpdated, true);
    prepaidCredit = stores.payments['ACC-PREPAID'].history.find((entry) => entry.id === prepaidSubmission.body.id);
    prepaidCharge = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-001|charge|400.00'
    ));
    secondPrepaidCredit = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.id === secondPrepaidSubmission.body.id
    ));
    secondPrepaidCharge = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-002|charge|400.00'
    ));
    assert.equal(prepaidCredit.amount, 350);
    assert.equal(prepaidCharge.amount, 350);
    assert.equal(secondPrepaidCredit.amount, 400);
    assert.equal(secondPrepaidCharge.amount, 400);
    assert.equal(prepaidCredit.fingerprint, 'acc-prepaid|prepaid-correction-001|payment|400.00');
    assert.equal(prepaidCharge.fingerprint, 'acc-prepaid|prepaid-correction-001|charge|400.00');
    assert.equal(secondPrepaidCredit.status, 'pending_approval');
    assert.equal(secondPrepaidCharge.status, 'pending_approval');
    assert.deepEqual(secondPrepaidCredit.amountCorrections || [], []);
    assert.equal(stores.payments['ACC-PREPAID'].history.length, 4);

    const prepaidOriginalRetry = await request('/ACC-PREPAID', {
      method: 'POST',
      body: JSON.stringify(prepaidPayment)
    });
    assert.equal(prepaidOriginalRetry.status, 200);
    assert.equal(prepaidOriginalRetry.body.replayed, true);
    assert.equal(stores.payments['ACC-PREPAID'].history.length, 4);

    const prepaidApproval = await request(
      `/approvals/${encodeURIComponent(prepaidSubmission.body.id)}/approve`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({})
      }
    );
    assert.equal(prepaidApproval.status, 200);
    prepaidCredit = stores.payments['ACC-PREPAID'].history.find((entry) => entry.id === prepaidSubmission.body.id);
    prepaidCharge = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-001|charge|400.00'
    ));
    secondPrepaidCredit = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.id === secondPrepaidSubmission.body.id
    ));
    secondPrepaidCharge = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.fingerprint === 'acc-prepaid|prepaid-correction-002|charge|400.00'
    ));
    assert.equal(prepaidCredit.status, 'approved');
    assert.equal(prepaidCharge.status, 'approved');
    assert.equal(secondPrepaidCredit.status, 'pending_approval');
    assert.equal(secondPrepaidCharge.status, 'pending_approval');

    secondPrepaidCharge.fingerprint = '';
    const duplicateLegacyPrepaidCharge = {
      ...structuredClone(secondPrepaidCharge),
      id: 'legacy-duplicate-prepaid-charge',
      fingerprint: ''
    };
    stores.payments['ACC-PREPAID'].history.push(duplicateLegacyPrepaidCharge);
    const ambiguousLegacyPrepaidCorrection = await request(
      `/approvals/${encodeURIComponent(secondPrepaidSubmission.body.id)}/amount`,
      {
        method: 'PATCH',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({
          expectedAmount: 400,
          amount: 375,
          reason: 'This must fail while duplicate legacy charges are unresolved.'
        })
      }
    );
    assert.equal(ambiguousLegacyPrepaidCorrection.status, 409);
    assert.equal(
      ambiguousLegacyPrepaidCorrection.body.code,
      'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS'
    );
    secondPrepaidCredit = stores.payments['ACC-PREPAID'].history.find((entry) => (
      entry.id === secondPrepaidSubmission.body.id
    ));
    const ambiguousLegacyCharges = stores.payments['ACC-PREPAID'].history.filter((entry) => (
      entry.id === secondPrepaidCharge.id || entry.id === duplicateLegacyPrepaidCharge.id
    ));
    assert.equal(secondPrepaidCredit.amount, 400);
    assert.equal(secondPrepaidCredit.amountCorrections?.length || 0, 0);
    assert.deepEqual(ambiguousLegacyCharges.map((entry) => entry.amount), [400, 400]);
    const ambiguousLegacyApproval = await request(
      `/approvals/${encodeURIComponent(secondPrepaidSubmission.body.id)}/approve`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({})
      }
    );
    assert.equal(ambiguousLegacyApproval.status, 409);
    assert.equal(ambiguousLegacyApproval.body.code, 'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS');
    const ambiguousLegacyRejection = await request(
      `/approvals/${encodeURIComponent(secondPrepaidSubmission.body.id)}/reject`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({ reason: 'Duplicate legacy pair must be resolved first.' })
      }
    );
    assert.equal(ambiguousLegacyRejection.status, 409);
    assert.equal(ambiguousLegacyRejection.body.code, 'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS');
    assert.deepEqual(
      stores.payments['ACC-PREPAID'].history
        .filter((entry) => (
          entry.id === secondPrepaidSubmission.body.id
          || entry.id === secondPrepaidCharge.id
          || entry.id === duplicateLegacyPrepaidCharge.id
        ))
        .map((entry) => entry.status),
      ['pending_approval', 'pending_approval', 'pending_approval']
    );

    relationalPaymentRows.push({
      id: 'rel-pay-001',
      branchId: 'branch-1',
      accountNumber: 'ACC-100',
      amount: 1000,
      date: '2026-08-09',
      kind: 'payment',
      direction: 'credit',
      reference: 'REL-REF-001',
      orNumber: 'OR-REL-001',
      description: 'Relational collector payment',
      type: 'credit',
      recordedAt: '2026-08-09 10:00:00',
      recordedByUserId: 'collector-1',
      recordedByUsername: 'collector.one',
      recordedByName: 'Collector One',
      recordedByRole: 'Collector',
      payer: 'Approval Test Client',
      status: 'pending_approval',
      paymentMethod: 'Cash',
      fingerprint: 'acc-100|rel-ref-001|payment|1000.00',
      xenditId: null
    });
    relationalReady = true;
    const relationalCorrection = await request('/approvals/rel-pay-001/amount', {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 1000,
        amount: 875,
        reason: 'Relational Cash count correction.'
      })
    });
    assert.equal(relationalCorrection.status, 200);
    assert.equal(relationalCorrection.body.record.amount, 875);
    assert.equal(relationalPaymentRows[0].amount, 875);
    assert.equal(relationalPaymentRows[0].fingerprint, 'acc-100|rel-ref-001|payment|1000.00');
    assert.equal(relationalCorrectionRows.length, 1);
    assert.equal(relationalCorrectionRows[0].paymentEntryId, 'rel-pay-001');
    assert.equal(relationalCorrectionRows[0].previousAmount, 1000);
    assert.equal(relationalCorrectionRows[0].correctedAmount, 875);
    assert.equal(relationalCorrectionRows[0].reason, 'Relational Cash count correction.');
    assert.equal(relationalCorrectionRows[0].correctedById, 'admin-1');
    const relationalPendingAfterCorrection = await request('/approvals', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(relationalPendingAfterCorrection.status, 200);
    assert.equal(relationalPendingAfterCorrection.body.records.length, 1);
    assert.equal(relationalPendingAfterCorrection.body.records[0].amount, 875);
    assert.equal(relationalPendingAfterCorrection.body.records[0].originalAmount, 1000);
    assert.equal(relationalPendingAfterCorrection.body.records[0].amountCorrectionCount, 1);
    assert.equal(
      relationalPendingAfterCorrection.body.records[0].amountCorrection.reason,
      'Relational Cash count correction.'
    );
    const secondRelationalCorrection = await request('/approvals/rel-pay-001/amount', {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 875,
        amount: 900,
        reason: 'Second verified Cash count correction.'
      })
    });
    assert.equal(secondRelationalCorrection.status, 200);
    assert.equal(secondRelationalCorrection.body.record.amount, 900);
    assert.equal(secondRelationalCorrection.body.record.originalAmount, 1000);
    assert.equal(secondRelationalCorrection.body.record.amountCorrectionCount, 2);
    assert.equal(
      secondRelationalCorrection.body.record.amountCorrection.reason,
      'Second verified Cash count correction.'
    );
    assert.equal(relationalPaymentRows[0].amount, 900);
    assert.equal(relationalCorrectionRows.length, 2);
    assert.equal(relationalCorrectionRows[1].previousAmount, 875);
    assert.equal(relationalCorrectionRows[1].correctedAmount, 900);
    const relationalPendingAfterSecondCorrection = await request('/approvals', {
      headers: { 'x-test-actor': 'admin' }
    });
    assert.equal(relationalPendingAfterSecondCorrection.status, 200);
    assert.equal(relationalPendingAfterSecondCorrection.body.records[0].amount, 900);
    assert.equal(relationalPendingAfterSecondCorrection.body.records[0].originalAmount, 1000);
    assert.equal(relationalPendingAfterSecondCorrection.body.records[0].amountCorrectionCount, 2);
    assert.equal(
      relationalPendingAfterSecondCorrection.body.records[0].amountCorrection.reason,
      'Second verified Cash count correction.'
    );
    const relationalApproval = await request('/approvals/rel-pay-001/approve', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(relationalApproval.status, 200);
    assert.equal(relationalPaymentRows[0].status, 'approved');
    assert.equal(relationalReviewRows.length, 1);
    assert.equal(relationalReviewRows[0].paymentEntryId, 'rel-pay-001');
    assert.equal(relationalReviewRows[0].status, 'approved');
    assert.equal(relationalReviewRows[0].reviewedById, 'admin-1');

    const ambiguousRelationalPayment = {
      id: 'rel-prepaid-ambiguous',
      branchId: 'branch-1',
      accountNumber: 'ACC-PREPAID',
      amount: 400,
      date: '2026-08-20',
      kind: 'payment',
      direction: 'credit',
      reference: 'REL-PREPAID-AMBIGUOUS',
      orNumber: null,
      description: 'Relational prepaid collector payment',
      type: 'payment',
      recordedAt: '2026-08-20 09:30:00',
      recordedByUserId: 'collector-1',
      recordedByUsername: 'collector.one',
      recordedByName: 'Collector One',
      recordedByRole: 'Collector',
      payer: 'Prepaid Approval Client',
      status: 'pending_approval',
      paymentMethod: 'Cash',
      fingerprint: 'acc-prepaid|rel-prepaid-ambiguous|payment|400.00',
      xenditId: null
    };
    const ambiguousRelationalCharge = {
      ...ambiguousRelationalPayment,
      id: 'rel-prepaid-ambiguous-charge-1',
      kind: 'charge',
      direction: 'debit',
      description: 'Prepaid renewal charge',
      type: 'debit',
      fingerprint: null
    };
    relationalPaymentRows.push(
      ambiguousRelationalPayment,
      ambiguousRelationalCharge,
      { ...ambiguousRelationalCharge, id: 'rel-prepaid-ambiguous-charge-2' }
    );
    const correctionCountBeforeAmbiguity = relationalCorrectionRows.length;
    const ambiguousRelationalCorrection = await request('/approvals/rel-prepaid-ambiguous/amount', {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 400,
        amount: 350,
        reason: 'Relational duplicate pairs must roll back without changing the ledger.'
      })
    });
    assert.equal(ambiguousRelationalCorrection.status, 409);
    assert.equal(
      ambiguousRelationalCorrection.body.code,
      'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS'
    );
    assert.equal(relationalCorrectionRows.length, correctionCountBeforeAmbiguity);
    assert.deepEqual(
      relationalPaymentRows
        .filter((entry) => String(entry.id).startsWith('rel-prepaid-ambiguous'))
        .map((entry) => entry.amount),
      [400, 400, 400]
    );
    const ambiguousRelationalApproval = await request('/approvals/rel-prepaid-ambiguous/approve', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(ambiguousRelationalApproval.status, 409);
    assert.equal(
      ambiguousRelationalApproval.body.code,
      'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS'
    );
    const ambiguousRelationalRejection = await request('/approvals/rel-prepaid-ambiguous/reject', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Duplicate relational pair must be resolved first.' })
    });
    assert.equal(ambiguousRelationalRejection.status, 409);
    assert.equal(
      ambiguousRelationalRejection.body.code,
      'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS'
    );
    assert.deepEqual(
      relationalPaymentRows
        .filter((entry) => String(entry.id).startsWith('rel-prepaid-ambiguous'))
        .map((entry) => entry.status),
      ['pending_approval', 'pending_approval', 'pending_approval']
    );
    relationalPaymentRows.find((entry) => (
      entry.id === 'rel-prepaid-ambiguous-charge-1'
    )).fingerprint = 'acc-prepaid|rel-prepaid-ambiguous|charge|400.00';
    const mixedRelationalCorrection = await request('/approvals/rel-prepaid-ambiguous/amount', {
      method: 'PATCH',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({
        expectedAmount: 400,
        amount: 350,
        reason: 'Mixed exact and legacy pairs must also remain unresolved.'
      })
    });
    assert.equal(mixedRelationalCorrection.status, 409);
    assert.equal(mixedRelationalCorrection.body.code, 'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS');
    const mixedRelationalApproval = await request('/approvals/rel-prepaid-ambiguous/approve', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(mixedRelationalApproval.status, 409);
    assert.equal(mixedRelationalApproval.body.code, 'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS');
    const mixedRelationalRejection = await request('/approvals/rel-prepaid-ambiguous/reject', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({ reason: 'Mixed duplicate pair must be resolved first.' })
    });
    assert.equal(mixedRelationalRejection.status, 409);
    assert.equal(mixedRelationalRejection.body.code, 'COLLECTOR_PAYMENT_PREPAID_PAIR_AMBIGUOUS');
    assert.deepEqual(
      relationalPaymentRows
        .filter((entry) => String(entry.id).startsWith('rel-prepaid-ambiguous'))
        .map((entry) => [entry.amount, entry.status]),
      [
        [400, 'pending_approval'],
        [400, 'pending_approval'],
        [400, 'pending_approval']
      ]
    );
    relationalReady = false;

    let gcashImportIndex = 0;
    const importOfficialGcashCredit = async (reference, amount, date) => {
      gcashImportIndex += 1;
      await actualGcashHistoryStore.importGcashTransactionBatch({
        branchId: 1,
        fileName: `collector-gcash-${gcashImportIndex}.pdf`,
        pdfSha256: String(gcashImportIndex).padStart(64, '0'),
        parsed: {
          title: 'GCash Transaction History',
          statementFrom: date,
          statementTo: date,
          transactions: [{
            reference,
            transactionAt: `${date} 09:30:00`,
            transactionDate: date,
            description: 'Transfer from 09111111111 to 09361565251',
            sender: '09111111111',
            recipient: '09361565251',
            debit: null,
            credit: amount,
            balance: amount,
            status: 'received',
            pageNumber: 1
          }]
        },
        importedBy: GCASH_ADMIN
      });
    };
    const submitCollectorGcash = (reference, amount, date, clientPaymentId) => request('/ACC-GCASH', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector-gcash' },
      body: JSON.stringify({
        amount,
        date,
        recordedAt: `${date}T09:30:00+08:00`,
        reference,
        paymentMethod: 'GCash',
        kind: 'payment',
        clientPaymentId
      })
    });
    const approveCollectorGcash = (entryId) => request(`/approvals/${encodeURIComponent(entryId)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin-gcash' },
      body: JSON.stringify({})
    });
    const findOfficialGcashTransaction = (history, reference) => (
      history.transactions.find((row) => (
        actualGcashHistoryStore.normalizeReference(row.reference)
        === actualGcashHistoryStore.normalizeReference(reference)
      ))
    );

    await importOfficialGcashCredit('GCASH-TEMP-OWNED-1', 700, '2026-08-10');
    const tempConflictSubmission = await submitCollectorGcash(
      'GCASH-TEMP-OWNED-1',
      700,
      '2026-08-10',
      'gcash-temp-owned-1'
    );
    assert.equal(tempConflictSubmission.status, 201);
    assert.equal(tempConflictSubmission.body.status, 'pending_approval');
    let gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    let officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-TEMP-OWNED-1');
    assert.equal(officialTransaction.assignment, null);
    await actualGcashHistoryStore.claimGcashTransaction({
      branchId: 1,
      reference: 'GCASH-TEMP-OWNED-1',
      submissionId: 'temp-gcash-owned-test',
      accountNumber: 'TMP0000001',
      customerName: 'Temp Customer',
      amount: 700,
      paymentDate: '2026-08-10',
      billingMonth: '2026-08',
      claimedBy: GCASH_ADMIN
    });
    const tempConflictApproval = await approveCollectorGcash(tempConflictSubmission.body.id);
    assert.equal(tempConflictApproval.status, 409);
    assert.equal(tempConflictApproval.body.code, 'GCASH_TRANSACTION_ALREADY_ASSIGNED');
    assert.equal(
      stores.payments['ACC-GCASH'].history.find((entry) => entry.id === tempConflictSubmission.body.id).status,
      'pending_approval'
    );
    const tempConflictBatch = await request('/approvals/approve-all', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin-gcash' },
      body: JSON.stringify({ entryIds: [tempConflictSubmission.body.id] })
    });
    assert.equal(tempConflictBatch.status, 200);
    assert.equal(tempConflictBatch.body.approved, 0);
    assert.equal(tempConflictBatch.body.skipped, 1);
    assert.equal(tempConflictBatch.body.firstError.code, 'GCASH_TRANSACTION_ALREADY_ASSIGNED');
    await actualGcashHistoryStore.releaseGcashTransactionClaim({
      branchId: 1,
      reference: 'GCASH-TEMP-OWNED-1',
      submissionId: 'temp-gcash-owned-test',
      accountNumber: 'TMP0000001'
    });

    await importOfficialGcashCredit('GCASH-COLLECTOR-OK-2', 800, '2026-08-11');
    const gcashSubmission = await submitCollectorGcash(
      'GCASH-COLLECTOR-OK-2',
      800,
      '2026-08-11',
      'gcash-collector-ok-2'
    );
    assert.equal(gcashSubmission.status, 201);
    const explicitGcashAmountLocked = await request(
      `/approvals/${encodeURIComponent(gcashSubmission.body.id)}/amount`,
      {
        method: 'PATCH',
        headers: { 'x-test-actor': 'admin-gcash' },
        body: JSON.stringify({
          expectedAmount: 800,
          amount: 750,
          reason: 'GCash amount must stay tied to imported history.'
        })
      }
    );
    assert.equal(explicitGcashAmountLocked.status, 409);
    assert.equal(explicitGcashAmountLocked.body.code, 'COLLECTOR_PAYMENT_AMOUNT_NOT_EDITABLE');
    assert.equal(
      stores.payments['ACC-GCASH'].history.find((entry) => entry.id === gcashSubmission.body.id).amount,
      800
    );
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-COLLECTOR-OK-2');
    assert.equal(officialTransaction.assignment, null);
    const gcashApproval = await approveCollectorGcash(gcashSubmission.body.id);
    assert.equal(gcashApproval.status, 200);
    assert.equal(gcashApproval.body.record.status, 'approved');
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-COLLECTOR-OK-2');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, gcashSubmission.body.id);
    assert.equal(stores.payments['ACC-GCASH'].history.filter((entry) => entry.id === gcashSubmission.body.id).length, 1);

    await importOfficialGcashCredit('GCASH-COLLECTOR-RETRY-3', 900, '2026-08-12');
    const retrySubmission = await submitCollectorGcash(
      'GCASH-COLLECTOR-RETRY-3',
      900,
      '2026-08-12',
      'gcash-collector-retry-3'
    );
    failNextCollectorGcashFinalize = true;
    const interruptedApproval = await approveCollectorGcash(retrySubmission.body.id);
    assert.equal(interruptedApproval.status, 409);
    assert.equal(interruptedApproval.body.code, 'COLLECTOR_GCASH_FINALIZATION_PENDING');
    const interruptedStored = stores.payments['ACC-GCASH'].history
      .find((entry) => entry.id === retrySubmission.body.id);
    assert.equal(interruptedStored.status, 'approved');
    const originalReviewedAt = interruptedStored.reviewedAt;
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-COLLECTOR-RETRY-3');
    assert.equal(officialTransaction.assignment.status, 'claimed');
    const recoveredApproval = await request('/approvals/approve-all', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin-gcash' },
      body: JSON.stringify({ entryIds: [retrySubmission.body.id] })
    });
    assert.equal(recoveredApproval.status, 200);
    assert.equal(recoveredApproval.body.approved, 1);
    assert.equal(recoveredApproval.body.skipped, 0);
    assert.equal(
      stores.payments['ACC-GCASH'].history.find((entry) => entry.id === retrySubmission.body.id).reviewedAt,
      originalReviewedAt
    );
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-COLLECTOR-RETRY-3');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, retrySubmission.body.id);

    await importOfficialGcashCredit('GCASH-COLLECTOR-RACE-4', 1000, '2026-08-13');
    const raceSubmission = await submitCollectorGcash(
      'GCASH-COLLECTOR-RACE-4',
      1000,
      '2026-08-13',
      'gcash-collector-race-4'
    );
    const concurrentApprovals = await Promise.all([
      approveCollectorGcash(raceSubmission.body.id),
      approveCollectorGcash(raceSubmission.body.id)
    ]);
    assert.deepEqual(concurrentApprovals.map((result) => result.status), [200, 200]);
    assert.equal(concurrentApprovals.filter((result) => result.body.replayed === true).length, 1);
    assert.equal(stores.payments['ACC-GCASH'].history.filter((entry) => entry.id === raceSubmission.body.id).length, 1);
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-COLLECTOR-RACE-4');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, raceSubmission.body.id);

    await importOfficialGcashCredit('GCASH-BATCH-RETRY-5', 550, '2026-08-14');
    const batchRetrySubmission = await submitCollectorGcash(
      'GCASH-BATCH-RETRY-5',
      550,
      '2026-08-14',
      'gcash-batch-retry-5'
    );
    failNextCollectorGcashFinalize = true;
    const automaticBatchRetry = await request('/approvals/approve-all', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin-gcash' },
      body: JSON.stringify({ entryIds: [batchRetrySubmission.body.id] })
    });
    assert.equal(automaticBatchRetry.status, 200);
    assert.equal(automaticBatchRetry.body.approved, 1);
    assert.equal(automaticBatchRetry.body.skipped, 0);
    assert.equal(stores.payments['ACC-GCASH'].history
      .filter((entry) => entry.id === batchRetrySubmission.body.id).length, 1);
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-BATCH-RETRY-5');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, batchRetrySubmission.body.id);

    const unimportedGcashSubmission = await submitCollectorGcash(
      'GCASH-NOT-IMPORTED-6',
      500,
      '2026-08-15',
      'gcash-not-imported-6'
    );
    const unimportedGcashApproval = await approveCollectorGcash(unimportedGcashSubmission.body.id);
    assert.equal(unimportedGcashApproval.status, 409);
    assert.equal(unimportedGcashApproval.body.code, 'GCASH_HISTORY_MATCH_REQUIRED');
    assert.equal(
      stores.payments['ACC-GCASH'].history.find((entry) => entry.id === unimportedGcashSubmission.body.id).status,
      'pending_approval'
    );

    await importOfficialGcashCredit('GCASH-MISLABELED-CASH-7', 600, '2026-08-16');
    const mislabeledSubmission = await request('/ACC-GCASH', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector-gcash' },
      body: JSON.stringify({
        amount: 600,
        date: '2026-08-16',
        recordedAt: '2026-08-16T09:30:00+08:00',
        reference: 'GCASH-MISLABELED-CASH-7',
        paymentMethod: 'Cash',
        kind: 'payment',
        clientPaymentId: 'gcash-mislabeled-cash-7'
      })
    });
    assert.equal(mislabeledSubmission.status, 201);
    const officialReferenceCashAmountLocked = await request(
      `/approvals/${encodeURIComponent(mislabeledSubmission.body.id)}/amount`,
      {
        method: 'PATCH',
        headers: { 'x-test-actor': 'admin-gcash' },
        body: JSON.stringify({
          expectedAmount: 600,
          amount: 550,
          reason: 'Official GCash-linked Cash entry must stay immutable.'
        })
      }
    );
    assert.equal(officialReferenceCashAmountLocked.status, 409);
    assert.equal(
      officialReferenceCashAmountLocked.body.code,
      'COLLECTOR_PAYMENT_AMOUNT_GCASH_IMMUTABLE'
    );
    const mislabeledApproval = await approveCollectorGcash(mislabeledSubmission.body.id);
    assert.equal(mislabeledApproval.status, 200);
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-MISLABELED-CASH-7');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, mislabeledSubmission.body.id);

    await importOfficialGcashCredit('0043891500999', 650, '2026-08-17');
    const leadingZeroRejectSubmission = await submitCollectorGcash(
      '43891500999',
      650,
      '2026-08-17',
      'gcash-leading-zero-reject-8'
    );
    assert.equal(leadingZeroRejectSubmission.status, 201);
    const leadingZeroSubmissionId = `collector-gcash-${crypto.createHash('sha256')
      .update(`1|${leadingZeroRejectSubmission.body.id}`)
      .digest('hex')
      .slice(0, 32)}`;
    await actualGcashHistoryStore.claimGcashTransaction({
      branchId: 1,
      reference: '0043891500999',
      submissionId: leadingZeroSubmissionId,
      accountNumber: 'ACC-GCASH',
      customerName: 'Main - ACC-GCASH',
      amount: 650,
      paymentDate: '2026-08-17',
      billingMonth: '2026-08',
      claimedBy: GCASH_ADMIN
    });
    const leadingZeroRejected = await request(
      `/approvals/${encodeURIComponent(leadingZeroRejectSubmission.body.id)}/reject`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin-gcash' },
        body: JSON.stringify({ reason: 'Official GCash proof was not accepted.' })
      }
    );
    assert.equal(leadingZeroRejected.status, 200);
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, '0043891500999');
    assert.equal(officialTransaction.assignment, null);

    await importOfficialGcashCredit('GCASH-RELATIONAL-9', 1100, '2026-08-18');
    relationalPaymentRows.push({
      id: 'rel-gcash-007',
      branchId: 1,
      accountNumber: 'ACC-GCASH',
      amount: 1100,
      date: '2026-08-18',
      kind: 'payment',
      direction: 'credit',
      reference: 'GCASH-RELATIONAL-9',
      orNumber: 'OR-REL-GCASH-007',
      description: 'Relational Collector GCash payment',
      type: 'payment',
      recordedAt: '2026-08-16 10:00:00',
      recordedByUserId: 'collector-gcash-1',
      recordedByUsername: 'collector.gcash',
      recordedByName: 'GCash Collector',
      recordedByRole: 'Collector',
      payer: 'GCash Approval Client',
      status: 'pending_approval',
      paymentMethod: 'GCash',
      fingerprint: 'acc-gcash|gcash-relational-7|payment|1100.00',
      xenditId: null
    });
    relationalReady = true;
    const relationalGcashApproval = await approveCollectorGcash('rel-gcash-007');
    assert.equal(relationalGcashApproval.status, 200);
    assert.equal(relationalPaymentRows.find((row) => row.id === 'rel-gcash-007').status, 'approved');
    assert.equal(relationalReviewRows.find((row) => row.paymentEntryId === 'rel-gcash-007').status, 'approved');
    gcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({ branchId: 1, all: true });
    officialTransaction = findOfficialGcashTransaction(gcashHistory, 'GCASH-RELATIONAL-9');
    assert.equal(officialTransaction.assignment.status, 'posted');
    assert.equal(officialTransaction.assignment.paymentEntryId, 'rel-gcash-007');
    relationalReady = false;

    console.log('COLLECTOR PAYMENT APPROVAL GATE PASSED');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
