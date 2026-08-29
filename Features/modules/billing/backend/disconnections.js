const express = require('express');
const createError = require('http-errors');
const { readJson } = require('../../../../core/data/data-store');
const customersModule = require('../../customer-management/backend/customers');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { loadIntegrationSettings, saveIntegrationSettings, resolveMikrotikRouter } = require('../../admin/backend/integration-settings');
const { connectMikrotikClient } = require('../../network/backend/mikrotik-client');
const { auditMikrotikPppoeCommand } = require('../../network/backend/mikrotik-audit-log');
const { calculatePaymentBreakdownEndingBalance } = require('./payment-breakdown-balance');
const {
  buildComplimentaryAccountSummary,
  sanitizeComplimentaryPeriods
} = require('./complimentary-account');
const {
  buildReconnectionSettlement,
  getManilaDateKey,
  getPendingReconnectionSettlement,
  normalizeChargePolicy,
  normalizeDateKey
} = require('./reconnection-settlement');
const { buildReferralLedger, buildReferralDiscountMap } = require('../../customer-management/backend/referral-engine');
const { readReferralRegistry } = require('../../customer-management/backend/referral-store');
const {
  dedupePppoeAccounts,
  normalizePppoeRouterId,
  normalizePppoeUsernameKey
} = require('../../network/backend/pppoe-account-utils');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const {
  serializePaymentMutationRequest
} = require('./payment-numbering');
const {
  getActiveClosedCustomerAccount
} = require('../../customer-management/backend/closed-customer-account-store');
const {
  STATUS_PENDING,
  STATUS_KEPT_ACTIVE,
  STATUS_DISCONNECTED,
  BILLING_POLICY_STOP,
  BILLING_POLICY_CONTINUE,
  CLOSED_ACCOUNT_BALANCE_MODE_SNAPSHOT,
  normalizeBillingPolicy,
  readBranchDisconnections,
  getAccountDisconnection,
  requiresReconnectionSettlementBeforeActivation,
  resolveDisconnectedPreviousBalance,
  upsertBranchDisconnection
} = require('./disconnection-store');
const { accountHasRole } = require('../../../../core/security/role-utils');

const router = express.Router();
router.use(serializePaymentMutationRequest);
const STATUS_DISABLED = 'disabled';
const STATUS_ACTIVE = 'active';
const STATUS_MODE_AUTO = 'auto';
const STORE_KEYS = {
  paymentBreakdownAdjustments: 'payment_breakdown_adjustments'
};

const readCustomers = async (branchId = null) => {
  if (typeof customersModule.readVisibleCustomers === 'function') {
    return customersModule.readVisibleCustomers(branchId);
  }
  return customersModule.readCustomers(branchId);
};

const readWritableCustomers = async (branchId = null) => customersModule.readCustomers(branchId);
const readPayments = async (branchId = null) => customersModule.readPayments(branchId);
const readPlans = async (branchId = null) => (
  typeof customersModule.readPlans === 'function' ? customersModule.readPlans(branchId) : []
);
const writeCustomers = async (customers, branchId = null) => customersModule.writeCustomers(customers, branchId);
const readPaymentBreakdownAdjustments = async () => {
  const data = await readJson(STORE_KEYS.paymentBreakdownAdjustments, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const sanitizeText = (value) => String(value || '').trim();
const normalizeAccountNumber = (value) => sanitizeText(value);
const assertClosedAccountLifecycleInactive = async (branchId, accountNumber) => {
  const activeClosure = await getActiveClosedCustomerAccount(branchId, accountNumber);
  if (!activeClosure) return;
  const error = createError(
    409,
    'This customer account is closed. Reopen it from Customer Archive before changing billing or service status.'
  );
  error.code = 'DISCONNECTION_ACCOUNT_CLOSED';
  throw error;
};
const assertFinalClosedBalanceSettlementNotBypassed = (decision = null) => {
  if (!requiresReconnectionSettlementBeforeActivation(decision)) return;
  const error = createError(
    409,
    'This account has a Final Closed Customer Balance. Use Reconnect and confirm its Billing settlement before restoring service.'
  );
  error.code = 'DISCONNECTION_FINAL_CLOSED_BALANCE_SETTLEMENT_REQUIRED';
  throw error;
};
const branchAdjustmentKey = (branchId = null) => String(branchId || 'global');
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-\d{2}/;
const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};
const normalizeAdjustmentAmount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return roundMoney(parsed);
};
const normalizeSignedAdjustmentAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
};
const hasAdjustmentAmount = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
};
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const normalizeAdjustmentMonthKey = (value) => {
  const text = sanitizeText(value).slice(0, 160);
  const match = text.match(MONTH_KEY_RE) || text.match(DATE_PREFIX_RE);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};
