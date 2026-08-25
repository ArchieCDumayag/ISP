const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { loadAccounts } = require('../../admin/backend/accounts-store');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { assignEntryNumbers, assertEntryNumbersAvailable, withTransaction } = require('../../billing/backend/payment-numbering');
const { triggerBranchServiceRefresh } = require('../../billing/backend/payment-service-refresh');
const {
  listGcashTransactionHistory,
  claimGcashTransaction,
  finalizeGcashTransactionAssignment,
  releaseGcashTransactionClaim,
  normalizeReference: normalizeOfficialGcashReference
} = require('../../billing/backend/gcash-transaction-history-store');
const { resolveCollectorNextDue } = require('./collector-next-due');
const { accountHasRole } = require('../../../../core/security/role-utils');
const paymentRecordsRouter = require('../../billing/backend/payment-records');
const collectorReschedulesRouter = require('./collector-reschedules');
const collectorPrioritiesRouter = require('./collector-priorities');
const { getActiveCollectorExclusionAccountSet } = require('./collector-client-exclusions');
const {
  notifyCollectorMutation,
  resolveCollectorPaymentMutationTopics
} = require('./collector-live-updates');

const router = express.Router();
router.use(notifyCollectorMutation(resolveCollectorPaymentMutationTopics));
router.use('/reschedules', collectorReschedulesRouter);
router.use('/priorities', collectorPrioritiesRouter);
const REFERENCE_MAX_LENGTH = 32;
const PAYMENT_METHOD_MAX_LENGTH = 40;
const MANILA_OFFSET_SUFFIX = '+08:00';
const BARE_DATETIME_VALUE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?$/;
const TIMEZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const EXPLICIT_TIME_RE = /(?:T|\s)\d{2}:\d{2}(?::\d{2})?/;
const COLLECTOR_PAYMENT_OPTIONS_KEY = 'collector_payment_options';
const DEFAULT_TYPE_OF_PAYMENT_OPTIONS = ['credit', 'debit', 'discount', 'rebate'];
const DEFAULT_PAYMENT_METHOD_OPTIONS = ['Cash', 'GCash'];
const MONTHLY_BILL_LABEL_PREFIX = 'Monthly Bill for ';
const MONTH_YEAR_PATTERN = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i;
const COLLECTOR_PAYMENT_PENDING_STATUS = 'pending_approval';
const COLLECTOR_PAYMENT_APPROVED_STATUS = 'approved';
const COLLECTOR_PAYMENT_REJECTED_STATUS = 'rejected';
const COLLECTOR_PAYMENT_DECISION_REASON_MAX_LENGTH = 500;
const COLLECTOR_CLIENT_PAYMENT_ID_MAX_LENGTH = 96;
const COLLECTOR_PAYMENT_REVIEW_TABLE = 'collector_payment_reviews';

