const APP_TIME_ZONE = 'Asia/Manila';
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const trimText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);
const roundMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const normalizeDateKey = (value) => {
  const text = trimText(value, 40);
  const match = text.match(DATE_ONLY_RE) || text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (month < 1 || month > 12 || day < 1 || day > maxDay) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normalizeMonthKey = (value) => {
  const text = trimText(value, 32);
  const match = text.match(MONTH_KEY_RE) || text.match(/^(\d{4})-(\d{2})-/);
  if (!match) return '';
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  return `${match[1]}-${String(month).padStart(2, '0')}`;
};

const getManilaDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateKeyFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return year && month && day ? `${year}-${month}-${day}` : '';
};

const parseDateKey = (value) => {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const addMonths = (dateKey, months = 1, dayMode = 'same') => {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + Number(months || 0);
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = dayMode === 'month-end' ? lastDay : Math.min(date.getUTCDate(), lastDay);
  return formatDateKey(new Date(Date.UTC(targetYear, targetMonth, day, 12)));
};

const addDays = (dateKey, days = 0) => {
  const date = parseDateKey(dateKey);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatDateKey(date);
};

const getMonthEndDateKey = (value) => {
  const date = parseDateKey(value);
  if (!date) return '';
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return formatDateKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day, 12)));
};

const getNextRegularCycleDate = ({ effectiveDate, planType = 'postpaid', chargePolicy = 'next-cycle' } = {}) => {
  const key = normalizeDateKey(effectiveDate);
  const date = parseDateKey(key);
  if (!date) return '';
  const prepaid = String(planType || '').trim().toLowerCase() === 'prepaid';
  const prorated = String(chargePolicy || '').trim().toLowerCase() === 'prorated';
  if (prepaid) {
    if (!prorated && date.getUTCDate() === 1) return key;
    return formatDateKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12)));
  }
  if (!prorated) return getMonthEndDateKey(key);
  return addMonths(getMonthEndDateKey(key), 1, 'month-end');
};

const calculateProration = ({ effectiveDate, planAmount = 0 } = {}) => {
  const start = parseDateKey(effectiveDate);
  const amount = Math.max(0, Number(planAmount) || 0);
  if (!start || amount <= 0) {
    return { amount: 0, periodStart: normalizeDateKey(effectiveDate), periodEnd: '' };
  }
  const periodEnd = getMonthEndDateKey(effectiveDate);
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const activeDays = Math.max(0, daysInMonth - start.getUTCDate() + 1);
  return {
    amount: roundMoney(Math.round((amount / daysInMonth) * activeDays)),
    periodStart: normalizeDateKey(effectiveDate),
    periodEnd
  };
};

const addMonthKey = (monthKey, offset = 1) => {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return '';
  const [year, month] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + Number(offset || 0), 1, 12));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const buildInstallmentSchedule = ({ amount = 0, months = 0, firstMonth = '' } = {}) => {
  const totalCents = Math.max(0, Math.round((Number(amount) || 0) * 100));
  const count = Math.max(0, Math.min(24, Math.trunc(Number(months) || 0)));
  const startMonth = normalizeMonthKey(firstMonth);
  if (!totalCents || !count || !startMonth) return [];
  const baseCents = Math.floor(totalCents / count);
  let remainder = totalCents - (baseCents * count);
  return Array.from({ length: count }, (_, index) => {
    const cents = baseCents + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return {
      number: index + 1,
      monthKey: addMonthKey(startMonth, index),
      amount: roundMoney(cents / 100)
    };
  });
};

const sanitizeActor = (value = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const actor = {
    id: value.id || null,
    username: trimText(value.username, 160),
    name: trimText(value.name || value.username, 160)
  };
  return actor.id || actor.username || actor.name ? actor : null;
};

const sanitizeActivationPayments = (input = []) => {
  const items = Array.isArray(input) ? input : [];
  const byId = new Map();
  items.forEach((value, index) => {
    if (!value || typeof value !== 'object') return;
    const entryId = trimText(value.entryId || value.id, 160) || `payment-${index + 1}`;
    const amount = roundMoney(Math.max(0, Number(value.amount) || 0));
    if (amount <= 0) return;
    byId.set(entryId, {
      entryId,
      amount,
      recordedAt: trimText(value.recordedAt || value.date, 80)
    });
  });
  return Array.from(byId.values());
};

