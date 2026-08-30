const crypto = require('crypto');
const createError = require('http-errors');
const fs = require('fs');
const { query } = require('../../../../core/data/db');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { normalizeCustomerName } = require('../../../../core/data/customer-name-normalizer');

const CUSTOMER_ARCHIVES_TABLE = 'customer_archives';
const STORE_KEY = 'customer_archives';
const ARCHIVE_RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let ensureTablePromise = null;
let cleanupInterval = null;

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const toNullableText = (value, maxLen = 0) => {
    const text = toSafeText(value, maxLen);
    return text || null;
};

const toPositiveInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return fallback;
    return parsed;
};

const toMysqlDateTime = (value) => {
    if (!value) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString().slice(0, 19).replace('T', ' ');
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const toDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toDateTimeOrFallback = (value, fallback = null) => toMysqlDateTime(value) || fallback;

const parseJsonText = (value, fallback) => {
    try {
        return JSON.parse(String(value || ''));
    } catch {
        return fallback;
    }
};

const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
};

const generateArchiveId = () => `cust-archive-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

const buildPurgeAfter = (deletedAt) => {
    const deletedDate = deletedAt instanceof Date && Number.isFinite(deletedAt.getTime())
        ? deletedAt
        : new Date();
    return toMysqlDateTime(new Date(deletedDate.getTime() + (ARCHIVE_RETENTION_DAYS * ONE_DAY_MS)));
};

const deleteLocalFiles = (filePaths = []) => {
    normalizeStringArray(filePaths).forEach((filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.warn(`Failed to delete archived customer file: ${filePath}`, error?.message || error);
        }
    });
};

const mapCustomerArchiveRow = (row, { includePayload = false } = {}) => {
    if (!row) return null;
    const deletedAt = row.deleted_at || row.deletedAt || null;
    const purgeAfter = row.purge_after || row.purgeAfter || null;
    const deletedDate = toDate(deletedAt);
    const purgeDate = toDate(purgeAfter);
    const remainingMs = purgeDate ? (purgeDate.getTime() - Date.now()) : 0;
    const daysRemaining = purgeDate ? Math.max(0, Math.ceil(remainingMs / ONE_DAY_MS)) : 0;
    const parsedPayload = parseJsonText(row.payload_json || row.payloadJson || '{}', {});
    const payloadMetadata = parsedPayload?.metadata && typeof parsedPayload.metadata === 'object' && !Array.isArray(parsedPayload.metadata)
        ? parsedPayload.metadata
        : {};
    const recordType = String(payloadMetadata?.recordType || '').trim().toLowerCase() === 'draft'
        ? 'draft'
        : 'customer';
    const payload = includePayload
        ? parsedPayload
        : undefined;
    return {
        id: String(row.id || ''),
        branchId: Number(row.branch_id || row.branchId) || null,
        accountNumber: toSafeText(row.account_number || row.accountNumber, 20),
        customerName: normalizeCustomerName(row.customer_name || row.customerName, 200),
        contactNumber: toSafeText(row.contact_number || row.contactNumber, 50),
        planName: toSafeText(row.plan_name || row.planName, 120),
        areaName: toSafeText(row.area_name || row.areaName, 150),
        paymentEntryCount: toPositiveInt(row.payment_entry_count || row.paymentEntryCount),
        ticketCount: toPositiveInt(row.ticket_count || row.ticketCount),
        jobCount: toPositiveInt(row.job_count || row.jobCount),
        smsMessageCount: toPositiveInt(row.sms_message_count || row.smsMessageCount),
        deletedAt,
        purgeAfter,
        daysRemaining,
        recordType,
        deletedBy: {
            id: toNullableText(row.deleted_by_user_id || row.deletedByUserId, 32),
            username: toNullableText(row.deleted_by_username || row.deletedByUsername, 100),
            name: toNullableText(row.deleted_by_name || row.deletedByName, 120)
        },
        restoredAt: row.restored_at || row.restoredAt || null,
        restoredBy: {
            id: toNullableText(row.restored_by_user_id || row.restoredByUserId, 32),
            username: toNullableText(row.restored_by_username || row.restoredByUsername, 100),
            name: toNullableText(row.restored_by_name || row.restoredByName, 120)
        },
        payload
    };
};

const normalizeJsonArchiveRow = (row = {}) => {
    const now = toMysqlDateTime(new Date());
    const branchId = Number(row.branch_id ?? row.branchId) || null;
    const payloadJson = typeof row.payload_json === 'string'
        ? row.payload_json
        : (typeof row.payloadJson === 'string' ? row.payloadJson : JSON.stringify(row.payload || {}));
    const proofFilePathsJson = typeof row.proof_file_paths_json === 'string'
        ? row.proof_file_paths_json
        : (typeof row.proofFilePathsJson === 'string' ? row.proofFilePathsJson : JSON.stringify(normalizeStringArray(row.proofFilePaths || [])));
    return {
        id: toSafeText(row.id, 64),
        branch_id: branchId,
        account_number: toSafeText(row.account_number ?? row.accountNumber, 20),
        customer_name: normalizeCustomerName(row.customer_name ?? row.customerName, 200) || null,
        contact_number: toNullableText(row.contact_number ?? row.contactNumber, 50),
        plan_name: toNullableText(row.plan_name ?? row.planName, 120),
        area_name: toNullableText(row.area_name ?? row.areaName, 150),
        payment_entry_count: toPositiveInt(row.payment_entry_count ?? row.paymentEntryCount),
        ticket_count: toPositiveInt(row.ticket_count ?? row.ticketCount),
        job_count: toPositiveInt(row.job_count ?? row.jobCount),
        sms_message_count: toPositiveInt(row.sms_message_count ?? row.smsMessageCount),
        deleted_at: toDateTimeOrFallback(row.deleted_at ?? row.deletedAt, now),
        purge_after: toDateTimeOrFallback(row.purge_after ?? row.purgeAfter, buildPurgeAfter(new Date())),
        deleted_by_user_id: toNullableText(row.deleted_by_user_id ?? row.deletedByUserId ?? row.deletedBy?.id, 32),
        deleted_by_username: toNullableText(row.deleted_by_username ?? row.deletedByUsername ?? row.deletedBy?.username, 100),
        deleted_by_name: toNullableText(row.deleted_by_name ?? row.deletedByName ?? row.deletedBy?.name, 120),
        payload_json: payloadJson,
        proof_file_paths_json: proofFilePathsJson,
        restored_at: toDateTimeOrFallback(row.restored_at ?? row.restoredAt, null),
        restored_by_user_id: toNullableText(row.restored_by_user_id ?? row.restoredByUserId ?? row.restoredBy?.id, 32),
        restored_by_username: toNullableText(row.restored_by_username ?? row.restoredByUsername ?? row.restoredBy?.username, 100),
        restored_by_name: toNullableText(row.restored_by_name ?? row.restoredByName ?? row.restoredBy?.name, 120),
        created_at: toDateTimeOrFallback(row.created_at ?? row.createdAt, now),
        updated_at: toDateTimeOrFallback(row.updated_at ?? row.updatedAt, now)
    };
};

const readJsonArchiveRows = async () => {
    const parsed = await readJson(STORE_KEY, []);
    const rows = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.items) ? parsed.items : []);
    return rows
        .map(normalizeJsonArchiveRow)
        .filter((row) => row.id && Number.isInteger(Number(row.branch_id)) && Number(row.branch_id) > 0);
};

const writeJsonArchiveRows = async (rows = []) => {
    const normalized = (Array.isArray(rows) ? rows : [])
        .map(normalizeJsonArchiveRow)
        .filter((row) => row.id && Number.isInteger(Number(row.branch_id)) && Number(row.branch_id) > 0)
        .sort((left, right) => {
            const rightTime = toDate(right.deleted_at)?.getTime() || 0;
            const leftTime = toDate(left.deleted_at)?.getTime() || 0;
            if (rightTime !== leftTime) return rightTime - leftTime;
            return String(right.id || '').localeCompare(String(left.id || ''));
        });
    await writeJson(STORE_KEY, normalized);
};

const ensureCustomerArchivesTable = async () => {
    if (!await isRelationalReady()) return;
    if (ensureTablePromise) return ensureTablePromise;
    ensureTablePromise = (async () => {
        await query(
            `CREATE TABLE IF NOT EXISTS ${CUSTOMER_ARCHIVES_TABLE} (
                id VARCHAR(64) PRIMARY KEY,
                branch_id INT NOT NULL,
                account_number VARCHAR(20) NOT NULL,
                customer_name VARCHAR(200) NULL,
                contact_number VARCHAR(50) NULL,
                plan_name VARCHAR(120) NULL,
                area_name VARCHAR(150) NULL,
                payment_entry_count INT NOT NULL DEFAULT 0,
                ticket_count INT NOT NULL DEFAULT 0,
                job_count INT NOT NULL DEFAULT 0,
                sms_message_count INT NOT NULL DEFAULT 0,
                deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                purge_after DATETIME NOT NULL,
                deleted_by_user_id VARCHAR(32) NULL,
                deleted_by_username VARCHAR(100) NULL,
                deleted_by_name VARCHAR(120) NULL,
                payload_json LONGTEXT NOT NULL,
                proof_file_paths_json LONGTEXT NULL,
                restored_at DATETIME NULL,
                restored_by_user_id VARCHAR(32) NULL,
                restored_by_username VARCHAR(100) NULL,
                restored_by_name VARCHAR(120) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_customer_archives_branch_deleted (branch_id, deleted_at),
                KEY idx_customer_archives_branch_purge (branch_id, purge_after),
                KEY idx_customer_archives_branch_account (branch_id, account_number),
                CONSTRAINT fk_customer_archives_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
    })().catch((error) => {
        ensureTablePromise = null;
        throw error;
    });
    return ensureTablePromise;
};

