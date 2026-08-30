const { readJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const {
  isEffectivePaymentEntryStatus,
  normalizePaymentEntry
} = require('./payment-entry-normalizer');

const PENDING_GCASH_STATUSES = new Set([
  'pending_gcash_verification',
  'pending_approval'
]);

const normalizeManualPaymentReferenceKey = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[\s-]+/g, '');

const normalizeNumericPaymentReferenceKey = (value) => {
  const key = normalizeManualPaymentReferenceKey(value);
  if (!/^\d+$/.test(key)) return '';
  return key.replace(/^0+(?=\d)/, '');
};

const paymentReferencesMatch = (left, right) => {
  const leftKey = normalizeManualPaymentReferenceKey(left);
  const rightKey = normalizeManualPaymentReferenceKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftNumericKey = normalizeNumericPaymentReferenceKey(leftKey);
  const rightNumericKey = normalizeNumericPaymentReferenceKey(rightKey);
  return Boolean(leftNumericKey && rightNumericKey && leftNumericKey === rightNumericKey);
};

const normalizePaymentStatus = (entry = {}) => String(
  entry?.status || entry?.paymentStatus || entry?.payment_status || ''
).trim().toLowerCase().replace(/[\s-]+/g, '_');

const isPositivePaymentCredit = (entry = {}) => {
  const amount = Number(entry?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const kind = String(entry?.kind || entry?.type || '').trim().toLowerCase();
  const direction = String(entry?.direction || '').trim().toLowerCase();
  return (kind === 'payment' || !kind)
    && (direction === 'credit' || kind === 'payment');
};

const paymentDateOnly = (entry = {}) => String(
  entry?.date || entry?.recordedAt || entry?.recorded_at || ''
).slice(0, 10);

const officialTransactionDateOnly = (transaction = {}) => String(
  transaction?.transactionDate || transaction?.transactionAt || ''
).slice(0, 10);

const resolveMislabeledOfficialCredit = (entry, officialTransactions = []) => {
  const entryReferences = [entry?.reference, entry?.orNumber, entry?.or_number]
    .map((value) => normalizeManualPaymentReferenceKey(value))
    .filter(Boolean);
  if (!entryReferences.length) return null;
  const candidates = (Array.isArray(officialTransactions) ? officialTransactions : [])
    .filter((transaction) => Number(transaction?.credit) > 0);
  const exactMatches = candidates.filter((transaction) => (
    entryReferences.includes(normalizeManualPaymentReferenceKey(transaction?.reference))
  ));
  let referenceMatches = exactMatches;
  if (!referenceMatches.length) {
    const entryNumericKeys = new Set(entryReferences.map(normalizeNumericPaymentReferenceKey).filter(Boolean));
    if (!entryNumericKeys.size) return null;
    const numericMatches = candidates.filter((transaction) => (
      entryNumericKeys.has(normalizeNumericPaymentReferenceKey(transaction?.reference))
    ));
    const distinctOfficialReferences = new Set(
      numericMatches.map((transaction) => normalizeManualPaymentReferenceKey(transaction?.reference)).filter(Boolean)
    );
    if (distinctOfficialReferences.size !== 1) return null;
    referenceMatches = numericMatches;
  }
  const entryAmount = Number(Number(entry?.amount || 0).toFixed(2));
  const entryDate = paymentDateOnly(entry);
  return referenceMatches.find((transaction) => (
    Number(Number(transaction?.credit || 0).toFixed(2)) === entryAmount
    && officialTransactionDateOnly(transaction) === entryDate
  )) || null;
};

const loadMainPaymentRecords = async (branchId) => {
  if (await isRelationalReady()) {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) return {};
    const [rows] = await query(
      `SELECT
         id,
         branch_id AS branchId,
         account_number AS accountNumber,
         amount,
         date,
         kind,
         direction,
         reference,
         or_number AS orNumber,
         type,
         recorded_at AS recordedAt,
         status,
         payment_method AS paymentMethod
       FROM payment_entries
       WHERE branch_id = ?`,
      [safeBranchId]
    );
    const grouped = {};
    (rows || []).forEach((row) => {
      const accountNumber = String(row?.accountNumber || '').trim();
      if (!accountNumber) return;
      if (!grouped[accountNumber]) grouped[accountNumber] = { history: [] };
      grouped[accountNumber].history.push(row);
    });
    return grouped;
  }
  return readJson('payments', {});
};

