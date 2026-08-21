const crypto = require('crypto');
const createError = require('http-errors');
const { getPool, query } = require('../../../../core/data/db');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const {
    readCustomers,
    resolveStoredAccountPrefixId,
    generateAccountNumber
} = require('./customers');

const CUSTOMER_DRAFT_SUBMISSIONS_TABLE = 'customer_draft_submissions';
const STORE_KEY = 'customer_draft_submissions';
const PUBLIC_STATUS = new Set(['pending', 'approved', 'rejected']);
const INTERNAL_STATUS = new Set(['processing']);
const ALLOWED_STATUS = new Set([...PUBLIC_STATUS, ...INTERNAL_STATUS]);
let ensureTablePromise = null;
let backfillDraftAccountNumbersPromise = null;
const jsonCompletionMutationTails = new Map();

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const parseDraftJson = (value) => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const normalizeStatus = (value, fallback = 'pending') => {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_STATUS.has(normalized) ? normalized : fallback;
};

const normalizeStatusFilters = (values = []) => {
    const list = Array.isArray(values) ? values : [values];
    return Array.from(
        new Set(
            list
                .map((value) => String(value || '').trim().toLowerCase())
                .filter((value) => ALLOWED_STATUS.has(value))
        )
    );
};

const withCustomerDraftStoreMutationLock = async (task) => {
    // All branches share one JSON file, so the compare-and-set must serialize the
    // complete read/modify/write cycle across the store rather than per branch.
    const key = 'all';
    const previous = jsonCompletionMutationTails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    jsonCompletionMutationTails.set(key, tail);
    await previous.catch(() => {});
    try {
        return await task();
    } finally {
        release();
        if (jsonCompletionMutationTails.get(key) === tail) {
            jsonCompletionMutationTails.delete(key);
        }
    }
};

const createInstallationCompletionConflict = () => {
    const error = createError(409, 'Installation completion was already submitted with different evidence.');
    error.code = 'INSTALLATION_COMPLETION_CONFLICT';
    return error;
};

const resolveInstallationCompletionCas = (existingCompletion, proposedCompletion) => {
    const proposed = proposedCompletion && typeof proposedCompletion === 'object' && !Array.isArray(proposedCompletion)
        ? JSON.parse(JSON.stringify(proposedCompletion))
        : null;
    const proposedEventId = toSafeText(proposed?.clientEventId, 100);
    const proposedFingerprint = toSafeText(proposed?.fingerprint, 64);
    if (!proposed || !proposedEventId || !proposedFingerprint) {
        throw createError(400, 'Installation completion event and fingerprint are required.');
    }
    const existing = existingCompletion && typeof existingCompletion === 'object' && !Array.isArray(existingCompletion)
        ? existingCompletion
        : null;
    if (!existing) {
        return { action: 'insert', completion: proposed };
    }
    const existingEventId = toSafeText(existing.clientEventId, 100);
    const existingFingerprint = toSafeText(existing.fingerprint, 64);
    if (existingEventId === proposedEventId && existingFingerprint === proposedFingerprint) {
        return { action: 'replay', completion: JSON.parse(JSON.stringify(existing)) };
    }
    throw createInstallationCompletionConflict();
};

const buildCustomerName = (draft = {}) => {
    const explicit = toSafeText(draft.name, 200);
    if (explicit) return explicit;
    const firstName = toSafeText(draft.firstName, 100);
    const lastName = toSafeText(draft.lastName, 100);
    return `${firstName} ${lastName}`.trim();
};

const buildAddressText = (draft = {}) =>
    [
        toSafeText(draft.street, 150),
        toSafeText(draft.barangay, 150),
        toSafeText(draft.municipality, 150),
        toSafeText(draft.province, 150)
    ]
        .filter(Boolean)
        .join(', ')
        .slice(0, 255);

const normalizeAccountNumber = (value) => toSafeText(value, 20);

const toJsonDateTime = (value, fallback = '') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return raw;
    return parsed.toISOString();
};

