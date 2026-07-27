const express = require('express');
const crypto = require('crypto');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { encryptJson, decryptJson } = require('./db-secrets');
const { normalizeMikrotikEndpoint } = require('./mikrotik-endpoint');

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
        delayMs: 600
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

function sanitizeSettingsForClient(settings = {}) {
    const normalized = normalizeMikrotikSettings(settings || {});
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
            passwordFallbackCount: normalizeSecretList(ipBrowser.passwordFallbacks).length
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
        if (!branchId) return normalizeMikrotikSettings({ ...DEFAULT_SETTINGS });
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
            return normalizeMikrotikSettings(merged);
        }
        return normalizeMikrotikSettings({ ...DEFAULT_SETTINGS });
    }
    const parsed = await readJson(STORE_KEY, null);
    const merged = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    return normalizeMikrotikSettings(merged);
}

async function saveSettings(nextSettings, branchId = null) {
    const merged = { ...DEFAULT_SETTINGS, ...nextSettings };
    const normalized = normalizeMikrotikSettings(merged);
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
            const delayMs = Number(incoming.delayMs);
            const hasIncomingFallbacks = hasOwn(incoming, 'passwordFallbacks')
                || hasOwn(incoming, 'fallbackPasswords');
            const normalized = {
                autoLoginEnabled: coerceEnabled(incoming.autoLoginEnabled ?? incoming.enabled),
                username: String(incoming.username || '').trim(),
                password: incoming.password != null ? String(incoming.password) : '',
                passwordFallbacks: hasIncomingFallbacks
                    ? normalizeSecretList(incoming.passwordFallbacks ?? incoming.fallbackPasswords)
                    : normalizeSecretList(current.ipBrowser?.passwordFallbacks),
                usernameSelector: String(incoming.usernameSelector || '').trim(),
                passwordSelector: String(incoming.passwordSelector || '').trim(),
                submitSelector: String(incoming.submitSelector || '').trim(),
                delayMs: Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000 ? delayMs : 600
            };
            nextSettings = {
                ...current,
                ipBrowser: { ...current.ipBrowser, ...normalized }
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
module.exports.hasUsableMikrotikRouter = hasUsableMikrotikRouter;
module.exports.IntegrationSettingsUnreadableError = IntegrationSettingsUnreadableError;
module.exports.isIntegrationSettingsUnreadableError = isIntegrationSettingsUnreadableError;
module.exports.sanitizeIntegrationSettingsForClient = sanitizeSettingsForClient;
