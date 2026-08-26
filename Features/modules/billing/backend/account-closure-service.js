const crypto = require('crypto');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { withTransaction } = require('./payment-numbering');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');

const PAYMENTS_STORE_KEY = 'payments';
const BALANCE_EPSILON = 0.005;
let jsonMutationQueue = Promise.resolve();

const cleanText = (value, maxLength = 0) => {
  const normalized = String(value == null ? '' : value).trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
};

const normalizeMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};

const toMysqlDateTime = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = cleanText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const buildClosureEntryId = (closureId) => {
  const digest = crypto.createHash('sha256').update(cleanText(closureId)).digest('hex').slice(0, 40);
  return `closure-writeoff-${digest}`;
};

const buildClosureReference = (closureId) => {
  const digest = crypto.createHash('sha1').update(cleanText(closureId)).digest('hex').slice(0, 16).toUpperCase();
  return `CLOSE-${digest}`;
};

const actorFromUser = (actor = {}) => ({
  id: cleanText(actor.id, 120),
  username: cleanText(actor.username, 160) || null,
  name: cleanText(actor.name || actor.username, 200) || null,
  role: cleanText(actor.role, 80) || null
});

const getCanonicalAccountClosureBalance = async (accountNumber, branchId) => {
  // Loaded lazily because payment-records imports Customer Management during
  // module composition. At request time both modules are fully initialized.
  const paymentRecords = require('./payment-records');
  const record = await paymentRecords.buildPaymentRecordForAccount(accountNumber, branchId);
  if (!record) throw createError(404, 'Customer payment record not found.');
  const balance = Number(record?.billingSummary?.endingBalance);
  if (!Number.isFinite(balance)) {
    throw createError(409, 'The canonical customer balance is unavailable. Reload billing data before closing this account.');
  }
  return {
    record,
    balance: normalizeMoney(balance)
  };
};

const findExistingJsonEntry = (payments, entryId) => Object.values(payments || {})
  .flatMap((record) => Array.isArray(record?.history) ? record.history : [])
  .find((entry) => cleanText(entry?.id, 96) === entryId) || null;

