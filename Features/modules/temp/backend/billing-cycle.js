const PLAN_TYPES = new Set(['prepaid', 'postpaid', 'prorate']);
const BILLING_SCHEDULE_MODES = new Set(['date', 'day']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizePlanType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return PLAN_TYPES.has(normalized) ? normalized : 'postpaid';
};

const normalizeBillingScheduleMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return BILLING_SCHEDULE_MODES.has(normalized) ? normalized : 'day';
};

const parseDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!ISO_DATE_RE.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return parsed;
};

const formatDateOnly = (value) => {
  const date = value instanceof Date ? value : parseDateOnly(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
};

const clampBillingDay = (year, monthIndex, billingDay) => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const requestedDay = Math.min(31, Math.max(1, Number.parseInt(billingDay, 10) || 1));
  return Math.min(requestedDay, lastDay);
};

const buildBillingDate = (year, monthIndex, billingDay) => new Date(Date.UTC(
  year,
  monthIndex,
  clampBillingDay(year, monthIndex, billingDay)
));

const advanceBillingDate = (value, billingDay, months = 1) => {
  const date = value instanceof Date ? value : parseDateOnly(value);
  if (!date) return null;
  return buildBillingDate(date.getUTCFullYear(), date.getUTCMonth() + months, billingDay);
};

const resolveBillingDateOnOrAfter = (value, billingDay, options = {}) => {
  const reference = value instanceof Date ? value : parseDateOnly(value);
  if (!reference) return null;
  let candidate = buildBillingDate(reference.getUTCFullYear(), reference.getUTCMonth(), billingDay);
  const strictAfter = options.strictAfter === true;
  if (candidate.getTime() < reference.getTime() || (strictAfter && candidate.getTime() === reference.getTime())) {
    candidate = buildBillingDate(reference.getUTCFullYear(), reference.getUTCMonth() + 1, billingDay);
  }
  return candidate;
};

const daysBetween = (start, end) => {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
};

function resolveInitialCycleState(customer = {}, asOfDate, options = {}) {
  const planType = normalizePlanType(customer.planType);
  const billingScheduleMode = normalizeBillingScheduleMode(customer.billingScheduleMode);
  if (billingScheduleMode === 'date') {
    const exactBillingDate = parseDateOnly(customer.nextBillingDate);
    if (!exactBillingDate) throw new Error('A valid next billing date is required.');
    return {
      billingCycleInitialized: true,
      billingScheduleConfigured: true,
      nextBillingDate: formatDateOnly(exactBillingDate),
      proratePending: false,
      billingDay: exactBillingDate.getUTCDate()
    };
  }

  const asOf = parseDateOnly(asOfDate);
  if (!asOf) throw new Error('A valid cycle date is required.');
  const activation = parseDateOnly(customer.activationDate);
  const reference = activation && activation.getTime() > asOf.getTime() ? activation : asOf;
  const nextBillingDate = resolveBillingDateOnOrAfter(reference, customer.billingDay, {
    strictAfter: options.legacy === true
  });
  const previousBillingDate = advanceBillingDate(nextBillingDate, customer.billingDay, -1);
  const proratePending = Boolean(
    planType === 'prorate'
    && options.legacy !== true
    && activation
    && previousBillingDate
    && activation.getTime() > previousBillingDate.getTime()
    && activation.getTime() < nextBillingDate.getTime()
  );

  return {
    billingCycleInitialized: true,
    billingScheduleConfigured: true,
    nextBillingDate: formatDateOnly(nextBillingDate),
    proratePending
  };
}

function resolveCycleCharge(customer = {}, cycleDateValue) {
  const monthlyRate = Math.max(0, Number(customer.monthlyRate) || 0);
  const cycleDate = parseDateOnly(cycleDateValue);
  if (!cycleDate || monthlyRate <= 0) return null;

  if (
    normalizePlanType(customer.planType) !== 'prorate'
    || normalizeBillingScheduleMode(customer.billingScheduleMode) !== 'day'
    || customer.proratePending !== true
  ) {
    return {
      amount: Number(monthlyRate.toFixed(2)),
      prorated: false,
      periodStart: '',
      periodEnd: ''
    };
  }

  const previousBillingDate = advanceBillingDate(cycleDate, customer.billingDay, -1);
  const activationDate = parseDateOnly(customer.activationDate);
  if (!previousBillingDate || !activationDate) {
    return {
      amount: Number(monthlyRate.toFixed(2)),
      prorated: false,
      periodStart: '',
      periodEnd: ''
    };
  }

  const periodStart = activationDate.getTime() > previousBillingDate.getTime()
    ? activationDate
    : previousBillingDate;
  const cycleDays = daysBetween(previousBillingDate, cycleDate);
  const activeDays = daysBetween(periodStart, cycleDate);
  if (!cycleDays || !activeDays || activeDays >= cycleDays) {
    return {
      amount: Number(monthlyRate.toFixed(2)),
      prorated: false,
      periodStart: '',
      periodEnd: ''
    };
  }

  const periodEnd = new Date(cycleDate.getTime() - DAY_MS);
  return {
    amount: Math.max(1, Math.round((monthlyRate / cycleDays) * activeDays)),
    prorated: true,
    periodStart: formatDateOnly(periodStart),
    periodEnd: formatDateOnly(periodEnd)
  };
}

const isCycleDue = (cycleDate, asOfDate) => {
  const cycle = parseDateOnly(cycleDate);
  const asOf = parseDateOnly(asOfDate);
  return Boolean(cycle && asOf && cycle.getTime() <= asOf.getTime());
};

module.exports = {
  PLAN_TYPES,
  BILLING_SCHEDULE_MODES,
  normalizePlanType,
  normalizeBillingScheduleMode,
  parseDateOnly,
  formatDateOnly,
  advanceBillingDate,
  resolveBillingDateOnOrAfter,
  resolveInitialCycleState,
  resolveCycleCharge,
  isCycleDue
};
