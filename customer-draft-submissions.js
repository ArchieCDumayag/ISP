const express = require('express');
const createError = require('http-errors');
const { getPool, query } = require('./db');
const { readJson } = require('./data-store');
const { isRelationalReady } = require('./db-relational');
const { loadAccounts, saveAccounts } = require('./accounts-store');
const { verifyPassword, isHashedPassword, hashPassword } = require('./passwords');
const { issueToken, verifyTokenDetailed, isEphemeralSessionSecret } = require('./session-cache');
const {
    createCustomerDraftSubmission,
    listCustomerDraftSubmissions,
    getCustomerDraftSubmission,
    ensureCustomerDraftSubmissionsTable,
    CUSTOMER_DRAFT_SUBMISSIONS_TABLE,
    updateCustomerDraftSubmissionRow,
    deleteCustomerDraftSubmissionRow,
    buildCustomerName,
    buildAddressText,
    toSafeText
} = require('./customer-draft-submissions-store');
const {
    createCustomerRecord,
    updateCustomerRecord,
    deleteCustomerRecord,
    removeCustomerPppoeAccounts,
    sanitizeCustomerForAdmin,
    readPlans
} = require('./customers');
const {
    createCustomerArchive
} = require('./customer-archive-store');
const {
    hasPonTables
} = require('./pon-management-api');
const {
    loadIntegrationSettings,
    hasUsableMikrotikRouter
} = require('./integration-settings');
const { accountHasRole } = require('./role-utils');

const adminRouter = express.Router();
const technicianRouter = express.Router();
const technicianAuthRouter = express.Router();

const TECHNICIAN_TOKEN_SCOPE = 'technician-customer-drafts';
const DEFAULT_TECHNICIAN_SESSION_TTL_SECONDS = 24 * 60 * 60;
const TECHNICIAN_SESSION_TTL_SECONDS = (() => {
    const parsed = Number(process.env.TECHNICIAN_SESSION_TTL_SECONDS);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TECHNICIAN_SESSION_TTL_SECONDS;
    return Math.trunc(parsed);
})();
const SINGLE_BRANCH_MODE = String(process.env.SINGLE_BRANCH_MODE || 'true').trim().toLowerCase() === 'true';
const SINGLE_BRANCH_ID = Number(process.env.SINGLE_BRANCH_ID || 1);
const COVERAGE_STORE_KEY = 'coverage';

const resolveBranchId = (value) => {
    if (SINGLE_BRANCH_MODE && Number.isFinite(SINGLE_BRANCH_ID) && SINGLE_BRANCH_ID > 0) {
        return SINGLE_BRANCH_ID;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const extractBearerToken = (req) => {
    const header = req.headers.authorization || req.headers.Authorization || '';
    if (!header) return '';
    const match = header.match(/Bearer\s+(.+)/i);
    return match ? String(match[1] || '').trim() : '';
};

const logTechnicianAuthFailure = (req, reason) => {
    const method = String(req.method || 'REQUEST').trim() || 'REQUEST';
    const route = String(req.originalUrl || req.url || '/').trim() || '/';
    const remoteAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '')
        .split(',')[0]
        .trim() || 'unknown-ip';
    console.warn(`[technician-auth] ${reason} [${method} ${route}] from ${remoteAddress}`);
};

const normalizeDateOnly = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const normalizeDateTimeInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 16);
};

const toOptionalNumber = (value, decimals = 2) => {
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Number(parsed.toFixed(decimals));
};

const normalizePlanCategory = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'prepaid' || normalized === 'postpaid' ? normalized : '';
};

const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
const normalizeAreaName = (value) => String(value || '').trim().toLowerCase();
const DEFAULT_DUE_OFFSET = 0;
const findPlanByIdOrName = (plans = [], { planId = '', planName = '' } = {}) => {
    const normalizedPlanId = normalizePlanId(planId);
    const normalizedPlanName = normalizePlanName(planName);
    if (!Array.isArray(plans) || (!normalizedPlanId && !normalizedPlanName)) {
        return null;
    }

    return plans.find((plan) => {
        const candidateId = normalizePlanId(plan?.id);
        if (normalizedPlanId && candidateId && candidateId === normalizedPlanId) {
            return true;
        }

        if (!normalizedPlanName) {
            return false;
        }

        return [
            plan?.name,
            plan?.label
        ].some((candidateName) => normalizePlanName(candidateName) === normalizedPlanName);
    }) || null;
};

const getTodayDateInputValue = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
};

