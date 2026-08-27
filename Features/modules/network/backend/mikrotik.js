const express = require('express');
const { requireAuth } = require('../../admin/backend/auth');
const { connectMikrotikClient, normalizeMikrotikErrorCode } = require('./mikrotik-client');
const { normalizeMikrotikEndpoint } = require('./mikrotik-endpoint');
const { readCustomers, readPlans, updateCustomerRecord } = require('../../customer-management/backend/customers');
const {
    loadIntegrationSettings,
    saveIntegrationSettings,
    resolveMikrotikRouter,
    normalizeMikrotikSettings
} = require('../../admin/backend/integration-settings');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { resolvePlanProfileForRouter } = require('../../billing/backend/plan-profile-utils');
const { serializePaymentMutationRequest } = require('../../billing/backend/payment-numbering');
const {
    getActiveClosedCustomerAccount
} = require('../../customer-management/backend/closed-customer-account-store');
const { auditMikrotikPppoeCommand } = require('./mikrotik-audit-log');
const {
    dedupeActivePppoeSessions,
    dedupePppoeAccounts,
    buildPppoeAccountKey,
    mergePppoeAccountEntries,
    normalizePppoeRouterId,
    normalizePppoeSecretId,
    normalizePppoeUsernameKey
} = require('./pppoe-account-utils');

const router = express.Router();
const PPPoE_SESSION_HISTORY_LIMIT = 20;
const PPPoE_SESSION_RECORDER_INTERVAL_MS = Math.max(
    10 * 1000,
    Number(process.env.PPPOE_SESSION_RECORDER_INTERVAL_MS || 60 * 1000) || 60 * 1000
);
const PPPoE_SESSION_RESTART_GRACE_MS = 2 * 60 * 1000;
const PPPoE_SESSION_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
let pppoeSessionRecorderTimer = null;
let pppoeSessionRecorderInFlight = false;

const coerceOptionalTrue = (value) => {
    if (value === true) return true;
    if (value === 1 || value === '1') return true;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y', 'on'].includes(normalized)) return true;
    return undefined;
};

const normalizeCredentials = (raw = {}) => {
    const endpoint = normalizeMikrotikEndpoint(raw.address || raw.host, raw.port);
    const username = String(raw.username || raw.user || '').trim();
    const password = raw.password != null ? String(raw.password) : '';
    return {
        address: endpoint.address,
        rawAddress: endpoint.rawAddress,
        hadEmbeddedPort: endpoint.hadEmbeddedPort,
        username,
        password,
        port: endpoint.port,
        tls: coerceOptionalTrue(raw.tls ?? raw.apiSsl ?? raw.ssl)
    };
};

const normalizePlanName = (value) => String(value || '').trim().toLowerCase();

const getRouterIdFromRequest = (req) => {
    const bodyId = req.body?.routerId || req.body?.mikrotikId;
    const queryId = req.query?.routerId || req.query?.mikrotikId;
    const routerId = bodyId || queryId || '';
    return String(routerId || '').trim();
};

const resolveRouterContext = (stored, req, overrides = {}) => {
    const routerId = getRouterIdFromRequest(req);
    const router = resolveMikrotikRouter(stored, routerId);
    const creds = normalizeCredentials({ ...(router || {}), ...(overrides || {}) });
    const resolvedId = router?.id || routerId || stored?.mikrotikDefaultId || '';
    return { router, routerId: resolvedId, creds };
};

const resolveBranchId = (req) => {
    const branchId = Number(req.user?.branchId);
    return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
};

const serializePppoeActivationRequest = (req, res, next) => {
    const payload = req.body || {};
    const isDelete = payload.delete === true || payload.action === 'delete';
    const requestedStatus = String(payload.status || 'active').trim().toLowerCase();
    const isDisabled = requestedStatus === 'inactive' || requestedStatus === 'disabled';
    if (isDelete || isDisabled) return next();
    return serializePaymentMutationRequest(req, res, next);
};

const assertPppoeActivationAccountOpen = async (branchId, accountNumber) => {
    const normalizedAccountNumber = String(accountNumber || '').trim();
    if (!normalizedAccountNumber) return;
    const activeClosure = await getActiveClosedCustomerAccount(branchId, normalizedAccountNumber);
    if (!activeClosure) return;
    const error = new Error(
        'This customer account is closed. Reopen it from Customer Archive before enabling or creating PPPoE service.'
    );
    error.status = 409;
    error.code = 'PPPOE_ACCOUNT_CLOSED';
    throw error;
};

const findConfiguredRouterById = (settings = {}, routerId = '') => {
    const requestedRouterId = String(routerId || '').trim();
    if (!requestedRouterId) return null;
    const normalized = normalizeMikrotikSettings(settings);
    return (Array.isArray(normalized?.mikrotikRouters) ? normalized.mikrotikRouters : []).find((router) =>
        String(router?.id || '').trim() === requestedRouterId
    ) || null;
};

const buildRouterConfigurationError = (routerId = '') => {
    const requestedRouterId = String(routerId || '').trim();
    if (!requestedRouterId) {
        return 'No usable MikroTik router is configured for this branch.';
    }
    return `MikroTik router "${requestedRouterId}" is not configured for this branch. Update Control Center > Settings > MikroTik routers.`;
};

const filterAccountsByRouter = (accounts = [], routerId, defaultId) => {
    const deduped = dedupePppoeAccounts(accounts, defaultId || routerId || '');
    if (!routerId) return deduped;
    const fallbackId = defaultId || routerId;
    return deduped.filter((acc) => String(acc?.routerId || fallbackId) === routerId);
};

const claimActiveSessionForUsername = (activeByUser, claimedUsernames, username) => {
    const usernameKey = normalizePppoeUsernameKey(username);
    if (!usernameKey) return null;
    if (claimedUsernames?.has(usernameKey)) return null;
    const active = activeByUser?.get(usernameKey) || null;
    if (active) claimedUsernames?.add(usernameKey);
    return active;
};

const findStoredAccount = (accounts = [], { routerId = '', defaultId = '', secretId = '', username = '' } = {}) => {
    const targetKey = buildPppoeAccountKey(
        {
            routerId: normalizePppoeRouterId(routerId, defaultId),
            secretId: normalizePppoeSecretId(secretId),
            username
        },
        defaultId
    );
    if (!targetKey) return null;
    return (Array.isArray(accounts) ? accounts : []).find((acc) => buildPppoeAccountKey(acc, defaultId) === targetKey) || null;
};

const findStoredAccountIndex = (accounts = [], { routerId = '', defaultId = '', secretId = '', username = '' } = {}) => {
    const targetKey = buildPppoeAccountKey(
        {
            routerId: normalizePppoeRouterId(routerId, defaultId),
            secretId: normalizePppoeSecretId(secretId),
            username
        },
        defaultId
    );
    if (!targetKey) return -1;
    return (Array.isArray(accounts) ? accounts : []).findIndex((acc) => buildPppoeAccountKey(acc, defaultId) === targetKey);
};

const findRouterSecretByIdentity = (secrets = [], { secretId = '', username = '' } = {}) => {
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    const usernameKey = normalizePppoeUsernameKey(username);
    return (Array.isArray(secrets) ? secrets : []).find((secret) => {
        const itemSecretId = normalizePppoeSecretId(secret?.['.id'] || secret?.id);
        if (normalizedSecretId && itemSecretId === normalizedSecretId) return true;
        const itemUsername = String(secret?.name || secret?.user || '').trim();
        return Boolean(usernameKey && normalizePppoeUsernameKey(itemUsername) === usernameKey);
    }) || null;
};

const findRouterSecretsByIdentity = (secrets = [], { secretId = '', username = '' } = {}) => {
    const normalizedSecretId = normalizePppoeSecretId(secretId);
    const usernameKey = normalizePppoeUsernameKey(username);
    return (Array.isArray(secrets) ? secrets : []).filter((secret) => {
        const itemSecretId = normalizePppoeSecretId(secret?.['.id'] || secret?.id);
        if (normalizedSecretId) return itemSecretId === normalizedSecretId;
        const itemUsername = String(secret?.name || secret?.user || '').trim();
        return Boolean(usernameKey && normalizePppoeUsernameKey(itemUsername) === usernameKey);
    });
};

