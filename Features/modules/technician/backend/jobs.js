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
    const parsed = await readJson(STORE_KEYS.jobs, []);
    return Array.isArray(parsed)
      ? parsed.map((row) => ({ ...row, ...mapJobRow(row) }))
      : [];
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
    String(entry?.accountNumber || '').trim() === accountNumber
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
const ORIGIN_JOB = 'job';

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
  if (!ticketId) return null;
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
  const idx = tickets.findIndex((t) => Number(t.id) === Number(ticketId));
  if (idx < 0) return null;
  const ticket = tickets[idx];
  ticket.status = 'in-progress';
  delete ticket.historyJobId;
  delete ticket.historyJobCreatedAt;
  ticket.updatedAt = new Date().toISOString();
  await writeTicketsData(tickets);
  return ticket;
};

const addJobEntry = async (job, branchId = null) => {
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
  const jobs = await readJobs();
  job.id = nextId(jobs);
  job.branchId = Number(branchId) || job.branchId || null;
  jobs.unshift(job);
  await writeJobs(jobs);
  return job;
};

const createJobFromTicket = async (ticket, branchId = null) => {
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
  return addJobEntry(job, branchId);
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

  const jobs = await readJobs(branchId);
  const nextJobs = jobs.filter((job) => {
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
  const jobs = await readJobs();
  const job = jobs.find((entry) => Number(entry?.id) === jobId);
  if (!job) return null;
  if (branchId && job.branchId && Number(job.branchId) !== Number(branchId)) return null;
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

  const job = await readJobById(branchId, jobId);
  if (!job) return null;

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
  if (expectedVersion != null && Number(expectedVersion) !== Number(job.version || 1)) {
    const error = new Error('Job changed on the server. Refresh and try again.');
    error.statusCode = 409;
    error.currentJob = job;
    throw error;
  }

  const now = new Date().toISOString();
  const nextPayload = normalizeDispatchPayload(details, job.dispatchPayload);
  const nextVersion = Number(job.version || 1) + 1;
  const nextTechnician = ['rejected'].includes(nextStatus) && actorType === 'technician'
    ? ''
    : job.technician;
  const updated = {
    ...job,
    technician: nextTechnician,
    workflowStatus: nextStatus,
    status: toLegacyJobStatus(nextStatus),
    doneAt: nextStatus === 'completed' ? now : null,
    dispatchPayload: nextPayload,
    version: nextVersion,
    updatedAt: now
  };

  if (await isRelationalReady()) {
    await query(
      `UPDATE jobs
       SET technician = ?, workflow_status = ?, status = ?, done_at = ?,
           dispatch_payload_json = ?, record_version = ?, updated_at = ?
       WHERE id = ? AND branch_id = ?`,
      [
        updated.technician || null,
        updated.workflowStatus,
        updated.status,
        toMysqlDateTime(updated.doneAt),
        JSON.stringify(updated.dispatchPayload || {}),
        updated.version,
        toMysqlDateTime(updated.updatedAt),
        jobId,
        branchId
      ]
    );
  } else {
    const jobs = await readJobs();
    const index = jobs.findIndex((entry) => Number(entry?.id) === jobId);
    if (index < 0) return null;
    jobs[index] = { ...jobs[index], ...updated, branchId: jobs[index].branchId || branchId };
    await writeJobs(jobs);
  }

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
      await query(
        `UPDATE jobs
         SET type = ?, technician = ?, priority = ?, schedule = ?, appointment_end = ?, sla_due_at = ?,
             status = ?, workflow_status = ?, done_at = ?, notes = ?, description = ?,
             customer_account_number = ?, customer_name = ?, customer_phone = ?, service_address = ?,
             latitude = ?, longitude = ?, plan_name = ?, dispatch_payload_json = ?, record_version = ?, updated_at = ?
         WHERE id = ? AND branch_id = ?`,
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
          branchId
        ]
      );
    } else {
      const jobs = await readJobs();
      const index = jobs.findIndex((job) => Number(job?.id) === id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Job not found' });
      jobs[index] = { ...jobs[index], ...updated, branchId: jobs[index].branchId || branchId };
      await writeJobs(jobs);
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
      await query(
        `UPDATE jobs
         SET technician = ?, workflow_status = ?, status = ?, done_at = NULL,
             record_version = ?, updated_at = ?
         WHERE id = ? AND branch_id = ?`,
        [
          technician || null,
          workflowStatus,
          updated.status,
          updated.version,
          toMysqlDateTime(now),
          id,
          branchId
        ]
      );
    } else {
      const jobs = await readJobs();
      const index = jobs.findIndex((job) => Number(job?.id) === id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Job not found' });
      jobs[index] = { ...jobs[index], ...updated, branchId: jobs[index].branchId || branchId };
      await writeJobs(jobs);
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
  const id = Number(req.params.id);
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const selectFields = await getJobSelectFields();
    const [rows] = await query(
      `SELECT ${selectFields}
       FROM jobs WHERE id = ? AND branch_id = ? LIMIT 1`,
      [id, branchId]
    );
    if (!rows || !rows.length) return res.status(404).json({ ok: false, error: 'Job not found' });
    const [hydratedRow] = await hydrateJobRows(branchId, rows.slice(0, 1));
    const job = mapJobRow(hydratedRow);

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
      await revertTicketStatus(job.ticketId, branchId);
      await query('DELETE FROM jobs WHERE id = ? AND branch_id = ?', [id, branchId]);
      return res.json({ ok: true, job });
    }

    job.status = 'scheduled';
    job.workflowStatus = hasAssignedTechnician(job.technician) ? 'assigned' : 'unassigned';
    job.doneAt = null;
    job.version = Number(job.version || 1) + 1;
    job.updatedAt = new Date().toISOString();
    await query(
      `UPDATE jobs
       SET status = ?, workflow_status = ?, done_at = NULL, record_version = ?, updated_at = ?
       WHERE id = ? AND branch_id = ?`,
      [job.status, job.workflowStatus, job.version, toMysqlDateTime(job.updatedAt), id, branchId]
    );
    await recordJobEvent(job, {
      branchId,
      eventType: 'reopened',
      fromStatus: 'completed',
      toStatus: job.workflowStatus,
      actorType: 'admin',
      actor: req.user,
      payload: { version: job.version }
    });
    return res.json({ ok: true, job });
  }

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });

  if (String(jobs[idx].status || '').toLowerCase() !== 'done') {
    return res.status(400).json({ ok: false, error: 'Job is not marked done' });
  }

  const doneAt = new Date(jobs[idx].doneAt || jobs[idx].updatedAt || Date.now());
  if (Number.isNaN(doneAt)) {
    return res.status(400).json({ ok: false, error: 'Cannot undo (invalid completion time)' });
  }
  const diffMs = Date.now() - doneAt.getTime();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  if (diffMs > threeDaysMs) {
    return res.status(400).json({ ok: false, error: 'Undo window has expired' });
  }

  const job = jobs[idx];
  job.status = 'scheduled';
  job.workflowStatus = hasAssignedTechnician(job.technician) ? 'assigned' : 'unassigned';
  job.doneAt = null;
  job.version = Number(job.version || 1) + 1;
  job.updatedAt = new Date().toISOString();
  if (job.origin === ORIGIN_TICKET) {
    await revertTicketStatus(job.ticketId);
    jobs.splice(idx, 1);
  }
  await writeJobs(jobs);
  if (job.origin !== ORIGIN_TICKET) {
    await recordJobEvent(job, {
      branchId: req.user?.branchId || job.branchId || null,
      eventType: 'reopened',
      fromStatus: 'completed',
      toStatus: job.workflowStatus,
      actorType: 'admin',
      actor: req.user,
      payload: { version: job.version }
    });
  }
  res.json({ ok: true, job });
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
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

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });
  const removed = jobs.splice(idx, 1)[0];
  await writeJobs(jobs);
  await recordJobEvent(mapJobRow(removed), {
    branchId: req.user?.branchId || removed.branchId || null,
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
router.readJobsForTechnician = readJobsForTechnician;
router.isOpenJobStatus = isOpenJobStatus;
router.deriveJobStatus = deriveJobStatus;
router.markJobDoneForTechnician = markJobDoneForTechnician;
router.readJobById = readJobById;
router.changeJobWorkflowStatus = changeJobWorkflowStatus;
router.readJobEvents = readJobEvents;
router.normalizeDispatchStatus = normalizeDispatchStatus;

module.exports = router;
