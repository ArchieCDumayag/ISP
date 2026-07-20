const { RouterOSClient } = require('routeros-client');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const { getSystemErrorName } = require('node:util');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TIMEOUT_SECONDS = Math.max(1, Math.ceil(DEFAULT_TIMEOUT_MS / 1000));
const DEFAULT_RETRY_COUNT = (() => {
    const configured = Number(process.env.MIKROTIK_CONNECT_RETRIES);
    if (!Number.isInteger(configured) || configured < 0) return 2;
    return configured;
})();
const DEFAULT_RETRY_DELAY_MS = (() => {
    const configured = Number(process.env.MIKROTIK_CONNECT_RETRY_MS);
    if (!Number.isFinite(configured) || configured < 100) return 1500;
    return Math.floor(configured);
})();
const DEFAULT_MAX_RETRY_DELAY_MS = (() => {
    const configured = Number(process.env.MIKROTIK_CONNECT_RETRY_MAX_MS);
    if (!Number.isFinite(configured) || configured < DEFAULT_RETRY_DELAY_MS) return 5000;
    return Math.floor(configured);
})();
const RETRYABLE_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'EHOSTDOWN',
    'EHOSTUNREACH',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'EPIPE',
    'ETIMEDOUT'
]);

const normalizeNodeRouterosInternalErrorCode = (error) => {
    const explicitCode = String(error?.code || '').trim().toUpperCase();
    if (explicitCode) return explicitCode;
    const explicitErrno = String(error?.errno || '').trim().toUpperCase();
    if (explicitErrno && !/^-?\d+$/.test(explicitErrno)) return explicitErrno;
    const message = String(error?.message || '').trim();
    if (/unregistered tag/i.test(message)) return 'UNREGISTEREDTAG';
    if (/unknown reply/i.test(message)) return 'UNKNOWNREPLY';
    return '';
};

const annotateNodeRouterosInternalError = (error) => {
    const code = normalizeNodeRouterosInternalErrorCode(error);
    if (code && error && typeof error === 'object') {
        try {
            error.code = error.code || code;
            error.errno = error.errno || code;
        } catch {
            // Some error-like values may be read-only.
        }
    }
    return code;
};

const installNodeRouterosUnknownReplyGuard = () => {
    try {
        const { Channel } = require('node-routeros/dist/Channel');
        const { RosException } = require('node-routeros/dist/RosException');
        if (Channel?.prototype && !Channel.prototype.__danteUnknownReplyGuard) {
            Object.defineProperty(Channel.prototype, '__danteUnknownReplyGuard', {
                value: true,
                configurable: false,
                enumerable: false,
                writable: false
            });
            Channel.prototype.onUnknown = function onUnknown(reply) {
                const error = new RosException('UNKNOWNREPLY', { reply });
                error.code = error.code || 'UNKNOWNREPLY';
                try {
                    this.emit('trap', { message: error.message, error });
                } catch {
                    // Keep unexpected RouterOS packets from escaping the event loop.
                }
                const connector = this.connector || this.Connector;
                try {
                    if (connector && typeof connector.emit === 'function') {
                        const hasErrorListener = typeof connector.listenerCount !== 'function'
                            || connector.listenerCount('error') > 0;
                        if (hasErrorListener) {
                            connector.emit('error', error, connector);
                            return;
                        }
                    }
                } catch {
                    // The caller will see the command rejection via the trap event above.
                }
                try {
                    if (typeof this.listenerCount !== 'function' || this.listenerCount('error') > 0) {
                        this.emit('error', error);
                    }
                } catch {
                    // Avoid recreating the original crash path.
                }
            };
        }
    } catch {
        // If internals move in a package update, normal connection error handling still applies.
    }

    try {
        const { Connector } = require('node-routeros/dist/connector/Connector');
        if (!Connector?.prototype || Connector.prototype.__danteReceiverGuard) return;
        const originalOnData = Connector.prototype.onData;
        Object.defineProperty(Connector.prototype, '__danteReceiverGuard', {
            value: true,
            configurable: false,
            enumerable: false,
            writable: false
        });
        Connector.prototype.onData = function guardedOnData(data) {
            try {
                return originalOnData.call(this, data);
            } catch (error) {
                annotateNodeRouterosInternalError(error);
                try {
                    if (typeof this.receiver?.cleanUp === 'function') {
                        this.receiver.cleanUp();
                    }
                } catch {
                    // Best-effort cleanup before dropping the bad RouterOS connection.
                }
                try {
                    const hasErrorListener = typeof this.listenerCount !== 'function'
                        || this.listenerCount('error') > 0;
                    if (hasErrorListener && typeof this.emit === 'function') {
                        this.emit('error', error, this);
                    }
                } catch {
                    // Never let a RouterOS receiver fault escape the socket data handler.
                }
                try {
                    if (typeof this.destroy === 'function') {
                        this.destroy();
                    }
                } catch {
                    // The connection is already unusable; ignore cleanup failures.
                }
                return undefined;
            }
        };
    } catch {
        // If internals move in a package update, normal connection error handling still applies.
    }
};

