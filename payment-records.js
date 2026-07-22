const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('./data-store');
const customersModule = require('./customers');
const { getEffectivePaymentEntries } = require('./payment-entry-normalizer');
const { accountHasRole } = require('./role-utils');

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
const normalizeAdjustmentAmount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Number(parsed.toFixed(2));
};
const sanitizePaymentBreakdownAdjustment = (adjustment = {}) => {
    const firstBill = adjustment?.firstBill || adjustment || {};
    return {
        firstBill: {
            previousBalance: normalizeAdjustmentAmount(firstBill.previousBalance),
            advance: normalizeAdjustmentAmount(firstBill.advance)
        }
    };
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

const buildPaymentRecord = (customer, payments = {}, plans = [], adjustments = {}, branchId = null) => {
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

    return {
        ...sanitizedCustomer,
        subscriberStatus,
        customerStatus: subscriberStatus,
        planCategory,
        paymentBreakdownAdjustment: getPaymentBreakdownAdjustment(adjustments, branchId, accountNumber),
        ...summary,
        history: paymentHistory
    };
};

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
        const [customers, payments, plans, adjustments] = await Promise.all([
            readCustomers(branchId),
            readPayments(branchId),
            readPlans(branchId),
            readPaymentBreakdownAdjustments()
        ]);

        const paymentRecords = customers
            .map((customer) => buildPaymentRecord(customer, payments, plans, adjustments, branchId))
            .filter(Boolean);

        res.json({ records: paymentRecords });
    } catch (error) {
        next(createError(500, 'Failed to generate payment records.'));
    }
});

// GET /api/payment-records/:accountNumber - Get one combined customer/payment record
router.get('/:accountNumber', async (req, res, next) => {
    try {
        const accountNumber = String(req.params?.accountNumber || '').trim();
        if (!accountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const branchId = req.user?.branchId || null;
        const [customers, payments, plans, adjustments] = await Promise.all([
            readCustomers(branchId),
            readPayments(branchId),
            readPlans(branchId),
            readPaymentBreakdownAdjustments()
        ]);

        const customer = Array.isArray(customers)
            ? customers.find((entry) => String(entry?.accountNumber || '').trim() === accountNumber)
            : null;
        if (!customer) {
            return next(createError(404, 'Customer not found.'));
        }

        const record = buildPaymentRecord(customer, payments, plans, adjustments, branchId);
        if (!record) {
            return next(createError(500, 'Failed to generate payment record.'));
        }

        res.json({ record });
    } catch (error) {
        next(createError(500, 'Failed to generate payment record.'));
    }
});

// PATCH /api/payment-records/:accountNumber/breakdown-adjustment - Save first bill adjustment
router.patch('/:accountNumber/breakdown-adjustment', async (req, res, next) => {
    try {
        const user = assertAdminUser(req);
        const accountNumber = String(req.params?.accountNumber || '').trim();
        if (!accountNumber) {
            return next(createError(400, 'Account number is required.'));
        }

        const branchId = user.branchId || null;
        const customers = await readCustomers(branchId);
        const customer = Array.isArray(customers)
            ? customers.find((entry) => String(entry?.accountNumber || '').trim() === accountNumber)
            : null;
        if (!customer) {
            return next(createError(404, 'Customer not found.'));
        }

        const nextAdjustment = sanitizePaymentBreakdownAdjustment(req.body?.firstBill || req.body || {});
        const adjustments = await readPaymentBreakdownAdjustments();
        const branchKey = branchAdjustmentKey(branchId);
        const branchBucket = adjustments[branchKey] && typeof adjustments[branchKey] === 'object'
            ? adjustments[branchKey]
            : {};

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

        res.json({
            ok: true,
            adjustment: sanitizePaymentBreakdownAdjustment(branchBucket[accountNumber])
        });
    } catch (error) {
        next(error?.status ? error : createError(500, 'Failed to save payment breakdown adjustment.'));
    }
});

module.exports = router;
