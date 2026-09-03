const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isMysqlEnabled, query } = require('../../../../core/data/db');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { DATA_DIR } = require('../../../../core/runtime/paths');

const ARCHIVE_VERSION = 1;
const STORE_KEY_PREFIX = 'payment_deletion_archive_branch_';
const configuredStoreTable = String(process.env.MYSQL_STORE_TABLE || 'app_store').trim();
const STORE_TABLE = /^[a-z0-9_]+$/i.test(configuredStoreTable)
    ? configuredStoreTable
    : 'app_store';
const mutationQueues = new Map();

const createArchiveCorruptionError = (detail = '') => {
    const error = createError(
        409,
        'The payment deletion archive is malformed. No audit records were changed.'
    );
    error.code = 'PAYMENT_DELETION_ARCHIVE_MALFORMED';
    if (detail) error.archiveDetail = detail;
    return error;
};

const isPlainObject = (value) => Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value);

const cleanText = (value, maxLength = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const normalizeBranchId = (value) => {
    const branchId = Number(value);
    if (!Number.isInteger(branchId) || branchId <= 0) {
        throw createError(400, 'Branch assignment is required.');
    }
    return branchId;
};

const getStoreKey = (branchId) => `${STORE_KEY_PREFIX}${normalizeBranchId(branchId)}`;

const cloneJsonValue = (value, fallback) => {
    if (value == null) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        throw createError(400, 'Payment deletion archive data must be valid JSON.');
    }
};

const normalizeDateTime = (value, fallback = null) => {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    const raw = cleanText(value, 80);
    if (raw) {
        const parsed = new Date(raw);
        if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }
    if (fallback instanceof Date && Number.isFinite(fallback.getTime())) return fallback.toISOString();
    return cleanText(fallback, 80) || null;
};

const normalizeActor = (value, { required = false } = {}) => {
    const actor = value && typeof value === 'object' ? value : {};
    const normalized = {
        id: cleanText(actor.id || actor.userId || actor.user_id, 64) || null,
        username: cleanText(actor.username, 100) || null,
        name: cleanText(actor.name || actor.displayName, 120) || null,
        role: cleanText(actor.role, 40) || null
    };
    if (required && !normalized.id && !normalized.username && !normalized.name) {
        throw createError(400, 'Admin identity is required for this payment history action.');
    }
    return normalized;
};

const normalizeReason = (value, label) => {
    const reason = cleanText(value, 500);
    if (!reason) throw createError(400, `${label} reason is required.`);
    return reason;
};

const normalizeAuditEntry = (value, fallback = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    const action = cleanText(source.action || fallback.action, 40).toLowerCase();
    const at = normalizeDateTime(source.at || source.createdAt || fallback.at, fallback.at || null);
    if (!action || !at) return null;
    const actor = normalizeActor(source.actor || source.by || fallback.actor || {}, { required: false });
    const reason = cleanText(source.reason || fallback.reason, 500) || null;
    const details = cloneJsonValue(source.details, null);
    return {
        id: cleanText(source.id, 64) || `payment-delete-audit-${crypto.randomUUID()}`,
        action,
        at,
        actor,
        reason,
        details: details && typeof details === 'object' ? details : null
    };
};

const normalizeStoredAuditEntry = (value) => {
    if (!isPlainObject(value)) {
        throw createArchiveCorruptionError('Archive audit event must be an object.');
    }
    const id = cleanText(value.id, 64);
    const action = cleanText(value.action, 40).toLowerCase();
    const at = normalizeDateTime(value.at);
    const reason = cleanText(value.reason, 500);
    if (!id || !['deleted', 'restored'].includes(action) || !at || !reason) {
        throw createArchiveCorruptionError('Archive audit event is incomplete or unsupported.');
    }
    let actor;
    try {
        actor = normalizeActor(value.actor, { required: true });
    } catch {
        throw createArchiveCorruptionError('Archive audit event is missing its Admin identity.');
    }
    const details = cloneJsonValue(value.details, null);
    return {
        id,
        action,
        at,
        actor,
        reason,
        details: details && typeof details === 'object' ? details : null
    };
};