installNodeRouterosUnknownReplyGuard();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const coerceOptionalBoolean = (value) => {
    if (value == null || value === '') return undefined;
    if (value === true || value === false) return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return undefined;
    if (['true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', 'no', 'n', 'off'].includes(normalized)) return false;
    return undefined;
};

const normalizeRetryCount = (value, fallback = DEFAULT_RETRY_COUNT) => {
    if (value == null) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return fallback;
    return parsed;
};

const normalizeRetryDelay = (value, fallback = DEFAULT_RETRY_DELAY_MS) => {
    if (value == null) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 100) return fallback;
    return Math.floor(parsed);
};

const normalizePort = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8728;
    return Math.trunc(parsed);
};

const normalizeTimeoutSeconds = (value, fallbackMs = DEFAULT_TIMEOUT_MS) => {
    if (value == null || value === '') return DEFAULT_TIMEOUT_SECONDS;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return Math.max(1, Math.ceil(Number(fallbackMs || DEFAULT_TIMEOUT_MS) / 1000));
    }
    if (parsed <= 120) {
        return Math.max(1, Math.floor(parsed));
    }
    return Math.max(1, Math.ceil(parsed / 1000));
};

const buildConnectionLabel = (creds = {}, explicitLabel = '') => {
    const customLabel = String(explicitLabel || '').trim();
    if (customLabel) return customLabel;
    const host = String(creds.address || creds.host || '').trim() || 'unknown-host';
    const user = String(creds.username || creds.user || '').trim() || 'unknown-user';
    return `${host}:${normalizePort(creds.port)} as ${user}`;
};

const normalizeMikrotikErrorCode = (error) => {
    if (!error) return '';
    const explicitCode = String(error.code || '').trim().toUpperCase();
    if (explicitCode) return explicitCode;
    const explicitErrno = String(error.errno || '').trim().toUpperCase();
    if (explicitErrno && !/^-?\d+$/.test(explicitErrno)) return explicitErrno;
    if (Number.isInteger(error.errno)) {
        try {
            return String(getSystemErrorName(error.errno) || '').trim().toUpperCase();
        } catch {
            // ignore and fall back to message parsing
        }
    }
    const message = String(error.message || '');
    const match = message.match(/\b(E[A-Z0-9_]+)\b/);
    return match ? String(match[1] || '').trim().toUpperCase() : '';
};

const isRetryableMikrotikError = (error) => RETRYABLE_ERROR_CODES.has(normalizeMikrotikErrorCode(error));

const isLikelyIpAddress = (value) => {
    const candidate = String(value || '').trim();
    if (!candidate) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) return true;
    return candidate.includes(':');
};

const buildMikrotikTlsOptions = (creds = {}, override = undefined) => {
    if (override && typeof override === 'object') {
        return { ...override };
    }
    const secureOptions = crypto.constants?.SSL_OP_LEGACY_SERVER_CONNECT || 0;
    const servername = String(creds.address || creds.host || '').trim();
    return {
        rejectUnauthorized: false,
        minVersion: 'TLSv1',
        ciphers: 'DEFAULT@SECLEVEL=0',
        ...(secureOptions ? { secureOptions } : {}),
        ...(!isLikelyIpAddress(servername) && servername ? { servername } : {})
    };
};

const isOpaqueMikrotikError = (error) => {
    if (!error) return false;
    const code = normalizeMikrotikErrorCode(error);
    const message = String(error.message || '').trim();
    return !code && !message;
};

