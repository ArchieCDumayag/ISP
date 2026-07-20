const express = require('express');
const jobsModule = require('./jobs');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { requireCustomer } = require('./customers');

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

const mapTicketRow = (row) => ({
  category: inferTicketCategory(row.subject),
  id: Number(row.id) || row.id,
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
  historyJobCreatedAt: row.historyJobCreatedAt || row.history_job_created_at || null
});

const readTickets = async (branchId = null) => {
  if (await isRelationalReady()) {
    if (!branchId) return [];
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
          history_job_created_at AS historyJobCreatedAt
       FROM tickets
       WHERE branch_id = ?
       ORDER BY created_at DESC`,
      [branchId]
    );
    return (rows || []).map(mapTicketRow);
  }
  const parsed = await readJson(STORE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
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

const ALLOWED_STATUSES = new Set(['open', 'in-progress', 'resolved', 'closed', 'done']);
const HISTORY_DONE_STATUSES = new Set(['resolved', 'closed', 'done']);
const CLOSED_TICKET_STATUSES = new Set(['resolved', 'closed', 'done', 'completed', 'cancelled']);

const canonicalizeTicketStatus = (value) => {
  const normalized = sanitizeText(value, 40).toLowerCase();
  if (normalized === 'assigned') return 'in-progress';
  return normalized;
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
  console.error(fallback, error);
  return res.status(500).json({ ok: false, error: message });
};

const resolveBranchId = async (accountNumber) => {
  if (!await isRelationalReady()) return null;
  const acct = String(accountNumber || '').trim();
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
    const hasBranch = branchId !== null && branchId !== undefined && String(branchId).trim() !== '';
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
          history_job_created_at AS historyJobCreatedAt
       FROM tickets
       WHERE account_number = ?
         ${hasBranch ? 'AND branch_id = ?' : ''}
       ORDER BY created_at DESC`,
      hasBranch ? [acct, branchId] : [acct]
    );
    return (rows || []).map(mapTicketRow);
  }
  const parsed = await readJson(STORE_KEY, []);
  const tickets = Array.isArray(parsed) ? parsed : [];
  const normalized = tickets
    .map(mapTicketRow)
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
        history_job_created_at AS historyJobCreatedAt
     FROM tickets
     WHERE branch_id = ?
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
    const assignee = String(ticket?.assignedTo || '').trim().toLowerCase();
    if (!identifierSet.has(assignee) && !(includeUnassigned && !assignee)) return false;
    return options.includeClosed ? true : isOpenTicketStatus(ticket?.status);
  });
};

