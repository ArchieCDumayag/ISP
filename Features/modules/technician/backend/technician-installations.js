const crypto = require('crypto');
const express = require('express');
const createError = require('http-errors');
const { assertRelationalReady } = require('../../../../core/data/db-relational');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { connectMikrotikClient } = require('../../network/backend/mikrotik-client');
const jobsRouter = require('./jobs');
const {
    requireTechnicianAuth
} = require('../../customer-management/backend/customer-draft-submissions');
const {
    readVisibleCustomers: readCustomers,
    readPlans,
    updateCustomerRecord,
    sanitizeCustomerForAdmin,
    findCustomerOnuSerialDuplicate,
    normalizeOnuSerialNumber
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
    loadPonStateForBranch
} = require('../../network/backend/pon-management-api');
const {
    parseCoordinate,
    findNearbyPonNaps,
    reservePonPort,
    submitPonReservationForAdmin,
    releasePonPortReservation,
    finalizePonAssignment
} = require('../../network/backend/pon-serviceability');
const {
    dedupePppoeAccounts,
    normalizePppoeRouterId,
    normalizePppoeSecretId,
    normalizePppoeUsernameKey
} = require('../../network/backend/pppoe-account-utils');
const {
    findCustomerDraftSubmissionByAccountNumber,
    listCustomerDraftSubmissions,
    compareAndSetCustomerDraftInstallationCompletion,
    withCustomerDraftStoreMutationLock,
    updateCustomerDraftSubmissionDraftDataByAccountNumber
} = require('../../customer-management/backend/customer-draft-submissions-store');
const {
    loadBranchActivePppoeLookup
} = require('../../network/backend/mikrotik');
const { readCoverage } = require('../../customer-management/backend/api_coverage');
const { resolvePlanProfileForRouter } = require('../../billing/backend/plan-profile-utils');
const { serializePaymentMutationRequest } = require('../../billing/backend/payment-numbering');
const {
    getActiveClosedCustomerAccount
} = require('../../customer-management/backend/closed-customer-account-store');
const {
    readBranchDisconnections,
    getAccountDisconnection,
    requiresReconnectionSettlementBeforeActivation
} = require('../../billing/backend/disconnection-store');

const router = express.Router();
const TECHNICIAN_COVERAGE_RADIUS_METERS = 600;

const assertTechnicianPppoeAccountOpen = async (branchId, accountNumber) => {
    const activeClosure = await getActiveClosedCustomerAccount(branchId, accountNumber);
    if (activeClosure) {
        const error = createError(
            409,
            'This customer account is closed. Reopen it from Customer Archive before generating PPPoE service.'
        );
        error.code = 'TECHNICIAN_PPPOE_ACCOUNT_CLOSED';
        throw error;
    }
    const decisions = await readBranchDisconnections(branchId);
    const decision = getAccountDisconnection(decisions, accountNumber);
    if (requiresReconnectionSettlementBeforeActivation(decision)) {
        const error = createError(
            409,
            'Complete the Final Closed Customer Balance reconnection settlement before generating PPPoE service.'
        );
        error.code = 'TECHNICIAN_PPPOE_RECONNECTION_SETTLEMENT_REQUIRED';
        throw error;
    }
};

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

const normalizeInstallationMaterials = (value) => {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw createError(400, 'Installation materials must be an array.');
    }
    if (value.length > 100) {
        throw createError(400, 'Installation materials cannot exceed 100 entries.');
    }
    return value.map((entry, index) => {
        const source = entry && typeof entry === 'object' && !Array.isArray(entry)
            ? entry
            : { name: entry };
        const sku = toSafeText(source.sku || source.itemId, 80).toUpperCase();
        const name = toSafeText(source.name || source.itemName || sku, 160);
        const quantity = Number(source.quantity == null ? 1 : source.quantity);
        if (!name) throw createError(400, `Installation material ${index + 1} requires a name or SKU.`);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
            throw createError(400, `Installation material ${index + 1} has an invalid quantity.`);
        }
        const serialNumbers = Array.isArray(source.serialNumbers)
            ? source.serialNumbers.map((item) => toSafeText(item, 120)).filter(Boolean)
            : [];
        if (serialNumbers.length > 100) {
            throw createError(400, `Installation material ${index + 1} has too many serial numbers.`);
        }
        return {
            sku,
            name,
            quantity: Math.round(quantity * 1000) / 1000,
            unit: toSafeText(source.unit || 'pcs', 30),
            serialNumbers: [...new Set(serialNumbers)]
        };
    });
};

const ONU_BRANDS = new Set([
    'Huawei', 'ZTE', 'FiberHome', 'YOTC', 'ZXIC', 'CIOT',
    'RTEG', 'XPON', 'SKYWORTH'
]);

const normalizeInstallationQuantity = (value, label, { minimum = 0 } = {}) => {
    const parsed = Number(value == null || value === '' ? 0 : value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > 10000) {
        throw createError(400, `${label} must be a whole number between ${minimum} and 10000.`);
    }
    return parsed;
};

