const express = require('express');
const crypto = require('crypto');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const customersModule = require('../../customer-management/backend/customers');
const { requireCustomer } = customersModule;
const { getPushStatus, sendToFcmEntries } = require('./firebase-push');
const {
    dedupeFcmTokenEntriesForDelivery,
    getEnabledTokenEntries,
    getRequestDeviceId,
    getRequestFcmToken,
    loadFcmTokenStore,
    registerCustomerFcmToken,
    removeCustomerFcmToken,
    sanitizeFcmTokenEntry,
    saveFcmTokenStore
} = require('./customer-fcm-tokens');
const {
    appendCustomerNotificationsForRecipients,
    listCustomerNotifications,
    markAllCustomerNotificationsRead,
    markCustomerNotificationRead
} = require('./customer-notification-inbox');
const { accountHasRole } = require('../../../../core/security/role-utils');

const STORE_KEY = 'customer_app_settings';
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;
const MAX_BUTTON_LABEL_LENGTH = 24;
const DEFAULT_PUSH_SCHEDULER_TICK_MS = Number.parseInt(process.env.PUSH_SCHEDULER_TICK_MS || '60000', 10) || 60000;
const PUSH_SCHEDULER_TIMEZONE = String(process.env.PUSH_SCHEDULER_TIMEZONE || 'Asia/Manila').trim() || 'Asia/Manila';
const ALLOWED_TONES = new Set(['info', 'billing', 'warning', 'success']);
const ALLOWED_PUSH_TARGETS = new Set(['all', 'branch']);
const ALLOWED_PUSH_RECIPIENT_MODES = new Set(['all', 'area', 'customer']);
const ALLOWED_PUSH_TRIGGER_MODES = new Set(['schedule', 'event']);
const ALLOWED_PUSH_EVENTS = new Set(['billing-date', 'due-date', 'overdue']);
const ALLOWED_DELAY_UNITS = new Set(['minutes', 'hours', 'days']);
const ALLOWED_DELAY_DIRECTIONS = new Set(['before', 'after']);
const MAX_PUSH_NOTIFICATIONS = 100;
const MAX_SELECTED_RECIPIENTS = 500;
const MAX_PUSH_HISTORY = 50;
const MAX_PUSH_HISTORY_RECIPIENTS = 1000;

const router = express.Router();
const publicRouter = express.Router();
let pushSchedulerInterval = null;
let pushSchedulerTickRunning = false;

const defaultSettings = () => ({
    popupReminder: {
        enabled: false,
        title: '',
        message: '',
        buttonLabel: 'OK',
        tone: 'info',
        updatedAt: null,
        updatedBy: null
    },
    pushScheduler: {
        enabled: false,
        time: '09:00',
        target: 'all',
        branchId: null,
        lastRunKey: null,
        lastRunAt: null,
        lastResult: null,
        updatedAt: null,
        updatedBy: null
    },
    pushNotifications: []
});

const trimLimit = (value, limit) => String(value || '').trim().slice(0, limit);

const normalizePopupReminder = (value = {}) => {
    const tone = String(value.tone || '').trim().toLowerCase();
    return {
        enabled: Boolean(value.enabled),
        title: trimLimit(value.title, MAX_TITLE_LENGTH),
        message: trimLimit(value.message, MAX_MESSAGE_LENGTH),
        buttonLabel: trimLimit(value.buttonLabel, MAX_BUTTON_LABEL_LENGTH) || 'OK',
        tone: ALLOWED_TONES.has(tone) ? tone : 'info',
        updatedAt: value.updatedAt || null,
        updatedBy: value.updatedBy || null
    };
};

const normalizeTimeOfDay = (value, fallback = '09:00') => {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return fallback;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const normalizeBranchId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const normalizeLastResult = (value = {}) => {
    if (!value || typeof value !== 'object') return null;
    return {
        ok: Boolean(value.ok),
        requestedCount: Number(value.requestedCount || 0) || 0,
        successCount: Number(value.successCount || 0) || 0,
        failureCount: Number(value.failureCount || 0) || 0,
        prunedCount: Number(value.prunedCount || 0) || 0,
        inboxSavedCount: Number(value.inboxSavedCount || 0) || 0,
        error: trimLimit(value.error || '', 180),
        ranAt: value.ranAt || null,
        mode: String(value.mode || '').trim() || 'scheduled'
    };
};

const normalizePushHistoryRecipient = (value = {}) => ({
    accountNumber: trimLimit(value.accountNumber, 20),
    name: trimLimit(value.name || value.customerName, 120),
    area: trimLimit(value.area, 120)
});

const normalizePushHistoryEntry = (value = {}) => {
    const recipients = Array.isArray(value.recipients) ? value.recipients : [];
    return {
        id: trimLimit(value.id, 80) || makePushNotificationId(),
        ranAt: value.ranAt || value.sentAt || new Date().toISOString(),
        mode: String(value.mode || '').trim() || 'scheduled',
        title: trimLimit(value.title, MAX_TITLE_LENGTH),
        message: trimLimit(value.message, MAX_MESSAGE_LENGTH),
        requestedCount: Number(value.requestedCount || 0) || 0,
        successCount: Number(value.successCount || 0) || 0,
        failureCount: Number(value.failureCount || 0) || 0,
        inboxSavedCount: Number(value.inboxSavedCount || 0) || 0,
        error: trimLimit(value.error || '', 180),
        recipients: recipients
            .map(normalizePushHistoryRecipient)
            .filter((recipient) => recipient.accountNumber)
            .slice(0, MAX_PUSH_HISTORY_RECIPIENTS)
    };
};

const normalizePushHistory = (value = []) => {
    const list = Array.isArray(value) ? value : [];
    return list
        .map(normalizePushHistoryEntry)
        .filter((entry) => entry.ranAt)
        .sort((a, b) => String(b.ranAt || '').localeCompare(String(a.ranAt || '')))
        .slice(0, MAX_PUSH_HISTORY);
};

const makePushNotificationId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
};

const normalizeTextList = (value = [], limit = MAX_SELECTED_RECIPIENTS) => {
    const list = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const normalized = [];
    list.forEach((entry) => {
        const text = String(entry || '').trim().slice(0, 120);
        const key = text.toLowerCase();
        if (!text || seen.has(key)) return;
        seen.add(key);
        normalized.push(text);
    });
    return normalized.slice(0, limit);
};

const normalizeScheduleAt = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return raw.slice(0, 32);
};

const normalizeDelayAmount = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.min(365, Math.floor(amount));
};

const normalizeSentKeys = (value = []) => normalizeTextList(value, 2000);