const deriveDueOffset = (customer = {}) => {
  const explicit = Number(customer?.dueOffset);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  const billDate = normalizeDateKey(customer?.billDate);
  const dueDate = normalizeDateKey(customer?.dueDate);
  if (!billDate || !dueDate) return 0;
  const bill = new Date(`${billDate}T12:00:00Z`);
  const due = new Date(`${dueDate}T12:00:00Z`);
  const days = Math.round((due.getTime() - bill.getTime()) / 86400000);
  return Number.isFinite(days) && days >= 0 ? days : 0;
};
const hasGeneratedCycleForMonth = (rows = [], monthKey = '') => (
  (Array.isArray(rows) ? rows : []).some((row) => {
    if (String(row?.billingMonthKey || '') !== monthKey) return false;
    const sourceType = String(row?.sourceType || '').trim().toLowerCase();
    if (['opening', 'disconnection', 'pending-postpaid', 'complimentary', 'reconnection-opening'].includes(sourceType)) {
      return false;
    }
    return Number(row?.planAmount) > 0.005;
  })
);
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
const sanitizeMonthlyReferralAdjustments = (input = {}) => {
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
    if (!monthKey || !hasAdjustmentAmount(referralValue)) return acc;
    const referralName = sanitizeText(
      item.referralName
      || item.referredName
      || item.referralClientName
      || item.name
    ).slice(0, 160);
    const referralAccountNumber = sanitizeText(
      item.referralAccountNumber
      || item.referredAccountNumber
      || item.accountNumber
    ).slice(0, 160);
    acc[monthKey] = {
      monthKey,
      referral: normalizeAdjustmentAmount(referralValue)
    };
    if (referralName) acc[monthKey].referralName = referralName;
    if (referralAccountNumber) acc[monthKey].referralAccountNumber = referralAccountNumber;
    return acc;
  }, {});
};
const sanitizePlanChangeAdjustments = (input = []) => {
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
    const planAmount = normalizeAdjustmentAmount(value.planAmount ?? value.amount ?? value.price);
    if (!effectiveMonth || planAmount <= 0) return;
    const planCategory = sanitizeText(value.planCategory || value.category || value.planType).toLowerCase();
    const previousPlanValue = value.previousPlan && typeof value.previousPlan === 'object'
      ? value.previousPlan
      : null;
    const entry = {
      effectiveMonth,
      billingEffectiveMonth: normalizeAdjustmentMonthKey(value.billingEffectiveMonth) || effectiveMonth,
      planId: sanitizeText(value.planId || value.id).slice(0, 160),
      planName: sanitizeText(value.planName || value.name || value.label).slice(0, 160) || 'Adjusted plan',
      planAmount,
      retroactiveAdjustment: normalizeSignedAdjustmentAmount(value.retroactiveAdjustment)
    };
    if (planCategory === 'prepaid' || planCategory === 'postpaid') {
      entry.planCategory = planCategory;
    }
    if (previousPlanValue) {
      const previousPlanAmount = normalizeAdjustmentAmount(
        previousPlanValue.planAmount ?? previousPlanValue.amount ?? previousPlanValue.price
      );
      const previousPlanCategory = sanitizeText(
        previousPlanValue.planCategory || previousPlanValue.category || previousPlanValue.planType
      ).toLowerCase();
      if (previousPlanAmount > 0) {
        entry.previousPlan = {
          planId: sanitizeText(previousPlanValue.planId || previousPlanValue.id).slice(0, 160),
          planName: sanitizeText(
            previousPlanValue.planName || previousPlanValue.name || previousPlanValue.label
          ).slice(0, 160) || 'Previous plan',
          planAmount: previousPlanAmount
        };
        if (previousPlanCategory === 'prepaid' || previousPlanCategory === 'postpaid') {
          entry.previousPlan.planCategory = previousPlanCategory;
        }
      }
    }
    byMonth.set(effectiveMonth, entry);
  });
  return Array.from(byMonth.values()).sort((left, right) => (
    left.effectiveMonth.localeCompare(right.effectiveMonth)
  ));
};
const sanitizePaymentBreakdownAdjustment = (adjustment = {}) => {
  const firstBill = resolveRawFirstBillAdjustment(adjustment);
  const sanitized = {
    firstBill: {
      previousBalance: normalizeAdjustmentAmount(firstBill.previousBalance),
      advance: normalizeAdjustmentAmount(firstBill.advance)
    },
    monthlyReferrals: sanitizeMonthlyReferralAdjustments(
      adjustment?.monthlyReferrals
      || adjustment?.referralAdjustments
      || adjustment?.monthlyReferralAdjustments
    ),
    planChanges: sanitizePlanChangeAdjustments(
      adjustment?.planChanges
      || adjustment?.scheduledPlanChanges
      || adjustment?.planChangeAdjustments
    ),
    complimentaryPeriods: sanitizeComplimentaryPeriods(
      adjustment?.complimentaryPeriods
      || adjustment?.complimentaryAccountPeriods
      || adjustment?.freeAccountPeriods
    )
  };
  if (hasAdjustmentAmount(firstBill.referral)) {
    sanitized.firstBill.referral = normalizeAdjustmentAmount(firstBill.referral);
  }
  if (hasAdjustmentAmount(firstBill.due)) {
    sanitized.firstBill.due = normalizeAdjustmentAmount(firstBill.due);
  }
  const referralName = sanitizeText(
    firstBill.referralName
    || firstBill.referredName
    || firstBill.referralClientName
  );
  const referralAccountNumber = sanitizeText(
    firstBill.referralAccountNumber
    || firstBill.referredAccountNumber
  );
  if (referralName) sanitized.firstBill.referralName = referralName.slice(0, 160);
  if (referralAccountNumber) sanitized.firstBill.referralAccountNumber = referralAccountNumber.slice(0, 160);
  return sanitized;
};
const getPaymentBreakdownAdjustment = (adjustments = {}, branchId = null, accountNumber = '') => {
  const branchBucket = adjustments?.[branchAdjustmentKey(branchId)] || {};
  const raw = branchBucket?.[normalizeAccountNumber(accountNumber)] || null;
  return raw && typeof raw === 'object' ? sanitizePaymentBreakdownAdjustment(raw) : null;
};