const probePlainSocket = (creds = {}, timeoutMs = 3000) => new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
            socket.destroy();
        } catch {
            // ignore cleanup errors
        }
        resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, code: '', message: '' }));
    socket.once('timeout', () => finish({
        ok: false,
        code: 'ETIMEDOUT',
        message: `Timed out after ${Math.max(1, Math.round(timeoutMs / 1000))} seconds`
    }));
    socket.once('error', (error) => finish({
        ok: false,
        code: String(error?.code || '').trim().toUpperCase(),
        message: String(error?.message || '').trim()
    }));
    socket.connect(normalizePort(creds.port), creds.address || creds.host);
});

const probeTlsSocket = (creds = {}, timeoutMs = 3000) => new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({
        host: creds.address || creds.host,
        port: normalizePort(creds.port),
        ...buildMikrotikTlsOptions(creds),
        timeout: timeoutMs
    });
    const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
            socket.destroy();
        } catch {
            // ignore cleanup errors
        }
        resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('secureConnect', () => finish({ ok: true, code: '', message: '' }));
    socket.once('timeout', () => finish({
        ok: false,
        code: 'ETIMEDOUT',
        message: `Timed out after ${Math.max(1, Math.round(timeoutMs / 1000))} seconds`
    }));
    socket.once('tlsClientError', (error) => finish({
        ok: false,
        code: String(error?.code || '').trim().toUpperCase(),
        message: String(error?.message || '').trim()
    }));
    socket.once('error', (error) => finish({
        ok: false,
        code: String(error?.code || '').trim().toUpperCase(),
        message: String(error?.message || '').trim()
    }));
});

const enrichOpaqueMikrotikError = async (error, creds = {}, transport = '') => {
    if (!isOpaqueMikrotikError(error)) return error;
    const host = String(creds.address || creds.host || '').trim() || 'unknown-host';
    const port = normalizePort(creds.port);
    const probeTimeoutMs = 3000;

    if (transport === 'tls') {
        const tlsProbe = await probeTlsSocket(creds, probeTimeoutMs).catch(() => null);
        if (tlsProbe?.ok) {
            error.code = 'OPAQUE_TLS_NEGOTIATION';
            error.message = `TLS to ${host}:${port} succeeded, but RouterOS API negotiation still failed. Check MikroTik api-ssl service and credentials.`;
            return error;
        }
        const detail = String(tlsProbe?.message || tlsProbe?.code || 'TLS handshake failed').trim();
        error.code = String(tlsProbe?.code || 'OPAQUE_TLS_PROBE_FAILED').trim().toUpperCase();
        error.message = `TLS handshake to ${host}:${port} failed: ${detail}`;
        return error;
    }

    const plainProbe = await probePlainSocket(creds, probeTimeoutMs).catch(() => null);
    if (plainProbe?.ok) {
        error.code = 'OPAQUE_PLAIN_NEGOTIATION';
        error.message = `TCP port ${host}:${port} is reachable, but plain RouterOS API negotiation failed. This endpoint may be forwarding to api-ssl (8729) or a different service.`;
        return error;
    }
    const detail = String(plainProbe?.message || plainProbe?.code || 'Connection failed').trim();
    error.code = String(plainProbe?.code || 'OPAQUE_TCP_PROBE_FAILED').trim().toUpperCase();
    error.message = `TCP probe to ${host}:${port} failed: ${detail}`;
    return error;
};

const resolveTlsPreference = (creds = {}, options = {}) => {
    const directOption = coerceOptionalBoolean(options.tls);
    if (typeof directOption === 'boolean') return directOption;
    const nestedTls = options.tlsOptions && typeof options.tlsOptions === 'object'
        ? true
        : undefined;
    if (typeof nestedTls === 'boolean') return nestedTls;
    return undefined;
};

const buildConnectionModes = (creds = {}, options = {}) => {
    const explicitTls = resolveTlsPreference(creds, options);
    const tlsOptions = buildMikrotikTlsOptions(creds, options.tlsOptions);
    const plain = { name: 'plain', tls: undefined };
    const tls = { name: 'tls', tls: tlsOptions };
    if (explicitTls === true) return [tls];
    if (explicitTls === false) return [plain];
    if (normalizePort(creds.port) === 8729) {
        return [tls, plain];
    }
    return [plain, tls];
};

const attachErrorListener = (emitter, handler) => {
    if (!emitter || typeof emitter.on !== 'function') {
        return () => {};
    }
    emitter.on('error', handler);
    return () => {
        if (typeof emitter.off === 'function') {
            emitter.off('error', handler);
            return;
        }
        if (typeof emitter.removeListener === 'function') {
            emitter.removeListener('error', handler);
        }
    };
};