const normalizePushNotification = (value = {}, defaults = {}) => {
    const recipientMode = String(value.recipientMode || defaults.recipientMode || 'all').trim().toLowerCase();
    const triggerMode = String(value.triggerMode || defaults.triggerMode || 'schedule').trim().toLowerCase();
    const eventType = String(value.eventType || defaults.eventType || 'due-date').trim().toLowerCase();
    const delayUnit = String(value.delayUnit || defaults.delayUnit || 'days').trim().toLowerCase();
    const delayDirection = String(value.delayDirection || defaults.delayDirection || 'after').trim().toLowerCase();
    const tone = String(value.tone || defaults.tone || 'billing').trim().toLowerCase();

    return {
        id: String(value.id || defaults.id || makePushNotificationId()).trim(),
        enabled: value.enabled !== undefined ? Boolean(value.enabled) : (defaults.enabled !== undefined ? Boolean(defaults.enabled) : true),
        title: trimLimit(value.title ?? defaults.title ?? 'Billing Reminder', MAX_TITLE_LENGTH),
        message: trimLimit(value.message ?? defaults.message ?? '', MAX_MESSAGE_LENGTH),
        tone: ALLOWED_TONES.has(tone) ? tone : 'billing',
        recipientMode: ALLOWED_PUSH_RECIPIENT_MODES.has(recipientMode) ? recipientMode : 'all',
        areaNames: normalizeTextList(value.areaNames ?? defaults.areaNames ?? []),
        accountNumbers: normalizeTextList(value.accountNumbers ?? defaults.accountNumbers ?? []),
        triggerMode: ALLOWED_PUSH_TRIGGER_MODES.has(triggerMode) ? triggerMode : 'schedule',
        scheduleAt: normalizeScheduleAt(value.scheduleAt ?? defaults.scheduleAt ?? ''),
        eventType: ALLOWED_PUSH_EVENTS.has(eventType) ? eventType : 'due-date',
        delayAmount: normalizeDelayAmount(value.delayAmount ?? defaults.delayAmount ?? 0),
        delayUnit: ALLOWED_DELAY_UNITS.has(delayUnit) ? delayUnit : 'days',
        delayDirection: ALLOWED_DELAY_DIRECTIONS.has(delayDirection) ? delayDirection : 'after',
        branchId: normalizeBranchId(value.branchId ?? defaults.branchId),
        createdAt: value.createdAt || defaults.createdAt || null,
        createdBy: value.createdBy || defaults.createdBy || null,
        updatedAt: value.updatedAt || defaults.updatedAt || null,
        updatedBy: value.updatedBy || defaults.updatedBy || null,
        lastRunKey: value.lastRunKey || defaults.lastRunKey || null,
        lastRunAt: value.lastRunAt || defaults.lastRunAt || null,
        lastResult: normalizeLastResult(value.lastResult || defaults.lastResult),
        sentKeys: normalizeSentKeys(value.sentKeys || defaults.sentKeys || []),
        history: normalizePushHistory(value.history || defaults.history || [])
    };
};

const normalizePushNotifications = (value = []) => {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const normalized = [];
    list.forEach((entry) => {
        const notification = normalizePushNotification(entry);
        if (!notification.id || seen.has(notification.id)) return;
        seen.add(notification.id);
        normalized.push(notification);
    });
    return normalized.slice(0, MAX_PUSH_NOTIFICATIONS);
};

const normalizePushScheduler = (value = {}) => {
    const target = String(value.target || '').trim().toLowerCase();
    return {
        enabled: Boolean(value.enabled),
        time: normalizeTimeOfDay(value.time),
        target: ALLOWED_PUSH_TARGETS.has(target) ? target : 'all',
        branchId: normalizeBranchId(value.branchId),
        lastRunKey: value.lastRunKey || null,
        lastRunAt: value.lastRunAt || null,
        lastResult: normalizeLastResult(value.lastResult),
        updatedAt: value.updatedAt || null,
        updatedBy: value.updatedBy || null
    };
};

const normalizeSettings = (value = {}) => {
    const defaults = defaultSettings();
    return {
        popupReminder: normalizePopupReminder({
            ...defaults.popupReminder,
            ...(value.popupReminder && typeof value.popupReminder === 'object' ? value.popupReminder : {})
        }),
        pushScheduler: normalizePushScheduler({
            ...defaults.pushScheduler,
            ...(value.pushScheduler && typeof value.pushScheduler === 'object' ? value.pushScheduler : {})
        }),
        pushNotifications: normalizePushNotifications(value.pushNotifications || defaults.pushNotifications)
    };
};

const loadSettings = async () => normalizeSettings(await readJson(STORE_KEY, defaultSettings()));

const saveSettings = async (settings) => {
    const normalized = normalizeSettings(settings);
    await writeJson(STORE_KEY, normalized);
    return normalized;
};

const isAdminRequest = (req) => accountHasRole(req.user, 'Admin');

const requireAdminRequest = (req, res) => {
    if (isAdminRequest(req)) return true;
    res.status(403).json({ ok: false, error: 'Admin access required.' });
    return false;
};

const readBoolean = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';

const selectFcmTokenEntries = (store = {}, filters = {}) => {
    const entries = getEnabledTokenEntries(store);
    const accountNumber = String(filters.accountNumber || '').trim();
    const tokenHash = String(filters.tokenHash || '').trim();
    const branchId = String(filters.branchId || '').trim();

    if (tokenHash) {
        return entries.filter((entry) => String(entry.tokenHash || '').trim() === tokenHash);
    }

    let selected = entries;
    if (accountNumber) {
        selected = selected.filter((entry) => String(entry.accountNumber || '').trim() === accountNumber);
    }
    if (branchId) {
        selected = selected.filter((entry) => String(entry.branchId || '').trim() === branchId);
    }
    const deliveryEntries = dedupeFcmTokenEntriesForDelivery(selected);
    if (!accountNumber && !branchId && !readBoolean(filters.all)) {
        return filters.allowSingleFallback && deliveryEntries.length === 1 ? deliveryEntries : [];
    }
    return deliveryEntries;
};

const pruneInvalidFcmTokens = async (store = {}, invalidTokenHashes = []) => {
    const hashes = new Set((invalidTokenHashes || []).filter(Boolean));
    if (!hashes.size) return 0;
    const tokens = { ...(store.tokens || {}) };
    let removedCount = 0;
    hashes.forEach((hash) => {
        if (tokens[hash]) {
            delete tokens[hash];
            removedCount += 1;
        }
    });
    if (removedCount) {
        await saveFcmTokenStore({ tokens });
    }
    return removedCount;
};

