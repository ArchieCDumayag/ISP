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
const COLLECTOR_ONE = {
  id: 'collector-1',
  username: 'collector.one',
  name: 'Collector One',
  role: 'Collector',
  branchId: 'branch-1',
  isActive: true
};
const COLLECTOR_TWO = {
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
    name: 'Priority Client',
    area: 'North Area',
    branchId: 'branch-1'
  }, {
    accountNumber: 'ACC-200',
    name: 'Second Client',
    area: 'South Area',
    branchId: 'branch-1'
  }, {
    accountNumber: 'ACC-250',
    name: 'Third Client',
    area: 'West Area',
    branchId: 'branch-1'
  }],
  collectors: {
    assignments: {
      'North Area': ['collector-1'],
      'South Area': ['collector-1']
    }
  },
  collector_priority_assignments: { records: [] }
};
const balances = new Map([
  ['ACC-100', 2000],
  ['ACC-200', 1000],
  ['ACC-250', 500],
  ['ACC-300', 1500]
]);
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
  query: async (sql, params = []) => {
    if (!relationalReady) throw new Error('Relational query should not run while JSON mode is active.');
    if (/FROM customers/i.test(sql)) {
      return [[{
        accountNumber: params[1],
        customerName: 'Relational Priority Client',
        area: 'North Area',
        branchId: params[0]
      }]];
    }
    throw new Error(`Unexpected relational query: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalReady
});
replaceModule('../../billing/backend/payment-records', {
  buildPaymentRecordForAccount: async (accountNumber) => ({
    accountNumber,
    paymentBreakdownEndingBalance: balances.get(accountNumber)
  })
});

const routerPath = require.resolve('../backend/collector-priorities');
delete require.cache[routerPath];
const priorityRouter = require(routerPath);

async function run() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.get('x-test-actor');
    if (actor === 'collector-1') req.collector = { ...COLLECTOR_ONE };
    else if (actor === 'collector-2') req.collector = { ...COLLECTOR_TWO };
    else req.user = { ...ADMIN };
    next();
  });
  app.use('/priorities', priorityRouter);
  app.use((error, req, res, next) => {
    void req;
    void next;
    res.status(error.status || 500).json({ ok: false, error: error.message });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/priorities`;

  async function request(path = '', options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    const created = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumbers: ['ACC-100', 'ACC-200'],
        priority: 'Urgent',
        collectionDate: '2026-08-10',
        reason: 'Large overdue balance'
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.count, 2);
    assert.equal(created.body.records.length, 2);
    assert.equal(created.body.record.priority, 'urgent');
    assert.equal(created.body.record.amountDue, 2000);
    assert.equal(created.body.record.assignmentScope, 'all_collectors');
    assert.equal(created.body.record.collectorId, '');
    assert.equal(created.body.record.auditHistory[0].action, 'created');
    const firstId = created.body.record.id;
    const secondId = created.body.records[1].id;

    const duplicate = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumbers: ['ACC-200', 'ACC-250'],
        priority: 'High',
        collectionDate: '2026-08-11',
        reason: 'Whole batch should fail on duplicate'
      })
    });
    assert.equal(duplicate.status, 409);
    assert.equal(stores.collector_priority_assignments.records.some((record) => record.accountNumber === 'ACC-250'), false);

    const collectorOneList = await request('', { headers: { 'x-test-actor': 'collector-1' } });
    assert.equal(collectorOneList.status, 200);
    assert.equal(collectorOneList.body.records.length, 2);
    assert.deepEqual(new Set(collectorOneList.body.records.map((record) => record.id)), new Set([firstId, secondId]));

    const collectorTwoList = await request('', { headers: { 'x-test-actor': 'collector-2' } });
    assert.equal(collectorTwoList.status, 200);
    assert.equal(collectorTwoList.body.records.length, 2);
    assert.deepEqual(
      collectorTwoList.body.records.map((record) => record.id),
      collectorOneList.body.records.map((record) => record.id)
    );

    const collectorCreate = await request('', {
      method: 'POST',
      headers: { 'x-test-actor': 'collector-1' },
      body: JSON.stringify({
        accountNumbers: ['ACC-250'],
        priority: 'High',
        collectionDate: '2026-08-10',
        reason: 'Collector cannot self-assign'
      })
    });
    assert.equal(collectorCreate.status, 403);

    const updated = await request(`/${encodeURIComponent(firstId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        priority: 'High',
        collectionDate: '2026-08-12',
        reason: 'Updated shared collection instruction'
      })
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.record.collectorId, '');
    assert.equal(updated.body.record.assignmentScope, 'all_collectors');
    assert.equal(updated.body.record.priority, 'high');
    assert.ok(updated.body.record.auditHistory.some((entry) => entry.action === 'updated'));

    balances.set('ACC-100', 0);
    const paidRefresh = await request('', { headers: { 'x-test-actor': 'collector-2' } });
    assert.equal(paidRefresh.body.records.length, 1);
    assert.equal(paidRefresh.body.records[0].accountNumber, 'ACC-200');
    const paidHistory = await request('?status=history');
    assert.equal(paidHistory.body.records.length, 1);
    assert.equal(paidHistory.body.records[0].historyType, 'Paid');

    const cancelled = await request(`/${encodeURIComponent(secondId)}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.record.status, 'History');
    assert.equal(cancelled.body.record.historyType, 'Cancelled');

    relationalReady = true;
    const relationalCreate = await request('', {
      method: 'POST',
      body: JSON.stringify({
        accountNumbers: ['ACC-300'],
        priority: 'High',
        collectionDate: '2026-08-18',
        reason: 'Relational branch assignment test'
      })
    });
    assert.equal(relationalCreate.status, 201);
    assert.equal(relationalCreate.body.record.customerName, 'Relational Priority Client');
    assert.equal(relationalCreate.body.record.amountDue, 1500);

    const priorityHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'collectors.html'), 'utf8');
    const priorityScript = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'collectors-page.js'), 'utf8');
    assert.doesNotMatch(priorityHtml, /collectorPriority(?:Search|StatusFilter|ClearFilters)/);
    assert.match(priorityHtml, /id="collectorPriorityHistoryToggle"/);
    assert.match(priorityHtml, /id="collectorPriorityPagination"/);
    assert.match(priorityScript, /const collectorPriorityPageSize = 10/);
    assert.match(priorityScript, /Number\(right\?\.amountDue \|\| 0\) - Number\(left\?\.amountDue \|\| 0\)/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run()
  .then(() => console.log('Collector priority assignment tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
