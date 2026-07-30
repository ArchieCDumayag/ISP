const express = require('express');
const crypto = require('crypto');
const net = require('net');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { encryptJson, decryptJson } = require('../../../../core/data/db-secrets');
const { normalizeMikrotikEndpoint } = require('../../network/backend/mikrotik-endpoint');

const router = express.Router();
const STORE_KEY = 'integrations';
let integrationSecretJsonColumnChecked = false;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const DEFAULT_SETTINGS = {
    gcash: {
        accountName: '',
        accountNumber: '',
        qrCodeImageData: '',
        qrCodeMimeType: '',
        qrCodeFileName: ''
    },
    xendit: {
        apiKey: '',
        transactionFee: '',
        webhookSecret: '',
        successRedirectUrl: '',
        failureRedirectUrl: ''
    },
    semaphore: {
        apiKey: '',
        senderName: ''
    },
    email: {
        host: '',
        port: '',
        secure: false,
        username: '',
        password: '',
        fromName: '',
        fromEmail: ''
    },
    genieacs: {
        enabled: false,
        protocol: 'http',
        host: '',
        username: '',
        password: '',
        uiPort: '3000',
        nbiPort: '7557'
    },
    mikrotik: {
        enabled: false,
        address: '',
        username: '',
        password: '',
        port: '',
        tls: undefined
    },
    mikrotikRouters: [],
    mikrotikDefaultId: '',
    pppoe: {
        accounts: []
    },
    ipBrowser: {
        autoLoginEnabled: false,
        username: '',
        password: '',
        passwordFallbacks: [],
        usernameSelector: '',
        passwordSelector: '',
        submitSelector: '',
        delayMs: 600,
        profiles: []
    }
};
const INTEGRATION_PROVIDER_KEYS = ['gcash', 'xendit', 'semaphore', 'email', 'genieacs', 'mikrotik', 'pppoe', 'ipBrowser'];

const hasNonEmptyValue = (value) => String(value || '').trim() !== '';

const redactSecretValue = (value) => (hasNonEmptyValue(value) ? '' : '');

const normalizeSecretList = (value) => {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\r\n,;]+/);
    return Array.from(new Set(
        source
            .map((entry) => String(entry ?? '').trim())
            .filter(Boolean)
    ));
};

const makeIpBrowserProfileId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `ip-browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeIpBrowserProfile = (raw = {}) => {
    const delayMs = Number(raw.delayMs);
    const matches = normalizeSecretList(
        raw.matches
        ?? raw.matchTargets
        ?? raw.targets
        ?? raw.gateways
        ?? raw.gateway
        ?? raw.address
    );
    return {
        id: String(raw.id || '').trim() || makeIpBrowserProfileId(),
        label: String(raw.label || raw.name || '').trim() || 'Router profile',
        enabled: raw.enabled == null ? true : coerceEnabled(raw.enabled),
        matches,
        username: String(raw.username || '').trim(),
        password: raw.password != null ? String(raw.password) : '',
        passwordFallbacks: normalizeSecretList(raw.passwordFallbacks ?? raw.fallbackPasswords),
        usernameSelector: String(raw.usernameSelector || '').trim(),
        passwordSelector: String(raw.passwordSelector || '').trim(),
        submitSelector: String(raw.submitSelector || '').trim(),
        delayMs: Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000 ? delayMs : 600
    };
};

const normalizeIpBrowserSettings = (settings = {}) => {
    const raw = settings?.ipBrowser && typeof settings.ipBrowser === 'object'
        ? settings.ipBrowser
        : {};
    const profiles = [];
    const seenIds = new Set();
    (Array.isArray(raw.profiles) ? raw.profiles : []).forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const profile = normalizeIpBrowserProfile(entry);
        while (seenIds.has(profile.id)) profile.id = makeIpBrowserProfileId();
        seenIds.add(profile.id);
        profiles.push(profile);
    });
    const delayMs = Number(raw.delayMs);
    return {
        ...settings,
        ipBrowser: {
            ...DEFAULT_SETTINGS.ipBrowser,
            ...raw,
            autoLoginEnabled: coerceEnabled(raw.autoLoginEnabled ?? raw.enabled),
            username: String(raw.username || '').trim(),
            password: raw.password != null ? String(raw.password) : '',
            passwordFallbacks: normalizeSecretList(raw.passwordFallbacks ?? raw.fallbackPasswords),
            usernameSelector: String(raw.usernameSelector || '').trim(),
            passwordSelector: String(raw.passwordSelector || '').trim(),
            submitSelector: String(raw.submitSelector || '').trim(),
            delayMs: Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000 ? delayMs : 600,
            profiles
        }
    };
};

const parseIpv4Number = (value = '') => {
    const host = String(value || '').trim();
    if (net.isIP(host) !== 4) return null;
    return host.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
};

const parseIpBrowserTarget = (target) => {
    if (!target) return null;
    try {
        const parsed = target instanceof URL
            ? target
            : new URL(/^https?:\/\//i.test(String(target)) ? String(target) : `http://${String(target)}`);
        const hostname = String(parsed.hostname || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (!hostname) return null;
        const port = String(parsed.port || '').trim();
        return {
            hostname,
            port,
            host: port ? `${hostname}:${port}` : hostname
        };
    } catch {
        return null;
    }
};

