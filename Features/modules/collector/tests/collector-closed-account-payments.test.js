const assert = require('assert/strict');
const fs = require('fs');
const express = require('express');

const COLLECTOR = {
  id: 'collector-1',
  username: 'collector.one',
  name: 'Collector One',
  role: 'Collector',
  branchId: '1',
  isActive: true
};
const OTHER_COLLECTOR = {
  id: 'collector-2',
  username: 'collector.two',
  name: 'Collector Two',
  role: 'Collector',
  branchId: '1',
  isActive: true
};
const INACTIVE_COLLECTOR = {
  id: 'collector-inactive',
  username: 'collector.inactive',
  name: 'Inactive Collector',
  role: 'Collector',
  branchId: '1',
  isActive: false
};
const ADMIN = {
  id: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'Admin',
  branchId: '1'
};

const closedRecord = (accountNumber, customerName, areaName, overrides = {}) => ({
  id: `closure-${accountNumber}`,
  branchId: '1',
  accountNumber,
  customerName,
  contactNumber: '09170000000',
  planName: 'Prepaid 800',
  areaName,
  closureDate: '2026-08-26',
  reason: 'Permanent disconnection',
  state: 'closed',
  active: true,
  balanceBefore: 1600,
  balanceTreatment: 'keep',
  writeOffAmount: 0,
  finalBalance: 1600,
  closedAt: '2026-08-26T08:00:00.000Z',
  closedBy: ADMIN,
  createdAt: '2026-08-26T08:00:00.000Z',
  updatedAt: '2026-08-26T08:00:00.000Z',
  auditHistory: [],
  ...overrides
});

const stores = {
  customers: [
    {
      accountNumber: 'ACC-CLOSED',
      name: 'Closed North Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Prepaid 800',
      planAmount: 800,
      planCategory: 'prepaid',
      planBilling: 'Prepaid'
    },
    {
      accountNumber: 'ACC-OTHER',
      name: 'Closed South Client',
      area: 'South Area',
      branchId: '1',
      planName: 'Postpaid 800',
      planAmount: 800,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    },
    {
      accountNumber: 'ACC-RACE',
      name: 'Closed Race Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Postpaid 800',
      planAmount: 800,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    },
    {
      accountNumber: 'ACC-REOPENED',
      name: 'Reopened Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Postpaid 800',
      planAmount: 800,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    },
    {
      accountNumber: 'ACC-NORMAL',
      name: 'Normal Excluded Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Postpaid 800',
      planAmount: 800,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    },
    {
      accountNumber: 'ACC-PENDING',
      name: 'Pre-close Pending Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Postpaid 800',
      planAmount: 800,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    },
    {
      accountNumber: 'ACC-GCASH-CLOSED',
      name: 'Official Proof Client',
      area: 'North Area',
      branchId: '1',
      planName: 'Postpaid 500',
      planAmount: 500,
      planCategory: 'postpaid',
      planBilling: 'Postpaid'
    }
  ],
  collectors: {
    assignments: {
      'North Area': ['collector-1'],
      'South Area': ['collector-2']
    }
  },
  payments: {
    'ACC-NORMAL': {
      history: [{
        id: 'normal-payment-1',
        accountNumber: 'ACC-NORMAL',
        amount: 100,
        date: '2026-08-25',
        kind: 'payment',
        type: 'credit',
        direction: 'credit',
        reference: 'NORMAL-REF-1',
        description: 'Billing Month: August 2026',
        recordedAt: '2026-08-25T08:00:00+08:00',
        recordedBy: { id: 'collector-1', role: 'Collector' },
        status: 'approved',
        paymentMethod: 'Cash'
      }]
    },
    'ACC-PENDING': {
      history: [{
        id: 'normal-pending-before-closure',
        accountNumber: 'ACC-PENDING',
        amount: 800,
        date: '2026-08-25',
        kind: 'payment',
        type: 'credit',
        direction: 'credit',
        reference: 'PRE-CLOSE-PENDING-1',
        description: 'Billing Month: August 2026',
        recordedAt: '2026-08-25T08:00:00+08:00',
        recordedBy: { id: 'collector-1', role: 'Collector' },
        status: 'pending_approval',
        paymentMethod: 'Cash'
      }]
    }
  },
  collector_remittances: { records: [] },
  collector_client_exclusions: {
    version: 1,
    branches: {
      1: {
        records: ['ACC-CLOSED', 'ACC-OTHER', 'ACC-RACE', 'ACC-NORMAL', 'ACC-PENDING', 'ACC-GCASH-CLOSED'].map((accountNumber) => ({
          id: `exclusion-${accountNumber}`,
          branchId: '1',
          accountNumber,
          active: true,
          auditHistory: []
        }))
      }
    }
  },
  closed_customer_accounts: {
    version: 1,
    branches: {
      1: {
        records: [
          closedRecord('ACC-CLOSED', 'Closed North Client', 'North Area', {
            reason: 'SECRET-ONLY-REASON'
          }),
          closedRecord('ACC-OTHER', 'Closed South Client', 'South Area', {
            balanceBefore: 800,
            finalBalance: 800
          }),
          closedRecord('ACC-RACE', 'Closed Race Client', 'North Area', {
            balanceBefore: 800,
            finalBalance: 800
          }),
          closedRecord('ACC-PENDING', 'Pre-close Pending Client', 'North Area', {
            balanceBefore: 800,
            finalBalance: 800
          }),
          closedRecord('ACC-GCASH-CLOSED', 'Official Proof Client', 'North Area', {
            balanceBefore: 500,
            finalBalance: 500
          }),
          closedRecord('ACC-REOPENED', 'Reopened Client', 'North Area', {
            active: false,
            reopenedAt: '2026-08-26T10:00:00.000Z'
          })
        ]
      }
    }
  },
  gcash_transaction_history: { version: 2, branches: {} }
};

