const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');

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
    name: cleanText(source.name || source.username || 'Collector', 200),
    branchId: normalizeBranchId(source.branchId),
    isCollector: !!req.collector
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

function buildRecord(req, customer, branchId, actor) {
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
  return {
    id: `followup-${crypto.randomUUID()}`,
    clientRecordId: clientRecordId || `android-${crypto.randomUUID()}`,
    branchId: normalizeBranchId(branchId),
    accountNumber,
    customerName: customerName(customer, accountNumber),
    area: cleanText(customer.area, 240),
    collectorId: actor.id,
    collectorName: actor.name,
    collectorUsername: actor.username,
    result,
    rescheduledDate,
    preferredTime,
    notes,
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
// Collector-only, idempotent upload from the Android app.
router.post('/', async (req, res, next) => {
  try {
    const accountNumber = normalizeAccountNumber(req.body?.accountNumber);
    if (!accountNumber) throw createError(400, 'accountNumber is required.');
    const { customer, branchId, actor } = await loadAssignedCustomer(req, accountNumber);
    const incoming = buildRecord(req, customer, branchId, actor);
    const saved = await mutateRecords(async (records) => {
      const duplicate = records.find((record) => (
        cleanText(record.collectorId, 120) === actor.id
        && recordMatchesBranch(record, branchId)
        && cleanText(record.clientRecordId, 160) === incoming.clientRecordId
      ));
      if (duplicate) return { record: duplicate, created: false };

      const archivedAt = new Date().toISOString();
      records.forEach((record) => {
        if (!isActiveRecord(record)) return;
        if (!recordMatchesBranch(record, branchId)) return;
        if (normalizeAccountNumber(record.accountNumber) !== accountNumber) return;
        record.status = HISTORY_STATUS;
        record.historyType = 'Rescheduled again';
        record.archivedAt = archivedAt;
        record.archivedBy = actor.name;
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