const normalizeStoredRecord = (value, branchId) => {
    if (!isPlainObject(value)) throw createArchiveCorruptionError('Archive record must be an object.');
    const safeBranchId = normalizeBranchId(branchId);
    const storedBranchId = Number(value.branchId);
    if (storedBranchId !== safeBranchId) throw createArchiveCorruptionError('Archive record branch does not match its store key.');

    const entry = cloneJsonValue(value.entry, null);
    if (!isPlainObject(entry)) throw createArchiveCorruptionError('Archive record is missing its payment entry snapshot.');
    const entryId = cleanText(value.entryId, 180);
    const snapshotEntryId = cleanText(entry.id, 180);
    const id = cleanText(value.id || value.archiveId || value.deletionId, 80);
    if (!id || !entryId || !snapshotEntryId || entryId !== snapshotEntryId) {
        throw createArchiveCorruptionError('Archive record is missing or disagrees on its archive or payment entry ID.');
    }
    entry.id = entryId;

    if (!isPlainObject(value.customer)) throw createArchiveCorruptionError('Archive customer snapshot must be an object.');
    const customer = cloneJsonValue(value.customer, {});
    if (!isPlainObject(customer)) throw createArchiveCorruptionError('Archive customer snapshot must be an object.');
    const accountNumber = cleanText(value.accountNumber, 40);
    const customerAccountNumber = cleanText(customer.accountNumber, 40);
    if (!accountNumber || !customerAccountNumber || accountNumber !== customerAccountNumber) {
        throw createArchiveCorruptionError('Archive record is missing or disagrees on its customer account number.');
    }
    customer.accountNumber = accountNumber;

    const deletedAt = normalizeDateTime(value.deletedAt);
    if (!deletedAt) throw createArchiveCorruptionError('Archive record is missing a valid deletion time.');
    const restoredAt = normalizeDateTime(value.restoredAt || value.restored_at);
    let deletedBy;
    try {
        deletedBy = normalizeActor(value.deletedBy, { required: true });
    } catch {
        throw createArchiveCorruptionError('Archive record is missing the deleting Admin identity.');
    }
    const restoredBy = restoredAt
        ? normalizeActor(value.restoredBy, { required: false })
        : null;
    const deletionReason = cleanText(value.deletionReason, 500);
    if (!deletionReason) throw createArchiveCorruptionError('Archive record is missing its deletion reason.');
    const restoreReason = restoredAt
        ? cleanText(value.restoreReason, 500) || null
        : null;
    if (restoredAt && (!restoredBy?.id && !restoredBy?.username && !restoredBy?.name)) {
        throw createArchiveCorruptionError('Restored archive record is missing the restoring Admin identity.');
    }
    if (restoredAt && !restoreReason) {
        throw createArchiveCorruptionError('Restored archive record is missing its restore reason.');
    }
    const rawStatus = cleanText(value.status, 20).toLowerCase();
    if (!['deleted', 'restored'].includes(rawStatus) || (rawStatus === 'restored') !== Boolean(restoredAt)) {
        throw createArchiveCorruptionError('Archive status and restoration metadata do not agree.');
    }
    if (!Array.isArray(value.audit) || !value.audit.length || value.audit.length > 200) {
        throw createArchiveCorruptionError('Archive record is missing its audit events or exceeds the audit limit.');
    }
    const audit = value.audit.map(normalizeStoredAuditEntry);
    const auditIds = new Set();
    audit.forEach((item) => {
        if (auditIds.has(item.id)) throw createArchiveCorruptionError('Archive record contains duplicate audit event IDs.');
        auditIds.add(item.id);
    });
    const deletionAuditCount = audit.filter((item) => item.action === 'deleted').length;
    const restoreAuditCount = audit.filter((item) => item.action === 'restored').length;
    if (deletionAuditCount !== 1 || restoreAuditCount !== (rawStatus === 'restored' ? 1 : 0)) {
        throw createArchiveCorruptionError('Archive record has invalid or incomplete audit events.');
    }
    if (!isPlainObject(value.related)) throw createArchiveCorruptionError('Archive related audit data must be an object.');
    const related = cloneJsonValue(value.related, {});
    if (!isPlainObject(related)) throw createArchiveCorruptionError('Archive related audit data must be an object.');

    return {
        id,
        branchId: safeBranchId,
        accountNumber,
        entryId,
        entry,
        customer,
        related,
        source: cleanText(value.source, 60) || 'payment-history',
        batchId: cleanText(value.batchId || value.batch_id, 80) || null,
        status: restoredAt ? 'restored' : 'deleted',
        deletionReason,
        deletedAt,
        deletedBy,
        restoredAt: restoredAt || null,
        restoredBy,
        restoreReason,
        audit,
        createdAt: normalizeDateTime(value.createdAt, deletedAt) || deletedAt,
        updatedAt: normalizeDateTime(value.updatedAt, restoredAt || deletedAt) || restoredAt || deletedAt
    };
};

