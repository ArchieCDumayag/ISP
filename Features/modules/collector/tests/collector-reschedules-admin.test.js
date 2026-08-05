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
  }],
  collectors: {
    assignments: {
      'North Area': ['collector-1']
    }
  },
  collector_followups: { records: [] }
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

    console.log('ADMIN COLLECTOR SCHEDULE CRUD PASSED');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
