const express = require('express');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const {
  assignFallbackManualJobNumber,
  getJobSelectFields,
  hasJobNumberColumn,
  hydrateJobRows,
  nextManualJobNumberValue,
  toJobNumberLabel,
  withTransaction
} = require('./job-numbering');

const router = express.Router();
const STORE_KEYS = {
  jobs: 'jobs',
  tickets: 'tickets'
};
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

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
  return {
    id: Number(row.id) || row.id,
    jobNumber: toJobNumberLabel(row),
    type: row.type || '',
    technician: row.technician || '',
    priority: row.priority || '',
    schedule: row.schedule || '',
    status: row.status || '',
    doneAt: row.doneAt || row.done_at || null,
    notes: notes || description,
    description,
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
    return Array.isArray(parsed) ? parsed : [];
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
    'status',
    'done_at',
    'notes',
    'description',
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
  const values = [branchId];
  if (useJobNumberColumn) values.push(storedJobNumber);
  values.push(
    job.type || null,
    job.technician || null,
    job.priority || null,
    toMysqlDateTime(job.schedule),
    job.status || null,
    toMysqlDateTime(job.doneAt),
    job.notes || null,
    job.description || null,
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

const buildEditableJobFields = (payload = {}, { requireTechnician = true } = {}) => {
  const type = sanitizeText(payload.type, 80).toLowerCase();
  const technician = sanitizeText(payload.technician, 120);
  const schedule = sanitizeText(payload.schedule, 40);
  const notes = sanitizeText(payload.notes || payload.description, 400);
  const description = sanitizeText(payload.description || payload.notes, 4000);

  if (!type || !schedule || (requireTechnician && !technician)) {
    return { error: 'type, technician, and schedule are required' };
  }

  if (!toMysqlDateTime(schedule)) {
    return { error: 'schedule is invalid' };
  }

  return {
    fields: {
      type,
      technician,
      schedule,
      notes,
      description
    }
  };
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

const markJobDoneForTechnician = async (branchId = null, technician = null, id) => {
  const jobId = Number(id);
  const identifiers = getTechnicianLookupValues(technician);
  if (!Number.isFinite(jobId) || jobId <= 0 || !identifiers.length) return null;

  if (await isRelationalReady()) {
    if (!branchId) return null;
    const selectFields = await getJobSelectFields();
    const [rows] = await query(
      `SELECT ${selectFields}
       FROM jobs
       WHERE id = ?
         AND branch_id = ?
         AND LOWER(TRIM(COALESCE(technician, ''))) IN (${identifiers.map(() => '?').join(', ')})
       LIMIT 1`,
      [jobId, branchId, ...identifiers]
    );
    if (!rows || !rows.length) return null;
    const [hydratedRow] = await hydrateJobRows(branchId, rows.slice(0, 1));
    const job = mapJobRow(hydratedRow);
    if (deriveJobStatus(job) !== 'in-progress') return null;
    job.status = 'done';
    job.doneAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    await query(
      'UPDATE jobs SET status = ?, done_at = ?, updated_at = ? WHERE id = ? AND branch_id = ?',
      [job.status, toMysqlDateTime(job.doneAt), toMysqlDateTime(job.updatedAt), jobId, branchId]
    );
    return job;
  }

  const identifierSet = new Set(identifiers);
  const jobs = await readJobs(branchId);
  const idx = jobs.findIndex((job) =>
    Number(job?.id) === jobId &&
    identifierSet.has(String(job?.technician || '').trim().toLowerCase())
  );
  if (idx < 0) return null;
  if (deriveJobStatus(jobs[idx]) !== 'in-progress') return null;

  jobs[idx].status = 'done';
  jobs[idx].doneAt = new Date().toISOString();
  jobs[idx].updatedAt = new Date().toISOString();
  await writeJobs(jobs);
  return jobs[idx];
};

router.get('/', async (req, res) => {
  const jobs = await readJobs(req.user?.branchId || null);
  // return newest first
  jobs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json({ ok: true, jobs });
});

router.post('/', async (req, res) => {
  const payload = req.body || {};
  const type = String(payload.type || '').trim();
  const technician = String(payload.technician || '').trim();
  const priority = String(payload.priority || 'normal').trim();
  const schedule = String(payload.schedule || '').trim();
  const notes = String(payload.notes || payload.description || '').trim();
  const description = String(payload.description || payload.notes || '').trim();

  if (!type || !technician || !schedule) {
    return res.status(400).json({ ok: false, error: 'type, technician, and schedule are required' });
  }
  const branchId = req.user?.branchId || null;
  if (!branchId && await isRelationalReady()) {
    return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
  }

  const job = {
    type,
    technician,
    priority,
    schedule,
    status: 'scheduled',
    doneAt: null,
    notes,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  job.origin = ORIGIN_JOB;
  if (await isRelationalReady()) {
    const saved = await addJobEntry(job, branchId);
    return res.status(201).json({ ok: true, job: saved });
  }

  const jobs = await readJobs();
  job.id = nextId(jobs);
  jobs.unshift(job);
  await writeJobs(jobs);
  res.status(201).json({ ok: true, job });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { fields, error } = buildEditableJobFields(req.body || {}, { requireTechnician: false });
  if (error) {
    return res.status(400).json({ ok: false, error });
  }

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
    const currentStatus = sanitizeText(job.status, 40).toLowerCase();

    job.type = fields.type;
    job.technician = fields.technician;
    job.schedule = fields.schedule;
    job.notes = fields.notes;
    job.description = fields.description;
    if (!CLOSED_JOB_STATUSES.has(currentStatus) && !hasAssignedTechnician(fields.technician)) {
      job.status = 'scheduled';
      job.doneAt = null;
    }
    job.updatedAt = new Date().toISOString();

    await query(
      `UPDATE jobs
       SET type = ?, technician = ?, schedule = ?, status = ?, done_at = ?, notes = ?, description = ?, updated_at = ?
       WHERE id = ? AND branch_id = ?`,
      [
        job.type || null,
        job.technician || null,
        toMysqlDateTime(job.schedule),
        job.status || null,
        toMysqlDateTime(job.doneAt),
        job.notes || null,
        job.description || null,
        toMysqlDateTime(job.updatedAt),
        id,
        branchId
      ]
    );
    return res.json({ ok: true, job });
  }

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });
  const currentStatus = sanitizeText(jobs[idx].status, 40).toLowerCase();

  jobs[idx].type = fields.type;
  jobs[idx].technician = fields.technician;
  jobs[idx].schedule = fields.schedule;
  jobs[idx].notes = fields.notes;
  jobs[idx].description = fields.description;
  if (!CLOSED_JOB_STATUSES.has(currentStatus) && !hasAssignedTechnician(fields.technician)) {
    jobs[idx].status = 'scheduled';
    jobs[idx].doneAt = null;
  }
  jobs[idx].updatedAt = new Date().toISOString();
  await writeJobs(jobs);
  res.json({ ok: true, job: jobs[idx] });
});

router.patch('/:id/done', async (req, res) => {
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
    job.status = 'done';
    job.doneAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    await query(
      'UPDATE jobs SET status = ?, done_at = ?, updated_at = ? WHERE id = ? AND branch_id = ?',
      [job.status, toMysqlDateTime(job.doneAt), toMysqlDateTime(job.updatedAt), id, branchId]
    );
    return res.json({ ok: true, job });
  }

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });

  jobs[idx].status = 'done';
  jobs[idx].doneAt = new Date().toISOString();
  jobs[idx].updatedAt = new Date().toISOString();
  await writeJobs(jobs);
  res.json({ ok: true, job: jobs[idx] });
});

