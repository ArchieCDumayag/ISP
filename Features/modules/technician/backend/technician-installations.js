const express = require('express');
const createError = require('http-errors');
const { assertRelationalReady } = require('../../../../core/data/db-relational');
const { connectMikrotikClient } = require('../../network/backend/mikrotik-client');
const {
    requireTechnicianAuth
} = require('../../customer-management/backend/customer-draft-submissions');
const {
    readVisibleCustomers: readCustomers,
    readPlans,
    updateCustomerRecord,
    sanitizeCustomerForAdmin
} = require('../../customer-management/backend/customers');
const {
    loadIntegrationSettings,
    saveIntegrationSettings,
    resolveMikrotikRouter,
    normalizeMikrotikSettings,
    hasUsableMikrotikRouter
} = require('../../admin/backend/integration-settings');
const {
    hasPonTables,
    loadPonOverviewForBranch,
    loadPonStateForBranch,
    savePonStateForBranch
} = require('../../network/backend/pon-management-api');
const {
    dedupePppoeAccounts,
    normalizePppoeRouterId,
    normalizePppoeSecretId,
    normalizePppoeUsernameKey
} = require('../../network/backend/pppoe-account-utils');
const {
    findCustomerDraftSubmissionByAccountNumber,
    listCustomerDraftSubmissions,
    updateCustomerDraftSubmissionDraftDataByAccountNumber
} = require('../../customer-management/backend/customer-draft-submissions-store');
const {
    loadBranchActivePppoeLookup
} = require('../../network/backend/mikrotik');
const { readCoverage } = require('../../customer-management/backend/api_coverage');
const { resolvePlanProfileForRouter } = require('../../billing/backend/plan-profile-utils');

const router = express.Router();

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const toPositiveInt = (value, fallback = null) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const normalizeNameKey = (value) => toSafeText(value).toLowerCase();
const normalizePlanName = (value) => normalizeNameKey(value);
const resolveCustomerCoverageAreaName = (customer = {}) => toSafeText(
    customer?.area || customer?.coverageArea || customer?.areaName,
    150
);
const findCoverageAreaForCustomer = async (branchId, customer = {}) => {
    const areaNameKey = normalizeNameKey(resolveCustomerCoverageAreaName(customer));
    if (!areaNameKey) return null;
    const coverageAreas = await readCoverage(branchId).catch(() => []);
    return (Array.isArray(coverageAreas) ? coverageAreas : []).find((area) =>
        normalizeNameKey(area?.name || area?.areaName) === areaNameKey
    ) || null;
};
const resolveCoverageLinkedRouterId = async (branchId, customer = {}, fallbackRouterId = '') => {
    const fallback = toSafeText(fallbackRouterId, 120);
    const matchedArea = await findCoverageAreaForCustomer(branchId, customer);
    return toSafeText(matchedArea?.mikrotikId || matchedArea?.routerId, 120) || fallback;
};
const buildCoverageSetupAction = (customer = {}) => {
    const areaName = resolveCustomerCoverageAreaName(customer);
    if (areaName) {
        return `Set Coverage Table > MikroTik Link for area "${areaName}".`;
    }
    return 'Set the customer coverage area first, then link it in Coverage Table.';
};
const resolveRouterDisplayLabel = (router = null, fallback = 'selected router') => (
    toSafeText(router?.label || router?.name || router?.address || router?.host, 120) || fallback
);
const buildPlanSetupAction = (customer = {}, routerLabel = 'selected router', matchedPlan = null) => {
    const planLabel = toSafeText(
        matchedPlan?.label || matchedPlan?.name || customer?.planName,
        120
    );
    if (planLabel) {
        return `Set Plans > Router Profile for ${routerLabel} under plan "${planLabel}", then make sure that profile exists on ${routerLabel}.`;
    }
    return 'Set the customer plan first, or assign a PPPoE profile before generating.';
};
const findConfiguredRouterById = (settings = {}, routerId = '') => {
    const normalizedSettings = normalizeMikrotikSettings(settings);
    const requestedRouterId = toSafeText(routerId, 120);
    if (!requestedRouterId) {
        return { settings: normalizedSettings, router: null };
    }
    const router = (Array.isArray(normalizedSettings?.mikrotikRouters) ? normalizedSettings.mikrotikRouters : []).find((entry) =>
        toSafeText(entry?.id, 120) === requestedRouterId
    ) || null;
    return { settings: normalizedSettings, router };
};
const buildRouterConfigurationAction = (customer = {}, routerId = '') => {
    const requestedRouterId = toSafeText(routerId, 120);
    const areaName = resolveCustomerCoverageAreaName(customer);
    if (requestedRouterId && areaName) {
        return `Coverage Table router link "${requestedRouterId}" for area "${areaName}" is not configured under Control Center > Settings > MikroTik routers.`;
    }
    if (requestedRouterId) {
        return `MikroTik router "${requestedRouterId}" is not configured under Control Center > Settings > MikroTik routers.`;
    }
    return buildCoverageSetupAction(customer);
};
const isSetupValidationError = (error) => {
    const statusCode = Number(error?.statusCode || error?.status || 0);
    return Number.isFinite(statusCode) && statusCode > 0 && statusCode < 500;
};
const resolveConnectionAccountNumber = (entry = {}) => {
    const direct = toSafeText(
        entry?.customerId || entry?.customerAccountNumber || entry?.accountNumber,
        20
    );
    if (direct) return direct;
    const fallback = toSafeText(entry?.customerRef, 20);
    return /^\d{4,20}$/.test(fallback) ? fallback : '';
};

const normalizeBoolean = (value, fallback = false) => {
    if (value === true || value === false) return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
};

const normalizeSubscriberStatus = (value) => {
    const normalized = toSafeText(value, 30).toLowerCase();
    if (['online', 'up', 'active', 'connected'].includes(normalized)) return 'online';
    if (['offline', 'down', 'inactive', 'disconnected'].includes(normalized)) return 'offline';
    return '';
};

const normalizeMikrotikStatus = (value) => {
    const normalized = toSafeText(value, 30).toLowerCase();
    if (['online', 'up', 'active', 'connected'].includes(normalized)) return 'online';
    if (['offline', 'down', 'inactive', 'disabled', 'disconnected'].includes(normalized)) return 'offline';
    return '';
};

const resolveCustomerContactNumber = (customer = {}) => {
    const candidates = [customer?.mobileRaw, customer?.mobile];
    for (const candidate of candidates) {
        const value = toSafeText(candidate, 50);
        if (value) return value;
    }
    return '';
};

