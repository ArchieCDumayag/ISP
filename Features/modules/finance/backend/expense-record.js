const EXPENSE_SCHEMA_VERSION = 1;

const EXPENSE_STATUSES = Object.freeze([
    'draft',
    'pending',
    'approved',
    'paid',
    'rejected'
]);

const PAYMENT_METHODS = Object.freeze([
    'cash',
    'gcash',
    'bank_transfer',
    'card',
    'check',
    'other'
]);

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const normalizeDateOnly = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parsedDate = new Date(`${raw}T00:00:00Z`);
        return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === raw
            ? raw
            : '';
    }
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const normalizeAmount = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Number(amount.toFixed(2));
};

const normalizeEnum = (value, allowed, fallback) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    return allowed.includes(normalized) ? normalized : fallback;
};

const normalizeExpenseStatus = (value, fallback = 'paid') =>
    normalizeEnum(value, EXPENSE_STATUSES, fallback);

const normalizePaymentMethod = (value, fallback = 'other') =>
    normalizeEnum(value, PAYMENT_METHODS, fallback);

const toIsoDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return raw;
    return parsed.toISOString();
};

const normalizeActor = (actor = {}) => ({
    userId: actor?.id != null ? toSafeText(actor.id, 32) : '',
    username: toSafeText(actor?.username, 100),
    name: toSafeText(actor?.name, 120)
});

const actorDisplay = (actor = {}) =>
    toSafeText(actor.username || actor.name || actor.userId, 100);

const isApprovalStatus = (status) => status === 'approved' || status === 'paid';

const normalizeExpenseFields = (input = {}, current = {}) => {
    const vendor = toSafeText(input.vendor ?? input.payee ?? current.vendor ?? current.payee, 160);
    return {
        date: normalizeDateOnly(input.date ?? input.expense_date ?? current.date),
        category: toSafeText(input.category ?? current.category, 80),
        vendor,
        payee: vendor,
        description: toSafeText(input.description ?? current.description, 1000),
        amount: normalizeAmount(input.amount ?? current.amount),
        paymentMethod: normalizePaymentMethod(
            input.paymentMethod ?? input.payment_method ?? current.paymentMethod,
            current.paymentMethod || 'other'
        ),
        referenceNumber: toSafeText(
            input.referenceNumber ?? input.reference_number ?? current.referenceNumber,
            120
        ),
        receiptUrl: toSafeText(input.receiptUrl ?? input.receipt_url ?? current.receiptUrl, 500),
        receiptName: toSafeText(input.receiptName ?? input.receipt_name ?? current.receiptName, 180),
        status: normalizeExpenseStatus(input.status ?? current.status, current.status || 'paid')
    };
};

const validateExpenseFields = (fields = {}) => {
    if (!fields.date) return 'Date is required.';
    if (!fields.category) return 'Category is required.';
    if (!fields.vendor) return 'Vendor / payee is required.';
    if (fields.amount == null || fields.amount <= 0) return 'Amount must be greater than zero.';
    return '';
};

const validateSubmittedEnums = (input = {}) => {
    const paymentMethod = input.paymentMethod ?? input.payment_method;
    if (paymentMethod != null && String(paymentMethod).trim()) {
        const normalized = normalizeEnum(paymentMethod, PAYMENT_METHODS, '');
        if (!normalized) return 'Payment method is invalid.';
    }

    if (input.status != null && String(input.status).trim()) {
        const normalized = normalizeEnum(input.status, EXPENSE_STATUSES, '');
        if (!normalized) return 'Expense status is invalid.';
    }
    return '';
};

