const { getPool, query } = require('../../../../core/data/db');

const JOB_NUMBER_PREFIX = 'JOB';
const APP_STORE_DDL = `
CREATE TABLE IF NOT EXISTS app_store (
  store_key VARCHAR(128) NOT NULL PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
`;
const JOB_NUMBER_COLUMN_CACHE_TTL_MS = 30 * 1000;

let cachedHasJobNumberColumn = null;
let cachedHasJobNumberCheckedAt = 0;
let appStoreEnsured = false;

const normalizeText = (value) => String(value == null ? '' : value).trim();
const normalizeBranchKey = (branchId) => {
  const numeric = Number(branchId);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  return normalizeText(branchId) || 'global';
};
const getFallbackMapStoreKey = (branchId) => `map:jobnum:branch:${normalizeBranchKey(branchId)}`;

const normalizeJobOrigin = (value) => {
  if (value && typeof value === 'object') {
    const explicitOrigin = normalizeText(value.origin).toLowerCase();
    if (explicitOrigin) return explicitOrigin;
    if (value.ticketId || value.ticket_id || value.ticketNumber || value.ticket_number) {
      return 'ticket';
    }
    return 'job';
  }
  const normalized = normalizeText(value).toLowerCase();
  return normalized || 'job';
};

const isTicketOriginJob = (value) => normalizeJobOrigin(value) === 'ticket';

const parseJobNumberValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    const prefixedMatch = raw.match(/^JOB-(\d+)$/i);
    if (prefixedMatch) {
      const prefixedValue = Number(prefixedMatch[1]);
      return Number.isFinite(prefixedValue) && prefixedValue > 0
        ? Math.trunc(prefixedValue)
        : null;
    }
    const numericFromString = Number(raw);
    return Number.isFinite(numericFromString) && numericFromString > 0
      ? Math.trunc(numericFromString)
      : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
};

const formatJobNumber = (value) => {
  const numericId = parseJobNumberValue(value);
  if (!numericId) return '';
  return `${JOB_NUMBER_PREFIX}-${String(numericId).padStart(8, '0')}`;
};

const toJobNumberLabel = (row = {}) => {
  const storedValue = parseJobNumberValue(row.jobNumber ?? row.job_number);
  if (storedValue) return formatJobNumber(storedValue);
  if (isTicketOriginJob(row)) return '';
  const fallbackId = parseJobNumberValue(row.id);
  return fallbackId ? formatJobNumber(fallbackId) : '';
};

const parseCounterPayload = (payloadText) => {
  const raw = normalizeText(payloadText);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
    if (parsed && typeof parsed === 'object') {
      const candidate = Number(parsed.last || parsed.value || 0);
      if (Number.isFinite(candidate) && candidate >= 0) return Math.trunc(candidate);
    }
  } catch {
    const candidate = Number(raw);
    if (Number.isFinite(candidate) && candidate >= 0) return Math.trunc(candidate);
  }
  return 0;
};

const parseJobNumberStatePayload = (payloadText) => {
  const fallback = { last: 0, values: {} };
  const raw = normalizeText(payloadText);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }
    const values = {};
    const rawValues = parsed.values && typeof parsed.values === 'object' && !Array.isArray(parsed.values)
      ? parsed.values
      : {};
    for (const [key, value] of Object.entries(rawValues)) {
      const numericValue = parseJobNumberValue(value);
      if (numericValue) values[String(key)] = numericValue;
    }
    const last = Math.max(
      parseJobNumberValue(parsed.last),
      ...Object.values(values).map((value) => parseJobNumberValue(value) || 0),
      0
    );
    return { last, values };
  } catch {
    return fallback;
  }
};

async function ensureAppStore(connection) {
  if (appStoreEnsured) return;
  await connection.query(APP_STORE_DDL);
  appStoreEnsured = true;
}

async function readJobNumberStateWithClient(client, branchId, options = {}) {
  await ensureAppStore(client);
  const key = getFallbackMapStoreKey(branchId);
  const defaultPayload = JSON.stringify({ last: 0, values: {} });
  await client.query(
    'INSERT INTO app_store (store_key, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE store_key = store_key',
    [key, defaultPayload]
  );
  const sql = options.forUpdate
    ? 'SELECT payload FROM app_store WHERE store_key = ? FOR UPDATE'
    : 'SELECT payload FROM app_store WHERE store_key = ? LIMIT 1';
  const [rows] = await client.query(sql, [key]);
  const payloadText = rows && rows.length ? rows[0].payload : defaultPayload;
  return {
    key,
    state: parseJobNumberStatePayload(payloadText)
  };
}