const removeRouterSecretById = async (api, internalId, username = '') => {
    const normalizedId = normalizePppoeSecretId(internalId);
    const safeUsername = String(username || '').trim();
    const attempts = [];
    if (normalizedId && api?.rosApi && typeof api.rosApi.write === 'function') {
        attempts.push(() => api.rosApi.write(['/ppp/secret/remove', `=.id=${normalizedId}`]));
    }
    if (normalizedId) {
        attempts.push(() => api.menu('/ppp secret').remove(normalizedId));
        attempts.push(() => api.menu('/ppp secret').remove({ '.id': normalizedId }));
    }
    if (safeUsername) {
        attempts.push(() => api.menu('/ppp secret').where('name', safeUsername).remove());
    }

    let lastError = null;
    for (const attempt of attempts) {
        try {
            await attempt();
            return true;
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return false;
};

const removeRouterSecretsByIdentity = async (api, { secretId = '', username = '', preloadedSecrets = null } = {}) => {
    const secrets = Array.isArray(preloadedSecrets)
        ? preloadedSecrets
        : await api.menu('/ppp secret').get();
    const matches = findRouterSecretsByIdentity(secrets, { secretId, username });
    let removed = 0;
    for (const match of matches) {
        const internalId = normalizePppoeSecretId(match?.['.id'] || match?.id);
        const matchUsername = String(match?.name || match?.user || username || '').trim();
        await removeRouterSecretById(api, internalId, matchUsername);
        removed += 1;
    }
    return { removed, matches };
};

const isPppoeSecretDisabled = (secret = {}) => String(secret?.disabled || '').toLowerCase() === 'true';

const summarizeRouterSecrets = (secrets = [], activeUsers = []) => {
    const activeUserKeys = new Set(
        (Array.isArray(activeUsers) ? activeUsers : [])
            .map((session) => normalizePppoeUsernameKey(session?.username || session?.name || session?.user || ''))
            .filter(Boolean)
    );
    return (Array.isArray(secrets) ? secrets : []).reduce(
        (summary, secret) => {
            const username = String(secret?.name || secret?.user || '').trim();
            if (!username) return summary;
            summary.totalCount += 1;
            const usernameKey = normalizePppoeUsernameKey(username);
            if (activeUserKeys.has(usernameKey)) {
                summary.activeCount += 1;
            }
            if (isPppoeSecretDisabled(secret)) {
                summary.disabledCount += 1;
            } else if (!activeUserKeys.has(usernameKey)) {
                summary.offlineCount += 1;
            }
            return summary;
        },
        { totalCount: 0, activeCount: 0, disabledCount: 0, offlineCount: 0 }
    );
};

const listRouterProfileNames = (profiles = []) =>
    Array.from(
        new Set(
            (Array.isArray(profiles) ? profiles : [])
                .map((profile) => String(profile?.name || profile?.profile || profile?.id || '').trim())
                .filter(Boolean)
        )
    ).sort((left, right) => left.localeCompare(right));

const mergeAccountsForRouter = (settings, routerId, routerAccounts) => {
    const normalizedRouterId = normalizePppoeRouterId(routerId, settings?.mikrotikDefaultId || '');
    const existing = dedupePppoeAccounts(
        Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
        settings?.mikrotikDefaultId || normalizedRouterId
    );
    const existingByKey = new Map(
        existing
            .filter((acc) => normalizePppoeRouterId(acc?.routerId, settings?.mikrotikDefaultId || normalizedRouterId) === normalizedRouterId)
            .map((acc) => [buildPppoeAccountKey(acc, settings?.mikrotikDefaultId || normalizedRouterId), acc])
            .filter(([key]) => Boolean(key))
    );
    const preserved = existing.filter(
        (acc) => normalizePppoeRouterId(acc?.routerId, settings?.mikrotikDefaultId || normalizedRouterId) !== normalizedRouterId
    );
    const nextAccounts = dedupePppoeAccounts(routerAccounts, normalizedRouterId).map((acc) => {
        const previous = existingByKey.get(buildPppoeAccountKey(acc, settings?.mikrotikDefaultId || normalizedRouterId)) || null;
        const merged = mergePppoeUsageState(previous, { ...acc, routerId: normalizedRouterId }).account;
        return mergePppoeAccountEntries(previous, merged, normalizedRouterId);
    });
    return dedupePppoeAccounts([...preserved, ...nextAccounts], settings?.mikrotikDefaultId || normalizedRouterId);
};

const validateCredentials = (creds) => {
    if (!creds.address) throw new Error('MikroTik address is required');
    if (!creds.username) throw new Error('MikroTik username is required');
    if (!creds.password) throw new Error('MikroTik password is required');
};

const connectMikrotik = async (creds, options = {}) => {
    return connectMikrotikClient(creds, {
        keepalive: true,
        timeout: 8000,
        ...options
    });
};

const DEFAULT_MIKROTIK_API_IDLE_MS = 12 * 60 * 60 * 1000;
const MIKROTIK_API_IDLE_MS = (() => {
    const configured = Number(process.env.MIKROTIK_API_IDLE_MS);
    if (!Number.isFinite(configured) || configured < 30 * 1000) return DEFAULT_MIKROTIK_API_IDLE_MS;
    return configured;
})();
const mikrotikConnectionPool = new Map();
const mikrotikConnectionPromises = new Map();

const normalizePort = (value) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
    return 8728;
};

const formatMikrotikError = (error, creds = {}) => {
    const code = normalizeMikrotikErrorCode(error);
    const address = String(creds?.address || '').trim() || String(creds?.rawAddress || '').trim() || 'unknown-host';
    const port = normalizePort(creds?.port);
    const combinedErrors = Array.isArray(error?.mikrotikModeErrors) ? error.mikrotikModeErrors : [];

    if (combinedErrors.length > 1) {
        const summary = combinedErrors
            .map((entry) => {
                const transportLabel = entry?.transport === 'tls' ? 'api-ssl' : 'api';
                const message = String(entry?.message || '').trim() || String(entry?.code || '').trim() || 'unknown error';
                return `${transportLabel}: ${message}`;
            })
            .join(' | ');
        return `Unable to negotiate MikroTik connection on ${address}:${port}. ${summary}`;
    }

    if (code === 'EAI_NONAME' || code === 'ENOTFOUND') {
        return `DNS lookup failed for MikroTik host "${address}". Check the address or DDNS record.`;
    }
    if (code === 'EAI_AGAIN') {
        return `DNS lookup timed out for MikroTik host "${address}". Try again in a moment.`;
    }
    if (code === 'CANTLOGIN') {
        return 'MikroTik username or password is invalid.';
    }
    if (code === 'SOCKTMOUT') {
        return `MikroTik connection to ${address}:${port} timed out. Check whether this tunnel forwards to the correct RouterOS API service (8728/api or 8729/api-ssl).`;
    }
    if (code === 'ECONNREFUSED') {
        return `MikroTik connection to ${address}:${port} was refused. Check the forwarded API port and that RouterOS API is enabled.`;
    }
    if (code === 'ECONNRESET') {
        return `MikroTik closed the connection on ${address}:${port}. This usually means the forwarded port/protocol does not match the selected API mode (8728/api vs 8729/api-ssl), or an address/firewall rule is dropping the session after connect.`;
    }
    if (code === 'ETIMEDOUT') {
        return `MikroTik connection to ${address}:${port} timed out. Check reachability and firewall rules.`;
    }
    if (code === 'UNKNOWNREPLY') {
        return `MikroTik returned an unexpected API reply on ${address}:${port}. The connection will be reset; check RouterOS API service mode and tunnel stability.`;
    }
    if (code === 'UNREGISTEREDTAG') {
        return `MikroTik sent a stale API response on ${address}:${port}. The connection was reset; retry the action and check RouterOS API tunnel stability if it repeats.`;
    }
    if (/ssl|tls|handshake|certificate|sspi/i.test(String(error?.message || ''))) {
        return `MikroTik TLS handshake failed on ${address}:${port}. api-ssl often fails this way when certificate=none; assign a certificate to api-ssl or use plain api (8728).`;
    }
    return error?.message || code || 'Unknown MikroTik error';
};

const buildPoolKey = (routerId, creds) => {
    const id = String(routerId || 'default').trim() || 'default';
    const host = String(creds?.address || '').trim().toLowerCase();
    const user = String(creds?.username || '').trim().toLowerCase();
    const port = normalizePort(creds?.port);
    return `${id}|${host}|${user}|${port}`;
};

const sameConnectionConfig = (left = {}, right = {}) => {
    const leftHost = String(left.address || '').trim().toLowerCase();
    const rightHost = String(right.address || '').trim().toLowerCase();
    const leftUser = String(left.username || '').trim().toLowerCase();
    const rightUser = String(right.username || '').trim().toLowerCase();
    const leftPassword = String(left.password || '');
    const rightPassword = String(right.password || '');
    return (
        leftHost === rightHost &&
        leftUser === rightUser &&
        leftPassword === rightPassword &&
        normalizePort(left.port) === normalizePort(right.port)
    );
};

const closePoolEntry = async (key, explicitEntry = null) => {
    const entry = explicitEntry || mikrotikConnectionPool.get(key);
    if (!entry) return;
    mikrotikConnectionPool.delete(key);
    if (typeof entry.client?.close === 'function') {
        await entry.client.close().catch(() => {});
    }
};

const getPooledApi = async (routerId, creds) => {
    const key = buildPoolKey(routerId, creds);
    const now = Date.now();
    const existing = mikrotikConnectionPool.get(key);
    if (existing) {
        if (sameConnectionConfig(existing.creds, creds)) {
            existing.lastUsedAt = now;
            return { key, api: existing.api };
        }
        await closePoolEntry(key, existing);
    }

    const inFlight = mikrotikConnectionPromises.get(key);
    if (inFlight) {
        const entry = await inFlight;
        if (entry && sameConnectionConfig(entry.creds, creds)) {
            entry.lastUsedAt = now;
            return { key, api: entry.api };
        }
        await closePoolEntry(key, entry);
    }

    const createPromise = (async () => {
        const { client, api, tls } = await connectMikrotik(creds, {
            label: key,
            onClientError: () => {
                closePoolEntry(key).catch(() => {});
            },
            logger: (error, context) => {
                const reason = formatMikrotikError(error, creds);
                const transport = context?.transport === 'tls' ? 'api-ssl' : context?.transport === 'plain' ? 'api' : '';
                const suffix = transport ? `|${transport}` : '';
                console.warn(`[mikrotik] pooled connection dropped [${context?.label || key}${suffix}]: ${reason}`);
            }
        });
        const current = mikrotikConnectionPool.get(key);
        if (current && current.client !== client) {
            await closePoolEntry(key, current);
        }
        const entry = {
            client,
            api,
            creds: { ...creds, tls: tls === true },
            lastUsedAt: Date.now()
        };
        mikrotikConnectionPool.set(key, entry);
        return entry;
    })();
    mikrotikConnectionPromises.set(key, createPromise);
    try {
        const entry = await createPromise;
        entry.lastUsedAt = now;
        return { key, api: entry.api };
    } finally {
        if (mikrotikConnectionPromises.get(key) === createPromise) {
            mikrotikConnectionPromises.delete(key);
        }
    }
};

const dropPooledApi = async (routerId, creds) => {
    const key = buildPoolKey(routerId, creds);
    await closePoolEntry(key);
};

const sweepIdleConnections = async () => {
    const now = Date.now();
    const staleEntries = [];
    for (const [key, entry] of mikrotikConnectionPool.entries()) {
        const lastUsedAt = Number(entry?.lastUsedAt || 0);
        if (!lastUsedAt || now - lastUsedAt >= MIKROTIK_API_IDLE_MS) {
            staleEntries.push([key, entry]);
        }
    }
    for (const [key, entry] of staleEntries) {
        await closePoolEntry(key, entry);
    }
};

const cleanupIntervalMs = Math.max(15 * 1000, Math.min(60 * 1000, Math.floor(MIKROTIK_API_IDLE_MS / 3)));
const mikrotikPoolSweepTimer = setInterval(() => {
    sweepIdleConnections().catch(() => {});
}, cleanupIntervalMs);
if (typeof mikrotikPoolSweepTimer?.unref === 'function') {
    mikrotikPoolSweepTimer.unref();
}

const fetchRouterInfo = async (api) => {
    const identity = await api.menu('/system identity').getOnly().catch(() => ({}));
    const resource = await api.menu('/system resource').getOnly().catch(() => ({}));
    return {
        identity: identity?.identity || identity?.name || null,
        boardName: resource?.boardName || resource?.['board-name'] || null,
        version: resource?.version || null,
        uptime: resource?.uptime || null,
        cpuLoad: resource?.cpuLoad ?? null,
        freeMemory: resource?.freeMemory ?? null,
        totalMemory: resource?.totalMemory ?? null
    };
};

const parseMetric = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const compact = raw.replace(/[\s,]+/g, '');
    if (!compact) return 0;
    if (/^\d+(\.\d+)?$/.test(compact)) {
        const num = Number(compact);
        return Number.isFinite(num) ? num : 0;
    }
    const match = compact.match(/^(\d+(?:\.\d+)?)([kmgt]i?b)?$/i);
    if (!match) return 0;
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return 0;
    const unit = (match[2] || '').toLowerCase();
    const factors = {
        kb: 1e3,
        mb: 1e6,
        gb: 1e9,
        tb: 1e12,
        kib: 1024,
        mib: 1024 * 1024,
        gib: 1024 * 1024 * 1024,
        tib: 1024 * 1024 * 1024 * 1024
    };
    const factor = factors[unit] || 1;
    return num * factor;
};

