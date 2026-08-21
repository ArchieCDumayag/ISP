const express = require('express');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { readCustomers } = require('../../customer-management/backend/customers');
const {
  assignFallbackManualJobNumber,
  getJobSelectFields,
  hasJobNumberColumn,
  hydrateJobRows,
  nextManualJobNumberValue,
  toJobNumberLabel,
  withTransaction
} = require('./job-numbering');
const {
  normalizeDispatchStatus,
  isDispatchStatusValue,
  normalizeDispatchFields,
  normalizeDispatchPayload,
  validateAppointmentWindow,
  hasAssignedTechnician: hasDispatchTechnician,
  canTechnicianTransition,
  toLegacyJobStatus,
  toSafeText,
  parseJsonValue,
  validateCoordinateInput,
  buildJobEvent
} = require('./dispatch-workflow');
const { appendJobEvent, findExistingEvent, readJobEvents } = require('./job-events');

const router = express.Router();
const STORE_KEYS = {
  jobs: 'jobs',
  tickets: 'tickets'
};
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
let jsonTechnicianMutationQueue = Promise.resolve();

router.use((req, res, next) => {
  if (!accountHasRole(req.user, 'Admin')) {
    return res.status(403).json({ ok: false, error: 'Admin dispatch access required.' });
  }
  return next();
});

const toMysqlDateTime = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (MYSQL_DATETIME_RE.test(raw)) return raw;
  const normalizedInput = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsed = new Date(normalizedInput);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const mapJobRow = (row) => {
  const notes = row.notes || '';
  const description = row.description || notes || '';
  const technician = row.technician || '';
  const dispatchPayload = normalizeDispatchPayload(
    row.dispatchPayloadJson || row.dispatch_payload_json || row.dispatchPayload,
    {}
  );
  const workflowStatus = normalizeDispatchStatus(
    row.workflowStatus || row.workflow_status || row.status,
    { technician, fallback: hasDispatchTechnician(technician) ? 'assigned' : 'unassigned' }
  );
  return {
    id: Number(row.id) || row.id,
    branchId: row.branchId ?? row.branch_id ?? null,
    jobNumber: toJobNumberLabel(row),
    type: row.type || '',
    technician,
    priority: row.priority || '',
    schedule: row.schedule || '',
    appointmentStart: row.appointmentStart || row.schedule || '',
    appointmentEnd: row.appointmentEnd || row.appointment_end || '',
    slaDueAt: row.slaDueAt || row.sla_due_at || '',
    status: row.status || '',
    workflowStatus,
    doneAt: row.doneAt || row.done_at || null,
    notes: notes || description,
    description,
    customerAccountNumber: row.customerAccountNumber || row.customer_account_number || '',
    customerName: row.customerName || row.customer_name || '',
    customerPhone: row.customerPhone || row.customer_phone || '',
    serviceAddress: row.serviceAddress || row.service_address || '',
    latitude: row.latitude == null || row.latitude === '' ? null : Number(row.latitude),
    longitude: row.longitude == null || row.longitude === '' ? null : Number(row.longitude),
    planName: row.planName || row.plan_name || '',
    dispatchPayload,
    version: Math.max(1, Number(row.version || row.record_version || 1) || 1),
    createdAt: row.createdAt || row.created_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
    ticketId: row.ticketId || row.ticket_id || null,
    ticketNumber: row.ticketNumber || row.ticket_number || '',
    ticketSubject: row.ticketSubject || row.ticket_subject || '',
    origin: row.origin || ''
  };
};

const hasBranchId = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const isSameBranch = (row, branchId) => (
  hasBranchId(branchId)
  && hasBranchId(row?.branchId ?? row?.branch_id)
  && String(row.branchId ?? row.branch_id) === String(branchId)
);
const readAllJobsJson = async () => {
  const parsed = await readJson(STORE_KEYS.jobs, []);
  return Array.isArray(parsed) ? parsed : [];
};
const withJsonTechnicianMutation = async (work) => {
  const previous = jsonTechnicianMutationQueue;
  let release;
  jsonTechnicianMutationQueue = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
};

const readJobs = async (branchId = null) => {
  try {
    if (await isRelationalReady()) {
      if (!branchId) return [];
      const selectFields = await getJobSelectFields();
      const [rows] = await query(
        `SELECT
            ${selectFields}
         FROM jobs
         WHERE branch_id = ?
         ORDER BY created_at DESC`,
        [branchId]
      );
      const hydratedRows = await hydrateJobRows(branchId, rows || []);
      return hydratedRows.map(mapJobRow);
    }
    if (!hasBranchId(branchId)) return [];
    const parsed = await readAllJobsJson();
    return parsed
      .filter((row) => isSameBranch(row, branchId))
      .map((row) => ({ ...row, ...mapJobRow(row) }));
  } catch (err) {
    console.error('Failed to read jobs:', err);
    return [];
  }
};

const writeJobs = async (jobs) => {
  await writeJson(STORE_KEYS.jobs, jobs);
};

