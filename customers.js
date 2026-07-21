const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./data-store');
const { requireAuth } = require('./auth');
const { getPool, query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const https = require('https');
const createError = require('http-errors');
const { loadIntegrationSettings, saveIntegrationSettings, resolveMikrotikRouter } = require('./integration-settings');
const { connectMikrotikClient } = require('./mikrotik-client');
const { auditMikrotikPppoeCommand } = require('./mikrotik-audit-log');
const {
    buildPppoeAccountKey,
    dedupePppoeAccounts,
    normalizePppoeRouterId,
    normalizePppoeSecretId,
    normalizePppoeUsernameKey
} = require('./pppoe-account-utils');
const { verifyPassword } = require('./passwords');
const { createPaymentConfirmationSubmission } = require('./payment-confirmation-queue-store');
const {
    getRequestFcmToken,
    registerCustomerFcmToken,
    sanitizeFcmTokenEntry
} = require('./customer-fcm-tokens');
const {
    listCustomerNotifications,
    markAllCustomerNotificationsRead,
    markCustomerNotificationRead
} = require('./customer-notification-inbox');
const {
    normalizePlanProfileBindings,
    resolvePlanProfileForRouter
} = require('./plan-profile-utils');
const {
    CUSTOMER_ARCHIVES_TABLE,
    ensureCustomerArchivesTable,
    createCustomerArchive,
    listCustomerArchives,
    getCustomerArchiveById,
    markCustomerArchiveRestored,
    deleteCustomerArchivePermanently,
    purgeExpiredCustomerArchives
} = require('./customer-archive-store');

const router = express.Router();
const publicRouter = express.Router();
const STORE_KEYS = {
    customers: 'customers',
    payments: 'payments',
    plans: 'plans'
};
const ACCOUNT_NUMBER_SETTINGS_KEY = 'account_number_settings';
const ACCOUNT_TOTAL_DIGITS = 9;
const ACCOUNT_PREFIX_DIGITS = 3;
const ACCOUNT_SUFFIX_DIGITS = ACCOUNT_TOTAL_DIGITS - ACCOUNT_PREFIX_DIGITS;
const DEFAULT_ACCOUNT_PREFIX = '100';
const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const toPositiveInt = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const normalizePhilippineMobile = (value, { fallbackToRaw = true } = {}) => {
    const original = sanitizeString(value);
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
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;
const ABSOLUTE_SCHEME_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let cachedCloudflaredHostname;
const STATUS_ACTIVE = 'active';
const STATUS_INACTIVE = 'inactive';
const STATUS_DISABLED = 'disabled';
const STATUS_MODE_AUTO = 'auto';
const CUSTOMER_SESSION_COOKIE = 'customerSessionId';
const CUSTOMER_SESSION_STORE_KEY = 'customer_sessions';
const CUSTOMER_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const CUSTOMER_SESSION_TTL_MS = CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000;
const CUSTOMER_SESSION_REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const TICKET_STORE_KEY = 'tickets';
const TICKET_DONE_STATUSES = new Set(['resolved', 'closed', 'done']);
const OPEN_TICKET_PREVIEW_LIMIT = 5;
const CUSTOMER_DRAFT_SUBMISSIONS_TABLE = 'customer_draft_submissions';
const PAYMENT_CONFIRMATION_QUEUE_TABLE = 'payment_confirmation_queue';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ARCHIVE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let archiveCleanupInterval = null;

const normalizeCustomerStatus = (value, fallback = STATUS_ACTIVE) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'force-inactive') return STATUS_INACTIVE;
    if (raw === STATUS_ACTIVE || raw === STATUS_INACTIVE || raw === STATUS_DISABLED) return raw;
    if (raw === 'force-active') return STATUS_ACTIVE; // backward compatibility
    return fallback;
};

const parseStoredCustomerStatus = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const status = normalizeCustomerStatus(raw, STATUS_ACTIVE);
    return { status, statusMode: STATUS_MODE_AUTO, stored: status };
};

const resolveCustomerStatusState = (
    statusValue,
    _statusModeValue,
    fallback = { status: STATUS_ACTIVE, statusMode: STATUS_MODE_AUTO }
) => {
    const parsed = parseStoredCustomerStatus(statusValue);
    const fallbackStatus = normalizeCustomerStatus(fallback?.status, STATUS_ACTIVE);
    const status = parsed?.status || normalizeCustomerStatus(statusValue, fallbackStatus);
    return { status, statusMode: STATUS_MODE_AUTO, stored: status };
};

const hydrateCustomerStatus = (customer) => {
    if (!customer || typeof customer !== 'object') return customer;
    const state = resolveCustomerStatusState(customer.status, customer.statusMode);
    return { ...customer, status: state.status, statusMode: state.statusMode, statusRaw: state.stored };
};

const parseCookies = (cookieHeader = '') =>
    cookieHeader.split(';').reduce((acc, part) => {
        const [key, ...rest] = part.trim().split('=');
        if (!key) return acc;
        acc[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '');
        return acc;
    }, {});

const customerSessions = new Map(); // sessionId -> { accountNumber, createdAt }
let customerSessionsLoaded = false;
let customerSessionsLoadPromise = null;
let customerSessionsPersistPromise = Promise.resolve();

const getCustomerSessionId = (req) => {
    const cookies = parseCookies(req.headers.cookie || '');
    return cookies[CUSTOMER_SESSION_COOKIE] || null;
};

const normalizeStoredCustomerSession = (value, now = Date.now()) => {
    if (!value || typeof value !== 'object') return null;
    const accountNumber = String(value.accountNumber || '').trim();
    const createdAt = Number(value.createdAt || 0);
    if (!accountNumber || !Number.isFinite(createdAt) || createdAt <= 0) return null;
    if (now - createdAt > CUSTOMER_SESSION_TTL_MS) return null;
    return { accountNumber, createdAt };
};

const buildCustomerSessionsPayload = () => {
    const now = Date.now();
    const sessions = {};
    for (const [sessionId, session] of customerSessions.entries()) {
        const normalized = normalizeStoredCustomerSession(session, now);
        if (!normalized) {
            customerSessions.delete(sessionId);
            continue;
        }
        sessions[sessionId] = normalized;
    }
    return { sessions };
};

const persistCustomerSessionsSafe = () => {
    customerSessionsPersistPromise = customerSessionsPersistPromise
        .catch(() => {})
        .then(() => writeJson(CUSTOMER_SESSION_STORE_KEY, buildCustomerSessionsPayload()))
        .catch((error) => {
            console.warn('Failed to persist customer sessions:', error?.message || error);
        });
    return customerSessionsPersistPromise;
};

const loadCustomerSessions = async () => {
    if (customerSessionsLoaded) return;
    if (customerSessionsLoadPromise) return customerSessionsLoadPromise;
    customerSessionsLoadPromise = (async () => {
        try {
            const stored = await readJson(CUSTOMER_SESSION_STORE_KEY, { sessions: {} });
            const rawSessions = stored?.sessions && typeof stored.sessions === 'object'
                ? stored.sessions
                : {};
            const now = Date.now();
            let pruned = false;
            for (const [sessionId, session] of Object.entries(rawSessions)) {
                const normalized = normalizeStoredCustomerSession(session, now);
                if (!normalized) {
                    pruned = true;
                    continue;
                }
                customerSessions.set(sessionId, normalized);
            }
            if (pruned) persistCustomerSessionsSafe();
        } catch (error) {
            console.warn('Failed to load customer sessions:', error?.message || error);
        } finally {
            customerSessionsLoaded = true;
            customerSessionsLoadPromise = null;
        }
    })();
    return customerSessionsLoadPromise;
};

const getCustomerSession = async (req, res = null) => {
    await loadCustomerSessions();
    const sessionId = getCustomerSessionId(req);
    if (!sessionId) return null;
    const session = customerSessions.get(sessionId);
    if (!session) return null;
    const now = Date.now();
    if (now - session.createdAt > CUSTOMER_SESSION_TTL_MS) {
        customerSessions.delete(sessionId);
        persistCustomerSessionsSafe();
        return null;
    }
    if (res && now - session.createdAt >= CUSTOMER_SESSION_REFRESH_AFTER_MS) {
        session.createdAt = now;
        customerSessions.set(sessionId, session);
        setCustomerSessionCookie(req, res, sessionId);
        persistCustomerSessionsSafe();
    }
    return { id: sessionId, ...session };
};

const setCustomerSessionCookie = (req, res, sessionId) => {
    const isSecure = !!(req.secure || (req.headers['x-forwarded-proto'] || '').includes('https'));
    const attrs = [
        `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
        'HttpOnly',
        'Path=/',
        'SameSite=Lax',
        `Max-Age=${CUSTOMER_SESSION_MAX_AGE_SECONDS}`
    ];
    if (isSecure) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
};

const clearCustomerSessionCookie = (req, res) => {
    const isSecure = !!(req.secure || (req.headers['x-forwarded-proto'] || '').includes('https'));
    const attrs = [
        `${CUSTOMER_SESSION_COOKIE}=;`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0'
    ];
    if (isSecure) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
};

const deleteCustomerSessionsForAccount = async (accountNumber) => {
    await loadCustomerSessions();
    const targetAccountNumber = String(accountNumber || '').trim();
    if (!targetAccountNumber) return 0;
    let removed = 0;
    for (const [sessionId, session] of customerSessions.entries()) {
        if (String(session?.accountNumber || '').trim() !== targetAccountNumber) continue;
        customerSessions.delete(sessionId);
        removed += 1;
    }
    if (removed) await persistCustomerSessionsSafe();
    return removed;
};

const isMissingTableError = (error) =>
    Boolean(error) && (
        String(error.code || '').toUpperCase() === 'ER_NO_SUCH_TABLE' ||
        /doesn't exist/i.test(String(error.message || ''))
    );

const isOptionalSchemaError = (error) =>
    isMissingTableError(error) || String(error?.code || '').toUpperCase() === 'ER_BAD_FIELD_ERROR';

const resolveUploadFilePath = (proofUrl) => {
    const normalizedUrl = String(proofUrl || '').trim();
    if (!normalizedUrl.startsWith('/uploads/')) return '';
    const relativePath = normalizedUrl
        .replace(/^\/+/, '')
        .split('/')
        .filter(Boolean);
    if (!relativePath.length) return '';
    return path.join(__dirname, 'public', ...relativePath);
};

const deleteLocalFiles = (filePaths = []) => {
    const uniquePaths = Array.from(
        new Set(
            (Array.isArray(filePaths) ? filePaths : [])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        )
    );
    uniquePaths.forEach((filePath) => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            console.warn(`Failed to delete file during customer cleanup: ${filePath}`, error?.message || error);
        }
    });
};

const buildSqlPlaceholders = (count) => Array.from({ length: count }, () => '?').join(', ');

const removeRouterSecret = async (secretMenu, { username = '', secretId = '' } = {}) => {
    const normalizedUsername = String(username || '').trim();
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    if (!normalizedUsername && !normalizedSecretId) return false;

    if (normalizedSecretId) {
        try {
            await secretMenu.remove({ '.id': normalizedSecretId });
            return true;
        } catch {
            try {
                await secretMenu.where('.id', normalizedSecretId).remove();
                return true;
            } catch (error) {
                if (!normalizedUsername) {
                    throw error;
                }
            }
        }
    }

    if (normalizedUsername) {
        await secretMenu.where('name', normalizedUsername).remove();
        return true;
    }

    return false;
};

const isLikelyMissingRouterSecretError = (error) => {
    const message = String(error?.message || '').trim().toLowerCase();
    return message.includes('not found') || message.includes('no such item');
};

const normalizeRouterCredentials = (routerConfig = {}) => {
    const port = Number(routerConfig?.port);
    return {
        address: String(routerConfig?.address || routerConfig?.host || '').trim(),
        username: String(routerConfig?.username || routerConfig?.user || '').trim(),
        password: routerConfig?.password != null ? String(routerConfig.password) : '',
        port: Number.isFinite(port) && port > 0 ? Math.trunc(port) : 8728
    };
};

const hasRouterCredentials = (routerConfig = {}) => {
    const creds = normalizeRouterCredentials(routerConfig);
    return Boolean(creds.address && creds.username && creds.password);
};

const matchesStoredPppoeCustomer = ({ entry = {}, accountNumber = '', usernameKey = '' } = {}) => {
    const normalizedAccountNumber = String(accountNumber || '').trim();
    const entryAccount = String(entry?.customerAccount || entry?.accountNumber || entry?.customerId || '').trim();
    if (normalizedAccountNumber && entryAccount === normalizedAccountNumber) {
        return true;
    }
    if (!usernameKey) return false;
    return normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user) === usernameKey;
};

const findRouterSecretByIdentity = (secrets = [], { secretId = '', username = '' } = {}) => {
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    const normalizedUsername = String(username || '').trim();
    const normalizedUsernameKey = normalizePppoeUsernameKey(normalizedUsername);
    return (Array.isArray(secrets) ? secrets : []).find((secret) => {
        const itemSecretId = normalizePppoeSecretId(secret?.['.id'] || secret?.id);
        if (normalizedSecretId && itemSecretId === normalizedSecretId) {
            return true;
        }
        const itemUsername = String(secret?.name || secret?.user || '').trim();
        return normalizedUsernameKey && normalizePppoeUsernameKey(itemUsername) === normalizedUsernameKey;
    }) || null;
};

const updateRouterSecretDisabledState = async (
    secretMenu,
    {
        secretId = '',
        username = '',
        disabled = false,
        branchId = null,
        routerId = '',
        source = 'customers',
        reason = ''
    } = {}
) => {
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    const normalizedUsername = String(username || '').trim();
    const updatePayload = {
        disabled: disabled ? 'true' : 'false'
    };
    if (normalizedSecretId) {
        try {
            await auditMikrotikPppoeCommand({
                branchId,
                source,
                routerId,
                username: normalizedUsername,
                secretId: normalizedSecretId,
                operation: 'update',
                selector: `.id=${normalizedSecretId}`,
                payload: updatePayload,
                reason
            });
            await secretMenu.where('.id', normalizedSecretId).update(updatePayload);
            return true;
        } catch (error) {
            if (!normalizedUsername) {
                throw error;
            }
        }
    }

    if (normalizedUsername) {
        await auditMikrotikPppoeCommand({
            branchId,
            source,
            routerId,
            username: normalizedUsername,
            secretId: normalizedSecretId,
            operation: 'update',
            selector: `name=${normalizedUsername}`,
            payload: updatePayload,
            reason
        });
        await secretMenu.where('name', normalizedUsername).update(updatePayload);
        return true;
    }

    return false;
};

const updateRouterSecretProfile = async (
    secretMenu,
    {
        secretId = '',
        username = '',
        profile = '',
        disabled,
        branchId = null,
        routerId = '',
        source = 'customers-update',
        reason = ''
    } = {}
) => {
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    const normalizedUsername = String(username || '').trim();
    const normalizedProfile = String(profile || '').trim();
    if (!normalizedProfile) return false;

    const updatePayload = {
        profile: normalizedProfile,
        ...(typeof disabled === 'boolean' ? { disabled: disabled ? 'true' : 'false' } : {})
    };
    if (normalizedSecretId) {
        try {
            await auditMikrotikPppoeCommand({
                branchId,
                source,
                routerId,
                username: normalizedUsername,
                secretId: normalizedSecretId,
                operation: 'update',
                selector: `.id=${normalizedSecretId}`,
                payload: updatePayload,
                reason
            });
            await secretMenu.where('.id', normalizedSecretId).update(updatePayload);
            return true;
        } catch (error) {
            if (!normalizedUsername) {
                throw error;
            }
        }
    }

    if (normalizedUsername) {
        await auditMikrotikPppoeCommand({
            branchId,
            source,
            routerId,
            username: normalizedUsername,
            secretId: normalizedSecretId,
            operation: 'update',
            selector: `name=${normalizedUsername}`,
            payload: updatePayload,
            reason
        });
        await secretMenu.where('name', normalizedUsername).update(updatePayload);
        return true;
    }

    return false;
};

const buildArchivedPppoeEntryLookup = (entries = [], fallbackRouterId = '') => {
    const list = dedupePppoeAccounts(Array.isArray(entries) ? entries : [], fallbackRouterId);
    const byKey = new Map();
    const byUsername = new Map();
    list.forEach((entry) => {
        const key = buildPppoeAccountKey(entry, fallbackRouterId);
        if (key && !byKey.has(key)) {
            byKey.set(key, entry);
        }
        const usernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user);
        if (usernameKey && !byUsername.has(usernameKey)) {
            byUsername.set(usernameKey, entry);
        }
    });
    return { list, byKey, byUsername };
};

const findArchivedPppoeEntryMeta = (lookup = null, entry = {}, fallbackRouterId = '') => {
    if (!lookup || typeof lookup !== 'object') return null;
    const key = buildPppoeAccountKey(entry, fallbackRouterId);
    if (key && lookup.byKey instanceof Map && lookup.byKey.has(key)) {
        return lookup.byKey.get(key) || null;
    }
    const usernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user);
    if (usernameKey && lookup.byUsername instanceof Map && lookup.byUsername.has(usernameKey)) {
        return lookup.byUsername.get(usernameKey) || null;
    }
    return null;
};

const buildPppoeActionWarning = (action = '', skippedEntries = []) => {
    const first = Array.isArray(skippedEntries) && skippedEntries.length ? skippedEntries[0] : null;
    if (!first) return '';
    if (first?.message) return String(first.message).trim();
    const username = String(first?.username || first?.name || first?.user || '').trim();
    if (username) {
        if (action === 'enable') return `Customer restored, but PPPoE "${username}" could not be re-enabled.`;
        if (action === 'disable') return `PPPoE "${username}" could not be disabled.`;
        if (action === 'delete') return `PPPoE "${username}" could not be removed from MikroTik.`;
    }
    if (action === 'enable') return 'Customer restored, but some PPPoE entries could not be re-enabled.';
    if (action === 'disable') return 'Some PPPoE entries could not be disabled.';
    if (action === 'delete') return 'Some PPPoE entries could not be removed from MikroTik.';
    return 'Unable to update PPPoE entries.';
};

const manageCustomerPppoeAccounts = async (
    {
        branchId,
        customer = null,
        action = 'delete',
        archiveEntries = [],
        allowWarnings = false,
        localOnly = false
    } = {}
) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    const username = String(customer?.pppoeUsername || '').trim();
    const usernameKey = normalizePppoeUsernameKey(username);
    const validActions = new Set(['disable', 'enable', 'delete']);
    const normalizedAction = validActions.has(String(action || '').trim().toLowerCase())
        ? String(action || '').trim().toLowerCase()
        : 'delete';
    const hasArchiveEntries = Array.isArray(archiveEntries) && archiveEntries.length > 0;
    if (!accountNumber && !usernameKey && !hasArchiveEntries) {
        return { processedEntries: [], skippedEntries: [] };
    }

    const settings = await loadIntegrationSettings(branchId);
    const defaultRouterId = settings?.mikrotikDefaultId || '';
    const rawAccounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
    const matchedRawAccounts = rawAccounts.filter((entry) =>
        matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })
    );
    const matchedAccounts = dedupePppoeAccounts(matchedRawAccounts, defaultRouterId);
    const archiveLookup = buildArchivedPppoeEntryLookup(archiveEntries, defaultRouterId);
    const allowRouterChanges = localOnly !== true;
    const candidates = matchedAccounts.length
        ? matchedAccounts
        : (archiveLookup.list.length
            ? archiveLookup.list
            : (allowRouterChanges && username
                ? [{
                    username,
                    routerId: defaultRouterId
                }]
                : []));

    const processedEntries = [];
    const skippedEntries = [];

    for (const entry of candidates) {
        const candidateUsername = String(entry?.username || entry?.name || entry?.user || '').trim();
        const archiveMeta = findArchivedPppoeEntryMeta(archiveLookup, entry, defaultRouterId);
        const routerId = normalizePppoeRouterId(entry?.routerId || archiveMeta?.routerId, defaultRouterId);
        const resolvedRouter = resolveMikrotikRouter(settings, routerId);
        const baseEntry = {
            username: candidateUsername,
            routerId: String(resolvedRouter?.id || routerId || '').trim(),
            secretId: normalizePppoeSecretId(entry?.secretId || entry?.['.id'] || archiveMeta?.secretId),
            previousStatus: String(entry?.status || archiveMeta?.previousStatus || '').trim(),
            disabledByArchive: archiveMeta?.disabledByArchive === true,
            wasDisabledBeforeArchive: archiveMeta?.wasDisabledBeforeArchive === true
        };
        if (!candidateUsername) {
            skippedEntries.push({ ...baseEntry, reason: 'missing-username' });
            continue;
        }
        if (normalizedAction === 'enable' && hasArchiveEntries && archiveMeta && archiveMeta.disabledByArchive !== true) {
            continue;
        }
        if (!allowRouterChanges) {
            processedEntries.push({
                ...baseEntry,
                missing: false,
                localOnly: true
            });
            continue;
        }
        if (!resolvedRouter || !hasRouterCredentials(resolvedRouter)) {
            const message = `Missing MikroTik router configuration for PPPoE account "${candidateUsername}".`;
            if (!allowWarnings) {
                throw createError(502, message);
            }
            skippedEntries.push({ ...baseEntry, reason: 'missing-router-config', message });
            continue;
        }

        const creds = normalizeRouterCredentials(resolvedRouter);
        let client = null;
        try {
            const connection = await connectMikrotikClient(creds, {
                timeout: 8000,
                label: `delete-customer:${accountNumber || candidateUsername}`
            });
            client = connection.client;
            const api = connection.api;
            const secretMenu = api.menu('/ppp secret');
            const secrets = await secretMenu.get().catch(() => []);
            const matchedSecret = findRouterSecretByIdentity(secrets, {
                secretId: baseEntry.secretId,
                username: candidateUsername
            });
            const nextEntry = {
                ...baseEntry,
                secretId: normalizePppoeSecretId(
                    matchedSecret?.['.id'] || matchedSecret?.id || baseEntry.secretId
                )
            };
            const wasDisabled = String(matchedSecret?.disabled || '').trim().toLowerCase() === 'true';

            if (normalizedAction === 'delete') {
                if (matchedSecret) {
                    await removeRouterSecret(secretMenu, {
                        username: candidateUsername,
                        secretId: nextEntry.secretId
                    });
                }
                processedEntries.push({
                    ...nextEntry,
                    missing: !matchedSecret
                });
                continue;
            }

            if (!matchedSecret) {
                processedEntries.push({
                    ...nextEntry,
                    missing: true
                });
                continue;
            }

            if (normalizedAction === 'disable' && !wasDisabled) {
                await updateRouterSecretDisabledState(secretMenu, {
                    username: candidateUsername,
                    secretId: nextEntry.secretId,
                    disabled: true,
                    branchId,
                    routerId: nextEntry.routerId,
                    source: 'customer-archive',
                    reason: 'archive-disable'
                });
            }
            if (normalizedAction === 'enable' && archiveMeta?.disabledByArchive === true && wasDisabled) {
                await updateRouterSecretDisabledState(secretMenu, {
                    username: candidateUsername,
                    secretId: nextEntry.secretId,
                    disabled: false,
                    branchId,
                    routerId: nextEntry.routerId,
                    source: 'customer-archive-restore',
                    reason: 'archive-restore'
                });
            }

            processedEntries.push({
                ...nextEntry,
                missing: false,
                disabledByArchive: normalizedAction === 'disable' ? !wasDisabled : nextEntry.disabledByArchive,
                wasDisabledBeforeArchive: normalizedAction === 'disable' ? wasDisabled : nextEntry.wasDisabledBeforeArchive,
                previousStatus: nextEntry.previousStatus
            });
        } catch (error) {
            if (isLikelyMissingRouterSecretError(error)) {
                processedEntries.push({
                    ...baseEntry,
                    missing: true
                });
                continue;
            }
            if (allowWarnings) {
                skippedEntries.push({
                    ...baseEntry,
                    reason: 'router-error',
                    message: `Failed to ${normalizedAction === 'enable' ? 're-enable' : normalizedAction} MikroTik PPPoE account "${candidateUsername}": ${error?.message || 'Unknown error'}`
                });
                continue;
            }
            throw createError(
                502,
                `Failed to ${normalizedAction === 'enable' ? 're-enable' : normalizedAction} MikroTik PPPoE account "${candidateUsername}": ${error?.message || 'Unknown error'}`
            );
        } finally {
            if (typeof client?.close === 'function') {
                await client.close().catch(() => {});
            }
        }
    }

    if (matchedRawAccounts.length) {
        let nextAccounts = rawAccounts;
        if (normalizedAction === 'delete') {
            nextAccounts = rawAccounts.filter((entry) =>
                !matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })
            );
        } else if (normalizedAction === 'disable') {
            nextAccounts = rawAccounts.map((entry) =>
                matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })
                    ? { ...entry, status: 'disabled' }
                    : entry
            );
        } else if (normalizedAction === 'enable') {
            nextAccounts = rawAccounts.map((entry) => {
                if (!matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })) {
                    return entry;
                }
                const archiveMeta = findArchivedPppoeEntryMeta(archiveLookup, entry, defaultRouterId);
                if (!archiveMeta) {
                    return entry;
                }
                const previousStatusRaw = String(archiveMeta.previousStatus || '').trim().toLowerCase();
                if (archiveMeta.wasDisabledBeforeArchive === true && archiveMeta.disabledByArchive !== true) {
                    const nextStatus = previousStatusRaw === 'inactive'
                        ? 'disabled'
                        : (previousStatusRaw || 'disabled');
                    return { ...entry, status: nextStatus };
                }
                const nextStatus = previousStatusRaw && previousStatusRaw !== 'disabled' && previousStatusRaw !== 'inactive'
                    ? previousStatusRaw
                    : 'offline';
                return { ...entry, status: nextStatus };
            });
        }

        const nextSettings = {
            ...settings,
            pppoe: {
                ...(settings?.pppoe || {}),
                accounts: nextAccounts
            }
        };
        await saveIntegrationSettings(nextSettings, branchId);
    }

    return { processedEntries, skippedEntries };
};

const syncCustomerPppoeProfileForPlan = async ({
    branchId,
    customer = null,
    profile = '',
    routerId = '',
    source = 'customers-update',
    reason = 'plan-profile-sync'
} = {}) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    const username = String(customer?.pppoeUsername || '').trim();
    const usernameKey = normalizePppoeUsernameKey(username);
    const desiredProfile = String(profile || '').trim();
    if (!accountNumber || !usernameKey || !desiredProfile) {
        return { ok: false, skipped: true, reason: 'missing-pppoe-profile-context' };
    }

    const settings = await loadIntegrationSettings(branchId);
    const defaultRouterId = settings?.mikrotikDefaultId || '';
    const rawAccounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
    const matchedEntry = rawAccounts.find((entry) =>
        matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })
    ) || null;
    const resolvedRouterId = normalizePppoeRouterId(
        routerId || customer?.mikrotikId || matchedEntry?.routerId,
        defaultRouterId
    );
    const resolvedRouter = resolveMikrotikRouter(settings, resolvedRouterId);
    if (!resolvedRouter || !hasRouterCredentials(resolvedRouter)) {
        return {
            ok: false,
            warning: `Missing MikroTik router configuration for PPPoE account "${username}".`
        };
    }

    const secretId = normalizePppoeSecretId(matchedEntry?.secretId || matchedEntry?.['.id']);
    const creds = normalizeRouterCredentials(resolvedRouter);
    let client = null;
    try {
        const connection = await connectMikrotikClient(creds, {
            timeout: 8000,
            label: `plan-profile-sync:${accountNumber || username}`
        });
        client = connection.client;
        const api = connection.api;
        const secretMenu = api.menu('/ppp secret');
        const secrets = await secretMenu.get().catch(() => []);
        const matchedSecret = findRouterSecretByIdentity(secrets, { secretId, username });
        if (!matchedSecret) {
            return {
                ok: false,
                warning: `PPPoE "${username}" was not found on MikroTik.`
            };
        }

        const currentProfile = String(matchedSecret?.profile || '').trim();
        const nextSecretId = normalizePppoeSecretId(matchedSecret?.['.id'] || matchedSecret?.id || secretId);
        const customerStatus = normalizeCustomerStatus(customer?.status, STATUS_ACTIVE);
        const shouldEnableActiveSecret = customerStatus === STATUS_ACTIVE
            && String(matchedSecret?.disabled || '').trim().toLowerCase() === 'true';
        if (currentProfile !== desiredProfile || shouldEnableActiveSecret) {
            await updateRouterSecretProfile(secretMenu, {
                username,
                secretId: nextSecretId,
                profile: desiredProfile,
                disabled: customerStatus === STATUS_ACTIVE ? false : undefined,
                branchId,
                routerId: String(resolvedRouter?.id || resolvedRouterId || '').trim(),
                source,
                reason
            });
        }

        if (matchedEntry) {
            const nextAccounts = rawAccounts.map((entry) =>
                matchesStoredPppoeCustomer({ entry, accountNumber, usernameKey })
                    ? {
                        ...entry,
                        profile: desiredProfile,
                        routerId: normalizePppoeRouterId(entry?.routerId, resolvedRouterId),
                        secretId: normalizePppoeSecretId(entry?.secretId || entry?.['.id'] || nextSecretId)
                    }
                    : entry
            );
            await saveIntegrationSettings({
                ...settings,
                pppoe: {
                    ...(settings?.pppoe || {}),
                    accounts: dedupePppoeAccounts(nextAccounts, defaultRouterId || resolvedRouterId)
                }
            }, branchId);
        }

        return {
            ok: true,
            profile: desiredProfile,
            routerId: String(resolvedRouter?.id || resolvedRouterId || '').trim(),
            username,
            changed: currentProfile !== desiredProfile
        };
    } catch (error) {
        return {
            ok: false,
            warning: `Failed to update MikroTik PPPoE profile for "${username}": ${error?.message || 'Unknown error'}`
        };
    } finally {
        if (typeof client?.close === 'function') {
            await client.close().catch(() => {});
        }
    }
};

const disableCustomerPppoeAccountsForArchive = async ({ branchId, customer = null } = {}) => (
    manageCustomerPppoeAccounts({
        branchId,
        customer,
        action: 'disable',
        allowWarnings: true
    })
);

const restoreArchivedCustomerPppoeAccounts = async ({ branchId, customer = null, archiveEntries = [] } = {}) => (
    manageCustomerPppoeAccounts({
        branchId,
        customer,
        action: 'enable',
        archiveEntries,
        allowWarnings: true
    })
);

const removeCustomerPppoeAccounts = async ({ branchId, customer = null, archiveEntries = [], localOnly = false } = {}) => (
    manageCustomerPppoeAccounts({
        branchId,
        customer,
        action: 'delete',
        archiveEntries,
        allowWarnings: false,
        localOnly
    })
);

const deleteOptionalRows = async (connection, sql, params = []) => {
    try {
        await connection.query(sql, params);
    } catch (error) {
        if (!isOptionalSchemaError(error)) {
            throw error;
        }
    }
};

const loadOptionalRows = async (connection, sql, params = []) => {
    try {
        const [rows] = await connection.query(sql, params);
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        if (isOptionalSchemaError(error)) {
            return [];
        }
        throw error;
    }
};

const buildInsertRowStatement = (tableName, row = {}) => {
    if (!tableName || !row || typeof row !== 'object' || Array.isArray(row)) return null;
    const columns = Object.keys(row);
    if (!columns.length) return null;
    const escapedColumns = columns.map((column) => `\`${column}\``).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    return {
        sql: `INSERT INTO ${tableName} (${escapedColumns}) VALUES (${placeholders})`,
        params: columns.map((column) => row[column])
    };
};

