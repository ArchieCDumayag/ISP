const crypto = require('crypto');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { normalizeCustomerName } = require('../../../../core/data/customer-name-normalizer');
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
const SCHEMA_VERSION = 5;
const LEGACY_SCHEMA_VERSION = 3;
const OFFICIAL_GCASH_SOURCE = 'gcash-history';
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
const normalizeGcashReference = (value) => cleanText(value, 120).toUpperCase().replace(/[\s-]+/g, '');
const gcashReferenceKeys = (value) => {
  const exact = normalizeGcashReference(value);
  if (!exact) return [];
  const numeric = /^\d+$/.test(exact) ? exact.replace(/^0+(?=\d)/, '') : '';
  return numeric && numeric !== exact ? [exact, numeric] : [exact];
};
const gcashReferencesMatch = (left, right) => {
  const leftKeys = new Set(gcashReferenceKeys(left));
  return gcashReferenceKeys(right).some((key) => leftKeys.has(key));
};
const resolveOfficialIncomingGcashReference = (transactions, reference) => {
  const requestedReference = normalizeGcashReference(reference);
  if (!requestedReference) return null;
  const incoming = (Array.isArray(transactions) ? transactions : []).filter((transaction) => (
    String(transaction?.status || '').trim().toLowerCase() === 'received'
    && Number(transaction?.credit) > 0
  ));
  const exactMatches = incoming.filter((transaction) => (
    normalizeGcashReference(transaction?.reference) === requestedReference
  ));
  if (exactMatches.length) return { transaction: exactMatches[0], ambiguous: exactMatches.length > 1 };
  const numericReference = /^\d+$/.test(requestedReference)
    ? requestedReference.replace(/^0+(?=\d)/, '')
    : '';
  if (!numericReference) return null;
  const numericMatches = incoming.filter((transaction) => {
    const normalized = normalizeGcashReference(transaction?.reference);
    return /^\d+$/.test(normalized)
      && normalized.replace(/^0+(?=\d)/, '') === numericReference;
  });
  if (!numericMatches.length) return null;
  const distinctReferences = new Set(
    numericMatches.map((transaction) => normalizeGcashReference(transaction?.reference)).filter(Boolean)
  );
  return { transaction: numericMatches[0], ambiguous: distinctReferences.size > 1 };
};
const roundMoney = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(2));
};
const normalizeAccountNumber = (value) => cleanText(value, 24).toUpperCase().replace(/\s+/g, '');
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const normalizeIsoTimestamp = (value) => {
  const candidate = cleanText(value, 40);
  if (!candidate || Number.isNaN(Date.parse(candidate))) return '';
  return candidate;
};
const normalizePositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const parseMapPinCoordinates = (value) => {
  const raw = cleanText(value, 120);
  if (!raw) return null;

  const decimalMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (decimalMatch) {
    const latitude = Number(decimalMatch[1]);
    const longitude = Number(decimalMatch[2]);
    if (
      Number.isFinite(latitude)
      && latitude >= -90
      && latitude <= 90
      && Number.isFinite(longitude)
      && longitude >= -180
      && longitude <= 180
    ) {
      return { latitude, longitude };
    }
    return null;
  }

  const normalizedDms = raw
    .replace(/\u00C2(?=\u00B0)/g, '')
    .replace(/[\u00BA\u02DA]/g, '\u00B0')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D]/g, '"')
    .replace(/\uFF0C/g, ',')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasDmsMarkers = /[NSEW]/i.test(normalizedDms)
    && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
  if (!hasDmsMarkers) return null;

  const parseDmsSegment = (segment) => {
    const text = String(segment || '').trim().toUpperCase();
    const hemisphere = text.match(/[NSEW]/)?.[0] || '';
    if (!hemisphere) return null;
    const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (!numericParts.length || numericParts.length > 3) return null;
    const degrees = Number(numericParts[0]);
    const minutes = Number(numericParts[1] || 0);
    const seconds = Number(numericParts[2] || 0);
    if (
      !Number.isFinite(degrees)
      || !Number.isFinite(minutes)
      || !Number.isFinite(seconds)
      || minutes < 0
      || minutes >= 60
      || seconds < 0
      || seconds >= 60
    ) return null;
    let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
    if (hemisphere === 'S' || hemisphere === 'W') decimal *= -1;
    return { value: decimal, hemisphere };
  };

  const segments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
  const parsedSegments = segments.map(parseDmsSegment).filter(Boolean);
  const latitude = parsedSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S')?.value;
  const longitude = parsedSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W')?.value;
  if (
    !Number.isFinite(latitude)
    || latitude < -90
    || latitude > 90
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
  ) return null;
  return { latitude, longitude };
};
const normalizeMapPin = (value, { strict = false } = {}) => {
  const raw = cleanText(value, 120);
  if (!raw) return '';
  const coordinates = parseMapPinCoordinates(raw);
  if (!coordinates) {
    if (strict) {
      throw new WorkspaceValidationError(
        'Coordinates must contain a valid latitude and longitude in decimal or DMS format.'
      );
    }
    return '';
  }
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
};
const todayIso = () => formatManilaDate(new Date()) || new Date().toISOString().slice(0, 10);
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
    firstName: normalizeCustomerName(raw.firstName, 80),
    lastName: normalizeCustomerName(raw.lastName, 80),
    contactNumber: cleanText(raw.contactNumber, 40),
    email: cleanText(raw.email, 160),
    address: cleanText(raw.address, 300),
    mapPin: normalizeMapPin(raw.mapPin || raw.coordinates),
    networkBranchId: normalizePositiveInteger(raw.networkBranchId),
    napId: cleanText(raw.napId, 80),
    napCode: cleanText(raw.napCode, 80).toUpperCase(),
    napPort: normalizePositiveInteger(raw.napPort),
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
  const source = cleanText(raw.source, 40).toLowerCase();
  const reference = cleanText(raw.reference, 120);
  return {
    id: cleanText(raw.id, 80),
    receiptNumber: cleanText(raw.receiptNumber, 40).toUpperCase(),
    accountNumber: normalizeAccountNumber(raw.accountNumber),
    kind: PAYMENT_KINDS.has(kind) ? kind : 'payment',
    amount: Math.abs(roundMoney(raw.amount)),
    date: isIsoDate(raw.date) ? String(raw.date) : todayIso(),
    paymentMethod: cleanText(raw.paymentMethod, 80),
    reference,
    description: cleanText(raw.description, 500),
    recordedBy: cleanText(raw.recordedBy, 120),
    systemGenerated: raw.systemGenerated === true,
    cycleKey: cleanText(raw.cycleKey, 80),
    billingMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(cleanText(raw.billingMonth, 7))
      ? cleanText(raw.billingMonth, 7)
      : (isIsoDate(raw.date) ? String(raw.date).slice(0, 7) : ''),
    source,
    sourceBranchId: normalizePositiveInteger(raw.sourceBranchId),
    sourceGroupId: cleanText(raw.sourceGroupId, 80),
    sourceAllocationId: cleanText(raw.sourceAllocationId, 80),
    officialReferenceKey: normalizeGcashReference(raw.officialReferenceKey || (
      source === OFFICIAL_GCASH_SOURCE ? reference : ''
    )),
    paymentReceivedAt: normalizeIsoTimestamp(raw.paymentReceivedAt),
    createdAt,
    updatedAt: cleanText(raw.updatedAt, 40) || createdAt
  };
}