const assertAdminUser = (req) => {
  const user = req.user || null;
  if (!user || !accountHasRole(user, 'Admin')) {
    throw createError(403, 'Admin access is required.');
  }
  return user;
};

const actorFromUser = (user = {}) => ({
  id: user.id || null,
  username: user.username || null,
  name: user.name || user.username || null
});

const getCustomerName = (customer = {}) => {
  const explicit = sanitizeText(customer.name);
  if (explicit) return explicit;
  return [customer.firstName, customer.lastName].map(sanitizeText).filter(Boolean).join(' ') || 'Unnamed customer';
};

const resolvePlanCategory = (customer = {}, plans = []) => {
  if (typeof customersModule.resolvePlanCategory === 'function') {
    return customersModule.resolvePlanCategory(customer, plans);
  }
  const explicit = sanitizeText(customer.planCategory || customer.planType).toLowerCase();
  if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
  const billing = sanitizeText(customer.planBilling).toLowerCase();
  if (billing.includes('prepaid')) return 'prepaid';
  return 'postpaid';
};

const computeBalance = (history = []) => {
  if (typeof customersModule.computePaymentSummary === 'function') {
    return roundMoney(customersModule.computePaymentSummary(Array.isArray(history) ? history : []).balance);
  }
  return 0;
};

const deriveCreditLimit = (customer = {}) => {
  const explicit = Number(customer.creditLimit);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const planAmount = Number(customer.planAmount);
  return Number.isFinite(planAmount) && planAmount > 0 ? planAmount : 0;
};

const isOverCreditLimit = ({ balance = 0, creditLimit = 0 } = {}) => {
  const currentBalance = Number(balance) || 0;
  const limit = Number(creditLimit) || 0;
  if (currentBalance <= 0.005) return false;
  if (limit <= 0) return currentBalance > 0.005;
  return currentBalance + 0.005 >= limit;
};

const getHistoryForCustomer = (payments = {}, customer = {}) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber);
  const history = accountNumber ? payments?.[accountNumber]?.history : [];
  return Array.isArray(history) ? history : [];
};

const computeEndingBalance = ({
  customer = {},
  payments = {},
  customers = [],
  adjustments = {},
  referralDiscountsByAccount = {},
  disconnections = {},
  branchId = null
} = {}) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber);
  const history = getHistoryForCustomer(payments, customer);
  const adjustment = getPaymentBreakdownAdjustment(adjustments, branchId, accountNumber);
  const record = {
    ...customer,
    history,
    referralDiscounts: Array.isArray(referralDiscountsByAccount?.[accountNumber])
      ? referralDiscountsByAccount[accountNumber]
      : (Array.isArray(customer.referralDiscounts) ? customer.referralDiscounts : []),
    disconnection: getAccountDisconnection(disconnections, accountNumber),
    paymentBreakdownAdjustment: adjustment
  };
  const breakdown = calculatePaymentBreakdownEndingBalance(record, customers);
  const endingBalance = Number(breakdown?.endingBalance);
  if (Number.isFinite(endingBalance)) {
    return {
      balance: roundMoney(endingBalance),
      rows: Array.isArray(breakdown?.rows) ? breakdown.rows.length : 0,
      billingRows: Array.isArray(breakdown?.rows) ? breakdown.rows : [],
      source: 'payment-breakdown-ending-balance'
    };
  }
  return {
    balance: computeBalance(history),
    rows: 0,
    billingRows: [],
    source: 'payment-history-summary'
  };
};

const buildSnapshot = (customer = {}, payments = {}, context = {}) => {
  const ending = computeEndingBalance({
    customer,
    payments,
    customers: context.customers,
    adjustments: context.adjustments,
    referralDiscountsByAccount: context.referralDiscountsByAccount,
    disconnections: context.disconnections,
    branchId: context.branchId
  });
  const balance = ending.balance;
  const creditLimit = deriveCreditLimit(customer);
  const adjustment = getPaymentBreakdownAdjustment(
    context.adjustments,
    context.branchId,
    customer?.accountNumber
  );
  const complimentaryAccount = buildComplimentaryAccountSummary(
    adjustment?.complimentaryPeriods || [],
    { planType: resolvePlanCategory(customer, context.plans || []) }
  );
  const overLimit = complimentaryAccount.active
    ? false
    : isOverCreditLimit({ balance, creditLimit });
  return {
    balance,
    creditLimit,
    overLimit,
    overAmount: complimentaryAccount.active ? 0 : roundMoney(Math.max(0, balance - creditLimit)),
    complimentaryAccount,
    balanceRows: ending.rows,
    billingRows: ending.billingRows,
    balanceSource: ending.source
  };
};

const buildQueueItem = ({ customer, plans, payments, decision, snapshot, context = {} }) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber);
  const itemSnapshot = snapshot || buildSnapshot(customer, payments, context);
  const status = decision?.status || (itemSnapshot.overLimit ? STATUS_PENDING : '');
  const billingPolicy = status === STATUS_DISCONNECTED
    ? (decision?.billingPolicy || BILLING_POLICY_STOP)
    : '';
  const planCategory = resolvePlanCategory(customer, plans);
  return {
    accountNumber,
    name: getCustomerName(customer),
    area: sanitizeText(customer.area),
    mobile: sanitizeText(customer.mobile || customer.mobileRaw || customer.contactNumber || customer.contact),
    planName: sanitizeText(customer.planName),
    planAmount: Number(customer.planAmount) || 0,
    planCategory,
    planBilling: sanitizeText(customer.planBilling) || 'Monthly',
    pppoeUsername: sanitizeText(customer.pppoeUsername),
    customerStatus: sanitizeText(customer.status || STATUS_ACTIVE).toLowerCase() || STATUS_ACTIVE,
    balance: itemSnapshot.balance,
    creditLimit: itemSnapshot.creditLimit,
    overAmount: itemSnapshot.overAmount,
    overLimit: itemSnapshot.overLimit,
    balanceSource: itemSnapshot.balanceSource,
    balanceRows: itemSnapshot.balanceRows,
    complimentaryAccount: itemSnapshot.complimentaryAccount,
    status,
    billingPolicy,
    hitCreditLimitAt: decision?.hitCreditLimitAt || null,
    decidedAt: decision?.decidedAt || null,
    disconnectedAt: decision?.disconnectedAt || null,
    reconnectedAt: decision?.reconnectedAt || null,
    reconnection: decision?.reconnection || null,
    updatedAt: decision?.updatedAt || null,
    notes: decision?.notes || '',
    pppoeWarning: decision?.pppoeWarning || ''
  };
};

