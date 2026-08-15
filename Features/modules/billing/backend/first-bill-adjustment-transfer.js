const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const ACCOUNT_KEYS = Object.freeze([
  'account_number',
  'accountNumber',
  'customer_account_number',
  'customerAccountNumber'
]);

const PREVIOUS_BALANCE_KEYS = Object.freeze([
  'first_bill_previous_balance',
  'firstBillPreviousBalance',
  'previous_balance',
  'previousBalance',
  'opening_previous_balance',
  'openingPreviousBalance'
]);

const ADVANCE_KEYS = Object.freeze([
  'first_bill_advance',
  'firstBillAdvance',
  'advance',
  'advance_payment',
  'advancePayment',
  'opening_advance',
  'openingAdvance',
  'opening_advance_payment',
  'openingAdvancePayment'
]);

const pickOwn = (value, keys = []) => {
  for (const key of keys) {
    if (hasOwn(value, key)) return value[key];
  }
  return undefined;
};

const parseObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeAmount = (value) => {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Number(parsed.toFixed(2));
};

const resolveRawFirstBill = (value = {}) => {
  const source = parseObject(value) || {};
  const adjustmentJson = parseObject(pickOwn(source, [
    'adjustment_json',
    'adjustmentJson',
    'payment_breakdown_adjustment_json',
    'paymentBreakdownAdjustmentJson'
  ]));
  const adjustment = adjustmentJson || parseObject(
    pickOwn(source, ['paymentBreakdownAdjustment', 'breakdownAdjustment', 'firstBillAdjustment'])
  ) || source;
  return parseObject(pickOwn(adjustment, ['firstBill', 'first_bill', 'first_bill_json', 'firstBillJson']))
    || adjustment;
};

const sanitizeUpdatedBy = (value) => {
  const parsed = parseObject(value);
  if (!parsed) return null;
  const username = String(parsed.username || '').trim().slice(0, 160);
  const name = String(parsed.name || username || '').trim().slice(0, 160);
  const id = parsed.id == null ? null : String(parsed.id).trim().slice(0, 160);
  if (!id && !username && !name) return null;
  return { id: id || null, username, name };
};

const extractFirstBillAdjustmentCandidate = (row = {}) => {
  const source = parseObject(row) || {};
  const accountNumber = String(pickOwn(source, ACCOUNT_KEYS) || '').trim();
  const firstBill = resolveRawFirstBill(source);
  const previousBalance = normalizeAmount(pickOwn(firstBill, PREVIOUS_BALANCE_KEYS));
  const advance = normalizeAmount(pickOwn(firstBill, ADVANCE_KEYS));
  const fields = {};
  if (previousBalance !== undefined) fields.previousBalance = previousBalance;
  if (advance !== undefined) fields.advance = advance;
  if (!Object.keys(fields).length) return null;
  return {
    accountNumber,
    firstBill: fields,
    updatedAt: String(pickOwn(source, ['updated_at', 'updatedAt']) || '').trim(),
    updatedBy: sanitizeUpdatedBy(pickOwn(source, ['updated_by_json', 'updatedByJson', 'updatedBy']))
  };
};

const extractLegacyFirstBillAdjustmentRows = (rows = []) => (Array.isArray(rows) ? rows : [])
  .map((row) => extractFirstBillAdjustmentCandidate(row))
  .filter(Boolean)
  .map((candidate) => ({
    account_number: candidate.accountNumber,
    ...(hasOwn(candidate.firstBill, 'previousBalance')
      ? { first_bill_previous_balance: candidate.firstBill.previousBalance }
      : {}),
    ...(hasOwn(candidate.firstBill, 'advance')
      ? { first_bill_advance: candidate.firstBill.advance }
      : {}),
    ...(candidate.updatedAt ? { updated_at: candidate.updatedAt } : {}),
    ...(candidate.updatedBy ? { updated_by_json: JSON.stringify(candidate.updatedBy) } : {})
  }));

const resolveBranchBucket = (adjustments = {}, branchId = null) => {
  const source = parseObject(adjustments) || {};
  const branchKey = String(branchId || 'global');
  if (parseObject(source[branchKey])) return source[branchKey];
  if (branchKey === '1' && parseObject(source.global)) return source.global;
  return {};
};

