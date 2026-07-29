const { readJson, writeJson } = require('../../../../core/data/data-store');

const STORE_KEYS = Object.freeze({
    customers: 'customers',
    plans: 'plans',
    payments: 'payments',
    tickets: 'tickets',
    jobs: 'jobs',
    smsMessages: 'sms_messages',
    smsAutomationRuns: 'sms_automation_runs',
    ponState: 'pon-state'
});

const IMPORTED_TEMPLATE = Object.freeze({
    plans: 0,
    customers: 0,
    payment_entries: 0,
    tickets: 0,
    jobs: 0,
    sms_messages: 0,
    sms_automation_runs: 0,
    pon_nap_connections: 0
});

const isNoRecordsPlaceholder = (entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const populatedFields = Object.entries(entry).filter(([, value]) => String(value == null ? '' : value).trim());
    if (populatedFields.length !== 1) return false;
    const [[key, value]] = populatedFields;
    return String(key || '').trim().toLowerCase() === 'note'
        && String(value || '').trim().toLowerCase() === 'no records';
};

const filterCustomerFullImportRows = (value) => (Array.isArray(value)
    ? value.filter((entry) => (
        entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && !isNoRecordsPlaceholder(entry)
    ))
    : []);

const asRows = filterCustomerFullImportRows;

const pickValue = (row, keys = []) => {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row || {}, key) && row[key] !== undefined) {
            return row[key];
        }
    }
    return undefined;
};

const textValue = (row, keys = []) => {
    const value = pickValue(row, keys);
    return value === undefined ? undefined : String(value == null ? '' : value).trim();
};

