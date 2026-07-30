const crypto = require('crypto');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const {
  PLAN_TYPES,
  BILLING_SCHEDULE_MODES,
  normalizePlanType,
  normalizeBillingScheduleMode,
  formatDateOnly,
  advanceBillingDate,
  resolveInitialCycleState,
  resolveCycleCharge,
  isCycleDue
} = require('./billing-cycle');

const STORE_KEY = 'temp_workspace_isolated_v1';
const EXPORT_KIND = 'isp-temp-workspace-export';
const SCHEMA_VERSION = 3;
const PAYMENT_KINDS = new Set(['payment', 'charge', 'rebate', 'discount']);
const CUSTOMER_STATUSES = new Set(['active', 'inactive']);

class WorkspaceValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'WorkspaceValidationError';
    this.statusCode = statusCode;
  }
}

const cleanText = (value, maxLength = 200) => String(value ?? '').trim().slice(0, maxLength);
const roundMoney = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(2));
};
const normalizeAccountNumber = (value) => cleanText(value, 24).toUpperCase().replace(/\s+/g, '');
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const todayIso = () => new Date().toISOString().slice(0, 10);
const manilaDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const formatManilaDate = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = Object.fromEntries(
    manilaDateFormatter.formatToParts(parsed).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

function createEmptyWorkspace() {
  return {
    schemaVersion: SCHEMA_VERSION,
    locationName: 'Secondary Location',
    customers: [],
    payments: [],
    sequences: { customer: 0, payment: 0 },
    updatedAt: null
  };
}

function normalizeCustomer(raw = {}) {
  const createdAt = cleanText(raw.createdAt, 40) || new Date(0).toISOString();
  return {
    accountNumber: normalizeAccountNumber(raw.accountNumber),
    firstName: cleanText(raw.firstName, 80),
    lastName: cleanText(raw.lastName, 80),
    contactNumber: cleanText(raw.contactNumber, 40),
    email: cleanText(raw.email, 160),
    address: cleanText(raw.address, 300),
    planName: cleanText(raw.planName, 120),
    planType: normalizePlanType(raw.planType),
    monthlyRate: Math.max(0, roundMoney(raw.monthlyRate)),
    billingScheduleMode: normalizeBillingScheduleMode(raw.billingScheduleMode),
    billingScheduleConfigured: raw.billingScheduleConfigured === true,
    billingDay: Math.min(31, Math.max(1, Number.parseInt(raw.billingDay, 10) || 1)),
    activationDate: isIsoDate(raw.activationDate) ? String(raw.activationDate) : '',
    nextBillingDate: isIsoDate(raw.nextBillingDate) ? String(raw.nextBillingDate) : '',
    billingCycleInitialized: raw.billingCycleInitialized === true,
    proratePending: raw.proratePending === true,
    openingBalance: roundMoney(raw.openingBalance),
    status: CUSTOMER_STATUSES.has(cleanText(raw.status, 20).toLowerCase())
      ? cleanText(raw.status, 20).toLowerCase()
      : 'active',
    notes: cleanText(raw.notes, 1000),
    createdAt,
    updatedAt: cleanText(raw.updatedAt, 40) || createdAt
  };
}

function normalizePayment(raw = {}) {
  const createdAt = cleanText(raw.createdAt, 40) || new Date(0).toISOString();
  const kind = cleanText(raw.kind, 20).toLowerCase();
  return {
    id: cleanText(raw.id, 80),
    receiptNumber: cleanText(raw.receiptNumber, 40).toUpperCase(),
    accountNumber: normalizeAccountNumber(raw.accountNumber),
    kind: PAYMENT_KINDS.has(kind) ? kind : 'payment',
    amount: Math.abs(roundMoney(raw.amount)),
    date: isIsoDate(raw.date) ? String(raw.date) : todayIso(),
    paymentMethod: cleanText(raw.paymentMethod, 80),
    reference: cleanText(raw.reference, 120),
    description: cleanText(raw.description, 500),
    recordedBy: cleanText(raw.recordedBy, 120),
    systemGenerated: raw.systemGenerated === true,
    cycleKey: cleanText(raw.cycleKey, 80),
    createdAt,
    updatedAt: cleanText(raw.updatedAt, 40) || createdAt
  };
}

function normalizeWorkspace(raw) {
  const base = createEmptyWorkspace();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const customers = Array.isArray(raw.customers)
    ? raw.customers.map(normalizeCustomer).filter((customer) => customer.accountNumber)
    : [];
  const knownAccounts = new Set(customers.map((customer) => customer.accountNumber));
  const payments = Array.isArray(raw.payments)
    ? raw.payments
        .map(normalizePayment)
        .filter((payment) => payment.id && payment.amount > 0 && knownAccounts.has(payment.accountNumber))
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    locationName: cleanText(raw.locationName, 120) || base.locationName,
    customers,
    payments,
    sequences: {
      customer: Math.max(customers.length, Number.parseInt(raw.sequences?.customer, 10) || 0),
      payment: Math.max(payments.length, Number.parseInt(raw.sequences?.payment, 10) || 0)
    },
    updatedAt: cleanText(raw.updatedAt, 40) || null
  };
}

