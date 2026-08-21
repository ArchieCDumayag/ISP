const express = require('express');
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const createError = require('http-errors');
const crypto = require('crypto');
const https = require('https');
const { connectMikrotikClient } = require('../../network/backend/mikrotik-client');
const { loadIntegrationSettings, saveIntegrationSettings, resolveMikrotikRouter } = require('../../admin/backend/integration-settings');
const { getUserFromSession } = require('../../admin/backend/auth');
const { query } = require('../../../../core/data/db');
const { assignEntryNumbers, assertEntryNumbersAvailable, withTransaction } = require('./payment-numbering');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const customersModule = require('../../customer-management/backend/customers');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const {
    getEffectivePaymentEntries,
    isEffectivePaymentEntryStatus,
    normalizePaymentEntry
} = require('./payment-entry-normalizer');
const { auditMikrotikPppoeCommand } = require('../../network/backend/mikrotik-audit-log');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { DATA_DIR, PROJECT_ROOT } = require('../../../../core/runtime/paths');
const {
    BILLING_POLICY_CONTINUE,
    STATUS_KEPT_ACTIVE,
    getAccountDisconnection,
    readBranchDisconnections,
    upsertBranchDisconnection
} = require('./disconnection-store');
const {
    activatePendingReconnectionSettlement,
    getManilaDateKey,
    getPendingReconnectionSettlement
} = require('./reconnection-settlement');
const {
    listGcashTransactionHistory,
    claimGcashTransactionAllocations,
    finalizeGcashTransactionAllocations,
    releaseGcashTransactionClaim,
    normalizeReference: normalizeGcashReference
} = require('./gcash-transaction-history-store');

const router = express.Router();
const STORE_KEYS = {
    payments: 'payments',
    customers: 'customers',
    paymentImportUnmatched: 'payment_import_unmatched'
};
const PAYMENT_BACKUP_DIR = path.join(DATA_DIR, 'payment-backups');
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
let paymentImportXlsxModule = null;
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

const isCollectedPaymentEntry = (entry = {}) => {
    if (!isPositiveCreditEntry(entry)) return false;
    if (!isEffectivePaymentEntryStatus(entry)) return false;
    const kind = String(entry?.kind || entry?.type || '').trim().toLowerCase();
    return kind === 'payment' || !kind;
};

const PENDING_GCASH_STATUS = 'pending_gcash_verification';
const normalizePaymentStatus = (entry = {}) => String(
    entry?.status || entry?.paymentStatus || entry?.payment_status || ''
).trim().toLowerCase().replace(/[\s-]+/g, '_');
const isPendingGcashPaymentEntry = (entry = {}) => (
    normalizePaymentStatus(entry) === PENDING_GCASH_STATUS
    && String(entry?.kind || entry?.type || '').trim().toLowerCase() === 'payment'
    && String(entry?.paymentMethod || entry?.payment_method || '').trim().toLowerCase() === 'gcash'
    && Number(entry?.amount) > 0
);

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
        const filePath = path.join(PROJECT_ROOT, '.cloudflared', 'config.yml');
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
const GCASH_RECEIVED_AT_AUDIT_RE = /\[GCASH_RECEIVED_AT:([^\]]+)\]/i;
const REFERENCE_REQUIRED_FOR_COLLECTOR_ERROR = 'Reference is required for collector submissions.';
const normalizeGcashReceivedAt = (value) => {
    const raw = String(value || '').trim();
    if (!raw || !hasExplicitTimeValue(raw)) return '';
    const normalized = normalizeDateTimeForRecordedAt(raw);
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? normalized : '';
};
const extractPaymentReceivedAt = (entry = {}) => {
    const explicit = normalizeGcashReceivedAt(
        entry?.paymentReceivedAt
        || entry?.payment_received_at
        || entry?.gcashReceivedAt
    );
    if (explicit) return explicit;
    const token = [entry?.fingerprint, entry?.description]
        .map((value) => String(value || ''))
        .join(' ')
        .match(GCASH_RECEIVED_AT_AUDIT_RE);
    return normalizeGcashReceivedAt(token?.[1]);
};
const appendGcashReceivedAtAudit = (description, paymentReceivedAt, maxLength = 0) => {
    const safeReceivedAt = normalizeGcashReceivedAt(paymentReceivedAt);
    const cleanDescription = String(description || '')
        .replace(GCASH_RECEIVED_AT_AUDIT_RE, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (!safeReceivedAt) return maxLength > 0 ? cleanDescription.slice(0, maxLength) : cleanDescription;
    const token = `[GCASH_RECEIVED_AT:${safeReceivedAt}]`;
    const availableBaseLength = maxLength > 0
        ? Math.max(0, maxLength - token.length - 1)
        : cleanDescription.length;
    return [cleanDescription.slice(0, availableBaseLength), token].filter(Boolean).join(' ');
};
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

const normalizeManualPaymentReferenceKey = (value) => sanitizeReferenceInput(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '');

const normalizeNumericPaymentReferenceKey = (value) => {
    const key = normalizeManualPaymentReferenceKey(value);
    if (!/^\d+$/.test(key)) return '';
    return key.replace(/^0+(?=\d)/, '');
};

const paymentReferencesMatch = (left, right) => {
    const leftKey = normalizeManualPaymentReferenceKey(left);
    const rightKey = normalizeManualPaymentReferenceKey(right);
    if (!leftKey || !rightKey) return false;
    if (leftKey === rightKey) return true;
    const leftNumericKey = normalizeNumericPaymentReferenceKey(leftKey);
    const rightNumericKey = normalizeNumericPaymentReferenceKey(rightKey);
    return Boolean(leftNumericKey && rightNumericKey && leftNumericKey === rightNumericKey);
};

const findManualPaymentReferenceConflict = ({
    reference,
    payments = {},
    paymentEntries = [],
    gcashTransactions = []
} = {}) => {
    const safeReference = sanitizeReferenceInput(reference);
    if (!safeReference) return null;

    const storedEntries = [
        ...Object.entries(payments || {}).flatMap(([accountNumber, record]) => (
            (Array.isArray(record?.history) ? record.history : []).map((entry) => ({ accountNumber, entry }))
        )),
        ...(Array.isArray(paymentEntries) ? paymentEntries : []).map((entry) => ({
            accountNumber: String(entry?.accountNumber || entry?.account_number || ''),
            entry
        }))
    ];
    const paymentConflict = storedEntries.find(({ entry }) => (
        [entry?.reference, entry?.orNumber, entry?.or_number]
            .some((candidate) => paymentReferencesMatch(candidate, safeReference))
    ));
    if (paymentConflict) {
        return {
            source: 'payment_history',
            accountNumber: paymentConflict.accountNumber || null,
            entryId: sanitizeString(paymentConflict.entry?.id) || null,
            message: 'This reference is already used in Payment History or a pending payment.'
        };
    }

    const importedConflict = (Array.isArray(gcashTransactions) ? gcashTransactions : [])
        .find((transaction) => paymentReferencesMatch(transaction?.reference, safeReference));
    if (importedConflict) {
        return {
            source: 'gcash_transaction',
            reference: sanitizeString(importedConflict.reference) || null,
            message: 'This reference already exists in Imported GCash Transactions. Use it from GCash Transactions instead.'
        };
    }
    return null;
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
    paymentReceivedAt: extractPaymentReceivedAt(row) || undefined,
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

const filterPaymentsForEffectiveHistory = (payments = {}) => Object.fromEntries(
    Object.entries(payments || {}).map(([accountNumber, accountData]) => [
        accountNumber,
        {
            ...accountData,
            history: getEffectivePaymentEntries(accountData?.history || [])
        }
    ])
);

const writePayments = async (payments) => {
    await writeJson(STORE_KEYS.payments, payments);
};

const getStoredManualPaymentReferenceConflict = async ({
    branchId,
    reference,
    payments = null,
    executor = null
} = {}) => {
    const safeReference = sanitizeReferenceInput(reference);
    if (!safeReference) return null;

    let paymentEntries = [];
    let paymentRecords = payments && typeof payments === 'object' ? payments : {};
    if (executor || await isRelationalReady()) {
        const runQuery = executor
            ? executor.query.bind(executor)
            : query;
        const [rows] = await runQuery(
            `SELECT
                id,
                account_number AS accountNumber,
                reference,
                or_number AS orNumber
             FROM payment_entries
             WHERE branch_id = ?
               AND (reference IS NOT NULL OR or_number IS NOT NULL)`,
            [branchId]
        );
        paymentEntries = rows || [];
        paymentRecords = {};
    } else if (!payments) {
        paymentRecords = await readPayments(branchId);
    }

    const gcashHistory = await listGcashTransactionHistory({ branchId, all: true });
    return findManualPaymentReferenceConflict({
        reference: safeReference,
        payments: paymentRecords,
        paymentEntries,
        gcashTransactions: gcashHistory?.transactions || []
    });
};

const createManualPaymentReferenceConflictError = (conflict) => {
    const error = createError(409, conflict?.message || 'This payment reference is already used.');
    error.code = 'PAYMENT_REFERENCE_ALREADY_USED';
    error.referenceSource = conflict?.source || 'unknown';
    return error;
};

const assertManualPaymentReferenceAvailable = async (options = {}) => {
    const conflict = await getStoredManualPaymentReferenceConflict(options);
    if (conflict) throw createManualPaymentReferenceConflictError(conflict);
    return true;
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

const PAYMENT_IMPORT_CLIENTS_SHEET_NAME = 'CLIENTS LIST';
const PAYMENT_IMPORT_WARNING_LIMIT = 100;
const PAYMENT_IMPORT_NAME_NOISE = new Set([
    'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april',
    'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept',
    'september', 'oct', 'october', 'nov', 'november', 'dec', 'december',
    'adv', 'advance', 'install', 'installation', 'new', 'payment', 'pay',
    'paid', 'pd', 'balance', 'bal', 'bill', 'billing'
]);
const PAYMENT_IMPORT_MONTH_LOOKUP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
};
const getPaymentImportXlsxModule = () => {
    if (!paymentImportXlsxModule) {
        paymentImportXlsxModule = require('xlsx');
    }
    return paymentImportXlsxModule;
};
const normalizePaymentImportHeaderKey = (value) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const normalizePaymentImportText = (value) => {
    if (value == null) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return paymentImportDateOnlyFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    return String(value).replace(/\s+/g, ' ').trim();
};
const normalizePaymentImportNameKey = (value) => normalizePaymentImportText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const compactPaymentImportNameKey = (value) => normalizePaymentImportNameKey(value).replace(/\s+/g, '');
const paymentImportPad2 = (value) => String(value).padStart(2, '0');
const paymentImportDateOnlyFromParts = (year, month, day) => {
    let normalizedYear = Number(year);
    const normalizedMonth = Number(month);
    const normalizedDay = Number(day);
    if (!normalizedYear || !normalizedMonth || !normalizedDay) return '';
    if (normalizedYear < 100) normalizedYear += normalizedYear >= 70 ? 1900 : 2000;
    const candidate = new Date(normalizedYear, normalizedMonth - 1, normalizedDay);
    if (
        Number.isNaN(candidate.getTime())
        || candidate.getFullYear() !== normalizedYear
        || candidate.getMonth() !== normalizedMonth - 1
        || candidate.getDate() !== normalizedDay
    ) {
        return '';
    }
    return `${normalizedYear}-${paymentImportPad2(normalizedMonth)}-${paymentImportPad2(normalizedDay)}`;
};
const inferPaymentImportYear = (sheetName = '') => {
    const match = String(sheetName || '').match(/\b(20\d{2}|\d{2})\b/);
    if (!match) return new Date().getFullYear();
    const year = Number(match[1]);
    return year < 100 ? 2000 + year : year;
};
const inferPaymentImportMonth = (sheetName = '') => {
    const key = normalizePaymentImportNameKey(sheetName);
    return key.split(' ').map((token) => PAYMENT_IMPORT_MONTH_LOOKUP[token]).find(Boolean) || null;
};
const inferPaymentImportDateFromSheetName = (sheetName = '') => {
    const month = inferPaymentImportMonth(sheetName);
    const year = inferPaymentImportYear(sheetName);
    return month ? paymentImportDateOnlyFromParts(year, month, 1) : '';
};
const parsePaymentImportDateOnly = (rawValue, displayValue = '', fallbackYear = new Date().getFullYear()) => {
    const text = normalizePaymentImportText(displayValue || (!(rawValue instanceof Date) && typeof rawValue !== 'number' ? rawValue : ''));
    if (/^total$/i.test(text)) return '';

    if (text) {
        const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (isoMatch) return paymentImportDateOnlyFromParts(isoMatch[1], isoMatch[2], isoMatch[3]);

        const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (slashMatch) return paymentImportDateOnlyFromParts(slashMatch[3], slashMatch[1], slashMatch[2]);

        const dayMonthNameMatch = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})(?:[-/\s,]+(\d{2,4}))?$/);
        if (dayMonthNameMatch) {
            const month = PAYMENT_IMPORT_MONTH_LOOKUP[String(dayMonthNameMatch[2] || '').toLowerCase()];
            if (month) {
                return paymentImportDateOnlyFromParts(dayMonthNameMatch[3] || fallbackYear, month, dayMonthNameMatch[1]);
            }
        }

        const monthDayNameMatch = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/);
        if (monthDayNameMatch) {
            const month = PAYMENT_IMPORT_MONTH_LOOKUP[String(monthDayNameMatch[1] || '').toLowerCase()];
            if (month) {
                return paymentImportDateOnlyFromParts(monthDayNameMatch[3] || fallbackYear, month, monthDayNameMatch[2]);
            }
        }

        const parsedTime = Date.parse(text);
        if (!Number.isNaN(parsedTime)) {
            const parsed = new Date(parsedTime);
            return paymentImportDateOnlyFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
        }
    }

    if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return paymentImportDateOnlyFromParts(rawValue.getFullYear(), rawValue.getMonth() + 1, rawValue.getDate());
    }

    const xlsx = paymentImportXlsxModule;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue) && xlsx?.SSF?.parse_date_code) {
        const parsed = xlsx.SSF.parse_date_code(rawValue);
        if (parsed?.y && parsed?.m && parsed?.d) {
            return paymentImportDateOnlyFromParts(parsed.y, parsed.m, parsed.d);
        }
    }

    return '';
};
const parsePaymentImportAmount = (rawValue, displayValue = '') => {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        return Number(rawValue.toFixed(2));
    }
    const text = normalizePaymentImportText(displayValue || rawValue);
    if (!text) return 0;
    const negative = /^\(.*\)$/.test(text) || text.includes('-');
    const normalized = text.replace(/[₱,\s]/g, '').replace(/[()]/g, '').replace(/[^0-9.-]/g, '');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return 0;
    return Number((negative ? -Math.abs(amount) : amount).toFixed(2));
};
const paymentImportCell = (xlsx, sheet, row, col) => sheet?.[xlsx.utils.encode_cell({ r: row, c: col })] || null;
const paymentImportCellText = (xlsx, sheet, row, col) => {
    const item = paymentImportCell(xlsx, sheet, row, col);
    return item ? normalizePaymentImportText(item.w ?? item.v ?? '') : '';
};
const paymentImportCellRaw = (xlsx, sheet, row, col) => paymentImportCell(xlsx, sheet, row, col)?.v;
const paymentImportCellReferenceText = (xlsx, sheet, row, col) => {
    const item = paymentImportCell(xlsx, sheet, row, col);
    if (!item) return '';
    if (typeof item.v === 'number' && Number.isFinite(item.v)) {
        if (Number.isInteger(item.v) || String(item.w || '').toUpperCase().includes('E+')) {
            return item.v.toFixed(0);
        }
    }
    return normalizePaymentImportText(item.w ?? item.v ?? '');
};
const paymentImportCellAccountText = (xlsx, sheet, row, col) => {
    const item = paymentImportCell(xlsx, sheet, row, col);
    if (!item) return '';
    return formatPaymentImportAccountNumber(item.v ?? item.w ?? '');
};
const formatPaymentImportAccountNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    return normalizePaymentImportText(value).replace(/\.0+$/, '');
};
const addPaymentImportAlias = (aliasMap, alias, accountNumber, area = '') => {
    const account = String(accountNumber || '').trim();
    const normalized = normalizePaymentImportNameKey(alias);
    if (!account || !normalized) return;
    const normalizedArea = normalizePaymentImportNameKey(area);
    const keys = new Set([normalized, compactPaymentImportNameKey(alias)]);
    if (normalizedArea) {
        keys.add(`${normalized}|${normalizedArea}`);
        keys.add(`${compactPaymentImportNameKey(alias)}|${normalizedArea}`);
    }
    keys.forEach((key) => {
        if (!key) return;
        if (!aliasMap.has(key)) aliasMap.set(key, new Set());
        aliasMap.get(key).add(account);
    });
};
const addPaymentImportCustomerAliases = (aliasMap, customer = {}) => {
    const accountNumber = String(customer?.accountNumber || '').trim();
    if (!accountNumber) return;
    const firstName = normalizePaymentImportText(customer?.firstName);
    const middleName = normalizePaymentImportText(customer?.middleName);
    const lastName = normalizePaymentImportText(customer?.lastName);
    const area = normalizePaymentImportText(customer?.area || customer?.coverageArea || customer?.barangay);
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const firstLast = [firstName, lastName].filter(Boolean).join(' ');
    const lastFirst = [lastName, firstName].filter(Boolean).join(' ');
    const lastFirstMiddle = [lastName, firstName, middleName].filter(Boolean).join(' ');

    [
        customer?.name,
        customer?.fullName,
        fullName,
        firstLast,
        lastFirst,
        lastName && firstName ? `${lastName}, ${firstName}` : '',
        lastName && fullName ? `${lastName}, ${[firstName, middleName].filter(Boolean).join(' ')}` : '',
        lastFirstMiddle
    ].forEach((alias) => addPaymentImportAlias(aliasMap, alias, accountNumber, area));
};
const findPaymentImportHeaderRow = (rows = [], expectedKeys = []) => (
    (Array.isArray(rows) ? rows : []).findIndex((row) => {
        const keys = new Set((Array.isArray(row) ? row : []).map(normalizePaymentImportHeaderKey).filter(Boolean));
        return expectedKeys.every((key) => keys.has(normalizePaymentImportHeaderKey(key)));
    })
);
const buildPaymentImportCustomerLookup = (customers = [], workbook) => {
    const xlsx = getPaymentImportXlsxModule();
    const customerList = Array.isArray(customers) ? customers : [];
    const customerByAccount = new Map();
    const aliasMap = new Map();

    customerList.forEach((customer) => {
        const accountNumber = String(customer?.accountNumber || '').trim();
        if (!accountNumber) return;
        customerByAccount.set(accountNumber, customer);
        addPaymentImportCustomerAliases(aliasMap, customer);
    });

    const selectedSheetName = workbook?.SheetNames?.find((name) =>
        String(name || '').trim().toLowerCase() === PAYMENT_IMPORT_CLIENTS_SHEET_NAME.toLowerCase()
    ) || workbook?.SheetNames?.find((name) => String(name || '').toLowerCase().includes('client'));
    const clientSheet = selectedSheetName ? workbook.Sheets[selectedSheetName] : null;
    if (clientSheet) {
        const rows = xlsx.utils.sheet_to_json(clientSheet, {
            header: 1,
            defval: '',
            raw: true,
            blankrows: false
        });
        const headerRowIndex = findPaymentImportHeaderRow(rows, ['Account Number']);
        const headerMap = new Map();
        if (headerRowIndex >= 0) {
            (rows[headerRowIndex] || []).forEach((cellValue, index) => {
                const key = normalizePaymentImportHeaderKey(cellValue);
                if (key && !headerMap.has(key)) headerMap.set(key, index);
            });
            const getCell = (row, aliases) => {
                for (const alias of aliases) {
                    const key = normalizePaymentImportHeaderKey(alias);
                    if (headerMap.has(key)) return row[headerMap.get(key)];
                }
                return '';
            };
            rows.slice(headerRowIndex + 1).forEach((row) => {
                const accountNumber = formatPaymentImportAccountNumber(getCell(row, [
                    'Account Number',
                    'Account No',
                    'Account #',
                    'account_number'
                ]));
                if (!accountNumber || !customerByAccount.has(accountNumber)) return;
                const firstName = normalizePaymentImportText(getCell(row, ['First Name', 'Firstname', 'first_name']));
                const middleName = normalizePaymentImportText(getCell(row, ['Middle Name', 'Middlename', 'middle_name']));
                const lastName = normalizePaymentImportText(getCell(row, ['Last Name', 'Lastname', 'last_name']));
                const area = normalizePaymentImportText(getCell(row, ['Area / Cluster', 'Area', 'Cluster', 'Barangay']));
                const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
                const firstLast = [firstName, lastName].filter(Boolean).join(' ');
                [
                    fullName,
                    firstLast,
                    [lastName, firstName].filter(Boolean).join(' '),
                    lastName && firstName ? `${lastName}, ${firstName}` : '',
                    lastName && fullName ? `${lastName}, ${[firstName, middleName].filter(Boolean).join(' ')}` : ''
                ].forEach((alias) => addPaymentImportAlias(aliasMap, alias, accountNumber, area));
            });
        }
    }

    const resolveAccount = (rawName, area = '') => {
        const normalized = normalizePaymentImportNameKey(rawName);
        const normalizedArea = normalizePaymentImportNameKey(area);
        if (!normalized) return { accountNumber: '', customer: null, ambiguous: false };
        const candidates = [
            normalizedArea ? `${normalized}|${normalizedArea}` : '',
            normalizedArea ? `${compactPaymentImportNameKey(rawName)}|${normalizedArea}` : '',
            normalized,
            compactPaymentImportNameKey(rawName)
        ].filter(Boolean);

        for (const candidate of candidates) {
            const matches = aliasMap.get(candidate);
            if (!matches || matches.size !== 1) continue;
            const [accountNumber] = [...matches];
            return { accountNumber, customer: customerByAccount.get(accountNumber) || null, ambiguous: false };
        }

        const ambiguous = candidates
            .map((candidate) => aliasMap.get(candidate))
            .find((matches) => matches && matches.size > 1);
        if (ambiguous) {
            return { accountNumber: '', customer: null, ambiguous: true, matches: [...ambiguous] };
        }
        return { accountNumber: '', customer: null, ambiguous: false };
    };

    return { resolveAccount, customerByAccount };
};
const trimPaymentImportNameNoise = (value) => {
    const tokens = normalizePaymentImportNameKey(value).split(' ').filter(Boolean);
    while (tokens.length > 1) {
        const last = tokens[tokens.length - 1];
        if (/^\d+$/.test(last) || PAYMENT_IMPORT_NAME_NOISE.has(last)) {
            tokens.pop();
            continue;
        }
        break;
    }
    return tokens.join(' ');
};
const paymentImportNameCandidates = (rawName) => {
    const original = normalizePaymentImportText(rawName);
    if (!original) return [];
    const candidates = new Set();
    const addCandidate = (value) => {
        const text = normalizePaymentImportText(value);
        const normalized = normalizePaymentImportNameKey(text);
        if (!normalized) return;
        candidates.add(text);
        candidates.add(normalized);
        const trimmed = trimPaymentImportNameNoise(text);
        if (trimmed && trimmed !== normalized) candidates.add(trimmed);
        const noParen = text.replace(/\([^)]*\)/g, ' ');
        const noParenKey = normalizePaymentImportNameKey(noParen);
        if (noParenKey && noParenKey !== normalized) candidates.add(noParenKey);
    };

    addCandidate(original);
    const commaMatch = original.match(/^([^,]+),\s*(.+)$/);
    if (commaMatch) {
        addCandidate(`${commaMatch[2]} ${commaMatch[1]}`);
        addCandidate(`${commaMatch[1]} ${commaMatch[2]}`);
    }

    return [...candidates];
};
const resolvePaymentImportAccount = (lookup, rawName, area = '') => {
    const directAccountMatch = normalizePaymentImportText(rawName).match(/\b\d{6,20}\b/);
    if (directAccountMatch && lookup.customerByAccount.has(directAccountMatch[0])) {
        return {
            accountNumber: directAccountMatch[0],
            customer: lookup.customerByAccount.get(directAccountMatch[0]) || null,
            ambiguous: false
        };
    }

    const matches = [];
    let sawAmbiguous = false;
    paymentImportNameCandidates(rawName).forEach((candidate) => {
        const resolved = lookup.resolveAccount(candidate, area);
        if (resolved.ambiguous) {
            sawAmbiguous = true;
            return;
        }
        if (resolved.accountNumber) matches.push({ ...resolved, matchedName: candidate });
    });

    const accountNumbers = new Set(matches.map((match) => match.accountNumber));
    if (accountNumbers.size === 1) return matches.find((match) => match.accountNumber === [...accountNumbers][0]);
    if (accountNumbers.size > 1 || sawAmbiguous) {
        return { accountNumber: '', customer: null, ambiguous: true, matches: [...accountNumbers] };
    }
    return { accountNumber: '', customer: null, ambiguous: false };
};
const resolvePaymentImportAccountFromRow = (lookup, { accountNumber = '', rawName = '', area = '' } = {}) => {
    const account = formatPaymentImportAccountNumber(accountNumber);
    if (!account) {
        const resolvedByName = resolvePaymentImportAccount(lookup, rawName, area);
        if (resolvedByName.accountNumber) {
            return {
                ...resolvedByName,
                matchedByNameFallback: true,
                missingAccountNumber: true
            };
        }
        return {
            ...resolvedByName,
            missingAccountNumber: true
        };
    }
    return {
        accountNumber: lookup.customerByAccount.has(account) ? account : '',
        customer: lookup.customerByAccount.get(account) || null,
        ambiguous: false,
        accountNumberHint: account,
        rawName
    };
};
const resolvePaymentImportSheetMethod = (sheetName = '') => {
    const name = String(sheetName || '').trim();
    if (/^CASH(?:\b|\s)/i.test(name)) return 'Cash';
    if (/^G(?:CASH|ASH)(?:\b|\s)/i.test(name)) return 'GCash';
    return '';
};
const findPaymentImportHeaderCol = (xlsx, sheet, row, startCol, endCol, aliases = []) => {
    const wanted = new Set(aliases.map(normalizePaymentImportHeaderKey).filter(Boolean));
    if (!wanted.size) return -1;
    for (let col = startCol; col <= endCol; col += 1) {
        if (wanted.has(normalizePaymentImportHeaderKey(paymentImportCellText(xlsx, sheet, row, col)))) {
            return col;
        }
    }
    return -1;
};
const hasPaymentImportHeaderCol = (xlsx, sheet, row, startCol, endCol, aliases = []) => (
    findPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, aliases) >= 0
);
const getPaymentImportDateHeaderCols = (xlsx, sheet, row) => {
    const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
    const endCol = Math.min(range.e.c, 18);
    const cols = [];
    for (let col = 0; col <= endCol; col += 1) {
        if (normalizePaymentImportHeaderKey(paymentImportCellText(xlsx, sheet, row, col)) === 'date') {
            cols.push(col);
        }
    }
    return cols;
};
const hasPaymentImportIncomeHeaders = (xlsx, sheet, row, dateCol, method) => {
    if (!Number.isInteger(dateCol) || dateCol < 0) return false;
    const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
    const startCol = dateCol + 1;
    const endCol = Math.min(range.e.c, dateCol + (method === 'Cash' ? 8 : 9));
    const hasAccountHeader = hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Account Number', 'Account No', 'Account #']);
    const hasCommonHeaders = hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Particulars'])
        && hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Amount', 'Payment', '3J Payment']);
    if (!hasCommonHeaders) return false;
    if (method !== 'GCash') {
        return hasAccountHeader
            || dateCol >= 3
            || hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Area', 'Area / Cluster', 'Collector', 'Collected By']);
    }

    const hasReferenceHeader = hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Reference Number', 'Ref. No.', 'Ref No']);
    if (!hasReferenceHeader) return false;
    return hasAccountHeader
        || dateCol >= 5
        || hasPaymentImportHeaderCol(xlsx, sheet, row, startCol, endCol, ['Gcash Account', 'Gcash No.', 'GCash No']);
};
const findPaymentImportIncomeDateCol = (xlsx, sheet, headerRow, method) => {
    const dateCols = getPaymentImportDateHeaderCols(xlsx, sheet, headerRow);
    return [...dateCols].reverse().find((dateCol) => hasPaymentImportIncomeHeaders(xlsx, sheet, headerRow, dateCol, method)) ?? -1;
};
const findPaymentImportCashHeader = (xlsx, sheet) => {
    const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
    for (let row = range.s.r; row <= Math.min(range.e.r, 24); row += 1) {
        if (findPaymentImportIncomeDateCol(xlsx, sheet, row, 'Cash') >= 0) {
            return row;
        }
    }
    return -1;
};
const findPaymentImportGcashHeader = (xlsx, sheet) => {
    const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
    for (let row = range.s.r; row <= Math.min(range.e.r, 24); row += 1) {
        if (findPaymentImportIncomeDateCol(xlsx, sheet, row, 'GCash') >= 0) {
            return row;
        }
    }
    return -1;
};
const resolvePaymentImportSectionColumns = (xlsx, sheet, headerRow, method) => {
    const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
    const fallbackIncomeDateCol = method === 'Cash' ? 3 : 6;
    const incomeDateCol = findPaymentImportIncomeDateCol(xlsx, sheet, headerRow, method);
    const resolvedIncomeDateCol = incomeDateCol >= 0 ? incomeDateCol : fallbackIncomeDateCol;
    const incomeStartCol = resolvedIncomeDateCol + 1;
    const incomeEndCol = Math.min(range.e.c, resolvedIncomeDateCol + (method === 'Cash' ? 8 : 9));

    if (method === 'Cash') {
        const collectorCol = findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Collector', 'Collected By']);
        return {
            income: {
                dateCol: resolvedIncomeDateCol,
                categoryCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Category']),
                areaCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Area', 'Area / Cluster']),
                accountCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Account Number', 'Account No', 'Account #']),
                particularsCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Particulars']),
                amountCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Amount', 'Payment']),
                collectorCol: collectorCol >= 0 ? collectorCol : resolvedIncomeDateCol + 6
            }
        };
    }

    const gcashAccountCol = findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Gcash Account', 'Gcash No.', 'GCash No']);
    return {
        income: {
            dateCol: resolvedIncomeDateCol,
            gcashAccountCol: gcashAccountCol >= 0 ? gcashAccountCol : incomeStartCol,
            referenceCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Reference Number', 'Ref. No.', 'Ref No']),
            accountCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Account Number', 'Account No', 'Account #']),
            particularsCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['Particulars']),
            amountCol: findPaymentImportHeaderCol(xlsx, sheet, headerRow, incomeStartCol, incomeEndCol, ['3J Payment', 'Amount', 'Payment'])
        }
    };
};
const paymentImportSheetSlug = (value) => normalizePaymentImportNameKey(value)
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
const paymentImportHash = (value, length = 10) =>
    crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, length);