const insertRows = async (connection, tableName, rows = []) => {
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
        const statement = buildInsertRowStatement(tableName, row);
        if (!statement) continue;
        await connection.query(statement.sql, statement.params);
    }
};

const dedupeRowsById = (rows = []) => {
    const seen = new Set();
    const list = [];
    rows.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const key = String(row?.id || '').trim() || JSON.stringify(row);
        if (seen.has(key)) return;
        seen.add(key);
        list.push(row);
    });
    return list;
};

const buildCustomerArchiveName = (customer = {}) => {
    const direct = String(customer?.name || '').trim();
    if (direct) return direct;
    const firstName = String(customer?.first_name || customer?.firstName || '').trim();
    const lastName = String(customer?.last_name || customer?.lastName || '').trim();
    return `${firstName} ${lastName}`.trim();
};

const buildCustomerArchiveContactNumber = (customer = {}) => (
    String(customer?.mobile_raw || customer?.mobile || customer?.contactNumber || customer?.contact || '').trim()
);

const buildCustomerArchiveAddressText = (customer = {}) => (
    [
        customer?.street,
        customer?.barangay,
        customer?.municipality,
        customer?.province
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .join(', ')
        .slice(0, 255)
);

const mapArchivedCustomerPayloadForJson = (customer = {}, branchId = null, fallbackAccountNumber = '') => {
    const accountNumber = String(customer?.accountNumber || customer?.account_number || fallbackAccountNumber || '').trim();
    const mapped = {
        accountNumber,
        branchId: Number(customer?.branchId ?? customer?.branch_id ?? branchId) || branchId || null,
        firstName: customer?.firstName ?? customer?.first_name ?? undefined,
        lastName: customer?.lastName ?? customer?.last_name ?? undefined,
        name: customer?.name ?? undefined,
        email: customer?.email ?? undefined,
        mobile: customer?.mobile ?? undefined,
        mobileRaw: customer?.mobileRaw ?? customer?.mobile_raw ?? undefined,
        street: customer?.street ?? undefined,
        barangay: customer?.barangay ?? undefined,
        municipality: customer?.municipality ?? undefined,
        province: customer?.province ?? undefined,
        area: customer?.area ?? undefined,
        mapPin: customer?.mapPin ?? customer?.map_pin ?? undefined,
        status: customer?.status ?? undefined,
        remarks: customer?.remarks ?? undefined,
        since: customer?.since ?? undefined,
        activationDate: customer?.activationDate ?? customer?.activation_date ?? undefined,
        planId: customer?.planId ?? customer?.plan_id ?? undefined,
        planName: customer?.planName ?? customer?.plan_name ?? undefined,
        planAmount: customer?.planAmount ?? customer?.plan_amount ?? undefined,
        planBilling: customer?.planBilling ?? customer?.plan_billing ?? undefined,
        planCategory: customer?.planCategory ?? customer?.plan_category ?? undefined,
        scheduledPlanId: customer?.scheduledPlanId ?? customer?.scheduled_plan_id ?? undefined,
        scheduledPlanName: customer?.scheduledPlanName ?? customer?.scheduled_plan_name ?? undefined,
        scheduledPlanAmount: customer?.scheduledPlanAmount ?? customer?.scheduled_plan_amount ?? undefined,
        scheduledPlanBilling: customer?.scheduledPlanBilling ?? customer?.scheduled_plan_billing ?? undefined,
        scheduledPlanCategory: customer?.scheduledPlanCategory ?? customer?.scheduled_plan_category ?? undefined,
        scheduledPlanApplyAt: customer?.scheduledPlanApplyAt ?? customer?.scheduled_plan_apply_at ?? undefined,
        scheduledPppoeProfile: customer?.scheduledPppoeProfile ?? customer?.scheduled_pppoe_profile ?? undefined,
        billDate: customer?.billDate ?? customer?.bill_date ?? undefined,
        dueDate: customer?.dueDate ?? customer?.due_date ?? undefined,
        prepaidExpirationAt: customer?.prepaidExpirationAt ?? customer?.prepaid_expiration_at ?? undefined,
        dueOffset: customer?.dueOffset ?? customer?.due_offset ?? undefined,
        creditLimit: customer?.creditLimit ?? customer?.credit_limit ?? undefined,
        loginUsername: customer?.loginUsername ?? customer?.login_username ?? undefined,
        loginPassword: customer?.loginPassword ?? customer?.login_password_hash ?? customer?.login_password ?? undefined,
        pppoeMode: customer?.pppoeMode ?? customer?.pppoe_mode ?? undefined,
        mikrotikId: customer?.mikrotikId ?? customer?.mikrotik_id ?? undefined,
        pppoeUsername: customer?.pppoeUsername ?? customer?.pppoe_username ?? undefined,
        pppoePassword: customer?.pppoePassword ?? customer?.pppoe_password ?? undefined,
        pppoeProfile: customer?.pppoeProfile ?? customer?.pppoe_profile ?? undefined,
        createdAt: customer?.createdAt ?? customer?.created_at ?? undefined,
        updatedAt: customer?.updatedAt ?? customer?.updated_at ?? new Date().toISOString()
    };
    return hydrateCustomerStatus(mapped);
};

const normalizeArchivedRecordType = (archive = {}) => {
    const rawType = String(
        archive?.recordType
        || archive?.payload?.metadata?.recordType
        || ''
    ).trim().toLowerCase();
    return rawType === 'draft' ? 'draft' : 'customer';
};

const toNullableArchiveText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const buildArchivedDraftSubmissionRow = (archive = {}, payload = {}, branchId = null) => {
    const draftSubmission = payload?.draftSubmission && typeof payload.draftSubmission === 'object' && !Array.isArray(payload.draftSubmission)
        ? payload.draftSubmission
        : null;
    if (!draftSubmission) {
        throw createError(400, 'Archived draft payload is incomplete.');
    }

    const submissionId = String(draftSubmission?.id || '').trim();
    if (!submissionId) {
        throw createError(400, 'Archived draft submission ID is missing.');
    }

    const submittedByUserId = String(draftSubmission?.submitted_by_user_id || '').trim();
    if (!submittedByUserId) {
        throw createError(400, 'Archived draft submitter is missing.');
    }

    const draftJson = typeof draftSubmission?.draft_json === 'string' && draftSubmission.draft_json.trim()
        ? draftSubmission.draft_json
        : '{}';
    const draftAccountNumber = String(
        draftSubmission?.draft_account_number
        || draftSubmission?.approved_customer_account_number
        || archive?.accountNumber
        || ''
    ).trim();

    return {
        id: submissionId,
        branch_id: Number(branchId) || Number(draftSubmission?.branch_id) || null,
        submitted_by_user_id: submittedByUserId,
        submitted_by_username: toNullableArchiveText(draftSubmission?.submitted_by_username, 100),
        submitted_by_name: toNullableArchiveText(draftSubmission?.submitted_by_name, 120),
        customer_name: toNullableArchiveText(draftSubmission?.customer_name, 200),
        contact_number: toNullableArchiveText(draftSubmission?.contact_number, 50),
        plan_name: toNullableArchiveText(draftSubmission?.plan_name, 120),
        area_name: toNullableArchiveText(draftSubmission?.area_name, 150),
        address_text: toNullableArchiveText(draftSubmission?.address_text, 255),
        draft_account_number: toNullableArchiveText(draftAccountNumber, 20),
        draft_json: draftJson,
        status: 'pending',
        submitted_at: toMysqlDateTime(draftSubmission?.submitted_at) || toMysqlDateTime(new Date()),
        reviewed_at: null,
        reviewed_by_user_id: null,
        reviewed_by_username: null,
        reviewed_by_name: null,
        decision_reason: null,
        approved_customer_account_number: toNullableArchiveText(draftSubmission?.approved_customer_account_number, 20)
    };
};

const ensureArchivedDraftCanBeRestored = async (connection, branchId, draftRow = {}) => {
    const conflictKeys = Array.from(
        new Set(
            [
                String(draftRow?.draft_account_number || '').trim(),
                String(draftRow?.approved_customer_account_number || '').trim()
            ].filter(Boolean)
        )
    );
    const accountConflictSql = conflictKeys.length
        ? `
            OR COALESCE(TRIM(draft_account_number), '') IN (${buildSqlPlaceholders(conflictKeys.length)})
            OR COALESCE(TRIM(approved_customer_account_number), '') IN (${buildSqlPlaceholders(conflictKeys.length)})
        `
        : '';
    const [existingRows] = await connection.query(
        `SELECT id
         FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
         WHERE branch_id = ?
           AND (
               id = ?
               ${accountConflictSql}
           )
         LIMIT 1`,
        [branchId, String(draftRow?.id || '').trim(), ...conflictKeys, ...conflictKeys]
    );
    if (Array.isArray(existingRows) && existingRows.length) {
        throw createError(409, 'A customer draft with the same ID or account number already exists.');
    }
};

const collectCustomerArchiveSnapshot = async (
    connection,
    {
        branchId,
        accountNumber,
        deleteDraftRows = true,
        cleanupWarning = ''
    } = {}
) => {
    const [customerRows] = await connection.query(
        `SELECT *
         FROM customers
         WHERE account_number = ?
           AND branch_id = ?
         LIMIT 1`,
        [accountNumber, branchId]
    );
    const customer = Array.isArray(customerRows) && customerRows.length ? customerRows[0] : null;
    if (!customer) return null;

    const paymentEntries = await loadOptionalRows(
        connection,
        `SELECT *
         FROM payment_entries
         WHERE branch_id = ?
           AND account_number = ?
         ORDER BY recorded_at DESC, id DESC`,
        [branchId, accountNumber]
    );
    const tickets = await loadOptionalRows(
        connection,
        `SELECT *
         FROM tickets
         WHERE branch_id = ?
           AND account_number = ?
         ORDER BY id ASC`,
        [branchId, accountNumber]
    );
    const ticketIds = tickets
        .map((row) => Number(row?.id))
        .filter((value) => Number.isInteger(value) && value > 0);
    const ticketNumbers = tickets
        .map((row) => String(row?.ticket_number || '').trim())
        .filter(Boolean);
    const jobsByTicketId = ticketIds.length
        ? await loadOptionalRows(
            connection,
            `SELECT *
             FROM jobs
             WHERE branch_id = ?
               AND ticket_id IN (${buildSqlPlaceholders(ticketIds.length)})
             ORDER BY id ASC`,
            [branchId, ...ticketIds]
        )
        : [];
    const jobsByTicketNumber = ticketNumbers.length
        ? await loadOptionalRows(
            connection,
            `SELECT *
             FROM jobs
             WHERE branch_id = ?
               AND ticket_number IN (${buildSqlPlaceholders(ticketNumbers.length)})
             ORDER BY id ASC`,
            [branchId, ...ticketNumbers]
        )
        : [];
    const jobs = dedupeRowsById([...jobsByTicketId, ...jobsByTicketNumber]);
    const paymentConfirmationQueue = await loadOptionalRows(
        connection,
        `SELECT *
         FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
         WHERE branch_id = ?
           AND account_number = ?
         ORDER BY submitted_at DESC, id DESC`,
        [branchId, accountNumber]
    );
    const smsMessages = await loadOptionalRows(
        connection,
        `SELECT *
         FROM sms_messages
         WHERE branch_id = ?
           AND customer_account_number = ?
         ORDER BY id ASC`,
        [branchId, accountNumber]
    );
    const smsAutomationRuns = await loadOptionalRows(
        connection,
        `SELECT *
         FROM sms_automation_runs
         WHERE branch_id = ?
           AND customer_account_number = ?
         ORDER BY id ASC`,
        [branchId, accountNumber]
    );
    const ponNapConnections = await loadOptionalRows(
        connection,
        `SELECT *
         FROM pon_nap_connections
         WHERE customer_account_number = ?
         ORDER BY id ASC`,
        [accountNumber]
    );
    const customerDraftSubmissions = deleteDraftRows
        ? await loadOptionalRows(
            connection,
            `SELECT *
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE branch_id = ?
               AND (
                   draft_account_number = ?
                   OR approved_customer_account_number = ?
               )
             ORDER BY submitted_at DESC, id DESC`,
            [branchId, accountNumber, accountNumber]
        )
        : [];
    const proofFilePaths = Array.from(
        new Set(
            paymentConfirmationQueue
                .map((row) => resolveUploadFilePath(row?.proof_image_url))
                .filter(Boolean)
        )
    );

    return {
        customer,
        paymentEntries,
        tickets,
        jobs,
        paymentConfirmationQueue,
        smsMessages,
        smsAutomationRuns,
        ponNapConnections,
        customerDraftSubmissions,
        proofFilePaths,
        customerName: buildCustomerArchiveName(customer),
        contactNumber: buildCustomerArchiveContactNumber(customer),
        addressText: buildCustomerArchiveAddressText(customer),
        planName: String(customer?.plan_name || '').trim(),
        areaName: String(customer?.area || '').trim(),
        cleanupWarning: String(cleanupWarning || '').trim()
    };
};

const restoreArchivedCustomerRecord = async (
    archiveId,
    {
        branchId,
        restoredBy = {}
    } = {}
) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const archive = await getCustomerArchiveById(archiveId, {
        branchId: scopedBranchId,
        includePayload: true
    });
    if (!archive) {
        throw createError(404, 'Archived record not found.');
    }
    if (archive.restoredAt) {
        throw createError(409, 'Archived record was already restored.');
    }

    const payload = archive.payload && typeof archive.payload === 'object' && !Array.isArray(archive.payload)
        ? archive.payload
        : {};
    const recordType = normalizeArchivedRecordType({ ...archive, payload });
    if (recordType === 'draft') {
        if (!(await isRelationalReady())) {
            throw createError(400, 'Draft archive restore is only available after MySQL schema setup.');
        }
        const pool = await getPool();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const draftRow = buildArchivedDraftSubmissionRow(archive, payload, scopedBranchId);
            await ensureArchivedDraftCanBeRestored(connection, scopedBranchId, draftRow);
            await insertRows(connection, CUSTOMER_DRAFT_SUBMISSIONS_TABLE, [draftRow]);

            const [restoreResult] = await connection.query(
                `UPDATE ${CUSTOMER_ARCHIVES_TABLE}
                 SET restored_at = CURRENT_TIMESTAMP,
                     restored_by_user_id = ?,
                     restored_by_username = ?,
                     restored_by_name = ?
                 WHERE id = ?
                   AND branch_id = ?
                   AND restored_at IS NULL`,
                [
                    String(restoredBy?.id || '').trim() || null,
                    String(restoredBy?.username || '').trim() || null,
                    String(restoredBy?.name || '').trim() || null,
                    String(archive.id || '').trim(),
                    scopedBranchId
                ]
            );
            if (!restoreResult?.affectedRows) {
                throw createError(409, 'Archived record was already restored.');
            }

            await connection.commit();
        } catch (error) {
            await connection.rollback().catch(() => {});
            throw error;
        } finally {
            connection.release();
        }

        triggerBranchServiceRefreshSafe(scopedBranchId, 'customer-drafts-archive-restore');
        return {
            archiveId: String(archive.id || '').trim(),
            accountNumber: String(archive.accountNumber || '').trim(),
            recordType: 'draft'
        };
    }

    const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const customerRow = payload.customer && typeof payload.customer === 'object' && !Array.isArray(payload.customer)
        ? payload.customer
        : null;
    if (!customerRow) {
        throw createError(400, 'Archived customer payload is incomplete.');
    }

    const accountNumber = String(customerRow?.account_number || archive.accountNumber || '').trim();
    if (!accountNumber) {
        throw createError(400, 'Archived customer account number is missing.');
    }
    const archivedCustomerBranchId = Number(customerRow?.branch_id ?? customerRow?.branchId ?? scopedBranchId);
    if (archivedCustomerBranchId !== scopedBranchId) {
        throw createError(403, 'Archived customer does not belong to this branch.');
    }

    if (!(await isRelationalReady())) {
        const customers = await readCustomers(scopedBranchId);
        const existing = customers.find((customer) =>
            String(customer?.accountNumber || '').trim() === accountNumber &&
            Number(customer?.branchId || scopedBranchId) === scopedBranchId
        );
        if (existing) {
            throw createError(409, `Customer account ${accountNumber} already exists.`);
        }
        const restoredCustomer = mapArchivedCustomerPayloadForJson(customerRow, scopedBranchId, accountNumber);
        await writeCustomers([...customers, restoredCustomer], scopedBranchId);
        const marked = await markCustomerArchiveRestored(archive.id, {
            branchId: scopedBranchId,
            restoredBy
        });
        if (!marked) {
            throw createError(409, 'Archived customer was already restored.');
        }
        triggerBranchServiceRefreshSafe(scopedBranchId, 'customers-archive-restore');
        return {
            archiveId: String(archive.id || '').trim(),
            accountNumber,
            recordType: 'customer'
        };
    }

    const pool = await getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [existingRows] = await connection.query(
            `SELECT account_number
             FROM customers
             WHERE branch_id = ?
               AND account_number = ?
             LIMIT 1`,
            [scopedBranchId, accountNumber]
        );
        if (Array.isArray(existingRows) && existingRows.length) {
            throw createError(409, `Customer account ${accountNumber} already exists.`);
        }

        await insertRows(connection, 'customers', [customerRow]);
        await insertRows(connection, 'payment_entries', payload.paymentEntries);
        await insertRows(connection, PAYMENT_CONFIRMATION_QUEUE_TABLE, payload.paymentConfirmationQueue);
        await insertRows(connection, 'sms_messages', payload.smsMessages);
        await insertRows(connection, 'sms_automation_runs', payload.smsAutomationRuns);
        await insertRows(connection, CUSTOMER_DRAFT_SUBMISSIONS_TABLE, payload.customerDraftSubmissions);
        await insertRows(connection, 'tickets', payload.tickets);
        await insertRows(connection, 'jobs', payload.jobs);
        await insertRows(connection, 'pon_nap_connections', payload.ponNapConnections);

        const [restoreResult] = await connection.query(
            `UPDATE ${CUSTOMER_ARCHIVES_TABLE}
             SET restored_at = CURRENT_TIMESTAMP,
                 restored_by_user_id = ?,
                 restored_by_username = ?,
                 restored_by_name = ?
             WHERE id = ?
               AND branch_id = ?
               AND restored_at IS NULL`,
            [
                String(restoredBy?.id || '').trim() || null,
                String(restoredBy?.username || '').trim() || null,
                String(restoredBy?.name || '').trim() || null,
                String(archive.id || '').trim(),
                scopedBranchId
            ]
        );
        if (!restoreResult?.affectedRows) {
            throw createError(409, 'Archived customer was already restored.');
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }

    const restorePppoeResult = await restoreArchivedCustomerPppoeAccounts({
        branchId: scopedBranchId,
        customer: {
            accountNumber,
            pppoeUsername: customerRow?.pppoe_username || customerRow?.pppoeUsername || ''
        },
        archiveEntries: Array.isArray(metadata?.pppoeArchive?.entries) ? metadata.pppoeArchive.entries : []
    });
    const warning = buildPppoeActionWarning('enable', restorePppoeResult?.skippedEntries || []);

    triggerBranchServiceRefreshSafe(scopedBranchId, 'customers-archive-restore');
    return {
        archiveId: String(archive.id || '').trim(),
        accountNumber,
        recordType: 'customer',
        warning: warning || undefined
    };
};

