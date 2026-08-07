const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;
const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-\d{2}/;
const BILLING_TIME_ZONE = 'Asia/Manila';

const billingDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const trimText = (value, maxLength = 160) => String(value || '').trim().slice(0, maxLength);

const normalizeMonthKey = (value) => {
  const text = trimText(value, 32);
  const match = text.match(MONTH_KEY_RE) || text.match(DATE_PREFIX_RE);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

const addMonthKey = (value, offset = 1) => {
  const monthKey = normalizeMonthKey(value);
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + Number(offset || 0), 1, 12));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getBillingDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = billingDateKeyFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return year && month && day ? `${year}-${month}-${day}` : '';
};

const getCurrentMonthKey = (now = new Date()) => getBillingDateKey(now).slice(0, 7);

const sanitizeActor = (value = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const actor = {
    id: value.id || null,
    username: trimText(value.username),
    name: trimText(value.name || value.username)
  };
  return actor.id || actor.username || actor.name ? actor : null;
};

const sanitizeComplimentaryPeriods = (input = []) => {
  const list = Array.isArray(input)
    ? input
    : Object.values(input && typeof input === 'object' ? input : {});
  const byId = new Map();

  list.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const effectiveMonth = normalizeMonthKey(value.effectiveMonth || value.startMonth || value.monthKey);
    if (!effectiveMonth) return;
    const rawEndMonth = normalizeMonthKey(value.endMonth || value.untilMonth || value.expiresMonth);
    const endMonth = rawEndMonth && rawEndMonth >= effectiveMonth ? rawEndMonth : '';
    const balanceTreatment = String(value.balanceTreatment || value.balancePolicy || 'keep').trim().toLowerCase() === 'write-off'
      ? 'write-off'
      : 'keep';
    const writeOffAmountValue = Number(value.writeOffAmount);
    const writeOffAmount = balanceTreatment === 'write-off' && Number.isFinite(writeOffAmountValue) && writeOffAmountValue > 0
      ? Number(writeOffAmountValue.toFixed(2))
      : 0;
    const periodId = trimText(value.periodId || value.id, 120) || `complimentary-${effectiveMonth}-${index + 1}`;
    const entry = {
      periodId,
      effectiveMonth,
      endMonth,
      balanceTreatment,
      writeOffAmount,
      reason: trimText(value.reason, 500),
      createdAt: trimText(value.createdAt, 80),
      updatedAt: trimText(value.updatedAt, 80),
      cancelledAt: trimText(value.cancelledAt, 80),
      cancelledFromMonth: normalizeMonthKey(value.cancelledFromMonth),
      endReason: trimText(value.endReason, 500)
    };
    const changedBy = sanitizeActor(value.changedBy);
    const endedBy = sanitizeActor(value.endedBy);
    if (changedBy) entry.changedBy = changedBy;
    if (endedBy) entry.endedBy = endedBy;
    byId.set(periodId, entry);
  });

  return Array.from(byId.values()).sort((left, right) => (
    left.effectiveMonth.localeCompare(right.effectiveMonth)
      || left.periodId.localeCompare(right.periodId)
  ));
};

const isPeriodActiveForMonth = (period = {}, monthValue = '') => {
  const monthKey = normalizeMonthKey(monthValue);
  const effectiveMonth = normalizeMonthKey(period.effectiveMonth);
  if (!monthKey || !effectiveMonth || monthKey < effectiveMonth) return false;
  if (period.cancelledAt && (!period.cancelledFromMonth || monthKey >= period.cancelledFromMonth)) return false;
  const endMonth = normalizeMonthKey(period.endMonth);
  return !endMonth || monthKey <= endMonth;
};

const getComplimentaryPeriodForMonth = (periods = [], monthValue = '') => (
  sanitizeComplimentaryPeriods(periods)
    .filter((period) => isPeriodActiveForMonth(period, monthValue))
    .slice(-1)[0] || null
);

const isComplimentaryMonth = (periods = [], monthValue = '') => Boolean(
  getComplimentaryPeriodForMonth(periods, monthValue)
);

const buildResumeCycleDate = (period = {}, planType = 'postpaid') => {
  const endMonth = normalizeMonthKey(period.endMonth);
  if (!endMonth) return null;
  const resumeMonth = addMonthKey(endMonth, 1);
  if (!resumeMonth) return null;
  if (String(planType || '').trim().toLowerCase() === 'prepaid') return `${resumeMonth}-01`;
  const [year, month] = resumeMonth.split('-').map(Number);
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${resumeMonth}-${String(day).padStart(2, '0')}`;
};

const buildComplimentaryAccountSummary = (periodsInput = [], options = {}) => {
  const periods = sanitizeComplimentaryPeriods(periodsInput);
  const currentMonth = normalizeMonthKey(options.currentMonth) || getCurrentMonthKey(options.now || new Date());
  const currentPeriod = getComplimentaryPeriodForMonth(periods, currentMonth);
  const scheduledPeriod = periods.find((period) => (
    !period.cancelledAt && period.effectiveMonth > currentMonth
  )) || null;
  const lastHistoricalPeriod = periods
    .filter((period) => period.effectiveMonth <= currentMonth)
    .slice(-1)[0] || null;
  const active = Boolean(currentPeriod);
  const status = active
    ? 'active'
    : (scheduledPeriod ? 'scheduled' : (lastHistoricalPeriod ? 'expired' : 'none'));

  return {
    active,
    status,
    label: active ? 'Complimentary' : (scheduledPeriod ? 'Complimentary scheduled' : 'Standard billing'),
    currentMonth,
    billingSuppressed: active,
    collectionSuppressed: active,
    reminderSuppressed: active,
    disconnectionSuppressed: active,
    nextBillableCycleDate: active ? buildResumeCycleDate(currentPeriod, options.planType) : null,
    currentPeriod,
    scheduledPeriod,
    periods
  };
};

const branchAdjustmentKey = (branchId = null) => String(branchId || 'global');

const getAccountComplimentaryPeriods = (adjustments = {}, branchId = null, accountNumber = '') => {
  const branchBucket = adjustments?.[branchAdjustmentKey(branchId)] || {};
  const adjustment = branchBucket?.[String(accountNumber || '').trim()] || {};
  return sanitizeComplimentaryPeriods(
    adjustment?.complimentaryPeriods
    || adjustment?.complimentaryAccountPeriods
    || adjustment?.freeAccountPeriods
  );
};

module.exports = {
  addMonthKey,
  branchAdjustmentKey,
  buildComplimentaryAccountSummary,
  buildResumeCycleDate,
  getAccountComplimentaryPeriods,
  getBillingDateKey,
  getComplimentaryPeriodForMonth,
  getCurrentMonthKey,
  isComplimentaryMonth,
  isPeriodActiveForMonth,
  normalizeMonthKey,
  sanitizeComplimentaryPeriods
};
