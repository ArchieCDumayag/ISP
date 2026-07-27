const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  loadAccounts,
  saveAccounts,
  isSystemAccountId,
  isSystemAccount,
  isBackupAdminId,
  BACKUP_ADMIN_USERNAME
} = require('./accounts-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { appendActivityLog } = require('./activity-log');
const { issueToken, storeSession, verifyTokenDetailed, isEphemeralSessionSecret } = require('./session-cache');
const { readJson, writeJson } = require('./data-store');
const { hashPassword, verifyPassword, isHashedPassword } = require('./passwords');
const { resolveCollectorNextDue } = require('./collector-next-due');
const { normalizePaymentEntry } = require('./payment-entry-normalizer');
const paymentRecordsRouter = require('./payment-records');
const { calculatePaymentBreakdownEndingBalance } = require('./payment-breakdown-balance');
const { normalizeRoles, rolesToStoredValue, accountHasRole, accountHasAnyRole, getPrimaryRole } = require('./role-utils');

const sessions = new Map(); // sessionId -> { userId, createdAt }
function parsePositiveSeconds(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

const SESSION_MAX_AGE_SECONDS = parsePositiveSeconds(
  process.env.ADMIN_SESSION_MAX_AGE_SECONDS,
  7 * 24 * 60 * 60
);
const SESSION_COOKIE_NAME = String(process.env.SESSION_COOKIE_NAME || 'sessionId')
  .trim()
  .replace(/[^A-Za-z0-9_-]/g, '') || 'sessionId';
const SESSION_TTL_MS = SESSION_MAX_AGE_SECONDS * 1000;
const SESSION_TOUCH_INTERVAL_MS = Math.min(5 * 60 * 1000, Math.max(60 * 1000, Math.floor(SESSION_TTL_MS / 12)));
const SERVICE_CONFIG_FILE = path.join(__dirname, 'service-config.json');
const SESSION_STORE_KEY = 'sessions';
let cachedServiceConfig = null;
const DEFAULT_BACKUP_PASSWORD = 'admin';
const SINGLE_BRANCH_MODE = String(process.env.SINGLE_BRANCH_MODE || 'true').trim().toLowerCase() === 'true';
const SINGLE_BRANCH_ID = Number(process.env.SINGLE_BRANCH_ID || 1);
const BUSINESS_PROFILE_STORE_KEY = 'business-profile';
const DEFAULT_BUSINESS_PROFILE = {
  businessName: '',
  tagline: '',
  supportEmail: '',
  contact: '',
  address: '',
  logoUrl: '',
  paymentInstructions: {}
};
const COLLECTORS_STORE_KEY = 'collectors';
const CUSTOMERS_STORE_KEY = 'customers';
const PON_STATE_STORE_KEY = 'pon-state';
const COLLECTOR_TOKEN_SCOPE = 'collector-app';
const STATUS_ACTIVE = 'active';
const STATUS_INACTIVE = 'inactive';
const STATUS_DISABLED = 'disabled';
const MONTHLY_BILL_LABEL_PREFIX = 'Monthly Bill for ';
const MONTH_YEAR_PATTERN = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i;
const DEFAULT_COLLECTOR_SESSION_TTL_SECONDS = 24 * 60 * 60;
const COLLECTOR_SESSION_TTL_SECONDS = (() => {
  const parsed = Number(process.env.COLLECTOR_SESSION_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COLLECTOR_SESSION_TTL_SECONDS;
  return Math.trunc(parsed);
})();

const resolveBranchId = (value) => {
  if (SINGLE_BRANCH_MODE && Number.isFinite(SINGLE_BRANCH_ID) && SINGLE_BRANCH_ID > 0) {
    return SINGLE_BRANCH_ID;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeBusinessProfile = (profile) => {
  const incoming = profile && typeof profile === 'object' ? profile : {};
  return {
    ...DEFAULT_BUSINESS_PROFILE,
    businessName: String(incoming.businessName || '').trim(),
    tagline: String(incoming.tagline || '').trim(),
    supportEmail: String(incoming.supportEmail || '').trim(),
    contact: String(incoming.contact || '').trim(),
    address: String(incoming.address || '').trim(),
    logoUrl: String(incoming.logoUrl || '').trim(),
    paymentInstructions:
      incoming.paymentInstructions && typeof incoming.paymentInstructions === 'object'
        ? incoming.paymentInstructions
        : {}
  };
};

const normalizeText = (value) => String(value || '').trim();

const normalizeCollectorCustomerStatus = (value, fallback = STATUS_ACTIVE) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'force-inactive') return STATUS_INACTIVE;
  if (raw === 'force-active') return STATUS_ACTIVE;
  if (raw === STATUS_ACTIVE || raw === STATUS_INACTIVE || raw === STATUS_DISABLED) return raw;
  return fallback;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(raw);
  if (isNaN(parsed)) return raw;
  return parsed.toISOString().slice(0, 10);
};

const toPlanAmount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidCoordinatePair = (lat, lng) => (
  Number.isFinite(lat)
  && Number.isFinite(lng)
  && lat >= -90
  && lat <= 90
  && lng >= -180
  && lng <= 180
);

const parseCoordinateValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = (() => {
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      return raw;
    }
  })();

  const patterns = [
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (isValidCoordinatePair(lat, lng)) {
      return { lat, lng };
    }
  }

  const normalizedDms = normalized
    .replace(/[\u00BA\u02DA]/g, '\u00B0')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasDmsMarkers = /[NSEW]/i.test(normalizedDms) && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalizedDms);
  if (!hasDmsMarkers) {
    return null;
  }

  const parseDmsSegment = (segment) => {
    const text = String(segment || '').trim().toUpperCase();
    if (!text) return null;
    const hemisphereMatch = text.match(/[NSEW]/);
    const hemisphere = hemisphereMatch ? hemisphereMatch[0] : '';
    if (!hemisphere) return null;
    const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (!numericParts.length) return null;

    const degrees = Number(numericParts[0]);
    const minutes = Number(numericParts[1] || 0);
    const seconds = Number(numericParts[2] || 0);
    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      return null;
    }
    if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
      return null;
    }

    let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
    if (String(numericParts[0] || '').trim().startsWith('-')) {
      decimal *= -1;
    }
    if (hemisphere === 'S' || hemisphere === 'W') {
      decimal = -Math.abs(decimal);
    } else {
      decimal = Math.abs(decimal);
    }

    return {
      value: decimal,
      hemisphere
    };
  };

  const dmsSegments = normalizedDms.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
  const parsedDmsSegments = dmsSegments.map(parseDmsSegment).filter(Boolean);
  const latEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S');
  const lngEntry = parsedDmsSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W');
  if (latEntry && lngEntry && isValidCoordinatePair(latEntry.value, lngEntry.value)) {
    return {
      lat: latEntry.value,
      lng: lngEntry.value
    };
  }

  return null;
};

const isPrepaidCustomer = (customer) => {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid') return true;
  if (explicit === 'postpaid') return false;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return true;
  if (billing.includes('postpaid')) return false;
  return false;
};

const resolveCustomerDisplayName = (row) => {
  const name = normalizeText(row?.name);
  if (name) return name;
  const first = normalizeText(row?.firstName);
  const last = normalizeText(row?.lastName);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return normalizeText(row?.accountNumber);
};