const deleteArchivedCustomerRecord = async (
    archiveId,
    {
        branchId
    } = {}
) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const archive = await getCustomerArchiveById(archiveId, {
        branchId: scopedBranchId,
        includePayload: true
    });
    if (!archive) {
        throw createError(404, 'Archived record not found.');
    }
    if (archive.restoredAt) {
        throw createError(409, 'Archived record was already restored.');
    }

    const payload = archive.payload && typeof archive.payload === 'object' && !Array.isArray(archive.payload)
        ? archive.payload
        : {};
    const recordType = normalizeArchivedRecordType({ ...archive, payload });
    if (recordType === 'draft') {
        const deleted = await deleteCustomerArchivePermanently(archiveId, {
            branchId: scopedBranchId
        });
        triggerBranchServiceRefreshSafe(scopedBranchId, 'customer-drafts-archive-delete');
        return {
            ...deleted,
            recordType: 'draft'
        };
    }

    const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {};
    const customerRow = payload.customer && typeof payload.customer === 'object' && !Array.isArray(payload.customer)
        ? payload.customer
        : {};

    await removeCustomerPppoeAccounts({
        branchId: scopedBranchId,
        customer: {
            accountNumber: String(customerRow?.account_number || archive.accountNumber || '').trim(),
            pppoeUsername: String(customerRow?.pppoe_username || customerRow?.pppoeUsername || '').trim()
        },
        archiveEntries: Array.isArray(metadata?.pppoeArchive?.entries) ? metadata.pppoeArchive.entries : []
    });

    const deleted = await deleteCustomerArchivePermanently(archiveId, {
        branchId: scopedBranchId
    });
    triggerBranchServiceRefreshSafe(scopedBranchId, 'customers-archive-delete');
    return {
        ...deleted,
        recordType: 'customer'
    };
};

const purgeExpiredArchivedCustomerRecords = async () => {
    if (!(await isRelationalReady())) {
        const result = await purgeExpiredCustomerArchives();
        return { purgedCount: Number(result?.purgedCount || 0), failed: [] };
    }

    await ensureCustomerArchivesTable();
    const [rows] = await query(
        `SELECT
            id,
            branch_id AS branchId
         FROM ${CUSTOMER_ARCHIVES_TABLE}
         WHERE restored_at IS NULL
           AND purge_after <= CURRENT_TIMESTAMP
         ORDER BY purge_after ASC, id ASC`
    );
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) {
        return { purgedCount: 0, failed: [] };
    }

    let purgedCount = 0;
    const failed = [];
    for (const item of items) {
        try {
            await deleteArchivedCustomerRecord(String(item?.id || '').trim(), {
                branchId: Number(item?.branchId || 0)
            });
            purgedCount += 1;
        } catch (error) {
            failed.push({
                archiveId: String(item?.id || '').trim(),
                message: error?.message || 'Unable to purge archived customer.'
            });
        }
    }

    return { purgedCount, failed };
};

const scheduleCustomerArchiveCleanupWithPppoe = ({ logger = console } = {}) => {
    if (archiveCleanupInterval) return archiveCleanupInterval;

    const runCleanup = async () => {
        try {
            const result = await purgeExpiredArchivedCustomerRecords();
            if (Number(result?.purgedCount || 0) > 0) {
                logger.info?.(`[customer-archive] Purged ${result.purgedCount} expired archived customer record(s).`);
            }
            if (Array.isArray(result?.failed) && result.failed.length) {
                logger.warn?.('[customer-archive] Some archive purges failed:', result.failed);
            }
        } catch (error) {
            logger.warn?.('[customer-archive] Cleanup failed:', error?.message || error);
        }
    };

    runCleanup();
    archiveCleanupInterval = setInterval(runCleanup, ARCHIVE_CLEANUP_INTERVAL_MS);
    archiveCleanupInterval.unref?.();
    return archiveCleanupInterval;
};

const mapCustomerRow = (row) => ({
    accountNumber: row.accountNumber,
    planId: row.planId || undefined,
    planName: row.planName,
    planAmount: row.planAmount != null ? Number(row.planAmount) : undefined,
    status: row.status || undefined,
    mobileRaw: row.mobileRaw || undefined,
    email: row.email || undefined,
    street: row.street || undefined,
    barangay: row.barangay || undefined,
    municipality: row.municipality || undefined,
    province: row.province || undefined,
    area: row.area || undefined,
    mapPin: row.mapPin || undefined,
    billDate: row.billDate || undefined,
    dueDate: row.dueDate || undefined,
    prepaidExpirationAt: row.prepaidExpirationAt || undefined,
    remarks: row.remarks || undefined,
    since: row.since || undefined,
    activationDate: row.activationDate || undefined,
    planBilling: row.planBilling || undefined,
    name: row.name || undefined,
    mobile: row.mobile || undefined,
    pppoeMode: row.pppoeMode || undefined,
    mikrotikId: row.mikrotikId || row.routerId || undefined,
    pppoeUsername: row.pppoeUsername || undefined,
    pppoePassword: row.pppoePassword || undefined,
    pppoeProfile: row.pppoeProfile || undefined,
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    creditLimit: row.creditLimit != null ? Number(row.creditLimit) : undefined,
    loginUsername: row.loginUsername || undefined,
    loginPassword: row.loginPassword || undefined,
    dueOffset: row.dueOffset != null ? Number(row.dueOffset) : undefined,
    planCategory: row.planCategory || undefined,
    scheduledPlanId: row.scheduledPlanId || undefined,
    scheduledPlanName: row.scheduledPlanName || undefined,
    scheduledPlanAmount: row.scheduledPlanAmount != null ? Number(row.scheduledPlanAmount) : undefined,
    scheduledPlanBilling: row.scheduledPlanBilling || undefined,
    scheduledPlanCategory: row.scheduledPlanCategory || undefined,
    scheduledPlanApplyAt: row.scheduledPlanApplyAt || undefined,
    scheduledPppoeProfile: row.scheduledPppoeProfile || undefined,
    branchId: row.branchId,
    createdAt: row.createdAt || undefined,
    updatedAt: row.updatedAt || undefined
});

const mapPaymentRow = (row) => ({
    id: row.id,
    amount: row.amount != null ? Number(row.amount) : 0,
    date: row.date || row.recordedAt || null,
    kind: row.kind || undefined,
    reference: row.reference || undefined,
    orNumber: row.orNumber || undefined,
    description: row.description || undefined,
    type: row.type || undefined,
    direction: row.direction || undefined,
    recordedAt: row.recordedAt || undefined,
    recordedBy: row.recordedByUserId ? {
        id: row.recordedByUserId,
        username: row.recordedByUsername || undefined,
        name: row.recordedByName || undefined,
        role: row.recordedByRole || undefined
    } : row.recordedByUsername || row.recordedByName ? {
        id: row.recordedByUserId || undefined,
        username: row.recordedByUsername || undefined,
        name: row.recordedByName || undefined,
        role: row.recordedByRole || undefined
    } : undefined,
    payer: row.payer || undefined,
    fingerprint: row.fingerprint || undefined,
    status: row.status || undefined,
    paymentMethod: row.paymentMethod || undefined,
    xenditId: row.xenditId || undefined
});

const mapPlanRow = (row) => ({
    id: row.id,
    category: row.category || '',
    label: row.label || '',
    name: row.name || '',
    description: row.description || '',
    profile: row.profile || '',
    profileBindings: normalizePlanProfileBindings(row.profileBindings || row.profile_bindings),
    price: row.price != null ? Number(row.price) : 0,
    priceSuffix: row.priceSuffix || '',
    validity: row.validity != null ? Number(row.validity) : undefined,
    createdAt: row.createdAt || undefined,
    updatedAt: row.updatedAt || undefined
});

const readCustomers = async (branchId = null) => {
    if (await isRelationalReady()) {
        const sql = `
            SELECT
                account_number AS accountNumber,
                branch_id AS branchId,
                first_name AS firstName,
                last_name AS lastName,
                name,
                email,
                mobile,
                mobile_raw AS mobileRaw,
                street,
                barangay,
                municipality,
                province,
                area,
                map_pin AS mapPin,
                status,
                remarks,
                since,
                activation_date AS activationDate,
                plan_id AS planId,
                plan_name AS planName,
                plan_amount AS planAmount,
                plan_billing AS planBilling,
                plan_category AS planCategory,
                scheduled_plan_id AS scheduledPlanId,
                scheduled_plan_name AS scheduledPlanName,
                scheduled_plan_amount AS scheduledPlanAmount,
                scheduled_plan_billing AS scheduledPlanBilling,
                scheduled_plan_category AS scheduledPlanCategory,
                scheduled_plan_apply_at AS scheduledPlanApplyAt,
                scheduled_pppoe_profile AS scheduledPppoeProfile,
                bill_date AS billDate,
                due_date AS dueDate,
                prepaid_expiration_at AS prepaidExpirationAt,
                due_offset AS dueOffset,
                credit_limit AS creditLimit,
                login_username AS loginUsername,
                login_password_hash AS loginPassword,
                pppoe_mode AS pppoeMode,
                mikrotik_id AS mikrotikId,
                pppoe_username AS pppoeUsername,
                pppoe_password AS pppoePassword,
                pppoe_profile AS pppoeProfile,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM customers
            ${branchId ? 'WHERE branch_id = ?' : ''}
        `;
        const [rows] = await query(sql, branchId ? [branchId] : []);
        return (rows || []).map(mapCustomerRow).map(hydrateCustomerStatus);
    }
    const data = await readJson(STORE_KEYS.customers, []);
    return Array.isArray(data) ? data.map(hydrateCustomerStatus) : [];
};

const writeCustomers = async (customers, branchId = null) => {
    if (await isRelationalReady()) {
        for (const customer of customers) {
            const resolvedBranchId = customer.branchId || branchId;
            if (!resolvedBranchId) {
                throw new Error('Branch ID is required when saving customers to MySQL.');
            }
            const existingStatusState = parseStoredCustomerStatus(customer.statusRaw) || {
                status: STATUS_ACTIVE,
                statusMode: STATUS_MODE_AUTO
            };
            const statusState = resolveCustomerStatusState(customer.status, customer.statusMode, existingStatusState);
            const loginPassword = String(customer.loginPassword || '').trim() || null;
            await query(
                `INSERT INTO customers (
                    account_number, branch_id, first_name, last_name, name, email, mobile, mobile_raw,
                    street, barangay, municipality, province, area, map_pin, status, remarks, since,
                    activation_date, plan_id, plan_name, plan_amount, plan_billing, plan_category,
                    scheduled_plan_id, scheduled_plan_name, scheduled_plan_amount, scheduled_plan_billing,
                    scheduled_plan_category, scheduled_plan_apply_at, scheduled_pppoe_profile,
                    bill_date, due_date, prepaid_expiration_at, due_offset, credit_limit,
                    login_username, login_password_hash, pppoe_mode, mikrotik_id, pppoe_username, pppoe_password, pppoe_profile
                 ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?
                 )
                 ON DUPLICATE KEY UPDATE
                    first_name = VALUES(first_name),
                    last_name = VALUES(last_name),
                    name = VALUES(name),
                    email = VALUES(email),
                    mobile = VALUES(mobile),
                    mobile_raw = VALUES(mobile_raw),
                    street = VALUES(street),
                    barangay = VALUES(barangay),
                    municipality = VALUES(municipality),
                    province = VALUES(province),
                    area = VALUES(area),
                    map_pin = VALUES(map_pin),
                    status = VALUES(status),
                    remarks = VALUES(remarks),
                    since = VALUES(since),
                    activation_date = VALUES(activation_date),
                    plan_id = VALUES(plan_id),
                    plan_name = VALUES(plan_name),
                    plan_amount = VALUES(plan_amount),
                    plan_billing = VALUES(plan_billing),
                    plan_category = VALUES(plan_category),
                    scheduled_plan_id = VALUES(scheduled_plan_id),
                    scheduled_plan_name = VALUES(scheduled_plan_name),
                    scheduled_plan_amount = VALUES(scheduled_plan_amount),
                    scheduled_plan_billing = VALUES(scheduled_plan_billing),
                    scheduled_plan_category = VALUES(scheduled_plan_category),
                    scheduled_plan_apply_at = VALUES(scheduled_plan_apply_at),
                    scheduled_pppoe_profile = VALUES(scheduled_pppoe_profile),
                    bill_date = VALUES(bill_date),
                    due_date = VALUES(due_date),
                    prepaid_expiration_at = VALUES(prepaid_expiration_at),
                    due_offset = VALUES(due_offset),
                    credit_limit = VALUES(credit_limit),
                    login_username = VALUES(login_username),
                    login_password_hash = VALUES(login_password_hash),
                    pppoe_mode = VALUES(pppoe_mode),
                    mikrotik_id = VALUES(mikrotik_id),
                    pppoe_username = VALUES(pppoe_username),
                    pppoe_password = VALUES(pppoe_password),
                    pppoe_profile = VALUES(pppoe_profile)`,
                [
                    String(customer.accountNumber || '').trim(),
                    resolvedBranchId,
                    customer.firstName || null,
                    customer.lastName || null,
                    customer.name || null,
                    customer.email || null,
                    customer.mobile || null,
                    customer.mobileRaw || null,
                    customer.street || null,
                    customer.barangay || null,
                    customer.municipality || null,
                    customer.province || null,
                    customer.area || null,
                    customer.mapPin || null,
                    statusState.stored || null,
                    customer.remarks || null,
                    customer.since || null,
                    customer.activationDate || null,
                    customer.planId || null,
                    customer.planName || null,
                    customer.planAmount != null ? Number(customer.planAmount) : null,
                    customer.planBilling || null,
                    customer.planCategory || null,
                    customer.scheduledPlanId || null,
                    customer.scheduledPlanName || null,
                    customer.scheduledPlanAmount != null ? Number(customer.scheduledPlanAmount) : null,
                    customer.scheduledPlanBilling || null,
                    customer.scheduledPlanCategory || null,
                    toMysqlDateTime(customer.scheduledPlanApplyAt),
                    customer.scheduledPppoeProfile || null,
                    customer.billDate || null,
                    customer.dueDate || null,
                    toMysqlDateTime(customer.prepaidExpirationAt),
                    Number.isFinite(Number(customer.dueOffset)) ? Number(customer.dueOffset) : null,
                    Number.isFinite(Number(customer.creditLimit)) ? Number(customer.creditLimit) : null,
                    customer.loginUsername || null,
                    loginPassword,
                    customer.pppoeMode || null,
                    customer.mikrotikId || null,
                    customer.pppoeUsername || null,
                    customer.pppoePassword != null ? String(customer.pppoePassword) : null,
                    customer.pppoeProfile || null
                ]
            );
        }
        return;
    }
    const serialized = Array.isArray(customers)
        ? customers.map((customer) => {
            if (!customer || typeof customer !== 'object') return customer;
            const existingStatusState = parseStoredCustomerStatus(customer.statusRaw) || {
                status: STATUS_ACTIVE,
                statusMode: STATUS_MODE_AUTO
            };
            const statusState = resolveCustomerStatusState(customer.status, customer.statusMode, existingStatusState);
            const { statusRaw, ...rest } = customer;
            return {
                ...rest,
                status: statusState.stored,
                statusMode: statusState.statusMode
            };
        })
        : customers;
    await writeJson(STORE_KEYS.customers, serialized);
};

const sanitizeCustomerPayload = (customer) => {
    if (!customer) return null;
    const normalized = hydrateCustomerStatus(customer);
    const { loginPassword, statusRaw, statusMode, ...rest } = normalized;
    return rest;
};

const sanitizeCustomerForAdmin = (customer) => {
    if (!customer || typeof customer !== 'object') return customer;
    const normalized = hydrateCustomerStatus(customer);
    const { loginPassword, statusRaw, statusMode, ...rest } = normalized;
    return {
        ...rest,
        loginPassword: String(loginPassword || ''),
        loginPasswordSet: Boolean(String(loginPassword || '').trim())
    };
};

const createCustomerSession = async (customer) => {
    await loadCustomerSessions();
    const accountNumber = String(customer?.accountNumber || '').trim();
    if (!accountNumber) return null;
    const sessionId = crypto.randomBytes(16).toString('hex');
    customerSessions.set(sessionId, { accountNumber, createdAt: Date.now() });
    await persistCustomerSessionsSafe();
    return sessionId;
};

const getCustomerFromSession = async (req, res = null) => {
    const session = await getCustomerSession(req, res);
    if (!session?.accountNumber) return null;
    if (await isRelationalReady()) {
        const [rows] = await query(
            `SELECT
                account_number AS accountNumber,
                branch_id AS branchId,
                first_name AS firstName,
                last_name AS lastName,
                name,
                email,
                mobile,
                mobile_raw AS mobileRaw,
                street,
                barangay,
                municipality,
                province,
                area,
                map_pin AS mapPin,
                status,
                remarks,
                since,
                activation_date AS activationDate,
                plan_id AS planId,
                plan_name AS planName,
                plan_amount AS planAmount,
                plan_billing AS planBilling,
                plan_category AS planCategory,
                scheduled_plan_id AS scheduledPlanId,
                scheduled_plan_name AS scheduledPlanName,
                scheduled_plan_amount AS scheduledPlanAmount,
                scheduled_plan_billing AS scheduledPlanBilling,
                scheduled_plan_category AS scheduledPlanCategory,
                scheduled_plan_apply_at AS scheduledPlanApplyAt,
                scheduled_pppoe_profile AS scheduledPppoeProfile,
                bill_date AS billDate,
                due_date AS dueDate,
                prepaid_expiration_at AS prepaidExpirationAt,
                due_offset AS dueOffset,
                credit_limit AS creditLimit,
                login_username AS loginUsername,
                login_password_hash AS loginPassword,
                pppoe_mode AS pppoeMode,
                mikrotik_id AS mikrotikId,
                pppoe_username AS pppoeUsername,
                pppoe_password AS pppoePassword,
                pppoe_profile AS pppoeProfile
            FROM customers
            WHERE account_number = ?
            LIMIT 1`,
            [session.accountNumber]
        );
        if (!rows || !rows.length) return null;
        return sanitizeCustomerPayload(mapCustomerRow(rows[0]));
    }
    const customers = await readCustomers();
    const match = customers.find((customer) =>
        String(customer?.accountNumber || '').trim() === session.accountNumber
    );
    if (!match) return null;
    return sanitizeCustomerPayload(match);
};

const requireCustomer = async (req, res, next) => {
    try {
        const customer = await getCustomerFromSession(req, res);
        if (!customer) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }
        req.customer = customer;
        next();
    } catch (error) {
        next(error);
    }
};