const formatDateOnlyLocal = (date) => {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateOnlyLocal = (value) => {
    const normalized = normalizeDateOnly(value);
    if (!normalized) return null;
    const [year, month, day] = normalized.split('-').map((part) => Number(part));
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const computeNextPostpaidCycleDate = (value) => {
    const baseDate = parseDateOnlyLocal(value) || parseDateOnlyLocal(getTodayDateInputValue());
    if (!baseDate) return getTodayDateInputValue();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const day = baseDate.getDate();
    const shifted = new Date(year, month + 1, 1);
    const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
    shifted.setDate(Math.min(day, lastDay));
    return formatDateOnlyLocal(shifted);
};

const computeDueDate = (billDateValue, dueOffsetValue) => {
    const billDate = normalizeDateOnly(billDateValue);
    const offset = Number(dueOffsetValue);
    if (!billDate || !Number.isFinite(offset) || offset < 0) return '';
    const parsed = new Date(`${billDate}T00:00:00`);
    if (!Number.isFinite(parsed.getTime())) return '';
    parsed.setDate(parsed.getDate() + Math.floor(offset));
    return parsed.toISOString().slice(0, 10);
};

const normalizePhilippineMobile = (value, { fallbackToRaw = true } = {}) => {
    const original = toSafeText(value, 50);
    if (!original) return '';

    const compact = original.replace(/[^\d+]/g, '');
    let local = compact;
    if (local.startsWith('+63')) local = `0${local.slice(3)}`;
    if (local.startsWith('63')) local = `0${local.slice(2)}`;
    if (local.startsWith('9') && local.length === 10) local = `0${local}`;

    const digits = local.replace(/\D+/g, '');
    if (/^09\d{9}$/.test(digits)) return digits;
    return fallbackToRaw ? original : '';
};

const normalizeDraftPayload = (payload = {}) => {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const firstName = toSafeText(source.firstName, 100);
    const lastName = toSafeText(source.lastName, 100);
    const explicitName = toSafeText(source.name, 200);
    const mobile = normalizePhilippineMobile(source.mobile || source.contactNumber || source.contact);
    const normalized = {
        name: explicitName || `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        mobile,
        email: toSafeText(source.email, 150),
        street: toSafeText(source.street, 150),
        barangay: toSafeText(source.barangay, 150),
        municipality: toSafeText(source.municipality, 150),
        province: toSafeText(source.province, 150),
        area: toSafeText(source.area, 150),
        mapPin: toSafeText(source.mapPin, 120),
        planId: toSafeText(source.planId, 80),
        planName: toSafeText(source.planName, 120),
        planCategory: normalizePlanCategory(source.planCategory),
        planAmount: toOptionalNumber(source.planAmount),
        activationDate: normalizeDateOnly(source.activationDate),
        billDate: normalizeDateOnly(source.billDate),
        dueDate: normalizeDateOnly(source.dueDate),
        prepaidExpirationAt: normalizeDateTimeInput(
            source.prepaidExpirationAt || source.prepaid_expiration_at || source.expiryDateTime
        ),
        dueOffset: Number.isFinite(Number(source.dueOffset)) ? Math.max(0, Math.floor(Number(source.dueOffset))) : null,
        creditLimit: Number.isFinite(Number(source.creditLimit)) ? Math.max(0, Math.floor(Number(source.creditLimit))) : null,
        remarks: toSafeText(source.remarks || source.notes, 2000),
        status: toSafeText(source.status, 30) || 'active',
        loginUsername: toSafeText(source.loginUsername, 120),
        loginPassword: toSafeText(source.loginPassword, 120),
        pppoeMode: toSafeText(source.pppoeMode, 30),
        pppoeUsername: toSafeText(source.pppoeUsername, 120),
        pppoePassword: toSafeText(source.pppoePassword, 120),
        pppoeProfile: toSafeText(source.pppoeProfile, 120)
    };

    if (normalized.planAmount == null) delete normalized.planAmount;
    if (normalized.dueOffset == null) delete normalized.dueOffset;
    if (normalized.creditLimit == null) delete normalized.creditLimit;
    if (!normalized.prepaidExpirationAt) delete normalized.prepaidExpirationAt;
    return normalized;
};

const applyDraftPortalCredentialDefaults = (draft = {}, accountNumber = '') => {
    const normalizedDraft = draft && typeof draft === 'object' && !Array.isArray(draft)
        ? { ...draft }
        : {};
    const account = toSafeText(accountNumber || normalizedDraft.accountNumber || normalizedDraft.draftAccountNumber, 20);
    if (!account) return normalizedDraft;

    const fullName = buildCustomerName(normalizedDraft);
    const incomingUsername = toSafeText(normalizedDraft.loginUsername, 120);
    const incomingPassword = toSafeText(normalizedDraft.loginPassword, 120);
    const pppoeUsername = toSafeText(normalizedDraft.pppoeUsername, 120);
    const pppoePassword = toSafeText(normalizedDraft.pppoePassword, 120);
    const normalizeCredential = (value) => String(value || '').trim().toLowerCase();
    const defaultUsername = fullName || account;
    const incomingUsernameKey = normalizeCredential(incomingUsername);
    const incomingPasswordKey = normalizeCredential(incomingPassword);
    const usernameLooksAutoFilled = !incomingUsername
        || incomingUsernameKey === normalizeCredential(account)
        || (pppoeUsername && incomingUsernameKey === normalizeCredential(pppoeUsername));
    const passwordLooksAutoFilled = !incomingPassword
        || (fullName && incomingPasswordKey === normalizeCredential(fullName))
        || (pppoePassword && incomingPasswordKey === normalizeCredential(pppoePassword));

    return {
        ...normalizedDraft,
        loginUsername: usernameLooksAutoFilled ? defaultUsername : incomingUsername,
        loginPassword: passwordLooksAutoFilled ? account : incomingPassword
    };
};

const applyPlanDefaults = (draft, plans = []) => {
    const normalizedDraft = { ...(draft || {}) };
    const matchedPlan = findPlanByIdOrName(plans, {
        planId: normalizedDraft.planId,
        planName: normalizedDraft.planName
    });

    if (matchedPlan) {
        if (!normalizedDraft.planId && matchedPlan.id) {
            normalizedDraft.planId = String(matchedPlan.id).trim();
        }
        if (!normalizedDraft.planName) {
            normalizedDraft.planName = String(matchedPlan.name || matchedPlan.label || '').trim();
        }
        if (!normalizedDraft.planCategory) {
            const category = normalizePlanCategory(matchedPlan.category);
            if (category) normalizedDraft.planCategory = category;
        }
        if (normalizedDraft.planAmount == null) {
            const price = Number(matchedPlan.price);
            if (Number.isFinite(price) && price >= 0) {
                normalizedDraft.planAmount = Number(price.toFixed(2));
            }
        }
    }

    return normalizedDraft;
};

const applyMonthlyBillingDefaults = (draft = {}) => {
    const normalizedDraft = { ...(draft || {}) };

    const today = getTodayDateInputValue();
    const activationDate = normalizeDateOnly(normalizedDraft.activationDate) || today;
    const minimumFirstBillDate = computeNextPostpaidCycleDate(activationDate);
    const submittedBillDate = normalizeDateOnly(normalizedDraft.billDate);
    const billDate = submittedBillDate || minimumFirstBillDate;
    const rawDueOffset = Number(normalizedDraft.dueOffset);
    let dueOffset = Number.isFinite(rawDueOffset) && rawDueOffset >= 0
        ? Math.floor(rawDueOffset)
        : null;

    const submittedDueDate = normalizeDateOnly(normalizedDraft.dueDate);
    if (dueOffset == null) {
        if (submittedBillDate && submittedDueDate) {
            const bill = new Date(`${submittedBillDate}T00:00:00`);
            const due = new Date(`${submittedDueDate}T00:00:00`);
            const diff = Math.round((due.getTime() - bill.getTime()) / (1000 * 60 * 60 * 24));
            dueOffset = Number.isFinite(diff) && diff >= 0 ? diff : DEFAULT_DUE_OFFSET;
        } else {
            dueOffset = DEFAULT_DUE_OFFSET;
        }
    }

    const minimumFirstDueDate = computeDueDate(billDate, dueOffset) || billDate;
    const dueDate = !submittedDueDate || submittedDueDate < minimumFirstDueDate
        ? minimumFirstDueDate
        : submittedDueDate;

    return {
        ...normalizedDraft,
        activationDate,
        billDate,
        dueOffset,
        dueDate
    };
};

const readCoverageAreaNames = async (branchId) => {
    if (await isRelationalReady()) {
        const [rows] = await query(
            'SELECT name FROM coverage_areas WHERE branch_id = ? ORDER BY name ASC',
            [branchId]
        );
        return Array.from(
            new Set(
                (rows || [])
                    .map((row) => String(row?.name || '').trim())
                    .filter(Boolean)
            )
        );
    }

    const coverageAreas = await readJson(COVERAGE_STORE_KEY, []);
    return Array.from(
        new Set(
            (Array.isArray(coverageAreas) ? coverageAreas : [])
                .map((area) => String(area?.name || area?.areaName || '').trim())
                .filter(Boolean)
        )
    ).sort((a, b) => a.localeCompare(b));
};

const resolveCoverageAreaName = (value, coverageAreas = []) => {
    const areaValue = toSafeText(value, 150);
    if (!areaValue) return '';
    return (Array.isArray(coverageAreas) ? coverageAreas : []).find((areaName) =>
        normalizeAreaName(areaName) === normalizeAreaName(areaValue)
    ) || '';
};

const syncPonUsedCountsForBranch = async (branchId) => {
    await query(
        `UPDATE pon_naps n
         LEFT JOIN (
            SELECT nap_id, COUNT(*) AS used_count
            FROM pon_nap_connections
            GROUP BY nap_id
         ) usage_counts ON usage_counts.nap_id = n.id
         SET n.used = COALESCE(usage_counts.used_count, 0)
         WHERE n.branch_id = ?`,
        [branchId]
    );
};

const removePonAssignmentsForAccount = async (branchId, accountNumber) => {
    const safeBranchId = Number(branchId);
    const safeAccountNumber = toSafeText(accountNumber, 20);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0 || !safeAccountNumber) {
        return false;
    }
    const ponReady = await hasPonTables().catch(() => false);
    if (!ponReady) return false;

    const [result] = await query(
        `DELETE c
         FROM pon_nap_connections c
         INNER JOIN pon_naps n ON n.id = c.nap_id
         WHERE n.branch_id = ?
           AND (
                COALESCE(TRIM(c.customer_account_number), '') = ?
                OR COALESCE(TRIM(c.customer_ref), '') = ?
           )`,
        [safeBranchId, safeAccountNumber, safeAccountNumber]
    );
    if (!result?.affectedRows) return false;

    await syncPonUsedCountsForBranch(safeBranchId);
    return true;
};

const promotePonAssignmentsForAccount = async (branchId, accountNumber) => {
    const safeBranchId = Number(branchId);
    const safeAccountNumber = toSafeText(accountNumber, 20);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0 || !safeAccountNumber) {
        return false;
    }
    const ponReady = await hasPonTables().catch(() => false);
    if (!ponReady) return false;

    const [result] = await query(
        `UPDATE pon_nap_connections c
         INNER JOIN pon_naps n ON n.id = c.nap_id
         SET c.customer_account_number = ?
         WHERE n.branch_id = ?
           AND COALESCE(TRIM(c.customer_account_number), '') = ''
           AND COALESCE(TRIM(c.customer_ref), '') = ?`,
        [safeAccountNumber, safeBranchId, safeAccountNumber]
    );
    return Boolean(result?.affectedRows);
};

const normalizeSubmissionIds = (values = []) => Array.from(
    new Set(
        (Array.isArray(values) ? values : [values])
            .map((value) => toSafeText(value, 64))
            .filter(Boolean)
    )
);

const cleanupDraftLinkedPppoeAccount = async ({
    branchId,
    linkedCustomerAccountNumber = '',
    draftData = {},
    customerName = ''
} = {}) => {
    const safeBranchId = Number(branchId);
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        return { removedEntries: [], skippedEntries: [] };
    }

    const accountNumber = toSafeText(
        linkedCustomerAccountNumber || draftData?.accountNumber || draftData?.draftAccountNumber,
        20
    );
    const pppoeUsername = toSafeText(draftData?.pppoeUsername, 120);
    if (!accountNumber && !pppoeUsername) {
        return { removedEntries: [], skippedEntries: [] };
    }

    try {
        return await removeCustomerPppoeAccounts({
            branchId: safeBranchId,
            customer: {
                accountNumber,
                pppoeUsername,
                name: toSafeText(customerName || buildCustomerName(draftData), 200)
            },
            // Draft cleanup should only remove app-side PPPoE references; it must not touch a live router.
            localOnly: true
        });
    } catch (error) {
        console.warn(
            `Draft PPPoE cleanup warning for ${accountNumber || pppoeUsername || 'unknown draft'}: ${error?.message || error}`
        );
        return { removedEntries: [], skippedEntries: [], warning: String(error?.message || error) };
    }
};

const buildDraftArchiveAccountNumber = (submission = {}) => {
    const draftData = submission?.draftData && typeof submission.draftData === 'object' && !Array.isArray(submission.draftData)
        ? submission.draftData
        : {};
    const direct = toSafeText(
        submission?.approvedCustomerAccountNumber
            || submission?.draftAccountNumber
            || draftData?.accountNumber
            || draftData?.draftAccountNumber,
        20
    );
    if (direct) return direct;
    const fallbackId = String(submission?.id || '').trim().slice(-14);
    return toSafeText(`DRAFT-${fallbackId || 'ARCHIVE'}`, 20);
};

const buildDraftArchiveSubmissionRow = (submission = {}) => {
    const draftData = submission?.draftData && typeof submission.draftData === 'object' && !Array.isArray(submission.draftData)
        ? submission.draftData
        : {};
    return {
        id: toSafeText(submission?.id, 64),
        branch_id: Number(submission?.branchId) || null,
        submitted_by_user_id: toSafeText(submission?.submittedBy?.id, 32),
        submitted_by_username: toSafeText(submission?.submittedBy?.username, 100) || null,
        submitted_by_name: toSafeText(submission?.submittedBy?.name, 120) || null,
        customer_name: toSafeText(submission?.customerName || buildCustomerName(draftData), 200) || null,
        contact_number: toSafeText(submission?.contactNumber, 50) || null,
        plan_name: toSafeText(submission?.planName, 120) || null,
        area_name: toSafeText(submission?.areaName, 150) || null,
        address_text: toSafeText(submission?.addressText || buildAddressText(draftData), 255) || null,
        draft_account_number: toSafeText(submission?.draftAccountNumber, 20) || null,
        draft_json: JSON.stringify(draftData),
        status: 'pending',
        submitted_at: String(submission?.submittedAt || '').trim() || null,
        reviewed_at: null,
        reviewed_by_user_id: null,
        reviewed_by_username: null,
        reviewed_by_name: null,
        decision_reason: null,
        approved_customer_account_number: toSafeText(submission?.approvedCustomerAccountNumber, 20) || null
    };
};

const buildDraftArchivePayload = ({
    submission = {},
    linkedCustomerAccountNumber = '',
    cleanupWarning = ''
} = {}) => {
    const archivedRow = buildDraftArchiveSubmissionRow(submission);
    return {
        draftSubmission: archivedRow,
        metadata: {
            recordType: 'draft',
            source: 'customer-draft-submissions',
            deletedFromStatus: String(submission?.rawStatus || 'pending').trim() || 'pending',
            linkedCustomerAccountNumber: toSafeText(linkedCustomerAccountNumber, 20) || null,
            draftAccountNumber: toSafeText(submission?.draftAccountNumber, 20) || null,
            approvedCustomerAccountNumber: toSafeText(submission?.approvedCustomerAccountNumber, 20) || null,
            addressText: toSafeText(submission?.addressText, 255) || null,
            cleanupWarning: toSafeText(cleanupWarning, 500) || null
        }
    };
};

const deletePendingDraftSubmission = async ({
    submissionId,
    branchId,
    submittedByUserId = '',
    refreshSource = 'customer-drafts-delete',
    deletedBy = null
} = {}) => {
    await ensureCustomerDraftSubmissionsTable();

    const safeSubmissionId = toSafeText(submissionId, 64);
    const safeBranchId = Number(branchId);
    const safeSubmittedByUserId = toSafeText(submittedByUserId, 32);
    if (!safeSubmissionId) {
        throw createError(400, 'Submission ID is required.');
    }
    if (!Number.isInteger(safeBranchId) || safeBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this request.');
    }

    const existing = await getCustomerDraftSubmission(safeSubmissionId, safeBranchId);
    if (!existing) {
        throw createError(404, 'Customer draft not found.');
    }
    if (safeSubmittedByUserId && toSafeText(existing?.submittedBy?.id, 32) !== safeSubmittedByUserId) {
        throw createError(404, 'Customer draft not found.');
    }
    if (existing.rawStatus !== 'pending') {
        throw createError(409, 'Only pending customer drafts can be deleted here.');
    }

    const linkedCustomerAccountNumber = toSafeText(
        existing.approvedCustomerAccountNumber || existing.draftAccountNumber,
        20
    );
    const existingDraftData = existing.draftData && typeof existing.draftData === 'object' && !Array.isArray(existing.draftData)
        ? existing.draftData
        : {};
    let cleanupWarning = '';
    await removePonAssignmentsForAccount(safeBranchId, linkedCustomerAccountNumber);
    if (linkedCustomerAccountNumber) {
        try {
            await deleteCustomerRecord(linkedCustomerAccountNumber, {
                branchId: safeBranchId,
                refreshSource,
                deleteDraftRows: false
            });
        } catch (error) {
            if (Number(error?.status || 0) !== 404) {
                throw error;
            }
            const cleanupResult = await cleanupDraftLinkedPppoeAccount({
                branchId: safeBranchId,
                linkedCustomerAccountNumber,
                draftData: existingDraftData,
                customerName: existing.customerName || buildCustomerName(existingDraftData)
            });
            cleanupWarning = String(cleanupResult?.warning || '').trim();
        }
    } else {
        const cleanupResult = await cleanupDraftLinkedPppoeAccount({
            branchId: safeBranchId,
            linkedCustomerAccountNumber,
            draftData: existingDraftData,
            customerName: existing.customerName || buildCustomerName(existingDraftData)
        });
        cleanupWarning = String(cleanupResult?.warning || '').trim();
    }

    if (!await isRelationalReady()) {
        const deleted = await deleteCustomerDraftSubmissionRow({
            id: safeSubmissionId,
            branchId: safeBranchId,
            submittedByUserId: safeSubmittedByUserId,
            status: 'pending'
        });
        if (!deleted) {
            throw createError(409, 'Unable to delete customer draft. It may have been updated already.');
        }
        return existing;
    }

    const params = [safeSubmissionId, safeBranchId];
    const submittedBySql = safeSubmittedByUserId ? ' AND submitted_by_user_id = ?' : '';
    if (safeSubmittedByUserId) {
        params.push(safeSubmittedByUserId);
    }
    const pool = await getPool();
    if (!pool) {
        throw createError(500, 'MySQL connection is not available.');
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        await createCustomerArchive({
            branchId: safeBranchId,
            accountNumber: buildDraftArchiveAccountNumber(existing),
            customerName: existing.customerName || buildCustomerName(existingDraftData),
            contactNumber: existing.contactNumber || null,
            planName: existing.planName || null,
            areaName: existing.areaName || null,
            deletedBy,
            payload: buildDraftArchivePayload({
                submission: existing,
                linkedCustomerAccountNumber,
                cleanupWarning
            }),
            executor: connection
        });

        const [result] = await connection.query(
            `DELETE FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE id = ?
               AND branch_id = ?
               AND status = 'pending'
               ${submittedBySql}`,
            params
        );
        if (!result || !result.affectedRows) {
            throw createError(409, 'Unable to delete customer draft. It may have been updated already.');
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }

    return existing;
};

const validateDraftPayload = (draft = {}, options = {}) => {
    const customerName = buildCustomerName(draft);
    if (!customerName) {
        throw createError(400, 'Customer first name or last name is required.');
    }
    if (!toSafeText(draft.planName, 120)) {
        throw createError(400, 'Plan is required.');
    }

    const coverageAreas = Array.isArray(options.coverageAreas) ? options.coverageAreas : [];
    const matchedAreaName = resolveCoverageAreaName(draft.area, coverageAreas);
    if (toSafeText(draft.area, 150)) {
        if (coverageAreas.length && !matchedAreaName) {
            throw createError(400, 'Area / Cluster must match the coverage area list.');
        }
        if (matchedAreaName) {
            draft.area = matchedAreaName;
        }
    }
};

const buildTechnicianProfile = (account = {}) => {
    const branchId = resolveBranchId(account.branchId || account.branch_id);
    return {
        id: String(account.id || ''),
        username: String(account.username || '').trim(),
        role: 'Technician',
        name: String(account.username || '').trim() || 'Technician',
        branchId
    };
};

const loadTechnicianByToken = async (req) => {
    const token = extractBearerToken(req);
    if (!token) {
        throw createError(401, 'Technician authorization is required.');
    }

    const verification = verifyTokenDetailed(token);
    if (!verification?.ok) {
        if (verification?.reason === 'expired') {
            logTechnicianAuthFailure(req, 'Expired technician token');
            throw createError(401, 'Technician session expired. Please sign in again.');
        }
        const invalidReason = isEphemeralSessionSecret
            ? 'Invalid technician token; possible server restart with temporary session secret'
            : 'Invalid technician token';
        logTechnicianAuthFailure(req, invalidReason);
        throw createError(401, 'Technician session is invalid. Please sign in again.');
    }

    const payload = verification.payload;
    if (payload.scope !== TECHNICIAN_TOKEN_SCOPE) {
        logTechnicianAuthFailure(req, `Wrong technician token scope (${String(payload.scope || 'none')})`);
        throw createError(401, 'Technician token is not authorized for this app.');
    }

    const technicianId = String(payload.sub || '').trim();
    if (!technicianId) {
        throw createError(401, 'Technician session is invalid.');
    }

    const accounts = await loadAccounts();
    const match = accounts.find((account) =>
        String(account.id || '').trim() === technicianId &&
        accountHasRole(account, 'Technician')
    );
    if (!match) {
        throw createError(401, 'Technician account was not found.');
    }
    if (match.isActive === false) {
        throw createError(403, 'Technician account is inactive.');
    }

    const technician = buildTechnicianProfile(match);
    if (!technician.branchId) {
        throw createError(400, 'Branch assignment missing for this technician account.');
    }
    return technician;
};

const requireTechnicianAuth = async (req, _res, next) => {
    try {
        req.technician = await loadTechnicianByToken(req);
        next();
    } catch (error) {
        next(error);
    }
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

technicianAuthRouter.post('/login', async (req, res, next) => {
    try {
        const rawUsername = req.body?.username ?? req.body?.email ?? req.body?.user;
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const username = String(rawUsername || '').trim().toLowerCase();
        if (!username || !password) {
            throw createError(400, 'Username and password are required.');
        }
        if (password !== password.replace(/^\s+|\s+$/g, '')) {
            throw createError(401, 'Invalid credentials.');
        }

        const accounts = await loadAccounts();
        const match = accounts.find((account) =>
            accountHasRole(account, 'Technician') &&
            String(account.username || '').trim().toLowerCase() === username
        );
        const passwordOk = match ? verifyPassword(password, String(match.password || '')) : false;
        if (!match || !passwordOk) {
            throw createError(401, 'Invalid credentials.');
        }
        if (match.isActive === false) {
            throw createError(403, 'Technician account is inactive.');
        }
        if (!isHashedPassword(String(match.password || ''))) {
            match.password = hashPassword(password);
            await saveAccounts(accounts);
        }

        const technician = buildTechnicianProfile(match);
        if (!technician.branchId) {
            throw createError(400, 'Branch assignment missing for this technician account.');
        }

        const token = issueToken(
            {
                scope: TECHNICIAN_TOKEN_SCOPE,
                sub: technician.id,
                role: technician.role,
                username: technician.username,
                branchId: technician.branchId
            },
            { expiresIn: TECHNICIAN_SESSION_TTL_SECONDS }
        );

        res.json({
            ok: true,
            token,
            technician,
            expiresInSeconds: TECHNICIAN_SESSION_TTL_SECONDS
        });
    } catch (error) {
        next(error);
    }
});

technicianAuthRouter.get('/me', requireTechnicianAuth, async (req, res, next) => {
    try {
        res.json({ ok: true, technician: req.technician });
    } catch (error) {
        next(error);
    }
});

technicianRouter.use(requireTechnicianAuth);

technicianRouter.get('/meta', async (req, res, next) => {
    try {
        const [plans, coverageAreas, integrationSettings] = await Promise.all([
            readPlans(req.technician.branchId),
            readCoverageAreaNames(req.technician.branchId),
            loadIntegrationSettings(req.technician.branchId).catch(() => null)
        ]);
        res.json({
            ok: true,
            technician: req.technician,
            plans: Array.isArray(plans) ? plans : [],
            coverageAreas: Array.isArray(coverageAreas) ? coverageAreas : [],
            mikrotikEnabled: hasUsableMikrotikRouter(integrationSettings)
        });
    } catch (error) {
        next(error);
    }
});

technicianRouter.get('/', async (req, res, next) => {
    try {
        const status = String(req.query?.status || 'all').trim().toLowerCase() || 'all';
        const limit = Number(req.query?.limit);
        const offset = Number(req.query?.offset);
        const result = await listCustomerDraftSubmissions({
            branchId: req.technician.branchId,
            status,
            submittedByUserId: req.technician.id,
            limit,
            offset
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error);
    }
});

technicianRouter.post('/', async (req, res, next) => {
    try {
        const [plans, coverageAreas] = await Promise.all([
            readPlans(req.technician.branchId),
            readCoverageAreaNames(req.technician.branchId)
        ]);
        const draft = applyMonthlyBillingDefaults(
            applyPlanDefaults(normalizeDraftPayload(req.body || {}), plans)
        );
        validateDraftPayload(draft, { coverageAreas });

        const item = await createCustomerDraftSubmission({
            branchId: req.technician.branchId,
            submittedBy: req.technician,
            draftData: draft
        });

        res.status(201).json({
            ok: true,
            message: 'Customer draft submitted for admin finalization.',
            item
        });
    } catch (error) {
        next(error);
    }
});

adminRouter.use(requireAdminWithBranch);

adminRouter.get('/', async (req, res, next) => {
    try {
        const status = String(req.query?.status || 'pending').trim().toLowerCase() || 'pending';
        const submittedByUserId = toSafeText(req.query?.submittedByUserId, 32);
        const limit = Number(req.query?.limit);
        const offset = Number(req.query?.offset);
        const result = await listCustomerDraftSubmissions({
            branchId: req.branchId,
            status,
            submittedByUserId,
            limit,
            offset
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error);
    }
});

adminRouter.post('/bulk-delete', async (req, res, next) => {
    try {
        const submissionIds = normalizeSubmissionIds(req.body?.submissionIds || req.body?.ids);
        if (!submissionIds.length) {
            throw createError(400, 'At least one submission ID is required.');
        }

        const deletedItems = [];
        for (const submissionId of submissionIds) {
            const deletedItem = await deletePendingDraftSubmission({
                submissionId,
                branchId: req.branchId,
                refreshSource: 'customer-drafts-bulk-delete',
                deletedBy: req.user || null
            });
            deletedItems.push(deletedItem);
        }

        res.json({
            ok: true,
            deletedCount: deletedItems.length,
            deletedIds: deletedItems.map((item) => item.id).filter(Boolean)
        });
    } catch (error) {
        next(error);
    }
});

adminRouter.post('/:id/approve', async (req, res, next) => {
    let connection = null;
    try {
        await ensureCustomerDraftSubmissionsTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            throw createError(400, 'Submission ID is required.');
        }

        if (!await isRelationalReady()) {
            const existing = await getCustomerDraftSubmission(submissionId, req.branchId);
            if (!existing) {
                throw createError(404, 'Customer draft not found.');
            }
            const currentStatus = String(existing.rawStatus || '').trim().toLowerCase();
            if (currentStatus !== 'pending') {
                throw createError(409, `This draft is already ${currentStatus || 'processed'}.`);
            }

            const existingDraftData = existing.draftData && typeof existing.draftData === 'object' && !Array.isArray(existing.draftData)
                ? existing.draftData
                : {};
            const incomingDraftData = req.body?.draftData && typeof req.body.draftData === 'object' && !Array.isArray(req.body.draftData)
                ? req.body.draftData
                : {};
            const [plans, coverageAreas] = await Promise.all([
                readPlans(req.branchId),
                readCoverageAreaNames(req.branchId)
            ]);
            let reviewedDraft = applyPlanDefaults(
                normalizeDraftPayload({ ...existingDraftData, ...incomingDraftData }),
                plans
            );

            const linkedCustomerAccountNumber = toSafeText(
                existing.draftAccountNumber || existing.approvedCustomerAccountNumber,
                20
            );
            reviewedDraft = applyDraftPortalCredentialDefaults(reviewedDraft, linkedCustomerAccountNumber);
            validateDraftPayload(reviewedDraft, { coverageAreas });

            let persistedCustomer = null;
            try {
                persistedCustomer = await updateCustomerRecord(linkedCustomerAccountNumber, reviewedDraft, {
                    branchId: req.branchId,
                    refreshSource: 'customer-drafts-finalize',
                    allowPastBillingDates: true
                });
            } catch (error) {
                if (Number(error?.status || 0) !== 404) {
                    throw error;
                }
                persistedCustomer = await createCustomerRecord({
                    ...reviewedDraft,
                    ...(linkedCustomerAccountNumber ? { accountNumber: linkedCustomerAccountNumber } : {})
                }, {
                    branchId: req.branchId,
                    refreshSource: 'customer-drafts-finalize',
                    allowPastBillingDates: true
                });
            }

            const finalizedDraft = {
                ...reviewedDraft,
                accountNumber: persistedCustomer?.accountNumber || linkedCustomerAccountNumber || '',
                mobile: persistedCustomer?.mobileRaw || persistedCustomer?.mobile || reviewedDraft.mobile || '',
                contactNumber: persistedCustomer?.mobileRaw || persistedCustomer?.mobile || reviewedDraft.mobile || '',
                planCategory: persistedCustomer?.planCategory || reviewedDraft.planCategory || '',
                planAmount: persistedCustomer?.planAmount ?? reviewedDraft.planAmount,
                activationDate: persistedCustomer?.activationDate || reviewedDraft.activationDate || '',
                dueDate: persistedCustomer?.dueDate || reviewedDraft.dueDate || '',
                dueOffset: persistedCustomer?.dueOffset ?? reviewedDraft.dueOffset,
                creditLimit: persistedCustomer?.creditLimit ?? reviewedDraft.creditLimit,
                prepaidExpirationAt: persistedCustomer?.prepaidExpirationAt || reviewedDraft.prepaidExpirationAt || '',
                loginUsername: persistedCustomer?.loginUsername || reviewedDraft.loginUsername || '',
                loginPassword: persistedCustomer?.loginPassword || reviewedDraft.loginPassword || '',
                status: persistedCustomer?.status || reviewedDraft.status || 'active'
            };

            const decisionReason = toSafeText(req.body?.reason, 2000) || null;
            await updateCustomerDraftSubmissionRow(submissionId, req.branchId, {
                customer_name: buildCustomerName(finalizedDraft) || null,
                contact_number: toSafeText(finalizedDraft.mobile, 50) || null,
                plan_name: toSafeText(finalizedDraft.planName, 120) || null,
                area_name: toSafeText(finalizedDraft.area, 150) || null,
                address_text: buildAddressText(finalizedDraft) || null,
                draft_account_number: toSafeText(persistedCustomer?.accountNumber, 20) || linkedCustomerAccountNumber || null,
                draft_json: JSON.stringify(finalizedDraft),
                status: 'approved',
                reviewed_at: new Date().toISOString(),
                reviewed_by_user_id: toSafeText(req.user?.id, 32) || null,
                reviewed_by_username: toSafeText(req.user?.username, 100) || null,
                reviewed_by_name: toSafeText(req.user?.name, 120) || null,
                decision_reason: decisionReason,
                approved_customer_account_number: toSafeText(persistedCustomer?.accountNumber, 20) || null
            });

            await promotePonAssignmentsForAccount(
                req.branchId,
                toSafeText(persistedCustomer?.accountNumber, 20) || linkedCustomerAccountNumber
            );
            const item = await getCustomerDraftSubmission(submissionId, req.branchId);
            res.json({
                ok: true,
                item,
                customer: sanitizeCustomerForAdmin(persistedCustomer)
            });
            return;
        }

        const pool = await getPool();
        if (!pool) {
            throw createError(500, 'MySQL connection is not available.');
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT *
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE id = ?
               AND branch_id = ?
             FOR UPDATE`,
            [submissionId, req.branchId]
        );
        if (!rows || !rows.length) {
            throw createError(404, 'Customer draft not found.');
        }

        const existing = rows[0];
        const currentStatus = String(existing.status || '').trim().toLowerCase();
        if (currentStatus !== 'pending') {
            throw createError(409, `This draft is already ${currentStatus || 'processed'}.`);
        }

        let existingDraftData = {};
        if (existing.draft_json) {
            try {
                const parsedDraft = JSON.parse(existing.draft_json);
                if (parsedDraft && typeof parsedDraft === 'object' && !Array.isArray(parsedDraft)) {
                    existingDraftData = parsedDraft;
                }
            } catch {
                existingDraftData = {};
            }
        }
        const incomingDraftData = req.body?.draftData && typeof req.body.draftData === 'object' && !Array.isArray(req.body.draftData)
            ? req.body.draftData
            : {};
        const [plans, coverageAreas] = await Promise.all([
            readPlans(req.branchId),
            readCoverageAreaNames(req.branchId)
        ]);
        let reviewedDraft = applyPlanDefaults(
            normalizeDraftPayload({ ...existingDraftData, ...incomingDraftData }),
            plans
        );

        const linkedCustomerAccountNumber = toSafeText(
            existing.draft_account_number || existing.approved_customer_account_number,
            20
        );
        reviewedDraft = applyDraftPortalCredentialDefaults(reviewedDraft, linkedCustomerAccountNumber);
        validateDraftPayload(reviewedDraft, { coverageAreas });
        let persistedCustomer = null;
        try {
            persistedCustomer = await updateCustomerRecord(linkedCustomerAccountNumber, reviewedDraft, {
                branchId: req.branchId,
                refreshSource: 'customer-drafts-finalize',
                allowPastBillingDates: true
            });
        } catch (error) {
            if (Number(error?.status || 0) !== 404) {
                throw error;
            }
            persistedCustomer = await createCustomerRecord({
                ...reviewedDraft,
                ...(linkedCustomerAccountNumber ? { accountNumber: linkedCustomerAccountNumber } : {})
            }, {
                branchId: req.branchId,
                refreshSource: 'customer-drafts-finalize',
                allowPastBillingDates: true
            });
        }

        const finalizedDraft = {
            ...reviewedDraft,
            accountNumber: persistedCustomer?.accountNumber || linkedCustomerAccountNumber || '',
            mobile: persistedCustomer?.mobileRaw || persistedCustomer?.mobile || reviewedDraft.mobile || '',
            contactNumber: persistedCustomer?.mobileRaw || persistedCustomer?.mobile || reviewedDraft.mobile || '',
            planCategory: persistedCustomer?.planCategory || reviewedDraft.planCategory || '',
            planAmount: persistedCustomer?.planAmount ?? reviewedDraft.planAmount,
            activationDate: persistedCustomer?.activationDate || reviewedDraft.activationDate || '',
            dueDate: persistedCustomer?.dueDate || reviewedDraft.dueDate || '',
            dueOffset: persistedCustomer?.dueOffset ?? reviewedDraft.dueOffset,
            creditLimit: persistedCustomer?.creditLimit ?? reviewedDraft.creditLimit,
            prepaidExpirationAt: persistedCustomer?.prepaidExpirationAt || reviewedDraft.prepaidExpirationAt || '',
            loginUsername: persistedCustomer?.loginUsername || reviewedDraft.loginUsername || '',
            loginPassword: persistedCustomer?.loginPassword || reviewedDraft.loginPassword || '',
            status: persistedCustomer?.status || reviewedDraft.status || 'active'
        };

        const decisionReason = toSafeText(req.body?.reason, 2000) || null;
        await connection.query(
            `UPDATE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             SET
                customer_name = ?,
                contact_number = ?,
                plan_name = ?,
                area_name = ?,
                address_text = ?,
                draft_account_number = ?,
                draft_json = ?,
                status = 'approved',
                reviewed_at = NOW(),
                reviewed_by_user_id = ?,
                reviewed_by_username = ?,
                reviewed_by_name = ?,
                decision_reason = ?,
                approved_customer_account_number = ?
             WHERE id = ?
               AND branch_id = ?`,
            [
                buildCustomerName(finalizedDraft) || null,
                toSafeText(finalizedDraft.mobile, 50) || null,
                toSafeText(finalizedDraft.planName, 120) || null,
                toSafeText(finalizedDraft.area, 150) || null,
                buildAddressText(finalizedDraft) || null,
                toSafeText(persistedCustomer?.accountNumber, 20) || linkedCustomerAccountNumber || null,
                JSON.stringify(finalizedDraft),
                toSafeText(req.user?.id, 32) || null,
                toSafeText(req.user?.username, 100) || null,
                toSafeText(req.user?.name, 120) || null,
                decisionReason,
                toSafeText(persistedCustomer?.accountNumber, 20) || null,
                submissionId,
                req.branchId
            ]
        );

        await connection.commit();
        await promotePonAssignmentsForAccount(
            req.branchId,
            toSafeText(persistedCustomer?.accountNumber, 20) || linkedCustomerAccountNumber
        );
        const item = await getCustomerDraftSubmission(submissionId, req.branchId);
        res.json({
            ok: true,
            item,
            customer: sanitizeCustomerForAdmin(persistedCustomer)
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch {
                // ignore rollback errors
            }
        }
        next(error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

adminRouter.post('/:id/reject', async (req, res, next) => {
    try {
        await ensureCustomerDraftSubmissionsTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            throw createError(400, 'Submission ID is required.');
        }

        const existing = await getCustomerDraftSubmission(submissionId, req.branchId);
        if (!existing) {
            throw createError(404, 'Customer draft not found.');
        }
        if (existing.rawStatus !== 'pending') {
            throw createError(409, `This draft is already ${existing.rawStatus || 'processed'}.`);
        }

        const draft = existing.draftData || {};
        const decisionReason = toSafeText(req.body?.reason, 2000) || null;
        const linkedCustomerAccountNumber = toSafeText(
            existing.approvedCustomerAccountNumber || existing.draftAccountNumber,
            20
        );
        await removePonAssignmentsForAccount(req.branchId, linkedCustomerAccountNumber);

        if (!await isRelationalReady()) {
            const item = await updateCustomerDraftSubmissionRow(submissionId, req.branchId, {
                customer_name: buildCustomerName(draft) || existing.customerName || null,
                contact_number: toSafeText(draft.mobile || draft.contactNumber, 50) || existing.contactNumber || null,
                plan_name: toSafeText(draft.planName, 120) || existing.planName || null,
                area_name: toSafeText(draft.area, 150) || existing.areaName || null,
                address_text: buildAddressText(draft) || existing.addressText || null,
                status: 'rejected',
                reviewed_at: new Date().toISOString(),
                reviewed_by_user_id: toSafeText(req.user?.id, 32) || null,
                reviewed_by_username: toSafeText(req.user?.username, 100) || null,
                reviewed_by_name: toSafeText(req.user?.name, 120) || null,
                decision_reason: decisionReason
            });
            if (!item) {
                throw createError(409, 'Unable to reject customer draft. It may have been updated already.');
            }
            res.json({ ok: true, item });
            return;
        }

        const [result] = await query(
            `UPDATE ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             SET
                customer_name = ?,
                contact_number = ?,
                plan_name = ?,
                area_name = ?,
                address_text = ?,
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
                buildCustomerName(draft) || existing.customerName || null,
                toSafeText(draft.mobile || draft.contactNumber, 50) || existing.contactNumber || null,
                toSafeText(draft.planName, 120) || existing.planName || null,
                toSafeText(draft.area, 150) || existing.areaName || null,
                buildAddressText(draft) || existing.addressText || null,
                toSafeText(req.user?.id, 32) || null,
                toSafeText(req.user?.username, 100) || null,
                toSafeText(req.user?.name, 120) || null,
                decisionReason,
                submissionId,
                req.branchId
            ]
        );
        if (!result || !result.affectedRows) {
            throw createError(409, 'Unable to reject customer draft. It may have been updated already.');
        }

        const item = await getCustomerDraftSubmission(submissionId, req.branchId);
        res.json({ ok: true, item });
    } catch (error) {
        next(error);
    }
});

adminRouter.delete('/:id', async (req, res, next) => {
    try {
        await deletePendingDraftSubmission({
            submissionId: req.params?.id,
            branchId: req.branchId,
            refreshSource: 'customer-drafts-delete',
            deletedBy: req.user || null
        });
        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

module.exports = {
    adminRouter,
    technicianRouter,
    technicianAuthRouter
};
module.exports.TECHNICIAN_TOKEN_SCOPE = TECHNICIAN_TOKEN_SCOPE;
module.exports.buildTechnicianProfile = buildTechnicianProfile;
module.exports.loadTechnicianByToken = loadTechnicianByToken;
module.exports.requireTechnicianAuth = requireTechnicianAuth;