const syncTicketHistoryState = async (ticket, nextStatus, branchId = null) => {
  if (!ticket) return ticket;

  if (HISTORY_DONE_STATUSES.has(nextStatus)) {
    if (
      !ticket.historyJobId &&
      typeof jobsModule.addHistoryJobFromTicket === 'function'
    ) {
      const createdJob = await jobsModule.addHistoryJobFromTicket(ticket, branchId);
      if (createdJob && createdJob.id) {
        ticket.historyJobId = createdJob.id;
        ticket.historyJobCreatedAt = createdJob.createdAt || new Date().toISOString();
      }
    }
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
    if (normalizeStatus(ticket.status, 'open') !== 'in-progress') return null;
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
  const tickets = await readTickets(branchId);
  const idx = tickets.findIndex((ticket) =>
    Number(ticket?.id) === ticketId &&
    identifierSet.has(String(ticket?.assignedTo || '').trim().toLowerCase())
  );
  if (idx < 0) return null;

  const ticket = tickets[idx];
  if (normalizeStatus(ticket.status, 'open') !== 'in-progress') return null;
  const nextStatus = normalizeStatus(statusValue, ticket.status || 'open');
  ticket.status = nextStatus;
  ticket.updatedAt = new Date().toISOString();
  await syncTicketHistoryState(ticket, nextStatus, branchId);
  await writeTickets(tickets);
  return ticket;
};

router.get('/', async (req, res) => {
  try {
    const tickets = await readTickets(req.user?.branchId || null);
    tickets.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ ok: true, tickets });
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
    const { ticket, error } = buildTicket({ payload, source: 'admin', allowStatus: true });
    if (error) {
      return res.status(400).json({ ok: false, error });
    }
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }
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

    const tickets = await readTickets();
    ticket.id = nextId(tickets);
    ticket.ticketNumber = formatTicketNumber(ticket.id);
    tickets.unshift(ticket);
    await writeTickets(tickets);
    return res.status(201).json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to create ticket');
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }
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
      const { ticket: updatedTicket, error } = applyTicketUpdates(ticket, req.body || {});
      if (error) {
        return res.status(400).json({ ok: false, error });
      }
      await query(
        `UPDATE tickets
         SET subject = ?, description = ?, customer_name = ?, account_number = ?, contact = ?,
             status = ?, assigned_to = ?, updated_at = ?
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
          id,
          branchId
        ]
      );
      return res.json({ ok: true, ticket: updatedTicket });
    }

    const tickets = await readTickets();
    const idx = tickets.findIndex((t) => Number(t.id) === id);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    const { ticket, error } = applyTicketUpdates(tickets[idx], req.body || {});
    if (error) {
      return res.status(400).json({ ok: false, error });
    }
    tickets[idx] = ticket;
    await writeTickets(tickets);
    return res.json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to update ticket');
  }
});

router.patch('/:id/assign', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }
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
      await query(
        'UPDATE tickets SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ? AND branch_id = ?',
        [ticket.assignedTo || null, ticket.status || null, toMysqlDateTime(ticket.updatedAt), id, branchId]
      );
      return res.json({ ok: true, ticket });
    }

    const tickets = await readTickets();
    const idx = tickets.findIndex((t) => Number(t.id) === id);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }

    const assignedTo = sanitizeText(req.body?.technician || req.body?.assignedTo, 120);
    const ticket = tickets[idx];
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
    tickets[idx] = ticket;
    await writeTickets(tickets);
    return res.json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to assign ticket');
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }
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

    const tickets = await readTickets();
    const idx = tickets.findIndex((t) => Number(t.id) === id);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }

    const nextStatus = normalizeStatus(req.body?.status, tickets[idx].status || 'open');
    const ticket = tickets[idx];
    ticket.status = nextStatus;
    ticket.updatedAt = new Date().toISOString();
    await syncTicketHistoryState(ticket, nextStatus);
    await writeTickets(tickets);
    return res.json({ ok: true, ticket });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to update ticket status');
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }
      const [rows] = await query(
        `SELECT id, subject, description, customer_name AS customerName, account_number AS accountNumber,
                ticket_number AS ticketNumber, contact, status, assigned_to AS assignedTo, source, created_at AS createdAt,
                updated_at AS updatedAt, history_job_id AS historyJobId, history_job_created_at AS historyJobCreatedAt
         FROM tickets WHERE id = ? AND branch_id = ? LIMIT 1`,
        [id, branchId]
      );
      if (!rows || !rows.length) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
      }
      await query('DELETE FROM tickets WHERE id = ? AND branch_id = ?', [id, branchId]);
      return res.json({ ok: true, ticket: mapTicketRow(rows[0]) });
    }

    const tickets = await readTickets();
    const idx = tickets.findIndex((t) => Number(t.id) === id);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    const removed = tickets.splice(idx, 1)[0];
    await writeTickets(tickets);
    return res.json({ ok: true, ticket: removed });
  } catch (error) {
    return sendRouteError(res, error, 'Failed to delete ticket');
  }
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
    if (await isRelationalReady()) {
      const branchId = await resolveBranchId(ticket.accountNumber);
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'No branch available for ticket submission.' });
      }
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

    const tickets = await readTickets();
    ticket.id = nextId(tickets);
    ticket.ticketNumber = formatTicketNumber(ticket.id);
    tickets.unshift(ticket);
    await writeTickets(tickets);
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
