const { readJson, writeJson } = require('./data-store');

const STORE_KEY = 'disconnection_decisions';
const STATUS_PENDING = 'pending';
const STATUS_KEPT_ACTIVE = 'kept-active';
const STATUS_DISCONNECTED = 'disconnected';
const BILLING_POLICY_STOP = 'stop';
const BILLING_POLICY_CONTINUE = 'continue';

const normalizeAccountNumber = (value) => String(value || '').trim();
const branchStoreKey = (branchId = null) => String(branchId || 'global');

const normalizeDisconnectionStatus = (value, fallback = STATUS_PENDING) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === STATUS_DISCONNECTED || raw === 'disconnect' || raw === 'disconnected') return STATUS_DISCONNECTED;
  if (raw === STATUS_KEPT_ACTIVE || raw === 'kept_active' || raw === 'kept active' || raw === 'active') return STATUS_KEPT_ACTIVE;
  if (raw === STATUS_PENDING || raw === 'needs-decision' || raw === 'needs decision') return STATUS_PENDING;
  return fallback;
};

const normalizeBillingPolicy = (value, fallback = BILLING_POLICY_STOP) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === BILLING_POLICY_CONTINUE || raw === 'continue-billing' || raw === 'continue billing' || raw === 'tuloy') {
    return BILLING_POLICY_CONTINUE;
  }
  if (raw === BILLING_POLICY_STOP || raw === 'stop-billing' || raw === 'stop billing' || raw === 'stop-next' || raw === 'stop_next') {
    return BILLING_POLICY_STOP;
  }
  return fallback;
};

const sanitizeDecisionRecord = (record = {}) => {
  const accountNumber = normalizeAccountNumber(record.accountNumber);
  if (!accountNumber) return null;
  const status = normalizeDisconnectionStatus(record.status);
  const billingPolicy = normalizeBillingPolicy(record.billingPolicy);
  return {
    accountNumber,
    status,
    billingPolicy,
    hitCreditLimitAt: record.hitCreditLimitAt || null,
    decidedAt: record.decidedAt || null,
    disconnectedAt: record.disconnectedAt || null,
    updatedAt: record.updatedAt || record.decidedAt || record.disconnectedAt || null,
    notes: String(record.notes || '').trim(),
    balanceSnapshot: Number.isFinite(Number(record.balanceSnapshot)) ? Number(record.balanceSnapshot) : null,
    creditLimitSnapshot: Number.isFinite(Number(record.creditLimitSnapshot)) ? Number(record.creditLimitSnapshot) : null,
    overAmountSnapshot: Number.isFinite(Number(record.overAmountSnapshot)) ? Number(record.overAmountSnapshot) : null,
    pppoeWarning: String(record.pppoeWarning || '').trim(),
    decidedBy: record.decidedBy && typeof record.decidedBy === 'object'
      ? {
          id: record.decidedBy.id || null,
          username: record.decidedBy.username || null,
          name: record.decidedBy.name || record.decidedBy.username || null
        }
      : null
  };
};

const readDisconnectionStore = async () => {
  const data = await readJson(STORE_KEY, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const writeDisconnectionStore = async (store = {}) => {
  await writeJson(STORE_KEY, store && typeof store === 'object' && !Array.isArray(store) ? store : {});
};

const getBranchDisconnectionBucket = (store = {}, branchId = null) => {
  const bucket = store?.[branchStoreKey(branchId)];
  return bucket && typeof bucket === 'object' && !Array.isArray(bucket) ? bucket : {};
};

const readBranchDisconnections = async (branchId = null) => {
  const store = await readDisconnectionStore();
  const bucket = getBranchDisconnectionBucket(store, branchId);
  return Object.entries(bucket).reduce((acc, [accountNumber, record]) => {
    const sanitized = sanitizeDecisionRecord({ ...record, accountNumber: record?.accountNumber || accountNumber });
    if (sanitized) acc[sanitized.accountNumber] = sanitized;
    return acc;
  }, {});
};

const getAccountDisconnection = (records = {}, accountNumber = '') => {
  const key = normalizeAccountNumber(accountNumber);
  if (!key) return null;
  const record = records?.[key] || null;
  return record ? sanitizeDecisionRecord({ ...record, accountNumber: record.accountNumber || key }) : null;
};

const upsertBranchDisconnection = async (branchId = null, accountNumber = '', patch = {}) => {
  const key = normalizeAccountNumber(accountNumber || patch?.accountNumber);
  if (!key) throw new Error('Account number is required.');
  const store = await readDisconnectionStore();
  const branchKey = branchStoreKey(branchId);
  const bucket = getBranchDisconnectionBucket(store, branchId);
  const current = sanitizeDecisionRecord({ ...(bucket[key] || {}), accountNumber: key }) || { accountNumber: key };
  const next = sanitizeDecisionRecord({
    ...current,
    ...patch,
    accountNumber: key,
    updatedAt: patch.updatedAt || new Date().toISOString()
  });
  bucket[key] = next;
  store[branchKey] = bucket;
  await writeDisconnectionStore(store);
  return next;
};

const shouldStopBillingAfterDisconnection = (record = null) => {
  const sanitized = record ? sanitizeDecisionRecord(record) : null;
  return Boolean(sanitized && sanitized.status === STATUS_DISCONNECTED && sanitized.billingPolicy === BILLING_POLICY_STOP);
};

const shouldContinueBillingAfterDisconnection = (record = null) => {
  const sanitized = record ? sanitizeDecisionRecord(record) : null;
  return Boolean(sanitized && sanitized.status === STATUS_DISCONNECTED && sanitized.billingPolicy === BILLING_POLICY_CONTINUE);
};

module.exports = {
  STATUS_PENDING,
  STATUS_KEPT_ACTIVE,
  STATUS_DISCONNECTED,
  BILLING_POLICY_STOP,
  BILLING_POLICY_CONTINUE,
  normalizeDisconnectionStatus,
  normalizeBillingPolicy,
  sanitizeDecisionRecord,
  readDisconnectionStore,
  writeDisconnectionStore,
  readBranchDisconnections,
  getAccountDisconnection,
  upsertBranchDisconnection,
  shouldStopBillingAfterDisconnection,
  shouldContinueBillingAfterDisconnection
};
