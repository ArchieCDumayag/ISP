document.addEventListener('DOMContentLoaded', () => {
    const locale = 'en-PH';
    const appTimeZone = window.__APP_TIMEZONE__ || 'Asia/Manila';
    const utcOffsetSuffix = 'Z';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
    const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-\d{2}/;
    const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const EPSILON = 0.005;
    const MAX_SYNTHETIC_ROWS = 120;

    const params = new URLSearchParams(window.location.search || '');
    const accountNumber = String(params.get('account') || params.get('accountNumber') || '').trim();

    const titleEl = document.getElementById('breakdownTitle');
    const subtitleEl = document.getElementById('breakdownSubtitle');
    const tableBody = document.getElementById('breakdownTableBody');
    const summaryEl = document.getElementById('breakdownSummary');
    const addPaymentBtn = document.getElementById('breakdownAddPaymentBtn');
    const adjustmentToolbar = {
        form: document.getElementById('breakdownAdjustmentToolbar'),
        toggle: document.getElementById('breakdownAdjustmentToggle'),
        month: document.getElementById('breakdownAdjustmentMonth'),
        previousBalance: document.getElementById('breakdownAdjustmentPreviousBalance'),
        advance: document.getElementById('breakdownAdjustmentAdvance'),
        referral: document.getElementById('breakdownAdjustmentReferral'),
        referralName: document.getElementById('breakdownAdjustmentReferralName'),
        due: document.getElementById('breakdownAdjustmentDue'),
        save: document.getElementById('breakdownAdjustmentSave')
    };
    const referralToolbar = {
        form: document.getElementById('breakdownReferralToolbar'),
        month: document.getElementById('breakdownReferralMonth'),
        subscriber: document.getElementById('breakdownReferralSubscriber'),
        amount: document.getElementById('breakdownReferralAmount'),
        save: document.getElementById('breakdownReferralSave'),
        cancel: document.getElementById('breakdownReferralCancel')
    };
    const planToolbar = {
        form: document.getElementById('breakdownPlanToolbar'),
        toggle: document.getElementById('breakdownPlanToggle'),
        effectiveMonth: document.getElementById('breakdownPlanEffectiveMonth'),
        plan: document.getElementById('breakdownPlanSelect'),
        save: document.getElementById('breakdownPlanSave'),
        cancel: document.getElementById('breakdownPlanCancel')
    };
    const disconnectBtn = document.getElementById('breakdownDisconnectBtn');
    const reconnectBtn = document.getElementById('breakdownReconnectBtn');
    const subscriberInfo = {
        card: document.getElementById('subscriberInfoCard'),
        avatar: document.getElementById('subscriberInfoAvatar'),
        name: document.getElementById('subscriberInfoName'),
        meta: document.getElementById('subscriberInfoMeta'),
        status: document.getElementById('subscriberInfoStatus'),
        account: document.getElementById('subscriberInfoAccount'),
        planType: document.getElementById('subscriberInfoPlanType'),
        plan: document.getElementById('subscriberInfoPlan'),
        billingCycle: document.getElementById('subscriberInfoBillingCycle'),
        activationDate: document.getElementById('subscriberInfoActivationDate'),
        dueDate: document.getElementById('subscriberInfoDueDate'),
        creditLimit: document.getElementById('subscriberInfoCreditLimit'),
        area: document.getElementById('subscriberInfoArea'),
        contact: document.getElementById('subscriberInfoContact'),
        address: document.getElementById('subscriberInfoAddress')
    };
    const metrics = {
        bills: document.getElementById('breakdownMetricBills'),
        paid: document.getElementById('breakdownMetricPaid'),
        referral: document.getElementById('breakdownMetricReferral'),
        balance: document.getElementById('breakdownMetricBalance')
    };
    const state = {
        record: null,
        customers: [],
        rows: [],
        context: null,
        savingAdjustment: false,
        savingReferralAdjustment: false,
        savingPlanChange: false,
        disconnecting: false,
        reconnecting: false,
        adjustmentToolbarOpen: false,
        referralToolbarOpen: false,
        planToolbarOpen: false,
        selectedReferralMonthKey: '',
        plans: []
    };

    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const countFormatter = new Intl.NumberFormat(locale);
    const dateFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const monthFormatter = new Intl.DateTimeFormat(locale, {
        timeZone: appTimeZone,
        month: 'short',
        year: 'numeric'
    });
    const zonedDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: appTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizeText = (value) => String(value || '').trim().toLowerCase();
    const normalizeIdentity = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, '');
    const toAmount = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    };
    const roundMoney = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Number(parsed.toFixed(2));
    };
    const roundWholePeso = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.round(parsed);
    };
    const toEditableAmount = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return roundMoney(parsed);
    };
    const hasAmountOverride = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && !value.trim()) return false;
        return Number.isFinite(Number(value));
    };
    const toOptionalEditableAmount = (value) => (hasAmountOverride(value) ? toEditableAmount(value) : null);
    const toAdjustmentDisplayText = (value) => String(value || '').trim().slice(0, 160);
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
    const normalizeAdjustmentMonthKey = (value) => {
        const text = toAdjustmentDisplayText(value);
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
    const formatEditableAmount = (value) => {
        const amount = toEditableAmount(value);
        return amount ? amount.toFixed(2) : '';
    };
    const setAdjustmentInputValue = (input, value) => {
        if (!input) return;
        const nextValue = String(value || '');
        input.value = nextValue;
        input.dataset.originalValue = nextValue;
        delete input.dataset.dirty;
    };
    const isAdjustmentInputDirty = (input) => {
        if (!input) return false;
        if (input.dataset.dirty === 'true') return true;
        return String(input.value || '') !== String(input.dataset.originalValue || '');
    };
    const normalizeFirstBillAdjustment = (adjustment = null) => {
        const firstBill = resolveRawFirstBillAdjustment(adjustment);
        if (!firstBill || typeof firstBill !== 'object') return null;
        return {
            previousBalance: toEditableAmount(firstBill.previousBalance),
            advance: toEditableAmount(firstBill.advance),
            referral: toOptionalEditableAmount(firstBill.referral),
            due: toOptionalEditableAmount(firstBill.due),
            referralName: toAdjustmentDisplayText(
                firstBill.referralName
                || firstBill.referredName
                || firstBill.referralClientName
            ),
            referralAccountNumber: toAdjustmentDisplayText(
                firstBill.referralAccountNumber
                || firstBill.referredAccountNumber
            )
        };
    };
    const normalizeMonthlyReferralAdjustments = (input = {}) => {
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
            if (!monthKey || !hasAmountOverride(referralValue)) return acc;
            const referralName = toAdjustmentDisplayText(
                item.referralName
                || item.referredName
                || item.referralClientName
                || item.name
            );
            const referralAccountNumber = toAdjustmentDisplayText(
                item.referralAccountNumber
                || item.referredAccountNumber
                || item.accountNumber
            );
            acc[monthKey] = {
                monthKey,
                referral: toEditableAmount(referralValue)
            };
            if (referralName) acc[monthKey].referralName = referralName;
            if (referralAccountNumber) acc[monthKey].referralAccountNumber = referralAccountNumber;
            return acc;
        }, {});
    };
    const normalizePlanChangeAdjustments = (input = []) => {
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
            const planAmount = toEditableAmount(value.planAmount ?? value.amount ?? value.price);
            if (!effectiveMonth || planAmount <= 0) return;
            const planCategory = toAdjustmentDisplayText(value.planCategory || value.category || value.planType).toLowerCase();
            const entry = {
                effectiveMonth,
                planId: toAdjustmentDisplayText(value.planId || value.id),
                planName: toAdjustmentDisplayText(value.planName || value.name || value.label) || 'Adjusted plan',
                planAmount
            };
            if (planCategory === 'prepaid' || planCategory === 'postpaid') {
                entry.planCategory = planCategory;
            }
            byMonth.set(effectiveMonth, entry);
        });
        return Array.from(byMonth.values()).sort((left, right) => (
            left.effectiveMonth.localeCompare(right.effectiveMonth)
        ));
    };
    const normalizePaymentBreakdownAdjustment = (adjustment = null) => {
        if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment)) {
            return { firstBill: null, monthlyReferrals: {}, planChanges: [] };
        }
        return {
            firstBill: normalizeFirstBillAdjustment(adjustment),
            monthlyReferrals: normalizeMonthlyReferralAdjustments(
                adjustment.monthlyReferrals
                || adjustment.referralAdjustments
                || adjustment.monthlyReferralAdjustments
            ),
            planChanges: normalizePlanChangeAdjustments(
                adjustment.planChanges
                || adjustment.scheduledPlanChanges
                || adjustment.planChangeAdjustments
            )
        };
    };
    const getPaymentBreakdownAdjustment = (record = {}) => normalizePaymentBreakdownAdjustment(
        record.paymentBreakdownAdjustment
        || record.breakdownAdjustment
        || record.firstBillAdjustment
        || null
    );
    const getFirstBillAdjustment = (record = {}) => getPaymentBreakdownAdjustment(record).firstBill;
    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCurrencyNoCents = (value) => `₱${(Number(value) || 0).toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    })}`;
    const formatCount = (value) => countFormatter.format(Number(value) || 0);
    const showToast = (message, type = 'info') => {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof window.appToast === 'function') {
            window.appToast(text, { type });
            return;
        }
        window.alert(text);
    };

    const parseDateOnlyParts = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const match = raw.match(DATE_ONLY_RE);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
        return { year, month, day };
    };

    const buildStableDate = (year, month, day) => new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const safeDate = (raw) => {
        if (!raw && raw !== 0) return null;
        const text = String(raw).trim();
        if (!text) return null;

        const dateOnlyParts = parseDateOnlyParts(text);
        if (dateOnlyParts) {
            return buildStableDate(dateOnlyParts.year, dateOnlyParts.month, dateOnlyParts.day);
        }
        if (SQL_DATETIME_RE.test(text)) {
            const parsed = new Date(text.replace(' ', 'T') + utcOffsetSuffix);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (ISO_DATETIME_NO_TZ_RE.test(text)) {
            const parsed = new Date(`${text}${utcOffsetSuffix}`);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const getZonedDateParts = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const parts = zonedDatePartsFormatter.formatToParts(date);
        const year = Number(parts.find((part) => part.type === 'year')?.value || 0);
        const month = Number(parts.find((part) => part.type === 'month')?.value || 0);
        const day = Number(parts.find((part) => part.type === 'day')?.value || 0);
        if (!year || !month || !day) return null;
        return { year, month, day };
    };

    const getBillingMonthKey = (date) => {
        const parts = getZonedDateParts(date);
        if (!parts) return '';
        return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}`;
    };

    const buildMonthlyDate = (year, month, billingDay) => {
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return buildStableDate(year, month, Math.min(Math.max(Number(billingDay) || 1, 1), lastDay));
    };

    const getMonthEndDate = (date) => {
        const parts = getZonedDateParts(date);
        if (!parts) return null;
        return buildStableDate(parts.year, parts.month, new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate());
    };

    const hasMonthEndBillingCycle = (record = {}) => {
        const text = String([
            record.billingCycle,
            record.billing_cycle,
            record.planBilling,
            record.billing
        ].filter(Boolean).join(' ')).trim().toLowerCase();
        return /\blast\b/.test(text) && /\bmonth\b/.test(text);
    };

    const isSameBillingMonth = (left, right) => {
        const leftParts = getZonedDateParts(left);
        const rightParts = getZonedDateParts(right);
        return Boolean(
            leftParts
            && rightParts
            && leftParts.year === rightParts.year
            && leftParts.month === rightParts.month
        );
    };

    const compareBillingDateOnly = (left, right) => {
        const leftParts = getZonedDateParts(left);
        const rightParts = getZonedDateParts(right);
        if (!leftParts || !rightParts) {
            const leftTime = left instanceof Date && !Number.isNaN(left.getTime()) ? left.getTime() : 0;
            const rightTime = right instanceof Date && !Number.isNaN(right.getTime()) ? right.getTime() : 0;
            return leftTime - rightTime;
        }
        if (leftParts.year !== rightParts.year) return leftParts.year - rightParts.year;
        if (leftParts.month !== rightParts.month) return leftParts.month - rightParts.month;
        return leftParts.day - rightParts.day;
    };

    const isBeforeBillingDate = (left, right) => compareBillingDateOnly(left, right) < 0;
    const isOnOrBeforeBillingDate = (left, right) => compareBillingDateOnly(left, right) <= 0;
    const isBeforeBillingMonth = (left, right) => {
        const leftParts = getZonedDateParts(left);
        const rightParts = getZonedDateParts(right);
        if (!leftParts || !rightParts) return isBeforeBillingDate(left, right);
        if (leftParts.year !== rightParts.year) return leftParts.year < rightParts.year;
        return leftParts.month < rightParts.month;
    };
    const getTodayBillingDate = () => {
        const parts = getZonedDateParts(new Date());
        return parts ? buildStableDate(parts.year, parts.month, parts.day) : new Date();
    };
    const isPreviousBillingMonth = (date) => isBeforeBillingMonth(date, getTodayBillingDate());

    const getInclusiveDayCount = (startDate, endDate) => {
        const startParts = getZonedDateParts(startDate);
        const endParts = getZonedDateParts(endDate);
        if (!startParts || !endParts) return 0;
        const startUtc = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
        const endUtc = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
        if (endUtc < startUtc) return 0;
        return Math.floor((endUtc - startUtc) / 86400000) + 1;
    };

    const isExistingCustomerStart = (record = {}) => {
        const raw = normalizeText(
            record.customerStartType
            || record.subscriberStartType
            || record.customerOrigin
            || ''
        );
        return raw === 'existing';
    };

    const resolveFirstMonthProration = (record = {}, billDate = null, fullPlanAmount = 0) => {
        const activationDate = safeDate(record.activationDate || record.activation_date);
        const planAmount = Number(fullPlanAmount) || 0;
        if (isExistingCustomerStart(record) && activationDate && billDate && isSameBillingMonth(activationDate, billDate)) {
            return {
                amount: 0,
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }
        if (!activationDate || !billDate || planAmount <= 0 || !isSameBillingMonth(activationDate, billDate)) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }

        const periodEnd = getMonthEndDate(activationDate);
        const monthStart = new Date(activationDate.getFullYear(), activationDate.getMonth(), 1);
        const activeDays = getInclusiveDayCount(activationDate, periodEnd);
        const totalDays = getInclusiveDayCount(monthStart, periodEnd);
        if (!activeDays || !totalDays || activeDays >= totalDays) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }

        return {
            amount: roundWholePeso((planAmount / totalDays) * activeDays),
            isProrated: true,
            periodStart: activationDate,
            periodEnd
        };
    };

    const getNextMonthParts = (year, month) => (
        month >= 12
            ? { year: year + 1, month: 1 }
            : { year, month: month + 1 }
    );

    const getMinDate = (dates = []) => {
        const validDates = dates.filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
        if (!validDates.length) return null;
        return validDates.reduce((earliest, date) => date < earliest ? date : earliest, validDates[0]);
    };

    const getMaxDate = (dates = []) => {
        const validDates = dates.filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
        if (!validDates.length) return null;
        return validDates.reduce((latest, date) => date > latest ? date : latest, validDates[0]);
    };

    const formatDate = (date, fallback = 'No date') => (
        date instanceof Date && !Number.isNaN(date.getTime())
            ? dateFormatter.format(date)
            : fallback
    );

    const formatMonth = (date, fallback = 'Bill') => (
        date instanceof Date && !Number.isNaN(date.getTime())
            ? monthFormatter.format(date)
            : fallback
    );

    const resolveDirection = (entry = {}) => {
        const direction = normalizeText(entry.direction || entry.nature);
        if (direction === 'debit' || direction === 'credit') return direction;
        const kind = normalizeText(entry.kind || entry.type);
        if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
        return 'credit';
    };

    const resolveKind = (entry = {}) => {
        const kind = normalizeText(entry.kind || entry.type);
        if (kind) return kind;
        return resolveDirection(entry) === 'debit' ? 'charge' : 'payment';
    };

    const isOpeningPreviousBalanceRaw = (entry = {}) => {
        const reference = normalizeText(entry?.reference || entry?.orNumber || entry?.or_number);
        const description = normalizeText([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' '));
        return reference.startsWith('obb-')
            || reference.startsWith('opening-bal-')
            || description.includes('previous balance bill')
            || description.includes('opening previous balance');
    };

    const isPrepaidAutoChargeRaw = (entry = {}) => {
        const description = normalizeText(entry?.description || entry?.notes || entry?.remarks);
        return description.includes('prepaid renewal charge');
    };

    const isOpeningAdvanceRaw = (entry = {}) => {
        const reference = normalizeText(entry?.reference || entry?.orNumber || entry?.or_number);
        const description = normalizeText([
            entry?.description,
            entry?.notes,
            entry?.remarks
        ].filter(Boolean).join(' '));
        return reference.startsWith('oba-')
            || reference.startsWith('opening-adv-')
            || description.includes('opening advance payment');
    };

    const normalizeEntry = (entry, index) => {
        const amount = toAmount(entry?.amount);
        if (!amount) return null;
        const openingPreviousBalance = isOpeningPreviousBalanceRaw(entry);
        const direction = openingPreviousBalance ? 'debit' : resolveDirection(entry);
        const kind = openingPreviousBalance ? 'bill' : resolveKind(entry);
        const dateObj = safeDate(entry?.recordedAt || entry?.recorded_at || entry?.date || entry?.createdAt || entry?.created_at);
        return {
            raw: entry || {},
            index,
            id: String(entry?.id || entry?.entryId || entry?.fingerprint || index),
            amount,
            direction,
            kind,
            dateObj,
            time: dateObj ? dateObj.getTime() : index,
            isOpeningPreviousBalance: openingPreviousBalance,
            isOpeningAdvance: isOpeningAdvanceRaw(entry),
            isPrepaidAutoCharge: isPrepaidAutoChargeRaw(entry)
        };
    };

    const compareEntries = (left, right) => {
        if (left.time !== right.time) return left.time - right.time;
        if (left.direction !== right.direction) return left.direction === 'debit' ? -1 : 1;
        return left.index - right.index;
    };

    const getCustomerName = (customer, fallbackAccount = '') => {
        const firstName = String(customer?.firstName || '').trim();
        const lastName = String(customer?.lastName || '').trim();
        const fullFromParts = [firstName, lastName].filter(Boolean).join(' ').trim();
        const fallbackName = String(customer?.name || customer?.fullName || '').trim();
        const account = String(fallbackAccount || customer?.accountNumber || '').trim();
        return fullFromParts || fallbackName || (account ? `Account ${account}` : 'Customer');
    };

    const resolvePlanAmount = (record = {}, overrideAmount = null) => {
        const candidates = [
            overrideAmount,
            record.planAmount,
            record.planPrice,
            record.monthlyFee,
            record.price,
            record.amount
        ];
        for (const candidate of candidates) {
            const parsed = Number(candidate);
            if (Number.isFinite(parsed) && parsed > 0) return roundMoney(parsed);
        }
        return 0;
    };

    const resolvePlanLabel = (record = {}) => {
        const name = String(record.planName || record.plan || '').trim();
        return name || 'Plan';
    };

    const toTitleCase = (value) => {
        const text = String(value || '').trim();
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    };

    const normalizePlanTypeValue = (value) => {
        const normalized = normalizeText(value);
        if (normalized.includes('prepaid')) return 'prepaid';
        if (normalized.includes('postpaid')) return 'postpaid';
        return '';
    };

    const resolveSourcePlanType = (record = {}) => {
        const directType = [
            record.sourceType,
            record.source_type,
            record.customerType,
            record.customer_type,
            record.accountType,
            record.account_type,
            record.subscriberType,
            record.subscriber_type
        ].map(normalizePlanTypeValue).find(Boolean);
        if (directType) return directType;

        const remarks = String(record.remarks || record.notes || '').trim();
        const sourceMatch = remarks.match(/\bsource\s+type\s*:\s*(prepaid|postpaid)\b/i);
        if (sourceMatch?.[1]) return normalizePlanTypeValue(sourceMatch[1]);

        return '';
    };

    const resolvePlanType = (record = {}) => {
        const sourceType = resolveSourcePlanType(record);
        if (sourceType) return sourceType;

        const explicit = normalizePlanTypeValue(record.planCategory || record.planType || record.type);
        if (explicit) return explicit;

        const billing = normalizeText(record.planBilling || record.billingCycle || record.billing);
        if (billing.includes('prepaid')) return 'prepaid';
        if (billing.includes('postpaid')) return 'postpaid';

        const planName = normalizeText(record.planName || record.plan);
        if (planName.includes('prepaid')) return 'prepaid';
        return 'postpaid';
    };

    const getOrdinalSuffix = (day) => {
        const value = Number(day);
        if (!Number.isFinite(value)) return '';
        if (value > 3 && value < 21) return 'th';
        switch (value % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    };

    const resolveBillingCycleLabel = (record = {}, billDate = null) => {
        const explicit = String(record.billingCycle || record.billing_cycle || '').trim();
        if (explicit) return explicit;

        const planBilling = String(record.planBilling || record.billing || '').trim();
        const planType = normalizePlanTypeValue(planOverride?.planCategory) || resolvePlanType(record);
        if (planType === 'prepaid') return 'Monthly';

        const cycleDate = safeDate(record.billDate)
            || safeDate(record.dueDate)
            || billDate;
        const day = getZonedDateParts(cycleDate)?.day;
        if (day) return `Every ${day}${getOrdinalSuffix(day)} of the month`;
        return planBilling || 'Monthly';
    };

    const setSubscriberText = (element, value, fallback = '-') => {
        if (!element) return;
        const text = String(value ?? '').trim();
        element.textContent = text || fallback;
    };

    const getSubscriberInitials = (record = {}, fallbackAccount = '') => {
        const firstName = String(record.firstName || '').trim();
        const lastName = String(record.lastName || '').trim();
        const source = firstName || lastName
            ? [firstName, lastName].filter(Boolean)
            : getCustomerName(record, fallbackAccount).split(/\s+/).filter(Boolean);
        const initials = source
            .slice(0, 2)
            .map((part) => part.charAt(0))
            .join('')
            .toUpperCase();
        return initials || '??';
    };

    const resolveSubscriberStatus = (record = {}) => {
        const raw = normalizeText(
            record.customerStatus
            || record.subscriberStatus
            || record.status
            || record.accountStatus
            || ''
        );
        if (raw === 'disabled' || raw === 'suspended') {
            return { label: 'Disabled', className: 'is-disabled' };
        }
        if (raw === 'inactive' || raw === 'archived' || raw === 'deleted') {
            return { label: 'Inactive', className: 'is-inactive' };
        }
        return { label: raw ? toTitleCase(raw) : 'Active', className: 'is-active' };
    };

    const formatRecordDate = (value, fallback = '-') => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return formatDate(value, fallback);
        }
        const parsed = safeDate(value);
        return parsed ? formatDate(parsed, fallback) : fallback;
    };

    const diffDays = (fromDate, toDate) => {
        const fromParts = getZonedDateParts(fromDate);
        const toParts = getZonedDateParts(toDate);
        if (!fromParts || !toParts) return null;
        const fromUtc = Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day);
        const toUtc = Date.UTC(toParts.year, toParts.month - 1, toParts.day);
        return Math.round((toUtc - fromUtc) / 86400000);
    };

    const addDays = (date, days = 0) => {
        const parts = getZonedDateParts(date);
        if (!parts) return null;
        const result = buildStableDate(parts.year, parts.month, parts.day);
        result.setUTCDate(result.getUTCDate() + (Number(days) || 0));
        return result;
    };

    const deriveDueOffset = (record = {}) => {
        const direct = Number(record.dueOffset ?? record.due_offset);
        if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

        const billDate = safeDate(record.billDate || record.bill_date);
        const dueDate = safeDate(record.dueDate || record.due_date);
        const offset = diffDays(billDate, dueDate);
        return Number.isFinite(offset) && offset >= 0 ? offset : null;
    };

    const resolveCurrentDueDate = (record = {}, rows = []) => {
        const latestRow = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
        if (resolvePlanType(record) === 'prepaid') {
            return safeDate(record.prepaidExpirationAt || record.prepaid_expiration_at || record.dueDate || record.due_date)
                || latestRow?.billDate
                || safeDate(record.billDate || record.bill_date);
        }

        const billDate = latestRow?.billDate instanceof Date && !Number.isNaN(latestRow.billDate.getTime())
            ? latestRow.billDate
            : safeDate(record.billDate || record.bill_date);
        const offset = deriveDueOffset(record);
        if (billDate && offset !== null) return addDays(billDate, offset);
        return safeDate(record.dueDate || record.due_date) || billDate;
    };

    const resolveContactText = (record = {}) => {
        const contactParts = [
            record.mobile,
            record.mobileRaw,
            record.phone,
            record.phoneNumber,
            record.email
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        return Array.from(new Set(contactParts)).join(' • ');
    };

    const resolveAddressText = (record = {}) => {
        const explicitAddress = String(record.address || record.fullAddress || '').trim();
        if (explicitAddress) return explicitAddress;
        return [
            record.street,
            record.purok,
            record.sitio,
            record.barangay,
            record.municipality || record.city,
            record.province
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(', ');
    };

    const resolveAreaText = (record = {}) => [
        record.area,
        record.cluster,
        record.coverageArea,
        record.coverage_area
    ]
        .map((value) => String(value || '').trim())
        .find(Boolean) || '';

    const renderSubscriberInfo = (record = {}, rows = state.rows) => {
        const account = String(record.accountNumber || accountNumber || '').trim();
        const customerName = getCustomerName(record, account);
        const planAmount = resolvePlanAmount(record);
        const planName = resolvePlanLabel(record);
        const planType = resolvePlanType(record);
        const billDate = safeDate(record.billDate) || safeDate(record.dueDate);
        const billingCycle = resolveBillingCycleLabel(record, billDate);
        const status = resolveSubscriberStatus(record);
        const joined = String(record.since || record.joinDate || '').trim();
        const creditLimit = Number(record.creditLimit);
        const currentDueDate = resolveCurrentDueDate(record, rows);
        const metaParts = [
            account ? `Account ${account}` : '',
            joined ? `Joined ${joined}` : '',
            resolveAreaText(record)
        ].filter(Boolean);

        if (subscriberInfo.card) subscriberInfo.card.hidden = false;
        setSubscriberText(subscriberInfo.avatar, getSubscriberInitials(record, account));
        setSubscriberText(subscriberInfo.name, customerName, 'Subscriber');
        setSubscriberText(subscriberInfo.meta, metaParts.join(' • '), 'Subscriber account details');
        if (subscriberInfo.status) {
            subscriberInfo.status.className = `subscriber-info-status ${status.className}`;
            subscriberInfo.status.textContent = status.label;
        }
        setSubscriberText(subscriberInfo.account, account);
        setSubscriberText(subscriberInfo.planType, toTitleCase(planType || 'postpaid'));
        setSubscriberText(
            subscriberInfo.plan,
            `${planName}${planAmount ? ` • ${formatCurrency(planAmount)}` : ''}`
        );
        setSubscriberText(subscriberInfo.billingCycle, billingCycle);
        setSubscriberText(subscriberInfo.activationDate, formatRecordDate(record.activationDate || record.activation_date));
        setSubscriberText(subscriberInfo.dueDate, formatRecordDate(currentDueDate || record.dueDate || record.prepaidExpirationAt || record.billDate));
        setSubscriberText(subscriberInfo.creditLimit, Number.isFinite(creditLimit) ? formatCurrency(creditLimit) : '');
        setSubscriberText(subscriberInfo.area, resolveAreaText(record));
        setSubscriberText(subscriberInfo.contact, resolveContactText(record));
        setSubscriberText(subscriberInfo.address, resolveAddressText(record));
    };

    const getReferralValues = (customer = {}) => {
        const values = [];
        [
            'referredBy',
            'referred_by',
            'referredByName',
            'referred_by_name',
            'referredByAccount',
            'referredByAccountNumber',
            'referred_by_account',
            'referred_by_account_number',
            'referrer',
            'referrerName',
            'referrerAccount',
            'referrerAccountNumber',
            'referralAccount',
            'referralAccountNumber',
            'referralSource'
        ].forEach((field) => {
            const value = customer?.[field];
            if (value || value === 0) values.push(String(value));
        });

        const remarks = String(customer?.remarks || customer?.notes || '').trim();
        if (remarks) {
            const patterns = [
                /referred\s+by\s*:\s*([^;\n]+)/gi,
                /referrer\s*:\s*([^;\n]+)/gi,
                /referral\s*:\s*([^;\n]+)/gi
            ];
            patterns.forEach((pattern) => {
                let match;
                while ((match = pattern.exec(remarks)) !== null) {
                    if (match[1]) values.push(match[1]);
                }
            });
        }

        return values.map((value) => String(value || '').trim()).filter(Boolean);
    };

    const getIdentityValues = (customer = {}) => {
        const firstName = String(customer?.firstName || '').trim();
        const lastName = String(customer?.lastName || '').trim();
        const fullName = getCustomerName(customer, customer?.accountNumber);
        return [
            customer?.accountNumber,
            customer?.id,
            customer?.loginUsername,
            customer?.pppoeUsername,
            customer?.name,
            customer?.fullName,
            fullName,
            firstName && lastName ? `${firstName} ${lastName}` : '',
            firstName && lastName ? `${lastName}, ${firstName}` : '',
            firstName && lastName ? `${lastName} ${firstName}` : ''
        ].map((value) => String(value || '').trim()).filter(Boolean);
    };

    const matchesReferralValue = (referralValue, targetIdentitySet) => {
        const referralKey = normalizeIdentity(referralValue);
        if (!referralKey) return false;
        if (targetIdentitySet.has(referralKey)) return true;
        return Array.from(targetIdentitySet).some((identity) => (
            identity.length >= 5
            && (referralKey.includes(identity) || identity.includes(referralKey))
        ));
    };

    const findReferredCustomers = (record = {}, customers = []) => {
        const targetAccount = String(record.accountNumber || accountNumber || '').trim();
        const targetIdentitySet = new Set(
            getIdentityValues(record)
                .map(normalizeIdentity)
                .filter(Boolean)
        );

        return (Array.isArray(customers) ? customers : []).filter((customer) => {
            const currentAccount = String(customer?.accountNumber || '').trim();
            if (targetAccount && currentAccount === targetAccount) return false;
            const referralValues = getReferralValues(customer);
            return referralValues.some((value) => matchesReferralValue(value, targetIdentitySet));
        });
    };

    const isReferralCredit = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        const text = normalizeText([
            entry.kind,
            entry.raw?.kind,
            entry.raw?.type,
            entry.raw?.description,
            entry.raw?.notes,
            entry.raw?.remarks,
            entry.raw?.reference,
            entry.raw?.orNumber
        ].filter(Boolean).join(' '));
        return /\b(referral|referred|referrer)\b/.test(text);
    };

    const isImportedPaymentCredit = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        const kind = normalizeText(entry.kind || entry.raw?.kind || entry.raw?.type);
        if (kind && kind !== 'payment' && kind !== 'credit') return false;
        const reference = String(entry.raw?.reference || entry.raw?.orNumber || '').trim();
        const text = normalizeText([
            entry.raw?.importedFrom,
            entry.raw?.imported_from,
            entry.raw?.description,
            entry.raw?.notes,
            entry.raw?.remarks,
            entry.raw?.paymentMethod,
            entry.raw?.payment_method
        ].filter(Boolean).join(' '));
        return /^CF2026-/i.test(reference)
            || /\bimported\s+(?:cash|gcash|gash)?\s*payment\b/.test(text)
            || /\b(?:cash|gcash|gash)\s+[a-z]+\s*\d{4}\b/.test(text)
            || /\bpayment-history-excel-import\b/.test(text);
    };

    const isPaymentCredit = (entry = {}) => {
        if (entry.direction !== 'credit') return false;
        if (isOpeningAdvanceEntry(entry)) return false;
        const kind = normalizeText(entry.kind || entry.raw?.kind || entry.raw?.type);
        return !kind || kind === 'payment' || kind === 'credit';
    };

    const shouldAttachCreditToBillMonth = (entry = {}, billDate = null, record = {}) => {
        if (!isPaymentCredit(entry) || !entry.dateObj || !billDate) return false;
        if (!isSameBillingMonth(entry.dateObj, billDate)) return false;
        if (isImportedPaymentCredit(entry)) return true;
        return resolvePlanType(record) === 'postpaid';
    };

    const isPendingPostpaidSyntheticBill = (record = {}, billDate = null, todayBillingDate = getTodayBillingDate()) => {
        if (resolvePlanType(record) !== 'postpaid' || !billDate || !todayBillingDate) return false;
        if (!isSameBillingMonth(billDate, todayBillingDate)) return false;
        const releaseDate = getMonthEndDate(billDate) || billDate;
        return compareBillingDateOnly(todayBillingDate, releaseDate) < 0;
    };

    const sumEntries = (entries = []) => roundMoney(
        entries.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0)
    );

    const resolvePaymentModeLabel = (entry = {}) => {
        const rawMode = String(
            entry.raw?.paymentMethod
            || entry.raw?.payment_method
            || entry.raw?.method
            || entry.raw?.channel
            || entry.raw?.paymentChannel
            || entry.raw?.payment_channel
            || ''
        ).trim();
        const normalized = normalizeText(rawMode).replace(/[\s-]+/g, '_');
        if (normalized.includes('gcash') || normalized.includes('ph_gcash')) return 'GCash';
        if (normalized === 'cash' || normalized.includes('_cash') || normalized.includes('cash_')) return 'Cash';
        if (entry.raw?.xenditId || entry.raw?.xendit_id) return rawMode || 'GCash';
        return rawMode || 'Cash';
    };

    const resolvePaymentModeSummary = (entries = []) => {
        const labels = Array.from(new Set(
            (Array.isArray(entries) ? entries : [])
                .map(resolvePaymentModeLabel)
                .filter(Boolean)
        ));
        return labels.length ? labels.join(' + ') : '-';
    };

    const resolveLatestPaymentDate = (entries = []) => {
        const datedEntries = (Array.isArray(entries) ? entries : [])
            .filter((entry) => entry?.dateObj instanceof Date && !Number.isNaN(entry.dateObj.getTime()))
            .sort((left, right) => right.dateObj.getTime() - left.dateObj.getTime());
        return datedEntries[0]?.dateObj || null;
    };

    const applyEntryToBalance = (balance, entry = {}) => {
        const amount = Number(entry.amount) || 0;
        if (entry.direction === 'debit') return roundMoney(balance + amount);
        if (entry.direction === 'credit') return roundMoney(balance - amount);
        return roundMoney(balance);
    };

    const splitBalanceCarryOver = (balanceAfterPayment) => {
        const signedBalance = roundMoney(Number(balanceAfterPayment) || 0);
        if (signedBalance > EPSILON) {
            return {
                signedBalance,
                previousBalance: signedBalance,
                advance: 0,
                type: 'balance'
            };
        }
        if (signedBalance < -EPSILON) {
            return {
                signedBalance,
                previousBalance: 0,
                advance: roundMoney(Math.abs(signedBalance)),
                type: 'advance'
            };
        }
        return {
            signedBalance: 0,
            previousBalance: 0,
            advance: 0,
            type: 'settled'
        };
    };

    const isOpeningPreviousBalanceEntry = (entry = {}) => Boolean(
        entry?.isOpeningPreviousBalance || isOpeningPreviousBalanceRaw(entry?.raw || entry)
    );

    const isPrepaidAutoChargeEntry = (entry = {}) => Boolean(
        entry?.isPrepaidAutoCharge || isPrepaidAutoChargeRaw(entry?.raw || entry)
    );

    const isOpeningAdvanceEntry = (entry = {}) => Boolean(
        entry?.isOpeningAdvance || isOpeningAdvanceRaw(entry?.raw || entry)
    );

    const getEntryDateKey = (entry = {}) => {
        const parts = getZonedDateParts(entry?.dateObj);
        if (!parts) return '';
        return [
            parts.year,
            String(parts.month).padStart(2, '0'),
            String(parts.day).padStart(2, '0')
        ].join('-');
    };

    const findIgnoredOpeningAutoChargeOrders = (entries = []) => {
        const openingAdjustments = entries.filter((entry) => (
            (
                entry.direction === 'debit'
                && isOpeningPreviousBalanceEntry(entry)
            )
            || (
                entry.direction === 'credit'
                && isOpeningAdvanceEntry(entry)
            )
        ));
        if (!openingAdjustments.length) return new Set();

        const ignored = new Set();
        entries.forEach((entry) => {
            if (entry.direction !== 'debit' || !isPrepaidAutoChargeEntry(entry)) return;
            const entryDateKey = getEntryDateKey(entry);
            const matchedOpeningAdjustment = openingAdjustments.some((opening) => {
                const amountMatches = Math.abs((Number(opening.amount) || 0) - (Number(entry.amount) || 0)) <= EPSILON;
                const dateMatches = entryDateKey && entryDateKey === getEntryDateKey(opening);
                const timeDiff = Math.abs((Number(entry.time) || 0) - (Number(opening.time) || 0));
                return amountMatches && dateMatches && timeDiff <= 30000;
            });
            if (matchedOpeningAdjustment) ignored.add(entry.sortOrder);
        });

        return ignored;
    };

    const createReferralContext = (record, entries, customers) => {
        const breakdownAdjustment = getPaymentBreakdownAdjustment(record);
        const planAmount = resolvePlanAmount(record);
        const explicitReferralTotal = sumEntries(entries.filter(isReferralCredit));
        const referralDiscounts = explicitReferralTotal > EPSILON
            ? []
            : getAutomaticReferralDiscounts(record);
        const automaticReferralTotal = explicitReferralTotal > EPSILON
            ? 0
            : roundMoney(referralDiscounts.length * (planAmount / 2));

        return {
            planAmount,
            referredCustomers: referralDiscounts,
            referralDiscounts,
            explicitReferralTotal,
            automaticReferralTotal,
            automaticReferralRemaining: automaticReferralTotal,
            automaticReferralApplied: 0,
            usedReferralDiscountIds: new Set(),
            usedSyntheticBills: false,
            firstBillAdjustment: breakdownAdjustment.firstBill,
            monthlyReferralAdjustments: breakdownAdjustment.monthlyReferrals,
            planChanges: breakdownAdjustment.planChanges
        };
    };

    const getDisconnectionState = (record = {}) => {
        const raw = record?.disconnection || null;
        if (!raw || typeof raw !== 'object') return null;
        if (normalizeText(raw.status) !== 'disconnected') return null;
        const disconnectedAt = safeDate(raw.disconnectedAt || raw.decidedAt || raw.updatedAt);
        if (!disconnectedAt) return null;
        const billingPolicy = normalizeText(raw.billingPolicy) === 'continue' ? 'continue' : 'stop';
        return {
            disconnectedAt,
            billingPolicy,
            billingPolicyLabel: billingPolicy === 'continue' ? 'billing continues' : 'billing stops next month'
        };
    };

    const getRowDisconnectionState = (record = {}, billDate = null) => {
        const disconnection = getDisconnectionState(record);
        if (!disconnection || !billDate || !isSameBillingMonth(disconnection.disconnectedAt, billDate)) return null;
        return disconnection;
    };

    const getMonthlyReferralAdjustment = (context = {}, billDate = null, isFirstRow = false) => {
        if (isFirstRow || !billDate) return null;
        const monthKey = getBillingMonthKey(billDate);
        if (!monthKey) return null;
        const adjustment = context?.monthlyReferralAdjustments?.[monthKey] || null;
        return adjustment && typeof adjustment === 'object' ? adjustment : null;
    };

    const resolvePlanChangeForMonth = (context = {}, billDate = null) => {
        const monthKey = getBillingMonthKey(billDate);
        if (!monthKey) return null;
        const changes = Array.isArray(context?.planChanges) ? context.planChanges : [];
        let selected = null;
        changes.forEach((change) => {
            if (!change?.effectiveMonth || change.effectiveMonth > monthKey) return;
            selected = change;
        });
        return selected;
    };

    const normalizeReferralDiscountItem = (item = {}, index = 0) => {
        const successAt = safeDate(
            item.successAt
            || item.success_at
            || item.paidAt
            || item.paymentDate
            || item.date
        );
        if (!successAt) return null;
        const id = String(
            item.id
            || item.referralId
            || item.referral_id
            || item.referredAccountNumber
            || item.referred_account_number
            || item.referredName
            || `referral-${index}`
        ).trim();
        return {
            id: id || `referral-${index}`,
            referredAccountNumber: String(item.referredAccountNumber || item.referred_account_number || '').trim(),
            referredName: String(item.referredName || item.referred_name || item.name || 'Referral').trim(),
            eligibleMonth: String(item.eligibleMonth || item.eligible_month || '').trim(),
            successAt
        };
    };

    const getAutomaticReferralDiscounts = (record = {}) => {
        const seen = new Set();
        return (Array.isArray(record.referralDiscounts) ? record.referralDiscounts : [])
            .map(normalizeReferralDiscountItem)
            .filter(Boolean)
            .filter((item) => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            })
            .sort((left, right) => {
                const dateDiff = compareBillingDateOnly(left.successAt, right.successAt);
                if (dateDiff) return dateDiff;
                return left.referredName.localeCompare(right.referredName);
            });
    };

    const takeAutomaticReferral = (context, dueBeforeReferral, billDate, planAmount) => {
        const discounts = Array.isArray(context?.referralDiscounts) ? context.referralDiscounts : [];
        const unitAmount = roundMoney((Number(planAmount) || 0) / 2);
        const monthlyPlanCap = Math.max(0, Number(planAmount) || 0);
        let remaining = roundMoney(Math.min(Math.max(0, Number(dueBeforeReferral) || 0), monthlyPlanCap));
        if (!discounts.length || unitAmount <= EPSILON || remaining <= EPSILON || !billDate) {
            return { amount: 0, items: [] };
        }

        const usedIds = context.usedReferralDiscountIds || new Set();
        context.usedReferralDiscountIds = usedIds;
        const items = [];
        let amount = 0;
        let usedThisBill = 0;

        discounts.forEach((item) => {
            if (usedThisBill >= 2 || remaining <= EPSILON) return;
            if (!item?.id || usedIds.has(item.id)) return;
            if (!item.successAt || compareBillingDateOnly(item.successAt, billDate) > 0) return;

            const applied = roundMoney(Math.min(unitAmount, remaining));
            if (applied <= EPSILON) return;
            usedIds.add(item.id);
            usedThisBill += 1;
            amount = roundMoney(amount + applied);
            remaining = roundMoney(remaining - applied);
            context.automaticReferralApplied = roundMoney((Number(context.automaticReferralApplied) || 0) + applied);
            context.automaticReferralRemaining = roundMoney(Math.max(0, (Number(context.automaticReferralRemaining) || 0) - applied));
            items.push({
                id: item.id,
                referredAccountNumber: item.referredAccountNumber,
                referredName: item.referredName,
                eligibleMonth: item.eligibleMonth,
                successAt: item.successAt,
                amount: applied
            });
        });

        return { amount, items };
    };

    const buildManualReferralDetails = (adjustment = {}, amount = 0, fallbackId = 'manual-referral') => {
        const applied = roundMoney(Math.max(0, Number(amount) || 0));
        if (applied <= EPSILON) return [];
        const referredName = toAdjustmentDisplayText(adjustment.referralName) || 'Manual referral';
        return [{
            id: fallbackId,
            referredAccountNumber: toAdjustmentDisplayText(adjustment.referralAccountNumber),
            referredName,
            amount: applied,
            manual: true
        }];
    };

    const createBreakdownRow = ({
        record,
        billDate,
        planAmount,
        credits,
        runningBalance,
        context,
        sourceType,
        proration = null,
        previousBalanceOverride = null,
        advanceOverride = null,
        openingPreviousBalance = false,
        openingAdvance = false,
        paymentModeOverride = '',
        paymentDateOverride = null,
        billLabelOverride = '',
        billMetaOverride = '',
        isFirstRow = false,
        planOverride = null,
        paymentStatusOverride = '',
        paymentStatusLabelOverride = ''
    }) => {
        const planLabel = toAdjustmentDisplayText(planOverride?.planName) || resolvePlanLabel(record);
        const firstBillAdjustment = isFirstRow ? normalizeFirstBillAdjustment(context?.firstBillAdjustment) : null;
        const monthlyReferralAdjustment = getMonthlyReferralAdjustment(context, billDate, isFirstRow);
        const referralAdjustment = firstBillAdjustment && hasAmountOverride(firstBillAdjustment.referral)
            ? firstBillAdjustment
            : monthlyReferralAdjustment;
        const effectivePreviousBalanceOverride = firstBillAdjustment
            ? firstBillAdjustment.previousBalance
            : previousBalanceOverride;
        const effectiveAdvanceOverride = firstBillAdjustment
            ? firstBillAdjustment.advance
            : advanceOverride;
        const hasPreviousBalanceOverride = hasAmountOverride(effectivePreviousBalanceOverride);
        const hasAdvanceOverride = hasAmountOverride(effectiveAdvanceOverride);
        const carryOver = splitBalanceCarryOver(runningBalance);
        const previousBalance = hasPreviousBalanceOverride
            ? roundMoney(Math.max(0, Number(effectivePreviousBalanceOverride) || 0))
            : carryOver.previousBalance;
        const advance = hasAdvanceOverride
            ? roundMoney(Math.max(0, Number(effectiveAdvanceOverride) || 0))
            : carryOver.advance;
        const referralCredits = (Array.isArray(credits) ? credits : []).filter(isReferralCredit);
        const paymentCredits = (Array.isArray(credits) ? credits : []).filter((entry) => !isReferralCredit(entry));
        const explicitReferral = sumEntries(referralCredits);
        const dueBeforeAutoReferral = roundMoney(planAmount - advance + previousBalance - explicitReferral);
        const hasReferralOverride = Boolean(referralAdjustment && hasAmountOverride(referralAdjustment.referral));
        const referralOverride = hasReferralOverride
            ? roundMoney(Math.max(0, Number(referralAdjustment.referral) || 0))
            : 0;
        const automaticReferral = explicitReferral > EPSILON
            ? { amount: 0, items: [] }
            : takeAutomaticReferral(
                context,
                hasReferralOverride ? referralOverride : dueBeforeAutoReferral,
                billDate,
                planAmount
            );
        const referral = hasReferralOverride
            ? referralOverride
            : roundMoney(explicitReferral + automaticReferral.amount);
        const referralDetails = hasReferralOverride
            ? buildManualReferralDetails(referralAdjustment, referral, firstBillAdjustment ? 'manual-first-bill-referral' : `manual-referral-${getBillingMonthKey(billDate)}`)
            : automaticReferral.items;
        const computedRawDue = roundMoney(planAmount - advance + previousBalance - referral);
        const hasDueOverride = Boolean(firstBillAdjustment && hasAmountOverride(firstBillAdjustment.due));
        const rawDue = hasDueOverride
            ? roundMoney(Math.max(0, Number(firstBillAdjustment.due) || 0))
            : computedRawDue;
        const due = roundMoney(Math.max(0, rawDue));
        const amountPaid = sumEntries(paymentCredits);
        const paymentMode = paymentModeOverride || (amountPaid > EPSILON ? resolvePaymentModeSummary(paymentCredits) : '-');
        const paymentDate = paymentDateOverride || (amountPaid > EPSILON ? resolveLatestPaymentDate(paymentCredits) : null);
        const balanceAfterPayment = roundMoney(rawDue - amountPaid);
        const nextCarryOver = splitBalanceCarryOver(balanceAfterPayment);
        const computedPaymentStatus = balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid';
        const paymentStatus = paymentStatusOverride || computedPaymentStatus;
        const paymentStatusLabel = paymentStatusLabelOverride || paymentStatus;
        const billLabel = billLabelOverride || (openingPreviousBalance ? 'Previous Balance' : (openingAdvance ? 'Opening Advance' : formatMonth(billDate, 'Bill')));
        const planType = resolvePlanType(record);
        const planTypeLabel = toTitleCase(planType);
        const billingCycle = resolveBillingCycleLabel(record, billDate);
        const disconnection = getRowDisconnectionState(record, billDate);
        const planAmountDisplay = proration?.isProrated ? formatCurrencyNoCents(planAmount) : formatCurrency(planAmount);
        const billMetaParts = billMetaOverride
            ? [billMetaOverride]
            : openingPreviousBalance
            ? [
                'Opening previous balance',
                formatCurrency(previousBalance),
                'current bill'
            ]
            : openingAdvance
            ? [
                'Opening advance payment',
                formatCurrency(advance)
            ]
            : [
                planLabel,
                planAmountDisplay,
                sourceType === 'posted' ? 'posted bill' : 'monthly plan',
                proration?.isProrated
                    ? `prorated ${formatDate(proration.periodStart, '')} to ${formatDate(proration.periodEnd, '')}`
                    : ''
            ].filter(Boolean);

        return {
            row: {
                billDate,
                billingMonthKey: getBillingMonthKey(billDate),
                billLabel,
                billMeta: billMetaParts.join(' · '),
                planType,
                planTypeLabel,
                planLabel,
                planAmount,
                billingCycle,
                previousBalance,
                advance,
                referral,
                referralDetails,
                due,
                isReferralOverride: hasReferralOverride,
                isMonthlyReferralOverride: Boolean(monthlyReferralAdjustment && hasReferralOverride),
                isDueOverride: hasDueOverride,
                amountPaid,
                paymentMode,
                paymentDateLabel: paymentDate ? formatDate(paymentDate, '-') : '-',
                paymentStatus,
                paymentStatusLabel,
                isDisconnected: Boolean(disconnection),
                disconnectedAt: disconnection?.disconnectedAt || null,
                disconnectionBillingPolicy: disconnection?.billingPolicy || '',
                disconnectionBillingPolicyLabel: disconnection?.billingPolicyLabel || '',
                balanceAfterPayment,
                sourceType,
                isFirstRow,
                isProrated: Boolean(proration?.isProrated),
                isAdjustmentEditable: isFirstRow,
                isReferralAdjustmentEditable: Boolean(!isFirstRow && !disconnection && sourceType !== 'disconnection' && isPreviousBillingMonth(billDate)),
                planOverride: planOverride || null,
                nextPreviousBalance: nextCarryOver.previousBalance,
                nextAdvance: nextCarryOver.advance,
                nextCarryOverType: nextCarryOver.type
            },
            nextBalance: nextCarryOver.signedBalance
        };
    };

    const resolveBillingDay = (record = {}, fallbackDate = null) => {
        if (hasMonthEndBillingCycle(record)) return 31;
        const candidates = [
            safeDate(record.billDate),
            safeDate(record.dueDate),
            safeDate(record.activationDate),
            fallbackDate
        ];
        for (const date of candidates) {
            const parts = getZonedDateParts(date);
            if (parts?.day) return parts.day;
        }
        return 1;
    };

    const resolvePendingPostpaidBillDate = (record = {}, todayBillingDate = getTodayBillingDate(), fallbackDate = null) => {
        const todayParts = getZonedDateParts(todayBillingDate);
        if (!todayParts) return null;
        const billingDay = resolveBillingDay(record, fallbackDate || todayBillingDate);
        const billDate = buildMonthlyDate(todayParts.year, todayParts.month, billingDay);
        return isPendingPostpaidSyntheticBill(record, billDate, todayBillingDate) ? billDate : null;
    };

    const buildPendingPostpaidBillMeta = (record = {}, billDate = null, planAmount = 0) => {
        const releaseDate = billDate ? getMonthEndDate(billDate) : null;
        return [
            resolvePlanLabel(record),
            formatCurrency(planAmount),
            `bill not generated yet${releaseDate ? `; generates ${formatDate(releaseDate, '')}` : ''}`
        ].filter(Boolean).join(' - ');
    };

    const buildRowsFromPostedDebits = (record, entries, context) => {
        const rows = [];
        const ignoredAutoChargeOrders = findIgnoredOpeningAutoChargeOrders(entries);
        const effectiveEntries = entries.filter((entry) => !ignoredAutoChargeOrders.has(entry.sortOrder));
        const debitEntries = effectiveEntries.filter((entry) => entry.direction === 'debit');
        if (!debitEntries.length) return rows;
        const assignedCreditOrders = new Set();
        const todayBillingDate = getTodayBillingDate();
        const pendingPostpaidBillDate = resolvePendingPostpaidBillDate(record, todayBillingDate, debitEntries[0]?.dateObj);

        let runningBalance = 0;
        effectiveEntries
            .filter((entry) => {
                if (entry.sortOrder >= debitEntries[0].sortOrder) return false;
                if (
                    shouldAttachCreditToBillMonth(entry, debitEntries[0].dateObj, record)
                ) {
                    return false;
                }
                return true;
            })
            .forEach((entry) => {
                runningBalance = applyEntryToBalance(runningBalance, entry);
            });

        debitEntries.forEach((debit, index) => {
            const nextDebit = debitEntries[index + 1] || null;
            const cycleCredits = effectiveEntries.filter((entry) => {
                if (entry.direction !== 'credit' || assignedCreditOrders.has(entry.sortOrder)) return false;
                const attachesToCurrentBillMonth = shouldAttachCreditToBillMonth(entry, debit.dateObj, record);
                const attachesToNextBillMonth = nextDebit
                    ? shouldAttachCreditToBillMonth(entry, nextDebit.dateObj, record)
                    : false;
                const attachesToPendingPostpaidBill = pendingPostpaidBillDate
                    && entry.dateObj
                    && isSameBillingMonth(entry.dateObj, pendingPostpaidBillDate)
                    && !isSameBillingMonth(debit.dateObj, pendingPostpaidBillDate);
                if (attachesToPendingPostpaidBill) return false;
                return attachesToCurrentBillMonth
                    || (
                        !attachesToNextBillMonth
                        && entry.sortOrder > debit.sortOrder
                        && (!nextDebit || entry.sortOrder < nextDebit.sortOrder)
                    );
            });
            cycleCredits.forEach((entry) => assignedCreditOrders.add(entry.sortOrder));
            const openingPreviousBalance = isOpeningPreviousBalanceEntry(debit);
            const planAmount = openingPreviousBalance ? 0 : resolvePlanAmount(record, debit.amount || context.planAmount);
            const result = createBreakdownRow({
                record,
                billDate: debit.dateObj,
                planAmount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: openingPreviousBalance ? 'opening' : 'posted',
                previousBalanceOverride: openingPreviousBalance ? debit.amount : null,
                openingPreviousBalance,
                isFirstRow: index === 0
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;
        });

        if (
            pendingPostpaidBillDate
            && !rows.some((row) => row?.billDate && isSameBillingMonth(row.billDate, pendingPostpaidBillDate))
        ) {
            const pendingCredits = effectiveEntries.filter((entry) => (
                entry.direction === 'credit'
                && !assignedCreditOrders.has(entry.sortOrder)
                && entry.dateObj
                && isSameBillingMonth(entry.dateObj, pendingPostpaidBillDate)
            ));
            pendingCredits.forEach((entry) => assignedCreditOrders.add(entry.sortOrder));
            const planChange = resolvePlanChangeForMonth(context, pendingPostpaidBillDate);
            const effectivePlanAmount = planChange ? planChange.planAmount : context.planAmount;
            const result = createBreakdownRow({
                record,
                billDate: pendingPostpaidBillDate,
                planAmount: 0,
                credits: pendingCredits,
                runningBalance,
                context,
                sourceType: 'pending',
                billMetaOverride: buildPendingPostpaidBillMeta(record, pendingPostpaidBillDate, effectivePlanAmount),
                isFirstRow: rows.length === 0,
                planOverride: planChange,
                paymentStatusOverride: 'not-generated',
                paymentStatusLabelOverride: 'not generated'
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;
        }

        return rows;
    };

    const buildRowsFromOpeningAdvanceOnly = (record, entries, context) => {
        if (!isExistingCustomerStart(record)) return [];
        const openingAdvanceEntries = (Array.isArray(entries) ? entries : []).filter((entry) => (
            entry.direction === 'credit'
            && isOpeningAdvanceEntry(entry)
        ));
        if (!openingAdvanceEntries.length) return [];

        const totalAdvance = sumEntries(openingAdvanceEntries);
        if (totalAdvance <= EPSILON) return [];

        const billDate = resolveLatestPaymentDate(openingAdvanceEntries)
            || safeDate(record.activationDate)
            || safeDate(record.billDate)
            || safeDate(record.dueDate)
            || new Date();
        const result = createBreakdownRow({
            record,
            billDate,
            planAmount: 0,
            credits: [],
            runningBalance: 0,
            context,
            sourceType: 'opening',
            advanceOverride: totalAdvance,
            openingAdvance: true,
            paymentModeOverride: resolvePaymentModeSummary(openingAdvanceEntries),
            paymentDateOverride: resolveLatestPaymentDate(openingAdvanceEntries),
            billLabelOverride: 'Opening Advance',
            billMetaOverride: `Opening advance payment · ${formatCurrency(totalAdvance)}`,
            isFirstRow: true
        });
        return [result.row];
    };

    const buildRowsFromMonthlyPlan = (record, entries, context) => {
        const planAmount = context.planAmount;
        const entryDates = entries.map((entry) => entry.dateObj).filter(Boolean);
        const firstEntryDate = getMinDate(entryDates);
        const lastEntryDate = getMaxDate(entryDates);
        let startSeed = firstEntryDate
            || safeDate(record.billDate)
            || safeDate(record.dueDate)
            || safeDate(record.activationDate)
            || new Date();
        const activationSeed = safeDate(record.activationDate || record.activation_date);
        if (activationSeed && startSeed && isBeforeBillingMonth(startSeed, activationSeed)) {
            startSeed = activationSeed;
        }
        const endSeed = getMaxDate([
            lastEntryDate,
            safeDate(record.dueDate),
            safeDate(record.billDate),
            new Date()
        ]) || startSeed;
        const startParts = getZonedDateParts(startSeed) || getZonedDateParts(new Date());
        const endParts = getZonedDateParts(endSeed) || startParts;
        const billingDay = resolveBillingDay(record, startSeed);
        const rows = [];
        let currentYear = startParts.year;
        let currentMonth = startParts.month;
        let billDate = buildMonthlyDate(currentYear, currentMonth, billingDay);
        let lastBillDate = buildMonthlyDate(endParts.year, endParts.month, billingDay);
        const disconnection = getDisconnectionState(record);
        if (disconnection?.billingPolicy === 'stop') {
            const disconnectionParts = getZonedDateParts(disconnection.disconnectedAt);
            const disconnectionBillDate = disconnectionParts
                ? buildMonthlyDate(disconnectionParts.year, disconnectionParts.month, billingDay)
                : null;
            if (disconnectionBillDate && disconnectionBillDate < lastBillDate) {
                lastBillDate = disconnectionBillDate;
            }
        }
        const todayBillingDate = getTodayBillingDate();
        let runningBalance = 0;
        let cursor = 0;

        context.usedSyntheticBills = true;

        while (
            cursor < entries.length
            && entries[cursor].dateObj
            && (
                shouldAttachCreditToBillMonth(entries[cursor], billDate, record)
                    ? isBeforeBillingMonth(entries[cursor].dateObj, billDate)
                    : isBeforeBillingDate(entries[cursor].dateObj, billDate)
            )
        ) {
            runningBalance = applyEntryToBalance(runningBalance, entries[cursor]);
            cursor += 1;
        }

        let guard = 0;
        while (
            billDate <= lastBillDate
            && (
                isOnOrBeforeBillingDate(billDate, todayBillingDate)
                || isPendingPostpaidSyntheticBill(record, billDate, todayBillingDate)
            )
            && guard < MAX_SYNTHETIC_ROWS
        ) {
            const nextParts = getNextMonthParts(currentYear, currentMonth);
            const nextBillDate = buildMonthlyDate(nextParts.year, nextParts.month, billingDay);
            const cycleCredits = [];

            while (
                cursor < entries.length
                && (
                    !entries[cursor].dateObj
                    || (
                        shouldAttachCreditToBillMonth(entries[cursor], billDate, record)
                            || (
                                !shouldAttachCreditToBillMonth(entries[cursor], nextBillDate, record)
                                && isBeforeBillingDate(entries[cursor].dateObj, nextBillDate)
                            )
                    )
                )
            ) {
                const entry = entries[cursor];
                if (entry.direction === 'credit') {
                    cycleCredits.push(entry);
                } else {
                    runningBalance = applyEntryToBalance(runningBalance, entry);
                }
                cursor += 1;
            }

            const planChange = resolvePlanChangeForMonth(context, billDate);
            const effectivePlanAmount = planChange ? planChange.planAmount : planAmount;
            const proration = resolveFirstMonthProration(record, billDate, effectivePlanAmount);
            const pendingPostpaidBill = isPendingPostpaidSyntheticBill(record, billDate, todayBillingDate);
            const releaseDate = pendingPostpaidBill ? getMonthEndDate(billDate) : null;
            const pendingBillMeta = pendingPostpaidBill
                ? [
                    resolvePlanLabel(record),
                    formatCurrency(effectivePlanAmount),
                    `bill not generated yet${releaseDate ? `; generates ${formatDate(releaseDate, '')}` : ''}`
                ].filter(Boolean).join(' - ')
                : '';
            const result = createBreakdownRow({
                record,
                billDate,
                planAmount: pendingPostpaidBill ? 0 : proration.amount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: pendingPostpaidBill ? 'pending' : 'monthly',
                proration: !pendingPostpaidBill && proration.isProrated ? proration : null,
                billMetaOverride: pendingBillMeta,
                isFirstRow: rows.length === 0,
                planOverride: planChange,
                paymentStatusOverride: pendingPostpaidBill ? 'not-generated' : '',
                paymentStatusLabelOverride: pendingPostpaidBill ? 'not generated' : ''
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;

            currentYear = nextParts.year;
            currentMonth = nextParts.month;
            billDate = nextBillDate;
            guard += 1;
        }

        return rows;
    };

    const appendDisconnectionMarkerRow = (record = {}, rows = []) => {
        const disconnection = getDisconnectionState(record);
        if (!disconnection) return rows;
        const hasDisconnectionMonth = rows.some((row) => (
            row?.billDate && isSameBillingMonth(row.billDate, disconnection.disconnectedAt)
        ));
        if (hasDisconnectionMonth) return rows;

        const lastRow = rows.length ? rows[rows.length - 1] : null;
        const balanceAfterPayment = roundMoney(Number(lastRow?.balanceAfterPayment) || 0);
        const nextCarryOver = splitBalanceCarryOver(balanceAfterPayment);
        const planType = resolvePlanType(record);
        const markerRow = {
            billDate: disconnection.disconnectedAt,
            billingMonthKey: getBillingMonthKey(disconnection.disconnectedAt),
            billLabel: 'Disconnected',
            billMeta: `Disconnected ${formatDate(disconnection.disconnectedAt, '')} - ${disconnection.billingPolicyLabel}`,
            planType,
            planTypeLabel: toTitleCase(planType),
            planLabel: resolvePlanLabel(record),
            planAmount: 0,
            billingCycle: resolveBillingCycleLabel(record, disconnection.disconnectedAt),
            previousBalance: 0,
            advance: 0,
            referral: 0,
            due: 0,
            amountPaid: 0,
            paymentMode: '-',
            paymentDateLabel: formatDate(disconnection.disconnectedAt, '-'),
            paymentStatus: balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid',
            isDisconnected: true,
            disconnectedAt: disconnection.disconnectedAt,
            disconnectionBillingPolicy: disconnection.billingPolicy,
            disconnectionBillingPolicyLabel: disconnection.billingPolicyLabel,
            balanceAfterPayment,
            sourceType: 'disconnection',
            isFirstRow: false,
            isProrated: false,
            isAdjustmentEditable: false,
            isReferralAdjustmentEditable: false,
            nextPreviousBalance: nextCarryOver.previousBalance,
            nextAdvance: nextCarryOver.advance,
            nextCarryOverType: nextCarryOver.type
        };
        return [...rows, markerRow];
    };

    const buildBreakdownRows = (record = {}, customers = []) => {
        const entries = (Array.isArray(record.history) ? record.history : [])
            .map(normalizeEntry)
            .filter(Boolean)
            .sort(compareEntries)
            .map((entry, sortOrder) => ({ ...entry, sortOrder }));
        const context = createReferralContext(record, entries, customers);
        let rows = [];
        if (entries.some((entry) => entry.direction === 'debit')) {
            rows = buildRowsFromPostedDebits(record, entries, context);
        }
        if (!rows.length) {
            rows = buildRowsFromOpeningAdvanceOnly(record, entries, context);
        }
        if (!rows.length) {
            rows = buildRowsFromMonthlyPlan(record, entries, context);
        }

        return { rows: appendDisconnectionMarkerRow(record, rows), context };
    };

    const getAmountClass = (value) => {
        const amount = Number(value) || 0;
        if (amount > EPSILON) return 'is-debit';
        return 'is-even';
    };

    const getCreditClass = (value) => ((Number(value) || 0) > EPSILON ? 'is-credit' : 'is-even');

    const getBalanceClass = (value) => {
        const amount = Number(value) || 0;
        if (amount > EPSILON) return 'is-debit';
        if (amount < -EPSILON) return 'is-credit';
        return 'is-even';
    };

    const formatBalance = (value) => {
        const amount = Number(value) || 0;
        if (amount < -EPSILON) return `${formatCurrency(Math.abs(amount))} advance`;
        return formatCurrency(Math.max(0, amount));
    };

    const renderEmpty = (message) => {
        if (tableBody) {
            tableBody.innerHTML = `
                <tr class="payment-breakdown-empty-row">
                    <td colspan="12" class="payment-breakdown-empty-cell">
                        <span class="payment-breakdown-empty-message">${escapeHtml(message)}</span>
                    </td>
                </tr>
            `;
        }
        if (summaryEl) summaryEl.textContent = message;
        renderAdjustmentToolbar([]);
        renderReferralToolbar([]);
        renderPlanToolbar();
        renderDisconnectButton(null);
    };

    const renderBillCell = (row) => {
        return `
            <span class="breakdown-bill">
                <span class="breakdown-bill__title">${escapeHtml(row.billLabel)}</span>
                <span class="breakdown-bill__meta">${escapeHtml(row.billMeta)}</span>
            </span>
        `;
    };

    const renderReferralCell = (row) => {
        const details = Array.isArray(row.referralDetails) ? row.referralDetails : [];
        const labels = details
            .map((item) => {
                const name = String(item?.referredName || item?.referredAccountNumber || '').trim();
                const amount = Number(item?.amount) || 0;
                if (!name) return '';
                return amount > EPSILON ? `${name} - ${formatCurrency(amount)}` : name;
            })
            .filter(Boolean);
        const detailLabel = labels.length
            ? labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '')
            : '';
        const detailTitle = details
            .map((item) => {
                const name = String(item?.referredName || item?.referredAccountNumber || 'Referral').trim();
                const amount = Number(item?.amount) || 0;
                return amount > EPSILON ? `${name}: ${formatCurrency(amount)}` : name;
            })
            .join(', ');
        return `
            <span class="breakdown-referral-cell">
                <span class="breakdown-amount ${getCreditClass(row.referral)}">${formatCurrency(row.referral)}</span>
                ${detailLabel ? `<span class="breakdown-referral-note" title="${escapeHtml(detailTitle)}">${escapeHtml(detailLabel)}</span>` : ''}
                ${row.isReferralAdjustmentEditable ? `
                    <button
                        type="button"
                        class="btn btn-icon btn-sm btn-outline-primary breakdown-referral-edit"
                        data-action="edit-referral"
                        data-month-key="${escapeHtml(row.billingMonthKey || '')}"
                        title="Edit referral for ${escapeHtml(row.billLabel || 'month')}"
                        aria-label="Edit referral for ${escapeHtml(row.billLabel || 'month')}"
                    >
                        <i class="ti ti-user-dollar" aria-hidden="true"></i>
                    </button>
                ` : ''}
            </span>
        `;
    };

    const renderRows = (rows = []) => {
        if (!tableBody) return;
        if (!rows.length) {
            renderEmpty('No payment breakdown rows available.');
            return;
        }

        tableBody.innerHTML = rows.map((row) => {
            const formatRowBillAmount = (value) => row.isProrated ? formatCurrencyNoCents(value) : formatCurrency(value);
            const previousBalanceCell = `<span class="breakdown-amount ${getAmountClass(row.previousBalance)}">${formatCurrency(row.previousBalance)}</span>`;
            const advanceCell = `<span class="breakdown-amount ${getCreditClass(row.advance)}">${formatCurrency(row.advance)}</span>`;
            const rowClasses = [
                row.isAdjustmentEditable ? 'is-first-adjustment-row' : '',
                row.isMonthlyReferralOverride ? 'is-referral-adjustment-row' : '',
                row.isDisconnected ? 'is-disconnected-row' : ''
            ].filter(Boolean).join(' ');
            const statusCell = row.isDisconnected
                ? `<span class="breakdown-status is-disconnected">disconnected</span><span class="breakdown-status-note">${escapeHtml(row.disconnectionBillingPolicyLabel || '')}</span>`
                : `<span class="breakdown-status is-${escapeHtml(row.paymentStatus)}">${escapeHtml(row.paymentStatusLabel || row.paymentStatus)}</span>`;
            return `
            <tr${rowClasses ? ` class="${rowClasses}"` : ''}>
                <td>
                    ${renderBillCell(row)}
                </td>
                <td><span class="breakdown-type is-${escapeHtml(row.planType || 'postpaid')}">${escapeHtml(row.planTypeLabel || 'Postpaid')}</span></td>
                <td><span class="breakdown-cycle">${escapeHtml(row.billingCycle || '-')}</span></td>
                <td class="is-num">${previousBalanceCell}</td>
                <td class="is-num">${advanceCell}</td>
                <td class="is-num">${renderReferralCell(row)}</td>
                <td class="is-num"><span class="breakdown-amount ${getAmountClass(row.due)}">${formatRowBillAmount(row.due)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.amountPaid)}">${formatCurrency(row.amountPaid)}</span></td>
                <td><span class="breakdown-mode">${escapeHtml(row.paymentMode || '-')}</span></td>
                <td><span class="breakdown-date">${escapeHtml(row.paymentDateLabel || '-')}</span></td>
                <td>${statusCell}</td>
                <td class="is-num"><span class="breakdown-amount ${getBalanceClass(row.balanceAfterPayment)}">${escapeHtml(formatBalance(row.balanceAfterPayment))}</span></td>
            </tr>
        `;
        }).join('');
        renderAdjustmentToolbar(rows);
        renderReferralToolbar(rows);
        renderPlanToolbar();
    };

    const renderAdjustmentToolbar = (rows = []) => {
        const firstRow = (Array.isArray(rows) ? rows : []).find((row) => row?.isAdjustmentEditable) || null;
        if (!adjustmentToolbar.form) return;
        if (!firstRow) {
            adjustmentToolbar.form.hidden = true;
            if (adjustmentToolbar.toggle) {
                adjustmentToolbar.toggle.hidden = true;
                adjustmentToolbar.toggle.setAttribute('aria-expanded', 'false');
            }
            state.adjustmentToolbarOpen = false;
            return;
        }

        if (adjustmentToolbar.toggle) {
            adjustmentToolbar.toggle.hidden = false;
            adjustmentToolbar.toggle.disabled = state.savingAdjustment;
            adjustmentToolbar.toggle.setAttribute('aria-expanded', state.adjustmentToolbarOpen ? 'true' : 'false');
            adjustmentToolbar.toggle.innerHTML = state.adjustmentToolbarOpen
                ? '<i class="ti ti-x" aria-hidden="true"></i> Hide adjustment'
                : '<i class="ti ti-adjustments" aria-hidden="true"></i> Edit first bill';
        }
        adjustmentToolbar.form.hidden = !state.adjustmentToolbarOpen;
        if (adjustmentToolbar.month) {
            adjustmentToolbar.month.textContent = `${firstRow.billLabel || 'First bill'} only`;
        }
        if (adjustmentToolbar.previousBalance) {
            setAdjustmentInputValue(adjustmentToolbar.previousBalance, formatEditableAmount(firstRow.previousBalance));
            adjustmentToolbar.previousBalance.disabled = state.savingAdjustment;
        }
        if (adjustmentToolbar.advance) {
            setAdjustmentInputValue(adjustmentToolbar.advance, formatEditableAmount(firstRow.advance));
            adjustmentToolbar.advance.disabled = state.savingAdjustment;
        }
        if (adjustmentToolbar.referral) {
            setAdjustmentInputValue(adjustmentToolbar.referral, formatEditableAmount(firstRow.referral));
            adjustmentToolbar.referral.disabled = state.savingAdjustment;
        }
        if (adjustmentToolbar.referralName) {
            const referralNames = (Array.isArray(firstRow.referralDetails) ? firstRow.referralDetails : [])
                .map((item) => String(item?.referredName || item?.referredAccountNumber || '').trim())
                .filter(Boolean);
            setAdjustmentInputValue(adjustmentToolbar.referralName, referralNames.join(', '));
            adjustmentToolbar.referralName.disabled = state.savingAdjustment;
        }
        if (adjustmentToolbar.due) {
            setAdjustmentInputValue(adjustmentToolbar.due, formatEditableAmount(firstRow.due));
            adjustmentToolbar.due.disabled = state.savingAdjustment;
        }
        if (adjustmentToolbar.save) {
            adjustmentToolbar.save.disabled = state.savingAdjustment;
            adjustmentToolbar.save.textContent = state.savingAdjustment ? 'Saving...' : 'Save adjustment';
            if (state.savingAdjustment) {
                adjustmentToolbar.save.setAttribute('aria-busy', 'true');
            } else {
                adjustmentToolbar.save.removeAttribute('aria-busy');
            }
        }
    };

    const getSelectedReferralRow = (rows = state.rows) => {
        const monthKey = normalizeAdjustmentMonthKey(state.selectedReferralMonthKey);
        if (!monthKey) return null;
        return (Array.isArray(rows) ? rows : []).find((row) => (
            row?.billingMonthKey === monthKey
            && row.isReferralAdjustmentEditable
        )) || null;
    };

    const renderReferralToolbar = (rows = state.rows) => {
        if (!referralToolbar.form) return;
        const row = getSelectedReferralRow(rows);
        if (!state.referralToolbarOpen || !row) {
            referralToolbar.form.hidden = true;
            state.referralToolbarOpen = false;
            if (!row) state.selectedReferralMonthKey = '';
            return;
        }

        const adjustment = getPaymentBreakdownAdjustment(state.record).monthlyReferrals[row.billingMonthKey] || null;
        const detail = Array.isArray(row.referralDetails) ? row.referralDetails[0] : null;
        const selectedAccount = String(adjustment?.referralAccountNumber || detail?.referredAccountNumber || '').trim();
        const amount = hasAmountOverride(adjustment?.referral)
            ? adjustment.referral
            : (row.referral > EPSILON ? row.referral : roundMoney((Number(row.planAmount) || Number(state.context?.planAmount) || 0) / 2));

        referralToolbar.form.hidden = false;
        referralToolbar.form.dataset.monthKey = row.billingMonthKey;
        if (referralToolbar.month) {
            referralToolbar.month.textContent = `${formatMonthKeyLabel(row.billingMonthKey)} referral adjustment`;
        }
        populateReferralSubscriberOptions(selectedAccount);
        if (referralToolbar.amount) {
            referralToolbar.amount.value = formatEditableAmount(amount);
            referralToolbar.amount.disabled = state.savingReferralAdjustment;
        }
        if (referralToolbar.subscriber) {
            referralToolbar.subscriber.disabled = state.savingReferralAdjustment;
        }
        if (referralToolbar.save) {
            referralToolbar.save.disabled = state.savingReferralAdjustment;
            referralToolbar.save.textContent = state.savingReferralAdjustment ? 'Saving...' : 'Save referral';
        }
        if (referralToolbar.cancel) {
            referralToolbar.cancel.disabled = state.savingReferralAdjustment;
        }
    };

    const renderPlanToolbar = () => {
        if (planToolbar.toggle) {
            planToolbar.toggle.hidden = !accountNumber;
            planToolbar.toggle.disabled = state.savingPlanChange || state.disconnecting || state.reconnecting || !state.plans.length;
            planToolbar.toggle.setAttribute('aria-expanded', state.planToolbarOpen ? 'true' : 'false');
            planToolbar.toggle.innerHTML = state.planToolbarOpen
                ? '<i class="ti ti-x" aria-hidden="true"></i> Hide plan'
                : '<i class="ti ti-arrows-exchange" aria-hidden="true"></i> Change plan';
        }
        if (!planToolbar.form) return;
        planToolbar.form.hidden = !state.planToolbarOpen;
        const nextMonthKey = getNextBillingMonthKey();
        if (planToolbar.effectiveMonth) {
            planToolbar.effectiveMonth.min = nextMonthKey;
            if (!normalizeAdjustmentMonthKey(planToolbar.effectiveMonth.value)) {
                planToolbar.effectiveMonth.value = nextMonthKey;
            }
            planToolbar.effectiveMonth.disabled = state.savingPlanChange;
        }
        if (planToolbar.plan) {
            const selected = planToolbar.plan.value || '0';
            populatePlanOptions(selected);
            planToolbar.plan.disabled = state.savingPlanChange || !state.plans.length;
        }
        if (planToolbar.save) {
            planToolbar.save.disabled = state.savingPlanChange || !state.plans.length;
            planToolbar.save.textContent = state.savingPlanChange ? 'Saving...' : 'Save plan change';
        }
        if (planToolbar.cancel) {
            planToolbar.cancel.disabled = state.savingPlanChange;
        }
    };

    const renderDisconnectButton = (record = state.record) => {
        const account = String(record?.accountNumber || accountNumber || '').trim();
        const disconnection = getDisconnectionState(record);
        if (disconnectBtn) {
            disconnectBtn.hidden = !account;
            disconnectBtn.disabled = state.disconnecting || state.reconnecting || Boolean(disconnection?.billingPolicy === 'stop');
            disconnectBtn.classList.toggle('btn-danger', !disconnection);
            disconnectBtn.classList.toggle('btn-outline-danger', Boolean(disconnection));
            if (state.disconnecting) {
                disconnectBtn.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i> Working...';
            } else if (disconnection?.billingPolicy === 'stop') {
                disconnectBtn.innerHTML = '<i class="ti ti-plug-off" aria-hidden="true"></i> Billing stopped';
            } else if (disconnection?.billingPolicy === 'continue') {
                disconnectBtn.innerHTML = '<i class="ti ti-receipt-off" aria-hidden="true"></i> Stop billing';
            } else {
                disconnectBtn.innerHTML = '<i class="ti ti-plug-off" aria-hidden="true"></i> Disconnect';
            }
        }
        if (reconnectBtn) {
            reconnectBtn.hidden = !account || !disconnection;
            reconnectBtn.disabled = state.disconnecting || state.reconnecting;
            reconnectBtn.innerHTML = state.reconnecting
                ? '<i class="ti ti-loader-2" aria-hidden="true"></i> Working...'
                : '<i class="ti ti-plug-connected" aria-hidden="true"></i> Reconnect';
        }
    };

    const renderMetrics = (rows = [], context = {}) => {
        const paidRows = rows.filter((row) => row.paymentStatus === 'paid').length;
        const pendingRows = rows.filter((row) => row.paymentStatus === 'not-generated').length;
        const unpaidRows = Math.max(0, rows.length - paidRows - pendingRows);
        const totalReferral = sumEntries(rows.map((row) => ({ amount: row.referral })));
        const endingBalance = rows.length ? rows[rows.length - 1].balanceAfterPayment : 0;

        if (metrics.bills) metrics.bills.textContent = formatCount(rows.length);
        if (metrics.paid) metrics.paid.textContent = formatCount(paidRows);
        if (metrics.referral) metrics.referral.textContent = formatCurrency(totalReferral);
        if (metrics.balance) metrics.balance.textContent = formatBalance(endingBalance);

        const referralCount = Number(context.referralDiscounts?.length || context.referredCustomers?.length) || 0;
        const summaryParts = [
            `Showing ${formatCount(rows.length)} bill breakdown${rows.length === 1 ? '' : 's'}.`,
            `${formatCount(paidRows)} paid, ${formatCount(unpaidRows)} unpaid.`,
            referralCount
                ? `${formatCount(referralCount)} successful referral discount${referralCount === 1 ? '' : 's'} available.`
                : 'No referral discount found.'
        ];
        if (pendingRows) {
            summaryParts.push(`${formatCount(pendingRows)} postpaid bill${pendingRows === 1 ? '' : 's'} not generated yet.`);
        }
        if (context.usedSyntheticBills) {
            summaryParts.push('Monthly plan rows were generated because no posted bill charges were found.');
        }
        if ((Number(context.automaticReferralApplied) || 0) > EPSILON) {
            summaryParts.push(`${formatCurrency(context.automaticReferralApplied)} automatic referral discount applied.`);
        }
        if (summaryEl) summaryEl.textContent = summaryParts.join(' ');
    };

    const renderHeader = (record = {}, context = {}) => {
        const account = String(record.accountNumber || accountNumber || '').trim();
        const customerName = getCustomerName(record, account);
        const planAmount = resolvePlanAmount(record);
        const planName = resolvePlanLabel(record);
        const referralCount = Number(context.referralDiscounts?.length || context.referredCustomers?.length) || 0;
        if (titleEl) titleEl.textContent = 'Payment Breakdown';
        if (addPaymentBtn) {
            addPaymentBtn.href = account
                ? `payments.html?payNow=${encodeURIComponent(account)}`
                : 'payments.html';
            addPaymentBtn.classList.toggle('disabled', !account);
            addPaymentBtn.setAttribute('aria-disabled', account ? 'false' : 'true');
        }
        if (subtitleEl) {
            subtitleEl.textContent = [
                customerName,
                account ? `Account ${account}` : '',
                `${planName} ${formatCurrency(planAmount)}`,
                referralCount ? `${formatCount(referralCount)} successful referral discount${referralCount === 1 ? '' : 's'}` : ''
            ].filter(Boolean).join(' • ');
        }
        renderDisconnectButton(record);
    };

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
        }
        return payload;
    }

    const saveBreakdownAdjustmentPatch = (body = {}) => fetchJSON(`/api/payment-records/${encodeURIComponent(accountNumber)}/breakdown-adjustment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const getCustomerAccountNumber = (customer = {}) => String(customer?.accountNumber || customer?.account_number || '').trim();
    const getCustomerOptionLabel = (customer = {}) => {
        const account = getCustomerAccountNumber(customer);
        const name = getCustomerName(customer, account);
        return [name, account ? `Account ${account}` : ''].filter(Boolean).join(' - ');
    };
    const getReferralSubscribers = () => {
        const currentAccount = String(state.record?.accountNumber || accountNumber || '').trim();
        return (Array.isArray(state.customers) ? state.customers : [])
            .filter((customer) => {
                const account = getCustomerAccountNumber(customer);
                return account && account !== currentAccount;
            })
            .sort((left, right) => getCustomerOptionLabel(left).localeCompare(getCustomerOptionLabel(right)));
    };
    const populateReferralSubscriberOptions = (selectedAccount = '') => {
        if (!referralToolbar.subscriber) return;
        const selected = String(selectedAccount || '').trim();
        const options = [
            '<option value="">No manual referral</option>',
            ...getReferralSubscribers().map((customer) => {
                const account = getCustomerAccountNumber(customer);
                return `<option value="${escapeHtml(account)}"${account === selected ? ' selected' : ''}>${escapeHtml(getCustomerOptionLabel(customer))}</option>`;
            })
        ];
        referralToolbar.subscriber.innerHTML = options.join('');
    };
    const findReferralSubscriber = (account = '') => {
        const key = String(account || '').trim();
        if (!key) return null;
        return getReferralSubscribers().find((customer) => getCustomerAccountNumber(customer) === key) || null;
    };
    const formatMonthKeyLabel = (monthKey = '') => {
        const normalized = normalizeAdjustmentMonthKey(monthKey);
        if (!normalized) return 'Selected month';
        const [year, month] = normalized.split('-').map(Number);
        return formatMonth(buildStableDate(year, month, 1), normalized);
    };
    const getNextBillingMonthKey = () => {
        const parts = getZonedDateParts(new Date()) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
        const next = getNextMonthParts(parts.year, parts.month);
        return `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}`;
    };
    const flattenPlansPayload = (payload = {}) => {
        const rawPlans = payload?.plans;
        const list = Array.isArray(rawPlans)
            ? rawPlans
            : Object.entries(rawPlans && typeof rawPlans === 'object' ? rawPlans : {})
                .flatMap(([category, plans]) => (Array.isArray(plans) ? plans.map((plan) => ({ ...plan, category: plan?.category || category })) : []));
        return list
            .map((plan, index) => {
                const price = toEditableAmount(plan?.price ?? plan?.planAmount ?? plan?.amount);
                const category = normalizePlanTypeValue(plan?.category || plan?.planCategory || plan?.planType);
                const name = toAdjustmentDisplayText(plan?.label || plan?.name || plan?.planName);
                return {
                    optionValue: String(index),
                    planId: toAdjustmentDisplayText(plan?.id || plan?.planId || plan?.plan_id || name),
                    planName: name || 'Plan',
                    planAmount: price,
                    planCategory: category || 'postpaid'
                };
            })
            .filter((plan) => plan.planAmount > 0)
            .sort((left, right) => {
                if (left.planCategory !== right.planCategory) return left.planCategory.localeCompare(right.planCategory);
                return left.planName.localeCompare(right.planName);
            })
            .map((plan, index) => ({ ...plan, optionValue: String(index) }));
    };
    const populatePlanOptions = (selectedValue = '') => {
        if (!planToolbar.plan) return;
        if (!state.plans.length) {
            planToolbar.plan.innerHTML = '<option value="">No plans available</option>';
            return;
        }
        planToolbar.plan.innerHTML = state.plans.map((plan) => (
            `<option value="${escapeHtml(plan.optionValue)}"${plan.optionValue === String(selectedValue) ? ' selected' : ''}>${escapeHtml(`${toTitleCase(plan.planCategory)} - ${plan.planName} - ${formatCurrency(plan.planAmount)}`)}</option>`
        )).join('');
    };

    const readFirstBillAdjustmentInputs = () => {
        const adjustment = {
            previousBalance: toEditableAmount(adjustmentToolbar.previousBalance?.value),
            advance: toEditableAmount(adjustmentToolbar.advance?.value)
        };
        const savedFirstBill = normalizeFirstBillAdjustment(
            state.record?.paymentBreakdownAdjustment
            || state.record?.breakdownAdjustment
            || state.record?.firstBillAdjustment
            || null
        );
        const hasSavedReferralOverride = hasAmountOverride(savedFirstBill?.referral);
        const hasSavedDueOverride = hasAmountOverride(savedFirstBill?.due);
        const referralChanged = isAdjustmentInputDirty(adjustmentToolbar.referral)
            || isAdjustmentInputDirty(adjustmentToolbar.referralName);
        if (hasSavedReferralOverride || referralChanged) {
            adjustment.referral = toEditableAmount(adjustmentToolbar.referral?.value);
            adjustment.referralName = toAdjustmentDisplayText(adjustmentToolbar.referralName?.value);
        }
        if (hasSavedDueOverride || isAdjustmentInputDirty(adjustmentToolbar.due)) {
            adjustment.due = toEditableAmount(adjustmentToolbar.due?.value);
        }
        return adjustment;
    };

    const applyLoadedBreakdown = (record, customers, plans = state.plans) => {
        const { rows, context } = buildBreakdownRows(record, customers);
        state.record = record;
        state.customers = customers;
        state.plans = Array.isArray(plans) ? plans : [];
        state.rows = rows;
        state.context = context;
        renderHeader(record, context);
        renderSubscriberInfo(record, rows);
        renderRows(rows);
        renderMetrics(rows, context);
    };

    async function saveFirstBillAdjustment() {
        if (state.savingAdjustment) return;
        if (!accountNumber) {
            showToast('No customer account selected.', 'error');
            return;
        }

        const adjustment = readFirstBillAdjustmentInputs();
        state.savingAdjustment = true;
        renderAdjustmentToolbar(state.rows);
        try {
            const payload = await saveBreakdownAdjustmentPatch({ firstBill: adjustment });

            const nextRecord = {
                ...(state.record || {}),
                paymentBreakdownAdjustment: payload?.adjustment || { firstBill: adjustment }
            };
            state.adjustmentToolbarOpen = false;
            applyLoadedBreakdown(nextRecord, state.customers);
            showToast('First bill adjustment saved.', 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to save first bill adjustment.', 'error');
            renderAdjustmentToolbar(state.rows);
        } finally {
            state.savingAdjustment = false;
            renderAdjustmentToolbar(state.rows);
            renderMetrics(state.rows, state.context || {});
        }
    }

    async function saveReferralAdjustment() {
        if (state.savingReferralAdjustment) return;
        const monthKey = normalizeAdjustmentMonthKey(referralToolbar.form?.dataset.monthKey || state.selectedReferralMonthKey);
        if (!accountNumber || !monthKey) {
            showToast('Choose a previous month row first.', 'error');
            return;
        }

        const amount = toEditableAmount(referralToolbar.amount?.value);
        const selectedAccount = String(referralToolbar.subscriber?.value || '').trim();
        const selectedSubscriber = findReferralSubscriber(selectedAccount);
        if (amount > EPSILON && !selectedSubscriber) {
            showToast('Choose the referred subscriber for this adjustment.', 'error');
            return;
        }

        const currentAdjustment = getPaymentBreakdownAdjustment(state.record);
        const monthlyReferrals = { ...(currentAdjustment.monthlyReferrals || {}) };
        if (!selectedSubscriber && amount <= EPSILON) {
            delete monthlyReferrals[monthKey];
        } else {
            monthlyReferrals[monthKey] = {
                monthKey,
                referral: amount,
                referralName: selectedSubscriber ? getCustomerName(selectedSubscriber, selectedAccount) : 'Manual referral',
                referralAccountNumber: selectedAccount
            };
        }

        state.savingReferralAdjustment = true;
        renderReferralToolbar(state.rows);
        try {
            const payload = await saveBreakdownAdjustmentPatch({ monthlyReferrals });
            const nextRecord = {
                ...(state.record || {}),
                paymentBreakdownAdjustment: payload?.adjustment || { ...currentAdjustment, monthlyReferrals }
            };
            state.referralToolbarOpen = false;
            state.selectedReferralMonthKey = '';
            applyLoadedBreakdown(nextRecord, state.customers, state.plans);
            showToast('Referral adjustment saved.', 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to save referral adjustment.', 'error');
            renderReferralToolbar(state.rows);
        } finally {
            state.savingReferralAdjustment = false;
            renderReferralToolbar(state.rows);
            renderMetrics(state.rows, state.context || {});
        }
    }

    async function savePlanChange() {
        if (state.savingPlanChange) return;
        if (!accountNumber) {
            showToast('No customer account selected.', 'error');
            return;
        }
        const effectiveMonth = normalizeAdjustmentMonthKey(planToolbar.effectiveMonth?.value);
        const nextMonthKey = getNextBillingMonthKey();
        if (!effectiveMonth || effectiveMonth < nextMonthKey) {
            showToast('Choose next month or a later month for the plan change.', 'error');
            return;
        }
        const selectedPlan = state.plans.find((plan) => plan.optionValue === String(planToolbar.plan?.value || ''));
        if (!selectedPlan) {
            showToast('Choose a new plan.', 'error');
            return;
        }

        const currentAdjustment = getPaymentBreakdownAdjustment(state.record);
        const planChanges = (Array.isArray(currentAdjustment.planChanges) ? currentAdjustment.planChanges : [])
            .filter((change) => change?.effectiveMonth !== effectiveMonth);
        planChanges.push({
            effectiveMonth,
            planId: selectedPlan.planId,
            planName: selectedPlan.planName,
            planAmount: selectedPlan.planAmount,
            planCategory: selectedPlan.planCategory
        });

        state.savingPlanChange = true;
        renderPlanToolbar();
        try {
            const payload = await saveBreakdownAdjustmentPatch({ planChanges });
            const nextRecord = {
                ...(state.record || {}),
                paymentBreakdownAdjustment: payload?.adjustment || { ...currentAdjustment, planChanges }
            };
            state.planToolbarOpen = false;
            applyLoadedBreakdown(nextRecord, state.customers, state.plans);
            showToast(`Plan change saved from ${formatMonthKeyLabel(effectiveMonth)}.`, 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to save plan change.', 'error');
            renderPlanToolbar();
        } finally {
            state.savingPlanChange = false;
            renderPlanToolbar();
            renderMetrics(state.rows, state.context || {});
        }
    }

    async function disconnectFromBreakdown() {
        if (state.disconnecting) return;
        const account = String(state.record?.accountNumber || accountNumber || '').trim();
        if (!account) {
            showToast('No customer account selected.', 'error');
            return;
        }
        const customerName = getCustomerName(state.record, account);
        const disconnection = getDisconnectionState(state.record);
        const message = disconnection?.billingPolicy === 'continue'
            ? `Stop billing for ${customerName} starting next month?`
            : `Disconnect ${customerName} and stop billing starting next month?`;
        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm(message, { title: disconnection ? 'Stop Billing' : 'Disconnect Subscriber' })
            : window.confirm(message);
        if (!confirmed) return;

        state.disconnecting = true;
        renderDisconnectButton(state.record);
        renderPlanToolbar();
        try {
            const url = disconnection?.billingPolicy === 'continue'
                ? `/api/disconnections/${encodeURIComponent(account)}/billing-policy`
                : `/api/disconnections/${encodeURIComponent(account)}/disconnect`;
            const method = disconnection?.billingPolicy === 'continue' ? 'PATCH' : 'POST';
            const payload = await fetchJSON(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    billingPolicy: 'stop',
                    notes: 'Stopped billing from payment breakdown.'
                })
            });
            const nextRecord = {
                ...(state.record || {}),
                status: payload?.customerStatus || state.record?.status,
                customerStatus: payload?.customerStatus || state.record?.customerStatus,
                subscriberStatus: payload?.customerStatus || state.record?.subscriberStatus,
                disconnection: payload?.decision || {
                    ...(state.record?.disconnection || {}),
                    status: 'disconnected',
                    billingPolicy: 'stop',
                    disconnectedAt: new Date().toISOString()
                }
            };
            applyLoadedBreakdown(nextRecord, state.customers, state.plans);
            showToast(payload?.warning || 'Disconnection saved. Billing will stop next month.', payload?.warning ? 'warning' : 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to disconnect subscriber.', 'error');
        } finally {
            state.disconnecting = false;
            renderDisconnectButton(state.record);
            renderPlanToolbar();
        }
    }

    async function reconnectFromBreakdown() {
        if (state.reconnecting) return;
        const account = String(state.record?.accountNumber || accountNumber || '').trim();
        const disconnection = getDisconnectionState(state.record);
        if (!account || !disconnection) {
            showToast('Subscriber is not disconnected.', 'error');
            return;
        }

        const customerName = getCustomerName(state.record, account);
        const confirmed = typeof window.appConfirm === 'function'
            ? await window.appConfirm(`Reconnect ${customerName} and resume billing?`, {
                title: 'Reconnect Subscriber',
                okText: 'Reconnect',
                cancelText: 'Cancel'
            })
            : window.confirm(`Reconnect ${customerName} and resume billing?`);
        if (!confirmed) return;

        state.reconnecting = true;
        renderDisconnectButton(state.record);
        renderPlanToolbar();
        try {
            const payload = await fetchJSON(`/api/disconnections/${encodeURIComponent(account)}/reconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notes: 'Reconnected from payment breakdown.'
                })
            });
            const nextRecord = {
                ...(state.record || {}),
                status: payload?.customerStatus || 'active',
                customerStatus: payload?.customerStatus || 'active',
                subscriberStatus: payload?.customerStatus || 'active',
                disconnection: payload?.decision || null
            };
            applyLoadedBreakdown(nextRecord, state.customers, state.plans);
            showToast(payload?.warning || 'Subscriber reconnected. Billing will continue.', payload?.warning ? 'warning' : 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to reconnect subscriber.', 'error');
        } finally {
            state.reconnecting = false;
            renderDisconnectButton(state.record);
            renderPlanToolbar();
        }
    }

    async function loadBreakdown() {
        if (!accountNumber) {
            renderEmpty('No customer account selected.');
            if (subtitleEl) subtitleEl.textContent = 'Open this page from the Payments table.';
            return;
        }

        try {
            const [recordPayload, customersPayload, plansPayload] = await Promise.all([
                fetchJSON(`/api/payment-records/${encodeURIComponent(accountNumber)}`),
                fetchJSON('/api/customers').catch(() => ({ customers: [] })),
                fetchJSON('/api/plans').catch(() => ({ plans: [] }))
            ]);
            const record = recordPayload?.record;
            if (!record) throw new Error('Customer payment record was not found.');

            const customers = Array.isArray(customersPayload?.customers) ? customersPayload.customers : [];
            const plans = flattenPlansPayload(plansPayload);
            applyLoadedBreakdown(record, customers, plans);
        } catch (error) {
            console.error('Failed to load payment breakdown:', error);
            renderEmpty(error?.message || 'Could not load payment breakdown.');
            if (subtitleEl) subtitleEl.textContent = 'Payment breakdown could not be loaded.';
        }
    }

    adjustmentToolbar.toggle?.addEventListener('click', () => {
        if (state.savingAdjustment) return;
        state.adjustmentToolbarOpen = !state.adjustmentToolbarOpen;
        renderAdjustmentToolbar(state.rows);
        if (state.adjustmentToolbarOpen) {
            adjustmentToolbar.previousBalance?.focus();
        }
    });

    [
        adjustmentToolbar.referral,
        adjustmentToolbar.referralName,
        adjustmentToolbar.due
    ].forEach((input) => {
        input?.addEventListener('input', () => {
            input.dataset.dirty = 'true';
        });
    });

    adjustmentToolbar.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveFirstBillAdjustment();
    });

    tableBody?.addEventListener('click', (event) => {
        const trigger = event.target?.closest?.('[data-action="edit-referral"]');
        if (!trigger || state.savingReferralAdjustment) return;
        const monthKey = normalizeAdjustmentMonthKey(trigger.dataset.monthKey);
        const row = (state.rows || []).find((entry) => (
            entry?.billingMonthKey === monthKey
            && entry.isReferralAdjustmentEditable
        ));
        if (!row) {
            showToast('Referral can only be adjusted on previous month rows.', 'error');
            return;
        }
        state.selectedReferralMonthKey = monthKey;
        state.referralToolbarOpen = true;
        renderReferralToolbar(state.rows);
        referralToolbar.subscriber?.focus();
    });

    referralToolbar.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveReferralAdjustment();
    });

    referralToolbar.cancel?.addEventListener('click', () => {
        if (state.savingReferralAdjustment) return;
        state.referralToolbarOpen = false;
        state.selectedReferralMonthKey = '';
        renderReferralToolbar(state.rows);
    });

    planToolbar.toggle?.addEventListener('click', () => {
        if (state.savingPlanChange || state.disconnecting) return;
        state.planToolbarOpen = !state.planToolbarOpen;
        if (state.planToolbarOpen && planToolbar.effectiveMonth) {
            planToolbar.effectiveMonth.value = normalizeAdjustmentMonthKey(planToolbar.effectiveMonth.value) || getNextBillingMonthKey();
        }
        renderPlanToolbar();
        if (state.planToolbarOpen) {
            planToolbar.effectiveMonth?.focus();
        }
    });

    planToolbar.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        void savePlanChange();
    });

    planToolbar.cancel?.addEventListener('click', () => {
        if (state.savingPlanChange) return;
        state.planToolbarOpen = false;
        renderPlanToolbar();
    });

    disconnectBtn?.addEventListener('click', () => {
        void disconnectFromBreakdown();
    });

    reconnectBtn?.addEventListener('click', () => {
        void reconnectFromBreakdown();
    });

    loadBreakdown();
});
