const { getEffectivePaymentEntries, normalizePaymentEntryDirection } = require('./payment-entry-normalizer');

const EPSILON = 0.005;

const normalizeText = (value) => String(value || '').trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const normalizeIdentity = (value) => normalizeKey(value).replace(/[^a-z0-9]+/g, '');
const normalizeAccountNumber = (value) => normalizeText(value);
const roundMoney = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
};

const parseDateOnly = (value) => {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseDateValue = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const dateOnly = parseDateOnly(value);
  if (dateOnly) return dateOnly;
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateOnly = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
};

const formatMonthKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const startOfNextMonth = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
};

const getCustomerName = (customer = {}, fallback = '') => {
  const explicit = normalizeText(customer.name || customer.fullName);
  if (explicit) return explicit;
  const fromParts = [customer.firstName, customer.lastName].map(normalizeText).filter(Boolean).join(' ');
  return fromParts || fallback || normalizeAccountNumber(customer.accountNumber) || 'Unnamed customer';
};

const getCustomerIdentityValues = (customer = {}) => [
  customer.accountNumber,
  customer.id,
  customer.loginUsername,
  customer.pppoeUsername,
  customer.name,
  customer.fullName,
  getCustomerName(customer),
  [customer.firstName, customer.lastName].map(normalizeText).filter(Boolean).join(' '),
  [customer.lastName, customer.firstName].map(normalizeText).filter(Boolean).join(', '),
  [customer.lastName, customer.firstName].map(normalizeText).filter(Boolean).join(' ')
].map(normalizeText).filter(Boolean);

const buildCustomerIdentityIndex = (customers = []) => {
  const byAccount = new Map();
  const byIdentity = new Map();
  (Array.isArray(customers) ? customers : []).forEach((customer) => {
    const accountNumber = normalizeAccountNumber(customer?.accountNumber);
    if (accountNumber) byAccount.set(accountNumber, customer);
    getCustomerIdentityValues(customer).forEach((value) => {
      const key = normalizeIdentity(value);
      if (key && !byIdentity.has(key)) byIdentity.set(key, customer);
    });
  });
  return { byAccount, byIdentity };
};

const buildAgentIndex = (agents = []) => {
  const byId = new Map();
  const byIdentity = new Map();
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    const id = normalizeText(agent?.id);
    if (id) byId.set(id, agent);
    [agent?.id, agent?.name, agent?.username].map(normalizeText).filter(Boolean).forEach((value) => {
      const key = normalizeIdentity(value);
      if (key && !byIdentity.has(key)) byIdentity.set(key, agent);
    });
  });
  return { byId, byIdentity };
};

const getReferralTextValues = (customer = {}) => [
  customer.referralSource,
  customer.referral_source,
  customer.referredBy,
  customer.referred_by,
  customer.referredByName,
  customer.referred_by_name,
  customer.referrer,
  customer.referrerName,
  customer.referralAgentName,
  customer.referral_agent_name,
  customer.referralCustomerName,
  customer.referral_customer_name
].map(normalizeText).filter(Boolean);

const resolveReferralSourceType = (customer = {}) => {
  const raw = normalizeKey(
    customer.referralSourceType
    || customer.referral_source_type
    || customer.referredByType
    || customer.referred_by_type
    || customer.referralType
    || customer.referral_type
  );
  if (raw === 'customer' || raw === 'subscriber' || raw === 'client') return 'customer';
  if (raw === 'agent' || raw === 'collector' || raw === 'sales') return 'agent';
  return '';
};

