const express = require('express');
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./data-store');
const createError = require('http-errors');
const crypto = require('crypto');
const https = require('https');
const { connectMikrotikClient } = require('./mikrotik-client');
const { loadIntegrationSettings, saveIntegrationSettings, resolveMikrotikRouter } = require('./integration-settings');
const { getUserFromSession } = require('./auth');
const { query } = require('./db');
const { assignEntryNumbers, assertEntryNumbersAvailable, withTransaction } = require('./payment-numbering');
const { isRelationalReady } = require('./db-relational');
const customersModule = require('./customers');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const { normalizePaymentEntry } = require('./payment-entry-normalizer');
const { auditMikrotikPppoeCommand } = require('./mikrotik-audit-log');
const { accountHasRole } = require('./role-utils');

const router = express.Router();
const STORE_KEYS = {
    payments: 'payments',
    customers: 'customers'
};
const PAYMENT_BACKUP_DIR = path.join(__dirname, 'data', 'payment-backups');
const readCustomers = async (branchId = null) => {
    if (typeof customersModule.readVisibleCustomers === 'function') {
        return customersModule.readVisibleCustomers(branchId);
    }
    if (typeof customersModule.readCustomers === 'function') {
        return customersModule.readCustomers(branchId);
    }
    const data = await readJson(STORE_KEYS.customers, []);
    return Array.isArray(data) ? data : [];
};
const writeCustomers = async (customers, branchId = null) => {
    if (typeof customersModule.writeCustomers === 'function') {
        return customersModule.writeCustomers(customers, branchId);
    }
    await writeJson(STORE_KEYS.customers, customers);
};
const readPlans = async (branchId = null) => {
    if (typeof customersModule.readPlans === 'function') {
        return customersModule.readPlans(branchId);
    }
    return [];
};
const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;
const ABSOLUTE_SCHEME_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let cachedCloudflaredHostname;
const XENDIT_SUCCESS_STATUSES = new Set(['COMPLETED', 'SETTLED', 'PAID', 'SUCCESS', 'SUCCEEDED']);
const XENDIT_CALLBACK_TOKEN_HEADERS = ['x-callback-token'];
const XENDIT_SIGNATURE_HEADERS = [
    'x-signature',
    'x-xendit-signature',
    'x-endit-signature',
    'x-xendit-signature-256'
];
const STATUS_ACTIVE = 'active';
const STATUS_INACTIVE = 'inactive';
const STATUS_DISABLED = 'disabled';
const STATUS_MODE_AUTO = 'auto';

const normalizeStatusValue = (value, fallback = STATUS_ACTIVE) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'force-inactive') return STATUS_INACTIVE;
    if (raw === STATUS_ACTIVE || raw === STATUS_INACTIVE || raw === STATUS_DISABLED) return raw;
    if (raw === 'force-active') return STATUS_ACTIVE; // backward compatibility
    return fallback;
};

const resolveCustomerStatusState = (customer = {}) => {
    const rawStatus = String(customer?.status || '').trim().toLowerCase();
    const status = normalizeStatusValue(rawStatus, STATUS_ACTIVE);
    return { status, statusMode: STATUS_MODE_AUTO };
};