const normalizeJsonSubmissionRow = (row = {}) => {
    const draftData = row.draftData && typeof row.draftData === 'object' && !Array.isArray(row.draftData)
        ? row.draftData
        : parseDraftJson(row.draft_json);
    const submittedBy = row.submittedBy && typeof row.submittedBy === 'object' ? row.submittedBy : {};
    const reviewedBy = row.reviewedBy && typeof row.reviewedBy === 'object' ? row.reviewedBy : {};
    const now = new Date().toISOString();
    const submittedAt = toJsonDateTime(row.submitted_at || row.submittedAt, now);
    const reviewedAt = toJsonDateTime(row.reviewed_at || row.reviewedAt, '');
    const createdAt = toJsonDateTime(row.created_at || row.createdAt, submittedAt || now);
    return {
        id: toSafeText(row.id, 64),
        branch_id: Number(row.branch_id ?? row.branchId) || null,
        submitted_by_user_id: toSafeText(row.submitted_by_user_id ?? row.submittedByUserId ?? submittedBy.id, 32),
        submitted_by_username: toSafeText(row.submitted_by_username ?? row.submittedByUsername ?? submittedBy.username, 100) || null,
        submitted_by_name: toSafeText(row.submitted_by_name ?? row.submittedByName ?? submittedBy.name, 120) || null,
        customer_name: toSafeText(row.customer_name ?? row.customerName, 200) || buildCustomerName(draftData) || null,
        contact_number: toSafeText(row.contact_number ?? row.contactNumber, 50) || toSafeText(draftData.mobile || draftData.contactNumber, 50) || null,
        plan_name: toSafeText(row.plan_name ?? row.planName, 120) || toSafeText(draftData.planName, 120) || null,
        area_name: toSafeText(row.area_name ?? row.areaName, 150) || toSafeText(draftData.area, 150) || null,
        address_text: toSafeText(row.address_text ?? row.addressText, 255) || buildAddressText(draftData) || null,
        draft_account_number: normalizeAccountNumber(row.draft_account_number ?? row.draftAccountNumber ?? row.approved_customer_account_number ?? row.approvedCustomerAccountNumber) || null,
        draft_json: typeof row.draft_json === 'string' ? row.draft_json : JSON.stringify(draftData || {}),
        status: normalizeStatus(row.status ?? row.rawStatus, 'pending'),
        submitted_at: submittedAt,
        reviewed_at: reviewedAt || null,
        reviewed_by_user_id: toSafeText(row.reviewed_by_user_id ?? row.reviewedByUserId ?? reviewedBy.id, 32) || null,
        reviewed_by_username: toSafeText(row.reviewed_by_username ?? row.reviewedByUsername ?? reviewedBy.username, 100) || null,
        reviewed_by_name: toSafeText(row.reviewed_by_name ?? row.reviewedByName ?? reviewedBy.name, 120) || null,
        decision_reason: toSafeText(row.decision_reason ?? row.decisionReason, 2000) || null,
        approved_customer_account_number: normalizeAccountNumber(row.approved_customer_account_number ?? row.approvedCustomerAccountNumber) || null,
        created_at: createdAt,
        updated_at: toJsonDateTime(row.updated_at || row.updatedAt, now)
    };
};

const readJsonSubmissionRows = async () => {
    const parsed = await readJson(STORE_KEY, []);
    const rows = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.items) ? parsed.items : []);
    return rows
        .map(normalizeJsonSubmissionRow)
        .filter((row) => row.id && Number.isInteger(Number(row.branch_id)) && Number(row.branch_id) > 0);
};

const writeJsonSubmissionRows = async (rows = []) => {
    const normalized = (Array.isArray(rows) ? rows : [])
        .map(normalizeJsonSubmissionRow)
        .filter((row) => row.id && Number.isInteger(Number(row.branch_id)) && Number(row.branch_id) > 0)
        .sort((left, right) => {
            const rightTime = new Date(right.submitted_at || 0).getTime() || 0;
            const leftTime = new Date(left.submitted_at || 0).getTime() || 0;
            if (rightTime !== leftTime) return rightTime - leftTime;
            return String(right.id || '').localeCompare(String(left.id || ''));
        });
    await writeJson(STORE_KEY, normalized);
};

const isDuplicateColumnError = (error) =>
    /duplicate column name|er_dup_fieldname/i.test(String(error?.message || ''));

const isDuplicateKeyError = (error) =>
    /duplicate key name|er_dup_keyname/i.test(String(error?.message || ''));

