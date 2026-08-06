const crypto = require('crypto');
const express = require('express');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');
const paymentRecords = require('../../billing/backend/payment-records');

const router = express.Router();
const STORE_KEY = 'messenger_reminders';
const STORE_VERSION = 1;
const MANILA_TIME_ZONE = 'Asia/Manila';
const BILLING_EPSILON = 0.005;
const MAX_TEXT_LENGTH = 2400;
const MAX_REASON_LENGTH = 240;
const MAX_HISTORY_RESULTS = 1000;
const BLOCKED_PAYMENT_STATUSES = new Set([
    'pending',
    'pending_approval',
    'pending-approval',
    'pending approval',
    'rejected',
    'cancelled',
    'canceled',
    'void',
    'voided'
]);
const ACTIVE_REMINDER_STATUSES = new Set(['pending']);
const SCHEDULED_STAGES = new Set(['advance', 'due', 'overdue', 'final']);
const STAGE_LABELS = Object.freeze({
    advance: 'Advance reminder',
    due: 'Payment due',
    overdue: 'Overdue follow-up',
    final: 'Final reminder',
    payment_confirmation: 'Payment confirmation'
});

let storeMutationQueue = Promise.resolve();

const trimText = (value, limit = 0) => {
    const text = String(value == null ? '' : value).trim();
    return limit > 0 ? text.slice(0, limit) : text;
};

const normalizeBranchId = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const normalizeRole = (user = {}) => {
    if (accountHasRole(user, 'Admin')) return 'Admin';
    if (accountHasRole(user, 'Collector')) return 'Collector';
    return '';
};

const requireReminderStaff = (req, res, next) => {
    const staffUser = req.user || req.collector || null;
    const role = normalizeRole(staffUser);
    if (!role) {
        return res.status(403).json({ ok: false, error: 'Admin or Collector access is required.' });
    }
    req.user = staffUser;
    req.messengerReminderRole = role;
    return next();
};

const defaultStore = () => ({ version: STORE_VERSION, branches: {} });

const normalizePreference = (value = {}) => ({
    messengerLink: trimText(value.messengerLink || value.messenger_link, 500),
    consentAllowed: value.consentAllowed === true || value.consent_allowed === true,
    consentRecordedAt: trimText(value.consentRecordedAt || value.consent_recorded_at, 40) || null,
    consentRecordedBy: value.consentRecordedBy && typeof value.consentRecordedBy === 'object'
        ? value.consentRecordedBy
        : null,
    updatedAt: trimText(value.updatedAt || value.updated_at, 40) || null
});

const normalizeReminderEntry = (value = {}) => {
    const status = trimText(value.status, 40).toLowerCase() || 'pending';
    return {
        id: trimText(value.id, 100),
        key: trimText(value.key, 500),
        branchId: normalizeBranchId(value.branchId || value.branch_id),
        accountNumber: trimText(value.accountNumber || value.account_number, 40),
        customerName: trimText(value.customerName || value.customer_name, 200),
        area: trimText(value.area, 160),
        stage: trimText(value.stage, 40),
        stageLabel: trimText(value.stageLabel || value.stage_label, 100),
        cycleKey: trimText(value.cycleKey || value.cycle_key, 20),
        amountDue: normalizeAmount(value.amountDue ?? value.amount_due),
        paymentAmount: normalizeAmount(value.paymentAmount ?? value.payment_amount),
        dueDate: trimText(value.dueDate || value.due_date, 20) || null,
        paymentId: trimText(value.paymentId || value.payment_id, 160) || null,
        paymentDate: trimText(value.paymentDate || value.payment_date, 40) || null,
        billingStatus: trimText(value.billingStatus || value.billing_status, 40),
        message: trimText(value.message, MAX_TEXT_LENGTH),
        status,
        createdAt: trimText(value.createdAt || value.created_at, 40) || null,
        updatedAt: trimText(value.updatedAt || value.updated_at, 40) || null,
        openedAt: trimText(value.openedAt || value.opened_at, 40) || null,
        openedBy: value.openedBy && typeof value.openedBy === 'object' ? value.openedBy : null,
        sentAt: trimText(value.sentAt || value.sent_at, 40) || null,
        sentBy: value.sentBy && typeof value.sentBy === 'object' ? value.sentBy : null,
        skippedAt: trimText(value.skippedAt || value.skipped_at, 40) || null,
        skippedBy: value.skippedBy && typeof value.skippedBy === 'object' ? value.skippedBy : null,
        skipReason: trimText(value.skipReason || value.skip_reason, MAX_REASON_LENGTH),
        resolvedAt: trimText(value.resolvedAt || value.resolved_at, 40) || null,
        resolutionReason: trimText(value.resolutionReason || value.resolution_reason, MAX_REASON_LENGTH)
    };
};