const statusRank = (item = {}) => {
  if (item.status === STATUS_PENDING) return 0;
  if (item.status === STATUS_KEPT_ACTIVE) return 1;
  if (item.status === STATUS_DISCONNECTED) return 2;
  return 3;
};

const normalizeRouterCredentials = (raw = {}) => ({
  address: sanitizeText(raw.address || raw.host),
  username: sanitizeText(raw.username || raw.user),
  password: raw.password != null ? String(raw.password) : '',
  port: Number.isFinite(Number(raw.port)) && Number(raw.port) > 0 ? Math.trunc(Number(raw.port)) : undefined
});

const resolveCustomerRouterId = (customer = {}, settings = {}) => {
  const explicit = sanitizeText(customer.mikrotikId || customer.routerId);
  return explicit || sanitizeText(settings.mikrotikDefaultId);
};

const buildPppoeAccounts = (secrets = [], activeSessions = [], routerId = '') => {
  const activeByUser = new Map();
  (Array.isArray(activeSessions) ? activeSessions : []).forEach((session) => {
    const username = sanitizeText(session.name || session.user || session.username);
    if (username) activeByUser.set(normalizePppoeUsernameKey(username), session);
  });
  return (Array.isArray(secrets) ? secrets : []).map((secret) => {
    const username = sanitizeText(secret.name || secret.user || secret.username);
    const active = activeByUser.has(normalizePppoeUsernameKey(username));
    const disabled = sanitizeText(secret.disabled).toLowerCase() === 'true';
    return {
      username,
      name: username,
      secretId: sanitizeText(secret['.id'] || secret.id),
      routerId,
      profile: sanitizeText(secret.profile),
      disabled: disabled ? 'true' : 'false',
      status: disabled ? 'disabled' : (active ? 'online' : 'offline')
    };
  }).filter((entry) => entry.username);
};

const mergeAccountsForRouter = (settings = {}, routerId = '', routerAccounts = []) => {
  const normalizedRouterId = normalizePppoeRouterId(routerId, settings.mikrotikDefaultId || routerId);
  const existing = dedupePppoeAccounts(
    Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
    settings.mikrotikDefaultId || normalizedRouterId
  );
  const preserved = existing.filter((entry) => (
    normalizePppoeRouterId(entry.routerId, settings.mikrotikDefaultId || normalizedRouterId) !== normalizedRouterId
  ));
  const nextForRouter = dedupePppoeAccounts(routerAccounts, normalizedRouterId)
    .map((entry) => ({ ...entry, routerId: normalizedRouterId }));
  return dedupePppoeAccounts([...preserved, ...nextForRouter], settings.mikrotikDefaultId || normalizedRouterId);
};

const removeActiveSession = async (api, session = {}, username = '') => {
  const activeMenu = api.menu('/ppp active');
  const sessionId = sanitizeText(session['.id'] || session.id);
  const sessionUsername = sanitizeText(session.name || session.user || session.username || username);
  const attempts = [];
  if (sessionId) {
    attempts.push(() => activeMenu.remove(sessionId));
    attempts.push(() => activeMenu.remove({ '.id': sessionId }));
  }
  if (sessionUsername) {
    attempts.push(() => activeMenu.where('name', sessionUsername).remove());
    attempts.push(() => activeMenu.where('user', sessionUsername).remove());
  }
  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch {
      // Try the next RouterOS selector shape.
    }
  }
  return false;
};

