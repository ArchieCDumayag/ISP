const crypto = require('crypto');
const { readJson, writeJson } = require('./data-store');

const FCM_TOKENS_STORE_KEY = 'customer_fcm_tokens';
const MAX_FCM_TOKEN_LENGTH = 4096;
const MAX_DEVICE_ID_LENGTH = 160;
const MAX_PLATFORM_LENGTH = 40;
const MAX_APP_VERSION_LENGTH = 60;
const ALLOWED_PLATFORMS = new Set(['android', 'ios', 'web', 'unknown']);

const trimLimit = (value, limit) => String(value || '').trim().slice(0, limit);

const defaultFcmTokenStore = () => ({ tokens: {} });

const normalizeFcmStore = (value = {}) => ({
    tokens: value?.tokens && typeof value.tokens === 'object' ? value.tokens : {}
});

const loadFcmTokenStore = async () =>
    normalizeFcmStore(await readJson(FCM_TOKENS_STORE_KEY, defaultFcmTokenStore()));

const saveFcmTokenStore = async (store) => {
    const normalized = normalizeFcmStore(store);
    await writeJson(FCM_TOKENS_STORE_KEY, normalized);
    return normalized;
};

const hashFcmToken = (token) =>
    crypto.createHash('sha256').update(String(token || '')).digest('hex');

const maskFcmToken = (token) => {
    const value = String(token || '');
    if (value.length <= 18) return value ? `${value.slice(0, 4)}...` : '';
    return `${value.slice(0, 10)}...${value.slice(-8)}`;
};

const normalizePlatform = (value) => {
    const platform = trimLimit(value || 'unknown', MAX_PLATFORM_LENGTH).toLowerCase();
    return ALLOWED_PLATFORMS.has(platform) ? platform : 'unknown';
};

const getRequestFcmToken = (body = {}) => {
    const token = trimLimit(
        body.fcmToken || body.token || body.registrationToken || body.deviceToken || '',
        MAX_FCM_TOKEN_LENGTH
    );
    const lowered = token.toLowerCase();
    return lowered === 'null' || lowered === 'undefined' ? '' : token;
};

const getRequestDeviceId = (body = {}) =>
    trimLimit(body.deviceId || body.installationId || '', MAX_DEVICE_ID_LENGTH);

const sanitizeFcmTokenEntry = (entry = {}) => ({
    accountNumber: entry.accountNumber || '',
    customerName: entry.customerName || '',
    branchId: entry.branchId || null,
    tokenHash: entry.tokenHash || '',
    tokenPreview: maskFcmToken(entry.token),
    platform: entry.platform || 'unknown',
    deviceId: entry.deviceId || '',
    appVersion: entry.appVersion || '',
    enabled: entry.enabled !== false,
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    lastSeenAt: entry.lastSeenAt || null
});

const getEnabledTokenEntries = (store = {}) =>
    Object.values(store.tokens || {})
        .filter((entry) => entry && entry.enabled !== false && String(entry.token || '').trim());

const getEntryTime = (entry = {}) => {
    const raw = entry.lastSeenAt || entry.updatedAt || entry.createdAt || '';
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : 0;
};

const getDeliveryDedupeKey = (entry = {}) => {
    const accountNumber = String(entry.accountNumber || '').trim();
    const deviceId = String(entry.deviceId || '').trim();
    const platform = normalizePlatform(entry.platform || 'unknown');
    if (!accountNumber) return `token:${String(entry.tokenHash || entry.token || '').trim()}`;
    if (deviceId) return `account-device:${accountNumber}:${deviceId}`;
    return `account-platform:${accountNumber}:${platform}`;
};

const dedupeFcmTokenEntriesForDelivery = (entries = []) => {
    const latestByKey = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (!entry || entry.enabled === false || !String(entry.token || '').trim()) return;
        const key = getDeliveryDedupeKey(entry);
        const current = latestByKey.get(key);
        if (!current || getEntryTime(entry) >= getEntryTime(current)) {
            latestByKey.set(key, entry);
        }
    });
    return Array.from(latestByKey.values());
};