const collectReservedAccountNumbers = async () => {
    const existing = new Set();
    const customers = await readCustomers();
    customers.forEach((customer) => {
        const accountNumber = normalizeAccountNumber(customer?.accountNumber);
        if (accountNumber) existing.add(accountNumber);
    });

    if (!await isRelationalReady()) {
        const rows = await readJsonSubmissionRows();
        rows.forEach((row) => {
            const draftAccountNumber = normalizeAccountNumber(row?.draft_account_number);
            const approvedCustomerAccountNumber = normalizeAccountNumber(row?.approved_customer_account_number);
            if (draftAccountNumber) existing.add(draftAccountNumber);
            if (approvedCustomerAccountNumber) existing.add(approvedCustomerAccountNumber);
        });
        return existing;
    }

    const [rows] = await query(
        `SELECT draft_account_number AS draftAccountNumber,
                approved_customer_account_number AS approvedCustomerAccountNumber
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         WHERE COALESCE(NULLIF(TRIM(draft_account_number), ''), NULL) IS NOT NULL
            OR COALESCE(NULLIF(TRIM(approved_customer_account_number), ''), NULL) IS NOT NULL`
    );
    (rows || []).forEach((row) => {
        const draftAccountNumber = normalizeAccountNumber(row?.draftAccountNumber);
        const approvedCustomerAccountNumber = normalizeAccountNumber(row?.approvedCustomerAccountNumber);
        if (draftAccountNumber) existing.add(draftAccountNumber);
        if (approvedCustomerAccountNumber) existing.add(approvedCustomerAccountNumber);
    });
    return existing;
};

const generateReservedDraftAccountNumber = async (existingSet = null) => {
    const reserved = existingSet instanceof Set ? existingSet : await collectReservedAccountNumbers();
    const prefixId = await resolveStoredAccountPrefixId();
    const nextAccountNumber = generateAccountNumber(reserved, prefixId);
    reserved.add(nextAccountNumber);
    return nextAccountNumber;
};

const backfillMissingDraftAccountNumbers = async () => {
    if (backfillDraftAccountNumbersPromise) return backfillDraftAccountNumbersPromise;
    backfillDraftAccountNumbersPromise = (async () => {
        if (!await isRelationalReady()) {
            const rows = await readJsonSubmissionRows();
            let changed = false;
            const reserved = await collectReservedAccountNumbers();
            for (const row of rows) {
                if (normalizeAccountNumber(row.draft_account_number)) continue;
                const approvedCustomerAccountNumber = normalizeAccountNumber(row.approved_customer_account_number);
                row.draft_account_number = approvedCustomerAccountNumber || await generateReservedDraftAccountNumber(reserved);
                row.updated_at = new Date().toISOString();
                changed = true;
            }
            if (changed) {
                await writeJsonSubmissionRows(rows);
            }
            return;
        }

        const [rows] = await query(
            `SELECT id, approved_customer_account_number AS approvedCustomerAccountNumber
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE draft_account_number IS NULL
                OR TRIM(draft_account_number) = ''
             ORDER BY submitted_at ASC, id ASC`
        );
        if (!rows || !rows.length) return;

        const reserved = await collectReservedAccountNumbers();
        for (const row of rows) {
            const approvedCustomerAccountNumber = normalizeAccountNumber(row?.approvedCustomerAccountNumber);
            const nextAccountNumber = approvedCustomerAccountNumber || await generateReservedDraftAccountNumber(reserved);
            await query(
                `UPDATE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
                 SET draft_account_number = ?
                 WHERE id = ?
                   AND (draft_account_number IS NULL OR TRIM(draft_account_number) = '')`,
                [nextAccountNumber, row.id]
            );
        }
    })().finally(() => {
        backfillDraftAccountNumbersPromise = null;
    });
    return backfillDraftAccountNumbersPromise;
};

const mapCustomerDraftSubmissionRow = (row) => {
    if (!row) return null;
    const status = normalizeStatus(row.status, 'pending');
    return {
        id: String(row.id || ''),
        branchId: Number(row.branch_id) || null,
        customerName: row.customer_name || '',
        contactNumber: row.contact_number || '',
        planName: row.plan_name || '',
        areaName: row.area_name || '',
        addressText: row.address_text || '',
        draftAccountNumber: normalizeAccountNumber(row.draft_account_number || row.approved_customer_account_number),
        status: PUBLIC_STATUS.has(status) ? status : 'pending',
        rawStatus: status,
        draftData: parseDraftJson(row.draft_json),
        submittedAt: row.submitted_at || null,
        submittedBy: {
            id: row.submitted_by_user_id || null,
            username: row.submitted_by_username || null,
            name: row.submitted_by_name || null
        },
        reviewedAt: row.reviewed_at || null,
        reviewedBy: {
            id: row.reviewed_by_user_id || null,
            username: row.reviewed_by_username || null,
            name: row.reviewed_by_name || null
        },
        decisionReason: row.decision_reason || '',
        approvedCustomerAccountNumber: row.approved_customer_account_number || ''
    };
};