const buildFirstBillAdjustmentExportRows = ({
  adjustments = {},
  branchId = null,
  accountNumbers = []
} = {}) => {
  const allowedAccounts = new Set((Array.isArray(accountNumbers) ? accountNumbers : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
  const bucket = resolveBranchBucket(adjustments, branchId);
  return Object.entries(bucket)
    .filter(([accountNumber]) => !allowedAccounts.size || allowedAccounts.has(String(accountNumber)))
    .map(([accountNumber, adjustment]) => {
      const firstBill = resolveRawFirstBill(adjustment);
      const previousBalance = normalizeAmount(pickOwn(firstBill, PREVIOUS_BALANCE_KEYS));
      const advance = normalizeAmount(pickOwn(firstBill, ADVANCE_KEYS));
      if (previousBalance === undefined && advance === undefined) return null;
      const updatedBy = sanitizeUpdatedBy(adjustment?.updatedBy);
      return {
        account_number: String(accountNumber),
        ...(previousBalance !== undefined ? { first_bill_previous_balance: previousBalance } : {}),
        ...(advance !== undefined ? { first_bill_advance: advance } : {}),
        updated_at: String(adjustment?.updatedAt || ''),
        updated_by_json: updatedBy ? JSON.stringify(updatedBy) : ''
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.account_number.localeCompare(right.account_number));
};

const existingFieldIsAuthoritative = (firstBill = {}, key) => (
  hasOwn(firstBill, key) && normalizeAmount(firstBill[key]) !== undefined
);

const mergeFirstBillAdjustmentRows = ({
  adjustments = {},
  branchId = null,
  rows = [],
  validAccountNumbers = [],
  now = new Date()
} = {}) => {
  const source = parseObject(adjustments) || {};
  const next = { ...source };
  const branchKey = String(branchId || 'global');
  const currentBucket = parseObject(source[branchKey]) || {};
  const bucket = { ...currentBucket };
  const validAccounts = new Set((Array.isArray(validAccountNumbers) ? validAccountNumbers : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean));
  const warnings = [];
  let imported = 0;
  let skipped = 0;
  const importedAt = now instanceof Date && Number.isFinite(now.getTime())
    ? now.toISOString()
    : new Date().toISOString();

  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const candidate = extractFirstBillAdjustmentCandidate(row);
    if (!candidate) {
      warnings.push(`Skipped first-bill adjustment row ${index + 2}: Previous Balance and Advance are missing or invalid.`);
      skipped += 1;
      continue;
    }
    if (!candidate.accountNumber) {
      warnings.push(`Skipped first-bill adjustment row ${index + 2}: account number is missing.`);
      skipped += 1;
      continue;
    }
    if (validAccounts.size && !validAccounts.has(candidate.accountNumber)) {
      warnings.push(`Skipped first-bill adjustment for ${candidate.accountNumber}: customer is not available in this branch.`);
      skipped += 1;
      continue;
    }

    const existing = parseObject(bucket[candidate.accountNumber]) || {};
    const rawExistingFirstBill = resolveRawFirstBill(existing);
    const nextFirstBill = parseObject(existing.firstBill)
      ? { ...existing.firstBill }
      : ['previousBalance', 'advance'].reduce((result, key) => {
        const amount = normalizeAmount(rawExistingFirstBill[key]);
        if (amount !== undefined) result[key] = amount;
        return result;
      }, {});
    let changed = false;
    for (const key of ['previousBalance', 'advance']) {
      if (!hasOwn(candidate.firstBill, key) || existingFieldIsAuthoritative(rawExistingFirstBill, key)) continue;
      nextFirstBill[key] = candidate.firstBill[key];
      changed = true;
    }
    if (!changed) {
      skipped += 1;
      continue;
    }

    bucket[candidate.accountNumber] = {
      ...existing,
      firstBill: nextFirstBill,
      updatedAt: String(existing.updatedAt || candidate.updatedAt || importedAt),
      updatedBy: sanitizeUpdatedBy(existing.updatedBy)
        || candidate.updatedBy
        || { id: null, username: 'legacy-import', name: 'Legacy customer import' },
      legacyImport: {
        source: 'customer-full-import',
        importedAt
      }
    };
    imported += 1;
  }

  if (imported) next[branchKey] = bucket;
  return { adjustments: next, imported, skipped, warnings };
};

module.exports = {
  buildFirstBillAdjustmentExportRows,
  extractFirstBillAdjustmentCandidate,
  extractLegacyFirstBillAdjustmentRows,
  mergeFirstBillAdjustmentRows
};