const buildJobInsertStatement = async () => {
  const useJobNumberColumn = await hasJobNumberColumn();
  const columns = ['branch_id'];
  if (useJobNumberColumn) columns.push('job_number');
  columns.push(
    'type',
    'technician',
    'priority',
    'schedule',
    'appointment_end',
    'sla_due_at',
    'status',
    'workflow_status',
    'done_at',
    'notes',
    'description',
    'customer_account_number',
    'customer_name',
    'customer_phone',
    'service_address',
    'latitude',
    'longitude',
    'plan_name',
    'dispatch_payload_json',
    'record_version',
    'created_at',
    'updated_at',
    'ticket_id',
    'ticket_number',
    'ticket_subject',
    'origin'
  );
  return {
    useJobNumberColumn,
    sql: `INSERT INTO jobs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  };
};

const buildJobInsertValues = (job, branchId, storedJobNumber, useJobNumberColumn) => {
  const workflowStatus = normalizeDispatchStatus(job.workflowStatus || job.status, {
    technician: job.technician,
    fallback: hasDispatchTechnician(job.technician) ? 'assigned' : 'unassigned'
  });
  const values = [branchId];
  if (useJobNumberColumn) values.push(storedJobNumber);
  values.push(
    job.type || null,
    job.technician || null,
    job.priority || null,
    toMysqlDateTime(job.appointmentStart || job.schedule),
    toMysqlDateTime(job.appointmentEnd),
    toMysqlDateTime(job.slaDueAt),
    job.status || toLegacyJobStatus(workflowStatus),
    workflowStatus,
    toMysqlDateTime(job.doneAt),
    job.notes || null,
    job.description || null,
    job.customerAccountNumber || null,
    job.customerName || null,
    job.customerPhone || null,
    job.serviceAddress || null,
    job.latitude == null ? null : job.latitude,
    job.longitude == null ? null : job.longitude,
    job.planName || null,
    JSON.stringify(job.dispatchPayload || {}),
    Math.max(1, Number(job.version || 1) || 1),
    toMysqlDateTime(job.createdAt),
    toMysqlDateTime(job.updatedAt),
    job.ticketId || null,
    job.ticketNumber || null,
    job.ticketSubject || null,
    job.origin || null
  );
  return values;
};

const nextId = (jobs) => jobs.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0) + 1;

const sanitizeText = (value, maxLen = 200) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLen);
};

const buildCustomerName = (customer = {}) => sanitizeText(
  customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' '),
  200
);

const buildCustomerAddress = (customer = {}) => sanitizeText(
  customer.address || customer.addressText || [
    customer.street,
    customer.barangay,
    customer.municipality,
    customer.province
  ].filter(Boolean).join(', '),
  500
);

const resolveCustomerSnapshot = async (branchId, payload = {}) => {
  const hasExplicitAccount = ['customerAccountNumber', 'accountNumber']
    .some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const accountNumber = sanitizeText(
    payload.customerAccountNumber || payload.accountNumber,
    20
  );
  if (!accountNumber) {
    return hasExplicitAccount
      ? {
          customerAccountNumber: '',
          customerName: '',
          customerPhone: '',
          serviceAddress: '',
          mapPin: '',
          planName: ''
        }
      : {};
  }
  const customers = await readCustomers(branchId);
  const customer = (Array.isArray(customers) ? customers : []).find((entry) =>
    isSameBranch(entry, branchId)
    && String(entry?.accountNumber || '').trim() === accountNumber
  );
  if (!customer) {
    const error = new Error('Selected customer was not found in this branch.');
    error.statusCode = 400;
    throw error;
  }
  return {
    customerAccountNumber: accountNumber,
    customerName: buildCustomerName(customer),
    customerPhone: sanitizeText(
      customer.mobileRaw || customer.mobile || customer.contactNumber || customer.contact,
      50
    ),
    serviceAddress: buildCustomerAddress(customer),
    mapPin: sanitizeText(customer.mapPin || customer.coordinates, 120),
    planName: sanitizeText(customer.planName, 120)
  };
};

const CLOSED_JOB_STATUSES = new Set(['done', 'closed', 'resolved', 'completed', 'cancelled']);
const UNASSIGNED_JOB_TECHNICIAN_VALUES = new Set(['', 'pending assignment', 'unassigned']);

const hasAssignedTechnician = (value) => {
  const normalized = sanitizeText(value, 120).toLowerCase();
  return Boolean(normalized) && !UNASSIGNED_JOB_TECHNICIAN_VALUES.has(normalized);
};

const isOpenJobStatus = (value) => {
  const normalized = sanitizeText(value, 40).toLowerCase();
  return !CLOSED_JOB_STATUSES.has(normalized);
};

const deriveJobStatus = (job = {}) => {
  if (job?.workflowStatus || job?.workflow_status) {
    return toLegacyJobStatus(normalizeDispatchStatus(
      job.workflowStatus || job.workflow_status,
      { technician: job.technician }
    ));
  }
  const normalized = sanitizeText(job?.status, 40).toLowerCase();
  if (CLOSED_JOB_STATUSES.has(normalized)) return 'done';
  if (!hasAssignedTechnician(job?.technician)) return 'scheduled';
  const scheduleValue = job?.schedule;
  const scheduledAt = scheduleValue ? new Date(scheduleValue) : null;
  if (scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt > new Date()) {
    return 'scheduled';
  }
  return 'in-progress';
};

const buildEditableJobFields = (payload = {}, { requireTechnician = true, current = {} } = {}) => {
  const coordinateError = validateCoordinateInput(payload);
  if (coordinateError) return { error: coordinateError };
  const type = sanitizeText(payload.type, 80).toLowerCase();
  const dispatch = normalizeDispatchFields(payload, current);
  const technician = dispatch.technician;
  const schedule = dispatch.appointmentStart;
  const notes = sanitizeText(payload.notes || payload.description, 400);
  const description = sanitizeText(payload.description || payload.notes, 4000);

  if (!type || !schedule) return { error: 'Type and appointment start are required.' };
  if (requireTechnician && !technician) return { error: 'Technician is required.' };

  const appointmentError = validateAppointmentWindow(dispatch);
  if (appointmentError) return { error: appointmentError };

  return {
    fields: {
      type,
      technician,
      priority: dispatch.priority,
      schedule,
      appointmentStart: schedule,
      appointmentEnd: dispatch.appointmentEnd,
      slaDueAt: dispatch.slaDueAt,
      workflowStatus: dispatch.workflowStatus,
      status: dispatch.legacyStatus,
      notes,
      description,
      customerAccountNumber: dispatch.customerAccountNumber,
      customerName: dispatch.customerName,
      customerPhone: dispatch.customerPhone,
      serviceAddress: dispatch.serviceAddress,
      latitude: dispatch.latitude,
      longitude: dispatch.longitude,
      planName: dispatch.planName,
      dispatchPayload: dispatch.dispatchPayload,
      version: dispatch.version
    }
  };
};

const mergeCustomerSnapshot = (payload = {}, customerSnapshot = {}) => {
  const merged = { ...payload, ...customerSnapshot };
  const manualMapPin = sanitizeText(payload.mapPin ?? payload.coordinates, 120);
  if (manualMapPin) merged.mapPin = manualMapPin;
  if (payload.latitude !== undefined) merged.latitude = payload.latitude;
  if (payload.longitude !== undefined) merged.longitude = payload.longitude;
  return merged;
};

const getTechnicianLookupValues = (technician) => {
  if (!technician) return [];
  const values = new Set();
  if (typeof technician === 'string') {
    const normalized = technician.trim().toLowerCase();
    if (normalized) values.add(normalized);
    return Array.from(values);
  }
  const normalized = String(technician.username || '').trim().toLowerCase();
  if (normalized) values.add(normalized);
  return Array.from(values);
};

const ORIGIN_TICKET = 'ticket';
const ORIGIN_TICKET_WORK_ORDER = 'ticket_work_order';
const ORIGIN_JOB = 'job';
const ACTIVE_LINKED_JOB_TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

const readTicketsData = async () => {
  try {
    const parsed = await readJson(STORE_KEYS.tickets, []);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to read tickets data:', err);
    return [];
  }
};

const writeTicketsData = async (tickets) => {
  await writeJson(STORE_KEYS.tickets, tickets);
};

const revertTicketStatus = async (ticketId, branchId = null) => {
  if (!ticketId || !hasBranchId(branchId)) return null;
  if (await isRelationalReady()) {
    if (!branchId) return null;
    const [rows] = await query(
      `SELECT id, status, subject, description, customer_name AS customerName, account_number AS accountNumber,
              contact, assigned_to AS assignedTo, source, created_at AS createdAt, updated_at AS updatedAt,
              history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt
       FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1`,
      [ticketId, branchId]
    );
    if (!rows || !rows.length) return null;
    const ticket = rows[0];
    await query(
      `UPDATE tickets SET status = 'in-progress', history_job_id = NULL, history_job_created_at = NULL, updated_at = ?
       WHERE id = ? AND branch_id = ?`,
      [toMysqlDateTime(new Date()), ticketId, branchId]
    );
    return ticket;
  }
  const tickets = await readTicketsData();
  const idx = tickets.findIndex((ticket) => (
    Number(ticket.id) === Number(ticketId) && isSameBranch(ticket, branchId)
  ));
  if (idx < 0) return null;
  const ticket = tickets[idx];
  ticket.status = 'in-progress';
  delete ticket.historyJobId;
  delete ticket.historyJobCreatedAt;
  ticket.updatedAt = new Date().toISOString();
  await writeTicketsData(tickets);
  return ticket;
};

const addJobEntry = async (job, branchId = null, options = {}) => {
  if (!hasBranchId(branchId)) throw new Error('Branch assignment missing for this job.');
  const dispatch = normalizeDispatchFields(job, job);
  Object.assign(job, dispatch, {
    schedule: dispatch.appointmentStart || job.schedule,
    status: job.status || dispatch.legacyStatus,
    workflowStatus: dispatch.workflowStatus,
    version: Math.max(1, Number(job.version || 1) || 1)
  });
  if (await isRelationalReady()) {
    if (!branchId) throw new Error('Branch assignment missing for this job.');
    const { useJobNumberColumn, sql } = await buildJobInsertStatement();
    const isManualJob = String(job.origin || '').trim().toLowerCase() !== ORIGIN_TICKET;

    if (useJobNumberColumn && isManualJob) {
      await withTransaction(async (connection) => {
        const storedJobNumber = await nextManualJobNumberValue(connection, branchId);
        const [result] = await connection.query(
          sql,
          buildJobInsertValues(job, branchId, storedJobNumber, true)
        );
        job.id = result && result.insertId ? result.insertId : job.id;
        job.jobNumber = toJobNumberLabel({ ...job, jobNumber: storedJobNumber });
      });
      return job;
    }

    if (isManualJob) {
      await withTransaction(async (connection) => {
        const [result] = await connection.query(
          sql,
          buildJobInsertValues(job, branchId, null, false)
        );
        job.id = result && result.insertId ? result.insertId : job.id;
        const storedJobNumber = await assignFallbackManualJobNumber(connection, branchId, job.id);
        job.jobNumber = toJobNumberLabel({ ...job, jobNumber: storedJobNumber });
      });
      return job;
    }

    const [result] = await query(
      sql,
      buildJobInsertValues(job, branchId, null, useJobNumberColumn)
    );
    job.id = result && result.insertId ? result.insertId : job.id;
    job.jobNumber = toJobNumberLabel(job);
    return job;
  }
  const persistJsonJob = async () => {
    const jobs = await readAllJobsJson();
    job.id = nextId(jobs);
    job.branchId = Number(branchId) || String(branchId);
    jobs.unshift(job);
    await writeJobs(jobs);
    return job;
  };
  return options.alreadySerialized
    ? persistJsonJob()
    : withJsonTechnicianMutation(persistJsonJob);
};

const createJobFromTicket = async (ticket, branchId = null, options = {}) => {
  if (!ticket) return null;
  const now = new Date().toISOString();
  const notesArray = [
    sanitizeText(ticket.description, 400),
    ticket.customerName ? `Customer: ${sanitizeText(ticket.customerName, 120)}` : null,
    ticket.accountNumber ? `Account: ${sanitizeText(ticket.accountNumber, 40)}` : null
  ]
    .filter(Boolean)
    .join(' | ');

  const job = {
    type: 'ticket',
    technician: sanitizeText(ticket.assignedTo, 120) || 'Support',
    priority: 'normal',
    schedule: ticket.updatedAt || ticket.createdAt || now,
    status: 'done',
    doneAt: now,
    notes: notesArray,
    description: sanitizeText(ticket.description || ticket.subject, 800),
    createdAt: now,
    updatedAt: now,
    ticketId: Number(ticket.id) || null,
    ticketNumber: sanitizeText(ticket.ticketNumber, 50),
    ticketSubject: sanitizeText(ticket.subject, 200),
    origin: ORIGIN_TICKET
  };
  return addJobEntry(job, branchId, options);
};

const removeHistoryJobForTicket = async (ticket, branchId = null) => {
  const historyJobId = Number(ticket?.historyJobId || ticket?.history_job_id || 0);
  const ticketId = Number(ticket?.id || ticket?.ticketId || ticket?.ticket_id || 0);
  const ticketNumber = sanitizeText(ticket?.ticketNumber || ticket?.ticket_number, 50);

  if (await isRelationalReady()) {
    if (!branchId) return false;
    if (historyJobId > 0) {
      await query(
        'DELETE FROM jobs WHERE id = ? AND branch_id = ? AND origin = ?',
        [historyJobId, branchId, ORIGIN_TICKET]
      );
      return true;
    }
    if (ticketId > 0) {
      await query(
        'DELETE FROM jobs WHERE branch_id = ? AND origin = ? AND ticket_id = ?',
        [branchId, ORIGIN_TICKET, ticketId]
      );
      return true;
    }
    if (ticketNumber) {
      await query(
        'DELETE FROM jobs WHERE branch_id = ? AND origin = ? AND ticket_number = ?',
        [branchId, ORIGIN_TICKET, ticketNumber]
      );
      return true;
    }
    return false;
  }

  if (!hasBranchId(branchId)) return false;
  const jobs = await readAllJobsJson();
  const nextJobs = jobs.filter((job) => {
    if (!isSameBranch(job, branchId)) return true;
    const isTicketOrigin = String(job?.origin || '').toLowerCase() === ORIGIN_TICKET;
    if (!isTicketOrigin) return true;
    if (historyJobId > 0 && Number(job?.id) === historyJobId) return false;
    if (ticketId > 0 && Number(job?.ticketId) === ticketId) return false;
    if (ticketNumber && String(job?.ticketNumber || '').trim() === ticketNumber) return false;
    return true;
  });
  if (nextJobs.length !== jobs.length) {
    await writeJobs(nextJobs);
    return true;
  }
  return false;
};

const isTicketWorkOrder = (job = {}) =>
  sanitizeText(job.origin, 50).toLowerCase() === ORIGIN_TICKET_WORK_ORDER;

const isActiveTicketWorkOrder = (job = {}) => {
  if (!isTicketWorkOrder(job)) return false;
  const workflowStatus = normalizeDispatchStatus(job.workflowStatus || job.status, {
    technician: job.technician
  });
  return !ACTIVE_LINKED_JOB_TERMINAL_STATUSES.has(workflowStatus);
};

const readTicketWorkOrders = async (branchId = null) => {
  const jobs = await readJobs(branchId);
  return jobs
    .filter(isTicketWorkOrder)
    .sort((left, right) => {
      const dateDifference = new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
      return dateDifference || (Number(right.id) || 0) - (Number(left.id) || 0);
    });
};

const findTicketWorkOrder = async (ticketId, branchId = null, options = {}) => {
  const normalizedTicketId = Number(ticketId);
  if (!Number.isFinite(normalizedTicketId) || normalizedTicketId <= 0) return null;
  const jobs = await readTicketWorkOrders(branchId);
  return jobs.find((job) => {
    if (Number(job.ticketId) !== normalizedTicketId) return false;
    if (options.activeOnly && !isActiveTicketWorkOrder(job)) return false;
    if (options.completedOnly) {
      const status = normalizeDispatchStatus(job.workflowStatus || job.status, {
        technician: job.technician
      });
      if (status !== 'completed') return false;
    }
    return true;
  }) || null;
};

const createWorkOrderFromTicket = async (ticket, payload = {}, branchId = null, actor = null) => {
  const ticketId = Number(ticket?.id);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    const error = new Error('Ticket is required to create a work order.');
    error.statusCode = 400;
    throw error;
  }

  if (!hasBranchId(branchId)) {
    const error = new Error('Branch assignment missing for this job.');
    error.statusCode = 400;
    throw error;
  }

  const buildWorkOrder = async (currentTicket) => {
    const now = new Date().toISOString();
    let customerSnapshot = {};
    if (currentTicket.accountNumber) {
      try {
        customerSnapshot = await resolveCustomerSnapshot(branchId, {
          customerAccountNumber: currentTicket.accountNumber
        });
      } catch (error) {
        if (Number(error?.statusCode) !== 400) throw error;
      }
    }
    const requestPayload = mergeCustomerSnapshot({
      ...payload,
      type: sanitizeText(payload.type, 80) || 'repair',
      technician: sanitizeText(payload.technician || payload.assignedTo || currentTicket.assignedTo, 120),
      priority: sanitizeText(payload.priority, 40) || 'normal',
      appointmentStart: payload.appointmentStart || payload.schedule || now,
      customerAccountNumber: sanitizeText(currentTicket.accountNumber, 20),
      customerName: sanitizeText(currentTicket.customerName, 200),
      customerPhone: sanitizeText(currentTicket.contact, 50),
      notes: sanitizeText(payload.notes || currentTicket.description || currentTicket.subject, 400),
      description: sanitizeText(payload.description || currentTicket.description || currentTicket.subject, 4000),
      details: {
        ...(payload.details && typeof payload.details === 'object' ? payload.details : {}),
        instructions: sanitizeText(
          payload.instructions || payload.details?.instructions || currentTicket.description,
          4000
        )
      }
    }, customerSnapshot);
    const { fields, error } = buildEditableJobFields(requestPayload, { requireTechnician: false });
    if (error) {
      const validationError = new Error(error);
      validationError.statusCode = 400;
      throw validationError;
    }

    const workflowStatus = hasAssignedTechnician(fields.technician) ? 'assigned' : 'unassigned';
    const job = {
      ...fields,
      schedule: fields.appointmentStart,
      workflowStatus,
      status: toLegacyJobStatus(workflowStatus),
      doneAt: null,
      version: 1,
      ticketId,
      ticketNumber: sanitizeText(currentTicket.ticketNumber, 50),
      ticketSubject: sanitizeText(currentTicket.subject, 200),
      origin: ORIGIN_TICKET_WORK_ORDER,
      createdAt: now,
      updatedAt: now
    };
    return job;
  };

  const assertTicketCanCreateWorkOrder = (currentTicket) => {
    if (currentTicket.archivedAt || currentTicket.archived_at) {
      const error = new Error('Restore this ticket before creating a work order.');
      error.statusCode = 409;
      throw error;
    }
    const status = String(currentTicket.status || '').trim().toLowerCase();
    if (['resolved', 'closed', 'done', 'completed', 'cancelled', 'canceled'].includes(status)) {
      const error = new Error('Reopen this ticket before creating a work order.');
      error.statusCode = 409;
      throw error;
    }
  };

  let saved;
  let updatedTicket;
  if (await isRelationalReady()) {
      const { useJobNumberColumn, sql } = await buildJobInsertStatement();
      const selectFields = await getJobSelectFields();
      const result = await withTransaction(async (connection) => {
        const [ticketRows] = await connection.query(
          `SELECT id, ticket_number AS ticketNumber, subject, description,
                  customer_name AS customerName, account_number AS accountNumber, contact, status,
                  assigned_to AS assignedTo, source, created_at AS createdAt, updated_at AS updatedAt,
                  history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt,
                  archived_at AS archivedAt, archived_by AS archivedBy
           FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
          [ticketId, branchId]
        );
        if (!ticketRows?.length) {
          const error = new Error('Ticket not found.');
          error.statusCode = 404;
          throw error;
        }
        const currentTicket = ticketRows[0];
        assertTicketCanCreateWorkOrder(currentTicket);
        const [existingRows] = await connection.query(
          `SELECT ${selectFields}
           FROM jobs
           WHERE branch_id = ? AND ticket_id = ? AND origin = ?
             AND LOWER(COALESCE(workflow_status, '')) NOT IN ('completed', 'cancelled')
             AND LOWER(COALESCE(status, '')) NOT IN ('done', 'closed', 'resolved', 'completed', 'cancelled')
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
          [branchId, ticketId, ORIGIN_TICKET_WORK_ORDER]
        );
        if (existingRows?.length) {
          const error = new Error('This ticket already has an active work order.');
          error.statusCode = 409;
          error.currentJob = mapJobRow(existingRows[0]);
          throw error;
        }

        const job = await buildWorkOrder(currentTicket);
        const storedJobNumber = useJobNumberColumn
          ? await nextManualJobNumberValue(connection, branchId)
          : null;
        const [result] = await connection.query(
          sql,
          buildJobInsertValues(job, branchId, storedJobNumber, useJobNumberColumn)
        );
        job.id = result?.insertId || job.id;
        const fallbackJobNumber = useJobNumberColumn
          ? storedJobNumber
          : await assignFallbackManualJobNumber(connection, branchId, job.id);
        job.jobNumber = toJobNumberLabel({ ...job, jobNumber: fallbackJobNumber });
        const ticketUpdatedAt = new Date().toISOString();
        const linkedTicket = {
          ...currentTicket,
          branchId: Number(branchId) || branchId,
          assignedTo: sanitizeText(job.technician, 120),
          status: 'in-progress',
          historyJobId: job.id || null,
          historyJobCreatedAt: job.createdAt || ticketUpdatedAt,
          updatedAt: ticketUpdatedAt
        };
        await connection.query(
          `UPDATE tickets
           SET status = ?, assigned_to = ?, history_job_id = ?, history_job_created_at = ?, updated_at = ?
           WHERE id = ? AND branch_id = ?`,
          [
            linkedTicket.status,
            linkedTicket.assignedTo || null,
            linkedTicket.historyJobId,
            toMysqlDateTime(linkedTicket.historyJobCreatedAt),
            toMysqlDateTime(linkedTicket.updatedAt),
            ticketId,
            branchId
          ]
        );
        return { job, ticket: linkedTicket };
      });
      saved = result.job;
      updatedTicket = result.ticket;
  } else {
    const result = await withJsonTechnicianMutation(async () => {
      const tickets = await readTicketsData();
      const ticketIndex = tickets.findIndex((entry) => (
        Number(entry?.id) === ticketId && isSameBranch(entry, branchId)
      ));
      if (ticketIndex < 0) {
        const error = new Error('Ticket not found.');
        error.statusCode = 404;
        throw error;
      }
      const currentTicket = tickets[ticketIndex];
      assertTicketCanCreateWorkOrder(currentTicket);
      const jobs = await readAllJobsJson();
      const existing = jobs.find((entry) => (
        isSameBranch(entry, branchId)
        && Number(entry?.ticketId ?? entry?.ticket_id) === ticketId
        && isActiveTicketWorkOrder(entry)
      ));
      if (existing) {
        const error = new Error('This ticket already has an active work order.');
        error.statusCode = 409;
        error.currentJob = mapJobRow(existing);
        throw error;
      }
      const job = await buildWorkOrder(currentTicket);
      job.id = nextId(jobs);
      job.branchId = Number(branchId) || String(branchId);
      job.jobNumber = toJobNumberLabel(job);
      jobs.unshift(job);
      const ticketUpdatedAt = new Date().toISOString();
      currentTicket.assignedTo = sanitizeText(job.technician, 120);
      currentTicket.status = 'in-progress';
      currentTicket.historyJobId = job.id || null;
      currentTicket.historyJobCreatedAt = job.createdAt || ticketUpdatedAt;
      currentTicket.updatedAt = ticketUpdatedAt;
      currentTicket.branchId = Number(branchId) || String(branchId);
      tickets[ticketIndex] = currentTicket;
      await writeJobs(jobs);
      await writeTicketsData(tickets);
      return { job, ticket: currentTicket };
    });
    saved = result.job;
    updatedTicket = result.ticket;
  }

  await recordJobEvent(saved, {
    branchId,
    eventType: 'created',
    toStatus: saved.workflowStatus,
    actorType: 'admin',
    actor,
    clientEventId: payload.clientEventId,
    payload: {
      ticketId,
      ticketNumber: saved.ticketNumber,
      origin: ORIGIN_TICKET_WORK_ORDER,
      version: saved.version || 1
    }
  });
  return { job: mapJobRow(saved), ticket: updatedTicket };
};

const applyLinkedJobStateToTicket = (ticket, job) => {
  const workflowStatus = normalizeDispatchStatus(job.workflowStatus || job.status, {
    technician: job.technician
  });
  const now = new Date().toISOString();
  const closedTicketStatuses = new Set(['resolved', 'closed', 'done', 'completed', 'cancelled', 'canceled']);
  const linkedToThisJob = Number(ticket.historyJobId ?? ticket.history_job_id) === Number(job.id);
  const shouldReopen = workflowStatus !== 'completed'
    && linkedToThisJob
    && closedTicketStatuses.has(String(ticket.status || '').trim().toLowerCase());
  ticket.assignedTo = sanitizeText(job.technician, 120);
  if (workflowStatus === 'completed') ticket.status = 'resolved';
  else if (shouldReopen) ticket.status = 'in-progress';
  ticket.historyJobId = Number(job.id) || job.id || null;
  ticket.historyJobCreatedAt = job.createdAt || ticket.historyJobCreatedAt || ticket.history_job_created_at || now;
  ticket.updatedAt = now;
  return ticket;
};

const syncLinkedTicketFromJob = async (job, branchId = null, options = {}) => {
  if (!isTicketWorkOrder(job) || !job.ticketId || !hasBranchId(branchId)) return null;

  const mutateTickets = async (tickets, persist) => {
    const index = tickets.findIndex((ticket) => (
      Number(ticket?.id) === Number(job.ticketId) && isSameBranch(ticket, branchId)
    ));
    if (index < 0) return null;
    const ticket = applyLinkedJobStateToTicket(tickets[index], job);
    tickets[index] = ticket;
    if (persist) await writeTicketsData(tickets);
    return ticket;
  };

  if (Array.isArray(options.tickets)) {
    return mutateTickets(options.tickets, false);
  }

  if (options.connection) {
    const [rows] = await options.connection.query(
      `SELECT id, status, assigned_to AS assignedTo, history_job_id AS historyJobId,
              history_job_created_at AS historyJobCreatedAt, created_at AS createdAt
       FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
      [job.ticketId, branchId]
    );
    if (!rows?.length) return null;
    const ticket = applyLinkedJobStateToTicket(rows[0], job);
    await options.connection.query(
      `UPDATE tickets
       SET status = ?, assigned_to = ?, history_job_id = ?, history_job_created_at = ?, updated_at = ?
       WHERE id = ? AND branch_id = ?`,
      [
        ticket.status || null,
        ticket.assignedTo || null,
        ticket.historyJobId || null,
        toMysqlDateTime(ticket.historyJobCreatedAt),
        toMysqlDateTime(ticket.updatedAt),
        job.ticketId,
        branchId
      ]
    );
    return ticket;
  }

  if (await isRelationalReady()) {
    return withTransaction((connection) => syncLinkedTicketFromJob(job, branchId, { connection }));
  }
  return withJsonTechnicianMutation(async () => mutateTickets(await readTicketsData(), true));
};