const attachClientErrorListener = (client, options = {}) => {
    if (!client || typeof client.on !== 'function') {
        return () => {};
    }
    const seenErrors = new WeakSet();
    let lastSignature = '';
    let lastSignatureAt = 0;
    const handler = (error) => {
        const now = Date.now();
        if (error && typeof error === 'object') {
            if (seenErrors.has(error)) return;
            seenErrors.add(error);
        }
        const signature = `${normalizeMikrotikErrorCode(error)}|${String(error?.message || error || '')}`;
        if (signature && signature === lastSignature && now - lastSignatureAt < 500) {
            return;
        }
        lastSignature = signature;
        lastSignatureAt = now;
        void (async () => {
            let finalError = error;
            try {
                if (typeof options.enrichError === 'function') {
                    finalError = await options.enrichError(error, client) || error;
                }
            } catch {
                finalError = error;
            }
            try {
                if (typeof options.onClientError === 'function') {
                    options.onClientError(finalError, client);
                }
            } catch {
                // Never let the recovery callback crash the process.
            }
            try {
                if (typeof options.logger === 'function') {
                    options.logger(finalError, {
                        label: options.label || '',
                        code: normalizeMikrotikErrorCode(finalError),
                        transport: options.transport || ''
                    });
                }
            } catch {
                // Logging failures should never affect runtime behavior.
            }
        })();
    };
    const detachClient = attachErrorListener(client, handler);
    const detachRosApi = attachErrorListener(client.rosApi, handler);
    return () => {
        detachClient();
        detachRosApi();
    };
};

const connectMikrotikClient = async (creds = {}, options = {}) => {
    const retries = normalizeRetryCount(options.retries);
    const retryDelayMs = normalizeRetryDelay(options.retryDelayMs);
    const maxRetryDelayMs = normalizeRetryDelay(options.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS);
    const label = buildConnectionLabel(creds, options.label);
    const timeoutSeconds = normalizeTimeoutSeconds(options.timeout, DEFAULT_TIMEOUT_MS);
    const connectionModes = buildConnectionModes(creds, options);

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const modeErrors = [];
        for (const mode of connectionModes) {
            const client = new RouterOSClient({
                host: creds.address || creds.host,
                user: creds.username || creds.user,
                password: creds.password,
                port: normalizePort(creds.port),
                timeout: timeoutSeconds,
                keepalive: options.keepalive === true,
                ...(mode.tls ? { tls: mode.tls } : {})
            });
            attachClientErrorListener(client, {
                label,
                transport: mode.name,
                enrichError: (error) => enrichOpaqueMikrotikError(error, creds, mode.name),
                onClientError: options.onClientError,
                logger: options.logger
            });

            try {
                const api = await client.connect();
                attachErrorListener(client.rosApi?.connector, (error) => {
                    client.emit('error', error);
                });
                return {
                    client,
                    api,
                    transport: mode.name,
                    tls: mode.name === 'tls'
                };
            } catch (error) {
                const finalError = await enrichOpaqueMikrotikError(error, creds, mode.name).catch(() => error);
                lastError = finalError;
                finalError.mikrotikTransport = mode.name;
                modeErrors.push(finalError);
                if (typeof client.close === 'function') {
                    await client.close().catch(() => {});
                }
            }
        }

        if (modeErrors.length > 1 && lastError) {
            lastError.mikrotikModeErrors = modeErrors.map((error) => ({
                transport: error?.mikrotikTransport || 'unknown',
                code: normalizeMikrotikErrorCode(error),
                message: error?.message || ''
            }));
        }

        if (attempt >= retries || !isRetryableMikrotikError(lastError)) {
            throw lastError;
        }
        const delayMs = Math.min(maxRetryDelayMs, retryDelayMs * Math.pow(2, attempt));
        if (typeof options.onRetry === 'function') {
            try {
                options.onRetry({
                    attempt: attempt + 1,
                    retries,
                    delayMs,
                    error: lastError,
                    label,
                    code: normalizeMikrotikErrorCode(lastError)
                });
            } catch {
                // Retry callback failures should not block reconnects.
            }
        }
        await sleep(delayMs);
    }

    throw lastError || new Error(`Unable to connect to MikroTik (${label})`);
};

module.exports = {
    connectMikrotikClient,
    normalizeMikrotikErrorCode,
    isRetryableMikrotikError
};
