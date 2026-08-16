const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const paymentRecordsRouter = require('../../billing/backend/payment-records');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { getActiveCollectorExclusionAccountSet } = require('./collector-client-exclusions');

const router = express.Router();
const STORE_KEY = 'collector_priority_assignments';
const ACTIVE_STATUS = 'Active';
const MAX_RECORDS = 10000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(['urgent', 'high', 'normal', 'low']);
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

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readRecords(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.records) ? payload.records : [];
}

function accountId(account = {}) {
  return cleanText(account.id ?? account.accountId ?? account.username, 120);
}

function getActor(req) {
  const source = req.collector || req.user || {};
  return {
    id: accountId(source),
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
    throw createError(403, 'Admin access required to manage priority collections.');
  }
  return actor;
}

function recordMatchesBranch(record = {}, branchId = '') {
  const wanted = normalizeBranchId(branchId);
  if (!wanted) return true;
  return normalizeBranchId(record.branchId) === wanted;
}

function isActiveRecord(record = {}) {
  return cleanText(record.status).toLowerCase() === ACTIVE_STATUS.toLowerCase();
}

function normalizePriority(value) {
  const normalized = cleanText(value, 20).toLowerCase();
  return PRIORITIES.has(normalized) ? normalized : '';
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

function appendAudit(record, action, actor = {}, changes = {}) {
  const history = Array.isArray(record.auditHistory) ? record.auditHistory : [];
  history.push({
    action: cleanText(action, 80),
    at: new Date().toISOString(),
    actorId: cleanText(actor.id, 120),
    actorName: cleanText(actor.name || actor.username || 'System', 200),
    actorUsername: cleanText(actor.username, 160),
    actorRole: actor.isCollector ? 'Collector' : (actor.isAdmin ? 'Admin' : 'System'),
    changes
  });
  record.auditHistory = history.slice(-100);
}

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

async function readCanonicalBalance(accountNumber, branchId) {
  try {
    const record = await paymentRecordsRouter.buildPaymentRecordForAccount(accountNumber, branchId || null);
    if (!record) return null;
    return normalizeMoney(record.paymentBreakdownEndingBalance ?? record.endingBalance ?? record.balance);
  } catch (error) {
    console.warn(`Unable to reconcile priority collection ${accountNumber}:`, error?.message || error);
    return null;
  }
}

async function loadAdminCustomers(req, accountNumbers) {
  const admin = requireAdminActor(req);
  const wantedAccounts = [...new Set((Array.isArray(accountNumbers) ? accountNumbers : [accountNumbers])
    .map(normalizeAccountNumber)
    .filter(Boolean))];
  if (!wantedAccounts.length) throw createError(400, 'At least one accountNumber is required.');
  if (wantedAccounts.length > 200) throw createError(400, 'A maximum of 200 clients can be assigned at once.');

  let targets;
  if (await isRelationalReady()) {
    if (!admin.branchId) throw createError(400, 'Branch assignment missing for this Admin account.');
    targets = await Promise.all(wantedAccounts.map(async (accountNumber) => {
      const [customerRows] = await query(
        `SELECT account_number AS accountNumber, name AS customerName, first_name AS firstName,
                last_name AS lastName, area, branch_id AS branchId
         FROM customers
         WHERE branch_id = ? AND account_number = ?
         LIMIT 1`,
        [admin.branchId, accountNumber]
      );
      const customer = Array.isArray(customerRows) && customerRows.length ? customerRows[0] : null;
      if (!customer) throw createError(404, `Customer ${accountNumber} was not found.`);
      return { admin, branchId: admin.branchId, customer, accountNumber };
    }));
  } else {
    const customerPayload = await readJson('customers', []);
    const customers = Array.isArray(customerPayload) ? customerPayload : (customerPayload?.customers || []);
    targets = wantedAccounts.map((accountNumber) => {
      const customer = customers.find((item) => {
        if (normalizeAccountNumber(item?.accountNumber) !== accountNumber) return false;
        const customerBranchId = normalizeBranchId(item?.branchId);
        return !admin.branchId || !customerBranchId || customerBranchId === admin.branchId;
      });
      if (!customer) throw createError(404, `Customer ${accountNumber} was not found.`);
      return {
        admin,
        branchId: admin.branchId || normalizeBranchId(customer.branchId),
        customer,
        accountNumber
      };
    });
  }
  const exclusionsByBranch = new Map();
  for (const target of targets) {
    const branchKey = normalizeBranchId(target.branchId) || '1';
    if (!exclusionsByBranch.has(branchKey)) {
      exclusionsByBranch.set(branchKey, await getActiveCollectorExclusionAccountSet(branchKey));
    }
  }
  const excludedAccounts = targets
    .filter((target) => exclusionsByBranch.get(normalizeBranchId(target.branchId) || '1')?.has(target.accountNumber))
    .map((target) => target.accountNumber);
  if (excludedAccounts.length) {
    throw createError(409, `Restore excluded clients before assigning priority: ${excludedAccounts.join(', ')}.`);
  }
  return targets;
}

function mutateRecords(mutator) {
  const operation = mutationQueue
    .catch(() => {})
    .then(async () => {
      const payload = await readJson(STORE_KEY, { records: [] });
      const records = readRecords(payload);
      const result = await mutator(records);
      await writeJson(STORE_KEY, {
        records: records.slice(0, MAX_RECORDS),
        updatedAt: new Date().toISOString()
      });
      return result;
    });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function archiveRecord(record, historyType, actor = {}, changes = {}) {
  const now = new Date().toISOString();
  record.status = 'History';
  record.historyType = historyType;
  record.archivedAt = now;
  record.updatedAt = now;
  record.updatedById = cleanText(actor.id, 120);
  record.updatedByName = cleanText(actor.name || actor.username || 'System', 200);
  appendAudit(record, historyType.toLowerCase(), actor, changes);
}

async function reconcileRecords(records, actor) {
  const candidates = records.filter((record) => (
    isActiveRecord(record)
    && recordMatchesBranch(record, actor.branchId)
  ));
  const today = todayKey();
  await Promise.all(candidates.map(async (record) => {
    const expiresOn = normalizeDate(record.expiresOn);
    if (expiresOn && expiresOn < today) {
      archiveRecord(record, 'Expired', { name: 'System' }, { expiresOn });
      return;
    }
    const balance = await readCanonicalBalance(record.accountNumber, record.branchId);
    if (balance === null) return;
    record.amountDue = balance;
    record.balanceCheckedAt = new Date().toISOString();
    if (balance <= 0.009) {
      archiveRecord(record, 'Paid', { name: 'System' }, { endingBalance: balance });
    }
  }));
}

function buildRecord(req, target, balance) {
  const body = req.body || {};
  const priority = normalizePriority(body.priority);
  const collectionDate = normalizeDate(body.collectionDate);
  const expiresOn = cleanText(body.expiresOn) ? normalizeDate(body.expiresOn) : '';
  const reason = cleanText(body.reason, 500);
  if (!priority) throw createError(400, 'priority must be Urgent, High, Normal, or Low.');
  if (!collectionDate) throw createError(400, 'A valid collectionDate in yyyy-MM-dd format is required.');
  if (cleanText(body.expiresOn) && !expiresOn) throw createError(400, 'expiresOn must use yyyy-MM-dd format.');
  if (expiresOn && expiresOn < collectionDate) throw createError(400, 'expiresOn cannot be before collectionDate.');
  if (!reason) throw createError(400, 'A collection reason is required.');

  const now = new Date().toISOString();
  const record = {
    id: `priority-${crypto.randomUUID()}`,
    branchId: normalizeBranchId(target.branchId),
    accountNumber: target.accountNumber,
    customerName: customerName(target.customer, target.accountNumber),
    area: cleanText(target.customer.area, 240),
    collectorId: '',
    collectorName: 'Anyone can collect',
    collectorUsername: '',
    assignmentScope: 'all_collectors',
    priority,
    collectionDate,
    expiresOn,
    reason,
    amountDue: balance,
    status: ACTIVE_STATUS,
    historyType: '',
    createdAt: now,
    updatedAt: now,
    createdById: target.admin.id,
    createdByName: target.admin.name,
    createdByUsername: target.admin.username,
    updatedById: target.admin.id,
    updatedByName: target.admin.name,
    auditHistory: []
  };
  appendAudit(record, 'created', target.admin, {
    assignmentScope: record.assignmentScope,
    priority,
    collectionDate,
    expiresOn
  });
  return record;
}

// GET /api/collector/payments/priorities
// Every collector sees the branch-wide shared queue. Admins see branch-scoped active/history records.
router.get('/', async (req, res, next) => {
  try {
    const actor = getActor(req);
    if (!actor.isCollector && !actor.isAdmin) throw createError(403, 'Admin or collector access required.');
    await mutateRecords(async (records) => reconcileRecords(records, actor));
    const payload = await readJson(STORE_KEY, { records: [] });
    const status = cleanText(req.query?.status || 'active', 40).toLowerCase();
    const requestedLimit = Number(req.query?.limit);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 500;
    const order = { urgent: 0, high: 1, normal: 2, low: 3 };
    const excludedAccounts = actor.isCollector
      ? await getActiveCollectorExclusionAccountSet(actor.branchId || '1')
      : new Set();
    const records = readRecords(payload)
      .filter((record) => recordMatchesBranch(record, actor.branchId))
      .filter((record) => !actor.isCollector || !excludedAccounts.has(normalizeAccountNumber(record.accountNumber)))
      .filter((record) => status === 'all' || (status === 'history' ? !isActiveRecord(record) : isActiveRecord(record)))
      .sort((left, right) => {
        if (isActiveRecord(left) !== isActiveRecord(right)) return isActiveRecord(left) ? -1 : 1;
        const priorityOrder = (order[normalizePriority(left.priority)] ?? 9) - (order[normalizePriority(right.priority)] ?? 9);
        if (priorityOrder) return priorityOrder;
        const dateOrder = cleanText(left.collectionDate).localeCompare(cleanText(right.collectionDate));
        if (dateOrder) return dateOrder;
        return cleanText(right.updatedAt).localeCompare(cleanText(left.updatedAt));
      })
      .slice(0, limit);
    res.json({
      ok: true,
      records,
      activeCount: records.filter(isActiveRecord).length,
      historyCount: records.filter((record) => !isActiveRecord(record)).length
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load priority collections.'));
  }
});

// POST /api/collector/payments/priorities
router.post('/', async (req, res, next) => {
  try {
    const requestedAccounts = Array.isArray(req.body?.accountNumbers)
      ? req.body.accountNumbers
      : [req.body?.accountNumber];
    const targets = await loadAdminCustomers(req, requestedAccounts);
    const balances = await Promise.all(targets.map((target) => (
      readCanonicalBalance(target.accountNumber, target.branchId)
    )));
    const paidAccounts = targets
      .filter((target, index) => balances[index] !== null && balances[index] <= 0.009)
      .map((target) => target.accountNumber);
    if (paidAccounts.length) {
      throw createError(409, `Fully paid clients cannot be assigned: ${paidAccounts.join(', ')}.`);
    }
    const newRecords = targets.map((target, index) => buildRecord(req, target, balances[index]));
    await mutateRecords(async (records) => {
      const duplicateAccounts = newRecords
        .filter((newRecord) => records.some((item) => (
          isActiveRecord(item)
          && recordMatchesBranch(item, newRecord.branchId)
          && normalizeAccountNumber(item.accountNumber) === newRecord.accountNumber
        )))
        .map((record) => record.accountNumber);
      if (duplicateAccounts.length) {
        throw createError(409, `Clients already in the active priority queue: ${duplicateAccounts.join(', ')}.`);
      }
      records.unshift(...newRecords);
    });
    res.status(201).json({
      ok: true,
      records: newRecords,
      record: newRecords[0] || null,
      count: newRecords.length
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to create priority collection.'));
  }
});

async function updatePriorityRecord(req, res, next) {
  try {
    const admin = requireAdminActor(req);
    const recordId = cleanText(req.params.id, 180);
    let updatedRecord;
    await mutateRecords(async (records) => {
      const record = records.find((item) => item.id === recordId && recordMatchesBranch(item, admin.branchId));
      if (!record) throw createError(404, 'Priority collection was not found.');
      if (!isActiveRecord(record)) throw createError(409, 'History records cannot be edited.');

      const accountNumber = normalizeAccountNumber(record.accountNumber);
      const [target] = await loadAdminCustomers(req, [accountNumber]);
      const priority = normalizePriority(req.body?.priority || record.priority);
      const collectionDate = normalizeDate(req.body?.collectionDate || record.collectionDate);
      const expiresOnRaw = Object.prototype.hasOwnProperty.call(req.body || {}, 'expiresOn')
        ? cleanText(req.body.expiresOn)
        : cleanText(record.expiresOn);
      const expiresOn = expiresOnRaw ? normalizeDate(expiresOnRaw) : '';
      const reason = cleanText(req.body?.reason ?? record.reason, 500);
      if (!priority) throw createError(400, 'priority must be Urgent, High, Normal, or Low.');
      if (!collectionDate) throw createError(400, 'A valid collectionDate in yyyy-MM-dd format is required.');
      if (expiresOnRaw && !expiresOn) throw createError(400, 'expiresOn must use yyyy-MM-dd format.');
      if (expiresOn && expiresOn < collectionDate) throw createError(400, 'expiresOn cannot be before collectionDate.');
      if (!reason) throw createError(400, 'A collection reason is required.');

      const duplicate = records.find((item) => (
        item !== record
        && isActiveRecord(item)
        && recordMatchesBranch(item, target.branchId)
        && normalizeAccountNumber(item.accountNumber) === accountNumber
      ));
      if (duplicate) throw createError(409, 'This client already has an active priority assignment.');

      const balance = await readCanonicalBalance(accountNumber, target.branchId);
      if (balance !== null && balance <= 0.009) {
        throw createError(409, 'This customer is already fully paid and does not need priority collection.');
      }
      const changes = {};
      const nextValues = {
        branchId: normalizeBranchId(target.branchId),
        accountNumber,
        customerName: customerName(target.customer, accountNumber),
        area: cleanText(target.customer.area, 240),
        collectorId: '',
        collectorName: 'Anyone can collect',
        collectorUsername: '',
        assignmentScope: 'all_collectors',
        priority,
        collectionDate,
        expiresOn,
        reason,
        amountDue: balance
      };
      Object.entries(nextValues).forEach(([key, value]) => {
        if (record[key] !== value) changes[key] = { from: record[key] ?? null, to: value };
        record[key] = value;
      });
      record.updatedAt = new Date().toISOString();
      record.updatedById = admin.id;
      record.updatedByName = admin.name;
      appendAudit(record, 'updated', admin, changes);
      updatedRecord = record;
    });
    res.json({ ok: true, record: updatedRecord });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to update priority collection.'));
  }
}

router.put('/:id', updatePriorityRecord);
router.patch('/:id', updatePriorityRecord);

// DELETE archives rather than erases so assignment decisions remain auditable.
router.delete('/:id', async (req, res, next) => {
  try {
    const admin = requireAdminActor(req);
    const recordId = cleanText(req.params.id, 180);
    let deletedRecord;
    await mutateRecords(async (records) => {
      const record = records.find((item) => item.id === recordId && recordMatchesBranch(item, admin.branchId));
      if (!record) throw createError(404, 'Priority collection was not found.');
      if (isActiveRecord(record)) {
        archiveRecord(record, 'Cancelled', admin, { reason: cleanText(req.body?.reason, 500) || 'Cancelled by Admin' });
      }
      deletedRecord = record;
    });
    res.json({ ok: true, record: deletedRecord });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to cancel priority collection.'));
  }
});

module.exports = router;
