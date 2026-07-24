(function () {
    const locale = 'en-PH';
    const appTimeZone = window.__APP_TIMEZONE__ || 'Asia/Manila';
    const utcOffsetSuffix = 'Z';
    const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
    const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
    const EPSILON = 0.005;
    const MAX_SYNTHETIC_ROWS = 120;

    const currencyFormatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const zonedDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: appTimeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

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
    const toAdjustmentAmount = (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return roundMoney(parsed);
    };
    const hasAmountOverride = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string' && !value.trim()) return false;
        return Number.isFinite(Number(value));
    };
    const normalizeFirstBillAdjustment = (adjustment = null) => {
        const firstBill = adjustment?.firstBill || adjustment || null;
        if (!firstBill || typeof firstBill !== 'object') return null;
        return {
            previousBalance: toAdjustmentAmount(firstBill.previousBalance),
            advance: toAdjustmentAmount(firstBill.advance)
        };
    };
    const getFirstBillAdjustment = (record = {}) => normalizeFirstBillAdjustment(
        record.paymentBreakdownAdjustment
        || record.breakdownAdjustment
        || record.firstBillAdjustment
        || null
    );

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
        return Boolean(leftParts && rightParts && leftParts.year === rightParts.year && leftParts.month === rightParts.month);
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
    const getInclusiveDayCount = (startDate, endDate) => {
        const startParts = getZonedDateParts(startDate);
        const endParts = getZonedDateParts(endDate);
        if (!startParts || !endParts) return 0;
        const startUtc = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
        const endUtc = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
        if (endUtc < startUtc) return 0;
        return Math.floor((endUtc - startUtc) / 86400000) + 1;
    };

    const resolveDirection = (entry = {}) => {
        if (isOpeningPreviousBalanceRaw(entry)) return 'debit';
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
            return { amount: 0, isProrated: false, periodStart: null, periodEnd: null };
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
        const targetAccount = String(record.accountNumber || '').trim();
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
    const sumEntries = (entries = []) => roundMoney(
        entries.reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0)
    );
    const applyEntryToBalance = (balance, entry = {}) => {
        const amount = Number(entry.amount) || 0;
        if (entry.direction === 'debit') return roundMoney(balance + amount);
        if (entry.direction === 'credit') return roundMoney(balance - amount);
        return roundMoney(balance);
    };
    const splitBalanceCarryOver = (balanceAfterPayment) => {
        const signedBalance = roundMoney(Number(balanceAfterPayment) || 0);
        if (signedBalance > EPSILON) {
            return { signedBalance, previousBalance: signedBalance, advance: 0, type: 'balance' };
        }
        if (signedBalance < -EPSILON) {
            return { signedBalance, previousBalance: 0, advance: roundMoney(Math.abs(signedBalance)), type: 'advance' };
        }
        return { signedBalance: 0, previousBalance: 0, advance: 0, type: 'settled' };
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
        return [parts.year, String(parts.month).padStart(2, '0'), String(parts.day).padStart(2, '0')].join('-');
    };
    const findIgnoredOpeningAutoChargeOrders = (entries = []) => {
        const openingAdjustments = entries.filter((entry) => (
            (entry.direction === 'debit' && isOpeningPreviousBalanceEntry(entry))
            || (entry.direction === 'credit' && isOpeningAdvanceEntry(entry))
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
        isFirstRow = false
    }) => {
        const firstBillAdjustment = isFirstRow ? normalizeFirstBillAdjustment(context?.firstBillAdjustment) : null;
        const effectivePreviousBalanceOverride = firstBillAdjustment ? firstBillAdjustment.previousBalance : previousBalanceOverride;
        const effectiveAdvanceOverride = firstBillAdjustment ? firstBillAdjustment.advance : advanceOverride;
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
        const automaticReferral = explicitReferral > EPSILON ? 0 : takeAutomaticReferral(context, dueBeforeAutoReferral);
        const referral = roundMoney(explicitReferral + automaticReferral);
        const rawDue = roundMoney(planAmount - advance + previousBalance - referral);
        const due = roundMoney(Math.max(0, rawDue));
        const amountPaid = sumEntries(paymentCredits);
        const balanceAfterPayment = roundMoney(rawDue - amountPaid);
        const nextCarryOver = splitBalanceCarryOver(balanceAfterPayment);

        return {
            row: {
                billDate,
                previousBalance,
                advance,
                referral,
                due,
                amountPaid,
                paymentStatus: balanceAfterPayment <= EPSILON ? 'paid' : 'unpaid',
                balanceAfterPayment,
                sourceType,
                planType: resolvePlanType(record),
                isFirstRow,
                isProrated: Boolean(proration?.isProrated),
                periodStart: proration?.periodStart || null,
                periodEnd: proration?.periodEnd || null,
                openingPreviousBalance,
                openingAdvance
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
    const buildRowsFromPostedDebits = (record, entries, context) => {
        const rows = [];
        const ignoredAutoChargeOrders = findIgnoredOpeningAutoChargeOrders(entries);
        const effectiveEntries = entries.filter((entry) => !ignoredAutoChargeOrders.has(entry.sortOrder));
        const debitEntries = effectiveEntries.filter((entry) => entry.direction === 'debit');
        if (!debitEntries.length) return rows;
        const assignedCreditOrders = new Set();

        let runningBalance = 0;
        effectiveEntries
            .filter((entry) => {
                if (entry.sortOrder >= debitEntries[0].sortOrder) return false;
                return !shouldAttachCreditToBillMonth(entry, debitEntries[0].dateObj, record);
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

        const billDate = getMaxDate(openingAdvanceEntries.map((entry) => entry.dateObj))
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
            isFirstRow: true
        });
        return [result.row];
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
        const lastBillDate = buildMonthlyDate(endParts.year, endParts.month, billingDay);
        const todayBillingDate = getTodayBillingDate();
        let runningBalance = 0;
        let cursor = 0;

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
            && isOnOrBeforeBillingDate(billDate, todayBillingDate)
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
    const getLedgerBalance = (record = {}) => {
        const entries = (Array.isArray(record.history) ? record.history : [])
            .map(normalizeEntry)
            .filter(Boolean)
            .sort(compareEntries)
            .map((entry, sortOrder) => ({ ...entry, sortOrder }));
        if (!entries.length) {
            const direct = Number(record.balance);
            return Number.isFinite(direct) ? roundMoney(direct) : 0;
        }
        const ignoredAutoChargeOrders = findIgnoredOpeningAutoChargeOrders(entries);
        return entries
            .filter((entry) => !ignoredAutoChargeOrders.has(entry.sortOrder))
            .reduce((balance, entry) => applyEntryToBalance(balance, entry), 0);
    };
    const getCurrentMonthRow = (record = {}, customers = [], cycleDate = new Date()) => {
        const { rows } = buildBreakdownRows(record, customers);
        const currentRows = rows.filter((row) => isSameBillingMonth(row.billDate, cycleDate));
        return currentRows.length ? currentRows[currentRows.length - 1] : null;
    };
    const resolveCurrentBillState = (record = {}, customers = [], cycleDate = new Date()) => {
        const currentRow = getCurrentMonthRow(record, customers, cycleDate);
        if (currentRow) {
            return {
                amount: roundMoney(currentRow.balanceAfterPayment),
                currentRow,
                hasCurrentBreakdownRow: true
            };
        }
        return {
            amount: getLedgerBalance(record),
            currentRow: null,
            hasCurrentBreakdownRow: false
        };
    };
    const formatBalanceAfterPayment = (value) => {
        const amount = roundMoney(value);
        if (amount < -EPSILON) return `${currencyFormatter.format(Math.abs(amount))} advance`;
        return currencyFormatter.format(Math.max(0, amount));
    };

    window.PaymentCurrentBill = {
        buildBreakdownRows,
        resolveCurrentBillState,
        formatBalanceAfterPayment,
        isSameBillingMonth
    };
})();