const resolveCustomerContactNumber = (row) => {
  const candidates = [
    row?.mobileRaw,
    row?.mobile,
    row?.contactNumber,
    row?.phone,
    row?.contact
  ];
  for (const candidate of candidates) {
    const value = normalizeText(candidate);
    if (value) return value;
  }
  return '';
};

function mapCollectorCustomerRow(row) {
  const mobileRaw = normalizeText(row?.mobileRaw);
  const mobile = normalizeText(row?.mobile);
  const contactNumber = resolveCustomerContactNumber({ ...row, mobileRaw, mobile });
  const resolvedName = resolveCustomerDisplayName(row);
  return {
    accountNumber: normalizeText(row?.accountNumber),
    customerName: resolvedName,
    name: resolvedName,
    firstName: normalizeText(row?.firstName),
    lastName: normalizeText(row?.lastName),
    mobileRaw,
    mobile,
    contactNumber,
    area: normalizeText(row?.area),
    status: normalizeCollectorCustomerStatus(row?.status),
    mapPin: normalizeText(row?.mapPin),
    coordinates: parseCoordinateValue(row?.mapPin),
    planName: normalizeText(row?.planName),
    planAmount: toPlanAmount(row?.planAmount),
    planBilling: normalizeText(row?.planBilling),
    planCategory: normalizeText(row?.planCategory),
    dueDate: normalizeDateOnly(row?.dueDate),
    nextDue: resolveCollectorNextDue(row)
  };
}

function mapCollectorPaymentRow(row) {
  return normalizePaymentEntry({
    id: row?.id,
    amount: row?.amount != null ? Number(row.amount) : 0,
    date: row?.date || row?.recordedAt || null,
    kind: row?.kind || undefined,
    reference: row?.reference || undefined,
    orNumber: row?.orNumber || undefined,
    description: row?.description || undefined,
    type: row?.type || undefined,
    direction: row?.direction || undefined,
    recordedAt: row?.recordedAt || undefined,
    recordedBy: row?.recordedByUserId ? {
      id: row.recordedByUserId,
      username: row.recordedByUsername || undefined,
      name: row.recordedByName || undefined,
      role: row.recordedByRole || undefined
    } : row?.recordedByUsername || row?.recordedByName ? {
      id: row?.recordedByUserId || undefined,
      username: row?.recordedByUsername || undefined,
      name: row?.recordedByName || undefined,
      role: row?.recordedByRole || undefined
    } : undefined,
    payer: row?.payer || undefined,
    fingerprint: row?.fingerprint || undefined,
    status: row?.status || undefined,
    paymentMethod: row?.paymentMethod || undefined,
    xenditId: row?.xenditId || undefined
  });
}

function normalizeCollectorHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const mapped = mapCollectorPaymentRow({
    id: entry.id,
    amount: entry.amount,
    date: entry.date || entry.recordedAt || null,
    kind: entry.kind,
    reference: entry.reference,
    orNumber: entry.orNumber,
    description: entry.description,
    type: entry.type,
    direction: entry.direction,
    recordedAt: entry.recordedAt,
    recordedByUserId: entry?.recordedBy?.id || entry?.recordedByUserId,
    recordedByUsername: entry?.recordedBy?.username || entry?.recordedByUsername,
    recordedByName: entry?.recordedBy?.name || entry?.recordedByName,
    recordedByRole: entry?.recordedBy?.role || entry?.recordedByRole,
    payer: entry.payer,
    fingerprint: entry.fingerprint,
    status: entry.status,
    paymentMethod: entry.paymentMethod,
    xenditId: entry.xenditId
  });
  return mapped?.id || mapped?.amount != null ? mapped : null;
}

const toCollectorAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
};

function parseCollectorEntryDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCollectorBillingMonth(value) {
  const parsed = parseCollectorEntryDate(value);
  if (!parsed) return '';
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function normalizeCollectorBillingMonthLabel(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const parsed = parseCollectorEntryDate(raw);
  return parsed ? formatCollectorBillingMonth(parsed) : raw;
}

function formatCollectorMonthlyBillLabel(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  if (/^Monthly\s+Bill\s+for\s+/i.test(normalized)) return normalized;
  return `${MONTHLY_BILL_LABEL_PREFIX}${normalized}`;
}

function resolveCollectorEntryDirection(entry) {
  const direction = normalizeText(entry?.direction).toLowerCase();
  if (direction === 'debit' || direction === 'credit') return direction;
  const kind = normalizeText(entry?.kind || entry?.type).toLowerCase();
  if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
  return 'credit';
}

function getCollectorEntryTimestamp(entry) {
  const direct = parseCollectorEntryDate(entry?.recordedAt || entry?.date)?.getTime();
  if (Number.isFinite(direct) && direct > 0) return direct;
  const idSuffix = normalizeText(entry?.id).match(/(\d{9,})$/);
  if (idSuffix?.[1]) {
    const parsed = Number(idSuffix[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getCollectorLedgerSortTimestamp(entry) {
  const direction = resolveCollectorEntryDirection(entry);
  const primary = direction === 'debit'
    ? (entry?.date || entry?.recordedAt || '')
    : (entry?.recordedAt || entry?.date || '');
  const primaryTime = parseCollectorEntryDate(primary)?.getTime();
  if (Number.isFinite(primaryTime) && primaryTime > 0) return primaryTime;
  return getCollectorEntryTimestamp(entry);
}

function resolveCollectorChargeMonth(entry) {
  const direct = normalizeCollectorBillingMonthLabel(
    entry?.coveredMonth ||
    entry?.billingMonth ||
    entry?.billMonth ||
    entry?.month ||
    entry?.period ||
    entry?.billingPeriod ||
    ''
  );
  if (direct) return formatCollectorMonthlyBillLabel(direct);

  const description = normalizeText(entry?.description || entry?.memo || entry?.notes);
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  if (monthMatch) return formatCollectorMonthlyBillLabel(normalizeCollectorBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`));

  return formatCollectorMonthlyBillLabel(formatCollectorBillingMonth(entry?.date || entry?.recordedAt || ''));
}

function resolveCollectorPaymentDescriptionMonth(entry) {
  const description = normalizeText(entry?.description || entry?.memo || entry?.notes);
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  return monthMatch ? formatCollectorMonthlyBillLabel(normalizeCollectorBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`)) : '';
}

function resolveCollectorPaymentFallbackMonth(entry) {
  return resolveCollectorPaymentDescriptionMonth(entry)
    || formatCollectorMonthlyBillLabel(formatCollectorBillingMonth(entry?.date || entry?.recordedAt || ''));
}

function pushCollectorBreakdownLine(items, label, amount) {
  const normalized = normalizeText(label);
  const amountValue = Number(amount);
  if (!normalized || !Number.isFinite(amountValue) || amountValue <= 0) return;
  const existing = items.find((item) => item.label === normalized);
  if (existing) {
    existing.amount = Number((Number(existing.amount || 0) + amountValue).toFixed(2));
    return;
  }
  items.push({
    label: normalized,
    amount: Number(amountValue.toFixed(2))
  });
}

function applyCollectorCreditToCharges(openCharges, amount, coveredBreakdown = null) {
  let remainingPayment = Number(amount);
  if (!Number.isFinite(remainingPayment) || remainingPayment <= 0) return;
  for (const charge of openCharges) {
    if (remainingPayment <= 0) break;
    const remainingCharge = Number(charge.remaining);
    if (!Number.isFinite(remainingCharge) || remainingCharge <= 0) continue;
    const applied = Math.min(remainingCharge, remainingPayment);
    if (coveredBreakdown) pushCollectorBreakdownLine(coveredBreakdown, charge.label, applied);
    charge.remaining = Number((remainingCharge - applied).toFixed(2));
    remainingPayment = Number((remainingPayment - applied).toFixed(2));
  }
}

function resolveLatestCollectorPayment(history = []) {
  return [...(Array.isArray(history) ? history : [])]
    .sort((left, right) => getCollectorEntryTimestamp(right) - getCollectorEntryTimestamp(left))
    .find((entry) => {
      const kind = normalizeText(entry?.kind || entry?.type).toLowerCase();
      const direction = resolveCollectorEntryDirection(entry);
      return direction === 'credit' && kind !== 'charge';
    }) || null;
}

function buildCollectorAssignedBreakdowns(history = []) {
  const latestPayment = resolveLatestCollectorPayment(history);
  const latestPaymentId = normalizeText(latestPayment?.id);
  const latestPaymentReference = normalizeText(latestPayment?.reference);
  const latestPaymentTimestamp = getCollectorEntryTimestamp(latestPayment);
  const latestPaymentAmount = Math.abs(Number(latestPayment?.amount) || 0);
  const coveredBillingBreakdown = [];
  const openCharges = [];
  let matchedLatestPayment = false;

  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      const amount = Math.abs(Number(entry?.amount) || 0);
      return {
        entry,
        index,
        amount,
        direction: resolveCollectorEntryDirection(entry),
        timestamp: getCollectorEntryTimestamp(entry),
        sortTimestamp: getCollectorLedgerSortTimestamp(entry)
      };
    })
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp - right.sortTimestamp;
      return left.index - right.index;
    });

  rows.forEach((row) => {
    const rowId = normalizeText(row.entry?.id);
    const rowReference = normalizeText(row.entry?.reference);
    const isLatestPayment = !matchedLatestPayment && latestPayment && (
      (latestPaymentId && rowId && latestPaymentId === rowId) ||
      (latestPaymentReference && rowReference && latestPaymentReference === rowReference) ||
      (
        row.direction === 'credit' &&
        latestPaymentTimestamp > 0 &&
        row.timestamp === latestPaymentTimestamp &&
        Math.abs(row.amount - latestPaymentAmount) < 0.0001
      )
    );

    if (row.direction === 'debit') {
      openCharges.push({
        label: resolveCollectorChargeMonth(row.entry),
        remaining: Number(row.amount.toFixed(2))
      });
      return;
    }

    applyCollectorCreditToCharges(openCharges, row.amount, isLatestPayment ? coveredBillingBreakdown : null);
    if (isLatestPayment) matchedLatestPayment = true;
  });

  if (!coveredBillingBreakdown.length && latestPayment) {
    pushCollectorBreakdownLine(
      coveredBillingBreakdown,
      resolveCollectorPaymentFallbackMonth(latestPayment),
      latestPaymentAmount
    );
  }

  const balanceBreakdown = openCharges
    .filter((charge) => Number(charge.remaining) > 0)
    .map((charge) => ({
      label: charge.label,
      amount: Number(Number(charge.remaining).toFixed(2))
    }));

  return {
    coveredBillingBreakdown,
    balanceBreakdown
  };
}