const isOfficialGcashPayment = (payment) => (
  cleanText(payment?.source, 40).toLowerCase() === OFFICIAL_GCASH_SOURCE
);

const buildOfficialGcashGroupId = (branchId, referenceKey) => (
  `temp-gcash-${crypto.createHash('sha256')
    .update(`${branchId}:${referenceKey}`)
    .digest('hex')
    .slice(0, 40)}`
);

const buildOfficialGcashAllocationId = (branchId, referenceKey, accountNumber) => (
  `temp-gcash-entry-${crypto.createHash('sha256')
    .update(`${branchId}:${referenceKey}:${accountNumber}`)
    .digest('hex')
    .slice(0, 47)}`
);

const createCodedValidationError = (message, statusCode, code, details = {}) => {
  const error = new WorkspaceValidationError(message, statusCode);
  error.code = code;
  Object.assign(error, details);
  return error;
};

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
  const transactionCounts = new Map();
  const receivedPaymentCounts = new Map();

  workspace.payments.forEach((payment) => {
    paymentTotals.set(
      payment.accountNumber,
      roundMoney((paymentTotals.get(payment.accountNumber) || 0) + paymentBalanceImpact(payment))
    );
    transactionCounts.set(payment.accountNumber, (transactionCounts.get(payment.accountNumber) || 0) + 1);
    if (payment.kind === 'payment') {
      receivedPaymentCounts.set(
        payment.accountNumber,
        (receivedPaymentCounts.get(payment.accountNumber) || 0) + 1
      );
    }
  });

  const customers = workspace.customers
    .map((customer) => ({
      ...customer,
      fullName: `${customer.firstName} ${customer.lastName}`.trim(),
      balance: roundMoney(customer.openingBalance + (paymentTotals.get(customer.accountNumber) || 0)),
      transactionCount: transactionCounts.get(customer.accountNumber) || 0,
      paymentCount: receivedPaymentCounts.get(customer.accountNumber) || 0
    }))
    .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName));
  const customerNames = new Map(customers.map((customer) => [customer.accountNumber, customer.fullName]));
  const payments = workspace.payments
    .map((payment) => ({
      ...payment,
      customerName: customerNames.get(payment.accountNumber) || payment.accountNumber,
      balanceImpact: paymentBalanceImpact(payment),
      officialGcash: isOfficialGcashPayment(payment),
      immutable: payment.systemGenerated || isOfficialGcashPayment(payment)
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
      receivedPaymentCount: payments.filter((payment) => payment.kind === 'payment').length,
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
  customer.mapPin = normalizeMapPin(payload?.mapPin || payload?.coordinates, { strict: true });
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
  const hasNapSelection = Boolean(customer.napId || customer.napPort || customer.networkBranchId);
  if (hasNapSelection && (!customer.napId || !customer.napPort || !customer.networkBranchId)) {
    throw new WorkspaceValidationError('Select both a NAP Pin and an available NAP port.');
  }
  if (hasNapSelection && !customer.mapPin) {
    throw new WorkspaceValidationError('Coordinates are required before assigning a NAP Pin.');
  }
  if (!hasNapSelection) {
    customer.networkBranchId = null;
    customer.napId = '';
    customer.napCode = '';
    customer.napPort = null;
  }
  return customer;
}

const findTempNapPortConflict = (customers, candidate, excludedAccountNumber = '') => (
  (Array.isArray(customers) ? customers : []).find((customer) => (
    customer.accountNumber !== excludedAccountNumber
    && candidate.networkBranchId
    && customer.networkBranchId === candidate.networkBranchId
    && (
      customer.napId === candidate.napId
      || (customer.napCode && candidate.napCode && customer.napCode === candidate.napCode)
    )
    && customer.napPort === candidate.napPort
  )) || null
);

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

const isGcashPaymentMethod = (payment) => (
  cleanText(payment?.paymentMethod, 80).toLowerCase() === 'gcash'
);

const officialPaymentSignature = (payment) => [
  cleanText(payment?.id, 80),
  cleanText(payment?.receiptNumber, 40).toUpperCase(),
  normalizeAccountNumber(payment?.accountNumber),
  cleanText(payment?.kind, 20).toLowerCase(),
  roundMoney(payment?.amount),
  cleanText(payment?.date, 20),
  cleanText(payment?.paymentMethod, 80),
  cleanText(payment?.reference, 120),
  cleanText(payment?.description, 500),
  cleanText(payment?.recordedBy, 120),
  payment?.systemGenerated === true ? '1' : '0',
  cleanText(payment?.cycleKey, 80),
  cleanText(payment?.billingMonth, 7),
  cleanText(payment?.source, 40).toLowerCase(),
  normalizePositiveInteger(payment?.sourceBranchId) || '',
  cleanText(payment?.sourceGroupId, 80),
  cleanText(payment?.sourceAllocationId, 80),
  normalizeGcashReference(payment?.officialReferenceKey),
  normalizeIsoTimestamp(payment?.paymentReceivedAt),
  cleanText(payment?.createdAt, 40),
  cleanText(payment?.updatedAt, 40)
].join('|');

const legacyGcashPaymentSignature = (payment) => [
  cleanText(payment?.id, 80),
  cleanText(payment?.receiptNumber, 40).toUpperCase(),
  normalizeAccountNumber(payment?.accountNumber),
  cleanText(payment?.kind, 20).toLowerCase(),
  roundMoney(payment?.amount),
  cleanText(payment?.date, 20),
  cleanText(payment?.paymentMethod, 80),
  cleanText(payment?.reference, 120),
  cleanText(payment?.description, 500),
  cleanText(payment?.recordedBy, 120),
  payment?.systemGenerated === true ? '1' : '0',
  cleanText(payment?.cycleKey, 80),
  cleanText(payment?.billingMonth, 7),
  cleanText(payment?.createdAt, 40),
  cleanText(payment?.updatedAt, 40)
].join('|');

const findProtectedGcashReferencePayment = (payments, candidate, excludedPaymentId = '') => {
  if (candidate?.kind === 'charge' || !normalizeGcashReference(candidate?.reference)) return null;
  const excludedId = cleanText(excludedPaymentId, 80);
  return (Array.isArray(payments) ? payments : []).find((payment) => (
    payment.id !== excludedId
    && (isOfficialGcashPayment(payment) || isGcashPaymentMethod(payment))
    && gcashReferencesMatch(payment.reference, candidate.reference)
  )) || null;
};

const allocationSignature = (allocations = []) => allocations
  .map((allocation) => [
    normalizeAccountNumber(allocation?.accountNumber),
    roundMoney(allocation?.amount, Number.NaN),
    cleanText(allocation?.billingMonth, 7)
  ].join('|'))
  .sort()
  .join('||');

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

    async getPaymentReceipt(paymentId) {
      const id = cleanText(paymentId, 80);
      const snapshot = buildWorkspaceSnapshot(await synchronizeBillingCycles());
      const payment = snapshot.payments.find((item) => item.id === id);
      if (!payment || payment.kind !== 'payment') {
        throw new WorkspaceValidationError('Temp payment receipt was not found.', 404);
      }
      const customer = snapshot.customers.find((item) => item.accountNumber === payment.accountNumber);
      if (!customer) throw new WorkspaceValidationError('Temp customer was not found.', 404);
      return {
        ok: true,
        receipt: {
          workspaceName: snapshot.workspace.locationName,
          receiptNumber: payment.receiptNumber,
          paymentId: payment.id,
          accountNumber: payment.accountNumber,
          customerName: customer.fullName,
          address: customer.address,
          contactNumber: customer.contactNumber,
          amount: payment.amount,
          date: payment.date,
          billingMonth: payment.billingMonth || payment.date.slice(0, 7),
          paymentMethod: payment.paymentMethod,
          reference: payment.reference,
          description: payment.description,
          recordedBy: payment.recordedBy,
          officialGcash: payment.officialGcash,
          createdAt: payment.createdAt
        }
      };
    },

    async findGcashReferencePayments({ reference, date } = {}) {
      const referenceKey = normalizeGcashReference(reference);
      const paymentDate = cleanText(date, 20);
      if (!referenceKey) throw new WorkspaceValidationError('GCash reference number is required.');
      if (paymentDate && !isIsoDate(paymentDate)) {
        throw new WorkspaceValidationError('GCash payment date must use YYYY-MM-DD.');
      }
      const snapshot = buildWorkspaceSnapshot(await readWorkspace());
      return snapshot.payments.filter((payment) => (
        payment.kind === 'payment'
        && gcashReferencesMatch(payment.reference, referenceKey)
        && (!paymentDate || payment.date === paymentDate)
      ));
    },

    async recordImportedGcashPayments({
      branchId,
      reference,
      date,
      paymentReceivedAt,
      officialAmount,
      allocationAmount,
      allocations,
      recordedBy
    } = {}) {
      const sourceBranchId = normalizePositiveInteger(branchId);
      const referenceValue = cleanText(reference, 120).toUpperCase();
      const referenceKey = normalizeGcashReference(referenceValue);
      const paymentDate = cleanText(date, 20);
      const receivedAt = normalizeIsoTimestamp(paymentReceivedAt);
      const sourceAllocations = Array.isArray(allocations) ? allocations : [];
      const creditedAmount = roundMoney(officialAmount, Number.NaN);
      const requiredAllocationAmount = allocationAmount == null
        ? creditedAmount
        : roundMoney(allocationAmount, Number.NaN);
      if (!sourceBranchId) throw new WorkspaceValidationError('Branch ID is required.');
      if (!referenceKey) throw new WorkspaceValidationError('GCash reference number is required.');
      if (!isIsoDate(paymentDate)) throw new WorkspaceValidationError('GCash payment date must use YYYY-MM-DD.');
      if (paymentReceivedAt && !receivedAt) {
        throw new WorkspaceValidationError('GCash received timestamp is invalid.');
      }
      if (!Number.isFinite(creditedAmount) || creditedAmount <= 0) {
        throw new WorkspaceValidationError('The imported GCash credit amount is invalid.');
      }
      if (
        !Number.isFinite(requiredAllocationAmount)
        || requiredAllocationAmount <= 0
        || requiredAllocationAmount > creditedAmount
      ) {
        throw new WorkspaceValidationError('The Temp portion of the imported GCash credit is invalid.');
      }
      if (sourceAllocations.length < 1 || sourceAllocations.length > 3) {
        throw new WorkspaceValidationError('Provide one to three Temp GCash allocations.');
      }
      const billingMonth = paymentDate.slice(0, 7);
      const safeAllocations = sourceAllocations.map((allocation) => ({
        accountNumber: normalizeAccountNumber(allocation?.accountNumber),
        amount: roundMoney(allocation?.amount, Number.NaN),
        billingMonth,
        description: cleanText(allocation?.description, 500)
      }));
      if (safeAllocations.some((allocation) => (
        !allocation.accountNumber
        || !Number.isFinite(allocation.amount)
        || allocation.amount <= 0
      ))) {
        throw new WorkspaceValidationError('Every Temp GCash allocation requires an account and amount greater than zero.');
      }
      if (new Set(safeAllocations.map((allocation) => allocation.accountNumber)).size !== safeAllocations.length) {
        throw new WorkspaceValidationError('Each Temp GCash allocation must use a different customer account.');
      }
      if (safeAllocations.some((allocation) => allocation.accountNumber.length > 20)) {
        throw createCodedValidationError(
          'Official GCash posting supports Temp account numbers up to 20 characters.',
          409,
          'TEMP_GCASH_ACCOUNT_NUMBER_TOO_LONG'
        );
      }
      const allocatedTotal = roundMoney(
        safeAllocations.reduce((total, allocation) => total + allocation.amount, 0)
      );
      if (allocatedTotal !== requiredAllocationAmount) {
        throw createCodedValidationError(
          'Temp allocations must equal the exact Temp portion of the imported GCash credit.',
          409,
          'TEMP_GCASH_TOTAL_MISMATCH',
          { officialAmount: requiredAllocationAmount, allocatedTotal }
        );
      }
      safeAllocations.sort((left, right) => left.accountNumber.localeCompare(right.accountNumber));

      const sourceGroupId = buildOfficialGcashGroupId(sourceBranchId, referenceKey);
      const actor = cleanText(recordedBy?.name || recordedBy?.username || recordedBy, 120) || 'Admin';
      const expected = safeAllocations.map((allocation, index) => ({
        ...allocation,
        sourceAllocationId: buildOfficialGcashAllocationId(
          sourceBranchId,
          referenceKey,
          allocation.accountNumber
        ),
        description: allocation.description
          || `Official imported GCash allocation ${index + 1} of ${safeAllocations.length}`
      }));

      const result = await mutateWorkspace(async (workspace) => {
        const customerByAccount = new Map(
          workspace.customers.map((customer) => [customer.accountNumber, customer])
        );
        const missing = expected.find((allocation) => !customerByAccount.has(allocation.accountNumber));
        if (missing) {
          throw createCodedValidationError(
            `Temp customer ${missing.accountNumber} was not found.`,
            404,
            'TEMP_GCASH_CUSTOMER_NOT_FOUND',
            { accountNumber: missing.accountNumber }
          );
        }

        const referenceRows = workspace.payments.filter((payment) => (
          payment.kind === 'payment'
          && gcashReferencesMatch(payment.reference, referenceKey)
        ));
        const officialRows = referenceRows.filter(isOfficialGcashPayment);
        const legacyRows = referenceRows.filter((payment) => !isOfficialGcashPayment(payment));
        const expectedByAccount = new Map(expected.map((allocation) => [allocation.accountNumber, allocation]));

        if (officialRows.length) {
          const exact = !legacyRows.length
            && officialRows.length === expected.length
            && officialRows.every((payment) => {
              const allocation = expectedByAccount.get(payment.accountNumber);
              return allocation
                && payment.sourceBranchId === sourceBranchId
                && payment.sourceGroupId === sourceGroupId
                && payment.sourceAllocationId === allocation.sourceAllocationId
                && payment.officialReferenceKey === referenceKey
                && payment.date === paymentDate
                && payment.billingMonth === billingMonth
                && payment.amount === allocation.amount;
            });
          if (exact) {
            return {
              ids: officialRows.map((payment) => payment.id),
              insertedCount: 0,
              adoptedCount: 0,
              sourceGroupId,
              referenceKey
            };
          }
          throw createCodedValidationError(
            'This official GCash allocation is only partially recorded or conflicts with stored Temp transactions.',
            409,
            'TEMP_GCASH_GROUP_CONFLICT',
            { sourceGroupId, referenceKey }
          );
        }

        const matchedLegacy = new Map();
        for (const payment of legacyRows) {
          const allocation = expectedByAccount.get(payment.accountNumber);
          if (
            !allocation
            || !isGcashPaymentMethod(payment)
            || payment.systemGenerated
            || payment.date !== paymentDate
            || payment.amount !== allocation.amount
            || matchedLegacy.has(payment.accountNumber)
          ) {
            throw createCodedValidationError(
              'A Temp payment already uses this GCash reference but does not exactly match the selected official allocation. Review the legacy row first.',
              409,
              'TEMP_GCASH_LEGACY_CONFLICT',
              { referenceKey, existingPaymentIds: legacyRows.map((item) => item.id) }
            );
          }
          matchedLegacy.set(payment.accountNumber, payment);
        }

        const timestamp = now();
        const ids = [];
        let adoptedCount = 0;
        let insertedCount = 0;
        expected.forEach((allocation) => {
          const legacy = matchedLegacy.get(allocation.accountNumber);
          if (legacy) {
            legacy.reference = referenceValue;
            legacy.billingMonth = billingMonth;
            legacy.source = OFFICIAL_GCASH_SOURCE;
            legacy.sourceBranchId = sourceBranchId;
            legacy.sourceGroupId = sourceGroupId;
            legacy.sourceAllocationId = allocation.sourceAllocationId;
            legacy.officialReferenceKey = referenceKey;
            legacy.paymentReceivedAt = receivedAt;
            legacy.updatedAt = timestamp;
            ids.push(legacy.id);
            adoptedCount += 1;
            return;
          }
          const payment = normalizePayment({
            id: allocation.sourceAllocationId,
            receiptNumber: nextReceiptNumber(workspace),
            accountNumber: allocation.accountNumber,
            kind: 'payment',
            amount: allocation.amount,
            date: paymentDate,
            billingMonth,
            paymentMethod: 'GCash',
            reference: referenceValue,
            description: allocation.description,
            recordedBy: actor,
            source: OFFICIAL_GCASH_SOURCE,
            sourceBranchId,
            sourceGroupId,
            sourceAllocationId: allocation.sourceAllocationId,
            officialReferenceKey: referenceKey,
            paymentReceivedAt: receivedAt,
            createdAt: timestamp,
            updatedAt: timestamp
          });
          workspace.payments.push(payment);
          ids.push(payment.id);
          insertedCount += 1;
        });
        return { ids, insertedCount, adoptedCount, sourceGroupId, referenceKey };
      });

      const snapshot = buildWorkspaceSnapshot(result.workspace);
      const paymentById = new Map(snapshot.payments.map((payment) => [payment.id, payment]));
      const entries = result.value.ids.map((id) => paymentById.get(id)).filter(Boolean);
      return {
        ok: true,
        sourceGroupId: result.value.sourceGroupId,
        submissionId: result.value.sourceGroupId,
        referenceKey: result.value.referenceKey,
        entries,
        paymentEntryIds: entries.map((entry) => entry.id),
        insertedCount: result.value.insertedCount,
        adoptedCount: result.value.adoptedCount,
        idempotent: result.value.insertedCount === 0 && result.value.adoptedCount === 0
      };
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
        const napConflict = findTempNapPortConflict(workspace.customers, customer);
        if (napConflict) {
          throw new WorkspaceValidationError(
            `That NAP port is already assigned to Temp customer ${napConflict.accountNumber}.`,
            409
          );
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
        const napConflict = findTempNapPortConflict(workspace.customers, updated, account);
        if (napConflict) {
          throw new WorkspaceValidationError(
            `That NAP port is already assigned to Temp customer ${napConflict.accountNumber}.`,
            409
          );
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
        const payment = validatePaymentInput({
          ...payload,
          source: '',
          sourceBranchId: null,
          sourceGroupId: '',
          sourceAllocationId: '',
          officialReferenceKey: '',
          paymentReceivedAt: ''
        });
        if (isGcashPaymentMethod(payment)) {
          throw createCodedValidationError(
            'Use the Imported GCash Posting tab so the official reference is claimed before posting.',
            409,
            'TEMP_GCASH_OFFICIAL_POSTING_REQUIRED'
          );
        }
        if (findProtectedGcashReferencePayment(workspace.payments, payment)) {
          throw createCodedValidationError(
            'This reference belongs to an official or legacy GCash payment. Use Imported GCash Posting or correct the existing GCash row first.',
            409,
            'TEMP_GCASH_REFERENCE_PROTECTED'
          );
        }
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
        if (existing.systemGenerated) {
          throw createCodedValidationError(
            'System-generated billing charges cannot be edited.',
            409,
            'TEMP_SYSTEM_CHARGE_IMMUTABLE'
          );
        }
        if (isOfficialGcashPayment(existing)) {
          throw createCodedValidationError(
            'Official imported GCash payments cannot be edited from the Temp ledger.',
            409,
            'TEMP_GCASH_PAYMENT_IMMUTABLE'
          );
        }
        const updated = validatePaymentInput({
          ...existing,
          ...payload,
          source: '',
          sourceBranchId: null,
          sourceGroupId: '',
          sourceAllocationId: '',
          officialReferenceKey: '',
          paymentReceivedAt: ''
        });
        if (isGcashPaymentMethod(existing) || isGcashPaymentMethod(updated)) {
          throw createCodedValidationError(
            'GCash payments cannot be edited in the ledger. Delete an unverified legacy row if necessary, then use Imported GCash Posting.',
            409,
            'TEMP_GCASH_OFFICIAL_POSTING_REQUIRED'
          );
        }
        if (findProtectedGcashReferencePayment(workspace.payments, updated, existing.id)) {
          throw createCodedValidationError(
            'This reference belongs to an official or legacy GCash payment. Use Imported GCash Posting or correct the existing GCash row first.',
            409,
            'TEMP_GCASH_REFERENCE_PROTECTED'
          );
        }
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
        if (workspace.payments[index].systemGenerated) {
          throw createCodedValidationError(
            'System-generated billing charges cannot be deleted.',
            409,
            'TEMP_SYSTEM_CHARGE_IMMUTABLE'
          );
        }
        if (isOfficialGcashPayment(workspace.payments[index])) {
          throw createCodedValidationError(
            'Official imported GCash payments cannot be deleted from the Temp ledger.',
            409,
            'TEMP_GCASH_PAYMENT_IMMUTABLE'
          );
        }
        workspace.payments.splice(index, 1);
        return id;
      });
      return { ok: true, id: result.value };
    },

    async clearAllData() {
      const result = await mutateWorkspace(async (workspace) => {
        if (workspace.payments.some(isOfficialGcashPayment)) {
          throw createCodedValidationError(
            'Official imported GCash payments are linked to the shared GCash history and prevent clearing the Temp workspace.',
            409,
            'TEMP_GCASH_WORKSPACE_CLEAR_BLOCKED'
          );
        }
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

    async replaceFromExport(payload, options = {}) {
      if (!payload || payload.kind !== EXPORT_KIND || !payload.data || typeof payload.data !== 'object') {
        throw new WorkspaceValidationError('Select a valid Temp workspace export file.');
      }
      const exportVersion = Number(payload.version ?? payload.data.schemaVersion);
      const dataSchemaVersion = Number(payload.data.schemaVersion ?? exportVersion);
      if (
        !Number.isInteger(exportVersion)
        || exportVersion < LEGACY_SCHEMA_VERSION
        || exportVersion > SCHEMA_VERSION
        || !Number.isInteger(dataSchemaVersion)
        || dataSchemaVersion < LEGACY_SCHEMA_VERSION
        || dataSchemaVersion > SCHEMA_VERSION
      ) {
        throw new WorkspaceValidationError('This Temp workspace export version is not supported.');
      }
      if (!Array.isArray(payload.data.customers) || !Array.isArray(payload.data.payments)) {
        throw new WorkspaceValidationError('The Temp export is missing customer or transaction records.');
      }

      const validatedCustomers = payload.data.customers.map((customer) => validateCustomerInput(customer));
      validatedCustomers.forEach((customer, index) => {
        const conflict = findTempNapPortConflict(validatedCustomers.slice(0, index), customer);
        if (conflict) {
          throw new WorkspaceValidationError(
            `The Temp export assigns NAP port ${customer.napPort} to both ${conflict.accountNumber} and ${customer.accountNumber}.`,
            409
          );
        }
      });
      payload.data.payments.forEach((payment) => {
        validatePaymentInput(payment);
        if (!cleanText(payment.id, 80) || !cleanText(payment.receiptNumber, 40)) {
          throw new WorkspaceValidationError('The Temp export contains an unnumbered transaction.');
        }
        const normalized = normalizePayment(payment);
        const hasOfficialMetadata = Boolean(
          normalized.sourceBranchId
          || normalized.sourceGroupId
          || normalized.sourceAllocationId
          || normalized.officialReferenceKey
          || normalized.paymentReceivedAt
        );
        if (isOfficialGcashPayment(normalized)) {
          if (
            normalized.kind !== 'payment'
            || !isGcashPaymentMethod(normalized)
            || normalized.systemGenerated
            || normalized.accountNumber.length > 20
            || !normalized.sourceBranchId
            || !normalized.sourceGroupId
            || !normalized.sourceAllocationId
            || !normalized.officialReferenceKey
            || normalized.officialReferenceKey !== normalizeGcashReference(normalized.reference)
            || normalized.sourceGroupId !== buildOfficialGcashGroupId(
              normalized.sourceBranchId,
              normalized.officialReferenceKey
            )
            || normalized.sourceAllocationId !== buildOfficialGcashAllocationId(
              normalized.sourceBranchId,
              normalized.officialReferenceKey,
              normalized.accountNumber
            )
            || normalized.billingMonth !== normalized.date.slice(0, 7)
          ) {
            throw new WorkspaceValidationError('The Temp export contains invalid official GCash transaction metadata.');
          }
        } else if (hasOfficialMetadata || normalized.source) {
          throw new WorkspaceValidationError('The Temp export contains unsupported transaction source metadata.');
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
      const uniqueReceiptNumbers = new Set(
        imported.payments.map((payment) => payment.receiptNumber.toUpperCase())
      );
      if (uniqueReceiptNumbers.size !== imported.payments.length) {
        throw new WorkspaceValidationError('The Temp export contains duplicate receipt numbers.');
      }
      const cycleKeys = imported.payments.map((payment) => payment.cycleKey).filter(Boolean);
      if (new Set(cycleKeys).size !== cycleKeys.length) {
        throw new WorkspaceValidationError('The Temp export contains duplicate billing-cycle charges.');
      }
      if (imported.payments.some((payment) => payment.systemGenerated && (
        payment.kind !== 'charge' || !payment.cycleKey
      ))) {
        throw new WorkspaceValidationError('The Temp export contains an invalid system-generated charge.');
      }

      const officialPayments = imported.payments.filter(isOfficialGcashPayment);
      const legacyGcashPayments = imported.payments.filter((payment) => (
        !isOfficialGcashPayment(payment) && isGcashPaymentMethod(payment)
      ));
      const officialLegacyReferenceConflict = legacyGcashPayments.find((legacyPayment) => (
        officialPayments.some((officialPayment) => (
          gcashReferencesMatch(officialPayment.reference, legacyPayment.reference)
        ))
      ));
      const protectedGcashPayments = [...officialPayments, ...legacyGcashPayments];
      const ordinaryReferenceConflict = imported.payments.find((payment) => (
        !isOfficialGcashPayment(payment)
        && !isGcashPaymentMethod(payment)
        && payment.kind !== 'charge'
        && normalizeGcashReference(payment.reference)
        && protectedGcashPayments.some((protectedPayment) => (
          gcashReferencesMatch(protectedPayment.reference, payment.reference)
        ))
      ));
      if (officialLegacyReferenceConflict || ordinaryReferenceConflict) {
        throw createCodedValidationError(
          'A GCash-owned reference cannot also appear as another effective Temp transaction. Reconcile legacy rows through Imported GCash Posting instead of importing a duplicate credit.',
          409,
          'TEMP_GCASH_IMPORT_REFERENCE_CONFLICT'
        );
      }
      if (typeof options.validateImportedPayments === 'function') {
        await options.validateImportedPayments(imported.payments);
      }
      const uniqueAllocationIds = new Set(
        officialPayments.map((payment) => payment.sourceAllocationId)
      );
      if (uniqueAllocationIds.size !== officialPayments.length) {
        throw new WorkspaceValidationError('The Temp export contains duplicate official GCash allocation IDs.');
      }
      const officialGroups = new Map();
      officialPayments.forEach((payment) => {
        const signature = [
          payment.sourceBranchId,
          payment.officialReferenceKey,
          payment.date,
          payment.sourceGroupId
        ].join('|');
        const group = officialGroups.get(payment.sourceGroupId) || {
          signature,
          accounts: new Set(),
          payments: []
        };
        if (group.signature !== signature || group.accounts.has(payment.accountNumber) || group.payments.length >= 3) {
          throw new WorkspaceValidationError('The Temp export contains a conflicting official GCash allocation group.');
        }
        group.accounts.add(payment.accountNumber);
        group.payments.push(payment);
        officialGroups.set(payment.sourceGroupId, group);
      });

      if (officialPayments.length && typeof options.validateOfficialPayments === 'function') {
        await options.validateOfficialPayments(officialPayments);
      }

      const result = await mutateWorkspace(async (workspace) => {
        const existingOfficialSignatures = new Set(
          workspace.payments.filter(isOfficialGcashPayment).map(officialPaymentSignature)
        );
        const importedOfficialSignatures = new Set(officialPayments.map(officialPaymentSignature));
        const removesOrChangesOfficialPayment = Array.from(existingOfficialSignatures)
          .some((signature) => !importedOfficialSignatures.has(signature));
        if (removesOrChangesOfficialPayment) {
          throw createCodedValidationError(
            'The import cannot remove or change an official GCash payment already linked to shared history.',
            409,
            'TEMP_GCASH_IMPORT_IMMUTABLE'
          );
        }
        const existingLegacyGcashSignatures = new Set(
          workspace.payments
            .filter((payment) => !isOfficialGcashPayment(payment) && isGcashPaymentMethod(payment))
            .map(legacyGcashPaymentSignature)
        );
        const importedLegacyGcashSignatures = new Set(
          legacyGcashPayments.map(legacyGcashPaymentSignature)
        );
        const changesLegacyGcashPayments = (
          existingLegacyGcashSignatures.size !== importedLegacyGcashSignatures.size
          || Array.from(existingLegacyGcashSignatures)
            .some((signature) => !importedLegacyGcashSignatures.has(signature))
        );
        if (changesLegacyGcashPayments) {
          throw createCodedValidationError(
            'Temp imports cannot add, remove, or change unverified legacy GCash rows. Reconcile them in Imported GCash Posting first.',
            409,
            'TEMP_GCASH_LEGACY_IMPORT_IMMUTABLE'
          );
        }
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
  LEGACY_SCHEMA_VERSION,
  OFFICIAL_GCASH_SOURCE,
  WorkspaceValidationError,
  createEmptyWorkspace,
  normalizeGcashReference,
  gcashReferenceKeys,
  gcashReferencesMatch,
  resolveOfficialIncomingGcashReference,
  isOfficialGcashPayment,
  buildOfficialGcashGroupId,
  buildOfficialGcashAllocationId,
  allocationSignature,
  normalizeWorkspace,
  normalizeMapPin,
  findTempNapPortConflict,
  buildWorkspaceSnapshot,
  createWorkspaceStore,
  ...defaultStore
};
