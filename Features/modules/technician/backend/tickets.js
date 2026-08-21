const express = require('express');
const jobsModule = require('./jobs');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { requireCustomer, readCustomers } = require('../../customer-management/backend/customers');
const { withTransaction } = require('./job-numbering');

const router = express.Router();
const publicRouter = express.Router();
const STORE_KEY = 'tickets';
const TICKET_ACCOUNT_NUMBER_MAX = 20;
const TICKET_CONTACT_MAX = 50;
const TICKET_SOURCE_MAX = 20;
const TICKET_SUBJECT_MAX = 140;
const TICKET_CATEGORY_MAX = 140;
const TICKET_NUMBER_MAX = 50;
const TICKET_NUMBER_PREFIX = 'TKT';
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
let ticketArchiveSchemaPromise = null;
const DEFAULT_TICKET_CATEGORIES = [
  'Blinking LOS',
  'No Power Modem',
  'Reset Modem',
  'Slow Connection',
  'Wire Problem',
  'Wi-Fi Connected, No Internet'
];
const TICKET_CATEGORY_LOOKUP = DEFAULT_TICKET_CATEGORIES.reduce((acc, label) => {
  acc[String(label).trim().toLowerCase()] = label;
  return acc;
}, {});

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

const ensureTicketArchiveColumns = async () => {
  if (!await isRelationalReady()) return false;
  if (ticketArchiveSchemaPromise) return ticketArchiveSchemaPromise;
  ticketArchiveSchemaPromise = (async () => {
    const [rows] = await query(
      `SELECT column_name AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'tickets'
         AND column_name IN ('archived_at', 'archived_by')`
    );
    const existing = new Set((rows || []).map((row) => String(row.columnName || row.COLUMN_NAME || '').toLowerCase()));
    const additions = [
      ['archived_at', 'ALTER TABLE tickets ADD COLUMN archived_at DATETIME NULL AFTER updated_at'],
      ['archived_by', 'ALTER TABLE tickets ADD COLUMN archived_by VARCHAR(120) NULL AFTER archived_at']
    ];
    for (const [column, sql] of additions) {
      if (existing.has(column)) continue;
      try {
        await query(sql);
      } catch (error) {
        if (String(error?.code || '').toUpperCase() !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
    return true;
  })().catch((error) => {
    ticketArchiveSchemaPromise = null;
    throw error;
  });
  return ticketArchiveSchemaPromise;
};

const mapTicketRow = (row) => ({
  category: inferTicketCategory(row.subject),
  id: Number(row.id) || row.id,
  branchId: row.branchId || row.branch_id || null,
  ticketNumber: row.ticketNumber || row.ticket_number || formatTicketNumber(row.id),
  subject: row.subject || '',
  description: row.description || '',
  customerName: row.customerName || row.customer_name || '',
  accountNumber: row.accountNumber || row.account_number || '',
  contact: row.contact || '',
  status: row.status || '',
  assignedTo: row.assignedTo || row.assigned_to || '',
  source: row.source || '',
  createdAt: row.createdAt || row.created_at || '',
  updatedAt: row.updatedAt || row.updated_at || '',
  historyJobId: row.historyJobId || row.history_job_id || null,
  historyJobCreatedAt: row.historyJobCreatedAt || row.history_job_created_at || null,
  archivedAt: row.archivedAt || row.archived_at || null,
  archivedBy: row.archivedBy || row.archived_by || ''
});

const hasBranchId = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const isSameBranch = (row, branchId) => (
  hasBranchId(branchId)
  && hasBranchId(row?.branchId ?? row?.branch_id)
  && String(row.branchId ?? row.branch_id) === String(branchId)
);
const readAllTicketsJson = async () => {
  const parsed = await readJson(STORE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
};

const readTickets = async (branchId = null) => {
  if (await isRelationalReady()) {
    if (!branchId) return [];
    await ensureTicketArchiveColumns();
    const [rows] = await query(
      `SELECT
          id,
          ticket_number AS ticketNumber,
          subject,
          description,
          customer_name AS customerName,
          account_number AS accountNumber,
          contact,
          status,
          assigned_to AS assignedTo,
          source,
          created_at AS createdAt,
          updated_at AS updatedAt,
          history_job_id AS historyJobId,
          history_job_created_at AS historyJobCreatedAt,
          archived_at AS archivedAt,
          archived_by AS archivedBy
       FROM tickets
       WHERE branch_id = ?
       ORDER BY created_at DESC`,
      [branchId]
    );
    return (rows || []).map(mapTicketRow);
  }
  if (!hasBranchId(branchId)) return [];
  const parsed = await readAllTicketsJson();
  return parsed.filter((ticket) => isSameBranch(ticket, branchId));
};

const writeTickets = async (tickets) => {
  await writeJson(STORE_KEY, tickets);
};

const nextId = (tickets) =>
  tickets.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;

const sanitizeText = (value, maxLen = 200) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLen);
};

const formatTicketNumber = (id) => {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) return '';
  return `${TICKET_NUMBER_PREFIX}-${String(Math.trunc(numericId)).padStart(8, '0')}`;
};

const normalizeTicketCategory = (value) => {
  const raw = sanitizeText(value, TICKET_CATEGORY_MAX);
  if (!raw) return '';
  return TICKET_CATEGORY_LOOKUP[raw.toLowerCase()] || raw;
};

const inferTicketCategory = (subjectValue) => {
  const rawSubject = sanitizeText(subjectValue, TICKET_SUBJECT_MAX);
  if (!rawSubject) return '';
  const normalized = TICKET_CATEGORY_LOOKUP[rawSubject.toLowerCase()];
  if (normalized) return normalized;
  return rawSubject;
};

const getTicketCategoriesPayload = () =>
  DEFAULT_TICKET_CATEGORIES.map((label, index) => ({
    id: String(index + 1),
    value: label,
    label
  }));

const ALLOWED_STATUSES = new Set([
  'open',
  'in-progress',
  'waiting-customer',
  'escalated',
  'resolved',
  'cancelled'
]);
const HISTORY_DONE_STATUSES = new Set(['resolved']);
const CLOSED_TICKET_STATUSES = new Set(['resolved', 'closed', 'done', 'completed', 'cancelled', 'canceled']);
const TICKET_STATUS_ALIASES = new Map([
  ['new', 'open'],
  ['pending', 'open'],
  ['unassigned', 'open'],
  ['to-be-assigned', 'open'],
  ['to_be_assigned', 'open'],
  ['assigned', 'in-progress'],
  ['in_progress', 'in-progress'],
  ['inprogress', 'in-progress'],
  ['working', 'in-progress'],
  ['waiting_customer', 'waiting-customer'],
  ['waiting customer', 'waiting-customer'],
  ['waiting for customer', 'waiting-customer'],
  ['waiting-for-customer', 'waiting-customer'],
  ['waiting-on-customer', 'waiting-customer'],
  ['pending-customer', 'waiting-customer'],
  ['customer-waiting', 'waiting-customer'],
  ['escalation', 'escalated'],
  ['closed', 'resolved'],
  ['done', 'resolved'],
  ['completed', 'resolved'],
  ['fixed', 'resolved'],
  ['canceled', 'cancelled']
]);

const canonicalizeTicketStatus = (value) => {
  const normalized = sanitizeText(value, 40).toLowerCase();
  const hyphenated = normalized.replace(/\s+/g, '-');
  return TICKET_STATUS_ALIASES.get(normalized) || TICKET_STATUS_ALIASES.get(hyphenated) || hyphenated;
};

const normalizeStatus = (value, fallback = 'open') => {
  const normalized = canonicalizeTicketStatus(value);
  if (ALLOWED_STATUSES.has(normalized)) return normalized;
  const normalizedFallback = canonicalizeTicketStatus(fallback);
  return ALLOWED_STATUSES.has(normalizedFallback) ? normalizedFallback : 'open';
};

const isOpenTicketStatus = (value) => {
  const normalized = sanitizeText(value, 40).toLowerCase();
  return !CLOSED_TICKET_STATUSES.has(normalized);
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

const buildTicket = ({ payload, source, allowStatus = false }) => {
  const requestedCategory = normalizeTicketCategory(
    payload.category || payload.ticketCategory || payload.reason || payload.issueType
  );
  const inputSubject = sanitizeText(payload.subject, TICKET_SUBJECT_MAX);
  const subject = inputSubject || requestedCategory;
  const category = inferTicketCategory(subject);
  const customerName = sanitizeText(payload.customerName || payload.name, 120);
  const accountNumber = sanitizeText(payload.accountNumber, TICKET_ACCOUNT_NUMBER_MAX);
  const contact = sanitizeText(payload.contact || payload.mobile || payload.email, TICKET_CONTACT_MAX);
  const description = sanitizeText(payload.description || payload.details, 1200);
  const assignedTo = sanitizeText(payload.assignedTo, 120);
  const ticketNumber = sanitizeText(payload.ticketNumber, TICKET_NUMBER_MAX);

  if (!subject) {
    return { error: 'subject is required' };
  }

  if (!customerName && !accountNumber) {
    return { error: 'customerName or accountNumber is required' };
  }

  let status = allowStatus ? normalizeStatus(payload.status, 'open') : 'open';
  if (assignedTo && status === 'open') {
    status = 'in-progress';
  }

  const now = new Date().toISOString();
  return {
    ticket: {
      category,
      subject,
      description,
      customerName,
      accountNumber,
      contact,
      ticketNumber,
      status,
      assignedTo,
      source: sanitizeText(source, TICKET_SOURCE_MAX) || 'admin',
      createdAt: now,
      updatedAt: now
    }
  };
};

const applyTicketUpdates = (ticket = {}, payload = {}) => {
  const requestedCategory = normalizeTicketCategory(
    payload.category || payload.ticketCategory || payload.reason || payload.issueType
  );
  const inputSubject = sanitizeText(payload.subject, TICKET_SUBJECT_MAX);
  const subject = inputSubject || requestedCategory;
  const customerName = sanitizeText(payload.customerName || payload.name, 120);
  const accountNumber = sanitizeText(payload.accountNumber, TICKET_ACCOUNT_NUMBER_MAX);
  const description = sanitizeText(payload.description || payload.details, 1200);
  const assignedTo = sanitizeText(payload.assignedTo || payload.technician, 120);
  const hasExplicitContact = ['contact', 'mobile', 'email'].some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
  const contact = hasExplicitContact
    ? sanitizeText(payload.contact || payload.mobile || payload.email, TICKET_CONTACT_MAX)
    : sanitizeText(ticket.contact, TICKET_CONTACT_MAX);

  if (!subject) {
    return { error: 'subject is required' };
  }

  if (!customerName && !accountNumber) {
    return { error: 'customerName or accountNumber is required' };
  }

  ticket.category = inferTicketCategory(subject);
  ticket.subject = subject;
  ticket.description = description;
  ticket.customerName = customerName;
  ticket.accountNumber = accountNumber;
  ticket.contact = contact;
  ticket.assignedTo = assignedTo;

  const currentStatus = normalizeStatus(ticket.status, 'open');
  if (assignedTo) {
    if (currentStatus === 'open') {
      ticket.status = 'in-progress';
    }
  } else if (currentStatus === 'in-progress') {
    ticket.status = 'open';
  }
  ticket.updatedAt = new Date().toISOString();
  return { ticket };
};

const normalizeTicketErrorMessage = (error, fallback) => {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR') {
    return 'Tickets schema is missing or outdated. Run Schema Update from /update-download.';
  }
  if (code === 'ER_NO_REFERENCED_ROW_2') {
    return 'Branch assignment for this ticket is invalid. Check the admin branch configuration.';
  }
  if (code === 'ER_DATA_TOO_LONG') {
    return 'One of the ticket fields is too long. Shorten account/contact details and try again.';
  }
  if (code === 'ER_TRUNCATED_WRONG_VALUE') {
    return 'Invalid date/time value for ticket record. Run Schema Update, then retry.';
  }
  return error?.sqlMessage || error?.message || fallback;
};

const sendRouteError = (res, error, fallback) => {
  const message = normalizeTicketErrorMessage(error, fallback);
  const statusCode = Number(error?.statusCode || 500);
  if (statusCode >= 500) console.error(fallback, error);
  return res.status(statusCode).json({
    ok: false,
    error: message,
    currentJob: error?.currentJob || undefined
  });
};

const requireAdminAccess = (req, res) => {
  if (accountHasRole(req.user, 'Admin')) return true;
  res.status(403).json({ ok: false, error: 'Admin ticket access required.' });
  return false;
};

const linkedWorkOrderSummary = (job) => {
  if (!job) return null;
  const workflowStatus = jobsModule.normalizeDispatchStatus
    ? jobsModule.normalizeDispatchStatus(job.workflowStatus || job.status, { technician: job.technician })
    : String(job.workflowStatus || job.status || '').trim().toLowerCase();
  return {
    id: Number(job.id) || job.id,
    jobNumber: job.jobNumber || '',
    technician: job.technician || '',
    priority: job.priority || 'normal',
    appointmentStart: job.appointmentStart || job.schedule || '',
    workflowStatus,
    active: typeof jobsModule.isActiveTicketWorkOrder === 'function'
      ? jobsModule.isActiveTicketWorkOrder(job)
      : !['completed', 'cancelled'].includes(workflowStatus)
  };
};

const resolveBranchId = async (accountNumber) => {
  const acct = String(accountNumber || '').trim();
  if (!await isRelationalReady()) {
    if (!acct) return null;
    const customers = await readCustomers(null);
    const customer = (Array.isArray(customers) ? customers : []).find((entry) => (
      String(entry?.accountNumber || '').trim() === acct && hasBranchId(entry?.branchId ?? entry?.branch_id)
    ));
    return customer?.branchId ?? customer?.branch_id ?? null;
  }
  if (acct) {
    const [rows] = await query('SELECT branch_id FROM customers WHERE account_number = ? LIMIT 1', [acct]);
    if (rows && rows.length) return rows[0].branch_id;
  }
  const [branches] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
  return branches && branches.length ? branches[0].id : null;
};

const readTicketsForCustomer = async (accountNumber, branchId = null) => {
  const acct = sanitizeText(accountNumber, TICKET_ACCOUNT_NUMBER_MAX);
  if (!acct) return [];
  if (await isRelationalReady()) {
    if (!hasBranchId(branchId)) return [];
    await ensureTicketArchiveColumns();
    const [rows] = await query(
      `SELECT
          id,
          ticket_number AS ticketNumber,
          subject,
          description,
          customer_name AS customerName,
          account_number AS accountNumber,
          contact,
          status,
          assigned_to AS assignedTo,
          source,
          created_at AS createdAt,
          updated_at AS updatedAt,
          history_job_id AS historyJobId,
          history_job_created_at AS historyJobCreatedAt,
          archived_at AS archivedAt,
          archived_by AS archivedBy
       FROM tickets
       WHERE account_number = ?
         AND archived_at IS NULL
         AND branch_id = ?
       ORDER BY created_at DESC`,
      [acct, branchId]
    );
    return (rows || []).map(mapTicketRow);
  }
  if (!hasBranchId(branchId)) return [];
  const tickets = await readAllTicketsJson();
  const normalized = tickets
    .filter((ticket) => isSameBranch(ticket, branchId))
    .map(mapTicketRow)
    .filter((ticket) => !ticket.archivedAt)
    .filter((ticket) => String(ticket?.accountNumber || '').trim() === acct)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return normalized;
};

const readTicketsForTechnician = async (branchId = null, technician = null, options = {}) => {
  const identifiers = getTechnicianLookupValues(technician);
  if (!identifiers.length) return [];
  const includeUnassigned = options.includeUnassigned !== false;

  if (await isRelationalReady()) {
    if (!branchId) return [];
    await ensureTicketArchiveColumns();
    const closedStatuses = Array.from(CLOSED_TICKET_STATUSES);
    const assignmentClauses = [`LOWER(TRIM(COALESCE(assigned_to, ''))) IN (${identifiers.map(() => '?').join(', ')})`];
    const params = [branchId, ...identifiers];
    if (includeUnassigned) {
      assignmentClauses.push("LOWER(TRIM(COALESCE(assigned_to, ''))) = ''");
    }
    let sql = `SELECT
        id,
        ticket_number AS ticketNumber,
        subject,
        description,
        customer_name AS customerName,
        account_number AS accountNumber,
        contact,
        status,
        assigned_to AS assignedTo,
        source,
        created_at AS createdAt,
        updated_at AS updatedAt,
        history_job_id AS historyJobId,
        history_job_created_at AS historyJobCreatedAt,
        archived_at AS archivedAt,
        archived_by AS archivedBy
     FROM tickets
     WHERE branch_id = ?
       AND archived_at IS NULL
       AND (${assignmentClauses.join(' OR ')})`;
    if (!options.includeClosed) {
      sql += ` AND LOWER(COALESCE(status, '')) NOT IN (${closedStatuses.map(() => '?').join(', ')})`;
      params.push(...closedStatuses);
    }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await query(sql, params);
    return (rows || []).map(mapTicketRow);
  }

  const identifierSet = new Set(identifiers);
  const tickets = await readTickets(branchId);
  return tickets.filter((ticket) => {
    if (ticket?.archivedAt) return false;
    const assignee = String(ticket?.assignedTo || '').trim().toLowerCase();
    if (!identifierSet.has(assignee) && !(includeUnassigned && !assignee)) return false;
    return options.includeClosed ? true : isOpenTicketStatus(ticket?.status);
  });
};

const syncTicketHistoryState = async (ticket, nextStatus, branchId = null) => {
  if (!ticket) return ticket;

  const findLinkedWorkOrder = typeof jobsModule.findTicketWorkOrder === 'function'
    ? jobsModule.findTicketWorkOrder
    : null;
  const latestLinkedWorkOrder = findLinkedWorkOrder
    ? await findLinkedWorkOrder(ticket.id, branchId)
    : null;

  if (HISTORY_DONE_STATUSES.has(nextStatus)) {
    const activeLinkedWorkOrder = findLinkedWorkOrder
      ? await findLinkedWorkOrder(ticket.id, branchId, { activeOnly: true })
      : null;
    if (activeLinkedWorkOrder) {
      const error = new Error('Complete or cancel the linked work order before resolving this ticket.');
      error.statusCode = 409;
      error.currentJob = activeLinkedWorkOrder;
      throw error;
    }
    const completedLinkedWorkOrder = findLinkedWorkOrder
      ? await findLinkedWorkOrder(ticket.id, branchId, { completedOnly: true })
      : null;
    if (completedLinkedWorkOrder) {
      ticket.historyJobId = completedLinkedWorkOrder.id;
      ticket.historyJobCreatedAt = completedLinkedWorkOrder.createdAt || new Date().toISOString();
      return ticket;
    }
    if (
      !ticket.historyJobId &&
      typeof jobsModule.addHistoryJobFromTicket === 'function'
    ) {
      const createdJob = await jobsModule.addHistoryJobFromTicket(ticket, branchId, {
        alreadySerialized: !await isRelationalReady()
      });
      if (createdJob && createdJob.id) {
        ticket.historyJobId = createdJob.id;
        ticket.historyJobCreatedAt = createdJob.createdAt || new Date().toISOString();
      }
    }
    return ticket;
  }

  if (latestLinkedWorkOrder) {
    ticket.historyJobId = latestLinkedWorkOrder.id;
    ticket.historyJobCreatedAt = latestLinkedWorkOrder.createdAt || ticket.historyJobCreatedAt || null;
    return ticket;
  }

  if (
    ticket.historyJobId &&
    typeof jobsModule.removeHistoryJobForTicket === 'function'
  ) {
    await jobsModule.removeHistoryJobForTicket(ticket, branchId);
  }
  ticket.historyJobId = null;
  ticket.historyJobCreatedAt = null;
  return ticket;
};

const updateTicketStatusForTechnician = async (branchId = null, technician = null, id, statusValue) => {
  const ticketId = Number(id);
  const identifiers = getTechnicianLookupValues(technician);
  if (!Number.isFinite(ticketId) || ticketId <= 0 || !identifiers.length) return null;

  if (await isRelationalReady()) {
    if (!branchId) return null;
    const [rows] = await query(
      `SELECT id, status, assigned_to AS assignedTo, created_at AS createdAt, updated_at AS updatedAt,
              ticket_number AS ticketNumber, subject, description, customer_name AS customerName, account_number AS accountNumber,
              contact, source, history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt
       FROM tickets
       WHERE id = ?
         AND branch_id = ?
         AND LOWER(TRIM(COALESCE(assigned_to, ''))) IN (${identifiers.map(() => '?').join(', ')})
       LIMIT 1`,
      [ticketId, branchId, ...identifiers]
    );
    if (!rows || !rows.length) return null;

    const ticket = mapTicketRow(rows[0]);
    if (!['in-progress', 'waiting-customer', 'escalated'].includes(normalizeStatus(ticket.status, 'open'))) {
      return null;
    }
    const nextStatus = normalizeStatus(statusValue, ticket.status || 'open');
    ticket.status = nextStatus;
    ticket.updatedAt = new Date().toISOString();
    await syncTicketHistoryState(ticket, nextStatus, branchId);
    await query(
      `UPDATE tickets
       SET status = ?, updated_at = ?, history_job_id = ?, history_job_created_at = ?
       WHERE id = ? AND branch_id = ?`,
      [
        ticket.status || null,
        toMysqlDateTime(ticket.updatedAt),
        ticket.historyJobId || null,
        toMysqlDateTime(ticket.historyJobCreatedAt),
        ticketId,
        branchId
      ]
    );
    return ticket;
  }

  const identifierSet = new Set(identifiers);
  if (!hasBranchId(branchId) || typeof jobsModule.withJsonTechnicianMutation !== 'function') return null;
  return jobsModule.withJsonTechnicianMutation(async () => {
    const tickets = await readAllTicketsJson();
    const idx = tickets.findIndex((ticket) => (
      Number(ticket?.id) === ticketId
      && isSameBranch(ticket, branchId)
      && identifierSet.has(String(ticket?.assignedTo || '').trim().toLowerCase())
    ));
    if (idx < 0) return null;

    const ticket = tickets[idx];
    if (!['in-progress', 'waiting-customer', 'escalated'].includes(normalizeStatus(ticket.status, 'open'))) {
      return null;
    }
    const nextStatus = normalizeStatus(statusValue, ticket.status || 'open');
    ticket.status = nextStatus;
    ticket.updatedAt = new Date().toISOString();
    ticket.branchId = Number(branchId) || String(branchId);
    await syncTicketHistoryState(ticket, nextStatus, branchId);
    tickets[idx] = ticket;
    await writeTickets(tickets);
    return ticket;
  });
};

const mutateTicketAndActiveWorkOrder = async (branchId, id, mutate) => {
  if (!hasBranchId(branchId)) {
    const error = new Error('Branch assignment missing for this admin account.');
    error.statusCode = 400;
    throw error;
  }
  const ticketId = Number(id);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return null;

  if (await isRelationalReady()) {
    await ensureTicketArchiveColumns();
    return withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, ticket_number AS ticketNumber, subject, description,
                customer_name AS customerName, account_number AS accountNumber, contact, status,
                assigned_to AS assignedTo, source, created_at AS createdAt, updated_at AS updatedAt,
                history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt,
                archived_at AS archivedAt, archived_by AS archivedBy
         FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1 FOR UPDATE`,
        [ticketId, branchId]
      );
      if (!rows?.length) return null;
      const ticket = mapTicketRow(rows[0]);
      const mutationResult = await mutate(ticket);
      if (mutationResult?.error) {
        const error = new Error(mutationResult.error);
        error.statusCode = 400;
        throw error;
      }
      const updatedTicket = mutationResult?.ticket || ticket;
      updatedTicket.branchId = Number(branchId) || branchId;
      await connection.query(
        `UPDATE tickets
         SET subject = ?, description = ?, customer_name = ?, account_number = ?, contact = ?,
             status = ?, assigned_to = ?, updated_at = ?, history_job_id = ?, history_job_created_at = ?
         WHERE id = ? AND branch_id = ?`,
        [
          updatedTicket.subject || null,
          updatedTicket.description || null,
          updatedTicket.customerName || null,
          updatedTicket.accountNumber || null,
          updatedTicket.contact || null,
          updatedTicket.status || null,
          updatedTicket.assignedTo || null,
          toMysqlDateTime(updatedTicket.updatedAt),
          updatedTicket.historyJobId || null,
          toMysqlDateTime(updatedTicket.historyJobCreatedAt),
          ticketId,
          branchId
        ]
      );
      const linkedJob = typeof jobsModule.syncActiveLinkedJobFromTicket === 'function'
        ? await jobsModule.syncActiveLinkedJobFromTicket(updatedTicket, branchId, { connection })
        : null;
      return { ticket: updatedTicket, linkedJob };
    });
  }

  if (typeof jobsModule.withJsonTechnicianMutation !== 'function') {
    throw new Error('Serialized ticket storage is unavailable.');
  }
  return jobsModule.withJsonTechnicianMutation(async () => {
    const tickets = await readAllTicketsJson();
    const index = tickets.findIndex((ticket) => (
      Number(ticket?.id) === ticketId && isSameBranch(ticket, branchId)
    ));
    if (index < 0) return null;
    const ticket = { ...tickets[index], ...mapTicketRow(tickets[index]) };
    const mutationResult = await mutate(ticket);
    if (mutationResult?.error) {
      const error = new Error(mutationResult.error);
      error.statusCode = 400;
      throw error;
    }
    const updatedTicket = mutationResult?.ticket || ticket;
    updatedTicket.branchId = Number(branchId) || String(branchId);
    tickets[index] = { ...tickets[index], ...updatedTicket };
    const jobs = await readJson('jobs', []);
    const jobList = Array.isArray(jobs) ? jobs : [];
    const linkedJob = typeof jobsModule.syncActiveLinkedJobFromTicket === 'function'
      ? await jobsModule.syncActiveLinkedJobFromTicket(updatedTicket, branchId, { jobs: jobList })
      : null;
    await writeTickets(tickets);
    if (linkedJob) await writeJson('jobs', jobList);
    return { ticket: updatedTicket, linkedJob };
  });
};

router.get('/', async (req, res) => {
  try {
    const branchId = req.user?.branchId || null;
    const includeArchived = accountHasRole(req.user, 'Admin') && ['1', 'true', 'yes', 'all'].includes(
      String(req.query?.includeArchived || '').trim().toLowerCase()
    );
    const tickets = await readTickets(branchId);
    const linkedJobs = accountHasRole(req.user, 'Admin') && typeof jobsModule.readTicketWorkOrders === 'function'
      ? await jobsModule.readTicketWorkOrders(branchId)
      : [];
    const linkedByTicket = new Map();
    linkedJobs.forEach((job) => {
      const ticketId = Number(job?.ticketId);
      if (!Number.isFinite(ticketId) || linkedByTicket.has(ticketId)) return;
      linkedByTicket.set(ticketId, job);
    });
    const visibleTickets = tickets
      .map((ticket) => ({
        ...mapTicketRow(ticket),
        linkedWorkOrder: linkedWorkOrderSummary(linkedByTicket.get(Number(ticket?.id)))
      }))
      .filter((ticket) => includeArchived || !ticket.archivedAt);
    visibleTickets.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({
      ok: true,
      tickets: visibleTickets,
      archivedCount: tickets.filter((ticket) => Boolean(ticket?.archivedAt || ticket?.archived_at)).length
    });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to load tickets');
  }
});

router.get('/categories', (_req, res) => {
  return res.json({
    ok: true,
    categories: getTicketCategoriesPayload()
  });
});

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const { ticket, error } = buildTicket({ payload, source: 'admin', allowStatus: true });
    if (error) {
      return res.status(400).json({ ok: false, error });
    }
    if (await isRelationalReady()) {
      const [result] = await query(
        `INSERT INTO tickets (
            branch_id, subject, description, customer_name, account_number, contact, status,
            assigned_to, source, created_at, updated_at, ticket_number
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          ticket.subject || null,
          ticket.description || null,
          ticket.customerName || null,
          ticket.accountNumber || null,
          ticket.contact || null,
          ticket.status || null,
          ticket.assignedTo || null,
          ticket.source || null,
          toMysqlDateTime(ticket.createdAt),
          toMysqlDateTime(ticket.updatedAt),
          null
        ]
      );
      ticket.id = result && result.insertId ? result.insertId : ticket.id;
      ticket.ticketNumber = formatTicketNumber(ticket.id);
      await query(
        'UPDATE tickets SET ticket_number = ? WHERE id = ? AND branch_id = ?',
        [ticket.ticketNumber || null, ticket.id, branchId]
      );
      return res.status(201).json({ ok: true, ticket });
    }

    await jobsModule.withJsonTechnicianMutation(async () => {
      const tickets = await readAllTicketsJson();
      ticket.id = nextId(tickets);
      ticket.ticketNumber = formatTicketNumber(ticket.id);
      ticket.branchId = Number(branchId) || String(branchId);
      tickets.unshift(ticket);
      await writeTickets(tickets);
    });
    return res.status(201).json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to create ticket');
  }
});

