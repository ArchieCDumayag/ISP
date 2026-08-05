const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { loadAccounts } = require('../../admin/backend/accounts-store');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');

const router = express.Router();
const STORE_KEY = 'collector_followups';
const ACTIVE_STATUS = 'Rescheduled';
const HISTORY_STATUS = 'Schedule History';
const MAX_RECORDS = 10000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
let mutationQueue = Promise.resolve();

const cleanText = (value, maxLength = 0) => {
  const normalized = String(value == null ? '' : value).trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeBranchId = (value) => cleanText(value, 80);
const normalizeAccountNumber = (value) => cleanText(value, 120);

function normalizeDate(value) {
  const normalized = cleanText(value, 10);
  if (!DATE_PATTERN.test(normalized)) return '';
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) return '';
  return normalized;
}

function normalizeIsoDate(value, fallback = '') {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isActiveRecord(record = {}) {
  return cleanText(record.status).toLowerCase() === ACTIVE_STATUS.toLowerCase();
}

function readRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.records) ? payload.records : [];
}

function getActor(req) {
  const source = req.collector || req.user || {};
  return {
    id: cleanText(source.id, 120),
    username: cleanText(source.username, 160),
    name: cleanText(source.name || source.username || (req.collector ? 'Collector' : 'Admin'), 200),
    branchId: normalizeBranchId(source.branchId),
    isCollector: !!req.collector,
    isAdmin: !req.collector && accountHasRole(source, 'Admin')
  };
}

function requireAdminActor(req) {
  const actor = getActor(req);
  if (actor.isCollector || !actor.isAdmin) {
    throw createError(403, 'Admin access required to manage collector schedules.');
  }
  return actor;
}

function accountId(account = {}) {
  return cleanText(account.id ?? account.accountId ?? account.username, 120);
}

function collectorActor(account = {}) {
  return {
    id: accountId(account),
    username: cleanText(account.username, 160),
    name: cleanText(account.name || account.username || 'Collector', 200),
    branchId: normalizeBranchId(account.branchId),
    isCollector: true,
    isAdmin: false
  };
}

function recordMatchesBranch(record = {}, branchId = '') {
  const wanted = normalizeBranchId(branchId);
  if (!wanted) return true;
  return normalizeBranchId(record.branchId) === wanted;
}