const sanitizeReconnectionSettlement = (value = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const effectiveDate = normalizeDateKey(value.effectiveDate || value.reconnectionDate);
  const disconnectedAt = trimText(value.disconnectedAt, 80);
  if (!effectiveDate || !disconnectedAt) return null;
  const balanceTreatmentValue = trimText(value.balanceTreatment, 40).toLowerCase();
  const balanceTreatment = ['keep', 'write-off', 'installment'].includes(balanceTreatmentValue)
    ? balanceTreatmentValue
    : 'keep';
  const chargePolicy = trimText(value.chargePolicy, 40).toLowerCase() === 'prorated'
    ? 'prorated'
    : 'next-cycle';
  const activationPolicy = trimText(value.activationPolicy, 40).toLowerCase() === 'after-payment'
    ? 'after-payment'
    : 'immediate';
  const previousBalanceSnapshot = roundMoney(Math.max(0, Number(value.previousBalanceSnapshot) || 0));
  const writeOffAmount = balanceTreatment === 'write-off'
    ? roundMoney(Math.min(previousBalanceSnapshot, Math.max(0, Number(value.writeOffAmount) || previousBalanceSnapshot)))
    : 0;
  const deferredBalanceAmount = balanceTreatment === 'installment'
    ? roundMoney(Math.min(previousBalanceSnapshot, Math.max(0, Number(value.deferredBalanceAmount) || previousBalanceSnapshot)))
    : 0;
  const installmentMonths = balanceTreatment === 'installment'
    ? Math.max(2, Math.min(24, Math.trunc(Number(value.installmentMonths) || 2)))
    : 0;
  const installmentSchedule = balanceTreatment === 'installment'
    ? buildInstallmentSchedule({
        amount: deferredBalanceAmount,
        months: installmentMonths,
        firstMonth: value.installmentSchedule?.[0]?.monthKey
          || value.firstInstallmentMonth
          || (chargePolicy === 'prorated' ? effectiveDate.slice(0, 7) : normalizeMonthKey(value.nextRegularCycleDate))
      })
    : [];
  const activationPayments = sanitizeActivationPayments(value.activationPayments);
  const paidTowardActivation = roundMoney(activationPayments.reduce((sum, entry) => sum + entry.amount, 0));
  const statusValue = trimText(value.status, 40).toLowerCase();
  const status = statusValue === 'cancelled'
    ? 'cancelled'
    : (activationPolicy === 'after-payment' && !value.activatedAt ? 'pending-payment' : 'active');
  const settlement = {
    reconnectionId: trimText(value.reconnectionId || value.id, 160) || `reconnection-${effectiveDate}`,
    disconnectedAt,
    requestedAt: trimText(value.requestedAt || value.createdAt, 80),
    effectiveDate,
    activatedAt: trimText(value.activatedAt, 80),
    status,
    planType: trimText(value.planType, 40).toLowerCase() === 'prepaid' ? 'prepaid' : 'postpaid',
    planId: trimText(value.planId, 160),
    planName: trimText(value.planName, 160),
    planAmount: roundMoney(Math.max(0, Number(value.planAmount) || 0)),
    previousBalanceSnapshot,
    balanceTreatment,
    writeOffAmount,
    deferredBalanceAmount,
    installmentMonths,
    installmentSchedule,
    chargePolicy,
    prorationAmount: chargePolicy === 'prorated'
      ? roundMoney(Math.max(0, Number(value.prorationAmount) || 0))
      : 0,
    prorationPeriodStart: chargePolicy === 'prorated'
      ? normalizeDateKey(value.prorationPeriodStart || effectiveDate)
      : '',
    prorationPeriodEnd: chargePolicy === 'prorated'
      ? normalizeDateKey(value.prorationPeriodEnd)
      : '',
    nextRegularCycleDate: normalizeDateKey(value.nextRegularCycleDate),
    nextDueDate: normalizeDateKey(value.nextDueDate),
    activationPolicy,
    requiredPaymentAmount: activationPolicy === 'after-payment'
      ? roundMoney(Math.max(0, Number(value.requiredPaymentAmount) || 0))
      : 0,
    paidTowardActivation,
    activationPayments,
    reason: trimText(value.reason)
  };
  const changedBy = sanitizeActor(value.changedBy);
  const activatedBy = sanitizeActor(value.activatedBy);
  if (changedBy) settlement.changedBy = changedBy;
  if (activatedBy) settlement.activatedBy = activatedBy;
  return settlement;
};