const normalizeInstallationMaterialUsage = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw createError(400, 'installationMaterials must be an object.');
    }
    const indoorOpticalOutletInstalled = normalizeBoolean(
        value.indoorOpticalOutletInstalled,
        false
    );
    const patchCordInstalled = normalizeBoolean(value.patchCordInstalled, false);
    const rawPatchCordType = toSafeText(value.patchCordType, 30).toLowerCase();
    const patchCordType = rawPatchCordType.replace(/_/g, '-');
    if (patchCordInstalled && !['upc-to-apc', 'upc-to-upc'].includes(patchCordType)) {
        throw createError(400, 'Patch cord type must be UPC to APC or UPC to UPC.');
    }
    return {
        indoorOpticalOutletInstalled,
        patchCordInstalled,
        patchCordType: patchCordInstalled ? patchCordType : '',
        patchCordQuantity: normalizeInstallationQuantity(
            patchCordInstalled ? value.patchCordQuantity : 0,
            'Patch cord quantity',
            { minimum: patchCordInstalled ? 1 : 0 }
        ),
        scConnectorQuantity: normalizeInstallationQuantity(
            value.scConnectorQuantity,
            'SC connector quantity'
        ),
        cClipQuantity: normalizeInstallationQuantity(value.cClipQuantity, 'C-Clip quantity'),
        cableClipQuantity: normalizeInstallationQuantity(
            value.cableClipQuantity,
            'Cable clip quantity'
        ),
        cableTieQuantity: normalizeInstallationQuantity(
            value.cableTieQuantity,
            'Cable tie quantity'
        ),
        fClampQuantity: normalizeInstallationQuantity(value.fClampQuantity, 'F-Clamp quantity')
    };
};

const normalizeInstallationCompletion = (value) => {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw createError(400, 'installationCompletion must be an object.');
    }
    const clientEventId = toSafeText(value.clientEventId, 100);
    const onuSerialNumber = normalizeOnuSerialNumber(value.onuSerialNumber || value.onuSerial);
    const onuBrand = toSafeText(value.onuBrand, 40);
    const opticalSignal = toSafeText(value.opticalSignal || value.rxPower, 80);
    if (!clientEventId) throw createError(400, 'Installation completion clientEventId is required.');
    if (!onuSerialNumber) throw createError(400, 'ONU serial number is required for installation completion.');
    if (onuBrand && !ONU_BRANDS.has(onuBrand)) {
        throw createError(400, 'ONU brand is not supported.');
    }

    const rawCableMeterStart = value.cableMeterStart;
    const rawCableMeterEnd = value.cableMeterEnd;
    const hasCableMeterStart = rawCableMeterStart != null && String(rawCableMeterStart).trim() !== '';
    const hasCableMeterEnd = rawCableMeterEnd != null && String(rawCableMeterEnd).trim() !== '';
    let cableMeterStart = null;
    let cableMeterEnd = null;
    let cableLengthMeters = null;
    if (hasCableMeterStart || hasCableMeterEnd) {
        if (!hasCableMeterStart || !hasCableMeterEnd) {
            throw createError(400, 'Both drop-cable start and end meter readings are required.');
        }
        cableMeterStart = Number(rawCableMeterStart);
        cableMeterEnd = Number(rawCableMeterEnd);
        if (!Number.isFinite(cableMeterStart) || !Number.isFinite(cableMeterEnd)
            || cableMeterStart < 0 || cableMeterEnd < cableMeterStart
            || cableMeterEnd > 1000000) {
            throw createError(400, 'Drop-cable meter readings are invalid.');
        }
        cableMeterStart = Math.round(cableMeterStart * 1000) / 1000;
        cableMeterEnd = Math.round(cableMeterEnd * 1000) / 1000;
        cableLengthMeters = Math.round((cableMeterEnd - cableMeterStart) * 1000) / 1000;
    } else if (value.cableLengthMeters != null && String(value.cableLengthMeters).trim() !== '') {
        cableLengthMeters = Number(value.cableLengthMeters);
        if (!Number.isFinite(cableLengthMeters) || cableLengthMeters < 0 || cableLengthMeters > 100000) {
            throw createError(400, 'Drop cable length must be between 0 and 100000 meters.');
        }
        cableLengthMeters = Math.round(cableLengthMeters * 1000) / 1000;
    }

    const normalized = {
        clientEventId,
        onuSerialNumber,
        ...(toSafeText(value.macAddress, 80) ? { macAddress: toSafeText(value.macAddress, 80) } : {}),
        ...(onuBrand ? { onuBrand } : {}),
        ...(opticalSignal ? { opticalSignal } : {}),
        ...(hasCableMeterStart ? { cableMeterStart, cableMeterEnd, cableLengthMeters } : {}),
        ...(!hasCableMeterStart && cableLengthMeters != null ? { cableLengthMeters } : {}),
        ...(value.materials != null ? { materials: normalizeInstallationMaterials(value.materials) } : {}),
        ...(value.installationMaterials != null ? {
            installationMaterials: normalizeInstallationMaterialUsage(value.installationMaterials)
        } : {}),
        ...(toSafeText(value.notes || value.completionNotes, 2000)
            ? { notes: toSafeText(value.notes || value.completionNotes, 2000) }
            : {})
    };
    return normalized;
};

const installationCompletionFingerprint = (completion) => crypto
    .createHash('sha256')
    .update(JSON.stringify(completion || null))
    .digest('hex');

const toLegacyInstallationCompletionShape = (completion = {}, onuSerialNumber = '') => ({
    clientEventId: completion.clientEventId,
    onuSerialNumber: onuSerialNumber || completion.onuSerialNumber,
    macAddress: completion.macAddress || '',
    ...(completion.onuBrand ? { onuBrand: completion.onuBrand } : {}),
    opticalSignal: completion.opticalSignal || '',
    ...(completion.cableMeterStart != null ? {
        cableMeterStart: completion.cableMeterStart,
        cableMeterEnd: completion.cableMeterEnd
    } : {}),
    cableLengthMeters: completion.cableLengthMeters ?? null,
    materials: Array.isArray(completion.materials) ? completion.materials : [],
    ...(completion.installationMaterials != null
        ? { installationMaterials: completion.installationMaterials }
        : {}),
    notes: completion.notes || ''
});

