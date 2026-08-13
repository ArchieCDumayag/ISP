const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { query, getPool } = require('../../../../core/data/db');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const customersModule = require('../../customer-management/backend/customers');
const { assignEntryNumbers, assertEntryNumbersAvailable } = require('./payment-numbering');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const paymentsRouter = require('./payments');
const paymentRecordsRouter = require('./payment-records');
const { loadIntegrationSettings } = require('../../admin/backend/integration-settings');
const { extractGcashTransactionsFromPdf } = require('./gcash-pdf-parser');
const {
    importGcashTransactionBatch,
    listGcashTransactionHistory,
    evaluateGcashTransactionMatch,
    claimGcashTransaction,
    finalizeGcashTransactionAssignment,
    releaseGcashTransactionClaim,
    updateGcashTransactionRemark,
    normalizeReference: normalizeGcashReference
} = require('./gcash-transaction-history-store');
const {
    PAYMENT_CONFIRMATION_QUEUE_TABLE,
    ensurePaymentConfirmationQueueTable,
    createPaymentConfirmationSubmission,
    listPaymentConfirmationSubmissions,
    getPaymentConfirmationSubmission,
    updatePaymentConfirmationSubmission,
    normalizeProofReference
} = require('./payment-confirmation-queue-store');
const { accountHasRole } = require('../../../../core/security/role-utils');

const router = express.Router();
const APPROVED_QUEUE_PAYMENT_METHOD = 'gcash';

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (maxLen > 0) return text.slice(0, maxLen);
    return text;
};

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeDateOnly = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const nowDateOnly = () => new Date().toISOString().slice(0, 10);
const nowDateTime = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const SAMPLE_PROOF_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgNfN3tQAAAAASUVORK5CYII=';
const normalizePaymentReference = (value) => normalizeProofReference(value).slice(0, 32);
const isGcashPaymentMethod = (value) => String(value || '').trim().toLowerCase() === 'gcash';
const isExplicitlyConfirmed = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';
const normalizeBillingMonth = (value) => {
    const match = toSafeText(value, 7).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    return match ? match[0] : '';
};

const readCustomerPhone = (customer = {}) => toSafeText(
    customer.mobile_raw
    ?? customer.mobileRaw
    ?? customer.mobile
    ?? customer.contactNumber
    ?? customer.contact,
    40
);

const decodeFileNameHeader = (value) => {
    const raw = toSafeText(Array.isArray(value) ? value[0] : value, 500);
    if (!raw) return 'gcash-transaction-history.pdf';
    try {
        return decodeURIComponent(raw).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
    } catch {
        return raw.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
    }
};

const loadBranchGcashMerchantNumber = async (branchId) => {
    const settings = await loadIntegrationSettings(branchId);
    return toSafeText(settings?.gcash?.accountNumber, 40);
};

const matchGcashSubmission = async ({
    branchId,
    paymentMethod,
    reference,
    amount,
    paymentDate,
    transactions = null,
    merchantNumber = null,
    customerPhone = '',
    accountNumber = '',
    submissionId = ''
} = {}) => {
    if (!isGcashPaymentMethod(paymentMethod)) return null;
    const history = Array.isArray(transactions)
        ? { transactions }
        : await listGcashTransactionHistory({ branchId, all: true });
    const resolvedMerchantNumber = merchantNumber == null
        ? await loadBranchGcashMerchantNumber(branchId)
        : merchantNumber;
    return evaluateGcashTransactionMatch({
        transactions: history.transactions,
        reference,
        amount,
        paymentDate,
        merchantNumber: resolvedMerchantNumber,
        customerPhone,
        accountNumber,
        submissionId
    });
};

const sendGcashHistoryMatchRequired = (res, { historyMatch = null } = {}) => {
    if (historyMatch?.status === 'already_assigned') {
        return res.status(409).json({
            ok: false,
            code: 'GCASH_TRANSACTION_ALREADY_ASSIGNED',
            error: historyMatch.message || 'This GCash transaction is already assigned to another customer.',
            assignment: historyMatch.transaction?.assignment || null,
            gcashMatch: historyMatch
        });
    }
    return res.status(409).json({
        ok: false,
        code: 'GCASH_HISTORY_MATCH_REQUIRED',
        error: 'This proof must match an unused transaction in the imported official GCash history before approval.',
        gcashMatch: historyMatch
    });
};

const sendGcashAssignmentConflict = (res, error) => res.status(409).json({
    ok: false,
    code: 'GCASH_TRANSACTION_ALREADY_ASSIGNED',
    error: error?.message || 'This GCash transaction is already assigned to another customer.',
    assignment: error?.assignment || null
});

const releaseGcashClaimBestEffort = async (claim = {}) => {
    try {
        return await releaseGcashTransactionClaim(claim);
    } catch {
        return false;
    }
};

