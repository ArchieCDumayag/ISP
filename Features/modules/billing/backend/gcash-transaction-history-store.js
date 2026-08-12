const crypto = require('crypto');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');

const GCASH_TRANSACTION_HISTORY_STORE_KEY = 'gcash_transaction_history';
const EMPTY_STORE = Object.freeze({ version: 2, branches: {} });
let mutationQueue = Promise.resolve();

const toSafeText = (value, maxLength = 0) => {
    const text = String(value == null ? '' : value).trim();
    return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const normalizeReference = (value) => toSafeText(value, 64).toUpperCase().replace(/[\s-]+/g, '');
const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('63') && digits.length === 12) return `0${digits.slice(2)}`;
    return digits;
};
const phoneMatches = (left, right) => {
    const normalizedLeft = normalizePhone(left);
    const normalizedRight = normalizePhone(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return normalizedLeft === normalizedRight || normalizedLeft.slice(-10) === normalizedRight.slice(-10);
};
const normalizeDateOnly = (value) => {
    const raw = toSafeText(value, 40);
    const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct) return direct[1];
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
};
const normalizeMoney = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const normalizeStore = (payload) => ({
    version: 2,
    branches: payload?.branches && typeof payload.branches === 'object' ? payload.branches : {}
});

const readHistoryStore = async () => normalizeStore(
    await readJson(GCASH_TRANSACTION_HISTORY_STORE_KEY, EMPTY_STORE)
);

const mutateHistoryStore = (mutation) => {
    const operation = mutationQueue.catch(() => {}).then(async () => {
        const store = await readHistoryStore();
        const result = await mutation(store);
        await writeJson(GCASH_TRANSACTION_HISTORY_STORE_KEY, store);
        return result;
    });
    mutationQueue = operation.catch(() => {});
    return operation;
};

const getBranchBucket = (store, branchId) => {
    const key = String(branchId);
    const existing = store.branches[key];
    if (!existing || typeof existing !== 'object') {
        store.branches[key] = { batches: [], transactions: [], updatedAt: null };
    }
    const bucket = store.branches[key];
    if (!Array.isArray(bucket.batches)) bucket.batches = [];
    if (!Array.isArray(bucket.transactions)) bucket.transactions = [];
    return bucket;
};

const sanitizeAssignment = (value) => {
    if (!value || typeof value !== 'object') return null;
    const submissionId = toSafeText(value.submissionId, 64);
    const accountNumber = toSafeText(value.accountNumber, 20);
    if (!submissionId || !accountNumber) return null;
    return {
        status: value.status === 'posted' ? 'posted' : 'claimed',
        submissionId,
        accountNumber,
        customerName: toSafeText(value.customerName, 200),
        amount: normalizeMoney(value.amount),
        paymentDate: normalizeDateOnly(value.paymentDate) || null,
        claimedAt: toSafeText(value.claimedAt, 40) || null,
        claimedBy: {
            id: toSafeText(value.claimedBy?.id, 32) || null,
            username: toSafeText(value.claimedBy?.username, 100) || null,
            name: toSafeText(value.claimedBy?.name, 120) || null
        },
        paymentEntryId: toSafeText(value.paymentEntryId, 64) || null,
        postedAt: toSafeText(value.postedAt, 40) || null
    };
};

const normalizeImportedTransaction = (row, batchId) => ({
    id: `gct-${crypto.randomUUID()}`,
    batchId,
    reference: normalizeReference(row?.reference),
    transactionAt: toSafeText(row?.transactionAt, 32),
    transactionDate: normalizeDateOnly(row?.transactionDate || row?.transactionAt),
    description: toSafeText(row?.description, 500),
    sender: normalizePhone(row?.sender),
    recipient: normalizePhone(row?.recipient),
    debit: normalizeMoney(row?.debit),
    credit: normalizeMoney(row?.credit),
    balance: normalizeMoney(row?.balance),
    status: Number(row?.credit) > 0 ? 'received' : 'debit',
    pageNumber: Number(row?.pageNumber) || 1,
    assignment: null
});