const disableCustomerPppoe = async (customer = {}, branchId = null) => {
  const username = sanitizeText(customer.pppoeUsername);
  if (!username) {
    return { disabled: false, disconnectedSessions: 0, warning: 'Customer has no PPPoE username.' };
  }

  let settings;
  try {
    settings = await loadIntegrationSettings(branchId);
  } catch (error) {
    return { disabled: false, disconnectedSessions: 0, warning: `Unable to load MikroTik settings: ${error?.message || error}` };
  }
  if (!settings?.mikrotik?.enabled) {
    return { disabled: false, disconnectedSessions: 0, warning: 'MikroTik integration is disabled.' };
  }

  const routerId = resolveCustomerRouterId(customer, settings);
  const routerConfig = resolveMikrotikRouter(settings, routerId);
  const creds = normalizeRouterCredentials(routerConfig || {});
  if (!creds.address || !creds.username || !creds.password) {
    return { disabled: false, disconnectedSessions: 0, warning: 'Missing MikroTik router credentials.' };
  }

  let client = null;
  try {
    const connection = await connectMikrotikClient(creds, {
      keepalive: false,
      timeout: 8000,
      label: `admin-disconnect:${username}`
    });
    client = connection.client;
    const api = connection.api;
    const secretMenu = api.menu('/ppp secret');
    const secrets = await secretMenu.get().catch(() => []);
    const usernameKey = normalizePppoeUsernameKey(username);
    const matchedSecret = (Array.isArray(secrets) ? secrets : []).find((secret) => (
      normalizePppoeUsernameKey(secret.name || secret.user || secret.username) === usernameKey
    ));
    let disabled = false;
    if (matchedSecret) {
      const secretName = sanitizeText(matchedSecret.name || matchedSecret.user || username);
      const alreadyDisabled = sanitizeText(matchedSecret.disabled).toLowerCase() === 'true';
      if (!alreadyDisabled) {
        await auditMikrotikPppoeCommand({
          branchId,
          source: 'admin-disconnection-page',
          routerId,
          username: secretName,
          secretId: sanitizeText(matchedSecret['.id'] || matchedSecret.id),
          operation: 'update',
          selector: `name=${secretName}`,
          payload: { disabled: 'true' },
          reason: 'admin-approved-credit-limit-disconnection'
        });
        await secretMenu.where('name', secretName).update({ disabled: 'true' });
      }
      disabled = true;
    }

    const activeSessions = await api.menu('/ppp active').get().catch(() => []);
    let disconnectedSessions = 0;
    for (const session of Array.isArray(activeSessions) ? activeSessions : []) {
      const sessionUsername = sanitizeText(session.name || session.user || session.username);
      if (normalizePppoeUsernameKey(sessionUsername) !== usernameKey) continue;
      if (await removeActiveSession(api, session, sessionUsername)) {
        disconnectedSessions += 1;
      }
    }

    const refreshedSecrets = await secretMenu.get().catch(() => secrets);
    const refreshedActive = await api.menu('/ppp active').get().catch(() => activeSessions);
    const accounts = buildPppoeAccounts(refreshedSecrets, refreshedActive, routerId);
    const mergedAccounts = mergeAccountsForRouter(settings, routerId, accounts);
    await saveIntegrationSettings({
      ...settings,
      pppoe: { ...(settings.pppoe || {}), accounts: mergedAccounts }
    }, branchId);

    return {
      disabled,
      disconnectedSessions,
      warning: matchedSecret ? '' : `PPPoE "${username}" was not found on MikroTik.`
    };
  } catch (error) {
    return {
      disabled: false,
      disconnectedSessions: 0,
      warning: `Failed to disable PPPoE "${username}": ${error?.message || error}`
    };
  } finally {
    if (client && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }
};

const enableCustomerPppoe = async (customer = {}, branchId = null) => {
  const username = sanitizeText(customer.pppoeUsername);
  if (!username) {
    return { enabled: false, warning: 'Customer has no PPPoE username.' };
  }

  let settings;
  try {
    settings = await loadIntegrationSettings(branchId);
  } catch (error) {
    return { enabled: false, warning: `Unable to load MikroTik settings: ${error?.message || error}` };
  }
  if (!settings?.mikrotik?.enabled) {
    return { enabled: false, warning: 'MikroTik integration is disabled.' };
  }

  const routerId = resolveCustomerRouterId(customer, settings);
  const routerConfig = resolveMikrotikRouter(settings, routerId);
  const creds = normalizeRouterCredentials(routerConfig || {});
  if (!creds.address || !creds.username || !creds.password) {
    return { enabled: false, warning: 'Missing MikroTik router credentials.' };
  }

  let client = null;
  try {
    const connection = await connectMikrotikClient(creds, {
      keepalive: false,
      timeout: 8000,
      label: `admin-reconnect:${username}`
    });
    client = connection.client;
    const api = connection.api;
    const secretMenu = api.menu('/ppp secret');
    const secrets = await secretMenu.get().catch(() => []);
    const usernameKey = normalizePppoeUsernameKey(username);
    const matchedSecret = (Array.isArray(secrets) ? secrets : []).find((secret) => (
      normalizePppoeUsernameKey(secret.name || secret.user || secret.username) === usernameKey
    ));
    if (!matchedSecret) {
      return { enabled: false, warning: `PPPoE "${username}" was not found on MikroTik.` };
    }

    const secretName = sanitizeText(matchedSecret.name || matchedSecret.user || username);
    const alreadyEnabled = sanitizeText(matchedSecret.disabled).toLowerCase() !== 'true';
    if (!alreadyEnabled) {
      await auditMikrotikPppoeCommand({
        branchId,
        source: 'admin-reconnection-page',
        routerId,
        username: secretName,
        secretId: sanitizeText(matchedSecret['.id'] || matchedSecret.id),
        operation: 'update',
        selector: `name=${secretName}`,
        payload: { disabled: 'false' },
        reason: 'admin-reconnect-subscriber'
      });
      await secretMenu.where('name', secretName).update({ disabled: 'false' });
    }

    const refreshedSecrets = await secretMenu.get().catch(() => secrets);
    const refreshedActive = await api.menu('/ppp active').get().catch(() => []);
    const accounts = buildPppoeAccounts(refreshedSecrets, refreshedActive, routerId);
    const mergedAccounts = mergeAccountsForRouter(settings, routerId, accounts);
    await saveIntegrationSettings({
      ...settings,
      pppoe: { ...(settings.pppoe || {}), accounts: mergedAccounts }
    }, branchId);

    return { enabled: true, warning: '' };
  } catch (error) {
    return {
      enabled: false,
      warning: `Failed to enable PPPoE "${username}": ${error?.message || error}`
    };
  } finally {
    if (client && typeof client.close === 'function') {
      await client.close().catch(() => {});
    }
  }
};

const saveCustomerStatus = async (customer = {}, branchId = null, status = STATUS_DISABLED) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber);
  const nextCustomer = {
    ...customer,
    status,
    statusMode: STATUS_MODE_AUTO
  };
  if (await isRelationalReady()) {
    await writeCustomers([nextCustomer], nextCustomer.branchId || branchId);
    return nextCustomer;
  }
  const customers = await readWritableCustomers(branchId);
  const index = customers.findIndex((entry) => normalizeAccountNumber(entry.accountNumber) === accountNumber);
  if (index < 0) throw createError(404, 'Customer not found.');
  customers[index] = nextCustomer;
  await writeCustomers(customers, branchId);
  return nextCustomer;
};