function buildCollectorBalanceSummary(history = []) {
  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => ({
      entry,
      index,
      amount: toCollectorAmount(entry?.amount),
      direction: resolveCollectorEntryDirection(entry),
      timestamp: getCollectorLedgerSortTimestamp(entry)
    }))
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
      return left.index - right.index;
    });

  const openCharges = [];
  let balance = 0;
  rows.forEach((row) => {
    if (row.direction === 'debit') {
      balance += row.amount;
      openCharges.push({
        label: resolveCollectorChargeMonth(row.entry),
        amount: Number(row.amount.toFixed(2)),
        paid: 0,
        balance: Number(row.amount.toFixed(2)),
        status: 'unpaid',
        date: row.entry?.date || row.entry?.recordedAt || null,
        entryId: normalizeText(row.entry?.id)
      });
      return;
    }

    balance -= row.amount;
    let remainingCredit = row.amount;
    openCharges.forEach((charge) => {
      if (remainingCredit <= 0 || charge.balance <= 0) return;
      const applied = Math.min(charge.balance, remainingCredit);
      charge.paid = Number((charge.paid + applied).toFixed(2));
      charge.balance = Number((charge.balance - applied).toFixed(2));
      charge.status = charge.balance <= 0 ? 'paid' : 'partial';
      remainingCredit = Number((remainingCredit - applied).toFixed(2));
    });
  });

  const balanceBreakdown = openCharges
    .filter((charge) => charge.balance > 0)
    .map((charge) => ({
      ...charge,
      status: charge.paid > 0 ? 'partial' : 'unpaid'
    }));

  return {
    balance: Number(balance.toFixed(2)),
    outstandingBalance: Number(Math.max(balance, 0).toFixed(2)),
    advanceBalance: Number(Math.max(-balance, 0).toFixed(2)),
    balanceBreakdown
  };
}

function resolveCollectorCurrentBillBalance(customer = {}, history = [], balanceSummary = {}) {
  const fallbackBalance = Number(balanceSummary?.balance);
  const fallback = Number.isFinite(fallbackBalance) ? fallbackBalance : 0;
  try {
    const breakdown = calculatePaymentBreakdownEndingBalance({
      ...customer,
      history
    });
    const endingBalance = Number(breakdown?.endingBalance);
    return Number.isFinite(endingBalance) ? Number(endingBalance.toFixed(2)) : Number(fallback.toFixed(2));
  } catch (error) {
    console.warn(
      `Unable to calculate collector current bill balance for ${customer?.accountNumber || 'unknown account'}:`,
      error?.message || error
    );
    return Number(fallback.toFixed(2));
  }
}

async function readCollectorPaymentHistoryByAccountNumbers(accountNumbers = [], branchId = null) {
  const safeAccountNumbers = Array.from(
    new Set((Array.isArray(accountNumbers) ? accountNumbers : []).map((value) => normalizeText(value)).filter(Boolean))
  );
  const historyByAccount = new Map();
  safeAccountNumbers.forEach((accountNumber) => historyByAccount.set(accountNumber, []));
  if (!safeAccountNumbers.length) return historyByAccount;

  try {
    if (await isRelationalReady()) {
      const placeholders = safeAccountNumbers.map(() => '?').join(', ');
      const scopedBranchId = resolveBranchId(branchId);
      const branchClause = scopedBranchId ? 'branch_id = ? AND ' : '';
      const params = scopedBranchId
        ? [scopedBranchId, ...safeAccountNumbers]
        : safeAccountNumbers;
      const [rows] = await query(
        `SELECT
           id,
           branch_id AS branchId,
           account_number AS accountNumber,
           amount,
           date,
           kind,
           direction,
           reference,
           or_number AS orNumber,
           description,
           type,
           recorded_at AS recordedAt,
           recorded_by_user_id AS recordedByUserId,
           recorded_by_username AS recordedByUsername,
           recorded_by_name AS recordedByName,
           recorded_by_role AS recordedByRole,
           payer,
           status,
           payment_method AS paymentMethod,
           fingerprint,
           xendit_id AS xenditId
         FROM payment_entries
         WHERE ${branchClause}account_number IN (${placeholders})
         ORDER BY account_number ASC, recorded_at DESC, date DESC, id DESC`,
        params
      );

      (rows || []).forEach((row) => {
        const accountNumber = normalizeText(row?.accountNumber);
        if (!accountNumber) return;
        if (!historyByAccount.has(accountNumber)) historyByAccount.set(accountNumber, []);
        historyByAccount.get(accountNumber).push(mapCollectorPaymentRow(row));
      });
      return historyByAccount;
    }

    const payments = await readJson('payments', {});
    safeAccountNumbers.forEach((accountNumber) => {
      const rawHistory = Array.isArray(payments?.[accountNumber]?.history) ? payments[accountNumber].history : [];
      historyByAccount.set(
        accountNumber,
        rawHistory.map((entry) => normalizeCollectorHistoryEntry(entry)).filter(Boolean)
      );
    });
    return historyByAccount;
  } catch (error) {
    console.warn('Unable to read collector transaction history:', error?.message || error);
    return historyByAccount;
  }
}