const transactionSignature = (row) => [
    normalizeReference(row?.reference),
    normalizeDateOnly(row?.transactionDate || row?.transactionAt),
    normalizeMoney(row?.debit),
    normalizeMoney(row?.credit),
    normalizePhone(row?.recipient)
].join('|');

const importGcashTransactionBatch = async ({
    branchId,
    fileName,
    pdfSha256,
    parsed,
    importedBy
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch assignment is required.');
    }
    const safeHash = toSafeText(pdfSha256, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(safeHash)) {
        throw createError(400, 'A valid PDF fingerprint is required.');
    }
    const sourceRows = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
    if (!sourceRows.length) throw createError(422, 'No GCash transactions are available to import.');

    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        if (bucket.batches.some((batch) => String(batch?.pdfSha256 || '') === safeHash)) {
            const error = createError(409, 'This GCash Transaction History PDF has already been imported.');
            error.code = 'DUPLICATE_GCASH_HISTORY_PDF';
            throw error;
        }

        const batchId = `gch-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
        const importedRows = sourceRows.map((row) => normalizeImportedTransaction(row, batchId));
        const seenInBatch = new Map();
        importedRows.forEach((row) => {
            if (!row.reference || !row.transactionDate) {
                throw createError(422, 'A GCash transaction row is missing its reference or date.');
            }
            const signature = transactionSignature(row);
            if (seenInBatch.has(row.reference) && seenInBatch.get(row.reference) !== signature) {
                throw createError(409, `Conflicting rows use GCash reference ${row.reference}.`);
            }
            seenInBatch.set(row.reference, signature);
        });

        const existingByReference = new Map(bucket.transactions.map((row) => [normalizeReference(row?.reference), row]));
        const newRows = [];
        let duplicateCount = 0;
        importedRows.forEach((row) => {
            const existing = existingByReference.get(row.reference);
            if (!existing) {
                newRows.push(row);
                existingByReference.set(row.reference, row);
                return;
            }
            if (transactionSignature(existing) !== transactionSignature(row)) {
                const error = createError(409, `Imported details conflict with the existing GCash reference ${row.reference}.`);
                error.code = 'CONFLICTING_GCASH_REFERENCE';
                throw error;
            }
            duplicateCount += 1;
        });

        const importedAt = new Date().toISOString();
        const batch = {
            id: batchId,
            fileName: toSafeText(fileName, 180) || 'gcash-transaction-history.pdf',
            pdfSha256: safeHash,
            statementFrom: normalizeDateOnly(parsed?.statementFrom) || null,
            statementTo: normalizeDateOnly(parsed?.statementTo) || null,
            pageCount: Number(parsed?.pageCount) || 1,
            sourceRowCount: importedRows.length,
            importedCount: newRows.length,
            duplicateCount,
            importedAt,
            importedBy: {
                id: toSafeText(importedBy?.id, 32) || null,
                username: toSafeText(importedBy?.username, 100) || null,
                name: toSafeText(importedBy?.name, 120) || null
            }
        };
        bucket.transactions.push(...newRows);
        bucket.batches.push(batch);
        bucket.updatedAt = importedAt;
        return { batch, transactions: newRows, duplicateCount };
    });
};

const listGcashTransactionHistory = async ({ branchId, limit = 200, all = false } = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch assignment is required.');
    }
    const store = await readHistoryStore();
    const bucket = getBranchBucket(store, safeBranchId);
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const sortedTransactions = bucket.transactions.map((transaction) => ({
        ...transaction,
        assignment: sanitizeAssignment(transaction?.assignment)
    })).sort((a, b) => String(b.transactionAt).localeCompare(String(a.transactionAt)));
    return {
        batches: bucket.batches.slice().sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))),
        transactions: all ? sortedTransactions : sortedTransactions.slice(0, safeLimit),
        totalTransactions: bucket.transactions.length,
        updatedAt: bucket.updatedAt || null
    };
};

const matchResult = (status, message, checks = {}, transaction = null) => ({
    matched: ['matched', 'matched_payer_mismatch', 'matched_payer_unavailable'].includes(status),
    status,
    message,
    checks,
    transaction: transaction ? {
        reference: transaction.reference,
        amount: normalizeMoney(transaction.credit),
        transactionAt: transaction.transactionAt,
        sender: transaction.sender,
        recipient: transaction.recipient,
        batchId: transaction.batchId,
        assignment: sanitizeAssignment(transaction.assignment)
    } : null
});

const evaluateGcashTransactionMatch = ({
    transactions = [],
    reference,
    amount,
    paymentDate,
    merchantNumber,
    customerPhone = '',
    accountNumber = '',
    submissionId = ''
} = {}) => {
    const normalizedReference = normalizeReference(reference);
    if (!normalizedReference) return matchResult('reference_missing', 'Reference number is required.');
    const transaction = transactions.find((row) => normalizeReference(row?.reference) === normalizedReference);
    if (!transaction) return matchResult('reference_not_found', 'Reference is not in the imported GCash history.');

    const assignment = sanitizeAssignment(transaction.assignment);
    const claimantAccount = toSafeText(accountNumber, 20);
    const claimantSubmission = toSafeText(submissionId, 64);
    if (assignment && (
        !claimantAccount
        || !claimantSubmission
        || assignment.accountNumber !== claimantAccount
        || assignment.submissionId !== claimantSubmission
    )) {
        return matchResult(
            'already_assigned',
            `This GCash transaction is already assigned to account ${assignment.accountNumber}.`,
            { assignmentAvailable: false },
            transaction
        );
    }

    const creditedAmount = normalizeMoney(transaction.credit);
    const expectedAmount = normalizeMoney(amount);
    const expectedDate = normalizeDateOnly(paymentDate);
    const transactionDate = normalizeDateOnly(transaction.transactionDate || transaction.transactionAt);
    const checks = {
        reference: true,
        received: transaction.status === 'received' && Number(creditedAmount) > 0,
        amount: expectedAmount != null && creditedAmount === expectedAmount,
        date: Boolean(expectedDate && transactionDate === expectedDate),
        recipient: phoneMatches(transaction.recipient, merchantNumber),
        payer: transaction.sender && normalizePhone(customerPhone)
            ? phoneMatches(transaction.sender, customerPhone)
            : null,
        assignmentAvailable: true
    };

    if (!checks.received) return matchResult('not_received', 'The reference is not an incoming GCash credit.', checks, transaction);
    if (!checks.amount) return matchResult('amount_mismatch', 'The submitted amount does not match the imported GCash credit.', checks, transaction);
    if (!expectedDate) return matchResult('date_missing', 'The submitted payment date is missing or invalid.', checks, transaction);
    if (!checks.date) return matchResult('date_mismatch', 'The submitted date does not match the imported GCash transaction.', checks, transaction);
    if (!normalizePhone(merchantNumber)) return matchResult('merchant_not_configured', 'Configure the GCash merchant number in Admin Accounts.', checks, transaction);
    if (!transaction.recipient) return matchResult('recipient_unavailable', 'The imported row does not identify a recipient.', checks, transaction);
    if (!checks.recipient) return matchResult('recipient_mismatch', 'The imported recipient does not match the configured GCash merchant number.', checks, transaction);
    if (checks.payer === false) {
        return matchResult(
            'matched_payer_mismatch',
            'Official transaction details match, but the sender number differs from the customer mobile. Verify who paid before approval.',
            checks,
            transaction
        );
    }
    if (checks.payer == null) {
        return matchResult(
            'matched_payer_unavailable',
            'Official transaction details match. Sender ownership could not be confirmed, so verify the customer assignment before approval.',
            checks,
            transaction
        );
    }
    return matchResult('matched', 'Reference, credited amount, date, recipient, and registered customer mobile match.', checks, transaction);
};

const createAssignmentConflictError = (assignment) => {
    const safeAssignment = sanitizeAssignment(assignment);
    const error = createError(
        409,
        safeAssignment
            ? `This GCash transaction is already assigned to account ${safeAssignment.accountNumber}.`
            : 'This GCash transaction is already assigned.'
    );
    error.code = 'GCASH_TRANSACTION_ALREADY_ASSIGNED';
    error.assignment = safeAssignment;
    return error;
};

const claimGcashTransaction = async ({
    branchId,
    reference,
    submissionId,
    accountNumber,
    customerName,
    amount,
    paymentDate,
    claimedBy
} = {}) => {
    const safeBranchId = Number(branchId);
    const safeReference = normalizeReference(reference);
    const safeSubmissionId = toSafeText(submissionId, 64);
    const safeAccountNumber = toSafeText(accountNumber, 20);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    if (!safeReference) throw createError(400, 'GCash reference number is required.');
    if (!safeSubmissionId || !safeAccountNumber) throw createError(400, 'Submission and customer account are required.');

    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === safeReference);
        if (!transaction) throw createError(409, 'Reference is not in the imported GCash history.');
        const currentAssignment = sanitizeAssignment(transaction.assignment);
        if (currentAssignment) {
            if (
                currentAssignment.submissionId === safeSubmissionId
                && currentAssignment.accountNumber === safeAccountNumber
            ) {
                return { transaction: { ...transaction, assignment: currentAssignment }, assignment: currentAssignment, idempotent: true };
            }
            throw createAssignmentConflictError(currentAssignment);
        }

        const claimedAt = new Date().toISOString();
        const assignment = sanitizeAssignment({
            status: 'claimed',
            submissionId: safeSubmissionId,
            accountNumber: safeAccountNumber,
            customerName,
            amount,
            paymentDate,
            claimedAt,
            claimedBy
        });
        transaction.assignment = assignment;
        bucket.updatedAt = claimedAt;
        return { transaction: { ...transaction, assignment }, assignment, idempotent: false };
    });
};

const finalizeGcashTransactionAssignment = async ({
    branchId,
    reference,
    submissionId,
    accountNumber,
    paymentEntryId
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    const safePaymentEntryId = toSafeText(paymentEntryId, 64);
    if (!safePaymentEntryId) throw createError(400, 'Payment entry ID is required to finalize the GCash assignment.');
    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === normalizeReference(reference));
        if (!transaction) throw createError(409, 'Reference is not in the imported GCash history.');
        const assignment = sanitizeAssignment(transaction.assignment);
        if (!assignment) throw createError(409, 'This GCash transaction has not been assigned.');
        if (
            assignment.submissionId !== toSafeText(submissionId, 64)
            || assignment.accountNumber !== toSafeText(accountNumber, 20)
        ) {
            throw createAssignmentConflictError(assignment);
        }
        const postedAt = new Date().toISOString();
        const finalized = sanitizeAssignment({
            ...assignment,
            status: 'posted',
            paymentEntryId: safePaymentEntryId,
            postedAt
        });
        transaction.assignment = finalized;
        bucket.updatedAt = postedAt;
        return { transaction: { ...transaction, assignment: finalized }, assignment: finalized };
    });
};

const releaseGcashTransactionClaim = async ({ branchId, reference, submissionId, accountNumber } = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) return false;
    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === normalizeReference(reference));
        if (!transaction) return false;
        const assignment = sanitizeAssignment(transaction.assignment);
        if (!assignment || assignment.status === 'posted' || assignment.paymentEntryId) return false;
        if (
            assignment.submissionId !== toSafeText(submissionId, 64)
            || assignment.accountNumber !== toSafeText(accountNumber, 20)
        ) return false;
        transaction.assignment = null;
        bucket.updatedAt = new Date().toISOString();
        return true;
    });
};

module.exports = {
    GCASH_TRANSACTION_HISTORY_STORE_KEY,
    importGcashTransactionBatch,
    listGcashTransactionHistory,
    evaluateGcashTransactionMatch,
    claimGcashTransaction,
    finalizeGcashTransactionAssignment,
    releaseGcashTransactionClaim,
    sanitizeAssignment,
    normalizeReference,
    normalizePhone,
    phoneMatches,
    transactionSignature
};