const buildCustomerAddressText = (customer = {}) => {
    const parts = [
        toSafeText(customer?.street, 150),
        toSafeText(customer?.barangay, 150),
        toSafeText(customer?.municipality, 150),
        toSafeText(customer?.province, 150)
    ].filter(Boolean);
    return parts.join(', ');
};

const isValidCoordinatePair = (lat, lng) => (
    Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
);

const formatDecimalCoordinate = (value) => (
    Number(value)
        .toFixed(15)
        .replace(/\.?0+$/, '')
);

const normalizeTechnicianCoordinateText = (value) => {
    const raw = toSafeText(value, 120);
    if (!raw) return '';

    const normalized = (() => {
        try {
            return decodeURIComponent(raw.replace(/\+/g, ' '));
        } catch {
            return raw;
        }
    })();

    const directPatterns = [
        /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
        /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
        /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
    ];

    for (const pattern of directPatterns) {
        const match = normalized.match(pattern);
        if (!match) continue;
        const latText = String(match[1] || '').trim();
        const lngText = String(match[2] || '').trim();
        const lat = Number(latText);
        const lng = Number(lngText);
        if (isValidCoordinatePair(lat, lng)) {
            return `${latText}, ${lngText}`;
        }
    }

    const normalizedDms = normalized
        .replace(/[\u00BA\u02DA]/g, '\u00B0')
        .replace(/[\u2032\u2019]/g, "'")
        .replace(/[\u2033\u201C\u201D]/g, '"')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const hasDmsMarkers = /[NSEW]/i.test(normalizedDms) && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
    if (!hasDmsMarkers) {
        return raw;
    }

    const parseDmsSegment = (segment) => {
        const text = String(segment || '').trim().toUpperCase();
        if (!text) return null;
        const hemisphereMatch = text.match(/[NSEW]/);
        const hemisphere = hemisphereMatch ? hemisphereMatch[0] : '';
        if (!hemisphere) return null;
        const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
        if (!numericParts.length) return null;

        const degrees = Number(numericParts[0]);
        const minutes = Number(numericParts[1] || 0);
        const seconds = Number(numericParts[2] || 0);
        if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
            return null;
        }
        if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
            return null;
        }

        let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
        if (String(numericParts[0] || '').trim().startsWith('-')) {
            decimal *= -1;
        }
        if (hemisphere === 'S' || hemisphere === 'W') {
            decimal = -Math.abs(decimal);
        } else {
            decimal = Math.abs(decimal);
        }

        return {
            value: decimal,
            hemisphere
        };
    };

    const dmsSegments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
    const parsedDmsSegments = dmsSegments.map(parseDmsSegment).filter(Boolean);
    const latEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S');
    const lngEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W');
    if (latEntry && lngEntry && isValidCoordinatePair(latEntry.value, lngEntry.value)) {
        return `${formatDecimalCoordinate(latEntry.value)}, ${formatDecimalCoordinate(lngEntry.value)}`;
    }

    return raw;
};

const buildNapInfoText = (assignment = null) => {
    if (!assignment || typeof assignment !== 'object') return '';
    const parts = [];
    const linkedOlt = toSafeText(assignment.linkedOlt, 120);
    const napCode = toSafeText(assignment.napCode, 120);
    if (linkedOlt) {
        parts.push(/^olt\b/i.test(linkedOlt) ? linkedOlt : `OLT ${linkedOlt}`);
    }
    if (napCode) parts.push(napCode);
    return parts.filter(Boolean).join(' | ');
};

const buildStoredPppoeStatusLookup = (settings = null) => {
    const accounts = dedupePppoeAccounts(
        Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
        settings?.mikrotikDefaultId || ''
    );
    const map = new Map();
    accounts.forEach((account) => {
        const username = normalizePppoeUsernameKey(account?.username);
        const status = normalizeMikrotikStatus(account?.status);
        if (username && status && !map.has(username)) {
            map.set(username, status);
        }
    });
    return map;
};

const buildStoredPppoeLookup = (settings = null) => {
    const accounts = dedupePppoeAccounts(
        Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
        settings?.mikrotikDefaultId || ''
    );
    const byAccount = new Map();
    const byUsername = new Map();
    accounts.forEach((account) => {
        const accountNumber = toSafeText(
            account?.customerAccount || account?.accountNumber || account?.customerId,
            20
        );
        if (accountNumber && !byAccount.has(accountNumber)) {
            byAccount.set(accountNumber, account);
        }
        const usernameKey = normalizePppoeUsernameKey(account?.username);
        if (usernameKey && !byUsername.has(usernameKey)) {
            byUsername.set(usernameKey, account);
        }
    });
    return { byAccount, byUsername };
};

const resolveStoredPppoeEntryForCustomer = (customer = {}, lookup = null) => {
    if (!lookup || typeof lookup !== 'object') return null;
    const accountNumber = toSafeText(customer?.accountNumber, 20);
    if (accountNumber && lookup.byAccount instanceof Map && lookup.byAccount.has(accountNumber)) {
        return lookup.byAccount.get(accountNumber) || null;
    }
    const usernameKey = normalizePppoeUsernameKey(customer?.pppoeUsername);
    if (usernameKey && lookup.byUsername instanceof Map && lookup.byUsername.has(usernameKey)) {
        return lookup.byUsername.get(usernameKey) || null;
    }
    return null;
};

const resolveCustomerMikrotikStatus = (customer = {}, liveLookup = null, storedLookup = null, storedEntry = null) => {
    const usernameKey = normalizePppoeUsernameKey(customer?.pppoeUsername || storedEntry?.username);
    if (!usernameKey) return '';
    if (liveLookup?.available) {
        return liveLookup.usernamesLower.has(usernameKey) ? 'online' : 'offline';
    }
    if (storedLookup instanceof Map && storedLookup.has(usernameKey)) {
        return storedLookup.get(usernameKey) || '';
    }
    const fallbackStatus = normalizeMikrotikStatus(storedEntry?.status);
    if (fallbackStatus) return fallbackStatus;
    return '';
};

const normalizeRouterCredentials = (routerConfig = {}) => {
    const port = routerConfig?.port ? Number(routerConfig.port) : undefined;
    return {
        address: toSafeText(routerConfig?.address || routerConfig?.host, 255),
        username: toSafeText(routerConfig?.username || routerConfig?.user, 255),
        password: routerConfig?.password != null ? String(routerConfig.password) : '',
        port: Number.isFinite(port) && port > 0 ? Math.trunc(port) : 8728
    };
};

const hasRouterCredentials = (routerConfig = {}) => {
    const creds = normalizeRouterCredentials(routerConfig);
    return Boolean(creds.address && creds.username && creds.password);
};