const buildPaymentImportReference = ({ sheetName, rowNumber, method }) => {
    const sheetToken = paymentImportSheetSlug(sheetName).replace(/-/g, '').toUpperCase().slice(0, 14) || 'SHEET';
    const methodToken = method === 'GCash' ? 'GC' : 'CA';
    return `CF2026-${methodToken}-${sheetToken}-${String(rowNumber).padStart(4, '0')}`.slice(0, REF_MAX_LENGTH);
};
const getPaymentImportCustomerDisplayName = (customer = {}, fallback = '') => normalizePaymentImportText(
    customer?.name
    || customer?.fullName
    || [
        customer?.lastName && customer?.firstName ? `${customer.lastName}, ${customer.firstName}` : '',
        customer?.middleName
    ].filter(Boolean).join(' ')
    || [
        customer?.firstName,
        customer?.lastName
    ].filter(Boolean).join(' ')
    || fallback
);
const buildPaymentImportEntry = ({
    accountNumber,
    customer,
    sheetName,
    rowNumber,
    method,
    date,
    amount,
    rawName,
    area,
    category,
    originalReference,
    accountNumberFromWorkbook,
    gcashAccount,
    collector,
    importedBy
}) => {
    const methodSlug = method === 'GCash' ? 'gcash' : 'cash';
    const sourceKey = `${sheetName}|${rowNumber}|${accountNumber}|${amount.toFixed(2)}|${methodSlug}`;
    const generatedReference = buildPaymentImportReference({ sheetName, rowNumber, method });
    const workbookReference = sanitizeString(originalReference).slice(0, REF_MAX_LENGTH);
    const reference = method === 'GCash' && workbookReference ? workbookReference : generatedReference;
    const customerName = getPaymentImportCustomerDisplayName(customer, rawName);
    const descriptionParts = [
        `Imported ${method} payment from ${sheetName}`,
        `Excel row ${rowNumber}`,
        accountNumberFromWorkbook ? `Account number: ${accountNumberFromWorkbook}` : '',
        category ? `Category: ${category}` : '',
        area ? `Area: ${area}` : '',
        gcashAccount ? `GCash account: ${gcashAccount}` : '',
        collector ? `Collector: ${collector}` : '',
        originalReference ? `Workbook ref: ${originalReference}` : '',
        rawName && rawName !== customerName ? `Workbook name: ${rawName}` : ''
    ].filter(Boolean);
    const recorderName = normalizePaymentImportText(collector)
        || normalizePaymentImportText(importedBy?.name || importedBy?.username)
        || 'Excel Import';
    const recordedBy = {
        id: String(importedBy?.id || 'excel-import'),
        username: normalizePaymentImportText(importedBy?.username) || 'excel-import',
        name: recorderName,
        role: normalizePaymentImportText(collector) ? 'Collector' : (importedBy?.role || 'System')
    };

    return {
        id: `cf2026-${methodSlug}-${paymentImportSheetSlug(sheetName).slice(0, 22)}-r${rowNumber}-${paymentImportHash(sourceKey, 8)}`.slice(0, 64),
        amount,
        date,
        kind: 'payment',
        type: 'payment',
        direction: 'credit',
        reference,
        orNumber: '',
        description: descriptionParts.join('; '),
        recordedAt: date ? `${date}T12:00:00+08:00` : new Date().toISOString(),
        recordedBy,
        payer: customerName || rawName || recorderName,
        status: 'paid',
        paymentMethod: method,
        gcashAccount: gcashAccount || undefined,
        fingerprint: `${accountNumber}|${reference}|payment|${amount.toFixed(2)}`,
        importedFrom: sheetName
    };
};
const getPaymentImportRecorderSnapshot = (user = null) => ({
    id: String(user?.id || '').trim(),
    username: normalizePaymentImportText(user?.username || user?.name || ''),
    name: normalizePaymentImportText(user?.name || user?.username || ''),
    role: normalizePaymentImportText(user?.role || '')
});
const buildPaymentImportUnmatchedRecord = ({
    sheetName,
    rowNumber,
    method,
    date,
    amount,
    rawName,
    area,
    category,
    originalReference,
    accountNumberFromWorkbook,
    gcashAccount,
    collector,
    reason,
    matches,
    importFileName,
    importedBy
} = {}) => {
    const sourceKey = [
        importFileName,
        sheetName,
        rowNumber,
        method,
        date,
        amount,
        rawName,
        originalReference,
        accountNumberFromWorkbook
    ].map((part) => normalizePaymentImportText(part)).join('|');
    return {
        id: `unmatched-${paymentImportHash(sourceKey || `${Date.now()}`, 18)}`,
        sheetName: normalizePaymentImportText(sheetName),
        rowNumber: Number(rowNumber) || 0,
        method: method === 'GCash' ? 'GCash' : 'Cash',
        date: normalizePaymentImportText(date),
        amount: Number(Number(amount || 0).toFixed(2)) || 0,
        customerName: normalizePaymentImportText(rawName),
        accountNumber: formatPaymentImportAccountNumber(accountNumberFromWorkbook),
        area: normalizePaymentImportText(area),
        category: normalizePaymentImportText(category),
        reference: sanitizeString(originalReference).slice(0, REF_MAX_LENGTH),
        gcashAccount: normalizePaymentImportText(gcashAccount),
        collector: normalizePaymentImportText(collector),
        reason: normalizePaymentImportText(reason),
        candidateAccountNumbers: Array.isArray(matches)
            ? matches.map(formatPaymentImportAccountNumber).filter(Boolean).slice(0, 12)
            : [],
        importFileName: normalizePaymentImportText(importFileName),
        importedAt: new Date().toISOString(),
        importedBy: getPaymentImportRecorderSnapshot(importedBy)
    };
};
const sanitizePaymentImportUnmatchedRecord = (record = {}) => {
    const id = sanitizeString(record?.id);
    const amount = Number(Number(record?.amount || 0).toFixed(2));
    if (!id || !Number.isFinite(amount) || amount <= 0) return null;
    const method = normalizePaymentImportText(record?.method);
    return {
        id,
        sheetName: normalizePaymentImportText(record?.sheetName),
        rowNumber: Number(record?.rowNumber) || 0,
        method: method === 'GCash' ? 'GCash' : 'Cash',
        date: normalizePaymentImportText(record?.date),
        amount,
        customerName: normalizePaymentImportText(record?.customerName || record?.rawName),
        accountNumber: formatPaymentImportAccountNumber(record?.accountNumber),
        area: normalizePaymentImportText(record?.area),
        category: normalizePaymentImportText(record?.category),
        reference: sanitizeString(record?.reference).slice(0, REF_MAX_LENGTH),
        gcashAccount: normalizePaymentImportText(record?.gcashAccount),
        collector: normalizePaymentImportText(record?.collector),
        reason: normalizePaymentImportText(record?.reason) || 'Customer not found',
        candidateAccountNumbers: Array.isArray(record?.candidateAccountNumbers)
            ? record.candidateAccountNumbers.map(formatPaymentImportAccountNumber).filter(Boolean).slice(0, 12)
            : [],
        importFileName: normalizePaymentImportText(record?.importFileName),
        importedAt: normalizePaymentImportText(record?.importedAt),
        importedBy: getPaymentImportRecorderSnapshot(record?.importedBy)
    };
};
const paymentImportUnmatchedBranchKey = (branchId) => {
    const numericBranchId = Number(branchId);
    return Number.isInteger(numericBranchId) && numericBranchId > 0 ? String(numericBranchId) : 'global';
};
const readPaymentImportUnmatchedStore = async () => {
    const data = await readJson(STORE_KEYS.paymentImportUnmatched, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};
const readPaymentImportUnmatchedRecords = async (branchId) => {
    const store = await readPaymentImportUnmatchedStore();
    const branchKey = paymentImportUnmatchedBranchKey(branchId);
    return (Array.isArray(store[branchKey]) ? store[branchKey] : [])
        .map(sanitizePaymentImportUnmatchedRecord)
        .filter(Boolean)
        .sort((left, right) => String(right.importedAt || '').localeCompare(String(left.importedAt || '')));
};
const writePaymentImportUnmatchedRecords = async (branchId, records = []) => {
    const store = await readPaymentImportUnmatchedStore();
    const branchKey = paymentImportUnmatchedBranchKey(branchId);
    store[branchKey] = (Array.isArray(records) ? records : [])
        .map(sanitizePaymentImportUnmatchedRecord)
        .filter(Boolean)
        .slice(0, 500);
    await writeJson(STORE_KEYS.paymentImportUnmatched, store);
    return store[branchKey];
};
const appendPaymentImportUnmatchedRecords = async (branchId, records = []) => {
    const cleanedRecords = (Array.isArray(records) ? records : [])
        .map(sanitizePaymentImportUnmatchedRecord)
        .filter(Boolean);
    if (!cleanedRecords.length) {
        const existingRecords = await readPaymentImportUnmatchedRecords(branchId);
        return { added: 0, count: existingRecords.length, records: existingRecords };
    }

    const existingRecords = await readPaymentImportUnmatchedRecords(branchId);
    const merged = new Map(existingRecords.map((record) => [record.id, record]));
    cleanedRecords.forEach((record) => merged.set(record.id, record));
    const nextRecords = Array.from(merged.values())
        .sort((left, right) => String(right.importedAt || '').localeCompare(String(left.importedAt || '')))
        .slice(0, 500);
    await writePaymentImportUnmatchedRecords(branchId, nextRecords);
    return { added: cleanedRecords.length, count: nextRecords.length, records: nextRecords };
};
const removePaymentImportUnmatchedRecord = async (branchId, recordId) => {
    const id = sanitizeString(recordId);
    const existingRecords = await readPaymentImportUnmatchedRecords(branchId);
    const target = existingRecords.find((record) => record.id === id) || null;
    if (!target) return { target: null, records: existingRecords };
    const nextRecords = existingRecords.filter((record) => record.id !== id);
    await writePaymentImportUnmatchedRecords(branchId, nextRecords);
    return { target, records: nextRecords };
};
const paymentImportOptionalCellText = (xlsx, sheet, row, col) => (
    Number.isInteger(col) && col >= 0 ? paymentImportCellText(xlsx, sheet, row, col) : ''
);
const paymentImportOptionalCellRaw = (xlsx, sheet, row, col) => (
    Number.isInteger(col) && col >= 0 ? paymentImportCellRaw(xlsx, sheet, row, col) : undefined
);
const paymentImportOptionalReferenceText = (xlsx, sheet, row, col) => (
    Number.isInteger(col) && col >= 0 ? paymentImportCellReferenceText(xlsx, sheet, row, col) : ''
);
const paymentImportOptionalAccountText = (xlsx, sheet, row, col) => (
    Number.isInteger(col) && col >= 0 ? paymentImportCellAccountText(xlsx, sheet, row, col) : ''
);
const parsePaymentImportWorkbook = (buffer, customers = [], importedBy = null, options = {}) => {
    const xlsx = getPaymentImportXlsxModule();
    const workbook = xlsx.read(Buffer.from(buffer || []), {
        type: 'buffer',
        cellDates: true,
        cellNF: false,
        cellText: true
    });
    const lookup = buildPaymentImportCustomerLookup(customers, workbook);
    const records = [];
    const skipped = [];
    const unmatched = [];
    const importFileName = normalizePaymentImportText(options?.fileName || options?.filename || '');
    let skippedCount = 0;
    const bySheet = {};

    workbook.SheetNames.forEach((sheetName) => {
        const method = resolvePaymentImportSheetMethod(sheetName);
        if (!method) return;

        const sheet = workbook.Sheets[sheetName];
        const range = xlsx.utils.decode_range(sheet?.['!ref'] || 'A1:A1');
        const headerRow = method === 'Cash'
            ? findPaymentImportCashHeader(xlsx, sheet)
            : findPaymentImportGcashHeader(xlsx, sheet);
        bySheet[sheetName] = {
            parsed: 0,
            matched: 0,
            skipped: 0,
            totalAmount: 0,
            method
        };

        if (headerRow < 0) {
            bySheet[sheetName].skipped += 1;
            skippedCount += 1;
            skipped.push({ sheetName, reason: 'Cash/GCash import header not found' });
            return;
        }

        const columns = resolvePaymentImportSectionColumns(xlsx, sheet, headerRow, method);
        const fallbackYear = inferPaymentImportYear(sheetName);
        let lastIncomeDate = inferPaymentImportDateFromSheetName(sheetName);
        let lastCollector = '';
        let lastGcashAccount = '';

        for (let row = headerRow + 1; row <= range.e.r; row += 1) {
            const incomeRawDate = paymentImportOptionalCellRaw(xlsx, sheet, row, columns.income.dateCol);
            const incomeDateText = paymentImportOptionalCellText(xlsx, sheet, row, columns.income.dateCol);
            const parsedIncomeDate = parsePaymentImportDateOnly(incomeRawDate, incomeDateText, fallbackYear);
            if (parsedIncomeDate) lastIncomeDate = parsedIncomeDate;

            if (method === 'Cash') {
                const collectorText = paymentImportOptionalCellText(xlsx, sheet, row, columns.income.collectorCol);
                if (collectorText && !/^collector$/i.test(collectorText)) lastCollector = collectorText;
            } else {
                const gcashAccountText = paymentImportOptionalCellText(xlsx, sheet, row, columns.income.gcashAccountCol);
                if (gcashAccountText && !/^gcash\s*no\.?$/i.test(gcashAccountText)) {
                    lastGcashAccount = gcashAccountText;
                }
            }

            const rawName = paymentImportOptionalCellText(xlsx, sheet, row, columns.income.particularsCol);
            const accountNumberFromWorkbook = paymentImportOptionalAccountText(xlsx, sheet, row, columns.income.accountCol);
            const amount = parsePaymentImportAmount(
                paymentImportOptionalCellRaw(xlsx, sheet, row, columns.income.amountCol),
                paymentImportOptionalCellText(xlsx, sheet, row, columns.income.amountCol)
            );

            if ((!rawName && !accountNumberFromWorkbook) || /^total$/i.test(rawName) || !Number.isFinite(amount) || amount <= 0) continue;
            bySheet[sheetName].parsed += 1;

            const area = method === 'Cash'
                ? paymentImportOptionalCellText(xlsx, sheet, row, columns.income.areaCol)
                : '';
            const category = method === 'Cash'
                ? paymentImportOptionalCellText(xlsx, sheet, row, columns.income.categoryCol)
                : '';
            const originalReference = method === 'GCash'
                ? paymentImportOptionalReferenceText(xlsx, sheet, row, columns.income.referenceCol)
                : '';
            const resolved = resolvePaymentImportAccountFromRow(lookup, {
                accountNumber: accountNumberFromWorkbook,
                rawName,
                area
            });

            if (!resolved.accountNumber) {
                const reason = resolved.missingAccountNumber
                    ? (resolved.ambiguous ? 'Missing account number and ambiguous customer name' : 'Missing account number and customer name not found')
                    : (resolved.ambiguous ? 'Ambiguous customer name' : 'Customer not found');
                const unmatchedRecord = buildPaymentImportUnmatchedRecord({
                    sheetName,
                    rowNumber: row + 1,
                    method,
                    date: lastIncomeDate,
                    amount,
                    rawName,
                    area,
                    category,
                    originalReference,
                    accountNumberFromWorkbook,
                    gcashAccount: method === 'GCash' ? lastGcashAccount : '',
                    collector: method === 'Cash' ? lastCollector : lastGcashAccount,
                    reason,
                    matches: resolved.matches,
                    importFileName,
                    importedBy
                });
                unmatched.push(unmatchedRecord);
                bySheet[sheetName].skipped += 1;
                skippedCount += 1;
                if (skipped.length < PAYMENT_IMPORT_WARNING_LIMIT) {
                    skipped.push({
                        id: unmatchedRecord.id,
                        sheetName,
                        rowNumber: row + 1,
                        amount,
                        reason,
                        customerName: rawName,
                        accountNumber: accountNumberFromWorkbook || resolved.accountNumberHint || '',
                        area
                    });
                }
                continue;
            }

            const entry = buildPaymentImportEntry({
                accountNumber: resolved.accountNumber,
                customer: resolved.customer,
                sheetName,
                rowNumber: row + 1,
                method,
                date: lastIncomeDate,
                amount,
                rawName,
                area,
                category,
                originalReference,
                accountNumberFromWorkbook,
                gcashAccount: method === 'GCash' ? lastGcashAccount : '',
                collector: method === 'Cash' ? lastCollector : lastGcashAccount,
                importedBy
            });
            records.push({
                accountNumber: resolved.accountNumber,
                customerName: getPaymentImportCustomerDisplayName(resolved.customer, rawName),
                area: normalizePaymentImportText(resolved.customer?.area || resolved.customer?.coverageArea || area),
                sheetName,
                rowNumber: row + 1,
                method,
                amount,
                entry
            });
            bySheet[sheetName].matched += 1;
            bySheet[sheetName].totalAmount = Number((Number(bySheet[sheetName].totalAmount || 0) + amount).toFixed(2));
        }
    });

    return { records, skipped, skippedCount, unmatched, bySheet, sheetNames: workbook.SheetNames };
};
const parsePaymentImportBase64Payload = (payload = {}) => {
    const base64 = String(payload?.fileBase64 || payload?.fileDataBase64 || payload?.data || '').trim();
    if (!base64) return null;
    const compact = base64.includes(',') ? base64.split(',').pop() : base64;
    try {
        return Buffer.from(compact, 'base64');
    } catch {
        return null;
    }
};
const paymentImportDuplicateInHistory = (history = [], entry = {}) => (
    (Array.isArray(history) ? history : []).some((existing) => {
        const existingId = sanitizeString(existing?.id);
        const existingFingerprint = sanitizeString(existing?.fingerprint);
        const existingReference = sanitizeString(existing?.reference);
        return (
            (entry.id && existingId === entry.id)
            || (entry.fingerprint && existingFingerprint === entry.fingerprint)
            || (entry.reference && existingReference === entry.reference)
        );
    })
);
const paymentImportEntryTimestamp = (entry = {}) => {
    const parsed = new Date(entry.recordedAt || entry.date || '').getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};
const sortPaymentImportHistory = (history = []) => {
    if (!Array.isArray(history)) return [];
    return history.slice().sort((left, right) => {
        const leftTime = paymentImportEntryTimestamp(left);
        const rightTime = paymentImportEntryTimestamp(right);
        if (rightTime !== leftTime) return rightTime - leftTime;
        return String(right.id || '').localeCompare(String(left.id || ''));
    });
};
const paymentImportMoney = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
};
const paymentImportBillingMonth = (value) => {
    const date = toPaymentDateOnly(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date.slice(0, 7) : '';
};
const paymentImportGcashSubmissionId = (branchId, reference) => (
    `payment-import-gcash-${paymentImportHash(`${branchId}|${normalizeGcashReference(reference)}`, 32)}`
);
const paymentImportGcashComparableReference = (value) => {
    const reference = normalizeGcashReference(value);
    if (!reference) return '';
    if (!/^\d+$/.test(reference)) return `text:${reference}`;
    return `numeric:${reference.replace(/^0+(?=\d)/, '')}`;
};
const buildPaymentImportOfficialReferenceLookup = (transactions = []) => {
    const exact = new Map();
    const comparable = new Map();
    (Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
        const reference = normalizeGcashReference(transaction?.reference);
        if (!reference) return;
        exact.set(reference, transaction);
        const comparableReference = paymentImportGcashComparableReference(reference);
        if (!comparable.has(comparableReference)) comparable.set(comparableReference, []);
        comparable.get(comparableReference).push(transaction);
    });
    const resolve = (value) => {
        const reference = normalizeGcashReference(value);
        if (!reference) return { reference: '', transaction: null, ambiguous: false, candidateCount: 0 };
        const exactTransaction = exact.get(reference) || null;
        if (exactTransaction) {
            const officialReference = normalizeGcashReference(exactTransaction.reference);
            return {
                reference: officialReference,
                transaction: exactTransaction,
                ambiguous: false,
                candidateCount: (comparable.get(paymentImportGcashComparableReference(officialReference)) || []).length
            };
        }
        const candidates = comparable.get(paymentImportGcashComparableReference(reference)) || [];
        if (candidates.length !== 1) {
            return {
                reference,
                transaction: null,
                ambiguous: candidates.length > 1,
                candidateCount: candidates.length
            };
        }
        return {
            reference: normalizeGcashReference(candidates[0].reference),
            transaction: candidates[0],
            ambiguous: false,
            candidateCount: 1
        };
    };
    return { exact, comparable, resolve };
};
const paymentImportAllocationSignature = (allocations = [], { includeBillingMonth = false } = {}) => (
    (Array.isArray(allocations) ? allocations : [])
        .map((allocation) => [
            String(allocation?.accountNumber || '').trim(),
            paymentImportMoney(allocation?.amount)?.toFixed(2) || '',
            includeBillingMonth ? String(allocation?.billingMonth || '').trim() : ''
        ].join('|'))
        .sort()
        .join('||')
);
const paymentImportLedgerSignature = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map(({ accountNumber, entry }) => [
            String(accountNumber || '').trim(),
            paymentImportMoney(entry?.amount)?.toFixed(2) || '',
            toPaymentDateOnly(entry?.date || entry?.recordedAt) || ''
        ].join('|'))
        .sort()
        .join('||')
);
const indexPaymentImportLedgerByReference = (payments = {}) => {
    const exact = new Map();
    const comparable = new Map();
    Object.entries(payments && typeof payments === 'object' ? payments : {}).forEach(([accountNumber, record]) => {
        (Array.isArray(record?.history) ? record.history : []).forEach((entry) => {
            const references = new Set([
                normalizeGcashReference(entry?.reference),
                normalizeGcashReference(entry?.orNumber || entry?.or_number)
            ].filter(Boolean));
            references.forEach((reference) => {
                if (!exact.has(reference)) exact.set(reference, []);
                exact.get(reference).push({ accountNumber: String(accountNumber || '').trim(), entry });
            });
            const comparableReferences = new Set(Array.from(references)
                .map(paymentImportGcashComparableReference)
                .filter(Boolean));
            comparableReferences.forEach((reference) => {
                if (!comparable.has(reference)) comparable.set(reference, []);
                comparable.get(reference).push({ accountNumber: String(accountNumber || '').trim(), entry });
            });
        });
    });
    return { exact, comparable };
};
const getPaymentImportLedgerEntriesForOfficialReference = ({
    ledgerIndex,
    reference,
    officialCandidateCount = 1
} = {}) => {
    const normalizedReference = normalizeGcashReference(reference);
    if (!normalizedReference) return [];
    const exactEntries = ledgerIndex?.exact?.get(normalizedReference) || [];
    if (officialCandidateCount > 1) return exactEntries;
    return ledgerIndex?.comparable?.get(paymentImportGcashComparableReference(normalizedReference)) || exactEntries;
};
const buildPaymentImportGcashReconciliationPlan = ({
    records = [],
    transactions = [],
    payments = {},
    branchId
} = {}) => {
    const officialLookup = buildPaymentImportOfficialReferenceLookup(transactions);
    const ledgerByReference = indexPaymentImportLedgerByReference(payments);
    const regularRecords = [];
    const grouped = new Map();

    (Array.isArray(records) ? records : []).forEach((record) => {
        const importedReference = record?.method === 'GCash'
            ? normalizeGcashReference(record?.entry?.reference)
            : '';
        const resolution = importedReference
            ? officialLookup.resolve(importedReference)
            : { reference: '', transaction: null, ambiguous: false, candidateCount: 0 };
        if (!resolution.transaction && !resolution.ambiguous) {
            regularRecords.push(record);
            return;
        }
        const groupKey = resolution.ambiguous
            ? `ambiguous:${importedReference}`
            : resolution.reference;
        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, {
                reference: resolution.reference || importedReference,
                transaction: resolution.transaction,
                officialCandidateCount: resolution.candidateCount,
                ambiguousReference: resolution.ambiguous,
                records: []
            });
        }
        grouped.get(groupKey).records.push(record);
    });

    const groups = Array.from(grouped.values()).map((group) => {
        const paymentDates = [...new Set(group.records
            .map((record) => toPaymentDateOnly(record?.entry?.date || record?.entry?.recordedAt))
            .filter(Boolean))];
        const paymentDate = paymentDates.length === 1 ? paymentDates[0] : '';
        const allocations = group.records.map((record) => ({
            accountNumber: String(record?.accountNumber || '').trim(),
            customerName: String(record?.customerName || '').trim(),
            amount: paymentImportMoney(record?.amount ?? record?.entry?.amount),
            billingMonth: paymentImportBillingMonth(record?.entry?.date || record?.entry?.recordedAt),
            paymentEntryId: String(record?.entry?.id || '').trim()
        }));
        const totalAmount = paymentImportMoney(allocations.reduce((sum, allocation) => (
            sum + Number(allocation.amount || 0)
        ), 0));
        const importedSignature = paymentImportAllocationSignature(allocations);
        const importedCycleSignature = paymentImportAllocationSignature(allocations, { includeBillingMonth: true });
        const submissionId = paymentImportGcashSubmissionId(branchId, group.reference);
        const assignment = group.transaction?.assignment && typeof group.transaction.assignment === 'object'
            ? group.transaction.assignment
            : null;
        const existingEntries = getPaymentImportLedgerEntriesForOfficialReference({
            ledgerIndex: ledgerByReference,
            reference: group.reference,
            officialCandidateCount: group.officialCandidateCount
        });
        const officialAmount = paymentImportMoney(group.transaction?.credit);
        const officialDate = toPaymentDateOnly(
            group.transaction?.transactionDate || group.transaction?.transactionAt
        );
        const finish = (action, reason = '') => ({
            ...group,
            action,
            reason,
            submissionId,
            paymentDate,
            billingMonth: paymentDate ? paymentDate.slice(0, 7) : '',
            allocations,
            totalAmount,
            existingEntries
        });

        if (group.ambiguousReference) {
            return finish('conflict', 'This numeric reference matches multiple official GCash references after leading-zero normalization.');
        }
        if (group.transaction?.postingLock) {
            return finish('conflict', 'This official GCash reference is marked Not for Posting and cannot be imported as a customer payment.');
        }
        if (
            group.records.length < 1
            || group.records.length > 3
            || new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length
        ) {
            return finish('conflict', 'One official GCash reference may bind only one to three distinct customer accounts.');
        }
        if (allocations.some((allocation) => (
            !allocation.accountNumber
            || allocation.amount == null
            || allocation.amount <= 0
            || !allocation.billingMonth
            || !allocation.paymentEntryId
        ))) {
            return finish('conflict', 'The imported GCash allocation is missing a valid customer, amount, date, or payment ID.');
        }
        if (String(group.transaction?.status || '').toLowerCase() !== 'received' || officialAmount == null || officialAmount <= 0) {
            return finish('conflict', 'The matching official GCash record is not an incoming credit.');
        }
        if (totalAmount == null || Math.abs(totalAmount - officialAmount) > 0.009) {
            return finish('conflict', 'The imported payment allocation does not equal the official GCash credit.');
        }
        if (!paymentDate || paymentDates.length !== 1 || !officialDate || paymentDate !== officialDate) {
            return finish('conflict', 'The imported payment date does not match the official GCash transaction date.');
        }

        if (assignment) {
            const assignmentSignature = paymentImportAllocationSignature(assignment.allocations || [assignment]);
            if (assignment.status === 'posted') {
                return assignmentSignature === importedSignature
                    ? finish('already_posted', 'This official GCash reference is already posted to the same customer allocation.')
                    : finish('conflict', 'This official GCash reference is already posted to a different customer allocation.');
            }
            const assignmentCycleSignature = paymentImportAllocationSignature(
                assignment.allocations || [assignment],
                { includeBillingMonth: true }
            );
            if (
                assignment.submissionId !== submissionId
                || assignmentCycleSignature !== importedCycleSignature
                || toPaymentDateOnly(assignment.paymentDate) !== paymentDate
            ) {
                return finish('conflict', 'This official GCash reference is reserved by another review or allocation.');
            }
        }

        if (existingEntries.length) {
            const importedLedgerSignature = group.records
                .map((record) => ({
                    accountNumber: record.accountNumber,
                    entry: record.entry
                }));
            const everyExistingEntryIsPayment = existingEntries.every(({ entry }) => isCollectedPaymentEntry(entry));
            if (
                !everyExistingEntryIsPayment
                || paymentImportLedgerSignature(existingEntries) !== paymentImportLedgerSignature(importedLedgerSignature)
            ) {
                return finish('conflict', 'This reference already exists in Payment History with different customer, amount, or date details.');
            }
            return finish('bind_existing');
        }

        return finish('insert');
    });

    return {
        regularRecords,
        groups,
        insertGroups: groups.filter((group) => group.action === 'insert'),
        bindExistingGroups: groups.filter((group) => group.action === 'bind_existing'),
        alreadyPostedGroups: groups.filter((group) => group.action === 'already_posted'),
        conflictGroups: groups.filter((group) => group.action === 'conflict')
    };
};
const applyOfficialReferenceToPaymentImportGroup = (group) => {
    const officialReference = normalizeGcashReference(group?.reference);
    if (!officialReference || !Array.isArray(group?.records)) return;
    group.records.forEach((record) => {
        if (!record?.entry || typeof record.entry !== 'object') return;
        const importedReference = normalizeGcashReference(record.entry.reference);
        const isLeadingZeroFallback = (
            importedReference
            && importedReference !== officialReference
            && /^\d+$/.test(importedReference)
            && /^\d+$/.test(officialReference)
            && paymentImportGcashComparableReference(importedReference)
                === paymentImportGcashComparableReference(officialReference)
        );
        if (!isLeadingZeroFallback) return;
        record.entry.reference = officialReference;
        const accountNumber = String(record.accountNumber || '').trim();
        const amount = paymentImportMoney(record.amount ?? record.entry.amount);
        if (accountNumber && amount != null) {
            record.entry.fingerprint = `${accountNumber}|${officialReference}|payment|${amount.toFixed(2)}`;
        }
    });
};
const buildExistingPaymentHistoryGcashReconciliationPlan = ({
    transactions = [],
    payments = {},
    customers = [],
    branchId
} = {}) => {
    const ledgerByReference = indexPaymentImportLedgerByReference(payments);
    const officialLookup = buildPaymentImportOfficialReferenceLookup(transactions);
    const customerByAccount = new Map((Array.isArray(customers) ? customers : [])
        .map((customer) => [String(customer?.accountNumber || customer?.account_number || '').trim(), customer])
        .filter(([accountNumber]) => Boolean(accountNumber)));
    const groups = [];

    (Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
        const reference = normalizeGcashReference(transaction?.reference);
        const officialCandidateCount = (
            officialLookup.comparable.get(paymentImportGcashComparableReference(reference)) || []
        ).length;
        const existingEntries = getPaymentImportLedgerEntriesForOfficialReference({
            ledgerIndex: ledgerByReference,
            reference,
            officialCandidateCount
        });
        if (
            !reference
            || !existingEntries.length
            || String(transaction?.status || '').toLowerCase() !== 'received'
            || Number(transaction?.credit) <= 0
        ) {
            return;
        }

        const allocations = existingEntries.map(({ accountNumber, entry }) => {
            const normalizedAccountNumber = String(accountNumber || '').trim();
            const customer = customerByAccount.get(normalizedAccountNumber) || null;
            const paymentDate = toPaymentDateOnly(entry?.date || entry?.recordedAt);
            return {
                accountNumber: normalizedAccountNumber,
                customerName: customer
                    ? getPaymentImportCustomerDisplayName(customer, normalizedAccountNumber)
                    : '',
                amount: paymentImportMoney(entry?.amount),
                paymentDate,
                billingMonth: paymentImportBillingMonth(paymentDate),
                paymentEntryId: String(entry?.id || '').trim(),
                paymentMethod: normalizePaymentImportText(entry?.paymentMethod),
                isCollectedPayment: isCollectedPaymentEntry(entry)
            };
        });
        const paymentDates = [...new Set(allocations.map((allocation) => allocation.paymentDate).filter(Boolean))];
        const paymentDate = paymentDates.length === 1 ? paymentDates[0] : '';
        const officialDate = toPaymentDateOnly(transaction?.transactionDate || transaction?.transactionAt);
        const officialAmount = paymentImportMoney(transaction?.credit);
        const totalAmount = paymentImportMoney(allocations.reduce((sum, allocation) => (
            sum + Number(allocation.amount || 0)
        ), 0));
        const submissionId = paymentImportGcashSubmissionId(branchId, reference);
        const assignment = transaction?.assignment && typeof transaction.assignment === 'object'
            ? transaction.assignment
            : null;
        const finish = (action, reason) => ({
            action,
            reason,
            reference,
            transaction,
            existingEntries,
            allocations,
            totalAmount,
            paymentDate,
            officialAmount,
            officialDate,
            submissionId
        });

        if (transaction?.postingLock) {
            groups.push(finish('not_for_posting', 'This official GCash reference is marked Not for Posting.'));
            return;
        }

        if (assignment?.status === 'posted') {
            groups.push(finish('assigned', 'This official GCash reference is already posted.'));
            return;
        }
        if (allocations.length < 1 || allocations.length > 3) {
            groups.push(finish('review_required', 'The same reference exists on more than three Payment History rows.'));
            return;
        }
        if (new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length) {
            groups.push(finish('review_required', 'The same reference appears more than once for one customer account.'));
            return;
        }
        if (allocations.some((allocation) => !allocation.customerName)) {
            groups.push(finish('review_required', 'A same-reference Payment History row is not linked to a current customer record.'));
            return;
        }
        if (allocations.some((allocation) => (
            !allocation.accountNumber
            || allocation.amount == null
            || allocation.amount <= 0
            || !allocation.paymentDate
            || !allocation.billingMonth
            || !allocation.paymentEntryId
            || !allocation.isCollectedPayment
        ))) {
            groups.push(finish('review_required', 'A same-reference Payment History row is not a complete collected payment.'));
            return;
        }
        if (allocations.some((allocation) => allocation.paymentMethod.toLowerCase() !== 'gcash')) {
            groups.push(finish('review_required', 'A same-reference Payment History row is not marked as GCash.'));
            return;
        }
        if (paymentDates.length !== 1 || !paymentDate || !officialDate || paymentDate !== officialDate) {
            groups.push(finish('review_required', 'The same-reference Payment History date does not match the official GCash date.'));
            return;
        }
        if (totalAmount == null || officialAmount == null || Math.abs(totalAmount - officialAmount) > 0.009) {
            groups.push(finish('review_required', 'The same-reference Payment History total does not match the official GCash credit.'));
            return;
        }

        if (assignment) {
            const assignmentCycleSignature = paymentImportAllocationSignature(
                assignment.allocations || [assignment],
                { includeBillingMonth: true }
            );
            const allocationCycleSignature = paymentImportAllocationSignature(allocations, { includeBillingMonth: true });
            if (
                assignment.submissionId !== submissionId
                || assignmentCycleSignature !== allocationCycleSignature
                || toPaymentDateOnly(assignment.paymentDate) !== paymentDate
            ) {
                groups.push(finish('assigned', 'This official GCash reference is reserved by another review or allocation.'));
                return;
            }
        }

        groups.push(finish('bind_existing', 'Reference, GCash payment total, date, and customer allocation match exactly.'));
    });

    return {
        groups,
        bindExistingGroups: groups.filter((group) => group.action === 'bind_existing'),
        suggestionGroups: groups.filter((group) => group.action === 'review_required')
    };
};
const readExistingPaymentHistoryGcashReconciliation = async ({ branchId, transactions = null } = {}) => {
    const [payments, customers, history] = await Promise.all([
        readPayments(branchId),
        readCustomers(branchId),
        Array.isArray(transactions)
            ? Promise.resolve({ transactions })
            : listGcashTransactionHistory({ branchId, all: true })
    ]);
    return buildExistingPaymentHistoryGcashReconciliationPlan({
        transactions: history.transactions,
        payments,
        customers,
        branchId
    });
};
const serializeExistingPaymentHistoryGcashMatch = (group) => ({
    status: group.action === 'bind_existing' ? 'exact_match' : 'review_required',
    reason: group.reason,
    totalAmount: group.totalAmount,
    paymentDate: group.paymentDate || null,
    allocations: group.allocations.slice(0, 3).map((allocation) => ({
        accountNumber: allocation.accountNumber,
        customerName: allocation.customerName,
        amount: allocation.amount
    }))
});
const getExistingPaymentHistoryGcashMatches = async ({ branchId, transactions = null } = {}) => {
    const reconciliation = await readExistingPaymentHistoryGcashReconciliation({ branchId, transactions });
    const visibleGroups = reconciliation.groups.filter((group) => (
        ['bind_existing', 'review_required'].includes(group.action)
        && group.allocations.some((allocation) => allocation.customerName)
    ));
    return {
        matchesByReference: Object.fromEntries(visibleGroups.map((group) => [
            group.reference,
            serializeExistingPaymentHistoryGcashMatch(group)
        ])),
        exactReferences: visibleGroups.filter((group) => group.action === 'bind_existing').length,
        suggestedReferences: visibleGroups.filter((group) => group.action === 'review_required').length
    };
};
const reconcileExistingPaymentHistoryWithGcashTransactions = async ({
    branchId,
    transactions = null,
    importedBy = null
} = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    const reconciliation = await readExistingPaymentHistoryGcashReconciliation({
        branchId: scopedBranchId,
        transactions
    });
    const reviewer = {
        id: String(importedBy?.id || '').trim() || null,
        username: normalizePaymentImportText(importedBy?.username) || null,
        name: normalizePaymentImportText(importedBy?.name) || null,
        role: normalizePaymentImportText(importedBy?.role) || null
    };
    let autoBoundReferences = 0;
    let autoBoundRows = 0;
    const warnings = [];

    for (const group of reconciliation.bindExistingGroups) {
        try {
            await claimGcashTransactionAllocations({
                branchId: scopedBranchId,
                reference: group.reference,
                submissionId: group.submissionId,
                allocations: group.allocations,
                amount: group.totalAmount,
                paymentDate: group.paymentDate,
                claimedBy: reviewer
            });
            await finalizeGcashTransactionAllocations({
                branchId: scopedBranchId,
                reference: group.reference,
                submissionId: group.submissionId,
                paymentEntries: group.allocations.map((allocation) => ({
                    accountNumber: allocation.accountNumber,
                    billingMonth: allocation.billingMonth,
                    paymentEntryId: allocation.paymentEntryId
                }))
            });
            autoBoundReferences += 1;
            autoBoundRows += group.allocations.length;
        } catch (error) {
            warnings.push({
                reference: group.reference,
                accountNumbers: group.allocations.map((allocation) => allocation.accountNumber),
                reason: error?.message || 'The exact same-reference payment could not be linked.',
                source: 'gcash-reference-reconciliation'
            });
        }
    }

    return {
        autoBoundReferences,
        autoBoundRows,
        suggestedReferences: reconciliation.suggestionGroups.length,
        failedReferences: warnings.length,
        warnings
    };
};
const importPaymentRecordsFromExcel = async ({ buffer, branchId, importedBy = null, fileName = '' } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    if (!buffer || !buffer.length) {
        throw createError(400, 'Import file is empty.');
    }

    const customers = await readCustomers(scopedBranchId);
    const parsed = parsePaymentImportWorkbook(buffer, customers, importedBy, { fileName });
    const unmatchedQueue = await appendPaymentImportUnmatchedRecords(scopedBranchId, parsed.unmatched);
    if (!parsed.records.length && !parsed.unmatched.length) {
        throw createError(400, 'No importable Cash or GCash income payment records found. Include Account Number, or make sure Particulars matches an existing subscriber name.');
    }
    if (!parsed.records.length) {
        return {
            imported: 0,
            duplicates: 0,
            skipped: parsed.skippedCount || parsed.skipped.length,
            warnings: parsed.skipped,
            unmatchedQueued: unmatchedQueue.added,
            unmatchedCount: unmatchedQueue.count,
            methods: { cash: 0, gcash: 0 },
            bySheet: parsed.bySheet,
            backup: null
        };
    }

    const relational = await isRelationalReady();
    const [existingPayments, gcashHistory] = await Promise.all([
        readPayments(scopedBranchId),
        listGcashTransactionHistory({ branchId: scopedBranchId, all: true })
    ]);
    const backup = await createPaymentRecordsBackup(existingPayments, {
        branchId: scopedBranchId,
        user: importedBy,
        reason: 'before-payment-history-excel-import'
    });
    const reconciliation = buildPaymentImportGcashReconciliationPlan({
        records: parsed.records,
        transactions: gcashHistory.transactions,
        payments: existingPayments,
        branchId: scopedBranchId
    });
    const methods = { cash: 0, gcash: 0 };
    let imported = 0;
    let duplicates = reconciliation.alreadyPostedGroups.reduce((sum, group) => sum + group.records.length, 0);
    let autoBoundReferences = 0;
    let newPaymentBindings = 0;
    let existingPaymentBindings = 0;
    let pendingReferences = 0;
    let suggestedReferences = 0;
    let lateMatchedReferences = 0;
    const conflictGroups = reconciliation.conflictGroups.slice();
    const claimedInsertGroups = [];
    const createdClaims = [];
    const reconciliationWarnings = conflictGroups.map((group) => ({
        reference: group.reference,
        accountNumbers: group.allocations.map((allocation) => allocation.accountNumber),
        reason: group.reason,
        source: 'gcash-reference-reconciliation'
    }));
    const reviewer = {
        id: String(importedBy?.id || '').trim() || null,
        username: normalizePaymentImportText(importedBy?.username) || null,
        name: normalizePaymentImportText(importedBy?.name) || null,
        role: normalizePaymentImportText(importedBy?.role) || null
    };
    const claimGroup = async (group) => {
        const claim = await claimGcashTransactionAllocations({
            branchId: scopedBranchId,
            reference: group.reference,
            submissionId: group.submissionId,
            allocations: group.allocations,
            amount: group.totalAmount,
            paymentDate: group.paymentDate,
            claimedBy: reviewer
        });
        if (!claim.idempotent) createdClaims.push(group);
        return claim;
    };
    const recordRuntimeConflict = (group, error) => {
        const conflict = {
            ...group,
            action: 'conflict',
            reason: error?.message || 'The official GCash reference changed while this import was being reconciled.'
        };
        conflictGroups.push(conflict);
        reconciliationWarnings.push({
            reference: group.reference,
            accountNumbers: group.allocations.map((allocation) => allocation.accountNumber),
            reason: conflict.reason,
            source: 'gcash-reference-reconciliation'
        });
    };

    for (const group of reconciliation.bindExistingGroups) {
        duplicates += group.records.length;
        try {
            await claimGroup(group);
        } catch (error) {
            recordRuntimeConflict(group, error);
            continue;
        }
        try {
            const paymentEntries = group.allocations.map((allocation) => {
                const existing = group.existingEntries.find(({ accountNumber, entry }) => (
                    String(accountNumber || '') === allocation.accountNumber
                    && paymentImportMoney(entry?.amount) === allocation.amount
                    && toPaymentDateOnly(entry?.date || entry?.recordedAt) === group.paymentDate
                ));
                return {
                    accountNumber: allocation.accountNumber,
                    billingMonth: allocation.billingMonth,
                    paymentEntryId: existing?.entry?.id
                };
            });
            await finalizeGcashTransactionAllocations({
                branchId: scopedBranchId,
                reference: group.reference,
                submissionId: group.submissionId,
                paymentEntries
            });
            autoBoundReferences += 1;
            existingPaymentBindings += 1;
        } catch (error) {
            pendingReferences += 1;
            reconciliationWarnings.push({
                reference: group.reference,
                accountNumbers: group.allocations.map((allocation) => allocation.accountNumber),
                reason: `${error?.message || 'Binding failed'} The existing payment was not duplicated; retry the import to finish the queue binding.`,
                source: 'gcash-reference-reconciliation'
            });
        }
    }

    for (const group of reconciliation.insertGroups) {
        try {
            applyOfficialReferenceToPaymentImportGroup(group);
            await claimGroup(group);
            claimedInsertGroups.push(group);
        } catch (error) {
            recordRuntimeConflict(group, error);
        }
    }

    const officialInsertGroupByReference = new Map(claimedInsertGroups.map((group) => [group.reference, group]));
    const recordsForInsert = [
        ...reconciliation.regularRecords,
        ...claimedInsertGroups.flatMap((group) => group.records)
    ];
    const releaseCreatedInsertClaims = async () => {
        const insertReferences = new Set(claimedInsertGroups.map((group) => group.reference));
        await Promise.all(createdClaims
            .filter((group) => insertReferences.has(group.reference))
            .map((group) => releaseGcashTransactionClaim({
                branchId: scopedBranchId,
                reference: group.reference,
                submissionId: group.submissionId
            }).catch(() => false)));
    };

    try {
        if (relational && recordsForInsert.length) {
            await withTransaction(async (connection) => {
                for (const group of claimedInsertGroups) {
                    const [referenceRows] = await connection.query(
                        `SELECT id
                         FROM payment_entries
                         WHERE branch_id = ?
                           AND (
                               REPLACE(REPLACE(UPPER(reference), '-', ''), ' ', '') = ?
                               OR REPLACE(REPLACE(UPPER(or_number), '-', ''), ' ', '') = ?
                           )
                         LIMIT 1
                         FOR UPDATE`,
                        [scopedBranchId, group.reference, group.reference]
                    );
                    if (referenceRows && referenceRows.length) {
                        throw createError(409, `GCash reference ${group.reference} was recorded while the import was being processed.`);
                    }
                }

                const checkedOfficialReferences = new Set();
                for (const record of recordsForInsert) {
                    const officialReference = normalizeGcashReference(record?.entry?.reference);
                    const officialGroup = officialInsertGroupByReference.get(officialReference);
                    const [duplicateRows] = await connection.query(
                        `SELECT id FROM payment_entries
                         WHERE branch_id = ?
                           AND account_number = ?
                           AND (id = ? OR fingerprint = ? OR reference = ?)
                         LIMIT 1`,
                        [
                            scopedBranchId,
                            record.accountNumber,
                            record.entry.id,
                            record.entry.fingerprint,
                            record.entry.reference
                        ]
                    );
                    if (duplicateRows && duplicateRows.length) {
                        if (officialGroup) {
                            throw createError(409, `GCash reference ${officialReference} conflicts with an existing payment entry.`);
                        }
                        duplicates += 1;
                        continue;
                    }

                    await assignEntryNumbers(connection, record.entry);
                    if (officialGroup && checkedOfficialReferences.has(officialReference)) {
                        const sharedReference = record.entry.reference;
                        record.entry.reference = null;
                        try {
                            await assertEntryNumbersAvailable(connection, scopedBranchId, record.entry);
                        } finally {
                            record.entry.reference = sharedReference;
                        }
                    } else {
                        await assertEntryNumbersAvailable(connection, scopedBranchId, record.entry);
                    }
                    if (officialGroup) checkedOfficialReferences.add(officialReference);
                    await insertPaymentEntry(record.entry, scopedBranchId, record.accountNumber, connection);
                    imported += 1;
                    if (record.method === 'GCash') methods.gcash += 1;
                    else methods.cash += 1;
                }
            });
        } else if (!relational && recordsForInsert.length) {
            const payments = existingPayments && typeof existingPayments === 'object' ? existingPayments : {};
            recordsForInsert.forEach((record) => {
                if (!payments[record.accountNumber]) {
                    payments[record.accountNumber] = {
                        customerName: record.customerName,
                        area: record.area,
                        history: []
                    };
                }
                if (!Array.isArray(payments[record.accountNumber].history)) {
                    payments[record.accountNumber].history = [];
                }
                if (!payments[record.accountNumber].customerName && record.customerName) {
                    payments[record.accountNumber].customerName = record.customerName;
                }
                if (!payments[record.accountNumber].area && record.area) {
                    payments[record.accountNumber].area = record.area;
                }
                const officialReference = normalizeGcashReference(record?.entry?.reference);
                const officialGroup = officialInsertGroupByReference.get(officialReference);
                if (paymentImportDuplicateInHistory(payments[record.accountNumber].history, record.entry)) {
                    if (officialGroup) {
                        throw createError(409, `GCash reference ${officialReference} conflicts with an existing payment entry.`);
                    }
                    duplicates += 1;
                    return;
                }
                payments[record.accountNumber].history.unshift(record.entry);
                imported += 1;
                if (record.method === 'GCash') methods.gcash += 1;
                else methods.cash += 1;
            });

            Object.keys(payments).forEach((accountNumber) => {
                if (!Array.isArray(payments[accountNumber]?.history)) return;
                payments[accountNumber].history = sortPaymentImportHistory(payments[accountNumber].history);
            });
            await writePayments(payments);
        }
    } catch (error) {
        await releaseCreatedInsertClaims();
        throw error;
    }

    for (const group of claimedInsertGroups) {
        try {
            await finalizeGcashTransactionAllocations({
                branchId: scopedBranchId,
                reference: group.reference,
                submissionId: group.submissionId,
                paymentEntries: group.allocations.map((allocation) => ({
                    accountNumber: allocation.accountNumber,
                    billingMonth: allocation.billingMonth,
                    paymentEntryId: allocation.paymentEntryId
                }))
            });
            autoBoundReferences += 1;
            newPaymentBindings += 1;
        } catch (error) {
            pendingReferences += 1;
            reconciliationWarnings.push({
                reference: group.reference,
                accountNumbers: group.allocations.map((allocation) => allocation.accountNumber),
                reason: `${error?.message || 'Binding finalization failed'} The payments were imported once and the reference remains reserved; retry the import to finish binding without duplicating them.`,
                source: 'gcash-reference-reconciliation'
            });
        }
    }

    if (parsed.records.some((record) => record.method === 'GCash')) {
        try {
            const lateReconciliation = await reconcileExistingPaymentHistoryWithGcashTransactions({
                branchId: scopedBranchId,
                importedBy
            });
            autoBoundReferences += lateReconciliation.autoBoundReferences;
            existingPaymentBindings += lateReconciliation.autoBoundReferences;
            pendingReferences += lateReconciliation.failedReferences;
            suggestedReferences += lateReconciliation.suggestedReferences;
            lateMatchedReferences += (
                lateReconciliation.autoBoundReferences
                + lateReconciliation.failedReferences
                + lateReconciliation.suggestedReferences
            );
            reconciliationWarnings.push(...lateReconciliation.warnings);
        } catch (error) {
            pendingReferences += 1;
            reconciliationWarnings.push({
                reference: '',
                accountNumbers: [],
                reason: `${error?.message || 'Final GCash reconciliation failed'} Payment rows were imported once and remain available for a safe reconciliation retry.`,
                source: 'gcash-reference-reconciliation'
            });
        }
    }

    if (imported > 0) triggerBranchServiceRefresh(scopedBranchId, 'payment-history-excel-import');

    const warnings = [...parsed.skipped, ...reconciliationWarnings].slice(0, PAYMENT_IMPORT_WARNING_LIMIT);
    const conflictRows = conflictGroups.reduce((sum, group) => sum + group.records.length, 0);
    const skipped = (parsed.skippedCount || parsed.skipped.length) + conflictRows;

    return {
        imported,
        duplicates,
        skipped,
        warnings,
        unmatchedQueued: unmatchedQueue.added,
        unmatchedCount: unmatchedQueue.count,
        methods,
        bySheet: parsed.bySheet,
        gcashReconciliation: {
            matchedReferences: reconciliation.groups.length + lateMatchedReferences,
            autoBoundReferences,
            newPaymentBindings,
            existingPaymentBindings,
            alreadyPostedReferences: reconciliation.alreadyPostedGroups.length,
            conflictReferences: conflictGroups.length,
            conflictRows,
            pendingReferences,
            suggestedReferences
        },
        backup
    };
};

