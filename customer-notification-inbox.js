const crypto = require('crypto');
const { readJson, writeJson } = require('./data-store');

const CUSTOMER_NOTIFICATION_INBOX_KEY = 'customer_notification_inbox';
const MAX_NOTIFICATIONS_PER_CUSTOMER = 200;
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_SOURCE_LENGTH = 80;
const MAX_TONE_LENGTH = 40;
const MAX_DATA_KEYS = 40;
const MAX_DATA_VALUE_LENGTH = 500;

const trimLimit = (value, limit = 0) => {
    const text = String(value == null ? '' : value).trim();
    return limit > 0 ? text.slice(0, limit) : text;
};

const defaultStore = () => ({
    accounts: {}
});

const getCustomerAccountNumber = (value = {}) =>
    trimLimit(value.accountNumber || value.account_number || value.customerAccount || value.customer_account_number, 20);

const getCustomerDisplayName = (value = {}) => {
    const explicit = trimLimit(value.customerName || value.name || value.recipientLabel, 200);
    if (explicit) return explicit;
    return trimLimit(`${value.firstName || value.first_name || ''} ${value.lastName || value.last_name || ''}`, 200);
};

const getBranchId = (value = {}) => {
    const branchId = Number(value.branchId || value.branch_id);
    return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
};