const buildCustomerDisplayName = (customer = {}) => {
    const explicitName = toSafeText(customer?.name, 200);
    if (explicitName) return explicitName;
    const firstName = toSafeText(customer?.firstName, 100);
    const lastName = toSafeText(customer?.lastName, 100);
    const combined = `${firstName} ${lastName}`.trim();
    if (combined) return combined;
    const accountNumber = toSafeText(customer?.accountNumber, 20);
    return accountNumber ? `Account ${accountNumber}` : 'Customer';
};

const buildDraftCustomerRecordFromSubmission = (submission = {}) => {
    if (!submission || typeof submission !== 'object') return null;
    const draft = submission?.draftData && typeof submission.draftData === 'object'
        ? submission.draftData
        : {};
    const accountNumber = toSafeText(
        submission?.draftAccountNumber || submission?.approvedCustomerAccountNumber || draft?.accountNumber,
        20
    );
    if (!accountNumber) return null;

    const contactNumber = toSafeText(
        draft?.mobile || draft?.contactNumber || draft?.contact || submission?.contactNumber,
        50
    );
    return {
        accountNumber,
        name: toSafeText(draft?.name || submission?.customerName, 200),
        firstName: toSafeText(draft?.firstName, 100),
        lastName: toSafeText(draft?.lastName, 100),
        area: toSafeText(draft?.area || submission?.areaName, 150),
        status: toSafeText(draft?.status, 50) || 'pending',
        planName: toSafeText(draft?.planName || submission?.planName, 120),
        mobileRaw: contactNumber,
        mobile: contactNumber,
        street: toSafeText(draft?.street, 150),
        barangay: toSafeText(draft?.barangay, 150),
        municipality: toSafeText(draft?.municipality, 150),
        province: toSafeText(draft?.province, 150),
        mapPin: toSafeText(draft?.mapPin, 120),
        loginUsername: toSafeText(draft?.loginUsername, 120),
        loginPassword: toSafeText(draft?.loginPassword, 120),
        pppoeUsername: toSafeText(draft?.pppoeUsername, 120),
        pppoePassword: toSafeText(draft?.pppoePassword, 120),
        pppoeProfile: toSafeText(draft?.pppoeProfile, 120),
        draftId: toSafeText(submission?.id, 64),
        draftStatus: toSafeText(submission?.status, 20) || 'pending',
        isDraft: true
    };
};

const loadPendingDraftCustomersForTechnician = async (branchId, technicianId, { limit = 200 } = {}) => {
    const result = await listCustomerDraftSubmissions({
        branchId,
        status: 'pending',
        submittedByUserId: technicianId,
        limit,
        offset: 0
    });
    return (Array.isArray(result?.items) ? result.items : [])
        .map((item) => buildDraftCustomerRecordFromSubmission(item))
        .filter((item) => item?.accountNumber);
};

const getCustomerNameParts = (customer = {}) => {
    const rawFirst = toSafeText(customer?.firstName, 100);
    const rawLast = toSafeText(customer?.lastName, 100);
    const rawName = toSafeText(customer?.name, 200);
    if (rawFirst || rawLast) {
        return {
            firstName: rawFirst,
            lastName: rawLast,
            fullName: rawName || `${rawFirst} ${rawLast}`.trim()
        };
    }
    if (!rawName) {
        return { firstName: '', lastName: '', fullName: '' };
    }
    const parts = rawName.split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || '';
    const lastName = parts.join(' ');
    return { firstName, lastName, fullName: rawName };
};

const toSlugToken = (value) => {
    const ascii = String(value || '')
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]/g, '');
    return ascii
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toUpperCase();
};

const toPasswordChunk = (value) => {
    const token = toSlugToken(value).replace(/-/g, '');
    if (!token) return '';
    return token.slice(0, 2);
};

const parseNapCodeParts = (rawCode) => {
    const normalizedCode = toSlugToken(rawCode);
    if (!normalizedCode) return { napCode: '', napNumber: '' };
    const compactMatch = normalizedCode.match(/(?:^|.*-)([A-Z0-9]+)-NAP-([A-Z0-9]+)$/);
    if (compactMatch) {
        const napNoRaw = compactMatch[2];
        const napNo = /^\d+$/.test(napNoRaw) ? napNoRaw.padStart(2, '0') : napNoRaw;
        return { napCode: compactMatch[1], napNumber: `NAP-${napNo}` };
    }
    const parts = normalizedCode.split('-').filter(Boolean);
    const napIndex = parts.lastIndexOf('NAP');
    if (napIndex > 0 && napIndex < parts.length - 1) {
        const napCode = parts[napIndex - 1] || '';
        const rawNo = parts[napIndex + 1] || '';
        if (!napCode || !rawNo) return { napCode: '', napNumber: '' };
        const napNo = /^\d+$/.test(rawNo) ? rawNo.padStart(2, '0') : rawNo;
        return { napCode, napNumber: `NAP-${napNo}` };
    }
    return { napCode: '', napNumber: '' };
};

const getNapSplitPortCount = (splitter, fallback = 0) => {
    const raw = toSafeText(splitter).replace('/', ':');
    const parts = raw.split(':');
    const parsed = Number(parts[1]);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    const fallbackValue = Number(fallback);
    if (Number.isInteger(fallbackValue) && fallbackValue > 0) return fallbackValue;
    return 16;
};