router.post('/:id/work-order', async (req, res) => {
  if (!requireAdminAccess(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ticket id is invalid.' });
    }
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    if (typeof jobsModule.createWorkOrderFromTicket !== 'function') {
      return res.status(503).json({ ok: false, error: 'Work-order creation is unavailable.' });
    }

    const result = await jobsModule.createWorkOrderFromTicket(
      { id },
      req.body || {},
      branchId,
      req.user
    );
    const job = result.job;
    const ticket = result.ticket;

    return res.status(201).json({
      ok: true,
      ticket: { ...mapTicketRow(ticket), linkedWorkOrder: linkedWorkOrderSummary(job) },
      job
    });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to create work order');
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    const result = await mutateTicketAndActiveWorkOrder(
      branchId,
      id,
      (ticket) => applyTicketUpdates(ticket, req.body || {})
    );
    if (!result) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    return res.json({
      ok: true,
      ticket: result.ticket,
      linkedWorkOrder: linkedWorkOrderSummary(result.linkedJob)
    });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to update ticket');
  }
});

router.patch('/:id/assign', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    const result = await mutateTicketAndActiveWorkOrder(branchId, id, (ticket) => {
      const assignedTo = sanitizeText(req.body?.technician || req.body?.assignedTo, 120);
      ticket.assignedTo = assignedTo;
      const currentStatus = normalizeStatus(ticket.status, 'open');
      if (assignedTo) {
        if (currentStatus === 'open') {
          ticket.status = 'in-progress';
        }
      } else if (currentStatus === 'in-progress') {
        ticket.status = 'open';
      }
      ticket.updatedAt = new Date().toISOString();
      return { ticket };
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    return res.json({
      ok: true,
      ticket: result.ticket,
      linkedWorkOrder: linkedWorkOrderSummary(result.linkedJob)
    });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to assign ticket');
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    if (await isRelationalReady()) {
      const [rows] = await query(
        `SELECT id, status, assigned_to AS assignedTo, created_at AS createdAt, updated_at AS updatedAt,
                ticket_number AS ticketNumber, subject, description, customer_name AS customerName, account_number AS accountNumber,
                contact, source, history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt
         FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );
      if (!rows || !rows.length) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
      }
      const ticket = mapTicketRow(rows[0]);
      const nextStatus = normalizeStatus(req.body?.status, ticket.status || 'open');
      ticket.status = nextStatus;
      ticket.updatedAt = new Date().toISOString();
      await syncTicketHistoryState(ticket, nextStatus, branchId);
      await query(
        `UPDATE tickets
         SET status = ?, updated_at = ?, history_job_id = ?, history_job_created_at = ?
         WHERE id = ? AND branch_id = ?`,
        [
          ticket.status || null,
          toMysqlDateTime(ticket.updatedAt),
          ticket.historyJobId || null,
          toMysqlDateTime(ticket.historyJobCreatedAt),
          id,
          branchId
        ]
      );
      return res.json({ ok: true, ticket });
    }

    const ticket = await jobsModule.withJsonTechnicianMutation(async () => {
      const tickets = await readAllTicketsJson();
      const idx = tickets.findIndex((entry) => Number(entry?.id) === id && isSameBranch(entry, branchId));
      if (idx < 0) return null;
      const current = tickets[idx];
      const nextStatus = normalizeStatus(req.body?.status, current.status || 'open');
      const storedJobs = await readJson('jobs', []);
      const linkedJobs = (Array.isArray(storedJobs) ? storedJobs : [])
        .filter((job) => (
          isSameBranch(job, branchId)
          && String(job?.origin || '').toLowerCase() === 'ticket_work_order'
          && Number(job?.ticketId ?? job?.ticket_id) === id
        ));
      if (nextStatus === 'resolved') {
        const activeJob = linkedJobs.find((job) => jobsModule.isActiveTicketWorkOrder?.(job));
        if (activeJob) {
          const error = new Error('Complete or cancel the linked work order before resolving this ticket.');
          error.statusCode = 409;
          error.currentJob = activeJob;
          throw error;
        }
        const completedJob = linkedJobs.find((job) => (
          jobsModule.normalizeDispatchStatus?.(job.workflowStatus || job.status, { technician: job.technician }) === 'completed'
        ));
        if (completedJob) {
          current.historyJobId = completedJob.id;
          current.historyJobCreatedAt = completedJob.createdAt || new Date().toISOString();
        }
      }
      current.status = nextStatus;
      current.updatedAt = new Date().toISOString();
      current.branchId = Number(branchId) || String(branchId);
      tickets[idx] = current;
      await writeTickets(tickets);
      return current;
    });
    if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    return res.json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to update ticket status');
  }
});

const setTicketArchiveState = async (req, res, archive) => {
  if (!requireAdminAccess(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Ticket id is invalid.' });
    }
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const now = new Date().toISOString();
    const actor = sanitizeText(req.user?.username || req.user?.name || 'Admin', 120) || 'Admin';
    const relationalReady = await isRelationalReady();

    if (relationalReady && archive && typeof jobsModule.findTicketWorkOrder === 'function') {
      const activeWorkOrder = await jobsModule.findTicketWorkOrder(id, branchId, { activeOnly: true });
      if (activeWorkOrder) {
        return res.status(409).json({
          ok: false,
          error: 'Complete or cancel the active work order before archiving this ticket.',
          currentJob: linkedWorkOrderSummary(activeWorkOrder)
        });
      }
    }

    if (relationalReady) {
      await ensureTicketArchiveColumns();
      const [rows] = await query(
        `SELECT id, subject, description, customer_name AS customerName, account_number AS accountNumber,
                ticket_number AS ticketNumber, contact, status, assigned_to AS assignedTo, source, created_at AS createdAt,
                updated_at AS updatedAt, history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt,
                archived_at AS archivedAt, archived_by AS archivedBy
         FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );
      if (!rows || !rows.length) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
      }
      const ticket = mapTicketRow(rows[0]);
      const replayed = archive ? Boolean(ticket.archivedAt) : !ticket.archivedAt;
      if (!replayed) {
        ticket.archivedAt = archive ? now : null;
        ticket.archivedBy = archive ? actor : '';
        ticket.updatedAt = now;
        await query(
          `UPDATE tickets SET archived_at = ?, archived_by = ?, updated_at = ?
           WHERE id = ? AND branch_id = ?`,
          [
            toMysqlDateTime(ticket.archivedAt),
            ticket.archivedBy || null,
            toMysqlDateTime(ticket.updatedAt),
            id,
            branchId
          ]
        );
      }
      return res.json({ ok: true, replayed, ticket });
    }

    const result = await jobsModule.withJsonTechnicianMutation(async () => {
      const tickets = await readAllTicketsJson();
      const idx = tickets.findIndex((ticket) => Number(ticket?.id) === id && isSameBranch(ticket, branchId));
      if (idx < 0) return null;
      if (archive) {
        const storedJobs = await readJson('jobs', []);
        const activeWorkOrder = (Array.isArray(storedJobs) ? storedJobs : []).find((job) => (
          isSameBranch(job, branchId)
          && Number(job?.ticketId ?? job?.ticket_id) === id
          && jobsModule.isActiveTicketWorkOrder?.(job)
        ));
        if (activeWorkOrder) {
          const error = new Error('Complete or cancel the active work order before archiving this ticket.');
          error.statusCode = 409;
          error.currentJob = activeWorkOrder;
          throw error;
        }
      }
      const ticket = tickets[idx];
      const replayed = archive ? Boolean(ticket.archivedAt) : !ticket.archivedAt;
      if (!replayed) {
        ticket.archivedAt = archive ? now : null;
        ticket.archivedBy = archive ? actor : '';
        ticket.updatedAt = now;
        ticket.branchId = Number(branchId) || String(branchId);
        tickets[idx] = ticket;
        await writeTickets(tickets);
      }
      return { replayed, ticket: mapTicketRow(ticket) };
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Ticket not found' });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendRouteError(res, error, archive ? 'Failed to archive ticket' : 'Failed to restore ticket');
  }
};

router.patch('/:id/archive', (req, res) => setTicketArchiveState(req, res, true));
router.patch('/:id/restore', (req, res) => setTicketArchiveState(req, res, false));

router.delete('/:id', async (req, res) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</api/tickets/${encodeURIComponent(req.params.id)}/archive>; rel="successor-version"`);
  return setTicketArchiveState(req, res, true);
});

publicRouter.get('/categories', (_req, res) => {
  return res.json({
    ok: true,
    categories: getTicketCategoriesPayload()
  });
});

publicRouter.get('/my', requireCustomer, async (req, res) => {
  try {
    const accountNumber = sanitizeText(req.customer?.accountNumber, TICKET_ACCOUNT_NUMBER_MAX);
    if (!accountNumber) {
      return res.status(400).json({ ok: false, error: 'Customer account number is required.' });
    }
    const branchId = req.customer?.branchId || null;
    const tickets = await readTicketsForCustomer(accountNumber, branchId);
    const openTickets = tickets.filter((ticket) => isOpenTicketStatus(ticket.status));
    return res.json({
      ok: true,
      accountNumber,
      totalCount: tickets.length,
      openCount: openTickets.length,
      hasOpen: openTickets.length > 0,
      openTickets: openTickets.slice(0, 20)
    });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to load customer tickets');
  }
});

const handlePublicTicketSubmit = async (req, res) => {
  try {
    const payload = req.body || {};
    const safePayload = {
      subject: payload.subject || payload.category || payload.ticketCategory || payload.reason || payload.issueType,
      category: payload.category || payload.ticketCategory || payload.reason || payload.issueType,
      customerName: payload.customerName || payload.name,
      accountNumber: payload.accountNumber,
      contact: payload.contact || payload.mobile || payload.email,
      description: payload.description || payload.details
    };
    const { ticket, error } = buildTicket({ payload: safePayload, source: 'customer', allowStatus: false });
    if (error) {
      return res.status(400).json({ ok: false, error });
    }
    const branchId = await resolveBranchId(ticket.accountNumber);
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'No branch available for ticket submission.' });
    }
    ticket.branchId = Number(branchId) || String(branchId);
    if (await isRelationalReady()) {
      const [result] = await query(
        `INSERT INTO tickets (
            branch_id, subject, description, customer_name, account_number, contact, status,
            assigned_to, source, created_at, updated_at, ticket_number
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          branchId,
          ticket.subject || null,
          ticket.description || null,
          ticket.customerName || null,
          ticket.accountNumber || null,
          ticket.contact || null,
          ticket.status || null,
          ticket.assignedTo || null,
          ticket.source || null,
          toMysqlDateTime(ticket.createdAt),
          toMysqlDateTime(ticket.updatedAt),
          null
        ]
      );
      ticket.id = result && result.insertId ? result.insertId : ticket.id;
      ticket.ticketNumber = formatTicketNumber(ticket.id);
      await query(
        'UPDATE tickets SET ticket_number = ? WHERE id = ? AND branch_id = ?',
        [ticket.ticketNumber || null, ticket.id, branchId]
      );
      return res.status(201).json({ ok: true, ticket });
    }

    await jobsModule.withJsonTechnicianMutation(async () => {
      const tickets = await readAllTicketsJson();
      ticket.id = nextId(tickets);
      ticket.ticketNumber = formatTicketNumber(ticket.id);
      tickets.unshift(ticket);
      await writeTickets(tickets);
    });
    return res.status(201).json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to submit customer ticket');
  }
};

publicRouter.post('/submit', handlePublicTicketSubmit);
publicRouter.post('/create', handlePublicTicketSubmit);
publicRouter.post('/mobile/create', handlePublicTicketSubmit);

module.exports = {
  router,
  publicRouter,
  readTicketsForTechnician,
  isOpenTicketStatus,
  normalizeTicketStatus: normalizeStatus,
  updateTicketStatusForTechnician
};