const bindPaymentImportUnmatchedRecord = async ({ branchId, recordId, accountNumber, importedBy = null } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }

    const selectedAccountNumber = formatPaymentImportAccountNumber(accountNumber);
    if (!selectedAccountNumber) {
        throw createError(400, 'Select a subscriber to bind this payment.');
    }

    const unmatchedRecords = await readPaymentImportUnmatchedRecords(scopedBranchId);
    const unmatchedRecord = unmatchedRecords.find((record) => record.id === sanitizeString(recordId));
    if (!unmatchedRecord) {
        throw createError(404, 'Unmatched payment record not found.');
    }

    const customers = await readCustomers(scopedBranchId);
    const customer = (Array.isArray(customers) ? customers : []).find((item) => (
        String(item?.accountNumber || '').trim() === selectedAccountNumber
    ));
    if (!customer) {
        throw createError(404, 'Selected subscriber was not found.');
    }

    const entry = buildPaymentImportEntry({
        accountNumber: selectedAccountNumber,
        customer,
        sheetName: unmatchedRecord.sheetName,
        rowNumber: unmatchedRecord.rowNumber,
        method: unmatchedRecord.method,
        date: unmatchedRecord.date,
        amount: unmatchedRecord.amount,
        rawName: unmatchedRecord.customerName,
        area: unmatchedRecord.area,
        category: unmatchedRecord.category,
        originalReference: unmatchedRecord.reference,
        accountNumberFromWorkbook: unmatchedRecord.accountNumber,
        gcashAccount: unmatchedRecord.method === 'GCash' ? unmatchedRecord.gcashAccount : '',
        collector: unmatchedRecord.method === 'Cash' ? unmatchedRecord.collector : unmatchedRecord.gcashAccount,
        importedBy
    });
    const customerName = getPaymentImportCustomerDisplayName(customer, unmatchedRecord.customerName);
    const customerArea = normalizePaymentImportText(customer?.area || customer?.coverageArea || unmatchedRecord.area);
    const relational = await isRelationalReady();
    const [existingPayments, gcashHistory] = await Promise.all([
        readPayments(scopedBranchId),
        listGcashTransactionHistory({ branchId: scopedBranchId, all: true })
    ]);
    const importRecord = {
        accountNumber: selectedAccountNumber,
        customerName,
        area: customerArea,
        sheetName: unmatchedRecord.sheetName,
        rowNumber: unmatchedRecord.rowNumber,
        method: unmatchedRecord.method,
        amount: unmatchedRecord.amount,
        entry
    };
    const reconciliation = buildPaymentImportGcashReconciliationPlan({
        records: [importRecord],
        transactions: gcashHistory.transactions,
        payments: existingPayments,
        branchId: scopedBranchId
    });
    const officialGroup = reconciliation.groups[0] || null;
    if (officialGroup?.action === 'conflict') {
        const conflict = createError(409, officialGroup.reason || 'The official GCash reference conflicts with this customer payment.');
        conflict.code = 'GCASH_IMPORT_REFERENCE_CONFLICT';
        throw conflict;
    }
    const backup = await createPaymentRecordsBackup(existingPayments, {
        branchId: scopedBranchId,
        user: importedBy,
        reason: 'before-payment-history-unmatched-bind'
    });
    const reviewer = {
        id: String(importedBy?.id || '').trim() || null,
        username: normalizePaymentImportText(importedBy?.username) || null,
        name: normalizePaymentImportText(importedBy?.name) || null,
        role: normalizePaymentImportText(importedBy?.role) || null
    };
    let claimCreated = false;
    const claimOfficialGroup = async () => {
        if (!officialGroup) return null;
        const claim = await claimGcashTransactionAllocations({
            branchId: scopedBranchId,
            reference: officialGroup.reference,
            submissionId: officialGroup.submissionId,
            allocations: officialGroup.allocations,
            amount: officialGroup.totalAmount,
            paymentDate: officialGroup.paymentDate,
            claimedBy: reviewer
        });
        claimCreated = !claim.idempotent;
        return claim;
    };
    const finalizeOfficialGroup = async (paymentEntryId) => {
        if (!officialGroup) return null;
        return finalizeGcashTransactionAllocations({
            branchId: scopedBranchId,
            reference: officialGroup.reference,
            submissionId: officialGroup.submissionId,
            paymentEntries: [{
                accountNumber: selectedAccountNumber,
                billingMonth: officialGroup.allocations[0].billingMonth,
                paymentEntryId
            }]
        });
    };

    if (officialGroup?.action === 'already_posted') {
        const removal = await removePaymentImportUnmatchedRecord(scopedBranchId, unmatchedRecord.id);
        return {
            imported: 0,
            duplicate: true,
            gcashAutoBound: false,
            gcashAlreadyPosted: true,
            accountNumber: selectedAccountNumber,
            customerName,
            entry: null,
            removed: Boolean(removal.target),
            unmatchedCount: removal.records.length,
            backup
        };
    }

    if (officialGroup?.action === 'bind_existing') {
        await claimOfficialGroup();
        const existingEntry = officialGroup.existingEntries[0]?.entry;
        await finalizeOfficialGroup(existingEntry?.id);
        const removal = await removePaymentImportUnmatchedRecord(scopedBranchId, unmatchedRecord.id);
        return {
            imported: 0,
            duplicate: true,
            gcashAutoBound: true,
            gcashExistingPaymentBinding: true,
            accountNumber: selectedAccountNumber,
            customerName,
            entry: existingEntry || null,
            removed: Boolean(removal.target),
            unmatchedCount: removal.records.length,
            backup
        };
    }

    if (officialGroup?.action === 'insert') {
        applyOfficialReferenceToPaymentImportGroup(officialGroup);
        await claimOfficialGroup();
    }

    try {
        if (relational) {
            await withTransaction(async (connection) => {
                if (officialGroup) {
                    const [referenceRows] = await connection.query(
                        `SELECT id
                         FROM payment_entries
                         WHERE branch_id = ?
                           AND (
                               REPLACE(REPLACE(UPPER(reference), '-', ''), ' ', '') = ?
                               OR REPLACE(REPLACE(UPPER(or_number), '-', ''), ' ', '') = ?
                           )
                         LIMIT 1
                         FOR UPDATE`,
                        [scopedBranchId, officialGroup.reference, officialGroup.reference]
                    );
                    if (referenceRows && referenceRows.length) {
                        throw createError(409, `GCash reference ${officialGroup.reference} was recorded while the payment was being bound.`);
                    }
                }
                const [duplicateRows] = await connection.query(
                    `SELECT id FROM payment_entries
                     WHERE branch_id = ?
                       AND account_number = ?
                       AND (id = ? OR fingerprint = ? OR reference = ?)
                     LIMIT 1`,
                    [
                        scopedBranchId,
                        selectedAccountNumber,
                        entry.id,
                        entry.fingerprint,
                        entry.reference
                    ]
                );
                if (duplicateRows && duplicateRows.length) {
                    throw createError(409, 'Payment already exists for this subscriber.');
                }
                await assignEntryNumbers(connection, entry);
                await assertEntryNumbersAvailable(connection, scopedBranchId, entry);
                await insertPaymentEntry(entry, scopedBranchId, selectedAccountNumber, connection);
            });
        } else {
            const payments = existingPayments && typeof existingPayments === 'object' ? existingPayments : {};
            if (!payments[selectedAccountNumber]) {
                payments[selectedAccountNumber] = {
                    customerName,
                    area: customerArea,
                    history: []
                };
            }
            if (!Array.isArray(payments[selectedAccountNumber].history)) {
                payments[selectedAccountNumber].history = [];
            }
            if (paymentImportDuplicateInHistory(payments[selectedAccountNumber].history, entry)) {
                throw createError(409, 'Payment already exists for this subscriber.');
            }
            if (!payments[selectedAccountNumber].customerName && customerName) {
                payments[selectedAccountNumber].customerName = customerName;
            }
            if (!payments[selectedAccountNumber].area && customerArea) {
                payments[selectedAccountNumber].area = customerArea;
            }
            payments[selectedAccountNumber].history.unshift(entry);
            payments[selectedAccountNumber].history = sortPaymentImportHistory(payments[selectedAccountNumber].history);
            await writePayments(payments);
        }
    } catch (error) {
        if (officialGroup && claimCreated) {
            await releaseGcashTransactionClaim({
                branchId: scopedBranchId,
                reference: officialGroup.reference,
                submissionId: officialGroup.submissionId
            }).catch(() => false);
        }
        throw error;
    }

    let gcashAutoBound = false;
    let gcashBindingPending = false;
    if (officialGroup) {
        try {
            await finalizeOfficialGroup(entry.id);
            gcashAutoBound = true;
        } catch {
            gcashBindingPending = true;
        }
    }
    const removal = await removePaymentImportUnmatchedRecord(scopedBranchId, unmatchedRecord.id);
    triggerBranchServiceRefresh(scopedBranchId, 'payment-history-unmatched-bind');
    return {
        imported: 1,
        duplicate: false,
        gcashAutoBound,
        gcashBindingPending,
        accountNumber: selectedAccountNumber,
        customerName,
        entry,
        removed: Boolean(removal.target),
        unmatchedCount: removal.records.length,
        backup
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

const PAYMENT_HISTORY_EDIT_BIND_AUDIT_PREFIX = '[EDIT_BIND:';
const isImportedPaymentHistoryEntry = (entry = {}) => (
    /^cf2026-(?:cash|gcash)-/i.test(String(entry?.id || '').trim())
    || /^Imported (?:Cash|GCash) payment from\b/i.test(String(entry?.description || '').trim())
);
const getPaymentHistoryEntryMatches = (payments = {}, entryId = '') => {
    const safeEntryId = String(entryId || '').trim();
    if (!safeEntryId) return [];
    return Object.entries(payments && typeof payments === 'object' ? payments : {}).flatMap(([accountNumber, record]) => (
        (Array.isArray(record?.history) ? record.history : [])
            .filter((entry) => String(entry?.id || '').trim() === safeEntryId)
            .map((entry) => ({ accountNumber: String(accountNumber || '').trim(), entry }))
    ));
};
const getPaymentHistoryReferenceMatches = (payments = {}, reference = '', excludedEntryId = '') => {
    const safeComparableReference = paymentImportGcashComparableReference(reference);
    if (!safeComparableReference) return [];
    const safeExcludedEntryId = String(excludedEntryId || '').trim();
    return Object.entries(payments && typeof payments === 'object' ? payments : {}).flatMap(([accountNumber, record]) => (
        (Array.isArray(record?.history) ? record.history : []).flatMap((entry) => {
            if (safeExcludedEntryId && String(entry?.id || '').trim() === safeExcludedEntryId) return [];
            const references = [entry?.reference, entry?.orNumber || entry?.or_number]
                .map(paymentImportGcashComparableReference)
                .filter(Boolean);
            return references.includes(safeComparableReference)
                ? [{ accountNumber: String(accountNumber || '').trim(), entry }]
                : [];
        })
    ));
};
const getGcashAssignmentPaymentEntryIds = (assignment = null) => new Set([
    assignment?.paymentEntryId,
    ...(Array.isArray(assignment?.paymentEntryIds) ? assignment.paymentEntryIds : []),
    ...(Array.isArray(assignment?.allocations)
        ? assignment.allocations.map((allocation) => allocation?.paymentEntryId)
        : [])
].map((value) => String(value || '').trim()).filter(Boolean));
const getPaymentHistoryEntryPostedGcashAssignment = (transactions = [], entryId = '') => {
    const safeEntryId = String(entryId || '').trim();
    if (!safeEntryId) return null;
    return (Array.isArray(transactions) ? transactions : []).find((transaction) => (
        transaction?.assignment?.status === 'posted'
        && getGcashAssignmentPaymentEntryIds(transaction.assignment).has(safeEntryId)
    )) || null;
};
const getPostedGcashPaymentBindings = (transactions = []) => {
    const bindingsByEntryId = new Map();
    (Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
        if (transaction?.assignment?.status !== 'posted') return;
        const reference = normalizeGcashReference(transaction?.reference);
        getGcashAssignmentPaymentEntryIds(transaction.assignment).forEach((paymentEntryId) => {
            if (!bindingsByEntryId.has(paymentEntryId)) {
                bindingsByEntryId.set(paymentEntryId, { paymentEntryId, reference });
            }
        });
    });
    return Array.from(bindingsByEntryId.values());
};
const listPostedGcashPaymentBindings = async ({ branchId } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    const history = await listGcashTransactionHistory({ branchId: scopedBranchId, all: true });
    return getPostedGcashPaymentBindings(history.transactions);
};
const createPaymentHistoryGcashBindingLockedError = () => {
    const error = createError(409, 'Locked—this GCash transaction is already posted.');
    error.code = 'PAYMENT_HISTORY_GCASH_BINDING_LOCKED';
    return error;
};
const assertEditableImportedPaymentHistoryEntry = (entry = {}) => {
    if (!isCollectedPaymentEntry(entry)) {
        throw createError(409, 'Only collected payment entries can be edited and bound.');
    }
    if (!isImportedPaymentHistoryEntry(entry)) {
        throw createError(409, 'Only imported Cash or GCash Payment History entries can use Edit & Bind.');
    }
    const amount = paymentImportMoney(entry?.amount);
    const paymentDate = toPaymentDateOnly(entry?.date || entry?.recordedAt);
    if (amount == null || amount <= 0 || !paymentDate) {
        throw createError(409, 'The imported payment is missing a valid amount or payment date.');
    }
    return { amount, paymentDate, billingMonth: paymentDate.slice(0, 7) };
};
const sanitizePaymentHistoryAuditPart = (value, maxLength = 100) => String(value || '')
    .trim()
    .replace(/[\[\]|\r\n]+/g, ' ')
    .slice(0, maxLength);
