const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const customersModule = require('../../customer-management/backend/customers');
const { getEffectivePaymentEntries } = require('./payment-entry-normalizer');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { readBranchDisconnections, getAccountDisconnection } = require('./disconnection-store');
const {
    buildReferralDiscountMap,
    buildReferralOptionMap
} = require('../../customer-management/backend/referral-engine');
const referralsModule = require('../../customer-management/backend/referrals');
const { calculatePaymentBreakdownEndingBalance } = require('./payment-breakdown-balance');
const {
    addMonthKey,
    buildComplimentaryAccountSummary,
    getCurrentMonthKey: getCurrentComplimentaryMonthKey,
    sanitizeComplimentaryPeriods
} = require('./complimentary-account');
const { buildReconnectionSummary } = require('./reconnection-settlement');

const router = express.Router();
const STORE_KEYS = {
    customers: 'customers',
    payments: 'payments',
    plans: 'plans',
    paymentBreakdownAdjustments: 'payment_breakdown_adjustments'
};
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
const readPayments = async (branchId = null) => {
    if (typeof customersModule.readPayments === 'function') {
        return customersModule.readPayments(branchId);
    }
    const data = await readJson(STORE_KEYS.payments, {});
    return data && typeof data === 'object' ? data : {};
};
const readPlans = async (branchId = null) => {
    if (typeof customersModule.readPlans === 'function') {
        return customersModule.readPlans(branchId);
    }
    const data = await readJson(STORE_KEYS.plans, []);
    return Array.isArray(data) ? data : [];
};
const readPaymentBreakdownAdjustments = async () => {
    const data = await readJson(STORE_KEYS.paymentBreakdownAdjustments, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};
const writePaymentBreakdownAdjustments = async (adjustments = {}) => {
    await writeJson(STORE_KEYS.paymentBreakdownAdjustments, adjustments && typeof adjustments === 'object' ? adjustments : {});
};

const ENTRY_KIND_DIRECTIONS = {
    payment: 'credit',
    rebate: 'credit',
    discount: 'credit',
    charge: 'debit',
    bill: 'debit',
    debit: 'debit'
};

const normalizeKind = (value) => {
    const key = String(value || 'payment').toLowerCase();
    return ENTRY_KIND_DIRECTIONS[key] ? key : 'payment';
};

const isOpeningPreviousBalanceEntry = (entry = {}) => {
    const reference = String(entry?.reference || entry?.orNumber || entry?.or_number || '').trim().toLowerCase();
    const description = String([
        entry?.description,
        entry?.notes,
        entry?.remarks
    ].filter(Boolean).join(' ')).trim().toLowerCase();
    return reference.startsWith('obb-')
        || reference.startsWith('opening-bal-')
        || description.includes('previous balance bill')
        || description.includes('opening previous balance');
};

const resolveDirection = (entry) => {
    if (!entry) return 'credit';
    if (isOpeningPreviousBalanceEntry(entry)) return 'debit';
    const normalizedKind = normalizeKind(entry.kind);
    const fallbackDirection = ENTRY_KIND_DIRECTIONS[normalizedKind] || 'credit';
    return (entry.direction || entry.nature || fallbackDirection).toLowerCase();
};

const normalizePlanName = (name) => String(name || '').trim().toLowerCase();

const resolvePlanCategory = (customer, plans = []) => {
    const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
    if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
    const billing = String(customer?.planBilling || '').trim().toLowerCase();
    if (billing.includes('prepaid')) return 'prepaid';
    if (billing.includes('postpaid')) return 'postpaid';
    const match = Array.isArray(plans)
        ? plans.find((p) => normalizePlanName(p.name) === normalizePlanName(customer?.planName))
        : null;
    if (match?.category) return String(match.category).toLowerCase();
    return 'postpaid';
};

const sanitizeCustomerForRecord = (customer) => {
    if (!customer || typeof customer !== 'object') return null;
    const { loginPassword, password, ...rest } = customer;
    const hasPassword = Boolean(String(loginPassword || password || '').trim());
    return { ...rest, loginPasswordSet: hasPassword };
};

const branchAdjustmentKey = (branchId = null) => String(branchId || 'global');
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-\d{2}/;
const normalizeAdjustmentAmount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Number(parsed.toFixed(2));
};
const normalizeSignedAdjustmentAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};
const hasAdjustmentAmount = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return Number.isFinite(Number(value));
};
const sanitizeAdjustmentText = (value) => String(value || '').trim().slice(0, 160);
const sanitizeAdjustmentReason = (value) => String(value || '').trim().slice(0, 500);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalizeAdjustmentMonthKey = (value) => {
    const text = sanitizeAdjustmentText(value);
    const match = text.match(MONTH_KEY_RE) || text.match(DATE_PREFIX_RE);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};
