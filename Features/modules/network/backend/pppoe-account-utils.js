const normalizePppoeUsername = (value) => String(value || '').trim();
const normalizePppoeUsernameKey = (value) => normalizePppoeUsername(value).toLowerCase();
const normalizePppoeRouterId = (value, fallback = '') => String(value || fallback || '').trim();
const normalizePppoeSecretId = (value) => String(value || '').trim();

const normalizePppoeAccountStatus = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'active') return 'online';
    if (normalized === 'inactive') return 'disabled';
    return normalized;
};

const statusPriority = (value = '') => {
    const normalized = normalizePppoeAccountStatus(value);
    if (normalized === 'online') return 3;
    if (normalized === 'offline') return 2;
    if (normalized === 'disabled') return 1;
    return 0;
};

const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const limitSessionHistory = (history = [], limit = 20) => (
    (Array.isArray(history) ? history : []).filter(Boolean).slice(-limit)
);

const mergeSessionHistory = (existing = {}, incoming = {}) => {
    const incomingHistory = limitSessionHistory(incoming?.pppoeSessionHistory);
    if (incomingHistory.length) return incomingHistory;
    return limitSessionHistory(existing?.pppoeSessionHistory);
};

const pickNonEmpty = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (text) return value;
    }
    return '';
};

const pickLatestDate = (...values) => {
    let best = '';
    let bestTime = Number.NEGATIVE_INFINITY;
    values.forEach((value) => {
        const text = String(value || '').trim();
        if (!text) return;
        const parsed = Date.parse(text);
        if (!Number.isNaN(parsed) && parsed >= bestTime) {
            bestTime = parsed;
            best = value;
            return;
        }
        if (!best) best = value;
    });
    return best;
};

const pickPreferredStatus = (left = '', right = '') => {
    const leftNormalized = normalizePppoeAccountStatus(left);
    const rightNormalized = normalizePppoeAccountStatus(right);
    return rightNormalized || leftNormalized || '';
};

const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source || {}, key);

const readRouterDisabledFlag = (entry = {}) => (
    entry?.routerDisabled === true
    || entry?.disabled === true
    || String(entry?.disabled || '').trim().toLowerCase() === 'true'
    || normalizePppoeAccountStatus(entry?.status) === 'disabled'
);

const mergeRouterDisabledFlag = (existing = {}, incoming = {}) => {
    const incomingIsAuthoritative =
        hasOwn(incoming, 'routerDisabled')
        || hasOwn(incoming, 'disabled')
        || Boolean(String(incoming?.status || '').trim());
    return incomingIsAuthoritative
        ? readRouterDisabledFlag(incoming)
        : readRouterDisabledFlag(existing);
};

const sessionUsageTotal = (entry = {}) => {
    const safeEntry = entry && typeof entry === 'object' ? entry : {};
    const direct = toFiniteNumber(safeEntry.totalBytes ?? safeEntry.sessionTotalBytes);
    if (direct > 0) return direct;
    return toFiniteNumber(safeEntry.rxBytes ?? safeEntry.sessionRxBytes) + toFiniteNumber(safeEntry.txBytes ?? safeEntry.sessionTxBytes);
};

const buildPppoeAccountKey = (entry = {}, fallbackRouterId = '') => {
    const routerId = normalizePppoeRouterId(entry?.routerId, fallbackRouterId);
    const secretId = normalizePppoeSecretId(entry?.secretId || entry?.['.id']);
    if (secretId) return `${routerId}::id:${secretId}`;
    const usernameKey = normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user);
    return usernameKey ? `${routerId}::user:${usernameKey}` : '';
};