const parseBitsPerSecond = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const compact = raw.replace(/[\s,]+/g, '').toLowerCase();
    if (!compact) return 0;
    if (/^\d+(\.\d+)?$/.test(compact)) {
        const num = Number(compact);
        return Number.isFinite(num) ? num : 0;
    }
    const match = compact.match(/^(\d+(?:\.\d+)?)([kmgt]?i?)(?:bit|bits|b)(?:\/?s|ps)?$/i);
    if (!match) return 0;
    const num = Number(match[1]);
    if (!Number.isFinite(num)) return 0;
    const unit = String(match[2] || '').toLowerCase();
    const factors = {
        k: 1e3,
        m: 1e6,
        g: 1e9,
        t: 1e12,
        ki: 1024,
        mi: 1024 * 1024,
        gi: 1024 * 1024 * 1024,
        ti: 1024 * 1024 * 1024 * 1024
    };
    return num * (factors[unit] || 1);
};

const readMetricValue = (source, keys = []) => {
    for (const key of keys) {
        if (source && source[key] != null && source[key] !== '') {
            return source[key];
        }
    }
    return null;
};

const readBitsPerSecond = (source, keys = []) => parseBitsPerSecond(readMetricValue(source, keys));

const readPacketsPerSecond = (source, keys = []) => parseMetric(readMetricValue(source, keys));

function normalizePppoeUsageStatus(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'active') return 'online';
    if (normalized === 'inactive') return 'disabled';
    return normalized;
}

function isPppoeOnlineStatus(value = '') {
    return normalizePppoeUsageStatus(value) === 'online';
}

function isPppoeOfflineStatus(value = '') {
    const normalized = normalizePppoeUsageStatus(value);
    return normalized === 'offline' || normalized === 'disabled';
}

function parseMikrotikDurationMs(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    let total = 0;
    const weekMatch = raw.match(/(\d+(?:\.\d+)?)w/);
    const dayMatch = raw.match(/(\d+(?:\.\d+)?)d/);
    const hourMatch = raw.match(/(\d+(?:\.\d+)?)h/);
    const minuteMatch = raw.match(/(\d+(?:\.\d+)?)m/);
    const secondMatch = raw.match(/(\d+(?:\.\d+)?)s/);
    if (weekMatch) total += Number(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000;
    if (dayMatch) total += Number(dayMatch[1]) * 24 * 60 * 60 * 1000;
    if (hourMatch) total += Number(hourMatch[1]) * 60 * 60 * 1000;
    if (minuteMatch) total += Number(minuteMatch[1]) * 60 * 1000;
    if (secondMatch) total += Number(secondMatch[1]) * 1000;
    if (total > 0) return total;
    const colonParts = raw.split(':').map((part) => Number(part));
    if (colonParts.length >= 2 && colonParts.every(Number.isFinite)) {
        const [hours = 0, minutes = 0, seconds = 0] = colonParts.length === 2
            ? [0, colonParts[0], colonParts[1]]
            : colonParts;
        return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
    }
    return null;
}

function formatSessionDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '-';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}

function limitPppoeSessionHistory(history = []) {
    return (Array.isArray(history) ? history : []).filter(Boolean).slice(-PPPoE_SESSION_HISTORY_LIMIT);
}

function buildCompletedPppoeSession({ loginAt = '', logoutAt = '', source = '' } = {}) {
    const safeLogoutAt = String(logoutAt || new Date().toISOString()).trim();
    const logoutTime = Date.parse(safeLogoutAt);
    const loginTime = Date.parse(String(loginAt || '').trim());
    const durationMs = Number.isFinite(loginTime) && Number.isFinite(logoutTime)
        ? Math.max(logoutTime - loginTime, 0)
        : null;
    return {
        loginAt: String(loginAt || '').trim(),
        logoutAt: safeLogoutAt,
        durationMs,
        durationLabel: Number.isFinite(durationMs) ? formatSessionDuration(durationMs) : '-',
        status: 'Completed',
        source
    };
}