const createCustomerArchive = async ({
    branchId,
    accountNumber,
    customerName,
    contactNumber,
    planName,
    areaName,
    deletedBy = {},
    payload = {},
    proofFilePaths = [],
    executor = null
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const safeAccountNumber = toSafeText(accountNumber, 20);
    if (!safeAccountNumber) {
        throw createError(400, 'Customer account number is required.');
    }

    const archiveId = generateArchiveId();
    const deletedAtDate = new Date();
    const deletedAt = toMysqlDateTime(deletedAtDate);
    const purgeAfter = buildPurgeAfter(deletedAtDate);
    const serializedPayload = JSON.stringify(payload && typeof payload === 'object' ? payload : {});
    const serializedProofPaths = JSON.stringify(normalizeStringArray(proofFilePaths));
    const paymentEntryCount = Array.isArray(payload?.paymentEntries) ? payload.paymentEntries.length : 0;
    const ticketCount = Array.isArray(payload?.tickets) ? payload.tickets.length : 0;
    const jobCount = Array.isArray(payload?.jobs) ? payload.jobs.length : 0;
    const smsMessageCount = Array.isArray(payload?.smsMessages) ? payload.smsMessages.length : 0;

    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        rows.push(normalizeJsonArchiveRow({
            id: archiveId,
            branch_id: safeBranchId,
            account_number: safeAccountNumber,
            customer_name: normalizeCustomerName(customerName, 200) || null,
            contact_number: toNullableText(contactNumber, 50),
            plan_name: toNullableText(planName, 120),
            area_name: toNullableText(areaName, 150),
            payment_entry_count: paymentEntryCount,
            ticket_count: ticketCount,
            job_count: jobCount,
            sms_message_count: smsMessageCount,
            deleted_at: deletedAt,
            purge_after: purgeAfter,
            deleted_by_user_id: toNullableText(deletedBy?.id, 32),
            deleted_by_username: toNullableText(deletedBy?.username, 100),
            deleted_by_name: toNullableText(deletedBy?.name, 120),
            payload_json: serializedPayload,
            proof_file_paths_json: serializedProofPaths,
            created_at: deletedAt,
            updated_at: deletedAt
        }));
        await writeJsonArchiveRows(rows);
        return {
            id: archiveId,
            deletedAt,
            purgeAfter
        };
    }

    await ensureCustomerArchivesTable();

    const runQuery = executor && typeof executor.query === 'function'
        ? executor.query.bind(executor)
        : query;

    await runQuery(
        `INSERT INTO ${CUSTOMER_ARCHIVES_TABLE} (
            id,
            branch_id,
            account_number,
            customer_name,
            contact_number,
            plan_name,
            area_name,
            payment_entry_count,
            ticket_count,
            job_count,
            sms_message_count,
            deleted_at,
            purge_after,
            deleted_by_user_id,
            deleted_by_username,
            deleted_by_name,
            payload_json,
            proof_file_paths_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            archiveId,
            safeBranchId,
            safeAccountNumber,
            normalizeCustomerName(customerName, 200) || null,
            toNullableText(contactNumber, 50),
            toNullableText(planName, 120),
            toNullableText(areaName, 150),
            paymentEntryCount,
            ticketCount,
            jobCount,
            smsMessageCount,
            deletedAt,
            purgeAfter,
            toNullableText(deletedBy?.id, 32),
            toNullableText(deletedBy?.username, 100),
            toNullableText(deletedBy?.name, 120),
            serializedPayload,
            serializedProofPaths
        ]
    );

    return {
        id: archiveId,
        deletedAt,
        purgeAfter
    };
};

const listCustomerArchives = async ({
    branchId,
    search = '',
    limit = 25,
    offset = 0
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const term = toSafeText(search, 120);
    if (!await isRelationalReady()) {
        const normalizedTerm = term.toLowerCase();
        const rows = (await readJsonArchiveRows())
            .filter((row) => Number(row.branch_id) === safeBranchId)
            .filter((row) => !row.restored_at)
            .filter((row) => {
                if (!normalizedTerm) return true;
                return [
                    row.account_number,
                    row.customer_name,
                    row.plan_name,
                    row.area_name
                ].some((value) => String(value || '').toLowerCase().includes(normalizedTerm));
            })
            .sort((left, right) => {
                const rightTime = toDate(right.deleted_at)?.getTime() || 0;
                const leftTime = toDate(left.deleted_at)?.getTime() || 0;
                if (rightTime !== leftTime) return rightTime - leftTime;
                return String(right.id || '').localeCompare(String(left.id || ''));
            });
        const pagedRows = rows.slice(safeOffset, safeOffset + safeLimit);
        return {
            items: pagedRows.map((row) => mapCustomerArchiveRow(row)),
            total: rows.length,
            limit: safeLimit,
            offset: safeOffset
        };
    }

    await ensureCustomerArchivesTable();

    const likeTerm = `%${term}%`;
    const filterSql = term
        ? `AND (
            account_number LIKE ?
            OR customer_name LIKE ?
            OR plan_name LIKE ?
            OR area_name LIKE ?
        )`
        : '';
    const params = term
        ? [safeBranchId, likeTerm, likeTerm, likeTerm, likeTerm]
        : [safeBranchId];

    const [countRows] = await query(
        `SELECT COUNT(*) AS total
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE branch_id = ?
           AND restored_at IS NULL
           ${filterSql}`,
        params
    );
    const total = Number(countRows?.[0]?.total || 0);

    const [rows] = await query(
        `SELECT
            id,
            branch_id,
            account_number,
            customer_name,
            contact_number,
            plan_name,
            area_name,
            payment_entry_count,
            ticket_count,
            job_count,
            sms_message_count,
            deleted_at,
            purge_after,
            deleted_by_user_id,
            deleted_by_username,
            deleted_by_name,
            payload_json AS payloadJson,
            restored_at,
            restored_by_user_id,
            restored_by_username,
            restored_by_name
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE branch_id = ?
           AND restored_at IS NULL
           ${filterSql}
         ORDER BY deleted_at DESC, id DESC
         LIMIT ?
         OFFSET ?`,
        [...params, safeLimit, safeOffset]
    );

    return {
        items: (rows || []).map((row) => mapCustomerArchiveRow(row)),
        total,
        limit: safeLimit,
        offset: safeOffset
    };
};

const getCustomerArchiveById = async (archiveId, {
    branchId,
    includePayload = false
} = {}) => {
    const safeArchiveId = toSafeText(archiveId, 64);
    const safeBranchId = Number(branchId);
    if (!safeArchiveId) {
        throw createError(400, 'Archive ID is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        const row = rows.find((entry) =>
            String(entry.id || '').trim() === safeArchiveId &&
            Number(entry.branch_id) === safeBranchId
        );
        return row ? mapCustomerArchiveRow(row, { includePayload }) : null;
    }

    await ensureCustomerArchivesTable();

    const selectColumns = includePayload
        ? '*'
        : `id,
           branch_id,
           account_number,
           customer_name,
           contact_number,
           plan_name,
           area_name,
           payment_entry_count,
           ticket_count,
           job_count,
           sms_message_count,
           deleted_at,
           purge_after,
           deleted_by_user_id,
           deleted_by_username,
           deleted_by_name,
           restored_at,
           restored_by_user_id,
           restored_by_username,
           restored_by_name`;

    const [rows] = await query(
        `SELECT ${selectColumns}
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE id = ?
           AND branch_id = ?
         LIMIT 1`,
        [safeArchiveId, safeBranchId]
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return row ? mapCustomerArchiveRow(row, { includePayload }) : null;
};

const markCustomerArchiveRestored = async (archiveId, {
    branchId,
    restoredBy = {}
} = {}) => {
    const safeArchiveId = toSafeText(archiveId, 64);
    const safeBranchId = Number(branchId);
    if (!safeArchiveId) {
        throw createError(400, 'Archive ID is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        const index = rows.findIndex((entry) =>
            String(entry.id || '').trim() === safeArchiveId &&
            Number(entry.branch_id) === safeBranchId &&
            !entry.restored_at
        );
        if (index < 0) return false;
        const restoredAt = toMysqlDateTime(new Date());
        rows[index] = normalizeJsonArchiveRow({
            ...rows[index],
            restored_at: restoredAt,
            restored_by_user_id: toNullableText(restoredBy?.id, 32),
            restored_by_username: toNullableText(restoredBy?.username, 100),
            restored_by_name: toNullableText(restoredBy?.name, 120),
            updated_at: restoredAt
        });
        await writeJsonArchiveRows(rows);
        return true;
    }

    await ensureCustomerArchivesTable();

    const [result] = await query(
        `UPDATE ${CUSTOMER_ARCHIVES_TABLE}
         SET restored_at = CURRENT_TIMESTAMP,
             restored_by_user_id = ?,
             restored_by_username = ?,
             restored_by_name = ?
         WHERE id = ?
           AND branch_id = ?
           AND restored_at IS NULL`,
        [
            toNullableText(restoredBy?.id, 32),
            toNullableText(restoredBy?.username, 100),
            toNullableText(restoredBy?.name, 120),
            safeArchiveId,
            safeBranchId
        ]
    );

    return Boolean(result?.affectedRows);
};

const deleteCustomerArchivePermanently = async (archiveId, {
    branchId
} = {}) => {
    const safeArchiveId = toSafeText(archiveId, 64);
    const safeBranchId = Number(branchId);
    if (!safeArchiveId) {
        throw createError(400, 'Archive ID is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        const index = rows.findIndex((entry) =>
            String(entry.id || '').trim() === safeArchiveId &&
            Number(entry.branch_id) === safeBranchId &&
            !entry.restored_at
        );
        if (index < 0) {
            throw createError(404, 'Archived customer not found.');
        }
        const [archive] = rows.splice(index, 1);
        await writeJsonArchiveRows(rows);
        deleteLocalFiles(parseJsonText(archive?.proof_file_paths_json || '[]', []));
        return {
            archiveId: safeArchiveId,
            accountNumber: toSafeText(archive?.account_number, 20)
        };
    }

    await ensureCustomerArchivesTable();

    const [rows] = await query(
        `SELECT
            id,
            account_number AS accountNumber,
            proof_file_paths_json AS proofFilePathsJson
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE id = ?
           AND branch_id = ?
           AND restored_at IS NULL
         LIMIT 1`,
        [safeArchiveId, safeBranchId]
    );
    const archive = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!archive) {
        throw createError(404, 'Archived customer not found.');
    }

    const [result] = await query(
        `DELETE FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE id = ?
           AND branch_id = ?
           AND restored_at IS NULL`,
        [safeArchiveId, safeBranchId]
    );
    if (!result?.affectedRows) {
        throw createError(404, 'Archived customer not found.');
    }

    deleteLocalFiles(parseJsonText(archive?.proofFilePathsJson || '[]', []));
    return {
        archiveId: safeArchiveId,
        accountNumber: toSafeText(archive?.accountNumber, 20)
    };
};

const deleteAllCustomerArchivesPermanently = async ({
    branchId
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        const deletedRows = [];
        const keptRows = [];
        rows.forEach((row) => {
            if (Number(row.branch_id) === safeBranchId && !row.restored_at) {
                deletedRows.push(row);
            } else {
                keptRows.push(row);
            }
        });
        if (!deletedRows.length) {
            return { deletedCount: 0 };
        }
        await writeJsonArchiveRows(keptRows);
        const proofFilePaths = deletedRows.flatMap((row) =>
            normalizeStringArray(parseJsonText(row?.proof_file_paths_json || '[]', []))
        );
        deleteLocalFiles(proofFilePaths);
        return { deletedCount: deletedRows.length };
    }

    await ensureCustomerArchivesTable();

    const [rows] = await query(
        `SELECT proof_file_paths_json AS proofFilePathsJson
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE branch_id = ?
           AND restored_at IS NULL`,
        [safeBranchId]
    );
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
        return { deletedCount: 0 };
    }
    const proofFilePaths = items.flatMap((row) =>
        normalizeStringArray(parseJsonText(row?.proofFilePathsJson || '[]', []))
    );

    const [result] = await query(
        `DELETE FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE branch_id = ?
           AND restored_at IS NULL`,
        [safeBranchId]
    );
    deleteLocalFiles(proofFilePaths);
    return { deletedCount: Number(result?.affectedRows || items.length || 0) };
};

const purgeExpiredCustomerArchives = async () => {
    if (!await isRelationalReady()) {
        const rows = await readJsonArchiveRows();
        const now = Date.now();
        const expired = [];
        const kept = [];
        rows.forEach((row) => {
            const purgeTime = toDate(row.purge_after)?.getTime() || 0;
            if (!row.restored_at && purgeTime > 0 && purgeTime <= now) {
                expired.push(row);
            } else {
                kept.push(row);
            }
        });
        if (!expired.length) {
            return { purgedCount: 0 };
        }
        await writeJsonArchiveRows(kept);
        const proofFilePaths = expired.flatMap((row) =>
            normalizeStringArray(parseJsonText(row?.proof_file_paths_json || '[]', []))
        );
        deleteLocalFiles(proofFilePaths);
        return { purgedCount: expired.length };
    }

    await ensureCustomerArchivesTable();

    const [rows] = await query(
        `SELECT id, proof_file_paths_json AS proofFilePathsJson
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE restored_at IS NULL
           AND purge_after <= CURRENT_TIMESTAMP
         ORDER BY purge_after ASC, id ASC`
    );
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
        return { purgedCount: 0 };
    }

    const ids = items
        .map((row) => toSafeText(row?.id, 64))
        .filter(Boolean);
    if (!ids.length) {
        return { purgedCount: 0 };
    }

    const proofFilePaths = items.flatMap((row) =>
        normalizeStringArray(parseJsonText(row?.proofFilePathsJson || '[]', []))
    );

    await query(
        `DELETE FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids
    );
    deleteLocalFiles(proofFilePaths);
    return { purgedCount: ids.length };
};

const scheduleCustomerArchiveCleanup = ({ logger = console } = {}) => {
    if (cleanupInterval) return cleanupInterval;

    const runCleanup = async () => {
        try {
            const result = await purgeExpiredCustomerArchives();
            if (Number(result?.purgedCount || 0) > 0) {
                logger.info?.(`[customer-archive] Purged ${result.purgedCount} expired archived customer record(s).`);
            }
        } catch (error) {
            logger.warn?.('[customer-archive] Cleanup failed:', error?.message || error);
        }
    };

    runCleanup();
    cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
    cleanupInterval.unref?.();
    return cleanupInterval;
};

module.exports = {
    CUSTOMER_ARCHIVES_TABLE,
    ARCHIVE_RETENTION_DAYS,
    ensureCustomerArchivesTable,
    createCustomerArchive,
    listCustomerArchives,
    getCustomerArchiveById,
    markCustomerArchiveRestored,
    deleteCustomerArchivePermanently,
    deleteAllCustomerArchivesPermanently,
    purgeExpiredCustomerArchives,
    scheduleCustomerArchiveCleanup
};