const normalizeCustomerSummary = (customer = {}, napAssignment = null, options = {}) => {
    const assignment = napAssignment && typeof napAssignment === 'object' ? {
        ...napAssignment,
        opticalInfo: toSafeText(napAssignment?.opticalInfo, 120),
        opticalPower: toSafeText(napAssignment?.opticalPower || napAssignment?.opticalInfo, 120),
        subscriberStatus: normalizeSubscriberStatus(napAssignment?.subscriberStatus)
    } : null;
    const address = buildCustomerAddressText(customer);
    const rawMapPin = toSafeText(customer?.mapPin, 120);
    const coordinates = normalizeTechnicianCoordinateText(rawMapPin);
    const contactNumber = resolveCustomerContactNumber(customer);
    const storedPppoeEntry = resolveStoredPppoeEntryForCustomer(customer, options.storedPppoeLookup || null);
    const effectivePppoeUsername = toSafeText(customer?.pppoeUsername || storedPppoeEntry?.username, 120);
    const effectivePppoePassword = toSafeText(customer?.pppoePassword || storedPppoeEntry?.password, 120);
    const effectivePppoeProfile = toSafeText(customer?.pppoeProfile || storedPppoeEntry?.profile, 120);
    const mikrotikStatus = resolveCustomerMikrotikStatus(
        { ...customer, pppoeUsername: effectivePppoeUsername },
        options.liveMikrotikLookup || null,
        options.storedPppoeStatusLookup || null,
        storedPppoeEntry
    );

    return {
        accountNumber: toSafeText(customer?.accountNumber, 20),
        name: buildCustomerDisplayName(customer),
        firstName: toSafeText(customer?.firstName, 100),
        lastName: toSafeText(customer?.lastName, 100),
        isDraft: Boolean(customer?.isDraft),
        draftId: toSafeText(customer?.draftId, 64),
        draftStatus: toSafeText(customer?.draftStatus, 20),
        area: toSafeText(customer?.area, 150),
        status: toSafeText(customer?.status, 50) || 'unknown',
        planName: toSafeText(customer?.planName, 120),
        plan: toSafeText(customer?.planName, 120),
        contactNumber,
        address,
        coordinates,
        mapPin: rawMapPin,
        pppoeUsername: effectivePppoeUsername,
        pppoeAccount: effectivePppoeUsername,
        pppoePassword: effectivePppoePassword,
        pppoeProfile: effectivePppoeProfile,
        opticalInfo: toSafeText(assignment?.opticalInfo || assignment?.opticalPower, 120),
        opticalPower: toSafeText(assignment?.opticalPower, 120),
        subscriberStatus: normalizeSubscriberStatus(assignment?.subscriberStatus),
        napPort: assignment?.port ?? null,
        napInfo: buildNapInfoText(assignment),
        mikrotikStatus,
        mikrotikStatusAvailable: Boolean(options.liveMikrotikLookup?.available || (options.storedPppoeStatusLookup instanceof Map && options.storedPppoeStatusLookup.size)),
        napAssignment: assignment
    };
};

const hasNapAssignment = (customer = {}) => Boolean(customer?.napAssignment);

const hasGeneratedPppoe = (customer = {}) => Boolean(
    toSafeText(customer?.pppoeUsername || customer?.pppoeAccount, 120)
);

const matchesAssignedFilter = (customer = {}, filter = 'all') => {
    const normalized = toSafeText(filter, 20).toLowerCase() || 'all';
    if (normalized === 'true' || normalized === 'assigned' || normalized === 'with' || normalized === 'has') {
        return hasNapAssignment(customer);
    }
    if (normalized === 'false' || normalized === 'unassigned' || normalized === 'without' || normalized === 'missing') {
        return !hasNapAssignment(customer);
    }
    return true;
};

const matchesPppoeFilter = (customer = {}, filter = 'all') => {
    const normalized = toSafeText(filter, 20).toLowerCase() || 'all';
    if (normalized === 'true' || normalized === 'generated' || normalized === 'with' || normalized === 'has') {
        return hasGeneratedPppoe(customer);
    }
    if (normalized === 'false' || normalized === 'missing' || normalized === 'without' || normalized === 'none') {
        return !hasGeneratedPppoe(customer);
    }
    return true;
};

const normalizeConnectionRecord = (entry = {}) => {
    const customerId = toSafeText(entry?.customerId || entry?.accountNumber || entry?.id, 20);
    const customerName = toSafeText(entry?.customerName || entry?.name, 200);
    const customerRef = toSafeText(entry?.customerRef || customerId || customerName, 255);
    const port = toPositiveInt(entry?.port);
    if (!customerRef || !port) return null;
    return {
        customerId,
        customerName,
        customerRef,
        port,
        opticalInfo: toSafeText(entry?.opticalInfo || entry?.optical || entry?.signal || entry?.rxPower, 120),
        opticalPower: toSafeText(entry?.opticalPower || entry?.opticalInfo || entry?.optical || entry?.signal || entry?.rxPower, 120),
        subscriberStatus: normalizeSubscriberStatus(entry?.subscriberStatus)
    };
};

const serializePonState = (state = {}) => ({
    olts: (Array.isArray(state?.olts) ? state.olts : []).map((item) => ({
        id: toSafeText(item?.id, 120),
        name: toSafeText(item?.name, 120),
        technology: toSafeText(item?.technology, 30),
        site: toSafeText(item?.site, 120),
        status: toSafeText(item?.status, 30),
        ponPorts: toPositiveInt(item?.ponPorts, 0) || 0
    })),
    naps: (Array.isArray(state?.naps) ? state.naps : []).map((item) => ({
        id: toSafeText(item?.id, 120),
        code: toSafeText(item?.code, 120),
        location: toSafeText(item?.location, 150),
        coordinate: toSafeText(item?.coordinate, 120),
        splitter: toSafeText(item?.splitter, 20),
        linkedOlt: toSafeText(item?.linkedOlt, 120),
        ponRef: toSafeText(item?.ponRef, 60),
        ponCapacity: toPositiveInt(item?.ponCapacity, 64) || 64,
        capacity: toPositiveInt(item?.capacity, getNapSplitPortCount(item?.splitter, 16)) || getNapSplitPortCount(item?.splitter, 16),
        used: toPositiveInt(item?.used, 0) || 0,
        opticalPower: toSafeText(item?.opticalPower, 120),
        connections: (Array.isArray(item?.connections) ? item.connections : [])
            .map((entry) => normalizeConnectionRecord(entry))
            .filter(Boolean)
    }))
});

const collectNapAssignments = (naps = []) => {
    const byAccount = new Map();
    (Array.isArray(naps) ? naps : []).forEach((nap) => {
        const napId = toSafeText(nap?.id, 120);
        const napCode = toSafeText(nap?.code, 120);
        const linkedOlt = toSafeText(nap?.linkedOlt, 120);
        const ponRef = toSafeText(nap?.ponRef, 60);
        const location = toSafeText(nap?.location, 150);
        const connections = Array.isArray(nap?.connections) ? nap.connections : [];
        connections.forEach((entry) => {
            const accountNumber = resolveConnectionAccountNumber(entry);
            const port = toPositiveInt(entry?.port);
            if (!accountNumber || !port) return;
            byAccount.set(accountNumber, {
                napId,
                napCode,
                linkedOlt,
                ponRef,
                location,
                port,
                opticalInfo: toSafeText(entry?.opticalInfo, 120),
                opticalPower: toSafeText(entry?.opticalPower || entry?.opticalInfo, 120),
                subscriberStatus: normalizeSubscriberStatus(entry?.subscriberStatus)
            });
        });
    });
    return byAccount;
};