const findExistingRelationalEntry = async (connection, branchId, entryId) => {
  const [rows] = await connection.query(
    `SELECT
       id,
       account_number AS accountNumber,
       amount,
       date,
       kind,
       direction,
       reference,
       description,
       recorded_at AS recordedAt
     FROM payment_entries
     WHERE branch_id = ?
       AND id = ?
     LIMIT 1
     FOR UPDATE`,
    [branchId, entryId]
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const insertRelationalClosureEntry = async (connection, entry, branchId, accountNumber) => {
  const recordedBy = entry.recordedBy || {};
  await connection.query(
    `INSERT INTO payment_entries (
       id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
       recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
       payer, status, payment_method, fingerprint, xendit_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      branchId,
      accountNumber,
      entry.amount,
      entry.date,
      entry.kind,
      entry.direction,
      entry.reference,
      null,
      entry.description,
      entry.type,
      toMysqlDateTime(entry.recordedAt),
      recordedBy.id || null,
      recordedBy.username || null,
      recordedBy.name || null,
      recordedBy.role || null,
      entry.payer || null,
      entry.status,
      entry.paymentMethod,
      entry.fingerprint,
      null
    ]
  );
};

const recordAccountClosureWriteOff = async ({
  branchId,
  accountNumber,
  closureId,
  closureDate,
  reason,
  actor = {},
  confirmed = false
} = {}) => {
  const safeBranchId = Number(branchId);
  const safeAccountNumber = cleanText(accountNumber, 120);
  const safeClosureId = cleanText(closureId, 96);
  const safeReason = cleanText(reason, 500);
  const safeClosureDate = cleanText(closureDate, 10);
  if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch ID is required.');
  if (!safeAccountNumber) throw createError(400, 'Customer account number is required.');
  if (!safeClosureId) throw createError(400, 'Closure audit ID is required.');
  if (safeReason.length < 3) throw createError(400, 'Enter a reason for the account closure adjustment.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeClosureDate)) throw createError(400, 'Choose a valid closure date.');

  const entryId = buildClosureEntryId(safeClosureId);
  const reference = buildClosureReference(safeClosureId);
  const relational = await isRelationalReady();

  if (relational) {
    const result = await withTransaction(async (connection) => {
      const existing = await findExistingRelationalEntry(connection, safeBranchId, entryId);
      if (existing) {
        return {
          entry: existing,
          amount: normalizeMoney(existing.amount),
          inserted: false,
          idempotent: true
        };
      }

      const { balance } = await getCanonicalAccountClosureBalance(safeAccountNumber, safeBranchId);
      if (balance < -BALANCE_EPSILON) {
        throw createError(409, `This account has an advance balance of ₱${Math.abs(balance).toFixed(2)}. Resolve or refund it before closing the account.`);
      }
      if (balance <= BALANCE_EPSILON) {
        return { entry: null, amount: 0, inserted: false, idempotent: false, balanceBefore: balance };
      }
      if (confirmed !== true) {
        const error = createError(409, `Confirm the audited write-off of ₱${balance.toFixed(2)} before closing this account.`);
        error.code = 'ACCOUNT_CLOSURE_WRITE_OFF_CONFIRMATION_REQUIRED';
        error.balance = balance;
        throw error;
      }

      const recordedAt = new Date().toISOString();
      const entry = {
        id: entryId,
        amount: balance,
        date: safeClosureDate,
        kind: 'discount',
        type: 'discount',
        direction: 'credit',
        reference,
        description: `Account closure write-off - ${safeReason}`.slice(0, 500),
        recordedAt,
        recordedBy: actorFromUser(actor),
        payer: actorFromUser(actor).name || actorFromUser(actor).username || 'Admin',
        status: 'Approved',
        paymentMethod: 'Account Closure Adjustment',
        fingerprint: `${safeAccountNumber}|account-closure|${safeClosureId}`.slice(0, 200)
      };
      await insertRelationalClosureEntry(connection, entry, safeBranchId, safeAccountNumber);
      return { entry, amount: balance, inserted: true, idempotent: false, balanceBefore: balance };
    });
    if (result.inserted) triggerBranchServiceRefresh(safeBranchId, 'account-closure-writeoff');
    return result;
  }

  const operation = jsonMutationQueue
    .catch(() => {})
    .then(async () => {
      const payments = await readJson(PAYMENTS_STORE_KEY, {});
      const normalizedPayments = payments && typeof payments === 'object' && !Array.isArray(payments) ? payments : {};
      const existing = findExistingJsonEntry(normalizedPayments, entryId);
      if (existing) {
        return {
          entry: existing,
          amount: normalizeMoney(existing.amount),
          inserted: false,
          idempotent: true
        };
      }

      const { balance } = await getCanonicalAccountClosureBalance(safeAccountNumber, safeBranchId);
      if (balance < -BALANCE_EPSILON) {
        throw createError(409, `This account has an advance balance of ₱${Math.abs(balance).toFixed(2)}. Resolve or refund it before closing the account.`);
      }
      if (balance <= BALANCE_EPSILON) {
        return { entry: null, amount: 0, inserted: false, idempotent: false, balanceBefore: balance };
      }
      if (confirmed !== true) {
        const error = createError(409, `Confirm the audited write-off of ₱${balance.toFixed(2)} before closing this account.`);
        error.code = 'ACCOUNT_CLOSURE_WRITE_OFF_CONFIRMATION_REQUIRED';
        error.balance = balance;
        throw error;
      }

      const recordedAt = new Date().toISOString();
      const safeActor = actorFromUser(actor);
      const entry = {
        id: entryId,
        amount: balance,
        date: safeClosureDate,
        kind: 'discount',
        type: 'discount',
        direction: 'credit',
        reference,
        description: `Account closure write-off - ${safeReason}`.slice(0, 500),
        recordedAt,
        recordedBy: safeActor,
        payer: safeActor.name || safeActor.username || 'Admin',
        status: 'Approved',
        paymentMethod: 'Account Closure Adjustment',
        fingerprint: `${safeAccountNumber}|account-closure|${safeClosureId}`.slice(0, 200)
      };
      if (!normalizedPayments[safeAccountNumber] || typeof normalizedPayments[safeAccountNumber] !== 'object') {
        normalizedPayments[safeAccountNumber] = { history: [] };
      }
      const history = Array.isArray(normalizedPayments[safeAccountNumber].history)
        ? normalizedPayments[safeAccountNumber].history
        : [];
      normalizedPayments[safeAccountNumber].history = [entry, ...history];
      await writeJson(PAYMENTS_STORE_KEY, normalizedPayments);
      return { entry, amount: balance, inserted: true, idempotent: false, balanceBefore: balance };
    });
  jsonMutationQueue = operation.then(() => undefined, () => undefined);
  const result = await operation;
  if (result.inserted) triggerBranchServiceRefresh(safeBranchId, 'account-closure-writeoff');
  return result;
};

module.exports = {
  BALANCE_EPSILON,
  buildClosureEntryId,
  buildClosureReference,
  toMysqlDateTime,
  getCanonicalAccountClosureBalance,
  recordAccountClosureWriteOff
};