const formatDateOnly = (d) => {
    if (!(d instanceof Date) || isNaN(d)) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const parseHostOnly = (hostValue = '') => {
    const value = String(hostValue || '').trim().toLowerCase();
    if (!value) return '';
    if (value.startsWith('[')) {
        const closeIndex = value.indexOf(']');
        return closeIndex >= 0 ? value.slice(0, closeIndex + 1) : value;
    }
    const colonIndex = value.indexOf(':');
    return colonIndex >= 0 ? value.slice(0, colonIndex) : value;
};

const isLocalhostHost = (hostValue = '') => LOCALHOST_HOSTS.has(parseHostOnly(hostValue));

const isLocalhostHttpUrl = (urlValue = '') => {
    try {
        const parsed = new URL(String(urlValue || '').trim());
        return isLocalhostHost(parsed.hostname);
    } catch {
        return false;
    }
};
const readCloudflaredHostname = () => {
    if (cachedCloudflaredHostname !== undefined) return cachedCloudflaredHostname;
    try {
        const filePath = path.join(__dirname, '.cloudflared', 'config.yml');
        const raw = fs.readFileSync(filePath, 'utf8');
        const match = raw.match(/^\s*-\s*hostname:\s*([^\s#]+)\s*$/m) || raw.match(/^\s*hostname:\s*([^\s#]+)\s*$/m);
        const host = String(match?.[1] || '').trim().toLowerCase();
        cachedCloudflaredHostname = host || '';
    } catch {
        cachedCloudflaredHostname = '';
    }
    return cachedCloudflaredHostname;
};

const resolveExternalBaseUrl = (req) => {
    const envBaseUrl = sanitizeString(
        process.env.PUBLIC_BASE_URL ||
        process.env.CENTRAL_URL ||
        process.env.APP_BASE_URL ||
        ''
    );
    if (ABSOLUTE_HTTP_URL_PATTERN.test(envBaseUrl) && !isLocalhostHttpUrl(envBaseUrl)) {
        return envBaseUrl.replace(/\/+$/, '');
    }

    const protoHeader = String(req.headers['x-forwarded-proto'] || '');
    const protocol = req.secure || protoHeader.includes('https') ? 'https' : 'http';
    const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const requestHostRaw = sanitizeString(req.get('host') || '');
    const requestHostOnly = parseHostOnly(requestHostRaw);
    const forwardedHostOnly = parseHostOnly(forwardedHostRaw);

    if (requestHostRaw && requestHostOnly && !isLocalhostHost(requestHostOnly)) {
        return `${protocol}://${requestHostRaw}`;
    }
    if (forwardedHostRaw && forwardedHostOnly && !isLocalhostHost(forwardedHostOnly)) {
        return `${protocol}://${forwardedHostRaw}`;
    }
    const tunnelHostname = readCloudflaredHostname();
    if (tunnelHostname && !isLocalhostHost(tunnelHostname)) {
        return `https://${tunnelHostname}`;
    }
    return `${protocol}://${requestHostRaw || forwardedHostRaw || 'localhost:3000'}`;
};

const buildXenditRedirectUrl = (req, options = {}) => {
    const providedValue = sanitizeString(options.provided);
    const statusValue = String(options.status || '').toLowerCase() === 'paid' ? 'paid' : 'failed';
    const baseUrl = resolveExternalBaseUrl(req);
    const fallbackPath = statusValue === 'paid' ? '/payment/success' : '/payment/failed';
    const candidates = [providedValue].filter(Boolean);
    const buildFallbackUrl = (targetValue = '') => {
        const fallbackUrl = new URL(fallbackPath, baseUrl);
        const target = sanitizeString(targetValue);
        if (target) fallbackUrl.searchParams.set('target', target);
        if (statusValue === 'paid') {
            const receipt = options.receipt && typeof options.receipt === 'object' ? options.receipt : {};
            const mappings = [
                ['account', receipt.accountNumber],
                ['reference', receipt.reference],
                ['amount', receipt.amount],
                ['method', receipt.method],
                ['description', receipt.description],
                ['mode', receipt.paymentMode]
            ];
            mappings.forEach(([key, value]) => {
                const text = sanitizeString(value == null ? '' : String(value));
                if (text) fallbackUrl.searchParams.set(key, text);
            });
        }
        return fallbackUrl.toString();
    };

    for (const selected of candidates) {
        if (ABSOLUTE_HTTP_URL_PATTERN.test(selected)) {
            if (isLocalhostHttpUrl(selected)) continue;
            if (statusValue === 'paid') return buildFallbackUrl(selected);
            return selected;
        }
        if (ABSOLUTE_SCHEME_URL_PATTERN.test(selected)) {
            return buildFallbackUrl(selected);
        }
        if (selected.startsWith('/')) {
            const absoluteTarget = new URL(selected, baseUrl).toString();
            if (statusValue === 'paid') return buildFallbackUrl(absoluteTarget);
            return absoluteTarget;
        }
    }
    return buildFallbackUrl();
};

const extractDisplayReferenceFromXenditIdentifier = (value) => {
    const normalized = sanitizeString(value);
    if (!normalized) return '';
    const tagged = normalized.match(/^(?:acct|cust)-([^-]+)-(.+)$/i);
    if (!tagged || !tagged[2]) return normalized;
    const trailingToken = String(tagged[2]).split('-').filter(Boolean).pop();
    return sanitizeString(trailingToken || tagged[2]);
};

const parseDateTimeValue = (value) => {
    if (value instanceof Date) {
        return isNaN(value) ? null : new Date(value.getTime());
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(' ', 'T');
    const parsed = new Date(normalized);
    return isNaN(parsed) ? null : parsed;
};

const toMysqlDateTime = (value) => {
    const parsed = parseDateTimeValue(value);
    if (!parsed) return null;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    const sec = String(parsed.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
};

const clampDay = (year, monthIndex, day) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return Math.min(day, lastDay);
};

const parseBillingDay = (customer) => {
    const raw = customer?.billDate;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) return numeric;
    const parsed = new Date(raw);
    if (!isNaN(parsed)) return parsed.getDate();
    return null;
};

const deriveDueOffset = (customer) => {
    const raw = Number(customer?.dueOffset);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    if (customer?.billDate && customer?.dueDate) {
        const bill = new Date(customer.billDate);
        const due = new Date(customer.dueDate);
        if (!isNaN(bill) && !isNaN(due)) {
            const diff = Math.round((due - bill) / (1000 * 60 * 60 * 24));
            if (Number.isFinite(diff) && diff >= 0) return diff;
        }
    }
    return null;
};

const computeNextBillDate = (customer, now = new Date()) => {
    const explicitBillDate = parseDateOnly(customer?.billDate);
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (explicitBillDate && explicitBillDate >= todayLocal) {
        return formatDateOnly(explicitBillDate);
    }
    const billDay = parseBillingDay(customer);
    if (!billDay) return null;
    const year = todayLocal.getFullYear();
    const month = todayLocal.getMonth();
    const candidate = new Date(year, month, clampDay(year, month, billDay));
    if (candidate < todayLocal) {
        return formatDateOnly(new Date(year, month + 1, clampDay(year, month + 1, billDay)));
    }
    return formatDateOnly(candidate);
};

const computeNextDueDate = (nextBillStr, offset, fallbackDue) => {
    if (nextBillStr && offset != null) {
        const base = new Date(nextBillStr);
        if (!isNaN(base)) {
            base.setDate(base.getDate() + offset);
            return formatDateOnly(base);
        }
    }
    return fallbackDue || null;
};

const readPayments = async (branchId = null) => {
    if (await isRelationalReady()) {
        const sql = `
            SELECT
                id,
                branch_id AS branchId,
                account_number AS accountNumber,
                amount,
                date,
                kind,
                direction,
                reference,
                or_number AS orNumber,
                description,
                type,
                recorded_at AS recordedAt,
                recorded_by_user_id AS recordedByUserId,
                recorded_by_username AS recordedByUsername,
                recorded_by_name AS recordedByName,
                recorded_by_role AS recordedByRole,
                payer,
                status,
                payment_method AS paymentMethod,
                fingerprint,
                xendit_id AS xenditId
            FROM payment_entries
            ${branchId ? 'WHERE branch_id = ?' : ''}
            ORDER BY recorded_at DESC`;
        const [rows] = await query(sql, branchId ? [branchId] : []);
        const grouped = {};
        (rows || []).forEach((row) => {
            const acct = String(row.accountNumber || '');
            if (!grouped[acct]) grouped[acct] = { history: [] };
            grouped[acct].history.push(mapPaymentRow(row));
        });
        return grouped;
    }
    const data = await readJson(STORE_KEYS.payments, {});
    return data && typeof data === 'object' ? data : {};
};

const readPlans = async (branchId = null) => {
    if (await isRelationalReady()) {
        const sql = `
            SELECT
                plan_id AS id,
                branch_id AS branchId,
                category,
                label,
                name,
                description,
                profile,
                profile_bindings AS profileBindings,
                price,
                price_suffix AS priceSuffix,
                validity,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM plans
            ${branchId ? 'WHERE branch_id = ?' : ''}`;
        const [rows] = await query(sql, branchId ? [branchId] : []);
        return (rows || []).map(mapPlanRow);
    }
    const data = await readJson(STORE_KEYS.plans, []);
    return Array.isArray(data) ? data : [];
};

const computePaymentSummary = (history = []) => {
    let balance = 0;
    let totalCredits = 0;
    let lastPayment = null;
    const resolveEntryPaymentTimestamp = (entry) => {
        const paymentDate = parseDateOnly(entry?.date);
        if (paymentDate) return paymentDate.getTime();
        const recordedAt = parseDateTimeValue(entry?.recordedAt);
        return recordedAt ? recordedAt.getTime() : 0;
    };
    const normKindDir = (entry) => {
        const kind = String(entry.kind || '').toLowerCase();
        const direction = String(entry.direction || '').toLowerCase();
        if (direction) return direction;
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        return 'credit';
    };
    history.forEach((entry) => {
        const amount = Number(entry.amount);
        if (!Number.isFinite(amount)) return;
        const dir = normKindDir(entry);
        if (dir === 'debit') balance += amount;
        else balance -= amount;
        if (entry.kind === 'payment' && dir === 'credit') totalCredits += amount;
        if (entry.kind === 'payment' && dir === 'credit') {
            const t = resolveEntryPaymentTimestamp(entry);
            const lt = lastPayment ? resolveEntryPaymentTimestamp(lastPayment) : -1;
            if (!lastPayment || t > lt) lastPayment = entry;
        }
    });
    return {
        balance: Number(balance.toFixed(2)),
        totalCredits: Number(totalCredits.toFixed(2)),
        lastPaymentAmount: lastPayment ? Number(lastPayment.amount) : null,
        lastPaymentDate: lastPayment ? (lastPayment.date || lastPayment.recordedAt || null) : null,
        lastPaymentKind: lastPayment ? lastPayment.kind : null
    };
};

const hasConfiguredXenditApiKey = (settings = {}) => Boolean(sanitizeString(settings?.xendit?.apiKey));

const loadPaymentIntegrationSettings = async (branchId = null) => {
    const branchSettings = await loadIntegrationSettings(branchId);
    if (hasConfiguredXenditApiKey(branchSettings) || !branchId) {
        return branchSettings;
    }
    try {
        const fallbackSettings = await loadIntegrationSettings(null);
        if (hasConfiguredXenditApiKey(fallbackSettings)) {
            return fallbackSettings;
        }
    } catch (error) {
        console.warn('Unable to load default Xendit integration settings:', error?.message || error);
    }
    return branchSettings;
};

const attachCustomerPaymentSummary = (customer, payments = {}) => {
    if (!customer || typeof customer !== 'object') return customer;
    const accountNumber = String(customer?.accountNumber || '').trim();
    const history = accountNumber ? (payments?.[accountNumber]?.history || []) : [];
    const summary = computePaymentSummary(Array.isArray(history) ? history : []);
    return {
        ...customer,
        balance: summary.balance,
        totalCredits: summary.totalCredits,
        lastPaymentAmount: summary.lastPaymentAmount,
        lastPaymentDate: summary.lastPaymentDate,
        lastPaymentKind: summary.lastPaymentKind,
        paymentSummary: summary
    };
};

const attachCustomerPaymentSummaries = (customers = [], payments = {}) =>
    (Array.isArray(customers) ? customers : []).map((customer) => attachCustomerPaymentSummary(customer, payments));

const findCustomerByCredentials = (customers, { username, accountNumber, password } = {}) => {
    const pass = String(password || '');
    if (!pass) return null;
    const acct = String(accountNumber || '').trim();
    if (acct) {
        const matchByAccount = customers.find((c) => {
            if (String(c.accountNumber || '').trim() !== acct) return false;
            const stored = String(c.loginPassword || '');
            return verifyPassword(pass, stored);
        });
        if (matchByAccount) return matchByAccount;
    }
    const user = String(username || '').trim().toLowerCase();
    if (!user) return null;
    return customers.find((c) => {
        const u = String(c.loginUsername || '').trim().toLowerCase();
        const p = String(c.loginPassword || '');
        return u === user && verifyPassword(pass, p);
    });
};

const readCustomerLoginCandidates = async ({ username, accountNumber } = {}) => {
    const acct = String(accountNumber || '').trim();
    const user = String(username || '').trim().toLowerCase();
    if (await isRelationalReady()) {
        const selectSql = `
            SELECT
                account_number AS accountNumber,
                branch_id AS branchId,
                first_name AS firstName,
                last_name AS lastName,
                name,
                email,
                mobile,
                mobile_raw AS mobileRaw,
                status,
                login_username AS loginUsername,
                login_password_hash AS loginPassword
            FROM customers`;
        if (acct) {
            const [rows] = await query(`${selectSql} WHERE account_number = ? LIMIT 1`, [acct]);
            return (rows || []).map(mapCustomerRow);
        }
        if (user) {
            const [rows] = await query(`${selectSql} WHERE LOWER(login_username) = ? LIMIT 10`, [user]);
            return (rows || []).map(mapCustomerRow);
        }
        return [];
    }
    return readCustomers();
};

const findCustomerByCredentialsForLogin = async ({ username, accountNumber, password } = {}) => {
    const candidates = await readCustomerLoginCandidates({ username, accountNumber });
    return findCustomerByCredentials(candidates, { username, accountNumber, password });
};

const findCustomerByAccount = (customers, accountNumber) => {
    const acct = String(accountNumber || '').trim();
    if (!acct) return null;
    return customers.find((c) => String(c.accountNumber || '').trim() === acct) || null;
};

const resolveCustomerForPublicPaymentAction = async ({ req, username, accountNumber, password, allowAccountOnly = false }) => {
    const sessionCustomer = await getCustomerFromSession(req);
    if (sessionCustomer) return sessionCustomer;

    const acct = String(accountNumber || '').trim();
    const user = String(username || '').trim();
    const pass = String(password || '');
    const customers = await readCustomers();

    if (allowAccountOnly && acct && !pass && !user) {
        const accountMatch = findCustomerByAccount(customers, acct);
        if (!accountMatch) {
            throw createError(404, 'Account number was not found.');
        }
        return accountMatch;
    }

    if ((!user && !acct) || !pass) {
        throw createError(400, 'Username/account number and password are required.');
    }

    const customer = findCustomerByCredentials(customers, { username: user, accountNumber: acct, password: pass });
    if (!customer) {
        throw createError(401, 'Invalid credentials.');
    }
    return customer;
};

const normalizePlanId = (value) => String(value || '').trim().toLowerCase();
const normalizePlanName = (name) => String(name || '').trim().toLowerCase();
const normalizePlanCategory = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'prepaid' || raw === 'postpaid') return raw;
    return '';
};
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
const deriveCustomerPlanSnapshot = ({
    plans = [],
    planId = '',
    planName = '',
    fallback = null,
    allowMissingPlan = false,
    useFallback = true
} = {}) => {
    const requestedPlanName = String(planName || '').trim();
    const requestedPlanId = String(planId || '').trim();
    const fallbackPlanName = String(fallback?.planName || '').trim();
    const fallbackPlanId = String(fallback?.planId || '').trim();

    let matchedPlan = findPlanByIdOrName(plans, { planId: requestedPlanId, planName: requestedPlanName });
    if (!matchedPlan && useFallback && fallbackPlanId) {
        const samePlanSelection = !requestedPlanName
            || normalizePlanName(requestedPlanName) === normalizePlanName(fallbackPlanName);
        if (samePlanSelection) {
            matchedPlan = findPlanByIdOrName(plans, { planId: fallbackPlanId });
        }
    }

    if (!matchedPlan) {
        if (allowMissingPlan && !requestedPlanId && !requestedPlanName) {
            return {
                planId: null,
                planName: '',
                planAmount: null,
                planCategory: normalizePlanCategory(fallback?.planCategory)
            };
        }
        throw createError(400, 'Selected plan is not available in the system.');
    }

    const resolvedPlanName = String(
        matchedPlan?.name
        || matchedPlan?.label
        || requestedPlanName
        || fallbackPlanName
        || ''
    ).trim();
    if (!resolvedPlanName) {
        throw createError(400, 'Plan is required.');
    }

    const matchedPrice = Number(matchedPlan?.price);
    const fallbackPlanAmount = Number(fallback?.planAmount);
    const resolvedPlanAmount = Number.isFinite(matchedPrice)
        ? Number(matchedPrice.toFixed(2))
        : (Number.isFinite(fallbackPlanAmount) ? Number(fallbackPlanAmount.toFixed(2)) : null);

    return {
        planId: String(matchedPlan?.id || requestedPlanId || fallbackPlanId || '').trim() || null,
        planName: resolvedPlanName,
        planAmount: resolvedPlanAmount,
        planCategory: normalizePlanCategory(matchedPlan?.category || fallback?.planCategory)
    };
};
const resolvePlanBillingLabel = (category = '', fallback = '') => {
    const normalizedCategory = normalizePlanCategory(category);
    if (normalizedCategory === 'prepaid') return 'Prepaid';
    if (normalizedCategory === 'postpaid') return 'Monthly';
    return String(fallback || '').trim() || null;
};
const buildScheduledPrepaidPlanReset = () => ({
    scheduledPlanId: null,
    scheduledPlanName: null,
    scheduledPlanAmount: null,
    scheduledPlanBilling: null,
    scheduledPlanCategory: null,
    scheduledPlanApplyAt: null,
    scheduledPppoeProfile: null
});
const clearScheduledPrepaidPlanFields = (customer = {}) => ({
    ...customer,
    ...buildScheduledPrepaidPlanReset()
});
const buildScheduledPrepaidPlanSnapshot = ({
    planSnapshot = {},
    planBilling = '',
    planCategory = '',
    pppoeProfile = '',
    applyAt = null
} = {}) => ({
    scheduledPlanId: String(planSnapshot?.planId || '').trim() || null,
    scheduledPlanName: String(planSnapshot?.planName || '').trim() || null,
    scheduledPlanAmount: Number.isFinite(Number(planSnapshot?.planAmount))
        ? Number(Number(planSnapshot.planAmount).toFixed(2))
        : null,
    scheduledPlanBilling: resolvePlanBillingLabel(planCategory, planBilling),
    scheduledPlanCategory: normalizePlanCategory(planCategory) || 'prepaid',
    scheduledPlanApplyAt: toMysqlDateTime(applyAt),
    scheduledPppoeProfile: String(pppoeProfile || '').trim() || null
});
const parseDateOnly = (value) => {
    const parts = String(value || '').trim().split('-').map((p) => Number(p));
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return isNaN(date) ? null : date;
};
const normalizeDateOnly = (value) => {
    const parsed = parseDateOnly(value);
    return parsed ? formatDateOnly(parsed) : '';
};
const getTodayDateOnly = () => formatDateOnly(new Date());
const assertDateNotBeforeToday = (value, label, { allowValue = '' } = {}) => {
    const normalizedValue = normalizeDateOnly(value);
    if (!normalizedValue) return;
    const normalizedAllowedValue = normalizeDateOnly(allowValue);
    const today = getTodayDateOnly();
    if (normalizedValue < today && normalizedValue !== normalizedAllowedValue) {
        throw createError(400, `${label} cannot be earlier than today.`);
    }
};
const formatSinceFromActivationDate = (activationDate, fallbackNow = new Date()) => {
    const parsed = parseDateOnly(activationDate);
    const base = parsed || (fallbackNow instanceof Date && !isNaN(fallbackNow) ? fallbackNow : new Date());
    return base.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const normalizePrepaidExpirationAt = (value) => {
    const normalized = toMysqlDateTime(value);
    return normalized || '';
};
const resolvePrepaidExpirationDate = (customer = {}) => {
    const explicit = parseDateTimeValue(customer?.prepaidExpirationAt);
    if (explicit) return explicit;
    const due = parseDateOnly(customer?.dueDate);
    if (!due) return null;
    // Legacy DATE-only due dates are considered valid through end-of-day.
    due.setHours(23, 59, 59, 999);
    return due;
};
const resolveCurrentPrepaidCycleBoundary = (customer = {}) => {
    const scheduledApplyAt = parseDateTimeValue(customer?.scheduledPlanApplyAt);
    if (scheduledApplyAt) return scheduledApplyAt;
    return resolvePrepaidExpirationDate(customer);
};
const hasAssignedPlan = (customer) => Boolean(String(customer?.planName || '').trim());
const isPrepaidActive = (customer = {}, now = new Date()) => {
    const explicitExpiry = parseDateTimeValue(customer?.prepaidExpirationAt);
    if (explicitExpiry) return explicitExpiry.getTime() >= now.getTime();
    if (hasAssignedPlan(customer) && String(customer?.billDate || '').trim()) return true;
    const expiry = resolvePrepaidExpirationDate(customer);
    if (!expiry) return hasAssignedPlan(customer);
    return expiry.getTime() >= now.getTime();
};
const normalizeStatusReason = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'no-plan' || raw === 'no plan' || raw === 'no_plan') return 'no-plan';
    if (raw === 'override') return 'override';
    return '';
};
const normalizeStatusReasonAmount = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Number(amount.toFixed(2));
};
const deriveCustomerCreditLimit = (customer) => {
    const creditRaw = Number(customer?.creditLimit);
    const fallbackLimit = Number(customer?.planAmount) || 0;
    if (Number.isFinite(creditRaw) && creditRaw >= 0) return creditRaw;
    return fallbackLimit > 0 ? fallbackLimit : 0;
};
const isCustomerOverCreditLimit = (customer, paymentHistory = []) => {
    const summary = computePaymentSummary(Array.isArray(paymentHistory) ? paymentHistory : []);
    const balance = Number(summary.balance) || 0;
    if (balance <= 0) return false;
    const creditLimit = deriveCustomerCreditLimit(customer);
    if (creditLimit <= 0) return balance > 0;
    return balance > creditLimit;
};
const isCustomerInactiveByRules = (customer, { plans = [], payments = {}, now = new Date() } = {}) => {
    const planCategory = resolvePlanCategory(customer, plans);
    if (planCategory === 'prepaid') {
        return !isPrepaidActive(customer, now);
    }
    if (!hasAssignedPlan(customer)) return true;
    const paymentHistory = payments?.[customer?.accountNumber]?.history || [];
    return isCustomerOverCreditLimit(customer, paymentHistory);
};
const deriveCustomerStatusReason = (customer, { plans = [], payments = {}, now = new Date() } = {}) => {
    const planCategory = resolvePlanCategory(customer, plans);
    if (planCategory === 'prepaid') {
        return '';
    }
    if (!hasAssignedPlan(customer)) return 'no-plan';
    if (planCategory !== 'postpaid') {
        return '';
    }
    const paymentHistory = payments?.[customer?.accountNumber]?.history || [];
    return isCustomerOverCreditLimit(customer, paymentHistory) ? 'override' : '';
};
const deriveCustomerStatusReasonAmount = (customer, { plans = [], payments = {} } = {}) => {
    const reason = deriveCustomerStatusReason(customer, { plans, payments });
    if (reason !== 'override') return 0;
    const paymentHistory = payments?.[customer?.accountNumber]?.history || [];
    const summary = computePaymentSummary(Array.isArray(paymentHistory) ? paymentHistory : []);
    const balance = Number(summary.balance) || 0;
    const creditLimit = deriveCustomerCreditLimit(customer);
    return normalizeStatusReasonAmount(balance - creditLimit);
};
const applyRuntimeStatusRules = (customer, { inactiveByRules = false } = {}) => {
    if (!customer || typeof customer !== 'object') return customer;
    const currentStatus = normalizeCustomerStatus(customer.status, STATUS_ACTIVE);
    if (currentStatus === STATUS_DISABLED) {
        return {
            ...customer,
            status: STATUS_DISABLED,
            statusMode: STATUS_MODE_AUTO
        };
    }
    if (!inactiveByRules) return customer;
    if (currentStatus === STATUS_INACTIVE) {
        return {
            ...customer,
            status: STATUS_INACTIVE,
            statusMode: STATUS_MODE_AUTO
        };
    }
    return {
        ...customer,
        status: STATUS_INACTIVE,
        statusMode: STATUS_MODE_AUTO
    };
};
const attachCustomerStatusReason = (customer, context = {}) => {
    if (!customer || typeof customer !== 'object') return customer;
    const normalizedReason = normalizeStatusReason(customer.statusReason);
    const derivedReason = normalizedReason || deriveCustomerStatusReason(customer, context);
    const derivedAmount = deriveCustomerStatusReasonAmount(customer, context);
    const normalizedAmount = normalizeStatusReasonAmount(customer.statusReasonAmount);
    const reasonAmount = derivedReason === 'override'
        ? (normalizedAmount || derivedAmount)
        : 0;
    const inactiveByRules = isCustomerInactiveByRules(customer, context);
    const runtimeAdjusted = applyRuntimeStatusRules(customer, { inactiveByRules });
    if (!derivedReason) {
        if (!Object.prototype.hasOwnProperty.call(runtimeAdjusted, 'statusReason')) return runtimeAdjusted;
        const { statusReason, statusReasonAmount, ...rest } = runtimeAdjusted;
        return rest;
    }
    const nextCustomer = { ...runtimeAdjusted, statusReason: derivedReason };
    if (derivedReason === 'override' && reasonAmount > 0) {
        nextCustomer.statusReasonAmount = reasonAmount;
    } else if (Object.prototype.hasOwnProperty.call(nextCustomer, 'statusReasonAmount')) {
        delete nextCustomer.statusReasonAmount;
    }
    return nextCustomer;
};
const attachCustomerStatusReasons = (customers = [], context = {}) =>
    (Array.isArray(customers) ? customers : []).map((customer) => attachCustomerStatusReason(customer, context));
const triggerBranchServiceRefreshSafe = (branchId, source = 'customers') => {
    try {
        const svc = require('./payment-service-refresh');
        if (typeof svc?.triggerBranchServiceRefresh === 'function') {
            svc.triggerBranchServiceRefresh(branchId, source);
        }
    } catch (error) {
        console.warn('Customer-triggered service refresh failed:', error?.message || error);
    }
};

const resolvePlanCategory = (customer, plans = []) => {
    const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
    if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
    const billing = String(customer?.planBilling || '').trim().toLowerCase();
    if (billing.includes('prepaid')) return 'prepaid';
    if (billing.includes('postpaid')) return 'postpaid';
    const match = findPlanByIdOrName(plans, {
        planId: customer?.planId,
        planName: customer?.planName
    });
    if (match?.category) return String(match.category).toLowerCase();
    return 'postpaid';
};
const resolveCustomerRouterId = (customer = {}, fallbackRouterId = '') =>
    normalizePppoeRouterId(customer?.mikrotikId || customer?.routerId, fallbackRouterId || '');