const scoreIpBrowserMatch = (target, rawRule = '') => {
    const rule = String(rawRule || '').trim().toLowerCase();
    if (!target || !rule) return -1;
    if (rule === '*') return 1;

    const cidrMatch = rule.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
    if (cidrMatch) {
        const targetNumber = parseIpv4Number(target.hostname);
        const networkNumber = parseIpv4Number(cidrMatch[1]);
        const prefixLength = Number(cidrMatch[2]);
        if (targetNumber == null || networkNumber == null || prefixLength < 0 || prefixLength > 32) return -1;
        const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
        return (targetNumber & mask) === (networkNumber & mask) ? 300 + prefixLength : -1;
    }

    if (rule.includes('*')) {
        const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        let pattern;
        try {
            pattern = new RegExp(`^${escaped}$`, 'i');
        } catch {
            return -1;
        }
        const literalLength = rule.replace(/\*/g, '').length;
        if (pattern.test(target.host)) return 220 + literalLength;
        if (pattern.test(target.hostname)) return 200 + literalLength;
        return -1;
    }

    let normalizedRule = rule;
    let hasExplicitPort = false;
    try {
        const parsedRule = new URL(/^https?:\/\//i.test(rule) ? rule : `http://${rule}`);
        const hostname = String(parsedRule.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
        const port = String(parsedRule.port || '').trim();
        if (hostname) {
            normalizedRule = port ? `${hostname}:${port}` : hostname;
            hasExplicitPort = Boolean(port);
        }
    } catch {
        normalizedRule = rule.replace(/^\[|\]$/g, '');
    }
    if (hasExplicitPort) return normalizedRule === target.host ? 500 : -1;
    return normalizedRule === target.hostname ? 450 : -1;
};

const resolveIpBrowserProfile = (settings = {}, target) => {
    const normalized = normalizeIpBrowserSettings(settings);
    const targetDetails = parseIpBrowserTarget(target);
    if (!targetDetails) return null;
    let best = null;
    normalized.ipBrowser.profiles.forEach((profile, index) => {
        if (profile.enabled === false || !profile.username || !profile.password) return;
        const score = profile.matches.reduce(
            (highest, rule) => Math.max(highest, scoreIpBrowserMatch(targetDetails, rule)),
            -1
        );
        if (score < 0) return;
        if (!best || score > best.score || (score === best.score && index < best.index)) {
            best = { profile, score, index };
        }
    });
    return best ? { ...best.profile } : null;
};

const preserveIpBrowserProfileSecrets = (incomingProfiles, currentProfiles) => {
    if (!Array.isArray(incomingProfiles)) return currentProfiles;
    const currentById = new Map(
        (Array.isArray(currentProfiles) ? currentProfiles : [])
            .filter((profile) => profile && typeof profile === 'object')
            .map((profile) => [String(profile.id || '').trim(), profile])
    );
    return incomingProfiles.map((profile) => {
        if (!profile || typeof profile !== 'object') return profile;
        const current = currentById.get(String(profile.id || '').trim()) || {};
        const next = { ...profile };
        ['username', 'password'].forEach((field) => {
            if (!hasNonEmptyValue(next[field]) && hasNonEmptyValue(current[field])) next[field] = current[field];
        });
        if (
            !hasOwn(next, 'passwordFallbacks')
            && !hasOwn(next, 'fallbackPasswords')
            && normalizeSecretList(current.passwordFallbacks).length
        ) {
            next.passwordFallbacks = current.passwordFallbacks;
        }
        return next;
    });
};

function sanitizeSettingsForClient(settings = {}) {
    const normalized = normalizeIntegrationSettings(settings || {});
    const xendit = normalized.xendit || {};
    const semaphore = normalized.semaphore || {};
    const email = normalized.email || {};
    const genieacs = normalized.genieacs || {};
    const ipBrowser = normalized.ipBrowser || {};
    return {
        ...normalized,
        xendit: {
            ...xendit,
            apiKey: redactSecretValue(xendit.apiKey),
            apiKeySet: hasNonEmptyValue(xendit.apiKey),
            webhookSecret: redactSecretValue(xendit.webhookSecret),
            webhookSecretSet: hasNonEmptyValue(xendit.webhookSecret)
        },
        semaphore: {
            ...semaphore,
            apiKey: redactSecretValue(semaphore.apiKey),
            apiKeySet: hasNonEmptyValue(semaphore.apiKey)
        },
        email: {
            ...email,
            username: redactSecretValue(email.username),
            usernameSet: hasNonEmptyValue(email.username),
            password: redactSecretValue(email.password),
            passwordSet: hasNonEmptyValue(email.password),
            fromEmail: redactSecretValue(email.fromEmail)
        },
        genieacs: {
            ...genieacs,
            username: redactSecretValue(genieacs.username),
            usernameSet: hasNonEmptyValue(genieacs.username),
            password: redactSecretValue(genieacs.password),
            passwordSet: hasNonEmptyValue(genieacs.password)
        },
        ipBrowser: {
            ...ipBrowser,
            username: redactSecretValue(ipBrowser.username),
            usernameSet: hasNonEmptyValue(ipBrowser.username),
            password: redactSecretValue(ipBrowser.password),
            passwordSet: hasNonEmptyValue(ipBrowser.password),
            passwordFallbacks: [],
            passwordFallbacksSet: normalizeSecretList(ipBrowser.passwordFallbacks).length > 0,
            passwordFallbackCount: normalizeSecretList(ipBrowser.passwordFallbacks).length,
            profiles: (Array.isArray(ipBrowser.profiles) ? ipBrowser.profiles : []).map((profile) => ({
                ...profile,
                username: redactSecretValue(profile.username),
                usernameSet: hasNonEmptyValue(profile.username),
                password: redactSecretValue(profile.password),
                passwordSet: hasNonEmptyValue(profile.password),
                passwordFallbacks: [],
                passwordFallbacksSet: normalizeSecretList(profile.passwordFallbacks).length > 0,
                passwordFallbackCount: normalizeSecretList(profile.passwordFallbacks).length
            }))
        }
    };
}

function normalizeProviderKey(provider = '') {
    const lower = String(provider || '').trim().toLowerCase();
    if (lower === 'ipbrowser' || lower === 'ip-browser' || lower === 'ip_browser') return 'ipBrowser';
    return lower;
}

function preserveSecretFields(provider, incoming = {}, current = {}) {
    if (!incoming || typeof incoming !== 'object') return incoming;
    const next = { ...incoming };
    const keepIfBlank = (field) => {
        if (hasOwn(next, field) && !hasNonEmptyValue(next[field]) && hasNonEmptyValue(current?.[field])) {
            next[field] = current[field];
        }
    };
    if (provider === 'xendit') {
        keepIfBlank('apiKey');
        keepIfBlank('webhookSecret');
    } else if (provider === 'semaphore') {
        keepIfBlank('apiKey');
    } else if (provider === 'email') {
        keepIfBlank('username');
        keepIfBlank('password');
        if (!hasNonEmptyValue(next.fromEmail) && hasNonEmptyValue(next.username)) {
            next.fromEmail = next.username;
        } else if (!hasNonEmptyValue(next.fromEmail) && hasNonEmptyValue(current?.fromEmail)) {
            next.fromEmail = current.fromEmail;
        }
    } else if (provider === 'genieacs') {
        keepIfBlank('username');
        keepIfBlank('password');
    } else if (provider === 'ipBrowser') {
        keepIfBlank('username');
        keepIfBlank('password');
        if (
            hasOwn(next, 'passwordFallbacks')
            && normalizeSecretList(next.passwordFallbacks).length === 0
            && normalizeSecretList(current?.passwordFallbacks).length > 0
        ) {
            next.passwordFallbacks = current.passwordFallbacks;
        }
        next.profiles = preserveIpBrowserProfileSecrets(next.profiles, current?.profiles);
    }
    return next;
}

class IntegrationSettingsUnreadableError extends Error {
    constructor(branchId, cause) {
        super(
            `Integration settings for branch ${branchId || 'default'} cannot be decrypted. ` +
            'Set the original CONFIG_MASTER_KEY or re-save integrations from the owner page.'
        );
        this.name = 'IntegrationSettingsUnreadableError';
        this.branchId = branchId || null;
        this.cause = cause;
    }
}

function isIntegrationSettingsUnreadableError(error) {
    return error?.name === 'IntegrationSettingsUnreadableError';
}

const coerceEnabled = (value) => {
    if (value === true || value === false) return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['false', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return false;
};

const coerceOptionalTrue = (value) => {
    if (value === true) return true;
    if (value === 1 || value === '1') return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', 'on'].includes(normalized)) return true;
    }
    return undefined;
};

const makeRouterId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `router-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeRouterEntry = (raw = {}, fallbackEnabled = false) => {
    const endpoint = normalizeMikrotikEndpoint(raw.address || raw.host, raw.port);
    const address = endpoint.address;
    const username = String(raw.username || raw.user || '').trim();
    const password = raw.password != null ? String(raw.password) : '';
    const tls = coerceOptionalTrue(raw.tls ?? raw.apiSsl ?? raw.ssl);
    const enabled = raw.enabled == null ? Boolean(fallbackEnabled) : coerceEnabled(raw.enabled);
    const id = String(raw.id || '').trim();
    const label = String(raw.label || raw.name || '').trim();
    return {
        id: id || makeRouterId(),
        label: label || address || 'MikroTik Router',
        address,
        username,
        password,
        port: endpoint.port,
        tls,
        enabled
    };
};

const normalizeMikrotikSettings = (settings = {}) => {
    const globalEnabled = Boolean(settings?.mikrotik?.enabled);
    const incomingRouters = Array.isArray(settings?.mikrotikRouters) ? settings.mikrotikRouters : [];
    const routers = [];
    const seen = new Set();
    incomingRouters.forEach((raw) => {
        const router = normalizeRouterEntry(raw, globalEnabled);
        if (!router.address || !router.username || !router.password) {
            return;
        }
        while (seen.has(router.id)) {
            router.id = makeRouterId();
        }
        seen.add(router.id);
        routers.push(router);
    });

    const legacyRaw = settings?.mikrotik || {};
    const legacyAddress = String(legacyRaw.address || legacyRaw.host || '').trim();
    const legacyUsername = String(legacyRaw.username || legacyRaw.user || '').trim();
    const legacyPassword = legacyRaw.password != null ? String(legacyRaw.password).trim() : '';
    const legacyHasCreds = Boolean(legacyAddress && legacyUsername && legacyPassword);
    if (!routers.length && legacyHasCreds) {
        const legacyEntry = normalizeRouterEntry(
            {
                ...legacyRaw,
                id: legacyRaw.id || '',
                label: legacyRaw.label || legacyRaw.name || 'MikroTik Router'
            },
            globalEnabled
        );
        if (!routers.some((router) => router.id === legacyEntry.id)) {
            routers.unshift(legacyEntry);
            seen.add(legacyEntry.id);
        }
    }

    let defaultId = String(settings?.mikrotikDefaultId || '').trim();
    if (!defaultId || !routers.some((router) => router.id === defaultId)) {
        const explicitDefault = routers.find((router) => router.isDefault);
        defaultId = explicitDefault?.id || routers[0]?.id || '';
    }

    routers.forEach((router) => {
        router.isDefault = Boolean(defaultId && router.id === defaultId);
    });

    const defaultRouter = routers.find((router) => router.id === defaultId) || null;
    const legacyDefaults = {
        enabled: defaultRouter ? Boolean(defaultRouter.enabled) : globalEnabled,
        address: defaultRouter?.address || legacyRaw.address || '',
        username: defaultRouter?.username || legacyRaw.username || '',
        password: defaultRouter?.password || legacyRaw.password || '',
        port: defaultRouter?.port ?? legacyRaw.port ?? '',
        tls: defaultRouter?.tls ?? coerceOptionalTrue(legacyRaw.tls ?? legacyRaw.apiSsl ?? legacyRaw.ssl)
    };

    const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
    const normalizedAccounts = accounts.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        if (entry.routerId || !defaultId) return entry;
        return { ...entry, routerId: defaultId };
    });

    return {
        ...settings,
        mikrotik: { ...DEFAULT_SETTINGS.mikrotik, ...legacyDefaults },
        mikrotikRouters: routers,
        mikrotikDefaultId: defaultId,
        pppoe: { ...(settings?.pppoe || {}), accounts: normalizedAccounts }
    };
};

const normalizeIntegrationSettings = (settings = {}) =>
    normalizeIpBrowserSettings(normalizeMikrotikSettings(settings));

const hasUsableMikrotikRouter = (settings = {}) => {
    const normalized = normalizeMikrotikSettings(settings);
    if (!normalized?.mikrotik?.enabled) {
        return false;
    }
    return (Array.isArray(normalized?.mikrotikRouters) ? normalized.mikrotikRouters : []).some((router) => (
        router?.enabled !== false
        && Boolean(String(router?.address || '').trim())
        && Boolean(String(router?.username || '').trim())
        && Boolean(String(router?.password ?? '').trim())
    ));
};

const resolveMikrotikRouter = (settings = {}, routerId) => {
    const normalized = normalizeMikrotikSettings(settings);
    if (routerId) {
        const match = normalized.mikrotikRouters.find((router) => router.id === routerId);
        if (match) return match;
    }
    const fallback = normalized.mikrotikRouters.find((router) => router.id === normalized.mikrotikDefaultId);
    if (fallback) return fallback;
    return normalized.mikrotikRouters[0] || null;
};

const normalizeIntegrationStorageError = (error) => {
    if (!error) return error;
    const code = String(error.code || '').toUpperCase();
    if (code === 'ER_DATA_TOO_LONG') {
        const mapped = new Error(
            'Integration payload is too large for current database storage. Run Schema Update, then retry with a smaller GCash QR image if needed.'
        );
        mapped.statusCode = 400;
        return mapped;
    }
    return error;
};

async function ensureIntegrationSecretJsonCapacity() {
    if (integrationSecretJsonColumnChecked) return;
    const [rows] = await query(
        `SELECT data_type
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'integration_settings'
           AND column_name = 'secret_json'
         LIMIT 1`
    );
    if (!rows || !rows.length) {
        integrationSecretJsonColumnChecked = true;
        return;
    }
    const dataType = String(rows[0].data_type || '').toLowerCase();
    if (!['longtext', 'mediumtext', 'json'].includes(dataType)) {
        await query('ALTER TABLE integration_settings MODIFY COLUMN secret_json LONGTEXT NOT NULL');
    }
    integrationSecretJsonColumnChecked = true;
}

async function loadSettings(branchId = null) {
    if (await isRelationalReady()) {
        if (!branchId) {
            const [rows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
            branchId = rows && rows.length ? rows[0].id : null;
        }
        if (!branchId) return normalizeIntegrationSettings({ ...DEFAULT_SETTINGS });
        const [rows] = await query(
            `SELECT secret_json FROM integration_settings WHERE branch_id = ? AND provider = 'core' LIMIT 1`,
            [branchId]
        );
        if (rows && rows.length) {
            let decrypted;
            try {
                decrypted = decryptJson(rows[0].secret_json);
            } catch (error) {
                throw new IntegrationSettingsUnreadableError(branchId, error);
            }
            const merged = { ...DEFAULT_SETTINGS, ...(decrypted && typeof decrypted === 'object' ? decrypted : {}) };
            return normalizeIntegrationSettings(merged);
        }
        return normalizeIntegrationSettings({ ...DEFAULT_SETTINGS });
    }
    const parsed = await readJson(STORE_KEY, null);
    const merged = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    return normalizeIntegrationSettings(merged);
}

async function saveSettings(nextSettings, branchId = null) {
    const merged = { ...DEFAULT_SETTINGS, ...nextSettings };
    const normalized = normalizeIntegrationSettings(merged);
    if (await isRelationalReady()) {
        await ensureIntegrationSecretJsonCapacity();
        if (!branchId) {
            const [rows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
            branchId = rows && rows.length ? rows[0].id : null;
        }
        if (!branchId) throw new Error('Branch not found for integration settings.');
        const encrypted = encryptJson(normalized);
        try {
            await query(
                `INSERT INTO integration_settings (branch_id, provider, secret_json)
                 VALUES (?, 'core', ?)
                 ON DUPLICATE KEY UPDATE secret_json = VALUES(secret_json)`,
                [branchId, JSON.stringify(encrypted)]
            );
        } catch (error) {
            throw normalizeIntegrationStorageError(error);
        }
        return normalized;
    }
    await writeJson(STORE_KEY, normalized);
    return normalized;
}

const requireAuthForIntegrationSettings = (req, res, next) => {
    const { requireAuth } = require('./auth');
    return requireAuth(req, res, next);
};

router.get('/', requireAuthForIntegrationSettings, async (_req, res, next) => {
    try {
        const settings = await loadSettings(_req.user?.branchId || null);
        res.json({ ok: true, settings: sanitizeSettingsForClient(settings) });
    } catch (err) {
        next(err);
    }
});

router.put('/:provider', requireAuthForIntegrationSettings, async (req, res, next) => {
    try {
        const provider = normalizeProviderKey(req.params.provider);
        if (!INTEGRATION_PROVIDER_KEYS.includes(provider)) {
            return res.status(400).json({ ok: false, error: 'Unsupported provider' });
        }
        const incomingRaw = req.body || {};
        const current = await loadSettings(req.user?.branchId || null);
        const incoming = preserveSecretFields(provider, incomingRaw, current[provider] || {});
        let nextSettings;
        if (provider === 'mikrotik') {
            const routersPayload = incoming.mikrotikRouters || incoming.routers;
            if (Array.isArray(routersPayload)) {
                const requestedDefaultId = String(incoming.mikrotikDefaultId || incoming.defaultId || '').trim();
                const defaultRouter =
                    routersPayload.find((router) => String(router?.id || '').trim() === requestedDefaultId) ||
                    routersPayload[0] ||
                    null;
                const effectiveDefaultId = requestedDefaultId || String(defaultRouter?.id || '').trim();
                const enabled = incoming.enabled != null
                    ? coerceEnabled(incoming.enabled)
                    : coerceEnabled(defaultRouter?.enabled);
                const defaultPortRaw = defaultRouter?.port;
                const defaultPortNum = defaultPortRaw === '' || defaultPortRaw == null ? NaN : Number(defaultPortRaw);
                const legacyUpdate = {
                    ...DEFAULT_SETTINGS.mikrotik,
                    enabled,
                    address: String(defaultRouter?.address || defaultRouter?.host || '').trim(),
                    username: String(defaultRouter?.username || defaultRouter?.user || '').trim(),
                    password: defaultRouter?.password != null ? String(defaultRouter.password) : '',
                    port: Number.isFinite(defaultPortNum) && defaultPortNum > 0 ? defaultPortNum : '',
                    tls: coerceOptionalTrue(defaultRouter?.tls ?? defaultRouter?.apiSsl ?? defaultRouter?.ssl)
                };
                nextSettings = {
                    ...current,
                    mikrotik: legacyUpdate,
                    mikrotikRouters: routersPayload,
                    mikrotikDefaultId: effectiveDefaultId
                };
            } else {
                nextSettings = {
                    ...current,
                    mikrotik: { ...current.mikrotik, ...incoming }
                };
            }
        } else if (provider === 'email') {
            const nextPort = incoming.port === '' || incoming.port == null
                ? ''
                : Number(incoming.port);
            const normalized = {
                ...incoming,
                secure: coerceEnabled(incoming.secure),
                port: Number.isFinite(nextPort) && nextPort > 0 ? nextPort : ''
            };
            nextSettings = {
                ...current,
                email: { ...current.email, ...normalized }
            };
        } else if (provider === 'ipBrowser') {
            if (Array.isArray(incoming.profiles) && incoming.profiles.length > 100) {
                return res.status(400).json({ ok: false, error: 'IP Browser supports up to 100 router profiles.' });
            }
            const normalized = normalizeIpBrowserSettings({
                ipBrowser: {
                    ...(current.ipBrowser || {}),
                    ...incoming,
                    autoLoginEnabled: incoming.autoLoginEnabled
                        ?? incoming.enabled
                        ?? current.ipBrowser?.autoLoginEnabled,
                    profiles: Array.isArray(incoming.profiles)
                        ? incoming.profiles
                        : current.ipBrowser?.profiles
                }
            }).ipBrowser;
            const invalidProfile = normalized.profiles.find((profile) => (
                !profile.label
                || !profile.matches.length
                || profile.matches.some((rule) => rule.length > 200)
                || !profile.username
                || !profile.password
            ));
            if (invalidProfile) {
                return res.status(400).json({
                    ok: false,
                    error: 'Every IP Browser profile needs a name, at least one IP/gateway match, a username, and a password.'
                });
            }
            nextSettings = {
                ...current,
                ipBrowser: normalized
            };
        } else {
            nextSettings = {
                ...current,
                [provider]: { ...current[provider], ...incoming }
            };
        }
        const saved = await saveSettings(nextSettings, req.user?.branchId || null);
        res.json({ ok: true, settings: sanitizeSettingsForClient(saved) });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports.DEFAULT_INTEGRATION_SETTINGS = DEFAULT_SETTINGS;
module.exports.loadIntegrationSettings = loadSettings;
module.exports.saveIntegrationSettings = saveSettings;
module.exports.resolveMikrotikRouter = resolveMikrotikRouter;
module.exports.normalizeMikrotikSettings = normalizeMikrotikSettings;
module.exports.normalizeIpBrowserSettings = normalizeIpBrowserSettings;
module.exports.resolveIpBrowserProfile = resolveIpBrowserProfile;
module.exports.preserveIpBrowserProfileSecrets = preserveIpBrowserProfileSecrets;
module.exports.hasUsableMikrotikRouter = hasUsableMikrotikRouter;
module.exports.IntegrationSettingsUnreadableError = IntegrationSettingsUnreadableError;
module.exports.isIntegrationSettingsUnreadableError = isIntegrationSettingsUnreadableError;
module.exports.sanitizeIntegrationSettingsForClient = sanitizeSettingsForClient;
