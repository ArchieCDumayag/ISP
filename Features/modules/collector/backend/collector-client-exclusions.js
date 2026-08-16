const crypto = require('crypto');
const { readJson, writeJson } = require('../../../../core/data/data-store');

const STORE_KEY = 'collector_client_exclusions';
const STORE_VERSION = 1;
const MAX_AUDIT_EVENTS = 200;
const ADMIN_DECISION_REASON = 'Admin decision';
let mutationQueue = Promise.resolve();

const cleanText = (value, maxLength = 0) => {
  const normalized = String(value == null ? '' : value).trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeBranchKey = (value) => cleanText(value, 80) || '1';
const normalizeAccountNumber = (value) => cleanText(value, 120);

function readBranchRecords(payload, branchId) {
  const branchKey = normalizeBranchKey(branchId);
  const records = payload?.branches?.[branchKey]?.records;
  return Array.isArray(records) ? records : [];
}

function normalizeActor(actor = {}) {
  return {
    id: cleanText(actor.id, 120),
    username: cleanText(actor.username, 160),
    name: cleanText(actor.name || actor.username || 'Admin', 200),
    role: cleanText(actor.role || 'Admin', 80) || 'Admin'
  };
}

function appendAudit(record, action, actor, reason) {
  const safeActor = normalizeActor(actor);
  const history = Array.isArray(record.auditHistory) ? record.auditHistory : [];
  history.push({
    action: cleanText(action, 40),
    at: new Date().toISOString(),
    reason: cleanText(reason, 500),
    actorId: safeActor.id,
    actorUsername: safeActor.username,
    actorName: safeActor.name,
    actorRole: safeActor.role
  });
  record.auditHistory = history.slice(-MAX_AUDIT_EVENTS);
}

function normalizePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    version: STORE_VERSION,
    branches: source.branches && typeof source.branches === 'object' ? source.branches : {},
    updatedAt: cleanText(source.updatedAt, 80) || null
  };
}

async function readCollectorClientExclusions(branchId, options = {}) {
  const payload = normalizePayload(await readJson(STORE_KEY, {
    version: STORE_VERSION,
    branches: {}
  }));
  const includeRestored = options.includeRestored === true;
  return readBranchRecords(payload, branchId)
    .filter((record) => includeRestored || record?.active === true)
    .map((record) => ({ ...record, auditHistory: Array.isArray(record.auditHistory) ? record.auditHistory : [] }))
    .sort((left, right) => cleanText(right.updatedAt).localeCompare(cleanText(left.updatedAt)));
}

async function getActiveCollectorExclusionAccountSet(branchId) {
  const records = await readCollectorClientExclusions(branchId);
  return new Set(records.map((record) => normalizeAccountNumber(record.accountNumber)).filter(Boolean));
}

async function isCollectorClientExcluded(branchId, accountNumber, activeAccounts = null) {
  const normalizedAccount = normalizeAccountNumber(accountNumber);
  if (!normalizedAccount) return false;
  const excludedAccounts = activeAccounts instanceof Set
    ? activeAccounts
    : await getActiveCollectorExclusionAccountSet(branchId);
  return excludedAccounts.has(normalizedAccount);
}

async function filterCollectorVisibleCustomers(customers, branchId) {
  const rows = Array.isArray(customers) ? customers : [];
  if (!rows.length) return [];
  const excludedAccounts = await getActiveCollectorExclusionAccountSet(branchId);
  if (!excludedAccounts.size) return rows;
  return rows.filter((customer) => !excludedAccounts.has(normalizeAccountNumber(customer?.accountNumber)));
}