const sanitizePlanPayload = (plan) => {
    if (!plan) return null;
    return {
        id: plan.id || null,
        name: plan.name || '',
        category: plan.category || '',
        price: Number(plan.price) || 0,
        priceSuffix: plan.priceSuffix || '',
        validity: Number(plan.validity) || null,
        profile: plan.profile || '',
        profileBindings: normalizePlanProfileBindings(plan.profileBindings || plan.profile_bindings)
    };
};

const toTicketPreviewRow = (row = {}) => ({
    id: row.id != null ? (Number.isFinite(Number(row.id)) ? Number(row.id) : row.id) : null,
    subject: String(row.subject || '').trim(),
    status: String(row.status || '').trim() || 'open',
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null
});

const isOpenTicketStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return !TICKET_DONE_STATUSES.has(normalized);
};

const toTimestamp = (value) => {
    if (!value) return 0;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const createEmptyTicketSummary = (accountNumber = '') => ({
    accountNumber: String(accountNumber || '').trim(),
    totalCount: 0,
    openCount: 0,
    hasOpen: false,
    latestOpenAt: null,
    openTickets: []
});

const buildCustomerTicketSummary = async (accountNumber, branchId = null) => {
    const safeAccount = String(accountNumber || '').trim();
    const emptySummary = createEmptyTicketSummary(safeAccount);
    if (!safeAccount) return emptySummary;

    const hasBranch = branchId !== null && branchId !== undefined && String(branchId).trim() !== '';
    const scopeWhereSql = hasBranch ? 'AND branch_id = ?' : '';
    const scopeParams = hasBranch ? [safeAccount, branchId] : [safeAccount];

    if (await isRelationalReady()) {
        const [summaryRows] = await query(
            `SELECT
                COUNT(*) AS totalCount,
                SUM(
                    CASE
                        WHEN LOWER(COALESCE(status, '')) IN ('resolved', 'closed', 'done') THEN 0
                        ELSE 1
                    END
                ) AS openCount,
                MAX(
                    CASE
                        WHEN LOWER(COALESCE(status, '')) IN ('resolved', 'closed', 'done') THEN NULL
                        ELSE COALESCE(updated_at, created_at)
                    END
                ) AS latestOpenAt
             FROM tickets
             WHERE account_number = ?
             ${scopeWhereSql}`,
            scopeParams
        );
        const summaryRow = Array.isArray(summaryRows) && summaryRows.length ? summaryRows[0] : {};
        const [openRows] = await query(
            `SELECT
                id,
                subject,
                status,
                created_at AS createdAt,
                updated_at AS updatedAt
             FROM tickets
             WHERE account_number = ?
               ${scopeWhereSql}
               AND LOWER(COALESCE(status, '')) NOT IN ('resolved', 'closed', 'done')
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT ${OPEN_TICKET_PREVIEW_LIMIT}`,
            scopeParams
        );
        const totalCount = Number(summaryRow?.totalCount) || 0;
        const openCount = Number(summaryRow?.openCount) || 0;
        return {
            accountNumber: safeAccount,
            totalCount,
            openCount,
            hasOpen: openCount > 0,
            latestOpenAt: summaryRow?.latestOpenAt || null,
            openTickets: (openRows || []).map(toTicketPreviewRow)
        };
    }

    const parsedTickets = await readJson(TICKET_STORE_KEY, []);
    const allTickets = Array.isArray(parsedTickets) ? parsedTickets : [];
    const normalizedBranch = hasBranch ? String(branchId).trim() : '';
    const scopedTickets = allTickets.filter((ticket) => {
        const ticketAccount = String(ticket?.accountNumber || ticket?.account_number || '').trim();
        if (ticketAccount !== safeAccount) return false;
        if (!hasBranch) return true;
        const rowBranch = ticket?.branchId ?? ticket?.branch_id ?? null;
        if (rowBranch === null || rowBranch === undefined || rowBranch === '') return true;
        return String(rowBranch).trim() === normalizedBranch;
    });
    const normalizedTickets = scopedTickets.map(toTicketPreviewRow);
    const openTickets = normalizedTickets
        .filter((ticket) => isOpenTicketStatus(ticket.status))
        .sort((a, b) => toTimestamp(b.updatedAt || b.createdAt) - toTimestamp(a.updatedAt || a.createdAt));

    return {
        accountNumber: safeAccount,
        totalCount: normalizedTickets.length,
        openCount: openTickets.length,
        hasOpen: openTickets.length > 0,
        latestOpenAt: openTickets.length ? (openTickets[0].updatedAt || openTickets[0].createdAt || null) : null,
        openTickets: openTickets.slice(0, OPEN_TICKET_PREVIEW_LIMIT)
    };
};

const normalizeMikrotikStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['online', 'up', 'active', 'connected'].includes(normalized)) return 'online';
    if (['offline', 'down', 'inactive', 'disabled', 'disconnected'].includes(normalized)) return 'offline';
    return '';
};

const buildNapInfoText = (assignment = null) => {
    if (!assignment || typeof assignment !== 'object') return '';
    const parts = [];
    const linkedOlt = String(assignment.linkedOlt || '').trim();
    const napCode = String(assignment.napCode || '').trim();
    if (linkedOlt) {
        parts.push(/^olt\b/i.test(linkedOlt) ? linkedOlt : `OLT ${linkedOlt}`);
    }
    if (napCode) parts.push(napCode);
    return parts.filter(Boolean).join(' | ');
};

const buildCustomerDisplayName = (customer = {}) => {
    const directName = String(customer?.name || '').trim();
    if (directName) return directName;
    const firstName = String(customer?.firstName || '').trim();
    const lastName = String(customer?.lastName || '').trim();
    return `${firstName} ${lastName}`.trim();
};