const createPaymentDeletionRecord = ({
    branchId,
    accountNumber,
    entry,
    customer = {},
    related = {},
    audit = [],
    reason,
    deletionReason,
    actor,
    deletedBy,
    source = 'payment-history',
    batchId = null,
    deletedAt = null,
    id = null
} = {}) => {
    const safeBranchId = normalizeBranchId(branchId);
    const entrySnapshot = cloneJsonValue(entry, null);
    if (!entrySnapshot || typeof entrySnapshot !== 'object' || Array.isArray(entrySnapshot)) {
        throw createError(400, 'Payment entry snapshot is required.');
    }
    const entryId = cleanText(entrySnapshot.id, 180);
    if (!entryId) throw createError(400, 'Payment entry ID is required.');

    const customerSnapshot = cloneJsonValue(customer, {}) || {};
    const safeAccountNumber = cleanText(
        accountNumber || customerSnapshot.accountNumber || entrySnapshot.accountNumber,
        40
    );
    if (!safeAccountNumber) throw createError(400, 'Customer account number is required.');
    customerSnapshot.accountNumber = safeAccountNumber;

    const safeReason = normalizeReason(deletionReason || reason, 'Deletion');
    const safeActor = normalizeActor(deletedBy || actor, { required: true });
    const safeDeletedAt = normalizeDateTime(deletedAt, new Date());
    const recordId = cleanText(id, 80) || `payment-delete-${crypto.randomUUID()}`;
    const normalizedAudit = (Array.isArray(audit) ? audit : [])
        .map((item) => normalizeAuditEntry(item))
        .filter(Boolean)
        .slice(-199);
    normalizedAudit.push(normalizeAuditEntry({}, {
        action: 'deleted',
        at: safeDeletedAt,
        actor: safeActor,
        reason: safeReason
    }));

    return {
        id: recordId,
        branchId: safeBranchId,
        accountNumber: safeAccountNumber,
        entryId,
        entry: entrySnapshot,
        customer: customerSnapshot,
        related: cloneJsonValue(related, {}) || {},
        source: cleanText(source, 60) || 'payment-history',
        batchId: cleanText(batchId, 80) || null,
        status: 'deleted',
        deletionReason: safeReason,
        deletedAt: safeDeletedAt,
        deletedBy: safeActor,
        restoredAt: null,
        restoredBy: null,
        restoreReason: null,
        audit: normalizedAudit,
        createdAt: safeDeletedAt,
        updatedAt: safeDeletedAt
    };
};

const emptyArchive = (branchId) => ({
    version: ARCHIVE_VERSION,
    branchId: normalizeBranchId(branchId),
    records: [],
    updatedAt: null
});

const normalizeArchive = (value, branchId) => {
    const safeBranchId = normalizeBranchId(branchId);
    if (!isPlainObject(value)) throw createArchiveCorruptionError('Archive payload must be an object.');
    const source = value;
    if (Number(source.version) !== ARCHIVE_VERSION) {
        throw createArchiveCorruptionError('Archive version is missing or unsupported.');
    }
    if (Number(source.branchId) !== safeBranchId) {
        throw createArchiveCorruptionError('Archive branch does not match its store key.');
    }
    if (!Array.isArray(source.records)) throw createArchiveCorruptionError('Archive records must be an array.');
    const records = source.records
        .map((record) => normalizeStoredRecord(record, safeBranchId))
        .sort((left, right) => {
            const dateDifference = Date.parse(right.deletedAt) - Date.parse(left.deletedAt);
            return dateDifference || right.id.localeCompare(left.id);
        });
    const recordIds = new Set();
    records.forEach((record) => {
        if (recordIds.has(record.id)) throw createArchiveCorruptionError('Archive contains duplicate record IDs.');
        recordIds.add(record.id);
    });
    return {
        version: ARCHIVE_VERSION,
        branchId: safeBranchId,
        records,
        updatedAt: normalizeDateTime(source.updatedAt) || null
    };
};

const parseArchivePayload = (payload, branchId) => {
    let parsed = payload;
    if (!isPlainObject(parsed)) {
        const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload == null ? '' : payload);
        if (!raw.trim()) throw createArchiveCorruptionError('Archive payload is empty.');
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw createArchiveCorruptionError('Archive payload is not valid JSON.');
        }
    }
    try {
        return normalizeArchive(parsed, branchId);
    } catch (error) {
        if (error?.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED') throw error;
        throw createArchiveCorruptionError(error?.message || 'Archive payload could not be normalized.');
    }
};