const evaluateGcashScreenshotConsistency = ({ analysis, reference, amount, paymentDate } = {}) => {
    if (!analysis || typeof analysis !== 'object') {
        return { consistent: null, conflicts: [], message: 'No stored screenshot analysis is available.' };
    }
    const confidence = Number(analysis.confidence);
    const aiWasUsed = Boolean(analysis.ai?.used);
    const sufficientlyReliable = aiWasUsed
        ? (Number.isFinite(confidence) && confidence >= 70)
        : (analysis.state === 'complete' || (Number.isFinite(confidence) && confidence >= 70));
    if (!sufficientlyReliable) {
        return { consistent: null, conflicts: [], message: 'Screenshot OCR was inconclusive; manual verification is required.' };
    }
    const fields = analysis.fields || {};
    const fieldSources = analysis.fieldSources || {};
    const isAiOnly = (field) => fieldSources[field] === 'vision_ai';
    const conflicts = [];
    let comparedFields = 0;
    const expectedReference = normalizePaymentReference(reference);
    const screenshotReference = normalizePaymentReference(fields.reference);
    if (screenshotReference && !isAiOnly('reference')) {
        comparedFields += 1;
        if (screenshotReference !== expectedReference) conflicts.push('reference');
    }
    const expectedAmount = toFiniteNumber(amount);
    const screenshotAmount = toFiniteNumber(fields.amount);
    if (
        screenshotAmount != null
        && expectedAmount != null
        && !isAiOnly('amount')
    ) {
        comparedFields += 1;
        if (Math.abs(screenshotAmount - expectedAmount) > 0.009) conflicts.push('amount');
    }
    const expectedDate = normalizeDateOnly(paymentDate);
    const screenshotDate = normalizeDateOnly(fields.transactionAt);
    if (screenshotDate && expectedDate && !isAiOnly('transactionAt')) {
        comparedFields += 1;
        if (screenshotDate !== expectedDate) conflicts.push('date');
    }
    if (['pending', 'failed'].includes(String(fields.status || '').toLowerCase()) && !isAiOnly('status')) {
        comparedFields += 1;
        conflicts.push('status');
    }
    if (analysis.checks?.recipientMatchesMerchant === false && !isAiOnly('recipientNumber')) {
        comparedFields += 1;
        conflicts.push('recipient');
    }
    if (!comparedFields) {
        return {
            consistent: null,
            conflicts: [],
            message: 'Only advisory Vision AI fields were available; Admin must verify the screenshot manually.'
        };
    }
    return {
        consistent: conflicts.length === 0,
        conflicts,
        message: conflicts.length
            ? `Screenshot analysis conflicts with the submitted ${conflicts.join(', ')}.`
            : 'Detected screenshot fields agree with the submitted payment.'
    };
};

const assertLockedGcashApproval = ({ submission, amountOverride, referenceOverride } = {}) => {
    const submittedAmount = toFiniteNumber(submission?.amount);
    const submittedReference = normalizePaymentReference(submission?.reference);
    if (
        amountOverride != null
        && submittedAmount != null
        && Math.abs(amountOverride - submittedAmount) > 0.009
    ) {
        const error = createError(409, 'The GCash amount is locked to the customer submission. Request new proof instead of changing it.');
        error.code = 'GCASH_PROOF_FIELDS_LOCKED';
        throw error;
    }
    if (
        referenceOverride
        && submittedReference
        && normalizePaymentReference(referenceOverride) !== submittedReference
    ) {
        const error = createError(409, 'The GCash reference is locked to the customer submission. Request new proof instead of changing it.');
        error.code = 'GCASH_PROOF_FIELDS_LOCKED';
        throw error;
    }
};

const readBranchCustomersForQueue = async (branchId, limit = 0) => {
    if (isJsonStorageMode()) {
        const readCustomers = customersModule.readVisibleCustomers || customersModule.readCustomers;
        const customers = typeof readCustomers === 'function' ? await readCustomers(branchId) : [];
        const list = Array.isArray(customers) ? customers : [];
        return limit > 0 ? list.slice(0, limit) : list;
    }
    const [rows] = await query(
        `SELECT account_number, name, first_name, last_name, mobile, mobile_raw, plan_amount
         FROM customers
         WHERE branch_id = ?
         ORDER BY updated_at DESC, id DESC
         ${limit > 0 ? 'LIMIT ?' : ''}`,
        limit > 0 ? [branchId, limit] : [branchId]
    );
    return Array.isArray(rows) ? rows : [];
};

const readQueueCustomer = async (branchId, accountNumber) => {
    if (isJsonStorageMode()) {
        const customers = await readBranchCustomersForQueue(branchId);
        return customers.find((item) => (
            String(item?.accountNumber || item?.account_number || '').trim() === accountNumber
        )) || null;
    }
    const [rows] = await query(
        `SELECT account_number, name, first_name, last_name, mobile, mobile_raw
         FROM customers
         WHERE account_number = ?
           AND branch_id = ?
         LIMIT 1`,
        [accountNumber, branchId]
    );
    return (rows || [])[0] || null;
};

const mapDuplicatePaymentReferenceRow = (row = {}) => {
    const customerName =
        toSafeText(row.customer_name, 200) ||
        `${toSafeText(row.first_name, 100)} ${toSafeText(row.last_name, 100)}`.trim() ||
        toSafeText(row.account_number, 20);
    return {
        paymentEntryId: row.id || '',
        accountNumber: row.account_number || '',
        customerName,
        amount: row.amount != null ? Number(row.amount) : null,
        date: row.date || null,
        reference: row.reference || '',
        orNumber: row.or_number || '',
        recordedAt: row.recorded_at || null,
        recordedBy: row.recorded_by_name || row.recorded_by_username || '',
        paymentMethod: row.payment_method || '',
        description: row.description || ''
    };
};

const buildPaymentEntryId = (submissionId) => {
    const compact = String(submissionId || '').replace(/[^0-9a-z_-]/gi, '');
    const candidate = `proof-${compact}`;
    if (candidate.length <= 64 && candidate.length > 6) return candidate;
    return `proof-${crypto.createHash('sha1').update(String(submissionId || Date.now())).digest('hex').slice(0, 58)}`;
};

const buildGcashHistorySubmissionId = (branchId, reference) => (
    `gcash-history-${crypto.createHash('sha256')
        .update(`${branchId}:${normalizeGcashReference(reference)}`)
        .digest('hex')
        .slice(0, 40)}`
);

const getPaymentRecordCustomerName = (record = {}) => (
    toSafeText(record.name, 200)
    || `${toSafeText(record.firstName, 100)} ${toSafeText(record.lastName, 100)}`.trim()
    || toSafeText(record.accountNumber, 20)
);

