const assert = require('assert/strict');
const crypto = require('crypto');
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
  loadAccounts: async () => [ADMIN, COLLECTOR, GCASH_ADMIN, GCASH_COLLECTOR]
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
    assert.equal(archivedRemittance.body.record.totalAmount, 2000);
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
    assert.equal(restoredRemittance.body.record.totalAmount, 2000);
    assert.equal(restoredRemittance.body.record.payments.length, 3);
    assert.equal(restoredRemittance.body.record.archiveHistory.length, 2);
    assert.equal(restoredRemittance.body.record.archiveHistory[1].action, 'restored');
    assert.equal(restoredRemittance.body.record.restoredBy.id, 'admin-1');

    const collectorRestoredList = await request('/remittances');
    assert.equal(collectorRestoredList.status, 200);
    assert.equal(collectorRestoredList.body.records.length, 1);

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