const loadPonContext = async (branchId, { allowMissingSchema = false } = {}) => {
    await assertRelationalReady();
    const schemaReady = await hasPonTables();
    if (!schemaReady) {
        if (allowMissingSchema) {
            return {
                schemaReady: false,
                message: 'PON schema is not initialized. Run Schema Update from owner page.',
                state: {
                    olts: [],
                    naps: [],
                    subscriberStatusAvailable: false,
                    activePppoeUsernames: []
                }
            };
        }
        throw createError(503, 'PON schema is not initialized. Run Schema Update from owner page.');
    }
    const state = await loadPonStateForBranch(branchId);
    return { schemaReady: true, state };
};

const buildGeneratedCredentials = (customer, napAssignment = null) => {
    if (!customer) {
        return { username: '', password: '', napAssignment: null };
    }
    const accountNumber = toSafeText(customer?.accountNumber, 20);
    const nameParts = getCustomerNameParts(customer);
    const firstToken = toSlugToken(nameParts.firstName || nameParts.fullName || 'CUSTOMER') || 'CUSTOMER';
    const lastToken = toSlugToken(nameParts.lastName || '');
    const usernameNameParts = [firstToken, lastToken].filter(Boolean);
    const parsedNap = parseNapCodeParts(napAssignment?.napCode || '');
    const usernameParts = [
        parsedNap.napCode,
        parsedNap.napNumber,
        ...usernameNameParts
    ].filter(Boolean);
    const fallbackUsernameParts = usernameNameParts.length ? usernameNameParts : ['CUSTOMER'];
    const username = (usernameParts.length ? usernameParts : fallbackUsernameParts).join('-');

    const firstChunk = toPasswordChunk(nameParts.firstName || nameParts.fullName || 'CU');
    const lastChunk = toPasswordChunk(nameParts.lastName || '');
    const prefix = `${firstChunk}${lastChunk}` || firstChunk || 'PW';
    const safeAccount = accountNumber || '00000000';
    const password = `${prefix}-${safeAccount}`.toUpperCase();

    return { username, password, napAssignment };
};

const buildPppoeLoginFallbackPatch = (customer = {}, username = '', password = '') => {
    const patch = {};
    if (customer?.isDraft) {
        const accountNumber = toSafeText(customer?.accountNumber, 20);
        const nameParts = getCustomerNameParts(customer);
        const fullName = toSafeText(nameParts.fullName, 200);
        if ((fullName || accountNumber) && !toSafeText(customer?.loginUsername, 120)) {
            patch.loginUsername = fullName || accountNumber;
        }
        if (accountNumber && !toSafeText(customer?.loginPassword, 255)) {
            patch.loginPassword = accountNumber;
        }
        return patch;
    }
    if (username && !toSafeText(customer?.loginUsername, 120)) {
        patch.loginUsername = username;
    }
    if (password && !toSafeText(customer?.loginPassword, 255)) {
        patch.loginPassword = password;
    }
    return patch;
};

const connectMikrotik = async (routerConfig = {}) => {
    const creds = normalizeRouterCredentials(routerConfig);
    if (!creds.address || !creds.username || !creds.password) {
        throw createError(400, 'MikroTik router credentials are incomplete.');
    }
    const { client, api } = await connectMikrotikClient(creds, {
        keepalive: false,
        timeout: 8000
    });
    return { client, api, creds };
};

router.use(requireTechnicianAuth);

router.get('/pon/overview', async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        await assertRelationalReady();
        const ponTablesReady = await hasPonTables();
        if (!ponTablesReady) {
            const customers = await readCustomers(branchId);
            return res.json({
                ok: true,
                schemaReady: false,
                message: 'PON schema is not initialized. Run Schema Update from owner page.',
                olts: [],
                naps: [],
                ports: [],
                subscriberStatusAvailable: false,
                activePppoeUsernames: [],
                customers: (Array.isArray(customers) ? customers : []).map((customer) => normalizeCustomerSummary(customer, null)),
                coverageAreas: []
            });
        }

        const overview = await loadPonOverviewForBranch(branchId);
        const assignmentMap = collectNapAssignments(overview?.naps);
        const customers = (Array.isArray(overview?.customers) ? overview.customers : [])
            .map((customer) => {
                const accountNumber = toSafeText(customer?.accountNumber, 20);
                return normalizeCustomerSummary(customer, assignmentMap.get(accountNumber) || null);
            })
            .filter((customer) => customer.accountNumber);

        return res.json({
            ok: true,
            schemaReady: true,
            olts: Array.isArray(overview?.olts) ? overview.olts : [],
            naps: Array.isArray(overview?.naps) ? overview.naps : [],
            ports: Array.isArray(overview?.ports) ? overview.ports : [],
            subscriberStatusAvailable: Boolean(overview?.subscriberStatusAvailable),
            activePppoeUsernames: Array.isArray(overview?.activePppoeUsernames) ? overview.activePppoeUsernames : [],
            customers,
            coverageAreas: Array.isArray(overview?.coverageAreas) ? overview.coverageAreas : []
        });
    } catch (error) {
        return next(error);
    }
});

router.get('/pon/state', async (req, res, next) => {
    try {
        const result = await loadPonContext(req.technician.branchId, { allowMissingSchema: true });
        return res.json({
            ok: true,
            schemaReady: result.schemaReady,
            message: result.message || '',
            ...result.state
        });
    } catch (error) {
        return next(error);
    }
});