function parsePppoeHistoryTime(value = '') {
    const parsed = Date.parse(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function hasPppoeSessionHistoryEntry(history = [], { loginAt = '', logoutAt = '', source = '' } = {}) {
    const targetLogoutTime = parsePppoeHistoryTime(logoutAt);
    const targetLoginTime = parsePppoeHistoryTime(loginAt);
    const targetLogoutKey = targetLogoutTime == null ? String(logoutAt || '').trim().toLowerCase() : '';
    const targetSource = String(source || '').trim().toLowerCase();
    if (!targetLogoutKey && targetLogoutTime == null && targetLoginTime == null) return false;
    return (Array.isArray(history) ? history : []).some((entry) => {
        const entryLogoutTime = parsePppoeHistoryTime(entry?.logoutAt);
        if (targetLogoutTime != null && entryLogoutTime != null) {
            if (Math.abs(entryLogoutTime - targetLogoutTime) <= PPPoE_SESSION_DUPLICATE_WINDOW_MS) return true;
        } else if (targetLogoutKey && String(entry?.logoutAt || '').trim().toLowerCase() === targetLogoutKey) {
            return true;
        }

        const entryLoginTime = parsePppoeHistoryTime(entry?.loginAt);
        const entrySource = String(entry?.source || '').trim().toLowerCase();
        return (
            targetLoginTime != null &&
            entryLoginTime != null &&
            Math.abs(entryLoginTime - targetLoginTime) <= PPPoE_SESSION_DUPLICATE_WINDOW_MS &&
            (!targetSource || !entrySource || targetSource === entrySource)
        );
    });
}

function readPppoeUsageState(entry = {}) {
    const sessionRx = parseMetric(entry?.sessionRxBytes);
    const sessionTx = parseMetric(entry?.sessionTxBytes);
    const sessionTotal = parseMetric(entry?.sessionTotalBytes) || sessionRx + sessionTx;
    const carryRx = parseMetric(entry?.usageCarryRxBytes);
    const carryTx = parseMetric(entry?.usageCarryTxBytes);
    const carryTotal = parseMetric(entry?.usageCarryTotalBytes) || carryRx + carryTx;
    return { sessionRx, sessionTx, sessionTotal, carryRx, carryTx, carryTotal };
}

function mergePppoeUsageState(previous = null, next = {}) {
    const current = next && typeof next === 'object' ? next : {};
    const nextUsage = readPppoeUsageState(current);
    const nextStatus = normalizePppoeUsageStatus(current.status);
    const nextUptimeMs = parseMikrotikDurationMs(current?.sessionUptime || current?.uptime);
    const inferredLoginAt = Number.isFinite(nextUptimeMs)
        ? new Date(Date.now() - nextUptimeMs).toISOString()
        : '';
    if (!previous || typeof previous !== 'object') {
        const initialHistory = limitPppoeSessionHistory(current.pppoeSessionHistory);
        const initialLogoutAt = !isPppoeOnlineStatus(nextStatus)
            ? String(current.inactiveSince || '').trim()
            : '';
        if (initialLogoutAt && !hasPppoeSessionHistoryEntry(initialHistory, {
            logoutAt: initialLogoutAt,
            source: 'MikroTik last-logged-out'
        })) {
            initialHistory.push(buildCompletedPppoeSession({
                logoutAt: initialLogoutAt,
                source: 'MikroTik last-logged-out'
            }));
        }
        return {
            account: {
                ...current,
                usageCarryRxBytes: nextUsage.carryRx,
                usageCarryTxBytes: nextUsage.carryTx,
                usageCarryTotalBytes: nextUsage.carryTotal,
                sessionRxBytes: nextUsage.sessionRx,
                sessionTxBytes: nextUsage.sessionTx,
                sessionTotalBytes: nextUsage.sessionTotal,
                currentSessionLoginAt: isPppoeOnlineStatus(nextStatus)
                    ? (current.currentSessionLoginAt || inferredLoginAt || '')
                    : '',
                pppoeSessionHistory: initialHistory
            },
            rolledOver: false
        };
    }

    const prevStatus = normalizePppoeUsageStatus(previous.status);
    const prevUsage = readPppoeUsageState(previous);
    const previousLoginAt = String(previous?.currentSessionLoginAt || '').trim();
    const sessionHistory = limitPppoeSessionHistory(previous?.pppoeSessionHistory);
    let historyChanged = false;
    let carryRx = prevUsage.carryRx;
    let carryTx = prevUsage.carryTx;
    let carryTotal = prevUsage.carryTotal;
    const previousLoginTime = Date.parse(previousLoginAt);
    const inferredLoginTime = Date.parse(inferredLoginAt);
    const restartedWhileOnline =
        isPppoeOnlineStatus(prevStatus) &&
        isPppoeOnlineStatus(nextStatus) &&
        Number.isFinite(previousLoginTime) &&
        Number.isFinite(inferredLoginTime) &&
        inferredLoginTime - previousLoginTime > PPPoE_SESSION_RESTART_GRACE_MS;

    const wentOffline = isPppoeOnlineStatus(prevStatus) && isPppoeOfflineStatus(nextStatus);
    const counterResetWhileOnline =
        isPppoeOnlineStatus(prevStatus) &&
        isPppoeOnlineStatus(nextStatus) &&
        prevUsage.sessionTotal > 0 &&
        nextUsage.sessionTotal < prevUsage.sessionTotal;
    const resumedFromLegacyOfflineSnapshot =
        !isPppoeOnlineStatus(prevStatus) &&
        isPppoeOnlineStatus(nextStatus) &&
        prevUsage.sessionTotal > 0 &&
        nextUsage.sessionTotal < prevUsage.sessionTotal;
    const shouldRollPreviousSession =
        prevUsage.sessionTotal > 0 &&
        (wentOffline || counterResetWhileOnline || resumedFromLegacyOfflineSnapshot || restartedWhileOnline);

    const appendCompletedSession = (loginAt, logoutAt, source = '') => {
        const safeLogoutAt = String(logoutAt || '').trim();
        if (!safeLogoutAt || hasPppoeSessionHistoryEntry(sessionHistory, { loginAt, logoutAt: safeLogoutAt, source })) return;
        sessionHistory.push(buildCompletedPppoeSession({ loginAt, logoutAt: safeLogoutAt, source }));
        historyChanged = true;
    };

    if (wentOffline) {
        appendCompletedSession(
            previousLoginAt,
            current.inactiveSince || new Date().toISOString(),
            current.inactiveSince ? 'MikroTik last-logged-out' : 'PPPoE session recorder'
        );
    }

    if (!isPppoeOnlineStatus(nextStatus) && current.inactiveSince) {
        appendCompletedSession(previousLoginAt, current.inactiveSince, 'MikroTik last-logged-out');
    }

    if (restartedWhileOnline) {
        appendCompletedSession(previousLoginAt, inferredLoginAt, 'MikroTik uptime reset');
    }

    if (shouldRollPreviousSession) {
        carryRx += prevUsage.sessionRx;
        carryTx += prevUsage.sessionTx;
        carryTotal += prevUsage.sessionTotal;
    }

    const clearCurrentSession = wentOffline;
    const nextCurrentSessionLoginAt = isPppoeOnlineStatus(nextStatus)
        ? ((restartedWhileOnline || counterResetWhileOnline) ? (inferredLoginAt || current.currentSessionLoginAt || '') : (previousLoginAt || inferredLoginAt || current.currentSessionLoginAt || ''))
        : '';
    return {
        account: {
            ...current,
            usageCarryRxBytes: carryRx,
            usageCarryTxBytes: carryTx,
            usageCarryTotalBytes: carryTotal,
            sessionRxBytes: clearCurrentSession ? 0 : nextUsage.sessionRx,
            sessionTxBytes: clearCurrentSession ? 0 : nextUsage.sessionTx,
            sessionTotalBytes: clearCurrentSession ? 0 : nextUsage.sessionTotal,
            currentSessionLoginAt: nextCurrentSessionLoginAt,
            pppoeSessionHistory: limitPppoeSessionHistory(sessionHistory)
        },
        rolledOver: shouldRollPreviousSession || historyChanged
    };
}

const readBytes = (session, keys) => {
    for (const key of keys) {
        if (session && session[key] != null && session[key] !== '') {
            return parseMetric(session[key]);
        }
    }
    return 0;
};

const readPackets = (session, keys) => {
    for (const key of keys) {
        if (session && session[key] != null && session[key] !== '') {
            return parseMetric(session[key]);
        }
    }
    return 0;
};

const normalizeActiveSessions = (activeSessions) => {
    if (!Array.isArray(activeSessions)) return [];
    return activeSessions
        .map((session) => {
            const username = session.name || session.user || '';
            if (!username) return null;
            const rxBytes = readBytes(session, [
                'bytes-in',
                'bytesIn',
                'rx-bytes',
                'rxBytes',
                'rxByte',
                'in-bytes',
                'inBytes'
            ]);
            const txBytes = readBytes(session, [
                'bytes-out',
                'bytesOut',
                'tx-bytes',
                'txBytes',
                'txByte',
                'out-bytes',
                'outBytes'
            ]);
            const totalBytes = readBytes(session, ['bytes', 'total-bytes', 'totalBytes', 'bytes-total']) || rxBytes + txBytes;
            const rxPackets = readPackets(session, [
                'packets-in',
                'packetsIn',
                'rx-packet',
                'rxPacket',
                'rxPackets',
                'rx-packets',
                'in-packets',
                'inPackets'
            ]);
            const txPackets = readPackets(session, [
                'packets-out',
                'packetsOut',
                'tx-packet',
                'txPacket',
                'txPackets',
                'tx-packets',
                'out-packets',
                'outPackets'
            ]);
            const totalPackets = readPackets(session, ['packets', 'total-packets', 'totalPackets', 'packets-total']) || rxPackets + txPackets;
            return {
                sessionId: String(session['.id'] || session.id || session['session-id'] || session.sessionId || '').trim(),
                username,
                address: session.address || session['remote-address'] || '',
                callerId: session.callerId || session['caller-id'] || session.lastCallerId || session['last-caller-id'] || '',
                encoding: session.encoding || '',
                service: session.service || '',
                uptime: session.uptime || session['session-uptime'] || '',
                rxBytes,
                txBytes,
                totalBytes,
                rxPackets,
                txPackets,
                totalPackets
            };
        })
        .filter(Boolean);
};

const hasRouterCredentials = (router = {}) => {
    const creds = normalizeCredentials(router);
    return Boolean(creds.address && creds.username && creds.password);
};

const resolveRouterContextById = (stored, routerId, overrides = {}) => {
    const router = resolveMikrotikRouter(stored, routerId);
    const creds = normalizeCredentials({ ...(router || {}), ...(overrides || {}) });
    const resolvedId = router?.id || String(routerId || '').trim() || stored?.mikrotikDefaultId || '';
    return { router, routerId: resolvedId, creds };
};

const normalizePppoeInterfaceName = (raw = '') => {
    let name = String(raw || '').trim();
    if (!name) return '';
    name = name.replace(/[<>]/g, '').trim();
    if (/^pppoe-/i.test(name)) {
        name = name.replace(/^pppoe-/i, '').trim();
    }
    return name;
};

const buildInterfaceUsageLookup = (interfaces = []) => {
    const map = new Map();
    const lowerMap = new Map();
    (Array.isArray(interfaces) ? interfaces : []).forEach((iface) => {
        const username = normalizePppoeInterfaceName(iface?.name || iface?.interface || '');
        if (!username) return;
        const rxBytes = readBytes(iface, ['rx-byte', 'rxByte', 'rxBytes', 'rx-bytes']);
        const txBytes = readBytes(iface, ['tx-byte', 'txByte', 'txBytes', 'tx-bytes']);
        const totalBytes = readBytes(iface, ['bytes', 'total-bytes', 'totalBytes', 'bytes-total']) || rxBytes + txBytes;
        const rxPackets = readPackets(iface, ['rx-packet', 'rxPacket', 'rxPackets', 'rx-packets']);
        const txPackets = readPackets(iface, ['tx-packet', 'txPacket', 'txPackets', 'tx-packets']);
        const totalPackets = readPackets(iface, ['packets', 'total-packets', 'totalPackets', 'packets-total']) || rxPackets + txPackets;
        const usage = {
            interfaceName: String(iface?.name || iface?.interface || '').trim(),
            rxBytes,
            txBytes,
            totalBytes,
            rxPackets,
            txPackets,
            totalPackets
        };
        if (!map.has(username)) {
            map.set(username, usage);
        }
        const lowerKey = username.toLowerCase();
        if (!lowerMap.has(lowerKey)) {
            lowerMap.set(lowerKey, usage);
        }
    });
    return { map, lowerMap };
};

const getUsageForUser = (lookup, username) => {
    if (!lookup || !username) return null;
    const direct = lookup.map.get(username);
    if (direct) return direct;
    const lower = lookup.lowerMap.get(String(username).toLowerCase());
    return lower || null;
};

const getRouterActivePppoeSnapshot = async ({ branchId = null, settings = null, routerId = '', overrides = {}, includeInfo = true } = {}) => {
    const stored = settings || await loadIntegrationSettings(branchId);
    const context = resolveRouterContextById(stored, routerId, overrides);
    validateCredentials(context.creds);
    try {
        const { api } = await getPooledApi(context.routerId, context.creds);
        const activeSessions = await api.menu('/ppp active').get().catch(() => []);
        const activeSessionCount = Array.isArray(activeSessions) ? activeSessions.length : 0;
        const interfaceStats = await api
            .menu('/interface')
            .options('stats')
            .where('type', 'pppoe-in')
            .get()
            .catch(() => []);
        const usageLookup = buildInterfaceUsageLookup(interfaceStats);
        const info = includeInfo ? await fetchRouterInfo(api) : {};
        const activeSessionsNormalized = normalizeActiveSessions(activeSessions).map((session) => {
            const usage = getUsageForUser(usageLookup, session.username);
            if (!usage) return session;
            const rxBytes = usage.rxBytes > 0 ? usage.rxBytes : session.rxBytes;
            const txBytes = usage.txBytes > 0 ? usage.txBytes : session.txBytes;
            const totalBytes = usage.totalBytes > 0 ? usage.totalBytes : session.totalBytes;
            const rxPackets = usage.rxPackets > 0 ? usage.rxPackets : session.rxPackets;
            const txPackets = usage.txPackets > 0 ? usage.txPackets : session.txPackets;
            const totalPackets = usage.totalPackets > 0 ? usage.totalPackets : session.totalPackets;
            return {
                ...session,
                interfaceName: usage.interfaceName || session.interfaceName || '',
                rxBytes,
                txBytes,
                totalBytes,
                rxPackets,
                txPackets,
                totalPackets
            };
        });
        const active = dedupeActivePppoeSessions(activeSessionsNormalized);
        return {
            stored,
            router: context.router,
            routerId: context.routerId,
            creds: context.creds,
            address: context.creds.address,
            info,
            active,
            activeSessions: activeSessionsNormalized,
            activeSessionCount
        };
    } catch (error) {
        await dropPooledApi(context.routerId, context.creds).catch(() => {});
        error.mikrotikMessage = formatMikrotikError(error, context.creds);
        throw error;
    }
};

const normalizeMonitorTrafficRow = (row = {}) => {
    const rxBitsPerSecond = readBitsPerSecond(row, [
        'rx-bits-per-second',
        'rxBitsPerSecond',
        'rx-bps',
        'rxBps',
        'rx-rate',
        'rxRate'
    ]);
    const txBitsPerSecond = readBitsPerSecond(row, [
        'tx-bits-per-second',
        'txBitsPerSecond',
        'tx-bps',
        'txBps',
        'tx-rate',
        'txRate'
    ]);
    const rxPacketsPerSecond = readPacketsPerSecond(row, [
        'rx-packets-per-second',
        'rxPacketsPerSecond',
        'rx-pps',
        'rxPps'
    ]);
    const txPacketsPerSecond = readPacketsPerSecond(row, [
        'tx-packets-per-second',
        'txPacketsPerSecond',
        'tx-pps',
        'txPps'
    ]);
    return {
        liveRxBitsPerSecond: rxBitsPerSecond,
        liveTxBitsPerSecond: txBitsPerSecond,
        liveRxBytesPerSecond: rxBitsPerSecond / 8,
        liveTxBytesPerSecond: txBitsPerSecond / 8,
        liveRxPacketsPerSecond: rxPacketsPerSecond,
        liveTxPacketsPerSecond: txPacketsPerSecond
    };
};

const readInterfaceMonitorTraffic = async (api, interfaceName = '') => {
    const targetInterface = String(interfaceName || '').trim();
    if (!targetInterface || !api?.rosApi || typeof api.rosApi.write !== 'function') return null;
    const rows = await api.rosApi.write([
        '/interface/monitor-traffic',
        `=interface=${targetInterface}`,
        '=once='
    ]);
    const first = Array.isArray(rows) ? rows[0] : rows;
    if (!first || typeof first !== 'object') return null;
    return {
        interfaceName: targetInterface,
        ...normalizeMonitorTrafficRow(first)
    };
};

const buildPppoeInterfaceCandidates = (session = {}, username = '') => {
    const safeUsername = String(username || session?.username || session?.name || session?.user || '').trim();
    return Array.from(new Set([
        session?.interfaceName,
        session?.interface,
        session?.name && /^<.*>$/.test(String(session.name)) ? session.name : '',
        safeUsername ? `<pppoe-${safeUsername}>` : '',
        safeUsername ? `pppoe-${safeUsername}` : '',
        safeUsername
    ].map((value) => String(value || '').trim()).filter(Boolean)));
};

const getLiveTrafficForSession = async (api, session = {}, username = '') => {
    const candidates = buildPppoeInterfaceCandidates(session, username);
    let lastError = null;
    for (const interfaceName of candidates) {
        try {
            const traffic = await readInterfaceMonitorTraffic(api, interfaceName);
            if (traffic) return traffic;
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) {
        console.warn('[mikrotik] PPPoE monitor-traffic failed:', lastError?.message || lastError);
    }
    return null;
};

const loadBranchActivePppoeLookup = async (branchId = null) => {
    const stored = await loadIntegrationSettings(branchId);
    const enabled = Boolean(stored?.mikrotik?.enabled);
    if (!enabled) {
        return {
            available: false,
            usernames: new Set(),
            usernamesLower: new Set(),
            routerIds: [],
            reason: 'disabled'
        };
    }

    const routers = (Array.isArray(stored?.mikrotikRouters) ? stored.mikrotikRouters : [])
        .filter((router) => router?.enabled !== false)
        .filter((router) => hasRouterCredentials(router));
    if (!routers.length) {
        return {
            available: false,
            usernames: new Set(),
            usernamesLower: new Set(),
            routerIds: [],
            reason: 'missing-router'
        };
    }

    const results = await Promise.allSettled(
        routers.map((router) => getRouterActivePppoeSnapshot({ settings: stored, routerId: router.id }))
    );
    if (results.some((result) => result.status === 'rejected')) {
        const rejected = results.find((result) => result.status === 'rejected');
        return {
            available: false,
            usernames: new Set(),
            usernamesLower: new Set(),
            routerIds: routers.map((router) => router.id),
            reason: 'router-unreachable',
            error: rejected?.reason?.mikrotikMessage || rejected?.reason?.message || 'Unable to load live PPPoE status.'
        };
    }

    const usernames = new Set();
    const usernamesLower = new Set();
    results.forEach((result) => {
        if (result.status !== 'fulfilled') return;
        result.value.active.forEach((session) => {
            const username = String(session?.username || '').trim();
            if (!username) return;
            usernames.add(username);
            usernamesLower.add(username.toLowerCase());
        });
    });

    return {
        available: true,
        usernames,
        usernamesLower,
        routerIds: routers.map((router) => router.id),
        reason: ''
    };
};

const listPppoeRecorderBranchIds = async () => {
    if (!isRelationalReady()) return [];
    const [rows] = await query('SELECT id FROM branches WHERE is_active = 1 ORDER BY id');
    return (Array.isArray(rows) ? rows : [])
        .map((row) => Number(row?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
};

const recordPppoeSessionsForRouter = async ({ branchId, settings, router: routerEntry }) => {
    const routerId = String(routerEntry?.id || '').trim();
    if (!routerId || routerEntry?.enabled === false || !hasRouterCredentials(routerEntry)) {
        return { changed: false, settings };
    }

    const snapshot = await getRouterActivePppoeSnapshot({ branchId, settings, routerId });
    const activeByUser = new Map();
    (Array.isArray(snapshot.active) ? snapshot.active : []).forEach((session) => {
        const usernameKey = normalizePppoeUsernameKey(session?.username || session?.name || session?.user);
        if (usernameKey && !activeByUser.has(usernameKey)) activeByUser.set(usernameKey, session);
    });

    const defaultId = settings?.mikrotikDefaultId || routerId;
    const scopedAccounts = filterAccountsByRouter(settings?.pppoe?.accounts || [], routerId, defaultId);
    const nextAccounts = scopedAccounts.map((account) => {
        const username = String(account?.username || account?.name || account?.user || '').trim();
        const active = activeByUser.get(normalizePppoeUsernameKey(username));
        const currentStatus = normalizePppoeUsageStatus(account?.status);
        const routerDisabled = account?.routerDisabled === true || currentStatus === 'disabled';
        if (active) {
            return mergePppoeUsageState(account, {
                ...account,
                status: 'online',
                inactiveSince: '',
                sessionUptime: active?.uptime || active?.['session-uptime'] || '',
                activeAddress: active?.address || active?.['remote-address'] || '',
                callerId: active?.callerId || active?.['caller-id'] || account?.callerId || '',
                sessionRxBytes: active?.rxBytes ?? 0,
                sessionTxBytes: active?.txBytes ?? 0,
                sessionTotalBytes: active?.totalBytes ?? ((active?.rxBytes ?? 0) + (active?.txBytes ?? 0)),
                sessionRxPackets: active?.rxPackets ?? 0,
                sessionTxPackets: active?.txPackets ?? 0,
                sessionTotalPackets: active?.totalPackets ?? ((active?.rxPackets ?? 0) + (active?.txPackets ?? 0)),
                activeSessionCount: Number(active?.sessionCount || 1),
                routerId
            }).account;
        }

        const wentOffline = isPppoeOnlineStatus(currentStatus);
        return mergePppoeUsageState(account, {
            ...account,
            status: routerDisabled ? 'disabled' : 'offline',
            inactiveSince: wentOffline ? (account?.inactiveSince || new Date().toISOString()) : (account?.inactiveSince || ''),
            sessionUptime: '',
            activeAddress: '',
            sessionRxBytes: account?.sessionRxBytes ?? 0,
            sessionTxBytes: account?.sessionTxBytes ?? 0,
            sessionTotalBytes: account?.sessionTotalBytes ?? 0,
            sessionRxPackets: account?.sessionRxPackets ?? 0,
            sessionTxPackets: account?.sessionTxPackets ?? 0,
            sessionTotalPackets: account?.sessionTotalPackets ?? 0,
            activeSessionCount: 0,
            routerId
        }).account;
    });

    const nextSettings = {
        ...settings,
        pppoe: {
            ...(settings?.pppoe || {}),
            accounts: mergeAccountsForRouter(settings, routerId, nextAccounts)
        }
    };
    return {
        changed: JSON.stringify(settings?.pppoe?.accounts || []) !== JSON.stringify(nextSettings?.pppoe?.accounts || []),
        settings: nextSettings
    };
};

const recordPppoeSessionsForBranch = async (branchId = null) => {
    let settings = await loadIntegrationSettings(branchId);
    if (!settings?.mikrotik?.enabled) return false;
    const routers = (Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [])
        .filter((routerEntry) => routerEntry?.enabled !== false)
        .filter((routerEntry) => hasRouterCredentials(routerEntry));
    if (!routers.length) return false;

    let changed = false;
    for (const routerEntry of routers) {
        try {
            const result = await recordPppoeSessionsForRouter({ branchId, settings, router: routerEntry });
            settings = result.settings || settings;
            changed = changed || Boolean(result.changed);
        } catch (error) {
            console.warn(
                `[mikrotik] PPPoE session recorder skipped router ${routerEntry?.label || routerEntry?.id || 'unknown'}:`,
                error?.mikrotikMessage || error?.message || error
            );
        }
    }
    if (changed) await saveIntegrationSettings(settings, branchId);
    return changed;
};

const runPppoeSessionHistoryRecorder = async () => {
    if (pppoeSessionRecorderInFlight) return;
    pppoeSessionRecorderInFlight = true;
    try {
        const branchIds = await listPppoeRecorderBranchIds();
        for (const branchId of branchIds) {
            await recordPppoeSessionsForBranch(branchId);
        }
    } catch (error) {
        console.warn('[mikrotik] PPPoE session recorder failed:', error?.message || error);
    } finally {
        pppoeSessionRecorderInFlight = false;
    }
};

const startPppoeSessionHistoryRecorder = () => {
    if (pppoeSessionRecorderTimer) return;
    runPppoeSessionHistoryRecorder();
    pppoeSessionRecorderTimer = setInterval(runPppoeSessionHistoryRecorder, PPPoE_SESSION_RECORDER_INTERVAL_MS);
    if (typeof pppoeSessionRecorderTimer?.unref === 'function') {
        pppoeSessionRecorderTimer.unref();
    }
};

const buildStoredUsageLookup = (accounts = []) => {
    const map = new Map();
    const lowerMap = new Map();
    (Array.isArray(accounts) ? accounts : []).forEach((acc) => {
        const username = String(acc?.username || '').trim();
        if (!username) return;
        const rxBytes = parseMetric(acc?.sessionRxBytes);
        const txBytes = parseMetric(acc?.sessionTxBytes);
        const totalBytes = parseMetric(acc?.sessionTotalBytes) || rxBytes + txBytes;
        const usage = { rxBytes, txBytes, totalBytes };
        if (!map.has(username)) {
            map.set(username, usage);
        }
        const lowerKey = username.toLowerCase();
        if (!lowerMap.has(lowerKey)) {
            lowerMap.set(lowerKey, usage);
        }
    });
    return { map, lowerMap };
};

const resolveAutoProfileFromCustomerPlan = async ({ branchId = null, customerAccount = '', routerId = '' } = {}) => {
    const accountNumber = String(customerAccount || '').trim();
    if (!accountNumber) return '';

    const customers = await readCustomers(branchId);
    const customer = (Array.isArray(customers) ? customers : []).find(
        (entry) => String(entry?.accountNumber || '').trim() === accountNumber
    ) || null;
    if (!customer) return '';

    const requestedRouterId = String(routerId || '').trim();
    const customerRouterId = String(customer?.mikrotikId || customer?.routerId || '').trim();
    const customerProfile = String(customer?.pppoeProfile || '').trim();
    if (customerProfile && (!requestedRouterId || !customerRouterId || customerRouterId === requestedRouterId)) {
        return customerProfile;
    }

    const targetPlanName = normalizePlanName(customer?.planName);
    if (!targetPlanName) return '';

    const plans = await readPlans(branchId);
    const matchedPlan = (Array.isArray(plans) ? plans : []).find((plan) =>
        [plan?.name, plan?.label, plan?.id].some((candidate) => normalizePlanName(candidate) === targetPlanName)
    ) || null;

    return resolvePlanProfileForRouter(matchedPlan, requestedRouterId);
};

const clearCustomerPppoeLink = async ({
    branchId = null,
    customerAccount = '',
    username = '',
    paymentMutationAlreadySerialized = false
} = {}) => {
    const accountNumber = String(customerAccount || '').trim();
    const usernameKey = normalizePppoeUsernameKey(username);
    if (!accountNumber && !usernameKey) return [];

    const customers = await readCustomers(branchId);
    const targets = (Array.isArray(customers) ? customers : []).filter((customer) => {
        const currentAccount = String(customer?.accountNumber || '').trim();
        if (accountNumber && currentAccount === accountNumber) return true;
        if (!usernameKey) return false;
        return normalizePppoeUsernameKey(customer?.pppoeUsername) === usernameKey;
    });

    const clearedAccounts = [];
    for (const customer of targets) {
        const currentAccount = String(customer?.accountNumber || '').trim();
        if (!currentAccount) continue;
        await updateCustomerRecord(
            currentAccount,
            {
                pppoeMode: '',
                pppoeUsername: '',
                pppoePassword: '',
                pppoeProfile: ''
            },
            {
                branchId,
                refreshSource: 'mikrotik-pppoe-delete',
                paymentMutationAlreadySerialized
            }
        );
        clearedAccounts.push(currentAccount);
    }

    return clearedAccounts;
};

const readLastLoggedOut = (secret = {}) => {
    return (
        secret['last-logged-out'] ||
        secret.lastLoggedOut ||
        secret.lastLoggedOutAt ||
        secret.lastLogout ||
        ''
    );
};

router.post('/test', requireAuth, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { routerId, creds } = resolveRouterContext(stored, req, req.body || {});
    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);
        const info = await fetchRouterInfo(api);
        return res.json({
            ok: true,
            address: creds.address,
            routerId,
            info
        });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({ ok: false, error: formatMikrotikError(err, creds) || 'Failed to reach MikroTik' });
    }
});

router.get('/pppoe/active', requireAuth, async (_req, res) => {
    try {
        const requestedRouterId = getRouterIdFromRequest(_req);
        const snapshot = await getRouterActivePppoeSnapshot({
            branchId: _req.user?.branchId || null,
            routerId: requestedRouterId
        });
        const { stored, routerId, creds, address, info, active, activeSessions, activeSessionCount } = snapshot;
        const storedAccounts = Array.isArray(stored?.pppoe?.accounts) ? stored.pppoe.accounts : [];
        const scopedAccounts = filterAccountsByRouter(storedAccounts, routerId, stored?.mikrotikDefaultId);
        const { api } = await getPooledApi(routerId, creds);
        const secrets = await api.menu('/ppp secret').get().catch(() => null);
        const secretSummary = Array.isArray(secrets) ? summarizeRouterSecrets(secrets, active) : null;
        const totalCount = secretSummary?.totalCount ?? scopedAccounts.length;
        const disabledCount = secretSummary?.disabledCount ?? scopedAccounts.filter(
            (acc) => String(acc.status || '').toLowerCase() === 'disabled' || String(acc.status || '').toLowerCase() === 'inactive'
        ).length;
        const offlineCount = secretSummary?.offlineCount ?? Math.max(totalCount - disabledCount - active.length, 0);
        const activeSecretCount = secretSummary?.activeCount ?? Math.max(totalCount - disabledCount - offlineCount, 0);
        const activeCount = activeSessionCount;
        const uniqueActiveCount = active.length;

        return res.json({
            ok: true,
            address,
            routerId,
            active,
            activeSessions,
            info: {
                ...info,
                totalCount,
                activeCount,
                uniqueActiveCount,
                activeSecretCount,
                activeSessionCount,
                duplicateSessionCount: Math.max(activeSessionCount - uniqueActiveCount, 0),
                disabledCount,
                offlineCount
            }
        });
    } catch (err) {
        return res.status(502).json({
            ok: false,
            error: err?.mikrotikMessage || err?.message || 'Failed to read active PPPoE sessions from MikroTik'
        });
    }
});

router.get('/pppoe/traffic', requireAuth, async (req, res) => {
    const username = String(req.query?.username || req.query?.user || req.query?.name || '').trim();
    if (!username) {
        return res.status(400).json({ ok: false, error: 'PPPoE username is required.' });
    }

    try {
        const requestedRouterId = getRouterIdFromRequest(req);
        const requestedSessionId = normalizePppoeSecretId(req.query?.sessionId || req.query?.liveSessionKey || '');
        const snapshot = await getRouterActivePppoeSnapshot({
            branchId: req.user?.branchId || null,
            routerId: requestedRouterId,
            includeInfo: false
        });
        const { routerId, creds, address, activeSessions } = snapshot;
        const usernameKey = normalizePppoeUsernameKey(username);
        const activeList = Array.isArray(activeSessions) ? activeSessions : [];
        const session = activeList.find((entry) => {
            const entryUsernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user);
            if (entryUsernameKey !== usernameKey) return false;
            if (!requestedSessionId) return true;
            const entrySessionId = normalizePppoeSecretId(entry?.sessionId || entry?.id || entry?.['.id'] || entry?.liveSessionKey);
            return !entrySessionId || entrySessionId === requestedSessionId;
        }) || activeList.find((entry) =>
            normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user) === usernameKey
        ) || null;

        if (!session) {
            return res.json({
                ok: true,
                routerId,
                address,
                username,
                active: false,
                session: null
            });
        }

        const { api } = await getPooledApi(routerId, creds);
        const liveTraffic = await getLiveTrafficForSession(api, session, username);
        return res.json({
            ok: true,
            routerId,
            address,
            username,
            active: true,
            session: {
                ...session,
                status: 'online',
                ...(liveTraffic || {})
            }
        });
    } catch (err) {
        return res.status(502).json({
            ok: false,
            error: err?.mikrotikMessage || err?.message || 'Failed to read live PPPoE traffic from MikroTik'
        });
    }
});

