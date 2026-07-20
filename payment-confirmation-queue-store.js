const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createError = require('http-errors');
const { query } = require('./db');

const PAYMENT_CONFIRMATION_QUEUE_TABLE = 'payment_confirmation_queue';
const MAX_PROOF_BYTES = 4 * 1024 * 1024; // 4 MB decoded image size
const ALLOWED_PROOF_TYPES = new Map([
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
]);
const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected']);
let ensureTablePromise = null;

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

const ensurePaymentConfirmationQueueTable = async () => {
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
                proof_image_url VARCHAR(255) NOT NULL,
                proof_mime VARCHAR(100) NOT NULL,
                proof_original_name VARCHAR(255) NULL,
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
    const absolutePath = path.join(__dirname, 'public', 'uploads', ...relativePath.split('/'));

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    return {
        relativePath,
        absolutePath,
        proofUrl: `/uploads/${relativePath}`
    };
};

const mapQueueRow = (row) => {
    if (!row) return null;
    return {
        id: String(row.id || ''),
        branchId: Number(row.branch_id) || null,
        accountNumber: String(row.account_number || '').trim(),
        customerName: row.customer_name || '',
        amount: row.amount != null ? Number(row.amount) : null,
        reference: row.reference || '',
        paymentMethod: row.payment_method || '',
        notes: row.notes || '',
        proofUrl: row.proof_image_url || '',
        proofMime: row.proof_mime || '',
        proofOriginalName: row.proof_original_name || '',
        status: sanitizeStatus(row.status, 'pending'),
        submittedAt: row.submitted_at || null,
        reviewedAt: row.reviewed_at || null,
        reviewedBy: {
            id: row.reviewed_by_user_id || null,
            username: row.reviewed_by_username || null,
            name: row.reviewed_by_name || null
        },
        decisionReason: row.decision_reason || '',
        paymentEntryId: row.payment_entry_id || null,
        reviewedAmount: row.reviewed_amount != null ? Number(row.reviewed_amount) : null,
        reviewedReference: row.reviewed_reference || ''
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

    const parsedProof = parseProofImagePayload(payload.proofImageData, payload.proofMimeType);
    const proofSaved = saveProofImageFile({
        branchId,
        extension: parsedProof.extension,
        buffer: parsedProof.buffer
    });

    const amountValue = toFiniteNumber(payload.amount);
    const amount = amountValue != null && amountValue > 0 ? Number(amountValue.toFixed(2)) : null;
    const reference = null;
    const paymentMethod = toSafeText(payload.paymentMethod, 40) || null;
    const notes = toSafeText(payload.notes, 2000) || null;
    const customerName = toSafeText(payload.customerName, 200) || null;
    const proofOriginalName = sanitizeProofFileName(payload.proofFileName) || null;
    const id = `pcq-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

    try {
        await query(
            `INSERT INTO ${PAYMENT_CONFIRMATION_QUEUE_TABLE} (
                id, branch_id, account_number, customer_name, amount, reference, payment_method, notes,
                proof_image_url, proof_mime, proof_original_name, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                id,
                branchId,
                accountNumber,
                customerName,
                amount,
                reference,
                paymentMethod,
                notes,
                proofSaved.proofUrl,
                parsedProof.mimeType,
                proofOriginalName
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
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

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
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
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
            rejected: Number(summary.rejected) || 0
        }
    };
};

const getPaymentConfirmationSubmission = async (id, branchId) => {
    await ensurePaymentConfirmationQueueTable();
    const safeId = toSafeText(id, 64);
    if (!safeId) return null;
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) return null;

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

module.exports = {
    PAYMENT_CONFIRMATION_QUEUE_TABLE,
    ensurePaymentConfirmationQueueTable,
    createPaymentConfirmationSubmission,
    listPaymentConfirmationSubmissions,
    getPaymentConfirmationSubmission,
    mapQueueRow
};