const numberValue = (row, keys = []) => {
    const value = pickValue(row, keys);
    if (value === undefined) return undefined;
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const integerValue = (row, keys = []) => {
    const value = numberValue(row, keys);
    return Number.isFinite(value) ? Math.trunc(value) : value;
};

const dateOnlyValue = (row, keys = []) => {
    const value = textValue(row, keys);
    if (value === undefined || value === '') return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value;
};

const dateTimeValue = (row, keys = []) => textValue(row, keys);

const definedFields = (value = {}) => Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneJsonValue = (value, fallback) => {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
};

const positiveIntegerValue = (row, keys = []) => {
    const value = integerValue(row, keys);
    return Number.isInteger(value) && value > 0 ? value : null;
};

const upsertById = (rows, normalized, idKeys = ['id']) => {
    const id = textValue(normalized, idKeys);
    if (!id) return false;
    const index = rows.findIndex((entry) => textValue(entry, idKeys) === id);
    if (index < 0) rows.push(normalized);
    else rows[index] = { ...rows[index], ...normalized };
    return true;
};

const normalizeNow = (value) => {
    const parsed = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
};

const customerAccountNumber = (customer = {}) => String(
    customer.accountNumber || customer.account_number || ''
).trim();

const customerBranchId = (customer = {}) => {
    const parsed = Number(customer.branchId || customer.branch_id || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const customerDisplayName = (customer = {}) => String(
    customer.name
    || customer.customerName
    || customer.customer_name
    || [customer.firstName || customer.first_name, customer.lastName || customer.last_name].filter(Boolean).join(' ')
    || ''
).trim();

const normalizePlan = (row, nowIso) => {
    const id = textValue(row, ['plan_id', 'planId', 'id']);
    if (!id) return null;
    const createdAt = dateTimeValue(row, ['created_at', 'createdAt']) || nowIso;
    const benefits = pickValue(row, ['benefits']);
    const profileBindings = pickValue(row, ['profile_bindings', 'profileBindings']);
    return definedFields({
        id,
        category: textValue(row, ['category']),
        label: textValue(row, ['label']),
        name: textValue(row, ['name']),
        description: textValue(row, ['description']),
        profile: textValue(row, ['profile']),
        profileBindings: profileBindings && typeof profileBindings === 'object' && !Array.isArray(profileBindings)
            ? profileBindings
            : undefined,
        price: numberValue(row, ['price']),
        priceSuffix: '/ month',
        benefits: Array.isArray(benefits) ? benefits : undefined,
        createdAt,
        updatedAt: dateTimeValue(row, ['updated_at', 'updatedAt']) || createdAt
    });
};

const normalizeCustomer = (row, branchId, nowIso) => {
    const accountNumber = textValue(row, ['account_number', 'accountNumber']);
    if (!accountNumber) return null;
    const firstName = textValue(row, ['first_name', 'firstName']);
    const lastName = textValue(row, ['last_name', 'lastName']);
    const explicitName = textValue(row, ['name', 'customer_name', 'customerName']);
    const derivedName = explicitName || [firstName, lastName].filter(Boolean).join(' ').trim();
    const createdAt = dateTimeValue(row, ['created_at', 'createdAt']) || nowIso;
    return definedFields({
        accountNumber,
        branchId,
        firstName,
        lastName,
        name: derivedName,
        email: textValue(row, ['email']),
        mobile: textValue(row, ['mobile']),
        mobileRaw: textValue(row, ['mobile_raw', 'mobileRaw']),
        street: textValue(row, ['street']),
        barangay: textValue(row, ['barangay']),
        municipality: textValue(row, ['municipality']),
        province: textValue(row, ['province']),
        area: textValue(row, ['area']),
        mapPin: textValue(row, ['map_pin', 'mapPin']),
        status: textValue(row, ['status']),
        statusMode: 'auto',
        remarks: textValue(row, ['remarks']),
        since: textValue(row, ['since']),
        activationDate: dateOnlyValue(row, ['activation_date', 'activationDate']),
        planId: textValue(row, ['plan_id', 'planId']),
        planName: textValue(row, ['plan_name', 'planName']),
        planAmount: numberValue(row, ['plan_amount', 'planAmount']),
        planBilling: textValue(row, ['plan_billing', 'planBilling']),
        planCategory: textValue(row, ['plan_category', 'planCategory']),
        scheduledPlanId: textValue(row, ['scheduled_plan_id', 'scheduledPlanId']),
        scheduledPlanName: textValue(row, ['scheduled_plan_name', 'scheduledPlanName']),
        scheduledPlanAmount: numberValue(row, ['scheduled_plan_amount', 'scheduledPlanAmount']),
        scheduledPlanBilling: textValue(row, ['scheduled_plan_billing', 'scheduledPlanBilling']),
        scheduledPlanCategory: textValue(row, ['scheduled_plan_category', 'scheduledPlanCategory']),
        scheduledPlanApplyAt: dateTimeValue(row, ['scheduled_plan_apply_at', 'scheduledPlanApplyAt']),
        scheduledPppoeProfile: textValue(row, ['scheduled_pppoe_profile', 'scheduledPppoeProfile']),
        billDate: dateOnlyValue(row, ['bill_date', 'billDate']),
        dueDate: dateOnlyValue(row, ['due_date', 'dueDate']),
        prepaidExpirationAt: dateTimeValue(row, [
            'prepaid_expiration_at',
            'prepaidExpirationAt',
            'expiry_datetime',
            'expiryDateTime'
        ]),
        dueOffset: integerValue(row, ['due_offset', 'dueOffset']),
        creditLimit: numberValue(row, ['credit_limit', 'creditLimit']),
        loginUsername: textValue(row, ['login_username', 'loginUsername']),
        loginPassword: textValue(row, ['login_password_hash', 'loginPassword', 'login_password']),
        pppoeMode: textValue(row, ['pppoe_mode', 'pppoeMode']),
        mikrotikId: textValue(row, ['mikrotik_id', 'mikrotikId']),
        pppoeUsername: textValue(row, ['pppoe_username', 'pppoeUsername']),
        pppoePassword: textValue(row, ['pppoe_password', 'pppoePassword']),
        pppoeProfile: textValue(row, ['pppoe_profile', 'pppoeProfile']),
        createdAt,
        updatedAt: dateTimeValue(row, ['updated_at', 'updatedAt']) || createdAt
    });
};

const normalizePayment = (row, branchId) => {
    const id = textValue(row, ['id']);
    const accountNumber = textValue(row, ['account_number', 'accountNumber']);
    if (!id || !accountNumber) return null;
    const recordedById = textValue(row, ['recorded_by_user_id', 'recordedByUserId']);
    const recordedByUsername = textValue(row, ['recorded_by_username', 'recordedByUsername']);
    const recordedByName = textValue(row, ['recorded_by_name', 'recordedByName']);
    const recordedByRole = textValue(row, ['recorded_by_role', 'recordedByRole']);
    const recordedBy = recordedById || recordedByUsername || recordedByName || recordedByRole
        ? definedFields({
            id: recordedById,
            username: recordedByUsername,
            name: recordedByName,
            role: recordedByRole
        })
        : undefined;
    return {
        accountNumber,
        entry: definedFields({
            id,
            branchId,
            accountNumber,
            amount: numberValue(row, ['amount']) ?? 0,
            date: dateOnlyValue(row, ['date']),
            kind: textValue(row, ['kind']),
            direction: textValue(row, ['direction']),
            reference: textValue(row, ['reference']),
            orNumber: textValue(row, ['or_number', 'orNumber']),
            description: textValue(row, ['description']),
            type: textValue(row, ['type']),
            recordedAt: dateTimeValue(row, ['recorded_at', 'recordedAt']),
            recordedBy,
            payer: textValue(row, ['payer']),
            status: textValue(row, ['status']),
            paymentMethod: textValue(row, ['payment_method', 'paymentMethod']),
            fingerprint: textValue(row, ['fingerprint']),
            xenditId: textValue(row, ['xendit_id', 'xenditId'])
        })
    };
};

const normalizeTicket = (row, branchId, nowIso) => {
    const id = positiveIntegerValue(row, ['id']);
    if (!id) return null;
    const createdAt = dateTimeValue(row, ['created_at', 'createdAt']) || nowIso;
    const subject = textValue(row, ['subject']) || '';
    return definedFields({
        id,
        branchId,
        ticketNumber: textValue(row, ['ticket_number', 'ticketNumber'])
            || `TKT-${String(id).padStart(8, '0')}`,
        category: textValue(row, ['category']) || subject,
        subject,
        description: textValue(row, ['description']),
        customerName: textValue(row, ['customer_name', 'customerName']),
        accountNumber: textValue(row, ['account_number', 'accountNumber']),
        contact: textValue(row, ['contact']),
        status: textValue(row, ['status']),
        assignedTo: textValue(row, ['assigned_to', 'assignedTo']),
        source: textValue(row, ['source']),
        createdAt,
        updatedAt: dateTimeValue(row, ['updated_at', 'updatedAt']) || createdAt,
        historyJobId: positiveIntegerValue(row, ['history_job_id', 'historyJobId']),
        historyJobCreatedAt: dateTimeValue(row, ['history_job_created_at', 'historyJobCreatedAt'])
    });
};

const normalizeJob = (row, branchId, nowIso, ticketIds) => {
    const id = positiveIntegerValue(row, ['id']);
    if (!id) return null;
    const requestedTicketId = positiveIntegerValue(row, ['ticket_id', 'ticketId']);
    const ticketId = requestedTicketId && ticketIds.has(String(requestedTicketId)) ? requestedTicketId : null;
    const createdAt = dateTimeValue(row, ['created_at', 'createdAt']) || nowIso;
    const notes = textValue(row, ['notes']);
    const description = textValue(row, ['description']);
    return definedFields({
        id,
        branchId,
        jobNumber: textValue(row, ['job_number', 'jobNumber']),
        type: textValue(row, ['type']),
        technician: textValue(row, ['technician']),
        priority: textValue(row, ['priority']),
        schedule: dateTimeValue(row, ['schedule']),
        status: textValue(row, ['status']),
        doneAt: dateTimeValue(row, ['done_at', 'doneAt']),
        notes: notes || description || '',
        description: description || notes || '',
        createdAt,
        updatedAt: dateTimeValue(row, ['updated_at', 'updatedAt']) || createdAt,
        ticketId,
        ticketNumber: textValue(row, ['ticket_number', 'ticketNumber']),
        ticketSubject: textValue(row, ['ticket_subject', 'ticketSubject']),
        origin: textValue(row, ['origin'])
    });
};

const normalizeSmsMessage = (row, branchId, nowIso) => {
    const id = positiveIntegerValue(row, ['id']);
    if (!id) return null;
    const requestedAccount = textValue(row, [
        'customer_account_number',
        'customerAccountNumber',
        'account_number',
        'accountNumber'
    ]) || '';
    const customerAccountNumber = requestedAccount;
    return definedFields({
        id,
        branchId,
        scheduleId: positiveIntegerValue(row, ['schedule_id', 'scheduleId']),
        provider: textValue(row, ['provider']) || 'semaphore',
        recipient: textValue(row, ['recipient']) || customerAccountNumber || `customer-${id}`,
        recipientLabel: textValue(row, ['recipient_label', 'recipientLabel']),
        customerAccountNumber,
        recipientArea: textValue(row, ['recipient_area', 'recipientArea']),
        senderName: textValue(row, ['sender_name', 'senderName']),
        messageText: textValue(row, ['message_text', 'messageText']) || '(imported message)',
        status: textValue(row, ['status']) || 'queued',
        providerMessageId: textValue(row, ['provider_message_id', 'providerMessageId']),
        providerResponse: pickValue(row, ['provider_response', 'providerResponse']),
        errorMessage: textValue(row, ['error_message', 'errorMessage']),
        createdByUserId: textValue(row, ['created_by_user_id', 'createdByUserId']),
        createdByUsername: textValue(row, ['created_by_username', 'createdByUsername']),
        createdAt: dateTimeValue(row, ['created_at', 'createdAt']) || nowIso
    });
};

const normalizeSmsAutomationRun = (row, branchId, nowIso) => {
    const id = positiveIntegerValue(row, ['id']);
    if (!id) return null;
    const requestedAccount = textValue(row, [
        'customer_account_number',
        'customerAccountNumber',
        'account_number',
        'accountNumber'
    ]) || '';
    const customerAccountNumber = requestedAccount;
    let payload = pickValue(row, ['payload']);
    if (typeof payload === 'string' && payload.trim()) {
        try {
            payload = JSON.parse(payload);
        } catch {
            // Keep provider payload text when it is not JSON.
        }
    }
    return definedFields({
        id,
        automationId: positiveIntegerValue(row, ['automation_id', 'automationId']),
        branchId,
        customerAccountNumber,
        recipient: textValue(row, ['recipient']),
        deliveryMethod: textValue(row, ['delivery_method', 'deliveryMethod']) || 'sms',
        status: textValue(row, ['status']) || 'pending',
        errorMessage: textValue(row, ['error_message', 'errorMessage']),
        payload,
        createdAt: dateTimeValue(row, ['created_at', 'createdAt']) || nowIso
    });
};

const parsePonStateRow = (tables = {}) => {
    const rows = asRows(tables.pon_state);
    if (!rows.length) return null;
    let payload = pickValue(rows[0], ['state_json', 'stateJson', 'state']);
    if (payload === undefined) {
        const chunks = rows
            .map((row, index) => ({
                index: positiveIntegerValue(row, ['chunk_index', 'chunkIndex']) || index + 1,
                value: String(pickValue(row, ['state_json_chunk', 'stateJsonChunk']) ?? '')
            }))
            .sort((left, right) => left.index - right.index);
        payload = chunks.map((chunk) => chunk.value).join('');
    }
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            return null;
        }
    }
    if (!isPlainObject(payload)) return null;
    const scoped = isPlainObject(payload.state) ? payload.state : payload;
    return {
        olts: Array.isArray(scoped.olts) ? cloneJsonValue(scoped.olts, []) : [],
        naps: Array.isArray(scoped.naps) ? cloneJsonValue(scoped.naps, []) : [],
        updatedAt: textValue(scoped, ['updatedAt', 'updated_at']) || undefined
    };
};

const buildPonNapLookup = (naps = []) => {
    const lookup = new Map();
    naps.forEach((nap) => {
        [nap?.id, nap?.napId, nap?.nap_id, nap?.code].forEach((value) => {
            const key = String(value == null ? '' : value).trim().toLowerCase();
            if (key && !lookup.has(key)) lookup.set(key, nap);
        });
    });
    return lookup;
};

const findPonNapForRow = (lookup, row) => {
    const candidates = [
        pickValue(row, ['nap_id', 'napId']),
        pickValue(row, ['nap_client_uid', 'napClientUid']),
        pickValue(row, ['nap_code', 'napCode'])
    ];
    for (const value of candidates) {
        const key = String(value == null ? '' : value).trim().toLowerCase();
        if (key && lookup.has(key)) return lookup.get(key);
    }
    return null;
};

const paymentTimestamp = (entry = {}) => {
    const parsed = new Date(entry.recordedAt || entry.recorded_at || entry.date || '').getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const sortPaymentHistory = (history = []) => history.slice().sort((left, right) => {
    const timeDifference = paymentTimestamp(right) - paymentTimestamp(left);
    return timeDifference || String(right.id || '').localeCompare(String(left.id || ''));
});

const buildCustomerFullJsonImport = ({ branchId, tables = {}, stores = {}, now = new Date() } = {}) => {
    const scopedBranchId = Number(branchId);
    if (!Number.isInteger(scopedBranchId) || scopedBranchId <= 0) {
        throw new Error('A valid branch ID is required for JSON customer import.');
    }

    const nowIso = normalizeNow(now);
    const imported = { ...IMPORTED_TEMPLATE };
    const warnings = [];
    const pushWarning = (message) => {
        if (message && warnings.length < 200) warnings.push(String(message));
    };

    const sourcePlans = Array.isArray(stores.plans) ? stores.plans : [];
    const plans = sourcePlans.map((plan) => ({ ...plan }));
    const planIndex = new Map(plans.map((plan, index) => [String(plan?.id || plan?.planId || plan?.plan_id || '').trim(), index]));
    asRows(tables.plans).forEach((row, index) => {
        const normalized = normalizePlan(row, nowIso);
        if (!normalized) {
            pushWarning(`Skipped plan row ${index + 2}: plan ID is missing.`);
            return;
        }
        const existingIndex = planIndex.get(normalized.id);
        if (existingIndex === undefined) {
            planIndex.set(normalized.id, plans.length);
            plans.push(normalized);
        } else {
            plans[existingIndex] = { ...plans[existingIndex], ...normalized };
        }
        imported.plans += 1;
    });

    const sourceCustomers = Array.isArray(stores.customers) ? stores.customers : [];
    const customers = sourceCustomers.map((customer) => ({ ...customer }));
    const customerIndex = new Map(customers.map((customer, index) => [customerAccountNumber(customer), index]));
    asRows(tables.customers).forEach((row, index) => {
        const normalized = normalizeCustomer(row, scopedBranchId, nowIso);
        if (!normalized) {
            pushWarning(`Skipped customer row ${index + 2}: account number is missing.`);
            return;
        }
        const existingIndex = customerIndex.get(normalized.accountNumber);
        if (existingIndex === undefined) {
            customerIndex.set(normalized.accountNumber, customers.length);
            customers.push(normalized);
        } else {
            customers[existingIndex] = { ...customers[existingIndex], ...normalized };
        }
        imported.customers += 1;
    });

    const branchAccounts = new Map();
    customers.forEach((customer) => {
        const accountNumber = customerAccountNumber(customer);
        const storedBranchId = customerBranchId(customer);
        if (accountNumber && (!storedBranchId || storedBranchId === scopedBranchId)) {
            branchAccounts.set(accountNumber, customer);
        }
    });

    const sourcePayments = stores.payments && typeof stores.payments === 'object' && !Array.isArray(stores.payments)
        ? stores.payments
        : {};
    const payments = Object.fromEntries(Object.entries(sourcePayments).map(([accountNumber, accountData]) => [
        accountNumber,
        {
            ...(accountData && typeof accountData === 'object' ? accountData : {}),
            history: asRows(accountData?.history).map((entry) => ({ ...entry }))
        }
    ]));
    const importedPaymentById = new Map();
    asRows(tables.payment_entries || tables.payments).forEach((row, index) => {
        const normalized = normalizePayment(row, scopedBranchId);
        if (!normalized) {
            pushWarning(`Skipped payment row ${index + 2}: payment ID or account number is missing.`);
            return;
        }
        if (!branchAccounts.has(normalized.accountNumber)) {
            pushWarning(`Skipped payment ${normalized.entry.id}: customer ${normalized.accountNumber} not found in branch ${scopedBranchId}.`);
            return;
        }
        importedPaymentById.set(normalized.entry.id, normalized);
        imported.payment_entries += 1;
    });

    if (importedPaymentById.size) {
        const replacedIds = new Set(importedPaymentById.keys());
        Object.values(payments).forEach((accountData) => {
            accountData.history = accountData.history.filter((entry) => !replacedIds.has(String(entry?.id || '').trim()));
        });
        importedPaymentById.forEach(({ accountNumber, entry }) => {
            const customer = branchAccounts.get(accountNumber) || {};
            if (!Object.prototype.hasOwnProperty.call(payments, accountNumber)) {
                Object.defineProperty(payments, accountNumber, {
                    value: { history: [] },
                    configurable: true,
                    enumerable: true,
                    writable: true
                });
            }
            payments[accountNumber] = {
                ...payments[accountNumber],
                customerName: payments[accountNumber].customerName || customerDisplayName(customer),
                area: payments[accountNumber].area || String(customer.area || '').trim(),
                history: sortPaymentHistory([...(payments[accountNumber].history || []), entry])
            };
        });
    }

    const tickets = asRows(stores.tickets).map((ticket) => ({ ...ticket }));
    asRows(tables.tickets).forEach((row, index) => {
        const normalized = normalizeTicket(row, scopedBranchId, nowIso);
        if (!normalized) {
            pushWarning(`Skipped ticket row ${index + 2}: ticket ID is missing or invalid.`);
            return;
        }
        upsertById(tickets, normalized);
        imported.tickets += 1;
    });

    const ticketIds = new Set(tickets.map((ticket) => String(ticket?.id || '').trim()).filter(Boolean));
    const jobs = asRows(stores.jobs).map((job) => ({ ...job }));
    asRows(tables.jobs).forEach((row, index) => {
        const normalized = normalizeJob(row, scopedBranchId, nowIso, ticketIds);
        if (!normalized) {
            pushWarning(`Skipped job row ${index + 2}: job ID is missing or invalid.`);
            return;
        }
        upsertById(jobs, normalized);
        imported.jobs += 1;
    });

    const smsMessages = asRows(stores.sms_messages).map((message) => ({ ...message }));
    asRows(tables.sms_messages).forEach((row, index) => {
        const normalized = normalizeSmsMessage(row, scopedBranchId, nowIso);
        if (!normalized) {
            pushWarning(`Skipped SMS message row ${index + 2}: message ID is missing or invalid.`);
            return;
        }
        upsertById(smsMessages, normalized);
        imported.sms_messages += 1;
    });

    const smsAutomationRuns = asRows(stores.sms_automation_runs).map((run) => ({ ...run }));
    asRows(tables.sms_automation_runs).forEach((row, index) => {
        const normalized = normalizeSmsAutomationRun(row, scopedBranchId, nowIso);
        if (!normalized) {
            pushWarning(`Skipped SMS automation row ${index + 2}: run ID is missing or invalid.`);
            return;
        }
        upsertById(smsAutomationRuns, normalized);
        imported.sms_automation_runs += 1;
    });

    const sourcePonState = isPlainObject(stores['pon-state']) ? stores['pon-state'] : {};
    const ponState = cloneJsonValue(sourcePonState, {});
    ponState.branches = isPlainObject(ponState.branches) ? ponState.branches : {};
    const branchKey = String(scopedBranchId);
    const exportedPonState = parsePonStateRow(tables);
    const storedScopedPonState = isPlainObject(ponState.branches[branchKey])
        ? ponState.branches[branchKey]
        : (isPlainObject(ponState.default) ? ponState.default : {});
    const scopedPonState = exportedPonState || cloneJsonValue(storedScopedPonState, {});
    scopedPonState.olts = Array.isArray(scopedPonState.olts) ? scopedPonState.olts : [];
    scopedPonState.naps = Array.isArray(scopedPonState.naps) ? scopedPonState.naps : [];
    const ponNapLookup = buildPonNapLookup(scopedPonState.naps);

    asRows(tables.pon_nap_connections).forEach((row, index) => {
        const nap = findPonNapForRow(ponNapLookup, row);
        const rowLabel = textValue(row, ['id']) || String(index + 2);
        if (!nap) {
            pushWarning(`Skipped PON connection ${rowLabel}: NAP is missing in this branch export.`);
            return;
        }
        const port = positiveIntegerValue(row, ['port']);
        if (!port) {
            pushWarning(`Skipped PON connection ${rowLabel}: port is invalid.`);
            return;
        }
        const requestedAccount = textValue(row, [
            'customer_account_number',
            'customerAccountNumber',
            'account_number',
            'accountNumber',
            'customer_id',
            'customerId'
        ]) || '';
        const accountNumber = requestedAccount;
        const connectionId = textValue(row, ['id'])
            || `${String(nap.id || nap.code || 'nap')}:${port}:${accountNumber || 'unassigned'}`;
        const connection = definedFields({
            id: connectionId,
            customerId: accountNumber,
            customerName: textValue(row, ['customer_name', 'customerName']),
            customerRef: textValue(row, ['customer_ref', 'customerRef']),
            port,
            opticalInfo: textValue(row, ['optical_info', 'opticalInfo']),
            createdAt: dateTimeValue(row, ['created_at', 'createdAt']) || nowIso,
            updatedAt: dateTimeValue(row, ['updated_at', 'updatedAt']) || nowIso
        });
        const connections = asRows(nap.connections).map((entry) => ({ ...entry }));
        const existingIndex = connections.findIndex((entry) => (
            String(entry?.id || '').trim() === connectionId
            || Number(entry?.port) === port
        ));
        if (existingIndex < 0) connections.push(connection);
        else connections[existingIndex] = { ...connections[existingIndex], ...connection };
        nap.connections = connections;
        nap.used = Math.max(Number(nap.used || 0), connections.length);
        imported.pon_nap_connections += 1;
    });

    const ponStateTouched = Boolean(exportedPonState) || imported.pon_nap_connections > 0;
    if (ponStateTouched) {
        scopedPonState.updatedAt = nowIso;
        ponState.branches[branchKey] = scopedPonState;
    }

    return {
        stores: {
            customers,
            plans,
            payments,
            tickets,
            jobs,
            sms_messages: smsMessages,
            sms_automation_runs: smsAutomationRuns,
            'pon-state': ponState
        },
        imported,
        warnings,
        warningCount: warnings.length,
        touchedKeys: [
            ...(imported.plans ? [STORE_KEYS.plans] : []),
            ...(imported.customers ? [STORE_KEYS.customers] : []),
            ...(imported.payment_entries ? [STORE_KEYS.payments] : []),
            ...(imported.tickets ? [STORE_KEYS.tickets] : []),
            ...(imported.jobs ? [STORE_KEYS.jobs] : []),
            ...(imported.sms_messages ? [STORE_KEYS.smsMessages] : []),
            ...(imported.sms_automation_runs ? [STORE_KEYS.smsAutomationRuns] : []),
            ...(ponStateTouched ? [STORE_KEYS.ponState] : [])
        ]
    };
};

const importCustomerFullJsonData = async ({
    branchId,
    tables,
    now = new Date(),
    readStore = readJson,
    writeStore = writeJson
} = {}) => {
    const [customers, plans, payments, tickets, jobs, smsMessages, smsAutomationRuns, ponState] = await Promise.all([
        readStore(STORE_KEYS.customers, []),
        readStore(STORE_KEYS.plans, []),
        readStore(STORE_KEYS.payments, {}),
        readStore(STORE_KEYS.tickets, []),
        readStore(STORE_KEYS.jobs, []),
        readStore(STORE_KEYS.smsMessages, []),
        readStore(STORE_KEYS.smsAutomationRuns, []),
        readStore(STORE_KEYS.ponState, {})
    ]);
    const result = buildCustomerFullJsonImport({
        branchId,
        tables,
        stores: {
            customers,
            plans,
            payments,
            tickets,
            jobs,
            sms_messages: smsMessages,
            sms_automation_runs: smsAutomationRuns,
            'pon-state': ponState
        },
        now
    });
    const originalByKey = {
        customers,
        plans,
        payments,
        tickets,
        jobs,
        sms_messages: smsMessages,
        sms_automation_runs: smsAutomationRuns,
        'pon-state': ponState
    };
    const writtenKeys = [];
    try {
        for (const key of result.touchedKeys) {
            await writeStore(key, result.stores[key]);
            writtenKeys.push(key);
        }
    } catch (error) {
        const rollbackFailures = [];
        for (const key of writtenKeys.reverse()) {
            try {
                await writeStore(key, originalByKey[key]);
            } catch (rollbackError) {
                rollbackFailures.push(`${key}: ${rollbackError?.message || rollbackError}`);
            }
        }
        if (rollbackFailures.length) error.rollbackFailures = rollbackFailures;
        throw error;
    }
    return result;
};

module.exports = {
    buildCustomerFullJsonImport,
    filterCustomerFullImportRows,
    importCustomerFullJsonData
};