const applyTicketStateToLinkedJob = (job, ticket) => {
  const technician = sanitizeText(ticket.assignedTo ?? ticket.assigned_to, 120);
  const previousTechnician = sanitizeText(job.technician, 120);
  const technicianChanged = previousTechnician.toLowerCase() !== technician.toLowerCase();
  const previousStatus = normalizeDispatchStatus(job.workflowStatus || job.status, {
    technician: previousTechnician
  });
  const workflowStatus = technicianChanged && !ACTIVE_LINKED_JOB_TERMINAL_STATUSES.has(previousStatus)
    ? (hasAssignedTechnician(technician) ? 'assigned' : 'unassigned')
    : previousStatus;
  const now = new Date().toISOString();
  return {
    ...job,
    technician,
    workflowStatus,
    status: toLegacyJobStatus(workflowStatus),
    doneAt: workflowStatus === 'completed' ? job.doneAt : null,
    ticketSubject: sanitizeText(ticket.subject, 200),
    description: sanitizeText(ticket.description || ticket.subject, 4000),
    customerAccountNumber: sanitizeText(ticket.accountNumber ?? ticket.account_number, 20),
    customerName: sanitizeText(ticket.customerName ?? ticket.customer_name, 200),
    customerPhone: sanitizeText(ticket.contact, 50),
    version: Number(job.version || job.record_version || 1) + 1,
    updatedAt: now
  };
};

