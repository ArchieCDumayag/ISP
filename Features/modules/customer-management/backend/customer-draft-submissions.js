const express = require('express');
const createError = require('http-errors');
const crypto = require('crypto');
const { getPool, query } = require('../../../../core/data/db');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { normalizeCustomerName } = require('../../../../core/data/customer-name-normalizer');
const { loadAccounts, saveAccounts } = require('../../admin/backend/accounts-store');
const { verifyPassword, isHashedPassword, hashPassword } = require('../../../../core/security/passwords');
const { issueToken, verifyTokenDetailed, isEphemeralSessionSecret } = require('../../../../core/security/session-cache');
const {
    createCustomerDraftSubmission,
    listCustomerDraftSubmissions,
    getCustomerDraftSubmission,
    ensureCustomerDraftSubmissionsTable,
    CUSTOMER_DRAFT_SUBMISSIONS_TABLE,
    updateCustomerDraftSubmissionRow,
    deleteCustomerDraftSubmissionRow,
    compareAndSetCustomerDraftInstallationCompletion,
    withCustomerDraftStoreMutationLock,
    updateCustomerDraftSubmissionDraftDataByAccountNumber,
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
    readPlans,
    readCustomers,
    recordCustomerOpeningAdjustment,
    normalizeCustomerMapPin,
    normalizeOnuSerialNumber,
    findCustomerOnuSerialDuplicate
} = require('./customers');
const {
    mutateReferralRegistry,
    normalizeActor
} = require('./referral-store');
const {
    createCustomerArchive
} = require('./customer-archive-store');
const {
    hasPonTables
} = require('../../network/backend/pon-management-api');
const {
    parseCoordinate,
    findNearbyPonNaps,
    withPonBranchLock,
    reassignPonDraftHold,
    finalizePonDraftHold,
    finalizeRequestedPonAssignment,
    releasePonDraftHold
} = require('../../network/backend/pon-serviceability');
const {
    loadIntegrationSettings,
    hasUsableMikrotikRouter
} = require('../../admin/backend/integration-settings');
const { accountHasRole } = require('../../../../core/security/role-utils');

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
const PON_STATE_STORE_KEY = 'pon-state';
const draftSubmissionMutationTails = new Map();

const withDraftSubmissionBranchLock = async (branchId, task) => {
    const key = String(resolveBranchId(branchId) || branchId || 'default');
    const previous = draftSubmissionMutationTails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    draftSubmissionMutationTails.set(key, tail);
    await previous.catch(() => {});
    try {
        return await task();
    } finally {
        release();
        if (draftSubmissionMutationTails.get(key) === tail) {
            draftSubmissionMutationTails.delete(key);
        }
    }
};

const withDraftSubmissionLock = async (branchId, task) =>
    withCustomerDraftStoreMutationLock(() => withDraftSubmissionBranchLock(branchId, task));

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

const MAX_FIRST_BILL_COLLECTION = 10000000;
const normalizeFirstBillAmountReceived = (source = {}) => {
    const raw = source.firstBillAmountReceived ?? source.first_bill_amount_received;
    if (raw === '' || raw == null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_FIRST_BILL_COLLECTION) {
        throw createError(400, 'First-bill amount received must be between PHP 0 and PHP 10,000,000.');
    }
    return toOptionalNumber(parsed);
};

const normalizePlanCategory = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'prepaid' || normalized === 'postpaid' ? normalized : '';
};

const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
const normalizePlanName = (value) => String(value || '').trim().toLowerCase();
const normalizeAreaName = (value) => String(value || '').trim().toLowerCase();
const DEFAULT_DUE_OFFSET = 0;
const normalizeBoolean = (value) => value === true
    || ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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

const findDraftSharedMobileConflicts = ({ draft = {}, customers = [], accountNumber = '' } = {}) => {
    const mobile = normalizePhilippineMobile(draft.mobile || draft.contactNumber || '', { fallbackToRaw: false });
    const targetAccountNumber = toSafeText(accountNumber, 20);
    if (!mobile) return [];
    const seen = new Set();
    return (Array.isArray(customers) ? customers : []).reduce((matches, customer) => {
        const candidateAccountNumber = toSafeText(customer?.accountNumber, 20);
        if (!candidateAccountNumber || candidateAccountNumber === targetAccountNumber || seen.has(candidateAccountNumber)) {
            return matches;
        }
        const candidateMobile = normalizePhilippineMobile(
            customer?.mobileRaw || customer?.mobile || customer?.contactNumber || '',
            { fallbackToRaw: false }
        );
        if (!candidateMobile || candidateMobile !== mobile) return matches;
        seen.add(candidateAccountNumber);
        matches.push({
            accountNumber: candidateAccountNumber,
            customerName: buildCustomerName(customer) || candidateAccountNumber
        });
        return matches;
    }, []);
};

const createSharedMobileConfirmationError = (conflicts = [], message = '') => {
    const safeConflicts = (Array.isArray(conflicts) ? conflicts : []).map((entry) => ({
        accountNumber: toSafeText(entry?.accountNumber, 20),
        customerName: toSafeText(entry?.customerName, 200)
    })).filter((entry) => entry.accountNumber);
    const firstAccountNumber = safeConflicts[0]?.accountNumber || '';
    const error = createError(
        409,
        message || (firstAccountNumber
            ? `Mobile number already belongs to account ${firstAccountNumber}. Confirm it is a shared contact and record the reason to continue.`
            : 'This mobile number is already used by another customer. Confirm it is a shared contact and record the reason to continue.')
    );
    error.code = 'CUSTOMER_DRAFT_SHARED_MOBILE_CONFIRMATION_REQUIRED';
    error.duplicate = { kind: 'mobile', accountNumber: firstAccountNumber };
    error.duplicateAccounts = safeConflicts;
    return error;
};

const resolveDraftSharedMobileApproval = ({
    draft = {},
    customers = [],
    accountNumber = '',
    override = {},
    actor = null
} = {}) => {
    const conflicts = findDraftSharedMobileConflicts({ draft, customers, accountNumber });
    if (!conflicts.length) return null;
    const confirmed = override?.confirmed === true;
    const reason = toSafeText(override?.reason, 500);
    if (!confirmed) throw createSharedMobileConfirmationError(conflicts);
    if (reason.length < 5) {
        throw createSharedMobileConfirmationError(
            conflicts,
            'Enter a clear reason for approving this shared mobile number.'
        );
    }
    return {
        confirmed: true,
        reason,
        matchedAccounts: conflicts.map((entry) => ({ ...entry })),
        confirmedAt: new Date().toISOString(),
        confirmedBy: {
            id: toSafeText(actor?.id, 32),
            username: toSafeText(actor?.username, 100),
            name: toSafeText(actor?.name, 120)
        }
    };
};

