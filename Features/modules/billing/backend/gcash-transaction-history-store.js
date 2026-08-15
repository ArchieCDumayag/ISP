const crypto = require('crypto');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');

const GCASH_TRANSACTION_HISTORY_STORE_KEY = 'gcash_transaction_history';
const EMPTY_STORE = Object.freeze({ version: 2, branches: {} });
const GCASH_RECIPIENT_LABELS = Object.freeze({
    '09361565251': 'Gcash - Archie',
    '09651404623': 'Gcash - Frances'
});
const GCASH_TRANSACTION_REMARKS = Object.freeze({
    expense_unclassified: 'Expense — Unclassified',
    operating_expense: 'Operating Expense',
    transfer: 'Transfer',
    refund: 'Refund',
    personal_other: 'Personal/Other'
});
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
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};
const normalizeBillingMonth = (value) => {
    const match = toSafeText(value, 7).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    return match ? match[0] : '';
};
const getGcashRecipientLabel = (value) => GCASH_RECIPIENT_LABELS[normalizePhone(value)] || '';
const normalizeRemarkCategory = (value) => {
    const category = toSafeText(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
    return Object.hasOwn(GCASH_TRANSACTION_REMARKS, category) ? category : '';
};

const sanitizeRemark = (value) => {
    if (!value || typeof value !== 'object') return null;
    const category = normalizeRemarkCategory(value.category);
    if (!category) return null;
    return {
        category,
        label: GCASH_TRANSACTION_REMARKS[category],
        updatedAt: toSafeText(value.updatedAt, 40) || null,
        updatedBy: {
            id: toSafeText(value.updatedBy?.id, 32) || null,
            username: toSafeText(value.updatedBy?.username, 100) || null,
            name: toSafeText(value.updatedBy?.name, 120) || null
        }
    };
};

const buildRemark = (category, updatedBy, updatedAt = new Date().toISOString()) => sanitizeRemark({
    category,
    updatedAt,
    updatedBy
});

const getTransactionRemark = (transaction) => (
    sanitizeRemark(transaction?.remark)
    || (String(transaction?.status || '').toLowerCase() === 'debit'
        ? buildRemark('expense_unclassified', transaction?.importedBy || {}, transaction?.importedAt || null)
        : null)
);

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

const sanitizeAssignmentAllocation = (value) => {
    if (!value || typeof value !== 'object') return null;
    const accountNumber = toSafeText(value.accountNumber, 20);
    const amount = normalizeMoney(value.amount);
    if (!accountNumber || amount == null || amount <= 0) return null;
    return {
        accountNumber,
        customerName: toSafeText(value.customerName, 200),
        amount,
        billingMonth: normalizeBillingMonth(value.billingMonth) || null,
        paymentEntryId: toSafeText(value.paymentEntryId, 64) || null
    };
};

const sanitizeAssignment = (value) => {
    if (!value || typeof value !== 'object') return null;
    const submissionId = toSafeText(value.submissionId, 64);
    const legacyAllocation = sanitizeAssignmentAllocation(value);
    const suppliedAllocations = Array.isArray(value.allocations)
        ? value.allocations.map(sanitizeAssignmentAllocation).filter(Boolean).slice(0, 3)
        : [];
    const allocations = suppliedAllocations.length ? suppliedAllocations : (legacyAllocation ? [legacyAllocation] : []);
    if (!submissionId || !allocations.length) return null;
    const singleAllocation = allocations.length === 1 ? allocations[0] : null;
    const paymentEntryIds = allocations.map((allocation) => allocation.paymentEntryId).filter(Boolean);
    const allocationTotal = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
    return {
        status: value.status === 'posted' ? 'posted' : 'claimed',
        submissionId,
        accountNumber: singleAllocation?.accountNumber || '',
        customerName: singleAllocation?.customerName || '',
        amount: normalizeMoney(value.amount) ?? Number(allocationTotal.toFixed(2)),
        paymentDate: normalizeDateOnly(value.paymentDate) || null,
        billingMonth: singleAllocation?.billingMonth || null,
        allocations,
        claimedAt: toSafeText(value.claimedAt, 40) || null,
        claimedBy: {
            id: toSafeText(value.claimedBy?.id, 32) || null,
            username: toSafeText(value.claimedBy?.username, 100) || null,
            name: toSafeText(value.claimedBy?.name, 120) || null
        },
        paymentEntryId: singleAllocation?.paymentEntryId || null,
        paymentEntryIds,
        postedAt: toSafeText(value.postedAt, 40) || null
    };
};

const sanitizeAssignmentAuditEntry = (value) => {
    if (!value || typeof value !== 'object') return null;
    const auditId = toSafeText(value.auditId, 64);
    const paymentEntryId = toSafeText(value.paymentEntryId, 64);
    const action = ['assigned', 'released', 'reassigned'].includes(value.action)
        ? value.action
        : '';
    if (!auditId || !paymentEntryId || !action) return null;
    return {
        auditId,
        action,
        paymentEntryId,
        fromReference: normalizeReference(value.fromReference) || null,
        toReference: normalizeReference(value.toReference) || null,
        sourceAccountNumber: toSafeText(value.sourceAccountNumber, 20) || null,
        targetAccountNumber: toSafeText(value.targetAccountNumber, 20) || null,
        editedAt: toSafeText(value.editedAt, 40) || null,
        editedBy: {
            id: toSafeText(value.editedBy?.id, 32) || null,
            username: toSafeText(value.editedBy?.username, 100) || null,
            name: toSafeText(value.editedBy?.name, 120) || null
        }
    };
};

const sanitizeAssignmentAudit = (value) => (Array.isArray(value) ? value : [])
    .map(sanitizeAssignmentAuditEntry)
    .filter(Boolean)
    .slice(-100);

const appendAssignmentAudit = (transaction, value) => {
    const audit = sanitizeAssignmentAuditEntry(value);
    if (!audit) return;
    const history = sanitizeAssignmentAudit(transaction?.assignmentAudit);
    if (!history.some((entry) => entry.auditId === audit.auditId && entry.action === audit.action)) {
        history.push(audit);
    }
    transaction.assignmentAudit = history.slice(-100);
};

const assignmentAllocationSignature = (allocations = []) => allocations
    .map((allocation) => [
        toSafeText(allocation?.accountNumber, 20),
        normalizeBillingMonth(allocation?.billingMonth),
        normalizeMoney(allocation?.amount)
    ].join('|'))
    .sort()
    .join('||');

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
    assignment: null,
    assignmentAudit: [],
    remark: null
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
        const duplicatePdfBatch = bucket.batches.find((batch) => String(batch?.pdfSha256 || '') === safeHash) || null;

        const batchId = `gch-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
        const importedRows = sourceRows.map((row) => normalizeImportedTransaction(row, batchId));
        importedRows.forEach((row) => {
            if (!row.reference || !row.transactionDate) {
                throw createError(422, 'A GCash transaction row is missing its reference or date.');
            }
        });

        const existingByReference = new Map(bucket.transactions.map((row) => [normalizeReference(row?.reference), row]));
        const newRows = [];
        let duplicateCount = 0;
        let conflictingDuplicateCount = 0;
        importedRows.forEach((row) => {
            const existing = existingByReference.get(row.reference);
            if (!existing) {
                newRows.push(row);
                existingByReference.set(row.reference, row);
                return;
            }
            if (transactionSignature(existing) !== transactionSignature(row)) {
                conflictingDuplicateCount += 1;
            }
            duplicateCount += 1;
        });

        const importedAt = new Date().toISOString();
        newRows.forEach((row) => {
            if (row.status === 'debit') {
                row.remark = buildRemark('expense_unclassified', importedBy, importedAt);
            }
        });
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
            conflictingDuplicateCount,
            duplicateFile: Boolean(duplicatePdfBatch),
            importedAt,
            importedBy: {
                id: toSafeText(importedBy?.id, 32) || null,
                username: toSafeText(importedBy?.username, 100) || null,
                name: toSafeText(importedBy?.name, 120) || null
            }
        };
        bucket.transactions.push(...newRows);
        const batchRecorded = !duplicatePdfBatch || newRows.length > 0;
        if (batchRecorded) bucket.batches.push(batch);
        if (newRows.length || batchRecorded) bucket.updatedAt = importedAt;
        return {
            batch,
            transactions: newRows,
            duplicateCount,
            conflictingDuplicateCount,
            duplicateFile: Boolean(duplicatePdfBatch),
            batchRecorded
        };
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
        recipientLabel: getGcashRecipientLabel(transaction?.recipient) || null,
        assignment: sanitizeAssignment(transaction?.assignment),
        assignmentAudit: sanitizeAssignmentAudit(transaction?.assignmentAudit),
        remark: getTransactionRemark(transaction)
    })).sort((a, b) => String(b.transactionAt).localeCompare(String(a.transactionAt)));
    return {
        batches: bucket.batches.slice().sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))),
        transactions: all ? sortedTransactions : sortedTransactions.slice(0, safeLimit),
        totalTransactions: bucket.transactions.length,
        updatedAt: bucket.updatedAt || null
    };
};

const updateGcashTransactionRemark = async ({ branchId, reference, category, updatedBy } = {}) => {
    const safeBranchId = Number(branchId);
    const safeReference = normalizeReference(reference);
    const safeCategory = normalizeRemarkCategory(category);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    if (!safeReference) throw createError(400, 'GCash reference number is required.');
    if (!safeCategory) throw createError(400, 'Select a valid transaction remark.');

    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === safeReference);
        if (!transaction) throw createError(404, 'Reference is not in the imported GCash history.');
        const updatedAt = new Date().toISOString();
        const remark = buildRemark(safeCategory, updatedBy, updatedAt);
        transaction.remark = remark;
        bucket.updatedAt = updatedAt;
        return {
            transaction: {
                ...transaction,
                recipientLabel: getGcashRecipientLabel(transaction.recipient) || null,
                assignment: sanitizeAssignment(transaction.assignment),
                remark
            },
            remark
        };
    });
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
        recipientLabel: getGcashRecipientLabel(transaction.recipient) || null,
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
    const assignedAccounts = safeAssignment?.allocations?.map((allocation) => allocation.accountNumber).filter(Boolean) || [];
    const error = createError(
        409,
        assignedAccounts.length
            ? `This GCash transaction is already assigned to ${assignedAccounts.length === 1 ? `account ${assignedAccounts[0]}` : `${assignedAccounts.length} accounts`}.`
            : 'This GCash transaction is already assigned.'
    );
    error.code = 'GCASH_TRANSACTION_ALREADY_ASSIGNED';
    error.assignment = safeAssignment;
    return error;
};

const claimGcashTransactionAllocations = async ({
    branchId,
    reference,
    submissionId,
    allocations,
    amount,
    paymentDate,
    claimedBy
} = {}) => {
    const safeBranchId = Number(branchId);
    const safeReference = normalizeReference(reference);
    const safeSubmissionId = toSafeText(submissionId, 64);
    const sourceAllocations = Array.isArray(allocations) ? allocations : [];
    const safeAllocations = sourceAllocations.map(sanitizeAssignmentAllocation).filter(Boolean);
    const accountKeys = safeAllocations.map((allocation) => allocation.accountNumber);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    if (!safeReference) throw createError(400, 'GCash reference number is required.');
    if (!safeSubmissionId) throw createError(400, 'Submission ID is required.');
    if (
        safeAllocations.length < 1
        || safeAllocations.length > 3
        || safeAllocations.length !== sourceAllocations.length
    ) {
        throw createError(400, 'Provide one to three valid GCash payment allocations.');
    }
    if (new Set(accountKeys).size !== accountKeys.length) {
        throw createError(400, 'Each GCash allocation must use a different customer account.');
    }
    if (safeAllocations.some((allocation) => !allocation.billingMonth)) {
        throw createError(400, 'Each GCash allocation requires a billing month.');
    }

    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === safeReference);
        if (!transaction) throw createError(409, 'Reference is not in the imported GCash history.');
        const currentAssignment = sanitizeAssignment(transaction.assignment);
        if (currentAssignment) {
            const sameAllocation = currentAssignment.submissionId === safeSubmissionId
                && assignmentAllocationSignature(currentAssignment.allocations) === assignmentAllocationSignature(safeAllocations);
            if (sameAllocation) {
                return {
                    transaction: { ...transaction, assignment: currentAssignment },
                    assignment: currentAssignment,
                    idempotent: true
                };
            }
            throw createAssignmentConflictError(currentAssignment);
        }

        const claimedAt = new Date().toISOString();
        const assignment = sanitizeAssignment({
            status: 'claimed',
            submissionId: safeSubmissionId,
            allocations: safeAllocations,
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

const claimGcashTransaction = async ({
    branchId,
    reference,
    submissionId,
    accountNumber,
    customerName,
    amount,
    paymentDate,
    billingMonth,
    claimedBy
} = {}) => {
    const safeBranchId = Number(branchId);
    const safeReference = normalizeReference(reference);
    const safeSubmissionId = toSafeText(submissionId, 64);
    const safeAccountNumber = toSafeText(accountNumber, 20);
    const safeBillingMonth = normalizeBillingMonth(billingMonth);
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
                if (
                    safeBillingMonth
                    && currentAssignment.billingMonth
                    && currentAssignment.billingMonth !== safeBillingMonth
                ) {
                    throw createAssignmentConflictError(currentAssignment);
                }
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
            billingMonth: safeBillingMonth,
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
            allocations: assignment.allocations.map((allocation) => ({
                ...allocation,
                paymentEntryId: safePaymentEntryId
            })),
            postedAt
        });
        transaction.assignment = finalized;
        bucket.updatedAt = postedAt;
        return { transaction: { ...transaction, assignment: finalized }, assignment: finalized };
    });
};

const finalizeGcashTransactionAllocations = async ({
    branchId,
    reference,
    submissionId,
    paymentEntries
} = {}) => {
    const safeBranchId = Number(branchId);
    const safeSubmissionId = toSafeText(submissionId, 64);
    const entries = Array.isArray(paymentEntries) ? paymentEntries : [];
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    if (!safeSubmissionId) throw createError(400, 'Submission ID is required.');
    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const transaction = bucket.transactions.find((row) => normalizeReference(row?.reference) === normalizeReference(reference));
        if (!transaction) throw createError(409, 'Reference is not in the imported GCash history.');
        const assignment = sanitizeAssignment(transaction.assignment);
        if (!assignment || assignment.submissionId !== safeSubmissionId) {
            throw createAssignmentConflictError(assignment);
        }
        if (entries.length !== assignment.allocations.length) {
            throw createError(409, 'Every GCash allocation requires one payment entry before finalization.');
        }
        const entryByAllocation = new Map(entries.map((entry) => [
            `${toSafeText(entry?.accountNumber, 20)}|${normalizeBillingMonth(entry?.billingMonth)}`,
            toSafeText(entry?.paymentEntryId || entry?.id, 64)
        ]));
        const finalizedAllocations = assignment.allocations.map((allocation) => {
            const paymentEntryId = entryByAllocation.get(`${allocation.accountNumber}|${allocation.billingMonth}`);
            if (!paymentEntryId) throw createError(409, 'A GCash allocation payment entry is missing or mismatched.');
            return { ...allocation, paymentEntryId };
        });
        const postedAt = new Date().toISOString();
        const finalized = sanitizeAssignment({
            ...assignment,
            status: 'posted',
            allocations: finalizedAllocations,
            postedAt
        });
        transaction.assignment = finalized;
        bucket.updatedAt = postedAt;
        return { transaction: { ...transaction, assignment: finalized }, assignment: finalized };
    });
};

const replaceGcashTransactionPaymentBinding = async ({
    branchId,
    oldReference,
    newReference,
    newSubmissionId,
    paymentEntryId,
    targetAllocation,
    auditId,
    editedAt,
    editedBy
} = {}) => {
    const safeBranchId = Number(branchId);
    const safeOldReference = normalizeReference(oldReference);
    const safeNewReference = normalizeReference(newReference);
    const safeSubmissionId = toSafeText(newSubmissionId, 64);
    const safePaymentEntryId = toSafeText(paymentEntryId, 64);
    const safeTargetAllocation = sanitizeAssignmentAllocation({
        ...(targetAllocation && typeof targetAllocation === 'object' ? targetAllocation : {}),
        paymentEntryId: safePaymentEntryId
    });
    const safeAuditId = toSafeText(auditId, 64);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) throw createError(400, 'Branch assignment is required.');
    if (!safeOldReference || !safeNewReference) throw createError(400, 'The previous and replacement GCash references are required.');
    if (!safeSubmissionId || !safePaymentEntryId || !safeTargetAllocation?.billingMonth) {
        throw createError(400, 'A valid payment entry and replacement allocation are required.');
    }
    if (!safeAuditId) throw createError(400, 'A binding audit ID is required.');

    return mutateHistoryStore(async (store) => {
        const bucket = getBranchBucket(store, safeBranchId);
        const oldTransaction = bucket.transactions.find((row) => (
            normalizeReference(row?.reference) === safeOldReference
        ));
        const newTransaction = bucket.transactions.find((row) => (
            normalizeReference(row?.reference) === safeNewReference
        ));
        if (!oldTransaction || !newTransaction) {
            throw createError(409, 'The previous or replacement reference is missing from imported GCash history.');
        }

        const oldAssignment = sanitizeAssignment(oldTransaction.assignment);
        const newAssignment = sanitizeAssignment(newTransaction.assignment);
        const postedNewAllocation = newAssignment?.status === 'posted'
            && newAssignment.allocations.length === 1
            && newAssignment.allocations[0].paymentEntryId === safePaymentEntryId
            && assignmentAllocationSignature(newAssignment.allocations) === assignmentAllocationSignature([safeTargetAllocation]);
        if (safeOldReference !== safeNewReference && !oldAssignment && postedNewAllocation) {
            return {
                oldTransaction: { ...oldTransaction, assignment: null },
                newTransaction: { ...newTransaction, assignment: newAssignment },
                assignment: newAssignment,
                idempotent: true
            };
        }
        if (
            !oldAssignment
            || oldAssignment.status !== 'posted'
            || oldAssignment.allocations.length !== 1
            || oldAssignment.allocations[0].paymentEntryId !== safePaymentEntryId
        ) {
            throw createError(409, 'The existing GCash binding is not a single posted payment and cannot be edited safely.');
        }

        const oldAllocation = oldAssignment.allocations[0];
        const auditBase = {
            auditId: safeAuditId,
            paymentEntryId: safePaymentEntryId,
            fromReference: safeOldReference,
            toReference: safeNewReference,
            sourceAccountNumber: oldAllocation.accountNumber,
            targetAccountNumber: safeTargetAllocation.accountNumber,
            editedAt: toSafeText(editedAt, 40) || new Date().toISOString(),
            editedBy
        };

        if (safeOldReference === safeNewReference) {
            const updatedAssignment = sanitizeAssignment({
                ...oldAssignment,
                amount: safeTargetAllocation.amount,
                paymentDate: oldAssignment.paymentDate,
                allocations: [safeTargetAllocation]
            });
            const idempotent = assignmentAllocationSignature(oldAssignment.allocations)
                === assignmentAllocationSignature(updatedAssignment.allocations);
            oldTransaction.assignment = updatedAssignment;
            if (!idempotent) appendAssignmentAudit(oldTransaction, { ...auditBase, action: 'reassigned' });
            bucket.updatedAt = auditBase.editedAt;
            return {
                oldTransaction: { ...oldTransaction, assignment: updatedAssignment },
                newTransaction: { ...oldTransaction, assignment: updatedAssignment },
                assignment: updatedAssignment,
                idempotent
            };
        }

        if (
            !newAssignment
            || newAssignment.submissionId !== safeSubmissionId
            || newAssignment.allocations.length !== 1
            || assignmentAllocationSignature(newAssignment.allocations) !== assignmentAllocationSignature([safeTargetAllocation])
            || (newAssignment.allocations[0].paymentEntryId && newAssignment.allocations[0].paymentEntryId !== safePaymentEntryId)
        ) {
            throw createAssignmentConflictError(newAssignment);
        }
        const postedAt = newAssignment.postedAt || auditBase.editedAt;
        const finalized = sanitizeAssignment({
            ...newAssignment,
            status: 'posted',
            allocations: [safeTargetAllocation],
            postedAt
        });
        oldTransaction.assignment = null;
        newTransaction.assignment = finalized;
        appendAssignmentAudit(oldTransaction, { ...auditBase, action: 'released' });
        appendAssignmentAudit(newTransaction, { ...auditBase, action: 'assigned' });
        bucket.updatedAt = auditBase.editedAt;
        return {
            oldTransaction: { ...oldTransaction, assignment: null },
            newTransaction: { ...newTransaction, assignment: finalized },
            assignment: finalized,
            idempotent: false
        };
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
        if (!assignment || assignment.status === 'posted' || assignment.paymentEntryIds.length) return false;
        const safeAccountNumber = toSafeText(accountNumber, 20);
        if (assignment.submissionId !== toSafeText(submissionId, 64)) return false;
        if (safeAccountNumber && assignment.accountNumber && assignment.accountNumber !== safeAccountNumber) return false;
        transaction.assignment = null;
        bucket.updatedAt = new Date().toISOString();
        return true;
    });
};

module.exports = {
    GCASH_TRANSACTION_HISTORY_STORE_KEY,
    GCASH_RECIPIENT_LABELS,
    GCASH_TRANSACTION_REMARKS,
    importGcashTransactionBatch,
    listGcashTransactionHistory,
    evaluateGcashTransactionMatch,
    claimGcashTransaction,
    claimGcashTransactionAllocations,
    finalizeGcashTransactionAssignment,
    finalizeGcashTransactionAllocations,
    replaceGcashTransactionPaymentBinding,
    releaseGcashTransactionClaim,
    updateGcashTransactionRemark,
    sanitizeAssignment,
    sanitizeAssignmentAudit,
    sanitizeRemark,
    normalizeRemarkCategory,
    normalizeReference,
    normalizePhone,
    getGcashRecipientLabel,
    phoneMatches,
    transactionSignature
};