router.get('/pppoe/profiles', requireAuth, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { router, routerId, creds } = resolveRouterContext(stored, req);
    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);
        const profilesRaw = await api.menu('/ppp profile').get().catch(() => []);
        const profiles = listRouterProfileNames(profilesRaw);
        return res.json({
            ok: true,
            routerId,
            routerLabel: String(router?.label || router?.address || '').trim(),
            profiles
        });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({
            ok: false,
            error: formatMikrotikError(err, creds) || 'Failed to load MikroTik PPPoE profiles'
        });
    }
});

router.post('/pppoe/sync', requireAuth, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { routerId, creds } = resolveRouterContext(stored, req, req.body || {});
    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);

        const secretsMenu = api.menu('/ppp secret');
        const activeSessions = await api.menu('/ppp active').get().catch(() => []);
        const interfaceStats = await api
            .menu('/interface')
            .options('stats')
            .where('type', 'pppoe-in')
            .get()
            .catch(() => []);
        const usageLookup = buildInterfaceUsageLookup(interfaceStats);
        const normalizedActive = dedupeActivePppoeSessions(normalizeActiveSessions(activeSessions).map((session) => {
            const usage = getUsageForUser(usageLookup, session.username);
            if (!usage) return session;
            const rxBytes = usage.rxBytes > 0 ? usage.rxBytes : session.rxBytes;
            const txBytes = usage.txBytes > 0 ? usage.txBytes : session.txBytes;
            const totalBytes = usage.totalBytes > 0 ? usage.totalBytes : session.totalBytes;
            const rxPackets = usage.rxPackets > 0 ? usage.rxPackets : session.rxPackets;
            const txPackets = usage.txPackets > 0 ? usage.txPackets : session.txPackets;
            const totalPackets = usage.totalPackets > 0 ? usage.totalPackets : session.totalPackets;
            return {
                ...session,
                interfaceName: usage.interfaceName || session.interfaceName || '',
                rxBytes,
                txBytes,
                totalBytes,
                rxPackets,
                txPackets,
                totalPackets
            };
        }));
        const activeByUser = new Map();
        normalizedActive.forEach((session) => {
            if (session?.username) {
                activeByUser.set(normalizePppoeUsernameKey(session.username), session);
            }
        });
        const claimedActiveUsers = new Set();

        const secrets = await secretsMenu.get();
        const storedAccounts = Array.isArray(stored?.pppoe?.accounts) ? stored.pppoe.accounts : [];
        const scopedStored = filterAccountsByRouter(storedAccounts, routerId, stored?.mikrotikDefaultId);
        const storedUsageLookup = buildStoredUsageLookup(scopedStored);
        const info = await fetchRouterInfo(api);
        const activeCount = normalizedActive.length;
        const activeSessionCount = Array.isArray(activeSessions) ? activeSessions.length : activeCount;
        const accounts = dedupePppoeAccounts(
            Array.isArray(secrets)
                ? secrets
                      .map((secret) => {
                          const username = secret.name || secret.user || '';
                          if (!username) return null;
                          const disabled = String(secret.disabled || '').toLowerCase() === 'true';
                          const active = claimActiveSessionForUsername(activeByUser, claimedActiveUsers, username);
                          const status = disabled ? 'disabled' : active ? 'online' : 'offline';
                          const storedUsage = active ? null : getUsageForUser(storedUsageLookup, username);
                          const usageFallback = storedUsage
                              ? {
                                    sessionRxBytes: storedUsage.rxBytes ?? 0,
                                    sessionTxBytes: storedUsage.txBytes ?? 0,
                                    sessionTotalBytes: storedUsage.totalBytes ?? 0
                                }
                              : { sessionRxBytes: 0, sessionTxBytes: 0, sessionTotalBytes: 0 };
                          return {
                              secretId: normalizePppoeSecretId(secret['.id'] || secret.id),
                              username,
                              password: secret.password || '',
                              profile: secret.profile || '',
                              pairedCustomer: '',
                              pairedPppoe: '',
                              status,
                              routerDisabled: disabled,
                              inactiveSince: readLastLoggedOut(secret),
                              sessionUptime: active?.uptime || '',
                              activeAddress: active?.address || '',
                              callerId: active?.callerId || secret.callerId || secret['caller-id'] || secret.lastCallerId || secret['last-caller-id'] || '',
                              sessionRxBytes: active?.rxBytes ?? usageFallback.sessionRxBytes,
                              sessionTxBytes: active?.txBytes ?? usageFallback.sessionTxBytes,
                              sessionTotalBytes: active?.totalBytes ?? usageFallback.sessionTotalBytes,
                              sessionRxPackets: active?.rxPackets ?? 0,
                              sessionTxPackets: active?.txPackets ?? 0,
                              sessionTotalPackets: active?.totalPackets ?? 0,
                              activeSessionCount: active?.sessionCount ?? 0,
                              routerId
                          };
                      })
                      .filter(Boolean)
                : [],
            routerId
        );
        const totalCount = accounts.length;
        const {
            activeCount: activeSecretCount,
            disabledCount,
            offlineCount
        } = summarizeRouterSecrets(secrets, normalizedActive);
        const routerActiveCount = activeSessionCount;
        const uniqueActiveCount = activeCount;

        const mergedAccounts = mergeAccountsForRouter(stored, routerId, accounts);
        const nextSettings = {
            ...stored,
            pppoe: {
                ...(stored?.pppoe || {}),
                accounts: mergedAccounts
            }
        };
        await saveIntegrationSettings(nextSettings, branchId);

        return res.json({
            ok: true,
            address: creds.address,
            routerId,
            count: accounts.length,
            accounts,
            info: {
                ...info,
                totalCount,
                activeCount: routerActiveCount,
                uniqueActiveCount,
                activeSecretCount,
                activeSessionCount,
                duplicateSessionCount: Math.max(activeSessionCount - uniqueActiveCount, 0),
                disabledCount,
                offlineCount
            }
        });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({ ok: false, error: formatMikrotikError(err, creds) || 'Failed to sync PPPoE from MikroTik' });
    }
});