const findCustomerOrThrow = (customers = [], accountNumber = '') => {
  const key = normalizeAccountNumber(accountNumber);
  const customer = (Array.isArray(customers) ? customers : []).find((entry) => normalizeAccountNumber(entry.accountNumber) === key);
  if (!customer) throw createError(404, 'Customer not found.');
  return customer;
};

router.get('/', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const [customers, payments, plans, decisions, adjustments, referralRegistry] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPlans(branchId),
      readBranchDisconnections(branchId),
      readPaymentBreakdownAdjustments(),
      readReferralRegistry(branchId)
    ]);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, registry: referralRegistry, now: new Date() })
    );
    const snapshotContext = { customers, plans, adjustments, disconnections: decisions, branchId, referralDiscountsByAccount };

    const items = [];
    for (const customer of Array.isArray(customers) ? customers : []) {
      const accountNumber = normalizeAccountNumber(customer.accountNumber);
      if (!accountNumber) continue;
      const decision = getAccountDisconnection(decisions, accountNumber);
      const snapshot = buildSnapshot(customer, payments, snapshotContext);
      const shouldShow =
        snapshot.overLimit
        || decision?.status === STATUS_DISCONNECTED
        || (decision?.status === STATUS_KEPT_ACTIVE && snapshot.overLimit);
      if (!shouldShow) continue;
      items.push(buildQueueItem({ customer, plans, payments, decision, snapshot, context: snapshotContext }));
    }

    items.sort((a, b) => {
      const rankDiff = statusRank(a) - statusRank(b);
      if (rankDiff) return rankDiff;
      const overDiff = (Number(b.overAmount) || 0) - (Number(a.overAmount) || 0);
      if (overDiff) return overDiff;
      return a.name.localeCompare(b.name);
    });

    const metrics = items.reduce((acc, item) => {
      acc.total += 1;
      if (item.status === STATUS_PENDING) acc.pending += 1;
      if (item.status === STATUS_KEPT_ACTIVE) acc.keptActive += 1;
      if (item.status === STATUS_DISCONNECTED) acc.disconnected += 1;
      if (item.overLimit) acc.overLimit += 1;
      acc.totalOverAmount = roundMoney(acc.totalOverAmount + (Number(item.overAmount) || 0));
      return acc;
    }, { total: 0, pending: 0, keptActive: 0, disconnected: 0, overLimit: 0, totalOverAmount: 0 });

    res.json({ ok: true, items, metrics });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to load disconnection queue.'));
  }
});

router.post('/:accountNumber/keep-active', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const accountNumber = normalizeAccountNumber(req.params.accountNumber);
    await assertClosedAccountLifecycleInactive(branchId, accountNumber);
    const [customers, payments, adjustments, referralRegistry, decisions] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPaymentBreakdownAdjustments(),
      readReferralRegistry(branchId),
      readBranchDisconnections(branchId)
    ]);
    assertFinalClosedBalanceSettlementNotBypassed(getAccountDisconnection(decisions, accountNumber));
    const customer = findCustomerOrThrow(customers, accountNumber);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, registry: referralRegistry, now: new Date() })
    );
    const snapshot = buildSnapshot(customer, payments, { customers, adjustments, branchId, referralDiscountsByAccount });
    const now = new Date().toISOString();
    const decision = await upsertBranchDisconnection(branchId, accountNumber, {
      status: STATUS_KEPT_ACTIVE,
      billingPolicy: BILLING_POLICY_CONTINUE,
      hitCreditLimitAt: snapshot.overLimit ? now : null,
      decidedAt: now,
      notes: sanitizeText(req.body?.notes),
      balanceSnapshot: snapshot.balance,
      creditLimitSnapshot: snapshot.creditLimit,
      overAmountSnapshot: snapshot.overAmount,
      pppoeWarning: '',
      decidedBy: actorFromUser(user)
    });

    if (sanitizeText(customer.status).toLowerCase() !== STATUS_ACTIVE) {
      await saveCustomerStatus(customer, branchId, STATUS_ACTIVE);
      triggerBranchServiceRefresh(branchId, 'disconnection-keep-active');
    }

    res.json({ ok: true, decision });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to keep customer active.'));
  }
});

