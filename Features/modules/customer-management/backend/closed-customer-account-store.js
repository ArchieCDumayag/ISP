const crypto = require('crypto');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { normalizeCustomerName } = require('../../../../core/data/customer-name-normalizer');

const STORE_KEY = 'closed_customer_accounts';
const STORE_VERSION = 2;
const MAX_AUDIT_EVENTS = 200;
const STATE_CLOSING = 'closing';
const STATE_CLOSED = 'closed';
const STATE_FAILED = 'failed';
const BALANCE_TREATMENT_ZERO = 'zero';
const BALANCE_TREATMENT_KEEP = 'keep';
const BALANCE_TREATMENT_WRITE_OFF = 'write-off';
const BALANCE_MODE_CANONICAL = 'canonical';
const BALANCE_MODE_SNAPSHOT = 'snapshot';
const REOPEN_ACTION_COLLECT_FIRST = 'collect-first';
const REOPEN_ACTION_KEEP = 'keep';
const REOPEN_ACTION_WRITE_OFF = 'write-off';

let mutationQueue = Promise.resolve();

const cleanText = (value, maxLength = 0) => {
  const normalized = String(value == null ? '' : value).trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeBranchKey = (value) => cleanText(value, 80) || '1';
const normalizeAccountNumber = (value) => cleanText(value, 120);
const normalizeMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};
const normalizeOptionalMoney = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
};

const normalizeBalanceMode = (value) => (
  cleanText(value, 40).toLowerCase() === BALANCE_MODE_SNAPSHOT
    ? BALANCE_MODE_SNAPSHOT
    : BALANCE_MODE_CANONICAL
);

const resolveFinalClosedCustomerBalance = (record = {}) => {
  const explicit = normalizeOptionalMoney(record.finalClosedCustomerBalance);
  if (explicit !== null) return explicit;
  const requested = normalizeOptionalMoney(record.requestedFinalBalance);
  if (requested !== null) return requested;
  return normalizeMoney(record.finalBalance);
};

// New closures keep an authoritative closed-account balance without changing
// Billing history. Effective payments still post to Billing, so the same
// canonical delta is applied to the saved closed-balance snapshot. Records
// created before this contract remain canonical to avoid double-counting their
// permanent Account Closure Adjustment entries.
const resolveClosedCustomerBalance = (record = {}, canonicalBalance) => {
  const canonical = normalizeOptionalMoney(canonicalBalance);
  if (canonical === null) return null;
  if (normalizeBalanceMode(record.balanceMode) !== BALANCE_MODE_SNAPSHOT) return canonical;
  const canonicalAtClosure = normalizeOptionalMoney(record.canonicalBalanceAtClosure)
    ?? normalizeMoney(record.balanceBefore);
  return normalizeMoney(
    resolveFinalClosedCustomerBalance(record) + canonical - canonicalAtClosure
  );
};

const normalizeAdjustmentDirection = (value) => {
  const normalized = cleanText(value, 20).toLowerCase();
  return ['credit', 'debit'].includes(normalized) ? normalized : null;
};

const normalizeBalanceTreatment = (value, { balanceBefore = 0 } = {}) => {
  const normalized = cleanText(value, 40).toLowerCase();
  if ([BALANCE_TREATMENT_ZERO, BALANCE_TREATMENT_KEEP, BALANCE_TREATMENT_WRITE_OFF].includes(normalized)) {
    return normalized;
  }
  if (Math.abs(normalizeMoney(balanceBefore)) <= 0.005) return BALANCE_TREATMENT_ZERO;
  // Before balance treatment was stored, every positive closure required a
  // write-off. Preserve that meaning for legacy closed/failed records.
  return BALANCE_TREATMENT_WRITE_OFF;
};

const normalizeReopenAction = (value) => {
  const normalized = cleanText(value, 40).toLowerCase();
  return [REOPEN_ACTION_COLLECT_FIRST, REOPEN_ACTION_KEEP, REOPEN_ACTION_WRITE_OFF].includes(normalized)
    ? normalized
    : REOPEN_ACTION_COLLECT_FIRST;
};

const normalizeActor = (actor = {}) => ({
  id: cleanText(actor.id, 120),
  username: cleanText(actor.username, 160),
  name: cleanText(actor.name || actor.username || 'Admin', 200),
  role: cleanText(actor.role || 'Admin', 80) || 'Admin'
});

const normalizePayload = (payload) => {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return {
    version: STORE_VERSION,
    branches: source.branches && typeof source.branches === 'object' && !Array.isArray(source.branches)
      ? source.branches
      : {},
    updatedAt: cleanText(source.updatedAt, 80) || null
  };
};

