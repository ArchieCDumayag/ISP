const DEBIT_KINDS = new Set(['charge', 'bill', 'debit']);
const CREDIT_KINDS = new Set(['payment', 'rebate', 'discount', 'credit']);
const KNOWN_KINDS = new Set([...DEBIT_KINDS, ...CREDIT_KINDS]);
const INEFFECTIVE_STATUSES = new Set([
  'pending_gcash_verification',
  'pending-gcash-verification',
  'pending gcash verification',
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
    .map((entry) => normalizePaymentEntry(entry));

  // Older prepaid payments created a matching debit for every payment. Those
  // debits are not billing cycles and caused duplicate rows within one month.
  // Keep the raw history intact, but exclude the deprecated generated entries
  // from every effective balance calculation.
  return entries.filter((entry) => !(
    normalizePaymentEntryDirection(entry) === 'debit'
    && isPrepaidAutoChargeEntry(entry)
  ));
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