const sendTechnicianCustomers = async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        const endpointFilters = req.technicianCustomerFilters || {};
        const targetAccount = toSafeText(
            req.query?.accountNumber || req.query?.account || req.query?.customerAccountNumber,
            20
        );
        const assignedFilter = toSafeText(endpointFilters.assigned ?? req.query?.assigned, 20).toLowerCase() || 'all';
        const pppoeFilter = toSafeText(endpointFilters.pppoe ?? req.query?.pppoe, 20).toLowerCase() || 'all';
        const [customers, draftCustomers, integrationSettings, liveMikrotikLookup] = await Promise.all([
            readCustomers(branchId),
            loadPendingDraftCustomersForTechnician(branchId, req.technician?.id || '').catch(() => []),
            loadIntegrationSettings(branchId).catch(() => null),
            loadBranchActivePppoeLookup(branchId).catch(() => ({
                available: false,
                usernames: new Set(),
                usernamesLower: new Set(),
                routerIds: [],
                reason: 'unavailable'
            }))
        ]);
        const storedPppoeStatusLookup = buildStoredPppoeStatusLookup(integrationSettings);
        const storedPppoeLookup = buildStoredPppoeLookup(integrationSettings);
        const mikrotikEnabled = hasUsableMikrotikRouter(integrationSettings);

        let assignmentMap = new Map();
        const ponReady = await hasPonTables().catch(() => false);
        if (ponReady) {
            const state = await loadPonStateForBranch(branchId);
            assignmentMap = collectNapAssignments(state.naps);
        }

        const realRows = customers
            .map((customer) => {
                const accountNumber = toSafeText(customer?.accountNumber, 20);
                return normalizeCustomerSummary(customer, assignmentMap.get(accountNumber) || null, {
                    liveMikrotikLookup,
                    storedPppoeStatusLookup,
                    storedPppoeLookup
                });
            })
            .filter((customer) => customer.accountNumber);

        const draftRows = draftCustomers
            .map((customer) => {
                const accountNumber = toSafeText(customer?.accountNumber, 20);
                return normalizeCustomerSummary(customer, assignmentMap.get(accountNumber) || null, {
                    liveMikrotikLookup,
                    storedPppoeStatusLookup,
                    storedPppoeLookup
                });
            })
            .filter((customer) => customer.accountNumber);

        const combinedByAccount = new Map();
        realRows.forEach((customer) => {
            combinedByAccount.set(customer.accountNumber, customer);
        });
        draftRows.forEach((customer) => {
            if (!combinedByAccount.has(customer.accountNumber)) {
                combinedByAccount.set(customer.accountNumber, customer);
            }
        });

        const rows = [...combinedByAccount.values()]
            .filter((customer) => !targetAccount || customer.accountNumber === targetAccount)
            .filter((customer) => matchesAssignedFilter(customer, assignedFilter))
            .filter((customer) => matchesPppoeFilter(customer, pppoeFilter))
            .sort((left, right) => {
                const nameCompare = left.name.localeCompare(right.name);
                if (nameCompare !== 0) return nameCompare;
                return left.accountNumber.localeCompare(right.accountNumber);
            });

        return res.json({ ok: true, mikrotikEnabled, customers: rows });
    } catch (error) {
        return next(error);
    }
};

router.get('/customers', sendTechnicianCustomers);
router.get('/customers/flat', sendTechnicianCustomers);
router.get('/customers/without-nap', (req, res, next) => {
    req.technicianCustomerFilters = { ...(req.technicianCustomerFilters || {}), assigned: 'missing' };
    return sendTechnicianCustomers(req, res, next);
});
router.get('/customers/without-pppoe', (req, res, next) => {
    req.technicianCustomerFilters = { ...(req.technicianCustomerFilters || {}), pppoe: 'missing' };
    return sendTechnicianCustomers(req, res, next);
});