const ensureCustomerDraftSubmissionsTable = async () => {
    if (ensureTablePromise) return ensureTablePromise;
    ensureTablePromise = (async () => {
        if (!await isRelationalReady()) {
            await backfillMissingDraftAccountNumbers();
            return;
        }

        await query(
            `CREATE TABLE IF NOT EXISTS ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE} (
                id VARCHAR(64) PRIMARY KEY,
                branch_id INT NOT NULL,
                submitted_by_user_id VARCHAR(32) NOT NULL,
                submitted_by_username VARCHAR(100) NULL,
                submitted_by_name VARCHAR(120) NULL,
                customer_name VARCHAR(200) NULL,
                contact_number VARCHAR(50) NULL,
                plan_name VARCHAR(120) NULL,
                area_name VARCHAR(150) NULL,
                address_text VARCHAR(255) NULL,
                draft_account_number VARCHAR(20) NULL,
                draft_json LONGTEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at DATETIME NULL,
                reviewed_by_user_id VARCHAR(32) NULL,
                reviewed_by_username VARCHAR(100) NULL,
                reviewed_by_name VARCHAR(120) NULL,
                decision_reason TEXT NULL,
                approved_customer_account_number VARCHAR(20) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_cds_branch_status_submitted (branch_id, status, submitted_at),
                KEY idx_cds_branch_submitter (branch_id, submitted_by_user_id, submitted_at),
                KEY idx_cds_plan_name (plan_name),
                CONSTRAINT fk_cds_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
        );
        try {
            await query(
                `ALTER TABLE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
                 ADD COLUMN draft_account_number VARCHAR(20) NULL AFTER address_text`
            );
        } catch (error) {
            if (!isDuplicateColumnError(error)) throw error;
        }
        try {
            await query(
                `ALTER TABLE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
                 ADD KEY idx_cds_draft_account_number (draft_account_number)`
            );
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
        }
        await backfillMissingDraftAccountNumbers();
    })().catch((error) => {
        ensureTablePromise = null;
        throw error;
    });
    return ensureTablePromise;
};

const createCustomerDraftSubmission = async ({
    branchId,
    submittedBy = {},
    draftData = {}
} = {}) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const submitterId = toSafeText(submittedBy.id, 32);
    if (!submitterId) {
        throw createError(400, 'Technician ID is required.');
    }

    const normalizedDraft = draftData && typeof draftData === 'object' && !Array.isArray(draftData)
        ? draftData
        : {};
    const customerName = buildCustomerName(normalizedDraft);
    if (!customerName) {
        throw createError(400, 'Customer name is required.');
    }

    const serializedDraft = JSON.stringify(normalizedDraft);
    const id = `cds-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const draftAccountNumber = await generateReservedDraftAccountNumber();

    if (!await isRelationalReady()) {
        const now = new Date().toISOString();
        const rows = await readJsonSubmissionRows();
        const row = normalizeJsonSubmissionRow({
            id,
            branch_id: safeBranchId,
            submitted_by_user_id: submitterId,
            submitted_by_username: toSafeText(submittedBy.username, 100) || null,
            submitted_by_name: toSafeText(submittedBy.name, 120) || null,
            customer_name: customerName || null,
            contact_number: toSafeText(normalizedDraft.mobile, 50) || null,
            plan_name: toSafeText(normalizedDraft.planName, 120) || null,
            area_name: toSafeText(normalizedDraft.area, 150) || null,
            address_text: buildAddressText(normalizedDraft) || null,
            draft_account_number: draftAccountNumber,
            draft_json: serializedDraft,
            status: 'pending',
            submitted_at: now,
            created_at: now,
            updated_at: now
        });
        rows.unshift(row);
        await writeJsonSubmissionRows(rows);
        return getCustomerDraftSubmission(id, safeBranchId);
    }

    await query(
        `INSERT INTO ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE} (
            id, branch_id, submitted_by_user_id, submitted_by_username, submitted_by_name,
            customer_name, contact_number, plan_name, area_name, address_text, draft_account_number, draft_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
            id,
            safeBranchId,
            submitterId,
            toSafeText(submittedBy.username, 100) || null,
            toSafeText(submittedBy.name, 120) || null,
            customerName || null,
            toSafeText(normalizedDraft.mobile, 50) || null,
            toSafeText(normalizedDraft.planName, 120) || null,
            toSafeText(normalizedDraft.area, 150) || null,
            buildAddressText(normalizedDraft) || null,
            draftAccountNumber,
            serializedDraft
        ]
    );

    return getCustomerDraftSubmission(id, safeBranchId);
};

const listCustomerDraftSubmissions = async ({
    branchId,
    status = 'pending',
    submittedByUserId = '',
    limit = 50,
    offset = 0
} = {}) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const normalizedStatus = String(status || 'pending').trim().toLowerCase();
    const hasStatusFilter = normalizedStatus && normalizedStatus !== 'all' && ALLOWED_STATUS.has(normalizedStatus);
    const safeSubmittedByUserId = toSafeText(submittedByUserId, 32);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    if (!await isRelationalReady()) {
        const rows = await readJsonSubmissionRows();
        const scopedRows = rows.filter((row) => {
            if (Number(row.branch_id) !== safeBranchId) return false;
            if (hasStatusFilter && normalizeStatus(row.status) !== normalizedStatus) return false;
            if (safeSubmittedByUserId && toSafeText(row.submitted_by_user_id, 32) !== safeSubmittedByUserId) return false;
            return true;
        }).sort((left, right) => {
            const rightTime = new Date(right.submitted_at || 0).getTime() || 0;
            const leftTime = new Date(left.submitted_at || 0).getTime() || 0;
            if (rightTime !== leftTime) return rightTime - leftTime;
            return String(right.id || '').localeCompare(String(left.id || ''));
        });
        const summaryRows = rows.filter((row) => Number(row.branch_id) === safeBranchId);
        const summary = summaryRows.reduce((acc, row) => {
            acc.total += 1;
            const statusKey = normalizeStatus(row.status);
            if (statusKey === 'pending') acc.pending += 1;
            if (statusKey === 'approved') acc.approved += 1;
            if (statusKey === 'rejected') acc.rejected += 1;
            return acc;
        }, { total: 0, pending: 0, approved: 0, rejected: 0 });
        return {
            items: scopedRows.slice(safeOffset, safeOffset + safeLimit).map(mapCustomerDraftSubmissionRow),
            pagination: {
                total: scopedRows.length,
                limit: safeLimit,
                offset: safeOffset
            },
            summary
        };
    }

    const where = ['branch_id = ?'];
    const params = [safeBranchId];
    if (hasStatusFilter) {
        where.push('status = ?');
        params.push(normalizedStatus);
    }
    if (safeSubmittedByUserId) {
        where.push('submitted_by_user_id = ?');
        params.push(safeSubmittedByUserId);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const [rows] = await query(
        `SELECT *
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         ${whereSql}
         ORDER BY submitted_at DESC, id DESC
         LIMIT ?
         OFFSET ?`,
        [...params, safeLimit, safeOffset]
    );

    const [countRows] = await query(
        `SELECT COUNT(*) AS total
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
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
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         WHERE branch_id = ?`,
        [safeBranchId]
    );
    const summary = (summaryRows || [])[0] || {};

    return {
        items: (rows || []).map(mapCustomerDraftSubmissionRow),
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

const getCustomerDraftSubmission = async (id, branchId) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeId = toSafeText(id, 64);
    const safeBranchId = Number(branchId);
    if (!safeId) return null;
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    if (!await isRelationalReady()) {
        const rows = await readJsonSubmissionRows();
        const row = rows.find((item) => item.id === safeId && Number(item.branch_id) === safeBranchId);
        return mapCustomerDraftSubmissionRow(row);
    }

    const [rows] = await query(
        `SELECT *
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         WHERE id = ?
           AND branch_id = ?
         LIMIT 1`,
        [safeId, safeBranchId]
    );
    return mapCustomerDraftSubmissionRow((rows || [])[0]);
};

const findCustomerDraftSubmissionByAccountNumber = async (accountNumber, branchId, { statuses = [] } = {}) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeAccountNumber = normalizeAccountNumber(accountNumber);
    const safeBranchId = Number(branchId);
    if (!safeAccountNumber) return null;
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }

    const normalizedStatuses = normalizeStatusFilters(statuses);
    if (!await isRelationalReady()) {
        const rows = await readJsonSubmissionRows();
        const match = rows
            .filter((row) => {
                if (Number(row.branch_id) !== safeBranchId) return false;
                if (
                    normalizeAccountNumber(row.draft_account_number) !== safeAccountNumber &&
                    normalizeAccountNumber(row.approved_customer_account_number) !== safeAccountNumber
                ) {
                    return false;
                }
                return normalizedStatuses.length ? normalizedStatuses.includes(normalizeStatus(row.status)) : true;
            })
            .sort((left, right) => {
                const rightTime = new Date(right.submitted_at || 0).getTime() || 0;
                const leftTime = new Date(left.submitted_at || 0).getTime() || 0;
                if (rightTime !== leftTime) return rightTime - leftTime;
                return String(right.id || '').localeCompare(String(left.id || ''));
            })[0];
        return mapCustomerDraftSubmissionRow(match);
    }

    const statusSql = normalizedStatuses.length
        ? `AND status IN (${normalizedStatuses.map(() => '?').join(', ')})`
        : '';
    const [rows] = await query(
        `SELECT *
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         WHERE branch_id = ?
           AND (
                COALESCE(TRIM(draft_account_number), '') = ?
                OR COALESCE(TRIM(approved_customer_account_number), '') = ?
           )
           ${statusSql}
         ORDER BY submitted_at DESC, id DESC
         LIMIT 1`,
        [safeBranchId, safeAccountNumber, safeAccountNumber, ...normalizedStatuses]
    );
    return mapCustomerDraftSubmissionRow((rows || [])[0]);
};

const compareAndSetCustomerDraftInstallationCompletion = async (
    accountNumber,
    branchId,
    completionRecord,
    { statuses = ['pending'] } = {}
) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeAccountNumber = normalizeAccountNumber(accountNumber);
    const safeBranchId = Number(branchId);
    if (!safeAccountNumber) {
        throw createError(400, 'Customer account number is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }
    const normalizedStatuses = normalizeStatusFilters(statuses);
    if (!normalizedStatuses.length) normalizedStatuses.push('pending');

    if (!await isRelationalReady()) {
        return withCustomerDraftStoreMutationLock(async () => {
            const rows = await readJsonSubmissionRows();
            const index = rows.findIndex((row) => {
                if (Number(row.branch_id) !== safeBranchId) return false;
                if (!normalizedStatuses.includes(normalizeStatus(row.status))) return false;
                return normalizeAccountNumber(row.draft_account_number) === safeAccountNumber
                    || normalizeAccountNumber(row.approved_customer_account_number) === safeAccountNumber;
            });
            if (index < 0) return null;

            const currentDraft = parseDraftJson(rows[index].draft_json);
            const decision = resolveInstallationCompletionCas(
                currentDraft.installationCompletion,
                completionRecord
            );
            if (decision.action === 'replay') {
                return {
                    item: mapCustomerDraftSubmissionRow(rows[index]),
                    installationCompletion: decision.completion,
                    replayed: true
                };
            }

            const nextDraft = {
                ...currentDraft,
                installationCompletion: decision.completion
            };
            rows[index] = normalizeJsonSubmissionRow({
                ...rows[index],
                draft_json: JSON.stringify(nextDraft),
                updated_at: new Date().toISOString()
            });
            await writeJsonSubmissionRows(rows);
            return {
                item: mapCustomerDraftSubmissionRow(rows[index]),
                installationCompletion: decision.completion,
                replayed: false
            };
        });
    }

    const pool = await getPool();
    if (!pool) throw createError(500, 'MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const statusSql = normalizedStatuses.map(() => '?').join(', ');
        const [rows] = await connection.query(
            `SELECT *
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE branch_id = ?
               AND (
                    COALESCE(TRIM(draft_account_number), '') = ?
                    OR COALESCE(TRIM(approved_customer_account_number), '') = ?
               )
               AND status IN (${statusSql})
             ORDER BY submitted_at DESC, id DESC
             LIMIT 1
             FOR UPDATE`,
            [safeBranchId, safeAccountNumber, safeAccountNumber, ...normalizedStatuses]
        );
        const row = (rows || [])[0];
        if (!row) {
            await connection.commit();
            return null;
        }

        const currentDraft = parseDraftJson(row.draft_json);
        const decision = resolveInstallationCompletionCas(
            currentDraft.installationCompletion,
            completionRecord
        );
        if (decision.action === 'replay') {
            await connection.commit();
            return {
                item: mapCustomerDraftSubmissionRow(row),
                installationCompletion: decision.completion,
                replayed: true
            };
        }

        const nextDraft = {
            ...currentDraft,
            installationCompletion: decision.completion
        };
        const [result] = await connection.query(
            `UPDATE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             SET draft_json = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND branch_id = ?
               AND status IN (${statusSql})`,
            [JSON.stringify(nextDraft), row.id, safeBranchId, ...normalizedStatuses]
        );
        if (!result?.affectedRows) {
            throw createError(409, 'Customer draft changed before installation completion could be stored.');
        }
        await connection.commit();
        return {
            item: mapCustomerDraftSubmissionRow({ ...row, draft_json: JSON.stringify(nextDraft) }),
            installationCompletion: decision.completion,
            replayed: false
        };
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
};

const updateCustomerDraftSubmissionDraftDataByAccountNumber = async (
    accountNumber,
    branchId,
    draftDataPatch = {},
    { statuses = ['pending'] } = {}
) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeAccountNumber = normalizeAccountNumber(accountNumber);
    const safeBranchId = Number(branchId);
    if (!safeAccountNumber) {
        throw createError(400, 'Customer account number is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }
    const normalizedStatuses = normalizeStatusFilters(statuses);
    if (!normalizedStatuses.length) normalizedStatuses.push('pending');
    const patch = draftDataPatch && typeof draftDataPatch === 'object' && !Array.isArray(draftDataPatch)
        ? draftDataPatch
        : {};

    if (!await isRelationalReady()) {
        // JSON callers must hold withCustomerDraftStoreMutationLock across this
        // complete read/modify/write operation.
        const existing = await findCustomerDraftSubmissionByAccountNumber(
            safeAccountNumber,
            safeBranchId,
            { statuses: normalizedStatuses }
        );
        if (!existing) return null;
        const rows = await readJsonSubmissionRows();
        const index = rows.findIndex((row) => (
            row.id === toSafeText(existing.id, 64)
            && Number(row.branch_id) === safeBranchId
            && normalizedStatuses.includes(normalizeStatus(row.status))
        ));
        if (index < 0) return null;
        const currentDraft = parseDraftJson(rows[index].draft_json);
        const nextDraft = { ...currentDraft, ...patch };
        rows[index] = normalizeJsonSubmissionRow({
            ...rows[index],
            customer_name: buildCustomerName(nextDraft) || existing.customerName || null,
            contact_number: toSafeText(nextDraft.mobile || nextDraft.contactNumber || nextDraft.contact, 50) || existing.contactNumber || null,
            plan_name: toSafeText(nextDraft.planName, 120) || existing.planName || null,
            area_name: toSafeText(nextDraft.area, 150) || existing.areaName || null,
            address_text: buildAddressText(nextDraft) || existing.addressText || null,
            draft_json: JSON.stringify(nextDraft),
            updated_at: new Date().toISOString()
        });
        await writeJsonSubmissionRows(rows);
        return mapCustomerDraftSubmissionRow(rows[index]);
    }

    const pool = await getPool();
    if (!pool) throw createError(500, 'MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const statusSql = normalizedStatuses.map(() => '?').join(', ');
        const [rows] = await connection.query(
            `SELECT *
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE branch_id = ?
               AND (
                    COALESCE(TRIM(draft_account_number), '') = ?
                    OR COALESCE(TRIM(approved_customer_account_number), '') = ?
               )
               AND status IN (${statusSql})
             ORDER BY submitted_at DESC, id DESC
             LIMIT 1
             FOR UPDATE`,
            [safeBranchId, safeAccountNumber, safeAccountNumber, ...normalizedStatuses]
        );
        const row = (rows || [])[0];
        if (!row) {
            await connection.commit();
            return null;
        }

        const currentDraft = parseDraftJson(row.draft_json);
        const nextDraft = { ...currentDraft, ...patch };
        const nextValues = {
            customerName: buildCustomerName(nextDraft) || row.customer_name || null,
            contactNumber: toSafeText(nextDraft.mobile || nextDraft.contactNumber || nextDraft.contact, 50) || row.contact_number || null,
            planName: toSafeText(nextDraft.planName, 120) || row.plan_name || null,
            areaName: toSafeText(nextDraft.area, 150) || row.area_name || null,
            addressText: buildAddressText(nextDraft) || row.address_text || null,
            draftJson: JSON.stringify(nextDraft)
        };
        const [result] = await connection.query(
            `UPDATE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             SET
                customer_name = ?,
                contact_number = ?,
                plan_name = ?,
                area_name = ?,
                address_text = ?,
                draft_json = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND branch_id = ?
               AND status IN (${statusSql})`,
            [
                nextValues.customerName,
                nextValues.contactNumber,
                nextValues.planName,
                nextValues.areaName,
                nextValues.addressText,
                nextValues.draftJson,
                row.id,
                safeBranchId,
                ...normalizedStatuses
            ]
        );
        if (!result?.affectedRows) {
            throw createError(409, 'Customer draft changed before PPPoE credentials could be stored.');
        }
        await connection.commit();
        return mapCustomerDraftSubmissionRow({
            ...row,
            customer_name: nextValues.customerName,
            contact_number: nextValues.contactNumber,
            plan_name: nextValues.planName,
            area_name: nextValues.areaName,
            address_text: nextValues.addressText,
            draft_json: nextValues.draftJson
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
};

const updateCustomerDraftSubmissionRow = async (id, branchId, patch = {}) => {
    if (await isRelationalReady()) {
        throw createError(500, 'Generic draft row updates are only available in JSON storage mode.');
    }
    const safeId = toSafeText(id, 64);
    const safeBranchId = Number(branchId);
    if (!safeId) throw createError(400, 'Submission ID is required.');
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }
    const rows = await readJsonSubmissionRows();
    const index = rows.findIndex((row) => row.id === safeId && Number(row.branch_id) === safeBranchId);
    if (index < 0) return null;
    rows[index] = normalizeJsonSubmissionRow({
        ...rows[index],
        ...patch,
        updated_at: new Date().toISOString()
    });
    await writeJsonSubmissionRows(rows);
    return getCustomerDraftSubmission(safeId, safeBranchId);
};

const deleteCustomerDraftSubmissionRow = async ({
    id,
    branchId,
    submittedByUserId = '',
    status = 'pending'
} = {}) => {
    if (await isRelationalReady()) {
        throw createError(500, 'Generic draft row deletes are only available in JSON storage mode.');
    }
    const safeId = toSafeText(id, 64);
    const safeBranchId = Number(branchId);
    const safeSubmittedByUserId = toSafeText(submittedByUserId, 32);
    const safeStatus = normalizeStatus(status, 'pending');
    if (!safeId) throw createError(400, 'Submission ID is required.');
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch ID is required.');
    }
    const rows = await readJsonSubmissionRows();
    const index = rows.findIndex((row) => {
        if (row.id !== safeId || Number(row.branch_id) !== safeBranchId) return false;
        if (safeSubmittedByUserId && toSafeText(row.submitted_by_user_id, 32) !== safeSubmittedByUserId) return false;
        if (safeStatus && normalizeStatus(row.status) !== safeStatus) return false;
        return true;
    });
    if (index < 0) return null;
    const [removed] = rows.splice(index, 1);
    await writeJsonSubmissionRows(rows);
    return mapCustomerDraftSubmissionRow(removed);
};

module.exports = {
    CUSTOMER_DRAFT_SUBMISSIONS_TABLE,
    PUBLIC_STATUS,
    ALLOWED_STATUS,
    ensureCustomerDraftSubmissionsTable,
    createCustomerDraftSubmission,
    listCustomerDraftSubmissions,
    getCustomerDraftSubmission,
    findCustomerDraftSubmissionByAccountNumber,
    compareAndSetCustomerDraftInstallationCompletion,
    withCustomerDraftStoreMutationLock,
    updateCustomerDraftSubmissionDraftDataByAccountNumber,
    updateCustomerDraftSubmissionRow,
    deleteCustomerDraftSubmissionRow,
    mapCustomerDraftSubmissionRow,
    buildCustomerName,
    buildAddressText,
    normalizeStatus,
    resolveInstallationCompletionCas,
    toSafeText
};
