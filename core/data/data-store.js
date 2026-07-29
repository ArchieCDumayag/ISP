const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { getPool, isMysqlEnabled } = require('./db');
const { isJsonStorageMode } = require('../config/storage-mode');
const { DATA_DIR } = require('../runtime/paths');

const STORE_TABLE = process.env.MYSQL_STORE_TABLE || 'app_store';
let tableReady = null;
const writeQueues = new Map();

const normalizeKey = (key) => String(key || '').trim().replace(/[\\/]/g, '_');
const keyToFilePath = (key) => path.join(DATA_DIR, `${normalizeKey(key)}.json`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureTable() {
  if (!isMysqlEnabled()) return;
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const pool = await getPool();
    if (!pool) return;
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${STORE_TABLE}\` (
        store_key VARCHAR(128) NOT NULL PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
    `;
    await pool.query(sql);
  })();
  return tableReady;
}

async function readJsonFile(key, fallback) {
  const filePath = keyToFilePath(key);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!String(raw || '').trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      console.warn(`[warn] Invalid JSON in ${path.relative(DATA_DIR, filePath)}; using fallback.`);
      return fallback;
    }
    throw error;
  }
}

async function replaceFile(tempPath, filePath) {
  const retryableCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error?.code)) throw error;
      await delay(40 * (attempt + 1));
    }
  }

  try {
    await fs.copyFile(tempPath, filePath);
    await fs.unlink(tempPath).catch(() => {});
    return;
  } catch {
    throw lastError;
  }
}

function enqueueWrite(key, operation) {
  const safeKey = normalizeKey(key);
  const previous = writeQueues.get(safeKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeQueues.set(safeKey, current);
  current.finally(() => {
    if (writeQueues.get(safeKey) === current) {
      writeQueues.delete(safeKey);
    }
  }).catch(() => {});
  return current;
}

async function writeJsonFile(key, data) {
  return enqueueWrite(key, async () => {
    const filePath = keyToFilePath(key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = path.join(
      dir,
      `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${crypto.randomUUID()}`
    );
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await replaceFile(tempPath, filePath);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  });
}

async function readJson(key, fallback) {
  if (isJsonStorageMode() || !isMysqlEnabled()) {
    return readJsonFile(key, fallback);
  }
  await ensureTable();
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL connection is not available.');
  }
  const safeKey = normalizeKey(key);
  const [rows] = await pool.query(
    `SELECT payload FROM \`${STORE_TABLE}\` WHERE store_key = ? LIMIT 1`,
    [safeKey]
  );
  if (!rows || !rows.length || rows[0].payload == null) {
    return fallback;
  }
  try {
    return JSON.parse(rows[0].payload);
  } catch {
    return fallback;
  }
}

async function writeJson(key, data, options = {}) {
  if (isJsonStorageMode() || !isMysqlEnabled()) {
    await writeJsonFile(key, data);
    return;
  }
  await ensureTable();
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL connection is not available.');
  }
  const safeKey = normalizeKey(key);
  const payload = JSON.stringify(data ?? null);
  await pool.query(
    `INSERT INTO \`${STORE_TABLE}\` (store_key, payload)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
    [safeKey, payload]
  );
  if (options.mirrorToFile) {
    await writeJsonFile(key, data);
  }
}

module.exports = {
  readJson,
  writeJson,
  readJsonFile,
  writeJsonFile
};