const sanitizeRecord = (record = {}) => {
  const accountNumber = normalizeAccountNumber(record.accountNumber);
  if (!accountNumber) return null;
  const state = [STATE_CLOSING, STATE_CLOSED, STATE_FAILED].includes(cleanText(record.state).toLowerCase())
    ? cleanText(record.state).toLowerCase()
    : STATE_CLOSING;
  const balanceBefore = normalizeMoney(record.balanceBefore);
  const writeOffAmount = normalizeMoney(record.writeOffAmount);
  const balanceMode = normalizeBalanceMode(record.balanceMode);
  return {
    id: cleanText(record.id, 96),
    branchId: normalizeBranchKey(record.branchId),
    accountNumber,
    customerName: normalizeCustomerName(record.customerName, 240),
    contactNumber: cleanText(record.contactNumber, 80),
    planName: cleanText(record.planName, 160),
    areaName: cleanText(record.areaName, 180),
    closureDate: cleanText(record.closureDate, 10),
    reason: cleanText(record.reason, 500),
    state,
    active: record.active !== false,
    balanceBefore,
    balanceMode,
    canonicalBalanceAtClosure: normalizeOptionalMoney(record.canonicalBalanceAtClosure) ?? balanceBefore,
    finalClosedCustomerBalance: resolveFinalClosedCustomerBalance(record),
    balanceTreatment: normalizeBalanceTreatment(record.balanceTreatment, { balanceBefore, writeOffAmount }),
    writeOffAmount,
    requestedFinalBalance: normalizeOptionalMoney(record.requestedFinalBalance),
    balanceAdjustmentAmount: normalizeMoney(record.balanceAdjustmentAmount),
    balanceAdjustmentDirection: normalizeAdjustmentDirection(record.balanceAdjustmentDirection),
    finalBalance: normalizeMoney(record.finalBalance),
    closedAt: cleanText(record.closedAt, 80) || null,
    closedBy: normalizeActor(record.closedBy || {}),
    reopenedAt: cleanText(record.reopenedAt, 80) || null,
    reopenedBy: record.reopenedBy ? normalizeActor(record.reopenedBy) : null,
    reopenReason: cleanText(record.reopenReason, 500),
    reopenBalanceAction: record.reopenBalanceAction ? normalizeReopenAction(record.reopenBalanceAction) : null,
    warning: cleanText(record.warning, 1000),
    createdAt: cleanText(record.createdAt, 80) || null,
    updatedAt: cleanText(record.updatedAt, 80) || null,
    auditHistory: (Array.isArray(record.auditHistory) ? record.auditHistory : [])
      .slice(-MAX_AUDIT_EVENTS)
      .map((event) => ({
        action: cleanText(event?.action, 60),
        at: cleanText(event?.at, 80),
        reason: cleanText(event?.reason, 500),
        actor: normalizeActor(event?.actor || {})
      }))
  };
};

const appendAudit = (record, action, actor, reason) => {
  const history = Array.isArray(record.auditHistory) ? record.auditHistory : [];
  history.push({
    action: cleanText(action, 60),
    at: new Date().toISOString(),
    reason: cleanText(reason, 500),
    actor: normalizeActor(actor)
  });
  record.auditHistory = history.slice(-MAX_AUDIT_EVENTS);
};

const readClosedCustomerAccountStore = async () => normalizePayload(await readJson(STORE_KEY, {
  version: STORE_VERSION,
  branches: {}
}));

const readBranchRecords = (payload, branchId) => {
  const branchKey = normalizeBranchKey(branchId);
  const records = payload?.branches?.[branchKey]?.records;
  return Array.isArray(records) ? records : [];
};