const appendPaymentHistoryEditBindAudit = ({
    description,
    submissionId,
    editedAt,
    sourceAccountNumber,
    targetAccountNumber,
    oldReference,
    officialReference,
    editedBy
} = {}) => {
    const safeDescription = String(description || '').trim();
    const markerStart = `${PAYMENT_HISTORY_EDIT_BIND_AUDIT_PREFIX}${submissionId}|`;
    if (safeDescription.includes(markerStart)) return safeDescription;
    const auditToken = `${markerStart}${[
        sanitizePaymentHistoryAuditPart(editedAt, 40),
        sanitizePaymentHistoryAuditPart(sourceAccountNumber, 20),
        sanitizePaymentHistoryAuditPart(targetAccountNumber, 20),
        sanitizePaymentHistoryAuditPart(oldReference, REF_MAX_LENGTH),
        sanitizePaymentHistoryAuditPart(officialReference, REF_MAX_LENGTH),
        sanitizePaymentHistoryAuditPart(editedBy?.id || editedBy?.username || editedBy?.name, 100)
    ].join('|')}]`;
    return [safeDescription, auditToken].filter(Boolean).join(' ');
};
const buildPaymentHistoryEditBindSubmissionId = ({ branchId, entryId, reference } = {}) => (
    `payment-history-edit-${paymentImportHash(`${branchId}|${entryId}|${normalizeGcashReference(reference)}`, 36)}`
);
const toPaymentHistoryEditBindTransaction = (transaction, flags = {}) => ({
    reference: normalizeGcashReference(transaction?.reference),
    transactionAt: transaction?.transactionAt || null,
    transactionDate: toPaymentDateOnly(transaction?.transactionDate || transaction?.transactionAt),
    amount: paymentImportMoney(transaction?.credit),
    description: String(transaction?.description || '').trim(),
    sender: String(transaction?.sender || '').trim(),
    recipient: String(transaction?.recipient || '').trim(),
    recipientLabel: String(transaction?.recipientLabel || '').trim(),
    pendingBinding: flags.pendingBinding === true
});

