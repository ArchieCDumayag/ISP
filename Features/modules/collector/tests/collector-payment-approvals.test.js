const assert = require('assert/strict');
const express = require('express');
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

const stores = {
  customers: [{
    accountNumber: 'ACC-100',
    name: 'Approval Test Client',
    area: 'North Area',
    branchId: 'branch-1',
    planName: 'Postpaid 1000',
    planAmount: 1000,
    planBilling: 'Postpaid'
  }],
  collectors: {
    assignments: {
      'North Area': ['collector-1']
    }
  },
  payments: {},
  collector_remittances: { records: [] }
};
let relationalReady = false;
const relationalPaymentRows = [];
const relationalReviewRows = [];

async function relationalConnectionQuery(sql, params = []) {
  if (/SELECT[\s\S]+FROM payment_entries[\s\S]+FOR UPDATE/i.test(sql)) {
    const [branchId, entryId] = params;
    const row = relationalPaymentRows.find((item) => (
      String(item.branchId) === String(branchId) && String(item.id) === String(entryId)
    ));
    return [row ? [structuredClone(row)] : []];
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
  query: async (sql) => {
    if (relationalReady && /CREATE TABLE IF NOT EXISTS collector_payment_reviews/i.test(sql)) {
      return [{ affectedRows: 0 }];
    }
    throw new Error(`Unexpected relational query: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalReady
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => [ADMIN, COLLECTOR]
});
replaceModule('../../billing/backend/payment-numbering', {
  assignEntryNumbers: async () => {},
  assertEntryNumbersAvailable: async () => {},
  withTransaction: async (work) => work({ query: relationalConnectionQuery })
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

const routerPath = require.resolve('../backend/collector-payments');
delete require.cache[routerPath];
const collectorPaymentsRouter = require(routerPath);

async function run() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get('x-test-actor') === 'admin') req.user = { ...ADMIN };
    else req.collector = { ...COLLECTOR };
    next();
  });
  app.use('/payments', collectorPaymentsRouter);
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message });
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
    assert.equal(confirmedRemittance.body.record.totalAmount, 2000);
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
