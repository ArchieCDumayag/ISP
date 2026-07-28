const DEBIT_KINDS = new Set(['charge', 'bill', 'debit']);
const CREDIT_KINDS = new Set(['payment', 'rebate', 'discount', 'credit']);
const KNOWN_KINDS = new Set([...DEBIT_KINDS, ...CREDIT_KINDS]);
const INEFFECTIVE_STATUSES = new Set([
  'pending_approval',
  'pending-approval',
  'pending approval',
  'rejected',
  'cancelled',
  'canceled',
  'void',
  'voided'
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isOpeningPreviousBalanceEntry(entry = {}) {
  const reference = normalizeText(entry?.reference || entry?.orNumber || entry?.or_number);
  const description = normalizeText([
    entry?.description,
    entry?.notes,
    entry?.remarks
  ].filter(Boolean).join(' '));

  return reference.startsWith('obb-')
    || reference.startsWith('opening-bal-')
    || description.includes('previous balance bill')
    || description.includes('opening previous balance');
}

function isPrepaidAutoChargeEntry(entry = {}) {
  const description = normalizeText([
    entry?.description,
    entry?.notes,
    entry?.remarks
  ].filter(Boolean).join(' '));
  return description.includes('prepaid renewal charge');
}

function isOpeningAdvancePaymentEntry(entry = {}) {
  const reference = normalizeText(entry?.reference || entry?.orNumber || entry?.or_number);
  const description = normalizeText([
    entry?.description,
    entry?.notes,
    entry?.remarks
  ].filter(Boolean).join(' '));

  return reference.startsWith('oba-')
    || reference.startsWith('opening-adv-')
    || description.includes('opening advance payment');
}

function getPaymentEntryAmount(entry = {}) {
  const amount = Math.abs(Number(entry?.amount) || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function getPaymentEntryDateKey(entry = {}) {
  const raw = String(entry?.date || entry?.recordedAt || entry?.recorded_at || entry?.createdAt || entry?.created_at || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct?.[1]) return direct[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function getPaymentEntryTime(entry = {}, fallback = 0) {
  const raw = String(entry?.recordedAt || entry?.recorded_at || entry?.date || entry?.createdAt || entry?.created_at || '').trim();
  if (!raw) return fallback;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? raw.replace(/\s+/, 'T')
    : raw;
  const parsed = new Date(normalized);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : fallback;
}

function isEffectivePaymentEntryStatus(entry = {}) {
  const status = normalizeText(entry?.status || entry?.paymentStatus || entry?.payment_status);
  return !status || !INEFFECTIVE_STATUSES.has(status);
}

function normalizePaymentEntryDirection(entry = {}) {
  if (isOpeningPreviousBalanceEntry(entry)) {
    return 'debit';
  }

  const explicitDirection = normalizeText(entry?.direction || entry?.nature);
  if (explicitDirection === 'debit' || explicitDirection === 'credit') {
    return explicitDirection;
  }

  const rawKind = normalizeText(entry?.kind || entry?.type);
  if (DEBIT_KINDS.has(rawKind)) return 'debit';
  if (CREDIT_KINDS.has(rawKind)) return 'credit';
  return '';
}

function normalizePaymentEntryKind(entry = {}) {
  if (isOpeningPreviousBalanceEntry(entry)) {
    return 'bill';
  }

  const rawKind = normalizeText(entry?.kind);
  if (KNOWN_KINDS.has(rawKind)) {
    return rawKind === 'debit' ? 'charge' : rawKind;
  }

  const direction = normalizePaymentEntryDirection(entry);
  const rawType = normalizeText(entry?.type);
  if (KNOWN_KINDS.has(rawType)) {
    if (direction === 'debit') return 'charge';
    return rawType === 'debit' ? 'charge' : rawType;
  }

  if (direction === 'debit') return 'charge';
  if (direction === 'credit') return 'payment';
  return '';
}

function normalizePaymentEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const kind = normalizePaymentEntryKind(entry);
  const direction = normalizePaymentEntryDirection({ ...entry, kind });

  return {
    ...entry,
    kind: kind || undefined,
    type: kind || undefined,
    direction: direction || undefined
  };
}

function getEffectivePaymentEntries(history = []) {
  const entries = (Array.isArray(history) ? history : [])
    .filter((entry) => isEffectivePaymentEntryStatus(entry))
    .map((entry, index) => ({
      entry: normalizePaymentEntry(entry),
      amount: getPaymentEntryAmount(entry),
      dateKey: getPaymentEntryDateKey(entry),
      time: getPaymentEntryTime(entry, index),
      index
    }));

  const openingAdjustments = entries.filter(({ entry, amount }) => (
    amount > 0
    && (
      (
        normalizePaymentEntryDirection(entry) === 'debit'
        && isOpeningPreviousBalanceEntry(entry)
      )
      || (
        normalizePaymentEntryDirection(entry) === 'credit'
        && isOpeningAdvancePaymentEntry(entry)
      )
    )
  ));
  if (!openingAdjustments.length) {
    return entries.map(({ entry }) => entry);
  }

  const ignored = new Set();
  entries.forEach((candidate) => {
    if (
      !candidate.amount
      || normalizePaymentEntryDirection(candidate.entry) !== 'debit'
      || !isPrepaidAutoChargeEntry(candidate.entry)
    ) {
      return;
    }

    const matchesOpeningAdjustment = openingAdjustments.some((opening) => (
      Math.abs(opening.amount - candidate.amount) <= 0.005
      && opening.dateKey
      && opening.dateKey === candidate.dateKey
      && Math.abs(opening.time - candidate.time) <= 30000
    ));
    if (matchesOpeningAdjustment) ignored.add(candidate.index);
  });

  return entries
    .filter(({ index }) => !ignored.has(index))
    .map(({ entry }) => entry);
}

module.exports = {
  getEffectivePaymentEntries,
  isOpeningAdvancePaymentEntry,
  isOpeningPreviousBalanceEntry,
  isEffectivePaymentEntryStatus,
  isPrepaidAutoChargeEntry,
  normalizePaymentEntry,
  normalizePaymentEntryDirection,
  normalizePaymentEntryKind
};