router.post('/pppoe', requireAuth, serializePppoeActivationRequest, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { router, routerId, creds } = resolveRouterContext(stored, req, req.body?.mikrotik || {});
    const payload = req.body || {};
    const username = String(payload.username || '').trim();
    const customerAccount = String(payload.customerAccount || payload.accountNumber || '').trim();
    const secretId = normalizePppoeSecretId(payload.secretId);
    const isDelete = payload.delete === true || payload.action === 'delete';
    const password = payload.password != null ? String(payload.password) : '';
    const requestedProfile = String(payload.profile || '').trim();
    const pairedCustomer = String(payload.pairedCustomer || '').trim();
    const pairedPppoe = String(payload.pairedPppoe || '').trim();
    const requestedStatus = String(payload.status || 'active').toLowerCase();
    const isDisabled = requestedStatus === 'inactive' || requestedStatus === 'disabled';
    const activationMutationSerialized = !isDelete && !isDisabled;
    const status = isDisabled ? 'disabled' : 'offline';

    if (!username) return res.status(400).json({ ok: false, error: 'Username is required' });
    if (!isDelete && !password) return res.status(400).json({ ok: false, error: 'Password is required' });

    try {
        const preflightStoredAccount = Array.isArray(stored?.pppoe?.accounts)
            ? findStoredAccount(stored.pppoe.accounts, {
                routerId,
                defaultId: stored?.mikrotikDefaultId || '',
                secretId,
                username
            })
            : null;
        if (activationMutationSerialized) {
            await assertPppoeActivationAccountOpen(
                branchId,
                customerAccount || preflightStoredAccount?.customerAccount
            );
        }
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);

        const secretMenu = api.menu('/ppp secret');
        const disabled = isDisabled ? 'true' : 'false';

        if (isDelete) {
            // Trim and match username on router (case-sensitive by RouterOS). Also try case-insensitive match fallback.
            const secretsList = await secretMenu.get().catch(() => []);
            const matches = findRouterSecretsByIdentity(secretsList, { secretId, username });

            if (!matches.length) {
                // If it doesn't exist on router, still purge locally
                const accounts = Array.isArray(stored?.pppoe?.accounts) ? [...stored.pppoe.accounts] : [];
                const idx = findStoredAccountIndex(accounts, {
                    routerId,
                    defaultId: stored?.mikrotikDefaultId || '',
                    secretId,
                    username
                });
                const linkedAccount = idx >= 0 ? String(accounts[idx]?.customerAccount || '').trim() : '';
                if (idx >= 0) accounts.splice(idx, 1);
                const nextSettings = { ...stored, pppoe: { ...(stored?.pppoe || {}), accounts } };
                await saveIntegrationSettings(nextSettings, branchId);
                const clearedCustomers = await clearCustomerPppoeLink({
                    branchId,
                    customerAccount: customerAccount || linkedAccount,
                    username
                }).catch(() => []);
                await dropPooledApi(routerId, creds).catch(() => {});
                return res.json({ ok: true, deleted: username, note: 'Not found on router', clearedCustomers });
            }

            const removal = await removeRouterSecretsByIdentity(api, { secretId, username, preloadedSecrets: secretsList });

            // Verify deletion on router
            const verifyList = await secretMenu.get().catch(() => []);
            const stillExists = Array.isArray(verifyList)
                ? verifyList.some((secret) => {
                      const itemSecretId = normalizePppoeSecretId(secret['.id'] || secret.id);
                      if (secretId) return itemSecretId === secretId;
                      const itemUsername = String(secret?.name || secret?.user || '').trim();
                      return itemUsername === username || normalizePppoeUsernameKey(itemUsername) === normalizePppoeUsernameKey(username);
                  })
                : false;
            if (stillExists) {
                await dropPooledApi(routerId, creds).catch(() => {});
                return res.status(502).json({
                    ok: false,
                    error: `MikroTik still reports this PPPoE entry (${username}) after delete. Please verify credentials and try again.`
                });
            }

            const accounts = Array.isArray(stored?.pppoe?.accounts) ? [...stored.pppoe.accounts] : [];
            const idx = findStoredAccountIndex(accounts, {
                routerId,
                defaultId: stored?.mikrotikDefaultId || '',
                secretId,
                username
            });
            const linkedAccount = idx >= 0 ? String(accounts[idx]?.customerAccount || '').trim() : '';
            if (idx >= 0) accounts.splice(idx, 1);
            const nextSettings = { ...stored, pppoe: { ...(stored?.pppoe || {}), accounts } };
            await saveIntegrationSettings(nextSettings, branchId);
            const clearedCustomers = await clearCustomerPppoeLink({
                branchId,
                customerAccount: customerAccount || linkedAccount,
                username
            }).catch(() => []);
            await dropPooledApi(routerId, creds).catch(() => {});
            return res.json({ ok: true, deleted: username, removedFromRouter: removal.removed, clearedCustomers });
        } else {
            const secretsList = await secretMenu.get().catch(() => []);
            const existing = findRouterSecretByIdentity(secretsList, { secretId, username });

            let autoProfile = '';
            if (!requestedProfile && customerAccount) {
                try {
                    autoProfile = await resolveAutoProfileFromCustomerPlan({
                        branchId: req.user?.branchId || null,
                        customerAccount,
                        routerId
                    });
                } catch (_error) {
                    autoProfile = '';
                }
            }
            const desiredProfile = requestedProfile || autoProfile || String(existing?.profile || '').trim();
            const profileMenu = api.menu('/ppp profile');
            const routerProfilesRaw = await profileMenu.get().catch(() => []);
            const routerProfiles = Array.isArray(routerProfilesRaw) ? routerProfilesRaw : [];
            const availableProfiles = listRouterProfileNames(routerProfiles);
            const findRouterProfile = (value) => {
                const normalizedValue = normalizePlanName(value);
                if (!normalizedValue) return null;
                return routerProfiles.find((entry) =>
                    normalizePlanName(entry?.name || entry?.profile || entry?.id) === normalizedValue
                ) || null;
            };
            const matchedRouterProfile = findRouterProfile(desiredProfile);
            if (desiredProfile && !matchedRouterProfile) {
                return res.status(400).json({
                    ok: false,
                    error: `PPPoE profile ${desiredProfile} does not exist on the selected router.`,
                    routerId,
                    routerLabel: String(router?.label || router?.address || '').trim(),
                    profile: desiredProfile,
                    availableProfiles
                });
            }
            const profile = String(
                matchedRouterProfile?.name ||
                matchedRouterProfile?.profile ||
                matchedRouterProfile?.id ||
                ''
            ).trim();
            let operationError = null;

            if (existing) {
                const updatePayload = {
                    name: username,
                    password,
                    service: 'pppoe',
                    disabled
                };
                if (profile) {
                    updatePayload.profile = profile;
                }
                const internalId = normalizePppoeSecretId(existing['.id'] || existing.id);
                try {
                    if (internalId) {
                        await auditMikrotikPppoeCommand({
                            branchId,
                            user: req.user,
                            source: 'api/mikrotik/pppoe',
                            routerId,
                            routerLabel: router?.label || router?.address || '',
                            username,
                            secretId: internalId,
                            operation: 'update',
                            selector: `.id=${internalId}`,
                            payload: { disabled, service: 'pppoe', profile: profile || undefined },
                            reason: isDisabled ? 'manual-status-disabled' : 'manual-status-active'
                        });
                        await secretMenu.where('.id', internalId).update(updatePayload);
                    } else {
                        throw new Error('Missing secret ID');
                    }
                } catch (_err) {
                    try {
                        if (internalId) {
                            await auditMikrotikPppoeCommand({
                                branchId,
                                user: req.user,
                                source: 'api/mikrotik/pppoe',
                                routerId,
                                routerLabel: router?.label || router?.address || '',
                                username,
                                secretId: internalId,
                                operation: 'update',
                                selector: `.id=${internalId}`,
                                payload: { disabled, service: 'pppoe', profile: profile || undefined },
                                reason: isDisabled ? 'manual-status-disabled-fallback' : 'manual-status-active-fallback'
                            });
                            await secretMenu.where('.id', internalId).update(updatePayload);
                        } else {
                            throw new Error('Missing secret ID');
                        }
                    } catch (_err2) {
                        try {
                            await auditMikrotikPppoeCommand({
                                branchId,
                                user: req.user,
                                source: 'api/mikrotik/pppoe',
                                routerId,
                                routerLabel: router?.label || router?.address || '',
                                username,
                                secretId: internalId,
                                operation: 'update',
                                selector: `name=${existing.name || username}`,
                                payload: { disabled, service: 'pppoe', profile: profile || undefined },
                                reason: isDisabled ? 'manual-status-disabled-name-fallback' : 'manual-status-active-name-fallback'
                            });
                            await secretMenu.where('name', existing.name || username).update(updatePayload);
                        } catch (_err3) {
                            operationError = _err3;
                        }
                    }
                }
            } else {
                const createPayload = {
                    name: username,
                    password,
                    service: 'pppoe',
                    disabled
                };
                if (profile) {
                    createPayload.profile = profile;
                }
                try {
                    await auditMikrotikPppoeCommand({
                        branchId,
                        user: req.user,
                        source: 'api/mikrotik/pppoe',
                        routerId,
                        routerLabel: router?.label || router?.address || '',
                        username,
                        operation: 'add',
                        selector: `name=${username}`,
                        payload: { disabled, service: 'pppoe', profile: profile || undefined },
                        reason: isDisabled ? 'manual-create-disabled' : 'manual-create-active'
                    });
                    await secretMenu.add(createPayload);
                } catch (error) {
                    operationError = error;
                }
            }

            const refreshedSecrets = await secretMenu.get().catch(() => []);
            const savedSecret = findRouterSecretByIdentity(refreshedSecrets, { secretId, username }) || existing;
            if (!savedSecret) {
                return res.status(502).json({
                    ok: false,
                    error: `MikroTik did not confirm PPPoE secret ${username} on ${String(router?.label || router?.address || routerId || 'the selected router').trim() || 'the selected router'} after save. Please retry.`
                });
            }
            if (operationError && !savedSecret) {
                throw operationError;
            }
            if (operationError && savedSecret) {
                console.warn(
                    `[mikrotik] PPPoE save recovered after router-side success for ${username}: ${operationError.message || operationError}`
                );
            }

            const existingAccount = Array.isArray(stored?.pppoe?.accounts)
                ? findStoredAccount(stored.pppoe.accounts, {
                    routerId,
                    defaultId: stored?.mikrotikDefaultId || '',
                    secretId: secretId || normalizePppoeSecretId(savedSecret?.['.id'] || savedSecret?.id),
                    username
                })
                : null;
            const previousCustomerAccount = String(existingAccount?.customerAccount || '').trim();
            const resolvedCustomerAccount = customerAccount || previousCustomerAccount;
            const preserveLiveSession = isPppoeOnlineStatus(existingAccount?.status);
            const entry = {
                secretId: secretId || normalizePppoeSecretId(savedSecret?.['.id'] || savedSecret?.id),
                customerAccount: resolvedCustomerAccount,
                username,
                password,
                profile: String(savedSecret?.profile || profile || '').trim(),
                pairedCustomer,
                pairedPppoe,
                status: isDisabled ? 'disabled' : (isPppoeOnlineStatus(existingAccount?.status) ? 'online' : status),
                inactiveSince: preserveLiveSession ? '' : readLastLoggedOut(savedSecret || existing),
                sessionUptime: preserveLiveSession ? String(existingAccount?.sessionUptime || '') : '',
                activeAddress: preserveLiveSession ? String(existingAccount?.activeAddress || '') : '',
                callerId: preserveLiveSession ? String(existingAccount?.callerId || '') : '',
                sessionRxBytes: preserveLiveSession ? parseMetric(existingAccount?.sessionRxBytes) : 0,
                sessionTxBytes: preserveLiveSession ? parseMetric(existingAccount?.sessionTxBytes) : 0,
                sessionTotalBytes: preserveLiveSession ? parseMetric(existingAccount?.sessionTotalBytes) : 0,
                activeSessionCount: preserveLiveSession ? Number(existingAccount?.activeSessionCount || 1) : 0,
                usageCarryRxBytes: existingAccount?.usageCarryRxBytes ?? 0,
                usageCarryTxBytes: existingAccount?.usageCarryTxBytes ?? 0,
                usageCarryTotalBytes: existingAccount?.usageCarryTotalBytes ?? 0,
                routerId
            };

            const accounts = Array.isArray(stored?.pppoe?.accounts) ? [...stored.pppoe.accounts] : [];
            const idx = findStoredAccountIndex(accounts, {
                routerId,
                defaultId: stored?.mikrotikDefaultId || '',
                secretId: entry.secretId,
                username
            });
            const mergedEntry = mergePppoeUsageState(existingAccount, entry).account;
            if (idx >= 0) {
                accounts[idx] = mergedEntry;
            } else {
                accounts.push(mergedEntry);
            }

            const nextSettings = {
                ...stored,
                pppoe: { ...(stored?.pppoe || {}), accounts }
            };
            await saveIntegrationSettings(nextSettings, branchId);
            if (Number.isInteger(branchId) && branchId > 0) {
                if (previousCustomerAccount && resolvedCustomerAccount && previousCustomerAccount !== resolvedCustomerAccount) {
                    await clearCustomerPppoeLink({
                        branchId,
                        customerAccount: previousCustomerAccount,
                        username: existingAccount?.username || username,
                        paymentMutationAlreadySerialized: activationMutationSerialized
                    }).catch(() => []);
                }
                if (resolvedCustomerAccount) {
                    await updateCustomerRecord(
                        resolvedCustomerAccount,
                        {
                            pppoeMode: 'manual',
                            pppoeUsername: username,
                            pppoePassword: password,
                            pppoeProfile: String(savedSecret?.profile || profile || '').trim(),
                            mikrotikId: routerId
                        },
                        {
                            branchId,
                            refreshSource: 'mikrotik-pppoe-save',
                            paymentMutationAlreadySerialized: activationMutationSerialized
                        }
                    ).catch((error) => {
                        console.warn(
                            `[mikrotik] saved PPPoE ${username} but failed to link customer ${resolvedCustomerAccount}: ${error?.message || error}`
                        );
                    });
                }
            }

            return res.json({
                ok: true,
                action: existing ? 'updated' : 'created',
                entry: mergedEntry
            });
        }
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        const statusCode = Number(err?.status || err?.statusCode) || 502;
        return res.status(statusCode).json({
            ok: false,
            error: statusCode < 500
                ? (err?.message || 'Unable to save PPPoE account.')
                : (formatMikrotikError(err, creds) || 'Failed to save PPPoE account to MikroTik'),
            ...(err?.code ? { code: err.code } : {})
        });
    }
});