const mergeActiveSessionEntries = (existing = {}, incoming = {}) => {
    const safeExisting = existing && typeof existing === 'object' ? existing : {};
    const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};
    const existingUsage = sessionUsageTotal(safeExisting);
    const incomingUsage = sessionUsageTotal(safeIncoming);
    const preferred = incomingUsage >= existingUsage ? safeIncoming : safeExisting;
    const fallback = preferred === safeIncoming ? safeExisting : safeIncoming;
    const existingSessionCount = Math.max(toFiniteNumber(safeExisting.sessionCount), 1);
    const incomingSessionCount = Math.max(toFiniteNumber(safeIncoming.sessionCount), 1);
    return {
        ...fallback,
        ...preferred,
        username: normalizePppoeUsername(preferred.username || preferred.name || preferred.user || fallback.username || fallback.name || fallback.user),
        address: pickNonEmpty(preferred.address, fallback.address, preferred['remote-address'], fallback['remote-address']),
        callerId: pickNonEmpty(preferred.callerId, fallback.callerId, preferred['caller-id'], fallback['caller-id']),
        uptime: pickNonEmpty(preferred.uptime, fallback.uptime, preferred['session-uptime'], fallback['session-uptime']),
        interfaceName: pickNonEmpty(preferred.interfaceName, fallback.interfaceName, preferred.interface, fallback.interface),
        rxBytes: toFiniteNumber(safeExisting.rxBytes) + toFiniteNumber(safeIncoming.rxBytes),
        txBytes: toFiniteNumber(safeExisting.txBytes) + toFiniteNumber(safeIncoming.txBytes),
        totalBytes: existingUsage + incomingUsage,
        rxPackets: toFiniteNumber(safeExisting.rxPackets) + toFiniteNumber(safeIncoming.rxPackets),
        txPackets: toFiniteNumber(safeExisting.txPackets) + toFiniteNumber(safeIncoming.txPackets),
        totalPackets: toFiniteNumber(safeExisting.totalPackets) + toFiniteNumber(safeIncoming.totalPackets),
        liveRxBytesPerSecond: toFiniteNumber(preferred.liveRxBytesPerSecond),
        liveTxBytesPerSecond: toFiniteNumber(preferred.liveTxBytesPerSecond),
        liveRxPacketsPerSecond: toFiniteNumber(preferred.liveRxPacketsPerSecond),
        liveTxPacketsPerSecond: toFiniteNumber(preferred.liveTxPacketsPerSecond),
        sessionCount: existingSessionCount + incomingSessionCount
    };
};

const dedupeActivePppoeSessions = (sessions = []) => {
    const order = [];
    const byKey = new Map();
    (Array.isArray(sessions) ? sessions : []).forEach((session) => {
        if (!session || typeof session !== 'object') return;
        const username = normalizePppoeUsername(session.username || session.name || session.user);
        if (!username) return;
        const key = normalizePppoeUsernameKey(username);
        const normalized = {
            ...session,
            username,
            sessionCount: Math.max(toFiniteNumber(session?.sessionCount), 1)
        };
        if (!byKey.has(key)) {
            order.push(key);
            byKey.set(key, normalized);
            return;
        }
        byKey.set(key, mergeActiveSessionEntries(byKey.get(key), normalized));
    });
    return order.map((key) => byKey.get(key)).filter(Boolean);
};