const resolveReferralSource = (customer = {}, indexes = {}) => {
  const accountNumber = normalizeAccountNumber(customer.accountNumber);
  const sourceType = resolveReferralSourceType(customer);
  const sourceAccount = normalizeAccountNumber(
    customer.referralCustomerAccountNumber
    || customer.referral_customer_account_number
    || customer.referredByAccountNumber
    || customer.referred_by_account_number
    || customer.referredByAccount
    || customer.referred_by_account
    || customer.referrerAccountNumber
    || customer.referrer_account_number
    || customer.referralAccountNumber
    || customer.referral_account_number
  );
  const agentId = normalizeText(
    customer.referralAgentId
    || customer.referral_agent_id
    || customer.referredByAgentId
    || customer.referred_by_agent_id
  );

  if (sourceAccount) {
    const referrer = indexes.customersByAccount?.get(sourceAccount) || null;
    if (normalizeAccountNumber(referrer?.accountNumber) === accountNumber) return null;
    return {
      type: 'customer',
      id: sourceAccount,
      accountNumber: sourceAccount,
      name: getCustomerName(referrer || {}, normalizeText(customer.referralCustomerName) || sourceAccount),
      customer: referrer
    };
  }

  if (agentId) {
    const agent = indexes.agentsById?.get(agentId) || null;
    return {
      type: 'agent',
      id: agentId,
      accountNumber: '',
      name: normalizeText(agent?.name || agent?.username || customer.referralAgentName) || agentId,
      agent
    };
  }

  const referralTexts = getReferralTextValues(customer);
  for (const value of referralTexts) {
    const key = normalizeIdentity(value);
    if (!key) continue;
    const matchedCustomer = indexes.customersByIdentity?.get(key);
    if (matchedCustomer && normalizeAccountNumber(matchedCustomer.accountNumber) !== accountNumber) {
      return {
        type: 'customer',
        id: normalizeAccountNumber(matchedCustomer.accountNumber),
        accountNumber: normalizeAccountNumber(matchedCustomer.accountNumber),
        name: getCustomerName(matchedCustomer),
        customer: matchedCustomer
      };
    }
    const matchedAgent = indexes.agentsByIdentity?.get(key);
    if (matchedAgent) {
      return {
        type: 'agent',
        id: normalizeText(matchedAgent.id),
        accountNumber: '',
        name: normalizeText(matchedAgent.name || matchedAgent.username || value),
        agent: matchedAgent
      };
    }
  }

  if (sourceType === 'agent' && referralTexts.length) {
    return { type: 'agent', id: '', accountNumber: '', name: referralTexts[0], agent: null };
  }
  if (sourceType === 'customer' && referralTexts.length) {
    return { type: 'customer', id: '', accountNumber: '', name: referralTexts[0], customer: null };
  }
  if (referralTexts.length) {
    return { type: 'external', id: '', accountNumber: '', name: referralTexts[0] };
  }
  return null;
};

const getEntryDate = (entry = {}) => parseDateValue(
  entry.recordedAt
  || entry.recorded_at
  || entry.date
  || entry.createdAt
  || entry.created_at
);

const getEntryAmount = (entry = {}) => {
  const amount = Math.abs(Number(entry.amount) || 0);
  return Number.isFinite(amount) ? amount : 0;
};

const isPaymentCredit = (entry = {}) => {
  const amount = getEntryAmount(entry);
  if (amount <= EPSILON) return false;
  const direction = normalizePaymentEntryDirection(entry);
  if (direction !== 'credit') return false;
  const kind = normalizeKey(entry.kind || entry.type);
  if (kind && kind !== 'payment' && kind !== 'credit') return false;
  const text = normalizeKey([entry.description, entry.notes, entry.remarks, entry.reference].filter(Boolean).join(' '));
  if (/\b(referral|rebate|discount)\b/.test(text)) return false;
  return true;
};

const isBillDebit = (entry = {}) => {
  const amount = getEntryAmount(entry);
  if (amount <= EPSILON) return false;
  const direction = normalizePaymentEntryDirection(entry);
  if (direction !== 'debit') return false;
  const kind = normalizeKey(entry.kind || entry.type);
  return !kind || kind === 'charge' || kind === 'bill' || kind === 'debit';
};

const evaluateReferralSuccess = (customer = {}, paymentsForAccount = [], now = new Date()) => {
  const activationDate = parseDateValue(customer.activationDate || customer.activation_date || customer.createdAt || customer.created_at);
  if (!activationDate) {
    return {
      status: 'pending',
      statusLabel: 'Waiting for activation date',
      eligibleMonth: '',
      firstBillAt: null,
      successAt: null
    };
  }

  const eligibleStart = startOfNextMonth(activationDate);
  const entries = getEffectivePaymentEntries(Array.isArray(paymentsForAccount) ? paymentsForAccount : [])
    .map((entry) => ({ ...entry, dateObj: getEntryDate(entry) }))
    .filter((entry) => entry.dateObj)
    .sort((a, b) => a.dateObj - b.dateObj);
  const firstBill = entries.find((entry) => isBillDebit(entry) && entry.dateObj >= eligibleStart);
  const firstPayment = entries.find((entry) => isPaymentCredit(entry) && entry.dateObj >= eligibleStart);
  const scheduledBillDate = parseDateValue(customer.billDate || customer.dueDate);
  const hasReachedScheduledBill = Boolean(scheduledBillDate && scheduledBillDate >= eligibleStart && scheduledBillDate <= now);

  if (firstPayment) {
    return {
      status: 'successful',
      statusLabel: 'Successful',
      eligibleMonth: formatMonthKey(eligibleStart),
      firstBillAt: firstBill ? formatDateOnly(firstBill.dateObj) : (hasReachedScheduledBill ? formatDateOnly(scheduledBillDate) : null),
      successAt: formatDateOnly(firstPayment.dateObj),
      paymentAmount: roundMoney(getEntryAmount(firstPayment))
    };
  }

  if (firstBill || hasReachedScheduledBill) {
    return {
      status: 'waiting-payment',
      statusLabel: 'Waiting for next-bill payment',
      eligibleMonth: formatMonthKey(eligibleStart),
      firstBillAt: firstBill ? formatDateOnly(firstBill.dateObj) : formatDateOnly(scheduledBillDate),
      successAt: null,
      paymentAmount: 0
    };
  }

  return {
    status: 'pending',
    statusLabel: 'Waiting for first month bill',
    eligibleMonth: formatMonthKey(eligibleStart),
    firstBillAt: null,
    successAt: null,
    paymentAmount: 0
  };
};

