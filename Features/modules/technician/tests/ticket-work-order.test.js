const assert = require('assert/strict');
const express = require('express');

const ADMIN = {
  id: 'admin-1',
  username: 'dispatcher',
  name: 'Dispatch Admin',
  role: 'Admin',
  branchId: 1
};
const TECHNICIAN = {
  id: 'tech-1',
  username: 'tech.one',
  name: 'Technician One',
  role: 'Technician',
  branchId: 1
};

const stores = {
  tickets: [{
    id: 1,
    branchId: 1,
    ticketNumber: 'TKT-00000001',
    subject: 'Blinking LOS',
    description: 'Customer reports a red LOS light.',
    customerName: 'Test Subscriber',
    accountNumber: 'ACC-100',
    contact: '09170000000',
    status: 'open',
    assignedTo: 'tech.one',
    source: 'admin',
    createdAt: '2026-08-16T08:00:00.000Z',
    updatedAt: '2026-08-16T08:00:00.000Z'
  }],
  jobs: [],
  technician_job_events: []
};
const customers = [{
  id: 100,
  branchId: 1,
  accountNumber: 'ACC-100',
  name: 'Test Subscriber',
  contactNumber: '09170000000',
  address: 'Test Street',
  mapPin: '14.5995, 120.9842',
  planName: 'Fiber 100'
}];

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
    throw new Error(`Unexpected relational query in JSON test: ${sql}`);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => false
});
replaceModule('../../customer-management/backend/customers', {
  readCustomers: async (branchId) => customers.filter((customer) => Number(customer.branchId) === Number(branchId)),
  requireCustomer: (_req, _res, next) => next()
});

const jobsPath = require.resolve('../backend/jobs');
const ticketsPath = require.resolve('../backend/tickets');
delete require.cache[jobsPath];
delete require.cache[ticketsPath];
const jobsRouter = require(jobsPath);
const ticketsModule = require(ticketsPath);