const assertInstallationCompletionReplay = (existing, completion) => {
    if (!existing || typeof existing !== 'object') return false;
    const existingEventId = toSafeText(existing.clientEventId, 100);
    if (existingEventId !== completion.clientEventId) {
        throw createError(409, 'Installation completion was already submitted for this client.');
    }
    const expectedFingerprint = installationCompletionFingerprint(completion);
    const storedFingerprint = toSafeText(existing.fingerprint, 64);
    const legacySerialNumber = toSafeText(existing.onuSerialNumber || existing.onuSerial, 160);
    const compatibleFingerprints = new Set([expectedFingerprint]);
    compatibleFingerprints.add(installationCompletionFingerprint(
        toLegacyInstallationCompletionShape(completion)
    ));
    if (legacySerialNumber && legacySerialNumber !== completion.onuSerialNumber) {
        compatibleFingerprints.add(installationCompletionFingerprint({
            ...completion,
            onuSerialNumber: legacySerialNumber
        }));
        compatibleFingerprints.add(installationCompletionFingerprint(
            toLegacyInstallationCompletionShape(completion, legacySerialNumber)
        ));
    }
    if (
        storedFingerprint
        && !compatibleFingerprints.has(storedFingerprint)
    ) {
        throw createError(409, 'Installation completion clientEventId was reused with different evidence.');
    }
    return true;
};

const promoteApprovedDraftOnuSerial = async ({
    completionUpdate,
    completion,
    branchId,
    fallbackAccountNumber = '',
    updateCustomer = updateCustomerRecord
} = {}) => {
    const item = completionUpdate?.item;
    const status = toSafeText(item?.rawStatus || item?.status, 20).toLowerCase();
    if (status !== 'approved') return null;
    const accountNumber = toSafeText(
        item?.approvedCustomerAccountNumber
            || item?.draftAccountNumber
            || fallbackAccountNumber,
        20
    );
    const onuSerialNumber = normalizeOnuSerialNumber(
        completion?.onuSerialNumber || completion?.onuSerial
    );
    if (!accountNumber || !onuSerialNumber) {
        throw createError(409, 'Approved installation completion could not be linked to its customer account.');
    }
    return updateCustomer(accountNumber, {}, {
        branchId,
        refreshSource: 'technician-installation-onu-reconcile',
        trustedOnuSerialNumber: onuSerialNumber
    });
};
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

const resolveJobCustomerAccountNumber = (job = {}) => toSafeText(
    job?.customerAccountNumber
        || job?.customer_account_number
        || job?.dispatchPayload?.customerAccountNumber
        || job?.dispatch_payload?.customerAccountNumber,
    20
);

const technicianOwnsPendingDraft = (submission = {}, technician = {}) => (
    ['in-progress', 'pending'].includes(
        toSafeText(submission?.status, 20).toLowerCase()
    )
    && toSafeText(submission?.submittedBy?.id, 64) === toSafeText(technician?.id, 64)
);

const technicianOwnsApprovedDraft = (submission = {}, technician = {}) => (
    toSafeText(submission?.status, 20).toLowerCase() === 'approved'
    && toSafeText(submission?.submittedBy?.id, 64) === toSafeText(technician?.id, 64)
);

const jobGrantsCustomerAccess = (job = {}, branchId, accountNumber = '') => {
    if (Number(job?.branchId) !== Number(branchId)) return false;
    return resolveJobCustomerAccountNumber(job) === toSafeText(accountNumber, 20);
};

const loadTechnicianOpenJobs = async (branchId, technician = {}) => {
    if (typeof jobsRouter.readJobsForTechnician !== 'function') {
        throw createError(500, 'Technician job lookup is unavailable.');
    }
    const jobs = await jobsRouter.readJobsForTechnician(branchId, technician, {
        includeClosed: false,
        includeUnassigned: false
    });
    return (Array.isArray(jobs) ? jobs : []).filter((job) => {
        if (Number(job?.branchId) !== Number(branchId)) return false;
        if (typeof jobsRouter.isOpenJobStatus !== 'function') return true;
        return jobsRouter.isOpenJobStatus(job?.workflowStatus || job?.status);
    });
};

const loadTechnicianAccessibleCustomers = async (branchId, technician = {}) => {
    const [customers, drafts, jobs] = await Promise.all([
        readCustomers(branchId),
        loadPendingDraftCustomersForTechnician(branchId, technician?.id || '', { limit: 500 }),
        loadTechnicianOpenJobs(branchId, technician)
    ]);
    const assignedAccounts = new Set(
        jobs.map(resolveJobCustomerAccountNumber).filter(Boolean)
    );
    const realCustomers = (Array.isArray(customers) ? customers : [])
        .filter((customer) => assignedAccounts.has(toSafeText(customer?.accountNumber, 20)));
    return {
        customers: realCustomers,
        drafts,
        jobs,
        assignedAccounts
    };
};