const customerDisplayName = (customer = {}) => [
  customer?.firstName || customer?.first_name,
  customer?.middleName || customer?.middle_name,
  customer?.lastName || customer?.last_name
].map((value) => String(value || '').trim()).filter(Boolean).join(' ');

const loadMainCustomerNames = async (branchId) => {
  if (await isRelationalReady()) {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) return new Map();
    const [rows] = await query(
      `SELECT
         account_number AS accountNumber,
         first_name AS firstName,
         last_name AS lastName
       FROM customers
       WHERE branch_id = ?`,
      [safeBranchId]
    );
    return new Map((rows || []).map((customer) => [
      String(customer?.accountNumber || '').trim(),
      customerDisplayName(customer)
    ]));
  }
  const safeBranchId = Number(branchId);
  const customers = await readJson('customers', []);
  return new Map((Array.isArray(customers) ? customers : [])
    .filter((customer) => (
      !Number.isInteger(safeBranchId)
      || safeBranchId <= 0
      || !customer?.branchId
      || Number(customer.branchId) === safeBranchId
    ))
    .map((customer) => [
      String(customer?.accountNumber || '').trim(),
      customerDisplayName(customer)
    ]));
};

const findMainGcashPaymentsByReference = async ({
  branchId,
  reference,
  references = [],
  payments = null,
  customers = null,
  includePending = false,
  includeCustomerNames = false,
  includeAnyPaymentMethod = false,
  officialTransactions = []
} = {}) => {
  const requestedKeys = new Set(
    [reference, ...(Array.isArray(references) ? references : [])]
      .map((value) => normalizeNumericPaymentReferenceKey(value) || normalizeManualPaymentReferenceKey(value))
      .filter(Boolean)
  );
  if (!requestedKeys.size) return [];
  const paymentRecords = payments && typeof payments === 'object'
    ? payments
    : await loadMainPaymentRecords(branchId);
  const customerNames = includeCustomerNames
    ? (customers instanceof Map
      ? customers
      : (Array.isArray(customers)
        ? new Map(customers.map((customer) => [
          String(customer?.accountNumber || '').trim(),
          customerDisplayName(customer)
        ]))
        : await loadMainCustomerNames(branchId)))
    : new Map();
  const matches = [];
  Object.entries(paymentRecords || {}).forEach(([accountNumber, record]) => {
    (Array.isArray(record?.history) ? record.history : []).forEach((rawEntry) => {
      const entry = normalizePaymentEntry(rawEntry || {});
      const paymentMethod = String(entry?.paymentMethod || entry?.payment_method || '').trim().toLowerCase();
      const pendingStatus = PENDING_GCASH_STATUSES.has(normalizePaymentStatus(entry));
      const pending = includePending && pendingStatus;
      const collected = isEffectivePaymentEntryStatus(entry);
      if (!isPositivePaymentCredit(entry) || (!collected && !pending)) return;
      const referenceKey = [entry?.reference, entry?.orNumber, entry?.or_number]
        .map((value) => normalizeNumericPaymentReferenceKey(value) || normalizeManualPaymentReferenceKey(value))
        .find((candidate) => requestedKeys.has(candidate));
      if (!referenceKey) return;
      if (
        !includeAnyPaymentMethod
        && paymentMethod !== 'gcash'
        && !resolveMislabeledOfficialCredit(entry, officialTransactions)
      ) return;
      const resolvedAccountNumber = String(accountNumber || entry?.accountNumber || '').trim();
      matches.push({
        id: String(entry?.id || '').trim(),
        paymentEntryId: String(entry?.id || '').trim(),
        accountNumber: resolvedAccountNumber,
        customerName: customerNames.get(resolvedAccountNumber) || '',
        amount: Number(Number(entry?.amount || 0).toFixed(2)),
        date: String(entry?.date || entry?.recordedAt || '').slice(0, 10),
        reference: String(entry?.reference || entry?.orNumber || entry?.or_number || '').trim(),
        referenceKey,
        paymentMethod,
        pending
      });
    });
  });
  return matches;
};

module.exports = {
  findMainGcashPaymentsByReference,
  normalizeManualPaymentReferenceKey,
  normalizeNumericPaymentReferenceKey,
  paymentReferencesMatch
};
