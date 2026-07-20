const DEBIT_KINDS = new Set(['charge', 'bill', 'debit']);
const CREDIT_KINDS = new Set(['payment', 'rebate', 'discount', 'credit']);
const KNOWN_KINDS = new Set([...DEBIT_KINDS, ...CREDIT_KINDS]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePaymentEntryDirection(entry = {}) {
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

module.exports = {
  normalizePaymentEntry,
  normalizePaymentEntryDirection,
  normalizePaymentEntryKind
};