const mutateStore = (branchId, mutator) => {
  const branchKey = normalizeBranchKey(branchId);
  const operation = mutationQueue
    .catch(() => {})
    .then(async () => {
      const payload = await readClosedCustomerAccountStore();
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
};

const listClosedCustomerAccounts = async ({
  branchId,
  search = '',
  limit = 25,
  offset = 0,
  includeReopened = false
} = {}) => {
  const payload = await readClosedCustomerAccountStore();
  const term = cleanText(search, 160).toLowerCase();
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const records = readBranchRecords(payload, branchId)
    .map(sanitizeRecord)
    .filter(Boolean)
    .filter((record) => includeReopened || record.active)
    .filter((record) => !term || [
      record.accountNumber,
      record.customerName,
      record.planName,
      record.areaName,
      record.reason
    ].some((value) => cleanText(value).toLowerCase().includes(term)))
    .sort((left, right) => cleanText(right.closedAt || right.updatedAt).localeCompare(cleanText(left.closedAt || left.updatedAt)));
  return {
    items: records.slice(safeOffset, safeOffset + safeLimit),
    total: records.length,
    limit: safeLimit,
    offset: safeOffset
  };
};

const getActiveClosedCustomerAccount = async (branchId, accountNumber) => {
  const normalizedAccount = normalizeAccountNumber(accountNumber);
  if (!normalizedAccount) return null;
  const payload = await readClosedCustomerAccountStore();
  const record = readBranchRecords(payload, branchId).find((entry) => (
    entry?.active !== false && normalizeAccountNumber(entry?.accountNumber) === normalizedAccount
  ));
  return record ? sanitizeRecord(record) : null;
};

const getClosedCustomerAccountById = async (closureId, { branchId, activeOnly = true } = {}) => {
  const id = cleanText(closureId, 96);
  if (!id) return null;
  const payload = await readClosedCustomerAccountStore();
  const record = readBranchRecords(payload, branchId).find((entry) => (
    cleanText(entry?.id, 96) === id && (!activeOnly || entry?.active !== false)
  ));
  return record ? sanitizeRecord(record) : null;
};

const getActiveClosedAccountNumberSet = async (branchId) => {
  const result = await listClosedCustomerAccounts({ branchId, limit: 100, offset: 0 });
  if (result.total <= result.items.length) {
    return new Set(result.items.map((record) => record.accountNumber));
  }
  const all = await listClosedCustomerAccounts({ branchId, limit: 100, offset: 0 });
  const accounts = [...all.items];
  let offset = accounts.length;
  while (offset < all.total) {
    const page = await listClosedCustomerAccounts({ branchId, limit: 100, offset });
    accounts.push(...page.items);
    offset += page.items.length;
    if (!page.items.length) break;
  }
  return new Set(accounts.map((record) => record.accountNumber));
};

const beginCustomerAccountClosure = async ({
  branchId,
  customer = {},
  closureDate,
  reason,
  balanceBefore = 0,
  balanceMode = BALANCE_MODE_CANONICAL,
  canonicalBalanceAtClosure = null,
  balanceTreatment = '',
  requestedFinalBalance = null,
  finalClosedCustomerBalance = null,
  closedBy = {}
} = {}) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber || customer.account_number);
  if (!accountNumber) throw createError(400, 'Customer account number is required.');
  const normalizedReason = cleanText(reason, 500) || 'Account closed by Admin.';
  const normalizedClosureDate = cleanText(closureDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedClosureDate)) {
    throw createError(400, 'Choose a valid closure date.');
  }
  const normalizedBalance = normalizeMoney(balanceBefore);
  const normalizedBalanceMode = normalizeBalanceMode(balanceMode);
  const requestedBalanceTreatment = cleanText(balanceTreatment, 40).toLowerCase();
  const explicitRequestedFinalBalance = normalizeOptionalMoney(finalClosedCustomerBalance)
    ?? normalizeOptionalMoney(requestedFinalBalance);
  const normalizedRequestedFinalBalance = explicitRequestedFinalBalance === null
    ? (requestedBalanceTreatment === BALANCE_TREATMENT_WRITE_OFF ? 0 : normalizedBalance)
    : explicitRequestedFinalBalance;
  if (normalizedRequestedFinalBalance < 0) {
    throw createError(400, 'Enter a valid final balance.');
  }
  const normalizedBalanceTreatment = normalizedBalanceMode === BALANCE_MODE_SNAPSHOT
    ? (normalizedRequestedFinalBalance <= 0.005 ? BALANCE_TREATMENT_ZERO : BALANCE_TREATMENT_KEEP)
    : ([BALANCE_TREATMENT_KEEP, BALANCE_TREATMENT_WRITE_OFF].includes(requestedBalanceTreatment)
      ? requestedBalanceTreatment
      : (Math.abs(normalizedBalance) <= 0.005 ? BALANCE_TREATMENT_ZERO : ''));
  if (!normalizedBalanceTreatment) {
    throw createError(400, 'Choose whether to keep or write off the remaining balance.');
  }
  const normalizedCanonicalBalanceAtClosure = normalizeOptionalMoney(canonicalBalanceAtClosure)
    ?? normalizedBalance;

  return mutateStore(branchId, async (records, branchKey) => {
    const existing = records.find((entry) => (
      entry?.active !== false && normalizeAccountNumber(entry?.accountNumber) === accountNumber
    ));
    if (existing) {
      const sanitized = sanitizeRecord(existing);
      if (sanitized?.state === STATE_CLOSED) {
        throw createError(409, 'This customer account is already closed.');
      }
      if (sanitized?.balanceMode !== normalizedBalanceMode) {
        throw createError(409, 'Retry this closure with its original balance tracking mode.');
      }
      if (sanitized?.balanceTreatment !== normalizedBalanceTreatment) {
        throw createError(409, 'Retry this closure with its original balance treatment.');
      }
      if (
        sanitized?.requestedFinalBalance !== null
        && Math.abs(sanitized.requestedFinalBalance - normalizedRequestedFinalBalance) > 0.005
      ) {
        throw createError(409, 'Retry this closure with its original final balance.');
      }
      const retryBalance = normalizeMoney(balanceBefore);
      const originalBalance = normalizeMoney(existing.balanceBefore);
      existing.closureDate = normalizedClosureDate;
      existing.reason = normalizedReason;
      // Keep the amount captured by the first attempt. A write-off may already
      // have reduced the live balance to zero before a later closure stage
      // failed, and retrying must not erase that original audit snapshot.
      existing.balanceBefore = Math.abs(originalBalance) > 0.005
        ? originalBalance
        : retryBalance;
      existing.balanceMode = sanitized.balanceMode;
      existing.canonicalBalanceAtClosure = normalizeOptionalMoney(existing.canonicalBalanceAtClosure)
        ?? normalizedCanonicalBalanceAtClosure;
      existing.finalClosedCustomerBalance = resolveFinalClosedCustomerBalance(sanitized);
      existing.finalBalance = sanitized.balanceMode === BALANCE_MODE_SNAPSHOT
        ? resolveClosedCustomerBalance(existing, retryBalance)
        : retryBalance;
      existing.requestedFinalBalance = sanitized?.requestedFinalBalance ?? normalizedRequestedFinalBalance;
      existing.balanceTreatment = normalizedBalanceTreatment;
      existing.state = STATE_CLOSING;
      existing.warning = '';
      existing.updatedAt = new Date().toISOString();
      appendAudit(existing, 'closure-retried', closedBy, normalizedReason);
      return sanitizeRecord(existing);
    }

    const now = new Date().toISOString();
    const record = {
      id: `closed-customer-${crypto.randomUUID()}`,
      branchId: branchKey,
      accountNumber,
      customerName: cleanText(
        customer.name
        || [customer.firstName, customer.lastName].map((value) => cleanText(value)).filter(Boolean).join(' ')
        || `Account ${accountNumber}`,
        240
      ),
      contactNumber: cleanText(customer.mobileRaw || customer.contactNumber || customer.mobile, 80),
      planName: cleanText(customer.planName, 160),
      areaName: cleanText(customer.area, 180),
      closureDate: normalizedClosureDate,
      reason: normalizedReason,
      state: STATE_CLOSING,
      active: true,
      balanceBefore: normalizedBalance,
      balanceMode: normalizedBalanceMode,
      canonicalBalanceAtClosure: normalizedCanonicalBalanceAtClosure,
      finalClosedCustomerBalance: normalizedRequestedFinalBalance,
      balanceTreatment: normalizedBalanceTreatment,
      writeOffAmount: 0,
      requestedFinalBalance: normalizedRequestedFinalBalance,
      balanceAdjustmentAmount: 0,
      balanceAdjustmentDirection: null,
      finalBalance: normalizedBalance,
      closedAt: null,
      closedBy: normalizeActor(closedBy),
      reopenedAt: null,
      reopenedBy: null,
      reopenReason: '',
      warning: '',
      createdAt: now,
      updatedAt: now,
      auditHistory: []
    };
    appendAudit(record, 'closure-started', closedBy, normalizedReason);
    records.unshift(record);
    return sanitizeRecord(record);
  });
};