const startingBalances = new Map([
  ['ACC-CLOSED', 1600],
  ['ACC-OTHER', 800],
  ['ACC-RACE', 800],
  ['ACC-REOPENED', 800],
  ['ACC-NORMAL', 800],
  ['ACC-PENDING', 800],
  ['ACC-GCASH-CLOSED', 500]
]);
const refreshEvents = [];
const paymentRecordReadOptions = [];

function replaceModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
}

function effectiveBalance(accountNumber) {
  const history = stores.payments?.[accountNumber]?.history || [];
  const approvedCredits = history
    .filter((entry) => String(entry?.direction || '').toLowerCase() === 'credit')
    .filter((entry) => ['approved', 'posted', 'completed'].includes(String(entry?.status || '').toLowerCase()))
    .reduce((sum, entry) => sum + Math.abs(Number(entry?.amount) || 0), 0);
  return Number(((startingBalances.get(accountNumber) || 0) - approvedCredits).toFixed(2));
}

replaceModule('../../../../core/data/data-store', {
  readJson: async (key, fallback) => structuredClone(stores[key] ?? fallback),
  writeJson: async (key, payload) => {
    stores[key] = structuredClone(payload);
  }
});
replaceModule('../../../../core/data/db', {
  query: async () => {
    throw new Error('Relational query must not run in JSON-mode coverage.');
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => false
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => [ADMIN, COLLECTOR, OTHER_COLLECTOR, INACTIVE_COLLECTOR]
});
replaceModule('../../billing/backend/payment-numbering', {
  assignEntryNumbers: async () => {},
  assertEntryNumbersAvailable: async () => {},
  enqueuePaymentMutation: async (work) => work(),
  lockPaymentAccount: async () => {},
  withTransaction: async (work) => work({ query: async () => [[]] })
});
replaceModule('../../billing/backend/payment-service-refresh', {
  triggerBranchServiceRefresh: (branchId, source) => refreshEvents.push({ branchId, source })
});
replaceModule('../../billing/backend/payment-records', {
  buildPaymentRecordForAccount: async (accountNumber, branchId, options = {}) => {
    paymentRecordReadOptions.push({ accountNumber, branchId, ...options });
    if (!startingBalances.has(accountNumber)) return null;
    const endingBalance = effectiveBalance(accountNumber);
    return {
      accountNumber,
      endingBalance,
      paymentBreakdownEndingBalance: endingBalance,
      currentBalance: endingBalance,
      billingSummary: { endingBalance },
      history: stores.payments?.[accountNumber]?.history || []
    };
  }
});
replaceModule('../../billing/backend/account-closure-service', {
  BALANCE_EPSILON: 0.005,
  getCanonicalAccountClosureBalance: async (accountNumber) => ({
    record: { accountNumber },
    balance: effectiveBalance(accountNumber)
  })
});

const gcashHistoryModulePath = require.resolve('../../billing/backend/gcash-transaction-history-store');
delete require.cache[gcashHistoryModulePath];
const actualGcashHistoryStore = require(gcashHistoryModulePath);

const routerPath = require.resolve('../backend/collector-payments');
delete require.cache[routerPath];
const collectorPaymentsRouter = require(routerPath);

async function run() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.get('x-test-actor');
    if (actor === 'admin') req.user = { ...ADMIN };
    else if (actor === 'other') req.collector = { ...OTHER_COLLECTOR };
    else if (actor === 'inactive') req.collector = { ...INACTIVE_COLLECTOR };
    else req.collector = { ...COLLECTOR };
    next();
  });
  app.use('/payments', collectorPaymentsRouter);
  app.use((error, req, res, next) => {
    void req;
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || null });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/payments`;
  const request = async (path = '', options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    return { status: response.status, body: await response.json() };
  };
  const payment = (overrides = {}) => ({
    amount: 600,
    date: '2026-08-26',
    recordedAt: '2026-08-26T15:00:00+08:00',
    reference: 'CLOSED-REF-1',
    paymentMethod: 'Cash',
    kind: 'payment',
    clientPaymentId: 'closed-local-1',
    closureId: 'closure-ACC-CLOSED',
    description: 'Collected at customer request',
    ...overrides
  });

  try {
    assert.equal((await request('/closed-accounts')).status, 400);

    const reasonOnlySearch = await request('/closed-accounts?search=SECRET');
    assert.equal(reasonOnlySearch.status, 200);
    assert.equal(reasonOnlySearch.body.records.length, 0, 'closure reasons must not be searchable by collectors');

    const assignedSearch = await request('/closed-accounts?search=Closed&limit=20');
    assert.equal(assignedSearch.status, 200);
    assert.deepEqual(
      assignedSearch.body.records.map((record) => record.accountNumber).sort(),
      ['ACC-CLOSED', 'ACC-GCASH-CLOSED', 'ACC-RACE'],
      'search must exclude other areas and reopened accounts'
    );
    assert.equal(assignedSearch.body.records[0].accountRemainsClosed, true);

    const otherAreaSearch = await request('/closed-accounts?search=South', {
      headers: { 'x-test-actor': 'other' }
    });
    assert.deepEqual(otherAreaSearch.body.records.map((record) => record.accountNumber), ['ACC-OTHER']);

    assert.equal((await request('/closed-accounts?search=Closed', {
      headers: { 'x-test-actor': 'admin' }
    })).status, 403);
    assert.equal((await request('/closed-accounts?search=Closed', {
      headers: { 'x-test-actor': 'inactive' }
    })).status, 403);

    const genericBypass = await request('/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment())
    });
    assert.equal(genericBypass.status, 409);
    assert.equal(genericBypass.body.code, 'COLLECTOR_PAYMENT_ACCOUNT_CLOSED');
    assert.match(genericBypass.body.error, /closed account collection/i);

    const reservedMarker = await request('/ACC-NORMAL', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'NORMAL-SPOOF-1',
        clientPaymentId: 'normal-spoof-1',
        description: 'Closed Account Collection | spoof'
      }))
    });
    assert.equal(reservedMarker.status, 400);

    const wrongArea = await request('/closed-accounts/ACC-OTHER', {
      method: 'POST',
      body: JSON.stringify(payment({ reference: 'OTHER-REF-1', clientPaymentId: 'other-local-1' }))
    });
    assert.equal(wrongArea.status, 409);
    assert.match(wrongArea.body.error, /assignment changed.*search/i);

    const missingClosureId = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'CLOSED-NO-CLOSURE-1',
        clientPaymentId: 'closed-no-closure-1',
        closureId: ''
      }))
    });
    assert.equal(missingClosureId.status, 400);
    assert.match(missingClosureId.body.error, /closureId is required/i);

    const staleLifecycle = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'CLOSED-STALE-LIFECYCLE-1',
        clientPaymentId: 'closed-stale-lifecycle-1',
        closureId: 'closure-OLD'
      }))
    });
    assert.equal(staleLifecycle.status, 409);
    assert.match(staleLifecycle.body.error, /lifecycle changed/i);

    const electronicCollection = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'CLOSED-GCASH-1',
        clientPaymentId: 'closed-gcash-1',
        paymentMethod: 'GCash'
      }))
    });
    assert.equal(electronicCollection.status, 400);
    assert.match(electronicCollection.body.error, /cash only/i);

    const branchWideDuplicate = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'NORMAL-REF-1',
        clientPaymentId: 'closed-cross-account-ref'
      }))
    });
    assert.equal(branchWideDuplicate.status, 409);
    assert.match(branchWideDuplicate.body.error, /reference already exists/i);

    const pendingBeforeClosureSearch = await request('/closed-accounts?search=ACC-PENDING');
    assert.equal(pendingBeforeClosureSearch.body.records[0].paymentAllowed, false);
    assert.match(pendingBeforeClosureSearch.body.records[0].collectionBlockedReason, /collector payment.*awaiting/i);
    const pendingBeforeClosureCapture = await request('/closed-accounts/ACC-PENDING', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'CLOSED-AFTER-NORMAL-PENDING-1',
        clientPaymentId: 'closed-after-normal-pending-1',
        closureId: 'closure-ACC-PENDING'
      }))
    });
    assert.equal(pendingBeforeClosureCapture.status, 409);
    const pendingBeforeClosureApproval = await request('/approvals/normal-pending-before-closure/approve', {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(pendingBeforeClosureApproval.status, 409);
    assert.match(pendingBeforeClosureApproval.body.error, /captured before.*closed/i);
    assert.equal(stores.payments['ACC-PENDING'].history[0].status, 'pending_approval');

    const submitted = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        description: 'Closed Account Collection | Closure ID: spoofed | unsafe detail'
      }))
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.status, 'pending_approval');
    assert.equal(submitted.body.closedAccountCollection, true);
    assert.equal(submitted.body.accountRemainsClosed, true);
    assert.equal(submitted.body.serviceAction, 'none');
    assert.equal(submitted.body.billingAction, 'none');
    assert.equal(submitted.body.paymentAllowed, false);
    assert.equal(stores.payments['ACC-CLOSED'].history.length, 1, 'prepaid closed collection must not create a renewal debit');
    assert.match(stores.payments['ACC-CLOSED'].history[0].description, /^Closed Account Collection \| Closure ID:/);
    assert.doesNotMatch(stores.payments['ACC-CLOSED'].history[0].description, /spoofed|unsafe detail/i);
    assert.equal(refreshEvents.length, 0, 'closed collection submission must not trigger service refresh');
    assert.equal(stores.collector_remittances.records.length, 1);
    assert.equal(
      paymentRecordReadOptions.at(-1)?.applyQueuedReferrals,
      false,
      'closed payment receipt balance must not allocate queued referrals'
    );

    const remittanceAfterSubmission = await request('/remittances');
    assert.equal(remittanceAfterSubmission.status, 200);
    assert.equal(remittanceAfterSubmission.body.records[0].payments[0].closedAccountCollection, true);
    assert.equal(remittanceAfterSubmission.body.records[0].payments[0].clientPaymentId, 'closed-local-1');
    assert.equal(
      remittanceAfterSubmission.body.records[0].payments[0].closedAccountClosureId,
      'closure-ACC-CLOSED'
    );

    const automaticClosedRemittance = stores.collector_remittances.records[0];
    const automaticClosedRemittanceStatus = automaticClosedRemittance.status;
    automaticClosedRemittance.status = 'remitted';
    automaticClosedRemittance.archivedAt = '2026-08-27T08:00:00.000Z';
    stores.collector_remittances.records.push({
      id: 'archived-normal-remittance',
      collectorId: 'collector-1',
      collectorName: 'Collector One',
      branchId: '1',
      archivedAt: '2026-08-27T08:00:00.000Z',
      payments: [{
        paymentEntryId: 'normal-payment-1',
        accountNumber: 'ACC-NORMAL',
        reference: 'NORMAL-REF-1',
        amount: 100
      }]
    });
    const archivedHiddenByDefault = await request('/remittances');
    assert.equal(archivedHiddenByDefault.body.records.length, 0);
    const archivedClosedHistory = await request('/remittances?includeArchivedClosed=true');
    assert.deepEqual(
      archivedClosedHistory.body.records.map((record) => record.id),
      [automaticClosedRemittance.id],
      'collector history may retain archived closed collections but not normal archived remittances'
    );

    const protectedClosedRemittanceDelete = await request(
      `/remittances/${encodeURIComponent(automaticClosedRemittance.id)}/delete`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({ reason: 'Attempted archived cleanup.' })
      }
    );
    assert.equal(protectedClosedRemittanceDelete.status, 409);
    assert.match(protectedClosedRemittanceDelete.body.error, /permanent collection history/i);
    assert.equal(stores.collector_remittances.records.length, 2);
    assert.equal(stores.collector_remittances.deletedRecords, undefined);

    const replay = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment())
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(stores.payments['ACC-CLOSED'].history.length, 1);
    assert.equal(stores.collector_remittances.records[0].payments.length, 1);
    assert.equal(
      stores.collector_remittances.records.length,
      2,
      'an exact retry must not create another remittance after the original was confirmed and archived'
    );
    const persistedAutomaticRemittance = stores.collector_remittances.records
      .find((record) => record.id === automaticClosedRemittance.id);
    delete persistedAutomaticRemittance.archivedAt;
    persistedAutomaticRemittance.status = automaticClosedRemittanceStatus;
    stores.collector_remittances.records.pop();

    const duplicatePending = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'CLOSED-REF-2',
        clientPaymentId: 'closed-local-2'
      }))
    });
    assert.equal(duplicatePending.status, 409);
    assert.match(duplicatePending.body.error, /awaiting admin approval/i);

    const approved = await request(`/approvals/${encodeURIComponent(submitted.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.record.closedAccountCollection, true);
    assert.equal(effectiveBalance('ACC-CLOSED'), 1000);
    assert.equal(refreshEvents.length, 0, 'closed collection approval must not refresh or reconnect service');
    const closureAfterApproval = stores.closed_customer_accounts.branches['1'].records
      .find((record) => record.accountNumber === 'ACC-CLOSED');
    assert.equal(closureAfterApproval.active, true);
    assert.equal(closureAfterApproval.state, 'closed');
    assert.equal(stores.collector_client_exclusions.branches['1'].records
      .find((record) => record.accountNumber === 'ACC-CLOSED').active, true);

    const liveAfterPartial = await request('/closed-accounts?search=ACC-CLOSED');
    assert.equal(liveAfterPartial.body.records[0].currentBalance, 1000);
    assert.equal(liveAfterPartial.body.records[0].paymentAllowed, true);

    const overpayment = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        amount: 1000.01,
        reference: 'CLOSED-OVERPAY-1',
        clientPaymentId: 'closed-overpay-1'
      }))
    });
    assert.equal(overpayment.status, 409);
    assert.match(overpayment.body.error, /exceeds.*current balance/i);

    const finalPayment = await request('/closed-accounts/ACC-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        amount: 1000,
        reference: 'CLOSED-FINAL-1',
        clientPaymentId: 'closed-final-1'
      }))
    });
    assert.equal(finalPayment.status, 201);
    const finalApproval = await request(`/approvals/${encodeURIComponent(finalPayment.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(finalApproval.status, 200);
    assert.equal(effectiveBalance('ACC-CLOSED'), 0);
    const paidSearch = await request('/closed-accounts?search=ACC-CLOSED');
    assert.equal(paidSearch.body.records[0].currentBalance, 0);
    assert.equal(paidSearch.body.records[0].paymentAllowed, false);
    assert.match(paidSearch.body.records[0].collectionBlockedReason, /no retained balance/i);

    const racePayment = await request('/closed-accounts/ACC-RACE', {
      method: 'POST',
      body: JSON.stringify(payment({
        amount: 800,
        reference: 'RACE-REF-1',
        clientPaymentId: 'race-local-1',
        closureId: 'closure-ACC-RACE'
      }))
    });
    assert.equal(racePayment.status, 201);
    const raceClosure = stores.closed_customer_accounts.branches['1'].records
      .find((record) => record.accountNumber === 'ACC-RACE');
    raceClosure.id = 'closure-ACC-RACE-2';
    const staleLifecycleApproval = await request(`/approvals/${encodeURIComponent(racePayment.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(staleLifecycleApproval.status, 409);
    assert.match(staleLifecycleApproval.body.error, /lifecycle changed/i);
    assert.equal(stores.payments['ACC-RACE'].history
      .find((entry) => entry.id === racePayment.body.id).status, 'pending_approval');
    raceClosure.id = 'closure-ACC-RACE';
    stores.payments['ACC-RACE'].history.push({
      id: 'admin-credit-before-approval',
      amount: 500,
      date: '2026-08-26',
      kind: 'payment',
      direction: 'credit',
      reference: 'ADMIN-CREDIT-1',
      description: 'Admin payment',
      recordedAt: '2026-08-26T16:00:00+08:00',
      recordedBy: { id: 'admin-1', role: 'Admin' },
      status: 'approved',
      paymentMethod: 'Cash'
    });
    const blockedApproval = await request(`/approvals/${encodeURIComponent(racePayment.body.id)}/approve`, {
      method: 'POST',
      headers: { 'x-test-actor': 'admin' },
      body: JSON.stringify({})
    });
    assert.equal(blockedApproval.status, 409);
    assert.match(blockedApproval.body.error, /exceeds.*current balance/i);
    assert.equal(stores.payments['ACC-RACE'].history
      .find((entry) => entry.id === racePayment.body.id).status, 'pending_approval');

    const reopenedSubmit = await request('/closed-accounts/ACC-REOPENED', {
      method: 'POST',
      body: JSON.stringify(payment({
        reference: 'REOPENED-REF-1',
        clientPaymentId: 'reopened-local-1'
      }))
    });
    assert.equal(reopenedSubmit.status, 409);

    const closedReceipt = await request('/reprint?accountNumber=ACC-CLOSED&reference=CLOSED-REF-1');
    assert.equal(closedReceipt.status, 200);
    assert.equal(closedReceipt.body.closedAccountCollection, true);
    assert.equal(closedReceipt.body.accountRemainsClosed, true);
    assert.equal(
      paymentRecordReadOptions.at(-1)?.applyQueuedReferrals,
      false,
      'closed receipt reprint balance must remain side-effect-free'
    );
    const excludedNormalReceipt = await request('/reprint?accountNumber=ACC-NORMAL&reference=NORMAL-REF-1');
    assert.equal(excludedNormalReceipt.status, 404);

    await actualGcashHistoryStore.importGcashTransactionBatch({
      branchId: 1,
      fileName: 'closed-account-official-gcash.pdf',
      pdfSha256: '9'.repeat(64),
      parsed: {
        title: 'GCash Transaction History',
        statementFrom: '2026-08-26',
        statementTo: '2026-08-26',
        transactions: [{
          reference: 'GCASH-CLOSED-CASH-1',
          transactionAt: '2026-08-26 09:30:00',
          transactionDate: '2026-08-26',
          description: 'Transfer from 09111111111 to 09361565251',
          sender: '09111111111',
          recipient: '09361565251',
          debit: null,
          credit: 500,
          balance: 500,
          status: 'received',
          pageNumber: 1
        }]
      },
      importedBy: ADMIN
    });
    const officialGcashCashSubmission = await request('/closed-accounts/ACC-GCASH-CLOSED', {
      method: 'POST',
      body: JSON.stringify(payment({
        amount: 500,
        reference: 'GCASH-CLOSED-CASH-1',
        clientPaymentId: 'closed-official-gcash-cash-1',
        closureId: 'closure-ACC-GCASH-CLOSED'
      }))
    });
    assert.equal(officialGcashCashSubmission.status, 201);
    const officialGcashCashApproval = await request(
      `/approvals/${encodeURIComponent(officialGcashCashSubmission.body.id)}/approve`,
      {
        method: 'POST',
        headers: { 'x-test-actor': 'admin' },
        body: JSON.stringify({})
      }
    );
    assert.equal(officialGcashCashApproval.status, 409);
    assert.equal(
      officialGcashCashApproval.body.code,
      'CLOSED_ACCOUNT_OFFICIAL_GCASH_REQUIRES_BILLING'
    );
    assert.match(officialGcashCashApproval.body.error, /official Billing\/GCash workflow/i);
    assert.equal(
      stores.payments['ACC-GCASH-CLOSED'].history
        .find((entry) => entry.id === officialGcashCashSubmission.body.id).status,
      'pending_approval'
    );
    const officialGcashHistory = await actualGcashHistoryStore.listGcashTransactionHistory({
      branchId: 1,
      all: true
    });
    assert.equal(
      officialGcashHistory.transactions
        .find((transaction) => (
          actualGcashHistoryStore.normalizeReference(transaction.reference)
          === actualGcashHistoryStore.normalizeReference('GCASH-CLOSED-CASH-1')
        )).assignment,
      null,
      'the Collector cash entry must not claim the official imported GCash credit'
    );

    const collectorPaymentsSource = fs.readFileSync(require.resolve('../backend/collector-payments'), 'utf8');
    const relationalLookupSource = collectorPaymentsSource.slice(
      collectorPaymentsSource.indexOf('async function findRelationalCollectorPaymentSubmission'),
      collectorPaymentsSource.indexOf('function getRemittanceActor')
    );
    assert.doesNotMatch(
      relationalLookupSource,
      /AND account_number = \?/,
      'relational duplicate-reference lookup must be branch-wide, matching JSON storage behavior'
    );
    assert.match(relationalLookupSource, /WHERE branch_id = \?[\s\S]*LOWER\(COALESCE\(reference/);
    assert.match(
      collectorPaymentsSource,
      /function mapReceiptPaymentRow\(row\)[\s\S]*accountNumber:\s*row\?\.accountNumber\s*\|\|\s*row\?\.account_number/,
      'relational replay matching must preserve the row account number'
    );
    assert.doesNotMatch(collectorPaymentsSource, /closedAccountCollectionSubmissionQueue|collectorPaymentApprovalMutationQueue/);
    assert.match(collectorPaymentsSource, /enqueueCollectorPaymentMutation\(\(\) => \(\s*submitCollectorPayment/);
    const collectorAdminSource = fs.readFileSync(require.resolve('../web/js/collectors-page'), 'utf8');
    assert.match(collectorAdminSource, /function closedAccountCollectionBadge/);
    assert.match(collectorAdminSource, /CLOSED ACCOUNT/);

    console.log('PASS search-only assigned closed accounts, Cash-only capture, official-GCash handoff, retry-safe shared mutation queue, branch-wide duplicate safety, archived history, approval race guard, no prepaid renewal/service refresh, and exact closed receipt reprint');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