function paymentBalanceImpact(payment) {
  return payment.kind === 'charge' ? payment.amount : -payment.amount;
}

function buildWorkspaceSnapshot(rawWorkspace) {
  const workspace = normalizeWorkspace(rawWorkspace);
  const paymentTotals = new Map();
  const paymentCounts = new Map();

  workspace.payments.forEach((payment) => {
    paymentTotals.set(
      payment.accountNumber,
      roundMoney((paymentTotals.get(payment.accountNumber) || 0) + paymentBalanceImpact(payment))
    );
    paymentCounts.set(payment.accountNumber, (paymentCounts.get(payment.accountNumber) || 0) + 1);
  });

  const customers = workspace.customers
    .map((customer) => ({
      ...customer,
      fullName: `${customer.firstName} ${customer.lastName}`.trim(),
      balance: roundMoney(customer.openingBalance + (paymentTotals.get(customer.accountNumber) || 0)),
      paymentCount: paymentCounts.get(customer.accountNumber) || 0
    }))
    .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName));
  const customerNames = new Map(customers.map((customer) => [customer.accountNumber, customer.fullName]));
  const payments = workspace.payments
    .map((payment) => ({
      ...payment,
      customerName: customerNames.get(payment.accountNumber) || payment.accountNumber,
      balanceImpact: paymentBalanceImpact(payment)
    }))
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt));

  const outstandingBalance = customers.reduce((total, customer) => total + Math.max(0, customer.balance), 0);
  const advanceBalance = customers.reduce((total, customer) => total + Math.max(0, -customer.balance), 0);
  const totalPayments = payments
    .filter((payment) => payment.kind === 'payment')
    .reduce((total, payment) => total + payment.amount, 0);
  const totalCharges = payments
    .filter((payment) => payment.kind === 'charge')
    .reduce((total, payment) => total + payment.amount, 0);

  return {
    ok: true,
    workspace: {
      schemaVersion: workspace.schemaVersion,
      locationName: workspace.locationName,
      updatedAt: workspace.updatedAt
    },
    customers,
    payments,
    summary: {
      customerCount: customers.length,
      activeCustomerCount: customers.filter((customer) => customer.status === 'active').length,
      paymentCount: payments.length,
      totalPayments: roundMoney(totalPayments),
      totalCharges: roundMoney(totalCharges),
      outstandingBalance: roundMoney(outstandingBalance),
      advanceBalance: roundMoney(advanceBalance)
    }
  };
}

function validateCustomerInput(payload, options = {}) {
  const requestedPlanType = cleanText(payload?.planType, 20).toLowerCase();
  if (requestedPlanType && !PLAN_TYPES.has(requestedPlanType)) {
    throw new WorkspaceValidationError('Plan type must be Prepaid, Postpaid, or Prorate.');
  }
  const requestedScheduleMode = cleanText(payload?.billingScheduleMode, 20).toLowerCase();
  if (requestedScheduleMode && !BILLING_SCHEDULE_MODES.has(requestedScheduleMode)) {
    throw new WorkspaceValidationError('Billing day type must be Date or Number.');
  }
  const customer = normalizeCustomer({ ...payload, status: payload?.status || 'active' });
  if (!customer.firstName) throw new WorkspaceValidationError('First name is required.');
  if (!customer.lastName) throw new WorkspaceValidationError('Last name is required.');
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    throw new WorkspaceValidationError('Enter a valid email address.');
  }
  if (customer.accountNumber && !/^[A-Z0-9-]{3,24}$/.test(customer.accountNumber)) {
    throw new WorkspaceValidationError('Account number may contain only letters, numbers, and hyphens.');
  }
  if (!options.allowMissingAccount && !customer.accountNumber) {
    throw new WorkspaceValidationError('Account number is required.');
  }
  if (options.requireActivationDate && !customer.activationDate) {
    throw new WorkspaceValidationError('Activation date is required.');
  }
  if (customer.billingScheduleMode === 'date' && !customer.nextBillingDate) {
    throw new WorkspaceValidationError('Next billing date is required when Billing day uses Date.');
  }
  return customer;
}