const syncActiveLinkedJobFromTicket = async (ticket, branchId = null, options = {}) => {
  if (!ticket?.id || !hasBranchId(branchId)) return null;

  const mutateJobs = async (jobs, persist) => {
    const index = jobs.findIndex((job) => (
      isSameBranch(job, branchId)
      && Number(job?.ticketId ?? job?.ticket_id) === Number(ticket.id)
      && isActiveTicketWorkOrder(job)
    ));
    if (index < 0) return null;
    const updated = applyTicketStateToLinkedJob(mapJobRow(jobs[index]), ticket);
    jobs[index] = { ...jobs[index], ...updated, branchId: Number(branchId) || String(branchId) };
    if (persist) await writeJobs(jobs);
    return updated;
  };

  if (Array.isArray(options.jobs)) return mutateJobs(options.jobs, false);

  if (options.connection) {
    const [rows] = await options.connection.query(
      `SELECT id, type, technician, priority, schedule, appointment_end AS appointmentEnd,
              sla_due_at AS slaDueAt, status, workflow_status AS workflowStatus, done_at AS doneAt,
              notes, description, customer_account_number AS customerAccountNumber,
              customer_name AS customerName, customer_phone AS customerPhone,
              service_address AS serviceAddress, latitude, longitude, plan_name AS planName,
              dispatch_payload_json AS dispatchPayloadJson, record_version AS version,
              created_at AS createdAt, updated_at AS updatedAt, ticket_id AS ticketId,
              ticket_number AS ticketNumber, ticket_subject AS ticketSubject, origin
       FROM jobs
       WHERE branch_id = ? AND ticket_id = ? AND origin = ?
         AND LOWER(COALESCE(workflow_status, '')) NOT IN ('completed', 'cancelled')
         AND LOWER(COALESCE(status, '')) NOT IN ('done', 'closed', 'resolved', 'completed', 'cancelled')
       ORDER BY created_at DESC, id DESC
       LIMIT 1 FOR UPDATE`,
      [branchId, ticket.id, ORIGIN_TICKET_WORK_ORDER]
    );
    if (!rows?.length) return null;
    const updated = applyTicketStateToLinkedJob(mapJobRow(rows[0]), ticket);
    await options.connection.query(
      `UPDATE jobs
       SET technician = ?, workflow_status = ?, status = ?, done_at = ?,
           ticket_subject = ?, description = ?, customer_account_number = ?, customer_name = ?,
           customer_phone = ?, record_version = ?, updated_at = ?
       WHERE id = ? AND branch_id = ? AND record_version = ?`,
      [
        updated.technician || null,
        updated.workflowStatus,
        updated.status,
        toMysqlDateTime(updated.doneAt),
        updated.ticketSubject || null,
        updated.description || null,
        updated.customerAccountNumber || null,
        updated.customerName || null,
        updated.customerPhone || null,
        updated.version,
        toMysqlDateTime(updated.updatedAt),
        updated.id,
        branchId,
        Number(rows[0].version || 1)
      ]
    );
    return updated;
  }

  if (await isRelationalReady()) {
    return withTransaction((connection) => syncActiveLinkedJobFromTicket(ticket, branchId, { connection }));
  }
  return withJsonTechnicianMutation(async () => mutateJobs(await readAllJobsJson(), true));
};