function getJsonAssignmentIds(assignments = {}, area = '') {
  const wantedArea = cleanText(area).toLowerCase();
  const matchingKey = Object.keys(assignments || {}).find(
    (key) => cleanText(key).toLowerCase() === wantedArea
  );
  const raw = matchingKey ? assignments[matchingKey] : [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((value) => cleanText(value, 120))
    .filter(Boolean);
}

function customerName(customer = {}, accountNumber = '') {
  const direct = cleanText(customer.customerName || customer.name || customer.subscriberName, 240);
  if (direct) return direct;
  const fullName = [customer.firstName, customer.lastName]
    .map((value) => cleanText(value, 120))
    .filter(Boolean)
    .join(' ');
  return fullName || `Account ${accountNumber}`;
}

async function loadAssignedCustomer(req, accountNumber) {
  const actor = getActor(req);
  if (!actor.isCollector || !actor.id) {
    throw createError(403, 'Collector access required to save a reschedule.');
  }

  if (await isRelationalReady()) {
    if (!actor.branchId) {
      throw createError(400, 'Branch assignment missing for the authenticated collector.');
    }
    const [customerRows] = await query(
      `SELECT
         account_number AS accountNumber,
         name AS customerName,
         first_name AS firstName,
         last_name AS lastName,
         area
       FROM customers
       WHERE branch_id = ? AND account_number = ?
       LIMIT 1`,
      [actor.branchId, accountNumber]
    );
    const customer = Array.isArray(customerRows) && customerRows.length ? customerRows[0] : null;
    if (!customer) throw createError(404, 'Customer not found.');

    const [assignmentRows] = await query(
      `SELECT collector_user_id AS collectorId
       FROM collector_assignments
       WHERE branch_id = ? AND LOWER(TRIM(area_name)) = LOWER(TRIM(?))`,
      [actor.branchId, cleanText(customer.area)]
    );
    const assignedIds = (assignmentRows || [])
      .map((row) => cleanText(row.collectorId, 120))
      .filter(Boolean);
    if (assignedIds.length && !assignedIds.includes(actor.id)) {
      throw createError(403, 'Collector not assigned to this customer area.');
    }
    return { customer, branchId: actor.branchId, actor };
  }

  const [customers, collectorData] = await Promise.all([
    readJson('customers', []),
    readJson('collectors', { assignments: {} })
  ]);
  const customer = (Array.isArray(customers) ? customers : []).find((item) => {
    if (normalizeAccountNumber(item?.accountNumber) !== accountNumber) return false;
    const customerBranchId = normalizeBranchId(item?.branchId);
    return !actor.branchId || !customerBranchId || customerBranchId === actor.branchId;
  });
  if (!customer) throw createError(404, 'Customer not found.');

  const assignedIds = getJsonAssignmentIds(collectorData?.assignments || {}, customer.area);
  if (assignedIds.length && !assignedIds.includes(actor.id)) {
    throw createError(403, 'Collector not assigned to this customer area.');
  }
  return {
    customer,
    branchId: actor.branchId || normalizeBranchId(customer.branchId),
    actor
  };
}

async function loadAdminScheduleTarget(req, accountNumber, requestedCollectorId) {
  const admin = requireAdminActor(req);
  const collectorId = cleanText(requestedCollectorId, 120);
  if (!collectorId) throw createError(400, 'collectorId is required.');

  const accounts = await loadAccounts();
  const collectorAccount = (Array.isArray(accounts) ? accounts : []).find((account) => (
    accountId(account) === collectorId
    && accountHasRole(account, 'Collector')
    && account?.isActive !== false
  ));
  if (!collectorAccount) throw createError(404, 'Collector account not found or inactive.');

  const collector = collectorActor(collectorAccount);
  if (admin.branchId && collector.branchId && admin.branchId !== collector.branchId) {
    throw createError(403, 'Collector belongs to a different branch.');
  }
  const requestedBranchId = admin.branchId || collector.branchId;

  if (await isRelationalReady()) {
    const params = [accountNumber];
    let sql = `SELECT
         account_number AS accountNumber,
         name AS customerName,
         first_name AS firstName,
         last_name AS lastName,
         area,
         branch_id AS branchId
       FROM customers
       WHERE account_number = ?`;
    if (requestedBranchId) {
      sql += ' AND branch_id = ?';
      params.push(requestedBranchId);
    }
    sql += ' LIMIT 1';
    const [customerRows] = await query(sql, params);
    const customer = Array.isArray(customerRows) && customerRows.length ? customerRows[0] : null;
    if (!customer) throw createError(404, 'Customer not found.');

    const branchId = requestedBranchId || normalizeBranchId(customer.branchId);
    if (!branchId) throw createError(400, 'Branch assignment missing for this schedule.');
    if (collector.branchId && collector.branchId !== branchId) {
      throw createError(403, 'Collector and customer belong to different branches.');
    }
    const [assignmentRows] = await query(
      `SELECT collector_user_id AS collectorId
       FROM collector_assignments
       WHERE branch_id = ? AND LOWER(TRIM(area_name)) = LOWER(TRIM(?))`,
      [branchId, cleanText(customer.area)]
    );
    const assignedIds = (assignmentRows || [])
      .map((row) => cleanText(row.collectorId, 120))
      .filter(Boolean);
    if (!assignedIds.includes(collector.id)) {
      throw createError(403, 'Assign this collector to the customer area before scheduling.');
    }
    return { customer, branchId, actor: collector, admin };
  }

  const [customers, collectorData] = await Promise.all([
    readJson('customers', []),
    readJson('collectors', { assignments: {} })
  ]);
  const customer = (Array.isArray(customers) ? customers : []).find((item) => {
    if (normalizeAccountNumber(item?.accountNumber) !== accountNumber) return false;
    const customerBranchId = normalizeBranchId(item?.branchId);
    return !requestedBranchId || !customerBranchId || customerBranchId === requestedBranchId;
  });
  if (!customer) throw createError(404, 'Customer not found.');

  const branchId = requestedBranchId || normalizeBranchId(customer.branchId);
  const customerBranchId = normalizeBranchId(customer.branchId);
  if (collector.branchId && customerBranchId && collector.branchId !== customerBranchId) {
    throw createError(403, 'Collector and customer belong to different branches.');
  }
  const assignedIds = getJsonAssignmentIds(collectorData?.assignments || {}, customer.area);
  if (!assignedIds.includes(collector.id)) {
    throw createError(403, 'Assign this collector to the customer area before scheduling.');
  }
  return { customer, branchId, actor: collector, admin };
}

function mutateRecords(mutator) {
  const operation = mutationQueue
    .catch(() => {})
    .then(async () => {
      const payload = await readJson(STORE_KEY, { records: [] });
      const records = readRecords(payload);
      const result = await mutator(records);
      const now = new Date().toISOString();
      await writeJson(STORE_KEY, {
        records: records.slice(0, MAX_RECORDS),
        updatedAt: now
      });
      return result;
    });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function buildRecord(req, customer, branchId, collector, creator = collector) {
  const body = req.body || {};
  const accountNumber = normalizeAccountNumber(body.accountNumber);
  const rescheduledDate = normalizeDate(body.rescheduledDate);
  const result = cleanText(body.result, 160);
  const notes = cleanText(body.notes, 1200);
  const preferredTime = cleanText(body.preferredTime, 80);
  const clientRecordId = cleanText(body.clientRecordId || body.id, 160);
  if (!accountNumber) throw createError(400, 'accountNumber is required.');
  if (!rescheduledDate) throw createError(400, 'A valid rescheduledDate in yyyy-MM-dd format is required.');
  if (!result) throw createError(400, 'Visit result is required.');
  if (!notes) throw createError(400, 'Reason or notes are required.');

  const now = new Date().toISOString();
  const source = creator.isCollector ? 'collector' : 'admin';
  return {
    id: `followup-${crypto.randomUUID()}`,
    clientRecordId: clientRecordId || `${source}-${crypto.randomUUID()}`,
    branchId: normalizeBranchId(branchId),
    accountNumber,
    customerName: customerName(customer, accountNumber),
    area: cleanText(customer.area, 240),
    collectorId: collector.id,
    collectorName: collector.name,
    collectorUsername: collector.username,
    result,
    rescheduledDate,
    preferredTime,
    notes,
    source,
    createdById: creator.id,
    createdByName: creator.name,
    createdByUsername: creator.username,
    createdByRole: creator.isCollector ? 'Collector' : 'Admin',
    status: ACTIVE_STATUS,
    historyType: '',
    createdAt: normalizeIsoDate(body.createdAt, now),
    syncedAt: now,
    updatedAt: now,
    archivedAt: null,
    archivedBy: null
  };
}

// GET /api/collector/payments/reschedules
// Collectors see their own records. Admins see records for their branch and can filter by collector/status/date.
router.get('/', async (req, res, next) => {
  try {
    await mutationQueue.catch(() => {});
    const actor = getActor(req);
    const payload = await readJson(STORE_KEY, { records: [] });
    const requestedCollectorId = cleanText(req.query?.collectorId, 120);
    const collectorId = actor.isCollector ? actor.id : requestedCollectorId;
    const status = cleanText(req.query?.status || 'active', 40).toLowerCase();
    const from = normalizeDate(req.query?.from);
    const to = normalizeDate(req.query?.to);
    const requestedLimit = Number(req.query?.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 1000)
      : 500;

    const records = readRecords(payload)
      .filter((record) => recordMatchesBranch(record, actor.branchId))
      .filter((record) => !collectorId || cleanText(record.collectorId, 120) === collectorId)
      .filter((record) => {
        if (status === 'all') return true;
        if (status === 'history') return !isActiveRecord(record);
        return isActiveRecord(record);
      })
      .filter((record) => !from || normalizeDate(record.rescheduledDate) >= from)
      .filter((record) => !to || normalizeDate(record.rescheduledDate) <= to)
      .sort((left, right) => {
        const leftActive = isActiveRecord(left);
        const rightActive = isActiveRecord(right);
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        if (leftActive) {
          const dateCompare = cleanText(left.rescheduledDate).localeCompare(cleanText(right.rescheduledDate));
          if (dateCompare !== 0) return dateCompare;
        }
        return cleanText(right.createdAt).localeCompare(cleanText(left.createdAt));
      })
      .slice(0, limit);

    res.json({
      ok: true,
      records,
      count: records.length,
      activeCount: records.filter(isActiveRecord).length
    });
  } catch (error) {
    next(error?.status ? error : createError(500, error.message || 'Failed to load collector reschedules.'));
  }
});

// POST /api/collector/payments/reschedules
// Collector uploads remain idempotent. Admins may create schedules for an assigned collector.
router.post('/', async (req, res, next) => {
  try {
    const accountNumber = normalizeAccountNumber(req.body?.accountNumber);
    if (!accountNumber) throw createError(400, 'accountNumber is required.');
    const requestActor = getActor(req);
    const target = requestActor.isCollector
      ? await loadAssignedCustomer(req, accountNumber)
      : await loadAdminScheduleTarget(req, accountNumber, req.body?.collectorId);
    const { customer, branchId, actor: collector } = target;
    const creator = requestActor.isCollector ? collector : target.admin;
    const incoming = buildRecord(req, customer, branchId, collector, creator);
    const saved = await mutateRecords(async (records) => {
      const duplicate = creator.isCollector
        ? records.find((record) => (
          cleanText(record.collectorId, 120) === collector.id
          && recordMatchesBranch(record, branchId)
          && cleanText(record.clientRecordId, 160) === incoming.clientRecordId
        ))
        : null;
      if (duplicate) return { record: duplicate, created: false };

      const archivedAt = new Date().toISOString();
      records.forEach((record) => {
        if (!isActiveRecord(record)) return;
        if (!recordMatchesBranch(record, branchId)) return;
        if (normalizeAccountNumber(record.accountNumber) !== accountNumber) return;
        record.status = HISTORY_STATUS;
        record.historyType = 'Rescheduled again';
        record.archivedAt = archivedAt;
        record.archivedBy = creator.name;
        record.updatedAt = archivedAt;
      });
      records.unshift(incoming);
      return { record: incoming, created: true };
    });
    res.status(saved.created ? 201 : 200).json({ ok: true, ...saved });
  } catch (error) {
    next(error?.status ? error : createError(500, error.message || 'Failed to save collector reschedule.'));
  }
});

async function updateAdminSchedule(req, res, next) {
  try {
    const admin = requireAdminActor(req);
    const recordId = cleanText(req.params?.id, 180);
    if (!recordId) throw createError(400, 'Schedule id is required.');
    const updated = await mutateRecords(async (records) => {
      const record = records.find((item) => cleanText(item?.id, 180) === recordId);
      if (!record || !recordMatchesBranch(record, admin.branchId)) {
        throw createError(404, 'Collector schedule not found.');
      }
      if (!isActiveRecord(record)) {
        throw createError(409, 'Only active schedules can be edited.');
      }
      const requestedAccountNumber = normalizeAccountNumber(req.body?.accountNumber);
      if (requestedAccountNumber && requestedAccountNumber !== normalizeAccountNumber(record.accountNumber)) {
        throw createError(400, 'Customer cannot be changed after a schedule is created.');
      }
      const requestedCollectorId = cleanText(req.body?.collectorId, 120);
      if (requestedCollectorId && requestedCollectorId !== cleanText(record.collectorId, 120)) {
        throw createError(400, 'Collector cannot be changed after a schedule is created.');
      }

      const rescheduledDate = normalizeDate(req.body?.rescheduledDate ?? record.rescheduledDate);
      const result = cleanText(req.body?.result ?? record.result, 160);
      const notes = cleanText(req.body?.notes ?? record.notes, 1200);
      const preferredTime = cleanText(req.body?.preferredTime ?? record.preferredTime, 80);
      if (!rescheduledDate) throw createError(400, 'A valid rescheduledDate in yyyy-MM-dd format is required.');
      if (!result) throw createError(400, 'Follow-up reason is required.');
      if (!notes) throw createError(400, 'Reason or notes are required.');

      const updatedAt = new Date().toISOString();
      record.rescheduledDate = rescheduledDate;
      record.preferredTime = preferredTime;
      record.result = result;
      record.notes = notes;
      record.updatedAt = updatedAt;
      record.updatedById = admin.id;
      record.updatedByName = admin.name;
      record.updatedByUsername = admin.username;
      return record;
    });
    res.json({ ok: true, record: updated });
  } catch (error) {
    next(error?.status ? error : createError(500, error.message || 'Failed to update collector schedule.'));
  }
}

// PUT/PATCH /api/collector/payments/reschedules/:id
// Admin-only schedule detail updates. Collector and customer remain immutable so cached Android records reconcile safely.
router.put('/:id', updateAdminSchedule);
router.patch('/:id', updateAdminSchedule);

// DELETE /api/collector/payments/reschedules/:id
// Admin-only audited deletion. A history tombstone remains so Android Sync can remove cached active reminders.
router.delete('/:id', async (req, res, next) => {
  try {
    const admin = requireAdminActor(req);
    const recordId = cleanText(req.params?.id, 180);
    if (!recordId) throw createError(400, 'Schedule id is required.');
    const deleted = await mutateRecords(async (records) => {
      const record = records.find((item) => cleanText(item?.id, 180) === recordId);
      if (!record || !recordMatchesBranch(record, admin.branchId)) {
        throw createError(404, 'Collector schedule not found.');
      }
      if (cleanText(record.historyType).toLowerCase() === 'deleted') {
        return { record, changed: false };
      }
      const deletedAt = new Date().toISOString();
      record.status = HISTORY_STATUS;
      record.historyType = 'Deleted';
      record.archivedAt = deletedAt;
      record.archivedBy = admin.name;
      record.deletedAt = deletedAt;
      record.deletedById = admin.id;
      record.deletedByName = admin.name;
      record.deletedByUsername = admin.username;
      record.updatedAt = deletedAt;
      return { record, changed: true };
    });
    res.json({ ok: true, deleted: true, ...deleted });
  } catch (error) {
    next(error?.status ? error : createError(500, error.message || 'Failed to delete collector schedule.'));
  }
});

// POST /api/collector/payments/reschedules/resolve/:accountNumber
// Archives active reminders after the assigned client has paid.
router.post('/resolve/:accountNumber', async (req, res, next) => {
  try {
    const accountNumber = normalizeAccountNumber(req.params.accountNumber);
    if (!accountNumber) throw createError(400, 'accountNumber is required.');
    const { branchId, actor } = await loadAssignedCustomer(req, accountNumber);
    const updated = await mutateRecords(async (records) => {
      let count = 0;
      const archivedAt = new Date().toISOString();
      records.forEach((record) => {
        if (!isActiveRecord(record)) return;
        if (!recordMatchesBranch(record, branchId)) return;
        if (!branchId && cleanText(record.collectorId, 120) !== actor.id) return;
        if (normalizeAccountNumber(record.accountNumber) !== accountNumber) return;
        record.status = HISTORY_STATUS;
        record.historyType = 'Paid';
        record.archivedAt = archivedAt;
        record.archivedBy = actor.name;
        record.updatedAt = archivedAt;
        count += 1;
      });
      return count;
    });
    res.json({ ok: true, accountNumber, updated });
  } catch (error) {
    next(error?.status ? error : createError(500, error.message || 'Failed to resolve collector reschedules.'));
  }
});

module.exports = router;
module.exports._test = {
  ACTIVE_STATUS,
  HISTORY_STATUS,
  isActiveRecord,
  normalizeDate
};