const getCustomerAccountNumber = (customer = {}) =>
    String(customer.accountNumber || customer.account_number || '').trim();

const getCustomerDisplayName = (customer = {}) => {
    const explicitName = String(customer.name || customer.customerName || '').trim();
    if (explicitName) return explicitName;
    return String(
        `${customer.firstName || customer.first_name || ''} ${customer.lastName || customer.last_name || ''}`.trim()
    ).trim();
};

const registerCustomerFcmToken = async ({ customer = {}, body = {}, token: explicitToken = '' } = {}) => {
    const token = explicitToken
        ? trimLimit(explicitToken, MAX_FCM_TOKEN_LENGTH)
        : getRequestFcmToken(body);
    if (!token) return null;

    const accountNumber = getCustomerAccountNumber(customer);
    if (!accountNumber) {
        const error = new Error('Customer account number is required.');
        error.status = 400;
        throw error;
    }

    const now = new Date().toISOString();
    const tokenHash = hashFcmToken(token);
    const store = await loadFcmTokenStore();
    const tokens = { ...store.tokens };
    const deviceId = getRequestDeviceId(body);
    const platform = normalizePlatform(body.platform);

    Object.entries(tokens).forEach(([key, entry]) => {
        if (key === tokenHash) return;
        const entryAccount = String(entry?.accountNumber || '').trim();
        const entryDeviceId = String(entry?.deviceId || '').trim();
        const entryPlatform = normalizePlatform(entry?.platform || 'unknown');
        const sameDevice = deviceId && entryDeviceId === deviceId;
        const sameNoDeviceSlot = !deviceId
            && !entryDeviceId
            && entryAccount === accountNumber
            && entryPlatform === platform;
        if (sameDevice || sameNoDeviceSlot) {
            delete tokens[key];
        }
    });

    const existing = tokens[tokenHash] || {};
    tokens[tokenHash] = {
        ...existing,
        token,
        tokenHash,
        accountNumber,
        customerName: getCustomerDisplayName(customer),
        branchId: customer.branchId || customer.branch_id || null,
        platform,
        deviceId,
        appVersion: trimLimit(body.appVersion || body.app_version || body.version || '', MAX_APP_VERSION_LENGTH),
        enabled: true,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        lastSeenAt: now
    };

    await saveFcmTokenStore({ tokens });
    return tokens[tokenHash];
};

const removeCustomerFcmToken = async ({ customer = {}, body = {}, token: explicitToken = '' } = {}) => {
    const accountNumber = getCustomerAccountNumber(customer);
    const token = explicitToken
        ? trimLimit(explicitToken, MAX_FCM_TOKEN_LENGTH)
        : getRequestFcmToken(body);
    const deviceId = getRequestDeviceId(body);
    if (!accountNumber || (!token && !deviceId)) return 0;

    const store = await loadFcmTokenStore();
    const tokens = { ...store.tokens };
    const tokenHash = token ? hashFcmToken(token) : '';
    let removedCount = 0;

    Object.entries(tokens).forEach(([key, entry]) => {
        const sameAccount = String(entry?.accountNumber || '').trim() === accountNumber;
        const sameToken = tokenHash && key === tokenHash;
        const sameDevice = deviceId && String(entry?.deviceId || '').trim() === deviceId;
        if (sameAccount && (sameToken || sameDevice)) {
            delete tokens[key];
            removedCount += 1;
        }
    });

    if (removedCount) {
        await saveFcmTokenStore({ tokens });
    }
    return removedCount;
};

module.exports = {
    FCM_TOKENS_STORE_KEY,
    dedupeFcmTokenEntriesForDelivery,
    getRequestDeviceId,
    getRequestFcmToken,
    getEnabledTokenEntries,
    loadFcmTokenStore,
    registerCustomerFcmToken,
    removeCustomerFcmToken,
    sanitizeFcmTokenEntry,
    saveFcmTokenStore
};