const normalizeBranchState = (value = {}) => {
    const preferences = {};
    const sourcePreferences = value.preferences && typeof value.preferences === 'object'
        ? value.preferences
        : {};
    Object.entries(sourcePreferences).forEach(([accountNumber, preference]) => {
        const safeAccount = trimText(accountNumber, 40);
        if (safeAccount) preferences[safeAccount] = normalizePreference(preference);
    });

    const reminders = {};
    const sourceReminders = value.reminders && typeof value.reminders === 'object'
        ? value.reminders
        : {};
    Object.entries(sourceReminders).forEach(([id, reminder]) => {
        const normalized = normalizeReminderEntry({ ...reminder, id: reminder?.id || id });
        if (normalized.id && normalized.accountNumber && normalized.key) {
            reminders[normalized.id] = normalized;
        }
    });
    return {
        preferences,
        reminders,
        lastGeneratedAt: trimText(value.lastGeneratedAt || value.last_generated_at, 40) || null
    };
};

const normalizeStore = (value = {}) => {
    const branches = {};
    const sourceBranches = value.branches && typeof value.branches === 'object'
        ? value.branches
        : {};
    Object.entries(sourceBranches).forEach(([branchId, branchState]) => {
        branches[String(normalizeBranchId(branchId))] = normalizeBranchState(branchState);
    });
    return { version: STORE_VERSION, branches };
};

const loadStore = async () => normalizeStore(await readJson(STORE_KEY, defaultStore()));

const saveStore = async (store) => {
    const normalized = normalizeStore(store);
    await writeJson(STORE_KEY, normalized);
    return normalized;
};

const withStoreMutation = (operation) => {
    const pending = storeMutationQueue.catch(() => {}).then(operation);
    storeMutationQueue = pending;
    return pending;
};

const getManilaDateParts = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: MANILA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(safeDate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        dateKey: `${values.year}-${values.month}-${values.day}`,
        cycleKey: `${values.year}-${values.month}`
    };
};

