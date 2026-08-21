const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertTechnicianTransactionType,
  createInventoryService
} = require('../backend/technician-inventory');

const clone = (value) => JSON.parse(JSON.stringify(value));

const createHarness = () => {
  let store = { schemaVersion: 1, branches: {} };
  const jobs = [
    {
      id: 41,
      branchId: 7,
      jobNumber: 'JOB-0041',
      customerAccountNumber: '30010001',
      technician: 'tech.one',
      status: 'in-progress'
    }
  ];
  let uuid = 0;
  const service = createInventoryService({
    readStore: async () => clone(store),
    writeStore: async (value) => { store = clone(value); },
    jobsModule: {
      readJobsForTechnician: async (branchId, technician) => jobs.filter((job) => (
        Number(job.branchId) === Number(branchId)
        && job.technician === technician.username
      ))
    },
    now: () => new Date('2026-08-16T12:00:00.000Z'),
    randomUUID: () => `inventory-event-${++uuid}`,
    mutationKey: `inventory-test-${Math.random()}`
  });
  return { service, jobs, getStore: () => clone(store) };
};

const technician = {
  id: 'tech-1',
  username: 'tech.one',
  branchId: 7
};

test('technician routes cannot self-issue stock', () => {
  assert.equal(assertTechnicianTransactionType('use'), 'use');
  assert.equal(assertTechnicianTransactionType('return'), 'return');
  assert.throws(
    () => assertTechnicianTransactionType('issue'),
    (error) => error.statusCode === 403 && /Admin or warehouse/.test(error.message)
  );
});