async function writeJobNumberState(connection, key, state) {
  await connection.query(
    'UPDATE app_store SET payload = ? WHERE store_key = ?',
    [JSON.stringify(state), key]
  );
}

async function readJobNumberState(branchId) {
  const pool = await getPool();
  if (!pool) return { last: 0, values: {} };
  const { state } = await readJobNumberStateWithClient(pool, branchId);
  return state;
}

async function hasJobNumberColumn() {
  const now = Date.now();
  if (
    cachedHasJobNumberColumn !== null &&
    (now - cachedHasJobNumberCheckedAt) < JOB_NUMBER_COLUMN_CACHE_TTL_MS
  ) {
    return cachedHasJobNumberColumn;
  }
  try {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'jobs'
         AND column_name = 'job_number'
       LIMIT 1`
    );
    cachedHasJobNumberColumn = Boolean(rows && rows.length);
  } catch {
    cachedHasJobNumberColumn = false;
  }
  cachedHasJobNumberCheckedAt = now;
  return cachedHasJobNumberColumn;
}

function clearJobNumberingCache() {
  cachedHasJobNumberColumn = null;
  cachedHasJobNumberCheckedAt = 0;
  appStoreEnsured = false;
}

async function getJobSelectFields() {
  const fields = ['id'];
  if (await hasJobNumberColumn()) {
    fields.push('job_number AS jobNumber');
  }
  fields.push(
    'type',
    'technician',
    'priority',
    'schedule',
    'appointment_end AS appointmentEnd',
    'sla_due_at AS slaDueAt',
    'status',
    'workflow_status AS workflowStatus',
    'done_at AS doneAt',
    'notes',
    'description',
    'customer_account_number AS customerAccountNumber',
    'customer_name AS customerName',
    'customer_phone AS customerPhone',
    'service_address AS serviceAddress',
    'latitude',
    'longitude',
    'plan_name AS planName',
    'dispatch_payload_json AS dispatchPayloadJson',
    'record_version AS version',
    'created_at AS createdAt',
    'updated_at AS updatedAt',
    'ticket_id AS ticketId',
    'ticket_number AS ticketNumber',
    'ticket_subject AS ticketSubject',
    'origin'
  );
  return fields.join(', ');
}

async function withTransaction(work) {
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL connection is not available.');
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
}

async function nextSequenceValue(connection, key, seedValue = 0) {
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
  const seededCurrent = Math.max(current, Number(seedValue) || 0);
  const next = seededCurrent + 1;
  await connection.query(
    'UPDATE app_store SET payload = ? WHERE store_key = ?',
    [JSON.stringify({ last: next }), key]
  );
  return next;
}

async function backfillFallbackJobNumbersWithConnection(connection, branchId) {
  const { key, state } = await readJobNumberStateWithClient(connection, branchId, { forUpdate: true });
  const [rows] = await connection.query(
    `SELECT id, origin, ticket_id AS ticketId, ticket_number AS ticketNumber
     FROM jobs
     WHERE branch_id = ?
     ORDER BY id ASC`,
    [branchId]
  );

  let nextValue = Math.max(
    parseJobNumberValue(state.last) || 0,
    ...Object.values(state.values || {}).map((value) => parseJobNumberValue(value) || 0),
    0
  );
  let dirty = false;

  for (const row of rows || []) {
    if (isTicketOriginJob(row)) continue;
    const existing = parseJobNumberValue(state.values[String(row.id)]);
    if (existing) {
      nextValue = Math.max(nextValue, existing);
      continue;
    }
    nextValue += 1;
    state.values[String(row.id)] = nextValue;
    dirty = true;
  }

  if (nextValue !== state.last) {
    state.last = nextValue;
    dirty = true;
  }

  if (dirty) {
    await writeJobNumberState(connection, key, state);
  }

  return state.values;
}

async function assignFallbackManualJobNumber(connection, branchId, jobId) {
  const values = await backfillFallbackJobNumbersWithConnection(connection, branchId);
  return parseJobNumberValue(values[String(jobId)]);
}

async function getFallbackJobNumberValues(branchId, rows = []) {
  if (!branchId) return {};
  const state = await readJobNumberState(branchId);
  const hasAllMappings = (rows || []).every((row) => {
    if (!row || isTicketOriginJob(row)) return true;
    return Boolean(parseJobNumberValue(state.values[String(row.id)]));
  });
  if (hasAllMappings) return state.values;
  return withTransaction((connection) => backfillFallbackJobNumbersWithConnection(connection, branchId));
}

async function hydrateJobRows(branchId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  if (await hasJobNumberColumn()) return list;
  const values = await getFallbackJobNumberValues(branchId, list);
  for (const row of list) {
    if (!row) continue;
    if (isTicketOriginJob(row)) {
      row.jobNumber = '';
      continue;
    }
    const numericValue = parseJobNumberValue(values[String(row.id)]);
    if (numericValue) {
      row.jobNumber = numericValue;
    }
  }
  return list;
}

async function nextManualJobNumberValue(connection, branchId) {
  const normalizedBranchId = Number(branchId);
  const branchKey = Number.isFinite(normalizedBranchId) && normalizedBranchId > 0
    ? String(Math.trunc(normalizedBranchId))
    : 'global';
  const [rows] = await connection.query(
    `SELECT MAX(job_number) AS maxJobNumber
     FROM jobs
     WHERE branch_id = ?
       AND LOWER(COALESCE(origin, 'job')) <> 'ticket'`,
    [branchId]
  );
  const maxExisting = Number(rows && rows.length ? rows[0].maxJobNumber : 0) || 0;
  return nextSequenceValue(connection, `seq:job:branch:${branchKey}`, maxExisting);
}

async function ensureJobsJobNumberColumn() {
  const [rows] = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'jobs'
       AND column_name = 'job_number'
     LIMIT 1`
  );
  if (rows && rows.length) {
    clearJobNumberingCache();
    return false;
  }
  await query('ALTER TABLE jobs ADD COLUMN job_number BIGINT NULL AFTER id');
  clearJobNumberingCache();
  return true;
}