const makeNotificationId = () => {
    if (typeof crypto.randomUUID === 'function') return `cin-${crypto.randomUUID()}`;
    return `cin-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
};

const normalizeDataPayload = (data = {}) => {
    const normalized = {};
    Object.entries(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
        .slice(0, MAX_DATA_KEYS)
        .forEach(([key, value]) => {
            const safeKey = trimLimit(key, 80);
            if (!safeKey || safeKey.startsWith('google.') || safeKey.startsWith('gcm.')) return;
            if (value === undefined || value === null) return;
            if (typeof value === 'object') {
                normalized[safeKey] = trimLimit(JSON.stringify(value), MAX_DATA_VALUE_LENGTH);
                return;
            }
            normalized[safeKey] = trimLimit(value, MAX_DATA_VALUE_LENGTH);
        });
    return normalized;
};

const normalizeNotificationEntry = (entry = {}) => {
    const accountNumber = getCustomerAccountNumber(entry);
    const title = trimLimit(entry.title || 'Billing Notification', MAX_TITLE_LENGTH) || 'Billing Notification';
    const message = trimLimit(entry.message || entry.body, MAX_MESSAGE_LENGTH);
    const createdAt = entry.createdAt || entry.sentAt || new Date().toISOString();
    return {
        id: trimLimit(entry.id, 80) || makeNotificationId(),
        accountNumber,
        customerName: getCustomerDisplayName(entry),
        branchId: getBranchId(entry),
        title,
        message,
        body: message,
        tone: trimLimit(entry.tone || entry.data?.tone || 'info', MAX_TONE_LENGTH) || 'info',
        source: trimLimit(entry.source || entry.data?.type || 'push', MAX_SOURCE_LENGTH) || 'push',
        notificationId: trimLimit(entry.notificationId || entry.data?.notificationId, 120),
        data: normalizeDataPayload(entry.data),
        createdAt,
        sentAt: entry.sentAt || createdAt,
        readAt: entry.readAt || null
    };
};

const normalizeNotificationList = (value = []) => {
    const list = Array.isArray(value) ? value : [];
    return list
        .map(normalizeNotificationEntry)
        .filter((entry) => entry.accountNumber && entry.message)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, MAX_NOTIFICATIONS_PER_CUSTOMER);
};

const normalizeStore = (value = {}) => {
    const accounts = {};
    const sourceAccounts = value?.accounts && typeof value.accounts === 'object' ? value.accounts : {};
    Object.entries(sourceAccounts).forEach(([accountNumber, notifications]) => {
        const safeAccount = trimLimit(accountNumber, 20);
        if (!safeAccount) return;
        accounts[safeAccount] = normalizeNotificationList(notifications);
    });
    return { accounts };
};

const loadCustomerNotificationStore = async () =>
    normalizeStore(await readJson(CUSTOMER_NOTIFICATION_INBOX_KEY, defaultStore()));

const saveCustomerNotificationStore = async (store) => {
    const normalized = normalizeStore(store);
    await writeJson(CUSTOMER_NOTIFICATION_INBOX_KEY, normalized);
    return normalized;
};

const sanitizeNotification = (entry = {}) => {
    const normalized = normalizeNotificationEntry(entry);
    return {
        id: normalized.id,
        accountNumber: normalized.accountNumber,
        customerName: normalized.customerName,
        branchId: normalized.branchId,
        title: normalized.title,
        message: normalized.message,
        body: normalized.body,
        tone: normalized.tone,
        source: normalized.source,
        notificationId: normalized.notificationId,
        data: normalized.data,
        createdAt: normalized.createdAt,
        sentAt: normalized.sentAt,
        readAt: normalized.readAt,
        isRead: Boolean(normalized.readAt)
    };
};

const listCustomerNotifications = async (customer = {}, options = {}) => {
    const accountNumber = getCustomerAccountNumber(customer);
    if (!accountNumber) {
        return { notifications: [], unreadCount: 0, totalCount: 0 };
    }
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), MAX_NOTIFICATIONS_PER_CUSTOMER);
    const includeRead = options.includeRead !== false;
    const store = await loadCustomerNotificationStore();
    const allNotifications = normalizeNotificationList(store.accounts[accountNumber] || []);
    const filtered = includeRead
        ? allNotifications
        : allNotifications.filter((entry) => !entry.readAt);
    return {
        notifications: filtered.slice(0, limit).map(sanitizeNotification),
        unreadCount: allNotifications.filter((entry) => !entry.readAt).length,
        totalCount: allNotifications.length
    };
};

const appendCustomerNotificationsForRecipients = async ({
    recipients = [],
    title = '',
    message = '',
    body = '',
    tone = '',
    source = '',
    notificationId = '',
    data = {},
    sentAt = ''
} = {}) => {
    const notificationMessage = trimLimit(message || body, MAX_MESSAGE_LENGTH);
    if (!notificationMessage) return [];

    const recipientsByAccount = new Map();
    (Array.isArray(recipients) ? recipients : []).forEach((recipient) => {
        const accountNumber = getCustomerAccountNumber(recipient);
        if (!accountNumber || recipientsByAccount.has(accountNumber)) return;
        recipientsByAccount.set(accountNumber, recipient || {});
    });
    if (!recipientsByAccount.size) return [];

    const now = new Date().toISOString();
    const store = await loadCustomerNotificationStore();
    const accounts = { ...store.accounts };
    const saved = [];

    recipientsByAccount.forEach((recipient, accountNumber) => {
        const entry = normalizeNotificationEntry({
            ...recipient,
            accountNumber,
            title,
            message: notificationMessage,
            tone,
            source,
            notificationId,
            data,
            sentAt: sentAt || data?.sentAt || now,
            createdAt: now
        });
        const current = normalizeNotificationList(accounts[accountNumber] || []);
        accounts[accountNumber] = [entry, ...current].slice(0, MAX_NOTIFICATIONS_PER_CUSTOMER);
        saved.push(sanitizeNotification(entry));
    });

    await saveCustomerNotificationStore({ accounts });
    return saved;
};

const markCustomerNotificationRead = async (customer = {}, notificationId = '') => {
    const accountNumber = getCustomerAccountNumber(customer);
    const targetId = trimLimit(notificationId, 80);
    if (!accountNumber || !targetId) {
        return { notification: null, unreadCount: 0, totalCount: 0 };
    }

    const store = await loadCustomerNotificationStore();
    const current = normalizeNotificationList(store.accounts[accountNumber] || []);
    let updatedNotification = null;
    const now = new Date().toISOString();
    const next = current.map((entry) => {
        if (entry.id !== targetId) return entry;
        updatedNotification = { ...entry, readAt: entry.readAt || now };
        return updatedNotification;
    });

    if (updatedNotification) {
        await saveCustomerNotificationStore({
            accounts: {
                ...store.accounts,
                [accountNumber]: next
            }
        });
    }

    const unreadCount = next.filter((entry) => !entry.readAt).length;
    return {
        notification: updatedNotification ? sanitizeNotification(updatedNotification) : null,
        unreadCount,
        totalCount: next.length
    };
};

const markAllCustomerNotificationsRead = async (customer = {}) => {
    const accountNumber = getCustomerAccountNumber(customer);
    if (!accountNumber) {
        return { updatedCount: 0, unreadCount: 0, totalCount: 0 };
    }

    const store = await loadCustomerNotificationStore();
    const current = normalizeNotificationList(store.accounts[accountNumber] || []);
    const now = new Date().toISOString();
    let updatedCount = 0;
    const next = current.map((entry) => {
        if (entry.readAt) return entry;
        updatedCount += 1;
        return { ...entry, readAt: now };
    });

    if (updatedCount) {
        await saveCustomerNotificationStore({
            accounts: {
                ...store.accounts,
                [accountNumber]: next
            }
        });
    }

    return {
        updatedCount,
        unreadCount: 0,
        totalCount: next.length
    };
};

module.exports = {
    CUSTOMER_NOTIFICATION_INBOX_KEY,
    appendCustomerNotificationsForRecipients,
    listCustomerNotifications,
    loadCustomerNotificationStore,
    markAllCustomerNotificationsRead,
    markCustomerNotificationRead,
    sanitizeNotification,
    saveCustomerNotificationStore
};