const getPaymentHistoryEditBindOptions = async ({ branchId, accountNumber, entryId } = {}) => {
    const scopedBranchId = Number(branchId);
    const sourceAccountNumber = formatPaymentImportAccountNumber(accountNumber);
    const safeEntryId = String(entryId || '').trim();
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    if (!sourceAccountNumber || !safeEntryId) throw createError(400, 'Payment account and entry ID are required.');

    const [payments, history] = await Promise.all([
        readPayments(scopedBranchId),
        listGcashTransactionHistory({ branchId: scopedBranchId, all: true })
    ]);
    const entryMatches = getPaymentHistoryEntryMatches(payments, safeEntryId);
    const sourceMatch = entryMatches.find((match) => match.accountNumber === sourceAccountNumber);
    if (!sourceMatch) throw createError(404, 'Payment History entry was not found for this customer.');
    if (entryMatches.length !== 1) throw createError(409, 'The payment entry ID is duplicated and cannot be edited safely.');
    const locked = assertEditableImportedPaymentHistoryEntry(sourceMatch.entry);
    const existingBinding = getPaymentHistoryEntryPostedGcashAssignment(history.transactions, safeEntryId);
    if (existingBinding) throw createPaymentHistoryGcashBindingLockedError();
    const eligibleTransactions = history.transactions.filter((transaction) => {
        const reference = normalizeGcashReference(transaction?.reference);
        const transactionAmount = paymentImportMoney(transaction?.credit);
        const transactionDate = toPaymentDateOnly(transaction?.transactionDate || transaction?.transactionAt);
        const pendingSubmissionId = buildPaymentHistoryEditBindSubmissionId({
            branchId: scopedBranchId,
            entryId: safeEntryId,
            reference
        });
        const pendingOwnClaim = transaction?.assignment?.status === 'claimed'
            && transaction.assignment.submissionId === pendingSubmissionId
            && getGcashAssignmentPaymentEntryIds(transaction.assignment).has(safeEntryId);
        return Boolean(reference)
            && String(transaction?.status || '').trim().toLowerCase() === 'received'
            && !transaction?.postingLock
            && (!transaction?.assignment || pendingOwnClaim)
            && transactionAmount === locked.amount
            && transactionDate === locked.paymentDate
            && getPaymentHistoryReferenceMatches(payments, reference, safeEntryId).length === 0;
    }).map((transaction) => toPaymentHistoryEditBindTransaction(transaction, {
        pendingBinding: transaction?.assignment?.status === 'claimed'
    }));
    const ledgerReference = normalizeGcashReference(sourceMatch.entry?.reference);
    const pendingSelected = eligibleTransactions.find((transaction) => (
        transaction.pendingBinding && transaction.reference === ledgerReference
    ));

    return {
        accountNumber: sourceAccountNumber,
        entryId: safeEntryId,
        amount: locked.amount,
        paymentDate: locked.paymentDate,
        reference: String(sourceMatch.entry?.reference || '').trim(),
        selectedReference: pendingSelected?.reference || '',
        existingBinding: null,
        transactions: eligibleTransactions
    };
};

const editAndBindPaymentHistoryEntry = async ({
    branchId,
    sourceAccountNumber,
    entryId,
    targetAccountNumber,
    gcashReference,
    assignmentConfirmed,
    editedBy
} = {}) => {
    const scopedBranchId = Number(branchId);
    const sourceAccount = formatPaymentImportAccountNumber(sourceAccountNumber);
    const targetAccount = formatPaymentImportAccountNumber(targetAccountNumber);
    const safeEntryId = String(entryId || '').trim();
    const officialReference = normalizeGcashReference(gcashReference);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    if (!sourceAccount || !safeEntryId) throw createError(400, 'Payment account and entry ID are required.');
    if (!targetAccount) throw createError(400, 'Select a customer account.');
    if (!officialReference) throw createError(400, 'Select an available imported GCash transaction.');
    if (officialReference.length > REF_MAX_LENGTH) throw createError(400, 'The official GCash reference is too long for Payment History.');
    if (assignmentConfirmed !== true) throw createError(400, 'Confirm the customer and official GCash transaction before saving.');

    const reviewer = {
        id: String(editedBy?.id || '').trim() || null,
        username: normalizePaymentImportText(editedBy?.username) || null,
        name: normalizePaymentImportText(editedBy?.name) || null,
        role: normalizePaymentImportText(editedBy?.role) || null
    };
    const [customers, payments, history] = await Promise.all([
        readCustomers(scopedBranchId),
        readPayments(scopedBranchId),
        listGcashTransactionHistory({ branchId: scopedBranchId, all: true })
    ]);
    const customer = (Array.isArray(customers) ? customers : []).find((item) => (
        String(item?.accountNumber || '').trim() === targetAccount
    ));
    if (!customer) throw createError(404, 'Selected customer was not found in this branch.');

    const entryMatches = getPaymentHistoryEntryMatches(payments, safeEntryId);
    const sourceMatch = entryMatches.find((match) => match.accountNumber === sourceAccount);
    if (!sourceMatch) throw createError(404, 'Payment History entry was not found for this customer.');
    if (entryMatches.length !== 1) throw createError(409, 'The payment entry ID is duplicated and cannot be edited safely.');
    const locked = assertEditableImportedPaymentHistoryEntry(sourceMatch.entry);
    const boundTransaction = getPaymentHistoryEntryPostedGcashAssignment(history.transactions, safeEntryId);
    if (boundTransaction) throw createPaymentHistoryGcashBindingLockedError();
    const selectedTransaction = history.transactions.find((transaction) => (
        normalizeGcashReference(transaction?.reference) === officialReference
    ));
    if (!selectedTransaction) throw createError(404, 'The selected reference is not in Imported GCash Transactions.');

    if (String(selectedTransaction.status || '').trim().toLowerCase() !== 'received' || Number(selectedTransaction.credit) <= 0) {
        throw createError(409, 'Only an incoming imported GCash credit can be bound.');
    }
    const importedAmount = paymentImportMoney(selectedTransaction.credit);
    const importedDate = toPaymentDateOnly(selectedTransaction.transactionDate || selectedTransaction.transactionAt);
    if (importedAmount !== locked.amount) {
        throw createError(409, 'The imported GCash credit amount does not match the locked payment amount.');
    }
    if (!importedDate || importedDate !== locked.paymentDate) {
        throw createError(409, 'The imported GCash transaction date does not match the locked payment date.');
    }
    const duplicateReferenceMatches = getPaymentHistoryReferenceMatches(payments, officialReference, safeEntryId);
    if (duplicateReferenceMatches.length) {
        throw createError(409, 'This GCash reference already belongs to another Payment History entry.');
    }

    const submissionId = buildPaymentHistoryEditBindSubmissionId({
        branchId: scopedBranchId,
        entryId: safeEntryId,
        reference: officialReference
    });
    const requestedAllocation = {
        accountNumber: targetAccount,
        customerName: getPaymentImportCustomerDisplayName(customer, targetAccount),
        amount: locked.amount,
        billingMonth: locked.billingMonth,
        paymentEntryId: safeEntryId
    };
    if (selectedTransaction.assignment) {
        const assignment = selectedTransaction.assignment;
        const samePendingClaim = assignment.status === 'claimed'
            && assignment.submissionId === submissionId
            && paymentImportAllocationSignature(assignment.allocations, { includeBillingMonth: true })
                === paymentImportAllocationSignature([requestedAllocation], { includeBillingMonth: true });
        if (!samePendingClaim) {
            throw createError(409, 'This imported GCash transaction is already reserved or posted.');
        }
    }

    const disconnections = await readBranchDisconnections(scopedBranchId);
    const reconnectionDecision = getAccountDisconnection(disconnections, sourceAccount);
    const protectedActivationPaymentIds = new Set(
        (Array.isArray(reconnectionDecision?.reconnectionHistory) ? reconnectionDecision.reconnectionHistory : [])
            .flatMap((settlement) => Array.isArray(settlement?.activationPayments) ? settlement.activationPayments : [])
            .map((entry) => String(entry?.entryId || '').trim())
            .filter(Boolean)
    );
    if (protectedActivationPaymentIds.has(safeEntryId)) {
        throw createError(409, 'A payment used to activate a reconnection cannot be moved because it is part of the audited service decision.');
    }

    const backup = await createPaymentRecordsBackup(payments, {
        branchId: scopedBranchId,
        user: editedBy,
        reason: 'before-payment-history-edit-bind'
    });
    let claim = null;
    let claimCreated = false;
    claim = await claimGcashTransactionAllocations({
        branchId: scopedBranchId,
        reference: officialReference,
        submissionId,
        allocations: [requestedAllocation],
        amount: locked.amount,
        paymentDate: locked.paymentDate,
        claimedBy: reviewer
    });
    claimCreated = !claim.idempotent;
    const editedAt = new Date().toISOString();
    const oldReference = String(sourceMatch.entry?.reference || '').trim();
    const bindingAuditId = submissionId;
    let updatedEntry = null;
    try {
        if (await isRelationalReady()) {
            await withTransaction(async (connection) => {
                const [sourceRows] = await connection.query(
                    `SELECT
                        id,
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
                     WHERE branch_id = ? AND account_number = ? AND id = ?
                     LIMIT 1
                     FOR UPDATE`,
                    [scopedBranchId, sourceAccount, safeEntryId]
                );
                if (!sourceRows?.length) throw createError(409, 'The payment changed while Edit & Bind was open. Reload and try again.');
                const lockedEntry = mapPaymentRow(sourceRows[0]);
                const currentLocked = assertEditableImportedPaymentHistoryEntry(lockedEntry);
                if (currentLocked.amount !== locked.amount || currentLocked.paymentDate !== locked.paymentDate) {
                    throw createError(409, 'The payment amount or date changed while Edit & Bind was open.');
                }
                const [referenceRows] = await connection.query(
                    `SELECT id, reference, or_number AS orNumber
                     FROM payment_entries
                     WHERE branch_id = ? AND id <> ?
                     FOR UPDATE`,
                    [scopedBranchId, safeEntryId]
                );
                const relationalDuplicate = (referenceRows || []).some((row) => (
                    [row.reference, row.orNumber]
                        .map(paymentImportGcashComparableReference)
                        .filter(Boolean)
                        .includes(paymentImportGcashComparableReference(officialReference))
                ));
                if (relationalDuplicate) {
                    throw createError(409, 'This GCash reference was assigned while Edit & Bind was open.');
                }
                const description = appendPaymentHistoryEditBindAudit({
                    description: lockedEntry.description,
                    submissionId: bindingAuditId,
                    editedAt,
                    sourceAccountNumber: sourceAccount,
                    targetAccountNumber: targetAccount,
                    oldReference: lockedEntry.reference,
                    officialReference,
                    editedBy: reviewer
                });
                const fingerprint = `${targetAccount}|${officialReference}|payment|${locked.amount.toFixed(2)}`;
                const [updateResult] = await connection.query(
                    `UPDATE payment_entries
                     SET account_number = ?, reference = ?, description = ?, payment_method = ?, fingerprint = ?
                     WHERE branch_id = ? AND account_number = ? AND id = ?`,
                    [
                        targetAccount,
                        officialReference,
                        description || null,
                        'GCash',
                        fingerprint,
                        scopedBranchId,
                        sourceAccount,
                        safeEntryId
                    ]
                );
                if (!updateResult?.affectedRows) throw createError(409, 'The payment changed before it could be saved.');
                updatedEntry = {
                    ...lockedEntry,
                    accountNumber: targetAccount,
                    reference: officialReference,
                    description,
                    paymentMethod: 'GCash',
                    fingerprint
                };
            });
        } else {
            const latestPayments = await readPayments(scopedBranchId);
            const latestEntryMatches = getPaymentHistoryEntryMatches(latestPayments, safeEntryId);
            const latestSource = latestEntryMatches.find((match) => match.accountNumber === sourceAccount);
            if (!latestSource || latestEntryMatches.length !== 1) {
                throw createError(409, 'The payment changed while Edit & Bind was open. Reload and try again.');
            }
            const latestLocked = assertEditableImportedPaymentHistoryEntry(latestSource.entry);
            if (latestLocked.amount !== locked.amount || latestLocked.paymentDate !== locked.paymentDate) {
                throw createError(409, 'The payment amount or date changed while Edit & Bind was open.');
            }
            if (getPaymentHistoryReferenceMatches(latestPayments, officialReference, safeEntryId).length) {
                throw createError(409, 'This GCash reference was assigned while Edit & Bind was open.');
            }
            const description = appendPaymentHistoryEditBindAudit({
                description: latestSource.entry.description,
                submissionId: bindingAuditId,
                editedAt,
                sourceAccountNumber: sourceAccount,
                targetAccountNumber: targetAccount,
                oldReference: latestSource.entry.reference,
                officialReference,
                editedBy: reviewer
            });
            const fingerprint = `${targetAccount}|${officialReference}|payment|${locked.amount.toFixed(2)}`;
            updatedEntry = {
                ...latestSource.entry,
                accountNumber: targetAccount,
                reference: officialReference,
                description,
                paymentMethod: 'GCash',
                fingerprint
            };
            latestPayments[sourceAccount].history = latestPayments[sourceAccount].history.filter((entry) => (
                String(entry?.id || '').trim() !== safeEntryId
            ));
            if (!latestPayments[targetAccount]) {
                latestPayments[targetAccount] = {
                    customerName: getPaymentImportCustomerDisplayName(customer, targetAccount),
                    area: normalizePaymentImportText(customer?.area || customer?.coverageArea),
                    history: []
                };
            }
            if (!Array.isArray(latestPayments[targetAccount].history)) latestPayments[targetAccount].history = [];
            latestPayments[targetAccount].history.push(updatedEntry);
            latestPayments[targetAccount].history = sortPaymentImportHistory(latestPayments[targetAccount].history);
            await writePayments(latestPayments);
        }
    } catch (error) {
        if (claimCreated) {
            await releaseGcashTransactionClaim({
                branchId: scopedBranchId,
                reference: officialReference,
                submissionId
            }).catch(() => false);
        }
        throw error;
    }

    let finalized;
    try {
        finalized = await finalizeGcashTransactionAllocations({
            branchId: scopedBranchId,
            reference: officialReference,
            submissionId,
            paymentEntries: [{
                accountNumber: targetAccount,
                billingMonth: locked.billingMonth,
                paymentEntryId: safeEntryId
            }]
        });
    } catch (error) {
        const pendingError = createError(
            503,
            `${error?.message || 'GCash binding finalization failed'} The payment was updated once; reload Payment History and retry from account ${targetAccount} to finish the binding.`
        );
        pendingError.code = 'GCASH_BINDING_FINALIZATION_PENDING';
        throw pendingError;
    }
    triggerBranchServiceRefresh(scopedBranchId, 'payment-history-edit-bind');
    return {
        idempotent: false,
        entry: updatedEntry,
        sourceAccountNumber: sourceAccount,
        targetAccountNumber: targetAccount,
        reference: officialReference,
        assignment: finalized.assignment,
        audit: {
            submissionId: bindingAuditId,
            editedAt,
            editedBy: reviewer,
            sourceAccountNumber: sourceAccount,
            targetAccountNumber: targetAccount,
            oldReference,
            officialReference
        },
        backup
    };
};

const buildPendingGcashSubmissionId = ({ branchId, entryId, reference } = {}) => (
    `pending-gcash-${paymentImportHash(`${branchId}|${entryId}|${normalizeGcashReference(reference)}`, 38)}`
);

const getPendingGcashPaymentMatches = (payments = {}, entryId = '') => {
    const safeEntryId = String(entryId || '').trim();
    return Object.entries(payments && typeof payments === 'object' ? payments : {}).flatMap(([accountNumber, record]) => (
        (Array.isArray(record?.history) ? record.history : []).flatMap((entry) => {
            if (!isPendingGcashPaymentEntry(entry)) return [];
            if (safeEntryId && String(entry?.id || '').trim() !== safeEntryId) return [];
            return [{ accountNumber: String(accountNumber || '').trim(), entry }];
        })
    ));
};

const toPendingGcashPaymentRecord = ({ accountNumber, entry }, customer = {}) => ({
    entryId: String(entry?.id || '').trim(),
    accountNumber: String(accountNumber || '').trim(),
    customerName: getPaymentImportCustomerDisplayName(customer, accountNumber),
    amount: paymentImportMoney(entry?.amount) || 0,
    paymentDate: toPaymentDateOnly(entry?.date || entry?.recordedAt),
    enteredReference: String(entry?.reference || '').trim(),
    paymentMethod: 'GCash',
    status: PENDING_GCASH_STATUS,
    statusLabel: 'Pending',
    notes: sanitizeString(entry?.description),
    recordedAt: entry?.recordedAt || entry?.date || null,
    recordedBy: entry?.recordedBy || null
});

