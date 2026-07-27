const express = require('express');
const createError = require('http-errors');
const { loadAccounts } = require('./accounts-store');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { assignEntryNumbers, assertEntryNumbersAvailable, withTransaction } = require('./payment-numbering');
const { triggerBranchServiceRefresh } = require('./payment-service-refresh');
const { resolveCollectorNextDue } = require('./collector-next-due');
const { accountHasRole } = require('./role-utils');

const router = express.Router();
const REFERENCE_MAX_LENGTH = 32;
const PAYMENT_METHOD_MAX_LENGTH = 40;
const MANILA_OFFSET_SUFFIX = '+08:00';
const BARE_DATETIME_VALUE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?$/;
const TIMEZONE_SUFFIX_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const EXPLICIT_TIME_RE = /(?:T|\s)\d{2}:\d{2}(?::\d{2})?/;
const COLLECTOR_PAYMENT_OPTIONS_KEY = 'collector_payment_options';
const DEFAULT_TYPE_OF_PAYMENT_OPTIONS = ['credit', 'debit', 'discount', 'rebate'];
const DEFAULT_PAYMENT_METHOD_OPTIONS = ['Cash', 'GCash'];
const MONTHLY_BILL_LABEL_PREFIX = 'Monthly Bill for ';
const MONTH_YEAR_PATTERN = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i;

const STORE_KEYS = {
  payments: 'payments',
  customers: 'customers',
  collectors: 'collectors',
  remittances: 'collector_remittances'
};

const remittanceText = (value) => String(value || '').trim();

function normalizeRemittancePayment(row = {}) {
  const paymentEntryId = remittanceText(row.paymentEntryId || row.entryId || row.id);
  const accountNumber = remittanceText(row.accountNumber || row.account);
  const reference = remittanceText(row.reference || row.ref || row.orNumber);
  const amount = Number(row.amount || 0);
  return {
    paymentEntryId,
    accountNumber,
    reference,
    amount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0
  };
}

function getRemittanceActor(req) {
  const actor = req.collector || req.user || {};
  return {
    id: remittanceText(actor.id),
    username: remittanceText(actor.username),
    name: remittanceText(actor.name || actor.username),
    role: req.collector ? 'Collector' : remittanceText(actor.role || 'Admin'),
    branchId: actor.branchId || null
  };
}

function normalizeKind(rawKind) {
  const k = String(rawKind || 'payment').toLowerCase().trim();
  const aliases = {
    payment: 'payment',
    paid: 'payment',
    credit: 'payment',
    rebate: 'rebate',
    discount: 'discount',
    charge: 'charge',
    debit: 'charge',
    bill: 'charge',
    billing: 'charge'
  };
  return aliases[k] || 'payment';
}