const syncCustomerNapAssignment = async ({
    branchId,
    accountNumber,
    customerName = '',
    napId = '',
    port = null,
    opticalInfo = undefined
} = {}) => {
    const scopedBranchId = Number(branchId);
    const targetAccountNumber = String(accountNumber || '').trim();
    const targetNapId = String(napId || '').trim();
    const targetPort = toPositiveInt(port);
    const hasExplicitOpticalInfo = opticalInfo !== undefined;

    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0 || !targetAccountNumber) {
        return null;
    }

    if ((targetNapId && !targetPort) || (!targetNapId && targetPort)) {
        throw createError(400, 'NAP pin and NAP port must be selected together.');
    }

    if (!(await isRelationalReady())) {
        return null;
    }

    const pool = await getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [existingRows] = await connection.query(
            `SELECT c.optical_info AS opticalInfo
             FROM pon_nap_connections c
             INNER JOIN pon_naps n ON n.id = c.nap_id
             WHERE n.branch_id = ?
               AND c.customer_account_number = ?
             ORDER BY c.updated_at DESC, c.id DESC`,
            [scopedBranchId, targetAccountNumber]
        );
        const preservedOpticalInfo = String(
            (existingRows || []).find((row) => String(row?.opticalInfo || '').trim())?.opticalInfo || ''
        ).trim() || null;
        const nextOpticalInfo = hasExplicitOpticalInfo
            ? (String(opticalInfo || '').trim() || null)
            : preservedOpticalInfo;

        await connection.query(
            `DELETE c
             FROM pon_nap_connections c
             INNER JOIN pon_naps n ON n.id = c.nap_id
             WHERE n.branch_id = ?
               AND c.customer_account_number = ?`,
            [scopedBranchId, targetAccountNumber]
        );

        if (targetNapId && targetPort) {
            const [napRows] = await connection.query(
                `SELECT id, code, capacity
                 FROM pon_naps
                 WHERE branch_id = ?
                   AND client_uid = ?
                 LIMIT 1`,
                [scopedBranchId, targetNapId]
            );
            const napRow = napRows?.[0] || null;
            const napDbId = Number(napRow?.id);
            if (!Number.isInteger(napDbId) || napDbId <= 0) {
                throw createError(400, 'Selected NAP pin no longer exists.');
            }

            const napCapacity = toPositiveInt(napRow?.capacity);
            if (napCapacity && targetPort > napCapacity) {
                throw createError(400, `Selected NAP port exceeds ${String(napRow?.code || 'the selected NAP').trim()} capacity.`);
            }

            const [occupiedRows] = await connection.query(
                `SELECT customer_account_number AS accountNumber
                 FROM pon_nap_connections
                 WHERE nap_id = ?
                   AND port = ?
                 LIMIT 1`,
                [napDbId, targetPort]
            );
            const occupiedAccount = String(occupiedRows?.[0]?.accountNumber || '').trim();
            if (occupiedAccount && occupiedAccount !== targetAccountNumber) {
                throw createError(409, 'Selected NAP port is already assigned to another customer.');
            }

            await connection.query(
                `INSERT INTO pon_nap_connections (
                    nap_id, customer_account_number, customer_name, customer_ref, port, optical_info
                 ) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    customer_account_number = VALUES(customer_account_number),
                    customer_name = VALUES(customer_name),
                    customer_ref = VALUES(customer_ref),
                    optical_info = VALUES(optical_info),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    napDbId,
                    targetAccountNumber,
                    customerName || null,
                    targetAccountNumber,
                    targetPort,
                    nextOpticalInfo
                ]
            );
        }

        await connection.commit();
        return {
            accountNumber: targetAccountNumber,
            napId: targetNapId || null,
            port: targetPort,
            opticalInfo: targetNapId ? nextOpticalInfo : null,
            cleared: !targetNapId
        };
    } catch (error) {
        try {
            await connection.rollback();
        } catch {
            // Ignore rollback failures.
        }
        if (isOptionalSchemaError(error)) {
            return null;
        }
        throw error;
    } finally {
        connection.release();
    }
};

const buildStoredPppoeStatusLookup = (settings = null) => {
    const accounts = dedupePppoeAccounts(
        Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
        settings?.mikrotikDefaultId || ''
    );
    const byUsername = new Map();
    accounts.forEach((entry) => {
        const usernameKey = normalizePppoeUsernameKey(entry?.username);
        const status = normalizeMikrotikStatus(entry?.status);
        if (usernameKey && status && !byUsername.has(usernameKey)) {
            byUsername.set(usernameKey, status);
        }
    });
    return byUsername;
};

const buildStoredPppoeLookup = (settings = null) => {
    const accounts = dedupePppoeAccounts(
        Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
        settings?.mikrotikDefaultId || ''
    );
    const byAccount = new Map();
    const byUsername = new Map();
    accounts.forEach((entry) => {
        const accountNumber = String(entry?.customerAccount || entry?.accountNumber || entry?.customerId || '').trim();
        if (accountNumber && !byAccount.has(accountNumber)) {
            byAccount.set(accountNumber, entry);
        }
        const usernameKey = normalizePppoeUsernameKey(entry?.username);
        if (usernameKey && !byUsername.has(usernameKey)) {
            byUsername.set(usernameKey, entry);
        }
    });
    return { byAccount, byUsername };
};

const resolveStoredPppoeEntryForCustomer = (customer = {}, lookup = null) => {
    if (!lookup || typeof lookup !== 'object') return null;
    const accountNumber = String(customer?.accountNumber || '').trim();
    if (accountNumber && lookup.byAccount instanceof Map && lookup.byAccount.has(accountNumber)) {
        return lookup.byAccount.get(accountNumber) || null;
    }
    const usernameKey = normalizePppoeUsernameKey(customer?.pppoeUsername);
    if (usernameKey && lookup.byUsername instanceof Map && lookup.byUsername.has(usernameKey)) {
        return lookup.byUsername.get(usernameKey) || null;
    }
    return null;
};

const resolveInitialNextBillDate = (value, now = new Date()) => {
    const requested = parseDateOnly(value);
    if (!requested) return '';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (requested > today) {
        return formatDateOnly(requested) || '';
    }

    const billDay = requested.getDate();
    let year = today.getFullYear();
    let month = today.getMonth();
    let candidate = new Date(year, month, clampDay(year, month, billDay));
    if (candidate <= today) {
        month += 1;
        candidate = new Date(year, month, clampDay(year, month, billDay));
    }
    return formatDateOnly(candidate) || '';
};

const alignBillDateOnOrAfterActivationDate = (billDateValue, activationDateValue) => {
    const billDate = parseDateOnly(billDateValue);
    const activationDate = parseDateOnly(activationDateValue);
    if (!billDate) return '';
    if (!activationDate || billDate >= activationDate) {
        return formatDateOnly(billDate) || '';
    }

    const billDay = billDate.getDate();
    let year = activationDate.getFullYear();
    let month = activationDate.getMonth();
    let candidate = new Date(year, month, clampDay(year, month, billDay));
    if (candidate < activationDate) {
        month += 1;
        candidate = new Date(year, month, clampDay(year, month, billDay));
    }
    return formatDateOnly(candidate) || '';
};

const loadNapAssignmentsByAccount = async (branchId, accountNumbers = []) => {
    const normalizedAccounts = Array.from(
        new Set(
            (Array.isArray(accountNumbers) ? accountNumbers : [])
                .map((value) => String(value || '').trim())
                .filter(Boolean)
        )
    );
    if (!normalizedAccounts.length || !branchId || !(await isRelationalReady())) {
        return new Map();
    }
    try {
        const [rows] = await query(
            `SELECT
                c.customer_account_number AS accountNumber,
                n.client_uid AS napId,
                c.port,
                c.optical_info AS opticalInfo,
                n.code AS napCode,
                n.area AS location,
                n.coordinate AS coordinate,
                o.name AS linkedOlt,
                n.pon_ref AS ponRef,
                n.optical_power AS opticalPower
             FROM pon_nap_connections c
             INNER JOIN pon_naps n ON n.id = c.nap_id
             LEFT JOIN pon_olts o ON o.id = n.olt_id
             WHERE n.branch_id = ?
               AND c.customer_account_number IN (${buildSqlPlaceholders(normalizedAccounts.length)})`,
            [branchId, ...normalizedAccounts]
        );
        const byAccount = new Map();
        (rows || []).forEach((row) => {
            const accountNumber = String(row?.accountNumber || '').trim();
            if (!accountNumber || byAccount.has(accountNumber)) return;
            byAccount.set(accountNumber, {
                accountNumber,
                napId: String(row?.napId || '').trim(),
                port: Number.isFinite(Number(row?.port)) ? Math.trunc(Number(row.port)) : null,
                opticalInfo: String(row?.opticalInfo || row?.opticalPower || '').trim(),
                opticalPower: String(row?.opticalPower || row?.opticalInfo || '').trim(),
                napCode: String(row?.napCode || '').trim(),
                location: String(row?.location || '').trim(),
                coordinate: String(row?.coordinate || '').trim(),
                linkedOlt: String(row?.linkedOlt || '').trim(),
                ponRef: String(row?.ponRef || '').trim()
            });
        });
        return byAccount;
    } catch (error) {
        if (isOptionalSchemaError(error)) {
            return new Map();
        }
        throw error;
    }
};

const attachTechnicalInfoToCustomer = (customer = {}, context = {}) => {
    const settings = context?.settings || {};
    const napAssignments = context?.napAssignments instanceof Map ? context.napAssignments : new Map();
    const storedPppoeLookup = context?.storedPppoeLookup || null;
    const storedPppoeStatusLookup = context?.storedPppoeStatusLookup instanceof Map
        ? context.storedPppoeStatusLookup
        : new Map();
    const storedEntry = resolveStoredPppoeEntryForCustomer(customer, storedPppoeLookup);
    const napAssignment = napAssignments.get(String(customer?.accountNumber || '').trim()) || null;

    const pppoeUsername = String(customer?.pppoeUsername || storedEntry?.username || '').trim();
    const pppoePassword = String(customer?.pppoePassword || storedEntry?.password || '').trim();
    const pppoeProfile = String(customer?.pppoeProfile || storedEntry?.profile || '').trim();
    const hasPppoeAssignment = Boolean(pppoeUsername || pppoePassword || pppoeProfile);
    const routerId = normalizePppoeRouterId(storedEntry?.routerId, settings?.mikrotikDefaultId || '');
    const resolvedRouter = hasPppoeAssignment ? resolveMikrotikRouter(settings, routerId) : null;
    const routerLabel = hasPppoeAssignment
        ? String(resolvedRouter?.label || resolvedRouter?.address || '').trim()
        : '';
    const usernameKey = normalizePppoeUsernameKey(pppoeUsername || storedEntry?.username);
    const mikrotikStatus = usernameKey
        ? (
            storedPppoeStatusLookup.get(usernameKey)
            || normalizeMikrotikStatus(storedEntry?.status)
            || ''
        )
        : '';
    const opticalInfo = String(napAssignment?.opticalInfo || napAssignment?.opticalPower || '').trim();
    const napInfo = buildNapInfoText(napAssignment);
    const technicalInfo = {
        routerLabel,
        pppoeUsername,
        pppoePassword,
        pppoeProfile,
        napInfo,
        napPort: napAssignment?.port ?? null,
        opticalInfo,
        mikrotikStatus
    };

    return {
        ...customer,
        routerLabel,
        pppoeUsername,
        pppoeAccount: pppoeUsername,
        pppoePassword,
        pppoeProfile,
        napInfo,
        napPort: napAssignment?.port ?? null,
        opticalInfo,
        mikrotikStatus,
        napAssignment,
        technicalInfo
    };
};

const enrichCustomersWithTechnicalDetails = async (customers = [], branchId = null) => {
    const list = Array.isArray(customers) ? customers : [];
    if (!list.length) return list;

    let settings = null;
    try {
        settings = await loadIntegrationSettings(branchId || null);
    } catch (error) {
        console.warn('Failed to load integration settings for customer technical info:', error?.message || error);
    }
    const storedPppoeLookup = buildStoredPppoeLookup(settings);
    const storedPppoeStatusLookup = buildStoredPppoeStatusLookup(settings);
    const napAssignments = await loadNapAssignmentsByAccount(
        branchId,
        list.map((customer) => customer?.accountNumber)
    );

    return list.map((customer) => attachTechnicalInfoToCustomer(customer, {
        settings,
        storedPppoeLookup,
        storedPppoeStatusLookup,
        napAssignments
    }));
};

const buildCustomerStatementPayload = async (customer, branchId = null) => {
    const portalContext = await buildCustomerPortalContext(customer, branchId);
    let notificationInbox = { notifications: [], unreadCount: 0, totalCount: 0 };
    try {
        notificationInbox = await listCustomerNotifications(customer, { limit: 50 });
    } catch (error) {
        console.warn(
            `Unable to load customer notifications for account ${customer?.accountNumber || 'unknown'}:`,
            error?.message || error
        );
    }
    if (!portalContext) {
        return {
            customer: null,
            paymentHistory: [],
            currentPlan: null,
            ticketSummary: createEmptyTicketSummary(customer?.accountNumber || ''),
            notifications: notificationInbox.notifications,
            notificationUnreadCount: notificationInbox.unreadCount,
            notificationTotalCount: notificationInbox.totalCount
        };
    }
    return {
        customer: sanitizeCustomerPayload(portalContext.customerRecord),
        paymentHistory: Array.isArray(portalContext.history) ? portalContext.history : [],
        currentPlan: portalContext.currentPlan,
        availablePlans: portalContext.availablePlans,
        amountDue: portalContext.amountDue ?? 0,
        nextBill: portalContext.nextBill || null,
        nextDue: portalContext.nextDue || null,
        planCategory: portalContext.planCategory || 'postpaid',
        paymentMode: portalContext.paymentMode || 'postpaid',
        paymentMethods: portalContext.paymentMethods || ['gcash', 'grabpay', 'shopeepay', 'paymaya'],
        remainingDaysToNextBill: portalContext.remainingDaysToNextBill ?? null,
        remainingDaysToExpire: portalContext.remainingDaysToExpire ?? null,
        status: portalContext.effectiveStatus || portalContext.customerRecord?.status,
        paymentSummary: portalContext.summary || computePaymentSummary([]),
        ticketSummary: portalContext.ticketSummary,
        notifications: notificationInbox.notifications,
        notificationUnreadCount: notificationInbox.unreadCount,
        notificationTotalCount: notificationInbox.totalCount
    };
};

const readPaymentHistoryForAccount = async (accountNumber, branchId = null) => {
    const safeAccount = String(accountNumber || '').trim();
    if (!safeAccount) return [];
    if (await isRelationalReady()) {
        const hasBranch = branchId !== null && branchId !== undefined && String(branchId).trim() !== '';
        const sql = `
            SELECT
                id,
                branch_id AS branchId,
                account_number AS accountNumber,
                amount,
                date,
                kind,
                direction,
                reference,
                or_number AS orNumber,
                description,
                type,
                recorded_at AS recordedAt,
                recorded_by_user_id AS recordedByUserId,
                recorded_by_username AS recordedByUsername,
                recorded_by_name AS recordedByName,
                recorded_by_role AS recordedByRole,
                payer,
                status,
                payment_method AS paymentMethod,
                fingerprint,
                xendit_id AS xenditId
            FROM payment_entries
            WHERE account_number = ?
              ${hasBranch ? 'AND branch_id = ?' : ''}
            ORDER BY recorded_at DESC`;
        const params = hasBranch ? [safeAccount, branchId] : [safeAccount];
        const [rows] = await query(sql, params);
        return (rows || []).map(mapPaymentRow);
    }
    const payments = await readPayments(branchId);
    const history = payments?.[safeAccount]?.history || [];
    return Array.isArray(history) ? history : [];
};

const buildCustomerPortalContext = async (customer, branchId = null, options = {}) => {
    if (!customer || typeof customer !== 'object') return null;
    const includeTechnicalDetails = options?.includeTechnicalDetails === true;
    const effectiveBranchId = customer.branchId || branchId || null;
    const accountNumber = String(customer.accountNumber || '').trim();
    const [technicalCustomerResult, historyResult, plansResult, ticketSummaryResult] = await Promise.all([
        includeTechnicalDetails
            ? enrichCustomersWithTechnicalDetails([customer], effectiveBranchId)
                .then(([technicalCustomer]) => technicalCustomer || customer)
                .catch((error) => {
                    console.warn('Unable to load customer technical details during portal request:', error?.message || error);
                    return customer;
                })
            : Promise.resolve(customer),
        readPaymentHistoryForAccount(accountNumber, effectiveBranchId)
            .catch((error) => {
                console.warn('Unable to load customer payment history during portal request:', error?.message || error);
                return [];
            }),
        readPlans(effectiveBranchId)
            .catch((error) => {
                console.warn('Unable to load plan catalog during portal request:', error?.message || error);
                return [];
            }),
        buildCustomerTicketSummary(accountNumber, effectiveBranchId)
            .catch((error) => {
                console.warn('Unable to load customer ticket summary during portal request:', error?.message || error);
                return createEmptyTicketSummary(accountNumber);
            })
    ]);

    const customerRecord = technicalCustomerResult || customer;
    const history = Array.isArray(historyResult) ? historyResult : [];
    const plans = Array.isArray(plansResult) ? plansResult : [];
    const ticketSummary = ticketSummaryResult || createEmptyTicketSummary(accountNumber);
    const summary = computePaymentSummary(history);
    const offset = deriveDueOffset(customerRecord);
    let nextBill = computeNextBillDate(customerRecord) || customerRecord.billDate || null;
    let nextDue = computeNextDueDate(nextBill, offset, customerRecord.dueDate || null);
    const planCategory = resolvePlanCategory(customerRecord, plans);
    const paymentMode = planCategory === 'prepaid' ? 'prepaid' : 'postpaid';
    const planMatch = findPlanByIdOrName(plans, {
        planId: customerRecord?.planId,
        planName: customerRecord?.planName
    });
    const currentPlan = sanitizePlanPayload(planMatch);
    const availablePlans = paymentMode === 'prepaid'
        ? plans
            .filter((p) => String(p.category || '').toLowerCase() === 'prepaid')
            .map(sanitizePlanPayload)
            .filter(Boolean)
        : undefined;
    const amountDue = paymentMode === 'postpaid'
        ? Math.max(Number(summary.balance) || 0, 0)
        : (currentPlan?.price ?? 0);
    const paymentMethods = ['gcash', 'grabpay', 'shopeepay', 'paymaya'];
    const prepaidExpiryDate = resolvePrepaidExpirationDate(customerRecord);
    let remainingDaysToNextBill = planCategory === 'postpaid'
        ? remainingDaysUntil(nextBill)
        : null;
    let remainingDaysToExpire = planCategory === 'prepaid'
        ? remainingDaysUntilDateTime(prepaidExpiryDate)
        : null;
    const currentStatusState = resolveCustomerStatusState(customerRecord.status, customerRecord.statusMode);
    let effectiveStatus = currentStatusState.status;
    if (effectiveStatus === STATUS_DISABLED) {
        nextBill = null;
        nextDue = null;
        remainingDaysToNextBill = null;
        remainingDaysToExpire = null;
    } else if (planCategory === 'prepaid') {
        nextBill = null;
        nextDue = null;
        remainingDaysToNextBill = null;
        if (!isPrepaidActive(customerRecord)) {
            effectiveStatus = STATUS_INACTIVE;
        }
    } else if (!hasAssignedPlan(customerRecord)) {
        effectiveStatus = STATUS_INACTIVE;
        nextBill = null;
        nextDue = null;
        remainingDaysToNextBill = null;
        remainingDaysToExpire = null;
    } else {
        const creditLimit = deriveCustomerCreditLimit(customerRecord);
        const currentBalance = Number(summary.balance) || 0;
        if (currentBalance > creditLimit) {
            effectiveStatus = STATUS_INACTIVE;
        }
    }

    return {
        customerRecord,
        history,
        summary,
        nextBill,
        nextDue,
        planCategory,
        paymentMode,
        currentPlan,
        availablePlans,
        amountDue,
        paymentMethods,
        remainingDaysToNextBill,
        remainingDaysToExpire,
        effectiveStatus,
        ticketSummary
    };
};

const QUICK_PAYMENT_METHODS = ['gcash', 'paymaya', 'grabpay', 'shopeepay'];

const normalizeQuickPaymentAccountNumber = (value) => {
    const raw = sanitizeString(value);
    if (!raw) return '';
    const digits = raw.replace(/\D+/g, '');
    return digits || raw;
};

const findCustomerForQuickPayment = async (accountNumber) => {
    const normalizedAccount = normalizeQuickPaymentAccountNumber(accountNumber);
    if (!normalizedAccount) {
        throw createError(400, 'Account number is required.');
    }
    const customers = await readCustomers();
    const customer = findCustomerByAccount(customers, normalizedAccount);
    if (!customer) {
        throw createError(404, 'Account number was not found.');
    }
    return customer;
};

const buildQuickPaymentSnapshot = async (customer) => {
    const branchId = customer?.branchId || null;
    const accountNumber = String(customer?.accountNumber || '').trim();
    const [history, plans] = await Promise.all([
        readPaymentHistoryForAccount(accountNumber, branchId),
        readPlans(branchId).catch(() => [])
    ]);
    const summary = computePaymentSummary(Array.isArray(history) ? history : []);
    const balance = Number(summary.balance) || 0;
    const amountDue = Math.max(balance, 0);
    const planCategory = resolvePlanCategory(customer, Array.isArray(plans) ? plans : []);
    const matchedPlan = findPlanByIdOrName(plans, {
        planId: customer?.planId,
        planName: customer?.planName
    });
    const planName = sanitizeString(customer?.planName || matchedPlan?.name || matchedPlan?.label) || 'Not set';
    const nextBill = computeNextBillDate(customer) || customer?.billDate || null;
    const dueDate = planCategory === 'prepaid'
        ? (formatDateOnly(resolvePrepaidExpirationDate(customer)) || customer?.dueDate || null)
        : computeNextDueDate(nextBill, deriveDueOffset(customer), customer?.dueDate || null);
    return {
        accountNumber,
        customerName: buildCustomerDisplayName(customer) || 'Customer',
        planName,
        dueDate: dueDate || null,
        balance: Number(balance.toFixed(2)),
        amountDue: Number(amountDue.toFixed(2)),
        hasPayableBalance: amountDue > 0,
        paymentMode: planCategory === 'prepaid' ? 'prepaid' : 'postpaid',
        paymentMethods: QUICK_PAYMENT_METHODS
    };
};

const buildQuickPaymentRedirectUrl = (req, status, accountNumber) => {
    const target = new URL('/quick-payment.html', resolveExternalBaseUrl(req));
    target.searchParams.set('status', String(status || '').trim().toLowerCase() === 'paid' ? 'paid' : 'failed');
    const account = normalizeQuickPaymentAccountNumber(accountNumber);
    if (account) target.searchParams.set('account', account);
    return target.toString();
};

const resolveXenditCustomerPhone = (customer = {}) => {
    const raw = sanitizeString(customer.mobileRaw || customer.mobile || '');
    const digits = raw.replace(/\D+/g, '');
    if (raw.startsWith('+') && /^\+\d{8,15}$/.test(raw)) return raw;
    if (/^63\d{9,12}$/.test(digits)) return `+${digits}`;
    if (/^0\d{9,10}$/.test(digits)) return `+63${digits.slice(1)}`;
    return undefined;
};

const createCustomerXenditCheckout = async ({
    req,
    customer,
    branchId = null,
    method = 'gcash',
    amount,
    description = '',
    successRedirectUrl = '',
    failureRedirectUrl = '',
    paymentMode = 'postpaid',
    includeCustomerDetails = true
} = {}) => {
    const payableAmount = Number(amount);
    if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
        throw createError(400, 'No payable amount found for this customer.');
    }

    const settings = await loadPaymentIntegrationSettings(branchId);
    const apiKey = sanitizeString(settings?.xendit?.apiKey);
    if (!apiKey) {
        throw createError(400, 'Xendit API key not configured.');
    }

    const methodRaw = String(method || 'gcash').toLowerCase();
    const channelMap = {
        gcash: 'PH_GCASH',
        grab: 'PH_GRABPAY',
        grabpay: 'PH_GRABPAY',
        shopee: 'PH_SHOPEEPAY',
        shopeepay: 'PH_SHOPEEPAY',
        maya: 'PH_PAYMAYA',
        paymaya: 'PH_PAYMAYA'
    };
    const invoiceMap = {
        grabpay: 'GRABPAY',
        grab: 'GRABPAY',
        shopee: 'SHOPEEPAY',
        shopeepay: 'SHOPEEPAY',
        maya: 'PAYMAYA',
        paymaya: 'PAYMAYA'
    };
    const channelCode = channelMap[methodRaw];
    if (!channelCode) {
        throw createError(400, 'Unsupported e-wallet method. Use gcash, grabpay, shopeepay, or paymaya.');
    }

    const accountNumber = String(customer?.accountNumber || '').trim();
    const referenceId = `cust-${accountNumber}-${Date.now()}`;
    const paymentDescription = description || `Payment for account ${accountNumber}`;
    const receiptReference = extractDisplayReferenceFromXenditIdentifier(referenceId);
    const successUrl = buildXenditRedirectUrl(req, {
        provided: successRedirectUrl || settings?.xendit?.successRedirectUrl,
        status: 'paid',
        receipt: {
            accountNumber,
            reference: receiptReference,
            amount: payableAmount,
            method: methodRaw,
            description: paymentDescription,
            paymentMode
        }
    });
    const failureUrl = buildXenditRedirectUrl(req, {
        provided: failureRedirectUrl || settings?.xendit?.failureRedirectUrl,
        status: 'failed'
    });
    const customerPhone = includeCustomerDetails ? resolveXenditCustomerPhone(customer) : undefined;
    const payerEmail = includeCustomerDetails ? sanitizeString(customer?.email) : '';
    const payerName = includeCustomerDetails
        ? (customer?.name || customer?.loginUsername || 'Customer')
        : 'Customer';

    if (channelCode === 'PH_GCASH') {
        const payload = {
            reference_id: referenceId,
            amount: payableAmount,
            currency: 'PHP',
            channel_code: channelCode,
            checkout_method: 'ONE_TIME_PAYMENT',
            channel_properties: {
                success_redirect_url: successUrl,
                failure_redirect_url: failureUrl,
                cancel_redirect_url: failureUrl,
                mobile_number: customerPhone
            },
            customer: {
                given_names: payerName,
                email: payerEmail || undefined,
                mobile_number: customerPhone
            },
            description: paymentDescription
        };
        const charge = await callXenditEwalletCharge(apiKey, payload);
        const actions = charge?.actions || {};
        const checkoutUrl =
            actions.desktop_web_checkout_url ||
            actions.mobile_web_checkout_url ||
            charge.checkout_url ||
            charge.status_url;
        if (!checkoutUrl) {
            throw createError(502, 'No checkout URL returned from Xendit.');
        }
        return {
            ok: true,
            checkoutUrl,
            method: methodRaw,
            amount: payableAmount,
            paymentMode,
            redirects: { success: successUrl, failure: failureUrl }
        };
    }

    const invoiceMethod = invoiceMap[methodRaw];
    const invoicePayload = {
        external_id: referenceId,
        amount: payableAmount,
        payer_email: payerEmail || undefined,
        description: paymentDescription,
        success_redirect_url: successUrl,
        failure_redirect_url: failureUrl,
        currency: 'PHP',
        payment_methods: invoiceMethod ? [invoiceMethod] : undefined
    };
    const invoice = await callXenditInvoice(apiKey, invoicePayload);
    if (!invoice?.invoice_url) {
        throw createError(502, 'No checkout URL returned from Xendit invoice.');
    }
    return {
        ok: true,
        checkoutUrl: invoice.invoice_url,
        method: methodRaw,
        amount: payableAmount,
        paymentMode,
        redirects: { success: successUrl, failure: failureUrl }
    };
};
const callXenditInvoice = (apiKey, payload) =>
    new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = https.request(
            {
                hostname: 'api.xendit.co',
                path: '/v2/invoices',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
                },
                timeout: 10000
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body || '{}'));
                        } catch (e) {
                            reject(new Error('Invalid response from Xendit'));
                        }
                    } else {
                        const msg = body || `Xendit responded with status ${res.statusCode}`;
                        reject(new Error(msg));
                    }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('Xendit request timed out'));
        });
        req.write(data);
        req.end();
    });

const callXenditEwalletCharge = (apiKey, payload) =>
    new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const req = https.request(
            {
                hostname: 'api.xendit.co',
                path: '/ewallets/charges',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
                },
                timeout: 10000
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(body || '{}'));
                        } catch (e) {
                            reject(new Error('Invalid response from Xendit'));
                        }
                    } else {
                        const msg = body || `Xendit responded with status ${res.statusCode}`;
                        reject(new Error(msg));
                    }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('Xendit request timed out'));
        });
        req.write(data);
        req.end();
    });

const remainingDaysUntil = (dateStr) => {
    if (!dateStr) return null;
    const target = new Date(dateStr);
    if (isNaN(target)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diffMs = target - today;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays < 0 ? 0 : diffDays;
};

const remainingDaysUntilDateTime = (value, now = new Date()) => {
    const target = value instanceof Date ? value : parseDateTimeValue(value);
    if (!target || isNaN(target)) return null;
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

const normalizeAccountPrefixId = (value) =>
    String(value || '')
        .replace(/\D/g, '')
        .slice(0, ACCOUNT_PREFIX_DIGITS);

const isAllowedGeneratedAccountPrefix = (value) =>
    new RegExp(`^[1-9]\\d{${ACCOUNT_PREFIX_DIGITS - 1}}$`).test(normalizeAccountPrefixId(value));

const resolveEffectiveAccountPrefixId = (value) =>
    isAllowedGeneratedAccountPrefix(value)
        ? normalizeAccountPrefixId(value)
        : DEFAULT_ACCOUNT_PREFIX;

const isValidAccountNumber = (value) =>
    new RegExp(`^\\d{${ACCOUNT_TOTAL_DIGITS}}$`).test(String(value || '').trim());

const resolveStoredAccountPrefixId = async () => {
    try {
        const settings = await readJson(ACCOUNT_NUMBER_SETTINGS_KEY, {});
        return normalizeAccountPrefixId(
            settings?.prefixId || settings?.serverPrefixId || settings?.prefix || ''
        );
    } catch {
        return '';
    }
};

const generateRandomAccountSuffix = () =>
    String(Math.floor(Math.random() * (10 ** ACCOUNT_SUFFIX_DIGITS))).padStart(ACCOUNT_SUFFIX_DIGITS, '0');

// Helper to generate a random unique account number
const generateAccountNumber = (existingSet, prefixId = '') => {
    const existing = existingSet instanceof Set ? existingSet : new Set();
    const prefix = resolveEffectiveAccountPrefixId(prefixId);
    for (let i = 0; i < 100; i++) {
        const candidateStr = `${prefix}${generateRandomAccountSuffix()}`;
        if (!existing.has(candidateStr)) {
            return candidateStr;
        }
    }
    throw new Error('Unable to generate unique account number');
};

const applyNormalizedCustomerMobileFields = (target, source = {}, { fallback = '' } = {}) => {
    if (!target || typeof target !== 'object') return '';
    const hasExplicitMobile = ['mobileRaw', 'mobile', 'contactNumber', 'contact'].some((key) =>
        Object.prototype.hasOwnProperty.call(source || {}, key)
    );
    const rawCandidate = hasExplicitMobile
        ? (source?.mobileRaw ?? source?.mobile ?? source?.contactNumber ?? source?.contact ?? '')
        : fallback;
    const normalizedMobile = normalizePhilippineMobile(rawCandidate);

    if (hasExplicitMobile || normalizedMobile) {
        target.mobileRaw = normalizedMobile || null;
        target.mobile = normalizedMobile || null;
    }

    return normalizedMobile;
};

const createCustomerRecord = async (payload = {}, { branchId, refreshSource = 'customers-create', allowPastBillingDates = false } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const customers = await readCustomers();
    const existing = new Set(customers.map((customer) => customer.accountNumber?.toString()).filter(Boolean));

    let incomingAccount = (payload?.accountNumber || '').toString().trim();
    const configuredPrefixId = await resolveStoredAccountPrefixId();
    const hasConfiguredPrefix = isAllowedGeneratedAccountPrefix(configuredPrefixId);
    const prefixMatches = !hasConfiguredPrefix || incomingAccount.startsWith(configuredPrefixId);
    const startsWithAllowedDigit = /^[1-9]/.test(incomingAccount);
    if (!incomingAccount || !isValidAccountNumber(incomingAccount) || !startsWithAllowedDigit || existing.has(incomingAccount) || !prefixMatches) {
        incomingAccount = generateAccountNumber(existing, configuredPrefixId);
    }

    const incomingBody = { ...(payload || {}) };
    delete incomingBody.statusMode;
    delete incomingBody.prepaidExpirationAt;
    delete incomingBody.prepaid_expiration_at;
    delete incomingBody.expiryDateTime;
    delete incomingBody.prepaidExpiration;
    delete incomingBody.activationDate;
    delete incomingBody.activation_date;
    delete incomingBody.planId;
    delete incomingBody.planAmount;
    delete incomingBody.napId;
    delete incomingBody.napPort;
    delete incomingBody.opticalInfo;
    delete incomingBody.opticalPower;
    applyNormalizedCustomerMobileFields(incomingBody, payload);
    const hasIncomingNapAssignment = Object.prototype.hasOwnProperty.call(payload || {}, 'napId')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'napPort')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'opticalInfo')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'opticalPower');
    const incomingNapId = String(payload?.napId || '').trim();
    const incomingNapPort = toPositiveInt(payload?.napPort);
    const incomingOpticalInfo = String(payload?.opticalInfo ?? payload?.opticalPower ?? '').trim();

    const firstName = String(payload?.firstName || '').trim();
    const lastName = String(payload?.lastName || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const loginUsername = String(payload?.loginUsername || '').trim() || fullName || incomingAccount;
    const rawLoginPassword = String(payload?.loginPassword || '').trim() || incomingAccount;
    const loginPassword = rawLoginPassword;
    const creditRaw = Number(payload?.creditLimit);
    const creditLimit = Number.isFinite(creditRaw) && creditRaw >= 0 ? Math.floor(creditRaw) : undefined;
    const dueOffsetRaw = Number(payload?.dueOffset);
    const dueOffset = Number.isFinite(dueOffsetRaw) && dueOffsetRaw >= 0 ? Math.floor(dueOffsetRaw) : undefined;
    const now = new Date();

    const plans = await readPlans(scopedBranchId);
    const requestedPlanCategory = normalizePlanCategory(payload?.planCategory);
    const planSnapshot = deriveCustomerPlanSnapshot({
        plans,
        planId: payload?.planId,
        planName: payload?.planName,
        allowMissingPlan: requestedPlanCategory === 'prepaid'
    });
    const incomingCategory = normalizePlanCategory(requestedPlanCategory || planSnapshot.planCategory);
    const incomingActivationDate = normalizeDateOnly(
        payload?.activationDate ?? payload?.activation_date
    );
    const requestedBillDate = normalizeDateOnly(payload?.billDate);
    const initialBillDate = incomingCategory === 'prepaid' || allowPastBillingDates
        ? requestedBillDate
        : resolveInitialNextBillDate(requestedBillDate, now);
    const incomingBillDate = incomingCategory === 'prepaid'
        ? initialBillDate
        : alignBillDateOnOrAfterActivationDate(initialBillDate, incomingActivationDate);
    const planBilling = incomingCategory === 'prepaid'
        ? 'Prepaid'
        : (incomingCategory === 'postpaid' ? 'Monthly' : (payload?.planBilling || 'Monthly'));
    const incomingPlanName = String(planSnapshot.planName || '').trim();
    const incomingMikrotikId = resolveCustomerRouterId(payload);
    if (!incomingPlanName) {
        throw createError(400, 'Plan is required.');
    }
    const incomingPrepaidExpirationAt = normalizePrepaidExpirationAt(
        payload?.prepaidExpirationAt
            ?? payload?.prepaid_expiration_at
            ?? payload?.expiryDateTime
            ?? payload?.prepaidExpiration
    );
    const incomingDueDateRaw = String(payload?.dueDate || '').trim();
    const baseIncomingDueDate = normalizeDateOnly(incomingDueDateRaw)
        || formatDateOnly(parseDateTimeValue(incomingPrepaidExpirationAt))
        || '';
    const effectiveDueOffset = dueOffset ?? deriveDueOffset({ billDate: requestedBillDate, dueDate: baseIncomingDueDate });
    const incomingDueDate = incomingCategory === 'prepaid'
        ? (baseIncomingDueDate || incomingBillDate)
        : computeNextDueDate(incomingBillDate, effectiveDueOffset, baseIncomingDueDate);
    if (incomingCategory !== 'prepaid' && !allowPastBillingDates) {
        assertDateNotBeforeToday(incomingBillDate, 'Next bill date');
        assertDateNotBeforeToday(incomingDueDate, 'Next due date');
    }
    const planReady = Boolean(incomingPlanName);
    const prepaidReady = incomingCategory === 'prepaid'
        ? isPrepaidActive(
            {
                planName: incomingPlanName,
                billDate: incomingBillDate,
                dueDate: incomingDueDate,
                prepaidExpirationAt: incomingPrepaidExpirationAt
            },
            now
        )
        : true;
    const serviceReady = planReady && prepaidReady;
    const requestedStatus = normalizeCustomerStatus(payload?.status, STATUS_ACTIVE);
    const desiredStatus = requestedStatus === STATUS_DISABLED
        ? STATUS_DISABLED
        : (serviceReady ? requestedStatus : STATUS_INACTIVE);
    const nextStatusState = resolveCustomerStatusState(
        desiredStatus,
        STATUS_MODE_AUTO
    );
    const newCustomer = {
        ...incomingBody,
        accountNumber: incomingAccount,
        loginUsername,
        loginPassword,
        since: formatSinceFromActivationDate(incomingActivationDate, now),
        activationDate: incomingActivationDate || null,
        planId: planSnapshot.planId,
        planName: incomingPlanName,
        planAmount: planSnapshot.planAmount,
        planBilling,
        status: nextStatusState.status,
        billDate: incomingBillDate || null,
        dueDate: incomingDueDate || null,
        prepaidExpirationAt: incomingCategory === 'prepaid'
            ? (incomingPrepaidExpirationAt || null)
            : null,
        branchId: scopedBranchId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...(incomingCategory ? { planCategory: incomingCategory } : {}),
        ...(incomingMikrotikId ? { mikrotikId: incomingMikrotikId } : {}),
        ...(creditLimit !== undefined ? { creditLimit } : {}),
        ...(dueOffset !== undefined ? { dueOffset } : {})
    };

    const payments = await readPayments(scopedBranchId);
    const inactiveByRules = isCustomerInactiveByRules(newCustomer, { plans, payments, now });
    const persistedCustomer = applyRuntimeStatusRules(newCustomer, { inactiveByRules });
    if (await isRelationalReady()) {
        await writeCustomers([persistedCustomer], scopedBranchId);
    } else {
        customers.push(persistedCustomer);
        await writeCustomers(customers, scopedBranchId);
    }

    if (hasIncomingNapAssignment) {
        await syncCustomerNapAssignment({
            branchId: scopedBranchId,
            accountNumber: persistedCustomer.accountNumber,
            customerName: buildCustomerDisplayName(persistedCustomer),
            napId: incomingNapId,
            port: incomingNapPort,
            opticalInfo: incomingOpticalInfo
        });
    }

    const normalizedRefreshSource = String(refreshSource || '').trim();
    if (normalizedRefreshSource) {
        triggerBranchServiceRefreshSafe(scopedBranchId, normalizedRefreshSource);
    }

    return persistedCustomer;
};

const updateCustomerRecord = async (accountNumber, payload = {}, { branchId, refreshSource = 'customers-update', allowPastBillingDates = false } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const targetAccountNumber = String(accountNumber || '').trim();
    if (!targetAccountNumber) {
        throw createError(400, 'Customer account number is required.');
    }

    const customers = await readCustomers(scopedBranchId);
    const index = customers.findIndex((customer) => String(customer?.accountNumber || '').trim() === targetAccountNumber);
    if (index === -1) {
        throw createError(404, 'Customer not found.');
    }

    const existing = customers[index];
    const incomingBody = { ...(payload || {}) };
    delete incomingBody.statusMode;
    delete incomingBody.prepaidExpirationAt;
    delete incomingBody.prepaid_expiration_at;
    delete incomingBody.expiryDateTime;
    delete incomingBody.prepaidExpiration;
    delete incomingBody.activationDate;
    delete incomingBody.activation_date;
    delete incomingBody.planId;
    delete incomingBody.planAmount;
    delete incomingBody.napId;
    delete incomingBody.napPort;
    delete incomingBody.opticalInfo;
    delete incomingBody.opticalPower;
    delete incomingBody.prepaidRenewalDate;
    delete incomingBody.renewalDate;
    delete incomingBody.scheduledPlanId;
    delete incomingBody.scheduledPlanName;
    delete incomingBody.scheduledPlanAmount;
    delete incomingBody.scheduledPlanBilling;
    delete incomingBody.scheduledPlanCategory;
    delete incomingBody.scheduledPlanApplyAt;
    delete incomingBody.scheduledPppoeProfile;
    applyNormalizedCustomerMobileFields(incomingBody, payload, {
        fallback: existing.mobileRaw || existing.mobile || ''
    });
    const hasIncomingNapAssignment = Object.prototype.hasOwnProperty.call(payload || {}, 'napId')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'napPort')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'opticalInfo')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'opticalPower');
    const incomingNapId = String(payload?.napId || '').trim();
    const incomingNapPort = toPositiveInt(payload?.napPort);
    const incomingOpticalInfo = String(payload?.opticalInfo ?? payload?.opticalPower ?? '').trim();

    const firstName = String(payload?.firstName ?? existing.firstName ?? '').trim();
    const lastName = String(payload?.lastName ?? existing.lastName ?? '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const loginUsername = String(payload?.loginUsername ?? existing.loginUsername ?? '').trim()
        || fullName
        || existing.accountNumber
        || targetAccountNumber;
    const nextLoginPasswordRaw = typeof payload?.loginPassword === 'string' ? payload.loginPassword.trim() : '';
    let loginPassword = existing.loginPassword || '';
    if (nextLoginPasswordRaw) {
        loginPassword = nextLoginPasswordRaw;
    }

    const dueOffsetRaw = Number(payload?.dueOffset ?? existing.dueOffset);
    const dueOffset = Number.isFinite(dueOffsetRaw) && dueOffsetRaw >= 0 ? Math.floor(dueOffsetRaw) : existing.dueOffset;
    const creditRaw = Number(payload?.creditLimit ?? existing.creditLimit);
    const creditLimit = Number.isFinite(creditRaw) && creditRaw >= 0 ? Math.floor(creditRaw) : existing.creditLimit;

    if (firstName || lastName) {
        incomingBody.name = fullName;
    }

    const plans = await readPlans(scopedBranchId);
    const hasIncomingPlanSelection = Object.prototype.hasOwnProperty.call(payload || {}, 'planId')
        || Object.prototype.hasOwnProperty.call(payload || {}, 'planName');
    const requestedPlanCategory = normalizePlanCategory(payload?.planCategory || existing.planCategory);
    const incomingPlanSelectionIsBlank = hasIncomingPlanSelection
        && !String(payload?.planId || payload?.planName || '').trim();
    const planSnapshot = deriveCustomerPlanSnapshot({
        plans,
        planId: hasIncomingPlanSelection ? payload?.planId : existing.planId,
        planName: hasIncomingPlanSelection ? payload?.planName : existing.planName,
        fallback: existing,
        allowMissingPlan: requestedPlanCategory === 'prepaid',
        useFallback: !(requestedPlanCategory === 'prepaid' && incomingPlanSelectionIsBlank)
    });
    const matchedPlan = findPlanByIdOrName(plans, {
        planId: planSnapshot.planId,
        planName: planSnapshot.planName
    });
    const nextRouterId = resolveCustomerRouterId(
        {
            mikrotikId: payload?.mikrotikId,
            routerId: payload?.routerId
        },
        resolveCustomerRouterId(existing)
    );
    const nextPlanProfile = resolvePlanProfileForRouter(matchedPlan, nextRouterId)
        || String(matchedPlan?.profile || '').trim();
    const incomingCategory = normalizePlanCategory(
        requestedPlanCategory || planSnapshot.planCategory
    );
    const hasIncomingActivationDate = [
        'activationDate',
        'activation_date'
    ].some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));
    const incomingActivationDateRaw = hasIncomingActivationDate
        ? (payload?.activationDate ?? payload?.activation_date)
        : existing?.activationDate;
    const normalizedActivationDate = normalizeDateOnly(incomingActivationDateRaw);
    const planBilling = incomingCategory === 'prepaid'
        ? 'Prepaid'
        : (incomingCategory === 'postpaid' ? 'Monthly' : (payload?.planBilling ?? existing.planBilling));
    const nextPlanName = String(planSnapshot.planName || '').trim();
    if (!nextPlanName) {
        throw createError(400, 'Plan is required.');
    }
    const hasIncomingBillDate = Object.prototype.hasOwnProperty.call(payload || {}, 'billDate');
    const nextBillDateRaw = hasIncomingBillDate
        ? String(payload?.billDate || '').trim()
        : String(existing?.billDate || '').trim();
    const normalizedNextBillDate = normalizeDateOnly(nextBillDateRaw);
    const nextBillDate = incomingCategory === 'prepaid'
        ? normalizedNextBillDate
        : alignBillDateOnOrAfterActivationDate(normalizedNextBillDate, normalizedActivationDate);
    const hasIncomingDueDate = Object.prototype.hasOwnProperty.call(payload || {}, 'dueDate');
    const nextDueDateRaw = hasIncomingDueDate
        ? String(payload?.dueDate || '').trim()
        : String(existing?.dueDate || '').trim();
    const hasIncomingPrepaidExpirationAt = [
        'prepaidExpirationAt',
        'prepaid_expiration_at',
        'expiryDateTime',
        'prepaidExpiration'
    ].some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));
    const incomingPrepaidExpirationRaw = hasIncomingPrepaidExpirationAt
        ? (
            payload?.prepaidExpirationAt
            ?? payload?.prepaid_expiration_at
            ?? payload?.expiryDateTime
            ?? payload?.prepaidExpiration
        )
        : existing?.prepaidExpirationAt;
    const normalizedPrepaidExpirationAt = normalizePrepaidExpirationAt(incomingPrepaidExpirationRaw);
    const normalizedIncomingDueDate = normalizeDateOnly(nextDueDateRaw)
        || formatDateOnly(parseDateTimeValue(normalizedPrepaidExpirationAt))
        || nextBillDate;
    let nextDueDate = normalizedIncomingDueDate;
    if (incomingCategory !== 'prepaid' && nextBillDate && normalizedNextBillDate && nextBillDate !== normalizedNextBillDate) {
        const alignedDueOffset = deriveDueOffset({
            billDate: normalizedNextBillDate,
            dueDate: nextDueDate,
            dueOffset
        });
        nextDueDate = computeNextDueDate(nextBillDate, alignedDueOffset, nextDueDate);
    }
    if (incomingCategory !== 'prepaid' && !allowPastBillingDates) {
        assertDateNotBeforeToday(nextBillDate, 'Next bill date', { allowValue: existing?.billDate });
        assertDateNotBeforeToday(nextDueDate, 'Next due date', { allowValue: existing?.dueDate });
    }

    const now = new Date();
    const prepaidRenewalDate = parseDateOnly(payload?.prepaidRenewalDate ?? payload?.renewalDate);
    const currentPrepaidCycleBoundary = incomingCategory === 'prepaid'
        ? resolveCurrentPrepaidCycleBoundary(existing)
        : null;
    const hasEarlyPrepaidRenewal = Boolean(
        incomingCategory === 'prepaid'
        && prepaidRenewalDate
        && currentPrepaidCycleBoundary
        && currentPrepaidCycleBoundary.getTime() > prepaidRenewalDate.getTime()
    );
    const shouldQueuePrepaidPlanChange = Boolean(
        hasEarlyPrepaidRenewal
        && String(existing?.planName || '').trim()
        && normalizePlanName(nextPlanName) !== normalizePlanName(existing?.planName)
    );
    const preservedScheduledPlanState = {
        scheduledPlanId: String(existing?.scheduledPlanId || '').trim() || null,
        scheduledPlanName: String(existing?.scheduledPlanName || '').trim() || null,
        scheduledPlanAmount: Number.isFinite(Number(existing?.scheduledPlanAmount))
            ? Number(Number(existing.scheduledPlanAmount).toFixed(2))
            : null,
        scheduledPlanBilling: String(existing?.scheduledPlanBilling || '').trim() || null,
        scheduledPlanCategory: normalizePlanCategory(existing?.scheduledPlanCategory) || null,
        scheduledPlanApplyAt: toMysqlDateTime(existing?.scheduledPlanApplyAt),
        scheduledPppoeProfile: String(existing?.scheduledPppoeProfile || '').trim() || null
    };
    const nextScheduledPlanState = shouldQueuePrepaidPlanChange
        ? buildScheduledPrepaidPlanSnapshot({
            planSnapshot,
            planBilling,
            planCategory: incomingCategory,
            pppoeProfile: nextPlanProfile,
            applyAt: currentPrepaidCycleBoundary
        })
        : (
            incomingCategory !== 'prepaid' || prepaidRenewalDate || hasIncomingPlanSelection
                ? buildScheduledPrepaidPlanReset()
                : preservedScheduledPlanState
        );
    const activePlanCategory = shouldQueuePrepaidPlanChange
        ? (normalizePlanCategory(existing?.planCategory) || incomingCategory)
        : incomingCategory;
    const activePlanBilling = shouldQueuePrepaidPlanChange
        ? resolvePlanBillingLabel(existing?.planCategory, existing?.planBilling)
        : planBilling;
    const activePlanId = shouldQueuePrepaidPlanChange
        ? (String(existing?.planId || '').trim() || null)
        : planSnapshot.planId;
    const activePlanName = shouldQueuePrepaidPlanChange
        ? String(existing?.planName || '').trim()
        : nextPlanName;
    const activePlanAmount = shouldQueuePrepaidPlanChange
        ? (existing?.planAmount != null ? Number(existing.planAmount) : null)
        : planSnapshot.planAmount;
    const planReady = Boolean(activePlanName || nextPlanName);
    const prepaidReady = incomingCategory === 'prepaid'
        ? isPrepaidActive(
            {
                planName: activePlanName || nextPlanName,
                billDate: nextBillDate,
                dueDate: nextDueDate,
                prepaidExpirationAt: incomingCategory === 'prepaid' ? normalizedPrepaidExpirationAt : ''
            },
            now
        )
        : true;
    const serviceReady = planReady && prepaidReady;
    const existingStatusState = resolveCustomerStatusState(existing.status, existing.statusMode);
    const requestedStatus = normalizeCustomerStatus(payload?.status, existingStatusState.status);
    const desiredStatus = requestedStatus === STATUS_DISABLED
        ? STATUS_DISABLED
        : (serviceReady ? requestedStatus : STATUS_INACTIVE);
    const nextStatusState = resolveCustomerStatusState(
        desiredStatus,
        STATUS_MODE_AUTO,
        existingStatusState
    );

    const updatedCustomer = {
        ...existing,
        ...incomingBody,
        firstName,
        lastName,
        loginUsername,
        loginPassword,
        dueOffset,
        creditLimit,
        planId: activePlanId,
        planName: activePlanName,
        planAmount: activePlanAmount,
        planBilling: activePlanBilling,
        since: normalizedActivationDate
            ? formatSinceFromActivationDate(normalizedActivationDate, now)
            : existing.since,
        activationDate: normalizedActivationDate || null,
        billDate: nextBillDate || null,
        dueDate: nextDueDate || null,
        prepaidExpirationAt: incomingCategory === 'prepaid'
            ? (normalizedPrepaidExpirationAt || null)
            : null,
        status: nextStatusState.status,
        ...(nextRouterId ? { mikrotikId: nextRouterId } : {}),
        ...(activePlanCategory ? { planCategory: activePlanCategory } : {}),
        ...nextScheduledPlanState
    };

    const payments = await readPayments(scopedBranchId);
    const inactiveByRules = isCustomerInactiveByRules(updatedCustomer, { plans, payments, now });
    const persistedCustomer = applyRuntimeStatusRules(updatedCustomer, { inactiveByRules });

    customers[index] = { ...persistedCustomer, branchId: scopedBranchId };
    if (await isRelationalReady()) {
        await writeCustomers([customers[index]], scopedBranchId);
    } else {
        await writeCustomers(customers, scopedBranchId);
    }

    if (
        refreshSource !== 'mikrotik-pppoe-save'
        && hasIncomingPlanSelection
        && !shouldQueuePrepaidPlanChange
        && nextPlanProfile
        && String(customers[index]?.pppoeUsername || '').trim()
    ) {
        const pppoeProfileSync = await syncCustomerPppoeProfileForPlan({
            branchId: scopedBranchId,
            customer: customers[index],
            profile: nextPlanProfile,
            routerId: nextRouterId,
            source: 'customers-plan-update',
            reason: 'customer-plan-change'
        });
        if (pppoeProfileSync?.ok) {
            customers[index] = {
                ...customers[index],
                pppoeProfile: pppoeProfileSync.profile,
                ...(pppoeProfileSync.routerId ? { mikrotikId: pppoeProfileSync.routerId } : {})
            };
            if (await isRelationalReady()) {
                await writeCustomers([customers[index]], scopedBranchId);
            } else {
                await writeCustomers(customers, scopedBranchId);
            }
        } else if (pppoeProfileSync?.warning) {
            console.warn(`[customers] ${pppoeProfileSync.warning}`);
            customers[index] = {
                ...customers[index],
                pppoeProfileSyncWarning: pppoeProfileSync.warning
            };
        }
    }

    if (hasIncomingNapAssignment) {
        await syncCustomerNapAssignment({
            branchId: scopedBranchId,
            accountNumber: customers[index].accountNumber,
            customerName: buildCustomerDisplayName(customers[index]),
            napId: incomingNapId,
            port: incomingNapPort,
            opticalInfo: incomingOpticalInfo
        });
    }

    const normalizedRefreshSource = String(refreshSource || '').trim();
    if (normalizedRefreshSource) {
        triggerBranchServiceRefreshSafe(scopedBranchId, normalizedRefreshSource);
    }

    return customers[index];
};

const deleteCustomerRecord = async (
    accountNumber,
    {
        branchId,
        refreshSource = 'customers-delete',
        deleteDraftRows = true,
        deletedBy = null
    } = {}
) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const targetAccountNumber = String(accountNumber || '').trim();
    if (!targetAccountNumber) {
        throw createError(400, 'Customer account number is required.');
    }

    let deleted = false;
    let cleanupWarning = '';
    let pppoeArchiveState = { entries: [] };
    if (await isRelationalReady()) {
        const [customerRows] = await query(
            `SELECT
                account_number AS accountNumber,
                branch_id AS branchId,
                name,
                pppoe_username AS pppoeUsername
             FROM customers
             WHERE account_number = ?
               AND branch_id = ?
             LIMIT 1`,
            [targetAccountNumber, scopedBranchId]
        );
        const customer = Array.isArray(customerRows) && customerRows.length ? customerRows[0] : null;
        if (!customer) {
            throw createError(404, 'Customer not found.');
        }

        const pppoeResult = await disableCustomerPppoeAccountsForArchive({
            branchId: scopedBranchId,
            customer
        });
        pppoeArchiveState = {
            entries: Array.isArray(pppoeResult?.processedEntries) ? pppoeResult.processedEntries : [],
            skippedEntries: Array.isArray(pppoeResult?.skippedEntries) ? pppoeResult.skippedEntries : []
        };
        const pppoeCleanupWarning = buildPppoeActionWarning('disable', pppoeArchiveState.skippedEntries);
        if (pppoeCleanupWarning) {
            cleanupWarning = cleanupWarning
                ? `${cleanupWarning} ${pppoeCleanupWarning}`
                : pppoeCleanupWarning;
        }

        await ensureCustomerArchivesTable();
        const pool = await getPool();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const archiveSnapshot = await collectCustomerArchiveSnapshot(connection, {
                branchId: scopedBranchId,
                accountNumber: targetAccountNumber,
                deleteDraftRows,
                cleanupWarning
            });
            if (!archiveSnapshot?.customer) {
                throw createError(404, 'Customer not found.');
            }

            await createCustomerArchive({
                branchId: scopedBranchId,
                accountNumber: targetAccountNumber,
                customerName: archiveSnapshot.customerName,
                contactNumber: archiveSnapshot.contactNumber,
                planName: archiveSnapshot.planName,
                areaName: archiveSnapshot.areaName,
                deletedBy,
                payload: {
                    customer: archiveSnapshot.customer,
                    paymentEntries: archiveSnapshot.paymentEntries,
                    tickets: archiveSnapshot.tickets,
                    jobs: archiveSnapshot.jobs,
                    paymentConfirmationQueue: archiveSnapshot.paymentConfirmationQueue,
                    smsMessages: archiveSnapshot.smsMessages,
                    smsAutomationRuns: archiveSnapshot.smsAutomationRuns,
                    ponNapConnections: archiveSnapshot.ponNapConnections,
                    customerDraftSubmissions: archiveSnapshot.customerDraftSubmissions,
                    metadata: {
                        addressText: archiveSnapshot.addressText,
                        cleanupWarning: archiveSnapshot.cleanupWarning,
                        deleteDraftRows: Boolean(deleteDraftRows),
                        pppoeArchive: pppoeArchiveState,
                        pppoeWarning: pppoeCleanupWarning || null
                    }
                },
                proofFilePaths: archiveSnapshot.proofFilePaths,
                executor: connection
            });

            const ticketRows = await loadOptionalRows(
                connection,
                `SELECT id
                 FROM tickets
                 WHERE branch_id = ?
                   AND account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );
            const ticketIds = ticketRows
                .map((row) => Number(row?.id))
                .filter((value) => Number.isInteger(value) && value > 0);
            const ticketNumberRows = await loadOptionalRows(
                connection,
                `SELECT ticket_number AS ticketNumber
                 FROM tickets
                 WHERE branch_id = ?
                   AND account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );
            const ticketNumbers = ticketNumberRows
                .map((row) => String(row?.ticketNumber || '').trim())
                .filter(Boolean);

            if (ticketIds.length) {
                await deleteOptionalRows(
                    connection,
                    `DELETE FROM jobs
                     WHERE branch_id = ?
                       AND ticket_id IN (${buildSqlPlaceholders(ticketIds.length)})`,
                    [scopedBranchId, ...ticketIds]
                );
            }
            if (ticketNumbers.length) {
                await deleteOptionalRows(
                    connection,
                    `DELETE FROM jobs
                     WHERE branch_id = ?
                       AND ticket_number IN (${buildSqlPlaceholders(ticketNumbers.length)})`,
                    [scopedBranchId, ...ticketNumbers]
                );
            }

            await deleteOptionalRows(
                connection,
                `DELETE FROM ${PAYMENT_CONFIRMATION_QUEUE_TABLE}
                 WHERE branch_id = ?
                   AND account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );
            await deleteOptionalRows(
                connection,
                `DELETE FROM sms_messages
                 WHERE branch_id = ?
                   AND customer_account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );
            await deleteOptionalRows(
                connection,
                `DELETE FROM sms_automation_runs
                 WHERE branch_id = ?
                   AND customer_account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );
            await deleteOptionalRows(
                connection,
                `DELETE FROM pon_nap_connections
                 WHERE customer_account_number = ?`,
                [targetAccountNumber]
            );
            if (deleteDraftRows) {
                await deleteOptionalRows(
                    connection,
                    `DELETE FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
                     WHERE branch_id = ?
                       AND (
                           draft_account_number = ?
                           OR approved_customer_account_number = ?
                       )`,
                    [scopedBranchId, targetAccountNumber, targetAccountNumber]
                );
            }
            await deleteOptionalRows(
                connection,
                `DELETE FROM tickets
                 WHERE branch_id = ?
                   AND account_number = ?`,
                [scopedBranchId, targetAccountNumber]
            );

            const [result] = await connection.query(
                'DELETE FROM customers WHERE account_number = ? AND branch_id = ?',
                [targetAccountNumber, scopedBranchId]
            );
            deleted = Boolean(result?.affectedRows);
            if (!deleted) {
                throw createError(404, 'Customer not found.');
            }

            await connection.commit();
        } catch (error) {
            await connection.rollback().catch(() => {});
            throw error;
        } finally {
            connection.release();
        }

        await deleteCustomerSessionsForAccount(targetAccountNumber);
    } else {
        const customers = await readCustomers(scopedBranchId);
        const targetCustomer = customers.find((customer) =>
            String(customer?.accountNumber || '').trim() === targetAccountNumber &&
            Number(customer?.branchId || scopedBranchId) === scopedBranchId
        );
        const filteredCustomers = customers.filter((customer) => String(customer?.accountNumber || '').trim() !== targetAccountNumber);
        if (filteredCustomers.length !== customers.length) {
            if (targetCustomer) {
                await createCustomerArchive({
                    branchId: scopedBranchId,
                    accountNumber: targetAccountNumber,
                    customerName: buildCustomerArchiveName(targetCustomer),
                    contactNumber: buildCustomerArchiveContactNumber(targetCustomer),
                    planName: String(targetCustomer?.planName || '').trim(),
                    areaName: String(targetCustomer?.area || '').trim(),
                    deletedBy,
                    payload: {
                        customer: {
                            ...targetCustomer,
                            branchId: Number(targetCustomer?.branchId || scopedBranchId)
                        },
                        paymentEntries: [],
                        tickets: [],
                        jobs: [],
                        paymentConfirmationQueue: [],
                        smsMessages: [],
                        smsAutomationRuns: [],
                        ponNapConnections: [],
                        customerDraftSubmissions: [],
                        metadata: {
                            addressText: buildCustomerArchiveAddressText(targetCustomer),
                            cleanupWarning,
                            deleteDraftRows: Boolean(deleteDraftRows),
                            pppoeArchive: pppoeArchiveState
                        }
                    },
                    proofFilePaths: []
                });
            }
            await writeCustomers(filteredCustomers, scopedBranchId);
            deleted = true;
        }
        await deleteCustomerSessionsForAccount(targetAccountNumber);
    }

    if (!deleted) {
        throw createError(404, 'Customer not found.');
    }

    const normalizedRefreshSource = String(refreshSource || '').trim();
    if (normalizedRefreshSource) {
        triggerBranchServiceRefreshSafe(scopedBranchId, normalizedRefreshSource);
    }

    return { ok: true, accountNumber: targetAccountNumber, warning: cleanupWarning || undefined };
};