router.post('/pon/assign', async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        const customerAccountNumber = toSafeText(
            req.body?.customerAccountNumber || req.body?.accountNumber || req.body?.customerId,
            20
        );
        const napId = toSafeText(req.body?.napId || req.body?.id, 120);
        const napCode = toSafeText(req.body?.napCode || req.body?.code, 120);
        const port = toPositiveInt(req.body?.port || req.body?.portNo || req.body?.customerPort);
        const opticalInfo = toSafeText(req.body?.opticalInfo || req.body?.signal || req.body?.rxPower, 120);
        const replaceExistingPort = normalizeBoolean(req.body?.replaceExistingPort, false);
        const moveExistingCustomer = normalizeBoolean(req.body?.moveExistingCustomer, false);

        if (!customerAccountNumber) {
            throw createError(400, 'Customer account number is required.');
        }
        if (!napId && !napCode) {
            throw createError(400, 'NAP ID or NAP code is required.');
        }
        if (!port) {
            throw createError(400, 'Target port is required.');
        }

        const customers = await readCustomers(branchId);
        let customer = customers.find((item) => toSafeText(item?.accountNumber, 20) === customerAccountNumber);
        if (!customer) {
            const draftSubmission = await findCustomerDraftSubmissionByAccountNumber(
                customerAccountNumber,
                branchId,
                { statuses: ['pending'] }
            );
            customer = buildDraftCustomerRecordFromSubmission(draftSubmission);
        }
        if (!customer) {
            throw createError(404, 'Customer or pending draft not found.');
        }

        const { state } = await loadPonContext(branchId);
        const editableState = serializePonState(state);
        const napIndex = editableState.naps.findIndex((item) =>
            (napId && toSafeText(item?.id, 120) === napId) ||
            (napCode && normalizeNameKey(item?.code) === normalizeNameKey(napCode))
        );
        if (napIndex < 0) {
            throw createError(404, 'NAP record not found.');
        }

        const targetNap = editableState.naps[napIndex];
        const targetCapacity = Math.max(
            toPositiveInt(targetNap.capacity, 0) || 0,
            getNapSplitPortCount(targetNap.splitter, targetNap.capacity)
        );
        if (targetCapacity > 0 && port > targetCapacity) {
            throw createError(400, `Port ${port} is outside the NAP capacity.`);
        }

        const currentAssignments = collectNapAssignments(editableState.naps);
        const existingCustomerAssignment = currentAssignments.get(customerAccountNumber) || null;
        if (
            existingCustomerAssignment &&
            (existingCustomerAssignment.napId !== targetNap.id || existingCustomerAssignment.port !== port) &&
            !moveExistingCustomer
        ) {
            throw createError(
                409,
                `Customer is already assigned to ${existingCustomerAssignment.napCode || 'another NAP'} port ${existingCustomerAssignment.port}.`
            );
        }

        const existingPortConnection = (Array.isArray(targetNap.connections) ? targetNap.connections : []).find((entry) => entry.port === port) || null;
        if (
            existingPortConnection &&
            resolveConnectionAccountNumber(existingPortConnection) !== customerAccountNumber &&
            !replaceExistingPort
        ) {
            throw createError(
                409,
                `Port ${port} is already assigned to customer ${resolveConnectionAccountNumber(existingPortConnection) || existingPortConnection.customerRef || 'unknown'}.`
            );
        }

        editableState.naps = editableState.naps.map((nap) => {
            const existingConnections = Array.isArray(nap.connections) ? nap.connections : [];
            let nextConnections = existingConnections;

            if (moveExistingCustomer || nap.id === targetNap.id) {
                nextConnections = nextConnections.filter((entry) => resolveConnectionAccountNumber(entry) !== customerAccountNumber);
            }
            if (nap.id === targetNap.id) {
                nextConnections = nextConnections.filter((entry) => entry.port !== port);
                nextConnections.push({
                    customerId: customerAccountNumber,
                    customerName: buildCustomerDisplayName(customer),
                    customerRef: customerAccountNumber,
                    port,
                    opticalInfo: opticalInfo || toSafeText(existingPortConnection?.opticalInfo || nap.opticalPower, 120)
                });
                nextConnections.sort((left, right) => left.port - right.port);
            }

            return {
                ...nap,
                connections: nextConnections,
                used: nextConnections.length
            };
        });

        await savePonStateForBranch(branchId, editableState);

        const refreshedState = await loadPonStateForBranch(branchId);
        const refreshedAssignments = collectNapAssignments(refreshedState.naps);
        const assigned = refreshedAssignments.get(customerAccountNumber) || null;

        return res.json({
            ok: true,
            assignment: assigned,
            customer: normalizeCustomerSummary(customer, assigned),
            state: {
                olts: refreshedState.olts,
                naps: refreshedState.naps,
                subscriberStatusAvailable: Boolean(refreshedState.subscriberStatusAvailable),
                activePppoeUsernames: Array.isArray(refreshedState.activePppoeUsernames)
                    ? refreshedState.activePppoeUsernames
                    : []
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/pppoe/generate', async (req, res, next) => {
    let client = null;
    try {
        const branchId = req.technician.branchId;
        const customerAccountNumber = toSafeText(
            req.body?.customerAccountNumber || req.body?.customerAccount || req.body?.accountNumber || req.body?.customerId,
            20
        );
        if (!customerAccountNumber) {
            throw createError(400, 'Customer account number is required.');
        }

        const customers = await readCustomers(branchId);
        const pendingDraftCustomers = await loadPendingDraftCustomersForTechnician(branchId, req.technician?.id || '', {
            limit: 500
        }).catch(() => []);
        let customer = customers.find((item) => toSafeText(item?.accountNumber, 20) === customerAccountNumber);
        if (!customer) {
            const draftSubmission = await findCustomerDraftSubmissionByAccountNumber(
                customerAccountNumber,
                branchId,
                { statuses: ['pending'] }
            );
            customer = buildDraftCustomerRecordFromSubmission(draftSubmission);
        }
        if (!customer) {
            throw createError(404, 'Customer or pending draft not found.');
        }

        let napAssignment = null;
        const ponReady = await hasPonTables().catch(() => false);
        if (ponReady) {
            const state = await loadPonStateForBranch(branchId);
            const assignmentMap = collectNapAssignments(state.naps);
            napAssignment = assignmentMap.get(customerAccountNumber) || null;
        }

        const generated = buildGeneratedCredentials(customer, napAssignment);
        const username = toSafeText(req.body?.username, 120) || generated.username;
        const password = toSafeText(req.body?.password, 120) || generated.password;
        if (!username || !password) {
            throw createError(400, 'Unable to generate PPPoE username or password for this customer.');
        }

        const plans = await readPlans(branchId);
        const matchedPlan = (Array.isArray(plans) ? plans : []).find((plan) =>
            normalizePlanName(plan?.name || plan?.label || plan?.id) === normalizePlanName(customer?.planName)
        ) || null;
        const requestedProfile = toSafeText(req.body?.profile, 120);
        const requestedRouterInput = toSafeText(req.body?.routerId || req.body?.mikrotikId, 120);
        const customerRouterInput = toSafeText(customer?.mikrotikId || customer?.routerId, 120);
        const coverageLinkedRouterId = await resolveCoverageLinkedRouterId(branchId, customer, '');
        if (!coverageLinkedRouterId && !requestedRouterInput && !customerRouterInput) {
            throw createError(400, buildCoverageSetupAction(customer));
        }
        const requestedRouterId = coverageLinkedRouterId || requestedRouterInput || customerRouterInput;
        let fallbackProfile = requestedProfile
            || toSafeText(customer?.pppoeProfile, 120)
            || toSafeText(resolvePlanProfileForRouter(matchedPlan, requestedRouterId), 120);

        const usernameKey = normalizePppoeUsernameKey(username);
        const duplicateCustomer = [...customers, ...pendingDraftCustomers].find((item) =>
            toSafeText(item?.accountNumber, 20) !== customerAccountNumber &&
            normalizePppoeUsernameKey(item?.pppoeUsername) === usernameKey
        );
        if (duplicateCustomer) {
            throw createError(409, `PPPoE username ${username} is already assigned to another customer.`);
        }
        let fallbackRouterId = requestedRouterId;

        try {
            const loadedSettings = await loadIntegrationSettings(branchId);
            const { settings, router: configuredRouter } = findConfiguredRouterById(loadedSettings, requestedRouterId);
            if (!settings?.mikrotik?.enabled) {
                throw createError(400, 'MikroTik integration is disabled for this branch.');
            }
            if (requestedRouterId && !configuredRouter) {
                throw createError(400, buildRouterConfigurationAction(customer, requestedRouterId));
            }

            const resolvedRouter = resolveMikrotikRouter(settings, requestedRouterId);
            if (!resolvedRouter || !hasRouterCredentials(resolvedRouter)) {
                throw createError(400, 'No usable MikroTik router is configured for this branch.');
            }
            const routerLabel = resolveRouterDisplayLabel(resolvedRouter);

            const routerId = normalizePppoeRouterId(
                resolvedRouter.id || requestedRouterId,
                settings?.mikrotikDefaultId || ''
            );
            fallbackRouterId = routerId;

            const connection = await connectMikrotik(resolvedRouter);
            client = connection.client;
            const api = connection.api;
            const secretMenu = api.menu('/ppp secret');
            const secrets = await secretMenu.get().catch(() => []);
            const existingSecret = (Array.isArray(secrets) ? secrets : []).find((entry) =>
                normalizePppoeUsernameKey(entry?.name || entry?.user) === usernameKey
            ) || null;

            const currentCustomerUsernameKey = normalizePppoeUsernameKey(customer?.pppoeUsername);
            if (existingSecret && currentCustomerUsernameKey !== usernameKey) {
                throw createError(409, `MikroTik already has a PPPoE secret named ${username}.`);
            }

            const profileMenu = api.menu('/ppp profile');
            const routerProfilesRaw = await profileMenu.get().catch(() => []);
            const routerProfiles = Array.isArray(routerProfilesRaw) ? routerProfilesRaw : [];
            const findRouterProfile = (value) => {
                const normalizedValue = normalizePlanName(value);
                if (!normalizedValue) return null;
                return routerProfiles.find((entry) =>
                    normalizePlanName(entry?.name || entry?.profile || entry?.id) === normalizedValue
                ) || null;
            };

            const requestedRouterProfile = findRouterProfile(requestedProfile);
            if (requestedProfile && !requestedRouterProfile) {
                throw createError(400, `PPPoE profile ${requestedProfile} does not exist on ${routerLabel}.`);
            }

            const customerProfileName = toSafeText(customer?.pppoeProfile, 120);
            const customerRouterProfile = findRouterProfile(customerProfileName);
            const planProfileName = toSafeText(
                resolvePlanProfileForRouter(
                    matchedPlan,
                    routerId,
                    settings?.mikrotikDefaultId || ''
                ),
                120
            );
            fallbackProfile = fallbackProfile || planProfileName;
            const planRouterProfile = findRouterProfile(planProfileName);
            const existingSecretProfileName = toSafeText(existingSecret?.profile, 120);
            const existingSecretRouterProfile = findRouterProfile(existingSecretProfileName);

            const matchedRouterProfile =
                requestedRouterProfile
                || customerRouterProfile
                || planRouterProfile
                || existingSecretRouterProfile
                || null;

            const profile = toSafeText(
                matchedRouterProfile?.name || matchedRouterProfile?.profile || matchedRouterProfile?.id,
                120
            ) || existingSecretProfileName;
            if (!profile) {
                throw createError(400, buildPlanSetupAction(customer, routerLabel, matchedPlan));
            }

            const updatePayload = {
                name: username,
                password,
                service: 'pppoe',
                disabled: 'false'
            };
            if (profile) {
                updatePayload.profile = profile;
            }

            if (existingSecret) {
                const secretId = normalizePppoeSecretId(existingSecret['.id'] || existingSecret.id);
                if (secretId) {
                    await secretMenu.where('.id', secretId).update(updatePayload);
                } else {
                    await secretMenu.where('name', existingSecret.name || username).update(updatePayload);
                }
            } else {
                await secretMenu.add(updatePayload);
            }

            const refreshedSecrets = await secretMenu.get().catch(() => []);
            const savedSecret = (Array.isArray(refreshedSecrets) ? refreshedSecrets : []).find((entry) =>
                normalizePppoeUsernameKey(entry?.name || entry?.user) === usernameKey
            ) || existingSecret;
            if (!savedSecret) {
                throw createError(502, `MikroTik did not confirm PPPoE secret ${username} on ${routerLabel} after save. Please retry.`);
            }

            const pairedCustomer = buildCustomerDisplayName(customer);
            const entry = {
                secretId: normalizePppoeSecretId(savedSecret?.['.id'] || savedSecret?.id),
                customerAccount: customerAccountNumber,
                username,
                password,
                profile,
                pairedCustomer,
                pairedPppoe: '',
                status: 'offline',
                routerId
            };

            const existingAccounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
            const nextSettings = {
                ...settings,
                pppoe: {
                    ...(settings?.pppoe || {}),
                    accounts: dedupePppoeAccounts([...existingAccounts, entry], settings?.mikrotikDefaultId || routerId)
                }
            };
            await saveIntegrationSettings(nextSettings, branchId);

            const loginFallbackPatch = buildPppoeLoginFallbackPatch(customer, username, password);
            const customerPppoePatch = {
                pppoeMode: 'manual',
                mikrotikId: routerId,
                pppoeUsername: username,
                pppoePassword: password,
                pppoeProfile: profile,
                ...loginFallbackPatch
            };

            if (customer?.isDraft) {
                const updatedDraft = await updateCustomerDraftSubmissionDraftDataByAccountNumber(
                    customerAccountNumber,
                    branchId,
                    customerPppoePatch,
                    { statuses: ['pending'] }
                );
                const persistedDraftCustomer = buildDraftCustomerRecordFromSubmission(updatedDraft) || {
                    ...customer,
                    ...customerPppoePatch
                };

                return res.status(existingSecret ? 200 : 201).json({
                    ok: true,
                    action: existingSecret ? 'updated' : 'created',
                    entry,
                    generated: {
                        username,
                        password,
                        profile,
                        routerId
                    },
                    napAssignment,
                    customer: normalizeCustomerSummary(persistedDraftCustomer, napAssignment)
                });
            }

            const persistedCustomer = await updateCustomerRecord(
                customerAccountNumber,
                customerPppoePatch,
                {
                    branchId,
                    refreshSource: 'technician-pppoe-generate'
                }
            );

            return res.status(existingSecret ? 200 : 201).json({
                ok: true,
                action: existingSecret ? 'updated' : 'created',
                entry,
                generated: {
                    username,
                    password,
                    profile,
                    routerId
                },
                napAssignment,
                customer: sanitizeCustomerForAdmin(persistedCustomer)
            });
        } catch (mikrotikError) {
            if (isSetupValidationError(mikrotikError)) {
                throw mikrotikError;
            }
            const fallbackCredentialPatch = {
                pppoeMode: 'manual',
                pppoeUsername: username,
                pppoePassword: password,
                pppoeProfile: fallbackProfile || toSafeText(customer?.pppoeProfile, 120),
                ...buildPppoeLoginFallbackPatch(customer, username, password)
            };
            const fallbackCustomer = {
                ...customer,
                ...fallbackCredentialPatch
            };

            if (customer?.isDraft) {
                const updatedDraft = await updateCustomerDraftSubmissionDraftDataByAccountNumber(
                    customerAccountNumber,
                    branchId,
                    fallbackCredentialPatch,
                    { statuses: ['pending'] }
                );
                const persistedDraftCustomer = buildDraftCustomerRecordFromSubmission(updatedDraft) || fallbackCustomer;

                return res.status(202).json({
                    ok: true,
                    manualRequired: true,
                    action: 'manual',
                    warning: mikrotikError?.message || 'Failed to save PPPoE to MikroTik. Configure it manually on the router.',
                    generated: {
                        username,
                        password,
                        profile: fallbackProfile,
                        routerId: fallbackRouterId
                    },
                    napAssignment,
                    customer: normalizeCustomerSummary(persistedDraftCustomer, napAssignment)
                });
            }

            const persistedCustomer = await updateCustomerRecord(
                customerAccountNumber,
                fallbackCredentialPatch,
                {
                    branchId,
                    refreshSource: 'technician-pppoe-generate-manual'
                }
            );

            return res.status(202).json({
                ok: true,
                manualRequired: true,
                action: 'manual',
                warning: mikrotikError?.message || 'Failed to save PPPoE to MikroTik. Configure it manually on the router.',
                generated: {
                    username,
                    password,
                    profile: fallbackProfile,
                    routerId: fallbackRouterId
                },
                napAssignment,
                customer: sanitizeCustomerForAdmin(persistedCustomer)
            });
        }
    } catch (error) {
        if (error && !error.status && !error.statusCode) {
            error.statusCode = 502;
        }
        return next(error);
    } finally {
        if (client) {
            await client.close().catch(() => {});
        }
    }
});

module.exports = router;