router.post('/:accountNumber/disconnect', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const accountNumber = normalizeAccountNumber(req.params.accountNumber);
    await assertClosedAccountLifecycleInactive(branchId, accountNumber);
    const billingPolicy = normalizeBillingPolicy(req.body?.billingPolicy, BILLING_POLICY_STOP);
    const [customers, payments, adjustments, referralRegistry] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPaymentBreakdownAdjustments(),
      readReferralRegistry(branchId)
    ]);
    const customer = findCustomerOrThrow(customers, accountNumber);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, registry: referralRegistry, now: new Date() })
    );
    const snapshot = buildSnapshot(customer, payments, { customers, adjustments, branchId, referralDiscountsByAccount });
    const pppoeResult = await disableCustomerPppoe(customer, branchId);
    const nextCustomer = await saveCustomerStatus(customer, branchId, STATUS_DISABLED);
    const now = new Date().toISOString();
    const decision = await upsertBranchDisconnection(branchId, accountNumber, {
      status: STATUS_DISCONNECTED,
      billingPolicy,
      hitCreditLimitAt: snapshot.overLimit ? now : null,
      disconnectedAt: now,
      reconnectedAt: null,
      decidedAt: now,
      notes: sanitizeText(req.body?.notes),
      balanceSnapshot: snapshot.balance,
      creditLimitSnapshot: snapshot.creditLimit,
      overAmountSnapshot: snapshot.overAmount,
      pppoeWarning: sanitizeText(pppoeResult.warning),
      decidedBy: actorFromUser(user)
    });

    triggerBranchServiceRefresh(branchId, 'admin-disconnection');
    res.json({
      ok: true,
      decision,
      customerStatus: nextCustomer.status,
      pppoe: pppoeResult,
      warning: pppoeResult.warning || undefined
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to disconnect customer.'));
  }
});

router.post('/:accountNumber/reconnect', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const accountNumber = normalizeAccountNumber(req.params.accountNumber);
    await assertClosedAccountLifecycleInactive(branchId, accountNumber);
    const [customers, payments, plans, decisions, adjustments, referralRegistry] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPlans(branchId),
      readBranchDisconnections(branchId),
      readPaymentBreakdownAdjustments(),
      readReferralRegistry(branchId)
    ]);
    const customer = findCustomerOrThrow(customers, accountNumber);
    const currentDecision = getAccountDisconnection(decisions, accountNumber);
    if (!currentDecision || currentDecision.status !== STATUS_DISCONNECTED) {
      throw createError(409, 'Subscriber is not currently disconnected.');
    }
    if (getPendingReconnectionSettlement(currentDecision)) {
      throw createError(409, 'This subscriber already has a reconnection waiting for its required payment.');
    }

    // Accounts whose billing continued have no stopped months to settle. Preserve
    // the existing cycle and use the legacy immediate service reconnection path.
    if (
      currentDecision.billingPolicy === BILLING_POLICY_CONTINUE
      && !requiresReconnectionSettlementBeforeActivation(currentDecision)
    ) {
      const pppoeResult = await enableCustomerPppoe(customer, branchId);
      const nextCustomer = await saveCustomerStatus(customer, branchId, STATUS_ACTIVE);
      const now = new Date().toISOString();
      const decision = await upsertBranchDisconnection(branchId, accountNumber, {
        status: STATUS_KEPT_ACTIVE,
        billingPolicy: BILLING_POLICY_CONTINUE,
        hitCreditLimitAt: null,
        disconnectedAt: null,
        reconnectedAt: now,
        decidedAt: now,
        notes: sanitizeText(req.body?.reason || req.body?.notes),
        closedAccountBalanceMode: null,
        closedAccountCanonicalBalanceAtClosure: null,
        finalClosedCustomerBalance: null,
        closedAccountClosureId: null,
        pppoeWarning: sanitizeText(pppoeResult.warning),
        decidedBy: actorFromUser(user)
      });
      triggerBranchServiceRefresh(branchId, 'admin-reconnection');
      return res.json({
        ok: true,
        decision,
        customerStatus: nextCustomer.status,
        pppoe: pppoeResult,
        warning: pppoeResult.warning || undefined
      });
    }

    if (req.body?.confirmed !== true) {
      throw createError(400, 'Confirm the reconnection billing settlement before saving.');
    }
    const reason = sanitizeText(req.body?.reason || req.body?.notes).slice(0, 500);
    if (reason.length < 3) {
      throw createError(400, 'Enter a reason for the reconnection audit trail.');
    }
    const effectiveDate = normalizeDateKey(req.body?.effectiveDate);
    const today = getManilaDateKey();
    if (!effectiveDate || effectiveDate !== today) {
      throw createError(400, `The reconnection date must be today (${today}) because service state changes immediately or after payment.`);
    }
    const balanceTreatment = ['keep', 'write-off', 'installment'].includes(String(req.body?.balanceTreatment || '').trim().toLowerCase())
      ? String(req.body.balanceTreatment).trim().toLowerCase()
      : 'keep';
    const chargePolicy = normalizeChargePolicy(req.body?.chargePolicy);
    const activationPolicy = String(req.body?.activationPolicy || '').trim().toLowerCase() === 'after-payment'
      ? 'after-payment'
      : 'immediate';
    const installmentMonths = Math.trunc(Number(req.body?.installmentMonths) || 0);
    if (balanceTreatment === 'installment' && (installmentMonths < 2 || installmentMonths > 24)) {
      throw createError(400, 'Choose between 2 and 24 months for the previous-balance installment.');
    }

    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, registry: referralRegistry, now: new Date() })
    );
    const snapshot = buildSnapshot(customer, payments, {
      customers,
      plans,
      decisions,
      disconnections: decisions,
      adjustments,
      branchId,
      referralDiscountsByAccount
    });
    const previousBalance = resolveDisconnectedPreviousBalance(currentDecision, snapshot.balance);
    const previousBalanceIsAuthoritative = currentDecision.closedAccountBalanceMode === CLOSED_ACCOUNT_BALANCE_MODE_SNAPSHOT;
    if (balanceTreatment === 'installment' && previousBalance <= 0.005) {
      throw createError(409, 'There is no previous balance to convert into installments.');
    }
    if (chargePolicy !== 'next-cycle' && hasGeneratedCycleForMonth(snapshot.billingRows, effectiveDate.slice(0, 7))) {
      throw createError(409, 'A regular bill already exists for this month. Choose Start on next regular cycle to avoid a duplicate reconnection charge.');
    }
    const planCategory = resolvePlanCategory(customer, plans);
    const planAmount = Number(customer.planAmount) || 0;
    if (planAmount <= 0) {
      throw createError(409, 'The subscriber must have a valid plan amount before reconnection.');
    }
    const requiredPaymentAmount = normalizeAdjustmentAmount(req.body?.requiredPaymentAmount);
    if (activationPolicy === 'after-payment' && requiredPaymentAmount <= 0) {
      throw createError(400, 'Enter the payment amount required before service activation.');
    }
    const actor = actorFromUser(user);
    const settlement = buildReconnectionSettlement({
      accountNumber,
      disconnectedAt: currentDecision.disconnectedAt || currentDecision.decidedAt,
      effectiveDate,
      planType: planCategory,
      planId: customer.planId,
      planName: customer.planName,
      planAmount,
      previousBalance,
      previousBalanceIsAuthoritative,
      balanceTreatment,
      installmentMonths,
      chargePolicy,
      activationPolicy,
      requiredPaymentAmount,
      dueOffset: deriveDueOffset(customer),
      reason,
      changedBy: actor,
      now: new Date()
    });
    if (!settlement) throw createError(500, 'Unable to build the reconnection billing settlement.');

    const updatedCustomer = {
      ...customer,
      billDate: settlement.nextRegularCycleDate,
      dueDate: settlement.nextDueDate || settlement.nextRegularCycleDate
    };
    const activateImmediately = settlement.activationPolicy === 'immediate';
    const pppoeResult = activateImmediately
      ? await enableCustomerPppoe(updatedCustomer, branchId)
      : { enabled: false, warning: '' };
    const nextCustomer = await saveCustomerStatus(
      updatedCustomer,
      branchId,
      activateImmediately ? STATUS_ACTIVE : STATUS_DISABLED
    );
    const now = new Date().toISOString();
    const reconnectionHistory = [
      ...(Array.isArray(currentDecision.reconnectionHistory) ? currentDecision.reconnectionHistory : []),
      settlement
    ];
    const decision = await upsertBranchDisconnection(branchId, accountNumber, {
      status: activateImmediately ? STATUS_KEPT_ACTIVE : STATUS_DISCONNECTED,
      billingPolicy: activateImmediately ? BILLING_POLICY_CONTINUE : BILLING_POLICY_STOP,
      hitCreditLimitAt: activateImmediately ? null : currentDecision.hitCreditLimitAt,
      disconnectedAt: activateImmediately ? null : currentDecision.disconnectedAt,
      reconnectedAt: activateImmediately ? now : null,
      decidedAt: now,
      notes: reason,
      balanceSnapshot: previousBalance,
      closedAccountBalanceMode: null,
      closedAccountCanonicalBalanceAtClosure: null,
      finalClosedCustomerBalance: null,
      closedAccountClosureId: null,
      reconnectionHistory,
      pppoeWarning: sanitizeText(pppoeResult.warning),
      decidedBy: actor
    });

    triggerBranchServiceRefresh(branchId, activateImmediately ? 'admin-reconnection' : 'admin-reconnection-pending-payment');
    res.json({
      ok: true,
      decision,
      settlement,
      customerStatus: nextCustomer.status,
      pppoe: pppoeResult,
      warning: pppoeResult.warning || undefined,
      message: activateImmediately
        ? 'Subscriber reconnected with an audited billing settlement.'
        : `Reconnection saved. Service will activate after ${requiredPaymentAmount.toFixed(2)} in new payments.`
    });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to reconnect customer.'));
  }
});