async function backfillManualJobNumbers() {
  if (!await hasJobNumberColumn()) return 0;
  const [rows] = await query(
    `SELECT id, branch_id AS branchId, origin, ticket_id AS ticketId, ticket_number AS ticketNumber, job_number AS jobNumber
     FROM jobs
     ORDER BY branch_id ASC, id ASC`
  );
  const counters = new Map();
  const fallbackStateByBranch = new Map();
  let updates = 0;

  for (const row of rows || []) {
    const branchKey = normalizeBranchKey(row.branchId);
    if (!fallbackStateByBranch.has(branchKey)) {
      fallbackStateByBranch.set(branchKey, await readJobNumberState(row.branchId));
    }
    const fallbackState = fallbackStateByBranch.get(branchKey) || { last: 0, values: {} };
    const fallbackMappedValue = parseJobNumberValue(fallbackState.values[String(row.id)]);
    const currentCounter = Math.max(
      counters.get(branchKey) || 0,
      parseJobNumberValue(fallbackState.last) || 0
    );
    const storedJobNumber = parseJobNumberValue(row.jobNumber);

    if (isTicketOriginJob(row)) {
      if (storedJobNumber) {
        await query('UPDATE jobs SET job_number = NULL WHERE id = ? AND branch_id = ?', [row.id, row.branchId]);
        updates += 1;
      }
      continue;
    }

    if (storedJobNumber) {
      counters.set(branchKey, Math.max(currentCounter, storedJobNumber));
      continue;
    }

    if (fallbackMappedValue) {
      await query('UPDATE jobs SET job_number = ? WHERE id = ? AND branch_id = ?', [fallbackMappedValue, row.id, row.branchId]);
      counters.set(branchKey, Math.max(currentCounter, fallbackMappedValue));
      updates += 1;
      continue;
    }

    const nextValue = currentCounter + 1;
    await query('UPDATE jobs SET job_number = ? WHERE id = ? AND branch_id = ?', [nextValue, row.id, row.branchId]);
    counters.set(branchKey, nextValue);
    updates += 1;
  }

  return updates;
}

module.exports = {
  assignFallbackManualJobNumber,
  backfillManualJobNumbers,
  clearJobNumberingCache,
  formatJobNumber,
  hydrateJobRows,
  getJobSelectFields,
  hasJobNumberColumn,
  isTicketOriginJob,
  nextManualJobNumberValue,
  toJobNumberLabel,
  withTransaction,
  ensureJobsJobNumberColumn
};
