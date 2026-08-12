const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createError = require('http-errors');
const { query } = require('../../../../core/data/db');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { PUBLIC_ROOT } = require('../../../../core/runtime/paths');
const { sanitizeGcashProofAnalysis } = require('./gcash-screenshot-parser');

const PAYMENT_CONFIRMATION_QUEUE_TABLE = 'payment_confirmation_queue';
const PAYMENT_CONFIRMATION_QUEUE_STORE_KEY = 'payment_confirmation_queue';
const MAX_PROOF_BYTES = 4 * 1024 * 1024; // 4 MB decoded image size
const ALLOWED_PROOF_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
]);
const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected', 'needs_new_proof']);
let ensureTablePromise = null;
let jsonMutationQueue = Promise.resolve();

const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (maxLen > 0) return text.slice(0, maxLen);
    return text;
};

const sanitizeStatus = (value, fallback = 'pending') => {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_STATUS.has(normalized) ? normalized : fallback;
};

const normalizeProofReference = (value) => toSafeText(value, 64)
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 64);

const normalizePaymentDate = (value) => {
    const raw = toSafeText(value, 40);
    if (!raw) return null;
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnly) return `${dateOnly[1]} 00:00:00`;
    const localDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
    if (localDateTime) {
        return `${localDateTime[1]} ${localDateTime[2]}:${localDateTime[3] || '00'}`;
    }
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const normalizeJsonQueuePayload = (payload) => {
    const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : []);
    return items.filter((item) => item && typeof item === 'object');
};

const readJsonQueue = async () => normalizeJsonQueuePayload(
    await readJson(PAYMENT_CONFIRMATION_QUEUE_STORE_KEY, [])
);

const mutateJsonQueue = (mutation) => {
    const operation = jsonMutationQueue.catch(() => {}).then(async () => {
        const items = await readJsonQueue();
        const result = await mutation(items);
        await writeJson(PAYMENT_CONFIRMATION_QUEUE_STORE_KEY, items);
        return result;
    });
    jsonMutationQueue = operation.catch(() => {});
    return operation;
};