const sanitizeReconnectionHistory = (input = []) => {
  const list = Array.isArray(input) ? input : [];
  const byId = new Map();
  list.forEach((value) => {
    const settlement = sanitizeReconnectionSettlement(value);
    if (settlement) byId.set(settlement.reconnectionId, settlement);
  });
  return Array.from(byId.values()).sort((left, right) => (
    left.effectiveDate.localeCompare(right.effectiveDate)
      || left.reconnectionId.localeCompare(right.reconnectionId)
  ));
};

const getLatestReconnectionSettlement = (decision = {}) => {
  const history = sanitizeReconnectionHistory(decision?.reconnectionHistory);
  return history.length ? history[history.length - 1] : null;
};

const getPendingReconnectionSettlement = (decision = {}) => (
  sanitizeReconnectionHistory(decision?.reconnectionHistory)
    .filter((entry) => entry.status === 'pending-payment')
    .slice(-1)[0] || null
);

const buildReconnectionSettlement = ({
  accountNumber = '',
  disconnectedAt = '',
  effectiveDate = '',
  planType = 'postpaid',
  planId = '',
  planName = '',
  planAmount = 0,
  previousBalance = 0,
  balanceTreatment = 'keep',
  installmentMonths = 0,
  chargePolicy = 'next-cycle',
  activationPolicy = 'immediate',
  requiredPaymentAmount = 0,
  dueOffset = 0,
  reason = '',
  changedBy = null,
  now = new Date()
} = {}) => {
  const safeEffectiveDate = normalizeDateKey(effectiveDate);
  const safePlanType = String(planType || '').trim().toLowerCase() === 'prepaid' ? 'prepaid' : 'postpaid';
  const safeChargePolicy = String(chargePolicy || '').trim().toLowerCase() === 'prorated' ? 'prorated' : 'next-cycle';
  const safeBalanceTreatment = ['keep', 'write-off', 'installment'].includes(String(balanceTreatment || '').trim().toLowerCase())
    ? String(balanceTreatment).trim().toLowerCase()
    : 'keep';
  const safeActivationPolicy = String(activationPolicy || '').trim().toLowerCase() === 'after-payment'
    ? 'after-payment'
    : 'immediate';
  const balance = roundMoney(Math.max(0, Number(previousBalance) || 0));
  const nextRegularCycleDate = getNextRegularCycleDate({
    effectiveDate: safeEffectiveDate,
    planType: safePlanType,
    chargePolicy: safeChargePolicy
  });
  const proration = safeChargePolicy === 'prorated'
    ? calculateProration({ effectiveDate: safeEffectiveDate, planAmount })
    : { amount: 0, periodStart: '', periodEnd: '' };
  const firstInstallmentMonth = safeChargePolicy === 'prorated'
    ? safeEffectiveDate.slice(0, 7)
    : nextRegularCycleDate.slice(0, 7);
  const safeInstallmentMonths = safeBalanceTreatment === 'installment'
    ? Math.max(2, Math.min(24, Math.trunc(Number(installmentMonths) || 2)))
    : 0;
  const installmentSchedule = safeBalanceTreatment === 'installment'
    ? buildInstallmentSchedule({ amount: balance, months: safeInstallmentMonths, firstMonth: firstInstallmentMonth })
    : [];
  const requestedAt = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();
  return sanitizeReconnectionSettlement({
    reconnectionId: `reconnection-${trimText(accountNumber, 80)}-${safeEffectiveDate}-${Date.now()}`,
    disconnectedAt,
    requestedAt,
    effectiveDate: safeEffectiveDate,
    activatedAt: safeActivationPolicy === 'immediate' ? requestedAt : '',
    status: safeActivationPolicy === 'immediate' ? 'active' : 'pending-payment',
    planType: safePlanType,
    planId,
    planName,
    planAmount,
    previousBalanceSnapshot: balance,
    balanceTreatment: safeBalanceTreatment,
    writeOffAmount: safeBalanceTreatment === 'write-off' ? balance : 0,
    deferredBalanceAmount: safeBalanceTreatment === 'installment' ? balance : 0,
    installmentMonths: safeInstallmentMonths,
    installmentSchedule,
    chargePolicy: safeChargePolicy,
    prorationAmount: proration.amount,
    prorationPeriodStart: proration.periodStart,
    prorationPeriodEnd: proration.periodEnd,
    nextRegularCycleDate,
    nextDueDate: addDays(nextRegularCycleDate, Math.max(0, Math.trunc(Number(dueOffset) || 0))),
    activationPolicy: safeActivationPolicy,
    requiredPaymentAmount,
    activationPayments: [],
    reason,
    changedBy,
    activatedBy: safeActivationPolicy === 'immediate' ? changedBy : null
  });
};