const runExecutorQuery = async (executor, sql, params = []) => {
    if (!executor || typeof executor.query !== 'function') {
        throw createError(500, 'A database executor is required for transactional payment archive access.');
    }
    return executor.query(sql, params);
};

const readPaymentDeletionArchive = async ({ branchId, executor = null, lock = false } = {}) => {
    const safeBranchId = normalizeBranchId(branchId);
    const storeKey = getStoreKey(safeBranchId);
    if (!executor) {
        if (isJsonStorageMode() || !isMysqlEnabled()) {
            const filePath = path.join(DATA_DIR, `${storeKey}.json`);
            try {
                const payload = await fs.promises.readFile(filePath, 'utf8');
                return parseArchivePayload(payload, safeBranchId);
            } catch (error) {
                if (error?.code === 'ENOENT') return emptyArchive(safeBranchId);
                if (error?.code === 'PAYMENT_DELETION_ARCHIVE_MALFORMED') throw error;
                throw createError(500, 'Failed to read the payment deletion archive.');
            }
        }
        // Ensure the configured app-store table exists, then read the raw payload
        // so malformed JSON cannot be mistaken for a missing archive.
        await readJson(storeKey, emptyArchive(safeBranchId));
        const [rows] = await query(
            `SELECT payload FROM \`${STORE_TABLE}\` WHERE store_key = ? LIMIT 1`,
            [storeKey]
        );
        if (!Array.isArray(rows) || !rows.length) return emptyArchive(safeBranchId);
        return parseArchivePayload(rows[0]?.payload, safeBranchId);
    }

    if (lock) {
        await runExecutorQuery(
            executor,
            `INSERT INTO \`${STORE_TABLE}\` (store_key, payload)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE store_key = store_key`,
            [storeKey, JSON.stringify(emptyArchive(safeBranchId))]
        );
    }
    const [rows] = await runExecutorQuery(
        executor,
        `SELECT payload
         FROM \`${STORE_TABLE}\`
         WHERE store_key = ?
         ${lock ? 'FOR UPDATE' : 'LIMIT 1'}`,
        [storeKey]
    );
    if (!Array.isArray(rows) || !rows.length) return emptyArchive(safeBranchId);
    return parseArchivePayload(rows[0]?.payload, safeBranchId);
};

const writePaymentDeletionArchive = async (archive, { branchId, executor = null } = {}) => {
    const safeBranchId = normalizeBranchId(branchId);
    const normalized = normalizeArchive(archive, safeBranchId);
    normalized.updatedAt = new Date().toISOString();
    const storeKey = getStoreKey(safeBranchId);
    if (!executor) {
        await writeJson(storeKey, normalized);
        return normalized;
    }
    await runExecutorQuery(
        executor,
        `UPDATE \`${STORE_TABLE}\`
         SET payload = ?, updated_at = CURRENT_TIMESTAMP
         WHERE store_key = ?`,
        [JSON.stringify(normalized), storeKey]
    );
    return normalized;
};

const enqueueJsonMutation = (branchId, operation) => {
    const key = getStoreKey(branchId);
    const previous = mutationQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    mutationQueues.set(key, current);
    current.finally(() => {
        if (mutationQueues.get(key) === current) mutationQueues.delete(key);
    }).catch(() => {});
    return current;
};

const appendPaymentDeletionRecordsUnlocked = async ({ branchId, records, executor = null } = {}) => {
    const safeBranchId = normalizeBranchId(branchId);
    const supplied = Array.isArray(records) ? records : (records ? [records] : []);
    if (!supplied.length) throw createError(400, 'At least one payment deletion record is required.');
    const normalizedRecords = supplied.map((record) => {
        if (Number(record?.branchId || safeBranchId) !== safeBranchId) {
            throw createError(409, 'Payment deletion archive branch does not match the active branch.');
        }
        const normalized = normalizeStoredRecord(record, safeBranchId);
        if (!normalized || !normalized.deletionReason) {
            throw createError(400, 'A valid payment deletion record with a reason is required.');
        }
        normalizeActor(normalized.deletedBy, { required: true });
        return normalized;
    });
    const suppliedIds = new Set();
    normalizedRecords.forEach((record) => {
        if (suppliedIds.has(record.id)) throw createError(409, 'Payment deletion archive ID is duplicated.');
        suppliedIds.add(record.id);
    });

    const archive = await readPaymentDeletionArchive({ branchId: safeBranchId, executor, lock: true });
    const appended = [];
    normalizedRecords.forEach((record) => {
        const sameId = archive.records.find((item) => item.id === record.id);
        if (sameId) {
            if (JSON.stringify(sameId) !== JSON.stringify(record)) {
                throw createError(409, 'Payment deletion archive ID already belongs to a different record.');
            }
            appended.push(sameId);
            return;
        }
        const activeEntryArchive = archive.records.find((item) => (
            item.status === 'deleted'
            && !item.restoredAt
            && item.accountNumber === record.accountNumber
            && item.entryId === record.entryId
        ));
        if (activeEntryArchive) {
            throw createError(409, 'This payment entry is already in Deleted Payments.');
        }
        archive.records.push(record);
        appended.push(record);
    });
    archive.records.sort((left, right) => (
        Date.parse(right.deletedAt) - Date.parse(left.deletedAt)
        || right.id.localeCompare(left.id)
    ));
    await writePaymentDeletionArchive(archive, { branchId: safeBranchId, executor });
    return appended;
};