const shiftCycleKey = (cycleKey, monthsToAdd = 0) => {
    const match = String(cycleKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return '';
    const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(monthsToAdd || 0), 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

const formatMoney = (value) => `₱${normalizeAmount(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;

const formatFriendlyDate = (value) => {
    const raw = trimText(value, 40);
    if (!raw) return 'Not specified';
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+08:00` : raw);
    if (!Number.isFinite(parsed.getTime())) return raw;
    return new Intl.DateTimeFormat('en-PH', {
        timeZone: MANILA_TIME_ZONE,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(parsed);
};

const customerDisplayName = (record = {}) => trimText(
    record.name
    || record.customerName
    || [record.firstName, record.lastName].filter(Boolean).join(' ')
    || record.accountNumber,
    200
);

const customerAccountNumber = (record = {}) => trimText(record.accountNumber || record.account_number, 40);

const customerIsActive = (record = {}) => {
    const status = trimText(record.subscriberStatus || record.customerStatus || record.status, 40).toLowerCase();
    return !status || ['active', 'connected', 'due', 'overdue', 'paid', 'advance'].includes(status);
};

const getBillingBalance = (record = {}) => normalizeAmount(
    record.billingSummary?.endingBalance
    ?? record.paymentBreakdownEndingBalance
    ?? record.endingBalance
    ?? record.balance
);

const getBillingStatus = (record = {}) => trimText(
    record.billingSummary?.billingStatus || record.status,
    40
).toLowerCase();

const getDueDate = (record = {}, cycleKey = '') => {
    const summaryDueDate = trimText(record.billingSummary?.dueDate, 20);
    if (summaryDueDate && (!cycleKey || summaryDueDate.startsWith(cycleKey))) return summaryDueDate;
    const cycleDueDate = trimText(record.billingSummary?.currentCycle?.dueDate, 20);
    if (cycleDueDate && (!cycleKey || cycleDueDate.startsWith(cycleKey))) return cycleDueDate;
    return cycleKey ? `${cycleKey}-01` : (summaryDueDate || cycleDueDate || null);
};

const getActor = (user = {}, role = '') => ({
    id: trimText(user.id || user.userId, 80),
    username: trimText(user.username, 120),
    name: trimText(user.name || user.displayName || user.username, 160),
    role: role || normalizeRole(user)
});

const makeReminderId = (key) => `msgr-${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 24)}`;

const normalizeMessengerLink = (value) => {
    const input = trimText(value, 500);
    if (!input) return '';
    if (/^[A-Za-z0-9._-]{2,160}$/.test(input)) {
        return `https://m.me/${encodeURIComponent(input)}`;
    }
    try {
        const parsed = new URL(input);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString().slice(0, 500);
    } catch {
        return '';
    }
};

const resolveCustomerMessengerLink = (record = {}, preference = {}) => {
    const preferred = normalizeMessengerLink(preference.messengerLink);
    if (preferred) return preferred;
    return normalizeMessengerLink(
        record.messengerLink
        || record.messenger_link
        || record.facebookUsername
        || record.facebook_username
        || record.facebook
        || record.fbUsername
        || record.fb_username
    );
};

const buildScheduledMessage = ({ stage, record, amountDue, dueDate, finalDate, businessName }) => {
    const name = customerDisplayName(record);
    const accountNumber = customerAccountNumber(record);
    const lines = [
        `Good day, ${name}!`,
        '',
        `This is a ${stage === 'advance' ? 'friendly advance payment reminder' : 'friendly payment reminder'} from ${businessName}.`,
        '',
        `Account Name: ${name}`,
        `Account Number: ${accountNumber}`,
        `Amount Due: ${formatMoney(amountDue)}`,
        `Due Date: ${formatFriendlyDate(dueDate)}`,
        '',
        'You may pay through GCash, bank transfer, or our authorized collector. After payment, please send your payment screenshot or reference number together with your account name through Messenger.',
        '',
        'Please disregard this message if you have already paid. Thank you!'
    ];
    if (stage === 'overdue') {
        lines.push('', 'Your account currently has an unpaid balance. Kindly settle it as soon as possible to keep your account updated.');
    }
    if (stage === 'final') {
        lines.push('', `Your account currently has an unpaid balance. Kindly settle it on or before ${formatFriendlyDate(finalDate || dueDate)} to avoid possible temporary service disconnection.`);
    }
    return lines.join('\n').slice(0, MAX_TEXT_LENGTH);
};

const buildPaymentConfirmationMessage = ({ record, payment, amountDue, businessName }) => {
    const name = customerDisplayName(record);
    const accountNumber = customerAccountNumber(record);
    const remainingLine = amountDue > BILLING_EPSILON
        ? `Remaining Balance: ${formatMoney(amountDue)}`
        : 'Account Status: Paid';
    return [
        `Good day, ${name}!`,
        '',
        `${businessName} has recorded your payment.`,
        '',
        `Account Name: ${name}`,
        `Account Number: ${accountNumber}`,
        `Payment Received: ${formatMoney(payment.amount)}`,
        `Payment Date: ${formatFriendlyDate(payment.date || payment.recordedAt)}`,
        remainingLine,
        '',
        'Thank you for your payment! Please keep your reference number or receipt for your records.'
    ].join('\n').slice(0, MAX_TEXT_LENGTH);
};

const resolveScheduledStage = ({ now = new Date(), balance = 0 } = {}) => {
    const parts = getManilaDateParts(now);
    if (parts.day >= 28 && balance <= BILLING_EPSILON) {
        return { stage: 'advance', cycleKey: shiftCycleKey(parts.cycleKey, 1) };
    }
    if (balance <= BILLING_EPSILON) return null;
    if (parts.day <= 4) return { stage: 'due', cycleKey: parts.cycleKey };
    if (parts.day <= 6) return { stage: 'overdue', cycleKey: parts.cycleKey };
    return { stage: 'final', cycleKey: parts.cycleKey };
};

const paymentTimestamp = (entry = {}) => {
    const parsed = new Date(entry.recordedAt || entry.recorded_at || entry.date || '').getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const listConfirmedPaymentsForCycle = (record = {}, cycleKey = '') => {
    const history = Array.isArray(record.history) ? record.history : [];
    return history
        .filter((entry) => {
            const kind = trimText(entry.kind, 40).toLowerCase();
            const direction = trimText(entry.direction, 40).toLowerCase();
            const status = trimText(entry.status, 60).toLowerCase();
            const dateKey = trimText(entry.date || entry.recordedAt || entry.recorded_at, 40).slice(0, 7);
            return kind === 'payment'
                && direction !== 'debit'
                && !BLOCKED_PAYMENT_STATUSES.has(status)
                && dateKey === cycleKey
                && normalizeAmount(entry.amount) > 0;
        })
        .sort((left, right) => paymentTimestamp(left) - paymentTimestamp(right));
};

const buildReminderCandidates = ({ records = [], branchId = 1, businessName = 'THRE3J Internet', now = new Date() } = {}) => {
    const candidates = [];
    const today = getManilaDateParts(now);
    (Array.isArray(records) ? records : []).forEach((record) => {
        const accountNumber = customerAccountNumber(record);
        if (!accountNumber || !customerIsActive(record)) return;
        const balance = getBillingBalance(record);
        const billingStatus = getBillingStatus(record);
        const scheduled = resolveScheduledStage({ now, balance });
        if (scheduled) {
            const dueDate = getDueDate(record, scheduled.cycleKey);
            const amountDue = scheduled.stage === 'advance'
                ? Math.max(normalizeAmount(record.planAmount), 0)
                : Math.max(balance, 0);
            if (amountDue > BILLING_EPSILON) {
                const key = `${branchId}|${accountNumber}|${scheduled.cycleKey}|${scheduled.stage}`;
                candidates.push({
                    id: makeReminderId(key),
                    key,
                    branchId,
                    accountNumber,
                    customerName: customerDisplayName(record),
                    area: trimText(record.area, 160),
                    stage: scheduled.stage,
                    stageLabel: STAGE_LABELS[scheduled.stage],
                    cycleKey: scheduled.cycleKey,
                    amountDue,
                    paymentAmount: 0,
                    dueDate,
                    paymentId: null,
                    paymentDate: null,
                    billingStatus,
                    message: buildScheduledMessage({
                        stage: scheduled.stage,
                        record,
                        amountDue,
                        dueDate,
                        finalDate: `${scheduled.cycleKey}-07`,
                        businessName
                    })
                });
            }
        }

        listConfirmedPaymentsForCycle(record, today.cycleKey).forEach((payment) => {
            const paymentIdentity = trimText(payment.id || payment.fingerprint || payment.reference, 160)
                || `${trimText(payment.date, 20)}-${normalizeAmount(payment.amount)}`;
            const key = `${branchId}|${accountNumber}|payment_confirmation|${paymentIdentity}`;
            candidates.push({
                id: makeReminderId(key),
                key,
                branchId,
                accountNumber,
                customerName: customerDisplayName(record),
                area: trimText(record.area, 160),
                stage: 'payment_confirmation',
                stageLabel: STAGE_LABELS.payment_confirmation,
                cycleKey: today.cycleKey,
                amountDue: Math.max(balance, 0),
                paymentAmount: normalizeAmount(payment.amount),
                dueDate: getDueDate(record, today.cycleKey),
                paymentId: paymentIdentity,
                paymentDate: trimText(payment.date || payment.recordedAt || payment.recorded_at, 40) || null,
                billingStatus,
                message: buildPaymentConfirmationMessage({
                    record,
                    payment,
                    amountDue: Math.max(balance, 0),
                    businessName
                })
            });
        });
    });
    return Array.from(new Map(candidates.map((candidate) => [candidate.key, candidate])).values());
};

const readBusinessName = async () => {
    const profile = await readJson('business-profile', {});
    return trimText(
        profile?.businessName
        || profile?.companyName
        || process.env.BUSINESS_NAME
        || 'THRE3J Internet',
        160
    ) || 'THRE3J Internet';
};

const readCollectorAreas = async (user = {}, branchId = 1) => {
    if (!accountHasRole(user, 'Collector')) return null;
    const collectorId = trimText(user.id || user.userId, 80);
    if (!collectorId) return new Set();
    if (await isRelationalReady()) {
        const [rows] = await query(
            `SELECT area_name AS areaName
             FROM collector_assignments
             WHERE branch_id = ? AND collector_user_id = ?`,
            [branchId, collectorId]
        );
        return new Set((rows || []).map((row) => trimText(row.areaName, 160).toLowerCase()).filter(Boolean));
    }
    const collectorStore = await readJson('collectors', { assignments: {} });
    const areas = Object.entries(collectorStore?.assignments || {})
        .filter(([, ids]) => (Array.isArray(ids) ? ids : [ids]).some((id) => String(id) === collectorId))
        .map(([area]) => trimText(area, 160).toLowerCase())
        .filter(Boolean);
    return new Set(areas);
};

const filterRecordsForUser = async (records = [], user = {}, branchId = 1) => {
    const areas = await readCollectorAreas(user, branchId);
    if (areas === null) return records;
    return records.filter((record) => areas.has(trimText(record.area, 160).toLowerCase()));
};

const loadAuthorizedRecords = async (user = {}) => {
    const branchId = normalizeBranchId(user.branchId);
    const records = await paymentRecords.buildPaymentRecordsForBranch(branchId);
    return {
        branchId,
        records: await filterRecordsForUser(records, user, branchId)
    };
};

const generateQueue = async ({ records = [], branchId = 1, businessName = 'THRE3J Internet', now = new Date() } = {}) => (
    withStoreMutation(async () => {
        const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();
        const store = await loadStore();
        const branchKey = String(branchId);
        const branchState = normalizeBranchState(store.branches[branchKey] || {});
        const candidates = buildReminderCandidates({ records, branchId, businessName, now });
        const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
        let createdCount = 0;
        let updatedCount = 0;
        let resolvedCount = 0;

        candidates.forEach((candidate) => {
            if (SCHEDULED_STAGES.has(candidate.stage)) {
                Object.values(branchState.reminders).forEach((entry) => {
                    if (
                        entry.accountNumber === candidate.accountNumber
                        && entry.cycleKey === candidate.cycleKey
                        && SCHEDULED_STAGES.has(entry.stage)
                        && entry.id !== candidate.id
                        && ACTIVE_REMINDER_STATUSES.has(entry.status)
                    ) {
                        entry.status = 'superseded';
                        entry.resolvedAt = nowIso;
                        entry.resolutionReason = `Replaced by ${candidate.stageLabel}.`;
                        entry.updatedAt = nowIso;
                        resolvedCount += 1;
                    }
                });
            }

            const existing = branchState.reminders[candidate.id];
            if (!existing) {
                branchState.reminders[candidate.id] = normalizeReminderEntry({
                    ...candidate,
                    status: 'pending',
                    createdAt: nowIso,
                    updatedAt: nowIso
                });
                createdCount += 1;
                return;
            }
            if (existing.status === 'pending') {
                branchState.reminders[candidate.id] = normalizeReminderEntry({
                    ...existing,
                    ...candidate,
                    updatedAt: nowIso
                });
                updatedCount += 1;
            }
        });

        Object.values(branchState.reminders).forEach((entry) => {
            if (
                entry.status === 'pending'
                && SCHEDULED_STAGES.has(entry.stage)
                && !candidateKeys.has(entry.key)
                && records.some((record) => customerAccountNumber(record) === entry.accountNumber)
            ) {
                entry.status = 'resolved';
                entry.resolvedAt = nowIso;
                entry.resolutionReason = 'Billing status no longer requires this reminder.';
                entry.updatedAt = nowIso;
                resolvedCount += 1;
            }
        });

        branchState.lastGeneratedAt = nowIso;
        store.branches[branchKey] = branchState;
        await saveStore(store);
        return {
            createdCount,
            updatedCount,
            resolvedCount,
            candidateCount: candidates.length,
            generatedAt: nowIso
        };
    })
);

const entrySortTime = (entry = {}) => String(
    entry.sentAt || entry.skippedAt || entry.updatedAt || entry.createdAt || ''
);

const stageSortRank = (stage) => ({ final: 0, overdue: 1, due: 2, advance: 3, payment_confirmation: 4 }[stage] ?? 9);

const listQueue = async ({ records = [], branchId = 1, view = 'active' } = {}) => {
    const store = await loadStore();
    const branchState = normalizeBranchState(store.branches[String(branchId)] || {});
    const recordByAccount = new Map(records.map((record) => [customerAccountNumber(record), record]));
    const lastSentByAccount = new Map();
    Object.values(branchState.reminders).forEach((entry) => {
        if (!entry.sentAt) return;
        const existing = lastSentByAccount.get(entry.accountNumber);
        if (!existing || String(existing.sentAt).localeCompare(String(entry.sentAt)) < 0) {
            lastSentByAccount.set(entry.accountNumber, entry);
        }
    });

    const requestedView = ['active', 'history', 'all'].includes(view) ? view : 'active';
    const allEntries = Object.values(branchState.reminders)
        .filter((entry) => recordByAccount.has(entry.accountNumber))
        .map((entry) => {
            const record = recordByAccount.get(entry.accountNumber) || {};
            const preference = normalizePreference(branchState.preferences[entry.accountNumber] || {});
            const messengerLink = resolveCustomerMessengerLink(record, preference);
            return {
                ...entry,
                customerName: customerDisplayName(record) || entry.customerName,
                area: trimText(record.area, 160) || entry.area,
                messengerLink,
                consentAllowed: preference.consentAllowed,
                consentRecordedAt: preference.consentRecordedAt,
                canSend: Boolean(messengerLink && preference.consentAllowed),
                setupRequired: !messengerLink || !preference.consentAllowed,
                lastReminderSent: lastSentByAccount.get(entry.accountNumber)?.sentAt || null,
                currentBalance: Math.max(getBillingBalance(record), 0),
                currentBillingStatus: getBillingStatus(record)
            };
        });
    const entries = allEntries
        .filter((entry) => {
            if (requestedView === 'active') return entry.status === 'pending';
            if (requestedView === 'history') return entry.status !== 'pending';
            return true;
        })
        .sort((left, right) => {
            if (left.status === 'pending' && right.status === 'pending') {
                return stageSortRank(left.stage) - stageSortRank(right.stage)
                    || left.customerName.localeCompare(right.customerName);
            }
            return entrySortTime(right).localeCompare(entrySortTime(left));
        })
        .slice(0, requestedView === 'active' ? MAX_HISTORY_RESULTS : MAX_HISTORY_RESULTS);

    const stats = {
        total: allEntries.length,
        pending: allEntries.filter((entry) => entry.status === 'pending').length,
        ready: allEntries.filter((entry) => entry.status === 'pending' && entry.canSend).length,
        setupRequired: allEntries.filter((entry) => entry.status === 'pending' && entry.setupRequired).length,
        sent: allEntries.filter((entry) => entry.status === 'sent').length,
        skipped: allEntries.filter((entry) => entry.status === 'skipped').length
    };
    return {
        entries,
        stats,
        lastGeneratedAt: branchState.lastGeneratedAt,
        view: requestedView
    };
};

const findAuthorizedRecord = (records, accountNumber) => (
    records.find((record) => customerAccountNumber(record) === trimText(accountNumber, 40)) || null
);

const getAuthorizedEntryContext = async ({ user, reminderId }) => {
    const { branchId, records } = await loadAuthorizedRecords(user);
    const store = await loadStore();
    const branchState = normalizeBranchState(store.branches[String(branchId)] || {});
    const entry = branchState.reminders[trimText(reminderId, 100)] || null;
    if (!entry || !findAuthorizedRecord(records, entry.accountNumber)) {
        return { branchId, records, store, branchState, entry: null };
    }
    return { branchId, records, store, branchState, entry };
};

router.use(requireReminderStaff);

router.get('/meta-status', (_req, res) => res.json({
    ok: true,
    mode: 'manual_review',
    automaticSendingEnabled: false,
    webhookConfigured: Boolean(trimText(process.env.MESSENGER_VERIFY_TOKEN)),
    pageTokenConfigured: Boolean(trimText(process.env.MESSENGER_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN)),
    businessInboxUrl: normalizeMessengerLink(
        process.env.MESSENGER_BUSINESS_INBOX_URL || 'https://business.facebook.com/latest/inbox/all'
    ),
    policyNote: 'The billing system prepares and audits reminders. Staff review and send them manually in Messenger.'
}));

router.get('/', async (req, res, next) => {
    try {
        const { branchId, records } = await loadAuthorizedRecords(req.user);
        const result = await listQueue({
            records,
            branchId,
            view: trimText(req.query.view, 20).toLowerCase()
        });
        return res.json({ ok: true, ...result });
    } catch (error) {
        return next(error);
    }
});

router.post('/generate', async (req, res, next) => {
    try {
        const { branchId, records } = await loadAuthorizedRecords(req.user);
        const businessName = await readBusinessName();
        const generated = await generateQueue({ records, branchId, businessName, now: new Date() });
        const queue = await listQueue({ records, branchId, view: 'active' });
        return res.json({ ok: true, message: 'Messenger reminder queue is ready.', generated, ...queue });
    } catch (error) {
        return next(error);
    }
});

router.put('/preferences/:accountNumber', async (req, res, next) => {
    try {
        const { branchId, records } = await loadAuthorizedRecords(req.user);
        const accountNumber = trimText(req.params.accountNumber, 40);
        const record = findAuthorizedRecord(records, accountNumber);
        if (!record) return res.status(404).json({ ok: false, error: 'Customer is not available to this user.' });

        const rawLink = trimText(req.body?.messengerLink, 500);
        const messengerLink = normalizeMessengerLink(rawLink);
        if (rawLink && !messengerLink) {
            return res.status(400).json({ ok: false, error: 'Enter a valid Messenger username or HTTPS conversation link.' });
        }
        const consentAllowed = req.body?.consentAllowed === true;
        const actor = getActor(req.user, req.messengerReminderRole);
        const nowIso = new Date().toISOString();
        const preference = await withStoreMutation(async () => {
            const store = await loadStore();
            const branchKey = String(branchId);
            const branchState = normalizeBranchState(store.branches[branchKey] || {});
            const previous = normalizePreference(branchState.preferences[accountNumber] || {});
            const nextPreference = normalizePreference({
                ...previous,
                messengerLink,
                consentAllowed,
                consentRecordedAt: consentAllowed ? (previous.consentRecordedAt || nowIso) : null,
                consentRecordedBy: consentAllowed ? actor : null,
                updatedAt: nowIso
            });
            branchState.preferences[accountNumber] = nextPreference;
            store.branches[branchKey] = branchState;
            await saveStore(store);
            return nextPreference;
        });
        return res.json({
            ok: true,
            preference: {
                ...preference,
                accountNumber,
                messengerLink: resolveCustomerMessengerLink(record, preference)
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/opened', async (req, res, next) => {
    try {
        const context = await getAuthorizedEntryContext({ user: req.user, reminderId: req.params.id });
        if (!context.entry) return res.status(404).json({ ok: false, error: 'Reminder was not found.' });
        const record = findAuthorizedRecord(context.records, context.entry.accountNumber);
        const preference = normalizePreference(context.branchState.preferences[context.entry.accountNumber] || {});
        const messengerLink = resolveCustomerMessengerLink(record, preference);
        if (!messengerLink) return res.status(400).json({ ok: false, error: 'Add a Messenger link first.' });
        const actor = getActor(req.user, req.messengerReminderRole);
        const updated = await withStoreMutation(async () => {
            const store = await loadStore();
            const branchState = normalizeBranchState(store.branches[String(context.branchId)] || {});
            const entry = branchState.reminders[context.entry.id];
            if (!entry) return null;
            entry.openedAt = new Date().toISOString();
            entry.openedBy = actor;
            entry.updatedAt = entry.openedAt;
            store.branches[String(context.branchId)] = branchState;
            await saveStore(store);
            return entry;
        });
        return res.json({ ok: true, reminder: updated, messengerLink });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/sent', async (req, res, next) => {
    try {
        const context = await getAuthorizedEntryContext({ user: req.user, reminderId: req.params.id });
        if (!context.entry) return res.status(404).json({ ok: false, error: 'Reminder was not found.' });
        const record = findAuthorizedRecord(context.records, context.entry.accountNumber);
        const preference = normalizePreference(context.branchState.preferences[context.entry.accountNumber] || {});
        const messengerLink = resolveCustomerMessengerLink(record, preference);
        if (!preference.consentAllowed) {
            return res.status(409).json({ ok: false, error: 'Record Messenger reminder consent before marking this reminder as sent.' });
        }
        if (!messengerLink) {
            return res.status(409).json({ ok: false, error: 'Add a Messenger username or conversation link first.' });
        }
        const actor = getActor(req.user, req.messengerReminderRole);
        const updated = await withStoreMutation(async () => {
            const store = await loadStore();
            const branchState = normalizeBranchState(store.branches[String(context.branchId)] || {});
            const entry = branchState.reminders[context.entry.id];
            if (!entry) return null;
            if (entry.status !== 'pending') return entry;
            entry.status = 'sent';
            entry.sentAt = new Date().toISOString();
            entry.sentBy = actor;
            entry.updatedAt = entry.sentAt;
            store.branches[String(context.branchId)] = branchState;
            await saveStore(store);
            return entry;
        });
        return res.json({ ok: true, message: 'Reminder marked as sent.', reminder: updated });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/skip', async (req, res, next) => {
    try {
        const context = await getAuthorizedEntryContext({ user: req.user, reminderId: req.params.id });
        if (!context.entry) return res.status(404).json({ ok: false, error: 'Reminder was not found.' });
        const actor = getActor(req.user, req.messengerReminderRole);
        const reason = trimText(req.body?.reason || 'Skipped by staff.', MAX_REASON_LENGTH);
        const updated = await withStoreMutation(async () => {
            const store = await loadStore();
            const branchState = normalizeBranchState(store.branches[String(context.branchId)] || {});
            const entry = branchState.reminders[context.entry.id];
            if (!entry) return null;
            if (entry.status !== 'pending') return entry;
            entry.status = 'skipped';
            entry.skippedAt = new Date().toISOString();
            entry.skippedBy = actor;
            entry.skipReason = reason;
            entry.updatedAt = entry.skippedAt;
            store.branches[String(context.branchId)] = branchState;
            await saveStore(store);
            return entry;
        });
        return res.json({ ok: true, message: 'Reminder skipped.', reminder: updated });
    } catch (error) {
        return next(error);
    }
});

router.post('/:id/reopen', async (req, res, next) => {
    try {
        const context = await getAuthorizedEntryContext({ user: req.user, reminderId: req.params.id });
        if (!context.entry) return res.status(404).json({ ok: false, error: 'Reminder was not found.' });
        if (!['sent', 'skipped'].includes(context.entry.status)) {
            return res.status(409).json({ ok: false, error: 'Only sent or skipped reminders can be reopened.' });
        }
        const updated = await withStoreMutation(async () => {
            const store = await loadStore();
            const branchState = normalizeBranchState(store.branches[String(context.branchId)] || {});
            const entry = branchState.reminders[context.entry.id];
            if (!entry) return null;
            entry.status = 'pending';
            entry.sentAt = null;
            entry.sentBy = null;
            entry.skippedAt = null;
            entry.skippedBy = null;
            entry.skipReason = '';
            entry.updatedAt = new Date().toISOString();
            store.branches[String(context.branchId)] = branchState;
            await saveStore(store);
            return entry;
        });
        return res.json({ ok: true, message: 'Reminder reopened.', reminder: updated });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
module.exports.STORE_KEY = STORE_KEY;
module.exports.buildReminderCandidates = buildReminderCandidates;
module.exports.generateQueue = generateQueue;
module.exports.getManilaDateParts = getManilaDateParts;
module.exports.listQueue = listQueue;
module.exports.listConfirmedPaymentsForCycle = listConfirmedPaymentsForCycle;
module.exports.normalizeMessengerLink = normalizeMessengerLink;
module.exports.resolveScheduledStage = resolveScheduledStage;
