const { readJson, writeJson } = require('./data-store');
const {
  loadIntegrationSettings,
  saveIntegrationSettings,
  resolveMikrotikRouter,
  isIntegrationSettingsUnreadableError
} = require('./integration-settings');
const { query } = require('./db');
const { assertRelationalReady } = require('./db-relational');
const { assignEntryNumbers, assertEntryNumbersAvailable, withTransaction } = require('./payment-numbering');
const { connectMikrotikClient } = require('./mikrotik-client');
const { auditMikrotikPppoeCommand } = require('./mikrotik-audit-log');
const customersModule = require('./customers');
const { resolvePlanProfileForRouter } = require('./plan-profile-utils');
const {
  dedupeActivePppoeSessions,
  dedupePppoeAccounts,
  mergePppoeAccountEntries,
  normalizePppoeRouterId,
  normalizePppoeUsernameKey
} = require('./pppoe-account-utils');

const STORE_KEYS = {
  customers: 'customers',
  payments: 'payments',
  plans: 'plans'
};
const BILLING_CLOCK_GUARD_KEY = 'billing-clock-guard';
const SYSTEM_RECORDER = { id: 'system', username: 'System', role: 'System' };
const BILLING_CLOCK_GUARD_MAX_FORWARD_DAYS = (() => {
  const fallback = 1;
  const configured = Number(process.env.BILLING_CLOCK_GUARD_MAX_FORWARD_DAYS);
  if (!Number.isFinite(configured) || configured < 0) return fallback;
  return Math.floor(configured);
})();
const BILLING_CLOCK_GUARD_RECONCILE_MIN_ACTIVITY_DAYS = (() => {
  const fallback = 2;
  const configured = Number(process.env.BILLING_CLOCK_GUARD_RECONCILE_MIN_ACTIVITY_DAYS);
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.floor(configured);
})();
const BILLING_CLOCK_GUARD_RECONCILE_MAX_STALE_DAYS = (() => {
  const fallback = 7;
  const configured = Number(process.env.BILLING_CLOCK_GUARD_RECONCILE_MAX_STALE_DAYS);
  if (!Number.isFinite(configured) || configured < 0) return fallback;
  return Math.floor(configured);
})();

function warnIntegrationSettingsUnreadable(error, context, branchId = null) {
  const branchLabel = branchId || error?.branchId || 'default';
  console.warn(
    `[billing] Skipped ${context} for branch ${branchLabel}: ${error?.message || error}`
  );
}
const GRACE_ENFORCEMENT_LOG_THROTTLE_MS = (() => {
  const fallback = 10 * 60 * 1000;
  const configured = Number(process.env.GRACE_ENFORCEMENT_LOG_THROTTLE_MS);
  if (!Number.isFinite(configured) || configured < 0) return fallback;
  return configured;
})();
const GRACE_ENFORCEMENT_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const BILLING_CLOCK_GUARD_LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const PPPOE_ENFORCEMENT_BULK_DISABLE_MIN = (() => {
  const fallback = 10;
  const configured = Number(process.env.PPPOE_ENFORCEMENT_BULK_DISABLE_MIN ?? process.env.PPPPOE_ENFORCEMENT_BULK_DISABLE_MIN);
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.floor(configured);
})();
const PPPOE_ENFORCEMENT_BULK_DISABLE_RATIO = (() => {
  const fallback = 0.35;
  const configured = Number(process.env.PPPOE_ENFORCEMENT_BULK_DISABLE_RATIO ?? process.env.PPPPOE_ENFORCEMENT_BULK_DISABLE_RATIO);
  if (!Number.isFinite(configured) || configured <= 0 || configured > 1) return fallback;
  return configured;
})();
const PPPOE_ENFORCEMENT_FULL_DISABLE_MIN = (() => {
  const fallback = 2;
  const configured = Number(process.env.PPPOE_ENFORCEMENT_FULL_DISABLE_MIN ?? process.env.PPPPOE_ENFORCEMENT_FULL_DISABLE_MIN);
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.floor(configured);
})();
const PPPOE_ENFORCEMENT_FULL_DISABLE_RATIO = (() => {
  const fallback = 0.9;
  const configured = Number(process.env.PPPOE_ENFORCEMENT_FULL_DISABLE_RATIO ?? process.env.PPPPOE_ENFORCEMENT_FULL_DISABLE_RATIO);
  if (!Number.isFinite(configured) || configured <= 0 || configured > 1) return fallback;
  return configured;
})();
const PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE =
  String((process.env.PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE ?? process.env.PPPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE) || '').trim().toLowerCase() === 'true';
const graceEnforcementErrorLogState = new Map();
const billingClockGuardLogState = new Map();

function shouldLogGraceEnforcementError(routerKey, err) {
  const now = Date.now();
  const code = String(err?.code || (Number.isFinite(Number(err?.errno)) ? `errno:${Number(err.errno)}` : '') || 'unknown').toLowerCase();
  const msg = String(err?.message || err || '').trim().toLowerCase().slice(0, 200);
  const key = `${String(routerKey || 'unknown')}|${code}|${msg}`;
  const state = graceEnforcementErrorLogState.get(key) || {
    lastLoggedAt: 0,
    suppressed: 0,
    lastSeenAt: now
  };

  state.lastSeenAt = now;

  const due = !state.lastLoggedAt || (now - state.lastLoggedAt) >= GRACE_ENFORCEMENT_LOG_THROTTLE_MS;
  if (due) {
    const suppressed = state.suppressed;
    state.lastLoggedAt = now;
    state.suppressed = 0;
    graceEnforcementErrorLogState.set(key, state);
    if (graceEnforcementErrorLogState.size > 300) {
      for (const [entryKey, entry] of graceEnforcementErrorLogState.entries()) {
        if (!entry || (now - Number(entry.lastSeenAt || 0)) > GRACE_ENFORCEMENT_LOG_RETENTION_MS) {
          graceEnforcementErrorLogState.delete(entryKey);
        }
      }
    }
    return { log: true, suppressed };
  }

  state.suppressed += 1;
  graceEnforcementErrorLogState.set(key, state);
  return { log: false, suppressed: state.suppressed };
}

function logBillingClockGuardBlocked(guard = {}, attempt = 'run') {
  const now = Date.now();
  const reason = String(guard?.reason || 'Unsafe billing clock state').trim();
  const lastSafeDate = String(guard?.lastSafeDate || '').trim() || 'unknown';
  const observedDate = String(guard?.observedDate || '').trim() || 'unknown';
  const key = `${reason}|${lastSafeDate}|${observedDate}`;
  const existing = billingClockGuardLogState.get(key);
  if (existing) {
    existing.lastSeenAt = now;
    existing.suppressed += 1;
    billingClockGuardLogState.set(key, existing);
    return false;
  }

  billingClockGuardLogState.set(key, {
    lastSeenAt: now,
    suppressed: 0
  });

  if (billingClockGuardLogState.size > 50) {
    for (const [entryKey, entry] of billingClockGuardLogState.entries()) {
      if (!entry || (now - Number(entry.lastSeenAt || 0)) > BILLING_CLOCK_GUARD_LOG_RETENTION_MS) {
        billingClockGuardLogState.delete(entryKey);
      }
    }
  }

  const resetCommand = observedDate !== 'unknown'
    ? `node scripts/reset-billing-clock-guard.js --date=${observedDate}`
    : 'node scripts/reset-billing-clock-guard.js --date=YYYY-MM-DD';
  console.error(
    `Billing clock guard blocked ${attempt}: ${reason} (last safe ${lastSafeDate}, observed ${observedDate}). `
    + `Duplicate logs for this blocked state will be suppressed until the date state changes. `
    + `After verifying the server date, reset with "${resetCommand}".`
  );
  return true;
}

const readCustomers = async (branchId = null) => {
  if (typeof customersModule.readVisibleCustomers === 'function') {
    return customersModule.readVisibleCustomers(branchId);
  }
  if (typeof customersModule.readCustomers === 'function') {
    return customersModule.readCustomers(branchId);
  }
  return readStore(STORE_KEYS.customers, []);
};

const readPayments = async (branchId = null) => {
  if (typeof customersModule.readPayments === 'function') {
    return customersModule.readPayments(branchId);
  }
  return readStore(STORE_KEYS.payments, {});
};

