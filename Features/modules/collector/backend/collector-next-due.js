function parseDateOnly(value) {
  if (!value && value !== 0) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Date(year, month - 1, day);
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateOnly(value) {
  const parsed = value instanceof Date ? value : parseDateOnly(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isPrepaidCustomer(customer) {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid') return true;
  if (explicit === 'postpaid') return false;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return true;
  if (billing.includes('postpaid')) return false;
  return false;
}

function clampDay(year, monthIndex, day) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(day, lastDay);
}

function addMonthClamp(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const year = dateObj.getFullYear();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();
  const next = new Date(year, month + 1, 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  return new Date(next.getFullYear(), next.getMonth(), Math.min(day, lastDay));
}

function parseBillingDay(customer) {
  const raw = customer?.billDate;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) return numeric;
  const parsed = parseDateOnly(raw);
  return parsed ? parsed.getDate() : null;
}

function deriveDueOffset(customer) {
  const raw = Number(customer?.dueOffset);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);

  const bill = parseDateOnly(customer?.billDate);
  const due = parseDateOnly(customer?.dueDate);
  if (!bill || !due) return null;

  const diff = Math.round((due.getTime() - bill.getTime()) / 86400000);
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

function computeNextBillDate(customer, now = new Date()) {
  const billDay = parseBillingDay(customer);
  if (!billDay) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const year = today.getFullYear();
  const month = today.getMonth();
  const candidate = new Date(year, month, clampDay(year, month, billDay));

  if (candidate < today) {
    return formatDateOnly(new Date(year, month + 1, clampDay(year, month + 1, billDay)));
  }
  return formatDateOnly(candidate);
}

function resolveCollectorNextDue(customer, now = new Date()) {
  if (!customer || typeof customer !== 'object') return null;

  const normalizedDue = formatDateOnly(customer?.dueDate);
  if (isPrepaidCustomer(customer)) return normalizedDue;

  const nextBill = computeNextBillDate(customer, now);
  const dueOffset = deriveDueOffset(customer);
  if (nextBill && dueOffset != null) {
    const base = parseDateOnly(nextBill);
    if (base) {
      base.setDate(base.getDate() + dueOffset);
      const computed = formatDateOnly(base);
      if (computed) return computed;
    }
  }

  const due = parseDateOnly(customer?.dueDate);
  if (!due) return normalizedDue;

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  while (candidate < start) {
    const next = addMonthClamp(candidate);
    if (!next) break;
    candidate = next;
  }
  return formatDateOnly(candidate) || normalizedDue;
}

module.exports = {
  resolveCollectorNextDue,
};