const resolveTechnicianAccessibleCustomer = async (
    branchId,
    technician = {},
    accountNumber = '',
    { allowApprovedDraftReplay = false } = {}
) => {
    const targetAccount = toSafeText(accountNumber, 20);
    if (!targetAccount) throw createError(400, 'Customer account number is required.');

    const ownDraft = await findCustomerDraftSubmissionByAccountNumber(
        targetAccount,
        branchId,
        { statuses: ['in-progress', 'pending'] }
    );
    if (ownDraft && technicianOwnsPendingDraft(ownDraft, technician)) {
        const customer = buildDraftCustomerRecordFromSubmission(ownDraft);
        if (customer) return { accessType: 'own-pending-draft', customer, draft: ownDraft, job: null };
    }

    if (allowApprovedDraftReplay) {
        const approvedDraft = await findCustomerDraftSubmissionByAccountNumber(
            targetAccount,
            branchId,
            { statuses: ['approved'] }
        );
        if (approvedDraft && technicianOwnsApprovedDraft(approvedDraft, technician)) {
            const customer = buildDraftCustomerRecordFromSubmission(approvedDraft);
            if (customer) {
                return {
                    accessType: 'own-approved-draft',
                    customer,
                    draft: approvedDraft,
                    job: null
                };
            }
        }
    }

    const jobs = await loadTechnicianOpenJobs(branchId, technician);
    const job = jobs.find((entry) => jobGrantsCustomerAccess(entry, branchId, targetAccount)) || null;
    if (!job) {
        throw createError(404, 'Customer is not available for this technician.');
    }
    const customers = await readCustomers(branchId);
    const customer = (Array.isArray(customers) ? customers : [])
        .find((entry) => toSafeText(entry?.accountNumber, 20) === targetAccount) || null;
    if (!customer) throw createError(404, 'Customer is not available for this technician.');
    return { accessType: 'assigned-open-job', customer, draft: null, job };
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

const sanitizeTechnicianPonConnection = (entry = {}, targetAccountNumber = '') => {
    const accountNumber = resolveConnectionAccountNumber(entry);
    const isTargetCustomer = Boolean(targetAccountNumber && accountNumber === targetAccountNumber);
    const port = toPositiveInt(entry?.port);
    return {
        port,
        occupied: Boolean(port),
        assignmentStatus: port ? 'used' : 'empty',
        ...(isTargetCustomer ? {
            customerId: accountNumber,
            customerRef: accountNumber,
            customerName: toSafeText(entry?.customerName, 200),
            opticalInfo: toSafeText(entry?.opticalInfo || entry?.opticalPower, 120),
            opticalPower: toSafeText(entry?.opticalPower || entry?.opticalInfo, 120),
            subscriberStatus: normalizeSubscriberStatus(entry?.subscriberStatus)
        } : {})
    };
};

const sanitizeTechnicianPonPort = (entry = {}, targetAccountNumber = '') => {
    const accountNumber = resolveConnectionAccountNumber(entry);
    const isTargetCustomer = Boolean(targetAccountNumber && accountNumber === targetAccountNumber);
    const occupied = Boolean(entry?.occupied || accountNumber || toSafeText(entry?.customerName, 200));
    return {
        port: toPositiveInt(entry?.port),
        portLabel: toSafeText(entry?.portLabel, 40),
        occupied,
        assignmentStatus: occupied ? 'used' : 'empty',
        status: occupied ? 'assigned' : 'empty',
        ...(isTargetCustomer ? {
            customerId: accountNumber,
            customerRef: accountNumber,
            customerName: toSafeText(entry?.customerName, 200),
            opticalInfo: toSafeText(entry?.opticalInfo || entry?.opticalPower, 120),
            opticalPower: toSafeText(entry?.opticalPower || entry?.opticalInfo, 120),
            subscriberStatus: normalizeSubscriberStatus(entry?.subscriberStatus),
            status: toSafeText(entry?.status, 30) || 'assigned'
        } : {})
    };
};

const sanitizeTechnicianPonNap = (nap = {}, targetAccountNumber = '') => ({
    id: toSafeText(nap?.id, 120),
    code: toSafeText(nap?.code, 120),
    location: toSafeText(nap?.location, 150),
    coordinate: toSafeText(nap?.coordinate, 120),
    splitter: toSafeText(nap?.splitter, 20),
    linkedOlt: toSafeText(nap?.linkedOlt, 120),
    ponRef: toSafeText(nap?.ponRef, 60),
    ponCapacity: toPositiveInt(nap?.ponCapacity, 0) || 0,
    capacity: toPositiveInt(nap?.capacity, 0) || 0,
    used: Math.max(0, Number(nap?.used) || 0),
    opticalPower: toSafeText(nap?.opticalPower, 120),
    customerCount: Math.max(0, Number(nap?.customerCount) || (Array.isArray(nap?.connections) ? nap.connections.length : 0)),
    connections: (Array.isArray(nap?.connections) ? nap.connections : [])
        .map((entry) => sanitizeTechnicianPonConnection(entry, targetAccountNumber))
        .filter((entry) => entry.port),
    ports: (Array.isArray(nap?.ports) ? nap.ports : [])
        .map((entry) => sanitizeTechnicianPonPort(entry, targetAccountNumber))
        .filter((entry) => entry.port)
});

const sanitizeTechnicianPonOverview = (overview = {}, targetAccountNumber = '') => ({
    olts: (Array.isArray(overview?.olts) ? overview.olts : []).map((olt) => ({
        id: toSafeText(olt?.id, 120),
        name: toSafeText(olt?.name, 120),
        technology: toSafeText(olt?.technology, 30),
        site: toSafeText(olt?.site, 120),
        status: toSafeText(olt?.status, 30),
        ponPorts: toPositiveInt(olt?.ponPorts, 0) || 0,
        ponCodePrefix: toSafeText(olt?.ponCodePrefix, 40),
        ponPortNames: olt?.ponPortNames && typeof olt.ponPortNames === 'object'
            ? { ...olt.ponPortNames }
            : {}
    })),
    naps: (Array.isArray(overview?.naps) ? overview.naps : [])
        .map((nap) => sanitizeTechnicianPonNap(nap, targetAccountNumber)),
    ports: (Array.isArray(overview?.ports) ? overview.ports : []).map((group) => ({
        key: toSafeText(group?.key, 255),
        oltId: toSafeText(group?.oltId, 120),
        linkedOlt: toSafeText(group?.linkedOlt, 120),
        ponRef: toSafeText(group?.ponRef, 60),
        ponPortName: toSafeText(group?.ponPortName, 80),
        ponPortNo: toPositiveInt(group?.ponPortNo),
        ponCapacity: toPositiveInt(group?.ponCapacity, 0) || 0,
        napCount: Math.max(0, Number(group?.napCount) || 0),
        totalCapacity: Math.max(0, Number(group?.totalCapacity) || 0),
        totalUsed: Math.max(0, Number(group?.totalUsed) || 0),
        totalCustomers: Math.max(0, Number(group?.totalCustomers) || 0),
        napIds: Array.isArray(group?.napIds) ? group.napIds.map((value) => toSafeText(value, 120)) : [],
        napCodes: Array.isArray(group?.napCodes) ? group.napCodes.map((value) => toSafeText(value, 120)) : [],
        naps: (Array.isArray(group?.naps) ? group.naps : [])
            .map((nap) => sanitizeTechnicianPonNap(nap, targetAccountNumber))
    }))
});

const sanitizeTechnicianNearbyCandidate = (candidate = {}, { includeClientLabels = false } = {}) => ({
    napId: toSafeText(candidate?.napId || candidate?.id, 120),
    napCode: toSafeText(candidate?.napCode || candidate?.code, 120),
    location: toSafeText(candidate?.location || candidate?.area, 150),
    latitude: Number(candidate?.latitude),
    longitude: Number(candidate?.longitude),
    distanceMeters: Math.max(0, Number(candidate?.distanceMeters) || 0),
    linkedOlt: toSafeText(candidate?.linkedOlt, 120),
    ponRef: toSafeText(candidate?.ponRef, 60),
    ponPortName: toSafeText(candidate?.ponPortName, 80),
    capacity: Math.max(0, Number(candidate?.capacity) || 0),
    usedPorts: Math.max(0, Number(candidate?.usedPorts) || 0),
    reservedPorts: Math.max(0, Number(candidate?.reservedPorts) || 0),
    availablePorts: Math.max(0, Number(candidate?.availablePorts) || 0),
    availablePortNumbers: (Array.isArray(candidate?.availablePortNumbers)
        ? candidate.availablePortNumbers : []).map((value) => toPositiveInt(value)).filter(Boolean),
    ports: (Array.isArray(candidate?.ports) ? candidate.ports : []).map((entry) => {
        const status = ['available', 'occupied', 'reserved', 'unavailable']
            .includes(toSafeText(entry?.status, 20).toLowerCase())
            ? toSafeText(entry.status, 20).toLowerCase()
            : 'unavailable';
        const accountNumber = toSafeText(
            entry?.customerAccountNumber || entry?.customerId || entry?.customerRef,
            20
        );
        return {
            port: toPositiveInt(entry?.port),
            status,
            available: status === 'available',
            ...(includeClientLabels && status !== 'available' && accountNumber ? {
                customerAccountNumber: accountNumber,
                customerName: toSafeText(entry?.customerName, 200)
            } : {})
        };
    }).filter((entry) => entry.port),
    oltStatus: toSafeText(candidate?.oltStatus, 30),
    opticalPower: toSafeText(candidate?.opticalPower, 120)
});

const loadPonContext = async (branchId, { allowMissingSchema = false } = {}) => {
    if (isJsonStorageMode()) {
        const state = await loadPonStateForBranch(branchId);
        return { schemaReady: true, state };
    }
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

const loadPonOverviewContext = async (branchId, { allowMissingSchema = false } = {}) => {
    if (isJsonStorageMode()) {
        return { schemaReady: true, overview: await loadPonOverviewForBranch(branchId) };
    }
    await assertRelationalReady();
    const schemaReady = await hasPonTables();
    if (!schemaReady) {
        if (allowMissingSchema) {
            return {
                schemaReady: false,
                message: 'PON schema is not initialized. Run Schema Update from owner page.',
                overview: { olts: [], naps: [], ports: [], customers: [], coverageAreas: [] }
            };
        }
        throw createError(503, 'PON schema is not initialized. Run Schema Update from owner page.');
    }
    return { schemaReady: true, overview: await loadPonOverviewForBranch(branchId) };
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
        const customerAccountNumber = toSafeText(
            req.query?.customerAccountNumber || req.query?.accountNumber || req.query?.account,
            20
        );
        const access = await resolveTechnicianAccessibleCustomer(
            branchId,
            req.technician,
            customerAccountNumber
        );
        const context = await loadPonOverviewContext(branchId, { allowMissingSchema: true });
        const overview = context.overview || {};
        const safeOverview = sanitizeTechnicianPonOverview(overview, customerAccountNumber);
        const assignmentMap = collectNapAssignments(overview?.naps);
        const customer = normalizeCustomerSummary(
            access.customer,
            assignmentMap.get(customerAccountNumber) || null
        );
        const activeUsername = toSafeText(customer.pppoeUsername, 120);
        const activePppoeUsernames = activeUsername && (Array.isArray(overview?.activePppoeUsernames)
            ? overview.activePppoeUsernames
            : []).some((username) => normalizeNameKey(username) === normalizeNameKey(activeUsername))
            ? [activeUsername]
            : [];

        return res.json({
            ok: true,
            schemaReady: context.schemaReady,
            message: context.message || '',
            accessType: access.accessType,
            ...safeOverview,
            subscriberStatusAvailable: Boolean(overview?.subscriberStatusAvailable),
            activePppoeUsernames,
            customer,
            customers: [customer],
            coverageAreas: []
        });
    } catch (error) {
        return next(error);
    }
});