router.patch('/:accountNumber/billing-policy', async (req, res, next) => {
  try {
    const user = assertAdminUser(req);
    const branchId = user.branchId || null;
    const accountNumber = normalizeAccountNumber(req.params.accountNumber);
    await assertClosedAccountLifecycleInactive(branchId, accountNumber);
    const billingPolicy = normalizeBillingPolicy(req.body?.billingPolicy, '');
    if (![BILLING_POLICY_STOP, BILLING_POLICY_CONTINUE].includes(billingPolicy)) {
      throw createError(400, 'Choose a valid billing policy.');
    }
    const [customers, decisions] = await Promise.all([
      readCustomers(branchId),
      readBranchDisconnections(branchId)
    ]);
    findCustomerOrThrow(customers, accountNumber);
    if (billingPolicy === BILLING_POLICY_CONTINUE) {
      assertFinalClosedBalanceSettlementNotBypassed(getAccountDisconnection(decisions, accountNumber));
    }
    const now = new Date().toISOString();
    const decision = await upsertBranchDisconnection(branchId, accountNumber, {
      status: STATUS_DISCONNECTED,
      billingPolicy,
      decidedAt: now,
      notes: sanitizeText(req.body?.notes),
      decidedBy: actorFromUser(user)
    });
    triggerBranchServiceRefresh(branchId, 'disconnection-billing-policy');
    res.json({ ok: true, decision });
  } catch (error) {
    next(error?.status ? error : createError(500, 'Failed to update disconnection billing policy.'));
  }
});

module.exports = router;