function normalizeOptionList(values, defaults = []) {
  const seen = new Set();
  return [...defaults, ...(Array.isArray(values) ? values : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeTypeOfPayment(kind) {
  if (kind === 'charge') return 'debit';
  if (kind === 'payment') return 'credit';
  if (kind === 'discount') return 'discount';
  if (kind === 'rebate') return 'rebate';
  return kind || 'credit';
}

function normalizePaymentMethodForOptions(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase() === 'gcash') return 'GCash';
  return trimmed;
}

function sanitizeReference(rawReference) {
  const trimmed = String(rawReference || '').trim();
  if (trimmed.length > REFERENCE_MAX_LENGTH) {
    throw createError(400, `Reference must be at most ${REFERENCE_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

function sanitizePaymentMethod(rawPaymentMethod) {
  const trimmed = String(rawPaymentMethod || '').trim();
  if (trimmed.length > PAYMENT_METHOD_MAX_LENGTH) {
    throw createError(400, `Payment method must be at most ${PAYMENT_METHOD_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

function requireCollectorReference(providedReference) {
  const explicit = sanitizeReference(providedReference);
  if (explicit) return explicit;
  throw createError(400, 'Reference is required for collector submissions.');
}

function toPlanAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidCoordinatePair(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function parseCoordinateValue(value) {
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

function toMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00:00`;
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function toMysqlDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 10);
}

function hasExplicitTime(value) {
  return EXPLICIT_TIME_RE.test(String(value || '').trim());
}

function normalizeDateTimeForRecordedAt(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const raw = String(value || '').trim();
  if (!raw || !hasExplicitTime(raw)) return null;
  if (TIMEZONE_SUFFIX_RE.test(raw)) return raw;
  const match = raw.match(BARE_DATETIME_VALUE_RE);
  if (!match) return raw;
  const seconds = match[3] || '00';
  return `${match[1]}T${match[2]}:${seconds}${match[4] || ''}${MANILA_OFFSET_SUFFIX}`;
}

function resolveRecordedAtValue(explicitRecordedAt, paymentDate) {
  return normalizeDateTimeForRecordedAt(explicitRecordedAt)
    || normalizeDateTimeForRecordedAt(paymentDate)
    || new Date().toISOString();
}

function toPaymentDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return toMysqlDateOnly(value);
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match ? match[1] : toMysqlDateOnly(raw);
}

function buildCollectorCustomerSummary(customer, accountNumber) {
  if (!customer) return null;
  const normalizedAccountNumber = String(customer.accountNumber || accountNumber || '').trim();
  if (!normalizedAccountNumber) return null;
  return {
    accountNumber: normalizedAccountNumber,
    area: customer.area ? String(customer.area) : null,
    mapPin: customer.mapPin ? String(customer.mapPin) : null,
    coordinates: parseCoordinateValue(customer.mapPin),
    planName: customer.planName ? String(customer.planName) : null,
    planAmount: toPlanAmount(customer.planAmount),
    planCategory: customer.planCategory ? String(customer.planCategory) : null,
    planBilling: customer.planBilling ? String(customer.planBilling) : null,
    dueDate: toMysqlDateOnly(customer.dueDate),
    nextDue: resolveCollectorNextDue(customer),
  };
}

function resolveCustomerDisplayName(customer, accountNumber = '') {
  const direct = String(customer?.name || customer?.customerName || customer?.subscriberName || '').trim();
  if (direct) return direct;
  const first = String(customer?.firstName || '').trim();
  const last = String(customer?.lastName || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  const normalizedAccountNumber = String(customer?.accountNumber || accountNumber || '').trim();
  return normalizedAccountNumber ? `Account ${normalizedAccountNumber}` : 'Subscriber';
}

function parseEntryDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatBillingMonth(value) {
  const parsed = parseEntryDate(value);
  if (!parsed) return '';
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function normalizeBillingMonthLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = parseEntryDate(raw);
  if (parsed) return formatBillingMonth(parsed);
  return raw;
}

function formatMonthlyBillLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (/^Monthly\s+Bill\s+for\s+/i.test(normalized)) return normalized;
  return `${MONTHLY_BILL_LABEL_PREFIX}${normalized}`;
}

function resolveEntryDirection(entry) {
  const direction = String(entry?.direction || '').trim().toLowerCase();
  if (direction === 'debit' || direction === 'credit') return direction;
  const kind = normalizeKind(entry?.kind || entry?.type);
  return kind === 'charge' ? 'debit' : 'credit';
}

function getEntryTimestamp(entry) {
  const direct = parseEntryDate(entry?.recordedAt || entry?.recorded_at || entry?.date)?.getTime();
  if (Number.isFinite(direct) && direct > 0) return direct;
  const idSuffix = String(entry?.id || '').match(/(\d{9,})$/);
  if (idSuffix?.[1]) {
    const parsed = Number(idSuffix[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function getLedgerSortTimestamp(entry) {
  const direction = resolveEntryDirection(entry);
  const primary = direction === 'debit'
    ? (entry?.date || entry?.recordedAt || entry?.recorded_at || '')
    : (entry?.recordedAt || entry?.recorded_at || entry?.date || '');
  const primaryTime = parseEntryDate(primary)?.getTime();
  if (Number.isFinite(primaryTime) && primaryTime > 0) return primaryTime;
  return getEntryTimestamp(entry);
}

function resolveChargeMonth(entry) {
  const direct = normalizeBillingMonthLabel(
    entry?.coveredMonth ||
    entry?.billingMonth ||
    entry?.billMonth ||
    entry?.month ||
    entry?.period ||
    entry?.billingPeriod ||
    ''
  );
  if (direct) return formatMonthlyBillLabel(direct);

  const description = String(entry?.description || entry?.memo || entry?.notes || '').trim();
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  if (monthMatch) return formatMonthlyBillLabel(normalizeBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`));

  return formatMonthlyBillLabel(formatBillingMonth(entry?.date || entry?.recordedAt || entry?.recorded_at || ''));
}

function resolvePaymentDescriptionMonth(entry) {
  const description = String(entry?.description || entry?.memo || entry?.notes || '').trim();
  const monthMatch = description.match(MONTH_YEAR_PATTERN);
  return monthMatch ? formatMonthlyBillLabel(normalizeBillingMonthLabel(`${monthMatch[1]} 1, ${monthMatch[2]}`)) : '';
}

function resolvePaymentFallbackMonth(entry) {
  return resolvePaymentDescriptionMonth(entry)
    || formatMonthlyBillLabel(formatBillingMonth(entry?.date || entry?.recordedAt || entry?.recorded_at || ''));
}

function mapReceiptPaymentRow(row) {
  return {
    id: row?.id,
    amount: row?.amount != null ? Number(row.amount) : 0,
    date: row?.date || row?.recordedAt || null,
    kind: row?.kind || undefined,
    direction: row?.direction || undefined,
    reference: row?.reference || undefined,
    orNumber: row?.orNumber || row?.or_number || undefined,
    description: row?.description || undefined,
    type: row?.type || undefined,
    recordedAt: row?.recordedAt || row?.recorded_at || undefined,
    recordedBy: row?.recordedBy && typeof row.recordedBy === 'object' ? {
      id: row.recordedBy.id || undefined,
      username: row.recordedBy.username || undefined,
      name: row.recordedBy.name || undefined,
      role: row.recordedBy.role || undefined
    } : row?.recordedByUserId ? {
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
    status: row?.status || undefined,
    paymentMethod: row?.paymentMethod || row?.payment_method || undefined,
    fingerprint: row?.fingerprint || undefined,
    xenditId: row?.xenditId || row?.xendit_id || undefined
  };
}

function pushBreakdownLine(items, label, amount) {
  const normalized = String(label || '').trim();
  const amountValue = Number(amount);
  if (!normalized || !Number.isFinite(amountValue) || amountValue <= 0) return;
  const existing = items.find((item) => item.month === normalized || item.label === normalized);
  if (existing) {
    existing.amount = Number((Number(existing.amount || 0) + amountValue).toFixed(2));
    return;
  }
  items.push({
    label: normalized,
    amount: Number(amountValue.toFixed(2))
  });
}

function applyCreditToCharges(openCharges, amount, coveredBreakdown = null) {
  let remainingPayment = Number(amount);
  if (!Number.isFinite(remainingPayment) || remainingPayment <= 0) return;
  for (const charge of openCharges) {
    if (remainingPayment <= 0) break;
    const remainingCharge = Number(charge.remaining);
    if (!Number.isFinite(remainingCharge) || remainingCharge <= 0) continue;
    const applied = Math.min(remainingCharge, remainingPayment);
    if (coveredBreakdown) pushBreakdownLine(coveredBreakdown, charge.label, applied);
    charge.remaining = Number((remainingCharge - applied).toFixed(2));
    remainingPayment = Number((remainingPayment - applied).toFixed(2));
  }
}

function buildCollectorReceiptBreakdown(history = [], paymentEntry = null) {
  const targetPayment = paymentEntry || null;
  const targetId = String(targetPayment?.id || '').trim();
  const targetReference = String(targetPayment?.reference || '').trim();
  const targetTimestamp = getEntryTimestamp(targetPayment);
  const targetAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      const amount = Math.abs(Number(entry?.amount) || 0);
      return {
        entry,
        index,
        amount,
        direction: resolveEntryDirection(entry),
        timestamp: getEntryTimestamp(entry),
        sortTimestamp: getLedgerSortTimestamp(entry)
      };
    })
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp - right.sortTimestamp;
      return left.index - right.index;
    });

  const coveredBillingBreakdown = [];
  const openCharges = [];
  let matched = false;

  rows.forEach((row) => {
    const rowId = String(row.entry?.id || '').trim();
    const rowReference = String(row.entry?.reference || '').trim();
    const idMatch = targetId && rowId && targetId === rowId;
    const referenceMatch = targetReference && rowReference && targetReference === rowReference;
    const fallbackMatch = row.direction === 'credit'
      && targetTimestamp > 0
      && row.timestamp === targetTimestamp
      && Math.abs(row.amount - targetAmount) < 0.0001;
    const isTargetPayment = !matched && (idMatch || referenceMatch || fallbackMatch);

    if (row.direction === 'debit') {
      openCharges.push({
        label: resolveChargeMonth(row.entry),
        remaining: Number(row.amount.toFixed(2))
      });
      return;
    }

    applyCreditToCharges(openCharges, row.amount, isTargetPayment ? coveredBillingBreakdown : null);
    if (isTargetPayment) matched = true;
  });

  if (!coveredBillingBreakdown.length && targetPayment) {
    pushBreakdownLine(coveredBillingBreakdown, resolvePaymentFallbackMonth(targetPayment), targetAmount);
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

function isSamePaymentEntry(left, right) {
  if (!left || !right) return false;
  const leftId = String(left?.id || '').trim();
  const rightId = String(right?.id || '').trim();
  if (leftId && rightId && leftId === rightId) return true;
  const leftReference = String(left?.reference || '').trim();
  const rightReference = String(right?.reference || '').trim();
  if (leftReference && rightReference && leftReference === rightReference) return true;
  const leftOrNumber = String(left?.orNumber || left?.or_number || '').trim();
  const rightOrNumber = String(right?.orNumber || right?.or_number || '').trim();
  if (leftOrNumber && rightOrNumber && leftOrNumber === rightOrNumber) return true;
  const leftTimestamp = getEntryTimestamp(left);
  const rightTimestamp = getEntryTimestamp(right);
  const leftAmount = Math.abs(Number(left?.amount) || 0);
  const rightAmount = Math.abs(Number(right?.amount) || 0);
  return leftTimestamp > 0
    && rightTimestamp > 0
    && leftTimestamp === rightTimestamp
    && Math.abs(leftAmount - rightAmount) < 0.0001;
}

function buildCollectorReceiptSummary(history = [], paymentEntry = null) {
  const targetPayment = paymentEntry || null;
  const targetAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const rows = (Array.isArray(history) ? history : [])
    .map((entry, index) => {
      const amount = Math.abs(Number(entry?.amount) || 0);
      return {
        entry,
        index,
        amount,
        direction: resolveEntryDirection(entry),
        sortTimestamp: getLedgerSortTimestamp(entry)
      };
    })
    .filter((row) => row.amount > 0 && (row.direction === 'debit' || row.direction === 'credit'))
    .sort((left, right) => {
      if (left.sortTimestamp !== right.sortTimestamp) return left.sortTimestamp - right.sortTimestamp;
      return left.index - right.index;
    });

  const result = {
    previousBalance: 0,
    paymentAmount: Number(targetAmount.toFixed(2)),
    balanceAfterPayment: 0,
    totalCharge: 0,
    currentBalance: 0,
    coveredBillingBreakdown: [],
    balanceBreakdown: []
  };
  if (!targetPayment || !rows.length) return result;

  const openCharges = [];
  let running = 0;
  let runningBeforePayment = 0;
  let runningAfterPayment = null;
  let chargesAfterPayment = 0;
  let matched = false;

  rows.forEach((row) => {
    const isTargetPayment = !matched && row.direction === 'credit' && isSamePaymentEntry(row.entry, targetPayment);
    if (isTargetPayment) {
      runningBeforePayment = running;
      matched = true;
    }

    if (row.direction === 'debit') {
      running = Number((running + row.amount).toFixed(2));
      openCharges.push({
        label: resolveChargeMonth(row.entry),
        remaining: Number(row.amount.toFixed(2))
      });
    } else {
      applyCreditToCharges(openCharges, row.amount, isTargetPayment ? result.coveredBillingBreakdown : null);
      running = Number((running - row.amount).toFixed(2));
    }

    if (isTargetPayment) {
      runningAfterPayment = running;
    }
    if (matched && !isTargetPayment && row.direction === 'debit') {
      chargesAfterPayment = Number((chargesAfterPayment + row.amount).toFixed(2));
    }
  });

  if (!result.coveredBillingBreakdown.length) {
    pushBreakdownLine(result.coveredBillingBreakdown, resolvePaymentFallbackMonth(targetPayment), targetAmount);
  }
  result.balanceBreakdown = openCharges
    .filter((charge) => Number(charge.remaining) > 0)
    .map((charge) => ({
      label: charge.label,
      amount: Number(Number(charge.remaining).toFixed(2))
    }));
  result.previousBalance = Number(Math.max(runningBeforePayment, 0).toFixed(2));
  result.balanceAfterPayment = Number(Math.max(
    Number.isFinite(runningAfterPayment) ? runningAfterPayment : (result.previousBalance - targetAmount),
    0
  ).toFixed(2));
  result.totalCharge = Number(Math.max(chargesAfterPayment, 0).toFixed(2));
  result.currentBalance = Number(Math.max(running, 0).toFixed(2));
  return result;
}

async function readPaymentHistoryForReceipt(branchId, accountNumber) {
  if (!branchId || !accountNumber) return [];
  const [rows] = await query(
    `SELECT
       id,
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
     WHERE branch_id = ?
       AND account_number = ?
     ORDER BY COALESCE(recorded_at, CONCAT(date, ' 00:00:00')) ASC, id ASC`,
    [branchId, accountNumber]
  );
  return Array.isArray(rows) ? rows.map(mapReceiptPaymentRow) : [];
}

function isReceiptPaymentEntry(entry) {
  if (!entry) return false;
  const amount = Math.abs(Number(entry?.amount) || 0);
  if (amount <= 0) return false;
  const direction = resolveEntryDirection(entry);
  const kind = normalizeKind(entry?.kind || entry?.type);
  return direction === 'credit' && kind !== 'charge';
}

function matchesReceiptLookup(entry, lookup) {
  const token = String(lookup?.token || '').trim();
  const entryId = String(lookup?.entryId || '').trim();
  if (!entry || (!token && !entryId)) return false;
  const id = String(entry?.id || '').trim();
  const reference = String(entry?.reference || '').trim();
  const orNumber = String(entry?.orNumber || entry?.or_number || '').trim();
  return Boolean(
    (entryId && id === entryId) ||
    (token && (reference === token || orNumber === token || id === token))
  );
}

function resolveReceiptLookup(req) {
  const token = String(
    req.query?.reference ||
    req.query?.ref ||
    req.query?.orNumber ||
    req.query?.or_number ||
    req.query?.or ||
    ''
  ).trim();
  const entryId = String(
    req.query?.entryId ||
    req.query?.entry ||
    req.query?.paymentId ||
    req.query?.payment ||
    ''
  ).trim();
  const accountNumber = String(req.query?.accountNumber || req.query?.account || '').trim();
  if (!token && !entryId) {
    throw createError(400, 'reference, orNumber, or entryId is required.');
  }
  if (token.length > 64 || entryId.length > 80 || accountNumber.length > 32) {
    throw createError(400, 'Receipt lookup value is too long.');
  }
  return { token, entryId, accountNumber };
}

function buildReceiptCustomerFromRow(row) {
  return {
    accountNumber: String(row?.accountNumber || '').trim(),
    name: row?.customerName || undefined,
    firstName: row?.firstName || undefined,
    lastName: row?.lastName || undefined,
    area: row?.area || undefined,
    mapPin: row?.mapPin || undefined,
    planName: row?.planName || undefined,
    planAmount: row?.planAmount != null ? Number(row.planAmount) : undefined,
    planCategory: row?.planCategory || undefined,
    planBilling: row?.planBilling || undefined,
    dueDate: row?.dueDate || undefined,
    dueOffset: row?.dueOffset != null ? Number(row.dueOffset) : undefined
  };
}

function buildCollectorReceiptPayload(customer, history, targetPayment) {
  const accountNumber = String(customer?.accountNumber || '').trim();
  const summary = buildCollectorReceiptSummary(history, targetPayment);
  const subscriberName = resolveCustomerDisplayName(customer, accountNumber);
  const customerSummary = {
    ...buildCollectorCustomerSummary(customer, accountNumber),
    name: subscriberName,
    customerName: subscriberName,
    firstName: customer?.firstName || undefined,
    lastName: customer?.lastName || undefined
  };
  const paymentAmount = Math.abs(Number(targetPayment?.amount) || 0);
  const receiptBreakdown = {
    coveredBillingBreakdown: summary.coveredBillingBreakdown,
    balanceBreakdown: summary.balanceBreakdown
  };

  return {
    ok: true,
    accountNumber,
    subscriberName,
    customerName: subscriberName,
    customer: customerSummary,
    paymentId: targetPayment?.id || null,
    reference: targetPayment?.reference || null,
    orNumber: targetPayment?.orNumber || null,
    paymentDate: targetPayment?.date || targetPayment?.recordedAt || null,
    recordedAt: targetPayment?.recordedAt || null,
    paymentAmount: Number(paymentAmount.toFixed(2)),
    paymentMethod: targetPayment?.paymentMethod || null,
    payer: targetPayment?.payer || null,
    recordedBy: targetPayment?.recordedBy || null,
    previousBalance: summary.previousBalance,
    balanceAfterPayment: summary.balanceAfterPayment,
    totalCharge: summary.totalCharge,
    currentBalance: summary.currentBalance,
    coveredBillingBreakdown: summary.coveredBillingBreakdown,
    coveredBreakdown: summary.coveredBillingBreakdown,
    balanceBreakdown: summary.balanceBreakdown,
    receiptBreakdown,
    historyCount: Array.isArray(history) ? history.length : 0
  };
}

async function isCollectorAssignedToCustomer(branchId, collectorId, customer) {
  if (!collectorId) return true;
  const area = String(customer?.area || '').trim();
  if (!branchId || !area) return false;
  const [rows] = await query(
    `SELECT ca.collector_user_id AS collectorId
     FROM collector_assignments ca
     LEFT JOIN coverage_areas cov
       ON cov.id = ca.coverage_id
      AND cov.branch_id = ca.branch_id
     WHERE ca.branch_id = ?
       AND ca.collector_user_id = ?
       AND (
         LOWER(TRIM(COALESCE(ca.area_name, ''))) = LOWER(TRIM(?))
         OR LOWER(TRIM(COALESCE(cov.name, ''))) = LOWER(TRIM(?))
       )
     LIMIT 1`,
    [branchId, String(collectorId), area, area]
  );
  return Array.isArray(rows) && rows.length > 0;
}

function isJsonCollectorAssignedToCustomer(collectorId, assignments, customer) {
  if (!collectorId) return true;
  const area = String(customer?.area || '').trim();
  if (!area) return false;
  const assignedRaw = assignments?.[area];
  const assignedCollectors = (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  return assignedCollectors.includes(String(collectorId));
}

async function insertPaymentEntry(entry, branchId, accountNumber, executor = null) {
  const runQuery = executor && typeof executor.query === 'function'
    ? executor.query.bind(executor)
    : query;
  const recordedBy = entry.recordedBy || {};
  const recordedAt = toMysqlDateTime(entry.recordedAt || normalizeDateTimeForRecordedAt(entry.date) || new Date());
  const entryDate = toPaymentDateOnly(entry.date) || toMysqlDateOnly(entry.recordedAt || recordedAt);
  await runQuery(
    `INSERT INTO payment_entries (
        id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
        recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
        payer, status, payment_method, fingerprint, xendit_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(entry.id || `${accountNumber}-${Date.now()}`),
      branchId,
      String(accountNumber),
      Number(entry.amount) || 0,
      entryDate,
      entry.kind || null,
      entry.direction || null,
      entry.reference || null,
      entry.orNumber || null,
      entry.description || null,
      entry.type || null,
      recordedAt,
      recordedBy.id ? String(recordedBy.id) : null,
      recordedBy.username || null,
      recordedBy.name || null,
      recordedBy.role || null,
      entry.payer || null,
      entry.status || null,
      entry.paymentMethod || null,
      entry.fingerprint || null,
      entry.xenditId || null
    ]
  );
}

async function readCollectorPaymentOptions(branchId = null) {
  let configured = {};
  try {
    configured = await readJson(COLLECTOR_PAYMENT_OPTIONS_KEY, {});
  } catch {
    configured = {};
  }

  let recordedPaymentMethods = [];
  if (await isRelationalReady()) {
    const params = [];
    const branchClause = branchId ? 'WHERE branch_id = ?' : '';
    if (branchId) params.push(branchId);
    const [rows] = await query(
      `SELECT DISTINCT payment_method AS paymentMethod
       FROM payment_entries
       ${branchClause}
       ORDER BY payment_method ASC`,
      params
    );
    recordedPaymentMethods = (rows || [])
      .map((row) => normalizePaymentMethodForOptions(row?.paymentMethod))
      .filter(Boolean);
  } else {
    const payments = await readJson(STORE_KEYS.payments, {});
    recordedPaymentMethods = Object.values(payments || {})
      .flatMap((record) => Array.isArray(record?.history) ? record.history : [])
      .map((entry) => normalizePaymentMethodForOptions(entry?.paymentMethod || entry?.method))
      .filter(Boolean);
  }

  return {
    typeOfPayment: normalizeOptionList(
      configured.typeOfPayment || configured.typeOfPayments || configured.types,
      DEFAULT_TYPE_OF_PAYMENT_OPTIONS
    ),
    paymentMethod: normalizeOptionList(
      configured.paymentMethod || configured.paymentMethods || configured.methods,
      [...DEFAULT_PAYMENT_METHOD_OPTIONS, ...recordedPaymentMethods]
    )
  };
}

// GET /api/collector/payments/options
router.get('/options', async (req, res, next) => {
  try {
    const branchId = req.collector?.branchId || req.user?.branchId || null;
    const options = await readCollectorPaymentOptions(branchId);
    res.json({ ok: true, ...options });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load collector payment options'));
  }
});

// GET /api/collector/payments/reprint?reference=...&accountNumber=...
// Also accepts orNumber/ref/entryId. Returns a complete receipt payload for one exact payment.
router.get('/reprint', async (req, res, next) => {
  try {
    const lookup = resolveReceiptLookup(req);
    const branchId = req.collector?.branchId || req.user?.branchId || null;
    if (!branchId && await isRelationalReady()) {
      return next(createError(400, 'Branch assignment missing for the authenticated account.'));
    }

    if (await isRelationalReady()) {
      const params = [branchId];
      const where = ['pe.branch_id = ?'];
      if (lookup.accountNumber) {
        where.push('pe.account_number = ?');
        params.push(lookup.accountNumber);
      }

      const identityClauses = [];
      if (lookup.token) {
        identityClauses.push('pe.reference = ?');
        params.push(lookup.token);
        identityClauses.push('pe.or_number = ?');
        params.push(lookup.token);
        identityClauses.push('pe.id = ?');
        params.push(lookup.token);
      }
      if (lookup.entryId) {
        identityClauses.push('pe.id = ?');
        params.push(lookup.entryId);
      }
      where.push(`(${identityClauses.join(' OR ')})`);

      const [rows] = await query(
        `SELECT
           pe.id,
           pe.amount,
           pe.date,
           pe.kind,
           pe.direction,
           pe.reference,
           pe.or_number AS orNumber,
           pe.description,
           pe.type,
           pe.recorded_at AS recordedAt,
           pe.recorded_by_user_id AS recordedByUserId,
           pe.recorded_by_username AS recordedByUsername,
           pe.recorded_by_name AS recordedByName,
           pe.recorded_by_role AS recordedByRole,
           pe.payer,
           pe.status,
           pe.payment_method AS paymentMethod,
           pe.fingerprint,
           pe.xendit_id AS xenditId,
           c.account_number AS accountNumber,
           c.name AS customerName,
           c.first_name AS firstName,
           c.last_name AS lastName,
           c.area,
           c.map_pin AS mapPin,
           c.plan_name AS planName,
           c.plan_amount AS planAmount,
           c.plan_category AS planCategory,
           c.plan_billing AS planBilling,
           c.due_offset AS dueOffset,
           c.due_date AS dueDate
         FROM payment_entries pe
         INNER JOIN customers c
           ON c.branch_id = pe.branch_id
          AND c.account_number = pe.account_number
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(pe.recorded_at, CONCAT(pe.date, ' 00:00:00')) DESC, pe.id DESC
         LIMIT 50`,
        params
      );

      for (const row of rows || []) {
        const targetPayment = mapReceiptPaymentRow(row);
        if (!isReceiptPaymentEntry(targetPayment)) continue;
        const customer = buildReceiptCustomerFromRow(row);
        if (isPrepaidCustomer(customer)) continue;
        if (req.collector && !await isCollectorAssignedToCustomer(branchId, req.collector.id, customer)) {
          continue;
        }

        const history = await readPaymentHistoryForReceipt(branchId, customer.accountNumber);
        const resolvedTarget = history.find((entry) => isSamePaymentEntry(entry, targetPayment)) || targetPayment;
        return res.json(buildCollectorReceiptPayload(customer, history, resolvedTarget));
      }

      return next(createError(404, 'Receipt payment was not found for this collector.'));
    }

    const collectorId = req.collector?.id ? String(req.collector.id) : '';
    const [customers, payments, collectorsData] = await Promise.all([
      readJson(STORE_KEYS.customers, []),
      readJson(STORE_KEYS.payments, {}),
      readJson(STORE_KEYS.collectors, { assignments: {} }).catch(() => ({ assignments: {} }))
    ]);
    const assignments = collectorsData?.assignments || {};
    for (const customer of Array.isArray(customers) ? customers : []) {
      const accountNumber = String(customer?.accountNumber || '').trim();
      if (!accountNumber) continue;
      if (lookup.accountNumber && accountNumber !== lookup.accountNumber) continue;
      if (isPrepaidCustomer(customer)) continue;
      if (req.collector && !isJsonCollectorAssignedToCustomer(collectorId, assignments, customer)) continue;
      const rawHistory = Array.isArray(payments?.[accountNumber]?.history) ? payments[accountNumber].history : [];
      const history = rawHistory.map(mapReceiptPaymentRow);
      const targetPayment = history.find((entry) => isReceiptPaymentEntry(entry) && matchesReceiptLookup(entry, lookup));
      if (!targetPayment) continue;
      return res.json(buildCollectorReceiptPayload(customer, history, targetPayment));
    }

    return next(createError(404, 'Receipt payment was not found for this collector.'));
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load receipt reprint.'));
  }
});

// GET /api/collector/payments/remittances
// Collector sees own remittances; admin sees all JSON remittance submissions.
router.get('/remittances', async (req, res, next) => {
  try {
    const actor = getRemittanceActor(req);
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const scoped = req.collector
      ? records.filter((record) => remittanceText(record.collectorId) === actor.id)
      : records;
    res.json({ ok: true, records: scoped });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to load remittances.'));
  }
});

// POST /api/collector/payments/remittances
// Body { paymentEntryIds: [{ paymentEntryId, accountNumber, reference, amount }], totalAmount? }
router.post('/remittances', async (req, res, next) => {
  try {
    if (!req.collector) {
      return next(createError(403, 'Collector access required to submit remittance.'));
    }
    const actor = getRemittanceActor(req);
    const rawItems = Array.isArray(req.body?.paymentEntryIds)
      ? req.body.paymentEntryIds
      : (Array.isArray(req.body?.payments) ? req.body.payments : []);
    const payments = rawItems
      .map(normalizeRemittancePayment)
      .filter((item) => item.paymentEntryId || item.reference || item.accountNumber);
    if (!payments.length) {
      return next(createError(400, 'At least one payment is required for remittance.'));
    }

    const computedTotal = payments.reduce((sum, item) => sum + Math.max(Number(item.amount || 0), 0), 0);
    const requestedTotal = Number(req.body?.totalAmount);
    const totalAmount = Number((Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : computedTotal).toFixed(2));
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const paymentKeys = new Set(
      payments.map((item) => remittanceText(item.paymentEntryId || item.reference)).filter(Boolean)
    );
    const duplicatePending = records.some((record) => {
      const status = remittanceText(record.status || 'pending').toLowerCase();
      if (status === 'rejected') return false;
      return (Array.isArray(record.payments) ? record.payments : []).some((item) => {
        const key = remittanceText(item.paymentEntryId || item.reference);
        return key && paymentKeys.has(key);
      });
    });
    if (duplicatePending) {
      return next(createError(409, 'One or more payments are already submitted for remittance.'));
    }

    const submittedAt = new Date().toISOString();
    const record = {
      id: `remit-${actor.id || 'collector'}-${Date.now()}`,
      collectorId: actor.id,
      collectorName: actor.name || actor.username || 'Collector',
      branchId: actor.branchId,
      status: 'pending',
      payments,
      totalAmount,
      submittedAt,
      submittedBy: actor,
      reviewedAt: null,
      reviewedBy: null,
      adminNote: ''
    };
    records.unshift(record);
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: submittedAt });
    res.status(201).json({ ok: true, record });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to submit remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/confirm
router.post('/remittances/:id/confirm', async (req, res, next) => {
  try {
    if (req.collector) {
      return next(createError(403, 'Admin access required to confirm remittance.'));
    }
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    const reviewer = getRemittanceActor(req);
    record.status = 'remitted';
    record.reviewedAt = new Date().toISOString();
    record.reviewedBy = reviewer;
    record.adminNote = remittanceText(req.body?.adminNote || req.body?.note);
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: new Date().toISOString() });
    res.json({ ok: true, record });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to confirm remittance.'));
  }
});

// POST /api/collector/payments/remittances/:id/reject
router.post('/remittances/:id/reject', async (req, res, next) => {
  try {
    if (req.collector) {
      return next(createError(403, 'Admin access required to reject remittance.'));
    }
    const payload = await readJson(STORE_KEYS.remittances, { records: [] });
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const record = records.find((item) => remittanceText(item.id) === remittanceText(req.params.id));
    if (!record) return next(createError(404, 'Remittance not found.'));
    const reviewer = getRemittanceActor(req);
    record.status = 'rejected';
    record.reviewedAt = new Date().toISOString();
    record.reviewedBy = reviewer;
    record.adminNote = remittanceText(req.body?.adminNote || req.body?.note);
    await writeJson(STORE_KEYS.remittances, { records, updatedAt: new Date().toISOString() });
    res.json({ ok: true, record });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to reject remittance.'));
  }
});

// POST /api/collector/payments/:accountNumber
// body for admin auth: { collectorId, amount, date, reference, kind?/typeOfPayment?, description?, payer?, paymentMethod? }
// body for collector token auth: { amount, date, reference, kind?/typeOfPayment?, description?, payer?, paymentMethod? }
router.post('/:accountNumber', async (req, res, next) => {
  try {
    const { accountNumber } = req.params;
    const {
      collectorId: rawCollectorId,
      amount,
      date,
      kind: rawKind,
      reference = null,
      description = null,
      payer = null,
      paymentMethod = null,
      typeOfPayment = null,
      paymentType = null,
      type = null,
      method = null,
    } = req.body || {};

    const authCollectorId = req.collector?.id ? String(req.collector.id) : '';
    const bodyCollectorId = rawCollectorId != null ? String(rawCollectorId) : '';
    const effectiveCollectorId = authCollectorId || bodyCollectorId;

    if (authCollectorId && bodyCollectorId && bodyCollectorId !== authCollectorId) {
      return next(createError(403, 'collectorId does not match the authenticated collector'));
    }

    if (!effectiveCollectorId) {
      return next(createError(401, 'collectorId is required'));
    }
    if (!accountNumber) {
      return next(createError(400, 'accountNumber is required'));
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return next(createError(400, 'amount must be a positive number'));
    }
    if (!date) {
      return next(createError(400, 'date is required'));
    }
    let normalizedReference;
    try {
      normalizedReference = requireCollectorReference(reference);
    } catch (referenceError) {
      return next(referenceError);
    }
    const requestedKind = rawKind || typeOfPayment || paymentType || type;
    const requestedKindNormalized = normalizeKind(requestedKind);
    let normalizedPaymentMethod;
    try {
      normalizedPaymentMethod = requestedKindNormalized === 'payment'
        ? sanitizePaymentMethod(paymentMethod || method)
        : '';
    } catch (paymentMethodError) {
      return next(paymentMethodError);
    }

    if (await isRelationalReady()) {
      const branchId = req.collector?.branchId || req.user?.branchId || null;
      if (!branchId) {
        return next(createError(400, 'Branch assignment missing for the authenticated account.'));
      }

      // Validate collector account
      const accounts = await loadAccounts();
      const collectorAccount = (accounts || []).find(
        (a) =>
          String(a.id) === String(effectiveCollectorId) &&
          accountHasRole(a, 'Collector') &&
          String(a.branchId || '') === String(branchId)
      );
      if (!collectorAccount) {
        return next(createError(403, 'Invalid collector account'));
      }

      const [customerRows] = await query(
        `SELECT
           c.account_number AS accountNumber,
           c.area,
           c.map_pin AS mapPin,
           c.plan_name AS planName,
           c.plan_amount AS planAmount,
           c.plan_category AS planCategory,
           c.plan_billing AS planBilling,
           c.bill_date AS billDate,
           c.due_offset AS dueOffset,
           c.due_date AS dueDate
         FROM customers c
         WHERE c.branch_id = ?
           AND c.account_number = ?
         LIMIT 1`,
        [branchId, accountNumber]
      );
      const customer = customerRows && customerRows.length ? customerRows[0] : null;
      if (!customer) {
        return next(createError(404, 'Customer not found'));
      }
      if (isPrepaidCustomer(customer)) {
        return next(createError(403, 'Prepaid customers are not included in collector collections.'));
      }

      const [assignRows] = await query(
        'SELECT collector_user_id AS collectorId FROM collector_assignments WHERE branch_id = ? AND area_name = ?',
        [branchId, customer.area]
      );
      const assignedCollectors = (assignRows || []).map((row) => String(row.collectorId || '').trim()).filter(Boolean);
      if (assignedCollectors.length && !assignedCollectors.includes(String(effectiveCollectorId))) {
        return next(createError(403, 'Collector not assigned to this customer area'));
      }

      const kind = requestedKindNormalized;
      const direction = kind === 'charge' ? 'debit' : 'credit';
      const normalizedTypeOfPayment = normalizeTypeOfPayment(kind);
      const isPrepaid = isPrepaidCustomer(customer);

      const recorder = {
        id: String(collectorAccount.id),
        username: collectorAccount.username || collectorAccount.name || null,
        name: collectorAccount.name || collectorAccount.username || null,
        role: 'Collector',
      };

      const entryStamp = Date.now();
      const newEntry = {
        id: `pay-${accountNumber}-${entryStamp}`,
        amount: numericAmount,
        date,
        kind,
        type: normalizedTypeOfPayment,
        reference: normalizedReference,
        description,
        direction,
        recordedAt: resolveRecordedAtValue(req.body?.recordedAt, date),
        recordedBy: recorder,
        payer: payer || recorder.name || recorder.username || null,
        paymentMethod: normalizedPaymentMethod || undefined,
        typeOfPayment: normalizedTypeOfPayment,
      };

      const shouldAutoCharge = isPrepaid && kind === 'payment';
      const chargeEntry = shouldAutoCharge ? {
        id: `charge-${accountNumber}-${entryStamp}`,
        amount: numericAmount,
        date,
        kind: 'charge',
        type: 'debit',
        reference: undefined,
        description: 'Prepaid renewal charge',
        direction: 'debit',
        recordedAt: newEntry.recordedAt,
        recordedBy: recorder,
        payer: newEntry.payer,
        paymentMethod: normalizedPaymentMethod || undefined,
        typeOfPayment: 'debit',
      } : null;

      const historyBeforeInsert = await readPaymentHistoryForReceipt(branchId, accountNumber);
      const receiptBreakdown = buildCollectorReceiptBreakdown(
        [...historyBeforeInsert, newEntry, ...(chargeEntry ? [chargeEntry] : [])],
        newEntry
      );

      await withTransaction(async (connection) => {
        await assignEntryNumbers(connection, newEntry);
        await assertEntryNumbersAvailable(connection, branchId, newEntry);
        await insertPaymentEntry(newEntry, branchId, accountNumber, connection);
        if (chargeEntry) {
          await assignEntryNumbers(connection, chargeEntry);
          await assertEntryNumbersAvailable(connection, branchId, chargeEntry);
          await insertPaymentEntry(chargeEntry, branchId, accountNumber, connection);
        }
      });
      triggerBranchServiceRefresh(branchId, 'collector-payments');

      return res.status(201).json({
        ...newEntry,
        customer: buildCollectorCustomerSummary(customer, accountNumber),
        coveredBillingBreakdown: receiptBreakdown.coveredBillingBreakdown,
        balanceBreakdown: receiptBreakdown.balanceBreakdown,
        receiptBreakdown,
      });
    }

    // JSON fallback
    // Validate collector account
    const accounts = await loadAccounts();
    const collectorAccount = (accounts || []).find(
      (a) => String(a.id) === String(effectiveCollectorId) && accountHasRole(a, 'Collector')
    );
    if (!collectorAccount) {
      return next(createError(403, 'Invalid collector account'));
    }

    // Validate assignment: accountNumber must belong to an area assigned to this collector
    const customers = await readJson(STORE_KEYS.customers, []);
    const customer = customers.find((c) => String(c.accountNumber) === String(accountNumber));
    if (!customer) {
      return next(createError(404, 'Customer not found'));
    }
    if (isPrepaidCustomer(customer)) {
      return next(createError(403, 'Prepaid customers are not included in collector collections.'));
    }

    const collectorsData = await readJson(STORE_KEYS.collectors, { assignments: {} });
    const assignments = collectorsData.assignments || {};
    const assignedRaw = assignments[customer.area];
    const assignedCollectors = (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw])
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    if (assignedCollectors.length && !assignedCollectors.includes(String(effectiveCollectorId))) {
      return next(createError(403, 'Collector not assigned to this customer area'));
    }

    const payments = await readJson(STORE_KEYS.payments, {});
    if (!payments[accountNumber]) {
      payments[accountNumber] = { history: [] };
    }

    const kind = requestedKindNormalized;
    const direction = kind === 'charge' ? 'debit' : 'credit';
    const normalizedTypeOfPayment = normalizeTypeOfPayment(kind);
    const isPrepaid = isPrepaidCustomer(customer);

    const recorder = {
      id: String(collectorAccount.id),
      username: collectorAccount.username || collectorAccount.name || null,
      name: collectorAccount.name || collectorAccount.username || null,
      role: 'Collector',
    };

    const entryStamp = Date.now();
    const newEntry = {
      id: `pay-${accountNumber}-${entryStamp}`,
      amount: numericAmount,
      date,
      kind,
      type: normalizedTypeOfPayment,
      reference: normalizedReference,
      description,
      direction,
      recordedAt: resolveRecordedAtValue(req.body?.recordedAt, date),
      recordedBy: recorder,
      payer: payer || recorder.name || recorder.username || null,
      paymentMethod: normalizedPaymentMethod || undefined,
      typeOfPayment: normalizedTypeOfPayment,
    };
    const paymentFingerprint = `${accountNumber}|${normalizedReference}|${kind}|${Math.abs(numericAmount).toFixed(2)}`;
    const normalizedReferenceKey = String(normalizedReference || '').trim().toLowerCase();
    const duplicateEntry = Object.values(payments || {}).some((bucket) => {
      const history = Array.isArray(bucket?.history) ? bucket.history : [];
      return history.some((entry) => {
        const entryReference = String(entry?.reference || entry?.orNumber || '').trim().toLowerCase();
        const entryFingerprint = String(entry?.fingerprint || '').trim();
        return (
          (normalizedReferenceKey && entryReference === normalizedReferenceKey) ||
          (entryFingerprint && entryFingerprint === paymentFingerprint)
        );
      });
    });
    if (duplicateEntry) {
      return next(createError(409, `Reference already exists: ${normalizedReference}`));
    }
    newEntry.fingerprint = paymentFingerprint;

    const shouldAutoCharge = isPrepaid && kind === 'payment';
    const chargeEntry = shouldAutoCharge ? {
      id: `charge-${accountNumber}-${entryStamp}`,
      amount: numericAmount,
      date,
      kind: 'charge',
      type: 'debit',
      reference: undefined,
      description: 'Prepaid renewal charge',
      direction: 'debit',
      recordedAt: newEntry.recordedAt,
      recordedBy: recorder,
      payer: newEntry.payer,
      paymentMethod: normalizedPaymentMethod || undefined,
      typeOfPayment: 'debit',
      fingerprint: `${accountNumber}|${normalizedReference}|charge|${Math.abs(numericAmount).toFixed(2)}`,
    } : null;

    payments[accountNumber].history = payments[accountNumber].history || [];
    if (chargeEntry) {
      payments[accountNumber].history.unshift(newEntry, chargeEntry);
    } else {
      payments[accountNumber].history.unshift(newEntry);
    }

    await writeJson(STORE_KEYS.payments, payments);
    const receiptBreakdown = buildCollectorReceiptBreakdown(payments[accountNumber].history, newEntry);
    res.status(201).json({
      ...newEntry,
      customer: buildCollectorCustomerSummary(customer, accountNumber),
      coveredBillingBreakdown: receiptBreakdown.coveredBillingBreakdown,
      balanceBreakdown: receiptBreakdown.balanceBreakdown,
      receiptBreakdown,
    });
  } catch (err) {
    next(err?.status ? err : createError(500, err.message || 'Failed to record payment'));
  }
});

module.exports = router;