router.delete('/pppoe/:username', requireAuth, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { routerId, creds } = resolveRouterContext(stored, req);
    const username = String(req.params.username || '').trim();
    const customerAccount = String(req.query?.customerAccount || req.query?.accountNumber || '').trim();
    const secretId = normalizePppoeSecretId(req.query?.secretId);
    if (!username) return res.status(400).json({ ok: false, error: 'Username is required' });

    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);

        await removeRouterSecretsByIdentity(api, { secretId, username });

        const accounts = Array.isArray(stored?.pppoe?.accounts) ? [...stored.pppoe.accounts] : [];
        const idx = findStoredAccountIndex(accounts, {
            routerId,
            defaultId: stored?.mikrotikDefaultId || '',
            secretId,
            username
        });
        const linkedAccount = idx >= 0 ? String(accounts[idx]?.customerAccount || '').trim() : '';
        if (idx >= 0) {
            accounts.splice(idx, 1);
        }

        const nextSettings = {
            ...stored,
            pppoe: { ...(stored?.pppoe || {}), accounts }
        };
        await saveIntegrationSettings(nextSettings, branchId);
        const clearedCustomers = await clearCustomerPppoeLink({
            branchId,
            customerAccount: customerAccount || linkedAccount,
            username
        }).catch(() => []);

        await dropPooledApi(routerId, creds).catch(() => {});
        return res.json({ ok: true, deleted: username, routerId, clearedCustomers });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({
            ok: false,
            error: formatMikrotikError(err, creds) || 'Failed to delete PPPoE from MikroTik'
        });
    }
});