const readJobsForTechnician = async (branchId = null, technician = null, options = {}) => {
  const identifiers = getTechnicianLookupValues(technician);
  if (!identifiers.length) return [];
  const includeUnassigned = options.includeUnassigned !== false;

  try {
    if (await isRelationalReady()) {
      if (!branchId) return [];
      const statusFilters = Array.from(CLOSED_JOB_STATUSES);
      const selectFields = await getJobSelectFields();
      const assignmentClauses = [`LOWER(TRIM(COALESCE(technician, ''))) IN (${identifiers.map(() => '?').join(', ')})`];
      const params = [branchId, ...identifiers];
      if (includeUnassigned) {
        const unassignedValues = Array.from(UNASSIGNED_JOB_TECHNICIAN_VALUES);
        assignmentClauses.push(`LOWER(TRIM(COALESCE(technician, ''))) IN (${unassignedValues.map(() => '?').join(', ')})`);
        params.push(...unassignedValues);
      }
      let sql = `SELECT
          ${selectFields}
       FROM jobs
       WHERE branch_id = ?
         AND (${assignmentClauses.join(' OR ')})`;
      if (!options.includeClosed) {
        sql += ` AND LOWER(COALESCE(status, '')) NOT IN (${statusFilters.map(() => '?').join(', ')})`;
        params.push(...statusFilters);
      }
      sql += ' ORDER BY created_at DESC';
      const [rows] = await query(sql, params);
      const hydratedRows = await hydrateJobRows(branchId, rows || []);
      return hydratedRows.map(mapJobRow);
    }

    const identifierSet = new Set(identifiers);
    const jobs = await readJobs(branchId);
    return jobs.filter((job) => {
      const assignee = String(job?.technician || '').trim().toLowerCase();
      if (!identifierSet.has(assignee) && !(includeUnassigned && UNASSIGNED_JOB_TECHNICIAN_VALUES.has(assignee))) return false;
      return options.includeClosed ? true : isOpenJobStatus(job?.status);
    });
  } catch (err) {
    console.error('Failed to read technician jobs:', err);
    return [];
  }
};

async function readJobById(branchId, id) {
  const jobId = Number(id);
  if (!Number.isFinite(jobId) || jobId <= 0) return null;
  if (await isRelationalReady()) {
    if (!branchId) return null;
    const selectFields = await getJobSelectFields();
    const [rows] = await query(
      `SELECT ${selectFields} FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1`,
      [jobId, branchId]
    );
    if (!rows?.length) return null;
    const [hydrated] = await hydrateJobRows(branchId, rows.slice(0, 1));
    return mapJobRow(hydrated);
  }
  const jobs = await readJobs(branchId);
  const job = jobs.find((entry) => Number(entry?.id) === jobId);
  if (!job) return null;
  return mapJobRow(job);
}

async function recordJobEvent(job, options = {}) {
  if (!job?.id || !options.branchId) return null;
  return appendJobEvent(buildJobEvent({
    branchId: options.branchId,
    jobId: job.id,
    jobNumber: job.jobNumber,
    eventType: options.eventType,
    fromStatus: options.fromStatus,
    toStatus: options.toStatus,
    actorType: options.actorType,
    actor: options.actor,
    clientEventId: options.clientEventId,
    payload: options.payload
  }));
}