const resolveRawFirstBillAdjustment = (adjustment = {}) => {
    if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment)) return {};
    if (adjustment.firstBill && typeof adjustment.firstBill === 'object') return adjustment.firstBill;
    const firstBillFields = [
        'previousBalance',
        'advance',
        'referral',
        'due',
        'referralName',
        'referredName',
        'referralClientName',
        'referralAccountNumber',
        'referredAccountNumber'
    ];
    return firstBillFields.some((field) => hasOwn(adjustment, field)) ? adjustment : {};
};
const sanitizeMonthlyReferralAdjustments = (input = {}) => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    return Object.entries(source).reduce((acc, [key, value]) => {
        const item = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : { referral: value };
        const monthKey = normalizeAdjustmentMonthKey(
            item.monthKey
            || item.billingMonth
            || item.billMonth
            || key
        );
        const referralValue = item.referral ?? item.amount ?? item.discount;
        if (!monthKey || !hasAdjustmentAmount(referralValue)) return acc;
        const referralName = sanitizeAdjustmentText(
            item.referralName
            || item.referredName
            || item.referralClientName
            || item.name
        );
        const referralAccountNumber = sanitizeAdjustmentText(
            item.referralAccountNumber
            || item.referredAccountNumber
            || item.accountNumber
        );
        acc[monthKey] = {
            monthKey,
            referral: normalizeAdjustmentAmount(referralValue)
        };
        if (referralName) acc[monthKey].referralName = referralName;
        if (referralAccountNumber) acc[monthKey].referralAccountNumber = referralAccountNumber;
        return acc;
    }, {});
};
const sanitizePlanChangeAdjustments = (input = []) => {
    const list = Array.isArray(input)
        ? input
        : Object.values(input && typeof input === 'object' ? input : {});
    const byMonth = new Map();
    list.forEach((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        const effectiveMonth = normalizeAdjustmentMonthKey(
            value.effectiveMonth
            || value.monthKey
            || value.billingMonth
            || value.billMonth
        );
        const planAmount = normalizeAdjustmentAmount(value.planAmount ?? value.amount ?? value.price);
        if (!effectiveMonth || planAmount <= 0) return;
        const planCategory = sanitizeAdjustmentText(value.planCategory || value.category || value.planType).toLowerCase();
        const billingEffectiveMonth = normalizeAdjustmentMonthKey(value.billingEffectiveMonth) || effectiveMonth;
        const previousPlanValue = value.previousPlan && typeof value.previousPlan === 'object'
            ? value.previousPlan
            : null;
        const entry = {
            effectiveMonth,
            billingEffectiveMonth,
            changeId: sanitizeAdjustmentText(value.changeId) || `plan-change-${effectiveMonth}`,
            planId: sanitizeAdjustmentText(value.planId || value.id),
            planName: sanitizeAdjustmentText(value.planName || value.name || value.label) || 'Adjusted plan',
            planAmount,
            retroactiveAdjustment: normalizeSignedAdjustmentAmount(value.retroactiveAdjustment),
            protectedPaidMonths: Array.from(new Set(
                (Array.isArray(value.protectedPaidMonths) ? value.protectedPaidMonths : [])
                    .map(normalizeAdjustmentMonthKey)
                    .filter(Boolean)
            )),
            reason: sanitizeAdjustmentReason(value.reason),
            createdAt: sanitizeAdjustmentText(value.createdAt),
            updatedAt: sanitizeAdjustmentText(value.updatedAt)
        };
        if (planCategory === 'prepaid' || planCategory === 'postpaid') {
            entry.planCategory = planCategory;
        }
        if (previousPlanValue) {
            const previousPlanAmount = normalizeAdjustmentAmount(
                previousPlanValue.planAmount ?? previousPlanValue.amount ?? previousPlanValue.price
            );
            const previousPlanCategory = sanitizeAdjustmentText(
                previousPlanValue.planCategory || previousPlanValue.category || previousPlanValue.planType
            ).toLowerCase();
            if (previousPlanAmount > 0) {
                entry.previousPlan = {
                    planId: sanitizeAdjustmentText(previousPlanValue.planId || previousPlanValue.id),
                    planName: sanitizeAdjustmentText(
                        previousPlanValue.planName || previousPlanValue.name || previousPlanValue.label
                    ) || 'Previous plan',
                    planAmount: previousPlanAmount
                };
                if (previousPlanCategory === 'prepaid' || previousPlanCategory === 'postpaid') {
                    entry.previousPlan.planCategory = previousPlanCategory;
                }
            }
        }
        const changedByValue = value.changedBy && typeof value.changedBy === 'object'
            ? value.changedBy
            : null;
        if (changedByValue) {
            entry.changedBy = {
                id: changedByValue.id || null,
                username: sanitizeAdjustmentText(changedByValue.username),
                name: sanitizeAdjustmentText(changedByValue.name || changedByValue.username)
            };
        }
        byMonth.set(effectiveMonth, entry);
    });
    return Array.from(byMonth.values()).sort((left, right) => (
        left.effectiveMonth.localeCompare(right.effectiveMonth)
    ));
};
const sanitizePaymentBreakdownAdjustment = (adjustment = {}) => {
    const firstBill = resolveRawFirstBillAdjustment(adjustment);
    const sanitized = {
        firstBill: {
            previousBalance: normalizeAdjustmentAmount(firstBill.previousBalance),
            advance: normalizeAdjustmentAmount(firstBill.advance)
        },
        monthlyReferrals: sanitizeMonthlyReferralAdjustments(
            adjustment?.monthlyReferrals
            || adjustment?.referralAdjustments
            || adjustment?.monthlyReferralAdjustments
        ),
        planChanges: sanitizePlanChangeAdjustments(
            adjustment?.planChanges
            || adjustment?.scheduledPlanChanges
            || adjustment?.planChangeAdjustments
        ),
        complimentaryPeriods: sanitizeComplimentaryPeriods(
            adjustment?.complimentaryPeriods
            || adjustment?.complimentaryAccountPeriods
            || adjustment?.freeAccountPeriods
        )
    };
    if (hasAdjustmentAmount(firstBill.referral)) {
        sanitized.firstBill.referral = normalizeAdjustmentAmount(firstBill.referral);
    }
    if (hasAdjustmentAmount(firstBill.due)) {
        sanitized.firstBill.due = normalizeAdjustmentAmount(firstBill.due);
    }
    const referralName = sanitizeAdjustmentText(
        firstBill.referralName
        || firstBill.referredName
        || firstBill.referralClientName
    );
    const referralAccountNumber = sanitizeAdjustmentText(
        firstBill.referralAccountNumber
        || firstBill.referredAccountNumber
    );
    if (referralName) sanitized.firstBill.referralName = referralName;
    if (referralAccountNumber) sanitized.firstBill.referralAccountNumber = referralAccountNumber;
    return sanitized;
};
const getPaymentBreakdownAdjustment = (adjustments = {}, branchId = null, accountNumber = '') => {
    const branchBucket = adjustments?.[branchAdjustmentKey(branchId)] || {};
    const raw = branchBucket?.[String(accountNumber || '').trim()] || null;
    return raw && typeof raw === 'object' ? sanitizePaymentBreakdownAdjustment(raw) : null;
};
const assertAdminUser = (req) => {
    const user = req.user || null;
    if (!user || !accountHasRole(user, 'Admin')) {
        throw createError(403, 'Admin access is required.');
    }
    return user;
};

const BILLING_SUMMARY_VERSION = 2;
const BILLING_EPSILON = 0.005;
const BILLING_TIME_ZONE = 'Asia/Manila';
const billingDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const toBillingDateKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const parts = billingDateKeyFormatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';
    return year && month && day ? `${year}-${month}-${day}` : '';
};
const getCurrentBillingMonthKey = (now = new Date()) => toBillingDateKey(now).slice(0, 7);
const addBillingMonths = (monthKey, offset = 1) => {
    const normalized = normalizeAdjustmentMonthKey(monthKey);
    if (!normalized) return '';
    const [year, month] = normalized.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + Number(offset || 0), 1, 12, 0, 0));
    return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