const activatePendingReconnectionSettlement = (value = {}, {
  effectiveDate = '',
  dueOffset = 0,
  activationPayments = [],
  activatedBy = null,
  now = new Date()
} = {}) => {
  const pending = sanitizeReconnectionSettlement(value);
  const activationDate = normalizeDateKey(effectiveDate);
  if (!pending || pending.status !== 'pending-payment' || !activationDate) return null;
  const activatedAt = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString()
    : new Date().toISOString();
  const rebuilt = buildReconnectionSettlement({
    accountNumber: '',
    disconnectedAt: pending.disconnectedAt,
    effectiveDate: activationDate,
    planType: pending.planType,
    planId: pending.planId,
    planName: pending.planName,
    planAmount: pending.planAmount,
    previousBalance: pending.previousBalanceSnapshot,
    balanceTreatment: pending.balanceTreatment,
    installmentMonths: pending.installmentMonths,
    chargePolicy: pending.chargePolicy,
    activationPolicy: 'after-payment',
    requiredPaymentAmount: pending.requiredPaymentAmount,
    dueOffset,
    reason: pending.reason,
    changedBy: pending.changedBy,
    now
  });
  if (!rebuilt) return null;
  return sanitizeReconnectionSettlement({
    ...rebuilt,
    reconnectionId: pending.reconnectionId,
    requestedAt: pending.requestedAt,
    activatedAt,
    status: 'active',
    activationPolicy: 'after-payment',
    requiredPaymentAmount: pending.requiredPaymentAmount,
    activationPayments,
    activatedBy
  });
};

const isBillingDateSuppressedByReconnection = (settlement = {}, billDateValue = '') => {
  const normalized = sanitizeReconnectionSettlement(settlement);
  const billDate = normalizeDateKey(billDateValue);
  const disconnectedDate = normalizeDateKey(normalized?.disconnectedAt);
  const resumeDate = normalizeDateKey(normalized?.nextRegularCycleDate);
  if (!normalized || !billDate || !disconnectedDate || !resumeDate) return false;
  return billDate > disconnectedDate && billDate < resumeDate;
};

const buildReconnectionSummary = (decision = {}) => {
  const history = sanitizeReconnectionHistory(decision?.reconnectionHistory);
  const latest = history.length ? history[history.length - 1] : null;
  const pending = history.filter((entry) => entry.status === 'pending-payment').slice(-1)[0] || null;
  return {
    status: pending ? 'pending-payment' : (latest ? latest.status : 'none'),
    pendingPayment: Boolean(pending),
    requiredPaymentAmount: pending?.requiredPaymentAmount || 0,
    paidTowardActivation: pending?.paidTowardActivation || 0,
    remainingActivationPayment: pending
      ? roundMoney(Math.max(0, pending.requiredPaymentAmount - pending.paidTowardActivation))
      : 0,
    latest,
    history
  };
};

module.exports = {
  activatePendingReconnectionSettlement,
  addMonthKey,
  buildInstallmentSchedule,
  buildReconnectionSettlement,
  buildReconnectionSummary,
  calculateProration,
  getLatestReconnectionSettlement,
  getManilaDateKey,
  getNextRegularCycleDate,
  getPendingReconnectionSettlement,
  isBillingDateSuppressedByReconnection,
  normalizeDateKey,
  normalizeMonthKey,
  roundMoney,
  sanitizeReconnectionHistory,
  sanitizeReconnectionSettlement
};
