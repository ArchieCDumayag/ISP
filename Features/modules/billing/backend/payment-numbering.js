const crypto = require('crypto');
const createError = require('http-errors');
const { getPool } = require('../../../../core/data/db');

const APP_STORE_DDL = `
CREATE TABLE IF NOT EXISTS app_store (
  store_key VARCHAR(128) NOT NULL PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
`;

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const normalizeText = (value) => String(value == null ? '' : value).trim();
const normalizeKind = (value) => normalizeText(value).toLowerCase();
const pad = (value, width) => String(value).padStart(width, '0');

let appStoreEnsured = false;

const resolveYear = (dateValue) => {
  const parsed = dateValue ? new Date(dateValue) : new Date();
  if (!Number.isFinite(parsed.getTime())) return new Date().getFullYear();
  return parsed.getFullYear();
};

const parseCounterPayload = (payloadText) => {
  const raw = normalizeText(payloadText);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    if (isObject(parsed)) {
      const candidate = Number(parsed.last || parsed.value || 0);
      if (Number.isFinite(candidate) && candidate >= 0) return Math.floor(candidate);
    }
  } catch {
    const candidate = Number(raw);
    if (Number.isFinite(candidate) && candidate >= 0) return Math.floor(candidate);
  }
  return 0;
};

const ensureAppStore = async (connection) => {
  if (appStoreEnsured) return;
  await connection.query(APP_STORE_DDL);
  appStoreEnsured = true;
};

const lockStoreKey = async (connection, key) => {
  await ensureAppStore(connection);
  await connection.query(
    'INSERT INTO app_store (store_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE store_key = store_key',
    [key, JSON.stringify({ lockedAt: Date.now() })]
  );
  await connection.query(
    'SELECT payload FROM app_store WHERE store_key = ? FOR UPDATE',
    [key]
  );
};

const makeCollisionLockKey = (prefix, branchId, value) => {
  const digest = crypto.createHash('sha1').update(String(value || '').toLowerCase()).digest('hex');
  return `${prefix}:${String(branchId || '').trim()}:${digest}`;
};

const nextSequenceValue = async (connection, key) => {
  await ensureAppStore(connection);

  await connection.query(
    'INSERT INTO app_store (store_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE store_key = store_key',
    [key, JSON.stringify({ last: 0 })]
  );

  const [rows] = await connection.query(
    'SELECT payload FROM app_store WHERE store_key = ? FOR UPDATE',
    [key]
  );
  const current = rows && rows.length ? parseCounterPayload(rows[0].payload) : 0;
  const next = current + 1;
  await connection.query(
    'UPDATE app_store SET payload = ? WHERE store_key = ?',
    [JSON.stringify({ last: next }), key]
  );
  return next;
};

const buildReference = async (connection, kind, dateValue) => {
  const normalizedKind = normalizeKind(kind);
  const year = resolveYear(dateValue);
  if (normalizedKind === 'charge' || normalizedKind === 'debit') {
    const seq = await nextSequenceValue(connection, `seq:inv:${year}`);
    return `INV-${year}-${pad(seq, 7)}`;
  }
  const seq = await nextSequenceValue(connection, `seq:sys:${year}`);
  return `SYS-${year}-${pad(seq, 7)}`;
};

const buildOrNumber = async (connection) => {
  const seq = await nextSequenceValue(connection, 'seq:or:global');
  return `OR-${pad(seq, 6)}`;
};

const assignEntryNumbers = async (connection, entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const kind = normalizeKind(entry.kind || 'payment');
  const providedReference = normalizeText(entry.reference);
  const dateHint = entry.date || entry.recordedAt || null;

  if (kind === 'charge' || kind === 'debit') {
    entry.reference = await buildReference(connection, 'charge', dateHint);
  } else if (providedReference) {
    entry.reference = providedReference;
  } else {
    entry.reference = await buildReference(connection, 'payment', dateHint);
  }

  if (kind === 'payment') {
    const providedOr = normalizeText(entry.orNumber);
    entry.orNumber = providedOr || await buildOrNumber(connection);
  } else {
    entry.orNumber = null;
  }

  return entry;
};

const assertEntryNumbersAvailable = async (connection, branchId, entry) => {
  if (!entry || typeof entry !== 'object' || !branchId) return;
  const reference = normalizeText(entry.reference);
  const orNumber = normalizeText(entry.orNumber);

  if (reference) {
    await lockStoreKey(connection, makeCollisionLockKey('lock:ref', branchId, reference));
    const [refRows] = await connection.query(
      'SELECT id FROM payment_entries WHERE branch_id = ? AND reference = ? LIMIT 1',
      [branchId, reference]
    );
    if (refRows && refRows.length) {
      throw createError(409, `Reference already exists: ${reference}`);
    }
  }

  if (orNumber) {
    await lockStoreKey(connection, makeCollisionLockKey('lock:or', branchId, orNumber));
    const [orRows] = await connection.query(
      'SELECT id FROM payment_entries WHERE branch_id = ? AND or_number = ? LIMIT 1',
      [branchId, orNumber]
    );
    if (orRows && orRows.length) {
      throw createError(409, `OR number already exists: ${orNumber}`);
    }
  }
};

const withTransaction = async (work) => {
  const pool = await getPool();
  if (!pool) {
    throw createError(500, 'MySQL connection is not available.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // best effort rollback
    }
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  assignEntryNumbers,
  assertEntryNumbersAvailable,
  withTransaction
};