const buildReferralLedger = ({ customers = [], payments = {}, agents = [], now = new Date() } = {}) => {
  const customerList = Array.isArray(customers) ? customers : [];
  const customerIndex = buildCustomerIdentityIndex(customerList);
  const agentIndex = buildAgentIndex(agents);
  const indexes = {
    customersByAccount: customerIndex.byAccount,
    customersByIdentity: customerIndex.byIdentity,
    agentsById: agentIndex.byId,
    agentsByIdentity: agentIndex.byIdentity
  };

  const items = [];
  for (const customer of customerList) {
    const accountNumber = normalizeAccountNumber(customer?.accountNumber);
    if (!accountNumber) continue;
    const source = resolveReferralSource(customer, indexes);
    if (!source) continue;
    const history = payments?.[accountNumber]?.history || [];
    const eligibility = evaluateReferralSuccess(customer, history, now);
    const referrerPlanAmount = Number(source.customer?.planAmount) || 0;
    const discountAmount = source.type === 'customer' ? roundMoney(referrerPlanAmount / 2) : 0;
    const discountEligible = source.type === 'customer' && eligibility.status === 'successful' && Boolean(source.accountNumber);
    items.push({
      id: `${source.type}:${source.id || source.name}:${accountNumber}`,
      sourceType: source.type,
      referrerAccountNumber: source.accountNumber || '',
      referrerId: source.id || '',
      referrerName: source.name || 'Unknown referrer',
      referredAccountNumber: accountNumber,
      referredName: getCustomerName(customer),
      referredPlanName: normalizeText(customer.planName),
      referredPlanAmount: Number(customer.planAmount) || 0,
      referredActivationDate: formatDateOnly(parseDateValue(customer.activationDate || customer.activation_date)),
      eligibleMonth: eligibility.eligibleMonth,
      firstBillAt: eligibility.firstBillAt,
      successAt: eligibility.successAt,
      status: eligibility.status,
      statusLabel: eligibility.statusLabel,
      paymentAmount: eligibility.paymentAmount || 0,
      discountEligible,
      discountAmount
    });
  }

  return items.sort((left, right) => {
    const leftTime = parseDateValue(left.successAt || left.firstBillAt || left.referredActivationDate)?.getTime() || 0;
    const rightTime = parseDateValue(right.successAt || right.firstBillAt || right.referredActivationDate)?.getTime() || 0;
    if (left.status !== right.status) {
      const rank = { successful: 0, 'waiting-payment': 1, pending: 2 };
      return (rank[left.status] ?? 3) - (rank[right.status] ?? 3);
    }
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.referredName.localeCompare(right.referredName);
  });
};

const buildReferralDiscountMap = (ledger = []) => {
  const map = {};
  (Array.isArray(ledger) ? ledger : []).forEach((item) => {
    if (!item?.discountEligible || !item.referrerAccountNumber || !item.successAt) return;
    const key = normalizeAccountNumber(item.referrerAccountNumber);
    map[key] = map[key] || [];
    map[key].push({
      id: item.id,
      referredAccountNumber: item.referredAccountNumber,
      referredName: item.referredName,
      successAt: item.successAt,
      eligibleMonth: item.eligibleMonth,
      discountAmount: item.discountAmount
    });
  });
  Object.keys(map).forEach((key) => {
    map[key].sort((left, right) => {
      const dateDiff = (parseDateValue(left.successAt)?.getTime() || 0) - (parseDateValue(right.successAt)?.getTime() || 0);
      if (dateDiff) return dateDiff;
      return normalizeText(left.referredName).localeCompare(normalizeText(right.referredName));
    });
  });
  return map;
};

const summarizeReferralLedger = (items = []) => (
  (Array.isArray(items) ? items : []).reduce((acc, item) => {
    acc.total += 1;
    if (item.sourceType === 'customer') acc.customerSources += 1;
    if (item.sourceType === 'agent') acc.agentSources += 1;
    if (item.status === 'successful') acc.successful += 1;
    if (item.status === 'waiting-payment') acc.waitingPayment += 1;
    if (item.status === 'pending') acc.pending += 1;
    if (item.discountEligible) acc.discountValue = roundMoney(acc.discountValue + (Number(item.discountAmount) || 0));
    return acc;
  }, {
    total: 0,
    successful: 0,
    waitingPayment: 0,
    pending: 0,
    customerSources: 0,
    agentSources: 0,
    discountValue: 0
  })
);

module.exports = {
  buildReferralLedger,
  buildReferralDiscountMap,
  evaluateReferralSuccess,
  getCustomerName,
  summarizeReferralLedger
};