const normalizeDraftPayload = (payload = {}) => {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const firstName = normalizeCustomerName(source.firstName, 100);
    const middleName = normalizeCustomerName(source.middleName, 100);
    const lastName = normalizeCustomerName(source.lastName, 100);
    const explicitName = normalizeCustomerName(source.name, 200);
    const mobile = normalizePhilippineMobile(source.mobile || source.contactNumber || source.contact);
    const hasLatitude = Object.prototype.hasOwnProperty.call(source, 'latitude')
        && source.latitude !== null
        && String(source.latitude).trim() !== '';
    const hasLongitude = Object.prototype.hasOwnProperty.call(source, 'longitude')
        && source.longitude !== null
        && String(source.longitude).trim() !== '';
    if (hasLatitude !== hasLongitude) {
        throw createError(400, 'Both latitude and longitude are required when capturing GPS.');
    }
    let coordinateInput = toSafeText(source.mapPin, 120);
    if (hasLatitude && hasLongitude) {
        const latitude = Number(source.latitude);
        const longitude = Number(source.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw createError(400, 'GPS latitude and longitude must be valid numbers.');
        }
        coordinateInput = `${latitude}, ${longitude}`;
    }
    const mapPin = coordinateInput ? normalizeCustomerMapPin(coordinateInput) : '';
    const parsedMapPin = mapPin ? parseCoordinate(mapPin) : null;
    const rawAccuracy = source.gpsAccuracyMeters ?? source.gps_accuracy_meters;
    let gpsAccuracyMeters = null;
    if (rawAccuracy !== undefined && rawAccuracy !== null && String(rawAccuracy).trim() !== '') {
        gpsAccuracyMeters = Number(rawAccuracy);
        if (!Number.isFinite(gpsAccuracyMeters) || gpsAccuracyMeters < 0 || gpsAccuracyMeters > 10000) {
            throw createError(400, 'GPS accuracy must be between 0 and 10,000 meters.');
        }
        gpsAccuracyMeters = Number(gpsAccuracyMeters.toFixed(2));
    }
    const rawCapturedAt = toSafeText(source.gpsCapturedAt || source.gps_captured_at, 80);
    let gpsCapturedAt = '';
    if (rawCapturedAt) {
        const capturedDate = new Date(rawCapturedAt);
        if (!Number.isFinite(capturedDate.getTime())) {
            throw createError(400, 'GPS capture time is invalid.');
        }
        gpsCapturedAt = capturedDate.toISOString();
    }
    const locationSourceInput = toSafeText(source.locationSource || source.location_source, 20).toLowerCase();
    const locationSource = ['gps', 'map', 'manual', 'map_picker', 'current_location'].includes(locationSourceInput)
        ? locationSourceInput
        : (mapPin ? (hasLatitude ? 'gps' : 'manual') : '');
    const normalized = {
        clientEventId: toSafeText(source.clientEventId || source.client_event_id, 100),
        name: explicitName || [firstName, middleName, lastName].filter(Boolean).join(' ').trim(),
        firstName,
        middleName,
        lastName,
        mobile,
        email: toSafeText(source.email, 150),
        facebookAccount: toSafeText(source.facebookAccount || source.facebook_account, 200),
        facebookConfirmed: normalizeBoolean(source.facebookConfirmed || source.facebook_confirmed),
        facebookConfirmedAt: toSafeText(
            source.facebookConfirmedAt || source.facebook_confirmed_at,
            80
        ),
        facebookConfirmedBy: toSafeText(
            source.facebookConfirmedBy || source.facebook_confirmed_by,
            120
        ),
        street: toSafeText(source.street, 150),
        serviceAddress: toSafeText(source.serviceAddress || source.service_address, 255),
        barangay: toSafeText(source.barangay, 150),
        municipality: toSafeText(source.municipality, 150),
        province: toSafeText(source.province, 150),
        provinceCode: toSafeText(source.provinceCode || source.province_code, 20),
        municipalityCode: toSafeText(source.municipalityCode || source.municipality_code, 20),
        barangayCode: toSafeText(source.barangayCode || source.barangay_code, 20),
        area: toSafeText(source.area, 150),
        mapPin,
        ...(parsedMapPin ? {
            latitude: Number(parsedMapPin.latitude.toFixed(6)),
            longitude: Number(parsedMapPin.longitude.toFixed(6))
        } : {}),
        gpsAccuracyMeters,
        gpsCapturedAt,
        locationSource,
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
        firstBillPaid: normalizeBoolean(source.firstBillPaid || source.first_bill_paid),
        firstBillProratedAmount: toOptionalNumber(
            source.firstBillProratedAmount ?? source.first_bill_prorated_amount
        ),
        firstBillAmountReceived: normalizeFirstBillAmountReceived(source),
        firstBillPeriodStart: normalizeDateOnly(
            source.firstBillPeriodStart || source.first_bill_period_start
        ),
        firstBillPeriodEnd: normalizeDateOnly(
            source.firstBillPeriodEnd || source.first_bill_period_end
        ),
        referralSourceType: toSafeText(source.referralSourceType || source.referral_source_type, 40).toLowerCase(),
        referralCustomerAccountNumber: toSafeText(
            source.referralCustomerAccountNumber || source.referral_customer_account_number,
            20
        ),
        referralCustomerName: toSafeText(
            source.referralCustomerName || source.referral_customer_name,
            200
        ),
        referredBy: toSafeText(source.referredBy || source.referred_by, 200),
        remarks: toSafeText(source.remarks || source.notes, 2000),
        status: toSafeText(source.status, 30) || 'active',
        loginUsername: toSafeText(source.loginUsername, 120),
        loginPassword: toSafeText(source.loginPassword, 120),
        pppoeMode: toSafeText(source.pppoeMode, 30),
        pppoeUsername: toSafeText(source.pppoeUsername, 120),
        pppoePassword: toSafeText(source.pppoePassword, 120),
        pppoeProfile: toSafeText(source.pppoeProfile, 120),
        selectedNapId: toSafeText(source.selectedNapId || source.selected_nap_id, 100),
        selectedNapPort: Number.isFinite(Number(source.selectedNapPort ?? source.selected_nap_port))
            ? Math.max(0, Math.floor(Number(source.selectedNapPort ?? source.selected_nap_port)))
            : null
    };

    if (normalized.planAmount == null) delete normalized.planAmount;
    if (normalized.dueOffset == null) delete normalized.dueOffset;
    if (normalized.creditLimit == null) delete normalized.creditLimit;
    if (normalized.gpsAccuracyMeters == null) delete normalized.gpsAccuracyMeters;
    if (!normalized.gpsCapturedAt) delete normalized.gpsCapturedAt;
    if (!normalized.locationSource) delete normalized.locationSource;
    if (!normalized.clientEventId) delete normalized.clientEventId;
    if (!normalized.prepaidExpirationAt) delete normalized.prepaidExpirationAt;
    if (normalized.firstBillProratedAmount == null) delete normalized.firstBillProratedAmount;
    if (normalized.firstBillAmountReceived == null) delete normalized.firstBillAmountReceived;
    if (!normalized.firstBillPeriodStart) delete normalized.firstBillPeriodStart;
    if (!normalized.firstBillPeriodEnd) delete normalized.firstBillPeriodEnd;
    if (!normalized.referralSourceType) delete normalized.referralSourceType;
    if (!normalized.referralCustomerAccountNumber) delete normalized.referralCustomerAccountNumber;
    if (!normalized.referralCustomerName) delete normalized.referralCustomerName;
    if (!normalized.referredBy) delete normalized.referredBy;
    if (!normalized.facebookAccount) delete normalized.facebookAccount;
    if (!normalized.facebookConfirmedAt) delete normalized.facebookConfirmedAt;
    if (!normalized.facebookConfirmedBy) delete normalized.facebookConfirmedBy;
    if (!normalized.serviceAddress) delete normalized.serviceAddress;
    if (!normalized.selectedNapId) delete normalized.selectedNapId;
    if (!normalized.selectedNapPort) delete normalized.selectedNapPort;
    return normalized;
};