const requireAdminWithBranch = (req, _res, next) => {
    if (!accountHasRole(req.user, 'Admin')) {
        return next(createError(403, 'Admin access required.'));
    }
    const branchId = Number(req.user?.branchId || 0);
    if (!Number.isInteger(branchId) || branchId <= 0) {
        return next(createError(400, 'Branch assignment missing for this admin account.'));
    }
    req.branchId = branchId;
    return next();
};

router.use(requireAdminWithBranch);

router.get('/gcash-history', async (req, res, next) => {
    try {
        const history = await listGcashTransactionHistory({
            branchId: req.branchId,
            limit: req.query?.limit
        });
        return res.json({ ok: true, ...history });
    } catch (error) {
        return next(error);
    }
});

router.post(
    '/gcash-history/import',
    express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '8mb' }),
    async (req, res, next) => {
        try {
            const pdfBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
            const password = String(req.get('X-PDF-Password') || '').slice(0, 200);
            const fileName = decodeFileNameHeader(req.get('X-PDF-File-Name'));
            const parsed = await extractGcashTransactionsFromPdf(pdfBuffer, password);
            const imported = await importGcashTransactionBatch({
                branchId: req.branchId,
                fileName,
                pdfSha256: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
                parsed,
                importedBy: req.user
            });
            const importedCount = Number(imported.batch.importedCount) || 0;
            const duplicateCount = Number(imported.duplicateCount) || 0;
            return res.status(importedCount > 0 ? 201 : 200).json({
                ok: true,
                message: `${importedCount} official GCash transaction(s) imported; ${duplicateCount} existing reference(s) skipped.`,
                batch: imported.batch,
                duplicateCount,
                conflictingDuplicateCount: imported.conflictingDuplicateCount,
                duplicateFile: imported.duplicateFile,
                batchRecorded: imported.batchRecorded
            });
        } catch (error) {
            return next(error);
        }
    }
);