async function readCollectorPaymentRecordsByAccountNumbers(accountNumbers = [], branchId = null) {
  const safeAccountNumbers = Array.from(
    new Set((Array.isArray(accountNumbers) ? accountNumbers : []).map((value) => normalizeText(value)).filter(Boolean))
  );
  const recordsByAccount = new Map();
  if (!safeAccountNumbers.length) return recordsByAccount;

  await Promise.all(safeAccountNumbers.map(async (accountNumber) => {
    try {
      const record = await paymentRecordsRouter.buildPaymentRecordForAccount(accountNumber, branchId);
      if (record) recordsByAccount.set(accountNumber, record);
    } catch (error) {
      console.warn(
        `Unable to load admin payment record for collector account ${accountNumber}:`,
        error?.message || error
      );
    }
  }));

  return recordsByAccount;
}

async function readAssignedCustomerTransactionRecordsForCollector(collector) {
  const assignedCustomers = await readAssignedCustomersForCollector(collector);
  const assignedAccountNumbers = assignedCustomers.map((customer) => customer.accountNumber);
  const branchId = resolveBranchId(collector?.branchId);
  const historyByAccount = await readCollectorPaymentHistoryByAccountNumbers(
    assignedAccountNumbers,
    branchId
  );
  const paymentRecordByAccount = await readCollectorPaymentRecordsByAccountNumbers(assignedAccountNumbers, branchId);
  return assignedCustomers.map((customer) => {
    const history = historyByAccount.get(customer.accountNumber) || [];
    const paymentRecord = paymentRecordByAccount.get(customer.accountNumber) || null;
    const breakdowns = buildCollectorAssignedBreakdowns(history);
    const balanceSummary = buildCollectorBalanceSummary(history);
    const adminEndingBalance = Number(
      paymentRecord?.paymentBreakdownEndingBalance
      ?? paymentRecord?.endingBalance
    );
    const currentBillBalance = Number.isFinite(adminEndingBalance)
      ? Number(adminEndingBalance.toFixed(2))
      : resolveCollectorCurrentBillBalance(paymentRecord || customer, paymentRecord?.history || history, balanceSummary);
    const outstandingBalance = Number(Math.max(currentBillBalance, 0).toFixed(2));
    const advanceBalance = Number(Math.max(-currentBillBalance, 0).toFixed(2));
    return {
      ...customer,
      balance: currentBillBalance,
      currentBalance: outstandingBalance,
      paymentBreakdownEndingBalance: currentBillBalance,
      endingBalance: currentBillBalance,
      outstandingBalance,
      advanceBalance,
      transactionCount: history.length,
      coveredBillingBreakdown: breakdowns.coveredBillingBreakdown,
      balanceBreakdown: balanceSummary.balanceBreakdown,
      receiptBreakdown: {
        coveredBillingBreakdown: breakdowns.coveredBillingBreakdown,
        balanceBreakdown: breakdowns.balanceBreakdown
      },
      history
    };
  });
}

async function readCollectorPonState(branchId = null) {
  const allState = await readJson(PON_STATE_STORE_KEY, {});
  const branchKey = String(resolveBranchId(branchId) || '1');
  const scoped = allState?.branches?.[branchKey] || allState?.default || {};
  return {
    naps: Array.isArray(scoped?.naps) ? scoped.naps : []
  };
}