router.post('/pppoe/delete', requireAuth, async (req, res) => {
    const branchId = resolveBranchId(req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { routerId, creds } = resolveRouterContext(stored, req, req.body?.mikrotik || {});
    const username = String(req.body?.username || '').trim();
    const customerAccount = String(req.body?.customerAccount || req.body?.accountNumber || '').trim();
    const secretId = normalizePppoeSecretId(req.body?.secretId);
    if (!username) return res.status(400).json({ ok: false, error: 'Username is required' });

    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);

        await removeRouterSecretsByIdentity(api, { secretId, username });

        const accounts = Array.isArray(stored?.pppoe?.accounts) ? [...stored.pppoe.accounts] : [];
        const idx = findStoredAccountIndex(accounts, {
            routerId,
            defaultId: stored?.mikrotikDefaultId || '',
            secretId,
            username
        });
        if (idx >= 0) {
            accounts.splice(idx, 1);
        }

        const nextSettings = {
            ...stored,
            pppoe: { ...(stored?.pppoe || {}), accounts }
        };
        await saveIntegrationSettings(nextSettings, branchId);
        const clearedCustomers = await clearCustomerPppoeLink({
            branchId,
            customerAccount,
            username
        }).catch(() => []);

        await dropPooledApi(routerId, creds).catch(() => {});
        return res.json({ ok: true, deleted: username, routerId, clearedCustomers });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({
            ok: false,
            error: formatMikrotikError(err, creds) || 'Failed to delete PPPoE from MikroTik'
        });
    }
});

router.get('/info', requireAuth, async (_req, res) => {
    const branchId = resolveBranchId(_req);
    const stored = await loadIntegrationSettings(branchId);
    const requestedRouterId = getRouterIdFromRequest(_req);
    if (requestedRouterId && !findConfiguredRouterById(stored, requestedRouterId)) {
        return res.status(400).json({ ok: false, error: buildRouterConfigurationError(requestedRouterId) });
    }
    const { routerId, creds } = resolveRouterContext(stored, _req);
    try {
        validateCredentials(creds);
        const { api } = await getPooledApi(routerId, creds);
        const info = await fetchRouterInfo(api);
        return res.json({ ok: true, info, address: creds.address, routerId });
    } catch (err) {
        await dropPooledApi(routerId, creds).catch(() => {});
        return res.status(502).json({ ok: false, error: formatMikrotikError(err, creds) || 'Failed to read MikroTik info' });
    }
});

module.exports = router;
module.exports.getRouterActivePppoeSnapshot = getRouterActivePppoeSnapshot;
module.exports.loadBranchActivePppoeLookup = loadBranchActivePppoeLookup;
module.exports.startPppoeSessionHistoryRecorder = startPppoeSessionHistoryRecorder;
module.exports.runPppoeSessionHistoryRecorder = runPppoeSessionHistoryRecorder;