function mutateExclusions(branchId, mutator) {
  const branchKey = normalizeBranchKey(branchId);
  const operation = mutationQueue
    .catch(() => {})
    .then(async () => {
      const payload = normalizePayload(await readJson(STORE_KEY, {
        version: STORE_VERSION,
        branches: {}
      }));
      const branch = payload.branches[branchKey] && typeof payload.branches[branchKey] === 'object'
        ? payload.branches[branchKey]
        : {};
      const records = Array.isArray(branch.records) ? branch.records : [];
      const result = await mutator(records, branchKey);
      const updatedAt = new Date().toISOString();
      payload.branches[branchKey] = { records, updatedAt };
      payload.updatedAt = updatedAt;
      await writeJson(STORE_KEY, payload);
      return result;
    });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function excludeCollectorClients({ branchId, targets = [], actor = {}, reason }) {
  const normalizedReason = cleanText(reason, 500) || ADMIN_DECISION_REASON;
  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((target) => ({
      accountNumber: normalizeAccountNumber(target?.accountNumber),
      customer: target?.customer && typeof target.customer === 'object' ? target.customer : {}
    }))
    .filter((target, index, rows) => target.accountNumber
      && rows.findIndex((item) => item.accountNumber === target.accountNumber) === index);
  if (!normalizedTargets.length) throw new Error('At least one account number is required.');

  return mutateExclusions(branchId, async (records, branchKey) => {
    const changedRecords = [];
    const unchangedRecords = [];
    normalizedTargets.forEach(({ accountNumber: normalizedAccount, customer }) => {
      const existing = records.find(
        (record) => normalizeAccountNumber(record?.accountNumber) === normalizedAccount
      );
      if (existing?.active === true) {
        unchangedRecords.push(existing);
        return;
      }

      const now = new Date().toISOString();
      const safeActor = normalizeActor(actor);
      const record = existing || {
        id: `collector-exclusion-${crypto.randomUUID()}`,
        branchId: branchKey,
        accountNumber: normalizedAccount,
        createdAt: now,
        auditHistory: []
      };
      record.customerName = cleanText(
        customer.customerName || customer.name
          || [customer.firstName, customer.lastName].map((value) => cleanText(value)).filter(Boolean).join(' ')
          || `Account ${normalizedAccount}`,
        240
      );
      record.area = cleanText(customer.area, 240);
      record.active = true;
      record.reason = normalizedReason;
      record.excludedAt = now;
      record.excludedById = safeActor.id;
      record.excludedByName = safeActor.name;
      record.excludedByUsername = safeActor.username;
      record.restoredAt = null;
      record.restoredById = '';
      record.restoredByName = '';
      record.restoreReason = '';
      record.updatedAt = now;
      appendAudit(record, 'excluded', safeActor, normalizedReason);
      if (!existing) records.unshift(record);
      changedRecords.push(record);
    });
    return {
      records: changedRecords,
      unchangedRecords,
      changed: changedRecords.length > 0
    };
  });
}

async function excludeCollectorClient({ branchId, accountNumber, customer = {}, actor = {}, reason }) {
  const result = await excludeCollectorClients({
    branchId,
    targets: [{ accountNumber, customer }],
    actor,
    reason
  });
  return {
    record: result.records[0] || result.unchangedRecords[0] || null,
    changed: result.changed
  };
}

async function restoreCollectorClients({ branchId, accountNumbers = [], actor = {}, reason }) {
  const normalizedReason = cleanText(reason, 500) || ADMIN_DECISION_REASON;
  const normalizedAccounts = [...new Set(
    (Array.isArray(accountNumbers) ? accountNumbers : [])
      .map(normalizeAccountNumber)
      .filter(Boolean)
  )];
  if (!normalizedAccounts.length) throw new Error('At least one account number is required.');

  return mutateExclusions(branchId, async (records) => {
    const changedRecords = [];
    const unchangedRecords = [];
    normalizedAccounts.forEach((normalizedAccount) => {
      const record = records.find(
        (item) => normalizeAccountNumber(item?.accountNumber) === normalizedAccount
      );
      if (!record || record.active !== true) {
        unchangedRecords.push(record || { accountNumber: normalizedAccount });
        return;
      }
      const now = new Date().toISOString();
      const safeActor = normalizeActor(actor);
      record.active = false;
      record.restoredAt = now;
      record.restoredById = safeActor.id;
      record.restoredByName = safeActor.name;
      record.restoredByUsername = safeActor.username;
      record.restoreReason = normalizedReason;
      record.updatedAt = now;
      appendAudit(record, 'restored', safeActor, normalizedReason);
      changedRecords.push(record);
    });
    return {
      records: changedRecords,
      unchangedRecords,
      changed: changedRecords.length > 0
    };
  });
}

async function restoreCollectorClient({ branchId, accountNumber, actor = {}, reason }) {
  const result = await restoreCollectorClients({
    branchId,
    accountNumbers: [accountNumber],
    actor,
    reason
  });
  return {
    record: result.records[0] || result.unchangedRecords[0] || null,
    changed: result.changed
  };
}

module.exports = {
  STORE_KEY,
  ADMIN_DECISION_REASON,
  normalizeBranchKey,
  normalizeAccountNumber,
  readCollectorClientExclusions,
  getActiveCollectorExclusionAccountSet,
  isCollectorClientExcluded,
  filterCollectorVisibleCustomers,
  excludeCollectorClients,
  excludeCollectorClient,
  restoreCollectorClients,
  restoreCollectorClient
};