const listPendingGcashPayments = async ({ branchId } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    const [payments, customers] = await Promise.all([
        readPayments(scopedBranchId),
        readCustomers(scopedBranchId)
    ]);
    const customerByAccount = new Map((Array.isArray(customers) ? customers : []).map((customer) => [
        String(customer?.accountNumber || '').trim(),
        customer
    ]));
    return getPendingGcashPaymentMatches(payments)
        .map((match) => toPendingGcashPaymentRecord(match, customerByAccount.get(match.accountNumber) || {}))
        .sort((left, right) => String(right.recordedAt || right.paymentDate || '')
            .localeCompare(String(left.recordedAt || left.paymentDate || '')));
};

const getPendingGcashBindContext = async ({ branchId, accountNumber, entryId } = {}) => {
    const scopedBranchId = Number(branchId);
    const safeAccountNumber = formatPaymentImportAccountNumber(accountNumber);
    const safeEntryId = String(entryId || '').trim();
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    if (!safeAccountNumber || !safeEntryId) {
        throw createError(400, 'Pending GCash payment account and entry ID are required.');
    }

    const [payments, customers, history] = await Promise.all([
        readPayments(scopedBranchId),
        readCustomers(scopedBranchId),
        listGcashTransactionHistory({ branchId: scopedBranchId, all: true })
    ]);
    const allEntryMatches = getPaymentHistoryEntryMatches(payments, safeEntryId);
    const match = allEntryMatches.find((item) => item.accountNumber === safeAccountNumber);
    if (!match) throw createError(404, 'Pending GCash payment was not found for this customer.');
    if (allEntryMatches.length !== 1) {
        throw createError(409, 'The pending payment entry ID is duplicated and cannot be bound safely.');
    }
    const customer = (Array.isArray(customers) ? customers : []).find((item) => (
        String(item?.accountNumber || '').trim() === safeAccountNumber
    ));
    if (!customer) throw createError(404, 'Customer was not found in this branch.');

    const amount = paymentImportMoney(match.entry?.amount);
    const paymentDate = toPaymentDateOnly(match.entry?.date || match.entry?.recordedAt);
    if (amount == null || amount <= 0 || !paymentDate) {
        throw createError(409, 'The pending GCash payment is missing a valid amount or payment date.');
    }
    const billingMonth = paymentDate.slice(0, 7);
    const transactions = (Array.isArray(history?.transactions) ? history.transactions : []).filter((transaction) => {
        const reference = normalizeGcashReference(transaction?.reference);
        const transactionAmount = paymentImportMoney(transaction?.credit);
        const transactionDate = toPaymentDateOnly(transaction?.transactionDate || transaction?.transactionAt);
        const submissionId = buildPendingGcashSubmissionId({
            branchId: scopedBranchId,
            entryId: safeEntryId,
            reference
        });
        const ownClaim = transaction?.assignment?.status === 'claimed'
            && transaction.assignment.submissionId === submissionId
            && getGcashAssignmentPaymentEntryIds(transaction.assignment).has(safeEntryId);
        const duplicatePostedReference = getPaymentHistoryReferenceMatches(payments, reference, safeEntryId)
            .some(({ entry }) => isCollectedPaymentEntry(entry));
        return Boolean(reference)
            && String(transaction?.status || '').trim().toLowerCase() === 'received'
            && !transaction?.postingLock
            && (!transaction?.assignment || ownClaim)
            && transactionAmount === amount
            && transactionDate === paymentDate
            && !duplicatePostedReference;
    }).map((transaction) => toPaymentHistoryEditBindTransaction(transaction, {
        pendingBinding: transaction?.assignment?.status === 'claimed'
    }));

    return {
        branchId: scopedBranchId,
        accountNumber: safeAccountNumber,
        entryId: safeEntryId,
        entry: match.entry,
        customer,
        amount,
        paymentDate,
        billingMonth,
        enteredReference: String(match.entry?.reference || '').trim(),
        transactions,
        payments,
        history
    };
};

const getPendingGcashBindOptions = async (payload = {}) => {
    const context = await getPendingGcashBindContext(payload);
    if (!isPendingGcashPaymentEntry(context.entry)) {
        const binding = getPaymentHistoryEntryPostedGcashAssignment(
            context.history.transactions,
            context.entryId
        );
        if (binding) throw createPaymentHistoryGcashBindingLockedError();
        throw createError(409, 'This GCash payment is no longer pending verification.');
    }
    return {
        payment: toPendingGcashPaymentRecord(
            { accountNumber: context.accountNumber, entry: context.entry },
            context.customer
        ),
        transactions: context.transactions
    };
};