const mapExpenseRecord = (row = {}, { branchId = null } = {}) => {
    const vendor = toSafeText(row.vendor || row.payee, 160);
    const resolvedBranchId = Number(row.branch_id || row.branchId || branchId || 0);
    return {
        schemaVersion: EXPENSE_SCHEMA_VERSION,
        id: toSafeText(row.id, 80),
        branchId: Number.isInteger(resolvedBranchId) && resolvedBranchId > 0 ? resolvedBranchId : null,
        date: normalizeDateOnly(row.expense_date || row.date),
        category: toSafeText(row.category, 80),
        vendor,
        payee: vendor,
        description: toSafeText(row.description, 1000),
        amount: normalizeAmount(row.amount) || 0,
        paymentMethod: normalizePaymentMethod(row.payment_method || row.paymentMethod, 'other'),
        referenceNumber: toSafeText(row.reference_number || row.referenceNumber, 120),
        receiptUrl: toSafeText(row.receipt_url || row.receiptUrl, 500),
        receiptName: toSafeText(row.receipt_name || row.receiptName, 180),
        status: normalizeExpenseStatus(row.status, 'paid'),
        createdAt: toIsoDateTime(row.created_at || row.createdAt),
        updatedAt: toIsoDateTime(row.updated_at || row.updatedAt),
        approvedAt: toIsoDateTime(row.approved_at || row.approvedAt),
        createdByUserId: toSafeText(row.created_by_user_id || row.createdByUserId, 32),
        createdBy: toSafeText(row.created_by_username || row.createdByUsername || row.createdBy, 100),
        createdByName: toSafeText(row.created_by_name || row.createdByName, 120),
        updatedByUserId: toSafeText(row.updated_by_user_id || row.updatedByUserId, 32),
        updatedBy: toSafeText(row.updated_by_username || row.updatedByUsername || row.updatedBy, 100),
        updatedByName: toSafeText(row.updated_by_name || row.updatedByName, 120),
        approvedByUserId: toSafeText(row.approved_by_user_id || row.approvedByUserId, 32),
        approvedBy: toSafeText(row.approved_by_username || row.approvedByUsername || row.approvedBy, 100),
        approvedByName: toSafeText(row.approved_by_name || row.approvedByName, 120)
    };
};

const buildExpenseRecord = ({
    id,
    branchId,
    input = {},
    current = {},
    actor,
    now = new Date().toISOString()
}) => {
    const enumValidationError = validateSubmittedEnums(input);
    if (enumValidationError) {
        const error = new Error(enumValidationError);
        error.statusCode = 400;
        throw error;
    }
    const fields = normalizeExpenseFields(input, current);
    const validationError = validateExpenseFields(fields);
    if (validationError) {
        const error = new Error(validationError);
        error.statusCode = 400;
        throw error;
    }

    const normalizedActor = normalizeActor(actor);
    const existing = mapExpenseRecord(current, { branchId });
    const approval = isApprovalStatus(fields.status)
        ? {
            approvedAt: existing.approvedAt || now,
            approvedByUserId: existing.approvedByUserId || normalizedActor.userId,
            approvedBy: existing.approvedBy || actorDisplay(normalizedActor),
            approvedByName: existing.approvedByName || normalizedActor.name
        }
        : {
            approvedAt: '',
            approvedByUserId: '',
            approvedBy: '',
            approvedByName: ''
        };

    return {
        ...existing,
        ...fields,
        schemaVersion: EXPENSE_SCHEMA_VERSION,
        id: toSafeText(id || existing.id, 80),
        branchId: Number(branchId) || existing.branchId || null,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        createdByUserId: existing.createdByUserId || normalizedActor.userId,
        createdBy: existing.createdBy || actorDisplay(normalizedActor),
        createdByName: existing.createdByName || normalizedActor.name,
        updatedByUserId: normalizedActor.userId,
        updatedBy: actorDisplay(normalizedActor),
        updatedByName: normalizedActor.name,
        ...approval
    };
};

module.exports = {
    EXPENSE_SCHEMA_VERSION,
    EXPENSE_STATUSES,
    PAYMENT_METHODS,
    toSafeText,
    normalizeDateOnly,
    normalizeAmount,
    normalizeExpenseStatus,
    normalizePaymentMethod,
    toIsoDateTime,
    normalizeActor,
    normalizeExpenseFields,
    validateExpenseFields,
    validateSubmittedEnums,
    mapExpenseRecord,
    buildExpenseRecord
};