const normalizePlanCategoryValue = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'prepaid' || normalized === 'postpaid' ? normalized : '';
};
const buildPlanSnapshot = (source = {}, fallbackCategory = '') => {
    const planAmount = normalizeAdjustmentAmount(
        source?.planAmount ?? source?.price ?? source?.amount ?? source?.monthlyFee
    );
    const planName = sanitizeAdjustmentText(source?.planName || source?.name || source?.label);
    if (!planName || planAmount <= 0) return null;
    return {
        planId: sanitizeAdjustmentText(source?.planId || source?.id || source?.plan_id),
        planName,
        planAmount,
        planCategory: normalizePlanCategoryValue(
            source?.planCategory || source?.category || source?.planType || fallbackCategory
        ) || 'postpaid'
    };
};
const resolvePlanSnapshotForMonth = (planChanges = [], monthKey = '', fallbackPlan = null) => {
    const targetMonth = normalizeAdjustmentMonthKey(monthKey);
    const changes = sanitizePlanChangeAdjustments(planChanges);
    let selected = changes.find((change) => change?.previousPlan)?.previousPlan || fallbackPlan;
    changes.forEach((change) => {
        if (!targetMonth || change.effectiveMonth > targetMonth) return;
        selected = change;
    });
    return selected ? buildPlanSnapshot(selected) : null;
};
const findPlanSnapshot = (plans = [], requested = {}) => {
    const requestedId = sanitizeAdjustmentText(requested?.planId || requested?.id).toLowerCase();
    const requestedName = normalizePlanName(requested?.planName || requested?.name || requested?.label);
    const match = (Array.isArray(plans) ? plans : []).find((plan) => {
        const planId = sanitizeAdjustmentText(plan?.id || plan?.planId || plan?.plan_id).toLowerCase();
        const planName = normalizePlanName(plan?.name || plan?.label || plan?.planName);
        return (requestedId && planId === requestedId) || (requestedName && planName === requestedName);
    });
    return match ? buildPlanSnapshot(match) : null;
};
const buildEffectivePlanChangeEntry = ({
    effectiveMonth,
    selectedPlan,
    previousPlan,
    existingChange = null,
    laterChange = null,
    rows = [],
    changedBy = null,
    reason = '',
    now = new Date()
} = {}) => {
    const normalizedEffectiveMonth = normalizeAdjustmentMonthKey(effectiveMonth);
    const nextPlan = buildPlanSnapshot(selectedPlan);
    const oldPlan = buildPlanSnapshot(existingChange?.previousPlan || previousPlan);
    if (!normalizedEffectiveMonth || !nextPlan || !oldPlan) {
        throw createError(400, 'The effective month, current plan, and new plan are required.');
    }
    if (nextPlan.planCategory !== oldPlan.planCategory) {
        throw createError(409, 'Change between prepaid and postpaid from the subscriber editor so billing dates can be reviewed safely.');
    }
    if (
        normalizePlanName(nextPlan.planName) === normalizePlanName(oldPlan.planName)
        && Math.abs(nextPlan.planAmount - oldPlan.planAmount) <= BILLING_EPSILON
    ) {
        throw createError(409, 'Choose a plan that is different from the plan already effective for that month.');
    }

    const nextBoundary = normalizeAdjustmentMonthKey(laterChange?.effectiveMonth);
    const affectedRowsByMonth = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const monthKey = normalizeAdjustmentMonthKey(row?.billingMonthKey || row?.billDate);
        if (!monthKey || monthKey < normalizedEffectiveMonth || (nextBoundary && monthKey >= nextBoundary)) return;
        affectedRowsByMonth.set(monthKey, row);
    });
    const affectedRows = Array.from(affectedRowsByMonth.values()).sort((left, right) => (
        String(left?.billingMonthKey || left?.billDate).localeCompare(String(right?.billingMonthKey || right?.billDate))
    ));
    const protectedRows = affectedRows.filter((row) => String(row?.paymentStatus || '').toLowerCase() === 'paid');
    const firstOpenRow = affectedRows.find((row) => String(row?.paymentStatus || '').toLowerCase() === 'unpaid');
    const firstPendingRow = affectedRows.find((row) => String(row?.paymentStatus || '').toLowerCase() === 'not-generated');
    const currentMonth = getCurrentBillingMonthKey(now);
    const latestProtectedMonth = protectedRows.reduce((latest, row) => {
        const monthKey = normalizeAdjustmentMonthKey(row?.billingMonthKey || row?.billDate);
        return monthKey > latest ? monthKey : latest;
    }, '');
    const billingEffectiveMonth = normalizeAdjustmentMonthKey(
        firstOpenRow?.billingMonthKey
        || firstOpenRow?.billDate
        || firstPendingRow?.billingMonthKey
        || firstPendingRow?.billDate
    ) || (
        normalizedEffectiveMonth > currentMonth
            ? normalizedEffectiveMonth
            : addBillingMonths(
                latestProtectedMonth > currentMonth ? latestProtectedMonth : currentMonth,
                1
            )
    );
    const retroactiveAdjustment = normalizeSignedAdjustmentAmount(protectedRows.reduce((total, row) => {
        const originalAmount = normalizeAdjustmentAmount(row?.planAmount);
        const ratio = oldPlan.planAmount > BILLING_EPSILON
            ? originalAmount / oldPlan.planAmount
            : 1;
        const replacementAmount = normalizeSignedAdjustmentAmount(nextPlan.planAmount * ratio);
        return total + replacementAmount - originalAmount;
    }, 0));
    const timestamp = now.toISOString();
    const existingCreatedAt = sanitizeAdjustmentText(existingChange?.createdAt);
    return sanitizePlanChangeAdjustments([{
        ...nextPlan,
        effectiveMonth: normalizedEffectiveMonth,
        billingEffectiveMonth,
        changeId: sanitizeAdjustmentText(existingChange?.changeId) || `plan-change-${normalizedEffectiveMonth}-${now.getTime()}`,
        previousPlan: oldPlan,
        retroactiveAdjustment,
        protectedPaidMonths: protectedRows.map((row) => row?.billingMonthKey || row?.billDate),
        reason: sanitizeAdjustmentReason(reason),
        createdAt: existingCreatedAt || timestamp,
        updatedAt: timestamp,
        changedBy
    }])[0];
};
const serializeBillingValue = (value) => {
    if (value instanceof Date) return toBillingDateKey(value);
    if (value instanceof Set) return Array.from(value).map(serializeBillingValue);
    if (Array.isArray(value)) return value.map(serializeBillingValue);
    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((result, [key, entry]) => {
            result[key] = serializeBillingValue(entry);
            return result;
        }, {});
    }
    return value;
};
const parseBillingDateKey = (value) => {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (Number.isNaN(date.getTime())) return null;
    return { year, month, day, date };
};
const addBillingDays = (dateKey, days = 0) => {
    const parsed = parseBillingDateKey(dateKey);
    if (!parsed) return '';
    parsed.date.setUTCDate(parsed.date.getUTCDate() + (Number(days) || 0));
    return [
        parsed.date.getUTCFullYear(),
        String(parsed.date.getUTCMonth() + 1).padStart(2, '0'),
        String(parsed.date.getUTCDate()).padStart(2, '0')
    ].join('-');
};
const getBillingDateDifference = (left, right) => {
    const leftDate = parseBillingDateKey(toBillingDateKey(left));
    const rightDate = parseBillingDateKey(toBillingDateKey(right));
    if (!leftDate || !rightDate) return null;
    return Math.round((rightDate.date.getTime() - leftDate.date.getTime()) / 86400000);
};
const resolveRecordDueOffset = (record = {}) => {
    const direct = Number(record.dueOffset ?? record.due_offset);
    if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
    const difference = getBillingDateDifference(record.billDate, record.dueDate);
    return Number.isFinite(difference) && difference >= 0 ? difference : 0;
};
const resolveCanonicalRowDueDate = (row = {}, record = {}, planType = 'postpaid') => {
    const billDate = toBillingDateKey(row.billDate);
    if (!billDate) return '';
    if (planType === 'prepaid') return billDate;
    return addBillingDays(billDate, resolveRecordDueOffset(record)) || billDate;
};
const serializeBillingRow = (row = {}, record = {}) => {
    const billDate = toBillingDateKey(row.billDate);
    const planType = String(row.planType || record.planCategory || 'postpaid').trim().toLowerCase() === 'prepaid'
        ? 'prepaid'
        : 'postpaid';
    const complimentaryRow = String(row?.sourceType || '').trim().toLowerCase() === 'complimentary';
    const reconnectionRow = String(row?.sourceType || '').trim().toLowerCase().startsWith('reconnection-');
    const complimentaryWriteOff = Number(row?.complimentaryWriteOff) || 0;
    return {
        ...serializeBillingValue(row),
        billDate,
        dueDate: resolveCanonicalRowDueDate(row, record, planType),
        billingMonthKey: row.billingMonthKey || billDate.slice(0, 7),
        planType,
        planTypeLabel: planType === 'prepaid' ? 'Prepaid' : 'Postpaid',
        planLabel: String(
            row?.planOverride?.planName
            || record.planName
            || record.plan
            || 'Monthly plan'
        ).trim() || 'Monthly plan',
        billLabel: complimentaryRow
            ? 'Complimentary account'
            : (reconnectionRow
                ? (Number(row?.planAmount) > BILLING_EPSILON ? 'Reconnection prorated charge' : 'Reconnection opening balance')
                : row?.billLabel),
        billMeta: complimentaryRow
            ? (complimentaryWriteOff > BILLING_EPSILON
                ? `No recurring charge; ${complimentaryWriteOff.toFixed(2)} existing balance written off`
                : 'No recurring charge for this complimentary month')
            : (reconnectionRow
                ? [
                    Number(row?.reconnectionPreviousBalance) > BILLING_EPSILON
                        ? `Previous disconnected balance ${Number(row.reconnectionPreviousBalance).toFixed(2)}`
                        : 'No previous disconnected balance',
                    Number(row?.reconnectionWriteOff) > BILLING_EPSILON
                        ? `${Number(row.reconnectionWriteOff).toFixed(2)} written off`
                        : '',
                    Number(row?.reconnectionDeferredBalance) > BILLING_EPSILON
                        ? `${Number(row.reconnectionDeferredBalance).toFixed(2)} moved to ${Number(row.reconnectionInstallmentMonths) || 0} installments`
                        : '',
                    Number(row?.reconnectionInstallment) > BILLING_EPSILON
                        ? `Installment ${Number(row.reconnectionInstallmentNumber) || 1}/${Number(row.reconnectionInstallmentMonths) || 1}: ${Number(row.reconnectionInstallment).toFixed(2)}`
                        : '',
                    row?.activationPolicy === 'after-payment'
                        ? `Service activates after ${Number(row.requiredActivationPayment || 0).toFixed(2)} in new payments`
                        : 'Service activation: immediate'
                ].filter(Boolean).join('; ')
                : [
                    row?.billMeta,
                    Number(row?.reconnectionInstallment) > BILLING_EPSILON
                        ? `Previous-balance installment ${Number(row.reconnectionInstallmentNumber) || 1}/${Number(row.reconnectionInstallmentMonths) || 1}: ${Number(row.reconnectionInstallment).toFixed(2)}`
                        : ''
                ].filter(Boolean).join('; ')),
        paymentStatusLabel: complimentaryRow ? 'Complimentary' : row?.paymentStatusLabel,
        paymentDetails: (Array.isArray(row.paymentDetails) ? row.paymentDetails : []).map((detail) => ({
            ...serializeBillingValue(detail),
            date: detail?.date || ''
        }))
    };
};
const getNextPrepaidCycleDate = (today = new Date()) => {
    const currentDateKey = toBillingDateKey(today);
    const [year, month] = currentDateKey.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
};
const getNextPostpaidCycleDate = (today = new Date()) => {
    const currentDateKey = toBillingDateKey(today);
    const [year, month] = currentDateKey.split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const monthEndDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(monthEndDay).padStart(2, '0')}`;
};
const getNextCycleDate = (planType, today = new Date()) => (
    planType === 'prepaid'
        ? getNextPrepaidCycleDate(today)
        : getNextPostpaidCycleDate(today)
);
const buildBillingReconciliation = ({ record = {}, rows = [], endingBalance = 0, currentCycle = null } = {}) => {
    const issues = [];
    const missingChargeMonths = [];
    const addIssue = (code, severity, message, details = {}) => {
        issues.push({ code, severity, message, ...details });
    };
    const cycleCounts = rows.reduce((counts, row) => {
        const monthKey = String(row?.billingMonthKey || '').trim();
        if (monthKey) counts.set(monthKey, (counts.get(monthKey) || 0) + 1);
        return counts;
    }, new Map());
    cycleCounts.forEach((count, monthKey) => {
        if (count > 1) {
            addIssue('duplicate-cycle', 'error', `Billing month ${monthKey} has ${count} cycle rows.`, { monthKey, count });
        }
    });

    rows.forEach((row) => {
        const monthKey = String(row?.billingMonthKey || '').trim();
        const planAmount = Number(row?.planAmount) || 0;
        const balanceAfterPayment = Number(row?.balanceAfterPayment) || 0;
        const nextPreviousBalance = Number(row?.nextPreviousBalance) || 0;
        const nextAdvance = Number(row?.nextAdvance) || 0;
        const isGeneratedCycle = !row?.openingPreviousBalance
            && !row?.openingAdvance
            && row?.sourceType !== 'pending-postpaid'
            && row?.sourceType !== 'disconnection'
            && row?.sourceType !== 'complimentary'
            && row?.sourceType !== 'reconnection-opening';
        if (isGeneratedCycle && planAmount <= BILLING_EPSILON) {
            missingChargeMonths.push(monthKey || 'unknown');
        }
        if ((Number(row?.advance) || 0) < -BILLING_EPSILON || nextAdvance < -BILLING_EPSILON) {
            addIssue('invalid-advance', 'error', `Billing month ${monthKey || 'unknown'} contains a negative advance.`, { monthKey });
        }
        if (balanceAfterPayment > BILLING_EPSILON && Math.abs(nextPreviousBalance - balanceAfterPayment) > BILLING_EPSILON) {
            addIssue('balance-carry-mismatch', 'error', `Billing month ${monthKey || 'unknown'} does not carry its balance forward correctly.`, { monthKey });
        }
        if (balanceAfterPayment < -BILLING_EPSILON && Math.abs(nextAdvance - Math.abs(balanceAfterPayment)) > BILLING_EPSILON) {
            addIssue('advance-carry-mismatch', 'error', `Billing month ${monthKey || 'unknown'} does not carry its advance forward correctly.`, { monthKey });
        }
    });
    if (missingChargeMonths.length) {
        addIssue(
            'missing-charge',
            'warning',
            `${missingChargeMonths.length} billing cycle${missingChargeMonths.length === 1 ? '' : 's'} are missing a calculated monthly charge.`,
            { monthKeys: missingChargeMonths }
        );
    }

    const billingStopped = String(record?.disconnection?.billingPolicy || '').trim().toLowerCase() === 'stop';
    const complimentaryAccount = buildComplimentaryAccountSummary(
        record?.paymentBreakdownAdjustment?.complimentaryPeriods || [],
        { planType: record?.planCategory }
    );
    if (!currentCycle && !billingStopped && !complimentaryAccount.active) {
        addIssue('missing-current-cycle', 'error', 'The current billing cycle is missing.');
    }
    const lastRowBalance = rows.length ? Number(rows[rows.length - 1]?.balanceAfterPayment) || 0 : 0;
    if (Math.abs(lastRowBalance - (Number(endingBalance) || 0)) > BILLING_EPSILON) {
        addIssue('ending-balance-mismatch', 'error', 'The ending balance does not match the final billing row.', {
            endingBalance: Number(endingBalance) || 0,
            lastRowBalance
        });
    }

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
        status: errorCount ? 'error' : (warningCount ? 'warning' : 'clean'),
        issueCount: issues.length,
        errorCount,
        warningCount,
        issues
    };
};
const resolveCanonicalBillingStatus = ({ rows = [], endingBalance = 0, currentCycle = null } = {}) => {
    const balance = Number(endingBalance) || 0;
    if (balance < -BILLING_EPSILON) return { status: 'advance', dueDate: currentCycle?.dueDate || null };
    if (balance <= BILLING_EPSILON) return { status: 'paid', dueDate: currentCycle?.dueDate || null };
    const outstandingRow = rows.find((row) => (
        row?.paymentStatus === 'unpaid'
        && (Number(row?.balanceAfterPayment) || 0) > BILLING_EPSILON
    ));
    const dueDate = outstandingRow?.dueDate || currentCycle?.dueDate || null;
    const todayKey = toBillingDateKey(new Date());
    return {
        status: dueDate && dueDate < todayKey ? 'overdue' : 'due',
        dueDate
    };
};
const buildFallbackBillingSummary = (record = {}, fallbackBalance = 0) => {
    const endingBalance = Number.isFinite(Number(fallbackBalance)) ? Number(fallbackBalance) : 0;
    const planType = String(record.planCategory || 'postpaid').trim().toLowerCase() === 'prepaid'
        ? 'prepaid'
        : 'postpaid';
    const complimentaryAccount = buildComplimentaryAccountSummary(
        record?.paymentBreakdownAdjustment?.complimentaryPeriods || [],
        { planType }
    );
    const reconnection = buildReconnectionSummary(record?.disconnection || {});
    return {
        version: BILLING_SUMMARY_VERSION,
        source: 'payment-breakdown-backend',
        available: false,
        planType,
        endingBalance,
        balance: Math.max(0, endingBalance),
        advance: Math.max(0, -endingBalance),
        currentCycle: null,
        nextCycleDate: complimentaryAccount.active
            ? complimentaryAccount.nextBillableCycleDate
            : getNextCycleDate(planType),
        rows: [],
        context: {},
        billingStatus: 'unavailable',
        dueDate: null,
        complimentaryAccount,
        reconnection,
        reconciliation: {
            status: 'error',
            issueCount: 1,
            errorCount: 1,
            warningCount: 0,
            issues: [{
                code: 'calculation-unavailable',
                severity: 'error',
                message: 'The backend billing calculation is unavailable.'
            }]
        }
    };
};
const buildCanonicalBillingSummary = (record = {}, fallbackBalance = 0) => {
    try {
        const breakdown = calculatePaymentBreakdownEndingBalance(record);
        const endingBalance = Number(breakdown?.endingBalance);
        const safeEndingBalance = Number.isFinite(endingBalance) ? endingBalance : Number(fallbackBalance) || 0;
        const rows = (Array.isArray(breakdown?.rows) ? breakdown.rows : [])
            .map((row) => serializeBillingRow(row, record));
        const currentMonthKey = toBillingDateKey(new Date()).slice(0, 7);
        const currentRows = rows.filter((row) => row.billingMonthKey === currentMonthKey);
        const planType = String(record.planCategory || 'postpaid').trim().toLowerCase() === 'prepaid'
            ? 'prepaid'
            : 'postpaid';
        const currentCycle = currentRows.length ? currentRows[currentRows.length - 1] : null;
        const complimentaryAccount = buildComplimentaryAccountSummary(
            record?.paymentBreakdownAdjustment?.complimentaryPeriods || [],
            { planType }
        );
        const reconnection = buildReconnectionSummary(record?.disconnection || {});
        const billingState = complimentaryAccount.active
            ? { status: 'complimentary', dueDate: null }
            : resolveCanonicalBillingStatus({ rows, endingBalance: safeEndingBalance, currentCycle });
        const reconciliation = buildBillingReconciliation({
            record,
            rows,
            endingBalance: safeEndingBalance,
            currentCycle
        });
        return {
            version: BILLING_SUMMARY_VERSION,
            source: 'payment-breakdown-backend',
            available: true,
            planType,
            endingBalance: safeEndingBalance,
            balance: Math.max(0, safeEndingBalance),
            advance: Math.max(0, -safeEndingBalance),
            currentCycle,
            nextCycleDate: complimentaryAccount.active
                ? complimentaryAccount.nextBillableCycleDate
                : getNextCycleDate(planType),
            rows,
            context: serializeBillingValue(breakdown?.context || {}),
            billingStatus: billingState.status,
            dueDate: billingState.dueDate,
            complimentaryAccount,
            reconnection,
            reconciliation
        };
    } catch (error) {
        console.warn(
            `Unable to calculate canonical billing summary for ${record?.accountNumber || 'unknown account'}:`,
            error?.message || error
        );
        return buildFallbackBillingSummary(record, fallbackBalance);
    }
};

const buildPlanHistory = (record = {}, planChanges = [], now = new Date()) => {
    const changes = sanitizePlanChangeAdjustments(planChanges);
    const currentMonth = getCurrentBillingMonthKey(now);
    const effectiveChanges = changes.filter((change) => change.effectiveMonth <= currentMonth);
    const activeChange = effectiveChanges.length ? effectiveChanges[effectiveChanges.length - 1] : null;
    const currentPlanName = normalizePlanName(record?.planName);
    return changes.slice().reverse().map((change) => {
        let status = 'history';
        if (change.effectiveMonth > currentMonth) {
            status = 'scheduled';
        } else if (activeChange?.changeId === change.changeId) {
            status = normalizePlanName(change.planName) === currentPlanName ? 'active' : 'pending-sync';
        }
        const adjustment = normalizeSignedAdjustmentAmount(change.retroactiveAdjustment);
        return {
            ...change,
            status,
            adjustmentType: adjustment > BILLING_EPSILON
                ? 'debit'
                : (adjustment < -BILLING_EPSILON ? 'credit' : 'none'),
            adjustmentAmount: Math.abs(adjustment)
        };
    });
};

const buildPaymentRecord = (
    customer,
    payments = {},
    plans = [],
    adjustments = {},
    branchId = null,
    disconnections = {},
    referralDiscountsByAccount = {},
    referralOptionsByAccount = {}
) => {
    if (!customer || typeof customer !== 'object') return null;
    const sanitizedCustomer = sanitizeCustomerForRecord(customer);
    if (!sanitizedCustomer) return null;
    const subscriberStatus = sanitizedCustomer.status || null;
    const accountNumber = customer.accountNumber;
    const rawHistory = payments?.[accountNumber]?.history || [];
    const paymentHistory = Array.isArray(rawHistory) ? rawHistory : [];
    const creditLimit = Number(customer.creditLimit);
    const summary = calculatePaymentSummary(paymentHistory, creditLimit, customer.planAmount);
    const planCategory = resolvePlanCategory(customer, plans);
    const paymentBreakdownAdjustment = getPaymentBreakdownAdjustment(adjustments, branchId, accountNumber);
    const recordBase = {
        ...sanitizedCustomer,
        subscriberStatus,
        customerStatus: subscriberStatus,
        planCategory,
        disconnection: getAccountDisconnection(disconnections, accountNumber),
        referralDiscounts: Array.isArray(referralDiscountsByAccount?.[accountNumber])
            ? referralDiscountsByAccount[accountNumber]
            : [],
        referralOptions: Array.isArray(referralOptionsByAccount?.[accountNumber])
            ? referralOptionsByAccount[accountNumber]
            : [],
        paymentBreakdownAdjustment,
        ...summary,
        history: paymentHistory
    };
    const billingSummary = buildCanonicalBillingSummary(recordBase, summary.balance);
    const endingBalance = billingSummary.endingBalance;
    const complimentaryAccount = billingSummary.complimentaryAccount
        || buildComplimentaryAccountSummary(paymentBreakdownAdjustment?.complimentaryPeriods || [], { planType: planCategory });
    const reconnection = billingSummary.reconnection || buildReconnectionSummary(recordBase.disconnection || {});
    const planHistory = buildPlanHistory(
        recordBase,
        paymentBreakdownAdjustment?.planChanges || []
    );

    return {
        ...recordBase,
        billingSummary,
        complimentaryAccount,
        reconnection,
        planHistory,
        paymentBreakdownEndingBalance: endingBalance,
        endingBalance
    };
};

const buildAutomaticReferralTarget = (record = {}) => {
    if (record?.complimentaryAccount?.active === true || record?.billingSummary?.complimentaryAccount?.active === true) return null;
    const accountNumber = String(record?.accountNumber || '').trim();
    const rows = Array.isArray(record?.billingSummary?.rows) ? record.billingSummary.rows : [];
    const billingRows = rows.filter((row) => {
        const sourceType = String(row?.sourceType || '').toLowerCase();
        if (!row?.billingMonthKey || !accountNumber) return false;
        if (['opening', 'disconnection'].includes(sourceType) || sourceType.startsWith('reconnection-')) return false;
        return true;
    });
    if (!billingRows.length) return null;
    const row = billingRows.slice().sort((left, right) => (
        String(right?.billDate || right?.billingMonthKey || '')
            .localeCompare(String(left?.billDate || left?.billingMonthKey || ''))
    ))[0];
    const sourceType = String(row?.sourceType || '').toLowerCase();
    if (sourceType === 'pending-postpaid') return null;
    if (String(row?.paymentStatus || '').toLowerCase() !== 'unpaid') return null;
    {
        const details = Array.isArray(row?.referralDetails) ? row.referralDetails : [];
        const hasLegacyManualReferral = (Number(row?.referral) || 0) > BILLING_EPSILON
            && (!details.length || details.some((detail) => !detail?.applicationId));
        if (hasLegacyManualReferral) return null;
    }
    const activeReferralAmount = (Array.isArray(row.referralDetails) ? row.referralDetails : [])
        .filter((detail) => detail?.applicationId)
        .reduce((sum, detail) => sum + (Number(detail?.amount) || 0), 0);
    const planAmount = Math.max(0, Number(row?.planAmount) || Number(record?.planAmount) || 0);
    const balanceAfterPayment = Math.max(0, Number(row?.balanceAfterPayment) || 0);
    const referralCapacity = normalizeAdjustmentAmount(Math.min(
        planAmount,
        Math.max(0, balanceAfterPayment + activeReferralAmount)
    ));
    if (referralCapacity <= BILLING_EPSILON) return null;
    return {
        referrerAccountNumber: accountNumber,
        billingMonth: row.billingMonthKey,
        referralCapacity
    };
};

async function buildPaymentRecordForAccount(accountNumber, branchId = null) {
    const safeAccountNumber = String(accountNumber || '').trim();
    if (!safeAccountNumber) return null;

    let [referralData, plans, adjustments, disconnections] = await Promise.all([
        referralsModule.loadReferralLedgerForBranch(branchId),
        readPlans(branchId),
        readPaymentBreakdownAdjustments(),
        readBranchDisconnections(branchId)
    ]);
    let customers = referralData.customers || [];
    let payments = referralData.payments || {};
    let referralDiscountsByAccount = buildReferralDiscountMap(referralData.items || []);
    let referralOptionsByAccount = buildReferralOptionMap(referralData.items || []);
    const customer = Array.isArray(customers)
        ? customers.find((entry) => String(entry?.accountNumber || '').trim() === safeAccountNumber)
        : null;
    if (!customer) return null;
    let record = buildPaymentRecord(
        customer,
        payments,
        plans,
        adjustments,
        branchId,
        disconnections,
        referralDiscountsByAccount,
        referralOptionsByAccount
    );
    const billingTarget = buildAutomaticReferralTarget(record);
    if (billingTarget) {
        const allocation = await referralsModule.allocateQueuedReferralDiscounts({
            branchId,
            billingTargets: [billingTarget]
        });
        if (allocation?.changed) {
            referralData = await referralsModule.loadReferralLedgerForBranch(branchId);
            customers = referralData.customers || [];
            payments = referralData.payments || {};
            referralDiscountsByAccount = buildReferralDiscountMap(referralData.items || []);
            referralOptionsByAccount = buildReferralOptionMap(referralData.items || []);
            const refreshedCustomer = customers.find((entry) => (
                String(entry?.accountNumber || '').trim() === safeAccountNumber
            )) || customer;
            record = buildPaymentRecord(
                refreshedCustomer,
                payments,
                plans,
                adjustments,
                branchId,
                disconnections,
                referralDiscountsByAccount,
                referralOptionsByAccount
            );
        }
    }
    return record;
}

async function buildPaymentRecordsForBranch(branchId = null) {
    let [referralData, plans, adjustments, disconnections] = await Promise.all([
        referralsModule.loadReferralLedgerForBranch(branchId),
        readPlans(branchId),
        readPaymentBreakdownAdjustments(),
        readBranchDisconnections(branchId)
    ]);
    let customers = referralData.customers || [];
    let payments = referralData.payments || {};
    let referralDiscountsByAccount = buildReferralDiscountMap(referralData.items || []);
    let referralOptionsByAccount = buildReferralOptionMap(referralData.items || []);
    let records = customers
        .map((customer) => buildPaymentRecord(
            customer,
            payments,
            plans,
            adjustments,
            branchId,
            disconnections,
            referralDiscountsByAccount,
            referralOptionsByAccount
        ))
        .filter(Boolean);
    const billingTargets = records.map(buildAutomaticReferralTarget).filter(Boolean);
    if (billingTargets.length) {
        const allocation = await referralsModule.allocateQueuedReferralDiscounts({ branchId, billingTargets });
        if (allocation?.changed) {
            referralData = await referralsModule.loadReferralLedgerForBranch(branchId);
            customers = referralData.customers || [];
            payments = referralData.payments || {};
            referralDiscountsByAccount = buildReferralDiscountMap(referralData.items || []);
            referralOptionsByAccount = buildReferralOptionMap(referralData.items || []);
            records = customers.map((customer) => buildPaymentRecord(
                customer,
                payments,
                plans,
                adjustments,
                branchId,
                disconnections,
                referralDiscountsByAccount,
                referralOptionsByAccount
            )).filter(Boolean);
        }
    }
    return records;
}

// Logic to calculate payment summary for a customer

function calculatePaymentSummary(history = [], creditLimit, planAmount) {
    let creditsAll = 0;          // includes payment, rebate, discount (all credits)
    let creditsPayments = 0;     // only real payments
    let totalDebits = 0;         // charges/bills/debits
    let lastPayment = null;

    getEffectivePaymentEntries(history).forEach(entry => {
        const amount = Math.abs(Number(entry.amount) || 0);
        const direction = resolveDirection(entry);

        if (direction === 'debit') {
            totalDebits += amount;
        } else if (direction === 'credit') {
            // Count all credits toward reducing balance
            creditsAll += amount;
            // But only count payments toward collected metric
            if (entry.kind === 'payment') {
                creditsPayments += amount;
            }
        }

        // Only consider entries with kind 'payment' for the "Last Payment" column logic
        if (entry.kind === 'payment' && direction === 'credit') {
            const entryTime = new Date(entry.recordedAt || entry.date || '').getTime();
            const lastTime = new Date(lastPayment?.recordedAt || lastPayment?.date || '').getTime();
            if (!lastPayment || Number.isNaN(lastTime) || (!Number.isNaN(entryTime) && entryTime > lastTime)) {
                lastPayment = { ...entry, direction };
            }
        }
    });

    // Balance should consider all credits (payments + rebate + discount)
    const balance = Number((totalDebits - creditsAll).toFixed(2));

    const limit = Number.isFinite(creditLimit) && creditLimit >= 0
        ? creditLimit
        : (Number(planAmount) || 0);

    let status;
    if (balance > (limit || 0)) status = 'Overdue';
    else if (balance > 0) status = 'Due';
    else if (balance < 0) status = 'Advance';
    else status = 'Paid';

    const lastPaymentAmount = lastPayment
        ? Number(((lastPayment.direction === 'debit' ? -1 : 1) * (Math.abs(Number(lastPayment.amount) || 0))).toFixed(2))
        : 0;

    const lastPaymentRecorder = lastPayment && lastPayment.recordedBy ? {
        id: lastPayment.recordedBy.id || null,
        username: lastPayment.recordedBy.username || null,
        name: lastPayment.recordedBy.name || lastPayment.recordedBy.username || null,
        role: lastPayment.recordedBy.role || null,
    } : null;

    return {
        balance,
    // Keep existing name for frontend metric: totalCredits = only payments collected
    totalCredits: creditsPayments,
    // Expose all credits as well in case it’s needed elsewhere
    totalCreditsAll: creditsAll,
        status,
        lastPaymentAmount,
        lastPaymentDate: lastPayment ? lastPayment.date : 'N/A',
        lastPaymentDirection: lastPayment ? lastPayment.direction : null,
        lastPaymentKind: lastPayment ? lastPayment.kind : null,
        lastPaymentRecorder,
    };
}

// GET /api/payment-records - Get combined customer and payment data
router.get('/', async (req, res, next) => {
    try {
        const branchId = req.user?.branchId || null;
        const paymentRecords = await buildPaymentRecordsForBranch(branchId);

        res.json({ records: paymentRecords });
    } catch (error) {
        next(createError(500, 'Failed to generate payment records.'));
    }
});

// GET /api/payment-records/reconciliation/report - Recalculate and report billing integrity issues
router.get('/reconciliation/report', async (req, res, next) => {
    try {
        const user = assertAdminUser(req);
        const records = await buildPaymentRecordsForBranch(user.branchId || null);
        const accounts = records
            .map((record) => ({
                accountNumber: record.accountNumber,
                customerName: [record.firstName, record.lastName].filter(Boolean).join(' ').trim() || record.name || '',
                planType: record.billingSummary?.planType || record.planCategory || 'postpaid',
                status: record.billingSummary?.reconciliation?.status || 'error',
                issues: record.billingSummary?.reconciliation?.issues || []
            }))
            .filter((record) => record.issues.length > 0);
        res.json({
            checkedAt: new Date().toISOString(),
            accountCount: records.length,
            affectedAccountCount: accounts.length,
            errorAccountCount: accounts.filter((record) => record.status === 'error').length,
            warningAccountCount: accounts.filter((record) => record.status === 'warning').length,
            accounts
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to reconcile payment records.'));
    }
});

// GET /api/payment-records/:accountNumber - Get one combined customer/payment record
router.get('/:accountNumber', async (req, res, next) => {
    try {
        const accountNumber = String(req.params?.accountNumber || '').trim();
        if (!accountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const record = await buildPaymentRecordForAccount(accountNumber, req.user?.branchId || null);
        if (!record) {
            return next(createError(404, 'Customer not found.'));
        }

        res.json({ record });
    } catch (error) {
        next(createError(500, 'Failed to generate payment record.'));
    }
});

const synchronizeCustomerPlanHistory = async ({ customer, planChanges = [], branchId } = {}) => {
    const changes = sanitizePlanChangeAdjustments(planChanges);
    const fallbackPlan = buildPlanSnapshot(customer);
    const currentMonth = getCurrentBillingMonthKey();
    const currentPlan = resolvePlanSnapshotForMonth(changes, currentMonth, fallbackPlan);
    if (!currentPlan) throw createError(409, 'The subscriber current plan could not be resolved.');

    const customerBranchId = Number(branchId || customer?.branchId);
    if (!Number.isInteger(customerBranchId) || customerBranchId <= 0) {
        throw createError(400, 'Branch assignment missing for this admin account.');
    }
    let synchronizedCustomer = await customersModule.updateCustomerRecord(
        customer.accountNumber,
        {
            planId: currentPlan.planId,
            planName: currentPlan.planName,
            planCategory: currentPlan.planCategory
        },
        {
            branchId: customerBranchId,
            refreshSource: 'payment-breakdown-plan-change',
            allowPastBillingDates: true
        }
    );

    const futureChange = changes.find((change) => change.effectiveMonth > currentMonth) || null;
    if (futureChange) {
        synchronizedCustomer = await customersModule.updateCustomerRecord(
            customer.accountNumber,
            {
                planId: futureChange.planId,
                planName: futureChange.planName,
                planCategory: futureChange.planCategory
            },
            {
                branchId: customerBranchId,
                refreshSource: 'payment-breakdown-plan-schedule',
                allowPastBillingDates: true,
                planChangeEffectiveAt: `${futureChange.effectiveMonth}-01T00:00:00+08:00`
            }
        );
    }

    return {
        customer: synchronizedCustomer,
        currentPlan,
        scheduledPlan: futureChange ? buildPlanSnapshot(futureChange) : null,
        scheduledEffectiveMonth: futureChange?.effectiveMonth || null,
        warning: sanitizeAdjustmentText(synchronizedCustomer?.pppoeProfileSyncWarning)
    };
};

// PATCH /api/payment-records/:accountNumber/breakdown-adjustment - Save audited backend adjustments
router.patch('/:accountNumber/breakdown-adjustment', async (req, res, next) => {
    try {
        const user = assertAdminUser(req);
        const accountNumber = String(req.params?.accountNumber || '').trim();
        if (!accountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const branchId = user.branchId || null;
        const [customers, plans] = await Promise.all([
            readCustomers(branchId),
            readPlans(branchId)
        ]);
        const customer = Array.isArray(customers)
            ? customers.find((entry) => String(entry?.accountNumber || '').trim() === accountNumber)
            : null;
        if (!customer) {
            return next(createError(404, 'Customer not found.'));
        }

        const adjustments = await readPaymentBreakdownAdjustments();
        const branchKey = branchAdjustmentKey(branchId);
        const branchBucket = adjustments[branchKey] && typeof adjustments[branchKey] === 'object'
            ? adjustments[branchKey]
            : {};
        const currentAdjustment = sanitizePaymentBreakdownAdjustment(branchBucket[accountNumber] || {});
        const rawBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        if (hasOwn(rawBody, 'planChanges')) {
            return next(createError(400, 'Plan changes must be submitted through the audited planChange request.'));
        }
        if (hasOwn(rawBody, 'monthlyReferrals')) {
            return next(createError(400, 'Referral discounts must be submitted through the audited referralApplication request.'));
        }
        if (hasOwn(rawBody, 'complimentaryPeriods')) {
            return next(createError(400, 'Complimentary periods must be submitted through the audited complimentaryAccount request.'));
        }
        if (hasOwn(rawBody, 'referralApplication')) {
            const requestApplication = rawBody.referralApplication && typeof rawBody.referralApplication === 'object'
                ? rawBody.referralApplication
                : {};
            const action = sanitizeAdjustmentText(requestApplication.action).toLowerCase();
            const referralId = sanitizeAdjustmentText(requestApplication.referralId);
            const billingMonth = normalizeAdjustmentMonthKey(
                requestApplication.billingMonth || requestApplication.monthKey
            );
            const reason = sanitizeAdjustmentReason(rawBody.reason);
            if (!['apply', 'reverse'].includes(action)) {
                return next(createError(400, 'Referral action must be apply or reverse.'));
            }
            if (action === 'apply') {
                return next(createError(409, 'Approved referrals are applied automatically in queue order. Manual application is not allowed.'));
            }
            if (!referralId || !billingMonth) {
                return next(createError(400, 'Choose an eligible referral and billing month.'));
            }
            if (reason.length < 3) {
                return next(createError(400, 'Enter a reason for the referral billing action.'));
            }
            const currentRecord = await buildPaymentRecordForAccount(accountNumber, branchId);
            if (!currentRecord) return next(createError(404, 'Customer payment record not found.'));
            const billingRow = (currentRecord.billingSummary?.rows || []).find((row) => (
                normalizeAdjustmentMonthKey(row?.billingMonthKey || row?.billDate) === billingMonth
            )) || null;
            if (!billingRow || billingRow.sourceType === 'opening' || billingRow.sourceType === 'disconnection') {
                return next(createError(409, 'Choose a generated subscriber billing cycle.'));
            }
            if (String(billingRow.paymentStatus || '').toLowerCase() === 'not-generated') {
                return next(createError(409, 'The selected billing cycle has not been generated yet.'));
            }
            if (action === 'apply' && String(billingRow.paymentStatus || '').toLowerCase() !== 'unpaid') {
                return next(createError(409, 'Referral discounts can only be applied to an unpaid billing cycle.'));
            }
            if (action === 'apply' && (Number(billingRow.due) || 0) <= BILLING_EPSILON) {
                return next(createError(409, 'The selected billing cycle has no remaining due amount.'));
            }
            const referralOption = (Array.isArray(currentRecord.referralOptions) ? currentRecord.referralOptions : [])
                .find((option) => option?.referralId === referralId) || null;
            if (!referralOption) {
                return next(createError(404, 'This referral is not available for the selected subscriber.'));
            }
            const billDateKey = toBillingDateKey(billingRow.billDate);
            const successDateKey = toBillingDateKey(referralOption.successAt);
            if (action === 'apply' && (!successDateKey || !billDateKey || successDateKey > billDateKey)) {
                return next(createError(409, 'This referral became eligible after the selected bill date. Choose a later billing cycle.'));
            }
            if (action === 'reverse') {
                const hasMatchingApplication = (Array.isArray(referralOption.applications) ? referralOption.applications : [])
                    .some((application) => (
                        application?.status === 'applied'
                        && normalizeAdjustmentMonthKey(application.billingMonth) === billingMonth
                    ));
                if (!hasMatchingApplication) {
                    return next(createError(409, 'No applied referral discount was found for this billing cycle.'));
                }
            }
            const referralApplication = await referralsModule.applyReferralDiscount({
                branchId,
                referrerAccountNumber: accountNumber,
                referralId,
                billingMonth,
                action,
                reason,
                user
            });
            const record = await buildPaymentRecordForAccount(accountNumber, branchId);
            return res.json({
                ok: true,
                referralApplication,
                record
            });
        }
        const hasLegacyFirstBillFields = [
            'previousBalance',
            'advance',
            'referral',
            'due',
            'referralName',
            'referredName',
            'referralClientName',
            'referralAccountNumber',
            'referredAccountNumber'
        ].some((field) => hasOwn(rawBody, field));
        let nextComplimentaryPeriods = currentAdjustment.complimentaryPeriods;
        let complimentaryChangeResult = null;
        if (hasOwn(rawBody, 'complimentaryAccount')) {
            if (rawBody.confirmed !== true) {
                return next(createError(400, 'Confirm the complimentary-account billing policy before saving.'));
            }
            const reason = sanitizeAdjustmentReason(rawBody.reason);
            if (reason.length < 3) {
                return next(createError(400, 'Enter a reason for the complimentary-account change.'));
            }
            const requestPolicy = rawBody.complimentaryAccount && typeof rawBody.complimentaryAccount === 'object'
                ? rawBody.complimentaryAccount
                : {};
            const action = sanitizeAdjustmentText(requestPolicy.action).toLowerCase();
            const currentMonth = getCurrentComplimentaryMonthKey();
            const changedBy = {
                id: user.id || null,
                username: user.username || null,
                name: user.name || user.username || null
            };
            const timestamp = new Date().toISOString();

            if (action === 'enable') {
                const subscriberStatus = String(customer?.status || 'active').trim().toLowerCase();
                if (subscriberStatus !== 'active') {
                    return next(createError(409, 'Reactivate or reconnect the subscriber before enabling complimentary billing.'));
                }
                const effectiveMonth = normalizeAdjustmentMonthKey(requestPolicy.effectiveMonth) || currentMonth;
                const endMonth = normalizeAdjustmentMonthKey(requestPolicy.endMonth);
                if (!effectiveMonth || effectiveMonth < currentMonth) {
                    return next(createError(400, `Choose ${currentMonth} or a future effective month.`));
                }
                if (endMonth && endMonth < effectiveMonth) {
                    return next(createError(400, 'The optional end month cannot be before the effective month.'));
                }
                const overlapsExisting = currentAdjustment.complimentaryPeriods.some((period) => {
                    if (period.cancelledAt) return false;
                    const leftEnd = endMonth || '9999-12';
                    const rightEnd = period.endMonth || '9999-12';
                    return effectiveMonth <= rightEnd && period.effectiveMonth <= leftEnd;
                });
                if (overlapsExisting) {
                    return next(createError(409, 'This complimentary period overlaps an existing active, scheduled, or historical period.'));
                }
                const balanceTreatment = String(requestPolicy.balanceTreatment || 'keep').trim().toLowerCase() === 'write-off'
                    ? 'write-off'
                    : 'keep';
                if (balanceTreatment === 'write-off' && effectiveMonth > currentMonth) {
                    return next(createError(409, 'A future complimentary period must keep the current balance. Choose write off when that month begins so the amount can be audited exactly.'));
                }
                const currentRecord = await buildPaymentRecordForAccount(accountNumber, branchId);
                if (!currentRecord) return next(createError(404, 'Customer payment record not found.'));
                const writeOffAmount = balanceTreatment === 'write-off'
                    ? normalizeAdjustmentAmount(Math.max(0, Number(currentRecord?.billingSummary?.endingBalance) || 0))
                    : 0;
                complimentaryChangeResult = sanitizeComplimentaryPeriods([{
                    periodId: `complimentary-${accountNumber}-${effectiveMonth}-${Date.now()}`,
                    effectiveMonth,
                    endMonth,
                    balanceTreatment,
                    writeOffAmount,
                    reason,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    changedBy
                }])[0];
                nextComplimentaryPeriods = sanitizeComplimentaryPeriods([
                    ...currentAdjustment.complimentaryPeriods,
                    complimentaryChangeResult
                ]);
            } else if (action === 'disable') {
                const resumeMonth = normalizeAdjustmentMonthKey(requestPolicy.resumeMonth || requestPolicy.effectiveMonth);
                if (!resumeMonth || resumeMonth <= currentMonth) {
                    return next(createError(400, `Choose a resume month after ${currentMonth}. The free month will not be back-billed.`));
                }
                const candidate = currentAdjustment.complimentaryPeriods
                    .filter((period) => (
                        !period.cancelledAt
                        && period.effectiveMonth <= resumeMonth
                        && (!period.endMonth || period.endMonth >= resumeMonth)
                    ))
                    .slice(-1)[0] || null;
                if (!candidate) {
                    return next(createError(409, 'No complimentary period covers the selected resume month.'));
                }
                const endMonth = addMonthKey(resumeMonth, -1);
                nextComplimentaryPeriods = sanitizeComplimentaryPeriods(
                    currentAdjustment.complimentaryPeriods.map((period) => (
                        period.periodId === candidate.periodId
                            ? (candidate.effectiveMonth === resumeMonth
                                ? {
                                    ...period,
                                    cancelledAt: timestamp,
                                    cancelledFromMonth: resumeMonth,
                                    endReason: reason,
                                    updatedAt: timestamp,
                                    endedBy: changedBy
                                }
                                : {
                                ...period,
                                endMonth,
                                endReason: reason,
                                updatedAt: timestamp,
                                endedBy: changedBy
                                })
                            : period
                    ))
                );
                complimentaryChangeResult = nextComplimentaryPeriods.find((period) => period.periodId === candidate.periodId) || null;
            } else {
                return next(createError(400, 'Complimentary-account action must be enable or disable.'));
            }
        }
        let nextPlanChanges = currentAdjustment.planChanges;
        let planChangeResult = null;
        if (hasOwn(rawBody, 'planChange')) {
            if (rawBody.confirmed !== true) {
                return next(createError(400, 'Confirm that paid bills will remain unchanged before saving the plan change.'));
            }
            const reason = sanitizeAdjustmentReason(rawBody.reason);
            if (reason.length < 3) {
                return next(createError(400, 'Enter a reason for the plan change.'));
            }
            const requestPlanChange = rawBody.planChange && typeof rawBody.planChange === 'object'
                ? rawBody.planChange
                : {};
            const effectiveMonth = normalizeAdjustmentMonthKey(requestPlanChange.effectiveMonth);
            if (!effectiveMonth) {
                return next(createError(400, 'Choose a valid effective month.'));
            }
            const currentRecord = await buildPaymentRecordForAccount(accountNumber, branchId);
            if (!currentRecord) {
                return next(createError(404, 'Customer payment record not found.'));
            }
            const earliestRowMonth = (currentRecord.billingSummary?.rows || [])
                .map((row) => normalizeAdjustmentMonthKey(row?.billingMonthKey || row?.billDate))
                .filter(Boolean)
                .sort()[0] || '';
            const activationMonth = normalizeAdjustmentMonthKey(customer.activationDate || customer.activation_date);
            const earliestAllowedMonth = activationMonth || earliestRowMonth;
            if (earliestAllowedMonth && effectiveMonth < earliestAllowedMonth) {
                return next(createError(400, `The effective month cannot be before ${earliestAllowedMonth}.`));
            }

            const selectedPlan = findPlanSnapshot(plans, requestPlanChange);
            if (!selectedPlan) {
                return next(createError(404, 'The selected plan no longer exists. Reload the page and choose again.'));
            }
            const currentMonth = getCurrentBillingMonthKey();
            const existingChange = currentAdjustment.planChanges.find((change) => (
                change.effectiveMonth === effectiveMonth
            )) || null;
            let retainedChanges = currentAdjustment.planChanges.filter((change) => (
                change.effectiveMonth !== effectiveMonth
            ));
            if (effectiveMonth > currentMonth) {
                retainedChanges = retainedChanges.filter((change) => change.effectiveMonth <= currentMonth);
            }
            const previousPlan = existingChange?.previousPlan
                || resolvePlanSnapshotForMonth(retainedChanges, effectiveMonth, buildPlanSnapshot(customer));
            const laterChange = retainedChanges.find((change) => change.effectiveMonth > effectiveMonth) || null;
            const changedBy = {
                id: user.id || null,
                username: user.username || null,
                name: user.name || user.username || null
            };
            const entry = buildEffectivePlanChangeEntry({
                effectiveMonth,
                selectedPlan,
                previousPlan,
                existingChange,
                laterChange,
                rows: currentRecord.billingSummary?.rows || [],
                changedBy,
                reason
            });
            nextPlanChanges = sanitizePlanChangeAdjustments([...retainedChanges, entry]);
            planChangeResult = entry;
        }

        const requestedFirstBill = hasOwn(rawBody, 'firstBill')
            ? {
                ...(currentAdjustment.firstBill || {}),
                ...(rawBody.firstBill && typeof rawBody.firstBill === 'object' && !Array.isArray(rawBody.firstBill)
                    ? rawBody.firstBill
                    : {})
            }
            : (hasLegacyFirstBillFields
                ? { ...(currentAdjustment.firstBill || {}), ...rawBody }
                : currentAdjustment.firstBill);
        const nextAdjustment = sanitizePaymentBreakdownAdjustment({
            firstBill: requestedFirstBill,
            monthlyReferrals: hasOwn(rawBody, 'monthlyReferrals')
                ? rawBody.monthlyReferrals
                : currentAdjustment.monthlyReferrals,
            planChanges: nextPlanChanges,
            complimentaryPeriods: nextComplimentaryPeriods
        });

        const previousStoredAdjustment = branchBucket[accountNumber]
            ? JSON.parse(JSON.stringify(branchBucket[accountNumber]))
            : null;
        branchBucket[accountNumber] = {
            ...nextAdjustment,
            updatedAt: new Date().toISOString(),
            updatedBy: {
                id: user.id || null,
                username: user.username || null,
                name: user.name || user.username || null
            }
        };
        adjustments[branchKey] = branchBucket;
        await writePaymentBreakdownAdjustments(adjustments);
        let subscriberSync = null;
        if (planChangeResult) {
            try {
                subscriberSync = await synchronizeCustomerPlanHistory({
                    customer,
                    planChanges: nextAdjustment.planChanges,
                    branchId
                });
            } catch (syncError) {
                if (previousStoredAdjustment) {
                    branchBucket[accountNumber] = previousStoredAdjustment;
                } else {
                    delete branchBucket[accountNumber];
                }
                adjustments[branchKey] = branchBucket;
                await writePaymentBreakdownAdjustments(adjustments);
                throw syncError;
            }
        }
        const record = await buildPaymentRecordForAccount(accountNumber, branchId);

        res.json({
            ok: true,
            adjustment: sanitizePaymentBreakdownAdjustment(branchBucket[accountNumber]),
            planChange: planChangeResult,
            complimentaryAccount: complimentaryChangeResult,
            subscriberSync,
            record
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to save payment breakdown adjustment.'));
    }
});

module.exports = router;
module.exports.buildPaymentRecordForAccount = buildPaymentRecordForAccount;
module.exports.buildPaymentRecordsForBranch = buildPaymentRecordsForBranch;
module.exports.buildPaymentRecord = buildPaymentRecord;
module.exports.buildCanonicalBillingSummary = buildCanonicalBillingSummary;
module.exports.buildAutomaticReferralTarget = buildAutomaticReferralTarget;
module.exports.buildEffectivePlanChangeEntry = buildEffectivePlanChangeEntry;
module.exports.resolvePlanSnapshotForMonth = resolvePlanSnapshotForMonth;
