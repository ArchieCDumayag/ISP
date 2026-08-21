const assert = require('assert/strict');

const branchId = 1;
const jobState = {
  id: 41,
  jobNumber: 41,
  type: 'repair',
  technician: 'tech.one',
  priority: 'normal',
  schedule: '2026-08-16 09:00:00',
  appointmentEnd: null,
  slaDueAt: null,
  status: 'scheduled',
  workflowStatus: 'assigned',
  doneAt: null,
  notes: '',
  description: 'Concurrency test',
  customerAccountNumber: 'ACC-100',
  customerName: 'Test Customer',
  customerPhone: '09170000000',
  serviceAddress: 'Test Street',
  latitude: null,
  longitude: null,
  planName: '',
  dispatchPayloadJson: '{}',
  version: 1,
  createdAt: '2026-08-16 08:00:00',
  updatedAt: '2026-08-16 08:00:00',
  ticketId: null,
  ticketNumber: null,
  ticketSubject: null,
  origin: 'job'
};

const observedSql = [];
let transactionTail = Promise.resolve();

const cloneJob = () => ({ ...jobState });

const makeConnection = () => {
  let releaseTransaction = null;
  return {
    async beginTransaction() {
      const previous = transactionTail;
      transactionTail = new Promise((resolve) => {
        releaseTransaction = resolve;
      });
      await previous;
    },
    async commit() {
      releaseTransaction?.();
      releaseTransaction = null;
    },
    async rollback() {
      releaseTransaction?.();
      releaseTransaction = null;
    },
    release() {},
    async query(sql, params = []) {
      observedSql.push(sql);
      if (/SELECT[\s\S]+FROM jobs[\s\S]+FOR UPDATE/i.test(sql)) {
        return [[cloneJob()], []];
      }
      if (/UPDATE jobs/i.test(sql)) {
        const expectedVersion = Number(params.at(-1));
        if (expectedVersion !== Number(jobState.version)) return [{ affectedRows: 0 }, []];
        jobState.technician = params[0] || '';
        jobState.workflowStatus = params[1];
        jobState.status = params[2];
        jobState.doneAt = params[3];
        jobState.dispatchPayloadJson = params[4];
        jobState.version = Number(params[5]);
        jobState.updatedAt = params[6];
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected transactional SQL: ${sql}`);
    }
  };
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

replaceModule('../../../../core/data/db', {
  getPool: async () => ({ getConnection: async () => makeConnection() }),
  query: async (sql) => {
    observedSql.push(sql);
    if (/information_schema\.columns/i.test(sql)) return [[{ columnName: 'job_number' }], []];
    if (/SELECT[\s\S]+FROM jobs/i.test(sql)) return [[cloneJob()], []];
    if (/FROM technician_job_events/i.test(sql)) return [[], []];
    if (/INSERT INTO technician_job_events/i.test(sql)) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => true
});
replaceModule('../../customer-management/backend/customers', {
  readCustomers: async () => []
});

const numberingPath = require.resolve('../backend/job-numbering');
const eventPath = require.resolve('../backend/job-events');
const jobsPath = require.resolve('../backend/jobs');
delete require.cache[numberingPath];
delete require.cache[eventPath];
delete require.cache[jobsPath];
const jobs = require(jobsPath);

async function run() {
  const mutate = () => jobs.changeJobWorkflowStatus({
    branchId,
    id: jobState.id,
    status: 'accepted',
    expectedVersion: 1,
    allowOverride: true,
    actorType: 'admin',
    actor: { id: 'admin-1', username: 'dispatcher' }
  });

  const outcomes = await Promise.allSettled([mutate(), mutate()]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent mutation must commit');
  assert.equal(rejected.length, 1, 'the stale concurrent mutation must be rejected');
  assert.equal(rejected[0].reason?.statusCode, 409);
  assert.match(rejected[0].reason?.message || '', /changed on the server/i);
  assert.equal(jobState.version, 2, 'the record version must increment exactly once');
  assert.ok(observedSql.some((sql) => /FROM jobs[\s\S]+FOR UPDATE/i.test(sql)));
  assert.ok(observedSql.some((sql) => /WHERE id = \? AND branch_id = \? AND record_version = \?/i.test(sql)));

  console.log('PASS MySQL job status mutation uses a row lock and atomic record-version predicate');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