const COLLECTOR_PAYMENT_REVIEW_DDL = `
CREATE TABLE IF NOT EXISTS collector_payment_reviews (
  payment_entry_id VARCHAR(64) NOT NULL PRIMARY KEY,
  branch_id VARCHAR(64) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  decision_status VARCHAR(30) NOT NULL,
  decision_reason VARCHAR(500) NULL,
  reviewed_at DATETIME NOT NULL,
  reviewed_by_user_id VARCHAR(32) NULL,
  reviewed_by_username VARCHAR(100) NULL,
  reviewed_by_name VARCHAR(100) NULL,
  reviewed_by_role VARCHAR(30) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_collector_payment_reviews_branch_status (branch_id, decision_status),
  KEY idx_collector_payment_reviews_account (account_number)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

let collectorPaymentReviewTableReady = false;

const STORE_KEYS = {
  payments: 'payments',
  customers: 'customers',
  collectors: 'collectors',
  remittances: 'collector_remittances'
};

function sanitizeCollectorClientPaymentId(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.length > COLLECTOR_CLIENT_PAYMENT_ID_MAX_LENGTH) {
    throw createError(400, `Client payment ID must be at most ${COLLECTOR_CLIENT_PAYMENT_ID_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

function sanitizeCollectorPaymentDecisionReason(value, required = false) {
  const trimmed = String(value || '').trim();
  if (trimmed.length > COLLECTOR_PAYMENT_DECISION_REASON_MAX_LENGTH) {
    throw createError(400, `Decision reason must be at most ${COLLECTOR_PAYMENT_DECISION_REASON_MAX_LENGTH} characters.`);
  }
  if (required && !trimmed) {
    throw createError(400, 'Rejection reason is required.');
  }
  return trimmed;
}

function buildCollectorPaymentEntryId(prefix, branchId, collectorId, accountNumber, clientPaymentId = '') {
  if (clientPaymentId) {
    const digest = crypto.createHash('sha256')
      .update([branchId, collectorId, accountNumber, clientPaymentId].map((value) => String(value || '').trim()).join('|'))
      .digest('hex')
      .slice(0, 40);
    return `${prefix}-${digest}`;
  }
  const safeAccount = String(accountNumber || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'account';
  return `${prefix}-${safeAccount}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 64);
}

function buildCollectorPaymentFingerprint(accountNumber, reference, kind, amount) {
  return [
    String(accountNumber || '').trim().toLowerCase(),
    String(reference || '').trim().toLowerCase(),
    normalizeKind(kind),
    Math.abs(Number(amount) || 0).toFixed(2)
  ].join('|');
}

const remittanceText = (value) => String(value || '').trim();

function normalizeRemittancePayment(row = {}) {
  const paymentEntryId = remittanceText(row.paymentEntryId || row.entryId || row.id);
  const accountNumber = remittanceText(row.accountNumber || row.account);
  const reference = remittanceText(row.reference || row.ref || row.orNumber);
  const amount = Number(row.amount || 0);
  return {
    paymentEntryId,
    accountNumber,
    reference,
    amount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0,
    customerName: remittanceText(row.customerName || row.customer || row.payer),
    paymentMethod: remittanceText(row.paymentMethod || row.method),
    collectionDate: toPaymentDateOnly(row.collectionDate || row.date || row.recordedAt || row.submittedAt),
    recordedAt: row.recordedAt || row.submittedAt || null,
    status: normalizeCollectorPaymentStatus(row.status || row.approvalStatus)
  };
}

function remittancePaymentKey(row = {}) {
  const payment = normalizeRemittancePayment(row);
  return remittanceText(payment.paymentEntryId || payment.reference
    || `${payment.accountNumber}|${payment.collectionDate}|${payment.amount.toFixed(2)}`);
}

function remittanceBatchDate(payment = {}) {
  return toPaymentDateOnly(payment.collectionDate || payment.date || payment.recordedAt || payment.submittedAt)
    || new Date().toISOString().slice(0, 10);
}

function remittanceStatus(value) {
  return remittanceText(value || 'pending').toLowerCase();
}

function remittancePaymentSummary(payments = []) {
  const summary = {
    count: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    pendingAmount: 0,
    approvedAmount: 0,
    rejectedAmount: 0,
    totalAmount: 0
  };
  for (const payment of Array.isArray(payments) ? payments : []) {
    const amount = Math.max(Number(payment?.amount || 0), 0);
    const status = normalizeCollectorPaymentStatus(payment?.status);
    summary.count += 1;
    summary.totalAmount += amount;
    if (status === COLLECTOR_PAYMENT_APPROVED_STATUS) {
      summary.approved += 1;
      summary.approvedAmount += amount;
    } else if (status === COLLECTOR_PAYMENT_REJECTED_STATUS) {
      summary.rejected += 1;
      summary.rejectedAmount += amount;
    } else {
      summary.pending += 1;
      summary.pendingAmount += amount;
    }
  }
  Object.keys(summary).forEach((key) => {
    if (key.toLowerCase().includes('amount')) summary[key] = Number(summary[key].toFixed(2));
  });
  return summary;
}

function findCanonicalRemittancePayment(entries = [], payment = {}) {
  const target = normalizeRemittancePayment(payment);
  return (Array.isArray(entries) ? entries : []).find((entry) => {
    const entryId = remittanceText(entry?.id || entry?.paymentEntryId);
    if (target.paymentEntryId && entryId === target.paymentEntryId) return true;
    const entryReference = remittanceText(entry?.reference || entry?.orNumber);
    if (target.reference && entryReference && entryReference.toLowerCase() === target.reference.toLowerCase()) {
      return !target.accountNumber
        || remittanceText(entry?.accountNumber).toLowerCase() === target.accountNumber.toLowerCase();
    }
    return false;
  }) || null;
}

async function loadCanonicalRemittancePayments(record = {}) {
  const submittedPayments = (Array.isArray(record?.payments) ? record.payments : [])
    .map(normalizeRemittancePayment);
  const paymentIds = [...new Set(submittedPayments.map((item) => item.paymentEntryId).filter(Boolean))];
  let canonicalEntries = [];

  if (await isRelationalReady()) {
    const branchId = record?.branchId || null;
    if (branchId && paymentIds.length) {
      const placeholders = paymentIds.map(() => '?').join(', ');
      const [rows] = await query(
        `SELECT
           id,
           account_number AS accountNumber,
           amount,
           date,
           kind,
           direction,
           reference,
           or_number AS orNumber,
           recorded_at AS recordedAt,
           recorded_by_user_id AS recordedByUserId,
           recorded_by_username AS recordedByUsername,
           recorded_by_name AS recordedByName,
           recorded_by_role AS recordedByRole,
           payer,
           status,
           payment_method AS paymentMethod
         FROM payment_entries
         WHERE branch_id = ?
           AND id IN (${placeholders})`,
        [branchId, ...paymentIds]
      );
      canonicalEntries = (rows || []).map(mapReceiptPaymentRow);
    }
  } else {
    const paymentsStore = await readJson(STORE_KEYS.payments, {});
    Object.entries(paymentsStore || {}).forEach(([accountNumber, bucket]) => {
      (Array.isArray(bucket?.history) ? bucket.history : []).forEach((entry) => {
        canonicalEntries.push({ ...entry, accountNumber: entry?.accountNumber || accountNumber });
      });
    });
  }

  return submittedPayments.map((payment) => {
    const canonical = findCanonicalRemittancePayment(canonicalEntries, payment);
    return {
      ...payment,
      canonicalFound: Boolean(canonical),
      accountNumber: payment.accountNumber || remittanceText(canonical?.accountNumber),
      reference: payment.reference || remittanceText(canonical?.reference || canonical?.orNumber),
      amount: canonical
        ? Math.max(Number(canonical?.amount || 0), 0)
        : payment.amount,
      customerName: payment.customerName || remittanceText(canonical?.customerName || canonical?.payer),
      paymentMethod: payment.paymentMethod || remittanceText(canonical?.paymentMethod),
      collectionDate: payment.collectionDate || remittanceBatchDate(canonical || payment),
      recordedAt: payment.recordedAt || canonical?.recordedAt || null,
      status: normalizeCollectorPaymentStatus(
        canonical ? canonical.status : (payment.status || COLLECTOR_PAYMENT_PENDING_STATUS)
      )
    };
  });
}

async function hydrateRemittanceRecord(record = {}) {
  const payments = await loadCanonicalRemittancePayments(record);
  return {
    ...record,
    payments,
    paymentSummary: remittancePaymentSummary(payments)
  };
}

async function hydrateRemittanceRecords(records = []) {
  return Promise.all((Array.isArray(records) ? records : []).map(hydrateRemittanceRecord));
}

async function upsertAutomaticRemittanceBatch(paymentEntry = {}, options = {}) {
  if (normalizeKind(paymentEntry?.kind || paymentEntry?.type) !== 'payment'
      || String(paymentEntry?.direction || 'credit').trim().toLowerCase() !== 'credit') {
    return null;
  }
  const payment = normalizeRemittancePayment({
    ...paymentEntry,
    paymentEntryId: paymentEntry?.id || paymentEntry?.paymentEntryId,
    accountNumber: options.accountNumber || paymentEntry?.accountNumber,
    customerName: options.customerName || paymentEntry?.customerName
  });
  if (!payment.paymentEntryId || !payment.accountNumber || payment.amount <= 0) return null;
  const collectorId = remittanceText(options.collectorId || paymentEntry?.recordedBy?.id || paymentEntry?.recordedByUserId);
  if (!collectorId) return null;
  const collectionDate = remittanceBatchDate(paymentEntry);
  const branchId = options.branchId || null;
  const payload = await readJson(STORE_KEYS.remittances, { records: [] });
  const records = Array.isArray(payload?.records) ? payload.records : [];
  let record = records.find((item) => (
    item?.autoBatch === true
    && remittanceStatus(item?.status) === 'pending'
    && remittanceText(item?.collectorId) === collectorId
    && remittanceText(item?.branchId || '') === remittanceText(branchId || '')
    && remittanceBatchDate(item) === collectionDate
  ));
  const now = new Date().toISOString();
  if (!record) {
    const collectorName = remittanceText(options.collectorName || paymentEntry?.recordedBy?.name
      || paymentEntry?.recordedBy?.username || 'Collector');
    const actor = {
      id: collectorId,
      username: remittanceText(options.collectorUsername || paymentEntry?.recordedBy?.username),
      name: collectorName,
      role: 'Collector',
      branchId
    };
    record = {
      id: `remit-${collectorId}-${collectionDate}-${Date.now()}`,
      collectorId,
      collectorName,
      branchId,
      collectionDate,
      status: 'pending',
      autoBatch: true,
      payments: [],
      totalAmount: 0,
      submittedAt: now,
      updatedAt: now,
      submittedBy: actor,
      reviewedAt: null,
      reviewedBy: null,
      adminNote: ''
    };
    records.unshift(record);
  }
  const existingKeys = new Set((Array.isArray(record.payments) ? record.payments : []).map(remittancePaymentKey));
  if (!existingKeys.has(remittancePaymentKey(payment))) {
    record.payments = [...(Array.isArray(record.payments) ? record.payments : []), payment];
  }
  record.totalAmount = Number(record.payments
    .reduce((sum, item) => sum + Math.max(Number(item?.amount || 0), 0), 0)
    .toFixed(2));
  record.updatedAt = now;
  await writeJson(STORE_KEYS.remittances, { records, updatedAt: now });
  return record;
}

function normalizeCollectorPaymentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPendingCollectorPaymentStatus(value) {
  return normalizeCollectorPaymentStatus(value) === COLLECTOR_PAYMENT_PENDING_STATUS;
}

function isCollectorCreditApprovalEntry(entry = {}) {
  const direction = String(entry.direction || '').trim().toLowerCase();
  const kind = normalizeKind(entry.kind || entry.type);
  const role = String(entry?.recordedBy?.role || entry.recordedByRole || '').trim().toLowerCase();
  return direction === 'credit'
    && kind !== 'charge'
    && role === 'collector'
    && isPendingCollectorPaymentStatus(entry.status);
}

function isCollectorGcashPayment(entry = {}) {
  return String(entry.paymentMethod || entry.payment_method || '').trim().toLowerCase() === 'gcash'
    && normalizeKind(entry.kind || entry.type) === 'payment';
}

function createCollectorGcashError(message, code) {
  const error = createError(409, message);
  error.code = code;
  return error;
}

function collectorGcashSubmissionId(branchId, entryId) {
  return `collector-gcash-${crypto.createHash('sha256')
    .update(`${branchId}|${entryId}`)
    .digest('hex')
    .slice(0, 32)}`;
}

function collectorGcashNumericReference(value) {
  const normalized = normalizeOfficialGcashReference(value);
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : '';
}

function resolveCollectorOfficialGcashTransaction(transactions, reference) {
  const requestedReference = normalizeOfficialGcashReference(reference);
  const exactMatches = (Array.isArray(transactions) ? transactions : [])
    .filter((transaction) => normalizeOfficialGcashReference(transaction?.reference) === requestedReference);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw createCollectorGcashError(
      'Multiple imported GCash credits use this exact reference. Resolve the imported history before approval.',
      'GCASH_HISTORY_MATCH_REQUIRED'
    );
  }
  const numericReference = collectorGcashNumericReference(requestedReference);
  if (!numericReference) return null;
  const numericMatches = (Array.isArray(transactions) ? transactions : [])
    .filter((transaction) => collectorGcashNumericReference(transaction?.reference) === numericReference);
  if (numericMatches.length === 1) return numericMatches[0];
  if (numericMatches.length > 1) {
    throw createCollectorGcashError(
      'This numeric reference matches multiple imported GCash credits. Resolve the imported history before approval.',
      'GCASH_HISTORY_MATCH_REQUIRED'
    );
  }
  return null;
}

async function prepareCollectorGcashApproval({ actor, branchId, accountNumber, entry }) {
  if (normalizeKind(entry?.kind || entry?.type) !== 'payment') return null;
  const explicitlyGcash = isCollectorGcashPayment(entry);
  const safeBranchId = Number(branchId);
  const entryId = String(entry?.id || '').trim();
  const reference = String(entry?.reference || entry?.orNumber || entry?.or_number || '').trim();
  const amount = Number(Number(entry?.amount || 0).toFixed(2));
  const paymentDate = toPaymentDateOnly(entry?.date || entry?.recordedAt);
  if (!reference) {
    if (explicitlyGcash) {
      throw createCollectorGcashError(
        'Collector GCash approval requires a reference from imported history.',
        'GCASH_HISTORY_MATCH_REQUIRED'
      );
    }
    return null;
  }
  if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
    if (!explicitlyGcash) return null;
    throw createError(400, 'Branch assignment missing for this admin account.');
  }
  const history = await listGcashTransactionHistory({ branchId: safeBranchId, all: true });
  const transaction = resolveCollectorOfficialGcashTransaction(history?.transactions, reference);
  if (!transaction) {
    if (explicitlyGcash) {
      throw createCollectorGcashError(
        'Collector GCash approval requires an imported official credit with the same reference.',
        'GCASH_HISTORY_MATCH_REQUIRED'
      );
    }
    return null;
  }
  const officialAmount = Number(Number(transaction?.credit || 0).toFixed(2));
  const officialDate = toPaymentDateOnly(transaction?.transactionDate || transaction?.transactionAt);
  if (
    transaction.postingLock
    || String(transaction.status || '').trim().toLowerCase() !== 'received'
    || !Number.isFinite(officialAmount)
    || officialAmount <= 0
    || officialAmount !== amount
    || !paymentDate
    || officialDate !== paymentDate
  ) {
    throw createCollectorGcashError(
      'Collector GCash approval requires one unlocked imported credit with the same reference, amount, and date.',
      transaction?.postingLock ? 'GCASH_TRANSACTION_POSTING_LOCKED' : 'GCASH_HISTORY_MATCH_REQUIRED'
    );
  }
  const submissionId = collectorGcashSubmissionId(safeBranchId, entryId);
  const claim = await claimGcashTransaction({
    branchId: safeBranchId,
    reference: transaction.reference,
    submissionId,
    accountNumber,
    customerName: `Main - ${accountNumber}`,
    amount,
    paymentDate,
    billingMonth: paymentDate.slice(0, 7),
    claimedBy: {
      id: String(actor?.id || '').trim() || null,
      username: String(actor?.username || '').trim() || null,
      name: String(actor?.name || '').trim() || null
    }
  });
  return {
    branchId: safeBranchId,
    reference: transaction.reference,
    submissionId,
    accountNumber,
    paymentEntryId: entryId,
    claim
  };
}

async function finalizeCollectorGcashApproval(binding) {
  if (!binding) return null;
  const existingAssignment = binding.claim?.assignment || null;
  if (
    existingAssignment?.status === 'posted'
    && existingAssignment.paymentEntryId === binding.paymentEntryId
  ) {
    return {
      transaction: binding.claim.transaction,
      assignment: existingAssignment,
      idempotent: true
    };
  }
  try {
    return await finalizeGcashTransactionAssignment(binding);
  } catch (error) {
    const pendingError = createCollectorGcashError(
      'The Collector payment was approved and the GCash credit remains reserved. Retry the same approval to finish the official binding.',
      'COLLECTOR_GCASH_FINALIZATION_PENDING'
    );
    pendingError.cause = error;
    throw pendingError;
  }
}

async function releaseCollectorGcashClaimAfterRejection({ branchId, accountNumber, entry }) {
  const safeBranchId = Number(branchId);
  const entryId = String(entry?.id || '').trim();
  if (!Number.isInteger(safeBranchId) || safeBranchId <= 0 || !entryId) return false;
  const submissionId = collectorGcashSubmissionId(safeBranchId, entryId);
  const rawReference = entry?.reference || entry?.orNumber || entry?.or_number;
  let releaseReference = rawReference;
  try {
    const history = await listGcashTransactionHistory({ branchId: safeBranchId, all: true });
    const claimedTransactions = (Array.isArray(history?.transactions) ? history.transactions : [])
      .filter((transaction) => (
        transaction?.assignment?.submissionId === submissionId
        && String(transaction?.assignment?.accountNumber || '').trim() === String(accountNumber || '').trim()
      ));
    const officialTransaction = claimedTransactions.length === 1
      ? claimedTransactions[0]
      : resolveCollectorOfficialGcashTransaction(history?.transactions, rawReference);
    if (officialTransaction?.reference) releaseReference = officialTransaction.reference;
  } catch (_error) {
    return false;
  }
  return releaseGcashTransactionClaim({
    branchId: safeBranchId,
    reference: releaseReference,
    submissionId,
    accountNumber
  }).catch(() => false);
}

function getApprovalActor(req) {
  if (req.collector) {
    throw createError(403, 'Admin approval is required for collector payments.');
  }
  if (!req.user || !accountHasRole(req.user, 'Admin')) {
    throw createError(403, 'Admin access required.');
  }
  return req.user;
}

function resolvePairedPrepaidChargeFingerprint(accountNumber, paymentEntry = {}) {
  const reference = String(paymentEntry.reference || paymentEntry.orNumber || '').trim();
  const amount = Math.abs(Number(paymentEntry.amount) || 0);
  if (!accountNumber || !reference || amount <= 0) return '';
  return buildCollectorPaymentFingerprint(accountNumber, reference, 'charge', amount);
}

function resolveApprovalCustomerName(customer = {}, accountNumber = '') {
  return resolveCustomerDisplayName({
    name: customer?.customerName || customer?.name,
    firstName: customer?.firstName,
    lastName: customer?.lastName,
    accountNumber
  }, accountNumber);
}

function mapCollectorPaymentApprovalItem(entry = {}, customer = {}, accountNumber = '') {
  const normalizedAccountNumber = String(entry.accountNumber || accountNumber || customer?.accountNumber || '').trim();
  const recordedBy = entry.recordedBy || {};
  return {
    id: String(entry.id || '').trim(),
    accountNumber: normalizedAccountNumber,
    customerName: resolveApprovalCustomerName(customer, normalizedAccountNumber),
    area: String(customer?.area || entry.area || '').trim(),
    amount: Math.abs(Number(entry.amount) || 0),
    date: entry.date || entry.recordedAt || null,
    recordedAt: entry.recordedAt || entry.recorded_at || null,
    reference: entry.reference || entry.orNumber || null,
    paymentMethod: entry.paymentMethod || entry.payment_method || null,
    kind: normalizeKind(entry.kind || entry.type),
    collectorId: String(recordedBy.id || entry.recordedByUserId || '').trim(),
    collectorName: String(recordedBy.name || entry.recordedByName || recordedBy.username || entry.recordedByUsername || 'Collector').trim(),
    collectorUsername: String(recordedBy.username || entry.recordedByUsername || '').trim(),
    status: entry.status || COLLECTOR_PAYMENT_PENDING_STATUS,
    reviewedAt: entry.reviewedAt || entry.reviewed_at || null,
    reviewedBy: entry.reviewedBy || null,
    decisionReason: entry.decisionReason || entry.decision_reason || ''
  };
}

function buildCollectorPaymentReview(actor = {}, status, reason = '') {
  return {
    status,
    decisionReason: reason,
    reviewedAt: new Date().toISOString(),
    reviewedBy: {
      id: String(actor?.id || '').trim(),
      username: String(actor?.username || '').trim(),
      name: String(actor?.name || actor?.username || 'Admin').trim(),
      role: 'Admin'
    }
  };
}

async function ensureCollectorPaymentReviewTable() {
  if (collectorPaymentReviewTableReady) return;
  await query(COLLECTOR_PAYMENT_REVIEW_DDL);
  collectorPaymentReviewTableReady = true;
}

async function writeRelationalCollectorPaymentReview(connection, review, entryId, branchId, accountNumber) {
  await connection.query(
    `INSERT INTO ${COLLECTOR_PAYMENT_REVIEW_TABLE} (
       payment_entry_id,
       branch_id,
       account_number,
       decision_status,
       decision_reason,
       reviewed_at,
       reviewed_by_user_id,
       reviewed_by_username,
       reviewed_by_name,
       reviewed_by_role
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       decision_status = VALUES(decision_status),
       decision_reason = VALUES(decision_reason),
       reviewed_at = VALUES(reviewed_at),
       reviewed_by_user_id = VALUES(reviewed_by_user_id),
       reviewed_by_username = VALUES(reviewed_by_username),
       reviewed_by_name = VALUES(reviewed_by_name),
       reviewed_by_role = VALUES(reviewed_by_role),
       updated_at = CURRENT_TIMESTAMP`,
    [
      entryId,
      String(branchId),
      String(accountNumber),
      review.status,
      review.decisionReason || null,
      toMysqlDateTime(review.reviewedAt),
      review.reviewedBy.id || null,
      review.reviewedBy.username || null,
      review.reviewedBy.name || null,
      review.reviewedBy.role
    ]
  );
}

function collectorPaymentEntriesMatch(existing = {}, requested = {}, accountNumber = '') {
  const existingAccount = String(existing.accountNumber || accountNumber || '').trim().toLowerCase();
  const requestedAccount = String(requested.accountNumber || accountNumber || '').trim().toLowerCase();
  const existingCollector = String(existing?.recordedBy?.id || existing.recordedByUserId || '').trim();
  const requestedCollector = String(requested?.recordedBy?.id || requested.recordedByUserId || '').trim();
  const existingMethod = String(existing.paymentMethod || existing.payment_method || '').trim().toLowerCase();
  const requestedMethod = String(requested.paymentMethod || requested.payment_method || '').trim().toLowerCase();
  const existingDate = toPaymentDateOnly(existing.date || existing.recordedAt);
  const requestedDate = toPaymentDateOnly(requested.date || requested.recordedAt);
  return existingAccount === requestedAccount
    && String(existing.reference || existing.orNumber || '').trim().toLowerCase()
      === String(requested.reference || requested.orNumber || '').trim().toLowerCase()
    && normalizeKind(existing.kind || existing.type) === normalizeKind(requested.kind || requested.type)
    && Math.abs(Math.abs(Number(existing.amount) || 0) - Math.abs(Number(requested.amount) || 0)) < 0.0001
    && (!existingCollector || !requestedCollector || existingCollector === requestedCollector)
    && existingMethod === requestedMethod
    && existingDate === requestedDate;
}

async function findRelationalCollectorPaymentSubmission(executor, branchId, accountNumber, requestedEntry) {
  const runQuery = executor && typeof executor.query === 'function'
    ? executor.query.bind(executor)
    : query;
  const [rows] = await runQuery(
    `SELECT
       id,
       account_number AS accountNumber,
       amount,
       date,
       kind,
       direction,
       reference,
       or_number AS orNumber,
       description,
       type,
       recorded_at AS recordedAt,
       recorded_by_user_id AS recordedByUserId,
       recorded_by_username AS recordedByUsername,
       recorded_by_name AS recordedByName,
       recorded_by_role AS recordedByRole,
       payer,
       status,
       payment_method AS paymentMethod,
       fingerprint,
       xendit_id AS xenditId
     FROM payment_entries
     WHERE branch_id = ?
       AND account_number = ?
       AND (id = ? OR LOWER(COALESCE(reference, '')) = LOWER(?))
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, recorded_at DESC, id DESC
     LIMIT 2`,
    [branchId, String(accountNumber), requestedEntry.id, requestedEntry.reference, requestedEntry.id]
  );
  const matches = (rows || []).map(mapReceiptPaymentRow);
  const exact = matches.find((entry) => collectorPaymentEntriesMatch(entry, requestedEntry, accountNumber));
  if (exact) return exact;
  if (matches.length) {
    throw createError(409, `Reference already exists with different payment details: ${requestedEntry.reference}`);
  }
  return null;
}

function getRemittanceActor(req) {
  const actor = req.collector || req.user || {};
  return {
    id: remittanceText(actor.id),
    username: remittanceText(actor.username),
    name: remittanceText(actor.name || actor.username),
    role: req.collector ? 'Collector' : remittanceText(actor.role || 'Admin'),
    branchId: actor.branchId || null
  };
}

function normalizeKind(rawKind) {
  const k = String(rawKind || 'payment').toLowerCase().trim();
  const aliases = {
    payment: 'payment',
    paid: 'payment',
    credit: 'payment',
    rebate: 'rebate',
    discount: 'discount',
    charge: 'charge',
    debit: 'charge',
    bill: 'charge',
    billing: 'charge'
  };
  return aliases[k] || 'payment';
}

function normalizeOptionList(values, defaults = []) {
  const seen = new Set();
  return [...defaults, ...(Array.isArray(values) ? values : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeTypeOfPayment(kind) {
  if (kind === 'charge') return 'debit';
  if (kind === 'payment') return 'credit';
  if (kind === 'discount') return 'discount';
  if (kind === 'rebate') return 'rebate';
  return kind || 'credit';
}

function normalizePaymentMethodForOptions(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'gcash') return 'GCash';
  return trimmed;
}

function sanitizeReference(rawReference) {
  const trimmed = String(rawReference || '').trim();
  if (trimmed.length > REFERENCE_MAX_LENGTH) {
    throw createError(400, `Reference must be at most ${REFERENCE_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

function sanitizePaymentMethod(rawPaymentMethod) {
  const trimmed = String(rawPaymentMethod || '').trim();
  if (trimmed.length > PAYMENT_METHOD_MAX_LENGTH) {
    throw createError(400, `Payment method must be at most ${PAYMENT_METHOD_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

function requireCollectorReference(providedReference) {
  const explicit = sanitizeReference(providedReference);
  if (explicit) return explicit;
  throw createError(400, 'Reference is required for collector submissions.');
}

function toPlanAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinatePair(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function parseCoordinateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = (() => {
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      return raw;
    }
  })();

  const patterns = [
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (isValidCoordinatePair(lat, lng)) {
      return { lat, lng };
    }
  }

  const normalizedDms = normalized
    .replace(/[\u00BA\u02DA]/g, '\u00B0')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasDmsMarkers = /[NSEW]/i.test(normalizedDms) && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
  if (!hasDmsMarkers) {
    return null;
  }

  const parseDmsSegment = (segment) => {
    const text = String(segment || '').trim().toUpperCase();
    if (!text) return null;
    const hemisphereMatch = text.match(/[NSEW]/);
    const hemisphere = hemisphereMatch ? hemisphereMatch[0] : '';
    if (!hemisphere) return null;
    const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (!numericParts.length) return null;

    const degrees = Number(numericParts[0]);
    const minutes = Number(numericParts[1] || 0);
    const seconds = Number(numericParts[2] || 0);
    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }
    if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
      return null;
    }

    let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
    if (String(numericParts[0] || '').trim().startsWith('-')) {
      decimal *= -1;
    }
    if (hemisphere === 'S' || hemisphere === 'W') {
      decimal = -Math.abs(decimal);
    } else {
      decimal = Math.abs(decimal);
    }

    return {
      value: decimal,
      hemisphere
    };
  };

  const dmsSegments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
  const parsedDmsSegments = dmsSegments.map(parseDmsSegment).filter(Boolean);
  const latEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S');
  const lngEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W');
  if (latEntry && lngEntry && isValidCoordinatePair(latEntry.value, lngEntry.value)) {
    return {
      lat: latEntry.value,
      lng: lngEntry.value
    };
  }

  return null;
}

function isPrepaidCustomer(customer) {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid') return true;
  if (explicit === 'postpaid') return false;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return true;
  if (billing.includes('postpaid')) return false;
  return false;
}

function toMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function toMysqlDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 10);
}

function hasExplicitTime(value) {
  return EXPLICIT_TIME_RE.test(String(value || '').trim());
}

function normalizeDateTimeForRecordedAt(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const raw = String(value || '').trim();
  if (!raw || !hasExplicitTime(raw)) return null;
  if (TIMEZONE_SUFFIX_RE.test(raw)) return raw;
  const match = raw.match(BARE_DATETIME_VALUE_RE);
  if (!match) return raw;
  const seconds = match[3] || '00';
  return `${match[1]}T${match[2]}:${seconds}${match[4] || ''}${MANILA_OFFSET_SUFFIX}`;
}

function resolveRecordedAtValue(explicitRecordedAt, paymentDate) {
  return normalizeDateTimeForRecordedAt(explicitRecordedAt)
    || normalizeDateTimeForRecordedAt(paymentDate)
    || new Date().toISOString();
}

function toPaymentDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return toMysqlDateOnly(value);
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match ? match[1] : toMysqlDateOnly(raw);
}

function buildCollectorCustomerSummary(customer, accountNumber) {
  if (!customer) return null;
  const normalizedAccountNumber = String(customer.accountNumber || accountNumber || '').trim();
  if (!normalizedAccountNumber) return null;
  return {
    accountNumber: normalizedAccountNumber,
    area: customer.area ? String(customer.area) : null,
    mapPin: customer.mapPin ? String(customer.mapPin) : null,
    coordinates: parseCoordinateValue(customer.mapPin),
    planName: customer.planName ? String(customer.planName) : null,
    planAmount: toPlanAmount(customer.planAmount),
    planCategory: customer.planCategory ? String(customer.planCategory) : null,
    planBilling: customer.planBilling ? String(customer.planBilling) : null,
    dueDate: toMysqlDateOnly(customer.dueDate),
    nextDue: resolveCollectorNextDue(customer),
  };
}

function resolveCustomerDisplayName(customer, accountNumber = '') {
  const direct = String(customer?.name || customer?.customerName || customer?.subscriberName || '').trim();
  if (direct) return direct;
  const first = String(customer?.firstName || '').trim();
  const last = String(customer?.lastName || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  const normalizedAccountNumber = String(customer?.accountNumber || accountNumber || '').trim();
  return normalizedAccountNumber ? `Account ${normalizedAccountNumber}` : 'Subscriber';
}

function parseEntryDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatBillingMonth(value) {
  const parsed = parseEntryDate(value);
  if (!parsed) return '';
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function normalizeBillingMonthLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = parseEntryDate(raw);
  if (parsed) return formatBillingMonth(parsed);
  return raw;
}

function formatMonthlyBillLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^Monthly\s+Bill\s+for\s+/i.test(normalized)) return normalized;
  return `${MONTHLY_BILL_LABEL_PREFIX}${normalized}`;
}

function resolveEntryDirection(entry) {
  const direction = String(entry?.direction || '').trim().toLowerCase();
  if (direction === 'debit' || direction === 'credit') return direction;
  const kind = normalizeKind(entry?.kind || entry?.type);
  return kind === 'charge' ? 'debit' : 'credit';
}

function getEntryTimestamp(entry) {
  const direct = parseEntryDate(entry?.recordedAt || entry?.recorded_at || entry?.date)?.getTime();
  if (Number.isFinite(direct) && direct > 0) return direct;
  const idSuffix = String(entry?.id || '').match(/(\d{9,})$/);
  if (idSuffix?.[1]) {
    const parsed = Number(idSuffix[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getLedgerSortTimestamp(entry) {
  const direction = resolveEntryDirection(entry);
  const primary = direction === 'debit'
    ? (entry?.date || entry?.recordedAt || entry?.recorded_at || '')
    : (entry?.recordedAt || entry?.recorded_at || entry?.date || '');
  const primaryTime = parseEntryDate(primary)?.getTime();
  if (Number.isFinite(primaryTime) && primaryTime > 0) return primaryTime;
  return getEntryTimestamp(entry);
}

function resolveChargeMonth(entry) {
  const direct = normalizeBillingMonthLabel(
    entry?.coveredMonth ||
    entry?.billingMonth ||
    entry?.billMonth ||
    entry?.month ||
    entry?.period ||
    entry?.billingPeriod ||
    ''
  );
  if (direct) return formatMonthlyBillLabel(direct);

  const description = String(entry?.description || entry?.memo || entry?.notes || '').trim();
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  if (monthMatch) return formatMonthlyBillLabel(normalizeBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`));

  return formatMonthlyBillLabel(formatBillingMonth(entry?.date || entry?.recordedAt || entry?.recorded_at || ''));
}

function resolvePaymentDescriptionMonth(entry) {
  const description = String(entry?.description || entry?.memo || entry?.notes || '').trim();
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  return monthMatch ? formatMonthlyBillLabel(normalizeBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`)) : '';
}

function resolvePaymentFallbackMonth(entry) {
  return resolvePaymentDescriptionMonth(entry)
    || formatMonthlyBillLabel(formatBillingMonth(entry?.date || entry?.recordedAt || entry?.recorded_at || ''));
}

function mapReceiptPaymentRow(row) {
  return {
    id: row?.id,
    amount: row?.amount != null ? Number(row.amount) : 0,
    date: row?.date || row?.recordedAt || null,
    kind: row?.kind || undefined,
    direction: row?.direction || undefined,
    reference: row?.reference || undefined,
    orNumber: row?.orNumber || row?.or_number || undefined,
    description: row?.description || undefined,
    type: row?.type || undefined,
    recordedAt: row?.recordedAt || row?.recorded_at || undefined,
    recordedBy: row?.recordedBy && typeof row.recordedBy === 'object' ? {
      id: row.recordedBy.id || undefined,
      username: row.recordedBy.username || undefined,
      name: row.recordedBy.name || undefined,
      role: row.recordedBy.role || undefined
    } : row?.recordedByUserId ? {
      id: row.recordedByUserId,
      username: row.recordedByUsername || undefined,
      name: row.recordedByName || undefined,
      role: row.recordedByRole || undefined
    } : row?.recordedByUsername || row?.recordedByName ? {
      id: row?.recordedByUserId || undefined,
      username: row?.recordedByUsername || undefined,
      name: row?.recordedByName || undefined,
      role: row?.recordedByRole || undefined
    } : undefined,
    payer: row?.payer || undefined,
    status: row?.status || undefined,
    paymentMethod: row?.paymentMethod || row?.payment_method || undefined,
    fingerprint: row?.fingerprint || undefined,
    xenditId: row?.xenditId || row?.xendit_id || undefined
  };
}

function pushBreakdownLine(items, label, amount) {
  const normalized = String(label || '').trim();
  const amountValue = Number(amount);
  if (!normalized || !Number.isFinite(amountValue) || amountValue <= 0) return;
  const existing = items.find((item) => item.month === normalized || item.label === normalized);
  if (existing) {
    existing.amount = Number((Number(existing.amount || 0) + amountValue).toFixed(2));
    return;
  }
  items.push({
    label: normalized,
    amount: Number(amountValue.toFixed(2))
  });
}

function applyCreditToCharges(openCharges, amount, coveredBreakdown = null) {
  let remainingPayment = Number(amount);
  if (!Number.isFinite(remainingPayment) || remainingPayment <= 0) return;
  for (const charge of openCharges) {
    if (remainingPayment <= 0) break;
    const remainingCharge = Number(charge.remaining);
    if (!Number.isFinite(remainingCharge) || remainingCharge <= 0) continue;
    const applied = Math.min(remainingCharge, remainingPayment);
    if (coveredBreakdown) pushBreakdownLine(coveredBreakdown, charge.label, applied);
    charge.remaining = Number((remainingCharge - applied).toFixed(2));
    remainingPayment = Number((remainingPayment - applied).toFixed(2));
  }
}

function buildCollectorReceiptBreakdown(history = [], paymentEntry = null) {
  const targetPayment = paymentEntry || null;
  const targetId = String(targetPayment?.id || '').trim();
  const targetReference = String(targetPayment?.reference || '').trim();
  const targetTimestamp = getEntryTimestamp(targetPayment);
  const targetAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      const amount = Math.abs(Number(entry?.amount) || 0);
      return {
        entry,
        index,
        amount,
        direction: resolveEntryDirection(entry),
        timestamp: getEntryTimestamp(entry),
        sortTimestamp: getLedgerSortTimestamp(entry)
      };
    })
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp - right.sortTimestamp;
      return left.index - right.index;
    });

  const coveredBillingBreakdown = [];
  const openCharges = [];
  let matched = false;

  rows.forEach((row) => {
    const rowId = String(row.entry?.id || '').trim();
    const rowReference = String(row.entry?.reference || '').trim();
    const idMatch = targetId && rowId && targetId === rowId;
    const referenceMatch = targetReference && rowReference && targetReference === rowReference;
    const fallbackMatch = row.direction === 'credit'
      && targetTimestamp > 0
      && row.timestamp === targetTimestamp
      && Math.abs(row.amount - targetAmount) < 0.0001;
    const isTargetPayment = !matched && (idMatch || referenceMatch || fallbackMatch);

    if (row.direction === 'debit') {
      openCharges.push({
        label: resolveChargeMonth(row.entry),
        remaining: Number(row.amount.toFixed(2))
      });
      return;
    }

    applyCreditToCharges(openCharges, row.amount, isTargetPayment ? coveredBillingBreakdown : null);
    if (isTargetPayment) matched = true;
  });

  if (!coveredBillingBreakdown.length && targetPayment) {
    pushBreakdownLine(coveredBillingBreakdown, resolvePaymentFallbackMonth(targetPayment), targetAmount);
  }

  const balanceBreakdown = openCharges
    .filter((charge) => Number(charge.remaining) > 0)
    .map((charge) => ({
      label: charge.label,
      amount: Number(Number(charge.remaining).toFixed(2))
    }));

  return {
    coveredBillingBreakdown,
    balanceBreakdown
  };
}

function isSamePaymentEntry(left, right) {
  if (!left || !right) return false;
  const leftId = String(left?.id || '').trim();
  const rightId = String(right?.id || '').trim();
  if (leftId && rightId && leftId === rightId) return true;
  const leftReference = String(left?.reference || '').trim();
  const rightReference = String(right?.reference || '').trim();
  if (leftReference && rightReference && leftReference === rightReference) return true;
  const leftOrNumber = String(left?.orNumber || left?.or_number || '').trim();
  const rightOrNumber = String(right?.orNumber || right?.or_number || '').trim();
  if (leftOrNumber && rightOrNumber && leftOrNumber === rightOrNumber) return true;
  const leftTimestamp = getEntryTimestamp(left);
  const rightTimestamp = getEntryTimestamp(right);
  const leftAmount = Math.abs(Number(left?.amount) || 0);
  const rightAmount = Math.abs(Number(right?.amount) || 0);
  return leftTimestamp > 0
    && rightTimestamp > 0
    && leftTimestamp === rightTimestamp
    && Math.abs(leftAmount - rightAmount) < 0.0001;
}

function buildCollectorReceiptSummary(history = [], paymentEntry = null) {
  const targetPayment = paymentEntry || null;
  const targetAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      const amount = Math.abs(Number(entry?.amount) || 0);
      return {
        entry,
        index,
        amount,
        direction: resolveEntryDirection(entry),
        sortTimestamp: getLedgerSortTimestamp(entry)
      };
    })
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp - right.sortTimestamp;
      return left.index - right.index;
    });

  const result = {
    previousBalance: 0,
    paymentAmount: Number(targetAmount.toFixed(2)),
    balanceAfterPayment: 0,
    totalCharge: 0,
    currentBalance: 0,
    coveredBillingBreakdown: [],
    balanceBreakdown: []
  };
  if (!targetPayment || !rows.length) return result;

  const openCharges = [];
  let running = 0;
  let runningBeforePayment = 0;
  let runningAfterPayment = null;
  let chargesAfterPayment = 0;
  let matched = false;

  rows.forEach((row) => {
    const isTargetPayment = !matched && row.direction === 'credit' && isSamePaymentEntry(row.entry, targetPayment);
    if (isTargetPayment) {
      runningBeforePayment = running;
      matched = true;
    }

    if (row.direction === 'debit') {
      running = Number((running + row.amount).toFixed(2));
      openCharges.push({
        label: resolveChargeMonth(row.entry),
        remaining: Number(row.amount.toFixed(2))
      });
    } else {
      applyCreditToCharges(openCharges, row.amount, isTargetPayment ? result.coveredBillingBreakdown : null);
      running = Number((running - row.amount).toFixed(2));
    }

    if (isTargetPayment) {
      runningAfterPayment = running;
    }
    if (matched && !isTargetPayment && row.direction === 'debit') {
      chargesAfterPayment = Number((chargesAfterPayment + row.amount).toFixed(2));
    }
  });

  if (!result.coveredBillingBreakdown.length) {
    pushBreakdownLine(result.coveredBillingBreakdown, resolvePaymentFallbackMonth(targetPayment), targetAmount);
  }
  result.balanceBreakdown = openCharges
    .filter((charge) => Number(charge.remaining) > 0)
    .map((charge) => ({
      label: charge.label,
      amount: Number(Number(charge.remaining).toFixed(2))
    }));
  result.previousBalance = Number(Math.max(runningBeforePayment, 0).toFixed(2));
  result.balanceAfterPayment = Number(Math.max(
    Number.isFinite(runningAfterPayment) ? runningAfterPayment : (result.previousBalance - targetAmount),
    0
  ).toFixed(2));
  result.totalCharge = Number(Math.max(chargesAfterPayment, 0).toFixed(2));
  result.currentBalance = Number(Math.max(running, 0).toFixed(2));
  return result;
}

async function readPaymentHistoryForReceipt(branchId, accountNumber) {
  if (!branchId || !accountNumber) return [];
  const [rows] = await query(
    `SELECT
       id,
       amount,
       date,
       kind,
       direction,
       reference,
       or_number AS orNumber,
       description,
       type,
       recorded_at AS recordedAt,
       recorded_by_user_id AS recordedByUserId,
       recorded_by_username AS recordedByUsername,
       recorded_by_name AS recordedByName,
       recorded_by_role AS recordedByRole,
       payer,
       status,
       payment_method AS paymentMethod,
       fingerprint,
       xendit_id AS xenditId
     FROM payment_entries
     WHERE branch_id = ?
       AND account_number = ?
     ORDER BY COALESCE(recorded_at, CONCAT(date, ' 00:00:00')) ASC, id ASC`,
    [branchId, accountNumber]
  );
  return Array.isArray(rows) ? rows.map(mapReceiptPaymentRow) : [];
}

function isReceiptPaymentEntry(entry) {
  if (!entry) return false;
  const amount = Math.abs(Number(entry?.amount) || 0);
  if (amount <= 0) return false;
  const direction = resolveEntryDirection(entry);
  const kind = normalizeKind(entry?.kind || entry?.type);
  return direction === 'credit' && kind !== 'charge';
}

function matchesReceiptLookup(entry, lookup) {
  const token = String(lookup?.token || '').trim();
  const entryId = String(lookup?.entryId || '').trim();
  if (!entry || (!token && !entryId)) return false;
  const id = String(entry?.id || '').trim();
  const reference = String(entry?.reference || '').trim();
  const orNumber = String(entry?.orNumber || entry?.or_number || '').trim();
  return Boolean(
    (entryId && id === entryId) ||
    (token && (reference === token || orNumber === token || id === token))
  );
}

function resolveReceiptLookup(req) {
  const token = String(
    req.query?.reference ||
    req.query?.ref ||
    req.query?.orNumber ||
    req.query?.or_number ||
    req.query?.or ||
    ''
  ).trim();
  const entryId = String(
    req.query?.entryId ||
    req.query?.entry ||
    req.query?.paymentId ||
    req.query?.payment ||
    ''
  ).trim();
  const accountNumber = String(req.query?.accountNumber || req.query?.account || '').trim();
  if (!token && !entryId) {
    throw createError(400, 'reference, orNumber, or entryId is required.');
  }
  if (token.length > 64 || entryId.length > 80 || accountNumber.length > 32) {
    throw createError(400, 'Receipt lookup value is too long.');
  }
  return { token, entryId, accountNumber };
}

function buildReceiptCustomerFromRow(row) {
  return {
    accountNumber: String(row?.accountNumber || '').trim(),
    name: row?.customerName || undefined,
    firstName: row?.firstName || undefined,
    lastName: row?.lastName || undefined,
    area: row?.area || undefined,
    mapPin: row?.mapPin || undefined,
    planName: row?.planName || undefined,
    planAmount: row?.planAmount != null ? Number(row.planAmount) : undefined,
    planCategory: row?.planCategory || undefined,
    planBilling: row?.planBilling || undefined,
    dueDate: row?.dueDate || undefined,
    dueOffset: row?.dueOffset != null ? Number(row.dueOffset) : undefined
  };
}

function buildCollectorReceiptPayload(customer, history, targetPayment) {
  const accountNumber = String(customer?.accountNumber || '').trim();
  const summary = buildCollectorReceiptSummary(history, targetPayment);
  const subscriberName = resolveCustomerDisplayName(customer, accountNumber);
  const customerSummary = {
    ...buildCollectorCustomerSummary(customer, accountNumber),
    name: subscriberName,
    customerName: subscriberName,
    firstName: customer?.firstName || undefined,
    lastName: customer?.lastName || undefined
  };
  const paymentAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const receiptBreakdown = {
    coveredBillingBreakdown: summary.coveredBillingBreakdown,
    balanceBreakdown: summary.balanceBreakdown
  };

  return {
    ok: true,
    accountNumber,
    subscriberName,
    customerName: subscriberName,
    customer: customerSummary,
    paymentId: targetPayment?.id || null,
    reference: targetPayment?.reference || null,
    orNumber: targetPayment?.orNumber || null,
    paymentDate: targetPayment?.date || targetPayment?.recordedAt || null,
    recordedAt: targetPayment?.recordedAt || null,
    paymentAmount: Number(paymentAmount.toFixed(2)),
    paymentMethod: targetPayment?.paymentMethod || null,
    payer: targetPayment?.payer || null,
    recordedBy: targetPayment?.recordedBy || null,
    previousBalance: summary.previousBalance,
    balanceAfterPayment: summary.balanceAfterPayment,
    totalCharge: summary.totalCharge,
    currentBalance: summary.currentBalance,
    coveredBillingBreakdown: summary.coveredBillingBreakdown,
    coveredBreakdown: summary.coveredBillingBreakdown,
    balanceBreakdown: summary.balanceBreakdown,
    receiptBreakdown,
    historyCount: Array.isArray(history) ? history.length : 0
  };
}

async function resolveAdminCurrentBillBalance(accountNumber, branchId, fallbackBalance = 0) {
  try {
    const record = await paymentRecordsRouter.buildPaymentRecordForAccount(accountNumber, branchId);
    const endingBalance = Number(record?.paymentBreakdownEndingBalance ?? record?.endingBalance);
    if (Number.isFinite(endingBalance)) return Number(endingBalance.toFixed(2));
  } catch (error) {
    console.warn(
      `Unable to resolve admin current bill balance for ${accountNumber || 'unknown account'}:`,
      error?.message || error
    );
  }
  const fallback = Number(fallbackBalance);
  return Number.isFinite(fallback) ? Number(fallback.toFixed(2)) : 0;
}

async function buildCollectorReceiptPayloadWithAdminBalance(customer, history, targetPayment, branchId = null) {
  const payload = buildCollectorReceiptPayload(customer, history, targetPayment);
  const currentBillAmount = await resolveAdminCurrentBillBalance(
    payload.accountNumber || customer?.accountNumber,
    branchId,
    payload.currentBalance
  );
  return {
    ...payload,
    currentBillAmount,
    paymentBreakdownEndingBalance: currentBillAmount,
    endingBalance: currentBillAmount,
    currentBalance: Number(Math.max(currentBillAmount, 0).toFixed(2))
  };
}

async function isCollectorAssignedToCustomer(branchId, collectorId, customer) {
  if (!collectorId) return true;
  const area = String(customer?.area || '').trim();
  if (!branchId || !area) return false;
  const [rows] = await query(
    `SELECT ca.collector_user_id AS collectorId
     FROM collector_assignments ca
     LEFT JOIN coverage_areas cov
       ON cov.id = ca.coverage_id
      AND cov.branch_id = ca.branch_id
     WHERE ca.branch_id = ?
       AND ca.collector_user_id = ?
       AND (
         LOWER(TRIM(COALESCE(ca.area_name, ''))) = LOWER(TRIM(?))
         OR LOWER(TRIM(COALESCE(cov.name, ''))) = LOWER(TRIM(?))
       )
     LIMIT 1`,
    [branchId, String(collectorId), area, area]
  );
  return Array.isArray(rows) && rows.length > 0;
}

function isJsonCollectorAssignedToCustomer(collectorId, assignments, customer) {
  if (!collectorId) return true;
  const area = String(customer?.area || '').trim();
  if (!area) return false;
  const assignedRaw = assignments?.[area];
  const assignedCollectors = (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return assignedCollectors.includes(String(collectorId));
}

async function insertPaymentEntry(entry, branchId, accountNumber, executor = null) {
  const runQuery = executor && typeof executor.query === 'function'
    ? executor.query.bind(executor)
    : query;
  const recordedBy = entry.recordedBy || {};
  const recordedAt = toMysqlDateTime(entry.recordedAt || normalizeDateTimeForRecordedAt(entry.date) || new Date());
  const entryDate = toPaymentDateOnly(entry.date) || toMysqlDateOnly(entry.recordedAt || recordedAt);
  await runQuery(
    `INSERT INTO payment_entries (
        id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
        recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
        payer, status, payment_method, fingerprint, xendit_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(entry.id || `${accountNumber}-${Date.now()}`),
      branchId,
      String(accountNumber),
      Number(entry.amount) || 0,
      entryDate,
      entry.kind || null,
      entry.direction || null,
      entry.reference || null,
      entry.orNumber || null,
      entry.description || null,
      entry.type || null,
      recordedAt,
      recordedBy.id ? String(recordedBy.id) : null,
      recordedBy.username || null,
      recordedBy.name || null,
      recordedBy.role || null,
      entry.payer || null,
      entry.status || null,
      entry.paymentMethod || null,
      entry.fingerprint || null,
      entry.xenditId || null
    ]
  );
}

async function readCollectorPaymentOptions(branchId = null) {
  let configured = {};
  try {
    configured = await readJson(COLLECTOR_PAYMENT_OPTIONS_KEY, {});
  } catch {
    configured = {};
  }

  let recordedPaymentMethods = [];
  if (await isRelationalReady()) {
    const params = [];
    const branchClause = branchId ? 'WHERE branch_id = ?' : '';
    if (branchId) params.push(branchId);
    const [rows] = await query(
      `SELECT DISTINCT payment_method AS paymentMethod
       FROM payment_entries
       ${branchClause}
       ORDER BY payment_method ASC`,
      params
    );
    recordedPaymentMethods = (rows || [])
      .map((row) => normalizePaymentMethodForOptions(row?.paymentMethod))
      .filter(Boolean);
  } else {
    const payments = await readJson(STORE_KEYS.payments, {});
    recordedPaymentMethods = Object.values(payments || {})
      .flatMap((record) => Array.isArray(record?.history) ? record.history : [])
      .map((entry) => normalizePaymentMethodForOptions(entry?.paymentMethod || entry?.method))
      .filter(Boolean);
  }

  return {
    typeOfPayment: normalizeOptionList(
      configured.typeOfPayment || configured.typeOfPayments || configured.types,
      DEFAULT_TYPE_OF_PAYMENT_OPTIONS
    ),
    paymentMethod: normalizeOptionList(
      configured.paymentMethod || configured.paymentMethods || configured.methods,
      [...DEFAULT_PAYMENT_METHOD_OPTIONS, ...recordedPaymentMethods]
    )
  };
}

async function listCollectorPaymentApprovals(req) {
  const actor = getApprovalActor(req);
  const branchId = actor?.branchId || null;

  if (await isRelationalReady()) {
    if (!branchId) {
      throw createError(400, 'Branch assignment missing for this admin account.');
    }
    const [rows] = await query(
      `SELECT
         pe.id,
         pe.account_number AS accountNumber,
         pe.amount,
         pe.date,
         pe.kind,
         pe.direction,
         pe.reference,
         pe.or_number AS orNumber,
         pe.description,
         pe.type,
         pe.recorded_at AS recordedAt,
         pe.recorded_by_user_id AS recordedByUserId,
         pe.recorded_by_username AS recordedByUsername,
         pe.recorded_by_name AS recordedByName,
         pe.recorded_by_role AS recordedByRole,
         pe.payer,
         pe.status,
         pe.payment_method AS paymentMethod,
         pe.fingerprint,
         pe.xendit_id AS xenditId,
         c.name AS customerName,
         c.first_name AS firstName,
         c.last_name AS lastName,
         c.area
       FROM payment_entries pe
       LEFT JOIN customers c
         ON c.branch_id = pe.branch_id
        AND c.account_number = pe.account_number
       WHERE pe.branch_id = ?
         AND LOWER(COALESCE(pe.status, '')) = ?
         AND LOWER(COALESCE(pe.recorded_by_role, '')) = 'collector'
         AND LOWER(COALESCE(pe.direction, '')) = 'credit'
         AND LOWER(COALESCE(pe.kind, pe.type, '')) <> 'charge'
       ORDER BY COALESCE(pe.recorded_at, CONCAT(pe.date, ' 00:00:00')) DESC, pe.id DESC
       LIMIT 200`,
      [branchId, COLLECTOR_PAYMENT_PENDING_STATUS]
    );
    const records = (rows || []).map((row) => mapCollectorPaymentApprovalItem(mapReceiptPaymentRow(row), {
      accountNumber: row.accountNumber,
      customerName: row.customerName,
      name: row.customerName,
      firstName: row.firstName,
      lastName: row.lastName,
      area: row.area
    }, row.accountNumber));
    return { records };
  }

  const [customers, payments] = await Promise.all([
    readJson(STORE_KEYS.customers, []),
    readJson(STORE_KEYS.payments, {})
  ]);
  const sourceCustomers = Array.isArray(customers) ? customers : [];
  const customerMap = new Map();
  sourceCustomers.forEach((customer) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    if (!accountNumber) return;
    if (branchId && customer?.branchId && String(customer.branchId) !== String(branchId)) return;
    customerMap.set(accountNumber, customer);
  });

  const records = [];
  Object.entries(payments || {}).forEach(([accountNumber, bucket]) => {
    const customer = customerMap.get(String(accountNumber));
    if (branchId && sourceCustomers.length && !customer) return;
    (Array.isArray(bucket?.history) ? bucket.history : []).forEach((entry) => {
      if (!isCollectorCreditApprovalEntry(entry)) return;
      records.push(mapCollectorPaymentApprovalItem(entry, customer || {}, accountNumber));
    });
  });
  records.sort((left, right) => {
    const leftTime = parseEntryDate(left.recordedAt || left.date)?.getTime() || 0;
    const rightTime = parseEntryDate(right.recordedAt || right.date)?.getTime() || 0;
    return rightTime - leftTime || String(right.id).localeCompare(String(left.id));
  });
  return { records: records.slice(0, 200) };
}

function isPairedPrepaidChargeEntry(entry = {}, target = {}, pairedFingerprint = '') {
  if (!entry || !target) return false;
  const direction = resolveEntryDirection(entry);
  if (direction !== 'debit') return false;
  if (!isPendingCollectorPaymentStatus(entry.status)) return false;
  if (pairedFingerprint && String(entry.fingerprint || '').trim() === pairedFingerprint) return true;
  const description = String(entry.description || '').trim().toLowerCase();
  const entryRecorder = String(entry?.recordedBy?.id || entry.recordedByUserId || '').trim();
  const targetRecorder = String(target?.recordedBy?.id || target.recordedByUserId || '').trim();
  return description.includes('prepaid renewal charge')
    && Math.abs((Number(entry.amount) || 0) - (Number(target.amount) || 0)) < 0.0001
    && String(entry.recordedAt || '') === String(target.recordedAt || '')
    && (!entryRecorder || !targetRecorder || entryRecorder === targetRecorder);
}

let collectorPaymentApprovalMutationQueue = Promise.resolve();

async function updateCollectorPaymentApprovalByIdUnlocked(req, rawEntryId, nextStatus) {
  const actor = getApprovalActor(req);
  const entryId = String(rawEntryId || '').trim();
  if (!entryId) throw createError(400, 'Payment entry ID is required.');
  const branchId = actor?.branchId || null;
  const decisionReason = sanitizeCollectorPaymentDecisionReason(
    req.body?.reason || req.body?.decisionReason || req.body?.note,
    nextStatus === COLLECTOR_PAYMENT_REJECTED_STATUS
  );
  const review = buildCollectorPaymentReview(actor, nextStatus, decisionReason);
  let gcashBinding = null;
  let replayedGcashApproval = false;

  if (await isRelationalReady()) {
    if (!branchId) {
      throw createError(400, 'Branch assignment missing for this admin account.');
    }
    await ensureCollectorPaymentReviewTable();
    let targetEntry = null;
    let targetAccountNumber = '';
    await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT
           id,
           account_number AS accountNumber,
           amount,
           date,
           kind,
           direction,
           reference,
           or_number AS orNumber,
           description,
           type,
           recorded_at AS recordedAt,
           recorded_by_user_id AS recordedByUserId,
           recorded_by_username AS recordedByUsername,
           recorded_by_name AS recordedByName,
           recorded_by_role AS recordedByRole,
           payer,
           status,
           payment_method AS paymentMethod,
           fingerprint,
           xendit_id AS xenditId
         FROM payment_entries
         WHERE branch_id = ?
           AND id = ?
         LIMIT 1
         FOR UPDATE`,
        [branchId, entryId]
      );
      const row = (rows || [])[0] || null;
      if (!row) throw createError(404, 'Pending collector payment was not found.');
      targetEntry = mapReceiptPaymentRow(row);
      targetAccountNumber = String(row.accountNumber || '').trim();
      if (!isCollectorCreditApprovalEntry(targetEntry)) {
        if (
          nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS
          && normalizeCollectorPaymentStatus(targetEntry.status) === COLLECTOR_PAYMENT_APPROVED_STATUS
          && normalizeKind(targetEntry.kind || targetEntry.type) === 'payment'
        ) {
          replayedGcashApproval = true;
          return;
        }
        throw createError(409, 'Collector payment is not pending approval.');
      }

      if (nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS) {
        gcashBinding = await prepareCollectorGcashApproval({
          actor,
          branchId,
          accountNumber: targetAccountNumber,
          entry: targetEntry
        });
      }

      const [updateResult] = await connection.query(
        `UPDATE payment_entries
         SET status = ?
         WHERE branch_id = ?
           AND id = ?
           AND LOWER(COALESCE(status, '')) = ?`,
        [nextStatus, branchId, entryId, COLLECTOR_PAYMENT_PENDING_STATUS]
      );
      if (Number(updateResult?.affectedRows || 0) !== 1) {
        throw createError(409, 'Collector payment is not pending approval.');
      }

      const pairedFingerprint = resolvePairedPrepaidChargeFingerprint(targetAccountNumber, targetEntry);
      if (pairedFingerprint) {
        await connection.query(
          `UPDATE payment_entries
           SET status = ?
           WHERE branch_id = ?
             AND account_number = ?
             AND fingerprint = ?
             AND LOWER(COALESCE(status, '')) = ?`,
          [nextStatus, branchId, targetAccountNumber, pairedFingerprint, COLLECTOR_PAYMENT_PENDING_STATUS]
        );
      }
      await writeRelationalCollectorPaymentReview(
        connection,
        review,
        entryId,
        branchId,
        targetAccountNumber
      );
    });
    if (replayedGcashApproval) {
      gcashBinding = await prepareCollectorGcashApproval({
        actor,
        branchId,
        accountNumber: targetAccountNumber,
        entry: targetEntry
      });
      if (!gcashBinding) throw createError(409, 'Collector payment is not pending approval.');
    }
    triggerBranchServiceRefresh(branchId, `collector-payment-${nextStatus}`);
    if (nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS) {
      await finalizeCollectorGcashApproval(gcashBinding);
    } else if (nextStatus === COLLECTOR_PAYMENT_REJECTED_STATUS) {
      await releaseCollectorGcashClaimAfterRejection({
        branchId,
        accountNumber: targetAccountNumber,
        entry: targetEntry
      });
    }
    return {
      record: mapCollectorPaymentApprovalItem(
        replayedGcashApproval ? targetEntry : { ...targetEntry, ...review },
        {},
        targetAccountNumber
      ),
      replayed: replayedGcashApproval
    };
  }

  const [customers, payments] = await Promise.all([
    readJson(STORE_KEYS.customers, []),
    readJson(STORE_KEYS.payments, {})
  ]);
  const customerMap = new Map(
    (Array.isArray(customers) ? customers : []).map((customer) => [
      String(customer?.accountNumber || '').trim(),
      customer
    ])
  );

  let targetAccount = '';
  let targetEntry = null;
  let targetHistory = null;
  for (const [accountNumber, bucket] of Object.entries(payments || {})) {
    const history = Array.isArray(bucket?.history) ? bucket.history : [];
    const entry = history.find((item) => String(item?.id || '').trim() === entryId);
    if (!entry) continue;
    targetAccount = String(accountNumber);
    targetEntry = entry;
    targetHistory = history;
    break;
  }
  if (!targetEntry || !targetHistory) throw createError(404, 'Pending collector payment was not found.');
  const targetCustomer = customerMap.get(targetAccount) || {};
  if (branchId && targetCustomer?.branchId && String(targetCustomer.branchId) !== String(branchId)) {
    throw createError(404, 'Pending collector payment was not found.');
  }
  if (!isCollectorCreditApprovalEntry(targetEntry)) {
    if (
      nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS
      && normalizeCollectorPaymentStatus(targetEntry.status) === COLLECTOR_PAYMENT_APPROVED_STATUS
      && normalizeKind(targetEntry.kind || targetEntry.type) === 'payment'
    ) {
      gcashBinding = await prepareCollectorGcashApproval({
        actor,
        branchId: branchId || targetCustomer?.branchId,
        accountNumber: targetAccount,
        entry: targetEntry
      });
      if (!gcashBinding) throw createError(409, 'Collector payment is not pending approval.');
      await finalizeCollectorGcashApproval(gcashBinding);
      return {
        record: mapCollectorPaymentApprovalItem(targetEntry, targetCustomer, targetAccount),
        replayed: true
      };
    }
    throw createError(409, 'Collector payment is not pending approval.');
  }

  if (nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS) {
    gcashBinding = await prepareCollectorGcashApproval({
      actor,
      branchId: branchId || targetCustomer?.branchId,
      accountNumber: targetAccount,
      entry: targetEntry
    });
  }

  Object.assign(targetEntry, review);
  const pairedFingerprint = resolvePairedPrepaidChargeFingerprint(targetAccount, targetEntry);
  targetHistory.forEach((entry) => {
    if (entry === targetEntry) return;
    if (isPairedPrepaidChargeEntry(entry, targetEntry, pairedFingerprint)) {
      Object.assign(entry, review, { reviewedBy: { ...review.reviewedBy } });
    }
  });
  await writeJson(STORE_KEYS.payments, payments);
  triggerBranchServiceRefresh(branchId || targetCustomer?.branchId || null, `collector-payment-${nextStatus}`);
  if (nextStatus === COLLECTOR_PAYMENT_APPROVED_STATUS) {
    await finalizeCollectorGcashApproval(gcashBinding);
  } else if (nextStatus === COLLECTOR_PAYMENT_REJECTED_STATUS) {
    await releaseCollectorGcashClaimAfterRejection({
      branchId: branchId || targetCustomer?.branchId,
      accountNumber: targetAccount,
      entry: targetEntry
    });
  }
  return {
    record: mapCollectorPaymentApprovalItem(targetEntry, targetCustomer, targetAccount),
    replayed: false
  };
}

async function updateCollectorPaymentApprovalById(req, rawEntryId, nextStatus) {
  const operation = collectorPaymentApprovalMutationQueue.then(() => (
    updateCollectorPaymentApprovalByIdUnlocked(req, rawEntryId, nextStatus)
  ));
  collectorPaymentApprovalMutationQueue = operation.catch(() => {});
  return operation;
}

async function updateCollectorPaymentApproval(req, nextStatus) {
  return updateCollectorPaymentApprovalById(req, req.params?.entryId, nextStatus);
}

async function approveCollectorPaymentApprovalsBatch(req) {
  const requestedIds = new Set(
    (Array.isArray(req.body?.entryIds) ? req.body.entryIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  let targetEntryIds = [...requestedIds];
  if (!targetEntryIds.length) {
    const { records } = await listCollectorPaymentApprovals(req);
    targetEntryIds = (Array.isArray(records) ? records : [])
      .map((record) => String(record?.id || '').trim())
      .filter(Boolean);
  }
  const errors = [];
  const approvedRecords = [];

  for (const entryId of targetEntryIds) {
    try {
      const result = await updateCollectorPaymentApprovalById(req, entryId, COLLECTOR_PAYMENT_APPROVED_STATUS);
      if (result?.record) approvedRecords.push(result.record);
    } catch (err) {
      let approvalError = err;
      if (err?.code === 'COLLECTOR_GCASH_FINALIZATION_PENDING') {
        try {
          const retry = await updateCollectorPaymentApprovalById(
            req,
            entryId,
            COLLECTOR_PAYMENT_APPROVED_STATUS
          );
          if (retry?.record) approvedRecords.push(retry.record);
          continue;
        } catch (retryError) {
          approvalError = retryError;
        }
      }
      const status = Number(approvalError?.status || approvalError?.statusCode || 0);
      if ([404, 409].includes(status)) {
        errors.push({
          id: entryId,
          code: String(approvalError?.code || '').trim() || null,
          error: approvalError.message || 'Collector payment was skipped.'
        });
        continue;
      }
      throw approvalError;
    }
  }

  const totalAmount = approvedRecords.reduce((sum, record) => sum + Math.abs(Number(record?.amount) || 0), 0);
  return {
    approved: approvedRecords.length,
    skipped: errors.length,
    totalAmount: Number(totalAmount.toFixed(2)),
    records: approvedRecords,
    errors: errors.slice(0, 25),
    firstError: errors[0] || null
  };
}

// GET /api/collector/payments/options
router.get('/options', async (req, res, next) => {
  try {
    const branchId = req.collector?.branchId || req.user?.branchId || null;
    const options = await readCollectorPaymentOptions(branchId);
    res.json({ ok: true, ...options });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load collector payment options'));
  }
});

// GET /api/collector/payments/reprint?reference=...&accountNumber=...
// Also accepts orNumber/ref/entryId. Returns a complete receipt payload for one exact payment.
router.get('/reprint', async (req, res, next) => {
  try {
    const lookup = resolveReceiptLookup(req);
    const branchId = req.collector?.branchId || req.user?.branchId || null;
    const excludedAccounts = req.collector
      ? await getActiveCollectorExclusionAccountSet(branchId || '1')
      : new Set();
    if (!branchId && await isRelationalReady()) {
      return next(createError(400, 'Branch assignment missing for the authenticated account.'));
    }

    if (await isRelationalReady()) {
      const params = [branchId];
      const where = ['pe.branch_id = ?'];
      if (lookup.accountNumber) {
        where.push('pe.account_number = ?');
        params.push(lookup.accountNumber);
      }

      const identityClauses = [];
      if (lookup.token) {
        identityClauses.push('pe.reference = ?');
        params.push(lookup.token);
        identityClauses.push('pe.or_number = ?');
        params.push(lookup.token);
        identityClauses.push('pe.id = ?');
        params.push(lookup.token);
      }
      if (lookup.entryId) {
        identityClauses.push('pe.id = ?');
        params.push(lookup.entryId);
      }
      where.push(`(${identityClauses.join(' OR ')})`);

      const [rows] = await query(
        `SELECT
           pe.id,
           pe.amount,
           pe.date,
           pe.kind,
           pe.direction,
           pe.reference,
           pe.or_number AS orNumber,
           pe.description,
           pe.type,
           pe.recorded_at AS recordedAt,
           pe.recorded_by_user_id AS recordedByUserId,
           pe.recorded_by_username AS recordedByUsername,
           pe.recorded_by_name AS recordedByName,
           pe.recorded_by_role AS recordedByRole,
           pe.payer,
           pe.status,
           pe.payment_method AS paymentMethod,
           pe.fingerprint,
           pe.xendit_id AS xenditId,
           c.account_number AS accountNumber,
           c.name AS customerName,
           c.first_name AS firstName,
           c.last_name AS lastName,
           c.area,
           c.map_pin AS mapPin,
           c.plan_name AS planName,
           c.plan_amount AS planAmount,
           c.plan_category AS planCategory,
           c.plan_billing AS planBilling,
           c.due_offset AS dueOffset,
           c.due_date AS dueDate
         FROM payment_entries pe
         INNER JOIN customers c
           ON c.branch_id = pe.branch_id
          AND c.account_number = pe.account_number
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(pe.recorded_at, CONCAT(pe.date, ' 00:00:00')) DESC, pe.id DESC
         LIMIT 50`,
        params
      );

      for (const row of rows || []) {
        const targetPayment = mapReceiptPaymentRow(row);
        if (!isReceiptPaymentEntry(targetPayment)) continue;
        const customer = buildReceiptCustomerFromRow(row);
        if (req.collector && excludedAccounts.has(String(customer.accountNumber || '').trim())) continue;
        if (req.collector && !await isCollectorAssignedToCustomer(branchId, req.collector.id, customer)) {
          continue;
        }

        const history = await readPaymentHistoryForReceipt(branchId, customer.accountNumber);
        const resolvedTarget = history.find((entry) => isSamePaymentEntry(entry, targetPayment)) || targetPayment;
        return res.json(await buildCollectorReceiptPayloadWithAdminBalance(customer, history, resolvedTarget, branchId));
      }

      return next(createError(404, 'Receipt payment was not found for this collector.'));
    }

    const collectorId = req.collector?.id ? String(req.collector.id) : '';
    const [customers, payments, collectorsData] = await Promise.all([
      readJson(STORE_KEYS.customers, []),
      readJson(STORE_KEYS.payments, {}),
      readJson(STORE_KEYS.collectors, { assignments: {} }).catch(() => ({ assignments: {} }))
    ]);
    const assignments = collectorsData?.assignments || {};
    for (const customer of Array.isArray(customers) ? customers : []) {
      const accountNumber = String(customer?.accountNumber || '').trim();
      if (!accountNumber) continue;
      if (lookup.accountNumber && accountNumber !== lookup.accountNumber) continue;
      if (req.collector && excludedAccounts.has(accountNumber)) continue;
      if (req.collector && !isJsonCollectorAssignedToCustomer(collectorId, assignments, customer)) continue;
      const rawHistory = Array.isArray(payments?.[accountNumber]?.history) ? payments[accountNumber].history : [];
      const history = rawHistory.map(mapReceiptPaymentRow);
      const targetPayment = history.find((entry) => isReceiptPaymentEntry(entry) && matchesReceiptLookup(entry, lookup));
      if (!targetPayment) continue;
      return res.json(await buildCollectorReceiptPayloadWithAdminBalance(customer, history, targetPayment, branchId));
    }

    return next(createError(404, 'Receipt payment was not found for this collector.'));
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load receipt reprint.'));
  }
});

// GET /api/collector/payments/remittances
// Collector sees own remittances; admin sees all JSON remittance submissions.
router.get('/remittances', async (req, res, next) => {
  try {
    const actor = getRemittanceActor(req);
    if (!req.collector) getApprovalActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const scoped = records.filter((record) => {
      if (req.collector && remittanceText(record.collectorId) !== actor.id) return false;
      if (req.collector && record?.archivedAt) return false;
      return !actor.branchId || !record?.branchId || remittanceText(record.branchId) === remittanceText(actor.branchId);
    });
    res.json({ ok: true, records: await hydrateRemittanceRecords(scoped) });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load remittances.'));
  }
});

// POST /api/collector/payments/remittances
// Body { paymentEntryIds: [{ paymentEntryId, accountNumber, reference, amount }], totalAmount? }
router.post('/remittances', async (req, res, next) => {
  try {
    if (!req.collector) {
      return next(createError(403, 'Collector access required to submit remittance.'));
    }
    const actor = getRemittanceActor(req);
    const rawItems = Array.isArray(req.body?.paymentEntryIds)
      ? req.body.paymentEntryIds
      : (Array.isArray(req.body?.payments) ? req.body.payments : []);
    const payments = rawItems
      .map(normalizeRemittancePayment)
      .filter((item) => item.paymentEntryId || item.reference || item.accountNumber);
    if (!payments.length) {
      return next(createError(400, 'At least one payment is required for remittance.'));
    }

    const hydratedSubmission = await hydrateRemittanceRecord({
      branchId: actor.branchId,
      payments
    });
    const ineligiblePayment = hydratedSubmission.payments.find((payment) => (
      payment?.canonicalFound !== true
      || normalizeCollectorPaymentStatus(payment?.status) !== COLLECTOR_PAYMENT_APPROVED_STATUS
    ));
    if (ineligiblePayment) {
      return next(createError(409, 'Only approved collector payments can be submitted for remittance.'));
    }

    const approvedPayments = hydratedSubmission.payments;
    const computedTotal = approvedPayments.reduce((sum, item) => sum + Math.max(Number(item.amount || 0), 0), 0);
    const requestedTotal = Number(req.body?.totalAmount);
    const totalAmount = Number((Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : computedTotal).toFixed(2));
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const paymentKeys = new Set(
      approvedPayments.map((item) => remittanceText(item.paymentEntryId || item.reference)).filter(Boolean)
    );
    const duplicatePending = records.some((record) => {
      const status = remittanceText(record.status || 'pending').toLowerCase();
      if (status === 'rejected') return false;
      return (Array.isArray(record.payments) ? record.payments : []).some((item) => {
        const key = remittanceText(item.paymentEntryId || item.reference);
        return key && paymentKeys.has(key);
      });
    });
    if (duplicatePending) {
      return next(createError(409, 'One or more payments are already submitted for remittance.'));
    }

    const submittedAt = new Date().toISOString();
    const record = {
      id: `remit-${actor.id || 'collector'}-${Date.now()}`,
      collectorId: actor.id,
      collectorName: actor.name || actor.username || 'Collector',
      branchId: actor.branchId,
      status: 'pending',
      payments: approvedPayments,
      totalAmount,
      submittedAt,
      submittedBy: actor,
      reviewedAt: null,
      reviewedBy: null,
      adminNote: ''
    };
    records.unshift(record);
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: submittedAt });
    res.status(201).json({ ok: true, record });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to submit remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/confirm
router.post('/remittances/:id/confirm', async (req, res, next) => {
  try {
    const admin = getApprovalActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    if (admin?.branchId && record?.branchId && remittanceText(admin.branchId) !== remittanceText(record.branchId)) {
      return next(createError(404, 'Remittance not found.'));
    }
    if (remittanceStatus(record.status) === 'remitted') {
      return res.json({
        ok: true,
        replayed: true,
        record: await hydrateRemittanceRecord(record),
        paymentApproval: { approved: 0, alreadyApproved: 0, rejected: 0, pending: 0, errors: [] }
      });
    }
    if (remittanceStatus(record.status) === 'rejected') {
      return next(createError(409, 'Rejected remittance must be resubmitted before confirmation.'));
    }

    const reviewedRecord = await hydrateRemittanceRecord(record);
    const paymentApproval = {
      approved: 0,
      alreadyApproved: 0,
      rejected: 0,
      pending: 0,
      errors: []
    };
    for (const payment of reviewedRecord.payments) {
      if (payment?.canonicalFound !== true) {
        paymentApproval.pending += 1;
        paymentApproval.errors.push({
          id: remittanceText(payment?.paymentEntryId),
          error: 'Canonical payment entry was not found.'
        });
        continue;
      }
      const status = normalizeCollectorPaymentStatus(payment?.status);
      if (status === COLLECTOR_PAYMENT_APPROVED_STATUS) {
        paymentApproval.alreadyApproved += 1;
        continue;
      }
      if (status === COLLECTOR_PAYMENT_REJECTED_STATUS) {
        paymentApproval.rejected += 1;
        continue;
      }
      paymentApproval.pending += 1;
    }

    if (reviewedRecord.paymentSummary.pending > 0 || paymentApproval.errors.length) {
      return next(createError(409, 'Complete Customer Payment Approval before confirming this cash remittance.'));
    }
    if (reviewedRecord.paymentSummary.approved < 1) {
      return next(createError(409, 'Remittance contains no approved payments to confirm.'));
    }

    const reviewer = getRemittanceActor(req);
    const reviewedAt = new Date().toISOString();
    if (!Number.isFinite(Number(record.originalTotalAmount))) {
      record.originalTotalAmount = Number(record.totalAmount || reviewedRecord.paymentSummary.totalAmount || 0);
    }
    record.status = 'remitted';
    record.payments = reviewedRecord.payments;
    record.totalAmount = reviewedRecord.paymentSummary.approvedAmount;
    record.rejectedTotalAmount = reviewedRecord.paymentSummary.rejectedAmount;
    record.reviewedAt = reviewedAt;
    record.reviewedBy = reviewer;
    record.adminNote = remittanceText(req.body?.adminNote || req.body?.note);
    record.updatedAt = reviewedAt;
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: reviewedAt });
    res.json({
      ok: true,
      replayed: false,
      record: await hydrateRemittanceRecord(record),
      paymentApproval
    });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to confirm remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/reject
router.post('/remittances/:id/reject', async (req, res, next) => {
  try {
    const admin = getApprovalActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    if (admin?.branchId && record?.branchId && remittanceText(admin.branchId) !== remittanceText(record.branchId)) {
      return next(createError(404, 'Remittance not found.'));
    }
    const reason = sanitizeCollectorPaymentDecisionReason(
      req.body?.adminNote || req.body?.note || req.body?.reason,
      true
    );
    if (remittanceStatus(record.status) === 'remitted') {
      return next(createError(409, 'Confirmed remittance cannot be rejected.'));
    }
    if (remittanceStatus(record.status) === 'rejected') {
      return res.json({ ok: true, replayed: true, record: await hydrateRemittanceRecord(record) });
    }
    const reviewer = getRemittanceActor(req);
    const reviewedAt = new Date().toISOString();
    record.status = 'rejected';
    record.reviewedAt = reviewedAt;
    record.reviewedBy = reviewer;
    record.adminNote = reason;
    record.updatedAt = reviewedAt;
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: reviewedAt });
    res.json({ ok: true, replayed: false, record: await hydrateRemittanceRecord(record) });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to reject remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/archive
// Admin-only, non-destructive archive for completed or rejected remittance records.
router.post('/remittances/:id/archive', async (req, res, next) => {
  try {
    const admin = getApprovalActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    if (admin?.branchId && record?.branchId && remittanceText(admin.branchId) !== remittanceText(record.branchId)) {
      return next(createError(404, 'Remittance not found.'));
    }
    if (record.archivedAt) {
      return res.json({ ok: true, replayed: true, record: await hydrateRemittanceRecord(record) });
    }
    if (remittanceStatus(record.status) === 'pending') {
      return next(createError(409, 'Pending remittance cannot be archived. Complete or reject it first.'));
    }

    const actor = getRemittanceActor(req);
    const archivedAt = new Date().toISOString();
    const auditEntry = { action: 'archived', at: archivedAt, by: actor };
    record.archivedAt = archivedAt;
    record.archivedBy = actor;
    record.archiveHistory = [...(Array.isArray(record.archiveHistory) ? record.archiveHistory : []), auditEntry];
    record.updatedAt = archivedAt;
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: archivedAt });
    res.json({ ok: true, replayed: false, record: await hydrateRemittanceRecord(record) });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to archive remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/restore
// Admin-only restore that preserves the archive audit history and financial record.
router.post('/remittances/:id/restore', async (req, res, next) => {
  try {
    const admin = getApprovalActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    if (admin?.branchId && record?.branchId && remittanceText(admin.branchId) !== remittanceText(record.branchId)) {
      return next(createError(404, 'Remittance not found.'));
    }
    if (!record.archivedAt) {
      return res.json({ ok: true, replayed: true, record: await hydrateRemittanceRecord(record) });
    }

    const actor = getRemittanceActor(req);
    const restoredAt = new Date().toISOString();
    const auditEntry = { action: 'restored', at: restoredAt, by: actor };
    record.archivedAt = null;
    record.archivedBy = null;
    record.restoredAt = restoredAt;
    record.restoredBy = actor;
    record.archiveHistory = [...(Array.isArray(record.archiveHistory) ? record.archiveHistory : []), auditEntry];
    record.updatedAt = restoredAt;
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: restoredAt });
    res.json({ ok: true, replayed: false, record: await hydrateRemittanceRecord(record) });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to restore remittance.'));
  }
});

// GET /api/collector/payments/approvals
// Admin-only list of collector payments waiting before they count in official collector totals.
router.get('/approvals', async (req, res, next) => {
  try {
    const result = await listCollectorPaymentApprovals(req);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load collector payment approvals.'));
  }
});

// POST /api/collector/payments/approvals/approve-all
// Admin-only batch approval for the pending payments reviewed in collectors.html.
router.post('/approvals/approve-all', async (req, res, next) => {
  try {
    const result = await approveCollectorPaymentApprovalsBatch(req);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to approve pending collector payments.'));
  }
});

// POST /api/collector/payments/approvals/:entryId/approve
router.post('/approvals/:entryId/approve', async (req, res, next) => {
  try {
    const result = await updateCollectorPaymentApproval(req, COLLECTOR_PAYMENT_APPROVED_STATUS);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to approve collector payment.'));
  }
});

// POST /api/collector/payments/approvals/:entryId/reject
router.post('/approvals/:entryId/reject', async (req, res, next) => {
  try {
    const result = await updateCollectorPaymentApproval(req, COLLECTOR_PAYMENT_REJECTED_STATUS);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to reject collector payment.'));
  }
});

// POST /api/collector/payments/:accountNumber
// body for admin auth: { collectorId, amount, date, reference, kind?/typeOfPayment?, description?, payer?, paymentMethod?, clientPaymentId? }
// body for collector token auth: { amount, date, reference, kind?/typeOfPayment?, description?, payer?, paymentMethod?, clientPaymentId? }
router.post('/:accountNumber', async (req, res, next) => {
  try {
    const { accountNumber } = req.params;
    const {
      collectorId: rawCollectorId,
      amount,
      date,
      kind: rawKind,
      reference = null,
      description = null,
      payer = null,
      paymentMethod = null,
      typeOfPayment = null,
      paymentType = null,
      type = null,
      method = null,
      clientPaymentId = null,
      localId = null,
      idempotencyKey = null,
    } = req.body || {};

    const authCollectorId = req.collector?.id ? String(req.collector.id) : '';
    const bodyCollectorId = rawCollectorId != null ? String(rawCollectorId) : '';
    const effectiveCollectorId = authCollectorId || bodyCollectorId;

    if (authCollectorId && bodyCollectorId && bodyCollectorId !== authCollectorId) {
      return next(createError(403, 'collectorId does not match the authenticated collector'));
    }

    if (!effectiveCollectorId) {
      return next(createError(401, 'collectorId is required'));
    }
    if (!accountNumber) {
      return next(createError(400, 'accountNumber is required'));
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return next(createError(400, 'amount must be a positive number'));
    }
    if (!date) {
      return next(createError(400, 'date is required'));
    }
    let normalizedReference;
    try {
      normalizedReference = requireCollectorReference(reference);
    } catch (referenceError) {
      return next(referenceError);
    }
    const requestedKind = rawKind || typeOfPayment || paymentType || type;
    const requestedKindNormalized = normalizeKind(requestedKind);
    let normalizedPaymentMethod;
    try {
      normalizedPaymentMethod = requestedKindNormalized === 'payment'
        ? sanitizePaymentMethod(paymentMethod || method)
        : '';
    } catch (paymentMethodError) {
      return next(paymentMethodError);
    }
    let normalizedClientPaymentId;
    try {
      normalizedClientPaymentId = sanitizeCollectorClientPaymentId(
        clientPaymentId || localId || idempotencyKey
      );
    } catch (clientPaymentIdError) {
      return next(clientPaymentIdError);
    }

    if (await isRelationalReady()) {
      const branchId = req.collector?.branchId || req.user?.branchId || null;
      if (!branchId) {
        return next(createError(400, 'Branch assignment missing for the authenticated account.'));
      }

      // Validate collector account
      const accounts = await loadAccounts();
      const collectorAccount = (accounts || []).find(
        (a) =>
          String(a.id) === String(effectiveCollectorId) &&
          accountHasRole(a, 'Collector') &&
          String(a.branchId || '') === String(branchId)
      );
      if (!collectorAccount) {
        return next(createError(403, 'Invalid collector account'));
      }

      const [customerRows] = await query(
        `SELECT
           c.account_number AS accountNumber,
           c.area,
           c.map_pin AS mapPin,
           c.plan_name AS planName,
           c.plan_amount AS planAmount,
           c.plan_category AS planCategory,
           c.plan_billing AS planBilling,
           c.bill_date AS billDate,
           c.due_offset AS dueOffset,
           c.due_date AS dueDate
         FROM customers c
         WHERE c.branch_id = ?
           AND c.account_number = ?
         LIMIT 1`,
        [branchId, accountNumber]
      );
      const customer = customerRows && customerRows.length ? customerRows[0] : null;
      if (!customer) {
        return next(createError(404, 'Customer not found'));
      }
      const [assignRows] = await query(
        'SELECT collector_user_id AS collectorId FROM collector_assignments WHERE branch_id = ? AND area_name = ?',
        [branchId, customer.area]
      );
      const assignedCollectors = (assignRows || []).map((row) => String(row.collectorId || '').trim()).filter(Boolean);
      if (assignedCollectors.length && !assignedCollectors.includes(String(effectiveCollectorId))) {
        return next(createError(403, 'Collector not assigned to this customer area'));
      }

      const kind = requestedKindNormalized;
      const direction = kind === 'charge' ? 'debit' : 'credit';
      const normalizedTypeOfPayment = normalizeTypeOfPayment(kind);
      const isPrepaid = isPrepaidCustomer(customer);

      const recorder = {
        id: String(collectorAccount.id),
        username: collectorAccount.username || collectorAccount.name || null,
        name: collectorAccount.name || collectorAccount.username || null,
        role: 'Collector',
      };

      const newEntry = {
        id: buildCollectorPaymentEntryId('pay', branchId, effectiveCollectorId, accountNumber, normalizedClientPaymentId),
        amount: numericAmount,
        date,
        kind,
        type: normalizedTypeOfPayment,
        reference: normalizedReference,
        description,
        direction,
        recordedAt: resolveRecordedAtValue(req.body?.recordedAt, date),
        recordedBy: recorder,
        payer: payer || recorder.name || recorder.username || null,
        status: COLLECTOR_PAYMENT_PENDING_STATUS,
        paymentMethod: normalizedPaymentMethod || undefined,
        typeOfPayment: normalizedTypeOfPayment,
        clientPaymentId: normalizedClientPaymentId || undefined,
        fingerprint: buildCollectorPaymentFingerprint(accountNumber, normalizedReference, kind, numericAmount),
      };

      const shouldAutoCharge = isPrepaid && kind === 'payment';
      const chargeEntry = shouldAutoCharge ? {
        id: buildCollectorPaymentEntryId('charge', branchId, effectiveCollectorId, accountNumber, normalizedClientPaymentId),
        amount: numericAmount,
        date,
        kind: 'charge',
        type: 'debit',
        reference: undefined,
        description: 'Prepaid renewal charge',
        direction: 'debit',
        recordedAt: newEntry.recordedAt,
        recordedBy: recorder,
        payer: newEntry.payer,
        status: COLLECTOR_PAYMENT_PENDING_STATUS,
        paymentMethod: normalizedPaymentMethod || undefined,
        typeOfPayment: 'debit',
        fingerprint: buildCollectorPaymentFingerprint(accountNumber, normalizedReference, 'charge', numericAmount),
      } : null;

      let storedPayment = null;
      let replayed = false;
      try {
        await withTransaction(async (connection) => {
          storedPayment = await findRelationalCollectorPaymentSubmission(
            connection,
            branchId,
            accountNumber,
            newEntry
          );
          if (storedPayment) {
            replayed = true;
            return;
          }
          await assignEntryNumbers(connection, newEntry);
          await assertEntryNumbersAvailable(connection, branchId, newEntry);
          await insertPaymentEntry(newEntry, branchId, accountNumber, connection);
          if (chargeEntry) {
            await assignEntryNumbers(connection, chargeEntry);
            await assertEntryNumbersAvailable(connection, branchId, chargeEntry);
            await insertPaymentEntry(chargeEntry, branchId, accountNumber, connection);
          }
          storedPayment = newEntry;
        });
      } catch (error) {
        const status = Number(error?.status || error?.statusCode || 0);
        if (status !== 409) throw error;
        const duplicate = await findRelationalCollectorPaymentSubmission(
          null,
          branchId,
          accountNumber,
          newEntry
        );
        if (!duplicate) throw error;
        storedPayment = duplicate;
        replayed = true;
      }
      if (!replayed) triggerBranchServiceRefresh(branchId, 'collector-payments');
      await upsertAutomaticRemittanceBatch(storedPayment, {
        accountNumber,
        customerName: resolveCustomerDisplayName(customer, accountNumber),
        collectorId: collectorAccount.id,
        collectorUsername: collectorAccount.username,
        collectorName: collectorAccount.name || collectorAccount.username,
        branchId
      });

      const receiptHistory = await readPaymentHistoryForReceipt(branchId, accountNumber);
      const receiptPayload = await buildCollectorReceiptPayloadWithAdminBalance(
        customer,
        receiptHistory,
        storedPayment,
        branchId
      );
      return res.status(replayed ? 200 : 201).json({
        ...storedPayment,
        ...receiptPayload,
        id: storedPayment.id,
        created: !replayed,
        replayed,
      });
    }

    // JSON fallback
    // Validate collector account
    const accounts = await loadAccounts();
    const collectorAccount = (accounts || []).find(
      (a) => String(a.id) === String(effectiveCollectorId) && accountHasRole(a, 'Collector')
    );
    if (!collectorAccount) {
      return next(createError(403, 'Invalid collector account'));
    }

    // Validate assignment: accountNumber must belong to an area assigned to this collector
    const customers = await readJson(STORE_KEYS.customers, []);
    const customer = customers.find((c) => String(c.accountNumber) === String(accountNumber));
    if (!customer) {
      return next(createError(404, 'Customer not found'));
    }
    const collectorsData = await readJson(STORE_KEYS.collectors, { assignments: {} });
    const assignments = collectorsData.assignments || {};
    const assignedRaw = assignments[customer.area];
    const assignedCollectors = (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw])
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    if (assignedCollectors.length && !assignedCollectors.includes(String(effectiveCollectorId))) {
      return next(createError(403, 'Collector not assigned to this customer area'));
    }

    const payments = await readJson(STORE_KEYS.payments, {});
    if (!payments[accountNumber]) {
      payments[accountNumber] = { history: [] };
    }

    const kind = requestedKindNormalized;
    const direction = kind === 'charge' ? 'debit' : 'credit';
    const normalizedTypeOfPayment = normalizeTypeOfPayment(kind);
    const isPrepaid = isPrepaidCustomer(customer);

    const recorder = {
      id: String(collectorAccount.id),
      username: collectorAccount.username || collectorAccount.name || null,
      name: collectorAccount.name || collectorAccount.username || null,
      role: 'Collector',
    };

    const newEntry = {
      id: buildCollectorPaymentEntryId(
        'pay',
        collectorAccount.branchId || customer?.branchId || '',
        effectiveCollectorId,
        accountNumber,
        normalizedClientPaymentId
      ),
      accountNumber: String(accountNumber),
      amount: numericAmount,
      date,
      kind,
      type: normalizedTypeOfPayment,
      reference: normalizedReference,
      description,
      direction,
      recordedAt: resolveRecordedAtValue(req.body?.recordedAt, date),
      recordedBy: recorder,
      payer: payer || recorder.name || recorder.username || null,
      status: COLLECTOR_PAYMENT_PENDING_STATUS,
      paymentMethod: normalizedPaymentMethod || undefined,
      typeOfPayment: normalizedTypeOfPayment,
      clientPaymentId: normalizedClientPaymentId || undefined,
      fingerprint: buildCollectorPaymentFingerprint(accountNumber, normalizedReference, kind, numericAmount),
    };
    const normalizedReferenceKey = String(normalizedReference || '').trim().toLowerCase();
    let duplicateEntry = null;
    let duplicateAccountNumber = '';
    let duplicateHistory = [];
    Object.entries(payments || {}).some(([candidateAccountNumber, bucket]) => {
      const history = Array.isArray(bucket?.history) ? bucket.history : [];
      const match = history.find((entry) => {
        const entryReference = String(entry?.reference || entry?.orNumber || '').trim().toLowerCase();
        const entryFingerprint = String(entry?.fingerprint || '').trim().toLowerCase();
        return (
          String(entry?.id || '').trim() === newEntry.id ||
          (normalizedReferenceKey && entryReference === normalizedReferenceKey) ||
          (entryFingerprint && entryFingerprint === newEntry.fingerprint)
        );
      });
      if (!match) return false;
      duplicateEntry = match;
      duplicateAccountNumber = String(candidateAccountNumber);
      duplicateHistory = history;
      return true;
    });
    if (duplicateEntry) {
      const existingWithAccount = { ...duplicateEntry, accountNumber: duplicateAccountNumber };
      if (!collectorPaymentEntriesMatch(existingWithAccount, newEntry, accountNumber)) {
        return next(createError(409, `Reference already exists with different payment details: ${normalizedReference}`));
      }
      await upsertAutomaticRemittanceBatch(duplicateEntry, {
        accountNumber: duplicateAccountNumber,
        customerName: resolveCustomerDisplayName(customer, duplicateAccountNumber),
        collectorId: collectorAccount.id,
        collectorUsername: collectorAccount.username,
        collectorName: collectorAccount.name || collectorAccount.username,
        branchId: collectorAccount.branchId || customer?.branchId || null
      });
      const receiptPayload = await buildCollectorReceiptPayloadWithAdminBalance(
        customer,
        duplicateHistory,
        duplicateEntry,
        collectorAccount.branchId || customer?.branchId || null
      );
      return res.status(200).json({
        ...duplicateEntry,
        ...receiptPayload,
        id: duplicateEntry.id,
        created: false,
        replayed: true,
      });
    }

    const shouldAutoCharge = isPrepaid && kind === 'payment';
    const chargeEntry = shouldAutoCharge ? {
      id: buildCollectorPaymentEntryId(
        'charge',
        collectorAccount.branchId || customer?.branchId || '',
        effectiveCollectorId,
        accountNumber,
        normalizedClientPaymentId
      ),
      amount: numericAmount,
      date,
      kind: 'charge',
      type: 'debit',
      reference: undefined,
      description: 'Prepaid renewal charge',
      direction: 'debit',
      recordedAt: newEntry.recordedAt,
      recordedBy: recorder,
      payer: newEntry.payer,
      status: COLLECTOR_PAYMENT_PENDING_STATUS,
      paymentMethod: normalizedPaymentMethod || undefined,
      typeOfPayment: 'debit',
      fingerprint: buildCollectorPaymentFingerprint(accountNumber, normalizedReference, 'charge', numericAmount),
    } : null;

    payments[accountNumber].history = payments[accountNumber].history || [];
    if (chargeEntry) {
      payments[accountNumber].history.unshift(newEntry, chargeEntry);
    } else {
      payments[accountNumber].history.unshift(newEntry);
    }

    await writeJson(STORE_KEYS.payments, payments);
    await upsertAutomaticRemittanceBatch(newEntry, {
      accountNumber,
      customerName: resolveCustomerDisplayName(customer, accountNumber),
      collectorId: collectorAccount.id,
      collectorUsername: collectorAccount.username,
      collectorName: collectorAccount.name || collectorAccount.username,
      branchId: collectorAccount.branchId || customer?.branchId || null
    });
    triggerBranchServiceRefresh(collectorAccount.branchId || customer?.branchId || null, 'collector-payments');
    const receiptPayload = await buildCollectorReceiptPayloadWithAdminBalance(
      customer,
      payments[accountNumber].history,
      newEntry,
      collectorAccount.branchId || null
    );
    res.status(201).json({
      ...newEntry,
      ...receiptPayload,
      id: newEntry.id,
      created: true,
      replayed: false,
    });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to record payment'));
  }
});

module.exports = router;