async function changeJobWorkflowStatus({
  branchId,
  technician = null,
  actor = null,
  actorType = 'admin',
  id,
  status,
  expectedVersion = null,
  clientEventId = '',
  details = {},
  allowOverride = false
}) {
  const jobId = Number(id);
  if (!branchId || !Number.isFinite(jobId) || jobId <= 0) return null;

  const normalizedClientEventId = toSafeText(clientEventId, 100);
  if (normalizedClientEventId) {
    const existingEvent = await findExistingEvent(branchId, normalizedClientEventId);
    if (existingEvent) {
      if (technician) {
        const actorKeys = new Set([
          String(existingEvent.actorId || '').trim().toLowerCase(),
          String(existingEvent.actorName || '').trim().toLowerCase()
        ].filter(Boolean));
        const technicianKeys = new Set([
          String(technician.id || '').trim().toLowerCase(),
          String(technician.username || '').trim().toLowerCase(),
          String(technician.name || '').trim().toLowerCase()
        ].filter(Boolean));
        if (![...actorKeys].some((key) => technicianKeys.has(key))) return null;
      }
      const existingJob = await readJobById(branchId, jobId);
      return { job: existingJob, event: existingEvent, duplicate: true };
    }
  }

  const buildMutation = (job) => {
    if (technician) {
      const identifiers = new Set(getTechnicianLookupValues(technician));
      const assignedKey = String(job.technician || '').trim().toLowerCase();
      if (!identifiers.has(assignedKey)) return null;
    }

    const currentStatus = normalizeDispatchStatus(job.workflowStatus || job.status, {
      technician: job.technician
    });
    if (!isDispatchStatusValue(status)) {
      const error = new Error('Job status is invalid.');
      error.statusCode = 400;
      throw error;
    }
    const nextStatus = normalizeDispatchStatus(status, {
      technician: job.technician,
      fallback: currentStatus
    });
    if (!allowOverride && currentStatus !== nextStatus && !canTechnicianTransition(currentStatus, nextStatus)) {
      const error = new Error(`Job cannot move from ${currentStatus} to ${nextStatus}.`);
      error.statusCode = 409;
      throw error;
    }
    const currentVersion = Number(job.version || 1);
    if (expectedVersion != null && Number(expectedVersion) !== currentVersion) {
      const error = new Error('Job changed on the server. Refresh and try again.');
      error.statusCode = 409;
      error.currentJob = job;
      throw error;
    }

    const now = new Date().toISOString();
    const nextPayload = normalizeDispatchPayload(details, job.dispatchPayload);
    const nextVersion = currentVersion + 1;
    const nextTechnician = nextStatus === 'rejected' && actorType === 'technician'
      ? ''
      : job.technician;
    return {
      currentStatus,
      nextStatus,
      nextPayload,
      currentVersion,
      nextVersion,
      updated: {
        ...job,
        technician: nextTechnician,
        workflowStatus: nextStatus,
        status: toLegacyJobStatus(nextStatus),
        doneAt: nextStatus === 'completed' ? now : null,
        dispatchPayload: nextPayload,
        version: nextVersion,
        updatedAt: now
      }
    };
  };

  let mutation;
  if (await isRelationalReady()) {
    const preliminary = await readJobById(branchId, jobId);
    if (!preliminary) return null;
    const selectFields = await getJobSelectFields();
    mutation = await withTransaction(async (connection) => {
      if (isTicketWorkOrder(preliminary) && preliminary.ticketId) {
        await connection.query(
          'SELECT id FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE',
          [preliminary.ticketId, branchId]
        );
      }
      const [rows] = await connection.query(
        `SELECT ${selectFields} FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
        [jobId, branchId]
      );
      if (!rows?.length) return null;
      const state = buildMutation(mapJobRow({ ...rows[0], branchId }));
      if (!state) return null;
      const [updateResult] = await connection.query(
        `UPDATE jobs
         SET technician = ?, workflow_status = ?, status = ?, done_at = ?,
             dispatch_payload_json = ?, record_version = ?, updated_at = ?
         WHERE id = ? AND branch_id = ? AND record_version = ?`,
        [
          state.updated.technician || null,
          state.updated.workflowStatus,
          state.updated.status,
          toMysqlDateTime(state.updated.doneAt),
          JSON.stringify(state.updated.dispatchPayload || {}),
          state.updated.version,
          toMysqlDateTime(state.updated.updatedAt),
          jobId,
          branchId,
          state.currentVersion
        ]
      );
      if (Number.isFinite(Number(updateResult?.affectedRows)) && Number(updateResult.affectedRows) !== 1) {
        const error = new Error('Job changed on the server. Refresh and try again.');
        error.statusCode = 409;
        error.currentJob = state.updated;
        throw error;
      }
      await syncLinkedTicketFromJob(state.updated, branchId, { connection });
      return state;
    });
  } else {
    mutation = await withJsonTechnicianMutation(async () => {
      const jobs = await readAllJobsJson();
      const index = jobs.findIndex((entry) => (
        Number(entry?.id) === jobId && isSameBranch(entry, branchId)
      ));
      if (index < 0) return null;
      const state = buildMutation(mapJobRow({ ...jobs[index], branchId }));
      if (!state) return null;
      jobs[index] = {
        ...jobs[index],
        ...state.updated,
        branchId: Number(branchId) || String(branchId)
      };
      const tickets = await readTicketsData();
      const linkedTicket = await syncLinkedTicketFromJob(state.updated, branchId, { tickets });
      await writeJobs(jobs);
      if (linkedTicket) await writeTicketsData(tickets);
      return state;
    });
  }
  if (!mutation) return null;

  const { updated, currentStatus, nextStatus, nextPayload, nextVersion } = mutation;

  const eventResult = await recordJobEvent(updated, {
    branchId,
    eventType: 'status_changed',
    fromStatus: currentStatus,
    toStatus: nextStatus,
    actorType,
    actor: actor || technician,
    clientEventId: normalizedClientEventId,
    payload: { details: nextPayload, version: nextVersion }
  });
  return {
    job: updated,
    event: eventResult?.event || null,
    duplicate: Boolean(eventResult?.duplicate)
  };
}

const markJobDoneForTechnician = async (branchId = null, technician = null, id) => {
  const result = await changeJobWorkflowStatus({
    branchId,
    technician,
    actor: technician,
    actorType: 'technician',
    id,
    status: 'completed',
    allowOverride: false
  });
  return result?.job || null;
};

router.get('/', async (req, res) => {
  const jobs = await readJobs(req.user?.branchId || null);
  // return newest first
  jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json({ ok: true, jobs });
});

router.get('/dispatch-summary', async (req, res) => {
  const jobs = (await readJobs(req.user?.branchId || null)).map(mapJobRow);
  const now = Date.now();
  const activeStatuses = new Set(['assigned', 'accepted', 'traveling', 'on_site']);
  const terminalStatuses = new Set(['completed', 'cancelled']);
  const workloads = new Map();
  jobs.forEach((job) => {
    const status = normalizeDispatchStatus(job.workflowStatus || job.status, { technician: job.technician });
    const technician = sanitizeText(job.technician, 120);
    if (technician) {
      const current = workloads.get(technician) || { technician, total: 0, active: 0, urgent: 0, overdue: 0 };
      current.total += 1;
      if (activeStatuses.has(status)) current.active += 1;
      if (['urgent', 'emergency'].includes(String(job.priority || '').toLowerCase()) && !terminalStatuses.has(status)) {
        current.urgent += 1;
      }
      const sla = new Date(job.slaDueAt || 0).getTime();
      if (sla > 0 && sla < now && !terminalStatuses.has(status)) current.overdue += 1;
      workloads.set(technician, current);
    }
  });
  const countStatus = (status) => jobs.filter((job) =>
    normalizeDispatchStatus(job.workflowStatus || job.status, { technician: job.technician }) === status
  ).length;
  const overdue = jobs.filter((job) => {
    const status = normalizeDispatchStatus(job.workflowStatus || job.status, { technician: job.technician });
    const sla = new Date(job.slaDueAt || 0).getTime();
    return sla > 0 && sla < now && !terminalStatuses.has(status);
  }).length;
  return res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    metrics: {
      total: jobs.length,
      unassigned: countStatus('unassigned'),
      active: jobs.filter((job) => activeStatuses.has(normalizeDispatchStatus(
        job.workflowStatus || job.status,
        { technician: job.technician }
      ))).length,
      overdue,
      completed: countStatus('completed')
    },
    workloads: Array.from(workloads.values()).sort((left, right) => right.active - left.active)
  });
});

router.get('/export.csv', async (req, res) => {
  const jobs = (await readJobs(req.user?.branchId || null)).map(mapJobRow);
  const escapeCsv = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  const rows = [[
    'Job Number', 'Type', 'Customer Account', 'Customer', 'Phone', 'Service Address',
    'Plan', 'Technician', 'Priority', 'Appointment Start', 'Appointment End', 'SLA Due',
    'Status', 'Created At', 'Updated At', 'Completed At'
  ]];
  jobs.forEach((job) => rows.push([
    job.jobNumber,
    job.type,
    job.customerAccountNumber,
    job.customerName,
    job.customerPhone,
    job.serviceAddress,
    job.planName,
    job.technician,
    job.priority,
    job.appointmentStart,
    job.appointmentEnd,
    job.slaDueAt,
    job.workflowStatus,
    job.createdAt,
    job.updatedAt,
    job.doneAt
  ]));
  const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
  const fileDate = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="technician-jobs-${fileDate}.csv"`);
  return res.send(`\uFEFF${csv}`);
});

router.get('/:id/events', async (req, res) => {
  const branchId = req.user?.branchId || null;
  const job = await readJobById(branchId, req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
  const events = await readJobEvents(branchId, job.id);
  return res.json({ ok: true, jobId: job.id, jobNumber: job.jobNumber, events });
});

router.patch('/:id/status', async (req, res) => {
  try {
    const branchId = req.user?.branchId || null;
    const result = await changeJobWorkflowStatus({
      branchId,
      actor: req.user,
      actorType: 'admin',
      id: req.params.id,
      status: req.body?.status,
      expectedVersion: req.body?.expectedVersion,
      clientEventId: req.body?.clientEventId,
      details: req.body?.details || req.body,
      allowOverride: true
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Job not found' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to change job status.',
      currentJob: error?.currentJob || undefined
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const customerSnapshot = await resolveCustomerSnapshot(branchId, payload);
    const mergedPayload = mergeCustomerSnapshot(payload, customerSnapshot);
    const { fields, error } = buildEditableJobFields(mergedPayload, { requireTechnician: false });
    if (error) return res.status(400).json({ ok: false, error });

    const now = new Date().toISOString();
    const workflowStatus = hasAssignedTechnician(fields.technician) ? 'assigned' : 'unassigned';
    const job = {
      ...fields,
      schedule: fields.appointmentStart,
      workflowStatus,
      status: toLegacyJobStatus(workflowStatus),
      doneAt: null,
      version: 1,
      origin: ORIGIN_JOB,
      createdAt: now,
      updatedAt: now
    };
    const saved = await addJobEntry(job, branchId);
    await recordJobEvent(saved, {
      branchId,
      eventType: 'created',
      toStatus: workflowStatus,
      actorType: 'admin',
      actor: req.user,
      clientEventId: payload.clientEventId,
      payload: { version: saved.version || 1 }
    });
    return res.status(201).json({ ok: true, job: mapJobRow(saved) });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to create job.'
    });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const current = await readJobById(branchId, id);
    if (!current) return res.status(404).json({ ok: false, error: 'Job not found' });

    const customerSnapshot = await resolveCustomerSnapshot(branchId, req.body || {});
    const mergedPayload = mergeCustomerSnapshot(req.body || {}, customerSnapshot);
    const { fields, error } = buildEditableJobFields(mergedPayload, {
      requireTechnician: false,
      current
    });
    if (error) return res.status(400).json({ ok: false, error });

    const previousTechnician = sanitizeText(current.technician, 120);
    const technicianChanged = previousTechnician.toLowerCase() !== fields.technician.toLowerCase();
    const previousStatus = normalizeDispatchStatus(current.workflowStatus || current.status, {
      technician: previousTechnician
    });
    const workflowStatus = technicianChanged && !['completed', 'cancelled'].includes(previousStatus)
      ? (hasAssignedTechnician(fields.technician) ? 'assigned' : 'unassigned')
      : previousStatus;
    const now = new Date().toISOString();
    const updated = {
      ...current,
      ...fields,
      schedule: fields.appointmentStart,
      workflowStatus,
      status: toLegacyJobStatus(workflowStatus),
      doneAt: workflowStatus === 'completed' ? current.doneAt : null,
      version: Number(current.version || 1) + 1,
      updatedAt: now
    };

    if (await isRelationalReady()) {
      await withTransaction(async (connection) => {
        if (isTicketWorkOrder(current) && current.ticketId) {
          await connection.query(
            'SELECT id FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE',
            [current.ticketId, branchId]
          );
        }
        const [lockedRows] = await connection.query(
          'SELECT record_version AS version FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE',
          [id, branchId]
        );
        if (!lockedRows?.length) {
          const notFound = new Error('Job not found');
          notFound.statusCode = 404;
          throw notFound;
        }
        if (Number(lockedRows[0].version || 1) !== Number(current.version || 1)) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          conflict.currentJob = current;
          throw conflict;
        }
        const [updateResult] = await connection.query(
        `UPDATE jobs
         SET type = ?, technician = ?, priority = ?, schedule = ?, appointment_end = ?, sla_due_at = ?,
             status = ?, workflow_status = ?, done_at = ?, notes = ?, description = ?,
             customer_account_number = ?, customer_name = ?, customer_phone = ?, service_address = ?,
             latitude = ?, longitude = ?, plan_name = ?, dispatch_payload_json = ?, record_version = ?, updated_at = ?
         WHERE id = ? AND branch_id = ? AND record_version = ?`,
        [
          updated.type || null,
          updated.technician || null,
          updated.priority || null,
          toMysqlDateTime(updated.schedule),
          toMysqlDateTime(updated.appointmentEnd),
          toMysqlDateTime(updated.slaDueAt),
          updated.status,
          updated.workflowStatus,
          toMysqlDateTime(updated.doneAt),
          updated.notes || null,
          updated.description || null,
          updated.customerAccountNumber || null,
          updated.customerName || null,
          updated.customerPhone || null,
          updated.serviceAddress || null,
          updated.latitude,
          updated.longitude,
          updated.planName || null,
          JSON.stringify(updated.dispatchPayload || {}),
          updated.version,
          toMysqlDateTime(updated.updatedAt),
          id,
          branchId,
          Number(current.version || 1)
        ]
        );
        if (Number.isFinite(Number(updateResult?.affectedRows)) && Number(updateResult.affectedRows) !== 1) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          throw conflict;
        }
        await syncLinkedTicketFromJob(updated, branchId, { connection });
      });
    } else {
      await withJsonTechnicianMutation(async () => {
        const jobs = await readAllJobsJson();
        const index = jobs.findIndex((job) => Number(job?.id) === id && isSameBranch(job, branchId));
        if (index < 0) {
          const notFound = new Error('Job not found');
          notFound.statusCode = 404;
          throw notFound;
        }
        if (Number(jobs[index].version || jobs[index].record_version || 1) !== Number(current.version || 1)) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          conflict.currentJob = mapJobRow(jobs[index]);
          throw conflict;
        }
        jobs[index] = { ...jobs[index], ...updated, branchId: Number(branchId) || String(branchId) };
        const tickets = await readTicketsData();
        const linkedTicket = await syncLinkedTicketFromJob(updated, branchId, { tickets });
        await writeJobs(jobs);
        if (linkedTicket) await writeTicketsData(tickets);
      });
    }

    await recordJobEvent(updated, {
      branchId,
      eventType: technicianChanged ? 'reassigned' : 'updated',
      fromStatus: previousStatus,
      toStatus: workflowStatus,
      actorType: 'admin',
      actor: req.user,
      clientEventId: req.body?.clientEventId,
      payload: {
        previousTechnician,
        technician: updated.technician,
        previousLocation: {
          latitude: current.latitude,
          longitude: current.longitude
        },
        location: {
          latitude: updated.latitude,
          longitude: updated.longitude
        },
        version: updated.version
      }
    });
    return res.json({ ok: true, job: updated });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to update job.'
    });
  }
});