const preserveInstallationCompletion = (reviewedDraft = {}, existingDraftData = {}) => {
    const sanitizedDraft = { ...(reviewedDraft || {}) };
    delete sanitizedDraft.installationCompletion;
    delete sanitizedDraft.onuSerialNumber;
    delete sanitizedDraft.onu_serial_number;
    delete sanitizedDraft.onuSerial;
    const completion = existingDraftData?.installationCompletion;
    if (!completion || typeof completion !== 'object' || Array.isArray(completion)) {
        return sanitizedDraft;
    }
    // Installation evidence is written by the authenticated technician finalize flow.
    // Admin form payloads may edit customer fields, but must not replace or erase it.
    const onuSerialNumber = normalizeOnuSerialNumber(
        completion.onuSerialNumber ?? completion.onuSerial
    );
    return {
        ...sanitizedDraft,
        ...(onuSerialNumber ? { onuSerialNumber } : {}),
        installationCompletion: JSON.parse(JSON.stringify(completion))
    };
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

const computeMonthEndDate = (value) => {
    const activation = parseDateOnlyLocal(value);
    if (!activation) return '';
    return formatDateOnlyLocal(new Date(
        activation.getFullYear(),
        activation.getMonth() + 1,
        0
    ));
};

const computeFirstBillProration = (activationDateValue, planAmountValue) => {
    const activation = parseDateOnlyLocal(activationDateValue);
    const planAmount = Number(planAmountValue);
    if (!activation || !Number.isFinite(planAmount) || planAmount < 0) return null;
    const daysInMonth = new Date(
        activation.getFullYear(),
        activation.getMonth() + 1,
        0
    ).getDate();
    const activeDays = daysInMonth - activation.getDate() + 1;
    const monthEnd = new Date(
        activation.getFullYear(),
        activation.getMonth() + 1,
        0
    );
    return {
        periodStart: formatDateOnlyLocal(activation),
        periodEnd: formatDateOnlyLocal(monthEnd),
        activeDays,
        daysInMonth,
        // Match Customer Management and Billing's whole-peso activation proration.
        amount: Math.round((planAmount / daysInMonth) * activeDays)
    };
};

const computeFirstBillCollection = (amountDueValue, amountReceivedValue) => {
    const amountDue = toOptionalNumber(amountDueValue);
    const amountReceived = toOptionalNumber(amountReceivedValue);
    if (amountDue == null || amountDue < 0) {
        throw createError(400, 'The prorated first-bill amount is invalid.');
    }
    if (amountReceived == null || amountReceived < 0 || amountReceived > MAX_FIRST_BILL_COLLECTION) {
        throw createError(400, 'First-bill amount received must be between PHP 0 and PHP 10,000,000.');
    }
    const amountApplied = Number(Math.min(amountDue, amountReceived).toFixed(2));
    const balanceDue = Number(Math.max(amountDue - amountReceived, 0).toFixed(2));
    const advanceCredit = Number(Math.max(amountReceived - amountDue, 0).toFixed(2));
    const firstBillPaymentStatus = amountReceived <= 0
        ? 'unpaid'
        : (amountReceived < amountDue
            ? 'partially_paid'
            : (amountReceived > amountDue ? 'paid_with_advance' : 'paid'));
    return {
        firstBillAmountReceived: amountReceived,
        firstBillAppliedAmount: amountApplied,
        firstBillBalanceDue: balanceDue,
        firstBillAdvanceCredit: advanceCredit,
        firstBillPaymentStatus,
        firstBillPaid: amountDue > 0 && balanceDue === 0
    };
};

const applyFirstBillDefaults = (draft = {}) => {
    const normalizedDraft = { ...(draft || {}) };
    if (normalizePlanCategory(normalizedDraft.planCategory) !== 'postpaid') {
        normalizedDraft.firstBillPaid = false;
        delete normalizedDraft.firstBillProratedAmount;
        delete normalizedDraft.firstBillAmountReceived;
        delete normalizedDraft.firstBillAppliedAmount;
        delete normalizedDraft.firstBillBalanceDue;
        delete normalizedDraft.firstBillAdvanceCredit;
        delete normalizedDraft.firstBillPaymentStatus;
        delete normalizedDraft.firstBillPeriodStart;
        delete normalizedDraft.firstBillPeriodEnd;
        return normalizedDraft;
    }
    const proration = computeFirstBillProration(
        normalizedDraft.activationDate,
        normalizedDraft.planAmount
    );
    if (!proration) return normalizedDraft;
    normalizedDraft.billDate = proration.periodEnd;
    normalizedDraft.dueDate = proration.periodEnd;
    normalizedDraft.dueOffset = 0;
    normalizedDraft.firstBillProratedAmount = proration.amount;
    normalizedDraft.firstBillPeriodStart = proration.periodStart;
    normalizedDraft.firstBillPeriodEnd = proration.periodEnd;
    const amountReceived = normalizedDraft.firstBillAmountReceived == null
        ? (normalizedDraft.firstBillPaid === true ? proration.amount : 0)
        : normalizedDraft.firstBillAmountReceived;
    Object.assign(normalizedDraft, computeFirstBillCollection(proration.amount, amountReceived));
    return normalizedDraft;
};

const applyReferralDefaults = (draft = {}, customers = []) => {
    const normalizedDraft = { ...(draft || {}) };
    const referrerAccountNumber = toSafeText(
        normalizedDraft.referralCustomerAccountNumber,
        20
    );
    if (!referrerAccountNumber) {
        delete normalizedDraft.referralSourceType;
        delete normalizedDraft.referralCustomerAccountNumber;
        delete normalizedDraft.referralCustomerName;
        delete normalizedDraft.referredBy;
        return normalizedDraft;
    }
    const referrer = (Array.isArray(customers) ? customers : []).find((customer) => (
        toSafeText(customer?.accountNumber, 20) === referrerAccountNumber
    )) || null;
    if (!referrer) {
        throw createError(400, 'The selected referral customer no longer exists.');
    }
    const referrerName = buildCustomerName(referrer) || referrerAccountNumber;
    normalizedDraft.referralSourceType = 'customer';
    normalizedDraft.referralCustomerAccountNumber = referrerAccountNumber;
    normalizedDraft.referralCustomerName = referrerName;
    normalizedDraft.referredBy = referrerName;
    return normalizedDraft;
};

const recordDraftFirstBillPayment = async ({
    branchId,
    customer,
    draft,
    actor,
    executor = null
} = {}) => {
    const proration = computeFirstBillProration(
        customer?.activationDate || draft?.activationDate,
        customer?.planAmount ?? draft?.planAmount
    );
    if (!proration || proration.amount <= 0) return null;
    const amountReceived = draft?.firstBillAmountReceived == null
        ? (draft?.firstBillPaid === true ? proration.amount : 0)
        : toOptionalNumber(draft.firstBillAmountReceived);
    if (amountReceived == null || amountReceived <= 0) return null;
    const collection = computeFirstBillCollection(proration.amount, amountReceived);
    const description = collection.firstBillPaymentStatus === 'partially_paid'
        ? 'Partial prorated first-bill collection during installation'
        : (collection.firstBillPaymentStatus === 'paid_with_advance'
            ? 'Prorated first bill and advance collected during installation'
            : 'Prorated first bill collected during installation');
    return recordCustomerOpeningAdjustment({
        branchId,
        accountNumber: customer?.accountNumber,
        advancePayment: collection.firstBillAmountReceived,
        effectiveDate: proration.periodStart,
        actor,
        executor,
        description,
        paymentMethod: 'Technician Collection',
        referencePrefix: 'PFB'
    });
};

const createPendingDraftReferral = async ({
    branchId,
    submissionId,
    referredAccountNumber,
    draft,
    actor
} = {}) => {
    const referrerAccountNumber = toSafeText(draft?.referralCustomerAccountNumber, 20);
    if (!referrerAccountNumber) return null;
    const customers = await readCustomers(branchId);
    const referrer = (Array.isArray(customers) ? customers : []).find((customer) => (
        toSafeText(customer?.accountNumber, 20) === referrerAccountNumber
    )) || null;
    if (!referrer) throw createError(409, 'The selected referral customer no longer exists.');
    const safeReferredAccount = toSafeText(referredAccountNumber, 20);
    if (!safeReferredAccount || safeReferredAccount === referrerAccountNumber) {
        throw createError(400, 'Choose a different existing customer as the referrer.');
    }
    const referrerName = buildCustomerName(referrer) || referrerAccountNumber;
    const timestamp = new Date().toISOString();
    const safeActor = normalizeActor(actor);
    const recordId = `referral-draft-${toSafeText(submissionId, 64)}`;
    return mutateReferralRegistry(branchId, (records) => {
        const existing = records.find((item) => (
            toSafeText(item?.referredAccountNumber, 20) === safeReferredAccount
        )) || null;
        if (existing) {
            const sameSource = existing.sourceType === 'customer'
                && toSafeText(existing.referrerAccountNumber, 20) === referrerAccountNumber;
            if (!sameSource) {
                throw createError(409, 'This customer already has a different referral record.');
            }
            return { changed: false, result: existing };
        }
        const reason = 'Submitted by technician during customer onboarding.';
        const record = {
            id: recordId,
            sourceType: 'customer',
            referrerAccountNumber,
            referrerId: '',
            referrerName,
            referredAccountNumber: safeReferredAccount,
            approvalStatus: 'pending',
            approvalReason: reason,
            approvedDiscountAmount: 0,
            approvedAt: '',
            approvedBy: null,
            applyFromMonth: '',
            createdAt: timestamp,
            createdBy: safeActor,
            updatedAt: timestamp,
            updatedBy: safeActor,
            applications: [],
            audit: [{
                id: `created-${recordId}`,
                action: 'created',
                reason,
                at: timestamp,
                by: safeActor
            }]
        };
        return { records: [...records, record], result: record };
    });
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
    if (isJsonStorageMode()) {
        return withPonBranchLock(safeBranchId, async () => {
            const allState = await readJson(PON_STATE_STORE_KEY, {});
            const branch = allState?.branches?.[String(safeBranchId)] || allState?.default;
            if (!branch || !Array.isArray(branch.naps)) return false;
            const accountKey = safeAccountNumber.toLowerCase();
            let removed = false;
            branch.naps.forEach((nap) => {
                const connections = Array.isArray(nap?.connections) ? nap.connections : [];
                const kept = connections.filter((entry) => {
                    const matches = [entry?.customerId, entry?.customerRef, entry?.accountNumber]
                        .some((value) => toSafeText(value, 200).toLowerCase() === accountKey);
                    if (matches) removed = true;
                    return !matches;
                });
                if (kept.length !== connections.length) {
                    nap.connections = kept;
                    nap.used = kept.length;
                }
            });
            if (removed) {
                branch.updatedAt = new Date().toISOString();
                await writeJson(PON_STATE_STORE_KEY, allState);
            }
            return removed;
        });
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
    if (isJsonStorageMode()) {
        return withPonBranchLock(safeBranchId, async () => {
            const allState = await readJson(PON_STATE_STORE_KEY, {});
            const branch = allState?.branches?.[String(safeBranchId)] || allState?.default;
            if (!branch || !Array.isArray(branch.naps)) return false;
            const accountKey = safeAccountNumber.toLowerCase();
            let promoted = false;
            branch.naps.forEach((nap) => {
                (Array.isArray(nap?.connections) ? nap.connections : []).forEach((entry) => {
                    const matches = [entry?.customerId, entry?.customerRef, entry?.accountNumber]
                        .some((value) => toSafeText(value, 200).toLowerCase() === accountKey);
                    if (!matches) return;
                    if (entry.customerId !== safeAccountNumber || entry.customerRef !== safeAccountNumber) {
                        entry.customerId = safeAccountNumber;
                        entry.customerRef = safeAccountNumber;
                        promoted = true;
                    }
                });
            });
            if (promoted) {
                branch.updatedAt = new Date().toISOString();
                await writeJson(PON_STATE_STORE_KEY, allState);
            }
            return promoted;
        });
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

const getDraftPonSelection = (draft = {}) => {
    const completion = draft?.installationCompletion;
    const assignment = completion?.ponAssignment;
    if (!completion || typeof completion !== 'object' || Array.isArray(completion)) return null;
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) return null;
    const status = toSafeText(assignment.status, 30).toLowerCase();
    const reservationId = toSafeText(assignment.reservationId, 64);
    const napId = toSafeText(draft.selectedNapId || assignment.napId, 100);
    const port = Number(draft.selectedNapPort || assignment.port);
    if (!napId || !Number.isInteger(port) || port <= 0) {
        return null;
    }
    return { completion, assignment, reservationId, napId, port, status };
};

const getDraftPonHold = (draft = {}) => {
    const selection = getDraftPonSelection(draft);
    if (!selection || selection.status !== 'draft-held' || !selection.reservationId) return null;
    return selection;
};

const prepareDraftPonHoldForAdmin = async ({ branchId, accountNumber, draft, actor } = {}) => {
    const hold = getDraftPonHold(draft);
    if (!hold) return null;
    const reassigned = await reassignPonDraftHold({
        branchId,
        reservationId: hold.reservationId,
        customerAccountNumber: accountNumber,
        napId: hold.napId,
        port: hold.port,
        reassignedByUserId: toSafeText(actor?.id || actor?.username, 64)
    });
    return { ...hold, selection: reassigned.selection || hold.assignment };
};

const finalizeDraftPonHoldForAdmin = async ({
    branchId,
    accountNumber,
    customerName,
    submissionId,
    hold
} = {}) => {
    if (!hold) return null;
    return finalizePonDraftHold({
        branchId,
        reservationId: hold.reservationId,
        customerAccountNumber: accountNumber,
        customerName,
        clientEventId: `admin-draft-${toSafeText(submissionId, 64)}`,
        opticalInfo: hold.assignment?.opticalInfo
    });
};

const finalizeDraftPonSelectionForAdmin = async ({
    branchId,
    accountNumber,
    customerName,
    submissionId,
    selection
} = {}) => {
    if (!selection) return null;
    if (selection.status === 'draft-held' && selection.reservationId) {
        return finalizeDraftPonHoldForAdmin({
            branchId,
            accountNumber,
            customerName,
            submissionId,
            hold: selection
        });
    }
    return finalizeRequestedPonAssignment({
        branchId,
        napId: selection.napId,
        port: selection.port,
        customerAccountNumber: accountNumber,
        customerName,
        clientEventId: `admin-draft-${toSafeText(submissionId, 64)}`,
        opticalInfo: selection.assignment?.opticalInfo
    });
};

const applyFinalizedPonAssignment = (draft = {}, finalizedResult = null) => {
    if (!finalizedResult?.assignment) return draft;
    const completion = draft?.installationCompletion;
    if (!completion || typeof completion !== 'object' || Array.isArray(completion)) return draft;
    const assignment = finalizedResult.assignment;
    return {
        ...draft,
        selectedNapId: toSafeText(assignment.napId, 100),
        selectedNapPort: Number(assignment.port) || null,
        installationCompletion: {
            ...completion,
            ponAssignment: {
                ...(completion.ponAssignment || {}),
                ...(toSafeText(finalizedResult.reservationId, 64)
                    ? { reservationId: toSafeText(finalizedResult.reservationId, 64) }
                    : {}),
                napId: toSafeText(assignment.napId, 100),
                napCode: toSafeText(assignment.napCode, 100),
                linkedOlt: toSafeText(assignment.linkedOlt, 120),
                ponRef: toSafeText(assignment.ponRef, 80),
                location: toSafeText(assignment.location, 150),
                port: Number(assignment.port) || null,
                opticalInfo: toSafeText(assignment.opticalInfo, 120),
                status: 'finalized'
            }
        }
    };
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

const cleanupRejectedOrDeletedDraftResources = async ({
    branchId,
    linkedCustomerAccountNumber = '',
    draftData = {},
    customerName = '',
    refreshSource = 'customer-drafts-delete',
    deleteCustomer = true
} = {}) => {
    const warnings = [];
    const hold = getDraftPonHold(draftData);
    if (hold) {
        try {
            await releasePonDraftHold({
                branchId,
                reservationId: hold.reservationId,
                customerAccountNumber: linkedCustomerAccountNumber
            });
        } catch (error) {
            warnings.push(`PON hold cleanup: ${error?.message || error}`);
        }
    }
    try {
        await removePonAssignmentsForAccount(branchId, linkedCustomerAccountNumber);
    } catch (error) {
        warnings.push(`PON cleanup: ${error?.message || error}`);
    }

    if (!deleteCustomer) return warnings.join('; ');

    if (linkedCustomerAccountNumber) {
        try {
            await deleteCustomerRecord(linkedCustomerAccountNumber, {
                branchId,
                refreshSource,
                deleteDraftRows: false
            });
            return warnings.join('; ');
        } catch (error) {
            if (Number(error?.status || 0) !== 404) {
                warnings.push(`Customer cleanup: ${error?.message || error}`);
                return warnings.join('; ');
            }
        }
    }

    const cleanupResult = await cleanupDraftLinkedPppoeAccount({
        branchId,
        linkedCustomerAccountNumber,
        draftData,
        customerName
    });
    if (cleanupResult?.warning) warnings.push(String(cleanupResult.warning));
    return warnings.join('; ');
};

const deletePendingDraftSubmission = async ({
    submissionId,
    branchId,
    submittedByUserId = '',
    refreshSource = 'customer-drafts-delete',
    deletedBy = null,
    branchLockHeld = false
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

    const relationalReady = await isRelationalReady();
    if (!relationalReady && !branchLockHeld) {
        return withDraftSubmissionLock(safeBranchId, () => deletePendingDraftSubmission({
            submissionId: safeSubmissionId,
            branchId: safeBranchId,
            submittedByUserId: safeSubmittedByUserId,
            refreshSource,
            deletedBy,
            branchLockHeld: true
        }));
    }

    const existing = await getCustomerDraftSubmission(safeSubmissionId, safeBranchId);
    if (!existing) {
        throw createError(404, 'Customer draft not found.');
    }
    if (safeSubmittedByUserId && toSafeText(existing?.submittedBy?.id, 32) !== safeSubmittedByUserId) {
        throw createError(404, 'Customer draft not found.');
    }
    const deletableStatus = toSafeText(existing.rawStatus, 20).toLowerCase();
    if (!['in-progress', 'pending'].includes(deletableStatus)) {
        throw createError(409, 'Only pending or incomplete customer drafts can be deleted here.');
    }

    const linkedCustomerAccountNumber = toSafeText(
        existing.approvedCustomerAccountNumber || existing.draftAccountNumber,
        20
    );
    const existingDraftData = existing.draftData && typeof existing.draftData === 'object' && !Array.isArray(existing.draftData)
        ? existing.draftData
        : {};
    if (!relationalReady) {
        const deleted = await deleteCustomerDraftSubmissionRow({
            id: safeSubmissionId,
            branchId: safeBranchId,
            submittedByUserId: safeSubmittedByUserId,
            status: deletableStatus
        });
        if (!deleted) {
            throw createError(409, 'Unable to delete customer draft. It may have been updated already.');
        }
        await cleanupRejectedOrDeletedDraftResources({
            branchId: safeBranchId,
            linkedCustomerAccountNumber,
            draftData: existingDraftData,
            customerName: existing.customerName || buildCustomerName(existingDraftData),
            refreshSource
        });
        return existing;
    }

    const params = [safeSubmissionId, safeBranchId, deletableStatus];
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
                cleanupWarning: ''
            }),
            executor: connection
        });

        const [result] = await connection.query(
            `DELETE FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE id = ?
               AND branch_id = ?
               AND status = ?
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

    await cleanupRejectedOrDeletedDraftResources({
        branchId: safeBranchId,
        linkedCustomerAccountNumber,
        draftData: existingDraftData,
        customerName: existing.customerName || buildCustomerName(existingDraftData),
        refreshSource
    });

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

const duplicateNameKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const draftSubmissionFingerprint = (draft = {}) => JSON.stringify({
    name: duplicateNameKey(buildCustomerName(draft)),
    middleName: duplicateNameKey(draft.middleName),
    mobile: normalizePhilippineMobile(draft.mobile, { fallbackToRaw: false }),
    email: toSafeText(draft.email, 150).toLowerCase(),
    facebookAccount: toSafeText(draft.facebookAccount, 200),
    facebookConfirmed: draft.facebookConfirmed === true,
    facebookConfirmedAt: toSafeText(draft.facebookConfirmedAt, 80),
    facebookConfirmedBy: toSafeText(draft.facebookConfirmedBy, 120),
    street: duplicateNameKey(draft.street),
    serviceAddress: duplicateNameKey(draft.serviceAddress),
    barangay: duplicateNameKey(draft.barangay),
    municipality: duplicateNameKey(draft.municipality),
    province: duplicateNameKey(draft.province),
    provinceCode: toSafeText(draft.provinceCode, 20),
    municipalityCode: toSafeText(draft.municipalityCode, 20),
    barangayCode: toSafeText(draft.barangayCode, 20),
    area: duplicateNameKey(draft.area),
    mapPin: toSafeText(draft.mapPin, 120),
    gpsAccuracyMeters: toOptionalNumber(draft.gpsAccuracyMeters),
    gpsCapturedAt: toSafeText(draft.gpsCapturedAt, 80),
    planId: toSafeText(draft.planId, 80),
    planName: duplicateNameKey(draft.planName),
    planCategory: toSafeText(draft.planCategory, 20).toLowerCase(),
    planAmount: toOptionalNumber(draft.planAmount),
    activationDate: normalizeDateOnly(draft.activationDate),
    billDate: normalizeDateOnly(draft.billDate),
    dueDate: normalizeDateOnly(draft.dueDate),
    prepaidExpirationAt: normalizeDateTimeInput(draft.prepaidExpirationAt),
    dueOffset: Number.isFinite(Number(draft.dueOffset)) ? Math.max(0, Math.floor(Number(draft.dueOffset))) : null,
    creditLimit: Number.isFinite(Number(draft.creditLimit)) ? Math.max(0, Math.floor(Number(draft.creditLimit))) : null,
    firstBillPaid: draft.firstBillPaid === true,
    firstBillProratedAmount: toOptionalNumber(draft.firstBillProratedAmount),
    firstBillAmountReceived: toOptionalNumber(draft.firstBillAmountReceived)
        ?? (draft.firstBillPaid === true ? toOptionalNumber(draft.firstBillProratedAmount) : 0),
    firstBillPeriodStart: normalizeDateOnly(draft.firstBillPeriodStart),
    firstBillPeriodEnd: normalizeDateOnly(draft.firstBillPeriodEnd),
    referralSourceType: toSafeText(draft.referralSourceType, 40),
    referralCustomerAccountNumber: toSafeText(draft.referralCustomerAccountNumber, 20),
    referralCustomerName: duplicateNameKey(draft.referralCustomerName),
    remarks: toSafeText(draft.remarks, 2000),
    status: toSafeText(draft.status, 30).toLowerCase(),
    loginUsername: toSafeText(draft.loginUsername, 120),
    loginPassword: toSafeText(draft.loginPassword, 120),
    pppoeMode: toSafeText(draft.pppoeMode, 30).toLowerCase(),
    pppoeUsername: toSafeText(draft.pppoeUsername, 120),
    pppoePassword: toSafeText(draft.pppoePassword, 120),
    pppoeProfile: toSafeText(draft.pppoeProfile, 120),
    selectedNapId: toSafeText(draft.selectedNapId, 100),
    selectedNapPort: Number.isInteger(Number(draft.selectedNapPort))
        ? Number(draft.selectedNapPort)
        : null,
    onuSerialNumber: normalizeOnuSerialNumber(
        draft.onuSerialNumber || draft.installationCompletion?.onuSerialNumber
    ),
    installationEventId: toSafeText(draft.installationCompletion?.clientEventId, 100)
});

const buildTechnicianCompletedDraft = async ({
    draft,
    source,
    branchId,
    technician,
    customers
} = {}) => {
    const rawCompletion = source?.installationCompletion;
    const hasCompletion = rawCompletion && typeof rawCompletion === 'object'
        && !Array.isArray(rawCompletion);
    const hasSelection = Boolean(draft?.selectedNapId || draft?.selectedNapPort);
    const rawOnuSerial = rawCompletion?.onuSerialNumber
        ?? source?.onuSerialNumber
        ?? source?.onuSerial;
    if (!hasCompletion && !hasSelection && !toSafeText(rawOnuSerial, 160)) {
        return { draft, completed: false };
    }

    const selectedNapId = toSafeText(draft?.selectedNapId, 100);
    const selectedNapPort = Number(draft?.selectedNapPort);
    if (!selectedNapId || !Number.isInteger(selectedNapPort) || selectedNapPort <= 0) {
        throw createError(400, 'Select a requested NAP and port before submitting for Admin review.');
    }
    const onuSerialNumber = normalizeOnuSerialNumber(rawOnuSerial);
    if (!onuSerialNumber) throw createError(400, 'ONU serial number is required.');
    const completionEventId = toSafeText(
        rawCompletion?.clientEventId || draft?.clientEventId,
        100
    );
    if (!completionEventId) throw createError(400, 'Installation clientEventId is required.');
    const onuDuplicate = findCustomerOnuSerialDuplicate(
        onuSerialNumber,
        customers,
        branchId
    );
    if (onuDuplicate) {
        throw createError(409, onuDuplicate.message, { duplicate: onuDuplicate });
    }
    const coordinates = parseCoordinate(draft?.mapPin)
        || parseCoordinate(`${draft?.latitude || ''}, ${draft?.longitude || ''}`);
    if (!coordinates) {
        throw createError(400, 'Valid customer coordinates are required to submit the requested NAP port.');
    }
    const nearby = await findNearbyPonNaps({
        branchId,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        limit: 500,
        maxDistanceMeters: 600,
        includeOffline: true,
        includeUnavailable: true,
        allowExpandedLimit: true
    });
    const candidate = nearby.candidates.find((entry) => entry.napId === selectedNapId);
    if (!candidate) {
        throw createError(400, 'The requested NAP is outside the 600-meter installation area.');
    }
    const portEntry = (Array.isArray(candidate.ports) ? candidate.ports : [])
        .find((entry) => Number(entry?.port) === selectedNapPort);
    if (!portEntry) {
        throw createError(400, 'The requested port is outside the selected NAP capacity.');
    }
    const requestedAt = new Date().toISOString();
    const completionFingerprint = crypto.createHash('sha256').update(JSON.stringify({
        completionEventId,
        onuSerialNumber,
        selectedNapId,
        selectedNapPort
    })).digest('hex');
    const installationCompletion = {
        clientEventId: completionEventId,
        onuSerialNumber,
        fingerprint: completionFingerprint,
        submittedAt: requestedAt,
        submittedBy: {
            id: toSafeText(technician?.id, 64),
            username: toSafeText(technician?.username || technician?.name, 120)
        },
        ponAssignment: {
            napId: selectedNapId,
            napCode: toSafeText(candidate.napCode, 100),
            linkedOlt: toSafeText(candidate.linkedOlt, 120),
            ponRef: toSafeText(candidate.ponRef, 80),
            location: toSafeText(candidate.location, 150),
            port: selectedNapPort,
            status: 'requested',
            requestedAt,
            availableAtSubmission: portEntry.available === true
        }
    };
    return {
        completed: true,
        draft: {
            ...draft,
            selectedNapId,
            selectedNapPort,
            onuSerialNumber,
            installationCompletion
        }
    };
};

const listAllCustomerDraftSubmissions = async (options = {}, listPage = listCustomerDraftSubmissions) => {
    const items = [];
    let offset = 0;
    while (true) {
        const result = await listPage({ ...options, limit: 200, offset });
        const page = Array.isArray(result?.items) ? result.items : [];
        items.push(...page);
        const total = Number(result?.pagination?.total);
        offset += page.length;
        if (!page.length || (Number.isFinite(total) && offset >= total)) break;
    }
    return items;
};

const findDraftSubmissionByClientEvent = async (branchId, technicianId, draft = {}) => {
    const clientEventId = toSafeText(draft.clientEventId, 100);
    if (!clientEventId) return null;
    const submissions = await listAllCustomerDraftSubmissions({
        branchId,
        status: 'all',
        submittedByUserId: technicianId
    });
    return submissions.find((submission) => (
        toSafeText(submission?.draftData?.clientEventId, 100) === clientEventId
    )) || null;
};

const findDraftDuplicateCandidates = async (branchId, draft = {}) => {
    const targetName = duplicateNameKey(buildCustomerName(draft));
    const targetMobile = normalizePhilippineMobile(draft.mobile, { fallbackToRaw: false });
    const targetMapPin = toSafeText(draft.mapPin, 120);
    if (!targetName) return [];

    const [customers, pendingDrafts] = await Promise.all([
        readCustomers(branchId),
        listAllCustomerDraftSubmissions({ branchId, status: 'all' })
    ]);
    const candidates = [];
    (Array.isArray(customers) ? customers : []).forEach((customer) => {
        const name = buildCustomerName(customer);
        const mobile = normalizePhilippineMobile(
            customer?.mobileRaw || customer?.mobile || customer?.contactNumber || '',
            { fallbackToRaw: false }
        );
        const mapPin = toSafeText(customer?.mapPin, 120);
        const sameName = duplicateNameKey(name) === targetName;
        const sameMobile = Boolean(targetMobile && mobile && targetMobile === mobile);
        const sameLocation = Boolean(targetMapPin && mapPin && targetMapPin === mapPin);
        if (!sameName || (!sameMobile && !sameLocation)) return;
        candidates.push({
            type: 'customer',
            accountNumber: toSafeText(customer?.accountNumber, 20),
            name,
            mobile,
            status: toSafeText(customer?.status, 30) || 'active',
            matchedBy: sameMobile ? 'name-and-mobile' : 'name-and-location'
        });
    });
    pendingDrafts
        .filter((submission) => ['in-progress', 'pending'].includes(
            toSafeText(submission?.rawStatus || submission?.status, 20).toLowerCase()
        ))
        .forEach((submission) => {
            const pendingDraft = submission?.draftData || {};
            const rawStatus = toSafeText(
                submission?.rawStatus || submission?.status,
                20
            ).toLowerCase();
            const name = submission?.customerName || buildCustomerName(pendingDraft);
            const mobile = normalizePhilippineMobile(
                pendingDraft?.mobile || submission?.contactNumber || '',
                { fallbackToRaw: false }
            );
            const mapPin = toSafeText(pendingDraft?.mapPin, 120);
            const sameName = duplicateNameKey(name) === targetName;
            const sameMobile = Boolean(targetMobile && mobile && targetMobile === mobile);
            const sameLocation = Boolean(targetMapPin && mapPin && targetMapPin === mapPin);
            if (!sameName || (!sameMobile && !sameLocation)) return;
            candidates.push({
                type: 'pending-draft',
                id: toSafeText(submission?.id, 64),
                accountNumber: toSafeText(submission?.draftAccountNumber, 20),
                name,
                mobile,
                status: rawStatus || 'pending',
                submittedByUserId: toSafeText(submission?.submittedBy?.id, 32),
                matchedBy: sameMobile ? 'name-and-mobile' : 'name-and-location'
            });
        });
    return candidates.slice(0, 10);
};

const selectRecoverableOwnedInProgressDraft = (candidates = [], technicianId = '') => {
    const safeTechnicianId = toSafeText(technicianId, 32);
    const list = Array.isArray(candidates) ? candidates : [];
    if (!safeTechnicianId || !list.length) return null;
    const recoverable = list.filter((candidate) => (
        candidate?.type === 'pending-draft'
        && toSafeText(candidate?.status, 20).toLowerCase() === 'in-progress'
        && toSafeText(candidate?.submittedByUserId, 32) === safeTechnicianId
        && toSafeText(candidate?.accountNumber, 20)
    ));
    return recoverable.length === 1 && list.length === 1 ? recoverable[0] : null;
};

const buildDraftDuplicateConflict = (duplicates = []) => {
    const list = Array.isArray(duplicates) ? duplicates : [];
    const first = list[0] || {};
    const reference = toSafeText(first.accountNumber || first.id, 64);
    const suffix = reference ? ` (${reference})` : '';
    const status = toSafeText(first.status, 20).toLowerCase();
    if (first.type === 'customer') {
        return `A matching customer already exists${suffix}.`;
    }
    if (status === 'in-progress') {
        return `A matching incomplete draft already exists${suffix}. Open Admin > Customer Draft Queue > Incomplete drafts to review or delete it.`;
    }
    return `A matching installation is already pending Admin review${suffix}.`;
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
        const [plans, coverageAreas, integrationSettings, customers] = await Promise.all([
            readPlans(req.technician.branchId),
            readCoverageAreaNames(req.technician.branchId),
            loadIntegrationSettings(req.technician.branchId).catch(() => null),
            readCustomers(req.technician.branchId)
        ]);
        const referralCustomers = (Array.isArray(customers) ? customers : [])
            .map((customer) => ({
                accountNumber: toSafeText(customer?.accountNumber, 20),
                name: buildCustomerName(customer),
                status: toSafeText(customer?.status, 30) || 'active',
                area: toSafeText(customer?.area, 150)
            }))
            .filter((customer) => customer.accountNumber && customer.name)
            .sort((left, right) => left.name.localeCompare(right.name));
        res.json({
            ok: true,
            technician: req.technician,
            plans: Array.isArray(plans) ? plans : [],
            coverageAreas: Array.isArray(coverageAreas) ? coverageAreas : [],
            referralCustomers,
            mikrotikEnabled: hasUsableMikrotikRouter(integrationSettings)
        });
    } catch (error) {
        next(error);
    }
});

technicianRouter.post('/duplicate-check', async (req, res, next) => {
    try {
        const draft = normalizeDraftPayload(req.body || {});
        const candidates = await findDraftDuplicateCandidates(req.technician.branchId, draft);
        res.json({ ok: true, duplicate: candidates.length > 0, candidates });
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
        const [plans, coverageAreas, customers] = await Promise.all([
            readPlans(req.technician.branchId),
            readCoverageAreaNames(req.technician.branchId),
            readCustomers(req.technician.branchId)
        ]);
        let draft = applyReferralDefaults(
            applyFirstBillDefaults(
                applyMonthlyBillingDefaults(
                    applyPlanDefaults(normalizeDraftPayload(req.body || {}), plans)
                )
            ),
            customers
        );
        validateDraftPayload(draft, { coverageAreas });
        const completedDraft = await buildTechnicianCompletedDraft({
            draft,
            source: req.body || {},
            branchId: req.technician.branchId,
            technician: req.technician,
            customers
        });
        draft = completedDraft.draft;

        const submission = await withDraftSubmissionLock(req.technician.branchId, async () => {
            const replay = await findDraftSubmissionByClientEvent(
                req.technician.branchId,
                req.technician.id,
                draft
            );
            if (replay) {
                if (draftSubmissionFingerprint(replay.draftData) !== draftSubmissionFingerprint(draft)) {
                    if (toSafeText(replay.rawStatus, 20).toLowerCase() === 'in-progress') {
                        const recoveredItem = await updateCustomerDraftSubmissionDraftDataByAccountNumber(
                            replay.draftAccountNumber,
                            req.technician.branchId,
                            draft,
                            { statuses: ['in-progress'] }
                        );
                        if (!recoveredItem) {
                            throw createError(409, 'The incomplete draft changed while it was being recovered. Retry the same submission.');
                        }
                        return { item: recoveredItem, replayed: false, recovered: true };
                    }
                    throw createError(409, 'clientEventId was already used for a different customer draft.');
                }
                return { item: replay, replayed: true, recovered: false };
            }
            const duplicates = await findDraftDuplicateCandidates(req.technician.branchId, draft);
            if (duplicates.length) {
                const recoverable = selectRecoverableOwnedInProgressDraft(
                    duplicates,
                    req.technician.id
                );
                if (recoverable) {
                    const recoveredItem = await updateCustomerDraftSubmissionDraftDataByAccountNumber(
                        recoverable.accountNumber,
                        req.technician.branchId,
                        draft,
                        { statuses: ['in-progress'] }
                    );
                    if (!recoveredItem) {
                        throw createError(409, 'The incomplete draft changed while it was being recovered. Retry the same submission.');
                    }
                    return { item: recoveredItem, replayed: false, recovered: true };
                }
                throw createError(409, buildDraftDuplicateConflict(duplicates), {
                    duplicateCandidates: duplicates
                });
            }
            return {
                item: await createCustomerDraftSubmission({
                    branchId: req.technician.branchId,
                    submittedBy: req.technician,
                    draftData: draft
                }),
                replayed: false,
                recovered: false
            };
        });

        if (completedDraft.completed) {
            const completionUpdate = await compareAndSetCustomerDraftInstallationCompletion(
                submission.item?.draftAccountNumber,
                req.technician.branchId,
                draft.installationCompletion,
                {
                    statuses: ['in-progress', 'pending', 'approved'],
                    transitionToPending: true
                }
            );
            if (!completionUpdate) {
                throw createError(503, 'The complete installation draft could not be submitted for Admin review. Retry the same submission.');
            }
            submission.item = completionUpdate.item;
        }

        res.status(submission.replayed ? 200 : 201).json({
            ok: true,
            replayed: submission.replayed,
            recovered: submission.recovered === true,
            message: completedDraft.completed
                ? (submission.replayed
                    ? 'The complete installation was already submitted for Admin review.'
                    : (submission.recovered
                        ? 'The incomplete customer draft was recovered, and the customer, billing, requested NAP/port, and ONU were submitted together for Admin review.'
                        : 'Customer, billing, requested NAP/port, and ONU were submitted together for Admin review.'))
                : (submission.replayed
                    ? 'Customer intake was already saved.'
                    : (submission.recovered
                        ? 'The incomplete customer draft was recovered and updated.'
                        : 'Customer intake saved. Select a NAP port and submit the installation for Admin review.')),
            item: submission.item
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

adminRouter.get('/:id/pon-options', async (req, res, next) => {
    try {
        const submissionId = toSafeText(req.params?.id, 64);
        const submission = await getCustomerDraftSubmission(submissionId, req.branchId);
        if (!submission) throw createError(404, 'Customer draft not found.');
        if (toSafeText(submission.rawStatus, 20).toLowerCase() !== 'pending') {
            throw createError(409, 'Only a pending customer draft can change its NAP port.');
        }
        const draft = submission.draftData || {};
        const selection = getDraftPonSelection(draft);
        const coordinates = parseCoordinate(draft.mapPin)
            || parseCoordinate(`${draft.latitude || ''}, ${draft.longitude || ''}`);
        if (!coordinates) {
            throw createError(409, 'The submitted customer location is required to load NAP options.');
        }
        const result = await findNearbyPonNaps({
            branchId: req.branchId,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            limit: 500,
            maxDistanceMeters: 100000,
            includeOffline: true,
            includeUnavailable: true,
            allowExpandedLimit: true
        });
        return res.json({
            ok: true,
            current: selection ? {
                ...(selection.reservationId ? { reservationId: selection.reservationId } : {}),
                napId: selection.napId,
                port: selection.port,
                status: selection.status || 'requested'
            } : null,
            candidates: result.candidates.map((candidate) => ({
                napId: candidate.napId,
                napCode: candidate.napCode,
                location: candidate.location,
                linkedOlt: candidate.linkedOlt,
                ponRef: candidate.ponRef,
                distanceMeters: candidate.distanceMeters,
                capacity: candidate.capacity,
                oltStatus: candidate.oltStatus,
                ports: candidate.ports
            }))
        });
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
            return await withDraftSubmissionLock(req.branchId, async () => {
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
            const [plans, coverageAreas, customers] = await Promise.all([
                readPlans(req.branchId),
                readCoverageAreaNames(req.branchId),
                readCustomers(req.branchId)
            ]);
            let reviewedDraft = preserveInstallationCompletion(
                applyReferralDefaults(
                    applyFirstBillDefaults(
                        applyMonthlyBillingDefaults(
                            applyPlanDefaults(
                                normalizeDraftPayload({ ...existingDraftData, ...incomingDraftData }),
                                plans
                            )
                        )
                    ),
                    customers
                ),
                existingDraftData
            );

            const linkedCustomerAccountNumber = toSafeText(
                existing.draftAccountNumber || existing.approvedCustomerAccountNumber,
                20
            );
            const sharedMobileApproval = resolveDraftSharedMobileApproval({
                draft: reviewedDraft,
                customers,
                accountNumber: linkedCustomerAccountNumber,
                override: req.body?.sharedMobileOverride,
                actor: req.user || null
            });
            reviewedDraft = applyDraftPortalCredentialDefaults(reviewedDraft, linkedCustomerAccountNumber);
            validateDraftPayload(reviewedDraft, { coverageAreas });
            const reviewedPonSelection = getDraftPonSelection(reviewedDraft);
            if (reviewedDraft.installationCompletion && !reviewedPonSelection) {
                throw createError(400, 'Select the NAP and port to finalize this installation.');
            }
            const preparedPonHold = await prepareDraftPonHoldForAdmin({
                branchId: req.branchId,
                accountNumber: linkedCustomerAccountNumber,
                draft: reviewedDraft,
                actor: req.user || null
            });
            const preparedPonSelection = preparedPonHold || reviewedPonSelection;

            let persistedCustomer = null;
            try {
                persistedCustomer = await updateCustomerRecord(linkedCustomerAccountNumber, reviewedDraft, {
                    branchId: req.branchId,
                    refreshSource: 'customer-drafts-finalize',
                    allowPastBillingDates: true,
                    trustedOnuSerialNumber: reviewedDraft.onuSerialNumber,
                    allowDuplicateMobile: Boolean(sharedMobileApproval)
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
                    allowPastBillingDates: true,
                    trustedOnuSerialNumber: reviewedDraft.onuSerialNumber,
                    allowDuplicateMobile: Boolean(sharedMobileApproval)
                });
            }

            const finalizedPonHold = await finalizeDraftPonSelectionForAdmin({
                branchId: req.branchId,
                accountNumber: toSafeText(persistedCustomer?.accountNumber, 20)
                    || linkedCustomerAccountNumber,
                customerName: buildCustomerName(reviewedDraft),
                submissionId,
                selection: preparedPonSelection
            });
            reviewedDraft = applyFinalizedPonAssignment(reviewedDraft, finalizedPonHold);

            const firstBillPayment = await recordDraftFirstBillPayment({
                branchId: req.branchId,
                customer: persistedCustomer,
                draft: reviewedDraft,
                actor: req.user || null
            });
            const referralRecord = await createPendingDraftReferral({
                branchId: req.branchId,
                submissionId,
                referredAccountNumber: persistedCustomer?.accountNumber || linkedCustomerAccountNumber,
                draft: reviewedDraft,
                actor: req.user || null
            });

            const finalizedDraft = {
                ...reviewedDraft,
                ...(sharedMobileApproval ? {
                    sharedMobileContact: true,
                    sharedMobileOverrideAudit: sharedMobileApproval
                } : {}),
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
                status: persistedCustomer?.status || reviewedDraft.status || 'active',
                firstBillPaymentStatus: firstBillPayment ? 'recorded' : 'not-paid',
                firstBillPaymentEntryId: firstBillPayment?.id || '',
                referralRecordId: referralRecord?.id || ''
            };

            const decisionReason = toSafeText(req.body?.reason, 2000) || null;
            const updatedSubmission = await updateCustomerDraftSubmissionRow(submissionId, req.branchId, {
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
            if (!updatedSubmission) {
                throw createError(409, 'Unable to approve customer draft. It may have been updated already.');
            }

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
            });
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
        const [plans, coverageAreas, customers] = await Promise.all([
            readPlans(req.branchId),
            readCoverageAreaNames(req.branchId),
            readCustomers(req.branchId)
        ]);
        let reviewedDraft = preserveInstallationCompletion(
            applyReferralDefaults(
                applyFirstBillDefaults(
                    applyMonthlyBillingDefaults(
                        applyPlanDefaults(
                            normalizeDraftPayload({ ...existingDraftData, ...incomingDraftData }),
                            plans
                        )
                    )
                ),
                customers
            ),
            existingDraftData
        );

        const linkedCustomerAccountNumber = toSafeText(
            existing.draft_account_number || existing.approved_customer_account_number,
            20
        );
        const sharedMobileApproval = resolveDraftSharedMobileApproval({
            draft: reviewedDraft,
            customers,
            accountNumber: linkedCustomerAccountNumber,
            override: req.body?.sharedMobileOverride,
            actor: req.user || null
        });
        reviewedDraft = applyDraftPortalCredentialDefaults(reviewedDraft, linkedCustomerAccountNumber);
        validateDraftPayload(reviewedDraft, { coverageAreas });
        const reviewedPonSelection = getDraftPonSelection(reviewedDraft);
        if (reviewedDraft.installationCompletion && !reviewedPonSelection) {
            throw createError(400, 'Select the NAP and port to finalize this installation.');
        }
        const preparedPonHold = await prepareDraftPonHoldForAdmin({
            branchId: req.branchId,
            accountNumber: linkedCustomerAccountNumber,
            draft: reviewedDraft,
            actor: req.user || null
        });
        const preparedPonSelection = preparedPonHold || reviewedPonSelection;
        let persistedCustomer = null;
        try {
            persistedCustomer = await updateCustomerRecord(linkedCustomerAccountNumber, reviewedDraft, {
                branchId: req.branchId,
                refreshSource: 'customer-drafts-finalize',
                allowPastBillingDates: true,
                trustedOnuSerialNumber: reviewedDraft.onuSerialNumber,
                allowDuplicateMobile: Boolean(sharedMobileApproval)
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
                allowPastBillingDates: true,
                trustedOnuSerialNumber: reviewedDraft.onuSerialNumber,
                allowDuplicateMobile: Boolean(sharedMobileApproval)
            });
        }

        const finalizedPonHold = await finalizeDraftPonSelectionForAdmin({
            branchId: req.branchId,
            accountNumber: toSafeText(persistedCustomer?.accountNumber, 20)
                || linkedCustomerAccountNumber,
            customerName: buildCustomerName(reviewedDraft),
            submissionId,
            selection: preparedPonSelection
        });
        reviewedDraft = applyFinalizedPonAssignment(reviewedDraft, finalizedPonHold);

        const firstBillPayment = await recordDraftFirstBillPayment({
            branchId: req.branchId,
            customer: persistedCustomer,
            draft: reviewedDraft,
            actor: req.user || null,
            executor: connection
        });
        const referralRecord = await createPendingDraftReferral({
            branchId: req.branchId,
            submissionId,
            referredAccountNumber: persistedCustomer?.accountNumber || linkedCustomerAccountNumber,
            draft: reviewedDraft,
            actor: req.user || null
        });

        const finalizedDraft = {
            ...reviewedDraft,
            ...(sharedMobileApproval ? {
                sharedMobileContact: true,
                sharedMobileOverrideAudit: sharedMobileApproval
            } : {}),
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
            status: persistedCustomer?.status || reviewedDraft.status || 'active',
            firstBillPaymentStatus: firstBillPayment ? 'recorded' : 'not-paid',
            firstBillPaymentEntryId: firstBillPayment?.id || '',
            referralRecordId: referralRecord?.id || ''
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
        if (
            error?.code === 'CUSTOMER_DRAFT_SHARED_MOBILE_CONFIRMATION_REQUIRED'
            || error?.duplicate?.kind === 'mobile'
        ) {
            const duplicateAccounts = Array.isArray(error?.duplicateAccounts) && error.duplicateAccounts.length
                ? error.duplicateAccounts
                : (error?.duplicate?.accountNumber ? [{
                    accountNumber: toSafeText(error.duplicate.accountNumber, 20),
                    customerName: ''
                }] : []);
            return res.status(409).json({
                ok: false,
                error: error.message,
                code: 'CUSTOMER_DRAFT_SHARED_MOBILE_CONFIRMATION_REQUIRED',
                duplicate: { kind: 'mobile' },
                duplicateAccounts
            });
        }
        next(error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

adminRouter.post('/:id/reject', async (req, res, next) => {
    let connection = null;
    try {
        await ensureCustomerDraftSubmissionsTable();
        const submissionId = toSafeText(req.params?.id, 64);
        if (!submissionId) {
            throw createError(400, 'Submission ID is required.');
        }
        const decisionReason = toSafeText(req.body?.reason, 2000) || null;

        if (!await isRelationalReady()) {
            return await withDraftSubmissionLock(req.branchId, async () => {
                const existing = await getCustomerDraftSubmission(submissionId, req.branchId);
                if (!existing) {
                    throw createError(404, 'Customer draft not found.');
                }
                if (existing.rawStatus !== 'pending') {
                    throw createError(409, `This draft is already ${existing.rawStatus || 'processed'}.`);
                }
                const draft = existing.draftData || {};
                const linkedCustomerAccountNumber = toSafeText(
                    existing.approvedCustomerAccountNumber || existing.draftAccountNumber,
                    20
                );
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
                const cleanupWarning = await cleanupRejectedOrDeletedDraftResources({
                    branchId: req.branchId,
                    linkedCustomerAccountNumber,
                    draftData: draft,
                    customerName: existing.customerName || buildCustomerName(draft),
                    refreshSource: 'customer-drafts-reject',
                    deleteCustomer: false
                });
                res.json({ ok: true, item, ...(cleanupWarning ? { cleanupWarning } : {}) });
            });
        }

        const pool = await getPool();
        if (!pool) throw createError(500, 'MySQL connection is not available.');
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
        if (!rows || !rows.length) throw createError(404, 'Customer draft not found.');
        const existing = rows[0];
        const currentStatus = String(existing.status || '').trim().toLowerCase();
        if (currentStatus !== 'pending') {
            throw createError(409, `This draft is already ${currentStatus || 'processed'}.`);
        }
        let draft = {};
        try {
            const parsed = JSON.parse(existing.draft_json || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) draft = parsed;
        } catch {
            draft = {};
        }
        const linkedCustomerAccountNumber = toSafeText(
            existing.approved_customer_account_number || existing.draft_account_number,
            20
        );
        const [result] = await connection.query(
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
                buildCustomerName(draft) || existing.customer_name || null,
                toSafeText(draft.mobile || draft.contactNumber, 50) || existing.contact_number || null,
                toSafeText(draft.planName, 120) || existing.plan_name || null,
                toSafeText(draft.area, 150) || existing.area_name || null,
                buildAddressText(draft) || existing.address_text || null,
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
        await connection.commit();
        connection.release();
        connection = null;
        const cleanupWarning = await cleanupRejectedOrDeletedDraftResources({
            branchId: req.branchId,
            linkedCustomerAccountNumber,
            draftData: draft,
            customerName: existing.customer_name || buildCustomerName(draft),
            refreshSource: 'customer-drafts-reject',
            deleteCustomer: false
        });
        const item = await getCustomerDraftSubmission(submissionId, req.branchId);
        res.json({ ok: true, item, ...(cleanupWarning ? { cleanupWarning } : {}) });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        next(error);
    } finally {
        if (connection) connection.release();
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
module.exports.normalizeDraftPayload = normalizeDraftPayload;
module.exports.findDraftSharedMobileConflicts = findDraftSharedMobileConflicts;
module.exports.resolveDraftSharedMobileApproval = resolveDraftSharedMobileApproval;
module.exports.applyFirstBillDefaults = applyFirstBillDefaults;
module.exports.computeFirstBillCollection = computeFirstBillCollection;
module.exports.applyReferralDefaults = applyReferralDefaults;
module.exports.computeFirstBillProration = computeFirstBillProration;
module.exports.preserveInstallationCompletion = preserveInstallationCompletion;
module.exports.findDraftDuplicateCandidates = findDraftDuplicateCandidates;
module.exports.selectRecoverableOwnedInProgressDraft = selectRecoverableOwnedInProgressDraft;
module.exports.buildDraftDuplicateConflict = buildDraftDuplicateConflict;
module.exports.withDraftSubmissionLock = withDraftSubmissionLock;
module.exports.draftSubmissionFingerprint = draftSubmissionFingerprint;
module.exports.listAllCustomerDraftSubmissions = listAllCustomerDraftSubmissions;