router.get('/pon/state', async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        const customerAccountNumber = toSafeText(
            req.query?.customerAccountNumber || req.query?.accountNumber || req.query?.account,
            20
        );
        const access = await resolveTechnicianAccessibleCustomer(
            branchId,
            req.technician,
            customerAccountNumber
        );
        const result = await loadPonContext(branchId, { allowMissingSchema: true });
        const safeState = sanitizeTechnicianPonOverview(result.state, customerAccountNumber);
        const assignmentMap = collectNapAssignments(result.state?.naps);
        return res.json({
            ok: true,
            schemaReady: result.schemaReady,
            message: result.message || '',
            accessType: access.accessType,
            ...safeState,
            customer: normalizeCustomerSummary(
                access.customer,
                assignmentMap.get(customerAccountNumber) || null
            ),
            subscriberStatusAvailable: Boolean(result.state?.subscriberStatusAvailable),
            activePppoeUsernames: []
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
        const [accessible, integrationSettings, liveMikrotikLookup] = await Promise.all([
            loadTechnicianAccessibleCustomers(branchId, req.technician),
            loadIntegrationSettings(branchId).catch(() => null),
            loadBranchActivePppoeLookup(branchId).catch(() => ({
                available: false,
                usernames: new Set(),
                usernamesLower: new Set(),
                routerIds: [],
                reason: 'unavailable'
            }))
        ]);
        const customers = accessible.customers;
        const draftCustomers = accessible.drafts;
        const storedPppoeStatusLookup = buildStoredPppoeStatusLookup(integrationSettings);
        const storedPppoeLookup = buildStoredPppoeLookup(integrationSettings);
        const mikrotikEnabled = hasUsableMikrotikRouter(integrationSettings);

        let assignmentMap = new Map();
        const ponContext = await loadPonContext(branchId, { allowMissingSchema: true }).catch(() => null);
        if (ponContext?.schemaReady) {
            const state = ponContext.state;
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

const requestedCustomerAccountNumber = (req) => toSafeText(
    req.body?.customerAccountNumber
        || req.body?.accountNumber
        || req.body?.customerId
        || req.query?.customerAccountNumber
        || req.query?.accountNumber
        || req.query?.account,
    20
);

const assertPonOverrideFlagsDenied = (payload = {}) => {
    if (
        normalizeBoolean(payload?.replaceExistingPort, false)
        || normalizeBoolean(payload?.moveExistingCustomer, false)
        || normalizeBoolean(payload?.override, false)
        || normalizeBoolean(payload?.force, false)
    ) {
        throw createError(403, 'Technicians cannot replace occupied ports or move existing customer assignments.');
    }
};

router.get('/pon/nearby', async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        const customerAccountNumber = requestedCustomerAccountNumber(req);
        const coverageMap = normalizeBoolean(req.query?.coverageMap, false);
        if (!customerAccountNumber && !coverageMap) {
            throw createError(400, 'Customer account number is required outside draft-selection mode.');
        }
        const access = customerAccountNumber
            ? await resolveTechnicianAccessibleCustomer(
                branchId,
                req.technician,
                customerAccountNumber
            )
            : { accessType: 'new-draft-selection', customer: null };
        const fallbackCoordinates = parseCoordinate(
            access.customer?.mapPin || access.customer?.coordinates
        );
        const latitude = req.query?.latitude ?? req.query?.lat ?? fallbackCoordinates?.latitude;
        const longitude = req.query?.longitude ?? req.query?.lng ?? req.query?.lon ?? fallbackCoordinates?.longitude;
        if (latitude == null || longitude == null) {
            throw createError(400, 'Valid customer latitude and longitude are required.');
        }
        const result = await findNearbyPonNaps({
            branchId,
            latitude,
            longitude,
            limit: coverageMap ? (req.query?.limit || 500) : req.query?.limit,
            maxDistanceMeters: coverageMap
                ? TECHNICIAN_COVERAGE_RADIUS_METERS
                : req.query?.maxDistanceMeters,
            includeOffline: coverageMap,
            includeUnavailable: coverageMap,
            allowExpandedLimit: coverageMap
        });
        return res.json({
            ok: true,
            accessType: access.accessType,
            customer: access.customer ? normalizeCustomerSummary(access.customer, null) : null,
            origin: {
                latitude: Number(latitude),
                longitude: Number(longitude)
            },
            coverageMap,
            candidates: result.candidates.map((candidate) => sanitizeTechnicianNearbyCandidate(
                candidate,
                { includeClientLabels: coverageMap }
            )),
            skippedInvalidCoordinates: result.skippedInvalidCoordinates,
            radiusMeters: result.radiusMeters
        });
    } catch (error) {
        return next(error);
    }
});

const reservePonPortHandler = async (req, res, next) => {
    try {
        assertPonOverrideFlagsDenied(req.body || {});
        const branchId = req.technician.branchId;
        const customerAccountNumber = requestedCustomerAccountNumber(req);
        const access = await resolveTechnicianAccessibleCustomer(branchId, req.technician, customerAccountNumber);
        const reservation = await reservePonPort({
            branchId,
            technicianUserId: req.technician.id,
            customerAccountNumber,
            napId: req.body?.napId,
            port: req.body?.port,
            clientEventId: req.body?.clientEventId,
            ttlMs: req.body?.ttlMs
        });
        return res.status(201).json({
            ok: true,
            accessType: access.accessType,
            reservation
        });
    } catch (error) {
        return next(error);
    }
};

router.post('/pon/reservations', reservePonPortHandler);
router.post('/pon/reserve', reservePonPortHandler);

const releasePonReservationHandler = async (req, res, next) => {
    try {
        const branchId = req.technician.branchId;
        const customerAccountNumber = requestedCustomerAccountNumber(req);
        await resolveTechnicianAccessibleCustomer(branchId, req.technician, customerAccountNumber);
        const reservationId = toSafeText(
            req.params?.reservationId || req.body?.reservationId || req.query?.reservationId,
            64
        );
        const reservation = await releasePonPortReservation({
            branchId,
            technicianUserId: req.technician.id,
            reservationId,
            customerAccountNumber
        });
        return res.json({ ok: true, reservation });
    } catch (error) {
        return next(error);
    }
};

router.delete('/pon/reservations/:reservationId', releasePonReservationHandler);
router.post('/pon/reservations/:reservationId/release', releasePonReservationHandler);
router.post('/pon/release', releasePonReservationHandler);

const submitPonDraftHoldHandler = async (req, res, next) => {
    try {
        assertPonOverrideFlagsDenied(req.body || {});
        const branchId = req.technician.branchId;
        const customerAccountNumber = requestedCustomerAccountNumber(req);
        const access = await resolveTechnicianAccessibleCustomer(
            branchId,
            req.technician,
            customerAccountNumber,
            { allowApprovedDraftReplay: true }
        );
        if (!['own-pending-draft', 'own-approved-draft'].includes(access.accessType)) {
            throw createError(409, 'Only the technician\'s own customer draft can be submitted for Admin review.');
        }
        const completion = normalizeInstallationCompletion(req.body?.installationCompletion);
        if (!completion) {
            throw createError(400, 'Installation completion with the ONU serial number is required.');
        }
        const existingCompletion = access.draft?.draftData?.installationCompletion;
        if (existingCompletion) {
            assertInstallationCompletionReplay(existingCompletion, completion);
        }
        const customers = await readCustomers(branchId);
        const onuDuplicate = findCustomerOnuSerialDuplicate(
            completion.onuSerialNumber,
            customers,
            branchId,
            customerAccountNumber
        );
        if (onuDuplicate) {
            const error = createError(409, onuDuplicate.message);
            error.code = 'CUSTOMER_ONU_SERIAL_DUPLICATE';
            error.duplicate = onuDuplicate;
            throw error;
        }
        const reservationId = toSafeText(
            req.params?.reservationId || req.body?.reservationId,
            64
        );
        const result = await submitPonReservationForAdmin({
            branchId,
            technicianUserId: req.technician.id,
            reservationId,
            clientEventId: req.body?.clientEventId,
            customerAccountNumber,
            opticalInfo: req.body?.opticalInfo || req.body?.signal || req.body?.rxPower
        });
        const selection = result?.selection || {};
        const completionRecord = existingCompletion || {
            ...completion,
            fingerprint: installationCompletionFingerprint(completion),
            submittedAt: new Date().toISOString(),
            submittedBy: {
                id: toSafeText(req.technician?.id, 64),
                username: toSafeText(req.technician?.username || req.technician?.name, 120)
            },
            ponAssignment: {
                reservationId: toSafeText(result?.reservationId || reservationId, 64),
                napId: toSafeText(selection?.napId, 100),
                napCode: toSafeText(selection?.napCode, 100),
                linkedOlt: toSafeText(selection?.linkedOlt, 120),
                ponRef: toSafeText(selection?.ponRef, 80),
                location: toSafeText(selection?.location, 150),
                port: toPositiveInt(selection?.port),
                opticalInfo: toSafeText(selection?.opticalInfo, 120),
                status: 'draft-held'
            }
        };
        const completionUpdate = await compareAndSetCustomerDraftInstallationCompletion(
            customerAccountNumber,
            branchId,
            completionRecord,
            {
                statuses: ['in-progress', 'pending', 'approved'],
                transitionToPending: true
            }
        );
        if (!completionUpdate) {
            throw createError(503, 'The port is held, but the customer draft could not be submitted for Admin review. Retry the same submission event.');
        }
        return res.json({
            ok: true,
            reservationId: result.reservationId,
            duplicate: Boolean(result.duplicate),
            hold: result.hold,
            selection,
            customer: normalizeCustomerSummary(access.customer, selection),
            installationCompletion: completionUpdate.installationCompletion || completionRecord,
            draftStatus: completionUpdate.item?.status || 'pending'
        });
    } catch (error) {
        return next(error);
    }
};

router.post('/pon/reservations/:reservationId/submit', submitPonDraftHoldHandler);
router.post('/pon/submissions', submitPonDraftHoldHandler);
router.post('/pon/assignments', submitPonDraftHoldHandler);

const finalizePonAssignmentHandler = async (req, res, next) => {
    try {
        assertPonOverrideFlagsDenied(req.body || {});
        const branchId = req.technician.branchId;
        const customerAccountNumber = requestedCustomerAccountNumber(req);
        const access = await resolveTechnicianAccessibleCustomer(
            branchId,
            req.technician,
            customerAccountNumber,
            { allowApprovedDraftReplay: true }
        );
        const completion = normalizeInstallationCompletion(req.body?.installationCompletion);
        const existingCompletion = access.draft?.draftData?.installationCompletion;
        if (access.accessType === 'own-approved-draft') {
            if (!completion) {
                throw createError(409, 'Installation completion is required for an approved client draft.');
            }
            if (existingCompletion) {
                assertInstallationCompletionReplay(existingCompletion, completion);
            }
        } else if (completion && access.accessType !== 'own-pending-draft') {
            throw createError(409, 'Installation completion evidence can only be attached to the technician\'s pending client draft.');
        }
        if (completion && existingCompletion) {
            assertInstallationCompletionReplay(existingCompletion, completion);
        }
        if (completion) {
            const customers = await readCustomers(branchId);
            const onuDuplicate = findCustomerOnuSerialDuplicate(
                completion.onuSerialNumber,
                customers,
                branchId,
                customerAccountNumber
            );
            if (onuDuplicate) {
                const error = createError(409, onuDuplicate.message);
                error.code = 'CUSTOMER_ONU_SERIAL_DUPLICATE';
                error.duplicate = onuDuplicate;
                throw error;
            }
        }
        const reservationId = toSafeText(
            req.params?.reservationId || req.body?.reservationId,
            64
        );
        const result = await finalizePonAssignment({
            branchId,
            technicianUserId: req.technician.id,
            reservationId,
            clientEventId: req.body?.clientEventId,
            customerAccountNumber,
            customerName: buildCustomerDisplayName(access.customer),
            opticalInfo: req.body?.opticalInfo || req.body?.signal || req.body?.rxPower
        });
        if (
            toSafeText(result?.assignment?.customerAccountNumber, 20)
            && toSafeText(result.assignment.customerAccountNumber, 20) !== customerAccountNumber
        ) {
            throw createError(409, 'Reservation does not belong to the requested customer.');
        }
        let persistedCompletion = existingCompletion || null;
        if (completion) {
            // Once compatibility validation accepts a replay, propose the stored record
            // verbatim so the strict draft CAS cannot reinterpret sparse/new normalization.
            const completionRecord = existingCompletion || {
                ...completion,
                fingerprint: installationCompletionFingerprint(completion),
                submittedAt: new Date().toISOString(),
                submittedBy: {
                    id: toSafeText(req.technician?.id, 64),
                    username: toSafeText(req.technician?.username || req.technician?.name, 120)
                },
                ponAssignment: {
                    reservationId: toSafeText(result?.reservationId || reservationId, 64),
                    napId: toSafeText(result?.assignment?.napId, 100),
                    napCode: toSafeText(result?.assignment?.napCode, 100),
                    port: toPositiveInt(result?.assignment?.port),
                    opticalInfo: toSafeText(result?.assignment?.opticalInfo, 120)
                }
            };
            const completionUpdate = await compareAndSetCustomerDraftInstallationCompletion(
                customerAccountNumber,
                branchId,
                completionRecord,
                { statuses: ['pending', 'approved'] }
            );
            if (!completionUpdate) {
                throw createError(503, 'The PON assignment was finalized, but installation evidence could not be stored. Retry the same submission event.');
            }
            persistedCompletion = completionUpdate.installationCompletion || completionRecord;
            await promoteApprovedDraftOnuSerial({
                completionUpdate,
                completion: persistedCompletion,
                branchId,
                fallbackAccountNumber: customerAccountNumber
            });
        }
        return res.json({
            ok: true,
            reservationId: result.reservationId,
            duplicate: Boolean(result.duplicate),
            assignment: result.assignment,
            customer: normalizeCustomerSummary(access.customer, result.assignment),
            installationCompletion: persistedCompletion
        });
    } catch (error) {
        return next(error);
    }
};

router.post('/pon/reservations/:reservationId/finalize', finalizePonAssignmentHandler);
router.post('/pon/assign', finalizePonAssignmentHandler);

router.post('/pppoe/generate', serializePaymentMutationRequest, async (req, res, next) => {
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

        const access = await resolveTechnicianAccessibleCustomer(
            branchId,
            req.technician,
            customerAccountNumber
        );
        const customers = await readCustomers(branchId);
        const pendingDraftCustomers = await loadPendingDraftCustomersForTechnician(branchId, req.technician?.id || '', {
            limit: 500
        }).catch(() => []);
        const customer = access.customer;
        await assertTechnicianPppoeAccountOpen(branchId, customerAccountNumber);

        let napAssignment = null;
        const ponContext = await loadPonContext(branchId, { allowMissingSchema: true }).catch(() => null);
        if (ponContext?.schemaReady) {
            const state = ponContext.state;
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
                const updatedDraft = await withCustomerDraftStoreMutationLock(() =>
                    updateCustomerDraftSubmissionDraftDataByAccountNumber(
                        customerAccountNumber,
                        branchId,
                        customerPppoePatch,
                        { statuses: ['pending'] }
                    )
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
                    refreshSource: 'technician-pppoe-generate',
                    paymentMutationAlreadySerialized: true
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
                const updatedDraft = await withCustomerDraftStoreMutationLock(() =>
                    updateCustomerDraftSubmissionDraftDataByAccountNumber(
                        customerAccountNumber,
                        branchId,
                        fallbackCredentialPatch,
                        { statuses: ['pending'] }
                    )
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
                    refreshSource: 'technician-pppoe-generate-manual',
                    paymentMutationAlreadySerialized: true
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
module.exports.TECHNICIAN_COVERAGE_RADIUS_METERS = TECHNICIAN_COVERAGE_RADIUS_METERS;
module.exports.resolveJobCustomerAccountNumber = resolveJobCustomerAccountNumber;
module.exports.technicianOwnsPendingDraft = technicianOwnsPendingDraft;
module.exports.technicianOwnsApprovedDraft = technicianOwnsApprovedDraft;
module.exports.jobGrantsCustomerAccess = jobGrantsCustomerAccess;
module.exports.sanitizeTechnicianPonOverview = sanitizeTechnicianPonOverview;
module.exports.sanitizeTechnicianNearbyCandidate = sanitizeTechnicianNearbyCandidate;
module.exports.assertPonOverrideFlagsDenied = assertPonOverrideFlagsDenied;
module.exports.normalizeInstallationCompletion = normalizeInstallationCompletion;
module.exports.installationCompletionFingerprint = installationCompletionFingerprint;
module.exports.assertInstallationCompletionReplay = assertInstallationCompletionReplay;
module.exports.promoteApprovedDraftOnuSerial = promoteApprovedDraftOnuSerial;