router.patch('/:id/done', async (req, res) => {
  try {
    const result = await changeJobWorkflowStatus({
      branchId: req.user?.branchId || null,
      actor: req.user,
      actorType: 'admin',
      id: req.params.id,
      status: 'completed',
      clientEventId: req.body?.clientEventId,
      details: req.body?.details || {},
      allowOverride: true
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Job not found' });
    return res.json({ ok: true, job: result.job, event: result.event });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to complete job.'
    });
  }
});

router.patch('/:id/assign', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const current = await readJobById(branchId, id);
    if (!current) return res.status(404).json({ ok: false, error: 'Job not found' });

    const technicianInput = sanitizeText(req.body?.technician, 120);
    const technician = hasAssignedTechnician(technicianInput) ? technicianInput : '';
    const workflowStatus = technician ? 'assigned' : 'unassigned';
    const now = new Date().toISOString();
    const updated = {
      ...current,
      technician,
      workflowStatus,
      status: toLegacyJobStatus(workflowStatus),
      doneAt: null,
      version: Number(current.version || 1) + 1,
      updatedAt: now
    };

    if (await isRelationalReady()) {
      await withTransaction(async (connection) => {
        if (isTicketWorkOrder(current) && current.ticketId) {
          await connection.query(
            'SELECT id FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE',
            [current.ticketId, branchId]
          );
        }
        const [lockedRows] = await connection.query(
          'SELECT record_version AS version FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE',
          [id, branchId]
        );
        if (!lockedRows?.length) {
          const notFound = new Error('Job not found');
          notFound.statusCode = 404;
          throw notFound;
        }
        if (Number(lockedRows[0].version || 1) !== Number(current.version || 1)) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          conflict.currentJob = current;
          throw conflict;
        }
        const [updateResult] = await connection.query(
        `UPDATE jobs
         SET technician = ?, workflow_status = ?, status = ?, done_at = NULL,
             record_version = ?, updated_at = ?
         WHERE id = ? AND branch_id = ? AND record_version = ?`,
        [
          technician || null,
          workflowStatus,
          updated.status,
          updated.version,
          toMysqlDateTime(now),
          id,
          branchId,
          Number(current.version || 1)
        ]
        );
        if (Number.isFinite(Number(updateResult?.affectedRows)) && Number(updateResult.affectedRows) !== 1) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          throw conflict;
        }
        await syncLinkedTicketFromJob(updated, branchId, { connection });
      });
    } else {
      await withJsonTechnicianMutation(async () => {
        const jobs = await readAllJobsJson();
        const index = jobs.findIndex((job) => Number(job?.id) === id && isSameBranch(job, branchId));
        if (index < 0) {
          const notFound = new Error('Job not found');
          notFound.statusCode = 404;
          throw notFound;
        }
        if (Number(jobs[index].version || jobs[index].record_version || 1) !== Number(current.version || 1)) {
          const conflict = new Error('Job changed on the server. Refresh and try again.');
          conflict.statusCode = 409;
          conflict.currentJob = mapJobRow(jobs[index]);
          throw conflict;
        }
        jobs[index] = { ...jobs[index], ...updated, branchId: Number(branchId) || String(branchId) };
        const tickets = await readTicketsData();
        const linkedTicket = await syncLinkedTicketFromJob(updated, branchId, { tickets });
        await writeJobs(jobs);
        if (linkedTicket) await writeTicketsData(tickets);
      });
    }

    await recordJobEvent(updated, {
      branchId,
      eventType: 'reassigned',
      fromStatus: current.workflowStatus,
      toStatus: workflowStatus,
      actorType: 'admin',
      actor: req.user,
      clientEventId: req.body?.clientEventId,
      payload: {
        previousTechnician: current.technician || '',
        technician,
        version: updated.version
      }
    });
    return res.json({ ok: true, job: updated });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to assign job.'
    });
  }
});