async function readAssignedCustomersForCollector(collector) {
  const collectorId = normalizeText(collector?.id);
  if (!collectorId) return [];

  try {
    if (await isRelationalReady()) {
      let scopedBranchId = resolveBranchId(collector?.branchId);
      if (!scopedBranchId) {
        const [branchRows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
        scopedBranchId = branchRows && branchRows.length ? Number(branchRows[0].id) : null;
      }
      if (!scopedBranchId) return [];

      const [assignmentRows] = await query(
        `SELECT DISTINCT COALESCE(NULLIF(TRIM(ca.area_name), ''), cov.name) AS areaName
         FROM collector_assignments ca
         LEFT JOIN coverage_areas cov
           ON cov.id = ca.coverage_id
          AND cov.branch_id = ca.branch_id
         WHERE ca.branch_id = ?
           AND ca.collector_user_id = ?`,
        [scopedBranchId, collectorId]
      );

      const areas = Array.from(
        new Set(
          (assignmentRows || [])
            .map((row) => normalizeText(row?.areaName))
            .filter(Boolean)
        )
      );
      if (!areas.length) return [];

      const placeholders = areas.map(() => '?').join(', ');
      const normalizedAreaParams = areas.map((area) => area.toLowerCase());
      const [customerRows] = await query(
        `SELECT
           c.account_number AS accountNumber,
           c.name,
           c.first_name AS firstName,
           c.last_name AS lastName,
           c.mobile_raw AS mobileRaw,
           c.mobile,
           c.area,
           c.status,
           c.map_pin AS mapPin,
           c.plan_name AS planName,
           c.plan_amount AS planAmount,
           c.plan_billing AS planBilling,
           c.plan_category AS planCategory,
           c.bill_date AS billDate,
           c.due_offset AS dueOffset,
           c.due_date AS dueDate
         FROM customers c
         WHERE c.branch_id = ?
           AND LOWER(TRIM(COALESCE(c.area, ''))) IN (${placeholders})
         ORDER BY c.name ASC, c.last_name ASC, c.first_name ASC, c.account_number ASC`,
        [scopedBranchId, ...normalizedAreaParams]
      );

      return (customerRows || [])
        .map(mapCollectorCustomerRow)
        .filter((row) => row.accountNumber);
    }

    const collectorsFile = await readJson(COLLECTORS_STORE_KEY, { assignments: {} });
    const assignments = collectorsFile?.assignments && typeof collectorsFile.assignments === 'object'
      ? collectorsFile.assignments
      : {};
    const assignedAreas = Array.from(
      new Set(
        Object.entries(assignments)
          .filter(([, assignedCollectorId]) => {
            const assignedCollectorIds = Array.isArray(assignedCollectorId)
              ? assignedCollectorId
              : [assignedCollectorId];
            return assignedCollectorIds
              .map((value) => normalizeText(value))
              .filter(Boolean)
              .includes(collectorId);
          })
          .map(([area]) => normalizeText(area))
          .map((area) => area.toLowerCase())
          .filter(Boolean)
      )
    );
    if (!assignedAreas.length) return [];

    const areaSet = new Set(assignedAreas);
    const customers = await readJson(CUSTOMERS_STORE_KEY, []);
    return (Array.isArray(customers) ? customers : [])
      .map((row) => mapCollectorCustomerRow(row))
      .filter((row) => row.accountNumber && areaSet.has(row.area.toLowerCase()));
  } catch (error) {
    console.warn('Unable to read collector assigned customers:', error?.message || error);
    return [];
  }
}

async function readBusinessProfileForBranch(branchId = null) {
  try {
    if (await isRelationalReady()) {
      let scopedBranchId = resolveBranchId(branchId);
      if (!scopedBranchId) {
        const [rows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
        scopedBranchId = rows && rows.length ? Number(rows[0].id) : null;
      }
      if (scopedBranchId) {
        const [rows] = await query(
          `SELECT business_name, tagline, support_email, contact, address, logo_base64
           FROM business_profiles
           WHERE branch_id = ?
           LIMIT 1`,
          [scopedBranchId]
        );
        if (rows && rows.length) {
          const row = rows[0] || {};
          return normalizeBusinessProfile({
            businessName: row.business_name,
            tagline: row.tagline,
            supportEmail: row.support_email,
            contact: row.contact,
            address: row.address,
            logoUrl: row.logo_base64
          });
        }
      }
      return { ...DEFAULT_BUSINESS_PROFILE };
    }

    const stored = await readJson(BUSINESS_PROFILE_STORE_KEY, null);
    return normalizeBusinessProfile(stored);
  } catch (error) {
    console.warn('Unable to read business profile for collector login:', error?.message || error);
    return { ...DEFAULT_BUSINESS_PROFILE };
  }
}

function isFixedAdminAccountId(id) {
  const normalized = String(id);
  return normalized === '1' || isSystemAccountId(normalized) || isBackupAdminId(normalized);
}

function loadServiceConfig() {
  if (cachedServiceConfig) return cachedServiceConfig;
  try {
    const raw = fs.readFileSync(SERVICE_CONFIG_FILE, 'utf8');
    cachedServiceConfig = JSON.parse(raw);
  } catch (error) {
    cachedServiceConfig = {};
  }
  return cachedServiceConfig;
}

function findServiceForApp(appName) {
  const normalized = String(appName || '').trim().toLowerCase();
  if (!normalized) return null;
  const config = loadServiceConfig();
  const services = Array.isArray(config.services) ? config.services : [];
  return services.find((svc) => {
    return (
      svc.isActive !== false &&
      String(svc.app || '').trim().toLowerCase() === normalized
    );
  }) || null;
}

function extractSessionId(cookieHeader = '') {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  return parts.map((part) => part.trim()).find((part) => part.startsWith('sessionId='));
}

async function proxyToService(req, res, service) {
  if (!service || !service.url) {
    return res.status(500).json({ error: `${service?.name || 'Service'} is not configured` });
  }

  const controller = new AbortController();
  const timeoutMs = Number(service.timeoutMs) || 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const payload = { ...(req.body || {}), app: service.app || req.body?.app };

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
    res.status(upstreamResponse.status);

    if (contentType.toLowerCase().includes('application/json')) {
      try {
        const parsed = responseText ? JSON.parse(responseText) : {};
        return res.type('application/json').json(parsed);
      } catch (error) {
        res.type('application/json');
        return res.send(responseText);
      }
    }

    res.setHeader('Content-Type', contentType);
    return res.send(responseText);
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: `${service.name || 'Service'} did not respond in time` });
    }
    console.error('Service proxy error:', error);
    return res.status(502).json({ error: `${service.name || 'Service'} is unavailable` });
  } finally {
    clearTimeout(timer);
  }
}

async function handleCustomerLoginProxy(req, res, service) {
  if (!service || !service.url) {
    return res.status(500).json({ error: 'Customer service is not configured' });
  }

  const controller = new AbortController();
  const timeoutMs = Number(service.timeoutMs) || 5000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const payload = { ...(req.body || {}), app: service.app || req.body?.app };
  const baseUrl = String(service.url || '').replace(/\/+$/, '');
  const loginPath = service.loginPath ? service.loginPath : '/api/auth/login';
  const targetUrl = `${baseUrl}${loginPath}`;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const rawText = await upstreamResponse.text();
    if (!upstreamResponse.ok) {
      return res.status(upstreamResponse.status).type('application/json').send(rawText);
    }

    let parsed = {};
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      parsed = {};
    }

    const sessionCookie = extractSessionId(upstreamResponse.headers.get('set-cookie') || '');
    if (!sessionCookie) {
      return res.status(502).json({ error: 'Customer backend did not issue a session cookie' });
    }

    const token = issueToken({
      app: service.app || 'customer',
      username: payload.username || payload.user || payload.email,
    });
    const customerMeta = parsed.customer || parsed.user || parsed || {};
    storeSession(token, sessionCookie, {
      upstream: service.url,
      customer: customerMeta,
    });

    return res.json({
      ok: true,
      loginType: resolveLoginType(service.app),
      token,
      data: parsed,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: `${service.name || 'Service'} did not respond in time` });
    }
    console.error('Customer proxy error:', error);
    return res.status(502).json({ error: `${service.name || 'Service'} is unavailable` });
  } finally {
    clearTimeout(timer);
  }
}

async function loadPersistedSessions() {
  try {
    if (await isRelationalReady()) {
      const [rows] = await query('SELECT session_id, user_id, created_at FROM sessions');
      (rows || []).forEach((row) => {
        const createdAt = Number(row.created_at);
        if (!Number.isFinite(createdAt) || createdAt <= 0) return;
        if (Date.now() - createdAt > SESSION_TTL_MS) return;
        sessions.set(row.session_id, { userId: String(row.user_id), createdAt });
      });
      return;
    }
    const parsed = await readJson(SESSION_STORE_KEY, {});
    const stored = parsed && typeof parsed.sessions === 'object' ? parsed.sessions : {};
    Object.entries(stored).forEach(([sid, value]) => {
      if (value && value.userId) {
        const createdAt = Number(value.createdAt);
        if (!Number.isFinite(createdAt) || createdAt <= 0) return;
        if (Date.now() - createdAt > SESSION_TTL_MS) return;
        sessions.set(sid, value);
      }
    });
  } catch (e) {
    console.warn('Failed to load session store:', e.message);
  }
}

async function persistSessions() {
  try {
    if (await isRelationalReady()) {
      for (const [sid, value] of sessions.entries()) {
        await query(
          `INSERT INTO sessions (session_id, user_id, created_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             user_id = VALUES(user_id),
             created_at = VALUES(created_at)`,
          [sid, String(value.userId), Number(value.createdAt)]
        );
      }
      return;
    }
    const payload = {
      sessions: Object.fromEntries(sessions),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(SESSION_STORE_KEY, payload);
  } catch (e) {
    console.warn('Failed to persist session store:', e.message);
  }
}

// hydrate sessions on boot so login state is shared across browsers and survives restarts
loadPersistedSessions().catch((e) => {
  console.warn('Failed to load session store:', e.message);
});

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, part) => {
    const [k, ...v] = part.trim().split('=');
    if (!k) return acc;
    acc[decodeURIComponent(k)] = decodeURIComponent(v.join('=') || '');
    return acc;
  }, {});
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = cookies[SESSION_COOKIE_NAME];
  if (!sid) return null;
  const sess = sessions.get(sid);
  if (!sess) return null;
  const createdAt = Number(sess.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    sessions.delete(sid);
    persistSessions().catch(() => {});
    return null;
  }
  if (Date.now() - createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    persistSessions().catch(() => {});
    return null;
  }
  return { ...sess, sessionId: sid };
}