router.patch('/:id/assign', async (req, res) => {
  const id = Number(req.params.id);
  const technicianInput = sanitizeText(req.body?.technician, 120);
  const technician = hasAssignedTechnician(technicianInput) ? technicianInput : '';

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
    job.technician = technician;
    job.updatedAt = new Date().toISOString();
    await query(
      'UPDATE jobs SET technician = ?, updated_at = ? WHERE id = ? AND branch_id = ?',
      [technician || null, toMysqlDateTime(job.updatedAt), id, branchId]
    );
    return res.json({ ok: true, job });
  }

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });

  jobs[idx].technician = technician;
  jobs[idx].updatedAt = new Date().toISOString();
  await writeJobs(jobs);
  res.json({ ok: true, job: jobs[idx] });
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
    job.doneAt = null;
    job.updatedAt = new Date().toISOString();
    await query(
      'UPDATE jobs SET status = ?, done_at = NULL, updated_at = ? WHERE id = ? AND branch_id = ?',
      [job.status, toMysqlDateTime(job.updatedAt), id, branchId]
    );
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
  job.doneAt = null;
  job.updatedAt = new Date().toISOString();
  if (job.origin === ORIGIN_TICKET) {
    await revertTicketStatus(job.ticketId);
    jobs.splice(idx, 1);
  }
  await writeJobs(jobs);
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
    await query('DELETE FROM jobs WHERE id = ? AND branch_id = ?', [id, branchId]);
    const [hydratedRow] = await hydrateJobRows(branchId, rows.slice(0, 1));
    return res.json({ ok: true, job: mapJobRow(hydratedRow) });
  }

  const jobs = await readJobs();
  const idx = jobs.findIndex((j) => Number(j.id) === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'Job not found' });
  const removed = jobs.splice(idx, 1)[0];
  await writeJobs(jobs);
  res.json({ ok: true, job: removed });
});

router.addHistoryJobFromTicket = createJobFromTicket;
router.addJobEntry = addJobEntry;
router.removeHistoryJobForTicket = removeHistoryJobForTicket;
router.readJobsForTechnician = readJobsForTechnician;
router.isOpenJobStatus = isOpenJobStatus;
router.deriveJobStatus = deriveJobStatus;
router.markJobDoneForTechnician = markJobDoneForTechnician;

module.exports = router;