const appendAcceptedPushNotifications = async ({ entries = [], result = {}, title = '', message = '', data = {} } = {}) => {
    if (!Number(result?.successCount || 0)) return [];
    const acceptedTokenHashes = new Set((result.acceptedTokenHashes || []).map((value) => String(value || '').trim()).filter(Boolean));
    const acceptedAccountNumbers = new Set((result.acceptedAccountNumbers || []).map((value) => String(value || '').trim()).filter(Boolean));
    const acceptedEntries = (Array.isArray(entries) ? entries : []).filter((entry) => {
        const tokenHash = String(entry?.tokenHash || '').trim();
        const accountNumber = String(entry?.accountNumber || '').trim();
        if (acceptedTokenHashes.size && tokenHash && acceptedTokenHashes.has(tokenHash)) return true;
        if (acceptedAccountNumbers.size && accountNumber && acceptedAccountNumbers.has(accountNumber)) return true;
        return !acceptedTokenHashes.size && !acceptedAccountNumbers.size && Number(result.successCount || 0) >= entries.length;
    });
    if (!acceptedEntries.length) return [];

    try {
        return await appendCustomerNotificationsForRecipients({
            recipients: acceptedEntries,
            title,
            message,
            tone: data?.tone || '',
            source: data?.type || 'push',
            notificationId: data?.notificationId || '',
            data,
            sentAt: data?.sentAt || new Date().toISOString()
        });
    } catch (error) {
        console.warn('Failed to store customer push notification inbox entries:', error?.message || error);
        return [];
    }
};

const sendPushToSelectedTokens = async ({ req, res, store, entries, title, message, data }) => {
    const deliveryEntries = dedupeFcmTokenEntriesForDelivery(entries);
    if (!deliveryEntries.length) {
        return res.status(404).json({ ok: false, error: 'No registered FCM tokens found for that target.' });
    }

    const result = await sendToFcmEntries(deliveryEntries, { title, body: message }, { data });
    const savedInboxEntries = await appendAcceptedPushNotifications({ entries: deliveryEntries, result, title, message, data });
    const prunedCount = await pruneInvalidFcmTokens(store, result.invalidTokenHashes);
    const errorMessage = result.successCount > 0
        ? ''
        : (result.errors?.[0]?.message || 'Firebase did not accept the notification.');
    return res.json({
        ok: result.successCount > 0,
        push: getPushStatus(),
        requestedCount: result.requestedCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
        prunedCount,
        inboxSavedCount: savedInboxEntries.length,
        error: errorMessage,
        errors: result.errors
    });
};

const getPushSchedulerTargetEntries = (store = {}, scheduler = {}) => {
    if (scheduler.target === 'branch' && scheduler.branchId) {
        return selectFcmTokenEntries(store, { branchId: scheduler.branchId });
    }
    return selectFcmTokenEntries(store, { all: true });
};

const countDeliveryTokenEntries = (store = {}) =>
    dedupeFcmTokenEntriesForDelivery(getEnabledTokenEntries(store)).length;

const getZonedNow = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: PUSH_SCHEDULER_TIMEZONE,
        hour12: false,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    const hour = Number(parts.hour || 0);
    const minute = Number(parts.minute || 0);
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        minuteOfDay: (hour * 60) + minute
    };
};

const parseMinuteOfDay = (timeValue) => {
    const time = normalizeTimeOfDay(timeValue);
    const [hour, minute] = time.split(':').map(Number);
    return (hour * 60) + minute;
};

const buildPushNotificationFromSettings = (settings = {}) => {
    const reminder = normalizePopupReminder(settings.popupReminder || {});
    return {
        title: trimLimit(reminder.title || 'Billing Reminder', MAX_TITLE_LENGTH),
        message: trimLimit(reminder.message || '', MAX_MESSAGE_LENGTH),
        tone: reminder.tone || 'billing'
    };
};

const buildPushRunResult = (result = {}, mode = 'scheduled') => ({
    ok: Number(result.successCount || 0) > 0,
    requestedCount: Number(result.requestedCount || 0) || 0,
    successCount: Number(result.successCount || 0) || 0,
    failureCount: Number(result.failureCount || 0) || 0,
    prunedCount: Number(result.prunedCount || 0) || 0,
    inboxSavedCount: Number(result.inboxSavedCount || 0) || 0,
    acceptedAccountNumbers: normalizeTextList(result.acceptedAccountNumbers || [], MAX_PUSH_HISTORY_RECIPIENTS),
    error: result.error || '',
    ranAt: new Date().toISOString(),
    mode
});

const combinePushResults = (results = []) => {
    const combined = {
        requestedCount: 0,
        successCount: 0,
        failureCount: 0,
        inboxSavedCount: 0,
        acceptedTokenHashes: [],
        acceptedAccountNumbers: [],
        invalidTokenHashes: [],
        errors: []
    };
    const invalidHashes = new Set();
    const acceptedHashes = new Set();
    const acceptedAccounts = new Set();

    results.forEach((result) => {
        combined.requestedCount += Number(result?.requestedCount || 0) || 0;
        combined.successCount += Number(result?.successCount || 0) || 0;
        combined.failureCount += Number(result?.failureCount || 0) || 0;
        combined.inboxSavedCount += Number(result?.inboxSavedCount || 0) || 0;
        (result?.acceptedTokenHashes || []).forEach((hash) => {
            if (hash) acceptedHashes.add(hash);
        });
        (result?.acceptedAccountNumbers || []).forEach((accountNumber) => {
            if (accountNumber) acceptedAccounts.add(accountNumber);
        });
        (result?.invalidTokenHashes || []).forEach((hash) => {
            if (hash) invalidHashes.add(hash);
        });
        combined.errors.push(...(Array.isArray(result?.errors) ? result.errors : []));
    });

    combined.acceptedTokenHashes = Array.from(acceptedHashes);
    combined.acceptedAccountNumbers = Array.from(acceptedAccounts);
    combined.invalidTokenHashes = Array.from(invalidHashes);
    combined.errors = combined.errors.slice(0, 20);
    return combined;
};