async function getUserFromSession(req) {
  const sess = getSession(req);
  if (!sess) return null;
  const accounts = await loadAccounts({ includeSystem: true });
  const u = accounts.find(a => a.id === sess.userId);
  if (!u) return null;
  // Enforce fixed role for id 1
  const roles = isFixedAdminAccountId(u.id)
    ? ['Admin']
    : normalizeRoles(u.roles || u.role, [u.role || 'Collector']);
  const role = rolesToStoredValue(roles, u.role || 'Collector');
  const branchId = resolveBranchId(u.branchId || u.branch_id);
  return {
    id: u.id,
    username: u.username,
    role,
    roles,
    name: u.name || u.username,
    branchId,
    sessionId: sess.sessionId || null,
    sessionCreatedAt: sess.createdAt || null,
  };
}

function getUserFromBasicAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  const token = header.slice(6).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64').toString('utf8');
  } catch (_e) {
    return null;
  }
  const [user, ...rest] = decoded.split(':');
  const pass = rest.join(':');
  const expectedUser = process.env.BILLING_BASIC_USER || '';
  const expectedPass = process.env.BILLING_BASIC_PASS || '';
  if (!expectedUser || !expectedPass) return null;
  if (user === expectedUser && pass === expectedPass) {
    return { id: 'basic', username: user, role: 'Service', name: user };
  }
  return null;
}

function resolveLoginType(role) {
  if (accountHasRole(role, 'Admin')) return 'Admin';
  if (accountHasRole(role, 'Technician')) return 'Technician';
  if (accountHasRole(role, 'Collector')) return 'Collector';
  if (String(role || '').trim().toLowerCase() === 'customer') return 'Customer';
  return getPrimaryRole(role, String(role || '').trim() || 'User');
}

function normalizeLoginIdentifier(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  return raw.includes('@') ? raw.split('@')[0].toLowerCase() : raw.toLowerCase();
}

function resolveDedicatedLoginRoute(roleOrApp) {
  if (accountHasRole(roleOrApp, 'Technician')) {
    return { label: 'Technician', path: '/api/auth/technician-login' };
  }
  if (accountHasRole(roleOrApp, 'Collector')) {
    return { label: 'Collector', path: '/api/auth/collector-login' };
  }
  return null;
}

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (!header) return '';
  const match = header.match(/Bearer\s+(.+)/i);
  return match ? String(match[1] || '').trim() : '';
}

function logCollectorAuthFailure(req, reason) {
  const method = String(req.method || 'REQUEST').trim() || 'REQUEST';
  const route = String(req.originalUrl || req.url || '/').trim() || '/';
  const remoteAddress = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '')
    .split(',')[0]
    .trim() || 'unknown-ip';
  console.warn(`[collector-auth] ${reason} [${method} ${route}] from ${remoteAddress}`);
}

function buildCollectorProfile(account) {
  const branchId = resolveBranchId(account?.branchId || account?.branch_id);
  return {
    id: String(account?.id || '').trim(),
    username: String(account?.username || '').trim(),
    role: 'Collector',
    name: String(account?.name || account?.username || '').trim() || 'Collector',
    branchId
  };
}

async function buildCollectorLoginPayload(account) {
  const collector = buildCollectorProfile(account);
  const loginType = 'Collector';
  const businessProfile = await readBusinessProfileForBranch(collector.branchId);
  const assignedCustomers = await readAssignedCustomerTransactionRecordsForCollector(collector);
  return {
    collector,
    collectorPayload: { ...collector, loginType, businessProfile, assignedCustomers },
    businessProfile,
    assignedCustomers,
    loginType
  };
}

async function loadCollectorByToken(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { collector: null, error: { status: 401, message: 'Collector authorization is required.' } };
  }

  const verification = verifyTokenDetailed(token);
  if (!verification?.ok) {
    if (verification?.reason === 'expired') {
      logCollectorAuthFailure(req, 'Expired collector token');
      return { collector: null, error: { status: 401, message: 'Collector session expired. Please sign in again.' } };
    }
    const invalidReason = isEphemeralSessionSecret
      ? 'Invalid collector token; possible server restart with temporary session secret'
      : 'Invalid collector token';
    logCollectorAuthFailure(req, invalidReason);
    return { collector: null, error: { status: 401, message: 'Collector session is invalid. Please sign in again.' } };
  }

  const payload = verification.payload || {};
  if (payload.scope !== COLLECTOR_TOKEN_SCOPE) {
    logCollectorAuthFailure(req, `Wrong collector token scope (${String(payload.scope || 'none')})`);
    return { collector: null, error: { status: 401, message: 'Collector token is not authorized for this app.' } };
  }

  const collectorId = String(payload.sub || '').trim();
  if (!collectorId) {
    return { collector: null, error: { status: 401, message: 'Collector session is invalid.' } };
  }

  const accounts = await loadAccounts();
  const match = accounts.find((account) =>
    String(account.id || '').trim() === collectorId &&
    accountHasRole(account, 'Collector')
  );
  if (!match) {
    return { collector: null, error: { status: 401, message: 'Collector account was not found.' } };
  }

  return { collector: buildCollectorProfile(match), error: null };
}

async function requireCollectorTokenAuth(req, res, next) {
  const { collector, error } = await loadCollectorByToken(req);
  if (error) {
    return res.status(error.status).json({ error: error.message });
  }
  req.collector = collector;
  next();
}

async function findMatchingLocalAppAccount(idOrName, password) {
  if (!idOrName || !password) return null;
  const accounts = await loadAccounts();
  const match = accounts.find((account) => {
    if (!accountHasAnyRole(account, ['Technician', 'Collector'])) return false;
    return String(account.username || '').trim().toLowerCase() === idOrName;
  });
  if (!match) return null;
  return verifyPassword(password, String(match.password || '')) ? match : null;
}