const completeCustomerAccountClosure = async (closureId, {
  branchId,
  balanceTreatment = '',
  balanceMode = '',
  canonicalBalanceAtClosure = null,
  writeOffAmount = 0,
  requestedFinalBalance = null,
  finalClosedCustomerBalance = null,
  balanceAdjustmentAmount = 0,
  balanceAdjustmentDirection = null,
  finalBalance = 0,
  warning = '',
  actor = {}
} = {}) => mutateStore(branchId, async (records) => {
  const id = cleanText(closureId, 96);
  const record = records.find((entry) => cleanText(entry?.id, 96) === id && entry?.active !== false);
  if (!record) throw createError(404, 'Closed-account record not found.');
  const now = new Date().toISOString();
  record.state = STATE_CLOSED;
  record.balanceMode = balanceMode ? normalizeBalanceMode(balanceMode) : normalizeBalanceMode(record.balanceMode);
  record.canonicalBalanceAtClosure = normalizeOptionalMoney(canonicalBalanceAtClosure)
    ?? normalizeOptionalMoney(record.canonicalBalanceAtClosure)
    ?? normalizeMoney(record.balanceBefore);
  record.finalClosedCustomerBalance = normalizeOptionalMoney(finalClosedCustomerBalance)
    ?? normalizeOptionalMoney(requestedFinalBalance)
    ?? resolveFinalClosedCustomerBalance(record);
  record.balanceTreatment = record.balanceMode === BALANCE_MODE_SNAPSHOT
    ? (record.finalClosedCustomerBalance <= 0.005 ? BALANCE_TREATMENT_ZERO : BALANCE_TREATMENT_KEEP)
    : normalizeBalanceTreatment(balanceTreatment || record.balanceTreatment, {
      balanceBefore: record.balanceBefore,
      writeOffAmount
    });
  record.writeOffAmount = record.balanceMode === BALANCE_MODE_SNAPSHOT ? 0 : normalizeMoney(writeOffAmount);
  record.requestedFinalBalance = record.finalClosedCustomerBalance;
  record.balanceAdjustmentAmount = record.balanceMode === BALANCE_MODE_SNAPSHOT
    ? 0
    : normalizeMoney(balanceAdjustmentAmount);
  record.balanceAdjustmentDirection = record.balanceMode === BALANCE_MODE_SNAPSHOT
    ? null
    : normalizeAdjustmentDirection(balanceAdjustmentDirection);
  record.finalBalance = normalizeMoney(finalBalance);
  record.warning = cleanText(warning, 1000);
  record.closedAt = record.closedAt || now;
  record.updatedAt = now;
  appendAudit(record, 'account-closed', actor, record.reason);
  return sanitizeRecord(record);
});

