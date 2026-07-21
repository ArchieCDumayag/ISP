document.addEventListener('DOMContentLoaded', () => {
    const locale = 'en-PH';
    const appTimeZone = window.__APP_TIMEZONE__ || 'Asia/Manila';
    const utcOffsetSuffix = 'Z';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
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
    const metrics = {
        bills: document.getElementById('breakdownMetricBills'),
        paid: document.getElementById('breakdownMetricPaid'),
        referral: document.getElementById('breakdownMetricReferral'),
        balance: document.getElementById('breakdownMetricBalance')
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
    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
    const formatCount = (value) => countFormatter.format(Number(value) || 0);

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

    const buildMonthlyDate = (year, month, billingDay) => {
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return buildStableDate(year, month, Math.min(Math.max(Number(billingDay) || 1, 1), lastDay));
    };

    const getMonthEndDate = (date) => {
        const parts = getZonedDateParts(date);
        if (!parts) return null;
        return buildStableDate(parts.year, parts.month, new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate());
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

    const getInclusiveDayCount = (startDate, endDate) => {
        const startParts = getZonedDateParts(startDate);
        const endParts = getZonedDateParts(endDate);
        if (!startParts || !endParts) return 0;
        const startUtc = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
        const endUtc = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
        if (endUtc < startUtc) return 0;
        return Math.floor((endUtc - startUtc) / 86400000) + 1;
    };

    const resolveFirstMonthProration = (record = {}, billDate = null, fullPlanAmount = 0) => {
        const activationDate = safeDate(record.activationDate || record.activation_date);
        const planAmount = Number(fullPlanAmount) || 0;
        if (!activationDate || !billDate || planAmount <= 0 || !isSameBillingMonth(activationDate, billDate)) {
            return {
                amount: roundMoney(planAmount),
                isProrated: false,
                periodStart: null,
                periodEnd: null
            };
        }
        const periodEnd = getMonthEndDate(activationDate);
        const monthStartParts = getZonedDateParts(activationDate);
        const periodStart = activationDate;
        const monthStart = monthStartParts ? buildStableDate(monthStartParts.year, monthStartParts.month, 1) : null;
        const activeDays = getInclusiveDayCount(periodStart, periodEnd);
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
            amount: roundMoney((planAmount / totalDays) * activeDays),
            isProrated: true,
            periodStart,
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

    const normalizeEntry = (entry, index) => {
        const amount = toAmount(entry?.amount);
        if (!amount) return null;
        const direction = resolveDirection(entry);
        const kind = resolveKind(entry);
        const dateObj = safeDate(entry?.recordedAt || entry?.recorded_at || entry?.date || entry?.createdAt || entry?.created_at);
        return {
            raw: entry || {},
            index,
            id: String(entry?.id || entry?.entryId || entry?.fingerprint || index),
            amount,
            direction,
            kind,
            dateObj,
            time: dateObj ? dateObj.getTime() : index
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
        const planType = resolvePlanType(record);
        if (planType === 'prepaid') {
            return 'Prepaid';
        }

        const cycleDate = safeDate(record.billDate)
            || safeDate(record.dueDate)
            || billDate;
        const day = getZonedDateParts(cycleDate)?.day;
        if (day) return `Every ${day}${getOrdinalSuffix(day)} of the month`;
        return planBilling || 'Monthly';
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

    const createReferralContext = (record, entries, customers) => {
        const planAmount = resolvePlanAmount(record);
        const referredCustomers = findReferredCustomers(record, customers);
        const explicitReferralTotal = sumEntries(entries.filter(isReferralCredit));
        const automaticReferralTotal = explicitReferralTotal > EPSILON
            ? 0
            : roundMoney(Math.floor(referredCustomers.length / 2) * planAmount);

        return {
            planAmount,
            referredCustomers,
            explicitReferralTotal,
            automaticReferralTotal,
            automaticReferralRemaining: automaticReferralTotal,
            automaticReferralApplied: 0,
            usedSyntheticBills: false
        };
    };

    const takeAutomaticReferral = (context, dueBeforeReferral) => {
        const available = Number(context?.automaticReferralRemaining) || 0;
        const base = Math.max(0, Number(dueBeforeReferral) || 0);
        if (available <= EPSILON || base <= EPSILON) return 0;
        const applied = roundMoney(Math.min(available, base));
        context.automaticReferralRemaining = roundMoney(available - applied);
        context.automaticReferralApplied = roundMoney((Number(context.automaticReferralApplied) || 0) + applied);
        return applied;
    };

    const createBreakdownRow = ({
        record,
        billDate,
        planAmount,
        credits,
        runningBalance,
        context,
        sourceType,
        proration = null
    }) => {
        const planLabel = resolvePlanLabel(record);
        const previousBalance = roundMoney(Math.max(0, Number(runningBalance) || 0));
        const advance = roundMoney(Math.max(0, -(Number(runningBalance) || 0)));
        const referralCredits = (Array.isArray(credits) ? credits : []).filter(isReferralCredit);
        const paymentCredits = (Array.isArray(credits) ? credits : []).filter((entry) => !isReferralCredit(entry));
        const explicitReferral = sumEntries(referralCredits);
        const dueBeforeAutoReferral = roundMoney(planAmount - advance + previousBalance - explicitReferral);
        const automaticReferral = explicitReferral > EPSILON
            ? 0
            : takeAutomaticReferral(context, dueBeforeAutoReferral);
        const referral = roundMoney(explicitReferral + automaticReferral);
        const rawDue = roundMoney(planAmount - advance + previousBalance - referral);
        const due = roundMoney(Math.max(0, rawDue));
        const amountPaid = sumEntries(paymentCredits);
        const paymentMode = amountPaid > EPSILON ? resolvePaymentModeSummary(paymentCredits) : '-';
        const paymentDate = amountPaid > EPSILON ? resolveLatestPaymentDate(paymentCredits) : null;
        const balanceAfterPayment = roundMoney(rawDue - amountPaid);
        const paymentStatus = balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid';
        const billLabel = formatMonth(billDate, 'Bill');
        const planType = resolvePlanType(record);
        const planTypeLabel = toTitleCase(planType);
        const billingCycle = resolveBillingCycleLabel(record, billDate);
        const billMetaParts = [
            planLabel,
            formatCurrency(planAmount),
            sourceType === 'posted' ? 'posted bill' : 'monthly plan',
            proration?.isProrated
                ? `prorated ${formatDate(proration.periodStart, '')} to ${formatDate(proration.periodEnd, '')}`
                : ''
        ].filter(Boolean);

        return {
            row: {
                billDate,
                billLabel,
                billMeta: billMetaParts.join(' · '),
                planType,
                planTypeLabel,
                billingCycle,
                previousBalance,
                advance,
                referral,
                due,
                amountPaid,
                paymentMode,
                paymentDateLabel: paymentDate ? formatDate(paymentDate, '-') : '-',
                paymentStatus,
                balanceAfterPayment,
                sourceType
            },
            nextBalance: balanceAfterPayment
        };
    };

    const resolveBillingDay = (record = {}, fallbackDate = null) => {
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

    const buildRowsFromPostedDebits = (record, entries, context) => {
        const rows = [];
        const debitEntries = entries.filter((entry) => entry.direction === 'debit');
        if (!debitEntries.length) return rows;

        let runningBalance = 0;
        entries
            .filter((entry) => entry.sortOrder < debitEntries[0].sortOrder)
            .forEach((entry) => {
                runningBalance = applyEntryToBalance(runningBalance, entry);
            });

        debitEntries.forEach((debit, index) => {
            const nextDebit = debitEntries[index + 1] || null;
            const cycleCredits = entries.filter((entry) => (
                entry.direction === 'credit'
                && entry.sortOrder > debit.sortOrder
                && (!nextDebit || entry.sortOrder < nextDebit.sortOrder)
            ));
            const planAmount = resolvePlanAmount(record, debit.amount || context.planAmount);
            const result = createBreakdownRow({
                record,
                billDate: debit.dateObj,
                planAmount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: 'posted'
            });
            rows.push(result.row);
            runningBalance = result.nextBalance;
        });

        return rows;
    };

    const buildRowsFromMonthlyPlan = (record, entries, context) => {
        const planAmount = context.planAmount;
        const entryDates = entries.map((entry) => entry.dateObj).filter(Boolean);
        const firstEntryDate = getMinDate(entryDates);
        const lastEntryDate = getMaxDate(entryDates);
        const startSeed = firstEntryDate
            || safeDate(record.billDate)
            || safeDate(record.dueDate)
            || safeDate(record.activationDate)
            || new Date();
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
        const lastBillDate = buildMonthlyDate(endParts.year, endParts.month, billingDay);
        let runningBalance = 0;
        let cursor = 0;

        context.usedSyntheticBills = true;

        while (
            cursor < entries.length
            && entries[cursor].dateObj
            && entries[cursor].dateObj < billDate
        ) {
            runningBalance = applyEntryToBalance(runningBalance, entries[cursor]);
            cursor += 1;
        }

        let guard = 0;
        while (billDate <= lastBillDate && guard < MAX_SYNTHETIC_ROWS) {
            const nextParts = getNextMonthParts(currentYear, currentMonth);
            const nextBillDate = buildMonthlyDate(nextParts.year, nextParts.month, billingDay);
            const cycleCredits = [];

            while (
                cursor < entries.length
                && (!entries[cursor].dateObj || entries[cursor].dateObj < nextBillDate)
            ) {
                const entry = entries[cursor];
                if (entry.direction === 'credit') {
                    cycleCredits.push(entry);
                } else {
                    runningBalance = applyEntryToBalance(runningBalance, entry);
                }
                cursor += 1;
            }

            const proration = resolveFirstMonthProration(record, billDate, planAmount);
            const result = createBreakdownRow({
                record,
                billDate,
                planAmount: proration.amount,
                credits: cycleCredits,
                runningBalance,
                context,
                sourceType: 'monthly',
                proration: proration.isProrated ? proration : null
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

    const buildBreakdownRows = (record = {}, customers = []) => {
        const entries = (Array.isArray(record.history) ? record.history : [])
            .map(normalizeEntry)
            .filter(Boolean)
            .sort(compareEntries)
            .map((entry, sortOrder) => ({ ...entry, sortOrder }));
        const context = createReferralContext(record, entries, customers);
        const rows = entries.some((entry) => entry.direction === 'debit')
            ? buildRowsFromPostedDebits(record, entries, context)
            : buildRowsFromMonthlyPlan(record, entries, context);

        return { rows, context };
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
    };

    const renderRows = (rows = []) => {
        if (!tableBody) return;
        if (!rows.length) {
            renderEmpty('No payment breakdown rows available.');
            return;
        }

        tableBody.innerHTML = rows.map((row) => `
            <tr>
                <td>
                    <span class="breakdown-bill">
                        <span class="breakdown-bill__title">${escapeHtml(row.billLabel)}</span>
                        <span class="breakdown-bill__meta">${escapeHtml(row.billMeta)}</span>
                    </span>
                </td>
                <td><span class="breakdown-type is-${escapeHtml(row.planType || 'postpaid')}">${escapeHtml(row.planTypeLabel || 'Postpaid')}</span></td>
                <td><span class="breakdown-cycle">${escapeHtml(row.billingCycle || '-')}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getAmountClass(row.previousBalance)}">${formatCurrency(row.previousBalance)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.advance)}">${formatCurrency(row.advance)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.referral)}">${formatCurrency(row.referral)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getAmountClass(row.due)}">${formatCurrency(row.due)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.amountPaid)}">${formatCurrency(row.amountPaid)}</span></td>
                <td><span class="breakdown-mode">${escapeHtml(row.paymentMode || '-')}</span></td>
                <td><span class="breakdown-date">${escapeHtml(row.paymentDateLabel || '-')}</span></td>
                <td><span class="breakdown-status is-${row.paymentStatus}">${escapeHtml(row.paymentStatus)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getBalanceClass(row.balanceAfterPayment)}">${escapeHtml(formatBalance(row.balanceAfterPayment))}</span></td>
            </tr>
        `).join('');
    };

    const renderMetrics = (rows = [], context = {}) => {
        const paidRows = rows.filter((row) => row.paymentStatus === 'paid').length;
        const totalReferral = sumEntries(rows.map((row) => ({ amount: row.referral })));
        const endingBalance = rows.length ? rows[rows.length - 1].balanceAfterPayment : 0;

        if (metrics.bills) metrics.bills.textContent = formatCount(rows.length);
        if (metrics.paid) metrics.paid.textContent = formatCount(paidRows);
        if (metrics.referral) metrics.referral.textContent = formatCurrency(totalReferral);
        if (metrics.balance) metrics.balance.textContent = formatBalance(endingBalance);

        const referralCount = Number(context.referredCustomers?.length) || 0;
        const summaryParts = [
            `Showing ${formatCount(rows.length)} bill breakdown${rows.length === 1 ? '' : 's'}.`,
            `${formatCount(paidRows)} paid, ${formatCount(Math.max(0, rows.length - paidRows))} unpaid.`,
            referralCount
                ? `${formatCount(referralCount)} referral${referralCount === 1 ? '' : 's'} found.`
                : 'No referral discount found.'
        ];
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
        const referralCount = Number(context.referredCustomers?.length) || 0;
        if (titleEl) titleEl.textContent = 'Payment Breakdown';
        if (subtitleEl) {
            subtitleEl.textContent = [
                customerName,
                account ? `Account ${account}` : '',
                `${planName} ${formatCurrency(planAmount)}`,
                referralCount ? `${formatCount(referralCount)} referral${referralCount === 1 ? '' : 's'}` : ''
            ].filter(Boolean).join(' • ');
        }
    };

    async function fetchJSON(url) {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
        }
        return payload;
    }

    async function loadBreakdown() {
        if (!accountNumber) {
            renderEmpty('No customer account selected.');
            if (subtitleEl) subtitleEl.textContent = 'Open this page from the Payments table.';
            return;
        }

        try {
            const [recordPayload, customersPayload] = await Promise.all([
                fetchJSON(`/api/payment-records/${encodeURIComponent(accountNumber)}`),
                fetchJSON('/api/customers').catch(() => ({ customers: [] }))
            ]);
            const record = recordPayload?.record;
            if (!record) throw new Error('Customer payment record was not found.');

            const customers = Array.isArray(customersPayload?.customers) ? customersPayload.customers : [];
            const { rows, context } = buildBreakdownRows(record, customers);
            renderHeader(record, context);
            renderRows(rows);
            renderMetrics(rows, context);
        } catch (error) {
            console.error('Failed to load payment breakdown:', error);
            renderEmpty(error?.message || 'Could not load payment breakdown.');
            if (subtitleEl) subtitleEl.textContent = 'Payment breakdown could not be loaded.';
        }
    }

    loadBreakdown();
});
