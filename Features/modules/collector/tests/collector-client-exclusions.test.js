const assert = require('assert/strict');
const express = require('express');

const ADMIN = {
  id: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'Admin',
  branchId: 'branch-1'
};
const OTHER_ADMIN = {
  id: 'admin-2',
  username: 'other',
  name: 'Other Admin',
  role: 'Admin',
  branchId: 'branch-2'
};
const COLLECTOR = {
  id: 'collector-1',
  username: 'collector.one',
  name: 'Collector One',
  role: 'Collector',
  branchId: 'branch-1',
  isActive: true
};

const stores = {
  customers: [{
    accountNumber: 'ACC-100',
    name: 'Excluded Client',
    area: 'North Area',
    branchId: 'branch-1'
  }, {
    accountNumber: 'ACC-200',
    name: 'Visible Client',
    area: 'North Area',
    branchId: 'branch-1'
  }],
  collectors: { assignments: { 'North Area': ['collector-1'] } },
  collector_client_exclusions: { version: 1, branches: {} },
  collector_followups: {
    records: [{
      id: 'schedule-acc-100',
      clientRecordId: 'local-schedule-acc-100',
      branchId: 'branch-1',
      accountNumber: 'ACC-100',
      customerName: 'Excluded Client',
      area: 'North Area',
      collectorId: 'collector-1',
      collectorName: 'Collector One',
      status: 'Rescheduled',
      rescheduledDate: '2026-08-20',
      result: 'Collection follow-up',
      notes: 'Existing schedule remains stored.',
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z'
    }]
  },
  payments: {
    'ACC-100': { history: [{ id: 'pay-1', amount: 100, kind: 'payment', direction: 'credit' }] }
  }
};

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
  query: async () => {
    throw new Error('Relational query should not run in the JSON exclusion test.');
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => false
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => [ADMIN, OTHER_ADMIN, COLLECTOR]
});
replaceModule('../../billing/backend/payment-records', {
  buildPaymentRecordForAccount: async (accountNumber) => ({
    accountNumber,
    paymentBreakdownEndingBalance: 1000
  })
});

const exclusionsPath = require.resolve('../backend/collector-client-exclusions');
delete require.cache[exclusionsPath];
const exclusions = require(exclusionsPath);
const collectorsPath = require.resolve('../backend/collectors');
delete require.cache[collectorsPath];
const collectorsRouter = require(collectorsPath);
const reschedulesPath = require.resolve('../backend/collector-reschedules');
delete require.cache[reschedulesPath];
const reschedulesRouter = require(reschedulesPath);

async function run() {
  const originalCustomers = structuredClone(stores.customers);
  const originalPayments = structuredClone(stores.payments);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.get('x-test-actor');
    if (actor === 'collector') req.collector = { ...COLLECTOR };
    else if (actor === 'other-admin') req.user = { ...OTHER_ADMIN };
    else if (actor === 'service') req.user = { id: 'service', role: 'Service' };
    else req.user = { ...ADMIN };
    next();
  });
  app.use('/collectors', collectorsRouter);
  app.use('/reschedules', reschedulesRouter);
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    const denied = await request('/collectors/exclusions', {
      headers: { 'x-test-actor': 'service' }
    });
    assert.equal(denied.status, 403);

    const missingSelection = await request('/collectors/exclusions', {
      method: 'POST',
      body: JSON.stringify({ accountNumbers: [] })
    });
    assert.equal(missingSelection.status, 400);

    const created = await request('/collectors/exclusions', {
      method: 'POST',
      body: JSON.stringify({ accountNumbers: ['ACC-100', 'ACC-200', 'ACC-100'] })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.count, 2);
    assert.deepEqual(created.body.records.map((record) => record.accountNumber), ['ACC-100', 'ACC-200']);
    created.body.records.forEach((record) => {
      assert.equal(record.active, true);
      assert.equal(record.reason, 'Admin decision');
      assert.equal(record.auditHistory.length, 1);
      assert.equal(record.auditHistory[0].action, 'excluded');
      assert.equal(record.auditHistory[0].actorId, ADMIN.id);
      assert.equal(record.auditHistory[0].reason, 'Admin decision');
    });

    const duplicate = await request('/collectors/exclusions', {
      method: 'POST',
      body: JSON.stringify({ accountNumbers: ['ACC-100', 'ACC-200'] })
    });
    assert.equal(duplicate.status, 409);

    const noVisibleCustomers = await exclusions.filterCollectorVisibleCustomers(stores.customers, 'branch-1');
    assert.deepEqual(noVisibleCustomers.map((customer) => customer.accountNumber), []);

    const bulkRestored = await request('/collectors/exclusions/restore', {
      method: 'POST',
      body: JSON.stringify({ accountNumbers: ['ACC-200'] })
    });
    assert.equal(bulkRestored.status, 200);
    assert.equal(bulkRestored.body.count, 1);
    assert.equal(bulkRestored.body.records[0].active, false);
    assert.equal(bulkRestored.body.records[0].restoreReason, 'Admin decision');

    const visibleCustomers = await exclusions.filterCollectorVisibleCustomers(stores.customers, 'branch-1');
    assert.deepEqual(visibleCustomers.map((customer) => customer.accountNumber), ['ACC-200']);

    const collectorSchedules = await request('/reschedules?status=all', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(collectorSchedules.status, 200);
    assert.equal(collectorSchedules.body.records.length, 0);
    assert.equal(collectorSchedules.body.tombstones.length, 1);
    assert.equal(collectorSchedules.body.tombstones[0].id, 'schedule-acc-100');

    const adminSchedules = await request('/reschedules?status=all');
    assert.equal(adminSchedules.status, 200);
    assert.equal(adminSchedules.body.records.length, 1);

    const blockedAdminSchedule = await request('/reschedules', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: 'ACC-100',
        collectorId: 'collector-1',
        rescheduledDate: '2026-08-21',
        result: 'Should not be delivered',
        notes: 'Excluded clients cannot receive new Admin schedules.'
      })
    });
    assert.equal(blockedAdminSchedule.status, 409);

    const otherBranch = await request('/collectors/exclusions', {
      headers: { 'x-test-actor': 'other-admin' }
    });
    assert.equal(otherBranch.status, 200);
    assert.equal(otherBranch.body.records.length, 0);

    const missingRestoreSelection = await request('/collectors/exclusions/restore', {
      method: 'POST',
      body: JSON.stringify({ accountNumbers: [] })
    });
    assert.equal(missingRestoreSelection.status, 400);

    const restored = await request('/collectors/exclusions/ACC-100/restore', {
      method: 'POST',
      body: JSON.stringify({})
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.record.active, false);
    assert.equal(restored.body.record.auditHistory.length, 2);
    assert.equal(restored.body.record.auditHistory[1].action, 'restored');
    assert.equal(restored.body.record.auditHistory[1].reason, 'Admin decision');

    const afterRestore = await request('/reschedules?status=active', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(afterRestore.status, 200);
    assert.equal(afterRestore.body.records.length, 1);
    assert.equal(afterRestore.body.records[0].id, 'schedule-acc-100');

    assert.deepEqual(stores.customers, originalCustomers, 'Exclusions must not edit customer records.');
    assert.deepEqual(stores.payments, originalPayments, 'Exclusions must not edit payment records.');
    console.log('PASS audited bulk Collector App exclusions/restores, branch isolation, schedule filtering, and record preservation');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