const formatPushCurrency = (value, fallback = 'PHP 0.00') => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return fallback;
    return `PHP ${amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
};

const formatPushDate = (value, fallback = 'N/A') => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) {
        const parsed = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw || fallback;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatPushDays = (value, fallback = 'N/A') => {
    const days = Number(value);
    if (!Number.isFinite(days) || days < 0) return fallback;
    const rounded = Math.floor(days);
    return `${rounded} day${rounded === 1 ? '' : 's'}`;
};

const getPushCustomerByAccount = (customers = []) => {
    const byAccount = new Map();
    (Array.isArray(customers) ? customers : []).forEach((customer) => {
        const accountNumber = getCustomerAccountNumber(customer);
        if (accountNumber && !byAccount.has(accountNumber)) {
            byAccount.set(accountNumber, customer);
        }
    });
    return byAccount;
};

const resolvePushCustomerForEntry = (entry = {}, customersByAccount = new Map()) => {
    const accountNumber = String(entry.accountNumber || '').trim();
    return customersByAccount.get(accountNumber) || {
        accountNumber,
        name: entry.customerName || '',
        branchId: entry.branchId || null
    };
};

const buildPushHistoryEntry = ({ notification = {}, runResult = {}, entries = [], customers = [] } = {}) => {
    const acceptedAccounts = new Set(normalizeTextList(runResult.acceptedAccountNumbers || [], MAX_PUSH_HISTORY_RECIPIENTS));
    if (!acceptedAccounts.size && Number(runResult.successCount || 0) > 0) {
        (Array.isArray(entries) ? entries : []).forEach((entry) => {
            const accountNumber = String(entry.accountNumber || '').trim();
            if (accountNumber) acceptedAccounts.add(accountNumber);
        });
    }

    const customersByAccount = getPushCustomerByAccount(customers);
    const entriesByAccount = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const accountNumber = String(entry.accountNumber || '').trim();
        if (accountNumber && !entriesByAccount.has(accountNumber)) entriesByAccount.set(accountNumber, entry);
    });

    const recipients = Array.from(acceptedAccounts).slice(0, MAX_PUSH_HISTORY_RECIPIENTS)
        .map((accountNumber) => {
            const customer = customersByAccount.get(accountNumber) || {};
            const entry = entriesByAccount.get(accountNumber) || {};
            return normalizePushHistoryRecipient({
                accountNumber,
                name: getCustomerName(customer) || entry.customerName || '',
                area: customer.area || entry.area || ''
            });
        })
        .filter((recipient) => recipient.accountNumber);

    return normalizePushHistoryEntry({
        id: makePushNotificationId(),
        ranAt: runResult.ranAt || new Date().toISOString(),
        mode: runResult.mode || 'scheduled',
        title: notification.title || 'Billing Reminder',
        message: notification.message || '',
        requestedCount: runResult.requestedCount,
        successCount: runResult.successCount,
        failureCount: runResult.failureCount,
        inboxSavedCount: runResult.inboxSavedCount,
        error: runResult.error,
        recipients
    });
};

const formatPushTime = (value, fallback = 'N/A') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const buildPushPlaceholderValues = (customer = {}, entry = {}, notification = {}) => {
    const summary = customer.paymentSummary || {};
    const balance = Number(customer.balance ?? summary.balance ?? 0);
    const amountDue = Math.max(Number.isFinite(balance) ? balance : 0, 0);
    const lastPaymentAmountRaw = customer.lastPaymentAmount ?? summary.lastPaymentAmount;
    const hasLastPaymentAmount = lastPaymentAmountRaw !== null &&
        lastPaymentAmountRaw !== undefined &&
        String(lastPaymentAmountRaw).trim() !== '';
    const lastPaymentAmount = Number(lastPaymentAmountRaw);
    const lastPaymentDate = customer.lastPaymentDate || summary.lastPaymentDate || '';
    const customerName = getCustomerName(customer) || entry.customerName || String(entry.accountNumber || '').trim();
    const firstName = String(customer.firstName || customer.first_name || '').trim();
    const lastName = String(customer.lastName || customer.last_name || '').trim();
    const accountNumber = getCustomerAccountNumber(customer) || String(entry.accountNumber || '').trim();
    const scheduledAt = notification.scheduleAt || notification.schedule_at || null;
    const notificationDate = scheduledAt || new Date();

    return {
        customer_name: customerName,
        name: customerName,
        first_name: firstName || customerName.split(/\s+/)[0] || customerName,
        last_name: lastName,
        account_number: accountNumber,
        account: accountNumber,
        plan_name: String(customer.planName || customer.plan_name || '').trim(),
        area_name: String(customer.area || customer.areaName || customer.area_name || '').trim(),
        area: String(customer.area || customer.areaName || customer.area_name || '').trim(),
        amount: hasLastPaymentAmount && Number.isFinite(lastPaymentAmount) ? formatPushCurrency(lastPaymentAmount) : 'N/A',
        payment_amount: hasLastPaymentAmount && Number.isFinite(lastPaymentAmount) ? formatPushCurrency(lastPaymentAmount) : 'N/A',
        last_payment_amount: hasLastPaymentAmount && Number.isFinite(lastPaymentAmount) ? formatPushCurrency(lastPaymentAmount) : 'N/A',
        amount_due: formatPushCurrency(amountDue),
        balance: formatPushCurrency(amountDue),
        current_balance: formatPushCurrency(amountDue),
        due_date: formatPushDate(customer.dueDate || customer.due_date),
        bill_date: formatPushDate(customer.billDate || customer.bill_date),
        payment_date: formatPushDate(lastPaymentDate),
        last_payment_date: formatPushDate(lastPaymentDate),
        date: formatPushDate(notificationDate),
        schedule_date: formatPushDate(scheduledAt),
        maintenance_date: formatPushDate(scheduledAt),
        appointment_date: formatPushDate(scheduledAt),
        start_time: formatPushTime(scheduledAt),
        end_time: 'N/A',
        appointment_window: 'N/A',
        grace_period: formatPushDays(customer.dueOffset ?? customer.due_offset),
        app_version: String(entry.appVersion || '').trim(),
        platform: String(entry.platform || '').trim()
    };
};

const renderPushTemplate = (template, customer = {}, entry = {}, notification = {}) => {
    const values = buildPushPlaceholderValues(customer, entry, notification);
    return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (_match, key) => {
        const normalizedKey = String(key || '').trim().toLowerCase();
        return values[normalizedKey] ?? '';
    });
};

const buildRenderedPushBatches = (entries = [], notification = {}, customers = []) => {
    const customersByAccount = getPushCustomerByAccount(customers);
    const batches = new Map();

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const customer = resolvePushCustomerForEntry(entry, customersByAccount);
        const title = renderPushTemplate(notification.title || 'Billing Reminder', customer, entry, notification)
            || 'Billing Reminder';
        const message = renderPushTemplate(notification.message || notification.body || '', customer, entry, notification);
        const key = JSON.stringify([title, message]);
        const batch = batches.get(key) || { title, message, entries: [] };
        batch.entries.push(entry);
        batches.set(key, batch);
    });

    return Array.from(batches.values()).filter((batch) => batch.message);
};

const sendRenderedPushToEntries = async ({ entries = [], title = '', message = '', customers = [], data = {} } = {}) => {
    const deliveryEntries = dedupeFcmTokenEntriesForDelivery(entries);
    const batches = buildRenderedPushBatches(deliveryEntries, { title, message }, customers);
    if (!batches.length) {
        return {
            requestedCount: 0,
            successCount: 0,
            failureCount: 0,
            invalidTokenHashes: [],
            errors: []
        };
    }

    const results = [];
    for (const batch of batches) {
        const result = await sendToFcmEntries(batch.entries, {
            title: batch.title,
            body: batch.message
        }, { data });
        const savedInboxEntries = await appendAcceptedPushNotifications({
            entries: batch.entries,
            result,
            title: batch.title,
            message: batch.message,
            data
        });
        result.inboxSavedCount = savedInboxEntries.length;
        results.push(result);
    }
    return combinePushResults(results);
};

const persistPushSchedulerRun = async (settings, scheduler, runResult, runKey = null) => {
    const nextScheduler = normalizePushScheduler({
        ...scheduler,
        lastRunKey: runKey || scheduler.lastRunKey || null,
        lastRunAt: runResult.ranAt,
        lastResult: runResult
    });
    return saveSettings({ ...settings, pushScheduler: nextScheduler });
};

const dispatchPushScheduler = async ({ settings, scheduler, mode = 'scheduled', runKey = null, user = null } = {}) => {
    const notification = buildPushNotificationFromSettings(settings);
    if (!notification.message) {
        const runResult = buildPushRunResult({
            error: 'Configure a reminder message before sending scheduled push reminders.'
        }, mode);
        await persistPushSchedulerRun(settings, scheduler, runResult, runKey);
        return runResult;
    }

    const store = await loadFcmTokenStore();
    const entries = getPushSchedulerTargetEntries(store, scheduler);
    if (!entries.length) {
        const runResult = buildPushRunResult({
            error: 'No registered FCM tokens found for the selected scheduler target.'
        }, mode);
        await persistPushSchedulerRun(settings, scheduler, runResult, runKey);
        return runResult;
    }

    const customers = await readPushCustomers(scheduler.target === 'branch' ? scheduler.branchId : null);
    const result = await sendRenderedPushToEntries({
        entries,
        title: notification.title,
        message: notification.message,
        customers,
        data: {
            type: mode === 'manual' ? 'manual_popup_reminder' : 'scheduled_popup_reminder',
            tone: notification.tone,
            target: scheduler.target || 'all',
            branchId: scheduler.branchId || '',
            sentBy: user?.username || user?.id || 'scheduler',
            sentAt: new Date().toISOString()
        }
    });
    const prunedCount = await pruneInvalidFcmTokens(store, result.invalidTokenHashes);
    const runResult = buildPushRunResult({
        ...result,
        prunedCount,
        error: result.successCount > 0
            ? ''
            : (result.errors?.[0]?.message || 'Firebase did not accept the notification.')
    }, mode);
    await persistPushSchedulerRun(settings, scheduler, runResult, runKey);
    return runResult;
};

const runPushSchedulerOnce = async () => {
    if (pushSchedulerTickRunning) return false;
    pushSchedulerTickRunning = true;
    try {
        const settings = await loadSettings();
        const scheduler = normalizePushScheduler(settings.pushScheduler || {});
        let ranAny = false;

        if (scheduler.enabled) {
            const zoned = getZonedNow();
            const scheduledMinute = parseMinuteOfDay(scheduler.time);
            const runKey = `${zoned.dateKey}:${scheduler.time}`;

            if (zoned.minuteOfDay >= scheduledMinute && scheduler.lastRunKey !== runKey) {
                await dispatchPushScheduler({
                    settings,
                    scheduler,
                    mode: 'scheduled',
                    runKey
                });
                ranAny = true;
            }
        }

        const rulesRan = await runPushNotificationRulesOnce(settings);
        return ranAny || rulesRan;
    } catch (error) {
        console.warn('Push scheduler tick failed:', error?.message || error);
        return false;
    } finally {
        pushSchedulerTickRunning = false;
    }
};

const schedulePushScheduler = () => {
    if (pushSchedulerInterval) return pushSchedulerInterval;
    runPushSchedulerOnce().catch((error) => {
        console.warn('Initial push scheduler run failed:', error?.message || error);
    });
    pushSchedulerInterval = setInterval(() => {
        runPushSchedulerOnce().catch((error) => {
            console.warn('Push scheduler interval failed:', error?.message || error);
        });
    }, DEFAULT_PUSH_SCHEDULER_TICK_MS);
    return pushSchedulerInterval;
};

const getCustomerName = (customer = {}) => {
    const explicit = String(customer.name || '').trim();
    if (explicit) return explicit;
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || String(customer.accountNumber || '').trim();
};

const isCreditPaymentEntry = (entry = {}) => {
    const kind = String(entry.kind || entry.type || '').trim().toLowerCase();
    const direction = String(entry.direction || '').trim().toLowerCase();
    return kind === 'payment' || direction === 'credit';
};

const parsePushTimestamp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) {
        const parsed = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const findLatestPaymentEntry = (history = []) => {
    let latest = null;
    (Array.isArray(history) ? history : []).forEach((entry) => {
        if (!isCreditPaymentEntry(entry)) return;
        const entryTime = parsePushTimestamp(entry.date || entry.recordedAt);
        const latestTime = latest ? parsePushTimestamp(latest.date || latest.recordedAt) : -1;
        if (!latest || entryTime >= latestTime) latest = entry;
    });
    return latest;
};

const readPushCustomers = async (branchId = null) => {
    const reader = typeof customersModule.readVisibleCustomers === 'function'
        ? customersModule.readVisibleCustomers
        : customersModule.readCustomers;
    const customers = await reader(branchId || null);
    const list = Array.isArray(customers) ? customers : [];
    if (
        typeof customersModule.readPayments !== 'function' ||
        typeof customersModule.computePaymentSummary !== 'function'
    ) {
        return list;
    }

    const payments = await customersModule.readPayments(branchId || null);
    return list.map((customer) => {
        const accountNumber = getCustomerAccountNumber(customer);
        const history = accountNumber ? (payments?.[accountNumber]?.history || []) : [];
        const summary = customersModule.computePaymentSummary(Array.isArray(history) ? history : []);
        const latestPayment = findLatestPaymentEntry(history);
        return {
            ...customer,
            balance: summary.balance,
            totalCredits: summary.totalCredits,
            lastPaymentAmount: summary.lastPaymentAmount,
            lastPaymentDate: summary.lastPaymentDate,
            lastPaymentKind: summary.lastPaymentKind,
            lastPaymentReference: latestPayment?.reference || latestPayment?.orNumber || '',
            lastPaymentMethod: latestPayment?.paymentMethod || '',
            paymentSummary: summary
        };
    });
};

const getCustomerAccountNumber = (customer = {}) => String(customer.accountNumber || customer.id || '').trim();

const selectPushNotificationAccounts = (notification = {}, customers = []) => {
    if (notification.recipientMode === 'customer') {
        return new Set(normalizeTextList(notification.accountNumbers || []));
    }

    if (notification.recipientMode === 'area') {
        const selectedAreas = new Set(normalizeTextList(notification.areaNames || []).map((area) => area.toLowerCase()));
        return new Set(
            customers
                .filter((customer) => selectedAreas.has(String(customer.area || '').trim().toLowerCase()))
                .map(getCustomerAccountNumber)
                .filter(Boolean)
        );
    }

    return new Set(
        customers
            .map(getCustomerAccountNumber)
            .filter(Boolean)
    );
};

const selectPushNotificationEntries = (store = {}, notification = {}, customers = []) => {
    const branchId = normalizeBranchId(notification.branchId);
    const entries = getEnabledTokenEntries(store)
        .filter((entry) => !branchId || Number(entry.branchId || 0) === branchId);

    if (notification.recipientMode === 'all') {
        return dedupeFcmTokenEntriesForDelivery(entries);
    }

    const accounts = selectPushNotificationAccounts(notification, customers);
    if (!accounts.size) return [];
    return dedupeFcmTokenEntriesForDelivery(
        entries.filter((entry) => accounts.has(String(entry.accountNumber || '').trim()))
    );
};

const parseDateOnly = (value) => {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    const date = new Date(year, month - 1, day, 9, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
};

const buildMonthlyEventDate = (sourceDate, now) => {
    if (!(sourceDate instanceof Date) || Number.isNaN(sourceDate.getTime())) return null;
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(sourceDate.getDate(), lastDay);
    return new Date(year, month, day, 9, 0, 0, 0);
};

const addDelayToDate = (date, notification = {}) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const amount = normalizeDelayAmount(notification.delayAmount);
    const direction = notification.delayDirection === 'before' ? -1 : 1;
    const unit = ALLOWED_DELAY_UNITS.has(notification.delayUnit) ? notification.delayUnit : 'days';
    const next = new Date(date);
    if (unit === 'minutes') next.setMinutes(next.getMinutes() + (amount * direction));
    if (unit === 'hours') next.setHours(next.getHours() + (amount * direction));
    if (unit === 'days') next.setDate(next.getDate() + (amount * direction));
    return next;
};

const getCustomerEventBaseDate = (customer = {}, notification = {}, now = new Date()) => {
    const eventType = notification.eventType || 'due-date';
    const rawDate = eventType === 'billing-date' ? customer.billDate : customer.dueDate;
    const parsed = parseDateOnly(rawDate);
    const monthly = buildMonthlyEventDate(parsed, now);
    if (!monthly) return null;
    if (eventType === 'overdue') {
        monthly.setDate(monthly.getDate() + 1);
    }
    return monthly;
};

const getEventSentKey = (notification = {}, customer = {}, baseDate = new Date()) => {
    const accountNumber = getCustomerAccountNumber(customer);
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    return `${notification.id}:${notification.eventType}:${accountNumber}:${year}-${month}`;
};

const summarizePushSendResult = (result = {}, prunedCount = 0, mode = 'scheduled') => buildPushRunResult({
    ...result,
    prunedCount,
    error: result.successCount > 0
        ? ''
        : (result.errors?.[0]?.message || result.error || 'Firebase did not accept the notification.')
}, mode);

const replaceStoredPushNotification = async (notificationId, updater) => {
    const current = await loadSettings();
    let updatedNotification = null;
    const notifications = normalizePushNotifications(current.pushNotifications || []).map((notification) => {
        if (notification.id !== notificationId) return notification;
        updatedNotification = normalizePushNotification(updater(notification), notification);
        return updatedNotification;
    });
    await saveSettings({ ...current, pushNotifications: notifications });
    return updatedNotification;
};

const sendPushNotificationEntries = async (notification = {}, entries = [], mode = 'scheduled', customers = []) => {
    if (!entries.length) {
        return summarizePushSendResult({
            requestedCount: 0,
            successCount: 0,
            failureCount: 0,
            error: 'No registered FCM tokens found for this notification.'
        }, 0, mode);
    }

    const store = await loadFcmTokenStore();
    const result = await sendRenderedPushToEntries({
        entries,
        title: notification.title || 'Billing Reminder',
        message: notification.message,
        customers,
        data: {
            type: mode === 'manual' ? 'manual_push_notification' : 'scheduled_push_notification',
            notificationId: notification.id,
            triggerMode: notification.triggerMode,
            eventType: notification.eventType || '',
            recipientMode: notification.recipientMode || 'all',
            sentAt: new Date().toISOString()
        }
    });
    const prunedCount = await pruneInvalidFcmTokens(store, result.invalidTokenHashes);
    return summarizePushSendResult(result, prunedCount, mode);
};

const runOnePushNotificationNow = async (notification = {}, mode = 'manual') => {
    const customers = await readPushCustomers(notification.branchId);
    const store = await loadFcmTokenStore();
    const entries = selectPushNotificationEntries(store, notification, customers);
    const runResult = await sendPushNotificationEntries(notification, entries, mode, customers);
    const historyEntry = buildPushHistoryEntry({ notification, runResult, entries, customers });
    await replaceStoredPushNotification(notification.id, (current) => ({
        ...current,
        lastRunAt: runResult.ranAt,
        lastResult: runResult,
        history: [historyEntry, ...(current.history || [])]
    }));
    return runResult;
};

const runScheduledPushNotification = async (notification = {}, now = new Date()) => {
    const scheduleDate = new Date(notification.scheduleAt || '');
    if (Number.isNaN(scheduleDate.getTime()) || now < scheduleDate) return false;
    const runKey = `${notification.id}:schedule:${notification.scheduleAt}`;
    if (notification.lastRunKey === runKey) return false;

    const customers = await readPushCustomers(notification.branchId);
    const store = await loadFcmTokenStore();
    const entries = selectPushNotificationEntries(store, notification, customers);
    const runResult = await sendPushNotificationEntries(notification, entries, 'scheduled', customers);
    const historyEntry = buildPushHistoryEntry({ notification, runResult, entries, customers });
    await replaceStoredPushNotification(notification.id, (current) => ({
        ...current,
        lastRunKey: runKey,
        lastRunAt: runResult.ranAt,
        lastResult: runResult,
        history: [historyEntry, ...(current.history || [])]
    }));
    return true;
};

const runEventPushNotification = async (notification = {}, now = new Date()) => {
    const customers = await readPushCustomers(notification.branchId);
    const selectedAccounts = selectPushNotificationAccounts(notification, customers);
    const sentKeys = new Set(normalizeSentKeys(notification.sentKeys || []));
    const dueCustomers = [];

    customers.forEach((customer) => {
        const accountNumber = getCustomerAccountNumber(customer);
        if (!accountNumber || !selectedAccounts.has(accountNumber)) return;
        const baseDate = getCustomerEventBaseDate(customer, notification, now);
        const triggerAt = addDelayToDate(baseDate, notification);
        if (!triggerAt || now < triggerAt) return;
        const sentKey = getEventSentKey(notification, customer, baseDate);
        if (sentKeys.has(sentKey)) return;
        dueCustomers.push({ customer, sentKey });
    });

    if (!dueCustomers.length) return false;

    const store = await loadFcmTokenStore();
    const dueAccounts = new Set(dueCustomers.map(({ customer }) => getCustomerAccountNumber(customer)));
    const entries = dedupeFcmTokenEntriesForDelivery(getEnabledTokenEntries(store))
        .filter((entry) => !notification.branchId || Number(entry.branchId || 0) === Number(notification.branchId))
        .filter((entry) => dueAccounts.has(String(entry.accountNumber || '').trim()));
    const runResult = await sendPushNotificationEntries(
        notification,
        entries,
        'event',
        dueCustomers.map(({ customer }) => customer)
    );
    const historyEntry = buildPushHistoryEntry({
        notification,
        runResult,
        entries,
        customers: dueCustomers.map(({ customer }) => customer)
    });
    const nextSentKeys = runResult.successCount > 0
        ? [...sentKeys, ...dueCustomers.map(({ sentKey }) => sentKey)].slice(-2000)
        : [...sentKeys];

    await replaceStoredPushNotification(notification.id, (current) => ({
        ...current,
        sentKeys: nextSentKeys,
        lastRunAt: runResult.ranAt,
        lastResult: runResult,
        history: [historyEntry, ...(current.history || [])]
    }));
    return true;
};

const runPushNotificationRulesOnce = async (settings = null) => {
    const activeSettings = settings || await loadSettings();
    const notifications = normalizePushNotifications(activeSettings.pushNotifications || []);
    if (!notifications.length) return false;

    const now = new Date();
    let ranAny = false;
    for (const notification of notifications) {
        if (!notification.enabled || !notification.message) continue;
        try {
            const ran = notification.triggerMode === 'event'
                ? await runEventPushNotification(notification, now)
                : await runScheduledPushNotification(notification, now);
            ranAny = ranAny || ran;
        } catch (error) {
            console.warn(`Push notification rule failed (${notification.id}):`, error?.message || error);
        }
    }
    return ranAny;
};

router.get('/settings', async (_req, res, next) => {
    try {
        const settings = await loadSettings();
        res.json({ ok: true, settings });
    } catch (error) {
        next(error);
    }
});

router.get('/fcm-tokens', async (req, res, next) => {
    try {
        const accountFilter = String(req.query?.accountNumber || '').trim();
        const store = await loadFcmTokenStore();
        const tokens = Object.values(store.tokens)
            .filter((entry) => !accountFilter || String(entry.accountNumber || '').trim() === accountFilter)
            .sort((a, b) => String(b.lastSeenAt || b.updatedAt || '').localeCompare(String(a.lastSeenAt || a.updatedAt || '')))
            .map(sanitizeFcmTokenEntry);
        res.json({ ok: true, tokens });
    } catch (error) {
        next(error);
    }
});

router.get('/push/status', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const settings = await loadSettings();
        const store = await loadFcmTokenStore();
        const scheduler = normalizePushScheduler(settings.pushScheduler || {});
        res.json({
            ok: true,
            push: getPushStatus(),
            scheduler,
            tokenCount: countDeliveryTokenEntries(store),
            targetTokenCount: getPushSchedulerTargetEntries(store, scheduler).length,
            timezone: PUSH_SCHEDULER_TIMEZONE
        });
    } catch (error) {
        next(error);
    }
});

router.put('/push-scheduler', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const current = await loadSettings();
        const target = String(req.body?.target || current.pushScheduler?.target || 'all').trim().toLowerCase();
        const branchId = target === 'branch'
            ? normalizeBranchId(req.user?.branchId || req.body?.branchId || current.pushScheduler?.branchId)
            : null;

        if (target === 'branch' && !branchId) {
            return res.status(400).json({ ok: false, error: 'Your account is not assigned to a branch.' });
        }

        const pushScheduler = normalizePushScheduler({
            ...current.pushScheduler,
            ...(req.body && typeof req.body === 'object' ? req.body : {}),
            target,
            branchId,
            updatedAt: new Date().toISOString(),
            updatedBy: req.user?.username || req.user?.name || req.user?.id || null
        });

        if (pushScheduler.enabled && !buildPushNotificationFromSettings(current).message) {
            return res.status(400).json({ ok: false, error: 'Save a reminder message before enabling scheduled push.' });
        }

        const settings = await saveSettings({ ...current, pushScheduler });
        const store = await loadFcmTokenStore();
        res.json({
            ok: true,
            pushScheduler: settings.pushScheduler,
            tokenCount: countDeliveryTokenEntries(store),
            targetTokenCount: getPushSchedulerTargetEntries(store, settings.pushScheduler).length,
            timezone: PUSH_SCHEDULER_TIMEZONE
        });
    } catch (error) {
        next(error);
    }
});

router.post('/push-scheduler/run-now', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const settings = await loadSettings();
        const scheduler = normalizePushScheduler({
            ...settings.pushScheduler,
            target: req.body?.target || settings.pushScheduler?.target || 'all',
            branchId: req.body?.target === 'branch'
                ? normalizeBranchId(req.user?.branchId || settings.pushScheduler?.branchId)
                : settings.pushScheduler?.branchId
        });
        const result = await dispatchPushScheduler({
            settings,
            scheduler,
            mode: 'manual',
            user: req.user
        });
        res.json({ ok: result.ok, result, push: getPushStatus() });
    } catch (error) {
        next(error);
    }
});

const buildPushNotificationFromRequest = (req, existing = {}) => {
    const now = new Date().toISOString();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return normalizePushNotification({
        ...existing,
        ...body,
        id: existing.id || body.id,
        lastRunKey: existing.lastRunKey || null,
        lastRunAt: existing.lastRunAt || null,
        lastResult: existing.lastResult || null,
        sentKeys: existing.sentKeys || [],
        history: existing.history || [],
        branchId: normalizeBranchId(req.user?.branchId || body.branchId || existing.branchId),
        createdAt: existing.createdAt || now,
        createdBy: existing.createdBy || req.user?.username || req.user?.id || null,
        updatedAt: now,
        updatedBy: req.user?.username || req.user?.id || null
    }, existing);
};

const validatePushNotificationPayload = (notification = {}) => {
    if (!notification.message) return 'Message is required.';
    if (notification.recipientMode === 'area' && !notification.areaNames.length) {
        return 'Select at least one area.';
    }
    if (notification.recipientMode === 'customer' && !notification.accountNumbers.length) {
        return 'Select at least one customer.';
    }
    if (notification.triggerMode === 'schedule' && !notification.scheduleAt) {
        return 'Schedule date and time is required.';
    }
    return '';
};

router.get('/push-notifications', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const branchId = normalizeBranchId(req.user?.branchId);
        const [settings, store, customers] = await Promise.all([
            loadSettings(),
            loadFcmTokenStore(),
            readPushCustomers(branchId)
        ]);
        const normalizedCustomers = customers
            .map((customer) => ({
                accountNumber: getCustomerAccountNumber(customer),
                name: getCustomerName(customer),
                area: String(customer.area || '').trim()
            }))
            .filter((customer) => customer.accountNumber);
        const areas = Array.from(new Set(normalizedCustomers.map((customer) => customer.area).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b));

        res.json({
            ok: true,
            push: getPushStatus(),
            notifications: settings.pushNotifications || [],
            customers: normalizedCustomers,
            areas,
            tokenCount: countDeliveryTokenEntries(store)
        });
    } catch (error) {
        next(error);
    }
});

router.post('/push-notifications', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const current = await loadSettings();
        const notifications = normalizePushNotifications(current.pushNotifications || []);
        if (notifications.length >= MAX_PUSH_NOTIFICATIONS) {
            return res.status(400).json({ ok: false, error: `Only ${MAX_PUSH_NOTIFICATIONS} push notifications can be saved.` });
        }

        const notification = buildPushNotificationFromRequest(req);
        const validationError = validatePushNotificationPayload(notification);
        if (validationError) {
            return res.status(400).json({ ok: false, error: validationError });
        }

        const settings = await saveSettings({
            ...current,
            pushNotifications: [notification, ...notifications]
        });
        res.status(201).json({ ok: true, notification, notifications: settings.pushNotifications });
    } catch (error) {
        next(error);
    }
});

router.put('/push-notifications/:id', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const id = String(req.params.id || '').trim();
        const current = await loadSettings();
        const notifications = normalizePushNotifications(current.pushNotifications || []);
        const existing = notifications.find((notification) => notification.id === id);
        if (!existing) {
            return res.status(404).json({ ok: false, error: 'Push notification was not found.' });
        }

        const notification = buildPushNotificationFromRequest(req, existing);
        const validationError = validatePushNotificationPayload(notification);
        if (validationError) {
            return res.status(400).json({ ok: false, error: validationError });
        }

        const settings = await saveSettings({
            ...current,
            pushNotifications: notifications.map((item) => item.id === id ? notification : item)
        });
        res.json({ ok: true, notification, notifications: settings.pushNotifications });
    } catch (error) {
        next(error);
    }
});

router.delete('/push-notifications/:id', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const id = String(req.params.id || '').trim();
        const current = await loadSettings();
        const notifications = normalizePushNotifications(current.pushNotifications || []);
        const nextNotifications = notifications.filter((notification) => notification.id !== id);
        if (nextNotifications.length === notifications.length) {
            return res.status(404).json({ ok: false, error: 'Push notification was not found.' });
        }
        const settings = await saveSettings({ ...current, pushNotifications: nextNotifications });
        res.json({ ok: true, notifications: settings.pushNotifications });
    } catch (error) {
        next(error);
    }
});

router.post('/push-notifications/:id/run-now', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const id = String(req.params.id || '').trim();
        const settings = await loadSettings();
        const notification = normalizePushNotifications(settings.pushNotifications || [])
            .find((entry) => entry.id === id);
        if (!notification) {
            return res.status(404).json({ ok: false, error: 'Push notification was not found.' });
        }
        const result = await runOnePushNotificationNow(notification, 'manual');
        res.json({ ok: result.ok, result });
    } catch (error) {
        next(error);
    }
});

router.post('/push-test', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const title = trimLimit(req.body?.title || 'Billing Notification Test', MAX_TITLE_LENGTH);
        const message = trimLimit(
            req.body?.message || req.body?.body || 'This is a test push notification from the billing system.',
            MAX_MESSAGE_LENGTH
        );
        if (!message) {
            return res.status(400).json({ ok: false, error: 'Notification message is required.' });
        }

        const store = await loadFcmTokenStore();
        const entries = selectFcmTokenEntries(store, {
            accountNumber: req.body?.accountNumber,
            tokenHash: req.body?.tokenHash,
            branchId: req.body?.branchId,
            all: req.body?.all,
            allowSingleFallback: true
        });

        if (!entries.length && countDeliveryTokenEntries(store) > 1 && !req.body?.accountNumber && !req.body?.tokenHash && !req.body?.branchId && !readBoolean(req.body?.all)) {
            return res.status(400).json({ ok: false, error: 'Provide accountNumber, tokenHash, branchId, or all=true.' });
        }

        return sendPushToSelectedTokens({
            req,
            res,
            store,
            entries,
            title,
            message,
            data: {
                type: 'push_test',
                accountNumber: req.body?.accountNumber || '',
                sentBy: req.user?.username || req.user?.id || 'admin',
                sentAt: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
});

router.post('/push-reminder', async (req, res, next) => {
    try {
        if (!requireAdminRequest(req, res)) return;
        const accountNumber = String(req.body?.accountNumber || '').trim();
        if (!accountNumber) {
            return res.status(400).json({ ok: false, error: 'Customer account number is required.' });
        }

        const settings = await loadSettings();
        const reminder = settings.popupReminder || {};
        const title = trimLimit(req.body?.title || reminder.title || 'Billing Reminder', MAX_TITLE_LENGTH);
        const message = trimLimit(req.body?.message || reminder.message || '', MAX_MESSAGE_LENGTH);
        if (!message) {
            return res.status(400).json({ ok: false, error: 'Configure a reminder message before sending push reminders.' });
        }

        const store = await loadFcmTokenStore();
        const entries = selectFcmTokenEntries(store, { accountNumber });
        return sendPushToSelectedTokens({
            req,
            res,
            store,
            entries,
            title,
            message,
            data: {
                type: 'billing_reminder',
                tone: reminder.tone || 'billing',
                accountNumber,
                sentBy: req.user?.username || req.user?.id || 'admin',
                sentAt: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
});

router.put('/popup-reminder', async (req, res, next) => {
    try {
        const current = await loadSettings();
        const popupReminder = normalizePopupReminder({
            ...current.popupReminder,
            ...(req.body && typeof req.body === 'object' ? req.body : {}),
            updatedAt: new Date().toISOString(),
            updatedBy: req.user?.username || req.user?.name || req.user?.id || null
        });

        if (popupReminder.enabled && !popupReminder.message) {
            return res.status(400).json({ ok: false, error: 'Reminder message is required.' });
        }

        const settings = await saveSettings({ ...current, popupReminder });
        res.json({ ok: true, popupReminder: settings.popupReminder });
    } catch (error) {
        next(error);
    }
});

publicRouter.get('/popup-reminder', requireCustomer, async (_req, res, next) => {
    try {
        const settings = await loadSettings();
        const reminder = settings.popupReminder;
        if (!reminder.enabled || !reminder.message) {
            return res.json({ ok: true, popupReminder: null });
        }
        res.json({
            ok: true,
            popupReminder: {
                title: reminder.title,
                message: reminder.message,
                buttonLabel: reminder.buttonLabel,
                tone: reminder.tone,
                updatedAt: reminder.updatedAt
            }
        });
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

publicRouter.post('/fcm-token', requireCustomer, async (req, res, next) => {
    try {
        const token = getRequestFcmToken(req.body || {});
        if (!token) {
            return res.status(400).json({ ok: false, error: 'FCM token is required.' });
        }
        const savedEntry = await registerCustomerFcmToken({
            customer: req.customer,
            body: req.body || {},
            token
        });
        res.json({ ok: true, fcmToken: sanitizeFcmTokenEntry(savedEntry) });
    } catch (error) {
        next(error);
    }
});

publicRouter.delete('/fcm-token', requireCustomer, async (req, res, next) => {
    try {
        const token = getRequestFcmToken(req.body || {});
        const deviceId = getRequestDeviceId(req.body || {});
        if (!token && !deviceId) {
            return res.status(400).json({ ok: false, error: 'FCM token or device ID is required.' });
        }
        const removedCount = await removeCustomerFcmToken({
            customer: req.customer,
            body: req.body || {},
            token
        });
        res.json({ ok: true, removedCount });
    } catch (error) {
        next(error);
    }
});

module.exports = {
    router,
    publicRouter,
    schedulePushScheduler,
    runPushSchedulerOnce
};