async function requireAuth(req, res, next) {
  const basicUser = getUserFromBasicAuth(req);
  if (basicUser) {
    req.user = basicUser;
    return next();
  }

  const user = await getUserFromSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!accountHasRole(user, 'Admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  refreshAdminSession(req, res, user);
  req.user = user;
  next();
}

async function requireCollectorOrAdminAuth(req, res, next) {
  const basicUser = getUserFromBasicAuth(req);
  if (basicUser) {
    req.user = basicUser;
    return next();
  }

  const user = await getUserFromSession(req);
  if (user) {
    if (accountHasRole(user, 'Admin')) {
      refreshAdminSession(req, res, user);
      req.user = user;
      return next();
    }
    return res.status(403).json({ error: 'Admin or collector access required' });
  }

  const { collector, error } = await loadCollectorByToken(req);
  if (error) {
    return res.status(error.status).json({ error: error.message });
  }
  req.collector = collector;
  next();
}

function setSessionCookie(req, res, sessionId) {
  const isSecure = !!(req.secure || (req.headers['x-forwarded-proto'] || '').includes('https'));
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];
  if (isSecure) attrs.push('Secure');
  // 12 hours expiry
  attrs.push(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  const isSecure = !!(req.secure || (req.headers['x-forwarded-proto'] || '').includes('https'));
  const attrs = [
    `${SESSION_COOKIE_NAME}=;`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function refreshAdminSession(req, res, user) {
  const sessionId = String(user?.sessionId || '').trim();
  const createdAt = Number(user?.sessionCreatedAt || 0);
  if (!sessionId || !Number.isFinite(createdAt) || createdAt <= 0) return;
  if (Date.now() - createdAt < SESSION_TOUCH_INTERVAL_MS) return;

  const current = sessions.get(sessionId);
  if (!current) return;
  current.createdAt = Date.now();
  sessions.set(sessionId, current);
  persistSessions().catch(() => {});
  setSessionCookie(req, res, sessionId);
}

const router = express.Router();

function isBackupAdminDefaultPassword(account) {
  if (!account || !isBackupAdminId(account.id)) return false;
  return verifyPassword(DEFAULT_BACKUP_PASSWORD, String(account.password || ''));
}

function isBackupAdminDefaultUsername(account) {
  if (!account || !isBackupAdminId(account.id)) return false;
  return String(account.username || '').trim().toLowerCase() === BACKUP_ADMIN_USERNAME;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const appName = String(req.body?.app || '').trim();
  const { email, username, user: userField, password } = req.body || {};
  const raw = (username || email || userField || '').trim();
  const idOrName = normalizeLoginIdentifier(raw);
  const pass = typeof password === 'string' ? password : '';
  const requestedRoute = resolveDedicatedLoginRoute(appName);
  if (requestedRoute) {
    console.warn(
      'Rejected misrouted login request on /api/auth/login for',
      idOrName ? `"${idOrName}"` : '[empty username]',
      'requested app',
      `"${appName}"`,
      'expected',
      requestedRoute.path,
      'at',
      new Date().toISOString()
    );
    return res.status(400).json({ error: `${requestedRoute.label} accounts must use ${requestedRoute.path}` });
  }
  const service = findServiceForApp(appName);
  if (service) {
    const localAppAccount = await findMatchingLocalAppAccount(idOrName, pass);
    if (localAppAccount) {
      const expectedRoute = resolveDedicatedLoginRoute(localAppAccount.role);
      console.warn(
        'Rejected misrouted customer-service login for local',
        resolveLoginType(localAppAccount.role),
        'account',
        idOrName ? `"${idOrName}"` : '[empty username]',
        'requested app',
        `"${appName}"`,
        'expected',
        expectedRoute?.path || '[unknown route]',
        'at',
        new Date().toISOString()
      );
      return res.status(400).json({
        error: `${resolveLoginType(localAppAccount.role)} accounts must use ${expectedRoute.path}`
      });
    }
    return handleCustomerLoginProxy(req, res, service);
  }

  // Do not accept passwords with leading/trailing whitespace
  if (pass !== pass.replace(/^\s+|\s+$/g, '')) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const accounts = await loadAccounts({ includeSystem: true });
  const match = accounts.find(u => String(u.username).toLowerCase() === idOrName);
  const passwordOk = match ? verifyPassword(pass, String(match.password || '')) : false;
  if (!match || !passwordOk) {
    // Minimal diagnostic to help during setup; remove or lower in production
    console.warn(
      'Login failed for',
      idOrName ? `"${idOrName}"` : '[empty username]',
      'on /api/auth/login',
      'app',
      appName ? `"${appName}"` : '[admin portal]',
      'at',
      new Date().toISOString()
    );
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!isHashedPassword(String(match.password || '')) && !isSystemAccount(match)) {
    try {
      match.password = hashPassword(pass);
      await saveAccounts(accounts);
    } catch (e) {
      console.warn('Failed to upgrade account password hash:', e?.message || e);
    }
  }
  // normalize to user object shape; enforce role for id 1
  const userRoles = isFixedAdminAccountId(match.id)
    ? ['Admin']
    : normalizeRoles(match.roles || match.role, [match.role || 'Collector']);
  const user = {
    id: String(match.id),
    username: match.username,
    role: rolesToStoredValue(userRoles, match.role || 'Collector'),
    roles: userRoles,
    name: match.name || match.username
  };
  if (!accountHasRole(user, 'Admin')) {
    const expectedRoute = resolveDedicatedLoginRoute(user.role);
    if (expectedRoute) {
      console.warn(
        'Rejected non-admin login on /api/auth/login for',
        idOrName ? `"${idOrName}"` : '[empty username]',
        'role',
        `"${resolveLoginType(user.role)}"`,
        'expected',
        expectedRoute.path,
        'at',
        new Date().toISOString()
      );
      return res.status(400).json({ error: `${resolveLoginType(user.role)} accounts must use ${expectedRoute.path}` });
    }
    return res.status(403).json({ error: 'Only Admin accounts are allowed to log into the web console' });
  }

  // create a session
  const sid = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { userId: user.id, createdAt: Date.now() });
  await persistSessions();
  setSessionCookie(req, res, sid);
  const loginType = resolveLoginType(user.role);
  const responseUser = { id: user.id, username: user.username, role: user.role, roles: user.roles, name: user.name, loginType };
  const mustChangePassword = isBackupAdminDefaultPassword(match);
  const mustChangeUsername = isBackupAdminDefaultUsername(match);
  await appendActivityLog({
    message: `Signed in as ${user.username}`,
    meta: user.role ? `Role: ${user.role}` : '',
    userId: user.id,
    username: user.username
  });

  res.json({
    ok: true,
    loginType,
    user: responseUser,
    mustChangePassword,
    mustChangeUsername
  });
});

// POST /api/auth/collector-login
// Lightweight login for collector/mobile app; issues a bearer token and does not create an admin session
router.post('/collector-login', async (req, res) => {
  const { email, username, user: userField, password } = req.body || {};
  const raw = (username || email || userField || '').trim();
  const idOrName = raw.includes('@') ? raw.split('@')[0].toLowerCase() : raw.toLowerCase();
  const pass = typeof password === 'string' ? password : '';
  if (pass !== pass.replace(/^\s+|\s+$/g, '')) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accounts = await loadAccounts();
  const match = accounts.find(u =>
    accountHasRole(u, 'Collector') &&
    String(u.username).toLowerCase() === idOrName
  );
  const passwordOk = match ? verifyPassword(pass, String(match.password || '')) : false;

  if (!match || !passwordOk) {
    console.warn('Collector login failed for', idOrName ? `"${idOrName}"` : '[empty username]', 'at', new Date().toISOString());
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!isHashedPassword(String(match.password || ''))) {
    try {
      match.password = hashPassword(pass);
      await saveAccounts(accounts);
    } catch (e) {
      console.warn('Failed to upgrade collector password hash:', e?.message || e);
    }
  }

  const {
    collector,
    collectorPayload,
    businessProfile,
    assignedCustomers,
    loginType
  } = await buildCollectorLoginPayload(match);
  const token = issueToken(
    {
      scope: COLLECTOR_TOKEN_SCOPE,
      app: 'collector',
      sub: collector.id,
      role: collector.role,
      username: collector.username,
      branchId: collector.branchId
    },
    { expiresIn: COLLECTOR_SESSION_TTL_SECONDS }
  );
  await appendActivityLog({
    message: `Collector ${collector.username} signed in`,
    meta: 'Collector login',
    userId: collector.id,
    username: collector.username
  });

  res.json({
    ok: true,
    loginType,
    token,
    expiresInSeconds: COLLECTOR_SESSION_TTL_SECONDS,
    collector: collectorPayload,
    businessProfile,
    assignedCustomers
  });
});

router.get('/collector-me', requireCollectorTokenAuth, async (req, res) => {
  const {
    collectorPayload,
    businessProfile,
    assignedCustomers,
    loginType
  } = await buildCollectorLoginPayload(req.collector);
  res.json({
    ok: true,
    loginType,
    collector: collectorPayload,
    businessProfile,
    assignedCustomers
  });
});

router.get('/collector-transactions', requireCollectorTokenAuth, async (req, res) => {
  const loginType = 'Collector';
  const businessProfile = await readBusinessProfileForBranch(req.collector?.branchId);
  const records = await readAssignedCustomerTransactionRecordsForCollector(req.collector);
  res.json({
    ok: true,
    loginType,
    collector: { ...req.collector, loginType },
    businessProfile,
    assignedCustomersCount: records.length,
    assignedCustomers: records,
    records
  });
});

router.get('/collector-payment-record/:accountNumber', requireCollectorTokenAuth, async (req, res) => {
  const accountNumber = normalizeText(req.params?.accountNumber);
  if (!accountNumber) {
    return res.status(400).json({ error: 'Account number is required.' });
  }

  const assignedCustomers = await readAssignedCustomersForCollector(req.collector);
  const assigned = (assignedCustomers || []).find((customer) => normalizeText(customer?.accountNumber) === accountNumber);
  if (!assigned) {
    return res.status(404).json({ error: 'Payment record was not found for this collector.' });
  }

  const record = await paymentRecordsRouter.buildPaymentRecordForAccount(
    accountNumber,
    resolveBranchId(req.collector?.branchId)
  );
  if (!record) {
    return res.status(404).json({ error: 'Payment record was not found.' });
  }

  res.json({
    ok: true,
    collector: { ...req.collector, loginType: 'Collector' },
    record
  });
});

router.get('/collector-map-data', requireCollectorTokenAuth, async (req, res) => {
  const records = await readAssignedCustomerTransactionRecordsForCollector(req.collector);
  const assignedAccounts = new Set(
    (records || [])
      .map((customer) => normalizeText(customer?.accountNumber))
      .filter(Boolean)
  );
  const assignedAreas = new Set(
    (records || [])
      .map((customer) => normalizeText(customer?.area).toLowerCase())
      .filter(Boolean)
  );
  const branchId = resolveBranchId(req.collector?.branchId);
  let ponState = { naps: [] };
  try {
    ponState = await readCollectorPonState(branchId);
  } catch (error) {
    ponState = { naps: [], mapWarning: error?.message || 'Unable to load NAP map data.' };
  }

  const naps = (Array.isArray(ponState?.naps) ? ponState.naps : [])
    .filter((nap) => {
      const napArea = normalizeText(nap?.location || nap?.area).toLowerCase();
      if (napArea && assignedAreas.has(napArea)) return true;
      const connections = Array.isArray(nap?.connections) ? nap.connections : [];
      return connections.some((entry) => {
        const accountCandidates = [
          normalizeText(entry?.customerId),
          normalizeText(entry?.accountNumber),
          normalizeText(entry?.customerRef)
        ].filter(Boolean);
        return accountCandidates.some((account) => assignedAccounts.has(account));
      });
    })
    .map((nap) => ({
      id: normalizeText(nap?.id),
      code: normalizeText(nap?.code),
      location: normalizeText(nap?.location || nap?.area),
      coordinate: normalizeText(nap?.coordinate || nap?.coordinates || nap?.coords),
      linkedOlt: normalizeText(nap?.linkedOlt),
      ponRef: normalizeText(nap?.ponRef),
      splitter: normalizeText(nap?.splitter),
      capacity: Number(nap?.capacity || 0) || 0,
      used: Number(nap?.used || 0) || 0,
      opticalPower: normalizeText(nap?.opticalPower),
      connections: (Array.isArray(nap?.connections) ? nap.connections : [])
        .map((entry) => ({
          customerId: normalizeText(entry?.customerId || entry?.accountNumber),
          customerName: normalizeText(entry?.customerName),
          customerRef: normalizeText(entry?.customerRef),
          port: entry?.port || null,
          opticalInfo: normalizeText(entry?.opticalInfo || entry?.opticalPower)
        }))
        .filter((entry) => (
          assignedAccounts.has(entry.customerId) ||
          assignedAccounts.has(entry.customerRef) ||
          entry.customerName
        ))
    }));

  res.json({
    ok: true,
    collector: { ...req.collector, loginType: 'Collector' },
    customers: records,
    naps,
    warning: ponState?.mapWarning || ''
  });
});

// POST /api/auth/technician-login
// Lightweight login for technician/mobile app; does not create an admin session
router.post('/technician-login', async (req, res) => {
  const { email, username, user: userField, password } = req.body || {};
  const raw = (username || email || userField || '').trim();
  const idOrName = raw.includes('@') ? raw.split('@')[0].toLowerCase() : raw.toLowerCase();
  const pass = typeof password === 'string' ? password : '';
  if (pass !== pass.replace(/^\s+|\s+$/g, '')) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const accounts = await loadAccounts();
  const match = accounts.find(u =>
    accountHasRole(u, 'Technician') &&
    String(u.username).toLowerCase() === idOrName
  );
  const passwordOk = match ? verifyPassword(pass, String(match.password || '')) : false;

  if (!match || !passwordOk) {
    console.warn('Technician login failed for', idOrName ? `"${idOrName}"` : '[empty username]', 'at', new Date().toISOString());
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!isHashedPassword(String(match.password || ''))) {
    try {
      match.password = hashPassword(pass);
      await saveAccounts(accounts);
    } catch (e) {
      console.warn('Failed to upgrade technician password hash:', e?.message || e);
    }
  }

  const technician = {
    id: String(match.id),
    username: match.username,
    role: 'Technician',
    name: match.username,
  };

  const loginType = 'Technician';
  const technicianPayload = { ...technician, loginType };
  await appendActivityLog({
    message: `Technician ${technician.username} signed in`,
    meta: 'Technician login',
    userId: technician.id,
    username: technician.username
  });

  res.json({ ok: true, loginType, technician: technicianPayload });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const user = await getUserFromSession(req);
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = cookies[SESSION_COOKIE_NAME];
  if (sid) {
    sessions.delete(sid);
    await persistSessions();
  }
  clearSessionCookie(req, res);
  if (user) {
    await appendActivityLog({
      message: `Signed out ${user.username}`,
      meta: 'Session ended',
      userId: user.id,
      username: user.username
    });
  }
  res.json({ ok: true });
});

// POST /api/auth/clear-sessions
// Admin-only endpoint to clear all in-memory sessions. Useful to force logout all users
router.post('/clear-sessions', async (req, res) => {
  const user = await getUserFromSession(req);
  if (!user || !accountHasRole(user, 'Admin')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  sessions.clear();
  if (await isRelationalReady()) {
    await query('DELETE FROM sessions');
  }
  await appendActivityLog({
    message: `Admin ${user.username} cleared all sessions`,
    meta: 'Force logout',
    userId: user.id,
    username: user.username
  });
  await persistSessions();
  res.json({ ok: true, cleared: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const user = await getUserFromSession(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      roles: user.roles || normalizeRoles(user.role, [user.role || 'User']),
      name: user.name,
      sessionCreatedAt: user.sessionCreatedAt,
      lastLogin: user.sessionCreatedAt ? new Date(user.sessionCreatedAt).toISOString() : null,
    },
  });
});

module.exports = {
  router,
  requireAuth,
  requireCollectorOrAdminAuth,
  getUserFromSession,
  getUserFromBasicAuth,
  loadCollectorByToken,
  requireCollectorTokenAuth
};