async function run() {
  assert.equal(ticketsModule.normalizeTicketStatus('assigned'), 'in-progress');
  assert.equal(ticketsModule.normalizeTicketStatus('waiting_customer'), 'waiting-customer');
  assert.equal(ticketsModule.normalizeTicketStatus('waiting for customer'), 'waiting-customer');
  assert.equal(ticketsModule.normalizeTicketStatus('escalation'), 'escalated');
  assert.equal(ticketsModule.normalizeTicketStatus('done'), 'resolved');
  assert.equal(ticketsModule.normalizeTicketStatus('canceled'), 'cancelled');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const branchId = Number(req.get('x-test-branch') || 1);
    req.user = req.get('x-test-role') === 'technician'
      ? { ...TECHNICIAN, branchId }
      : { ...ADMIN, branchId };
    next();
  });
  app.use('/tickets', ticketsModule.router);
  app.use('/jobs', jobsRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const forbidden = await request('/tickets/1/work-order', {
      method: 'POST',
      headers: { 'x-test-role': 'technician' },
      body: JSON.stringify({ appointmentStart: '2026-08-16T09:00:00.000Z' })
    });
    assert.equal(forbidden.status, 403);
    assert.equal(stores.jobs.length, 0);

    const workOrderRequest = () => request('/tickets/1/work-order', {
      method: 'POST',
      body: JSON.stringify({
        type: 'repair',
        technician: 'tech.one',
        priority: 'urgent',
        appointmentStart: '2026-08-16T09:00:00.000Z',
        appointmentEnd: '2026-08-16T11:00:00.000Z',
        slaDueAt: '2026-08-16T18:00:00.000Z',
        instructions: 'Inspect the drop cable and optical signal.'
      })
    });
    const concurrentResults = await Promise.all([workOrderRequest(), workOrderRequest()]);
    const created = concurrentResults.find((result) => result.status === 201);
    const duplicate = concurrentResults.find((result) => result.status === 409);
    assert.ok(created, 'one concurrent work-order request must create the job');
    assert.ok(duplicate, 'one concurrent work-order request must be rejected as a duplicate');
    assert.equal(created.status, 201);
    assert.equal(created.body.job.origin, 'ticket_work_order');
    assert.equal(created.body.job.workflowStatus, 'assigned');
    assert.match(created.body.job.jobNumber, /^JOB-\d{8}$/);
    assert.equal(stores.jobs.length, 1);
    assert.equal(stores.tickets[0].status, 'in-progress');
    assert.equal(Number(stores.tickets[0].historyJobId), Number(created.body.job.id));

    const laterDuplicate = await request('/tickets/1/work-order', {
      method: 'POST',
      body: JSON.stringify({ appointmentStart: '2026-08-17T09:00:00.000Z' })
    });
    assert.equal(laterDuplicate.status, 409);
    assert.match(laterDuplicate.body.error, /active work order/i);
    assert.equal(stores.jobs.length, 1);

    const activeArchive = await request('/tickets/1/archive', { method: 'PATCH' });
    assert.equal(activeArchive.status, 409);
    assert.equal(stores.tickets[0].archivedAt, undefined);

    const completed = await request(`/jobs/${created.body.job.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' })
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.job.workflowStatus, 'completed');
    assert.equal(stores.tickets[0].status, 'resolved');
    assert.equal(Number(stores.tickets[0].historyJobId), Number(created.body.job.id));
    assert.equal(stores.jobs.length, 1);
    assert.equal(stores.jobs.filter((job) => job.origin === 'ticket').length, 0);

    const resolvedAgain = await request('/tickets/1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' })
    });
    assert.equal(resolvedAgain.status, 200);
    assert.equal(resolvedAgain.body.ticket.status, 'resolved');
    assert.equal(stores.jobs.length, 1, 'resolving a linked ticket must not create a synthetic history job');

    const archived = await request('/tickets/1/archive', { method: 'PATCH' });
    assert.equal(archived.status, 200);
    assert.ok(stores.tickets[0].archivedAt);
    assert.equal(stores.tickets.length, 1, 'archive must preserve the ticket record');

    const defaultList = await request('/tickets');
    assert.equal(defaultList.status, 200);
    assert.equal(defaultList.body.tickets.length, 0);
    const archivedList = await request('/tickets?includeArchived=1');
    assert.equal(archivedList.status, 200);
    assert.equal(archivedList.body.tickets.length, 1);
    assert.equal(archivedList.body.archivedCount, 1);

    const restored = await request('/tickets/1/restore', { method: 'PATCH' });
    assert.equal(restored.status, 200);
    assert.equal(stores.tickets[0].archivedAt, null);
    assert.equal(stores.tickets.length, 1);

    const legacyDelete = await request('/tickets/1', { method: 'DELETE' });
    assert.equal(legacyDelete.status, 200);
    assert.ok(stores.tickets[0].archivedAt);
    assert.equal(stores.tickets.length, 1, 'legacy DELETE must archive instead of deleting');

    const restoreForSync = await request('/tickets/1/restore', { method: 'PATCH' });
    assert.equal(restoreForSync.status, 200);
    const reopened = await request(`/jobs/${created.body.job.id}/undo`, { method: 'PATCH' });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.job.workflowStatus, 'assigned');
    assert.equal(stores.tickets[0].status, 'in-progress');
    assert.equal(stores.tickets[0].assignedTo, reopened.body.job.technician);

    const ticketAssignment = await request('/tickets/1/assign', {
      method: 'PATCH',
      body: JSON.stringify({ technician: 'tech.two' })
    });
    assert.equal(ticketAssignment.status, 200);
    assert.equal(stores.tickets[0].assignedTo, 'tech.two');
    assert.equal(stores.jobs[0].technician, 'tech.two', 'ticket reassignment must update its active work order');

    const jobAssignment = await request(`/jobs/${created.body.job.id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ technician: 'tech.three' })
    });
    assert.equal(jobAssignment.status, 200);
    assert.equal(stores.jobs[0].technician, 'tech.three');
    assert.equal(stores.tickets[0].assignedTo, 'tech.three', 'job reassignment must update its linked ticket');

    const concurrentAssignments = await Promise.all([
      request('/tickets/1/assign', {
        method: 'PATCH',
        body: JSON.stringify({ technician: 'tech.ticket' })
      }),
      request(`/jobs/${created.body.job.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ technician: 'tech.job' })
      })
    ]);
    assert.ok(concurrentAssignments.every((result) => [200, 409].includes(result.status)));
    assert.equal(
      stores.tickets[0].assignedTo,
      stores.jobs[0].technician,
      'serialized concurrent ticket/job updates must leave one canonical assignee'
    );

    stores.tickets.push({
      id: 200,
      branchId: 2,
      ticketNumber: 'TKT-00000200',
      subject: 'Branch two ticket',
      customerName: 'Other Branch',
      accountNumber: 'ACC-200',
      status: 'open',
      assignedTo: '',
      createdAt: '2026-08-16T10:00:00.000Z',
      updatedAt: '2026-08-16T10:00:00.000Z'
    }, {
      id: 201,
      ticketNumber: 'TKT-00000201',
      subject: 'Legacy branchless ticket',
      customerName: 'Legacy',
      accountNumber: 'ACC-201',
      status: 'open'
    });
    stores.jobs.push({
      id: 200,
      branchId: 2,
      jobNumber: 'JOB-00000200',
      type: 'repair',
      technician: 'other.tech',
      status: 'scheduled',
      workflowStatus: 'assigned',
      version: 1,
      origin: 'job',
      schedule: '2026-08-17T09:00:00.000Z'
    }, {
      id: 201,
      jobNumber: 'JOB-00000201',
      type: 'repair',
      technician: 'legacy.tech',
      status: 'scheduled',
      workflowStatus: 'assigned',
      version: 1,
      origin: 'job',
      schedule: '2026-08-17T09:00:00.000Z'
    });

    const branchOneTickets = await request('/tickets');
    assert.equal(branchOneTickets.status, 200);
    assert.ok(branchOneTickets.body.tickets.every((ticket) => Number(ticket.branchId) === 1));
    assert.ok(!branchOneTickets.body.tickets.some((ticket) => Number(ticket.id) === 200));
    assert.ok(!branchOneTickets.body.tickets.some((ticket) => Number(ticket.id) === 201));

    const crossBranchTicketMutation = await request('/tickets/200/assign', {
      method: 'PATCH',
      body: JSON.stringify({ technician: 'intruder' })
    });
    assert.equal(crossBranchTicketMutation.status, 404);
    assert.equal(stores.tickets.find((ticket) => ticket.id === 200).assignedTo, '');

    const crossBranchJobMutation = await request('/jobs/200/assign', {
      method: 'PATCH',
      body: JSON.stringify({ technician: 'intruder' })
    });
    assert.equal(crossBranchJobMutation.status, 404);
    assert.equal(stores.jobs.find((job) => job.id === 200).technician, 'other.tech');

    const branchTwoTicket = await request('/tickets', {
      method: 'POST',
      headers: { 'x-test-branch': '2' },
      body: JSON.stringify({ subject: 'New branch two request', customerName: 'Branch Two Customer' })
    });
    assert.equal(branchTwoTicket.status, 201);
    assert.equal(Number(branchTwoTicket.body.ticket.branchId), 2);
    assert.equal(Number(stores.tickets.find((ticket) => ticket.id === branchTwoTicket.body.ticket.id).branchId), 2);

    console.log('PASS ticket/work-order lifecycle, assignee synchronization, branch isolation, and archive contracts');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