const ensurePaymentConfirmationQueueTable = async () => {
    if (isJsonStorageMode()) return;
    if (ensureTablePromise) return ensureTablePromise;
    ensureTablePromise = (async () => {
        await query(
            `CREATE TABLE IF NOT EXISTS ${PAYMENT_CONFIRMATION_QUEUE_TABLE} (
                id VARCHAR(64) PRIMARY KEY,
                branch_id INT NOT NULL,
                account_number VARCHAR(20) NOT NULL,
                customer_name VARCHAR(200) NULL,
                amount DECIMAL(12, 2) NULL,
                reference VARCHAR(64) NULL,
                payment_method VARCHAR(40) NULL,
                notes TEXT NULL,
                payment_date DATETIME NULL,
                proof_image_url VARCHAR(255) NOT NULL,
                proof_mime VARCHAR(100) NOT NULL,
                proof_original_name VARCHAR(255) NULL,
                proof_sha256 CHAR(64) NULL,
                proof_analysis_json LONGTEXT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at DATETIME NULL,
                reviewed_by_user_id VARCHAR(32) NULL,
                reviewed_by_username VARCHAR(100) NULL,
                reviewed_by_name VARCHAR(120) NULL,
                decision_reason TEXT NULL,
                payment_entry_id VARCHAR(64) NULL,
                reviewed_amount DECIMAL(12, 2) NULL,
                reviewed_reference VARCHAR(64) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_pcq_branch_status_submitted (branch_id, status, submitted_at),
                KEY idx_pcq_branch_account (branch_id, account_number),
                KEY idx_pcq_payment_entry (payment_entry_id),
                CONSTRAINT fk_pcq_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );

        const [columnRows] = await query(
            `SELECT column_name AS columnName
               FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = ?
               AND column_name IN ('payment_date', 'proof_sha256', 'proof_analysis_json')`,
            [PAYMENT_CONFIRMATION_QUEUE_TABLE]
        );
        const existingColumns = new Set((columnRows || []).map((row) => String(row.columnName || '').toLowerCase()));
        if (!existingColumns.has('payment_date')) {
            await query(`ALTER TABLE ${PAYMENT_CONFIRMATION_QUEUE_TABLE} ADD COLUMN payment_date DATETIME NULL AFTER notes`);
        }
        if (!existingColumns.has('proof_sha256')) {
            await query(`ALTER TABLE ${PAYMENT_CONFIRMATION_QUEUE_TABLE} ADD COLUMN proof_sha256 CHAR(64) NULL AFTER proof_original_name`);
        }
        if (!existingColumns.has('proof_analysis_json')) {
            await query(`ALTER TABLE ${PAYMENT_CONFIRMATION_QUEUE_TABLE} ADD COLUMN proof_analysis_json LONGTEXT NULL AFTER proof_sha256`);
        }
    })().catch((error) => {
        ensureTablePromise = null;
        throw error;
    });
    return ensureTablePromise;
};

const parseProofImagePayload = (proofImageData, proofMimeType = '') => {
    const raw = String(proofImageData || '').trim();
    if (!raw) {
        throw createError(400, 'Proof image is required.');
    }

    let mimeType = String(proofMimeType || '').trim().toLowerCase();
    let base64Data = raw;

    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
        mimeType = String(dataUrlMatch[1] || '').trim().toLowerCase();
        base64Data = String(dataUrlMatch[2] || '').trim();
    }

    if (!mimeType) {
        mimeType = 'image/jpeg';
    }
    if (!ALLOWED_PROOF_TYPES.has(mimeType)) {
        throw createError(400, 'Unsupported proof image type. Allowed: JPEG, PNG, WEBP.');
    }

    const normalizedBase64 = base64Data.replace(/\s+/g, '');
    if (!normalizedBase64 || !/^[a-z0-9+/_=-]+$/i.test(normalizedBase64)) {
        throw createError(400, 'Invalid proof image format.');
    }

    let buffer = null;
    try {
        buffer = Buffer.from(normalizedBase64, 'base64');
    } catch {
        throw createError(400, 'Invalid proof image payload.');
    }
    if (!buffer || !buffer.length) {
        throw createError(400, 'Proof image is empty.');
    }
    if (buffer.length > MAX_PROOF_BYTES) {
        throw createError(413, 'Proof image is too large. Max size is 4 MB.');
    }

    const hasExpectedSignature = (
        (['image/jpeg', 'image/jpg'].includes(mimeType)
            && buffer.length >= 3
            && buffer[0] === 0xff
            && buffer[1] === 0xd8
            && buffer[2] === 0xff)
        || (mimeType === 'image/png'
            && buffer.length >= 8
            && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        || (mimeType === 'image/webp'
            && buffer.length >= 12
            && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
    );
    if (!hasExpectedSignature) {
        throw createError(400, 'The uploaded file content does not match its image type.');
    }

    const extension = ALLOWED_PROOF_TYPES.get(mimeType) || 'jpg';
    return { mimeType, extension, buffer };
};

const sanitizeProofFileName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
};

const saveProofImageFile = ({ branchId, extension, buffer }) => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const branchSegment = String(branchId || '0').replace(/\D+/g, '') || '0';
    const fileName = `proof-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
    const relativePath = path.posix.join('payment-proofs', branchSegment, yyyy, mm, fileName);
    const absolutePath = path.join(PUBLIC_ROOT, 'uploads', ...relativePath.split('/'));

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    return {
        relativePath,
        absolutePath,
        proofUrl: `/uploads/${relativePath}`
    };
};

const parseStoredProofAnalysis = (value) => {
    if (!value) return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!parsed || typeof parsed !== 'object') return null;
        return sanitizeGcashProofAnalysis(parsed);
    } catch {
        return null;
    }
};

const mapQueueRow = (row) => {
    if (!row) return null;
    return {
        id: String(row.id || ''),
        branchId: Number(row.branch_id ?? row.branchId) || null,
        accountNumber: String(row.account_number ?? row.accountNumber ?? '').trim(),
        customerName: row.customer_name ?? row.customerName ?? '',
        amount: row.amount != null ? Number(row.amount) : null,
        reference: row.reference || '',
        paymentMethod: row.payment_method ?? row.paymentMethod ?? '',
        notes: row.notes || '',
        paymentDate: row.payment_date ?? row.paymentDate ?? null,
        proofUrl: row.proof_image_url ?? row.proofUrl ?? '',
        proofMime: row.proof_mime ?? row.proofMime ?? '',
        proofOriginalName: row.proof_original_name ?? row.proofOriginalName ?? '',
        proofSha256: row.proof_sha256 ?? row.proofSha256 ?? '',
        proofAnalysis: parseStoredProofAnalysis(row.proof_analysis_json ?? row.proofAnalysis),
        status: sanitizeStatus(row.status, 'pending'),
        submittedAt: row.submitted_at ?? row.submittedAt ?? null,
        reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
        reviewedBy: {
            id: row.reviewed_by_user_id ?? row.reviewedBy?.id ?? null,
            username: row.reviewed_by_username ?? row.reviewedBy?.username ?? null,
            name: row.reviewed_by_name ?? row.reviewedBy?.name ?? null
        },
        decisionReason: row.decision_reason ?? row.decisionReason ?? '',
        paymentEntryId: row.payment_entry_id ?? row.paymentEntryId ?? null,
        reviewedAmount: (row.reviewed_amount ?? row.reviewedAmount) != null
            ? Number(row.reviewed_amount ?? row.reviewedAmount)
            : null,
        reviewedReference: row.reviewed_reference ?? row.reviewedReference ?? ''
    };
};

const createPaymentConfirmationSubmission = async (payload = {}) => {
    await ensurePaymentConfirmationQueueTable();

    const branchId = Number(payload.branchId);
    if (!Number.isInteger(branchId) || branchId <= 0) {
        throw createError(400, 'Branch ID is required for payment proof submission.');
    }

    const accountNumber = toSafeText(payload.accountNumber, 20);
    if (!accountNumber) {
        throw createError(400, 'Account number is required.');
    }

    const amountValue = toFiniteNumber(payload.amount);
    const amount = amountValue != null && amountValue > 0 ? Number(amountValue.toFixed(2)) : null;
    const reference = normalizeProofReference(payload.reference) || null;
    const paymentMethod = toSafeText(payload.paymentMethod, 40) || null;
    const notes = toSafeText(payload.notes, 2000) || null;
    const paymentDate = normalizePaymentDate(payload.paymentDate);
    const customerName = toSafeText(payload.customerName, 200) || null;
    const proofOriginalName = sanitizeProofFileName(payload.proofFileName) || null;
    const proofAnalysis = payload.proofAnalysis && typeof payload.proofAnalysis === 'object'
        ? sanitizeGcashProofAnalysis(payload.proofAnalysis)
        : null;
    const parsedProof = parseProofImagePayload(payload.proofImageData, payload.proofMimeType);
    const proofSha256 = crypto.createHash('sha256').update(parsedProof.buffer).digest('hex');
    const requestedId = toSafeText(payload.id, 64);
    if (requestedId && !/^pcq-[a-z0-9_-]{8,60}$/i.test(requestedId)) {
        throw createError(400, 'Payment confirmation submission ID is invalid.');
    }
    const id = requestedId || `pcq-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const submittedAt = new Date().toISOString();

    if (isJsonStorageMode()) {
        return mutateJsonQueue(async (items) => {
            if (items.some((item) => String(item?.id || '') === id)) {
                throw createError(409, 'This payment confirmation submission already exists.');
            }
            const duplicateProof = items.find((item) => (
                Number(item?.branchId) === branchId
                && String(item?.proofSha256 || '') === proofSha256
            ));
            if (duplicateProof) {
                throw createError(409, 'This screenshot has already been submitted.');
            }
            const duplicateReference = reference && items.find((item) => (
                Number(item?.branchId) === branchId
                && normalizeProofReference(item?.reference) === reference
                && ['pending', 'approved'].includes(sanitizeStatus(item?.status))
            ));
            if (duplicateReference) {
                throw createError(409, 'This reference number has already been submitted.');
            }

            const proofSaved = saveProofImageFile({
                branchId,
                extension: parsedProof.extension,
                buffer: parsedProof.buffer
            });
            const item = {
                id,
                branchId,
                accountNumber,
                customerName,
                amount,
                reference,
                paymentMethod,
                notes,
                paymentDate,
                proofUrl: proofSaved.proofUrl,
                proofMime: parsedProof.mimeType,
                proofOriginalName,
                proofSha256,
                proofAnalysis,
                status: 'pending',
                submittedAt,
                reviewedAt: null,
                reviewedBy: { id: null, username: null, name: null },
                decisionReason: '',
                paymentEntryId: null,
                reviewedAmount: null,
                reviewedReference: ''
            };
            items.push(item);
            return mapQueueRow(item);
        });
    }

    const [duplicateRows] = await query(
        `SELECT id, status, reference, proof_sha256
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         WHERE branch_id = ?
           AND (
             proof_sha256 = ?
             OR (? IS NOT NULL AND reference = ? AND status IN ('pending', 'approved'))
           )
         LIMIT 1`,
        [branchId, proofSha256, reference, reference]
    );
    const duplicate = (duplicateRows || [])[0];
    if (duplicate) {
        if (String(duplicate.proof_sha256 || '') === proofSha256) {
            throw createError(409, 'This screenshot has already been submitted.');
        }
        throw createError(409, 'This reference number has already been submitted.');
    }

    const proofSaved = saveProofImageFile({
        branchId,
        extension: parsedProof.extension,
        buffer: parsedProof.buffer
    });

    try {
        await query(
            `INSERT INTO ${PAYMENT_CONFIRMATION_QUEUE_TABLE} (
                id, branch_id, account_number, customer_name, amount, reference, payment_method, notes,
                payment_date, proof_image_url, proof_mime, proof_original_name, proof_sha256, proof_analysis_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                id,
                branchId,
                accountNumber,
                customerName,
                amount,
                reference,
                paymentMethod,
                notes,
                paymentDate,
                proofSaved.proofUrl,
                parsedProof.mimeType,
                proofOriginalName,
                proofSha256,
                proofAnalysis ? JSON.stringify(proofAnalysis) : null
            ]
        );
    } catch (error) {
        try {
            fs.unlinkSync(proofSaved.absolutePath);
        } catch {
            // best effort cleanup
        }
        throw error;
    }

    const [rows] = await query(
        `SELECT *
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         WHERE id = ?
         LIMIT 1`,
        [id]
    );
    return mapQueueRow((rows || [])[0]);
};

