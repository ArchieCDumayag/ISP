const { query, isMysqlEnabled } = require('./db');
const { isJsonStorageMode } = require('./storage-mode');

let cachedReady = null;
let cachedCheckedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

async function isRelationalReady() {
  if (isJsonStorageMode()) return false;
  if (!isMysqlEnabled()) return false;
  const now = Date.now();
  if (cachedReady !== null && (now - cachedCheckedAt) < CACHE_TTL_MS) {
    return cachedReady;
  }
  try {
    const [rows] = await query(
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'branches'
       LIMIT 1`
    );
    cachedReady = Boolean(rows && rows.length);
  } catch {
    cachedReady = false;
  }
  cachedCheckedAt = now;
  return cachedReady;
}

async function assertRelationalReady() {
  const ready = await isRelationalReady();
  if (!ready) {
    throw new Error('Relational schema not initialized. Run schema + migration first.');
  }
}

function clearRelationalCache() {
  cachedReady = null;
  cachedCheckedAt = 0;
}

module.exports = {
  isRelationalReady,
  assertRelationalReady,
  clearRelationalCache
};
