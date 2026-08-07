const { readJson, writeJson } = require('../../../../core/data/data-store');

const STORE_KEY = 'referral_registry';
const STORE_VERSION = 1;
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'cancelled']);
const APPLICATION_STATUSES = new Set(['applied', 'reversed']);

let mutationQueue = Promise.resolve();

const normalizeText = (value, maxLength = 240) => String(value || '').trim().slice(0, maxLength);
const normalizeAccountNumber = (value) => normalizeText(value, 160);
const normalizeMoney = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
};
const normalizeMonthKey = (value) => {
  const match = normalizeText(value, 32).match(/^(\d{4})-(\d{2})/);
  if (!match) return '';
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : '';
};
const normalizeActor = (actor = null) => {
  if (!actor || typeof actor !== 'object') return null;
  return {
    id: actor.id || null,
    username: normalizeText(actor.username, 160),
    name: normalizeText(actor.name || actor.username, 160)
  };
};
const sanitizeAuditEntry = (entry = {}) => {
  if (!entry || typeof entry !== 'object') return null;
  const action = normalizeText(entry.action, 80).toLowerCase();
  const at = normalizeText(entry.at || entry.createdAt || entry.updatedAt, 80);
  if (!action || !at) return null;
  return {
    id: normalizeText(entry.id, 160) || `${action}-${at}`,
    action,
    reason: normalizeText(entry.reason, 500),
    at,
    by: normalizeActor(entry.by || entry.actor)
  };
};
const sanitizeApplication = (application = {}) => {
  if (!application || typeof application !== 'object') return null;
  const id = normalizeText(application.id || application.applicationId, 160);
  const billingMonth = normalizeMonthKey(application.billingMonth || application.monthKey);
  const statusValue = normalizeText(application.status, 40).toLowerCase();
  const status = APPLICATION_STATUSES.has(statusValue) ? statusValue : 'applied';
  if (!id || !billingMonth) return null;
  const result = {
    id,
    billingMonth,
    referrerAccountNumber: normalizeAccountNumber(application.referrerAccountNumber),
    amount: normalizeMoney(application.amount),
    status,
    automatic: application.automatic === true,
    appliedAt: normalizeText(application.appliedAt, 80),
    appliedBy: normalizeActor(application.appliedBy),
    applyReason: normalizeText(application.applyReason, 500)
  };
  if (status === 'reversed') {
    result.reversedAt = normalizeText(application.reversedAt, 80);
    result.reversedBy = normalizeActor(application.reversedBy);
    result.reverseReason = normalizeText(application.reverseReason, 500);
  }
  return result;
};
const sanitizeReferralRecord = (record = {}) => {
  if (!record || typeof record !== 'object') return null;
  const id = normalizeText(record.id, 200);
  const referredAccountNumber = normalizeAccountNumber(record.referredAccountNumber);
  const sourceTypeValue = normalizeText(record.sourceType, 40).toLowerCase();
  const sourceType = sourceTypeValue === 'customer' || sourceTypeValue === 'agent'
    ? sourceTypeValue
    : 'external';
  if (!id || !referredAccountNumber) return null;
  const approvalValue = normalizeText(record.approvalStatus, 40).toLowerCase();
  return {
    id,
    sourceType,
    referrerAccountNumber: sourceType === 'customer'
      ? normalizeAccountNumber(record.referrerAccountNumber)
      : '',
    referrerId: sourceType === 'agent' ? normalizeText(record.referrerId, 160) : '',
    referrerName: normalizeText(record.referrerName, 240),
    referredAccountNumber,
    approvalStatus: APPROVAL_STATUSES.has(approvalValue) ? approvalValue : 'pending',
    approvalReason: normalizeText(record.approvalReason, 500),
    approvedDiscountAmount: normalizeMoney(record.approvedDiscountAmount),
    approvedAt: normalizeText(record.approvedAt, 80),
    approvedBy: normalizeActor(record.approvedBy),
    applyFromMonth: normalizeMonthKey(record.applyFromMonth),
    createdAt: normalizeText(record.createdAt, 80),
    createdBy: normalizeActor(record.createdBy),
    updatedAt: normalizeText(record.updatedAt, 80),
    updatedBy: normalizeActor(record.updatedBy),
    applications: (Array.isArray(record.applications) ? record.applications : [])
      .map(sanitizeApplication)
      .filter(Boolean),
    audit: (Array.isArray(record.audit) ? record.audit : [])
      .map(sanitizeAuditEntry)
      .filter(Boolean)
      .slice(-100)
  };
};
const sanitizeStore = (value = {}) => {
  const branches = value?.branches && typeof value.branches === 'object' && !Array.isArray(value.branches)
    ? value.branches
    : {};
  return {
    version: STORE_VERSION,
    branches: Object.entries(branches).reduce((result, [branchKey, bucket]) => {
      const records = (Array.isArray(bucket?.records) ? bucket.records : [])
        .map(sanitizeReferralRecord)
        .filter(Boolean);
      result[String(branchKey)] = {
        records,
        updatedAt: normalizeText(bucket?.updatedAt, 80) || null
      };
      return result;
    }, {})
  };
};
const branchStoreKey = (branchId = null) => String(branchId || 'global');

const readReferralRegistryStore = async () => sanitizeStore(await readJson(STORE_KEY, {
  version: STORE_VERSION,
  branches: {}
}));

const readReferralRegistry = async (branchId = null) => {
  const store = await readReferralRegistryStore();
  return store.branches[branchStoreKey(branchId)]?.records || [];
};

const mutateReferralRegistry = async (branchId, mutator) => {
  const operation = mutationQueue.catch(() => {}).then(async () => {
    const store = await readReferralRegistryStore();
    const key = branchStoreKey(branchId);
    const currentRecords = (store.branches[key]?.records || []).map((record) => ({
      ...record,
      applications: record.applications.map((application) => ({ ...application })),
      audit: record.audit.map((entry) => ({ ...entry }))
    }));
    const mutation = await mutator(currentRecords);
    if (mutation?.changed === false) return mutation?.result;
    const nextRecords = Array.isArray(mutation?.records) ? mutation.records : currentRecords;
    store.branches[key] = {
      records: nextRecords.map(sanitizeReferralRecord).filter(Boolean),
      updatedAt: new Date().toISOString()
    };
    await writeJson(STORE_KEY, sanitizeStore(store));
    return mutation?.result;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

module.exports = {
  STORE_KEY,
  mutateReferralRegistry,
  normalizeActor,
  normalizeMonthKey,
  readReferralRegistry,
  sanitizeReferralRecord
};