const failCustomerAccountClosure = async (closureId, {
  branchId,
  warning = '',
  actor = {}
} = {}) => mutateStore(branchId, async (records) => {
  const id = cleanText(closureId, 96);
  const record = records.find((entry) => cleanText(entry?.id, 96) === id && entry?.active !== false);
  if (!record) return null;
  record.state = STATE_FAILED;
  record.warning = cleanText(warning, 1000) || 'Closure did not finish. Retry or reopen this account.';
  record.updatedAt = new Date().toISOString();
  appendAudit(record, 'closure-failed', actor, record.warning);
  return sanitizeRecord(record);
});

const reopenClosedCustomerAccount = async (closureId, {
  branchId,
  reason,
  balanceAction = REOPEN_ACTION_COLLECT_FIRST,
  reopenedBy = {}
} = {}) => {
  const normalizedReason = cleanText(reason, 500);
  if (normalizedReason.length < 3) throw createError(400, 'Enter a reason for reopening this account.');
  const normalizedBalanceAction = normalizeReopenAction(balanceAction);
  return mutateStore(branchId, async (records) => {
    const id = cleanText(closureId, 96);
    const record = records.find((entry) => cleanText(entry?.id, 96) === id && entry?.active !== false);
    if (!record) throw createError(404, 'Closed-account record not found.');
    const now = new Date().toISOString();
    record.active = false;
    record.reopenedAt = now;
    record.reopenedBy = normalizeActor(reopenedBy);
    record.reopenReason = normalizedReason;
    record.reopenBalanceAction = normalizedBalanceAction;
    record.updatedAt = now;
    appendAudit(record, 'account-reopened', reopenedBy, normalizedReason);
    return sanitizeRecord(record);
  });
};

module.exports = {
  STORE_KEY,
  STATE_CLOSING,
  STATE_CLOSED,
  STATE_FAILED,
  BALANCE_TREATMENT_ZERO,
  BALANCE_TREATMENT_KEEP,
  BALANCE_TREATMENT_WRITE_OFF,
  BALANCE_MODE_CANONICAL,
  BALANCE_MODE_SNAPSHOT,
  REOPEN_ACTION_COLLECT_FIRST,
  REOPEN_ACTION_KEEP,
  REOPEN_ACTION_WRITE_OFF,
  listClosedCustomerAccounts,
  getActiveClosedCustomerAccount,
  getClosedCustomerAccountById,
  getActiveClosedAccountNumberSet,
  resolveFinalClosedCustomerBalance,
  resolveClosedCustomerBalance,
  beginCustomerAccountClosure,
  completeCustomerAccountClosure,
  failCustomerAccountClosure,
  reopenClosedCustomerAccount
};