const mergePppoeAccountEntries = (existing = {}, incoming = {}, fallbackRouterId = '') => {
    const safeExisting = existing && typeof existing === 'object' ? existing : {};
    const safeIncoming = incoming && typeof incoming === 'object' ? incoming : {};
    const existingUsage = sessionUsageTotal(safeExisting);
    const incomingUsage = sessionUsageTotal(safeIncoming);
    const preferred = incomingUsage >= existingUsage ? safeIncoming : safeExisting;
    const fallback = preferred === safeIncoming ? safeExisting : safeIncoming;
    return {
        ...fallback,
        ...preferred,
        username: normalizePppoeUsername(
            safeIncoming.username || safeIncoming.name || safeIncoming.user || safeExisting.username || safeExisting.name || safeExisting.user
        ),
        routerId: normalizePppoeRouterId(safeIncoming.routerId || safeExisting.routerId, fallbackRouterId),
        secretId: normalizePppoeSecretId(safeIncoming.secretId || safeExisting.secretId || safeIncoming['.id'] || safeExisting['.id']),
        customerAccount: pickNonEmpty(
            safeExisting.customerAccount,
            safeIncoming.customerAccount,
            safeExisting.accountNumber,
            safeIncoming.accountNumber,
            safeExisting.customerId,
            safeIncoming.customerId
        ),
        password: pickNonEmpty(preferred.password, fallback.password),
        profile: pickNonEmpty(preferred.profile, fallback.profile),
        pairedCustomer: pickNonEmpty(safeExisting.pairedCustomer, safeIncoming.pairedCustomer),
        pairedPppoe: pickNonEmpty(safeExisting.pairedPppoe, safeIncoming.pairedPppoe),
        status: pickPreferredStatus(safeExisting.status, safeIncoming.status),
        routerDisabled: mergeRouterDisabledFlag(safeExisting, safeIncoming),
        inactiveSince: pickLatestDate(safeExisting.inactiveSince, safeIncoming.inactiveSince),
        currentSessionLoginAt: normalizePppoeAccountStatus(pickPreferredStatus(safeExisting.status, safeIncoming.status)) === 'online'
            ? pickNonEmpty(safeIncoming.currentSessionLoginAt, safeExisting.currentSessionLoginAt)
            : '',
        pppoeSessionHistory: mergeSessionHistory(safeExisting, safeIncoming),
        sessionUptime: pickNonEmpty(preferred.sessionUptime, fallback.sessionUptime, preferred.uptime, fallback.uptime),
        interfaceName: pickNonEmpty(preferred.interfaceName, fallback.interfaceName, preferred.interface, fallback.interface),
        activeAddress: pickNonEmpty(preferred.activeAddress, fallback.activeAddress, preferred.address, fallback.address),
        callerId: pickNonEmpty(preferred.callerId, fallback.callerId, preferred['caller-id'], fallback['caller-id']),
        sessionRxBytes: Math.max(toFiniteNumber(safeExisting.sessionRxBytes), toFiniteNumber(safeIncoming.sessionRxBytes)),
        sessionTxBytes: Math.max(toFiniteNumber(safeExisting.sessionTxBytes), toFiniteNumber(safeIncoming.sessionTxBytes)),
        sessionTotalBytes: Math.max(existingUsage, incomingUsage),
        sessionRxPackets: Math.max(toFiniteNumber(safeExisting.sessionRxPackets), toFiniteNumber(safeIncoming.sessionRxPackets)),
        sessionTxPackets: Math.max(toFiniteNumber(safeExisting.sessionTxPackets), toFiniteNumber(safeIncoming.sessionTxPackets)),
        sessionTotalPackets: Math.max(toFiniteNumber(safeExisting.sessionTotalPackets), toFiniteNumber(safeIncoming.sessionTotalPackets)),
        liveRxBytesPerSecond: toFiniteNumber(preferred.liveRxBytesPerSecond),
        liveTxBytesPerSecond: toFiniteNumber(preferred.liveTxBytesPerSecond),
        liveRxPacketsPerSecond: toFiniteNumber(preferred.liveRxPacketsPerSecond),
        liveTxPacketsPerSecond: toFiniteNumber(preferred.liveTxPacketsPerSecond),
        activeSessionCount: Math.max(
            toFiniteNumber(safeExisting.activeSessionCount),
            toFiniteNumber(safeIncoming.activeSessionCount),
            toFiniteNumber(safeExisting.sessionCount),
            toFiniteNumber(safeIncoming.sessionCount)
        ),
        usageCarryRxBytes: Math.max(toFiniteNumber(safeExisting.usageCarryRxBytes), toFiniteNumber(safeIncoming.usageCarryRxBytes)),
        usageCarryTxBytes: Math.max(toFiniteNumber(safeExisting.usageCarryTxBytes), toFiniteNumber(safeIncoming.usageCarryTxBytes)),
        usageCarryTotalBytes: Math.max(toFiniteNumber(safeExisting.usageCarryTotalBytes), toFiniteNumber(safeIncoming.usageCarryTotalBytes))
    };
};

const dedupePppoeAccounts = (accounts = [], fallbackRouterId = '') => {
    const order = [];
    const byKey = new Map();
    (Array.isArray(accounts) ? accounts : []).forEach((account) => {
        if (!account || typeof account !== 'object') return;
        const username = normalizePppoeUsername(account.username || account.name || account.user);
        if (!username) return;
        const routerId = normalizePppoeRouterId(account.routerId, fallbackRouterId);
        const normalized = {
            ...account,
            username,
            routerId,
            secretId: normalizePppoeSecretId(account.secretId || account['.id'])
        };
        const key = buildPppoeAccountKey(normalized, fallbackRouterId);
        if (!key) return;
        if (!byKey.has(key)) {
            order.push(key);
            byKey.set(key, normalized);
            return;
        }
        byKey.set(key, mergePppoeAccountEntries(byKey.get(key), normalized, fallbackRouterId));
    });
    return order.map((key) => byKey.get(key)).filter(Boolean);
};

module.exports = {
    dedupeActivePppoeSessions,
    dedupePppoeAccounts,
    mergePppoeAccountEntries,
    buildPppoeAccountKey,
    normalizePppoeAccountStatus,
    normalizePppoeRouterId,
    normalizePppoeSecretId,
    normalizePppoeUsername,
    normalizePppoeUsernameKey
};