const isPositiveCreditEntry = (entry = {}) => {
    const amount = Number(entry?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const kind = String(entry?.kind || '').trim().toLowerCase();
    const direction = String(entry?.direction || '').trim().toLowerCase();
    return direction === 'credit' || ['payment', 'rebate', 'discount'].includes(kind);
};

const getRawBody = (req) => {
    if (typeof req.rawBody === 'string') return req.rawBody;
    if (typeof req.body === 'string') return req.body;
    try {
        return JSON.stringify(req.body || {});
    } catch {
        return '';
    }
};

const getXenditSignature = (req) => {
    for (const header of XENDIT_SIGNATURE_HEADERS) {
        const value = req.get(header);
        if (value) return value;
    }
    return '';
};

const getXenditCallbackToken = (req) => {
    for (const header of XENDIT_CALLBACK_TOKEN_HEADERS) {
        const value = req.get(header);
        if (value) return value;
    }
    return '';
};

const extractAccountNumberFromXenditIdentifier = (value) => {
    if (!value) return '';
    const normalized = String(value).trim();
    if (/^\d{5,20}$/.test(normalized)) return normalized;
    const tagged = normalized.match(/^(?:acct|cust)-(.+)$/i);
    if (tagged && tagged[1]) {
        const firstToken = String(tagged[1]).split('-')[0].trim();
        if (firstToken) return firstToken;
    }
    const numericFallback = normalized.match(/\d{5,20}/);
    if (numericFallback && numericFallback[0]) return numericFallback[0];
    return '';
};
const extractDisplayReferenceFromXenditIdentifier = (value) => {
    const normalized = sanitizeString(value);
    if (!normalized) return '';
    const tagged = normalized.match(/^(?:acct|cust)-([^-]+)-(.+)$/i);
    if (!tagged || !tagged[2]) {
        return normalized;
    }
    const trailingToken = String(tagged[2]).split('-').filter(Boolean).pop();
    return sanitizeString(trailingToken || tagged[2]);
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
const REF_WIDTH = 12;
const REF_BODY_LEN = 11;
const REF_MAX_LENGTH = 32;
const DATE_ONLY_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SQL_DATETIME_VALUE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_DATETIME_NO_TZ_VALUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const MANILA_OFFSET_SUFFIX = '+08:00';
const BARE_DATETIME_VALUE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?$/;
const TIMEZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const EXPLICIT_TIME_VALUE_RE = /(?:T|\s)\d{2}:\d{2}(?::\d{2})?/;
const REFERENCE_REQUIRED_FOR_COLLECTOR_ERROR = 'Reference is required for collector submissions.';
const digitsOnly = (value) => {
    const trimmed = sanitizeString(value);
    return /^\d+$/.test(trimmed) ? trimmed : '';
};
const padBody = (value) => String(value).padStart(REF_BODY_LEN, '0');
const computeCheckDigit = (payload) => {
    // Luhn check digit calculation for payload (without check digit)
    const digits = (payload + '0').split('').reverse();
    let sum = 0;
    digits.forEach((ch, idx) => {
        let n = Number(ch);
        if (!Number.isFinite(n)) return;
        if (idx % 2 === 1) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
    });
    return String((10 - (sum % 10)) % 10);
};
const collectUsedRefs = (payments, accountNumber) => {
    const used = new Set();
    const history = payments?.[accountNumber]?.history || [];
    history.forEach((entry) => {
        const ref = digitsOnly(entry?.reference);
        if (ref) {
            // normalize to full width to avoid mismatches
            const normalized = ref.padStart(REF_WIDTH, '0').slice(-REF_WIDTH);
            used.add(normalized);
        }
    });
    return used;
};
const generateRandomBase = () => padBody(crypto.randomInt(0, 10 ** REF_BODY_LEN));
const generateRef = (used) => {
    // Try random bases first
    for (let attempt = 0; attempt < 25; attempt++) {
        const base = generateRandomBase();
        const check = computeCheckDigit(base);
        const ref = `${base}${check}`;
        if (!used.has(ref)) return ref;
    }
    // Fallback: deterministic increment from max
    let maxBase = 0;
    used.forEach((ref) => {
        const base = ref.slice(0, REF_BODY_LEN);
        const num = parseInt(base, 10);
        if (Number.isFinite(num) && num > maxBase) maxBase = num;
    });
    const nextBase = padBody(maxBase + 1);
    return `${nextBase}${computeCheckDigit(nextBase)}`;
};
const normalizeIncomingReference = (input, used) => {
    const text = sanitizeString(input);
    if (!text) {
        return generateRef(used);
    }
    if (text.length > REF_MAX_LENGTH) {
        throw createError(400, `Reference must be at most ${REF_MAX_LENGTH} characters.`);
    }
    return text;
};
const sanitizeReferenceInput = (input) => {
    const text = sanitizeString(input);
    if (!text) return '';
    if (text.length > REF_MAX_LENGTH) {
        throw createError(400, `Reference must be at most ${REF_MAX_LENGTH} characters.`);
    }
    return text;
};
const collectUsedReferenceTokens = (history = []) => {
    const used = new Set();
    (Array.isArray(history) ? history : []).forEach((entry) => {
        const token = sanitizeString(entry?.reference).toLowerCase();
        if (token) used.add(token);
    });
    return used;
};

const collectUsedRefsFromDb = async (branchId, accountNumber) => {
    if (!branchId || !accountNumber) return new Set();
    const [rows] = await query(
        `SELECT reference FROM payment_entries WHERE branch_id = ? AND account_number = ? AND reference IS NOT NULL`,
        [branchId, accountNumber]
    );
    const used = new Set();
    (rows || []).forEach((row) => {
        const ref = digitsOnly(row.reference);
        if (!ref) return;
        const normalized = ref.padStart(REF_WIDTH, '0').slice(-REF_WIDTH);
        used.add(normalized);
    });
    return used;
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
const normalizeCredentials = (raw = {}) => {
    const address = String(raw.address || raw.host || '').trim();
    const username = String(raw.username || raw.user || '').trim();
    const password = raw.password != null ? String(raw.password) : '';
    const port = raw.port ? Number(raw.port) : undefined;
    return { address, username, password, port };
};

const mergeAccountsForRouter = (settings, routerId, routerAccounts) => {
    const existing = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
    const preserved = existing.filter((acc) => String(acc?.routerId || settings?.mikrotikDefaultId || '') !== routerId);
    const nextAccounts = routerAccounts.map((acc) => ({ ...acc, routerId }));
    return [...preserved, ...nextAccounts];
};

const resolveCustomerRouterId = (customer, settings) => {
    const explicit = String(customer?.mikrotikId || customer?.routerId || '').trim();
    return explicit || String(settings?.mikrotikDefaultId || '').trim();
};

async function connectMikrotik(creds) {
    if (!creds.address || !creds.username || !creds.password) {
        throw new Error('Missing MikroTik credentials');
    }
    return connectMikrotikClient(creds, {
        keepalive: false,
        timeout: 8000
    });
}

const buildPppoeAccounts = (secrets = [], activeSessions = []) => {
    const activeMap = new Map();
    if (Array.isArray(activeSessions)) {
        activeSessions.forEach((session) => {
            const u = session.name || session.user || '';
            if (u) activeMap.set(u, session);
        });
    }
    return Array.isArray(secrets)
        ? secrets
              .map((secret) => {
                  const username = secret.name || secret.user || '';
                  if (!username) return null;
                  const disabled = String(secret.disabled || '').toLowerCase() === 'true';
                  const active = activeMap.get(username);
                  const status = disabled ? 'disabled' : active ? 'online' : 'offline';
                  return {
                      username,
                      password: secret.password || '',
                      profile: secret.profile || '',
                      pairedCustomer: '',
                      pairedPppoe: '',
                      status,
                      inactiveSince: secret['last-logged-out'] || '',
                      sessionUptime: active?.uptime || active?.['session-uptime'] || '',
                      activeAddress: active?.address || active?.['remote-address'] || ''
                  };
              })
              .filter(Boolean)
        : [];
};

const mapPaymentRow = (row) => normalizePaymentEntry({
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
    const rawPayments = data && typeof data === 'object' ? data : {};
    return Object.fromEntries(
        Object.entries(rawPayments).map(([accountNumber, accountData]) => [
            accountNumber,
            {
                ...accountData,
                history: (Array.isArray(accountData?.history) ? accountData.history : []).map((entry) => normalizePaymentEntry(entry))
            }
        ])
    );
};

const readPaymentsForAccount = async (accountNumber, branchId = null) => {
    if (await isRelationalReady()) {
        const [rows] = await query(
            `SELECT
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
             ${branchId ? 'AND branch_id = ?' : ''}
             ORDER BY recorded_at DESC`,
            branchId ? [accountNumber, branchId] : [accountNumber]
        );
        return (rows || []).map(mapPaymentRow);
    }
    const payments = await readPayments();
    return payments?.[accountNumber]?.history || [];
};

const writePayments = async (payments) => {
    await writeJson(STORE_KEYS.payments, payments);
};

const countPaymentEntries = (payments = {}) => Object.values(payments || {}).reduce((sum, record) => (
    sum + (Array.isArray(record?.history) ? record.history.length : 0)
), 0);

const countPaymentAccounts = (payments = {}) => Object.values(payments || {}).filter((record) => (
    Array.isArray(record?.history) && record.history.length > 0
)).length;

const safeBackupToken = (value, fallback = 'all') => {
    const token = String(value || fallback).trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
    return token || fallback;
};

const createPaymentRecordsBackup = async (payments, { branchId = null, user = null, reason = 'manual' } = {}) => {
    const relational = await isRelationalReady();
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-');
    const branchToken = safeBackupToken(branchId || 'all');
    const filename = `payment-records-${branchToken}-${stamp}.json`;
    const filePath = path.join(PAYMENT_BACKUP_DIR, filename);
    const payload = {
        ok: true,
        createdAt,
        reason,
        storage: relational ? 'mysql' : 'json',
        branchId: branchId || null,
        createdBy: user ? {
            id: user.id || null,
            username: user.username || null,
            role: user.role || null
        } : null,
        accountCount: countPaymentAccounts(payments),
        entryCount: countPaymentEntries(payments),
        payments: payments && typeof payments === 'object' ? payments : {}
    };

    await fs.promises.mkdir(PAYMENT_BACKUP_DIR, { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return {
        filename,
        path: filePath,
        createdAt,
        accountCount: payload.accountCount,
        entryCount: payload.entryCount
    };
};

const assertAdminUser = async (req) => {
    const user = req.user || await getUserFromSession(req);
    if (!user || !accountHasRole(user, 'Admin')) {
        throw createError(403, 'Admin access is required.');
    }
    return user;
};

const toMysqlDateTime = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        if (isNaN(value)) return null;
        return value.toISOString().slice(0, 19).replace('T', ' ');
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
    const parsed = new Date(raw);
    if (isNaN(parsed)) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const toMysqlDateOnly = (value) => {
    if (!value) return null;
    if (value instanceof Date) {
        if (isNaN(value)) return null;
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 10);
    const parsed = new Date(raw);
    if (isNaN(parsed)) return null;
    return parsed.toISOString().slice(0, 10);
};

const hasExplicitTimeValue = (value) => EXPLICIT_TIME_VALUE_RE.test(String(value || '').trim());

const normalizeDateTimeForRecordedAt = (value) => {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const raw = String(value || '').trim();
    if (!raw || !hasExplicitTimeValue(raw)) return null;
    if (TIMEZONE_SUFFIX_RE.test(raw)) return raw;
    const match = raw.match(BARE_DATETIME_VALUE_RE);
    if (!match) return raw;
    const seconds = match[3] || '00';
    return `${match[1]}T${match[2]}:${seconds}${match[4] || ''}${MANILA_OFFSET_SUFFIX}`;
};

const resolveRecordedAtValue = (explicitRecordedAt, paymentDate) => (
    normalizeDateTimeForRecordedAt(explicitRecordedAt)
    || normalizeDateTimeForRecordedAt(paymentDate)
    || new Date().toISOString()
);

const toPaymentDateOnly = (value) => {
    if (!value) return null;
    if (value instanceof Date) return toMysqlDateOnly(value);
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
    return match ? match[1] : toMysqlDateOnly(raw);
};

const hasPaymentFingerprint = async (branchId, accountNumber, fingerprint, executor = null) => {
    if (!fingerprint || !branchId || !accountNumber) return false;
    const runQuery = executor && typeof executor.query === 'function'
        ? executor.query.bind(executor)
        : query;
    const [rows] = await runQuery(
        `SELECT id FROM payment_entries WHERE branch_id = ? AND account_number = ? AND fingerprint = ? LIMIT 1`,
        [branchId, accountNumber, fingerprint]
    );
    return Boolean(rows && rows.length);
};

const insertPaymentEntry = async (entry, branchId, accountNumber, executor = null) => {
    const runQuery = executor && typeof executor.query === 'function'
        ? executor.query.bind(executor)
        : query;
    const recordedBy = entry.recordedBy || {};
    const recordedAt = toMysqlDateTime(entry.recordedAt || normalizeDateTimeForRecordedAt(entry.date) || new Date());
    const entryDate = toPaymentDateOnly(entry.date) || toMysqlDateOnly(entry.recordedAt || recordedAt);
    await runQuery(
        `INSERT INTO payment_entries (
            id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
            recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
            payer, status, payment_method, fingerprint, xendit_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            String(entry.id || `${accountNumber}-${Date.now()}`),
            branchId,
            String(accountNumber),
            Number(entry.amount) || 0,
            entryDate,
            entry.kind || null,
            entry.direction || null,
            entry.reference || null,
            entry.orNumber || null,
            entry.description || null,
            entry.type || null,
            recordedAt,
            recordedBy.id ? String(recordedBy.id) : null,
            recordedBy.username || null,
            recordedBy.name || null,
            recordedBy.role || null,
            entry.payer || null,
            entry.status || null,
            entry.paymentMethod || null,
            entry.fingerprint || null,
            entry.xenditId || null
        ]
    );
};

const pad2 = (n) => String(n).padStart(2, '0');

const formatDateOnly = (d) => {
    if (!(d instanceof Date) || isNaN(d)) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const parseDateOnly = (value) => {
    const parts = String(value || '').trim().split('-').map((part) => Number(part));
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
};

const clampDay = (year, monthIndex, day) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return Math.min(day, lastDay);
};

const advanceMonthlyCycleDate = (baseDate, months = 1) => {
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth() + months;
    const day = baseDate.getDate();
    return new Date(year, month, clampDay(year, month, day));
};

const isAutoGeneratedMonthlyChargeEntry = (entry = {}) => {
    const entryId = String(entry?.id || '').trim();
    const kind = String(entry?.kind || '').trim().toLowerCase();
    const direction = String(entry?.direction || '').trim().toLowerCase();
    const description = String(entry?.description || '').trim().toLowerCase();
    if (/^bill-[^-]+-\d{4}-\d{2}$/i.test(entryId)) return true;
    return kind === 'charge'
        && direction === 'debit'
        && description === 'monthly recurring charge';
};

const parseDateTimeValue = (value) => {
    if (value instanceof Date) {
        return isNaN(value) ? null : new Date(value.getTime());
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    let parsed;
    if (DATE_ONLY_VALUE_RE.test(raw)) {
        parsed = new Date(`${raw}T00:00:00`);
    } else if (SQL_DATETIME_VALUE_RE.test(raw)) {
        parsed = new Date(raw.replace(' ', 'T') + 'Z');
    } else if (ISO_DATETIME_NO_TZ_VALUE_RE.test(raw)) {
        parsed = new Date(`${raw}Z`);
    } else {
        parsed = new Date(raw);
    }
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolvePrepaidExpiryDate = (customer = {}) => {
    const explicit = parseDateTimeValue(customer?.prepaidExpirationAt);
    if (explicit) return explicit;
    const dueDate = parseDateTimeValue(customer?.dueDate);
    if (!dueDate) return null;
    // DATE-only due dates should be valid until end-of-day.
    dueDate.setHours(23, 59, 59, 999);
    return dueDate;
};

const resolveValidityDaysFromSuffix = (suffix = '') => {
    const raw = String(suffix || '').toLowerCase();
    const dayMatch = raw.match(/(\d+)\s*day/);
    if (dayMatch && dayMatch[1]) return Number(dayMatch[1]) || 0;
    const weekMatch = raw.match(/(\d+)\s*week/);
    if (weekMatch && weekMatch[1]) return (Number(weekMatch[1]) || 0) * 7;
    const hourMatch = raw.match(/(\d+)\s*hour/);
    if (hourMatch && hourMatch[1]) return Math.max(Math.ceil((Number(hourMatch[1]) || 0) / 24), 1);
    return 0;
};

const resolvePrepaidRenewalTerms = (customer = {}, plans = []) => {
    const planNameKey = String(customer?.planName || '').trim().toLowerCase();
    const planIdKey = String(customer?.planId || '').trim().toLowerCase();
    const plan = (Array.isArray(plans) ? plans : []).find((entry) => {
        const category = String(entry?.category || '').trim().toLowerCase();
        if (category && category !== 'prepaid') return false;
        const id = String(entry?.id || '').trim().toLowerCase();
        const name = String(entry?.name || '').trim().toLowerCase();
        return (planIdKey && id === planIdKey) || (planNameKey && name === planNameKey);
    }) || null;

    const explicitValidity = Number(plan?.validity);
    const fromPlan = Number.isFinite(explicitValidity) && explicitValidity > 0
        ? Math.round(explicitValidity)
        : 0;
    const fromSuffix = resolveValidityDaysFromSuffix(plan?.priceSuffix || '');
    const validityDays = Math.max(fromPlan || fromSuffix || 7, 1);

    const unitPriceCandidates = [Number(plan?.price), Number(customer?.planAmount)];
    const unitPrice = unitPriceCandidates.find((value) => Number.isFinite(value) && value > 0) || 0;

    return { validityDays, unitPrice };
};

const maybeExtendPrepaidExpiryOnPayment = async (accountNumber, paymentEntry, branchId = null) => {
    const amount = Number(paymentEntry?.amount);
    const kind = String(paymentEntry?.kind || '').trim().toLowerCase();
    const direction = String(paymentEntry?.direction || '').trim().toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (kind !== 'payment' || direction !== 'credit') return;

    const customers = await readCustomers(branchId);
    const idx = customers.findIndex((customer) => String(customer?.accountNumber || '') === String(accountNumber));
    if (idx < 0) return;

    const current = customers[idx];
    if (!isPrepaidCustomer(current)) return;

    const plans = await readPlans(current.branchId || branchId);
    const { validityDays, unitPrice } = resolvePrepaidRenewalTerms(current, plans);
    const cycles = Number.isFinite(unitPrice) && unitPrice > 0
        ? Math.max(1, Math.floor((amount + 1e-9) / unitPrice))
        : 1;
    const daysToAdd = Math.max(validityDays * cycles, 1);

    const now = new Date();
    const currentExpiry = resolvePrepaidExpiryDate(current);
    const baseDate = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const nextExpiry = new Date(baseDate.getTime());
    nextExpiry.setDate(nextExpiry.getDate() + daysToAdd);

    customers[idx] = {
        ...current,
        status: STATUS_ACTIVE,
        statusMode: STATUS_MODE_AUTO,
        dueDate: formatDateOnly(nextExpiry),
        prepaidExpirationAt: nextExpiry.toISOString()
    };

    if (await isRelationalReady()) {
        await writeCustomers([customers[idx]], current.branchId || branchId);
    } else {
        await writeCustomers(customers, branchId);
    }
};

const computeBalance = (history = []) => {
    if (!Array.isArray(history)) return 0;
    let balance = 0;
    history.forEach((p) => {
        const amt = Number(p.amount);
        if (!Number.isFinite(amt)) return;
        const kind = String(p.kind || '').toLowerCase();
        const direction = String(p.direction || '').toLowerCase();
        const isDebit = direction === 'debit' || kind === 'charge';
        const isCredit = direction === 'credit' || ['payment', 'rebate', 'discount'].includes(kind);
        if (isDebit) balance += amt;
        else if (isCredit) balance -= amt;
    });
    return balance;
};

const deriveOffset = (customer) => {
    const raw = Number(customer?.dueOffset);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    // fallback: diff between dueDate and billDate
    if (customer?.billDate && customer?.dueDate) {
        const bill = new Date(customer.billDate);
        const due = new Date(customer.dueDate);
        if (!isNaN(bill) && !isNaN(due)) {
            const diffDays = Math.round((due - bill) / (1000 * 60 * 60 * 24));
            if (Number.isFinite(diffDays) && diffDays >= 0) return diffDays;
        }
    }
    return 5; // default
};

const normalizeEntryIds = (values = []) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
));

const reconcileCustomerCycleAfterDeletedCharges = async (accountNumber, branchId, deletedEntries = []) => {
    const autoCharges = (Array.isArray(deletedEntries) ? deletedEntries : [])
        .filter((entry) => isAutoGeneratedMonthlyChargeEntry(entry))
        .slice()
        .sort((left, right) => {
            const leftDate = parseDateOnly(left?.date) || parseDateTimeValue(left?.recordedAt);
            const rightDate = parseDateOnly(right?.date) || parseDateTimeValue(right?.recordedAt);
            const leftTime = leftDate instanceof Date && !Number.isNaN(leftDate.getTime()) ? leftDate.getTime() : 0;
            const rightTime = rightDate instanceof Date && !Number.isNaN(rightDate.getTime()) ? rightDate.getTime() : 0;
            return leftTime - rightTime;
        });

    if (!autoCharges.length) return;

    const customers = await readCustomers(branchId);
    const customerIndex = customers.findIndex((customer) => String(customer?.accountNumber || '') === String(accountNumber));
    if (customerIndex < 0) return;

    let nextCustomer = customers[customerIndex];
    if (isPrepaidCustomer(nextCustomer)) return;

    autoCharges.forEach((entry) => {
        const deletedBillDate = parseDateOnly(entry?.date) || parseDateTimeValue(entry?.recordedAt);
        const currentBillDate = parseDateOnly(nextCustomer?.billDate);
        if (!deletedBillDate) return;
        if (currentBillDate && currentBillDate.getTime() > deletedBillDate.getTime()) return;

        const nextBillDate = advanceMonthlyCycleDate(deletedBillDate, 1);
        if (!nextBillDate) return;

        const offset = deriveOffset(nextCustomer);
        let nextDueDate = nextCustomer?.dueDate || null;
        if (offset != null) {
            const dueDate = new Date(nextBillDate.getTime());
            dueDate.setDate(dueDate.getDate() + offset);
            nextDueDate = formatDateOnly(dueDate) || null;
        }

        nextCustomer = {
            ...nextCustomer,
            billDate: formatDateOnly(nextBillDate) || null,
            dueDate: nextDueDate
        };
    });

    customers[customerIndex] = nextCustomer;
    await writeCustomers([nextCustomer], nextCustomer.branchId || branchId);
};

const deletePaymentEntriesForAccount = async (accountNumber, entryIds, branchId) => {
    const normalizedAccountNumber = String(accountNumber || '').trim();
    const normalizedEntryIds = normalizeEntryIds(entryIds);
    if (!normalizedAccountNumber) {
        throw createError(400, 'Account number is required.');
    }
    if (!normalizedEntryIds.length) {
        throw createError(400, 'Select at least one transaction to delete.');
    }

    let deletedEntries = [];

    if (await isRelationalReady()) {
        if (!branchId) {
            throw createError(400, 'Branch assignment missing for this admin account.');
        }

        await withTransaction(async (connection) => {
            const placeholders = normalizedEntryIds.map(() => '?').join(', ');
            const selectParams = [normalizedAccountNumber, branchId, ...normalizedEntryIds];
            const [rows] = await connection.query(
                `SELECT
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
                   AND branch_id = ?
                   AND id IN (${placeholders})
                 ORDER BY recorded_at DESC, id DESC`,
                selectParams
            );
            deletedEntries = (rows || []).map(mapPaymentRow);
            if (!deletedEntries.length) {
                throw createError(404, normalizedEntryIds.length === 1 ? 'Payment entry not found' : 'Payment entries not found');
            }

            const deleteParams = [normalizedAccountNumber, branchId, ...normalizedEntryIds];
            const [result] = await connection.query(
                `DELETE FROM payment_entries
                 WHERE account_number = ?
                   AND branch_id = ?
                   AND id IN (${placeholders})`,
                deleteParams
            );
            if (!result || !result.affectedRows) {
                throw createError(404, normalizedEntryIds.length === 1 ? 'Payment entry not found' : 'Payment entries not found');
            }
        });
    } else {
        const payments = await readPayments(branchId);
        const history = Array.isArray(payments?.[normalizedAccountNumber]?.history)
            ? payments[normalizedAccountNumber].history
            : null;

        if (!history) {
            throw createError(404, 'Account or history not found');
        }

        const selectedIds = new Set(normalizedEntryIds);
        deletedEntries = history.filter((entry) => selectedIds.has(String(entry?.id || '').trim()));
        if (!deletedEntries.length) {
            throw createError(404, normalizedEntryIds.length === 1 ? 'Payment entry not found' : 'Payment entries not found');
        }

        payments[normalizedAccountNumber].history = history.filter((entry) => !selectedIds.has(String(entry?.id || '').trim()));
        await writePayments(payments);
    }

    await reconcileCustomerCycleAfterDeletedCharges(normalizedAccountNumber, branchId, deletedEntries);

    return {
        deletedEntries,
        deletedCount: deletedEntries.length
    };
};

const deriveCreditLimit = (customer) => {
    const raw = Number(customer?.creditLimit);
    const planAmt = Number(customer?.planAmount) || 0;
    if (Number.isFinite(raw) && raw >= 0) return raw;
    return planAmt > 0 ? planAmt : 0;
};
const hasAssignedPlan = (customer) => Boolean(String(customer?.planName || '').trim());

const isPrepaidCustomer = (customer) => {
    const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
    if (explicit === 'prepaid') return true;
    if (explicit === 'postpaid') return false;
    const billing = String(customer?.planBilling || '').trim().toLowerCase();
    if (billing.includes('prepaid')) return true;
    if (billing.includes('postpaid')) return false;
    return false;
};

const normalizePlanNameKey = (value) => String(value || '').trim().toLowerCase();
const findPrepaidPlanByHint = (plans = [], planId = '', planName = '') => {
    const idHint = String(planId || '').trim().toLowerCase();
    const nameHint = normalizePlanNameKey(planName);
    if (!idHint && !nameHint) return null;
    return (Array.isArray(plans) ? plans : []).find((entry) => {
        const category = String(entry?.category || '').trim().toLowerCase();
        if (category && category !== 'prepaid') return false;
        const id = String(entry?.id || '').trim().toLowerCase();
        const name = normalizePlanNameKey(entry?.name);
        return (idHint && id === idHint) || (nameHint && name === nameHint);
    }) || null;
};
const resolvePrepaidChargeAmount = ({ customer = {}, plans = [], planId = '', planName = '' } = {}) => {
    const explicitPlanId = String(planId || '').trim();
    const explicitPlanName = String(planName || '').trim();
    const hasExplicitSelection = Boolean(explicitPlanId || explicitPlanName);

    let selectedPlan = findPrepaidPlanByHint(plans, explicitPlanId, explicitPlanName);
    if (!selectedPlan) {
        selectedPlan = findPrepaidPlanByHint(plans, customer?.planId, customer?.planName);
    }
    if (hasExplicitSelection && !selectedPlan) {
        throw createError(404, 'Prepaid plan not found.');
    }

    const amountCandidates = [Number(selectedPlan?.price), Number(customer?.planAmount)];
    const amount = amountCandidates.find((value) => Number.isFinite(value) && value > 0) || 0;
    if (!amount) {
        throw createError(400, 'Prepaid plan has no payable amount.');
    }
    return { amount, selectedPlan };
};

const enablePppoeForCustomer = async (customer, branchId = null) => {
    const username = String(customer?.pppoeUsername || '').trim();
    if (!username) return;
    try {
        const settings = await loadIntegrationSettings(branchId);
        const routerId = resolveCustomerRouterId(customer, settings);
        const router = resolveMikrotikRouter(settings, routerId);
        if (router?.enabled === false) return;
        const creds = normalizeCredentials(router || {});
        if (!creds.address || !creds.username || !creds.password) return;

        const { client, api } = await connectMikrotik(creds);
        const secretMenu = api.menu('/ppp secret');

        // Try direct name match; fallback to case-insensitive search
        try {
            await auditMikrotikPppoeCommand({
                branchId,
                source: 'payment-reenable',
                routerId,
                username,
                operation: 'update',
                selector: `name=${username}`,
                payload: { disabled: 'false' },
                reason: 'payment-balance-clear'
            });
            await secretMenu.where('name', username).update({ disabled: 'false' });
        } catch (_e) {
            const list = await secretMenu.get().catch(() => []);
            const match = Array.isArray(list)
                ? list.find((s) => String(s.name || s.user || '').trim().toLowerCase() === username.toLowerCase())
                : null;
            if (match) {
                await auditMikrotikPppoeCommand({
                    branchId,
                    source: 'payment-reenable',
                    routerId,
                    username: match.name || match.user || username,
                    secretId: match['.id'] || match.id || '',
                    operation: 'update',
                    selector: `name=${match.name || match.user || username}`,
                    payload: { disabled: 'false' },
                    reason: 'payment-balance-clear-fallback'
                });
                await secretMenu.where('name', match.name || match.user || username).update({ disabled: 'false' });
            }
        }

        // Refresh accounts cache in integration settings
        const secrets = await secretMenu.get().catch(() => []);
        const activeSessions = await api.menu('/ppp active').get().catch(() => []);
        const accounts = buildPppoeAccounts(secrets, activeSessions);
        const mergedAccounts = mergeAccountsForRouter(settings, routerId || router?.id || '', accounts);
        const nextSettings = { ...settings, pppoe: { ...(settings?.pppoe || {}), accounts: mergedAccounts } };
        await saveIntegrationSettings(nextSettings, branchId);

        await client.close().catch(() => {});
    } catch (err) {
        console.warn('Failed to enable PPPoE for customer', customer?.accountNumber, err?.message || err);
    }
};

const applyReenableOnPaid = async (accountNumber, branchId = null, paymentsCache = null) => {
    const payments = paymentsCache || await readPayments(branchId);
    const balance = computeBalance(payments?.[accountNumber]?.history);
    const customers = await readCustomers(branchId);
    const idx = customers.findIndex((c) => c.accountNumber === accountNumber);
    if (idx < 0) return;
    const current = customers[idx];
    const currentStatus = resolveCustomerStatusState(current);
    if (currentStatus.status === STATUS_DISABLED) {
        // Disabled is admin lock: never auto-reactivate from payments.
        return;
    }
    if (!isPrepaidCustomer(current) && !hasAssignedPlan(current)) {
        customers[idx] = { ...current, status: STATUS_INACTIVE, statusMode: STATUS_MODE_AUTO };
        if (await isRelationalReady()) {
            await writeCustomers([customers[idx]], current.branchId || branchId);
        } else {
            await writeCustomers(customers, branchId);
        }
        return;
    }
    if (isPrepaidCustomer(current)) {
        customers[idx] = { ...current, status: STATUS_ACTIVE, statusMode: STATUS_MODE_AUTO };
        if (await isRelationalReady()) {
            await writeCustomers([customers[idx]], current.branchId || branchId);
        } else {
            await writeCustomers(customers, branchId);
        }
        await enablePppoeForCustomer(customers[idx], current.branchId || branchId);
        return;
    }
    const creditLimit = deriveCreditLimit(current);
    if (balance > creditLimit) return; // still over limit
    const nextCustomer = {
        ...current,
        status: STATUS_ACTIVE,
        statusMode: STATUS_MODE_AUTO
    };
    const shouldPersist = currentStatus.status !== STATUS_ACTIVE;
    customers[idx] = nextCustomer;
    if (shouldPersist) {
        if (await isRelationalReady()) {
            await writeCustomers([customers[idx]], current.branchId || branchId);
        } else {
            await writeCustomers(customers, branchId);
        }
    }
    await enablePppoeForCustomer(nextCustomer, current.branchId || branchId);
};

async function maybeAdvanceCustomerDueDate(accountNumber, paymentEntry, branchId = null) {
    const creditKinds = new Set(['payment', 'rebate', 'discount']);
    const amount = Number(paymentEntry.amount);
    if (!creditKinds.has(paymentEntry.kind) || !Number.isFinite(amount) || amount <= 0) return;
    const customers = await readCustomers(branchId);
    const idx = customers.findIndex((c) => c.accountNumber === accountNumber);
    if (idx < 0) return;
    const current = customers[idx];
    const nextDue = advanceDueDate(current.dueDate);
    if (!nextDue) return;
    customers[idx] = { ...current, dueDate: nextDue };
    if (await isRelationalReady()) {
        await writeCustomers([customers[idx]], current.branchId || branchId);
    } else {
        await writeCustomers(customers, branchId);
    }
}

// GET /api/payments - Get all payment records
router.get('/', async (req, res, next) => {
    try {
        const payments = await readPayments(req.user?.branchId || null);
        res.json(payments);
    } catch (error) {
        next(createError(500, 'Failed to retrieve payment records.'));
    }
});

// POST /api/payments/backup - Save a local backup of payment records
router.post('/backup', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const payments = await readPayments(branchId);
        const backup = await createPaymentRecordsBackup(payments, {
            branchId,
            user,
            reason: 'manual-payment-history-backup'
        });
        res.json({ ok: true, backup });
    } catch (error) {
        next(error.status ? error : createError(500, 'Failed to back up payment records.'));
    }
});

// DELETE /api/payments/clear - Back up, then clear payment records
router.delete('/clear', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const payments = await readPayments(branchId);
        const backup = await createPaymentRecordsBackup(payments, {
            branchId,
            user,
            reason: 'before-clear-payment-history'
        });
        const removedCount = countPaymentEntries(payments);
        const relational = await isRelationalReady();

        if (relational) {
            if (!branchId) {
                throw createError(400, 'Branch is required to clear relational payment records.');
            }
            await withTransaction(async (connection) => {
                await connection.query('DELETE FROM payment_entries WHERE branch_id = ?', [branchId]);
            });
        } else {
            await writePayments({});
        }

        triggerBranchServiceRefresh(branchId, 'payments-clear');
        res.json({ ok: true, removedCount, backup });
    } catch (error) {
        next(error.status ? error : createError(500, 'Failed to clear payment records.'));
    }
});

// GET /api/payments/:accountNumber - Get payment history for one account
router.get('/:accountNumber', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        const payments = await readPayments(branchId);
        const accountHistory = payments[req.params.accountNumber] || { history: [] };
        res.json(accountHistory);
    } catch (error) {
        next(createError(500, 'Failed to retrieve account history.'));
    }
});

// POST /api/payments/:accountNumber - Add a payment entry to an account's history
router.post('/:accountNumber', async (req, res, next) => {
    try {
        const { accountNumber } = req.params;
        const paymentEntry = req.body;
        const allowedKinds = new Set(['payment', 'rebate', 'discount', 'charge']);
        const requestedKind = typeof paymentEntry.kind === 'string' ? paymentEntry.kind.toLowerCase().trim() : 'payment';
        const amountValue = Number(paymentEntry?.amount);

        // Ensure 'kind' is one of the allowed values, default to 'payment' if not.
        const kind = allowedKinds.has(requestedKind) ? requestedKind : 'payment';
        const direction = (kind === 'charge') ? 'debit' : 'credit';
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return next(createError(400, 'Amount must be greater than 0.'));
        }

        const sessionUser = req.user || await getUserFromSession(req);
        if (!sessionUser) {
            return next(createError(401, 'Unauthorized'));
        }
        const branchId = sessionUser.branchId || null;
        if (!branchId) {
            return next(createError(400, 'Branch assignment missing for this admin account.'));
        }

        const recorder = {
            id: String(sessionUser.id || ''),
            username: sessionUser.username || sessionUser.name || null,
            name: sessionUser.name || sessionUser.username || null,
            role: sessionUser.role || null
        };
        const recorderLabel = recorder.name || recorder.username || null;

        const customers = await readCustomers(branchId);
        const currentCustomer = customers.find((c) => String(c.accountNumber) === String(accountNumber));
        if (!currentCustomer) {
            return next(createError(404, 'Customer not found'));
        }
        const isPrepaid = currentCustomer ? isPrepaidCustomer(currentCustomer) : false;

        let providedReference = '';
        try {
            providedReference = sanitizeReferenceInput(paymentEntry.reference);
        } catch (err) {
            return next(err);
        }

        const isCollectorRecorder = accountHasRole(recorder, 'Collector');
        if (isCollectorRecorder && kind === 'payment' && !providedReference) {
            return next(createError(400, REFERENCE_REQUIRED_FOR_COLLECTOR_ERROR));
        }

        const relational = await isRelationalReady();
        let payments = null;
        let history = [];
        let fallbackReference = '';
        if (relational) {
            history = await readPaymentsForAccount(accountNumber, branchId);
        } else {
            payments = await readPayments(branchId);
            if (!payments[accountNumber]) {
                payments[accountNumber] = { history: [] };
            }
            history = payments[accountNumber].history || [];
            const usedRefs = collectUsedRefs(payments, accountNumber);
            const usedReferenceTokens = collectUsedReferenceTokens(history);
            try {
                fallbackReference = normalizeIncomingReference(providedReference, usedRefs);
                if (usedReferenceTokens.has(fallbackReference.toLowerCase())) {
                    return next(createError(409, 'Reference already exists for this account.'));
                }
            } catch (err) {
                return next(err);
            }
        }
        const description = sanitizeString(paymentEntry.description);

        // Add a unique ID, timestamp, and who recorded the payment (from auth)
        const entryStamp = Date.now();
        const now = Date.now();
        const recentDuplicate = history.find((entry) => {
            const recordedAt = parseDateTimeValue(entry.recordedAt || entry.date)?.getTime() || 0;
            return (
                entry.recordedBy?.username === recorder.username &&
                entry.kind === kind &&
                Math.abs(Number(entry.amount) - Number(paymentEntry.amount)) === 0 &&
                Math.abs(recordedAt - now) <= 10000
            );
        });
        if (recentDuplicate) {
            return next(createError(409, 'Payment already recorded.'));
        }
        const newEntry = {
            id: `pay-${accountNumber}-${entryStamp}`,
            ...paymentEntry,
            amount: amountValue,
            kind,
            type: kind,
            direction,
            reference: relational ? (providedReference || undefined) : fallbackReference,
            description: description || undefined,
            recordedAt: resolveRecordedAtValue(paymentEntry.recordedAt, paymentEntry.date),
            recordedBy: recorder,
            payer: recorderLabel || paymentEntry.payer || null
        };

        const shouldAutoCharge = isPrepaid && kind === 'payment';
        const chargeEntry = shouldAutoCharge ? {
            id: `charge-${accountNumber}-${entryStamp}`,
            amount: amountValue,
            date: paymentEntry.date,
            kind: 'charge',
            reference: undefined,
            description: 'Prepaid renewal charge',
            type: 'charge',
            direction: 'debit',
            recordedAt: newEntry.recordedAt,
            recordedBy: recorder,
            payer: newEntry.payer
        } : null;

        if (relational) {
            await withTransaction(async (connection) => {
                await assignEntryNumbers(connection, newEntry);
                await assertEntryNumbersAvailable(connection, branchId, newEntry);

                const newEntryFingerprint = `${accountNumber}|${newEntry.reference}|${kind}|${(Math.abs(Number(paymentEntry.amount) || 0)).toFixed(2)}`;
                newEntry.fingerprint = newEntryFingerprint;
                if (await hasPaymentFingerprint(branchId, accountNumber, newEntryFingerprint, connection)) {
                    throw createError(409, 'Payment already recorded (duplicate request).');
                }
                await insertPaymentEntry(newEntry, branchId, accountNumber, connection);

                if (chargeEntry) {
                    await assignEntryNumbers(connection, chargeEntry);
                    await assertEntryNumbersAvailable(connection, branchId, chargeEntry);
                    const chargeFingerprint = `${accountNumber}|${chargeEntry.reference}|charge|${(Math.abs(Number(chargeEntry.amount) || 0)).toFixed(2)}`;
                    chargeEntry.fingerprint = chargeFingerprint;
                    if (await hasPaymentFingerprint(branchId, accountNumber, chargeFingerprint, connection)) {
                        throw createError(409, 'Payment already recorded (duplicate request).');
                    }
                    await insertPaymentEntry(chargeEntry, branchId, accountNumber, connection);
                }
            });
        } else {
            const fallbackFingerprint = `${accountNumber}|${newEntry.reference}|${kind}|${(Math.abs(Number(paymentEntry.amount) || 0)).toFixed(2)}`;
            const duplicate = history.find((entry) => entry.fingerprint === fallbackFingerprint);
            if (duplicate) {
                return next(createError(409, 'Payment already recorded (duplicate request).'));
            }
            newEntry.fingerprint = fallbackFingerprint;
            if (chargeEntry) {
                chargeEntry.fingerprint = `${accountNumber}|${chargeEntry.reference || ''}|charge|${(Math.abs(Number(chargeEntry.amount) || 0)).toFixed(2)}`;
                payments[accountNumber].history.unshift(newEntry, chargeEntry);
            } else {
                payments[accountNumber].history.unshift(newEntry);
            }
            await writePayments(payments);
        }
        if (isPositiveCreditEntry(newEntry)) {
            await applyReenableOnPaid(accountNumber, branchId, payments);
        }
        await maybeExtendPrepaidExpiryOnPayment(accountNumber, newEntry, branchId);
        triggerBranchServiceRefresh(branchId, 'payments-manual');
        res.status(201).json(newEntry);
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to add payment entry.'));
    }
});

// POST /api/payments/:accountNumber/bulk-delete - Delete multiple history entries for one account
router.post('/:accountNumber/bulk-delete', async (req, res, next) => {
    try {
        const { accountNumber } = req.params;
        const branchId = req.user?.branchId || null;
        const entryIds = normalizeEntryIds(req.body?.entryIds);
        const result = await deletePaymentEntriesForAccount(accountNumber, entryIds, branchId);
        triggerBranchServiceRefresh(branchId, 'payments-delete-bulk');
        res.status(200).json({
            success: true,
            deletedCount: result.deletedCount,
            deletedEntryIds: result.deletedEntries.map((entry) => entry.id).filter(Boolean)
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to delete payment entries.'));
    }
});

// DELETE /api/payments/:accountNumber/:entryId - Delete a specific entry from history
router.delete('/:accountNumber/:entryId', async (req, res, next) => {
    try {
        const { accountNumber, entryId } = req.params;
        const branchId = req.user?.branchId || null;
        await deletePaymentEntriesForAccount(accountNumber, [entryId], branchId);
        triggerBranchServiceRefresh(branchId, 'payments-delete');
        res.status(204).send(); // No Content
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to delete payment entry.'));
    }
});

// POST /api/payments/:accountNumber/xendit/link - create Xendit invoice/link for a customer
router.post('/:accountNumber/xendit/link', async (req, res, next) => {
    try {
        const { accountNumber } = req.params;
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return next(createError(400, 'Branch assignment missing for this admin account.'));
        }
        const settings = await loadIntegrationSettings(branchId);
        const apiKey = sanitizeString(settings?.xendit?.apiKey);
        if (!apiKey) {
            return next(createError(400, 'Xendit API key not configured.'));
        }

        const customers = await readCustomers(branchId);
        const customer = customers.find((c) => String(c.accountNumber) === String(accountNumber));
        if (!customer) return next(createError(404, 'Customer not found.'));

        const plans = await readPlans(branchId);
        const planCategory = typeof customersModule.resolvePlanCategory === 'function'
            ? customersModule.resolvePlanCategory(customer, plans)
            : (isPrepaidCustomer(customer) ? 'prepaid' : 'postpaid');
        const paymentMode = planCategory === 'prepaid' ? 'prepaid' : 'postpaid';
        const relational = await isRelationalReady();
        const payments = relational ? null : await readPayments(branchId);

        let amount = 0;
        let selectedPlan = null;
        if (paymentMode === 'prepaid') {
            const resolved = resolvePrepaidChargeAmount({
                customer,
                plans,
                planId: req.body?.planId,
                planName: req.body?.planName
            });
            amount = resolved.amount;
            selectedPlan = resolved.selectedPlan;
        } else {
            const history = relational
                ? await readPaymentsForAccount(accountNumber, branchId)
                : payments?.[accountNumber]?.history || [];
            const outstanding = Math.max(computeBalance(history), 0);
            const requestedAmount = Number(req.body?.amount);
            amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : outstanding;
            if (!amount || amount <= 0) return next(createError(400, 'No payable amount found for this customer.'));
        }

        // Auto-generate description if missing
        const now = new Date();
        const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const prepaidPlanLabel = sanitizeString(selectedPlan?.name || customer?.planName || '');
        const description =
            sanitizeString(req.body?.description) ||
            (
                paymentMode === 'prepaid'
                    ? `Prepaid renewal for account ${accountNumber}${prepaidPlanLabel ? ` - ${prepaidPlanLabel}` : ''}`
                    : `Payment for account ${accountNumber} - ${monthLabel}`
            );
        // External id should be unique; reuse our 12-digit ref generator to reduce collisions
        let reference;
        try {
            const usedRefs = relational
                ? await collectUsedRefsFromDb(branchId, accountNumber)
                : collectUsedRefs(payments, accountNumber);
            reference = normalizeIncomingReference(null, usedRefs);
        } catch (_e) {
            reference = `inv${Date.now()}`; // fallback
        }
        const externalId = `acct-${accountNumber}-${reference}`;
        const successRedirectUrl = buildXenditRedirectUrl(req, {
            provided: req.body?.successRedirectUrl,
            status: 'paid',
            receipt: {
                accountNumber,
                reference,
                amount,
                method: 'xendit',
                description,
                paymentMode
            }
        });
        const failureRedirectUrl = buildXenditRedirectUrl(req, {
            provided: req.body?.failureRedirectUrl,
            status: 'failed'
        });

        const payload = {
            external_id: externalId,
            amount,
            payer_email: sanitizeString(customer.email) || undefined,
            description,
            success_redirect_url: successRedirectUrl,
            failure_redirect_url: failureRedirectUrl,
            currency: 'PHP'
        };

        const invoice = await callXenditInvoice(apiKey, payload);
        return res.json({
            ok: true,
            amount,
            paymentMode,
            planName: prepaidPlanLabel || undefined,
            invoiceUrl: invoice.invoice_url,
            invoice,
            redirects: { success: successRedirectUrl, failure: failureRedirectUrl }
        });
    } catch (error) {
        if (error?.status && error?.status >= 400 && error?.status < 500) {
            return next(error);
        }
        return next(createError(502, error?.message || 'Failed to create Xendit payment link.'));
    }
});

// POST /api/payments/:accountNumber/xendit/gcash - create direct eWallet charge link (default: GCash)
router.post('/:accountNumber/xendit/gcash', async (req, res, next) => {
    try {
        const { accountNumber } = req.params;
        const branchId = req.user?.branchId || null;
        if (!branchId) {
            return next(createError(400, 'Branch assignment missing for this admin account.'));
        }
        const settings = await loadIntegrationSettings(branchId);
        const apiKey = sanitizeString(settings?.xendit?.apiKey);
        if (!apiKey) {
            return next(createError(400, 'Xendit API key not configured.'));
        }

        const customers = await readCustomers(branchId);
        const customer = customers.find((c) => String(c.accountNumber) === String(accountNumber));
        if (!customer) return next(createError(404, 'Customer not found.'));

        const plans = await readPlans(branchId);
        const planCategory = typeof customersModule.resolvePlanCategory === 'function'
            ? customersModule.resolvePlanCategory(customer, plans)
            : (isPrepaidCustomer(customer) ? 'prepaid' : 'postpaid');
        const paymentMode = planCategory === 'prepaid' ? 'prepaid' : 'postpaid';
        const relational = await isRelationalReady();
        const payments = relational ? null : await readPayments(branchId);

        let amount = 0;
        let selectedPlan = null;
        if (paymentMode === 'prepaid') {
            const resolved = resolvePrepaidChargeAmount({
                customer,
                plans,
                planId: req.body?.planId,
                planName: req.body?.planName
            });
            amount = resolved.amount;
            selectedPlan = resolved.selectedPlan;
        } else {
            const history = relational
                ? await readPaymentsForAccount(accountNumber, branchId)
                : payments?.[accountNumber]?.history || [];
            const outstanding = Math.max(computeBalance(history), 0);
            const requestedAmount = Number(req.body?.amount);
            amount = Number.isFinite(requestedAmount) && requestedAmount > 0 ? requestedAmount : outstanding;
            if (!amount || amount <= 0) return next(createError(400, 'No payable amount found for this customer.'));
        }

        const now = new Date();
        const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const prepaidPlanLabel = sanitizeString(selectedPlan?.name || customer?.planName || '');
        const description =
            sanitizeString(req.body?.description) ||
            (
                paymentMode === 'prepaid'
                    ? `Prepaid renewal for account ${accountNumber}${prepaidPlanLabel ? ` - ${prepaidPlanLabel}` : ''}`
                    : `Payment for account ${accountNumber} - ${monthLabel}`
            );
        const customerPhone = (() => {
            const raw = sanitizeString(customer.mobileRaw || customer.mobile || '');
            // Expect E.164: +63xxxxxxxxxx; fallback to PH if 10/11 digits
            const digits = raw.replace(/\D+/g, '');
            if (raw.startsWith('+') && /^\+\d{8,15}$/.test(raw)) return raw;
            if (/^63\d{9,12}$/.test(digits)) return `+${digits}`;
            if (/^0\d{9,10}$/.test(digits)) return `+63${digits.slice(1)}`;
            return undefined;
        })();

        const methodRaw = String(req.body?.method || 'gcash').toLowerCase();
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

        let reference;
        try {
            const usedRefs = relational
                ? await collectUsedRefsFromDb(branchId, accountNumber)
                : collectUsedRefs(payments, accountNumber);
            reference = normalizeIncomingReference(null, usedRefs);
        } catch (_e) {
            reference = `gcash${Date.now()}`;
        }
        const referenceId = `acct-${accountNumber}-${reference}`;
        const successRedirectUrl = buildXenditRedirectUrl(req, {
            provided: req.body?.successRedirectUrl,
            status: 'paid',
            receipt: {
                accountNumber,
                reference,
                amount,
                method: methodRaw,
                description,
                paymentMode
            }
        });
        const failureRedirectUrl = buildXenditRedirectUrl(req, {
            provided: req.body?.failureRedirectUrl,
            status: 'failed'
        });

        // For GCash use direct charge; for others, fall back to invoice with specific method to avoid provider errors
        if (channel_code === 'PH_GCASH') {
            const payload = {
                reference_id: referenceId,
                amount,
                currency: 'PHP',
                channel_code,
                checkout_method: 'ONE_TIME_PAYMENT',
                channel_properties: {
                    success_redirect_url: successRedirectUrl,
                    failure_redirect_url: failureRedirectUrl,
                    cancel_redirect_url: failureRedirectUrl,
                    mobile_number: customerPhone
                },
                customer: {
                    given_names: customer.name || customer.username || 'Customer',
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
                charge,
                method: methodRaw,
                amount,
                paymentMode,
                planName: prepaidPlanLabel || undefined,
                redirects: { success: successRedirectUrl, failure: failureRedirectUrl }
            });
        }

        // Non-GCash: use invoice with constrained payment method
        const invoiceMethod = invoiceMap[methodRaw];
        const invoicePayload = {
            external_id: referenceId,
            amount,
            payer_email: sanitizeString(customer.email) || undefined,
            description,
            success_redirect_url: successRedirectUrl,
            failure_redirect_url: failureRedirectUrl,
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
            invoice,
            method: methodRaw,
            amount,
            paymentMode,
            planName: prepaidPlanLabel || undefined,
            redirects: { success: successRedirectUrl, failure: failureRedirectUrl }
        });
    } catch (error) {
        if (error?.status && error?.status >= 400 && error?.status < 500) {
            return next(error);
        }
        return next(createError(502, error?.message || 'Failed to create GCash payment link.'));
    }
});

const handleXenditWebhook = async (req, res, next) => {
    try {
        const callbackToken = getXenditCallbackToken(req);
        const signature = getXenditSignature(req);
        if (!callbackToken && !signature) {
            return res.status(400).json({ ok: false, error: 'Missing Xendit verification header' });
        }

        const incoming = req.body || {};
        const payload = incoming && typeof incoming === 'object' && incoming.data && typeof incoming.data === 'object'
            ? incoming.data
            : incoming;
        const status = String(payload.status || incoming.status || '').toUpperCase();
        if (!XENDIT_SUCCESS_STATUSES.has(status)) {
            return res.json({ ok: true, skipped: true, status });
        }

        const accountNumber =
            extractAccountNumberFromXenditIdentifier(payload.external_id) ||
            extractAccountNumberFromXenditIdentifier(payload.reference_id) ||
            extractAccountNumberFromXenditIdentifier(payload.reference) ||
            extractAccountNumberFromXenditIdentifier(incoming.external_id) ||
            extractAccountNumberFromXenditIdentifier(incoming.reference_id) ||
            extractAccountNumberFromXenditIdentifier(incoming.reference);
        if (!accountNumber) {
            return res.status(400).json({ ok: false, error: 'Account number missing in payload' });
        }
        const relational = await isRelationalReady();
        let branchId = null;
        if (relational) {
            const [rows] = await query('SELECT branch_id FROM customers WHERE account_number = ? LIMIT 1', [accountNumber]);
            branchId = rows && rows.length ? rows[0].branch_id : null;
            if (!branchId) {
                return res.status(404).json({ ok: false, error: `Customer not found for account number: ${accountNumber}` });
            }
        }

        const settings = await loadIntegrationSettings(branchId);
        const webhookSecret = sanitizeString(settings?.xendit?.webhookSecret);
        if (!webhookSecret) {
            return res.status(400).json({ ok: false, error: 'Webhook secret is not configured' });
        }

        if (callbackToken) {
            const providedToken = String(callbackToken || '').trim();
            const expectedToken = String(webhookSecret || '').trim();
            const providedBuf = Buffer.from(providedToken);
            const expectedBuf = Buffer.from(expectedToken);
            const tokenOk = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
            if (!tokenOk) {
                return res.status(403).json({ ok: false, error: 'Invalid webhook callback token' });
            }
        } else {
            const rawBody = getRawBody(req);
            const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
            const provided = String(signature || '').trim().toLowerCase();
            const expected = String(expectedSignature || '').trim().toLowerCase();
            const providedBuf = Buffer.from(provided);
            const expectedBuf = Buffer.from(expected);
            const sigOk = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
            if (!sigOk) {
                return res.status(403).json({ ok: false, error: 'Invalid webhook signature' });
            }
        }

        const amount = Number(
            payload.amount ??
                payload.total_amount ??
                payload.paid_amount ??
                payload.grand_total ??
                payload.price ??
                payload.charge_amount ??
                payload.capture_amount ??
                incoming.amount ??
                incoming.total_amount ??
                incoming.paid_amount ??
                incoming.charge_amount ??
                incoming.capture_amount
        );
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: 'Invalid payment amount' });
        }

        if (relational) {
            const [rows] = await query(
                `SELECT id FROM payment_entries WHERE xendit_id = ? LIMIT 1`,
                [payload.id ? String(payload.id) : '']
            );
            if (rows && rows.length) {
                return res.json({ ok: true, skipped: true, reason: 'already recorded' });
            }
        } else {
            const payments = await readPayments();
            if (!payments[accountNumber]) {
                payments[accountNumber] = { history: [] };
            }

            const alreadySaved = payments[accountNumber].history.some(
                (entry) => entry.xenditId && String(entry.xenditId) === String(payload.id)
            );
            if (alreadySaved) {
                return res.json({ ok: true, skipped: true, reason: 'already recorded' });
            }
        }

        const recordedAt = payload.paid_at || payload.status_date || payload.updated_at || new Date().toISOString();
        const xenditReferenceRaw =
            payload.reference_id ||
            payload.reference ||
            payload.external_id ||
            incoming.reference_id ||
            incoming.reference ||
            incoming.external_id;
        let xenditReference = extractDisplayReferenceFromXenditIdentifier(xenditReferenceRaw);
        if (xenditReference.length > REF_MAX_LENGTH) {
            xenditReference = xenditReference.slice(0, REF_MAX_LENGTH);
        }
        const entry = {
            id: `xendit-${payload.id || Date.now()}`,
            amount,
            date: recordedAt,
            kind: 'payment',
            direction: 'credit',
            reference: xenditReference || undefined,
            description:
                payload.description || `Xendit ${payload.payment_method || payload.payment_channel || 'payment'}`,
            recordedAt,
            recordedBy: {
                id: 'xendit',
                username: 'Xendit',
                name: 'Xendit',
                role: 'System'
            },
            payer: payload.paid_by || payload.customer?.given_names || payload.customer?.name || 'Xendit',
            status,
            paymentMethod: payload.payment_method || payload.payment_channel,
            xenditId: payload.id ? String(payload.id) : undefined
        };

        const customersForAccount = await readCustomers(branchId);
        const currentCustomer = customersForAccount.find((customer) => (
            String(customer?.accountNumber || '') === String(accountNumber)
        ));
        const shouldAutoCharge = currentCustomer ? isPrepaidCustomer(currentCustomer) : false;
        const chargeEntry = shouldAutoCharge ? {
            id: `charge-${accountNumber}-${payload.id || Date.now()}`,
            amount,
            date: recordedAt,
            kind: 'charge',
            reference: undefined,
            description: 'Prepaid renewal charge',
            type: 'charge',
            direction: 'debit',
            recordedAt,
            recordedBy: entry.recordedBy,
            payer: entry.payer,
            status,
            paymentMethod: entry.paymentMethod
        } : null;
        if (relational) {
            try {
                await withTransaction(async (connection) => {
                    await assignEntryNumbers(connection, entry);
                    await assertEntryNumbersAvailable(connection, branchId, entry);
                    await insertPaymentEntry(entry, branchId, accountNumber, connection);

                    if (chargeEntry) {
                        await assignEntryNumbers(connection, chargeEntry);
                        await assertEntryNumbersAvailable(connection, branchId, chargeEntry);
                        chargeEntry.fingerprint = `${accountNumber}|${chargeEntry.reference || ''}|charge|${(Math.abs(Number(chargeEntry.amount) || 0)).toFixed(2)}`;
                        if (await hasPaymentFingerprint(branchId, accountNumber, chargeEntry.fingerprint, connection)) {
                            throw createError(409, 'Payment already recorded (duplicate request).');
                        }
                        await insertPaymentEntry(chargeEntry, branchId, accountNumber, connection);
                    }
                });
            } catch (error) {
                if (error?.status === 409) {
                    return res.json({ ok: true, skipped: true, reason: error.message || 'duplicate reference' });
                }
                throw error;
            }
        } else {
            const payments = await readPayments();
            if (!payments[accountNumber]) {
                payments[accountNumber] = { history: [] };
            }
            if (chargeEntry) {
                chargeEntry.fingerprint = `${accountNumber}|${chargeEntry.reference || ''}|charge|${(Math.abs(Number(chargeEntry.amount) || 0)).toFixed(2)}`;
                payments[accountNumber].history.unshift(entry, chargeEntry);
            } else {
                payments[accountNumber].history.unshift(entry);
            }
            await writePayments(payments);
        }
        if (isPositiveCreditEntry(entry)) {
            await applyReenableOnPaid(accountNumber, branchId, relational ? null : await readPayments());
        }
        await maybeExtendPrepaidExpiryOnPayment(accountNumber, entry, branchId);
        triggerBranchServiceRefresh(branchId, 'payments-webhook');

        return res.json({ ok: true, recorded: true, entryId: entry.id });
    } catch (error) {
        next(error);
    }
};

module.exports = router;
module.exports.handleXenditWebhook = handleXenditWebhook;