const loadPendingDraftLinkedCustomerAccounts = async (branchId = null) => {
    if (!(await isRelationalReady())) {
        return new Set();
    }
    const scopedBranchId = Number(branchId);
    const hasScopedBranchId = Number.isInteger(scopedBranchId) && scopedBranchId > 0;
    try {
        const [rows] = await query(
            `SELECT
                draft_account_number AS draftAccountNumber,
                approved_customer_account_number AS approvedCustomerAccountNumber
             FROM ${CUSTOMER_DRAFT_SUBMISSIONS_TABLE}
             WHERE status = 'pending'
               ${hasScopedBranchId ? 'AND branch_id = ?' : ''}`,
            hasScopedBranchId ? [scopedBranchId] : []
        );
        const linkedAccounts = new Set();
        (rows || []).forEach((row) => {
            [
                row?.draftAccountNumber,
                row?.approvedCustomerAccountNumber
            ].forEach((value) => {
                const accountNumber = String(value || '').trim();
                if (accountNumber) {
                    linkedAccounts.add(accountNumber);
                }
            });
        });
        return linkedAccounts;
    } catch (error) {
        if (isMissingTableError(error)) {
            return new Set();
        }
        throw error;
    }
};

const filterPendingDraftLinkedCustomers = (customers = [], pendingDraftAccounts = new Set()) => {
    if (!Array.isArray(customers) || !pendingDraftAccounts?.size) {
        return Array.isArray(customers) ? customers : [];
    }
    return customers.filter((customer) => {
        const accountNumber = String(customer?.accountNumber || '').trim();
        return !accountNumber || !pendingDraftAccounts.has(accountNumber);
    });
};

const readVisibleCustomers = async (branchId = null) => {
    const [customers, pendingDraftAccounts] = await Promise.all([
        readCustomers(branchId),
        loadPendingDraftLinkedCustomerAccounts(branchId)
    ]);
    return filterPendingDraftLinkedCustomers(customers, pendingDraftAccounts);
};

// Admin routes require authentication
router.use(requireAuth);

// GET /api/customers - Get all customers
router.get('/', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        const [customers, plans, payments] = await Promise.all([
            readVisibleCustomers(branchId),
            readPlans(branchId),
            readPayments(branchId)
        ]);
        const technicalCustomers = await enrichCustomersWithTechnicalDetails(customers, branchId);
        const enriched = attachCustomerStatusReasons(technicalCustomers, { plans, payments, now: new Date() });
        const withPayments = attachCustomerPaymentSummaries(enriched, payments);
        res.json({ customers: withPayments.map(sanitizeCustomerForAdmin) });
    } catch (error) {
        next(error);
    }
});

// GET /api/customers/next-account - Get the next available account number
router.get('/next-account', async (req, res, next) => {
    try {
        const customers = await readCustomers();
        const existing = new Set(customers.map((c) => c.accountNumber?.toString()).filter(Boolean));
        const storedPrefixId = await resolveStoredAccountPrefixId();
        const effectivePrefixId = resolveEffectiveAccountPrefixId(storedPrefixId);
        const accountNumber = generateAccountNumber(existing, storedPrefixId);
        res.json({ accountNumber, prefixId: effectivePrefixId });
    } catch (error) {
        next(error);
    }
});

const handleCustomerLogin = async (req, res, next) => {
    try {
        const { username, password, accountNumber } = req.body || {};
        if ((!username && !accountNumber) || !password) {
            return res.status(400).json({ ok: false, error: 'Username/account number and password are required' });
        }
        const match = await findCustomerByCredentialsForLogin({ username, accountNumber, password });
        if (!match) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        const customerRecord = match;
        const payload = {
            accountNumber: customerRecord.accountNumber || '',
            branchId: customerRecord.branchId || null,
            loginUsername: customerRecord.loginUsername || '',
            name: customerRecord.name || `${customerRecord.firstName || ''} ${customerRecord.lastName || ''}`.trim(),
            status: normalizeCustomerStatus(customerRecord.status, STATUS_ACTIVE)
        };
        const sessionId = await createCustomerSession(customerRecord);
        if (sessionId) {
            setCustomerSessionCookie(req, res, sessionId);
        }
        let savedFcmToken = null;
        const loginFcmToken = getRequestFcmToken(req.body || {});
        if (loginFcmToken) {
            try {
                const savedEntry = await registerCustomerFcmToken({
                    customer: customerRecord,
                    body: req.body || {},
                    token: loginFcmToken
                });
                savedFcmToken = sanitizeFcmTokenEntry(savedEntry);
            } catch (error) {
                console.warn(
                    `Failed to save customer FCM token for account ${customerRecord.accountNumber || 'unknown'}:`,
                    error?.message || error
                );
            }
        }
        const loginType = 'Customer';
        payload.loginType = loginType;
        const response = { ok: true, loginType, customer: payload };
        if (savedFcmToken) {
            response.fcmToken = savedFcmToken;
        }
        return res.json(response);
    } catch (error) {
        next(error);
    }
};

