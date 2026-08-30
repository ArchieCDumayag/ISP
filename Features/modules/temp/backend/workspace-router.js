const express = require('express');
const { accountHasRole } = require('../../../../core/security/role-utils');
const {
  listGcashTransactionHistory,
  claimGcashTransactionAllocations,
  finalizeGcashTransactionAllocations,
  normalizeReference
} = require('../../billing/backend/gcash-transaction-history-store');
const {
  findMainGcashPaymentsByReference,
  paymentReferencesMatch
} = require('../../billing/backend/gcash-payment-reference-lookup');
const workspaceStore = require('./workspace-store');
const { buildMainGcashAllocationPlan } = require('./gcash-mixed-allocation');
const {
  EXCEL_MIME_TYPE,
  buildWorkspaceExcelBuffer,
  resolveCollectorReportDate,
  buildCollectorExcelBuffer,
  buildPaymentHistoryExcelBuffer,
  parseWorkspaceExcelBuffer
} = require('./workspace-excel');

const router = express.Router();
let networkStateProvider = null;

const configureNetworkStateProvider = (provider) => {
  networkStateProvider = typeof provider === 'function' ? provider : null;
};

router.use((req, res, next) => {
  if (!req.user || !accountHasRole(req.user, 'Admin')) {
    return res.status(403).json({ ok: false, error: 'Admin access required.' });
  }
  return next();
});

const manilaMonthFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit'
});
const currentManilaMonth = () => {
  const parts = Object.fromEntries(
    manilaMonthFormatter.formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}`;
};
const isMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const money = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : Number.NaN;
};
const resolveBranchId = (req) => {
  const branchId = Number(req.user?.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new workspaceStore.WorkspaceValidationError('Branch assignment is required.');
  }
  return branchId;
};
const auditActor = (user = {}) => ({
  id: String(user?.id || '').trim() || null,
  username: String(user?.username || '').trim() || null,
  name: String(user?.name || '').trim() || null
});
const actorLabel = (user = {}) => (
  String(user?.name || user?.username || '').trim() || 'Admin'
);
const createRouterError = (message, statusCode = 400, code = '') => {
  const error = new workspaceStore.WorkspaceValidationError(message, statusCode);
  if (code) error.code = code;
  return error;
};
const toPositiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const splitterCapacity = (value) => {
  const parsed = Number(String(value || '').replace('/', ':').split(':')[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16;
};
const napTotalPorts = (nap = {}) => {
  const highestAssigned = (Array.isArray(nap.connections) ? nap.connections : [])
    .reduce((highest, connection) => Math.max(highest, toPositiveInteger(connection?.port) || 0), 0);
  return Math.max(
    splitterCapacity(nap.splitter),
    toPositiveInteger(nap.capacity) || 0,
    highestAssigned,
    1
  );
};
const tempNetworkCustomer = (customer = {}) => ({
  accountNumber: String(customer.accountNumber || '').trim(),
  name: String(customer.fullName || `${customer.firstName || ''} ${customer.lastName || ''}`).trim(),
  firstName: String(customer.firstName || '').trim(),
  lastName: String(customer.lastName || '').trim(),
  area: String(customer.address || '').trim(),
  mapPin: String(customer.mapPin || '').trim(),
  coordinates: String(customer.mapPin || '').trim(),
  status: String(customer.status || 'inactive').trim().toLowerCase(),
  balance: Number(customer.balance) || 0,
  workspace: 'temp',
  readOnly: true,
  networkBranchId: toPositiveInteger(customer.networkBranchId),
  napId: String(customer.napId || '').trim(),
  napCode: String(customer.napCode || '').trim(),
  napPort: toPositiveInteger(customer.napPort)
});

const loadTempNetworkCustomers = async (branchId) => {
  const normalizedBranchId = toPositiveInteger(branchId);
  if (!normalizedBranchId) return [];
  const snapshot = await workspaceStore.getSnapshot();
  return snapshot.customers
    .filter((customer) => Number(customer.networkBranchId) === normalizedBranchId)
    .map(tempNetworkCustomer)
    .filter((customer) => customer.accountNumber);
};

const requireNetworkState = async (branchId) => {
  if (!networkStateProvider) {
    throw createRouterError('PON Management is unavailable. Try again after the server finishes loading.', 503);
  }
  return networkStateProvider(branchId);
};

const validateCustomerNetworkSelection = async (req, payload = {}) => {
  const napId = String(payload?.napId || '').trim();
  const napPort = toPositiveInteger(payload?.napPort);
  if (!napId && !napPort) {
    return {
      ...payload,
      networkBranchId: null,
      napId: '',
      napCode: '',
      napPort: null
    };
  }
  if (!napId || !napPort) {
    throw createRouterError('Select both a NAP Pin and an available NAP port.');
  }

  const branchId = resolveBranchId(req);
  const state = await requireNetworkState(branchId);
  const nap = (Array.isArray(state?.naps) ? state.naps : []).find((entry) => (
    String(entry?.id || '').trim() === napId
    || String(entry?.code || '').trim().toLowerCase() === napId.toLowerCase()
  ));
  if (!nap) throw createRouterError('The selected NAP Pin is no longer available.', 409);
  const totalPorts = napTotalPorts(nap);
  if (napPort > totalPorts) {
    throw createRouterError(`The selected NAP has only ${totalPorts} configured ports.`, 409);
  }
  const occupied = (Array.isArray(nap.connections) ? nap.connections : []).find((connection) => (
    toPositiveInteger(connection?.port) === napPort
  ));
  if (occupied) {
    const occupiedBy = String(
      occupied.customerName || occupied.customerId || occupied.customerRef || 'another customer'
    ).trim();
    throw createRouterError(`That NAP port is already assigned to ${occupiedBy}.`, 409);
  }
  return {
    ...payload,
    networkBranchId: branchId,
    napId: String(nap.id || napId).trim(),
    napCode: String(nap.code || '').trim(),
    napPort
  };
};

const rejectManualOfficialGcashReference = async (req, payload = {}, paymentId = '') => {
  let candidate = payload || {};
  if (paymentId) {
    const snapshot = await workspaceStore.getSnapshot();
    const existing = snapshot.payments.find((payment) => payment.id === String(paymentId || '').trim());
    if (existing) candidate = { ...existing, ...candidate };
  }
  const kind = String(candidate?.kind || 'payment').trim().toLowerCase();
  const reference = String(candidate?.reference || '').trim();
  if (kind === 'charge' || !reference) return;
  const branchId = resolveBranchId(req);
  const history = await listGcashTransactionHistory({ branchId, all: true });
  const match = workspaceStore.resolveOfficialIncomingGcashReference(history?.transactions, reference);
  if (!match) return;
  throw createRouterError(
    match.ambiguous
      ? 'This numeric reference matches multiple imported GCash credits. Resolve imported history before recording a Temp transaction.'
      : 'This reference belongs to an imported GCash credit. Post it from the GCash Posting tab so it cannot be paid twice.',
    409,
    match.ambiguous ? 'TEMP_GCASH_REFERENCE_AMBIGUOUS' : 'TEMP_GCASH_OFFICIAL_POSTING_REQUIRED'
  );
};

const sendError = (res, error) => {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) console.error('Temp workspace request failed:', error);
  const payload = {
    ok: false,
    error: status >= 500 ? 'Unable to update the Temp workspace.' : error.message
  };
  if (status < 500 && error?.code) payload.code = String(error.code);
  ['officialAmount', 'allocatedTotal', 'referenceKey'].forEach((field) => {
    if (status < 500 && error?.[field] !== undefined) payload[field] = error[field];
  });
  return res.status(status).json(payload);
};

const isTempGcashAssignment = (assignment) => (
  Boolean(assignment)
  && String(assignment.submissionId || '').startsWith('temp-gcash-')
);

const validateImportedOfficialPayments = async (officialPayments, branchId) => {
  const groups = new Map();
  officialPayments.forEach((payment) => {
    if (Number(payment.sourceBranchId) !== Number(branchId)) {
      throw createRouterError(
        'The Temp export contains an official GCash payment from another branch.',
        409,
        'TEMP_GCASH_IMPORT_BRANCH_MISMATCH'
      );
    }
    const rows = groups.get(payment.sourceGroupId) || [];
    rows.push(payment);
    groups.set(payment.sourceGroupId, rows);
  });
  if (!groups.size) return true;

  const history = await listGcashTransactionHistory({ branchId, all: true });
  const transactionByReference = new Map(
    history.transactions.map((transaction) => [normalizeReference(transaction.reference), transaction])
  );
  for (const [sourceGroupId, payments] of groups.entries()) {
    const referenceKey = payments[0].officialReferenceKey;
    const transaction = transactionByReference.get(referenceKey);
    const assignment = transaction?.assignment;
    if (!transaction || !isTempGcashAssignment(assignment) || assignment.submissionId !== sourceGroupId) {
      throw createRouterError(
        `Official GCash reference ${referenceKey} is not linked to this Temp workspace in shared history.`,
        409,
        'TEMP_GCASH_IMPORT_ASSIGNMENT_MISSING'
      );
    }
    const importedAllocations = payments.map((payment) => ({
      accountNumber: payment.accountNumber,
      amount: payment.amount,
      billingMonth: payment.billingMonth || payment.date.slice(0, 7)
    }));
    const importedPaymentIds = new Set(payments.map((payment) => String(payment.id || '')).filter(Boolean));
    const assignmentTempAllocations = (Array.isArray(assignment.allocations) ? assignment.allocations : [])
      .filter((allocation) => (
        String(allocation?.customerName || '').startsWith('Temp - ')
        || importedPaymentIds.has(String(allocation?.paymentEntryId || ''))
      ));
    if (workspaceStore.allocationSignature(importedAllocations)
      !== workspaceStore.allocationSignature(assignmentTempAllocations)) {
      throw createRouterError(
        `Official GCash reference ${referenceKey} does not match its shared allocation.`,
        409,
        'TEMP_GCASH_IMPORT_ASSIGNMENT_MISMATCH'
      );
    }
    const importedTotal = money(payments.reduce((total, payment) => total + Number(payment.amount || 0), 0));
    const assignedTempTotal = money(assignmentTempAllocations.reduce((total, allocation) => (
      total + Number(allocation?.amount || 0)
    ), 0));
    if (importedTotal !== assignedTempTotal || money(assignment.amount) !== money(transaction.credit)) {
      throw createRouterError(
        `Official GCash reference ${referenceKey} does not match the imported credit amount.`,
        409,
        'TEMP_GCASH_IMPORT_AMOUNT_MISMATCH'
      );
    }
    if (assignment.status === 'posted') {
      const postedIds = new Set(
        assignment.allocations.map((allocation) => String(allocation.paymentEntryId || '')).filter(Boolean)
      );
      if (payments.some((payment) => !postedIds.has(payment.id))) {
        throw createRouterError(
          `Official GCash reference ${referenceKey} has mismatched posted payment IDs.`,
          409,
          'TEMP_GCASH_IMPORT_PAYMENT_ID_MISMATCH'
        );
      }
    }
  }
  return true;
};

const validateImportedPaymentReferences = async (payments, branchId) => {
  const importedPayments = Array.isArray(payments) ? payments : [];
  const officialPayments = importedPayments.filter(workspaceStore.isOfficialGcashPayment);
  await validateImportedOfficialPayments(officialPayments, branchId);
  const ordinaryCredits = importedPayments.filter((payment) => (
    !workspaceStore.isOfficialGcashPayment(payment)
    && String(payment?.paymentMethod || '').trim().toLowerCase() !== 'gcash'
    && String(payment?.kind || '').trim().toLowerCase() !== 'charge'
    && String(payment?.reference || '').trim()
  ));
  if (!ordinaryCredits.length) return true;
  const history = await listGcashTransactionHistory({ branchId, all: true });
  const conflict = ordinaryCredits.find((payment) => (
    workspaceStore.resolveOfficialIncomingGcashReference(history?.transactions, payment.reference)
  ));
  if (conflict) {
    throw createRouterError(
      `Temp transaction ${conflict.receiptNumber || conflict.id || ''} reuses an incoming official GCash reference. Remove it and use GCash Posting instead.`,
      409,
      'TEMP_GCASH_IMPORT_OFFICIAL_REFERENCE_CONFLICT'
    );
  }
  return true;
};

router.get('/workspace', async (_req, res) => {
  try {
    return res.json(await workspaceStore.getSnapshot());
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/network-options', async (req, res) => {
  try {
    const branchId = resolveBranchId(req);
    const [state, tempCustomers] = await Promise.all([
      requireNetworkState(branchId),
      loadTempNetworkCustomers(branchId)
    ]);
    const tempAssignments = new Map();
    tempCustomers.forEach((customer) => {
      if (!customer.napId || !customer.napPort) return;
      const matchedNap = (Array.isArray(state?.naps) ? state.naps : []).find((nap) => (
        String(nap?.id || '').trim() === customer.napId
        || (
          customer.napCode
          && String(nap?.code || '').trim().toLowerCase() === customer.napCode.toLowerCase()
        )
      ));
      const resolvedNapId = String(matchedNap?.id || customer.napId).trim();
      tempAssignments.set(`${resolvedNapId}:${customer.napPort}`, customer);
    });
    const naps = (Array.isArray(state?.naps) ? state.naps : []).map((nap) => {
      const totalPorts = napTotalPorts(nap);
      const canonicalByPort = new Map(
        (Array.isArray(nap.connections) ? nap.connections : [])
          .map((connection) => [toPositiveInteger(connection?.port), connection])
          .filter(([port]) => port)
      );
      const id = String(nap?.id || '').trim();
      return {
        id,
        code: String(nap?.code || '').trim(),
        location: String(nap?.location || '').trim(),
        coordinate: String(nap?.coordinate || '').trim(),
        totalPorts,
        ports: Array.from({ length: totalPorts }, (_, index) => {
          const port = index + 1;
          const canonical = canonicalByPort.get(port) || null;
          const temp = tempAssignments.get(`${id}:${port}`) || null;
          return {
            port,
            available: !canonical && !temp,
            workspace: canonical ? 'main' : (temp ? 'temp' : ''),
            customerAccountNumber: String(
              canonical?.customerId || canonical?.customerRef || temp?.accountNumber || ''
            ).trim(),
            customerName: String(canonical?.customerName || temp?.name || '').trim()
          };
        })
      };
    });
    return res.json({ ok: true, branchId, naps, customers: tempCustomers });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/network-customers', async (req, res) => {
  try {
    const branchId = resolveBranchId(req);
    const customers = await loadTempNetworkCustomers(branchId);
    return res.json({ ok: true, customers });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/customers', async (req, res) => {
  try {
    const payload = await validateCustomerNetworkSelection(req, req.body || {});
    const customer = await workspaceStore.createCustomer(payload);
    return res.status(201).json({ ok: true, customer });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/customers/:accountNumber', async (req, res) => {
  try {
    const payload = await validateCustomerNetworkSelection(req, req.body || {});
    const customer = await workspaceStore.updateCustomer(req.params.accountNumber, payload);
    return res.json({ ok: true, customer });
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/customers/:accountNumber', async (req, res) => {
  try {
    return res.json(await workspaceStore.deleteCustomer(req.params.accountNumber));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/payments', async (req, res) => {
  try {
    await rejectManualOfficialGcashReference(req, req.body || {});
    const payment = await workspaceStore.createPayment(req.body || {}, req.user?.name || req.user?.username || 'Admin');
    return res.status(201).json({ ok: true, payment });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/payments/:paymentId/receipt', async (req, res) => {
  try {
    return res.json(await workspaceStore.getPaymentReceipt(req.params.paymentId));
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/payments/:paymentId', async (req, res) => {
  try {
    await rejectManualOfficialGcashReference(req, req.body || {}, req.params.paymentId);
    const payment = await workspaceStore.updatePayment(
      req.params.paymentId,
      req.body || {},
      req.user?.name || req.user?.username || 'Admin'
    );
    return res.json({ ok: true, payment });
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/payments/:paymentId', async (req, res) => {
  try {
    return res.json(await workspaceStore.deletePayment(req.params.paymentId));
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/workspace', async (_req, res) => {
  try {
    const snapshot = await workspaceStore.clearAllData();
    return res.json({ ...snapshot, message: 'All Temp customers and transactions were cleared.' });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/gcash', async (req, res) => {
  try {
    const branchId = resolveBranchId(req);
    const selectedMonth = String(req.query.month || currentManilaMonth()).trim();
    if (!isMonth(selectedMonth)) {
      throw new workspaceStore.WorkspaceValidationError('GCash history month must use YYYY-MM format.');
    }
    const [history, snapshot] = await Promise.all([
      listGcashTransactionHistory({ branchId, all: true }),
      workspaceStore.getSnapshot()
    ]);
    const mainPayments = await findMainGcashPaymentsByReference({
      branchId,
      references: history.transactions.map((transaction) => transaction.reference),
      includePending: true,
      includeCustomerNames: true,
      officialTransactions: history.transactions
    });
    const paymentsByReference = new Map();
    snapshot.payments.forEach((payment) => {
      if (payment.kind !== 'payment' || String(payment.paymentMethod || '').toLowerCase() !== 'gcash') return;
      workspaceStore.gcashReferenceKeys(payment.reference).forEach((referenceKey) => {
        const rows = paymentsByReference.get(referenceKey) || [];
        if (!rows.some((row) => row.id === payment.id)) rows.push(payment);
        paymentsByReference.set(referenceKey, rows);
      });
    });
    const incoming = history.transactions.filter((transaction) => (
      String(transaction.status || '').toLowerCase() === 'received'
      && Number(transaction.credit) > 0
      && !transaction.postingLock
      && (!transaction.assignment || isTempGcashAssignment(transaction.assignment))
    ));
    const availableMonths = Array.from(new Set([
      selectedMonth,
      ...incoming.map((transaction) => String(
        transaction.transactionDate || transaction.transactionAt || ''
      ).slice(0, 7)).filter(isMonth)
    ])).sort((left, right) => right.localeCompare(left));
    const transactions = incoming
      .filter((transaction) => String(
        transaction.transactionDate || transaction.transactionAt || ''
      ).slice(0, 7) === selectedMonth)
      .map((transaction) => {
        const referenceKey = workspaceStore.normalizeGcashReference(transaction.reference);
        const matchingMainPayments = mainPayments.filter((payment) => (
          paymentReferencesMatch(payment.reference, transaction.reference)
        ));
        const legacyPayments = workspaceStore.gcashReferenceKeys(referenceKey)
          .flatMap((key) => paymentsByReference.get(key) || [])
          .filter((payment, index, rows) => rows.findIndex((row) => row.id === payment.id) === index)
          .filter((payment) => !payment.officialGcash)
          .map((payment) => ({
            id: payment.id,
            receiptNumber: payment.receiptNumber,
            accountNumber: payment.accountNumber,
            customerName: payment.customerName,
            amount: payment.amount,
            date: payment.date
          }));
        const assignment = transaction.assignment || null;
        const officialAmount = money(transaction.credit);
        const transactionDate = String(transaction.transactionDate || transaction.transactionAt || '').slice(0, 10);
        const mainPlan = buildMainGcashAllocationPlan({
          mainPayments: matchingMainPayments,
          officialAmount,
          transactionDate
        });
        const state = assignment
          ? (assignment.status === 'posted' ? 'posted' : 'claimed')
          : (mainPlan.status === 'partial'
            ? 'mixed'
            : (mainPlan.status === 'complete' || mainPlan.status === 'conflict'
              ? 'conflict'
              : (legacyPayments.length ? 'reconcile' : 'available')));
        return {
          reference: transaction.reference,
          transactionAt: transaction.transactionAt,
          transactionDate: transaction.transactionDate,
          description: transaction.description,
          sender: transaction.sender,
          recipient: transaction.recipient,
          recipientLabel: transaction.recipientLabel,
          amount: officialAmount,
          state,
          assignment,
          legacyPayments,
          mainPayments: matchingMainPayments,
          mainAmount: mainPlan.mainAmount,
          remainingAmount: mainPlan.remainingAmount,
          mainPlanStatus: mainPlan.status,
          mainPlanReason: mainPlan.reason
        };
      });
    const availableRows = transactions.filter((transaction) => (
      transaction.state === 'available' || transaction.state === 'reconcile' || transaction.state === 'mixed'
    ));
    return res.json({
      ok: true,
      selectedMonth,
      availableMonths,
      summary: {
        availableCount: transactions.filter((transaction) => transaction.state === 'available').length,
        reconcileCount: transactions.filter((transaction) => transaction.state === 'reconcile').length,
        mixedCount: transactions.filter((transaction) => transaction.state === 'mixed').length,
        conflictCount: transactions.filter((transaction) => transaction.state === 'conflict').length,
        postedCount: transactions.filter((transaction) => transaction.state === 'posted').length,
        claimedCount: transactions.filter((transaction) => transaction.state === 'claimed').length,
        availableAmount: money(availableRows.reduce((total, transaction) => (
          total + (transaction.state === 'mixed' ? transaction.remainingAmount : transaction.amount)
        ), 0))
      },
      transactions
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/gcash/:reference/post', async (req, res) => {
  let claim = null;
  let recorded = null;
  let branchId = null;
  let submissionId = '';
  let reference = '';
  try {
    if (req.body?.assignmentConfirmed !== true) {
      throw createRouterError(
        'Confirm that the selected Temp customers are the correct recipients before posting.',
        400,
        'TEMP_GCASH_ASSIGNMENT_CONFIRMATION_REQUIRED'
      );
    }
    branchId = resolveBranchId(req);
    reference = normalizeReference(req.params.reference);
    if (!reference) throw new workspaceStore.WorkspaceValidationError('GCash reference number is required.');
    const [history, snapshot] = await Promise.all([
      listGcashTransactionHistory({ branchId, all: true }),
      workspaceStore.getSnapshot()
    ]);
    const transaction = history.transactions.find((row) => normalizeReference(row.reference) === reference);
    if (!transaction) {
      throw createRouterError(
        'Reference is not in the imported GCash history.',
        409,
        'TEMP_GCASH_REFERENCE_NOT_IMPORTED'
      );
    }
    if (transaction.postingLock) {
      throw createRouterError(
        'This imported GCash credit is marked Not for Posting.',
        409,
        'GCASH_TRANSACTION_POSTING_LOCKED'
      );
    }
    const officialAmount = money(transaction.credit);
    const transactionDate = String(transaction.transactionDate || transaction.transactionAt || '').slice(0, 10);
    if (
      String(transaction.status || '').toLowerCase() !== 'received'
      || !Number.isFinite(officialAmount)
      || officialAmount <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)
    ) {
      throw createRouterError(
        'Only a valid incoming imported GCash credit can be posted.',
        409,
        'TEMP_GCASH_INCOMING_CREDIT_REQUIRED'
      );
    }
    const mainPayments = await findMainGcashPaymentsByReference({
      branchId,
      reference,
      includePending: true,
      includeCustomerNames: true,
      officialTransactions: [transaction]
    });
    const mainPlan = buildMainGcashAllocationPlan({
      mainPayments,
      officialAmount,
      transactionDate
    });
    if (mainPlan.status === 'complete' || mainPlan.status === 'conflict') {
      const conflict = createRouterError(
        mainPlan.reason || 'This GCash reference cannot be split because its Main payment records conflict with the official credit.',
        409,
        'TEMP_GCASH_MAIN_PAYMENT_CONFLICT'
      );
      conflict.referenceKey = reference;
      throw conflict;
    }
    const mixedPosting = mainPlan.status === 'partial';
    const tempTargetAmount = mixedPosting ? mainPlan.remainingAmount : officialAmount;
    const maxTempAllocations = 3 - mainPlan.allocations.length;
    if (mixedPosting && maxTempAllocations < 1) {
      throw createRouterError(
        'The Main portion already uses all three allocation slots, so no Temp allocation can be added.',
        409,
        'TEMP_GCASH_MIXED_ALLOCATION_LIMIT'
      );
    }
    submissionId = workspaceStore.buildOfficialGcashGroupId(branchId, reference);
    if (transaction.assignment && (
      !isTempGcashAssignment(transaction.assignment)
      || transaction.assignment.submissionId !== submissionId
    )) {
      throw createRouterError(
        'This GCash reference is already assigned outside the Temp workspace.',
        409,
        'GCASH_TRANSACTION_ALREADY_ASSIGNED'
      );
    }

    const sourceAllocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    if (sourceAllocations.length < 1 || sourceAllocations.length > maxTempAllocations) {
      throw new workspaceStore.WorkspaceValidationError(
        mixedPosting
          ? `Provide one to ${maxTempAllocations} Temp allocation${maxTempAllocations === 1 ? '' : 's'} for the remaining amount.`
          : 'Provide one to three Temp GCash allocations.'
      );
    }
    const customerByAccount = new Map(snapshot.customers.map((customer) => [customer.accountNumber, customer]));
    const billingMonth = transactionDate.slice(0, 7);
    const allocations = sourceAllocations.map((allocation) => {
      const accountNumber = String(allocation?.accountNumber || '').trim().toUpperCase();
      const amount = money(allocation?.amount);
      const customer = customerByAccount.get(accountNumber);
      if (!customer) {
        throw createRouterError(
          `Temp customer ${accountNumber || '(missing)'} was not found.`,
          404,
          'TEMP_GCASH_CUSTOMER_NOT_FOUND'
        );
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new workspaceStore.WorkspaceValidationError('Every allocation amount must be greater than zero.');
      }
      if (accountNumber.length > 20) {
        throw createRouterError(
          'Official GCash posting supports Temp account numbers up to 20 characters.',
          409,
          'TEMP_GCASH_ACCOUNT_NUMBER_TOO_LONG'
        );
      }
      return {
        accountNumber,
        customerName: `Temp - ${customer.fullName}`.slice(0, 200),
        amount,
        billingMonth
      };
    });
    if (new Set(allocations.map((allocation) => allocation.accountNumber)).size !== allocations.length) {
      throw new workspaceStore.WorkspaceValidationError('Each allocation must use a different Temp customer.');
    }
    const allocatedTotal = money(allocations.reduce((total, allocation) => total + allocation.amount, 0));
    if (allocatedTotal !== tempTargetAmount) {
      const mismatch = createRouterError(
        mixedPosting
          ? 'Temp allocations must equal the exact amount remaining after the Main payment.'
          : 'Temp allocations must equal the exact imported GCash credit amount.',
        409,
        'TEMP_GCASH_TOTAL_MISMATCH'
      );
      mismatch.officialAmount = tempTargetAmount;
      mismatch.allocatedTotal = allocatedTotal;
      throw mismatch;
    }

    const combinedAllocations = [...mainPlan.allocations, ...allocations];
    if (new Set(combinedAllocations.map((allocation) => allocation.accountNumber)).size !== combinedAllocations.length) {
      throw createRouterError(
        'A Main and Temp allocation cannot use the same account number.',
        409,
        'TEMP_GCASH_MIXED_ACCOUNT_CONFLICT'
      );
    }

    const allocationByAccount = new Map(
      allocations.map((allocation) => [allocation.accountNumber, allocation])
    );
    const legacyReferencePayments = snapshot.payments.filter((payment) => (
      payment.kind === 'payment'
      && !payment.officialGcash
      && paymentReferencesMatch(payment.reference, reference)
    ));
    const seenLegacyAccounts = new Set();
    const incompatibleLegacyPayment = legacyReferencePayments.find((payment) => {
      const allocation = allocationByAccount.get(payment.accountNumber);
      const isCompatible = (
        allocation
        && String(payment.paymentMethod || '').trim().toLowerCase() === 'gcash'
        && payment.date === transactionDate
        && money(payment.amount) === allocation.amount
        && !seenLegacyAccounts.has(payment.accountNumber)
      );
      if (isCompatible) seenLegacyAccounts.add(payment.accountNumber);
      return !isCompatible;
    });
    if (incompatibleLegacyPayment) {
      throw createRouterError(
        'A Temp payment already uses this GCash reference but does not exactly match the official credit allocation. Delete the incorrect legacy row before posting.',
        409,
        'TEMP_GCASH_LEGACY_CONFLICT'
      );
    }

    claim = await claimGcashTransactionAllocations({
      branchId,
      reference,
      submissionId,
      allocations: combinedAllocations,
      amount: officialAmount,
      paymentDate: transactionDate,
      claimedBy: auditActor(req.user)
    });

    recorded = await workspaceStore.recordImportedGcashPayments({
      branchId,
      reference,
      date: transactionDate,
      paymentReceivedAt: transaction.transactionAt,
      officialAmount,
      allocationAmount: tempTargetAmount,
      allocations,
      recordedBy: actorLabel(req.user)
    });

    let finalized;
    try {
      finalized = await finalizeGcashTransactionAllocations({
        branchId,
        reference,
        submissionId,
        paymentEntries: [
          ...mainPlan.allocations.map((allocation) => ({
            accountNumber: allocation.accountNumber,
            billingMonth: allocation.billingMonth,
            paymentEntryId: allocation.paymentEntryId
          })),
          ...recorded.entries.map((payment) => ({
            accountNumber: payment.accountNumber,
            billingMonth: payment.billingMonth || transactionDate.slice(0, 7),
            paymentEntryId: payment.id
          }))
        ]
      });
    } catch (_error) {
      throw createRouterError(
        'The Temp payments were saved and the GCash reference remains reserved. Retry the same posting to finish verification.',
        409,
        'TEMP_GCASH_FINALIZATION_PENDING'
      );
    }

    const adoptedMessage = recorded.adoptedCount
      ? ` ${recorded.adoptedCount} matching legacy Temp payment${recorded.adoptedCount === 1 ? '' : 's'} adopted without duplication.`
      : '';
    return res.json({
      ok: true,
      message: mixedPosting
        ? `Main payment ${mainPlan.mainAmount.toFixed(2)} was linked and the remaining ${tempTargetAmount.toFixed(2)} was posted to ${recorded.entries.length} Temp account${recorded.entries.length === 1 ? '' : 's'} without duplicating the Main payment.${adoptedMessage}`
        : `Official GCash credit posted to ${recorded.entries.length} Temp account${recorded.entries.length === 1 ? '' : 's'}.${adoptedMessage}`,
      idempotent: Boolean(claim?.idempotent && recorded.idempotent),
      mixed: mixedPosting,
      adoptedCount: recorded.adoptedCount,
      payments: recorded.entries,
      assignment: finalized.assignment,
      transaction: finalized.transaction
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/collector-export', async (req, res) => {
  try {
    const payload = await workspaceStore.createExport();
    const reportDate = resolveCollectorReportDate(payload, req.query.date);
    const workbook = buildCollectorExcelBuffer(payload, { reportDate });
    res.set('Content-Type', EXCEL_MIME_TYPE);
    res.set('Content-Disposition', `attachment; filename="temp-collector-${reportDate.slice(0, 7)}.xlsx"`);
    res.set('Content-Length', String(workbook.length));
    return res.send(workbook);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/payment-history-export', async (req, res) => {
  try {
    const month = String(req.query.month || currentManilaMonth()).trim();
    if (!isMonth(month)) {
      throw new workspaceStore.WorkspaceValidationError('Payment-history month must use YYYY-MM format.');
    }
    const payload = await workspaceStore.createExport();
    const workbook = buildPaymentHistoryExcelBuffer(payload, { month });
    res.set('Content-Type', EXCEL_MIME_TYPE);
    res.set('Content-Disposition', `attachment; filename="temp-payment-history-${month}.xlsx"`);
    res.set('Content-Length', String(workbook.length));
    return res.send(workbook);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/export', async (req, res) => {
  try {
    const payload = await workspaceStore.createExport();
    const date = payload.exportedAt.slice(0, 10);
    const format = String(req.query.format || 'json').trim().toLowerCase();
    if (format === 'xlsx' || format === 'excel') {
      const workbook = buildWorkspaceExcelBuffer(payload);
      res.set('Content-Type', EXCEL_MIME_TYPE);
      res.set('Content-Disposition', `attachment; filename="temp-workspace-${date}.xlsx"`);
      res.set('Content-Length', String(workbook.length));
      return res.send(workbook);
    }
    if (format !== 'json') {
      throw new workspaceStore.WorkspaceValidationError('Export format must be JSON or Excel.');
    }
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="temp-workspace-${date}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return sendError(res, error);
  }
});

const importedSnapshotResponse = (res, snapshot) => res.json({
  ...snapshot,
  message: `Imported ${snapshot.summary.customerCount} Temp customers and ${snapshot.summary.paymentCount} transactions.`
});

router.post('/import', async (req, res) => {
  try {
    const branchId = resolveBranchId(req);
    const snapshot = await workspaceStore.replaceFromExport(req.body || {}, {
      validateImportedPayments: (payments) => validateImportedPaymentReferences(payments, branchId)
    });
    return importedSnapshotResponse(res, snapshot);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/import-file', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new workspaceStore.WorkspaceValidationError('Select a JSON or Excel Temp workspace export file.');
    }
    let filename = String(req.get('X-Import-Filename') || '').trim();
    try {
      filename = decodeURIComponent(filename);
    } catch (_error) {
      throw new workspaceStore.WorkspaceValidationError('The import filename is invalid.');
    }
    const extension = filename.toLowerCase().match(/\.(json|xlsx|xls)$/)?.[1] || '';
    let payload;
    if (extension === 'json') {
      try {
        payload = JSON.parse(req.body.toString('utf8').replace(/^\uFEFF/, ''));
      } catch (_error) {
        throw new workspaceStore.WorkspaceValidationError('Select a valid Temp workspace JSON export file.');
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      payload = parseWorkspaceExcelBuffer(req.body);
    } else {
      throw new workspaceStore.WorkspaceValidationError('Only exported Temp JSON, XLSX, or XLS files can be imported.');
    }
    const branchId = resolveBranchId(req);
    const snapshot = await workspaceStore.replaceFromExport(payload, {
      validateImportedPayments: (payments) => validateImportedPaymentReferences(payments, branchId)
    });
    return importedSnapshotResponse(res, snapshot);
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
module.exports.configureNetworkStateProvider = configureNetworkStateProvider;
module.exports.loadTempNetworkCustomers = loadTempNetworkCustomers;
module.exports.validateCustomerNetworkSelection = validateCustomerNetworkSelection;
