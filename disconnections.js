const express = require('express');
const createError = require('http-errors');
const { readJson } = require('./data-store');
const customersModule = require('./customers');
const { isRelationalReady } = require('./db-relational');
const { loadIntegrationSettings, saveIntegrationSettings, resolveMikrotikRouter } = require('./integration-settings');
const { connectMikrotikClient } = require('./mikrotik-client');
const { auditMikrotikPppoeCommand } = require('./mikrotik-audit-log');
const { calculatePaymentBreakdownEndingBalance } = require('./payment-breakdown-balance');
const { buildReferralLedger, buildReferralDiscountMap } = require('./referral-engine');
const {
  dedupePppoeAccounts,
  normalizePppoeRouterId,
  normalizePppoeUsernameKey
} = require('./pppoe-account-utils');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const {
  STATUS_PENDING,
  STATUS_KEPT_ACTIVE,
  STATUS_DISCONNECTED,
  BILLING_POLICY_STOP,
  BILLING_POLICY_CONTINUE,
  normalizeBillingPolicy,
  readBranchDisconnections,
  getAccountDisconnection,
  upsertBranchDisconnection
} = require('./disconnection-store');
const { accountHasRole } = require('./role-utils');

const router = express.Router();
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
    const entry = {
      effectiveMonth,
      planId: sanitizeText(value.planId || value.id).slice(0, 160),
      planName: sanitizeText(value.planName || value.name || value.label).slice(0, 160) || 'Adjusted plan',
      planAmount
    };
    if (planCategory === 'prepaid' || planCategory === 'postpaid') {
      entry.planCategory = planCategory;
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
    paymentBreakdownAdjustment: adjustment
  };
  const breakdown = calculatePaymentBreakdownEndingBalance(record, customers);
  const endingBalance = Number(breakdown?.endingBalance);
  if (Number.isFinite(endingBalance)) {
    return {
      balance: roundMoney(endingBalance),
      rows: Array.isArray(breakdown?.rows) ? breakdown.rows.length : 0,
      source: 'payment-breakdown-ending-balance'
    };
  }
  return {
    balance: computeBalance(history),
    rows: 0,
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
    branchId: context.branchId
  });
  const balance = ending.balance;
  const creditLimit = deriveCreditLimit(customer);
  const overLimit = isOverCreditLimit({ balance, creditLimit });
  return {
    balance,
    creditLimit,
    overLimit,
    overAmount: roundMoney(Math.max(0, balance - creditLimit)),
    balanceRows: ending.rows,
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
    status,
    billingPolicy,
    hitCreditLimitAt: decision?.hitCreditLimitAt || null,
    decidedAt: decision?.decidedAt || null,
    disconnectedAt: decision?.disconnectedAt || null,
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
    const [customers, payments, plans, decisions, adjustments] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPlans(branchId),
      readBranchDisconnections(branchId),
      readPaymentBreakdownAdjustments()
    ]);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, now: new Date() })
    );
    const snapshotContext = { customers, adjustments, branchId, referralDiscountsByAccount };

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
    const [customers, payments, adjustments] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPaymentBreakdownAdjustments()
    ]);
    const customer = findCustomerOrThrow(customers, accountNumber);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, now: new Date() })
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
    const billingPolicy = normalizeBillingPolicy(req.body?.billingPolicy, BILLING_POLICY_STOP);
    const [customers, payments, adjustments] = await Promise.all([
      readCustomers(branchId),
      readPayments(branchId),
      readPaymentBreakdownAdjustments()
    ]);
    const customer = findCustomerOrThrow(customers, accountNumber);
    const referralDiscountsByAccount = buildReferralDiscountMap(
      buildReferralLedger({ customers, payments, now: new Date() })
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
    const customers = await readCustomers(branchId);
    const customer = findCustomerOrThrow(customers, accountNumber);
    const pppoeResult = await enableCustomerPppoe(customer, branchId);
    const nextCustomer = await saveCustomerStatus(customer, branchId, STATUS_ACTIVE);
    const now = new Date().toISOString();
    const decision = await upsertBranchDisconnection(branchId, accountNumber, {
      status: STATUS_KEPT_ACTIVE,
      billingPolicy: BILLING_POLICY_CONTINUE,
      hitCreditLimitAt: null,
      disconnectedAt: null,
      decidedAt: now,
      notes: sanitizeText(req.body?.notes),
      pppoeWarning: sanitizeText(pppoeResult.warning),
      decidedBy: actorFromUser(user)
    });

    triggerBranchServiceRefresh(branchId, 'admin-reconnection');
    res.json({
      ok: true,
      decision,
      customerStatus: nextCustomer.status,
      pppoe: pppoeResult,
      warning: pppoeResult.warning || undefined
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
    const billingPolicy = normalizeBillingPolicy(req.body?.billingPolicy, '');
    if (![BILLING_POLICY_STOP, BILLING_POLICY_CONTINUE].includes(billingPolicy)) {
      throw createError(400, 'Choose a valid billing policy.');
    }
    const customers = await readCustomers(branchId);
    findCustomerOrThrow(customers, accountNumber);
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