const readPlans = async (branchId = null) => {
  if (typeof customersModule.readPlans === 'function') {
    return customersModule.readPlans(branchId);
  }
  return readStore(STORE_KEYS.plans, []);
};

const writeCustomers = async (customers, branchId = null) => {
  if (typeof customersModule.writeCustomers === 'function') {
    return customersModule.writeCustomers(customers, branchId);
  }
  return writeStore(STORE_KEYS.customers, customers);
};

function pad(n) { return String(n).padStart(2, '0'); }

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const MANILA_OFFSET_MS = 8 * ONE_HOUR_MS;

function clampDay(year, monthIndex, day) {
  // monthIndex is 0-based; get last day of month by day 0 of next month
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(day, lastDay);
}

function getManilaDateParts(now = new Date()) {
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  return {
    year: manilaNow.getUTCFullYear(),
    month: manilaNow.getUTCMonth(),
    day: manilaNow.getUTCDate()
  };
}

function getManilaStartOfDay(now = new Date()) {
  const { year, month, day } = getManilaDateParts(now);
  return new Date(year, month, day);
}

function diffWholeDays(later, earlier) {
  if (!(later instanceof Date) || isNaN(later) || !(earlier instanceof Date) || isNaN(earlier)) return null;
  return Math.round((later.getTime() - earlier.getTime()) / ONE_DAY_MS);
}

function toMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (isNaN(value)) return null;
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw} 00:00:00`;
  }
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

async function readStore(key, fallback) {
  const data = await readJson(key, fallback);
  if (Array.isArray(fallback)) return Array.isArray(data) ? data : fallback;
  if (fallback && typeof fallback === 'object') return data && typeof data === 'object' ? data : fallback;
  return data ?? fallback;
}

async function writeStore(key, data) {
  await writeJson(key, data);
}

async function listBranchIds() {
  await assertRelationalReady();
  const [rows] = await query('SELECT id FROM branches');
  return (rows || []).map((row) => row.id);
}

async function insertPaymentEntry(entry, branchId, accountNumber, executor = null) {
  const runQuery = executor && typeof executor.query === 'function'
    ? executor.query.bind(executor)
    : query;
  const recordedAt = toMysqlDateTime(entry.recordedAt || entry.date);
  const entryDate = toMysqlDateOnly(entry.date || entry.recordedAt);
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
      entry.recordedBy?.id ? String(entry.recordedBy.id) : null,
      entry.recordedBy?.username || null,
      entry.recordedBy?.name || null,
      entry.recordedBy?.role || null,
      entry.payer || null,
      entry.status || null,
      entry.paymentMethod || null,
      entry.fingerprint || null,
      entry.xenditId || null
    ]
  );
  return true;
}

function makeBillId(accountNumber, year, month) {
  return `bill-${accountNumber}-${year}-${pad(month + 1)}`; // month index -> 1-based
}

function normalizeMikrotikCreds(raw = {}) {
  const address = String(raw.address || raw.host || '').trim();
  const username = String(raw.username || raw.user || '').trim();
  const password = raw.password != null ? String(raw.password) : '';
  const port = raw.port ? Number(raw.port) : undefined;
  return { address, username, password, port };
}

function resolveCustomerRouterId(customer, settings) {
  const explicit = String(customer?.mikrotikId || customer?.routerId || '').trim();
  return explicit || String(settings?.mikrotikDefaultId || '').trim();
}

function mergeAccountsForRouter(settings, routerId, routerAccounts) {
  const normalizedRouterId = normalizePppoeRouterId(routerId, settings?.mikrotikDefaultId || '');
  const existing = dedupePppoeAccounts(
    Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [],
    settings?.mikrotikDefaultId || normalizedRouterId
  );
  const existingByUsername = new Map(
    existing
      .filter((acc) => normalizePppoeRouterId(acc?.routerId, settings?.mikrotikDefaultId || normalizedRouterId) === normalizedRouterId)
      .map((acc) => [normalizePppoeUsernameKey(acc?.username), acc])
      .filter(([username]) => Boolean(username))
  );
  const preserved = existing.filter(
    (acc) => normalizePppoeRouterId(acc?.routerId, settings?.mikrotikDefaultId || normalizedRouterId) !== normalizedRouterId
  );
  const nextAccounts = dedupePppoeAccounts(routerAccounts, normalizedRouterId).map((acc) => {
    const previous = existingByUsername.get(normalizePppoeUsernameKey(acc?.username)) || null;
    return mergePppoeAccountEntries(previous, { ...acc, routerId: normalizedRouterId }, normalizedRouterId);
  });
  return dedupePppoeAccounts([...preserved, ...nextAccounts], settings?.mikrotikDefaultId || normalizedRouterId);
}

async function connectMikrotik(creds) {
  if (!creds.address || !creds.username || !creds.password) {
    throw new Error('Missing MikroTik credentials');
  }
  return connectMikrotikClient(creds, {
    keepalive: false,
    timeout: 8000
  });
}

function buildPppoeAccounts(secrets = [], activeSessions = []) {
  const activeMap = new Map();
  dedupeActivePppoeSessions(activeSessions).forEach((session) => {
    const u = session.username || session.name || session.user || '';
    if (u) activeMap.set(normalizePppoeUsernameKey(u), session);
  });
  const claimedActiveUsers = new Set();

  return dedupePppoeAccounts(Array.isArray(secrets)
    ? secrets
        .map((secret) => {
          const username = secret.name || secret.user || '';
          if (!username) return null;
          const disabled = String(secret.disabled || '').toLowerCase() === 'true';
          const usernameKey = normalizePppoeUsernameKey(username);
          const active = claimedActiveUsers.has(usernameKey) ? null : (activeMap.get(usernameKey) || null);
          if (active) claimedActiveUsers.add(usernameKey);
          const status = disabled ? 'disabled' : active ? 'online' : 'offline';
          return {
            username,
            password: secret.password || '',
            profile: secret.profile || '',
            pairedCustomer: '',
            pairedPppoe: '',
            status,
            routerDisabled: disabled,
            inactiveSince: secret['last-logged-out'] || '',
            sessionUptime: active?.uptime || active?.['session-uptime'] || '',
            activeAddress: active?.address || active?.['remote-address'] || ''
          };
        })
        .filter(Boolean)
    : []);
}

function latestCreditDate(paymentsForAccount = []) {
  const credits = Array.isArray(paymentsForAccount)
    ? paymentsForAccount.filter((p) => {
        const kind = String(p.kind || '').toLowerCase();
        const creditKinds = new Set(['payment', 'rebate', 'discount']);
        const amount = Number(p.amount);
        return creditKinds.has(kind) && Number.isFinite(amount) && amount > 0;
      })
    : [];
  if (!credits.length) return null;
  const parsedDates = credits
    .map((p) => {
      const d = p.date || p.recordedAt;
      const parsed = d ? new Date(d) : null;
      return parsed && !isNaN(parsed) ? parsed : null;
    })
    .filter(Boolean);
  if (!parsedDates.length) return null;
  return new Date(Math.max(...parsedDates.map((d) => d.getTime())));
}

function computeBalance(paymentsForAccount = []) {
  if (!Array.isArray(paymentsForAccount)) return 0;
  let balance = 0;
  paymentsForAccount.forEach((p) => {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount)) return;
    const kind = String(p.kind || '').toLowerCase();
    const direction = String(p.direction || '').toLowerCase();
    const isDebit = direction === 'debit' || kind === 'charge';
    const isCredit = direction === 'credit' || ['payment', 'rebate', 'discount'].includes(kind);
    if (isDebit) balance += amount;
    else if (isCredit) balance -= amount;
  });
  return balance;
}

function normalizePlanName(name) {
  return String(name || '').trim().toLowerCase();
}

const STATUS_ACTIVE = 'active';
const STATUS_INACTIVE = 'inactive';
const STATUS_DISABLED = 'disabled';
const STATUS_MODE_AUTO = 'auto';

function normalizeStatusValue(value, fallback = STATUS_ACTIVE) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'force-inactive') return STATUS_INACTIVE;
  if (raw === STATUS_ACTIVE || raw === STATUS_INACTIVE || raw === STATUS_DISABLED) return raw;
  if (raw === 'force-active') return STATUS_ACTIVE; // backward compatibility
  return fallback;
}

function resolveCustomerStatusState(customer = {}) {
  const rawStatus = String(customer?.status || '').trim().toLowerCase();
  const status = normalizeStatusValue(rawStatus, STATUS_ACTIVE);
  return {
    status,
    statusMode: STATUS_MODE_AUTO,
    stored: status
  };
}

function parseDateOnly(value) {
  const parts = String(value || '').trim().split('-').map((p) => Number(p));
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return isNaN(date) ? null : date;
}

async function readBillingClockGuardState() {
  const state = await readJson(BILLING_CLOCK_GUARD_KEY, {});
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
}

async function writeBillingClockGuardState(state) {
  await writeJson(BILLING_CLOCK_GUARD_KEY, state || {});
}

async function findBillingClockGuardReconciliation(lastSafeDate, observedDate, observedDateValue) {
  if (!lastSafeDate || !observedDate) return null;
  try {
    const [rows] = await query(
      `SELECT
          MAX(DATE(recorded_at)) AS latestRecordedDate,
          COUNT(DISTINCT DATE(recorded_at)) AS distinctRecordedDays,
          COUNT(*) AS entryCount
       FROM payment_entries
       WHERE recorded_at IS NOT NULL
         AND DATE(recorded_at) > ?
         AND DATE(recorded_at) <= ?
         AND LOWER(COALESCE(kind, '')) = 'charge'
         AND LOWER(COALESCE(description, '')) = 'monthly recurring charge'`,
      [lastSafeDate, observedDate]
    );
    const row = rows?.[0] || {};
    const latestRecordedDate = toMysqlDateOnly(row.latestRecordedDate);
    const latestRecordedDateValue = parseDateOnly(latestRecordedDate);
    if (!latestRecordedDateValue) return null;

    const distinctRecordedDays = Number(row.distinctRecordedDays || 0);
    if (distinctRecordedDays < BILLING_CLOCK_GUARD_RECONCILE_MIN_ACTIVITY_DAYS) return null;

    const staleDays = diffWholeDays(observedDateValue, latestRecordedDateValue);
    if (!Number.isFinite(staleDays) || staleDays > BILLING_CLOCK_GUARD_RECONCILE_MAX_STALE_DAYS) return null;

    return {
      latestRecordedDate,
      distinctRecordedDays,
      entryCount: Number(row.entryCount || 0),
      staleDays
    };
  } catch (error) {
    console.warn('Unable to reconcile billing clock guard from MRC history:', error?.message || error);
    return null;
  }
}

async function ensureBillingClockSafe(now = new Date(), source = 'billing-run') {
  const observedDateValue = getManilaStartOfDay(now);
  const observedDate = formatDateOnly(observedDateValue);
  const observedAt = new Date().toISOString();
  const state = await readBillingClockGuardState();
  const lastSafeDate = String(state?.lastSafeDate || '').trim();
  const lastSafeDateValue = parseDateOnly(lastSafeDate);

  if (lastSafeDateValue) {
    const diffDays = diffWholeDays(observedDateValue, lastSafeDateValue);
    if (Number.isFinite(diffDays) && diffDays > BILLING_CLOCK_GUARD_MAX_FORWARD_DAYS) {
      const reconciliation = await findBillingClockGuardReconciliation(lastSafeDate, observedDate, observedDateValue);
      if (reconciliation) {
        console.warn(
          `Billing clock guard reconciled stale safe date ${lastSafeDate} to ${observedDate} using `
          + `${reconciliation.distinctRecordedDays} MRC activity days through ${reconciliation.latestRecordedDate}.`
        );
        const nextState = {
          ...state,
          lastSeenDate: observedDate,
          lastSeenAt: observedAt,
          lastSeenSource: source,
          lastSafeDate: observedDate,
          lastSafeAt: observedAt,
          lastSafeSource: `${source}:reconciled`,
          blocked: false,
          blockedAt: null,
          blockedSource: null,
          blockedObservedDate: null,
          blockedLastSafeDate: null,
          blockedDiffDays: null,
          reason: null,
          reconciledAt: observedAt,
          reconciledFromLastSafeDate: lastSafeDate,
          reconciledObservedDate: observedDate,
          reconciledLatestBillingDate: reconciliation.latestRecordedDate,
          reconciledActivityDays: reconciliation.distinctRecordedDays,
          reconciledEntryCount: reconciliation.entryCount,
          reconciledStaleDays: reconciliation.staleDays
        };
        await writeBillingClockGuardState(nextState);
        return {
          ok: true,
          observedDate,
          lastSafeDate: nextState.lastSafeDate,
          reconciled: true,
          reconciliation
        };
      }

      const sameBlockedState = Boolean(state?.blocked)
        && String(state?.blockedObservedDate || '').trim() === observedDate
        && String(state?.blockedLastSafeDate || '').trim() === lastSafeDate
        && Number(state?.blockedDiffDays) === diffDays;
      const nextState = {
        ...state,
        lastSeenDate: observedDate,
        lastSeenAt: observedAt,
        lastSeenSource: source,
        blocked: true,
        blockedAt: sameBlockedState ? (state?.blockedAt || observedAt) : observedAt,
        blockedSource: sameBlockedState ? (state?.blockedSource || source) : source,
        blockedObservedDate: observedDate,
        blockedLastSafeDate: lastSafeDate,
        blockedDiffDays: diffDays,
        reason: `Observed Manila date jumped forward by ${diffDays} days`
      };
      await writeBillingClockGuardState(nextState);
      return {
        ok: false,
        observedDate,
        lastSafeDate,
        diffDays,
        reason: nextState.reason
      };
    }
  }

  const observedIsOlder = lastSafeDateValue && observedDateValue < lastSafeDateValue;
  const nextState = {
    ...state,
    lastSeenDate: observedDate,
    lastSeenAt: observedAt,
    lastSeenSource: source,
    blocked: false,
    blockedAt: null,
    blockedSource: null,
    blockedObservedDate: null,
    blockedLastSafeDate: null,
    blockedDiffDays: null,
    reason: null
  };
  if (!observedIsOlder) {
    nextState.lastSafeDate = observedDate;
    nextState.lastSafeAt = observedAt;
    nextState.lastSafeSource = source;
  }
  await writeBillingClockGuardState(nextState);
  return {
    ok: true,
    observedDate,
    lastSafeDate: nextState.lastSafeDate || observedDate,
    observedIsOlder: Boolean(observedIsOlder)
  };
}

function formatDateOnly(value) {
  if (!(value instanceof Date) || isNaN(value)) return '';
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatManilaDateTime(now = new Date()) {
  const source = now instanceof Date ? now : new Date(now);
  if (isNaN(source)) return null;
  const manilaNow = new Date(source.getTime() + MANILA_OFFSET_MS);
  return `${manilaNow.getUTCFullYear()}-${pad(manilaNow.getUTCMonth() + 1)}-${pad(manilaNow.getUTCDate())} ${pad(manilaNow.getUTCHours())}:${pad(manilaNow.getUTCMinutes())}:${pad(manilaNow.getUTCSeconds())}`;
}

function parseBillingDay(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) {
    return numeric;
  }
  const parsed = parseDateOnly(value) || parseDateTime(value);
  if (parsed && !isNaN(parsed)) {
    return parsed.getDate();
  }
  return null;
}

function resolveScheduledBillDate(customer, now = new Date()) {
  const todayLocal = getManilaStartOfDay(now);
  const explicitBillDate = parseDateOnly(customer?.billDate);
  if (explicitBillDate) {
    return explicitBillDate;
  }

  const billDay = parseBillingDay(customer?.billDate) || 1;
  return new Date(
    todayLocal.getFullYear(),
    todayLocal.getMonth(),
    clampDay(todayLocal.getFullYear(), todayLocal.getMonth(), billDay)
  );
}

function advanceMonthlyCycleDate(baseDate, months = 1) {
  if (!(baseDate instanceof Date) || isNaN(baseDate)) return null;
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + months;
  const day = baseDate.getDate();
  return new Date(year, month, clampDay(year, month, day));
}

function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function isSameBillingMonth(left, right) {
  return Boolean(
    left instanceof Date
    && right instanceof Date
    && !isNaN(left)
    && !isNaN(right)
    && left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
  );
}

function getInclusiveDayCount(startDate, endDate) {
  if (!(startDate instanceof Date) || isNaN(startDate) || !(endDate instanceof Date) || isNaN(endDate)) return 0;
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  if (endUtc < startUtc) return 0;
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function isExistingCustomerStart(customer = {}) {
  const raw = String(
    customer?.customerStartType
    || customer?.subscriberStartType
    || customer?.customerOrigin
    || ''
  ).trim().toLowerCase();
  return raw === 'existing';
}

function resolveFirstBillingCharge(customer = {}, billDate, fullPlanAmount = 0) {
  const planAmount = Number(fullPlanAmount) || 0;
  const activationDate = parseDateOnly(customer?.activationDate);
  if (isExistingCustomerStart(customer) && activationDate && (billDate instanceof Date) && !isNaN(billDate) && isSameBillingMonth(activationDate, billDate)) {
    return {
      amount: 0,
      prorated: false,
      periodStart: null,
      periodEnd: null,
      skipInitialCharge: true
    };
  }
  return {
    amount: roundMoney(planAmount),
    prorated: false,
    periodStart: null,
    periodEnd: null
  };
}

function alignBillDateOnOrAfterActivationDate(billDate, activationDateValue) {
  if (!(billDate instanceof Date) || isNaN(billDate)) return null;
  const activationDate = parseDateOnly(activationDateValue);
  if (!activationDate || billDate >= activationDate) return billDate;

  const billDay = billDate.getDate();
  let year = activationDate.getFullYear();
  let month = activationDate.getMonth();
  let candidate = new Date(year, month, clampDay(year, month, billDay));
  if (candidate < activationDate) {
    month += 1;
    candidate = new Date(year, month, clampDay(year, month, billDay));
  }
  return candidate;
}

function deriveDueOffset(customer = {}) {
  const raw = Number(customer?.dueOffset);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);

  const bill = parseDateOnly(customer?.billDate) || parseDateTime(customer?.billDate);
  const due = parseDateOnly(customer?.dueDate) || parseDateTime(customer?.dueDate);
  if (bill && due && !isNaN(bill) && !isNaN(due)) {
    const diffDays = Math.round((due.getTime() - bill.getTime()) / (1000 * 60 * 60 * 24));
    if (Number.isFinite(diffDays) && diffDays >= 0) {
      return diffDays;
    }
  }

  return null;
}

function buildNextBillingCycleState(customer = {}, currentBillDate) {
  const nextBillDate = advanceMonthlyCycleDate(currentBillDate, 1);
  if (!nextBillDate) return null;

  const offset = deriveDueOffset(customer);
  let nextDueDate = customer?.dueDate || null;
  if (offset != null) {
    const dueDate = new Date(nextBillDate.getTime());
    dueDate.setDate(dueDate.getDate() + offset);
    nextDueDate = formatDateOnly(dueDate) || null;
  }

  return {
    billDate: formatDateOnly(nextBillDate) || null,
    dueDate: nextDueDate
  };
}

function buildActivationAlignedBillingCycleState(customer = {}, scheduledBillDate) {
  const alignedBillDate = alignBillDateOnOrAfterActivationDate(scheduledBillDate, customer?.activationDate);
  if (!alignedBillDate) return null;
  if (alignedBillDate.getTime() === scheduledBillDate.getTime()) {
    return { billDate: scheduledBillDate, changed: false, state: null };
  }

  const offset = deriveDueOffset(customer);
  let dueDate = customer?.dueDate || null;
  if (offset != null) {
    const alignedDueDate = new Date(alignedBillDate.getTime());
    alignedDueDate.setDate(alignedDueDate.getDate() + offset);
    dueDate = formatDateOnly(alignedDueDate) || null;
  }

  return {
    billDate: alignedBillDate,
    changed: true,
    state: {
      billDate: formatDateOnly(alignedBillDate) || null,
      dueDate
    }
  };
}

function parseDateTime(value) {
  if (value instanceof Date) {
    return isNaN(value) ? null : new Date(value.getTime());
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(' ', 'T');
  const parsed = new Date(normalized);
  return isNaN(parsed) ? null : parsed;
}

function resolvePrepaidExpirationDate(customer = {}) {
  const explicit = parseDateTime(customer?.prepaidExpirationAt);
  if (explicit) return explicit;
  const due = parseDateOnly(customer?.dueDate);
  if (!due) return null;
  due.setHours(23, 59, 59, 999);
  return due;
}

function hasAssignedPlan(customer) {
  return Boolean(String(customer?.planName || '').trim());
}

function isPrepaidActive(customer, now = new Date()) {
  const explicitExpiry = parseDateTime(customer?.prepaidExpirationAt);
  if (explicitExpiry) return explicitExpiry.getTime() >= now.getTime();
  if (hasAssignedPlan(customer) && String(customer?.billDate || '').trim()) return true;
  const expiry = resolvePrepaidExpirationDate(customer);
  if (!expiry) return false;
  return expiry.getTime() >= now.getTime();
}

function isServiceEligible(customer, plans = [], now = new Date()) {
  const planCategory = resolvePlanCategory(customer, plans);
  if (planCategory === 'prepaid') {
    return isPrepaidActive(customer, now);
  }
  if (!hasAssignedPlan(customer)) return false;
  return true;
}

function resolvePlanCategory(customer, plans = []) {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid' || explicit === 'postpaid') return explicit;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return 'prepaid';
  if (billing.includes('postpaid')) return 'postpaid';
  const match = Array.isArray(plans)
    ? plans.find((p) => normalizePlanName(p.name) === normalizePlanName(customer?.planName))
    : null;
  if (match?.category) return String(match.category).toLowerCase();
  return 'postpaid';
}

function resolvePlanBillingLabel(category = '', fallback = '') {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  if (normalizedCategory === 'prepaid' || normalizedCategory === 'postpaid') return 'Monthly';
  return String(fallback || '').trim() || null;
}

function findPlanByIdOrName(plans = [], { planId = '', planName = '' } = {}) {
  const normalizedPlanId = String(planId || '').trim().toLowerCase();
  const normalizedPlanName = normalizePlanName(planName);
  if (!Array.isArray(plans) || (!normalizedPlanId && !normalizedPlanName)) return null;
  return plans.find((plan) => {
    const candidateId = String(plan?.id || plan?.plan_id || '').trim().toLowerCase();
    if (normalizedPlanId && candidateId && candidateId === normalizedPlanId) return true;
    if (!normalizedPlanName) return false;
    return [plan?.name, plan?.label, plan?.id, plan?.plan_id].some((candidate) =>
      normalizePlanName(candidate) === normalizedPlanName
    );
  }) || null;
}

function buildScheduledPlanReset() {
  return {
    scheduledPlanId: null,
    scheduledPlanName: null,
    scheduledPlanAmount: null,
    scheduledPlanBilling: null,
    scheduledPlanCategory: null,
    scheduledPlanApplyAt: null,
    scheduledPppoeProfile: null
  };
}

function resolveScheduledPlanSnapshot(customer = {}, plans = [], settings = {}) {
  const matchedPlan = findPlanByIdOrName(plans, {
    planId: customer?.scheduledPlanId,
    planName: customer?.scheduledPlanName
  });
  const planName = String(
    customer?.scheduledPlanName
    || matchedPlan?.name
    || matchedPlan?.label
    || matchedPlan?.id
    || ''
  ).trim();
  if (!planName) return null;
  const planCategory = resolvePlanCategory({
    planName,
    planCategory: customer?.scheduledPlanCategory,
    planBilling: customer?.scheduledPlanBilling
  }, matchedPlan ? [matchedPlan] : plans);
  const scheduledAmount = Number(customer?.scheduledPlanAmount);
  const matchedPrice = Number(matchedPlan?.price);
  return {
    planId: String(customer?.scheduledPlanId || matchedPlan?.id || matchedPlan?.plan_id || '').trim() || null,
    planName,
    planAmount: Number.isFinite(scheduledAmount)
      ? Number(scheduledAmount.toFixed(2))
      : (Number.isFinite(matchedPrice) ? Number(matchedPrice.toFixed(2)) : null),
    planBilling: resolvePlanBillingLabel(planCategory, customer?.scheduledPlanBilling || ''),
    planCategory: planCategory || 'prepaid',
    pppoeProfile: String(
      customer?.scheduledPppoeProfile
      || resolvePlanProfileForRouter(
        matchedPlan,
        resolveCustomerRouterId(customer, settings),
        settings?.mikrotikDefaultId || ''
      )
      || ''
    ).trim(),
    applyAt: parseDateTime(customer?.scheduledPlanApplyAt)
  };
}

function updateStoredPppoeProfile(settings = {}, customer = {}, profile = '') {
  const normalizedProfile = String(profile || '').trim();
  const usernameKey = normalizePppoeUsernameKey(customer?.pppoeUsername);
  if (!usernameKey || !normalizedProfile) {
    return { nextSettings: settings, changed: false };
  }
  const defaultRouterId = settings?.mikrotikDefaultId || '';
  const targetRouterId = normalizePppoeRouterId(resolveCustomerRouterId(customer, settings), defaultRouterId);
  const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
  let changed = false;
  const nextAccounts = accounts.map((entry) => {
    if (normalizePppoeUsernameKey(entry?.username) !== usernameKey) return entry;
    const entryRouterId = normalizePppoeRouterId(entry?.routerId, defaultRouterId);
    if (targetRouterId && entryRouterId && entryRouterId !== targetRouterId) return entry;
    if (String(entry?.profile || '').trim() === normalizedProfile) return entry;
    changed = true;
    return { ...entry, profile: normalizedProfile };
  });
  if (!changed) {
    return { nextSettings: settings, changed: false };
  }
  return {
    nextSettings: {
      ...settings,
      pppoe: { ...(settings?.pppoe || {}), accounts: nextAccounts }
    },
    changed: true
  };
}

async function syncScheduledPlanProfileToMikrotik(customer = {}, targetProfile = '', settings = {}) {
  const username = String(customer?.pppoeUsername || '').trim();
  const normalizedProfile = String(targetProfile || '').trim();
  if (!username || !normalizedProfile) {
    return { ok: true, nextSettings: settings, settingsChanged: false, appliedProfile: normalizedProfile };
  }
  if (!settings?.mikrotik?.enabled) {
    return { ok: false, nextSettings: settings, settingsChanged: false, reason: 'MikroTik integration is disabled.' };
  }

  const routerId = resolveCustomerRouterId(customer, settings);
  const router = resolveMikrotikRouter(settings, routerId);
  if (!router || router?.enabled === false) {
    return { ok: false, nextSettings: settings, settingsChanged: false, reason: 'No enabled MikroTik router is configured for this customer.' };
  }

  const creds = normalizeMikrotikCreds(router);
  if (!creds.address || !creds.username || !creds.password) {
    return { ok: false, nextSettings: settings, settingsChanged: false, reason: 'MikroTik router credentials are incomplete.' };
  }

  let client = null;
  try {
    const connected = await connectMikrotik(creds);
    client = connected.client;
    const api = connected.api;
    const profileMenu = api.menu('/ppp profile');
    const profiles = await profileMenu.get().catch(() => []);
    const matchedProfile = (Array.isArray(profiles) ? profiles : []).find((entry) =>
      normalizePlanName(entry?.name || entry?.profile || entry?.id) === normalizePlanName(normalizedProfile)
    ) || null;
    if (!matchedProfile) {
      throw new Error(`PPPoE profile ${normalizedProfile} does not exist on the assigned router.`);
    }

    const profileName = String(
      matchedProfile?.name || matchedProfile?.profile || matchedProfile?.id || normalizedProfile
    ).trim();
    const secretMenu = api.menu('/ppp secret');
    const secrets = await secretMenu.get().catch(() => []);
    const existingSecret = (Array.isArray(secrets) ? secrets : []).find((entry) =>
      normalizePppoeUsernameKey(entry?.name || entry?.user) === normalizePppoeUsernameKey(username)
    ) || null;
    if (!existingSecret) {
      throw new Error(`PPPoE secret ${username} was not found on the assigned router.`);
    }

    const secretId = String(existingSecret?.['.id'] || existingSecret?.id || '').trim();
    try {
      if (secretId) {
        await secretMenu.where('.id', secretId).update({ profile: profileName });
      } else {
        throw new Error('Missing secret ID');
      }
    } catch (_firstError) {
      try {
        if (secretId) {
          await secretMenu.where('.id', secretId).update({ profile: profileName });
        } else {
          throw new Error('Missing secret ID');
        }
      } catch (_secondError) {
        await secretMenu.where('name', existingSecret?.name || username).update({ profile: profileName });
      }
    }
    const { nextSettings, changed } = updateStoredPppoeProfile(settings, customer, profileName);
    return {
      ok: true,
      nextSettings,
      settingsChanged: changed,
      appliedProfile: profileName
    };
  } catch (error) {
    return {
      ok: false,
      nextSettings: settings,
      settingsChanged: false,
      reason: error?.message || error
    };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

async function applyDueScheduledPrepaidPlanChangesForBranch(branchId, now = new Date()) {
  const customers = await readCustomers(branchId);
  const plans = await readPlans(branchId);
  let settings;
  try {
    settings = await loadIntegrationSettings(branchId);
  } catch (error) {
    if (isIntegrationSettingsUnreadableError(error)) {
      warnIntegrationSettingsUnreadable(error, 'scheduled prepaid plan changes', branchId);
      return { applied: 0, pending: 0, skipped: 'integration-settings-unreadable' };
    }
    throw error;
  }
  let customersChanged = false;
  let settingsChanged = false;
  let applied = 0;
  let pending = 0;

  for (let index = 0; index < customers.length; index += 1) {
    const customer = customers[index];
    const applyAt = parseDateTime(customer?.scheduledPlanApplyAt);
    if (!applyAt || applyAt.getTime() > now.getTime()) continue;

    const scheduledSnapshot = resolveScheduledPlanSnapshot(customer, plans, settings);
    if (!scheduledSnapshot?.planName) {
      customers[index] = { ...customer, ...buildScheduledPlanReset() };
      customersChanged = true;
      continue;
    }

    const hasLinkedPppoe = Boolean(String(customer?.pppoeUsername || '').trim());
    let appliedProfile = String(scheduledSnapshot.pppoeProfile || '').trim();
    if (hasLinkedPppoe && appliedProfile) {
      const routerSync = await syncScheduledPlanProfileToMikrotik(customer, appliedProfile, settings);
      settings = routerSync.nextSettings || settings;
      settingsChanged = settingsChanged || Boolean(routerSync.settingsChanged);
      if (!routerSync.ok) {
        pending += 1;
        console.warn(
          `[billing] Deferred scheduled prepaid plan change for ${customer?.accountNumber || 'unknown'}: ${routerSync.reason}`
        );
        continue;
      }
      appliedProfile = String(routerSync.appliedProfile || appliedProfile).trim();
    }

    if (hasLinkedPppoe && !appliedProfile) {
      console.warn(
        `[billing] Scheduled prepaid plan change for ${customer?.accountNumber || 'unknown'} has no MikroTik profile snapshot; keeping existing PPPoE profile.`
      );
    }

    customers[index] = {
      ...customer,
      planId: scheduledSnapshot.planId,
      planName: scheduledSnapshot.planName,
      planAmount: scheduledSnapshot.planAmount,
      planBilling: scheduledSnapshot.planBilling,
      planCategory: scheduledSnapshot.planCategory,
      pppoeProfile: appliedProfile || customer?.pppoeProfile || null,
      ...buildScheduledPlanReset()
    };
    customersChanged = true;
    applied += 1;
  }

  if (customersChanged) {
    await writeCustomers(customers, branchId);
  }
  if (settingsChanged) {
    await saveIntegrationSettings(settings, branchId);
  }

  return { applied, pending };
}

function isOverCreditLimit(customer, paymentsForAccount = []) {
  if (!customer) return false;
  const balance = computeBalance(paymentsForAccount);
  if (balance <= 0) return false;
  const limitRaw = Number(customer.creditLimit);
  const fallbackLimit = Number(customer.planAmount) || 0;
  const creditLimit = Number.isFinite(limitRaw) && limitRaw >= 0 ? limitRaw : fallbackLimit;
  if (creditLimit <= 0) return balance > 0;
  return balance > creditLimit;
}

function isOverLimitNoPppoe(customer, paymentsForAccount = []) {
  if (!customer) return false;
  return isOverCreditLimit(customer, paymentsForAccount);
}

function shouldBlockBulkPppoeDisable({ disableTargets = [], secretsByName = new Map(), linkedCount = 0, routerId = '' } = {}) {
  if (PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE) return false;
  const targets = Array.from(disableTargets || []);
  const newDisableTargets = targets.filter((target) => {
    const match = secretsByName.get(String(target || '').trim().toLowerCase());
    if (!match) return false;
    return String(match.disabled || '').toLowerCase() !== 'true';
  });
  const candidateCount = newDisableTargets.length;
  const denominator = Math.max(Number(linkedCount) || 0, secretsByName.size || 0, 1);
  const ratio = candidateCount / denominator;
  const linkedDenominator = Math.max(Number(linkedCount) || 0, 1);
  const linkedRatio = candidateCount / linkedDenominator;
  const isFullRouterDisable =
    candidateCount >= PPPOE_ENFORCEMENT_FULL_DISABLE_MIN
    && (ratio >= PPPOE_ENFORCEMENT_FULL_DISABLE_RATIO || linkedRatio >= PPPOE_ENFORCEMENT_FULL_DISABLE_RATIO);
  const isBulkDisable =
    candidateCount >= PPPOE_ENFORCEMENT_BULK_DISABLE_MIN
    && ratio >= PPPOE_ENFORCEMENT_BULK_DISABLE_RATIO;
  if (!isFullRouterDisable && !isBulkDisable) return false;
  console.error(
    `[billing] Blocked bulk PPPoE disable on router ${routerId || 'unknown'}: `
    + `${candidateCount}/${denominator} accounts would be disabled (${Math.round(ratio * 100)}%). `
    + `This protects against bad plan/payment/date data. Set PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE=true to override intentionally.`
  );
  return true;
}

function getActivePppoeSessionId(session = {}) {
  return String(session?.['.id'] || session?.id || '').trim();
}

function getActivePppoeSessionUsername(session = {}) {
  return String(session?.name || session?.user || session?.username || '').trim();
}

async function removeActivePppoeSession(api, session = {}, username = '') {
  const activeMenu = api.menu('/ppp active');
  const sessionId = getActivePppoeSessionId(session);
  const sessionUsername = getActivePppoeSessionUsername(session) || String(username || '').trim();
  const attempts = [];

  if (sessionId && api?.rosApi && typeof api.rosApi.write === 'function') {
    attempts.push(() => api.rosApi.write(['/ppp/active/remove', `=.id=${sessionId}`]));
  }
  if (sessionId) {
    attempts.push(() => activeMenu.remove(sessionId));
    attempts.push(() => activeMenu.remove({ '.id': sessionId }));
  }
  if (sessionUsername) {
    attempts.push(() => activeMenu.where('name', sessionUsername).remove());
    attempts.push(() => activeMenu.where('user', sessionUsername).remove());
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function disconnectActivePppoeSessions(api, usernames = []) {
  const targetKeys = new Set(
    Array.from(usernames || [])
      .map((username) => normalizePppoeUsernameKey(username))
      .filter(Boolean)
  );
  if (!targetKeys.size) return 0;

  const activeSessions = await api.menu('/ppp active').get().catch(() => []);
  let disconnected = 0;
  for (const session of Array.isArray(activeSessions) ? activeSessions : []) {
    const sessionUsername = getActivePppoeSessionUsername(session);
    const sessionKey = normalizePppoeUsernameKey(sessionUsername);
    if (!sessionKey || !targetKeys.has(sessionKey)) continue;
    try {
      const removed = await removeActivePppoeSession(api, session, sessionUsername);
      if (removed) disconnected += 1;
    } catch (error) {
      console.warn(
        `Failed to remove active PPPoE session ${sessionUsername || getActivePppoeSessionId(session) || 'unknown'}:`,
        error?.message || error
      );
    }
  }
  return disconnected;
}

function shouldBlockBulkCustomerInactive({ downgradeCount = 0, activeCount = 0, branchId = '' } = {}) {
  if (PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE) return false;
  const candidateCount = Number(downgradeCount) || 0;
  if (candidateCount < PPPOE_ENFORCEMENT_BULK_DISABLE_MIN) return false;
  const denominator = Math.max(Number(activeCount) || 0, 1);
  const ratio = candidateCount / denominator;
  if (ratio < PPPOE_ENFORCEMENT_BULK_DISABLE_RATIO) return false;
  console.error(
    `[billing] Blocked bulk customer inactive sync for branch ${branchId || 'unknown'}: `
    + `${candidateCount}/${denominator} active customers would become inactive (${Math.round(ratio * 100)}%). `
    + `This protects against bad plan/payment/date data. Set PPPOE_ENFORCEMENT_ALLOW_BULK_DISABLE=true to override intentionally.`
  );
  return true;
}

async function enforcePppoeGracePeriodForBranch(branchId, now = new Date()) {
  await applyDueScheduledPrepaidPlanChangesForBranch(branchId, now);
  const customers = await readCustomers(branchId);
  const payments = await readPayments(branchId);
  const plans = await readPlans(branchId);
  let settings;
  try {
    settings = await loadIntegrationSettings(branchId);
  } catch (error) {
    if (isIntegrationSettingsUnreadableError(error)) {
      warnIntegrationSettingsUnreadable(error, 'PPPoE grace enforcement', branchId);
      return { disabled: 0, enabled: 0, skipped: 'integration-settings-unreadable' };
    }
    throw error;
  }
  if (!settings?.mikrotik?.enabled) {
    return { disabled: 0, enabled: 0, skipped: 'disabled' };
  }

  const groupedByRouter = new Map();
  customers.forEach((customer, idx) => {
    const username = String(customer.pppoeUsername || '').trim();
    if (!username) return;
    const routerId = resolveCustomerRouterId(customer, settings);
    const router = resolveMikrotikRouter(settings, routerId);
    if (!router?.address || !router?.username || !router?.password) return;
    if (router?.enabled === false) return;
    const key = router.id || routerId;
    if (!key) return;
    if (!groupedByRouter.has(key)) {
      groupedByRouter.set(key, { router, indices: [], usernames: new Map() });
    }
    const entry = groupedByRouter.get(key);
    entry.indices.push(idx);
    entry.usernames.set(username.toLowerCase(), customer);
  });

  if (!groupedByRouter.size) {
    return { disabled: 0, enabled: 0, skipped: 'missing-credentials' };
  }

  let customersChanged = false;

  let totalDisabled = 0;
  let totalEnabled = 0;
  let totalDisconnected = 0;
  let nextAccounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];

  for (const [routerId, group] of groupedByRouter.entries()) {
    const creds = normalizeMikrotikCreds(group.router || {});
    if (!creds.address || !creds.username || !creds.password) continue;

    const overdueUsers = [];
    const eligibleUsers = [];
    const ineligibleUsers = [];
    group.usernames.forEach((customer, unameLower) => {
      const currentStatus = resolveCustomerStatusState(customer);
      if (currentStatus.status === STATUS_DISABLED) {
        // Disabled is admin lock: keep disabled and never auto-enable.
        ineligibleUsers.push(unameLower);
        return;
      }
      const payHistory = payments?.[customer.accountNumber]?.history || [];
      const eligible = isServiceEligible(customer, plans, now);
      if (!eligible) {
        ineligibleUsers.push(unameLower);
        return;
      }
      const planCategory = resolvePlanCategory(customer, plans);
      if (planCategory !== 'prepaid' && isOverCreditLimit(customer, payHistory)) {
        overdueUsers.push(unameLower);
        return;
      }
      eligibleUsers.push(unameLower);
    });

    if (!overdueUsers.length && !eligibleUsers.length && !ineligibleUsers.length) {
      continue;
    }

    let client;
    try {
      const connected = await connectMikrotik(creds);
      client = connected.client;
      const api = connected.api;

      const secretMenu = api.menu('/ppp secret');
      const secretsList = await secretMenu.get().catch(() => []);
      const secretsByName = new Map();
      secretsList.forEach((s) => {
        const u = String(s.name || s.user || '').trim();
        if (u) secretsByName.set(u.toLowerCase(), s);
      });

      let disabledCount = 0;
      let enabledCount = 0;
      let disconnectedCount = 0;
      const disableTargets = new Set([...overdueUsers, ...ineligibleUsers]);
      const blockBulkDisable = shouldBlockBulkPppoeDisable({
        disableTargets,
        secretsByName,
        linkedCount: group.usernames.size,
        routerId
      });
      if (!blockBulkDisable) {
        for (const target of disableTargets) {
          const match = secretsByName.get(target);
          if (!match) continue;
          const alreadyDisabled = String(match.disabled || '').toLowerCase() === 'true';
          if (alreadyDisabled) continue;
          try {
            await auditMikrotikPppoeCommand({
              branchId,
              source: 'billing-scheduler',
              routerId,
              username: match.name || target,
              secretId: match['.id'] || match.id || '',
              operation: 'update',
              selector: `name=${match.name || target}`,
              payload: { disabled: 'true' },
              reason: overdueUsers.includes(target) ? 'over-credit-limit' : 'ineligible-service'
            });
            await secretMenu.where('name', match.name || target).update({ disabled: 'true' });
            disabledCount += 1;
          } catch (e) {
            console.warn(`Failed to disable PPPoE ${target}:`, e?.message || e);
          }
        }
        disconnectedCount = await disconnectActivePppoeSessions(api, disableTargets);
        if (disconnectedCount > 0) {
          console.info(
            `[billing] Removed ${disconnectedCount} active PPPoE session${disconnectedCount === 1 ? '' : 's'} on router ${routerId || 'unknown'}.`
          );
        }
      }

      for (const target of eligibleUsers) {
        const match = secretsByName.get(target);
        if (!match) continue;
        const alreadyDisabled = String(match.disabled || '').toLowerCase() === 'true';
        if (!alreadyDisabled) continue;
        try {
          await auditMikrotikPppoeCommand({
            branchId,
            source: 'billing-scheduler',
            routerId,
            username: match.name || target,
            secretId: match['.id'] || match.id || '',
            operation: 'update',
            selector: `name=${match.name || target}`,
            payload: { disabled: 'false' },
            reason: 'eligible-service'
          });
          await secretMenu.where('name', match.name || target).update({ disabled: 'false' });
          enabledCount += 1;
        } catch (e) {
          console.warn(`Failed to enable PPPoE ${target}:`, e?.message || e);
        }
      }

      const overdueSet = new Set(overdueUsers);
      group.indices.forEach((idx) => {
        const cust = customers[idx];
        if (!cust) return;
        const currentStatus = resolveCustomerStatusState(cust);
        let desiredStatus = currentStatus.status;
        if (currentStatus.status === STATUS_DISABLED) {
          // Keep disabled until explicitly set active by admin.
          const desiredMode = STATUS_MODE_AUTO;
          if (currentStatus.statusMode !== desiredMode) {
            customers[idx] = { ...cust, status: currentStatus.status, statusMode: desiredMode };
            customersChanged = true;
          }
          return;
        }
        const uname = String(cust.pppoeUsername || '').trim().toLowerCase();
        if (!uname) return;
        const eligible = isServiceEligible(cust, plans, now);
        const planCategory = resolvePlanCategory(cust, plans);
        const isOverdue = planCategory !== 'prepaid' && overdueSet.has(uname);
        desiredStatus = eligible && !isOverdue ? STATUS_ACTIVE : STATUS_INACTIVE;
        if (blockBulkDisable && desiredStatus !== STATUS_ACTIVE) {
          return;
        }
        const desiredMode = STATUS_MODE_AUTO;
        if (currentStatus.status !== desiredStatus || currentStatus.statusMode !== desiredMode) {
          customers[idx] = { ...cust, status: desiredStatus, statusMode: desiredMode };
          customersChanged = true;
        }
      });

      const refreshedSecrets = await secretMenu.get().catch(() => secretsList);
      const activeSessions = await api.menu('/ppp active').get().catch(() => []);
      const accounts = buildPppoeAccounts(refreshedSecrets, activeSessions);
      nextAccounts = mergeAccountsForRouter({ ...settings, pppoe: { ...(settings?.pppoe || {}), accounts: nextAccounts } }, routerId, accounts);

      await client.close().catch(() => {});

      totalDisabled += disabledCount;
      totalEnabled += enabledCount;
      totalDisconnected += disconnectedCount;
    } catch (err) {
      if (client) await client.close().catch(() => {});
      const { log, suppressed } = shouldLogGraceEnforcementError(routerId, err);
      if (log) {
        const reason = err?.message || err;
        const suppressedSuffix = suppressed > 0
          ? ` (suppressed ${suppressed} similar error${suppressed === 1 ? '' : 's'})`
          : '';
        console.warn(`Grace-period enforcement failed [router:${routerId || 'unknown'}]: ${reason}${suppressedSuffix}`);
      }
    }
  }

  const nextSettings = {
    ...settings,
    pppoe: { ...(settings?.pppoe || {}), accounts: nextAccounts }
  };
  await saveIntegrationSettings(nextSettings, branchId);
  if (customersChanged) {
    await writeCustomers(customers, branchId);
  }
  return { disabled: totalDisabled, enabled: totalEnabled, disconnected: totalDisconnected };
}

async function enforcePppoeGracePeriod(now = new Date()) {
  await assertRelationalReady();

  const branchIds = await listBranchIds();
  let totalDisabled = 0;
  let totalEnabled = 0;
  let totalDisconnected = 0;
  for (const branchId of branchIds) {
    if (!branchId) continue;
    const result = await enforcePppoeGracePeriodForBranch(branchId, now);
    totalDisabled += result.disabled || 0;
    totalEnabled += result.enabled || 0;
    totalDisconnected += result.disconnected || 0;
  }
  return { disabled: totalDisabled, enabled: totalEnabled, disconnected: totalDisconnected };
}

async function runMonthlyBillingForBranch(branchId, now = new Date(), options = {}) {
  await applyDueScheduledPrepaidPlanChangesForBranch(branchId, now);
  const syncCustomerStatus = options?.syncCustomerStatus !== false;
  const customers = await readCustomers(branchId);
  const payments = await readPayments(branchId);
  const plans = await readPlans(branchId);

  const normalize = (s) => String(s || '').trim().toLowerCase();
  const planPriceByName = new Map();
  for (const p of Array.isArray(plans) ? plans : []) {
    const name = normalize(p.name);
    if (!name) continue;
    const price = Number(p.price) || 0;
    if (price > 0) planPriceByName.set(name, price);
  }

  let changed = false;

  // Full run: sync status first. Catch-up run: skip this to keep it lightweight.
  if (syncCustomerStatus) {
    const updates = [];
    let activeCustomersSeen = 0;
    let activeToInactiveCount = 0;
    customers.forEach((cust, idx) => {
      const currentStatus = resolveCustomerStatusState(cust);
      if (currentStatus.status === STATUS_DISABLED) {
        // Respect disabled admin lock; do not auto-reactivate here.
        if (currentStatus.statusMode !== STATUS_MODE_AUTO) {
          updates.push({ idx, next: { ...cust, status: currentStatus.status, statusMode: STATUS_MODE_AUTO }, downgrade: false });
        }
        return;
      }
      if (currentStatus.status === STATUS_ACTIVE) activeCustomersSeen += 1;
      const planCategory = resolvePlanCategory(cust, plans);
      const payHistory = payments?.[cust.accountNumber]?.history || [];
      const eligible = isServiceEligible(cust, plans, now);
      const overdue = planCategory !== 'prepaid' && isOverLimitNoPppoe(cust, payHistory);
      const desiredStatus = eligible && !overdue ? STATUS_ACTIVE : STATUS_INACTIVE;
      const downgrade = currentStatus.status === STATUS_ACTIVE && desiredStatus === STATUS_INACTIVE;
      if (downgrade) activeToInactiveCount += 1;
      if (currentStatus.status !== desiredStatus || currentStatus.statusMode !== STATUS_MODE_AUTO) {
        updates.push({ idx, next: { ...cust, status: desiredStatus, statusMode: STATUS_MODE_AUTO }, downgrade });
      }
    });
    const blockBulkInactive = shouldBlockBulkCustomerInactive({
      downgradeCount: activeToInactiveCount,
      activeCount: activeCustomersSeen,
      branchId
    });
    updates.forEach((update) => {
      if (blockBulkInactive && update.downgrade) return;
      customers[update.idx] = update.next;
    });
    if (updates.some((update) => !(blockBulkInactive && update.downgrade))) {
      await writeCustomers(customers, branchId);
    }
  }

  let customerDatesChanged = false;

  for (let index = 0; index < customers.length; index += 1) {
    let customer = customers[index];
    // Only bill active customers. Overdue accounts are handled by PPPoE enforcement.
    const statusState = resolveCustomerStatusState(customer);
    if (statusState.status !== STATUS_ACTIVE) continue;
    const planCategory = resolvePlanCategory(customer, plans);
    if (planCategory === 'prepaid') continue;
    if (!hasAssignedPlan(customer)) continue;

    const payHistory = payments?.[customer.accountNumber]?.history || [];
    if (isOverCreditLimit(customer, payHistory)) {
      continue;
    }

    const accountNumber = customer.accountNumber;
    let planAmount = Number(customer.planAmount) || 0;
    if (planAmount <= 0 && customer.planName) {
      const lookup = planPriceByName.get(normalize(customer.planName));
      if (Number.isFinite(lookup) && lookup > 0) planAmount = lookup;
    }
    if (!accountNumber || planAmount <= 0) continue;

    let billDate = resolveScheduledBillDate(customer, now);
    if (!billDate) continue;

    const alignedCycleState = buildActivationAlignedBillingCycleState(customer, billDate);
    if (alignedCycleState?.changed && alignedCycleState.state) {
      customer = {
        ...customer,
        billDate: alignedCycleState.state.billDate,
        dueDate: alignedCycleState.state.dueDate
      };
      customers[index] = customer;
      billDate = alignedCycleState.billDate;
      customerDatesChanged = true;
      changed = true;
    }

    // Only add charge if Manila today is on/after the scheduled bill date
    const todayLocal = getManilaStartOfDay(now);
    if (todayLocal < billDate) continue;

    if (!payments[accountNumber]) payments[accountNumber] = { history: [] };
    if (!Array.isArray(payments[accountNumber].history)) payments[accountNumber].history = [];

    const billId = makeBillId(accountNumber, billDate.getFullYear(), billDate.getMonth());
    const alreadyExists = payments[accountNumber].history.some(h => h.id === billId);
    const nextCycleState = buildNextBillingCycleState(customer, billDate);
    if (alreadyExists) {
      if (nextCycleState && (
        String(customer?.billDate || '') !== String(nextCycleState.billDate || '')
        || String(customer?.dueDate || '') !== String(nextCycleState.dueDate || '')
      )) {
        customers[index] = {
          ...customer,
          billDate: nextCycleState.billDate,
          dueDate: nextCycleState.dueDate
        };
        customerDatesChanged = true;
        changed = true;
      }
      continue;
    }

    const isoDate = formatDateOnly(billDate);
    const firstBillingCharge = resolveFirstBillingCharge(customer, billDate, planAmount);
    if ((Number(firstBillingCharge.amount) || 0) <= 0 || firstBillingCharge.skipInitialCharge) {
      if (nextCycleState) {
        customers[index] = {
          ...customer,
          billDate: nextCycleState.billDate,
          dueDate: nextCycleState.dueDate
        };
        customerDatesChanged = true;
        changed = true;
      }
      continue;
    }
    const entry = {
      id: billId,
      amount: firstBillingCharge.amount,
      date: isoDate,
      kind: 'charge',
      reference: undefined,
      description: 'Monthly Recurring Charge',
      type: 'charge',
      direction: 'debit',
      recordedAt: formatManilaDateTime(now) || new Date().toISOString(),
      recordedBy: SYSTEM_RECORDER,
      payer: 'System'
    };
    payments[accountNumber].history.push(entry);
    try {
      await withTransaction(async (connection) => {
        await assignEntryNumbers(connection, entry);
        await assertEntryNumbersAvailable(connection, branchId, entry);
        return insertPaymentEntry(entry, branchId, accountNumber, connection);
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        continue;
      }
      throw error;
    }
    if (nextCycleState) {
      customers[index] = {
        ...customer,
        billDate: nextCycleState.billDate,
        dueDate: nextCycleState.dueDate
      };
      customerDatesChanged = true;
    }
    changed = true;
  }

  if (customerDatesChanged) {
    await writeCustomers(customers, branchId);
  }

  return changed;
}

async function runMonthlyBillingOnceForBranch(branchId, now = new Date()) {
  return runMonthlyBillingForBranch(branchId, now, { syncCustomerStatus: true });
}

async function runMonthlyBillingCatchUpForBranch(branchId, now = new Date()) {
  return runMonthlyBillingForBranch(branchId, now, { syncCustomerStatus: false });
}

async function runMonthlyBillingOnce(now = new Date()) {
  await assertRelationalReady();
  const guard = await ensureBillingClockSafe(now, 'runMonthlyBillingOnce');
  if (!guard.ok) {
    logBillingClockGuardBlocked(guard, 'run');
    return false;
  }

  const branchIds = await listBranchIds();
  let changed = false;
  for (const branchId of branchIds) {
    if (!branchId) continue;
    const branchChanged = await runMonthlyBillingOnceForBranch(branchId, now);
    if (branchChanged) changed = true;
  }
  return changed;
}

async function runMonthlyBillingCatchUp(now = new Date()) {
  await assertRelationalReady();
  const guard = await ensureBillingClockSafe(now, 'runMonthlyBillingCatchUp');
  if (!guard.ok) {
    logBillingClockGuardBlocked(guard, 'catch-up');
    return false;
  }

  const branchIds = await listBranchIds();
  let changed = false;
  for (const branchId of branchIds) {
    if (!branchId) continue;
    const branchChanged = await runMonthlyBillingCatchUpForBranch(branchId, now);
    if (branchChanged) changed = true;
  }
  return changed;
}

function millisecondsUntilNextManilaMidnight(now = new Date()) {
  // Asia/Manila is UTC+08:00 year-round (no DST), so fixed offset is safe.
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const y = manilaNow.getUTCFullYear();
  const m = manilaNow.getUTCMonth();
  const d = manilaNow.getUTCDate();
  const nextMidnightAsUtcMs = Date.UTC(y, m, d + 1, 0, 0, 0, 0) - MANILA_OFFSET_MS;
  return Math.max(0, nextMidnightAsUtcMs - now.getTime());
}

function scheduleBilling() {
  let mainRunInFlight = false;
  let catchUpInFlight = false;

  const runGraceEnforcement = async (label) => {
    try {
      await enforcePppoeGracePeriod();
    } catch (err) {
      console.error(`PPPoE grace enforcement ${label} failed:`, err);
    }
  };

  const runMain = async () => {
    if (mainRunInFlight) return;
    mainRunInFlight = true;
    try {
      await runMonthlyBillingOnce();
    } catch (err) {
      console.error('Billing main run failed:', err);
    }
    try {
      await runGraceEnforcement('during main run');
    } finally {
      mainRunInFlight = false;
    }
  };

  const runCatchUp = async () => {
    // Skip catch-up while full run is executing.
    if (catchUpInFlight || mainRunInFlight) return;
    catchUpInFlight = true;
    try {
      await runMonthlyBillingCatchUp();
    } catch (err) {
      console.error('Billing catch-up run failed:', err);
    }
    try {
      await runGraceEnforcement('during catch-up run');
    } finally {
      catchUpInFlight = false;
    }
  };

  // Startup catch-up for downtime recovery.
  runCatchUp();

  // Hourly lightweight catch-up.
  setInterval(runCatchUp, ONE_HOUR_MS);

  // Main full run: once per day at 00:00 Asia/Manila.
  const initialDelay = millisecondsUntilNextManilaMidnight(new Date());
  setTimeout(() => {
    runMain();
    setInterval(runMain, ONE_DAY_MS);
  }, initialDelay);
}

module.exports = {
  scheduleBilling,
  runMonthlyBillingOnce,
  runMonthlyBillingOnceForBranch,
  runMonthlyBillingCatchUp,
  runMonthlyBillingCatchUpForBranch,
  enforcePppoeGracePeriod,
  enforcePppoeGracePeriodForBranch
};
