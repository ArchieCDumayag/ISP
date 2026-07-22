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
        savingAdjustment: false
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
    const formatEditableAmount = (value) => {
        const amount = toEditableAmount(value);
        return amount ? amount.toFixed(2) : '';
    };
    const normalizeFirstBillAdjustment = (adjustment = null) => {
        const firstBill = adjustment?.firstBill || adjustment || null;
        if (!firstBill || typeof firstBill !== 'object') return null;
        return {
            previousBalance: toEditableAmount(firstBill.previousBalance),
            advance: toEditableAmount(firstBill.advance)
        };
    };
    const getFirstBillAdjustment = (record = {}) => normalizeFirstBillAdjustment(
        record.paymentBreakdownAdjustment
        || record.breakdownAdjustment
        || record.firstBillAdjustment
        || null
    );
    const formatCurrency = (value) => currencyFormatter.format(Number(value) || 0);
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
        const parsed = safeDate(value);
        return parsed ? formatDate(parsed, fallback) : fallback;
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

    const renderSubscriberInfo = (record = {}) => {
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
        setSubscriberText(subscriberInfo.dueDate, formatRecordDate(record.dueDate || record.prepaidExpirationAt || record.billDate));
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
            usedSyntheticBills: false,
            firstBillAdjustment: getFirstBillAdjustment(record)
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
        proration = null,
        previousBalanceOverride = null,
        advanceOverride = null,
        openingPreviousBalance = false,
        openingAdvance = false,
        paymentModeOverride = '',
        paymentDateOverride = null,
        billLabelOverride = '',
        billMetaOverride = '',
        isFirstRow = false
    }) => {
        const planLabel = resolvePlanLabel(record);
        const firstBillAdjustment = isFirstRow ? normalizeFirstBillAdjustment(context?.firstBillAdjustment) : null;
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
        const automaticReferral = explicitReferral > EPSILON
            ? 0
            : takeAutomaticReferral(context, dueBeforeAutoReferral);
        const referral = roundMoney(explicitReferral + automaticReferral);
        const rawDue = roundMoney(planAmount - advance + previousBalance - referral);
        const due = roundMoney(Math.max(0, rawDue));
        const amountPaid = sumEntries(paymentCredits);
        const paymentMode = paymentModeOverride || (amountPaid > EPSILON ? resolvePaymentModeSummary(paymentCredits) : '-');
        const paymentDate = paymentDateOverride || (amountPaid > EPSILON ? resolveLatestPaymentDate(paymentCredits) : null);
        const balanceAfterPayment = roundMoney(rawDue - amountPaid);
        const nextCarryOver = splitBalanceCarryOver(balanceAfterPayment);
        const paymentStatus = balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid';
        const billLabel = billLabelOverride || (openingPreviousBalance ? 'Previous Balance' : (openingAdvance ? 'Opening Advance' : formatMonth(billDate, 'Bill')));
        const planType = resolvePlanType(record);
        const planTypeLabel = toTitleCase(planType);
        const billingCycle = resolveBillingCycleLabel(record, billDate);
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
                sourceType,
                isFirstRow,
                isAdjustmentEditable: isFirstRow,
                nextPreviousBalance: nextCarryOver.previousBalance,
                nextAdvance: nextCarryOver.advance,
                nextCarryOverType: nextCarryOver.type
            },
            nextBalance: nextCarryOver.signedBalance
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
        const ignoredAutoChargeOrders = findIgnoredOpeningAutoChargeOrders(entries);
        const effectiveEntries = entries.filter((entry) => !ignoredAutoChargeOrders.has(entry.sortOrder));
        const debitEntries = effectiveEntries.filter((entry) => entry.direction === 'debit');
        if (!debitEntries.length) return rows;

        let runningBalance = 0;
        effectiveEntries
            .filter((entry) => entry.sortOrder < debitEntries[0].sortOrder)
            .forEach((entry) => {
                runningBalance = applyEntryToBalance(runningBalance, entry);
            });

        debitEntries.forEach((debit, index) => {
            const nextDebit = debitEntries[index + 1] || null;
            const cycleCredits = effectiveEntries.filter((entry) => (
                entry.direction === 'credit'
                && entry.sortOrder > debit.sortOrder
                && (!nextDebit || entry.sortOrder < nextDebit.sortOrder)
            ));
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
                proration: proration.isProrated ? proration : null,
                isFirstRow: rows.length === 0
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

    const renderAdjustmentInput = (field, value, label) => `
        <label class="breakdown-adjustment-field">
            <span class="breakdown-adjustment-field__label">${escapeHtml(label)}</span>
            <input
                type="number"
                class="form-control form-control-sm breakdown-adjustment-input"
                min="0"
                step="0.01"
                inputmode="decimal"
                data-breakdown-adjustment-field="${escapeHtml(field)}"
                value="${escapeHtml(formatEditableAmount(value))}"
                placeholder="0.00"
                aria-label="${escapeHtml(label)}"
                ${state.savingAdjustment ? 'disabled' : ''}
            >
        </label>
    `;

    const renderBillCell = (row) => {
        const adjustmentActions = row.isAdjustmentEditable
            ? `
                <span class="breakdown-bill__adjustment">
                    <button
                        type="button"
                        class="btn btn-sm btn-primary breakdown-adjustment-save"
                        ${state.savingAdjustment ? 'disabled aria-busy="true"' : ''}
                    >
                        ${state.savingAdjustment ? 'Saving...' : 'Save adjustment'}
                    </button>
                    <span class="breakdown-bill__hint">First bill only</span>
                </span>
            `
            : '';
        return `
            <span class="breakdown-bill">
                <span class="breakdown-bill__title">${escapeHtml(row.billLabel)}</span>
                <span class="breakdown-bill__meta">${escapeHtml(row.billMeta)}</span>
                ${adjustmentActions}
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
            const previousBalanceCell = row.isAdjustmentEditable
                ? renderAdjustmentInput('previousBalance', row.previousBalance, 'Previous Balance')
                : `<span class="breakdown-amount ${getAmountClass(row.previousBalance)}">${formatCurrency(row.previousBalance)}</span>`;
            const advanceCell = row.isAdjustmentEditable
                ? renderAdjustmentInput('advance', row.advance, 'Advance')
                : `<span class="breakdown-amount ${getCreditClass(row.advance)}">${formatCurrency(row.advance)}</span>`;
            return `
            <tr${row.isAdjustmentEditable ? ' class="is-first-adjustment-row"' : ''}>
                <td>
                    ${renderBillCell(row)}
                </td>
                <td><span class="breakdown-type is-${escapeHtml(row.planType || 'postpaid')}">${escapeHtml(row.planTypeLabel || 'Postpaid')}</span></td>
                <td><span class="breakdown-cycle">${escapeHtml(row.billingCycle || '-')}</span></td>
                <td class="is-num">${previousBalanceCell}</td>
                <td class="is-num">${advanceCell}</td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.referral)}">${formatCurrency(row.referral)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getAmountClass(row.due)}">${formatCurrency(row.due)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getCreditClass(row.amountPaid)}">${formatCurrency(row.amountPaid)}</span></td>
                <td><span class="breakdown-mode">${escapeHtml(row.paymentMode || '-')}</span></td>
                <td><span class="breakdown-date">${escapeHtml(row.paymentDateLabel || '-')}</span></td>
                <td><span class="breakdown-status is-${row.paymentStatus}">${escapeHtml(row.paymentStatus)}</span></td>
                <td class="is-num"><span class="breakdown-amount ${getBalanceClass(row.balanceAfterPayment)}">${escapeHtml(formatBalance(row.balanceAfterPayment))}</span></td>
            </tr>
        `;
        }).join('');
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

    async function fetchJSON(url, options = {}) {
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
        }
        return payload;
    }

    const readFirstBillAdjustmentInputs = () => {
        const previousInput = tableBody?.querySelector('[data-breakdown-adjustment-field="previousBalance"]');
        const advanceInput = tableBody?.querySelector('[data-breakdown-adjustment-field="advance"]');
        return {
            previousBalance: toEditableAmount(previousInput?.value),
            advance: toEditableAmount(advanceInput?.value)
        };
    };

    const applyLoadedBreakdown = (record, customers) => {
        const { rows, context } = buildBreakdownRows(record, customers);
        state.record = record;
        state.customers = customers;
        state.rows = rows;
        state.context = context;
        renderHeader(record, context);
        renderSubscriberInfo(record);
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
        renderRows(state.rows);
        try {
            const payload = await fetchJSON(`/api/payment-records/${encodeURIComponent(accountNumber)}/breakdown-adjustment`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstBill: adjustment })
            });

            const nextRecord = {
                ...(state.record || {}),
                paymentBreakdownAdjustment: payload?.adjustment || { firstBill: adjustment }
            };
            applyLoadedBreakdown(nextRecord, state.customers);
            showToast('First bill adjustment saved.', 'success');
        } catch (error) {
            showToast(error?.message || 'Failed to save first bill adjustment.', 'error');
            renderRows(state.rows);
        } finally {
            state.savingAdjustment = false;
            renderRows(state.rows);
            renderMetrics(state.rows, state.context || {});
        }
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
            applyLoadedBreakdown(record, customers);
        } catch (error) {
            console.error('Failed to load payment breakdown:', error);
            renderEmpty(error?.message || 'Could not load payment breakdown.');
            if (subtitleEl) subtitleEl.textContent = 'Payment breakdown could not be loaded.';
        }
    }

    tableBody?.addEventListener('click', (event) => {
        const saveButton = event.target.closest('.breakdown-adjustment-save');
        if (!saveButton) return;
        void saveFirstBillAdjustment();
    });

    loadBreakdown();
});
