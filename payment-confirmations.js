const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { query, getPool } = require('./db');
const { assignEntryNumbers, assertEntryNumbersAvailable } = require('./payment-numbering');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const {
    PAYMENT_CONFIRMATION_QUEUE_TABLE,
    ensurePaymentConfirmationQueueTable,
    createPaymentConfirmationSubmission,
    listPaymentConfirmationSubmissions,
    getPaymentConfirmationSubmission
} = require('./payment-confirmation-queue-store');
const { accountHasRole } = require('./role-utils');

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
const QUEUE_PAYMENT_REFERENCE_PREFIX = 'OPQ-';

const normalizePaymentReference = (value) => {
    const direct = String(value || '').trim();
    if (!direct) return '';
    const withoutPrefix = direct.toUpperCase().startsWith(QUEUE_PAYMENT_REFERENCE_PREFIX)
        ? direct.slice(QUEUE_PAYMENT_REFERENCE_PREFIX.length).trim()
        : direct;
    if (!withoutPrefix) return '';
    return `${QUEUE_PAYMENT_REFERENCE_PREFIX}${withoutPrefix}`.slice(0, 32);
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

        const [customerRows] = await query(
            `SELECT account_number, name, first_name, last_name
             FROM customers
             WHERE account_number = ?
               AND branch_id = ?
             LIMIT 1`,
            [accountNumber, req.branchId]
        );
        const customer = (customerRows || [])[0] || null;

        const resolvedCustomerName =
            toSafeText(req.body?.customerName, 200) ||
            toSafeText(customer?.name, 200) ||
            `${toSafeText(customer?.first_name, 100)} ${toSafeText(customer?.last_name, 100)}`.trim() ||
            accountNumber;

        const submission = await createPaymentConfirmationSubmission({
            branchId: req.branchId,
            accountNumber,
            customerName: resolvedCustomerName,
            amount: Number(amountValue.toFixed(2)),
            reference: toSafeText(req.body?.reference, 64) || null,
            paymentMethod: toSafeText(req.body?.paymentMethod, 40) || null,
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

        const [customerRows] = await query(
            `SELECT
                account_number,
                name,
                first_name,
                last_name,
                plan_amount
             FROM customers
             WHERE branch_id = ?
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
            [req.branchId, sampleCount]
        );

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
            const accountNumber = toSafeText(row?.account_number, 20);
            if (!accountNumber) continue;

            const resolvedName =
                toSafeText(row?.name, 200) ||
                `${toSafeText(row?.first_name, 100)} ${toSafeText(row?.last_name, 100)}`.trim() ||
                accountNumber;

            const planAmount = toFiniteNumber(row?.plan_amount);
            const fallbackAmount = 999 + (index * 250);
            const amount = Number((planAmount != null && planAmount > 0 ? planAmount : fallbackAmount).toFixed(2));
            const reference = `SMPL-${nowToken}-${String(index + 1).padStart(2, '0')}`.slice(0, 64);

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
                proofImageData: SAMPLE_PROOF_PNG_DATA_URL,
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

        const [result] = await query(
            `UPDATE ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
             SET
                status = 'rejected',
                reviewed_at = NOW(),
                reviewed_by_user_id = ?,
                reviewed_by_username = ?,
                reviewed_by_name = ?,
                decision_reason = ?
             WHERE id = ?
               AND branch_id = ?
               AND status = 'pending'`,
            [
                toSafeText(req.user?.id, 32) || null,
                toSafeText(req.user?.username, 100) || null,
                toSafeText(req.user?.name, 120) || null,
                reason,
                submissionId,
                req.branchId
            ]
        );
        if (!result || !result.affectedRows) {
            return next(createError(409, 'Unable to reject request. It may have been updated by another user.'));
        }

        const updated = await getPaymentConfirmationSubmission(submissionId, req.branchId);
        return res.json({ ok: true, item: updated });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/approve', async (req, res, next) => {
    let connection = null;
    let shouldRefreshBranch = false;
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
        const approvedDate =
            normalizeDateOnly(req.body?.date) ||
            normalizeDateOnly(req.body?.recordedAt) ||
            nowDateOnly();

        const pool = await getPool();
        if (!pool) {
            return next(createError(500, 'MySQL connection is not available.'));
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
        const approvedReference = normalizePaymentReference(approvedReferenceOverride);
        if (!approvedReference) {
            throw createError(400, 'Reference number is required.');
        }

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
        shouldRefreshBranch = true;
        connection.release();
        connection = null;

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