router.patch('/:id/undo', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const job = await readJobById(branchId, id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });

    if (String(job.status || '').toLowerCase() !== 'done') {
      return res.status(400).json({ ok: false, error: 'Job is not marked done' });
    }

    const doneAt = new Date(job.doneAt || job.updatedAt || Date.now());
    if (Number.isNaN(doneAt)) {
      return res.status(400).json({ ok: false, error: 'Cannot undo (invalid completion time)' });
    }
    const diffMs = Date.now() - doneAt.getTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (diffMs > threeDaysMs) {
      return res.status(400).json({ ok: false, error: 'Undo window has expired' });
    }

    if (job.origin === ORIGIN_TICKET) {
      if (await isRelationalReady()) {
        await withTransaction(async (connection) => {
          await connection.query(
            `UPDATE tickets
             SET status = 'in-progress', history_job_id = NULL, history_job_created_at = NULL, updated_at = ?
             WHERE id = ? AND branch_id = ?`,
            [toMysqlDateTime(new Date()), job.ticketId, branchId]
          );
          await connection.query(
            'DELETE FROM jobs WHERE id = ? AND branch_id = ? AND origin = ?',
            [id, branchId, ORIGIN_TICKET]
          );
        });
      } else {
        await withJsonTechnicianMutation(async () => {
          const jobs = await readAllJobsJson();
          const index = jobs.findIndex((entry) => Number(entry?.id) === id && isSameBranch(entry, branchId));
          if (index < 0) return;
          const tickets = await readTicketsData();
          const ticket = tickets.find((entry) => (
            Number(entry?.id) === Number(job.ticketId) && isSameBranch(entry, branchId)
          ));
          if (ticket) {
            ticket.status = 'in-progress';
            delete ticket.historyJobId;
            delete ticket.historyJobCreatedAt;
            ticket.updatedAt = new Date().toISOString();
          }
          jobs.splice(index, 1);
          await writeJobs(jobs);
          if (ticket) await writeTicketsData(tickets);
        });
      }
      return res.json({ ok: true, job });
    }

    const result = await changeJobWorkflowStatus({
      branchId,
      id,
      status: hasAssignedTechnician(job.technician) ? 'assigned' : 'unassigned',
      expectedVersion: job.version,
      allowOverride: true,
      actorType: 'admin',
      actor: req.user,
      clientEventId: req.body?.clientEventId,
      details: req.body?.details || {}
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Job not found' });
    return res.json({ ok: true, job: result.job, event: result.event });
  } catch (error) {
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error?.message || 'Unable to undo job completion.',
      currentJob: error?.currentJob || undefined
    });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const branchId = req.user?.branchId || null;
  if (!branchId) {
    return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
  }
  if (await isRelationalReady()) {
    const selectFields = await getJobSelectFields();
    const [rows] = await query(
      `SELECT ${selectFields}
       FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1`,
      [id, branchId]
    );
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: 'Job not found' });
    const [hydratedRow] = await hydrateJobRows(branchId, rows.slice(0, 1));
    const job = mapJobRow(hydratedRow);
    await recordJobEvent(job, {
      branchId,
      eventType: 'deleted',
      fromStatus: job.workflowStatus,
      actorType: 'admin',
      actor: req.user,
      payload: { deleted: true, version: job.version }
    });
    await query('DELETE FROM jobs WHERE id = ? AND branch_id = ?', [id, branchId]);
    return res.json({ ok: true, job });
  }

  const removed = await withJsonTechnicianMutation(async () => {
    const jobs = await readAllJobsJson();
    const idx = jobs.findIndex((job) => Number(job?.id) === id && isSameBranch(job, branchId));
    if (idx < 0) return null;
    const [job] = jobs.splice(idx, 1);
    await writeJobs(jobs);
    return job;
  });
  if (!removed) return res.status(404).json({ ok: false, error: 'Job not found' });
  await recordJobEvent(mapJobRow(removed), {
    branchId,
    eventType: 'deleted',
    fromStatus: removed.workflowStatus || removed.status,
    actorType: 'admin',
    actor: req.user,
    payload: { deleted: true, version: removed.version || 1 }
  });
  res.json({ ok: true, job: removed });
});

router.addHistoryJobFromTicket = createJobFromTicket;
router.addJobEntry = addJobEntry;
router.removeHistoryJobForTicket = removeHistoryJobForTicket;
router.createWorkOrderFromTicket = createWorkOrderFromTicket;
router.findTicketWorkOrder = findTicketWorkOrder;
router.readTicketWorkOrders = readTicketWorkOrders;
router.isActiveTicketWorkOrder = isActiveTicketWorkOrder;
router.syncLinkedTicketFromJob = syncLinkedTicketFromJob;
router.syncActiveLinkedJobFromTicket = syncActiveLinkedJobFromTicket;
router.withJsonTechnicianMutation = withJsonTechnicianMutation;
router.readJobsForTechnician = readJobsForTechnician;
router.isOpenJobStatus = isOpenJobStatus;
router.deriveJobStatus = deriveJobStatus;
router.markJobDoneForTechnician = markJobDoneForTechnician;
router.readJobById = readJobById;
router.changeJobWorkflowStatus = changeJobWorkflowStatus;
router.readJobEvents = readJobEvents;
router.normalizeDispatchStatus = normalizeDispatchStatus;

module.exports = router;