function validatePaymentInput(payload) {
  const requestedKind = cleanText(payload?.kind, 20).toLowerCase();
  if (!PAYMENT_KINDS.has(requestedKind)) throw new WorkspaceValidationError('Transaction type is invalid.');
  const payment = normalizePayment(payload);
  if (!payment.accountNumber) throw new WorkspaceValidationError('Customer is required.');
  if (!Number.isFinite(Number(payload?.amount)) || Number(payload.amount) <= 0) {
    throw new WorkspaceValidationError('Amount must be greater than zero.');
  }
  if (!isIsoDate(payload?.date)) throw new WorkspaceValidationError('Transaction date is required.');
  return payment;
}

function createWorkspaceStore(options = {}) {
  const readStore = options.readJson || readJson;
  const writeStore = options.writeJson || writeJson;
  const now = options.now || (() => new Date().toISOString());
  const uuid = options.uuid || (() => crypto.randomUUID());
  const resolveCurrentDate = (timestamp = now()) => {
    const override = typeof options.today === 'function' ? options.today() : options.today;
    const candidate = cleanText(override, 20);
    if (isIsoDate(candidate)) return candidate;
    return formatManilaDate(timestamp) || todayIso();
  };
  let mutationQueue = Promise.resolve();

  const readWorkspace = async () => normalizeWorkspace(await readStore(STORE_KEY, createEmptyWorkspace()));
  const saveWorkspace = async (workspace) => {
    const normalized = normalizeWorkspace(workspace);
    normalized.updatedAt = now();
    await writeStore(STORE_KEY, normalized);
    return normalized;
  };
  const mutateWorkspace = (operation) => {
    const result = mutationQueue.then(async () => {
      const workspace = await readWorkspace();
      const value = await operation(workspace);
      const saved = await saveWorkspace(workspace);
      return { value, workspace: saved };
    });
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const nextAccountNumber = (workspace) => {
    const existing = new Set(workspace.customers.map((customer) => customer.accountNumber));
    do {
      workspace.sequences.customer += 1;
      const candidate = `TMP${String(workspace.sequences.customer).padStart(6, '0')}`;
      if (!existing.has(candidate)) return candidate;
    } while (workspace.sequences.customer < 999999);
    throw new WorkspaceValidationError('No more Temp account numbers are available.', 409);
  };

  const nextReceiptNumber = (workspace) => {
    workspace.sequences.payment += 1;
    return `TMP-${String(workspace.sequences.payment).padStart(7, '0')}`;
  };

  const applyBillingCycles = (workspace, asOfDate, timestamp) => {
    let changed = false;
    for (let index = 0; index < workspace.customers.length; index += 1) {
      let customer = workspace.customers[index];
      if (!customer.billingCycleInitialized || !customer.billingScheduleConfigured) {
        customer = {
          ...customer,
          activationDate: customer.activationDate || asOfDate,
          ...resolveInitialCycleState(customer, asOfDate, { legacy: true }),
          updatedAt: timestamp
        };
        workspace.customers[index] = customer;
        changed = true;
      }

      if (customer.status !== 'active') continue;
      let cyclesProcessed = 0;
      while (isCycleDue(customer.nextBillingDate, asOfDate) && cyclesProcessed < 120) {
        const cycleDate = customer.nextBillingDate;
        const charge = resolveCycleCharge(customer, cycleDate);
        if (!charge || charge.amount <= 0) break;
        const cycleKey = `${customer.accountNumber}:${cycleDate}`;
        const alreadyRecorded = workspace.payments.some((payment) => payment.cycleKey === cycleKey);
        if (!alreadyRecorded) {
          workspace.payments.push(normalizePayment({
            id: `temp-cycle-${customer.accountNumber}-${cycleDate}`,
            receiptNumber: nextReceiptNumber(workspace),
            accountNumber: customer.accountNumber,
            kind: 'charge',
            amount: charge.amount,
            date: cycleDate,
            paymentMethod: 'System',
            description: charge.prorated
              ? `Prorated recurring charge (${charge.periodStart} to ${charge.periodEnd}, billing day ${customer.billingDay})`
              : 'Monthly recurring charge',
            recordedBy: 'Temp billing cycle',
            systemGenerated: true,
            cycleKey,
            createdAt: timestamp,
            updatedAt: timestamp
          }));
        }
        const nextCycleDate = advanceBillingDate(cycleDate, customer.billingDay, 1);
        customer = {
          ...customer,
          nextBillingDate: formatDateOnly(nextCycleDate),
          proratePending: false,
          updatedAt: timestamp
        };
        workspace.customers[index] = customer;
        changed = true;
        cyclesProcessed += 1;
      }
    }
    return changed;
  };

  const synchronizeBillingCycles = () => {
    const result = mutationQueue.then(async () => {
      const workspace = await readWorkspace();
      const timestamp = now();
      const changed = applyBillingCycles(workspace, resolveCurrentDate(timestamp), timestamp);
      return changed ? saveWorkspace(workspace) : workspace;
    });
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return Object.freeze({
    async getSnapshot() {
      return buildWorkspaceSnapshot(await synchronizeBillingCycles());
    },

    async createCustomer(payload) {
      const result = await mutateWorkspace(async (workspace) => {
        const timestamp = now();
        const asOfDate = resolveCurrentDate(timestamp);
        const customer = validateCustomerInput({
          ...payload,
          activationDate: payload?.activationDate || asOfDate
        }, { allowMissingAccount: true, requireActivationDate: true });
        customer.accountNumber = customer.accountNumber || nextAccountNumber(workspace);
        if (workspace.customers.some((item) => item.accountNumber === customer.accountNumber)) {
          throw new WorkspaceValidationError('That Temp account number already exists.', 409);
        }
        Object.assign(customer, resolveInitialCycleState(customer, asOfDate));
        customer.createdAt = timestamp;
        customer.updatedAt = timestamp;
        workspace.customers.push(customer);
        return customer.accountNumber;
      });
      return buildWorkspaceSnapshot(result.workspace).customers.find((customer) => customer.accountNumber === result.value);
    },

    async updateCustomer(accountNumber, payload) {
      const account = normalizeAccountNumber(accountNumber);
      const result = await mutateWorkspace(async (workspace) => {
        const index = workspace.customers.findIndex((customer) => customer.accountNumber === account);
        if (index < 0) throw new WorkspaceValidationError('Temp customer was not found.', 404);
        const existing = workspace.customers[index];
        const timestamp = now();
        const asOfDate = resolveCurrentDate(timestamp);
        const updated = validateCustomerInput({
          ...existing,
          ...payload,
          accountNumber: account,
          activationDate: payload?.activationDate || existing.activationDate || asOfDate
        }, { requireActivationDate: true });
        const cycleInputsChanged = (
          updated.planType !== existing.planType
          || updated.activationDate !== existing.activationDate
          || updated.billingScheduleMode !== existing.billingScheduleMode
          || updated.billingDay !== existing.billingDay
          || (
            updated.billingScheduleMode === 'date'
            && updated.nextBillingDate !== existing.nextBillingDate
          )
          || (existing.status !== 'active' && updated.status === 'active')
          || !existing.billingCycleInitialized
          || !existing.billingScheduleConfigured
        );
        if (cycleInputsChanged) {
          Object.assign(updated, resolveInitialCycleState(updated, asOfDate));
        } else {
          updated.nextBillingDate = existing.nextBillingDate;
          updated.billingCycleInitialized = existing.billingCycleInitialized;
          updated.billingScheduleConfigured = existing.billingScheduleConfigured;
          updated.proratePending = existing.proratePending;
        }
        updated.createdAt = existing.createdAt;
        updated.updatedAt = timestamp;
        workspace.customers[index] = updated;
        return account;
      });
      return buildWorkspaceSnapshot(result.workspace).customers.find((customer) => customer.accountNumber === result.value);
    },

    async deleteCustomer(accountNumber) {
      const account = normalizeAccountNumber(accountNumber);
      const result = await mutateWorkspace(async (workspace) => {
        const index = workspace.customers.findIndex((customer) => customer.accountNumber === account);
        if (index < 0) throw new WorkspaceValidationError('Temp customer was not found.', 404);
        if (workspace.payments.some((payment) => payment.accountNumber === account)) {
          throw new WorkspaceValidationError('Delete this customer\'s Temp transactions first.', 409);
        }
        workspace.customers.splice(index, 1);
        return account;
      });
      return { ok: true, accountNumber: result.value };
    },

    async createPayment(payload, actor = '') {
      const result = await mutateWorkspace(async (workspace) => {
        const payment = validatePaymentInput(payload);
        if (!workspace.customers.some((customer) => customer.accountNumber === payment.accountNumber)) {
          throw new WorkspaceValidationError('Select an existing Temp customer.', 404);
        }
        const timestamp = now();
        payment.id = uuid();
        payment.receiptNumber = nextReceiptNumber(workspace);
        payment.recordedBy = cleanText(actor, 120);
        payment.createdAt = timestamp;
        payment.updatedAt = timestamp;
        workspace.payments.push(payment);
        return payment.id;
      });
      return buildWorkspaceSnapshot(result.workspace).payments.find((payment) => payment.id === result.value);
    },

    async updatePayment(paymentId, payload, actor = '') {
      const id = cleanText(paymentId, 80);
      const result = await mutateWorkspace(async (workspace) => {
        const index = workspace.payments.findIndex((payment) => payment.id === id);
        if (index < 0) throw new WorkspaceValidationError('Temp transaction was not found.', 404);
        const existing = workspace.payments[index];
        const updated = validatePaymentInput({ ...existing, ...payload });
        if (!workspace.customers.some((customer) => customer.accountNumber === updated.accountNumber)) {
          throw new WorkspaceValidationError('Select an existing Temp customer.', 404);
        }
        updated.id = existing.id;
        updated.receiptNumber = existing.receiptNumber;
        updated.recordedBy = cleanText(actor, 120) || existing.recordedBy;
        updated.createdAt = existing.createdAt;
        updated.updatedAt = now();
        workspace.payments[index] = updated;
        return id;
      });
      return buildWorkspaceSnapshot(result.workspace).payments.find((payment) => payment.id === result.value);
    },

    async deletePayment(paymentId) {
      const id = cleanText(paymentId, 80);
      const result = await mutateWorkspace(async (workspace) => {
        const index = workspace.payments.findIndex((payment) => payment.id === id);
        if (index < 0) throw new WorkspaceValidationError('Temp transaction was not found.', 404);
        workspace.payments.splice(index, 1);
        return id;
      });
      return { ok: true, id: result.value };
    },

    async clearAllData() {
      const result = await mutateWorkspace(async (workspace) => {
        const locationName = workspace.locationName || createEmptyWorkspace().locationName;
        Object.assign(workspace, createEmptyWorkspace(), { locationName });
        return true;
      });
      return buildWorkspaceSnapshot(result.workspace);
    },

    async createExport() {
      const workspace = await synchronizeBillingCycles();
      return {
        kind: EXPORT_KIND,
        version: SCHEMA_VERSION,
        exportedAt: now(),
        data: workspace
      };
    },

    async replaceFromExport(payload) {
      if (!payload || payload.kind !== EXPORT_KIND || !payload.data || typeof payload.data !== 'object') {
        throw new WorkspaceValidationError('Select a valid Temp workspace export file.');
      }
      if (!Array.isArray(payload.data.customers) || !Array.isArray(payload.data.payments)) {
        throw new WorkspaceValidationError('The Temp export is missing customer or transaction records.');
      }

      payload.data.customers.forEach((customer) => validateCustomerInput(customer));
      payload.data.payments.forEach((payment) => {
        validatePaymentInput(payment);
        if (!cleanText(payment.id, 80) || !cleanText(payment.receiptNumber, 40)) {
          throw new WorkspaceValidationError('The Temp export contains an unnumbered transaction.');
        }
      });

      const imported = normalizeWorkspace(payload.data);
      if (imported.customers.length !== payload.data.customers.length) {
        throw new WorkspaceValidationError('The Temp export contains an invalid customer record.');
      }
      const uniqueAccounts = new Set(imported.customers.map((customer) => customer.accountNumber));
      if (uniqueAccounts.size !== imported.customers.length) {
        throw new WorkspaceValidationError('The Temp export contains duplicate account numbers.');
      }
      if (imported.payments.length !== payload.data.payments.length) {
        throw new WorkspaceValidationError('The Temp export contains an invalid or unmatched transaction.');
      }
      const uniquePaymentIds = new Set(imported.payments.map((payment) => payment.id));
      if (uniquePaymentIds.size !== imported.payments.length) {
        throw new WorkspaceValidationError('The Temp export contains duplicate transaction IDs.');
      }

      const result = await mutateWorkspace(async (workspace) => {
        Object.assign(workspace, imported);
        return true;
      });
      return buildWorkspaceSnapshot(result.workspace);
    }
  });
}

const defaultStore = createWorkspaceStore();

module.exports = {
  STORE_KEY,
  EXPORT_KIND,
  SCHEMA_VERSION,
  WorkspaceValidationError,
  createEmptyWorkspace,
  normalizeWorkspace,
  buildWorkspaceSnapshot,
  createWorkspaceStore,
  ...defaultStore
};