publicRouter.post('/login', handleCustomerLogin);

publicRouter.get('/me', requireCustomer, async (req, res, next) => {
    try {
        const payload = await buildCustomerStatementPayload(req.customer, req.customer?.branchId || null);
        res.json({ ok: true, ...payload });
    } catch (error) {
        next(error);
    }
});

publicRouter.get('/notifications', requireCustomer, async (req, res, next) => {
    try {
        const limit = Number(req.query?.limit);
        const includeRead = String(req.query?.includeRead || 'true').trim().toLowerCase() !== 'false';
        const inbox = await listCustomerNotifications(req.customer, {
            limit,
            includeRead
        });
        res.json({ ok: true, ...inbox });
    } catch (error) {
        next(error);
    }
});

publicRouter.post('/notifications/read-all', requireCustomer, async (req, res, next) => {
    try {
        const result = await markAllCustomerNotificationsRead(req.customer);
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error);
    }
});

publicRouter.post('/notifications/:id/read', requireCustomer, async (req, res, next) => {
    try {
        const result = await markCustomerNotificationRead(req.customer, req.params.id);
        if (!result.notification) {
            return res.status(404).json({ ok: false, error: 'Notification was not found.' });
        }
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/customers/archive - List archived customer records for the current branch
router.get('/archive', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
        }

        await purgeExpiredArchivedCustomerRecords().catch(() => ({ purgedCount: 0 }));
        const result = await listCustomerArchives({
            branchId,
            search: req.query?.search || req.query?.q || '',
            limit: req.query?.limit,
            offset: req.query?.offset
        });
        return res.json({
            ok: true,
            items: result.items,
            total: result.total,
            limit: result.limit,
            offset: result.offset
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/customers/archive/:archiveId/restore - Restore one archived record
router.post('/archive/:archiveId/restore', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
        }

        await purgeExpiredArchivedCustomerRecords().catch(() => ({ purgedCount: 0 }));
        const restored = await restoreArchivedCustomerRecord(req.params.archiveId, {
            branchId,
            restoredBy: req.user || {}
        });
        return res.json({
            ok: true,
            accountNumber: restored.accountNumber,
            archiveId: restored.archiveId,
            recordType: restored.recordType || 'customer',
            warning: restored.warning || undefined
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/customers/archive/:archiveId - Permanently delete one archived record
router.delete('/archive/:archiveId', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
        }

        await purgeExpiredArchivedCustomerRecords().catch(() => ({ purgedCount: 0 }));
        const deleted = await deleteArchivedCustomerRecord(req.params.archiveId, {
            branchId
        });
        return res.json({
            ok: true,
            archiveId: deleted.archiveId,
            accountNumber: deleted.accountNumber,
            recordType: deleted.recordType || 'customer'
        });
    } catch (error) {
        next(error);
    }
});

publicRouter.put('/me/contact', requireCustomer, async (req, res, next) => {
    try {
        const branchId = Number(req.customer?.branchId);
        if (!Number.isInteger(branchId) || branchId <= 0) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this customer account.' });
        }

        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const rawEmail = sanitizeString(payload.email);
        const rawMobile = sanitizeString(
            payload.mobileRaw
            ?? payload.mobile
            ?? payload.contactNumber
            ?? payload.phone
            ?? payload.contact
            ?? ''
        );

        if (rawEmail && !EMAIL_PATTERN.test(rawEmail)) {
            return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
        }

        const normalizedMobile = rawMobile
            ? normalizePhilippineMobile(rawMobile, { fallbackToRaw: false })
            : '';
        if (rawMobile && !normalizedMobile) {
            return res.status(400).json({ ok: false, error: 'Please enter a valid mobile number.' });
        }

        const accountNumber = String(req.customer?.accountNumber || '').trim();
        if (!accountNumber) {
            return res.status(400).json({ ok: false, error: 'Customer account number is required.' });
        }

        const customers = await readCustomers(branchId);
        const index = customers.findIndex((customer) => String(customer?.accountNumber || '').trim() === accountNumber);
        if (index < 0) {
            return res.status(404).json({ ok: false, error: 'Customer not found.' });
        }

        const updatedCustomer = {
            ...customers[index],
            email: rawEmail || null,
            mobile: normalizedMobile || null,
            mobileRaw: normalizedMobile || null
        };

        customers[index] = updatedCustomer;
        if (await isRelationalReady()) {
            await writeCustomers([updatedCustomer], branchId);
        } else {
            await writeCustomers(customers, branchId);
        }

        triggerBranchServiceRefreshSafe(branchId, 'customers-self-contact-update');
        res.json({ ok: true, customer: sanitizeCustomerPayload(updatedCustomer) });
    } catch (error) {
        next(error);
    }
});

publicRouter.post('/logout', async (req, res) => {
    const sessionId = getCustomerSessionId(req);
    if (sessionId) {
        await loadCustomerSessions();
        customerSessions.delete(sessionId);
        await persistCustomerSessionsSafe();
    }
    clearCustomerSessionCookie(req, res);
    res.json({ ok: true });
});

publicRouter.post('/update-credentials', async (req, res, next) => {
    try {
        const rawUsername = String(req.body?.username || '').trim();
        const rawAccount = String(req.body?.accountNumber || '').trim();
        const currentPassword = String(req.body?.password || '');
        const nextUsername = String(req.body?.newUsername || '').trim();
        const nextPassword = String(req.body?.newPassword || '').trim();

        if (!rawUsername && !rawAccount) {
            return res.status(400).json({ ok: false, error: 'Username or account number is required' });
        }
        if (!currentPassword) {
            return res.status(400).json({ ok: false, error: 'Password is required' });
        }
        if (!nextUsername && !nextPassword) {
            return res.status(400).json({ ok: false, error: 'New username or password is required' });
        }

        const customers = await readCustomers();
        const lookupUsername = rawUsername.toLowerCase();

        let index = -1;
        if (rawAccount) {
            index = customers.findIndex(c => String(c.accountNumber || '') === rawAccount);
        }
        if (index < 0 && lookupUsername) {
            index = customers.findIndex(c => String(c.loginUsername || '').trim().toLowerCase() === lookupUsername);
        }

        if (index < 0) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }

        const existing = customers[index];
        const existingUsername = String(existing.loginUsername || '').trim().toLowerCase();
        if (lookupUsername && existingUsername !== lookupUsername) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }
        if (!verifyPassword(currentPassword, String(existing.loginPassword || ''))) {
            return res.status(401).json({ ok: false, error: 'Invalid credentials' });
        }

        if (nextUsername) {
            const nextUsernameLower = nextUsername.toLowerCase();
            const usernameTaken = customers.some((c, i) =>
                i !== index && String(c.loginUsername || '').trim().toLowerCase() === nextUsernameLower
            );
            if (usernameTaken) {
                return res.status(409).json({ ok: false, error: 'Username already exists' });
            }
        }

        const updatedCustomer = { ...existing };
        if (nextUsername) updatedCustomer.loginUsername = nextUsername;
        if (nextPassword) updatedCustomer.loginPassword = nextPassword;

        customers[index] = updatedCustomer;
        if (await isRelationalReady()) {
            await writeCustomers([updatedCustomer], updatedCustomer.branchId || null);
        } else {
            await writeCustomers(customers);
        }

        const { loginPassword, statusRaw, ...safeCustomer } = updatedCustomer;
        res.json({ ok: true, customer: safeCustomer });
    } catch (error) {
        next(error);
    }
});

// POST /api/customers/quick-payment/lookup
// body: { accountNumber }
// Public account-number-only lookup for quick payment. Returns payment-safe balance data only.
publicRouter.post('/quick-payment/lookup', async (req, res, next) => {
    try {
        const customer = await findCustomerForQuickPayment(req.body?.accountNumber);
        const snapshot = await buildQuickPaymentSnapshot(customer);
        res.json({
            ok: true,
            account: snapshot
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/customers/quick-payment/ewallet
// body: { accountNumber, method }
// Creates a payment link for the full outstanding balance without exposing customer profile details.
publicRouter.post('/quick-payment/ewallet', async (req, res, next) => {
    try {
        const customer = await findCustomerForQuickPayment(req.body?.accountNumber);
        const snapshot = await buildQuickPaymentSnapshot(customer);
        if (!snapshot.hasPayableBalance) {
            return next(createError(400, 'No outstanding balance for this account.'));
        }
        const requestedAmount = Number(req.body?.amount);
        const amount = Number.isFinite(requestedAmount) && requestedAmount > 0
            ? Number(requestedAmount.toFixed(2))
            : snapshot.amountDue;
        if (amount > snapshot.amountDue) {
            return next(createError(400, 'Amount cannot be higher than the outstanding balance.'));
        }

        const checkout = await createCustomerXenditCheckout({
            req,
            customer,
            branchId: customer.branchId || null,
            method: req.body?.method || 'gcash',
            amount,
            description: `Quick payment for account ${snapshot.accountNumber}`,
            successRedirectUrl: buildQuickPaymentRedirectUrl(req, 'paid', snapshot.accountNumber),
            failureRedirectUrl: buildQuickPaymentRedirectUrl(req, 'failed', snapshot.accountNumber),
            paymentMode: snapshot.paymentMode,
            includeCustomerDetails: false
        });

        res.json({
            ...checkout,
            account: snapshot
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/customers/payments/ewallet
// body: { username? | accountNumber?, password, method, amount?, planName?, planId?, successRedirectUrl?, failureRedirectUrl? }
publicRouter.post('/payments/ewallet', async (req, res, next) => {
    try {
        const {
            username,
            accountNumber,
            password,
            method = 'gcash',
            amount: rawAmount,
            planName,
            planId,
            successRedirectUrl,
            failureRedirectUrl
        } = req.body || {};

        const requestedAccountNumber = sanitizeString(accountNumber);
        const sessionCustomer = await getCustomerFromSession(req, res).catch(() => null);
        let customer = null;
        if (
            sessionCustomer
            && (!requestedAccountNumber || requestedAccountNumber === sanitizeString(sessionCustomer.accountNumber))
        ) {
            customer = sessionCustomer;
        } else {
            if ((!username && !accountNumber) || !password) {
                return next(createError(400, 'Username/account number and password are required.'));
            }
            const customers = await readCustomers();
            customer = findCustomerByCredentials(customers, { username, accountNumber, password });
            if (!customer) return next(createError(401, 'Invalid credentials.'));
        }
        const branchId = customer.branchId || null;
        const plans = await readPlans(branchId);
        const planCategory = resolvePlanCategory(customer, plans);
        const paymentMode = planCategory === 'prepaid' ? 'prepaid' : 'postpaid';

        let amount = 0;
        let selectedPlan = null;
        if (paymentMode === 'prepaid') {
            const planKey = String(planId || planName || '').trim().toLowerCase();
            if (!planKey) {
                return next(createError(400, 'Prepaid plan is required.'));
            }
            selectedPlan = (Array.isArray(plans) ? plans : []).find((p) => {
                const id = String(p.id || '').trim().toLowerCase();
                const name = normalizePlanName(p.name);
                const key = normalizePlanName(planKey);
                return (id && id === planKey) || (name && name === key);
            });
            if (!selectedPlan || String(selectedPlan.category || '').toLowerCase() !== 'prepaid') {
                return next(createError(404, 'Prepaid plan not found.'));
            }
            amount = Number(selectedPlan.price) || 0;
            if (amount <= 0) {
                return next(createError(400, 'Selected plan has no payable amount.'));
            }
        } else {
            const payments = await readPayments(branchId);
            const history = payments?.[customer.accountNumber]?.history || [];
            const summary = computePaymentSummary(history);
            const outstanding = Math.max(Number(summary.balance) || 0, 0);
            const requestedAmount = Number(rawAmount);
            amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : outstanding;
            if (!amount || amount <= 0) {
                return next(createError(400, 'No payable amount found for this customer.'));
            }
        }

        const settings = await loadPaymentIntegrationSettings(branchId);
        const apiKey = sanitizeString(settings?.xendit?.apiKey);
        if (!apiKey) {
            return next(createError(400, 'Xendit API key not configured.'));
        }

        const description = paymentMode === 'prepaid' && selectedPlan
            ? `Prepaid renewal for account ${customer.accountNumber} - ${selectedPlan.name}`
            : `Payment for account ${customer.accountNumber}`;

        const customerPhone = (() => {
            const raw = sanitizeString(customer.mobileRaw || customer.mobile || '');
            const digits = raw.replace(/\D+/g, '');
            if (raw.startsWith('+') && /^\+\d{8,15}$/.test(raw)) return raw;
            if (/^63\d{9,12}$/.test(digits)) return `+${digits}`;
            if (/^0\d{9,10}$/.test(digits)) return `+63${digits.slice(1)}`;
            return undefined;
        })();

        const methodRaw = String(method || 'gcash').toLowerCase();
        const channelMap = {
            gcash: 'PH_GCASH',
            grab: 'PH_GRABPAY',
            grabpay: 'PH_GRABPAY',
            shopee: 'PH_SHOPEEPAY',
            shopeepay: 'PH_SHOPEEPAY',
            maya: 'PH_PAYMAYA',
            paymaya: 'PH_PAYMAYA'
        };
        const invoiceMap = {
            grabpay: 'GRABPAY',
            grab: 'GRABPAY',
            shopee: 'SHOPEEPAY',
            shopeepay: 'SHOPEEPAY',
            maya: 'PAYMAYA',
            paymaya: 'PAYMAYA'
        };
        const channel_code = channelMap[methodRaw];
        if (!channel_code) {
            return next(createError(400, 'Unsupported e-wallet method. Use gcash, grabpay, shopeepay, or paymaya.'));
        }

        const referenceId = `cust-${customer.accountNumber}-${Date.now()}`;
        const receiptReference = extractDisplayReferenceFromXenditIdentifier(referenceId);
        const successUrl = buildXenditRedirectUrl(req, {
            provided: successRedirectUrl || settings?.xendit?.successRedirectUrl,
            status: 'paid',
            receipt: {
                accountNumber: customer.accountNumber,
                reference: receiptReference,
                amount,
                method: methodRaw,
                description,
                paymentMode
            }
        });
        const failureUrl = buildXenditRedirectUrl(req, {
            provided: failureRedirectUrl || settings?.xendit?.failureRedirectUrl,
            status: 'failed'
        });

        if (channel_code === 'PH_GCASH') {
            const payload = {
                reference_id: referenceId,
                amount,
                currency: 'PHP',
                channel_code,
                checkout_method: 'ONE_TIME_PAYMENT',
                channel_properties: {
                    success_redirect_url: successUrl,
                    failure_redirect_url: failureUrl,
                    cancel_redirect_url: failureUrl,
                    mobile_number: customerPhone
                },
                customer: {
                    given_names: customer.name || customer.loginUsername || 'Customer',
                    email: sanitizeString(customer.email) || undefined,
                    mobile_number: customerPhone
                },
                description
            };
            const charge = await callXenditEwalletCharge(apiKey, payload);
            const actions = charge?.actions || {};
            const checkoutUrl =
                actions.desktop_web_checkout_url ||
                actions.mobile_web_checkout_url ||
                charge.checkout_url ||
                charge.status_url;
            if (!checkoutUrl) {
                return next(createError(502, 'No checkout URL returned from Xendit.'));
            }
            return res.json({
                ok: true,
                checkoutUrl,
                method: methodRaw,
                amount,
                paymentMode,
                redirects: { success: successUrl, failure: failureUrl }
            });
        }

        const invoiceMethod = invoiceMap[methodRaw];
        const invoicePayload = {
            external_id: referenceId,
            amount,
            payer_email: sanitizeString(customer.email) || undefined,
            description,
            success_redirect_url: successUrl,
            failure_redirect_url: failureUrl,
            currency: 'PHP',
            payment_methods: invoiceMethod ? [invoiceMethod] : undefined
        };
        const invoice = await callXenditInvoice(apiKey, invoicePayload);
        if (!invoice?.invoice_url) {
            return next(createError(502, 'No checkout URL returned from Xendit invoice.'));
        }
        return res.json({
            ok: true,
            checkoutUrl: invoice.invoice_url,
            method: methodRaw,
            amount,
            paymentMode,
            redirects: { success: successUrl, failure: failureUrl }
        });
    } catch (error) {
        return next(createError(502, error?.message || 'Failed to create customer payment link.'));
    }
});

// POST /api/customers/payments/proof
// body:
// minimal app payload:
//   accountNumber (required), amount (required), proofImageData (required), proofMimeType?, proofFileName?
// optional authenticated payload:
//   username? | accountNumber?, password?,
//   amount?, reference?, paymentMethod?, notes?,
//   proofImageData (required), proofMimeType?, proofFileName?
publicRouter.post('/payments/proof', async (req, res, next) => {
    try {
        const {
            username,
            accountNumber,
            password,
            amount,
            reference,
            paymentMethod,
            notes,
            proofImageData,
            proofMimeType,
            proofFileName
        } = req.body || {};
        const accountNumberInput =
            String(accountNumber || req.body?.account_number || req.body?.accountNo || '').trim();
        const proofImageDataInput =
            proofImageData ||
            req.body?.imageProof ||
            req.body?.proofImage ||
            req.body?.proof ||
            '';
        const proofMimeTypeInput =
            proofMimeType ||
            req.body?.proofMime ||
            req.body?.mimeType ||
            '';
        const proofFileNameInput =
            proofFileName ||
            req.body?.fileName ||
            req.body?.proofFile ||
            '';

        const customer = await resolveCustomerForPublicPaymentAction({
            req,
            username,
            accountNumber: accountNumberInput,
            password,
            allowAccountOnly: true
        });

        const branchId = Number(customer?.branchId || 0);
        if (!Number.isInteger(branchId) || branchId <= 0) {
            return next(createError(400, 'Customer branch assignment is missing.'));
        }

        const amountValue = Number(amount);
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return next(createError(400, 'Payment amount is required.'));
        }

        const customerAccountNumber = String(customer?.accountNumber || accountNumberInput || '').trim();
        if (!customerAccountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const customerName = String(
            customer?.name ||
            `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim() ||
            ''
        ).trim();

        const submission = await createPaymentConfirmationSubmission({
            branchId,
            accountNumber: customerAccountNumber,
            customerName,
            amount: amountValue,
            reference,
            paymentMethod,
            notes,
            proofImageData: proofImageDataInput,
            proofMimeType: proofMimeTypeInput,
            proofFileName: proofFileNameInput
        });

        return res.status(201).json({
            ok: true,
            message: 'Payment proof submitted and queued for review.',
            submission
        });
    } catch (error) {
        return next(error);
    }
});

// GET /api/customers/:id - Get a single customer by ID
router.get('/:id', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        const customers = await readCustomers(branchId);
        const customer = customers.find(c => c.accountNumber === req.params.id);
        if (customer) {
            const [plans, payments] = await Promise.all([
                readPlans(branchId),
                readPayments(branchId)
            ]);
            const [technicalCustomer] = await enrichCustomersWithTechnicalDetails([customer], branchId);
            const enriched = attachCustomerStatusReason(technicalCustomer || customer, { plans, payments, now: new Date() });
            res.json(sanitizeCustomerForAdmin(attachCustomerPaymentSummary(enriched, payments)));
        } else {
            res.status(404).json({ message: 'Customer not found' });
        }
    } catch (error) {
        next(error);
    }
});

// POST /api/customers - Add a new customer
router.post('/', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ message: 'Branch assignment missing for this admin account.' });
        }
        const persistedCustomer = await createCustomerRecord(req.body || {}, {
            branchId,
            refreshSource: 'customers-create'
        });
        const [technicalCustomer] = await enrichCustomersWithTechnicalDetails([persistedCustomer], branchId);
        const payments = await readPayments(branchId);
        res.status(201).json(sanitizeCustomerForAdmin(attachCustomerPaymentSummary(technicalCustomer || persistedCustomer, payments)));
    } catch (error) {
        next(error);
    }
});

// PUT /api/customers/:id - Update an existing customer
router.put('/:id', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ message: 'Branch assignment missing for this admin account.' });
        }
        const persistedCustomer = await updateCustomerRecord(req.params.id, req.body || {}, {
            branchId,
            refreshSource: 'customers-update'
        });
        const [technicalCustomer] = await enrichCustomersWithTechnicalDetails([persistedCustomer], branchId);
        const payments = await readPayments(branchId);
        res.json(sanitizeCustomerForAdmin(attachCustomerPaymentSummary(technicalCustomer || persistedCustomer, payments)));
    } catch (error) {
        next(error);
    }
});

// DELETE /api/customers/bulk - Delete multiple customers
router.delete('/bulk', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ message: 'Branch assignment missing for this admin account.' });
        }

        const inputAccounts = Array.isArray(req.body?.accountNumbers)
            ? req.body.accountNumbers
            : (Array.isArray(req.body?.accounts) ? req.body.accounts : []);
        const accountNumbers = Array.from(
            new Set(
                inputAccounts
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            )
        );

        if (!accountNumbers.length) {
            return res.status(400).json({ message: 'Please provide at least one valid account number.' });
        }
        if (accountNumbers.length > 500) {
            return res.status(400).json({ message: 'Too many account numbers. Maximum is 500 per request.' });
        }

        let deletedCount = 0;
        const deletedAccounts = [];
        const notFound = [];
        const failed = [];

        for (const accountNumber of accountNumbers) {
            try {
                await deleteCustomerRecord(accountNumber, {
                    branchId,
                    refreshSource: '',
                    deletedBy: req.user || {}
                });
                deletedCount += 1;
                deletedAccounts.push(accountNumber);
            } catch (error) {
                const status = Number(error?.status || error?.statusCode || 0);
                if (status === 404) {
                    notFound.push(accountNumber);
                    continue;
                }
                failed.push({
                    accountNumber,
                    message: error?.message || 'Unable to delete customer.'
                });
            }
        }

        if (deletedCount > 0) {
            triggerBranchServiceRefreshSafe(branchId, 'customers-bulk-delete');
        }

        return res.json({
            ok: true,
            requestedCount: accountNumbers.length,
            deletedCount,
            deletedAccounts,
            notFound,
            failed
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/customers/:id - Delete a customer
router.delete('/:id', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return res.status(400).json({ message: 'Branch assignment missing for this admin account.' });
        }
        await deleteCustomerRecord(req.params.id, {
            branchId,
            refreshSource: 'customers-delete',
            deletedBy: req.user || {}
        });
        res.status(204).send(); // No Content
    } catch (error) {
        next(error);
    }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.getCustomerFromSession = getCustomerFromSession;
module.exports.requireCustomer = requireCustomer;
module.exports.readCustomers = readCustomers;
module.exports.readVisibleCustomers = readVisibleCustomers;
module.exports.writeCustomers = writeCustomers;
module.exports.readPayments = readPayments;
module.exports.readPlans = readPlans;
module.exports.computePaymentSummary = computePaymentSummary;
module.exports.resolvePlanCategory = resolvePlanCategory;
module.exports.createCustomerRecord = createCustomerRecord;
module.exports.updateCustomerRecord = updateCustomerRecord;
module.exports.deleteCustomerRecord = deleteCustomerRecord;
module.exports.removeCustomerPppoeAccounts = removeCustomerPppoeAccounts;
module.exports.restoreArchivedCustomerRecord = restoreArchivedCustomerRecord;
module.exports.purgeExpiredArchivedCustomerRecords = purgeExpiredArchivedCustomerRecords;
module.exports.scheduleCustomerArchiveCleanupWithPppoe = scheduleCustomerArchiveCleanupWithPppoe;
module.exports.sanitizeCustomerForAdmin = sanitizeCustomerForAdmin;
module.exports.resolveStoredAccountPrefixId = resolveStoredAccountPrefixId;
module.exports.generateAccountNumber = generateAccountNumber;