const listPaymentConfirmationSubmissions = async ({
    branchId,
    status = 'pending',
    search = '',
    accountNumber = '',
    limit = 50,
    offset = 0
} = {}) => {
    await ensurePaymentConfirmationQueueTable();

    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const normalizedStatus = String(status || 'pending').trim().toLowerCase();
    const hasStatusFilter = normalizedStatus && normalizedStatus !== 'all' && ALLOWED_STATUS.has(normalizedStatus);
    const normalizedSearch = toSafeText(search, 200);
    const normalizedAccountNumber = toSafeText(accountNumber, 20);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    if (isJsonStorageMode()) {
        const items = (await readJsonQueue()).map(mapQueueRow).filter(Boolean);
        const branchItems = items.filter((item) => Number(item.branchId) === safeBranchId);
        const filtered = branchItems.filter((item) => {
            if (hasStatusFilter && item.status !== normalizedStatus) return false;
            if (normalizedAccountNumber && item.accountNumber !== normalizedAccountNumber) return false;
            if (normalizedSearch) {
                const haystack = `${item.accountNumber} ${item.customerName}`.toLowerCase();
                if (!haystack.includes(normalizedSearch.toLowerCase())) return false;
            }
            return true;
        }).sort((a, b) => {
            const dateDifference = new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime();
            return dateDifference || String(b.id).localeCompare(String(a.id));
        });
        const pageItems = filtered.slice(safeOffset, safeOffset + safeLimit);
        return {
            items: pageItems,
            pagination: { total: filtered.length, limit: safeLimit, offset: safeOffset },
            summary: {
                total: branchItems.length,
                pending: branchItems.filter((item) => item.status === 'pending').length,
                approved: branchItems.filter((item) => item.status === 'approved').length,
                rejected: branchItems.filter((item) => item.status === 'rejected').length,
                needsNewProof: branchItems.filter((item) => item.status === 'needs_new_proof').length
            }
        };
    }

    const where = ['branch_id = ?'];
    const params = [safeBranchId];
    if (hasStatusFilter) {
        where.push('status = ?');
        params.push(normalizedStatus);
    }
    if (normalizedSearch) {
        where.push('(account_number LIKE ? OR customer_name LIKE ?)');
        params.push(`%${normalizedSearch}%`, `%${normalizedSearch}%`);
    }
    if (normalizedAccountNumber) {
        where.push('account_number = ?');
        params.push(normalizedAccountNumber);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await query(
        `SELECT *
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         ${whereSql}
         ORDER BY submitted_at DESC, id DESC
         LIMIT ?
         OFFSET ?`,
        [...params, safeLimit, safeOffset]
    );

    const [countRows] = await query(
        `SELECT COUNT(*) AS total
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         ${whereSql}`,
        params
    );
    const total = Number((countRows || [])[0]?.total) || 0;

    const [summaryRows] = await query(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status = 'needs_new_proof' THEN 1 ELSE 0 END) AS needs_new_proof
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         WHERE branch_id = ?`,
        [safeBranchId]
    );
    const summary = (summaryRows || [])[0] || {};

    return {
        items: (rows || []).map(mapQueueRow),
        pagination: {
            total,
            limit: safeLimit,
            offset: safeOffset
        },
        summary: {
            total: Number(summary.total) || 0,
            pending: Number(summary.pending) || 0,
            approved: Number(summary.approved) || 0,
            rejected: Number(summary.rejected) || 0,
            needsNewProof: Number(summary.needs_new_proof) || 0
        }
    };
};

const getPaymentConfirmationSubmission = async (id, branchId) => {
    await ensurePaymentConfirmationQueueTable();
    const safeId = toSafeText(id, 64);
    if (!safeId) return null;
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) return null;

    if (isJsonStorageMode()) {
        const item = (await readJsonQueue()).find((candidate) => (
            String(candidate?.id || '') === safeId
            && Number(candidate?.branchId) === safeBranchId
        ));
        return mapQueueRow(item);
    }

    const [rows] = await query(
        `SELECT *
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         WHERE id = ?
           AND branch_id = ?
         LIMIT 1`,
        [safeId, safeBranchId]
    );
    return mapQueueRow((rows || [])[0]);
};

const updatePaymentConfirmationSubmission = async (id, branchId, changes = {}, options = {}) => {
    await ensurePaymentConfirmationQueueTable();
    const safeId = toSafeText(id, 64);
    const safeBranchId = Number(branchId);
    if (!safeId || !Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Valid submission and branch IDs are required.');
    }
    const expectedStatus = options.expectedStatus
        ? sanitizeStatus(options.expectedStatus, '')
        : '';

    if (isJsonStorageMode()) {
        return mutateJsonQueue(async (items) => {
            const index = items.findIndex((candidate) => (
                String(candidate?.id || '') === safeId
                && Number(candidate?.branchId) === safeBranchId
            ));
            if (index < 0) throw createError(404, 'Payment confirmation request not found.');
            const current = mapQueueRow(items[index]);
            if (expectedStatus && current.status !== expectedStatus) {
                throw createError(409, `This request is already ${current.status}.`);
            }
            const next = {
                ...items[index],
                ...changes,
                id: safeId,
                branchId: safeBranchId
            };
            if (changes.status) next.status = sanitizeStatus(changes.status, current.status);
            items[index] = next;
            return mapQueueRow(next);
        });
    }

    const assignments = [];
    const params = [];
    const add = (column, value) => {
        assignments.push(`${column} = ?`);
        params.push(value);
    };
    if (changes.status !== undefined) add('status', sanitizeStatus(changes.status));
    if (changes.reviewedAt !== undefined) add('reviewed_at', changes.reviewedAt);
    if (changes.reviewedBy !== undefined) {
        add('reviewed_by_user_id', toSafeText(changes.reviewedBy?.id, 32) || null);
        add('reviewed_by_username', toSafeText(changes.reviewedBy?.username, 100) || null);
        add('reviewed_by_name', toSafeText(changes.reviewedBy?.name, 120) || null);
    }
    if (changes.decisionReason !== undefined) add('decision_reason', toSafeText(changes.decisionReason, 2000) || null);
    if (changes.paymentEntryId !== undefined) add('payment_entry_id', toSafeText(changes.paymentEntryId, 64) || null);
    if (changes.reviewedAmount !== undefined) add('reviewed_amount', toFiniteNumber(changes.reviewedAmount));
    if (changes.reviewedReference !== undefined) add('reviewed_reference', normalizeProofReference(changes.reviewedReference) || null);
    if (changes.amount !== undefined) add('amount', toFiniteNumber(changes.amount));
    if (changes.reference !== undefined) add('reference', normalizeProofReference(changes.reference) || null);
    if (changes.paymentMethod !== undefined) add('payment_method', toSafeText(changes.paymentMethod, 40) || null);
    if (!assignments.length) return getPaymentConfirmationSubmission(safeId, safeBranchId);

    params.push(safeId, safeBranchId);
    let whereStatus = '';
    if (expectedStatus) {
        whereStatus = ' AND status = ?';
        params.push(expectedStatus);
    }
    const [result] = await query(
        `UPDATE ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         SET ${assignments.join(', ')}
         WHERE id = ? AND branch_id = ?${whereStatus}`,
        params
    );
    if (!result?.affectedRows) {
        const existing = await getPaymentConfirmationSubmission(safeId, safeBranchId);
        if (!existing) throw createError(404, 'Payment confirmation request not found.');
        throw createError(409, `This request is already ${existing.status}.`);
    }
    return getPaymentConfirmationSubmission(safeId, safeBranchId);
};

module.exports = {
    PAYMENT_CONFIRMATION_QUEUE_TABLE,
    PAYMENT_CONFIRMATION_QUEUE_STORE_KEY,
    ensurePaymentConfirmationQueueTable,
    createPaymentConfirmationSubmission,
    listPaymentConfirmationSubmissions,
    getPaymentConfirmationSubmission,
    updatePaymentConfirmationSubmission,
    normalizeProofReference,
    parseProofImagePayload,
    mapQueueRow
};