router.put('/gcash-history/:reference/remark', async (req, res, next) => {
    try {
        const updated = await updateGcashTransactionRemark({
            branchId: req.branchId,
            reference: req.params?.reference,
            category: req.body?.category,
            updatedBy: req.user
        });
        return res.json({
            ok: true,
            message: 'Transaction remark saved.',
            transaction: updated.transaction,
            remark: updated.remark
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/gcash-history/:reference/post-payment', async (req, res, next) => {
    let claimedGcash = null;
    let paymentRecorded = false;
    const reference = normalizeGcashReference(req.params?.reference);
    const accountNumber = toSafeText(req.body?.accountNumber, 20);
    const billingMonth = normalizeBillingMonth(req.body?.billingMonth);
    const confirmedAmount = toFiniteNumber(req.body?.amount);
    const assignmentConfirmed = isExplicitlyConfirmed(req.body?.assignmentConfirmed);
    const submissionId = buildGcashHistorySubmissionId(req.branchId, reference);
    try {
        if (!reference) throw createError(400, 'GCash reference number is required.');
        if (!accountNumber) throw createError(400, 'Customer account is required.');
        if (!billingMonth) throw createError(400, 'Billing month is required.');
        if (!assignmentConfirmed) {
            return res.status(400).json({
                ok: false,
                code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED',
                error: 'Confirm the customer, billing month, reference, and imported amount before posting.'
            });
        }

        const history = await listGcashTransactionHistory({ branchId: req.branchId, all: true });
        const transaction = history.transactions.find((row) => (
            normalizeGcashReference(row?.reference) === reference
        ));
        if (!transaction) throw createError(404, 'Reference is not in the imported GCash history.');
        const importedAmount = toFiniteNumber(transaction.credit);
        if (String(transaction.status || '').toLowerCase() !== 'received' || importedAmount == null || importedAmount <= 0) {
            const error = createError(409, 'Only an imported incoming GCash credit can be posted as a payment.');
            error.code = 'GCASH_INCOMING_CREDIT_REQUIRED';
            throw error;
        }
        if (confirmedAmount == null || Math.abs(confirmedAmount - importedAmount) > 0.009) {
            return res.status(409).json({
                ok: false,
                code: 'GCASH_IMPORTED_AMOUNT_MISMATCH',
                error: 'The confirmed payment amount must exactly match the imported GCash credit.',
                importedAmount: Number(importedAmount.toFixed(2))
            });
        }

        const existingAssignment = transaction.assignment && typeof transaction.assignment === 'object'
            ? transaction.assignment
            : null;
        if (existingAssignment) {
            const sameDirectAssignment = existingAssignment.submissionId === submissionId
                && existingAssignment.accountNumber === accountNumber
                && existingAssignment.billingMonth === billingMonth;
            if (
                sameDirectAssignment
                && existingAssignment.status === 'posted'
                && existingAssignment.paymentEntryId
            ) {
                return res.json({
                    ok: true,
                    idempotent: true,
                    message: 'This imported GCash transaction is already posted to the selected customer ledger.',
                    reference,
                    amount: Number(importedAmount.toFixed(2)),
                    billingMonth,
                    paymentEntryId: existingAssignment.paymentEntryId,
                    assignment: existingAssignment
                });
            }
            if (!sameDirectAssignment) {
                return res.status(409).json({
                    ok: false,
                    code: 'GCASH_TRANSACTION_ALREADY_ASSIGNED',
                    error: `This GCash transaction is already assigned to account ${existingAssignment.accountNumber}.`,
                    assignment: existingAssignment
                });
            }
        }

        const paymentRecord = await paymentRecordsRouter.buildPaymentRecordForAccount(accountNumber, req.branchId);
        if (!paymentRecord) throw createError(404, 'Customer not found.');
        const billingRows = Array.isArray(paymentRecord?.billingSummary?.rows)
            ? paymentRecord.billingSummary.rows
            : [];
        const billingRow = billingRows.find((row) => String(row?.billingMonthKey || '').trim() === billingMonth);
        if (!billingRow) {
            return res.status(409).json({
                ok: false,
                code: 'BILLING_CYCLE_NOT_FOUND',
                error: 'The selected billing month is not available for this customer.'
            });
        }
        const billingStatus = String(billingRow.paymentStatus || billingRow.paymentStatusLabel || '').trim().toLowerCase();
        if (['paid', 'complimentary'].includes(billingStatus)) {
            return res.status(409).json({
                ok: false,
                code: 'BILLING_CYCLE_ALREADY_SETTLED',
                error: 'The selected billing month is already settled. Choose an open billing month.'
            });
        }

        const reviewer = {
            id: toSafeText(req.user?.id, 32) || null,
            username: toSafeText(req.user?.username, 100) || null,
            name: toSafeText(req.user?.name, 120) || null,
            role: toSafeText(req.user?.role, 30) || null
        };
        const customerName = getPaymentRecordCustomerName(paymentRecord);
        try {
            claimedGcash = await claimGcashTransaction({
                branchId: req.branchId,
                reference,
                submissionId,
                accountNumber,
                customerName,
                amount: importedAmount,
                paymentDate: transaction.transactionDate || transaction.transactionAt,
                billingMonth,
                claimedBy: reviewer
            });
        } catch (error) {
            if (error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED') {
                return sendGcashAssignmentConflict(res, error);
            }
            throw error;
        }

        if (typeof paymentsRouter.recordApprovedProofPayment !== 'function') {
            throw createError(500, 'Imported GCash payment writer is unavailable.');
        }
        const paymentEntry = await paymentsRouter.recordApprovedProofPayment({
            submissionId,
            source: 'gcash-history',
            branchId: req.branchId,
            accountNumber,
            amount: Number(importedAmount.toFixed(2)),
            reference,
            date: normalizeDateOnly(transaction.transactionDate || transaction.transactionAt) || nowDateOnly(),
            reviewer,
            payer: customerName || accountNumber,
            description: `Imported GCash payment posted for billing cycle ${billingMonth}`
        });
        paymentRecorded = true;

        const finalized = await finalizeGcashTransactionAssignment({
            branchId: req.branchId,
            reference,
            submissionId,
            accountNumber,
            paymentEntryId: paymentEntry.id
        });
        claimedGcash = null;
        return res.status(201).json({
            ok: true,
            message: 'Imported GCash transaction posted to the customer ledger.',
            reference,
            amount: Number(importedAmount.toFixed(2)),
            billingMonth,
            paymentEntryId: paymentEntry.id,
            assignment: finalized.assignment
        });
    } catch (error) {
        if (claimedGcash && !paymentRecorded) {
            await releaseGcashClaimBestEffort({
                branchId: req.branchId,
                reference,
                submissionId,
                accountNumber
            });
        }
        if (error?.status === 409 && error?.duplicatePayment) {
            return res.status(409).json({
                ok: false,
                code: 'DUPLICATE_PAYMENT_REFERENCE',
                error: error.message || 'Payment has been recorded',
                duplicatePayment: error.duplicatePayment
            });
        }
        return next(error);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const status = String(req.query?.status || 'pending').trim().toLowerCase();
        const search = toSafeText(req.query?.search, 200) || toSafeText(req.query?.accountNumber, 200);
        const limit = Number(req.query?.limit);
        const offset = Number(req.query?.offset);
        const result = await listPaymentConfirmationSubmissions({
            branchId: req.branchId,
            status,
            search,
            limit,
            offset
        });
        const gcashItems = result.items.filter((item) => isGcashPaymentMethod(item?.paymentMethod));
        if (gcashItems.length) {
            const [history, merchantNumber, customers] = await Promise.all([
                listGcashTransactionHistory({ branchId: req.branchId, all: true }),
                loadBranchGcashMerchantNumber(req.branchId),
                readBranchCustomersForQueue(req.branchId)
            ]);
            const customerByAccount = new Map((customers || []).map((customer) => [
                String(customer?.account_number ?? customer?.accountNumber ?? '').trim(),
                customer
            ]));
            result.items = result.items.map((item) => {
                if (!isGcashPaymentMethod(item?.paymentMethod)) return item;
                const customer = customerByAccount.get(String(item.accountNumber || '').trim()) || null;
                return {
                    ...item,
                    gcashMatch: evaluateGcashTransactionMatch({
                        transactions: history.transactions,
                        reference: item.reviewedReference || item.reference,
                        amount: item.reviewedAmount ?? item.amount,
                        paymentDate: item.paymentDate,
                        merchantNumber,
                        customerPhone: readCustomerPhone(customer),
                        accountNumber: item.accountNumber,
                        submissionId: item.id
                    })
                };
            });
        }
        return res.json({ ok: true, ...result });
    } catch (error) {
        return next(error);
    }
});

router.post('/', async (req, res, next) => {
    try {
        await ensurePaymentConfirmationQueueTable();

        const accountNumber = toSafeText(req.body?.accountNumber, 20);
        if (!accountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const amountValue = toFiniteNumber(req.body?.amount);
        if (amountValue == null || amountValue <= 0) {
            return next(createError(400, 'Amount is required.'));
        }

        const proofImageData = toSafeText(req.body?.proofImageData);
        if (!proofImageData) {
            return next(createError(400, 'Proof image is required.'));
        }
        const reference = toSafeText(req.body?.reference, 64);
        const paymentMethod = toSafeText(req.body?.paymentMethod, 40);
        if (isGcashPaymentMethod(paymentMethod) && !reference) {
            return next(createError(400, 'GCash reference number is required.'));
        }

        const customer = await readQueueCustomer(req.branchId, accountNumber);

        if (!customer) {
            return next(createError(404, 'Customer account was not found in this branch.'));
        }

        const resolvedCustomerName =
            toSafeText(customer?.name, 200) ||
            `${toSafeText(customer?.first_name ?? customer?.firstName, 100)} ${toSafeText(customer?.last_name ?? customer?.lastName, 100)}`.trim() ||
            accountNumber;

        const submission = await createPaymentConfirmationSubmission({
            branchId: req.branchId,
            accountNumber,
            customerName: resolvedCustomerName,
            amount: Number(amountValue.toFixed(2)),
            reference: reference || null,
            paymentMethod: paymentMethod || null,
            notes: toSafeText(req.body?.notes, 2000) || null,
            proofImageData: req.body?.proofImageData,
            proofMimeType: toSafeText(req.body?.proofMimeType, 100) || null,
            proofFileName: toSafeText(req.body?.proofFileName, 255) || null
        });

        return res.status(201).json({
            ok: true,
            message: 'Payment confirmation request added to queue.',
            item: submission
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/seed-sample', async (req, res, next) => {
    try {
        await ensurePaymentConfirmationQueueTable();

        const requestedCount = Number.parseInt(String(req.body?.count ?? '3'), 10);
        const sampleCount = Math.min(Math.max(Number.isFinite(requestedCount) ? requestedCount : 3, 1), 10);

        const customerRows = await readBranchCustomersForQueue(req.branchId, sampleCount);

        const methods = ['GCash', 'Bank Transfer', 'Maya'];
        const nowToken = String(Date.now()).slice(-8);
        const sourceRows = Array.isArray(customerRows) ? customerRows : [];
        const rowsToSeed = sourceRows.length
            ? sourceRows
            : Array.from({ length: sampleCount }, (_, index) => ({
                account_number: `SMP${String(req.branchId)}${nowToken}${String(index + 1).padStart(2, '0')}`.slice(0, 20),
                name: `Sample Customer ${index + 1}`,
                first_name: '',
                last_name: '',
                plan_amount: 999 + (index * 250),
                __synthetic: true
            }));
        const inserted = [];

        for (let index = 0; index < rowsToSeed.length; index += 1) {
            const row = rowsToSeed[index];
            const accountNumber = toSafeText(row?.account_number ?? row?.accountNumber, 20);
            if (!accountNumber) continue;

            const resolvedName =
                toSafeText(row?.name, 200) ||
                `${toSafeText(row?.first_name ?? row?.firstName, 100)} ${toSafeText(row?.last_name ?? row?.lastName, 100)}`.trim() ||
                accountNumber;

            const planAmount = toFiniteNumber(row?.plan_amount ?? row?.planAmount);
            const fallbackAmount = 999 + (index * 250);
            const amount = Number((planAmount != null && planAmount > 0 ? planAmount : fallbackAmount).toFixed(2));
            const reference = `SMPL-${nowToken}-${String(index + 1).padStart(2, '0')}`.slice(0, 64);
            const sampleProofData = Buffer.concat([
                Buffer.from(SAMPLE_PROOF_PNG_DATA_URL.split(',')[1], 'base64'),
                Buffer.from(`sample-${index + 1}`)
            ]).toString('base64');

            const submission = await createPaymentConfirmationSubmission({
                branchId: req.branchId,
                accountNumber,
                customerName: resolvedName,
                amount,
                reference,
                paymentMethod: methods[index % methods.length],
                notes: row?.__synthetic
                    ? 'Sample queue request generated automatically because no branch customer records were found.'
                    : 'Sample queue request generated from branch customer data.',
                proofImageData: `data:image/png;base64,${sampleProofData}`,
                proofMimeType: 'image/png',
                proofFileName: `sample-proof-${index + 1}.png`
            });
            inserted.push(submission);
        }

        const sourceLabel = sourceRows.length ? 'customer records' : 'synthetic defaults';
        return res.status(201).json({
            ok: true,
            message: `${inserted.length} sample queue request(s) added from ${sourceLabel}.`,
            count: inserted.length,
            source: sourceRows.length ? 'customers' : 'synthetic',
            items: inserted
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/reject', async (req, res, next) => {
    try {
        await ensurePaymentConfirmationQueueTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            return next(createError(400, 'Submission ID is required.'));
        }

        const reason = toSafeText(req.body?.reason, 2000);
        if (!reason) {
            return next(createError(400, 'Rejection reason is required.'));
        }

        const existing = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        if (!existing) {
            return next(createError(404, 'Payment confirmation request not found.'));
        }
        if (existing.status !== 'pending') {
            return next(createError(409, `This request is already ${existing.status}.`));
        }

        const updated = await updatePaymentConfirmationSubmission(submissionId, req.branchId, {
            status: 'rejected',
            reviewedAt: nowDateTime(),
            reviewedBy: {
                id: toSafeText(req.user?.id, 32) || null,
                username: toSafeText(req.user?.username, 100) || null,
                name: toSafeText(req.user?.name, 120) || null
            },
            decisionReason: reason
        }, { expectedStatus: 'pending' });
        return res.json({ ok: true, item: updated });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/request-new-proof', async (req, res, next) => {
    try {
        await ensurePaymentConfirmationQueueTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            return next(createError(400, 'Submission ID is required.'));
        }

        const reason = toSafeText(req.body?.reason, 2000);
        if (!reason) {
            return next(createError(400, 'Reason for requesting new proof is required.'));
        }

        const existing = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        if (!existing) {
            return next(createError(404, 'Payment confirmation request not found.'));
        }
        if (existing.status !== 'pending') {
            return next(createError(409, `This request is already ${existing.status}.`));
        }

        const updated = await updatePaymentConfirmationSubmission(submissionId, req.branchId, {
            status: 'needs_new_proof',
            reviewedAt: nowDateTime(),
            reviewedBy: {
                id: toSafeText(req.user?.id, 32) || null,
                username: toSafeText(req.user?.username, 100) || null,
                name: toSafeText(req.user?.name, 120) || null
            },
            decisionReason: reason
        }, { expectedStatus: 'pending' });
        return res.json({ ok: true, item: updated });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/approve', async (req, res, next) => {
    let connection = null;
    let shouldRefreshBranch = false;
    let claimedGcash = null;
    let paymentRecorded = false;
    try {
        await ensurePaymentConfirmationQueueTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            return next(createError(400, 'Submission ID is required.'));
        }

        const reviewer = {
            id: toSafeText(req.user?.id, 32) || null,
            username: toSafeText(req.user?.username, 100) || null,
            name: toSafeText(req.user?.name, 120) || null,
            role: toSafeText(req.user?.role, 30) || null
        };

        const approvedAmountOverride = toFiniteNumber(req.body?.amount);
        const approvedReferenceOverride = toSafeText(req.body?.reference, 64);
        const decisionReason = toSafeText(req.body?.reason, 2000) || null;
        const assignmentConfirmed = isExplicitlyConfirmed(req.body?.assignmentConfirmed);
        let approvedDate =
            normalizeDateOnly(req.body?.date) ||
            normalizeDateOnly(req.body?.recordedAt) ||
            nowDateOnly();

        if (isJsonStorageMode()) {
            const existing = await getPaymentConfirmationSubmission(submissionId, req.branchId);
            if (!existing) throw createError(404, 'Payment confirmation request not found.');
            if (existing.status !== 'pending') {
                throw createError(409, `This request is already ${existing.status}.`);
            }
            const customer = await readQueueCustomer(req.branchId, existing.accountNumber);
            if (!customer) throw createError(404, 'The customer account assigned to this proof no longer exists.');
            const gcashApproval = isGcashPaymentMethod(existing.paymentMethod);
            if (gcashApproval && !assignmentConfirmed) {
                return res.status(400).json({
                    ok: false,
                    code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED',
                    error: 'Confirm that this transaction belongs to the displayed customer account before approval.'
                });
            }
            if (gcashApproval) {
                assertLockedGcashApproval({
                    submission: existing,
                    amountOverride: approvedAmountOverride,
                    referenceOverride: approvedReferenceOverride
                });
            }
            const derivedAmount = approvedAmountOverride != null && approvedAmountOverride > 0
                ? approvedAmountOverride
                : toFiniteNumber(existing.amount);
            if (derivedAmount == null || derivedAmount <= 0) {
                throw createError(400, 'Approved amount is required.');
            }
            const approvedAmount = Number(derivedAmount.toFixed(2));
            const approvedReference = normalizePaymentReference(approvedReferenceOverride || existing.reference);
            if (!approvedReference) throw createError(400, 'Reference number is required.');
            approvedDate = normalizeDateOnly(req.body?.date || existing.paymentDate) || approvedDate;

            if (gcashApproval) {
                const screenshotConsistency = evaluateGcashScreenshotConsistency({
                    analysis: existing.proofAnalysis,
                    reference: approvedReference,
                    amount: approvedAmount,
                    paymentDate: approvedDate
                });
                if (screenshotConsistency.consistent === false) {
                    return res.status(409).json({
                        ok: false,
                        code: 'GCASH_SCREENSHOT_CONFLICT',
                        error: `${screenshotConsistency.message} Request a new proof instead of approving it.`,
                        conflicts: screenshotConsistency.conflicts
                    });
                }
            }

            const gcashMatch = await matchGcashSubmission({
                branchId: req.branchId,
                paymentMethod: existing.paymentMethod,
                reference: approvedReference,
                amount: approvedAmount,
                paymentDate: approvedDate,
                customerPhone: readCustomerPhone(customer),
                accountNumber: existing.accountNumber,
                submissionId
            });
            if (gcashApproval && !gcashMatch?.matched) {
                return sendGcashHistoryMatchRequired(res, { historyMatch: gcashMatch });
            }

            if (gcashApproval && gcashMatch?.matched) {
                try {
                    claimedGcash = await claimGcashTransaction({
                        branchId: req.branchId,
                        reference: approvedReference,
                        submissionId,
                        accountNumber: existing.accountNumber,
                        customerName: existing.customerName,
                        amount: approvedAmount,
                        paymentDate: approvedDate,
                        claimedBy: reviewer
                    });
                } catch (error) {
                    if (error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED') {
                        return sendGcashAssignmentConflict(res, error);
                    }
                    throw error;
                }
            }

            if (typeof paymentsRouter.recordApprovedProofPayment !== 'function') {
                throw createError(500, 'Approved proof payment writer is unavailable.');
            }
            let paymentEntry;
            try {
                paymentEntry = await paymentsRouter.recordApprovedProofPayment({
                    submissionId,
                    branchId: req.branchId,
                    accountNumber: existing.accountNumber,
                    amount: approvedAmount,
                    reference: approvedReference,
                    date: approvedDate,
                    reviewer,
                    payer: existing.customerName || existing.accountNumber,
                    notes: existing.notes
                });
            } catch (error) {
                if (error?.status === 409) {
                    if (claimedGcash) {
                        await releaseGcashClaimBestEffort({
                            branchId: req.branchId,
                            reference: approvedReference,
                            submissionId,
                            accountNumber: existing.accountNumber
                        });
                        claimedGcash = null;
                    }
                    return res.status(409).json({
                        ok: false,
                        code: 'DUPLICATE_PAYMENT_REFERENCE',
                        error: error.message || 'Payment has been recorded',
                        duplicatePayment: error.duplicatePayment || null
                    });
                }
                throw error;
            }
            paymentRecorded = true;

            const updated = await updatePaymentConfirmationSubmission(submissionId, req.branchId, {
                status: 'approved',
                reviewedAt: nowDateTime(),
                reviewedBy: reviewer,
                decisionReason,
                paymentEntryId: paymentEntry.id,
                reviewedAmount: approvedAmount,
                reviewedReference: approvedReference,
                paymentMethod: APPROVED_QUEUE_PAYMENT_METHOD,
                amount: approvedAmount,
                reference: approvedReference
            }, { expectedStatus: 'pending' });
            if (gcashApproval && gcashMatch?.matched) {
                await finalizeGcashTransactionAssignment({
                    branchId: req.branchId,
                    reference: approvedReference,
                    submissionId,
                    accountNumber: existing.accountNumber,
                    paymentEntryId: paymentEntry.id
                });
                claimedGcash = null;
            }
            return res.json({ ok: true, item: updated, paymentEntryId: paymentEntry.id });
        }

        const approvalPreview = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        if (!approvalPreview) throw createError(404, 'Payment confirmation request not found.');
        if (approvalPreview.status !== 'pending') {
            throw createError(409, `This request is already ${approvalPreview.status}.`);
        }
        const previewCustomer = await readQueueCustomer(req.branchId, approvalPreview.accountNumber);
        if (!previewCustomer) throw createError(404, 'The customer account assigned to this proof no longer exists.');
        const previewIsGcash = isGcashPaymentMethod(approvalPreview.paymentMethod);
        if (previewIsGcash && !assignmentConfirmed) {
            return res.status(400).json({
                ok: false,
                code: 'PAYMENT_ASSIGNMENT_CONFIRMATION_REQUIRED',
                error: 'Confirm that this transaction belongs to the displayed customer account before approval.'
            });
        }
        if (previewIsGcash) {
            assertLockedGcashApproval({
                submission: approvalPreview,
                amountOverride: approvedAmountOverride,
                referenceOverride: approvedReferenceOverride
            });
        }
        const previewAmountValue = approvedAmountOverride != null && approvedAmountOverride > 0
            ? approvedAmountOverride
            : toFiniteNumber(approvalPreview.amount);
        if (previewAmountValue == null || previewAmountValue <= 0) {
            throw createError(400, 'Approved amount is required.');
        }
        const previewAmount = Number(previewAmountValue.toFixed(2));
        const previewReference = normalizePaymentReference(approvedReferenceOverride || approvalPreview.reference);
        if (!previewReference) throw createError(400, 'Reference number is required.');
        const previewDate = normalizeDateOnly(req.body?.date || approvalPreview.paymentDate) || approvedDate;
        if (previewIsGcash) {
            const screenshotConsistency = evaluateGcashScreenshotConsistency({
                analysis: approvalPreview.proofAnalysis,
                reference: previewReference,
                amount: previewAmount,
                paymentDate: previewDate
            });
            if (screenshotConsistency.consistent === false) {
                return res.status(409).json({
                    ok: false,
                    code: 'GCASH_SCREENSHOT_CONFLICT',
                    error: `${screenshotConsistency.message} Request a new proof instead of approving it.`,
                    conflicts: screenshotConsistency.conflicts
                });
            }
        }
        const previewGcashMatch = await matchGcashSubmission({
            branchId: req.branchId,
            paymentMethod: approvalPreview.paymentMethod,
            reference: previewReference,
            amount: previewAmount,
            paymentDate: previewDate,
            customerPhone: readCustomerPhone(previewCustomer),
            accountNumber: approvalPreview.accountNumber,
            submissionId
        });
        if (previewIsGcash && !previewGcashMatch?.matched) {
            return sendGcashHistoryMatchRequired(res, { historyMatch: previewGcashMatch });
        }

        if (previewIsGcash && previewGcashMatch?.matched) {
            try {
                claimedGcash = await claimGcashTransaction({
                    branchId: req.branchId,
                    reference: previewReference,
                    submissionId,
                    accountNumber: approvalPreview.accountNumber,
                    customerName: approvalPreview.customerName,
                    amount: previewAmount,
                    paymentDate: previewDate,
                    claimedBy: reviewer
                });
            } catch (error) {
                if (error?.code === 'GCASH_TRANSACTION_ALREADY_ASSIGNED') {
                    return sendGcashAssignmentConflict(res, error);
                }
                throw error;
            }
        }

        const pool = await getPool();
        if (!pool) {
            throw createError(500, 'MySQL connection is not available.');
        }
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT *
             FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
             WHERE id = ?
               AND branch_id = ?
             FOR UPDATE`,
            [submissionId, req.branchId]
        );
        const row = (rows || [])[0];
        if (!row) {
            throw createError(404, 'Payment confirmation request not found.');
        }
        if (String(row.status || '').toLowerCase() !== 'pending') {
            throw createError(409, `This request is already ${row.status || 'processed'}.`);
        }

        const derivedAmount = approvedAmountOverride != null && approvedAmountOverride > 0
            ? approvedAmountOverride
            : toFiniteNumber(row.amount);
        if (derivedAmount == null || derivedAmount <= 0) {
            throw createError(400, 'Approved amount is required.');
        }
        const approvedAmount = Number(derivedAmount.toFixed(2));
        const approvedReference = normalizePaymentReference(approvedReferenceOverride || row.reference);
        if (!approvedReference) {
            throw createError(400, 'Reference number is required.');
        }
        approvedDate = normalizeDateOnly(req.body?.date || row.payment_date) || approvedDate;

        const [duplicateRows] = await connection.query(
            `SELECT
                 pe.id,
                 pe.account_number,
                 pe.amount,
                 pe.date,
                 pe.reference,
                 pe.or_number,
                 pe.recorded_at,
                 pe.recorded_by_username,
                 pe.recorded_by_name,
                 pe.payment_method,
                 pe.description,
                 c.name AS customer_name,
                 c.first_name,
                 c.last_name
             FROM payment_entries pe
             LEFT JOIN customers c
               ON c.account_number = pe.account_number
              AND c.branch_id = pe.branch_id
             WHERE pe.branch_id = ?
               AND pe.reference = ?
             ORDER BY pe.recorded_at DESC, pe.date DESC
             LIMIT 1`,
            [req.branchId, approvedReference]
        );
        const duplicatePayment = (duplicateRows || [])[0];
        if (duplicatePayment) {
            await connection.rollback();
            connection.release();
            connection = null;
            if (claimedGcash) {
                await releaseGcashClaimBestEffort({
                    branchId: req.branchId,
                    reference: previewReference,
                    submissionId,
                    accountNumber: approvalPreview.accountNumber
                });
                claimedGcash = null;
            }
            return res.status(409).json({
                ok: false,
                code: 'DUPLICATE_PAYMENT_REFERENCE',
                error: 'Payment has been recorded',
                duplicatePayment: mapDuplicatePaymentReferenceRow(duplicatePayment)
            });
        }

        const paymentEntryId = buildPaymentEntryId(row.id);
        const paymentDescriptionParts = ['Payment proof approved'];
        const queueNotes = toSafeText(row.notes, 220);
        if (queueNotes) {
            paymentDescriptionParts.push(queueNotes);
        }
        const paymentDescription = paymentDescriptionParts.join(' - ');
        const paymentMethod = APPROVED_QUEUE_PAYMENT_METHOD;
        const payer = toSafeText(row.customer_name, 100) || toSafeText(row.account_number, 100) || null;

        const paymentEntry = {
            id: paymentEntryId,
            amount: approvedAmount,
            date: approvedDate,
            kind: 'payment',
            direction: 'credit',
            reference: approvedReference || undefined,
            description: paymentDescription,
            type: 'payment',
            recordedAt: nowDateTime(),
            recordedBy: reviewer,
            payer,
            status: 'Approved',
            paymentMethod
        };
        await assignEntryNumbers(connection, paymentEntry);
        await assertEntryNumbersAvailable(connection, req.branchId, paymentEntry);
        const finalReference = String(paymentEntry.reference || '').trim();
        const fingerprint = `${row.account_number}|${finalReference}|proof|${approvedAmount.toFixed(2)}|${row.id}`.slice(0, 200);

        await connection.query(
            `INSERT INTO payment_entries (
                id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
                recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
                payer, status, payment_method, fingerprint, xendit_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                paymentEntry.id,
                req.branchId,
                toSafeText(row.account_number, 20),
                paymentEntry.amount,
                paymentEntry.date,
                paymentEntry.kind,
                paymentEntry.direction,
                paymentEntry.reference || null,
                paymentEntry.orNumber || null,
                paymentEntry.description || null,
                paymentEntry.type || null,
                paymentEntry.recordedAt,
                reviewer.id,
                reviewer.username,
                reviewer.name,
                reviewer.role,
                paymentEntry.payer,
                paymentEntry.status,
                paymentEntry.paymentMethod,
                fingerprint,
                null
            ]
        );

        const [updateResult] = await connection.query(
            `UPDATE ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
             SET
                 status = 'approved',
                 reviewed_at = NOW(),
                 reviewed_by_user_id = ?,
                 reviewed_by_username = ?,
                 reviewed_by_name = ?,
                 decision_reason = ?,
                 payment_entry_id = ?,
                 reviewed_amount = ?,
                 reviewed_reference = ?,
                 payment_method = ?,
                 amount = ?,
                 reference = ?
              WHERE id = ?
                AND branch_id = ?
                AND status = 'pending'`,
            [
                reviewer.id,
                reviewer.username,
                reviewer.name,
                decisionReason,
                paymentEntryId,
                approvedAmount,
                finalReference,
                paymentMethod,
                approvedAmount,
                finalReference,
                submissionId,
                req.branchId
            ]
        );
        if (!updateResult || !updateResult.affectedRows) {
            throw createError(409, 'Unable to approve request. It may have been updated by another user.');
        }

        await connection.commit();
        paymentRecorded = true;
        shouldRefreshBranch = true;
        connection.release();
        connection = null;

        if (previewIsGcash && previewGcashMatch?.matched) {
            await finalizeGcashTransactionAssignment({
                branchId: req.branchId,
                reference: finalReference,
                submissionId,
                accountNumber: approvalPreview.accountNumber,
                paymentEntryId
            });
            claimedGcash = null;
        }
        const updated = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        return res.json({
            ok: true,
            item: updated,
            paymentEntryId
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {
                // best effort
            }
            connection.release();
        }
        if (claimedGcash && !paymentRecorded) {
            await releaseGcashClaimBestEffort({
                branchId: req.branchId,
                reference: claimedGcash.transaction?.reference,
                submissionId: claimedGcash.assignment?.submissionId,
                accountNumber: claimedGcash.assignment?.accountNumber
            });
        }
        return next(error);
    } finally {
        if (shouldRefreshBranch) {
            triggerBranchServiceRefresh(req.branchId, 'payment-confirmation-approved');
        }
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            return next(createError(400, 'Submission ID is required.'));
        }
        const item = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        if (!item) {
            return next(createError(404, 'Payment confirmation request not found.'));
        }
        return res.json({ ok: true, item });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