const buildVerifiedPendingGcashDescription = ({ description, reference } = {}) => {
    const cleanDescription = String(description || '')
        .replace(/\s*-?\s*Pending GCash verification\s*/ig, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return [cleanDescription, `Verified against imported GCash reference ${reference}`]
        .filter(Boolean)
        .join(' - ');
};

const bindPendingGcashPayment = async ({
    branchId,
    accountNumber,
    entryId,
    gcashReference,
    assignmentConfirmed,
    verifiedBy
} = {}) => {
    const officialReference = normalizeGcashReference(gcashReference);
    if (!officialReference) throw createError(400, 'Select an imported GCash transaction.');
    if (assignmentConfirmed !== true) {
        throw createError(400, 'Confirm the customer, amount, date, and imported GCash transaction before posting.');
    }

    const context = await getPendingGcashBindContext({ branchId, accountNumber, entryId });
    const selectedTransaction = (Array.isArray(context.history.transactions) ? context.history.transactions : [])
        .find((transaction) => normalizeGcashReference(transaction?.reference) === officialReference);
    if (!selectedTransaction) throw createError(404, 'The selected reference is not in Imported GCash Transactions.');
    const submissionId = buildPendingGcashSubmissionId({
        branchId: context.branchId,
        entryId: context.entryId,
        reference: officialReference
    });
    const existingBinding = getPaymentHistoryEntryPostedGcashAssignment(
        context.history.transactions,
        context.entryId
    );
    if (existingBinding) {
        if (normalizeGcashReference(existingBinding.reference) !== officialReference) {
            throw createPaymentHistoryGcashBindingLockedError();
        }
        return {
            idempotent: true,
            entry: context.entry,
            reference: officialReference,
            assignment: existingBinding.assignment || selectedTransaction.assignment || null
        };
    }

    const officialAmount = paymentImportMoney(selectedTransaction?.credit);
    const officialDate = toPaymentDateOnly(selectedTransaction?.transactionDate || selectedTransaction?.transactionAt);
    const officialReceivedAt = normalizeGcashReceivedAt(selectedTransaction?.transactionAt);
    if (String(selectedTransaction?.status || '').trim().toLowerCase() !== 'received' || officialAmount == null || officialAmount <= 0) {
        throw createError(409, 'Only an incoming imported GCash credit can verify this payment.');
    }
    if (selectedTransaction?.postingLock) {
        throw createError(409, 'This imported GCash credit is marked Not for Posting.');
    }
    if (officialAmount !== context.amount) {
        throw createError(409, 'The imported GCash credit amount does not match the pending payment.');
    }
    if (!officialDate || officialDate !== context.paymentDate) {
        throw createError(409, 'The imported GCash transaction date does not match the pending payment date.');
    }
    if (!officialReceivedAt) {
        throw createError(409, 'The imported GCash transaction is missing its official date and time.');
    }
    const duplicateReference = getPaymentHistoryReferenceMatches(
        context.payments,
        officialReference,
        context.entryId
    ).find(({ entry }) => isCollectedPaymentEntry(entry));
    if (duplicateReference) {
        throw createError(409, 'This GCash reference already belongs to another posted payment.');
    }

    const reviewer = {
        id: String(verifiedBy?.id || '').trim() || null,
        username: sanitizeString(verifiedBy?.username) || null,
        name: sanitizeString(verifiedBy?.name) || null,
        role: sanitizeString(verifiedBy?.role) || null
    };
    const requestedAllocation = {
        accountNumber: context.accountNumber,
        customerName: getPaymentImportCustomerDisplayName(context.customer, context.accountNumber),
        amount: context.amount,
        billingMonth: context.billingMonth,
        paymentEntryId: context.entryId
    };
    const assignment = selectedTransaction?.assignment || null;
    const ownClaim = assignment?.status === 'claimed'
        && assignment.submissionId === submissionId
        && getGcashAssignmentPaymentEntryIds(assignment).has(context.entryId);
    if (assignment && !ownClaim) {
        throw createError(409, 'This imported GCash transaction is already reserved or posted.');
    }

    if (!isPendingGcashPaymentEntry(context.entry)) {
        if (!ownClaim || normalizeGcashReference(context.entry?.reference) !== officialReference) {
            throw createError(409, 'This GCash payment is no longer pending verification.');
        }
        const recovered = await finalizeGcashTransactionAllocations({
            branchId: context.branchId,
            reference: officialReference,
            submissionId,
            paymentEntries: [{
                accountNumber: context.accountNumber,
                billingMonth: context.billingMonth,
                paymentEntryId: context.entryId
            }]
        });
        await applyReenableOnPaid(context.accountNumber, context.branchId, context.payments, context.entry);
        await maybeExtendPrepaidExpiryOnPayment(context.accountNumber, context.entry, context.branchId);
        triggerBranchServiceRefresh(context.branchId, 'payments-gcash-pending-posted');
        return {
            idempotent: true,
            recovered: true,
            entry: context.entry,
            reference: officialReference,
            assignment: recovered.assignment
        };
    }

    const backup = await createPaymentRecordsBackup(context.payments, {
        branchId: context.branchId,
        user: verifiedBy,
        reason: 'before-pending-gcash-bind'
    });
    let claimCreated = false;
    let ledgerUpdated = false;
    const claim = await claimGcashTransactionAllocations({
        branchId: context.branchId,
        reference: officialReference,
        submissionId,
        allocations: [requestedAllocation],
        amount: context.amount,
        paymentDate: context.paymentDate,
        claimedBy: reviewer
    });
    claimCreated = !claim.idempotent;

    const description = appendGcashReceivedAtAudit(buildVerifiedPendingGcashDescription({
        description: context.entry?.description,
        reference: officialReference
    }), officialReceivedAt);
    const fingerprint = appendGcashReceivedAtAudit(
        `${context.accountNumber}|${officialReference}|gcash-verified|${context.amount.toFixed(2)}|${context.entryId}`,
        officialReceivedAt,
        200
    );
    let updatedEntry;
    try {
        if (await isRelationalReady()) {
            await withTransaction(async (connection) => {
                const [rows] = await connection.query(
                    `SELECT
                        id,
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
                     WHERE branch_id = ? AND account_number = ? AND id = ?
                     LIMIT 1
                     FOR UPDATE`,
                    [context.branchId, context.accountNumber, context.entryId]
                );
                const lockedEntry = rows?.[0] ? mapPaymentRow(rows[0]) : null;
                if (!lockedEntry || !isPendingGcashPaymentEntry(lockedEntry)) {
                    throw createError(409, 'The pending GCash payment changed before it could be posted.');
                }
                const [referenceRows] = await connection.query(
                    `SELECT
                        id,
                        amount,
                        kind,
                        direction,
                        reference,
                        or_number AS orNumber,
                        status,
                        payment_method AS paymentMethod
                     FROM payment_entries
                     WHERE branch_id = ? AND id <> ?
                     FOR UPDATE`,
                    [context.branchId, context.entryId]
                );
                const hasPostedDuplicate = (referenceRows || []).map(mapPaymentRow).some((entry) => (
                    isCollectedPaymentEntry(entry)
                    && [entry?.reference, entry?.orNumber]
                        .map(paymentImportGcashComparableReference)
                        .filter(Boolean)
                        .includes(paymentImportGcashComparableReference(officialReference))
                ));
                if (hasPostedDuplicate) {
                    throw createError(409, 'This GCash reference was posted while verification was open.');
                }
                const [updateResult] = await connection.query(
                    `UPDATE payment_entries
                     SET date = ?, reference = ?, description = ?, status = ?, payment_method = ?, fingerprint = ?
                     WHERE branch_id = ? AND account_number = ? AND id = ?`,
                    [
                        officialDate,
                        officialReference,
                        description || null,
                        'Approved',
                        'GCash',
                        fingerprint,
                        context.branchId,
                        context.accountNumber,
                        context.entryId
                    ]
                );
                if (!updateResult?.affectedRows) {
                    throw createError(409, 'The pending GCash payment changed before it could be saved.');
                }
                updatedEntry = {
                    ...lockedEntry,
                    date: officialDate,
                    reference: officialReference,
                    description,
                    status: 'Approved',
                    paymentMethod: 'GCash',
                    fingerprint,
                    paymentReceivedAt: officialReceivedAt
                };
            });
        } else {
            const latestPayments = await readPayments(context.branchId);
            const matches = getPaymentHistoryEntryMatches(latestPayments, context.entryId);
            const latest = matches.find((item) => item.accountNumber === context.accountNumber);
            if (!latest || matches.length !== 1 || !isPendingGcashPaymentEntry(latest.entry)) {
                throw createError(409, 'The pending GCash payment changed before it could be posted.');
            }
            const hasPostedDuplicate = getPaymentHistoryReferenceMatches(
                latestPayments,
                officialReference,
                context.entryId
            ).some(({ entry }) => isCollectedPaymentEntry(entry));
            if (hasPostedDuplicate) {
                throw createError(409, 'This GCash reference was posted while verification was open.');
            }
            updatedEntry = {
                ...latest.entry,
                date: officialDate,
                reference: officialReference,
                description,
                status: 'Approved',
                paymentMethod: 'GCash',
                fingerprint,
                paymentReceivedAt: officialReceivedAt
            };
            latestPayments[context.accountNumber].history = latestPayments[context.accountNumber].history
                .map((entry) => String(entry?.id || '').trim() === context.entryId ? updatedEntry : entry);
            await writePayments(latestPayments);
        }
        ledgerUpdated = true;
    } catch (error) {
        if (claimCreated && !ledgerUpdated) {
            await releaseGcashTransactionClaim({
                branchId: context.branchId,
                reference: officialReference,
                submissionId
            }).catch(() => false);
        }
        throw error;
    }

    let finalized;
    try {
        finalized = await finalizeGcashTransactionAllocations({
            branchId: context.branchId,
            reference: officialReference,
            submissionId,
            paymentEntries: [{
                accountNumber: context.accountNumber,
                billingMonth: context.billingMonth,
                paymentEntryId: context.entryId
            }]
        });
    } catch (error) {
        const pendingError = createError(
            503,
            `${error?.message || 'GCash verification finalization failed'} The ledger entry was updated once; reload and retry to finish locking the imported reference.`
        );
        pendingError.code = 'PENDING_GCASH_FINALIZATION_REQUIRED';
        throw pendingError;
    }

    await applyReenableOnPaid(context.accountNumber, context.branchId, null, updatedEntry);
    await maybeExtendPrepaidExpiryOnPayment(context.accountNumber, updatedEntry, context.branchId);
    triggerBranchServiceRefresh(context.branchId, 'payments-gcash-pending-posted');
    return {
        idempotent: false,
        entry: updatedEntry,
        reference: officialReference,
        assignment: finalized.assignment,
        backup
    };
};

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
const advanceMonthlyExpiryDate = (baseDate, months = 1) => {
    const next = advanceMonthlyCycleDate(baseDate, months);
    if (!next) return null;
    next.setHours(
        baseDate.getHours(),
        baseDate.getMinutes(),
        baseDate.getSeconds(),
        baseDate.getMilliseconds()
    );
    return next;
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

    const unitPriceCandidates = [Number(plan?.price), Number(customer?.planAmount)];
    const unitPrice = unitPriceCandidates.find((value) => Number.isFinite(value) && value > 0) || 0;

    return { unitPrice };
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
    const { unitPrice } = resolvePrepaidRenewalTerms(current, plans);
    const cycles = Number.isFinite(unitPrice) && unitPrice > 0
        ? Math.max(1, Math.floor((amount + 1e-9) / unitPrice))
        : 1;
    const monthsToAdd = Math.max(cycles, 1);

    const now = new Date();
    const currentExpiry = resolvePrepaidExpiryDate(current);
    const baseDate = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
    const nextExpiry = advanceMonthlyExpiryDate(baseDate, monthsToAdd) || new Date(baseDate.getTime());

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
    getEffectivePaymentEntries(history).forEach((p) => {
        const amt = Number(p.amount);
        if (!Number.isFinite(amt)) return;
        const kind = String(p.kind || '').toLowerCase();
        const direction = String(p.direction || '').toLowerCase();
        const isDebit = direction === 'debit' || ['charge', 'bill', 'debit'].includes(kind);
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
    const disconnections = await readBranchDisconnections(branchId);
    const reconnectionDecision = getAccountDisconnection(disconnections, normalizedAccountNumber);
    const protectedActivationPaymentIds = new Set(
        (Array.isArray(reconnectionDecision?.reconnectionHistory) ? reconnectionDecision.reconnectionHistory : [])
            .flatMap((settlement) => Array.isArray(settlement?.activationPayments) ? settlement.activationPayments : [])
            .map((entry) => String(entry?.entryId || '').trim())
            .filter(Boolean)
    );
    if (normalizedEntryIds.some((entryId) => protectedActivationPaymentIds.has(entryId))) {
        throw createError(409, 'A payment used to activate a reconnection cannot be deleted because it is part of the audited service decision.');
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

const applyReenableOnPaid = async (accountNumber, branchId = null, paymentsCache = null, paymentEntry = null) => {
    const payments = paymentsCache || await readPayments(branchId);
    const balance = computeBalance(payments?.[accountNumber]?.history);
    const customers = await readCustomers(branchId);
    const idx = customers.findIndex((c) => c.accountNumber === accountNumber);
    if (idx < 0) return;
    const current = customers[idx];
    const currentStatus = resolveCustomerStatusState(current);
    const disconnections = await readBranchDisconnections(branchId);
    const currentDecision = getAccountDisconnection(disconnections, accountNumber);
    const pendingReconnection = getPendingReconnectionSettlement(currentDecision);
    if (pendingReconnection && isCollectedPaymentEntry(paymentEntry || {})) {
        const paymentId = String(paymentEntry?.id || paymentEntry?.fingerprint || paymentEntry?.reference || '').trim();
        const existingPayments = Array.isArray(pendingReconnection.activationPayments)
            ? pendingReconnection.activationPayments
            : [];
        const alreadyCounted = paymentId && existingPayments.some((entry) => String(entry?.entryId || '') === paymentId);
        const activationPayments = alreadyCounted
            ? existingPayments
            : [
                ...existingPayments,
                {
                    entryId: paymentId || `activation-payment-${Date.now()}`,
                    amount: Math.max(0, Number(paymentEntry.amount) || 0),
                    recordedAt: paymentEntry.recordedAt || paymentEntry.date || new Date().toISOString()
                }
            ];
        const paidTowardActivation = activationPayments.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0);
        const activationReached = paidTowardActivation + 0.005 >= Number(pendingReconnection.requiredPaymentAmount || 0);
        const activatedAt = activationReached ? new Date().toISOString() : '';
        const activationActor = activationReached
            ? {
                id: paymentEntry?.recordedBy?.id || null,
                username: paymentEntry?.recordedBy?.username || 'payment',
                name: paymentEntry?.recordedBy?.name || paymentEntry?.payer || 'Payment'
            }
            : null;
        const activatedSettlement = activationReached
            ? activatePendingReconnectionSettlement(pendingReconnection, {
                effectiveDate: getManilaDateKey(),
                dueOffset: deriveOffset(current),
                activationPayments,
                activatedBy: activationActor,
                now: new Date(activatedAt)
            })
            : null;
        if (activationReached && !activatedSettlement) {
            throw createError(500, 'Unable to finalize the pending reconnection billing settlement.');
        }
        const updatedHistory = (Array.isArray(currentDecision?.reconnectionHistory) ? currentDecision.reconnectionHistory : [])
            .map((settlement) => (
                settlement?.reconnectionId === pendingReconnection.reconnectionId
                    ? (activatedSettlement || {
                        ...settlement,
                        activationPayments,
                        paidTowardActivation,
                        status: 'pending-payment',
                        activatedAt: '',
                        activatedBy: null
                    })
                    : settlement
            ));
        if (!activationReached) {
            await upsertBranchDisconnection(branchId, accountNumber, {
                reconnectionHistory: updatedHistory,
                decidedAt: new Date().toISOString()
            });
            return;
        }

        const nextCustomer = {
            ...current,
            billDate: activatedSettlement.nextRegularCycleDate,
            dueDate: activatedSettlement.nextDueDate || activatedSettlement.nextRegularCycleDate,
            status: STATUS_ACTIVE,
            statusMode: STATUS_MODE_AUTO
        };
        customers[idx] = nextCustomer;
        if (await isRelationalReady()) {
            await writeCustomers([nextCustomer], current.branchId || branchId);
        } else {
            await writeCustomers(customers, branchId);
        }
        await enablePppoeForCustomer(nextCustomer, current.branchId || branchId);
        await upsertBranchDisconnection(branchId, accountNumber, {
            status: STATUS_KEPT_ACTIVE,
            billingPolicy: BILLING_POLICY_CONTINUE,
            hitCreditLimitAt: null,
            disconnectedAt: null,
            reconnectedAt: activatedAt,
            decidedAt: activatedAt,
            notes: pendingReconnection.reason,
            reconnectionHistory: updatedHistory,
            decidedBy: activationActor
        });
        return;
    }
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

const PAYMENT_EXPORT_MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
const PAYMENT_EXPORT_MONEY_FORMAT = '#,##0.00;\\(#,##0.00\\)';
const PAYMENT_EXPORT_DATE_FORMAT = 'd mmm yyyy';

const normalizePaymentExportText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizePaymentExportKey = (value) => normalizePaymentExportText(value).toLowerCase();
const roundPaymentExportMoney = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
};

const parsePaymentExportMonth = (value) => {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) {
        throw createError(400, 'Select a valid export month.');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        throw createError(400, 'Select a valid export month.');
    }
    const monthName = PAYMENT_EXPORT_MONTH_NAMES[month - 1];
    const paddedMonth = pad2(month);
    return {
        year,
        month,
        paddedMonth,
        value: `${year}-${paddedMonth}`,
        title: `${monthName} ${year}`,
        sheetToken: `${monthName.toUpperCase()}${year}`,
        firstDate: new Date(year, month - 1, 1)
    };
};

const safePaymentExportSheetName = (value, fallback) => {
    const text = normalizePaymentExportText(value).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, 31);
};

const getPaymentExportCustomerName = (customer = {}, accountNumber = '', paymentRecord = {}) => {
    const firstName = normalizePaymentExportText(customer?.firstName);
    const lastName = normalizePaymentExportText(customer?.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const lastFirstName = [lastName, firstName].filter(Boolean).join(', ');
    const fallback = normalizePaymentExportText(
        customer?.name
        || customer?.fullName
        || paymentRecord?.customerName
        || paymentRecord?.name
        || ''
    );
    return (lastName && firstName ? lastFirstName : fullName) || fallback || `Account ${accountNumber}`;
};

const getPaymentExportArea = (customer = {}, paymentRecord = {}) => normalizePaymentExportText(
    customer?.area
    || customer?.coverageArea
    || customer?.cluster
    || customer?.barangay
    || paymentRecord?.area
    || paymentRecord?.coverageArea
    || ''
);

const formatPaymentExportRecorderLabel = (entry = {}) => {
    if (typeof entry?.recordedBy === 'string') {
        const recordedByText = normalizePaymentExportText(entry.recordedBy);
        if (recordedByText) return recordedByText;
    }
    const recorder = entry?.recordedBy || {};
    const name = normalizePaymentExportText(recorder?.name || recorder?.username || entry?.recordedByName || entry?.recordedByUsername);
    const role = normalizePaymentExportKey(recorder?.role || entry?.recordedByRole);
    const roles = role.split(/[,/|;]+|\s+\+\s+|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
    if (name && roles.includes('collector')) return `${name} (Collector)`;
    if (name && roles.includes('admin')) return `${name} (Admin)`;
    if (name && role) return `${name} (${role.charAt(0).toUpperCase()}${role.slice(1)})`;
    if (name) return name;

    const method = normalizePaymentExportText(
        entry?.paymentMethod
        || entry?.payment_method
        || entry?.method
        || entry?.channel
        || entry?.paymentChannel
        || entry?.payment_channel
        || ''
    );
    if (entry?.xenditId || entry?.xendit_id) return 'Xendit';
    return method || 'System';
};

const resolvePaymentExportMethodLabel = (entry = {}) => {
    const rawMethod = normalizePaymentExportText(
        entry?.paymentMethod
        || entry?.payment_method
        || entry?.method
        || entry?.channel
        || entry?.paymentChannel
        || entry?.payment_channel
        || entry?.channelCode
        || entry?.channel_code
        || ''
    );
    const normalized = normalizePaymentExportKey(rawMethod).replace(/[\s-]+/g, '_');

    if (normalized.includes('gcash') || normalized.includes('ph_gcash')) return 'GCash';
    if (normalized === 'cash' || normalized.includes('_cash') || normalized.includes('cash_')) return 'Cash';
    if (entry?.xenditId || entry?.xendit_id) return rawMethod || 'Xendit';
    return rawMethod || 'Cash';
};

const resolvePaymentExportMethodKey = (methodLabel) => (
    normalizePaymentExportKey(methodLabel).includes('gcash') ? 'gcash' : 'cash'
);

const sumPaymentExportRows = (rows = []) => roundPaymentExportMoney(
    (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + (Number(row?.amount) || 0), 0)
);

const buildPaymentExportRows = (payments = {}, customers = [], monthInfo) => {
    const customerMap = new Map(
        (Array.isArray(customers) ? customers : []).map((customer) => [
            String(customer?.accountNumber || '').trim(),
            customer
        ])
    );
    const rows = [];
    const monthPrefix = `${monthInfo.year}-${monthInfo.paddedMonth}-`;

    Object.entries(payments || {}).forEach(([accountNumber, paymentRecord]) => {
        const account = String(accountNumber || '').trim();
        const customer = customerMap.get(account) || {};
        const subscriber = getPaymentExportCustomerName(customer, account, paymentRecord);
        const area = getPaymentExportArea(customer, paymentRecord);

        getEffectivePaymentEntries(paymentRecord?.history || []).forEach((rawEntry, index) => {
            const entry = normalizePaymentEntry(rawEntry || {});
            const kind = normalizePaymentExportKey(entry?.kind);
            const direction = normalizePaymentExportKey(entry?.direction);
            if (!(kind === 'payment' && direction === 'credit')) return;

            const amount = roundPaymentExportMoney(Math.abs(Number(entry?.amount) || 0));
            if (amount <= 0) return;

            const rawDate = entry?.date || entry?.recordedAt || entry?.recorded_at || entry?.createdAt || entry?.created_at || '';
            const dateKey = toPaymentDateOnly(rawDate);
            if (!dateKey || !dateKey.startsWith(monthPrefix)) return;

            const methodLabel = resolvePaymentExportMethodLabel(entry);
            const reference = normalizePaymentExportText(entry?.reference || entry?.ref || '');
            const orNumber = normalizePaymentExportText(entry?.orNumber || entry?.or_number || '');
            const gcashAccount = normalizePaymentExportText(
                entry?.gcashAccount
                || entry?.gcash_account
                || entry?.gcashNo
                || entry?.gcash_no
                || entry?.gcashNumber
                || entry?.gcash_number
                || ''
            );
            rows.push({
                id: String(entry?.id || `${account}-${dateKey}-${index}`),
                accountNumber: account,
                subscriber,
                area,
                dateKey,
                date: parseDateOnly(dateKey),
                amount,
                methodLabel,
                methodKey: resolvePaymentExportMethodKey(methodLabel),
                reference,
                orNumber,
                gcashAccount,
                recorderLabel: formatPaymentExportRecorderLabel(entry)
            });
        });
    });

    rows.sort((left, right) => {
        if (left.dateKey !== right.dateKey) return String(left.dateKey).localeCompare(String(right.dateKey));
        if (left.subscriber !== right.subscriber) {
            return String(left.subscriber).localeCompare(String(right.subscriber), undefined, {
                sensitivity: 'base',
                numeric: true
            });
        }
        if (left.accountNumber !== right.accountNumber) return String(left.accountNumber).localeCompare(String(right.accountNumber));
        return String(left.id).localeCompare(String(right.id));
    });

    return {
        allRows: rows,
        cashRows: rows.filter((row) => row.methodKey !== 'gcash'),
        gcashRows: rows.filter((row) => row.methodKey === 'gcash')
    };
};

const paymentExportSetNumberCell = (sheet, address, value = 0, format = PAYMENT_EXPORT_MONEY_FORMAT) => {
    sheet[address] = {
        t: 'n',
        v: roundPaymentExportMoney(value),
        z: format
    };
};
const paymentExportSetDateCell = (sheet, address, value, format = PAYMENT_EXPORT_DATE_FORMAT) => {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return;
    sheet[address] = {
        t: 'd',
        v: value,
        z: format
    };
};

const createCashPaymentExportSheet = (xlsx, rows = [], monthInfo) => {
    const dataRowCount = Math.max(rows.length, 1);
    const rowCount = 2 + dataRowCount;
    const columnCount = 11;
    const aoa = Array.from({ length: rowCount }, () => Array(columnCount).fill(''));
    const incomeTotal = sumPaymentExportRows(rows);

    aoa[0][0] = 'Expense';
    aoa[0][4] = 'Income';
    aoa[0][9] = 'TOTAL INCOME';
    aoa[1][0] = 'Date';
    aoa[1][1] = 'Category';
    aoa[1][2] = 'Particulars';
    aoa[1][3] = 'Amount';
    aoa[1][4] = 'Date';
    aoa[1][5] = 'Account Number';
    aoa[1][6] = 'Particulars';
    aoa[1][7] = 'Amount';
    aoa[1][8] = 'Collector';
    aoa[1][9] = 'TOTAL EXPENSE';

    rows.forEach((row, index) => {
        const sheetRow = 2 + index;
        aoa[sheetRow][4] = row.date;
        aoa[sheetRow][5] = row.accountNumber;
        aoa[sheetRow][6] = row.subscriber;
        aoa[sheetRow][7] = row.amount;
        aoa[sheetRow][8] = row.recorderLabel;
    });

    const sheet = xlsx.utils.aoa_to_sheet(aoa, { cellDates: true });
    paymentExportSetNumberCell(sheet, 'K1', incomeTotal, PAYMENT_EXPORT_MONEY_FORMAT);
    paymentExportSetNumberCell(sheet, 'K2', 0, '0');
    rows.forEach((row, index) => {
        const excelRow = 3 + index;
        if (sheet[`E${excelRow}`]) paymentExportSetDateCell(sheet, `E${excelRow}`, row.date);
        if (sheet[`H${excelRow}`]) paymentExportSetNumberCell(sheet, `H${excelRow}`, row.amount, PAYMENT_EXPORT_MONEY_FORMAT);
    });
    sheet['!cols'] = [
        { wch: 13.25 }, { wch: 13.25 }, { wch: 32.25 }, { wch: 12.25 },
        { wch: 13.25 }, { wch: 16.25 }, { wch: 46.25 }, { wch: 12.25 },
        { wch: 12.25 }, { wch: 18.25 }, { wch: 9.25 }
    ];
    return sheet;
};

const createGcashPaymentExportSheet = (xlsx, rows = [], monthInfo) => {
    const dataRowCount = Math.max(rows.length, 1);
    const rowCount = 2 + dataRowCount;
    const columnCount = 13;
    const aoa = Array.from({ length: rowCount }, () => Array(columnCount).fill(''));
    const incomeTotal = sumPaymentExportRows(rows);

    aoa[0][0] = 'Expense';
    aoa[0][5] = 'Income';
    aoa[0][11] = 'TOTAL INCOME';
    aoa[1][0] = 'Date';
    aoa[1][1] = ' Category';
    aoa[1][2] = 'Reference Number';
    aoa[1][3] = 'Particulars';
    aoa[1][4] = 'Amount';
    aoa[1][5] = 'Date';
    aoa[1][6] = 'Gcash Account';
    aoa[1][7] = 'Reference Number';
    aoa[1][8] = 'Account Number';
    aoa[1][9] = 'Particulars';
    aoa[1][10] = 'Amount';
    aoa[1][11] = 'TOTAL EXPENSE';

    rows.forEach((row, index) => {
        const sheetRow = 2 + index;
        aoa[sheetRow][5] = row.date;
        aoa[sheetRow][6] = row.gcashAccount || row.recorderLabel;
        aoa[sheetRow][7] = row.reference || row.orNumber;
        aoa[sheetRow][8] = row.accountNumber;
        aoa[sheetRow][9] = row.subscriber;
        aoa[sheetRow][10] = row.amount;
    });

    const sheet = xlsx.utils.aoa_to_sheet(aoa, { cellDates: true });
    paymentExportSetNumberCell(sheet, 'M1', incomeTotal, PAYMENT_EXPORT_MONEY_FORMAT);
    paymentExportSetNumberCell(sheet, 'M2', 0, PAYMENT_EXPORT_MONEY_FORMAT);
    rows.forEach((row, index) => {
        const excelRow = 3 + index;
        if (sheet[`F${excelRow}`]) paymentExportSetDateCell(sheet, `F${excelRow}`, row.date);
        if (sheet[`K${excelRow}`]) paymentExportSetNumberCell(sheet, `K${excelRow}`, row.amount, PAYMENT_EXPORT_MONEY_FORMAT);
    });
    sheet['!cols'] = [
        { wch: 18.25 }, { wch: 19.25 }, { wch: 17.25 }, { wch: 38.25 },
        { wch: 18.25 }, { wch: 19.25 }, { wch: 33.25 }, { wch: 29.5 },
        { wch: 21.25 }, { wch: 46.25 }, { wch: 21.25 }, { wch: 14.38 },
        { wch: 11.63 }
    ];
    return sheet;
};

const createPaymentHistoryExportWorkbook = ({ payments = {}, customers = [], monthInfo }) => {
    const xlsx = getPaymentImportXlsxModule();
    const workbook = xlsx.utils.book_new();
    const groupedRows = buildPaymentExportRows(payments, customers, monthInfo);
    const cashSheetName = safePaymentExportSheetName(`CASH ${monthInfo.sheetToken}`, 'CASH');
    const gcashSheetName = safePaymentExportSheetName(`GCASH ${monthInfo.sheetToken}`, 'GCASH');

    xlsx.utils.book_append_sheet(
        workbook,
        createCashPaymentExportSheet(xlsx, groupedRows.cashRows, monthInfo),
        cashSheetName
    );
    xlsx.utils.book_append_sheet(
        workbook,
        createGcashPaymentExportSheet(xlsx, groupedRows.gcashRows, monthInfo),
        gcashSheetName
    );

    return {
        buffer: xlsx.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
            compression: true
        }),
        counts: {
            cash: groupedRows.cashRows.length,
            gcash: groupedRows.gcashRows.length,
            total: groupedRows.allRows.length
        }
    };
};

// GET /api/payments - Get all payment records
router.get('/', async (req, res, next) => {
    try {
        const payments = await readPayments(req.user?.branchId || null);
        const effectiveOnly = ['1', 'true', 'approved', 'history'].includes(
            String(req.query?.effective || req.query?.scope || '').trim().toLowerCase()
        );
        res.json(effectiveOnly ? filterPaymentsForEffectiveHistory(payments) : payments);
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

// POST /api/payments/import-excel - Import Cash/GCash payment history from Excel workbook
router.post('/import-excel', express.raw({
    type: [
        'application/octet-stream',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ],
    limit: '40mb'
}), async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const importBuffer = Buffer.isBuffer(req.body)
            ? req.body
            : parsePaymentImportBase64Payload(req.body || {});

        const result = await importPaymentRecordsFromExcel({
            buffer: importBuffer,
            branchId,
            importedBy: user,
            fileName: decodeURIComponent(String(req.get('x-import-filename') || '')).trim()
        });

        res.json({
            ok: true,
            ...result
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to import payment records from Excel.'));
    }
});

// GET /api/payments/export-excel - Export monthly Cash/GCash payment history workbook
router.get('/export-excel', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const monthInfo = parsePaymentExportMonth(req.query?.month);
        const [payments, customers] = await Promise.all([
            readPayments(branchId),
            readCustomers(branchId)
        ]);
        const { buffer, counts } = createPaymentHistoryExportWorkbook({
            payments,
            customers,
            monthInfo
        });
        const filename = `payment-history-${monthInfo.value}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Payment-Export-Cash-Count', String(counts.cash));
        res.setHeader('X-Payment-Export-Gcash-Count', String(counts.gcash));
        res.setHeader('X-Payment-Export-Total-Count', String(counts.total));
        res.setHeader('Content-Length', String(buffer.length));
        res.send(buffer);
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to export payment history.'));
    }
});

// GET /api/payments/import-unmatched - List imported payment rows that need manual binding
router.get('/import-unmatched', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const records = await readPaymentImportUnmatchedRecords(branchId);
        res.json({
            ok: true,
            count: records.length,
            records
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to load unmatched imported payments.'));
    }
});

// DELETE /api/payments/import-unmatched - Clear all unmatched imported rows for this branch
router.delete('/import-unmatched', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const existingRecords = await readPaymentImportUnmatchedRecords(branchId);
        await writePaymentImportUnmatchedRecords(branchId, []);
        res.json({
            ok: true,
            deleted: true,
            deletedCount: existingRecords.length,
            unmatchedCount: 0
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to clear unmatched imported payments.'));
    }
});

// POST /api/payments/import-unmatched/:recordId/bind - Bind an unmatched row to a subscriber
router.post('/import-unmatched/:recordId/bind', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const result = await bindPaymentImportUnmatchedRecord({
            branchId: user.branchId || null,
            recordId: req.params.recordId,
            accountNumber: req.body?.accountNumber,
            importedBy: user
        });
        res.json({
            ok: true,
            ...result
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to bind unmatched payment.'));
    }
});

// DELETE /api/payments/import-unmatched/:recordId - Remove an unmatched imported row
router.delete('/import-unmatched/:recordId', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const branchId = user.branchId || null;
        const removal = await removePaymentImportUnmatchedRecord(branchId, req.params.recordId);
        if (!removal.target) {
            throw createError(404, 'Unmatched payment record not found.');
        }
        res.json({
            ok: true,
            deleted: true,
            unmatchedCount: removal.records.length
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to delete unmatched payment.'));
    }
});

// GET /api/payments/gcash-bindings - List posted GCash bindings for Payment History actions
router.get('/gcash-bindings', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const bindings = await listPostedGcashPaymentBindings({
            branchId: user.branchId || null
        });
        res.json({ ok: true, bindings });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to load posted GCash bindings.'));
    }
});

// GET /api/payments/reference-availability - Validate one manual reference before saving
router.get('/reference-availability', async (req, res, next) => {
    try {
        const sessionUser = req.user || await getUserFromSession(req);
        if (!sessionUser) throw createError(401, 'Unauthorized');
        const branchId = sessionUser.branchId || null;
        if (!branchId) throw createError(400, 'Branch assignment missing for this account.');
        const reference = sanitizeReferenceInput(req.query?.reference);
        if (!reference) {
            return res.json({ ok: true, available: true });
        }
        const conflict = await getStoredManualPaymentReferenceConflict({ branchId, reference });
        return res.json({
            ok: true,
            available: !conflict,
            code: conflict ? 'PAYMENT_REFERENCE_ALREADY_USED' : null,
            source: conflict?.source || null,
            message: conflict?.message || 'Reference is available.'
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to validate the payment reference.'));
    }
});

// GET /api/payments/gcash-pending - List manual GCash payments awaiting official proof
router.get('/gcash-pending', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const payments = await listPendingGcashPayments({ branchId: user.branchId || null });
        res.json({ ok: true, payments });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to load pending GCash payments.'));
    }
});

// GET /api/payments/gcash-pending/:accountNumber/:entryId/options - List exact imported proof matches
router.get('/gcash-pending/:accountNumber/:entryId/options', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const result = await getPendingGcashBindOptions({
            branchId: user.branchId || null,
            accountNumber: req.params.accountNumber,
            entryId: req.params.entryId
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to load imported GCash proof matches.'));
    }
});

// POST /api/payments/gcash-pending/:accountNumber/:entryId/bind - Verify and post one pending GCash payment
router.post('/gcash-pending/:accountNumber/:entryId/bind', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const result = await bindPendingGcashPayment({
            branchId: user.branchId || null,
            accountNumber: req.params.accountNumber,
            entryId: req.params.entryId,
            gcashReference: req.body?.gcashReference,
            assignmentConfirmed: req.body?.assignmentConfirmed === true,
            verifiedBy: user
        });
        res.status(result.idempotent ? 200 : 201).json({
            ok: true,
            message: result.idempotent
                ? 'This pending GCash payment is already verified and posted.'
                : 'Pending GCash payment verified and posted from the imported transaction.',
            ...result
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to verify and post the pending GCash payment.'));
    }
});

// GET /api/payments/:accountNumber/:entryId/edit-bind-options - List exact available GCash matches
router.get('/:accountNumber/:entryId/edit-bind-options', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const result = await getPaymentHistoryEditBindOptions({
            branchId: user.branchId || null,
            accountNumber: req.params.accountNumber,
            entryId: req.params.entryId
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to load Edit & Bind options.'));
    }
});

// PUT /api/payments/:accountNumber/:entryId/edit-bind - Move one imported payment and bind its official GCash row
router.put('/:accountNumber/:entryId/edit-bind', async (req, res, next) => {
    try {
        const user = await assertAdminUser(req);
        const result = await editAndBindPaymentHistoryEntry({
            branchId: user.branchId || null,
            sourceAccountNumber: req.params.accountNumber,
            entryId: req.params.entryId,
            targetAccountNumber: req.body?.targetAccountNumber,
            gcashReference: req.body?.gcashReference,
            assignmentConfirmed: req.body?.assignmentConfirmed === true,
            editedBy: user
        });
        res.json({
            ok: true,
            message: result.idempotent
                ? 'This Payment History entry is already bound to the selected GCash transaction.'
                : 'Payment History entry moved and bound to the official GCash transaction.',
            ...result
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to edit and bind the Payment History entry.'));
    }
});

// GET /api/payments/:accountNumber - Get payment history for one account
router.get('/:accountNumber', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        const payments = await readPayments(branchId);
        const accountHistory = payments[req.params.accountNumber] || { history: [] };
        const effectiveOnly = ['1', 'true', 'yes'].includes(
            String(req.query?.effective || '').trim().toLowerCase()
        );
        res.json(effectiveOnly
            ? {
                ...accountHistory,
                history: getEffectivePaymentEntries(accountHistory?.history || [])
            }
            : accountHistory);
    } catch (error) {
        next(createError(500, 'Failed to retrieve account history.'));
    }
});

// POST /api/payments/:accountNumber - Add a payment entry to an account's history
router.post('/:accountNumber', async (req, res, next) => {
    try {
        const { accountNumber } = req.params;
        const paymentEntry = req.body;
        const normalizedPaymentEntry = normalizePaymentEntry(paymentEntry || {});
        const allowedKinds = new Set(['payment', 'rebate', 'discount', 'charge', 'bill']);
        const requestedKind = typeof normalizedPaymentEntry.kind === 'string'
            ? normalizedPaymentEntry.kind.toLowerCase().trim()
            : 'payment';
        const amountValue = Number(paymentEntry?.amount);
        // Ensure 'kind' is one of the allowed values, default to 'payment' if not.
        const kind = allowedKinds.has(requestedKind) ? requestedKind : 'payment';
        const direction = (kind === 'charge' || kind === 'bill') ? 'debit' : 'credit';
        const paymentMethod = sanitizeString(paymentEntry?.paymentMethod || paymentEntry?.payment_method);
        const isPendingGcashPayment = kind === 'payment' && paymentMethod.toLowerCase() === 'gcash';
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return next(createError(400, 'Amount must be greater than 0.'));
        }
        if (isPendingGcashPayment && !toPaymentDateOnly(paymentEntry?.date)) {
            return next(createError(400, 'Payment date is required for pending GCash verification.'));
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
                await assertManualPaymentReferenceAvailable({
                    branchId,
                    reference: fallbackReference,
                    payments
                });
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
            status: isPendingGcashPayment ? PENDING_GCASH_STATUS : paymentEntry?.status,
            paymentMethod: paymentMethod || undefined,
            reference: relational ? (providedReference || undefined) : fallbackReference,
            description: isPendingGcashPayment
                ? [description, 'Pending GCash verification'].filter(Boolean).join(' - ')
                : (description || undefined),
            recordedAt: resolveRecordedAtValue(paymentEntry.recordedAt, paymentEntry.date),
            recordedBy: recorder,
            payer: recorderLabel || paymentEntry.payer || null
        };
        delete newEntry.skipPrepaidAutoCharge;
        delete newEntry.skipAutoCharge;

        if (relational) {
            await withTransaction(async (connection) => {
                if (providedReference) {
                    await assertManualPaymentReferenceAvailable({
                        branchId,
                        reference: providedReference,
                        executor: connection
                    });
                }
                await assignEntryNumbers(connection, newEntry);
                await assertEntryNumbersAvailable(connection, branchId, newEntry);

                const newEntryFingerprint = `${accountNumber}|${newEntry.reference}|${kind}|${(Math.abs(Number(paymentEntry.amount) || 0)).toFixed(2)}`;
                newEntry.fingerprint = newEntryFingerprint;
                if (await hasPaymentFingerprint(branchId, accountNumber, newEntryFingerprint, connection)) {
                    throw createError(409, 'Payment already recorded (duplicate request).');
                }
                await insertPaymentEntry(newEntry, branchId, accountNumber, connection);

            });
        } else {
            const fallbackFingerprint = `${accountNumber}|${newEntry.reference}|${kind}|${(Math.abs(Number(paymentEntry.amount) || 0)).toFixed(2)}`;
            const duplicate = history.find((entry) => entry.fingerprint === fallbackFingerprint);
            if (duplicate) {
                return next(createError(409, 'Payment already recorded (duplicate request).'));
            }
            newEntry.fingerprint = fallbackFingerprint;
            payments[accountNumber].history.unshift(newEntry);
            await writePayments(payments);
        }
        if (isCollectedPaymentEntry(newEntry)) {
            await applyReenableOnPaid(accountNumber, branchId, payments, newEntry);
            await maybeExtendPrepaidExpiryOnPayment(accountNumber, newEntry, branchId);
        }
        triggerBranchServiceRefresh(branchId, isPendingGcashPayment
            ? 'payments-gcash-pending'
            : 'payments-manual');
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

        if (relational) {
            try {
                await withTransaction(async (connection) => {
                    await assignEntryNumbers(connection, entry);
                    await assertEntryNumbersAvailable(connection, branchId, entry);
                    await insertPaymentEntry(entry, branchId, accountNumber, connection);
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
            payments[accountNumber].history.unshift(entry);
            await writePayments(payments);
        }
        if (isPositiveCreditEntry(entry)) {
            await applyReenableOnPaid(accountNumber, branchId, relational ? null : await readPayments(), entry);
        }
        await maybeExtendPrepaidExpiryOnPayment(accountNumber, entry, branchId);
        triggerBranchServiceRefresh(branchId, 'payments-webhook');

        return res.json({ ok: true, recorded: true, entryId: entry.id });
    } catch (error) {
        next(error);
    }
};

let approvedProofPaymentQueue = Promise.resolve();

const buildApprovedPaymentEntryId = (submissionId) => {
    const compact = String(submissionId || '').replace(/[^0-9a-z_-]/gi, '');
    const candidate = `proof-${compact}`;
    if (candidate.length <= 64 && candidate.length > 6) return candidate;
    return `proof-${crypto.createHash('sha1').update(String(submissionId || Date.now())).digest('hex').slice(0, 58)}`;
};

const normalizeApprovedPaymentReferenceKey = (value) => sanitizeReferenceInput(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '');

const createApprovedPaymentDuplicateError = ({ accountNumber, entry, customerName = '' } = {}) => {
    const duplicateError = createError(409, 'Payment has been recorded');
    duplicateError.duplicatePayment = {
        paymentEntryId: entry?.id || '',
        accountNumber: accountNumber || entry?.accountNumber || '',
        customerName,
        amount: Number(entry?.amount) || null,
        date: entry?.date || null,
        reference: entry?.reference || '',
        orNumber: entry?.orNumber || entry?.or_number || '',
        recordedAt: entry?.recordedAt || entry?.recorded_at || null,
        recordedBy: entry?.recordedBy?.name
            || entry?.recordedBy?.username
            || entry?.recordedByName
            || entry?.recordedByUsername
            || entry?.recorded_by_name
            || entry?.recorded_by_username
            || '',
        paymentMethod: entry?.paymentMethod || entry?.payment_method || '',
        description: entry?.description || ''
    };
    return duplicateError;
};

const recordApprovedProofPayment = (payload = {}) => {
    const operation = approvedProofPaymentQueue.catch(() => {}).then(async () => {
        const branchId = Number(payload.branchId);
        const accountNumber = String(payload.accountNumber || '').trim();
        const submissionId = String(payload.submissionId || '').trim();
        const amount = Number(payload.amount);
        const reference = sanitizeReferenceInput(payload.reference);
        if (!Number.isInteger(branchId) || branchId <= 0) throw createError(400, 'Branch ID is required.');
        if (!accountNumber) throw createError(400, 'Account number is required.');
        if (!submissionId) throw createError(400, 'Submission ID is required.');
        if (!Number.isFinite(amount) || amount <= 0) throw createError(400, 'Amount must be greater than 0.');
        if (!reference) throw createError(400, 'Reference number is required.');

        const customers = await readCustomers(branchId);
        const customer = customers.find((item) => String(item?.accountNumber ?? item?.account_number ?? '') === accountNumber);
        if (!customer) throw createError(404, 'Customer not found.');

        const amountRounded = Number(amount.toFixed(2));
        const source = payload.source === 'gcash-history' ? 'gcash-history' : 'proof';
        const referenceKey = normalizeApprovedPaymentReferenceKey(reference);
        const notes = sanitizeString(payload.notes).slice(0, 220);
        const suppliedDescription = sanitizeString(payload.description).slice(0, 220);
        const description = suppliedDescription || (
            notes ? `Payment proof approved - ${notes}` : 'Payment proof approved'
        );
        const entry = {
            id: buildApprovedPaymentEntryId(submissionId),
            amount: amountRounded,
            date: toPaymentDateOnly(payload.date) || new Date().toISOString().slice(0, 10),
            kind: 'payment',
            type: 'payment',
            direction: 'credit',
            reference,
            description,
            recordedAt: new Date().toISOString(),
            recordedBy: {
                id: String(payload.reviewer?.id || ''),
                username: payload.reviewer?.username || null,
                name: payload.reviewer?.name || null,
                role: payload.reviewer?.role || null
            },
            payer: sanitizeString(payload.payer) || accountNumber,
            status: 'Approved',
            paymentMethod: 'gcash',
            fingerprint: `${accountNumber}|${reference}|${source}|${amountRounded.toFixed(2)}|${submissionId}`.slice(0, 200)
        };
        let resultEntry = entry;
        let inserted = false;

        if (await isRelationalReady()) {
            const result = await withTransaction(async (connection) => {
                const [existingRows] = await connection.query(
                    `SELECT
                         id,
                         account_number AS accountNumber,
                         amount,
                         date,
                         reference,
                         or_number AS orNumber,
                         description,
                         recorded_at AS recordedAt,
                         recorded_by_username AS recordedByUsername,
                         recorded_by_name AS recordedByName,
                         payment_method AS paymentMethod
                     FROM payment_entries
                     WHERE branch_id = ?
                       AND id = ?
                     LIMIT 1
                     FOR UPDATE`,
                    [branchId, entry.id]
                );
                if ((existingRows || [])[0]) {
                    return { entry: existingRows[0], inserted: false };
                }

                const [duplicateRows] = await connection.query(
                    `SELECT
                         pe.id,
                         pe.account_number AS accountNumber,
                         pe.amount,
                         pe.date,
                         pe.reference,
                         pe.or_number AS orNumber,
                         pe.description,
                         pe.recorded_at AS recordedAt,
                         pe.recorded_by_username AS recordedByUsername,
                         pe.recorded_by_name AS recordedByName,
                         pe.payment_method AS paymentMethod,
                         c.name AS customerName,
                         c.first_name AS firstName,
                         c.last_name AS lastName
                     FROM payment_entries pe
                     LEFT JOIN customers c
                       ON c.account_number = pe.account_number
                      AND c.branch_id = pe.branch_id
                     WHERE pe.branch_id = ?
                       AND (
                           REPLACE(REPLACE(UPPER(pe.reference), '-', ''), ' ', '') = ?
                           OR REPLACE(REPLACE(UPPER(pe.or_number), '-', ''), ' ', '') = ?
                       )
                     ORDER BY pe.recorded_at DESC, pe.date DESC
                     LIMIT 1
                     FOR UPDATE`,
                    [branchId, referenceKey, referenceKey]
                );
                const duplicate = (duplicateRows || [])[0];
                if (duplicate) {
                    const duplicateCustomerName = sanitizeString(duplicate.customerName)
                        || [duplicate.firstName, duplicate.lastName].map(sanitizeString).filter(Boolean).join(' ');
                    throw createApprovedPaymentDuplicateError({
                        accountNumber: duplicate.accountNumber,
                        entry: duplicate,
                        customerName: duplicateCustomerName
                    });
                }

                await assignEntryNumbers(connection, entry);
                await assertEntryNumbersAvailable(connection, branchId, entry);
                await insertPaymentEntry(entry, branchId, accountNumber, connection);
                return { entry, inserted: true };
            });
            resultEntry = result.entry;
            inserted = result.inserted;
        } else {
            const payments = await readPayments(branchId);
            if (!payments[accountNumber]) payments[accountNumber] = { history: [] };
            const existingEntry = Object.values(payments).flatMap((record) => (
                Array.isArray(record?.history) ? record.history : []
            )).find((candidate) => String(candidate?.id || '') === entry.id);
            if (existingEntry) return existingEntry;

            const duplicate = Object.entries(payments).flatMap(([duplicateAccount, record]) => (
                (Array.isArray(record?.history) ? record.history : []).map((candidate) => ({
                    accountNumber: duplicateAccount,
                    entry: candidate
                }))
            )).find(({ entry: candidate }) => {
                const candidates = [candidate?.reference, candidate?.orNumber, candidate?.or_number]
                    .map(normalizeApprovedPaymentReferenceKey)
                    .filter(Boolean);
                return candidates.includes(referenceKey);
            });
            if (duplicate) {
                const duplicateCustomer = customers.find((item) => (
                    String(item?.accountNumber ?? item?.account_number ?? '') === duplicate.accountNumber
                ));
                throw createApprovedPaymentDuplicateError({
                    ...duplicate,
                    customerName: sanitizeString(duplicateCustomer?.name)
                        || [duplicateCustomer?.firstName, duplicateCustomer?.lastName].map(sanitizeString).filter(Boolean).join(' ')
                });
            }

            payments[accountNumber].history.unshift(entry);
            await writePayments(payments);
            resultEntry = entry;
            inserted = true;
            await applyReenableOnPaid(accountNumber, branchId, payments, entry);
        }

        if (inserted) {
            if (await isRelationalReady()) {
                await applyReenableOnPaid(accountNumber, branchId, null, resultEntry);
            }
            await maybeExtendPrepaidExpiryOnPayment(accountNumber, resultEntry, branchId);
            triggerBranchServiceRefresh(branchId, source === 'gcash-history'
                ? 'gcash-history-payment-posted'
                : 'payment-confirmation-approved');
        }
        return resultEntry;
    });
    approvedProofPaymentQueue = operation.catch(() => {});
    return operation;
};

const recordApprovedProofPayments = (payload = {}) => {
    const operation = approvedProofPaymentQueue.catch(() => {}).then(async () => {
        const branchId = Number(payload.branchId);
        const submissionId = String(payload.submissionId || '').trim();
        const reference = sanitizeReferenceInput(payload.reference);
        const sourceAllocations = Array.isArray(payload.allocations) ? payload.allocations : [];
        if (!Number.isInteger(branchId) || branchId <= 0) throw createError(400, 'Branch ID is required.');
        if (!submissionId) throw createError(400, 'Submission ID is required.');
        if (!reference) throw createError(400, 'Reference number is required.');
        if (sourceAllocations.length < 1 || sourceAllocations.length > 3) {
            throw createError(400, 'Provide one to three payment allocations.');
        }

        const allocations = sourceAllocations.map((allocation) => ({
            accountNumber: String(allocation?.accountNumber || '').trim(),
            billingMonth: String(allocation?.billingMonth || '').trim(),
            amount: Number(allocation?.amount),
            customerName: sanitizeString(allocation?.customerName),
            description: sanitizeString(allocation?.description).slice(0, 220)
        }));
        if (allocations.some((allocation) => (
            !allocation.accountNumber
            || !/^\d{4}-(0[1-9]|1[0-2])$/.test(allocation.billingMonth)
            || !Number.isFinite(allocation.amount)
            || allocation.amount <= 0
        ))) {
            throw createError(400, 'Every payment allocation requires an account, billing month, and amount greater than 0.');
        }
        if (new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length) {
            throw createError(400, 'Each payment allocation must use a different customer account.');
        }
        allocations.forEach((allocation) => {
            allocation.amount = Number(allocation.amount.toFixed(2));
        });
        const allocatedTotal = Number(allocations.reduce((sum, allocation) => sum + allocation.amount, 0).toFixed(2));
        const expectedTotal = Number(payload.amount ?? payload.totalAmount);
        if (!Number.isFinite(expectedTotal) || Math.abs(allocatedTotal - expectedTotal) > 0.009) {
            throw createError(409, 'Payment allocations must exactly equal the imported GCash credit.');
        }

        const customers = await readCustomers(branchId);
        const customerByAccount = new Map(customers.map((customer) => [
            String(customer?.accountNumber ?? customer?.account_number ?? ''),
            customer
        ]));
        const missingAccount = allocations.find((allocation) => !customerByAccount.has(allocation.accountNumber));
        if (missingAccount) throw createError(404, `Customer ${missingAccount.accountNumber} was not found.`);

        const source = payload.source === 'gcash-history' ? 'gcash-history' : 'proof';
        const referenceKey = normalizeApprovedPaymentReferenceKey(reference);
        const paymentDate = toPaymentDateOnly(payload.date) || new Date().toISOString().slice(0, 10);
        const recordedAt = new Date().toISOString();
        const entries = allocations.map((allocation, index) => {
            const allocationSubmissionId = allocations.length === 1
                ? submissionId
                : `${submissionId}-${index + 1}`;
            const customer = customerByAccount.get(allocation.accountNumber) || {};
            const customerName = allocation.customerName
                || sanitizeString(customer.name)
                || [customer.firstName ?? customer.first_name, customer.lastName ?? customer.last_name]
                    .map(sanitizeString)
                    .filter(Boolean)
                    .join(' ')
                || allocation.accountNumber;
            const baseDescription = allocation.description
                || `Imported GCash payment allocation ${index + 1} of ${allocations.length} for billing cycle ${allocation.billingMonth}`;
            const paymentReceivedAt = source === 'gcash-history'
                ? normalizeGcashReceivedAt(payload.paymentReceivedAt)
                : '';
            const description = baseDescription;
            const fingerprint = appendGcashReceivedAtAudit(
                `${allocation.accountNumber}|${reference}|${source}|${allocation.amount.toFixed(2)}|${allocationSubmissionId}`,
                paymentReceivedAt,
                200
            );
            return {
                id: buildApprovedPaymentEntryId(allocationSubmissionId),
                accountNumber: allocation.accountNumber,
                billingMonth: allocation.billingMonth,
                amount: allocation.amount,
                date: paymentDate,
                kind: 'payment',
                type: 'payment',
                direction: 'credit',
                reference,
                description,
                paymentReceivedAt: paymentReceivedAt || undefined,
                recordedAt,
                recordedBy: {
                    id: String(payload.reviewer?.id || ''),
                    username: payload.reviewer?.username || null,
                    name: payload.reviewer?.name || null,
                    role: payload.reviewer?.role || null
                },
                payer: sanitizeString(payload.payer) || customerName,
                status: 'Approved',
                paymentMethod: 'gcash',
                fingerprint
            };
        });
        const entryIds = new Set(entries.map((entry) => entry.id));
        const entryMatches = (existing, expected) => (
            String(existing?.accountNumber ?? existing?.account_number ?? '') === expected.accountNumber
            && Number(existing?.amount) === expected.amount
            && normalizeApprovedPaymentReferenceKey(existing?.reference) === referenceKey
        );
        let resultEntries = entries;
        let inserted = false;
        const relational = await isRelationalReady();

        if (relational) {
            const result = await withTransaction(async (connection) => {
                const placeholders = entries.map(() => '?').join(', ');
                const [existingRows] = await connection.query(
                    `SELECT
                         id,
                         account_number AS accountNumber,
                         amount,
                         date,
                         reference,
                         or_number AS orNumber,
                         description,
                         recorded_at AS recordedAt,
                         recorded_by_username AS recordedByUsername,
                         recorded_by_name AS recordedByName,
                         payment_method AS paymentMethod
                     FROM payment_entries
                     WHERE branch_id = ?
                       AND id IN (${placeholders})
                     FOR UPDATE`,
                    [branchId, ...entries.map((entry) => entry.id)]
                );
                const existingById = new Map((existingRows || []).map((entry) => [String(entry.id), entry]));
                if (existingById.size) {
                    const allMatch = existingById.size === entries.length
                        && entries.every((entry) => entryMatches(existingById.get(entry.id), entry));
                    if (!allMatch) throw createError(409, 'The GCash allocation group is only partially recorded or conflicts with stored payments.');
                    return { entries: entries.map((entry) => existingById.get(entry.id)), inserted: false };
                }

                const [duplicateRows] = await connection.query(
                    `SELECT
                         pe.id,
                         pe.account_number AS accountNumber,
                         pe.amount,
                         pe.date,
                         pe.reference,
                         pe.or_number AS orNumber,
                         pe.description,
                         pe.recorded_at AS recordedAt,
                         pe.recorded_by_username AS recordedByUsername,
                         pe.recorded_by_name AS recordedByName,
                         pe.payment_method AS paymentMethod,
                         c.name AS customerName,
                         c.first_name AS firstName,
                         c.last_name AS lastName
                     FROM payment_entries pe
                     LEFT JOIN customers c
                       ON c.account_number = pe.account_number
                      AND c.branch_id = pe.branch_id
                     WHERE pe.branch_id = ?
                       AND (
                           REPLACE(REPLACE(UPPER(pe.reference), '-', ''), ' ', '') = ?
                           OR REPLACE(REPLACE(UPPER(pe.or_number), '-', ''), ' ', '') = ?
                       )
                     ORDER BY pe.recorded_at DESC, pe.date DESC
                     LIMIT 1
                     FOR UPDATE`,
                    [branchId, referenceKey, referenceKey]
                );
                const duplicate = (duplicateRows || [])[0];
                if (duplicate) {
                    const duplicateCustomerName = sanitizeString(duplicate.customerName)
                        || [duplicate.firstName, duplicate.lastName].map(sanitizeString).filter(Boolean).join(' ');
                    throw createApprovedPaymentDuplicateError({
                        accountNumber: duplicate.accountNumber,
                        entry: duplicate,
                        customerName: duplicateCustomerName
                    });
                }

                for (const [entryIndex, entry] of entries.entries()) {
                    await assignEntryNumbers(connection, entry);
                    if (entryIndex === 0) {
                        await assertEntryNumbersAvailable(connection, branchId, entry);
                    } else {
                        const sharedReference = entry.reference;
                        entry.reference = null;
                        try {
                            await assertEntryNumbersAvailable(connection, branchId, entry);
                        } finally {
                            entry.reference = sharedReference;
                        }
                    }
                    await insertPaymentEntry(entry, branchId, entry.accountNumber, connection);
                }
                return { entries, inserted: true };
            });
            resultEntries = result.entries;
            inserted = result.inserted;
        } else {
            const payments = await readPayments(branchId);
            const storedEntries = Object.entries(payments).flatMap(([accountNumber, record]) => (
                (Array.isArray(record?.history) ? record.history : []).map((entry) => ({ accountNumber, entry }))
            ));
            const existingById = new Map(storedEntries
                .filter(({ entry }) => entryIds.has(String(entry?.id || '')))
                .map(({ accountNumber, entry }) => [String(entry.id), { ...entry, accountNumber }]));
            if (existingById.size) {
                const allMatch = existingById.size === entries.length
                    && entries.every((entry) => entryMatches(existingById.get(entry.id), entry));
                if (!allMatch) throw createError(409, 'The GCash allocation group is only partially recorded or conflicts with stored payments.');
                return { entries: entries.map((entry) => existingById.get(entry.id)), inserted: false, idempotent: true };
            }

            const duplicate = storedEntries.find(({ entry }) => {
                const candidates = [entry?.reference, entry?.orNumber, entry?.or_number]
                    .map(normalizeApprovedPaymentReferenceKey)
                    .filter(Boolean);
                return candidates.includes(referenceKey);
            });
            if (duplicate) {
                const duplicateCustomer = customerByAccount.get(duplicate.accountNumber) || {};
                throw createApprovedPaymentDuplicateError({
                    ...duplicate,
                    customerName: sanitizeString(duplicateCustomer.name)
                        || [duplicateCustomer.firstName, duplicateCustomer.lastName]
                            .map(sanitizeString)
                            .filter(Boolean)
                            .join(' ')
                });
            }

            entries.forEach((entry) => {
                if (!payments[entry.accountNumber]) payments[entry.accountNumber] = { history: [] };
                payments[entry.accountNumber].history.unshift(entry);
            });
            await writePayments(payments);
            resultEntries = entries;
            inserted = true;
            for (const entry of entries) {
                try {
                    await applyReenableOnPaid(entry.accountNumber, branchId, payments, entry);
                } catch (error) {
                    console.error('GCash allocation service re-enable failed:', error);
                }
            }
        }

        if (inserted) {
            if (relational) {
                for (const entry of resultEntries) {
                    try {
                        await applyReenableOnPaid(entry.accountNumber, branchId, null, entry);
                    } catch (error) {
                        console.error('GCash allocation service re-enable failed:', error);
                    }
                }
            }
            for (const entry of resultEntries) {
                try {
                    await maybeExtendPrepaidExpiryOnPayment(entry.accountNumber, entry, branchId);
                } catch (error) {
                    console.error('GCash allocation prepaid expiry update failed:', error);
                }
            }
            try {
                triggerBranchServiceRefresh(branchId, source === 'gcash-history'
                    ? 'gcash-history-payment-posted'
                    : 'payment-confirmation-approved');
            } catch (error) {
                console.error('GCash allocation service refresh failed:', error);
            }
        }
        return { entries: resultEntries, inserted, idempotent: !inserted };
    });
    approvedProofPaymentQueue = operation.catch(() => {});
    return operation;
};

module.exports = router;
module.exports.handleXenditWebhook = handleXenditWebhook;
module.exports.recordApprovedProofPayment = recordApprovedProofPayment;
module.exports.recordApprovedProofPayments = recordApprovedProofPayments;
module.exports.buildPaymentImportGcashReconciliationPlan = buildPaymentImportGcashReconciliationPlan;
module.exports.buildExistingPaymentHistoryGcashReconciliationPlan = buildExistingPaymentHistoryGcashReconciliationPlan;
module.exports.getExistingPaymentHistoryGcashMatches = getExistingPaymentHistoryGcashMatches;
module.exports.reconcileExistingPaymentHistoryWithGcashTransactions = reconcileExistingPaymentHistoryWithGcashTransactions;
module.exports.importPaymentRecordsFromExcel = importPaymentRecordsFromExcel;
module.exports.getPostedGcashPaymentBindings = getPostedGcashPaymentBindings;
module.exports.listPostedGcashPaymentBindings = listPostedGcashPaymentBindings;
module.exports.getPaymentHistoryEditBindOptions = getPaymentHistoryEditBindOptions;
module.exports.editAndBindPaymentHistoryEntry = editAndBindPaymentHistoryEntry;
module.exports.isPendingGcashPaymentEntry = isPendingGcashPaymentEntry;
module.exports.listPendingGcashPayments = listPendingGcashPayments;
module.exports.getPendingGcashBindOptions = getPendingGcashBindOptions;
module.exports.bindPendingGcashPayment = bindPendingGcashPayment;
module.exports.normalizeManualPaymentReferenceKey = normalizeManualPaymentReferenceKey;
module.exports.paymentReferencesMatch = paymentReferencesMatch;
module.exports.findManualPaymentReferenceConflict = findManualPaymentReferenceConflict;
module.exports.getStoredManualPaymentReferenceConflict = getStoredManualPaymentReferenceConflict;
