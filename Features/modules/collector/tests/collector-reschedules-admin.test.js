const assert = require('assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');

const ADMIN = {
  id: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'Admin',
  branchId: 'branch-1'
};
const OTHER_ADMIN = {
  id: 'admin-2',
  username: 'other.admin',
  name: 'Other Branch Admin',
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
const UNASSIGNED_COLLECTOR = {
  id: 'collector-2',
  username: 'collector.two',
  name: 'Collector Two',
  role: 'Collector',
  branchId: 'branch-1',
  isActive: true
};

const stores = {
  customers: [{
    accountNumber: 'ACC-100',
    name: 'Test Client',
    area: 'North Area',
    branchId: 'branch-1'
  }, {
    accountNumber: 'ACC-PARTIAL',
    name: 'Partial Payment Client',
    area: 'North Area',
    branchId: 'branch-1'
  }, {
    accountNumber: 'ACC-PAID',
    name: 'Paid Schedule Client',
    area: 'North Area',
    branchId: 'branch-1'
  }],
  collectors: {
    assignments: {
      'North Area': ['collector-1']
    }
  },
  collector_followups: { records: [] },
  payments: {
    'ACC-PARTIAL': {
      history: [{
        id: 'pay-partial-1',
        amount: 400,
        date: '2026-08-09',
        kind: 'payment',
        direction: 'credit',
        reference: 'PARTIAL-REF-1',
        status: 'pending_approval',
        recordedBy: {
          id: 'collector-1',
          username: 'collector.one',
          name: 'Collector One',
          role: 'Collector'
        }
      }]
    }
  }
};
const canonicalBalances = {
  'ACC-100': 1000,
  'ACC-PARTIAL': 600,
  'ACC-PAID': 500,
  'ACC-200': 700
};
let relationalReady = false;

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
    if (!relationalReady) {
      throw new Error('Relational query should not run while JSON mode is active.');
    }
    if (/FROM customers/i.test(sql)) {
      return [[{
        accountNumber: 'ACC-200',
        customerName: 'Relational Test Client',
        area: 'North Area',
        branchId: 'branch-1'
      }]];
    }
    if (/FROM collector_assignments/i.test(sql)) {
      return [[{ collectorId: 'collector-1' }]];
    }
    throw new Error(`Unexpected relational query: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalReady
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => [ADMIN, COLLECTOR, UNASSIGNED_COLLECTOR]
});
replaceModule('../../billing/backend/payment-records', {
  buildPaymentRecordForAccount: async (accountNumber) => ({
    accountNumber,
    paymentBreakdownEndingBalance: canonicalBalances[accountNumber] ?? null
  })
});

const routerPath = require.resolve('../backend/collector-reschedules');
delete require.cache[routerPath];
const collectorReschedulesRouter = require(routerPath);

async function run() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.get('x-test-actor');
    if (actor === 'collector') req.collector = { ...COLLECTOR };
    else if (actor === 'other-admin') req.user = { ...OTHER_ADMIN };
    else req.user = { ...ADMIN };
    next();
  });
  app.use('/reschedules', collectorReschedulesRouter);
  app.use((error, req, res, next) => {
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/reschedules`;

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

  try {
    const create = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: 'ACC-100',
        collectorId: 'collector-1',
        rescheduledDate: '2026-08-10',
        preferredTime: '9:00 AM',
        result: 'Admin payment follow-up',
        notes: 'Please collect the promised payment.'
      })
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.record.collectorId, 'collector-1');
    assert.equal(create.body.record.source, 'admin');
    assert.equal(create.body.record.createdByRole, 'Admin');
    const recordId = create.body.record.id;

    const unassigned = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: 'ACC-100',
        collectorId: 'collector-2',
        rescheduledDate: '2026-08-10',
        result: 'Should fail',
        notes: 'Collector is not assigned.'
      })
    });
    assert.equal(unassigned.status, 403);

    const collectorList = await request('?status=all', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(collectorList.status, 200);
    assert.equal(collectorList.body.records.length, 1);
    assert.equal(collectorList.body.records[0].id, recordId);

    const otherBranchList = await request('?status=all', {
      headers: { 'x-test-actor': 'other-admin' }
    });
    assert.equal(otherBranchList.status, 200);
    assert.equal(otherBranchList.body.records.length, 0);

    const otherBranchEdit = await request(`/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      headers: { 'x-test-actor': 'other-admin' },
      body: JSON.stringify({ notes: 'Must not cross branch boundaries.' })
    });
    assert.equal(otherBranchEdit.status, 404);

    const collectorEdit = await request(`/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      headers: { 'x-test-actor': 'collector' },
      body: JSON.stringify({ notes: 'Collector must not edit this way.' })
    });
    assert.equal(collectorEdit.status, 403);

    const update = await request(`/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        accountNumber: 'ACC-100',
        collectorId: 'collector-1',
        rescheduledDate: '2026-08-12',
        preferredTime: 'Afternoon',
        result: 'Updated follow-up',
        notes: 'Updated Admin instructions.'
      })
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.record.rescheduledDate, '2026-08-12');
    assert.equal(update.body.record.notes, 'Updated Admin instructions.');
    assert.equal(update.body.record.updatedById, 'admin-1');

    const updatedCollectorList = await request('?status=all', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(updatedCollectorList.body.records[0].result, 'Updated follow-up');

    const remove = await request(`/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    assert.equal(remove.status, 200);
    assert.equal(remove.body.record.historyType, 'Deleted');
    assert.equal(remove.body.record.status, 'Schedule History');

    const activeAfterDelete = await request('?status=active', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(activeAfterDelete.body.records.length, 0);

    const tombstoneAfterDelete = await request('?status=all', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(tombstoneAfterDelete.body.records.length, 1);
    assert.equal(tombstoneAfterDelete.body.records[0].historyType, 'Deleted');

    const paidScheduleCreate = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: 'ACC-PAID',
        collectorId: 'collector-1',
        rescheduledDate: '2026-08-14',
        result: 'Promised payment',
        notes: 'Automatically close this schedule after full payment.'
      })
    });
    assert.equal(paidScheduleCreate.status, 201);
    canonicalBalances['ACC-PAID'] = 0;

    const activeAfterCanonicalPayment = await request('?status=active', {
      headers: { 'x-test-actor': 'collector' }
    });
    assert.equal(activeAfterCanonicalPayment.status, 200);
    assert.equal(activeAfterCanonicalPayment.body.records.length, 0);

    const paidScheduleHistory = await request('?status=all', {
      headers: { 'x-test-actor': 'collector' }
    });
    const paidRecord = paidScheduleHistory.body.records.find(
      (record) => record.id === paidScheduleCreate.body.record.id
    );
    assert.ok(paidRecord);
    assert.equal(paidRecord.status, 'Schedule History');
    assert.equal(paidRecord.historyType, 'Paid');
    assert.equal(paidRecord.archivedBy, 'System');
    assert.equal(paidRecord.auditHistory.at(-1).actorRole, 'System');
    assert.equal(paidRecord.auditHistory.at(-1).changes.endingBalance, 0);

    const invalidPartialBalance = await request('', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector' },
      body: JSON.stringify({
        clientRecordId: 'partial-followup-invalid-balance',
        accountNumber: 'ACC-PARTIAL',
        followUpType: 'partial_payment',
        paymentEntryId: 'pay-partial-1',
        amountPaid: 400,
        remainingBalance: -600,
        rescheduledDate: '2026-08-11',
        preferredTime: '3:00 PM'
      })
    });
    assert.equal(invalidPartialBalance.status, 400);

    const mismatchedPartialAmount = await request('', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector' },
      body: JSON.stringify({
        clientRecordId: 'partial-followup-invalid-amount',
        accountNumber: 'ACC-PARTIAL',
        followUpType: 'partial_payment',
        paymentEntryId: 'pay-partial-1',
        amountPaid: 500,
        remainingBalance: 500,
        rescheduledDate: '2026-08-11',
        preferredTime: '3:00 PM'
      })
    });
    assert.equal(mismatchedPartialAmount.status, 409);

    const partialCreate = await request('', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector' },
      body: JSON.stringify({
        clientRecordId: 'partial-followup-local-1',
        accountNumber: 'ACC-PARTIAL',
        followUpType: 'partial_payment',
        paymentEntryId: 'pay-partial-1',
        paymentReference: 'PARTIAL-REF-1',
        amountPaid: 400,
        remainingBalance: 600,
        rescheduledDate: '2026-08-11',
        preferredTime: '3:00 PM',
        collectorNote: 'Customer requested an afternoon visit.',
        result: 'Partial payment',
        createdAt: '2026-08-09T10:00:00+08:00'
      })
    });
    assert.equal(partialCreate.status, 201);
    assert.equal(partialCreate.body.record.followUpType, 'partial_payment');
    assert.equal(partialCreate.body.record.source, 'partial_payment');
    assert.equal(partialCreate.body.record.paymentEntryId, 'pay-partial-1');
    assert.equal(partialCreate.body.record.amountPaid, 400);
    assert.equal(partialCreate.body.record.remainingBalance, 600);
    assert.equal(partialCreate.body.record.collectorNote, 'Customer requested an afternoon visit.');
    assert.equal(partialCreate.body.record.auditHistory[0].action, 'created');
    const partialRecordId = partialCreate.body.record.id;

    const prematureResolve = await request('/resolve/ACC-PARTIAL', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector' },
      body: '{}'
    });
    assert.equal(prematureResolve.status, 409);

    const partialDuplicate = await request('', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector' },
      body: JSON.stringify({
        clientRecordId: 'partial-followup-local-1',
        accountNumber: 'ACC-PARTIAL',
        followUpType: 'partial_payment',
        paymentEntryId: 'pay-partial-1',
        paymentReference: 'PARTIAL-REF-1',
        amountPaid: 400,
        remainingBalance: 600,
        rescheduledDate: '2026-08-11',
        preferredTime: '3:00 PM',
        collectorNote: 'Customer requested an afternoon visit.'
      })
    });
    assert.equal(partialDuplicate.status, 200);
    assert.equal(partialDuplicate.body.created, false);
    assert.equal(partialDuplicate.body.record.id, partialRecordId);

    const partialEdit = await request(`/${encodeURIComponent(partialRecordId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        rescheduledDate: '2026-08-13',
        preferredTime: '5:00 PM',
        collectorNote: ''
      })
    });
    assert.equal(partialEdit.status, 200);
    assert.equal(partialEdit.body.record.rescheduledDate, '2026-08-13');
    assert.equal(partialEdit.body.record.preferredTime, '5:00 PM');
    assert.equal(partialEdit.body.record.collectorNote, '');
    assert.equal(partialEdit.body.record.notes, '');
    assert.equal(partialEdit.body.record.paymentEntryId, 'pay-partial-1');
    assert.equal(partialEdit.body.record.auditHistory.at(-1).action, 'updated');

    const partialDelete = await request(`/${encodeURIComponent(partialRecordId)}`, { method: 'DELETE' });
    assert.equal(partialDelete.status, 200);
    assert.equal(partialDelete.body.record.historyType, 'Deleted');
    assert.equal(partialDelete.body.record.auditHistory.at(-1).action, 'deleted');

    relationalReady = true;
    const relationalCreate = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: 'ACC-200',
        collectorId: 'collector-1',
        rescheduledDate: '2026-08-15',
        result: 'Relational follow-up',
        notes: 'Validate relational customer and assignment checks.'
      })
    });
    assert.equal(relationalCreate.status, 201);
    assert.equal(relationalCreate.body.record.accountNumber, 'ACC-200');
    assert.equal(relationalCreate.body.record.branchId, 'branch-1');
    relationalReady = false;

    const collectorsHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'collectors.html'), 'utf8');
    const collectorsScript = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'collectors-page.js'), 'utf8');
    assert.match(collectorsHtml, /id="collectorRescheduleFiltersToggle"[^>]+aria-expanded="false"[^>]+aria-controls="collectorRescheduleFiltersPanel"/);
    assert.match(collectorsHtml, /id="collectorRescheduleActiveFilterCount" hidden/);
    assert.match(collectorsHtml, /id="collectorRescheduleFiltersPanel" hidden/);
    assert.match(collectorsHtml, /collectorRescheduleFiltersPanel[\s\S]+collectorRescheduleSearch[\s\S]+collectorRescheduleCollectorFilter[\s\S]+collectorRescheduleStatusFilter[\s\S]+collectorRescheduleDateFilter[\s\S]+collectorRescheduleClearFilters/);
    assert.match(collectorsScript, /function countCollectorRescheduleFilters\(\)/);
    assert.match(collectorsScript, /collectorRescheduleFiltersPanel\.hidden = !collectorRescheduleFiltersPanel\.hidden/);
    assert.match(collectorsScript, /const resetCollectorReschedulePageAndRender = \(\) => \{\s*collectorReschedulePage = 1;/);

    console.log('ADMIN COLLECTOR SCHEDULE CRUD PASSED');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