test('inventory issue/use/return ledger is idempotent and never permits negative stock', async () => {
  const { service } = createHarness();

  const issued = await service.transact(technician, 'issue', {
    clientEventId: 'event-issue-1',
    itemId: 'drop-cable',
    itemName: 'Drop Cable',
    unit: 'meter',
    quantity: 20
  });
  assert.equal(issued.duplicate, false);
  assert.equal(issued.stock.sku, 'DROP-CABLE');
  assert.equal(issued.stock.onHand, 20);

  const duplicate = await service.transact(technician, 'issue', {
    clientEventId: 'event-issue-1',
    itemId: 'drop-cable',
    itemName: 'Drop Cable',
    unit: 'meter',
    quantity: 20
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal((await service.listStock(technician))[0].onHand, 20);

  const used = await service.transact(technician, 'use', {
    clientEventId: 'event-use-1',
    sku: 'DROP-CABLE',
    quantity: 7.5,
    jobId: 41
  });
  assert.equal(used.stock.onHand, 12.5);
  assert.equal(used.transaction.jobNumber, 'JOB-0041');
  assert.equal(used.transaction.customerAccountNumber, '30010001');

  const returned = await service.transact(technician, 'return', {
    clientEventId: 'event-return-1',
    sku: 'DROP-CABLE',
    quantity: 2.5
  });
  assert.equal(returned.stock.onHand, 10);
  assert.equal(returned.transaction.direction, 'out');

  await assert.rejects(
    service.transact(technician, 'use', {
      clientEventId: 'event-use-too-much',
      sku: 'DROP-CABLE',
      quantity: 10.001,
      jobId: 41
    }),
    (error) => error.statusCode === 409 && /Insufficient/.test(error.message)
  );
  assert.equal((await service.listStock(technician))[0].onHand, 10);
});

test('serialized stock accepts compatibility aliases and requires owned serials', async () => {
  const { service } = createHarness();

  const issued = await service.transact(technician, 'issue', {
    clientEventId: 'onu-issue-1',
    itemId: 'ONU-X1',
    itemName: 'ONU',
    quantity: 1,
    serialized: true,
    serialNumber: 'ONU-SN-001'
  });
  assert.deepEqual(issued.stock.serialNumbers, ['ONU-SN-001']);

  const used = await service.transact(technician, 'use', {
    clientEventId: 'onu-use-1',
    itemId: 'ONU-X1',
    quantity: 1,
    serialized: true,
    serialNumber: 'ONU-SN-001',
    jobId: '41'
  });
  assert.equal(used.stock.onHand, 0);
  assert.deepEqual(used.stock.serialNumbers, []);

  await service.transact(technician, 'issue', {
    clientEventId: 'onu-issue-2',
    itemId: 'ONU-X1',
    quantity: 1,
    serialized: true,
    serialNumber: 'ONU-SN-002'
  });

  await assert.rejects(
    service.transact(technician, 'return', {
      clientEventId: 'onu-return-missing',
      itemId: 'ONU-X1',
      quantity: 1,
      serialized: true,
      serialNumber: 'ONU-SN-404'
    }),
    (error) => error.statusCode === 409 && /not in this technician's stock/.test(error.message)
  );
});

test('material use rejects free-form or unassigned job references', async () => {
  const { service } = createHarness();
  await service.transact(technician, 'issue', {
    clientEventId: 'connector-issue',
    sku: 'SC-CONNECTOR',
    quantity: 2
  });

  await assert.rejects(
    service.transact(technician, 'use', {
      clientEventId: 'connector-use-no-job',
      sku: 'SC-CONNECTOR',
      quantity: 1,
      jobReference: 'JOB-0041'
    }),
    (error) => error.statusCode === 400 && /jobId is required/.test(error.message)
  );

  await assert.rejects(
    service.transact(technician, 'use', {
      clientEventId: 'connector-use-wrong-job',
      sku: 'SC-CONNECTOR',
      quantity: 1,
      jobId: 999
    }),
    (error) => error.statusCode === 404 && /not found for this technician/.test(error.message)
  );
});

test('reusing a clientEventId for a different mutation fails closed', async () => {
  const { service } = createHarness();
  await service.transact(technician, 'issue', {
    clientEventId: 'same-event',
    sku: 'FAST-CONNECTOR',
    quantity: 3
  });
  await assert.rejects(
    service.transact(technician, 'issue', {
      clientEventId: 'same-event',
      sku: 'FAST-CONNECTOR',
      quantity: 4
    }),
    (error) => error.statusCode === 409 && /different inventory transaction/.test(error.message)
  );
});

test('a stored job-linked mutation remains replayable after the job leaves the work queue', async () => {
  const { service, jobs } = createHarness();
  await service.transact(technician, 'issue', {
    clientEventId: 'replay-issue',
    sku: 'PATCH-CORD',
    quantity: 2
  });
  const first = await service.transact(technician, 'use', {
    clientEventId: 'replay-use',
    sku: 'PATCH-CORD',
    quantity: 1,
    jobId: 41
  });
  jobs.length = 0;
  const replay = await service.transact(technician, 'use', {
    clientEventId: 'replay-use',
    sku: 'PATCH-CORD',
    quantity: 1,
    jobId: 41
  });
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.transaction.id, first.transaction.id);
  assert.equal(replay.stock.onHand, 1);
});

test('stock visibility is technician- and branch-scoped while serialized identity is branch-unique', async () => {
  const { service } = createHarness();
  await service.transact(technician, 'issue', {
    clientEventId: 'scoped-onu-1',
    sku: 'ONU-Z',
    quantity: 1,
    serialized: true,
    serialNumber: 'BRANCH-7-SERIAL'
  });

  const otherTechnician = { id: 'tech-2', username: 'tech.two', branchId: 7 };
  assert.deepEqual(await service.listStock(otherTechnician), []);
  await assert.rejects(
    service.transact(otherTechnician, 'issue', {
      clientEventId: 'scoped-onu-2',
      sku: 'ONU-Z',
      quantity: 1,
      serialized: true,
      serialNumber: 'BRANCH-7-SERIAL'
    }),
    (error) => error.statusCode === 409 && /already in branch stock/.test(error.message)
  );

  const otherBranchTechnician = { id: 'tech-3', username: 'tech.three', branchId: 8 };
  const otherBranchIssue = await service.transact(otherBranchTechnician, 'issue', {
    clientEventId: 'scoped-onu-3',
    sku: 'ONU-Z',
    quantity: 1,
    serialized: true,
    serialNumber: 'BRANCH-7-SERIAL'
  });
  assert.equal(otherBranchIssue.stock.onHand, 1);
  assert.equal((await service.listStock(technician))[0].onHand, 1);
});