const appendPaymentDeletionRecords = async (options = {}) => {
    if (options.executor) return appendPaymentDeletionRecordsUnlocked(options);
    return enqueueJsonMutation(options.branchId, () => appendPaymentDeletionRecordsUnlocked(options));
};

const recordMatchesSearch = (record, search) => {
    const term = cleanText(search, 160).toLowerCase();
    if (!term) return true;
    return [
        record.id,
        record.accountNumber,
        record.entryId,
        record.entry?.reference,
        record.entry?.orNumber,
        record.entry?.or_number,
        record.entry?.paymentMethod,
        record.customer?.name,
        record.customer?.customerName,
        record.deletionReason,
        record.deletedBy?.name,
        record.deletedBy?.username,
        record.restoreReason,
        record.restoredBy?.name,
        record.restoredBy?.username
    ].some((value) => String(value || '').toLowerCase().includes(term));
};

const listPaymentDeletionRecords = async ({
    branchId,
    executor = null,
    includeRestored = false,
    search = '',
    limit = 25,
    offset = 0
} = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const safeOffset = Math.max(Math.floor(Number(offset) || 0), 0);
    const archive = await readPaymentDeletionArchive({ branchId, executor, lock: false });
    const filtered = archive.records.filter((record) => (
        (includeRestored || (record.status === 'deleted' && !record.restoredAt))
        && recordMatchesSearch(record, search)
    ));
    return {
        items: filtered.slice(safeOffset, safeOffset + safeLimit),
        total: filtered.length,
        limit: safeLimit,
        offset: safeOffset
    };
};

const markPaymentDeletionRestoredUnlocked = async ({
    branchId,
    id,
    archiveId,
    recordId,
    reason,
    restoreReason,
    actor,
    restoredBy,
    restoredAt = null,
    executor = null
} = {}) => {
    const safeBranchId = normalizeBranchId(branchId);
    const safeId = cleanText(id || archiveId || recordId, 80);
    if (!safeId) throw createError(400, 'Payment deletion archive ID is required.');
    const safeReason = normalizeReason(restoreReason || reason, 'Restore');
    const safeActor = normalizeActor(restoredBy || actor, { required: true });
    const archive = await readPaymentDeletionArchive({ branchId: safeBranchId, executor, lock: true });
    const index = archive.records.findIndex((record) => record.id === safeId);
    if (index < 0) throw createError(404, 'Deleted payment record was not found.');
    const current = archive.records[index];
    if (current.restoredAt || current.status === 'restored') return current;

    const safeRestoredAt = normalizeDateTime(restoredAt, new Date());
    const restoredAudit = normalizeAuditEntry({}, {
        action: 'restored',
        at: safeRestoredAt,
        actor: safeActor,
        reason: safeReason
    });
    const updated = {
        ...current,
        status: 'restored',
        restoredAt: safeRestoredAt,
        restoredBy: safeActor,
        restoreReason: safeReason,
        audit: [...current.audit, restoredAudit].slice(-200),
        updatedAt: safeRestoredAt
    };
    archive.records[index] = updated;
    await writePaymentDeletionArchive(archive, { branchId: safeBranchId, executor });
    return updated;
};

const markPaymentDeletionRestored = async (options = {}) => {
    if (options.executor) return markPaymentDeletionRestoredUnlocked(options);
    return enqueueJsonMutation(options.branchId, () => markPaymentDeletionRestoredUnlocked(options));
};

module.exports = {
    ARCHIVE_VERSION,
    STORE_KEY_PREFIX,
    appendPaymentDeletionRecords,
    createPaymentDeletionRecord,
    listPaymentDeletionRecords,
    markPaymentDeletionRestored,
    readPaymentDeletionArchive
};
