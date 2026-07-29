const fs = require('fs');
const path = require('path');
const { getStorageDriver, isMysqlStorageMode } = require('../config/storage-mode');
const { DATA_DIR } = require('../runtime/paths');

let mysql = null;
let pool = null;

const MYSQL_CONFIG_FILE = path.join(DATA_DIR, 'mysql-config.json');
const MYSQL_CONFIG_BACKUP_FILE = path.join(DATA_DIR, 'mysql-config.backup.json');

const readJsonFileSafe = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false, value: null, error: null };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return { exists: true, value: JSON.parse(raw), error: null };
  } catch (error) {
    return { exists: true, value: null, error };
  }
};

const writeJsonAtomic = (filePath, value) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // best effort temp cleanup
    }
  }
};

const deleteFileIfExists = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort cleanup
  }
};

const normalizeInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return parsed;
};

const parseMysqlHostInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return { host: '', port: null };
  }

  const bracketedMatch = raw.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracketedMatch) {
    return {
      host: String(bracketedMatch[1] || '').trim(),
      port: bracketedMatch[2] ? normalizeInt(bracketedMatch[2], null, 1, 65535) : null
    };
  }

  const colonCount = (raw.match(/:/g) || []).length;
  if (colonCount === 1) {
    const hostPortMatch = raw.match(/^([^:]+):(\d{1,5})$/);
    if (hostPortMatch) {
      return {
        host: String(hostPortMatch[1] || '').trim(),
        port: normalizeInt(hostPortMatch[2], null, 1, 65535)
      };
    }
  }

  return { host: raw, port: null };
};

const normalizeMysqlConfig = (input = {}) => {
  const mysqlUrl = String(input.mysqlUrl || input.url || '').trim();
  const parsedHost = parseMysqlHostInput(input.host);

  return {
    mysqlUrl,
    host: mysqlUrl ? String(input.host || '').trim() : parsedHost.host,
    port: mysqlUrl
      ? normalizeInt(input.port, 3306, 1, 65535)
      : (parsedHost.port ?? normalizeInt(input.port, 3306, 1, 65535)),
    user: String(input.user || '').trim(),
    password: input.password == null ? '' : String(input.password),
    database: String(input.database || '').trim(),
    connLimit: normalizeInt(input.connLimit, 10, 1, 100)
  };
};

const cloneMysqlConfig = (config) => (config ? { ...config } : null);

const maskMysqlConfig = (config) => {
  if (!config) return null;
  const clone = { ...config };
  const hasPassword = Boolean(String(clone.password || ''));
  clone.password = '';
  clone.passwordSet = hasPassword;
  return clone;
};

const hasMysqlConfigIntent = (config) => {
  if (!config) return false;
  return Boolean(
    String(config.mysqlUrl || '').trim() ||
    String(config.host || '').trim() ||
    String(config.database || '').trim()
  );
};

const assertValidMysqlConfig = (config) => {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid MySQL configuration payload.');
  }
  if (String(config.mysqlUrl || '').trim()) return;
  if (!String(config.host || '').trim()) {
    throw new Error('MySQL host is required.');
  }
  if (!String(config.user || '').trim()) {
    throw new Error('MySQL user is required.');
  }
  if (!String(config.database || '').trim()) {
    throw new Error('MySQL database is required.');
  }
};

const buildConfigFromEnv = () =>
  normalizeMysqlConfig({
    mysqlUrl: process.env.MYSQL_URL || '',
    host: process.env.MYSQL_HOST || '',
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || '',
    connLimit: process.env.MYSQL_CONN_LIMIT || 10
  });

const normalizeStoredMysqlConfig = (input) => {
  if (!input || typeof input !== 'object') return null;
  const normalized = normalizeMysqlConfig(input);
  if (!hasMysqlConfigIntent(normalized)) return null;
  return normalized;
};

const readStoredMysqlConfig = () => {
  const primary = readJsonFileSafe(MYSQL_CONFIG_FILE);
  const normalizedPrimary = normalizeStoredMysqlConfig(primary.value);
  if (normalizedPrimary) {
    // Keep a companion backup so accidental deletes are recoverable on restart.
    try {
      writeJsonAtomic(MYSQL_CONFIG_BACKUP_FILE, normalizedPrimary);
    } catch {
      // best effort backup refresh
    }
    return normalizedPrimary;
  }

  const backup = readJsonFileSafe(MYSQL_CONFIG_BACKUP_FILE);
  const normalizedBackup = normalizeStoredMysqlConfig(backup.value);
  if (!normalizedBackup) return null;

  // Primary is missing/corrupt; restore it from backup.
  try {
    writeJsonAtomic(MYSQL_CONFIG_FILE, normalizedBackup);
  } catch {
    // best effort restore; still use backup in memory
  }
  return normalizedBackup;
};

const writeStoredMysqlConfig = (config) => {
  writeJsonAtomic(MYSQL_CONFIG_FILE, config);
  writeJsonAtomic(MYSQL_CONFIG_BACKUP_FILE, config);
};

const deleteStoredMysqlConfig = () => {
  deleteFileIfExists(MYSQL_CONFIG_FILE);
  deleteFileIfExists(MYSQL_CONFIG_BACKUP_FILE);
};

const isIsolatedFlavorRuntime = () => String(process.env.FLAVOR_RUNTIME_ISOLATED || '').trim() === '1';

let runtimeMysqlConfig = isIsolatedFlavorRuntime() ? null : readStoredMysqlConfig();

const getMysqlConfigSource = () => {
  if (!isMysqlStorageMode()) return getStorageDriver();
  if (isIsolatedFlavorRuntime() && hasMysqlConfigIntent(buildConfigFromEnv())) return 'env';
  if (hasMysqlConfigIntent(runtimeMysqlConfig)) return 'runtime';
  if (hasMysqlConfigIntent(buildConfigFromEnv())) return 'env';
  return 'none';
};

const getEffectiveMysqlConfig = () => {
  if (!isMysqlStorageMode()) return null;
  if (isIsolatedFlavorRuntime()) {
    const fromEnv = buildConfigFromEnv();
    if (!hasMysqlConfigIntent(fromEnv)) return null;
    return fromEnv;
  }
  if (hasMysqlConfigIntent(runtimeMysqlConfig)) {
    return cloneMysqlConfig(runtimeMysqlConfig);
  }
  const fromEnv = buildConfigFromEnv();
  if (!hasMysqlConfigIntent(fromEnv)) return null;
  return fromEnv;
};

const toPoolConfig = (config) => {
  if (!config) return null;
  if (String(config.mysqlUrl || '').trim()) {
    return String(config.mysqlUrl).trim();
  }
  return {
    host: config.host || '127.0.0.1',
    port: normalizeInt(config.port, 3306, 1, 65535),
    user: config.user || 'root',
    password: config.password || '',
    database: config.database || '',
    waitForConnections: true,
    connectionLimit: normalizeInt(config.connLimit, 10, 1, 100),
    queueLimit: 0,
    dateStrings: true
  };
};

const isMysqlEnabled = () => isMysqlStorageMode() && Boolean(getEffectiveMysqlConfig());

async function resetPool() {
  if (!pool) return;
  const stalePool = pool;
  pool = null;
  try {
    await stalePool.end();
  } catch {
    // ignore pool shutdown errors
  }
}

async function testMysqlConnection(inputConfig) {
  const candidate = inputConfig ? normalizeMysqlConfig(inputConfig) : getEffectiveMysqlConfig();
  if (!candidate || !hasMysqlConfigIntent(candidate)) {
    throw new Error('MySQL is not configured.');
  }
  assertValidMysqlConfig(candidate);
  mysql = mysql || require('mysql2/promise');
  const tempPool = mysql.createPool(toPoolConfig(candidate));
  try {
    await tempPool.query('SELECT 1 AS ok');
  } finally {
    await tempPool.end().catch(() => {});
  }
  return true;
}

async function setMysqlRuntimeConfig(inputConfig, options = {}) {
  const nextConfig = normalizeMysqlConfig(inputConfig);
  assertValidMysqlConfig(nextConfig);

  if (options.verify !== false) {
    await testMysqlConnection(nextConfig);
  }

  runtimeMysqlConfig = nextConfig;
  if (options.persist !== false) {
    writeStoredMysqlConfig(nextConfig);
  }

  await resetPool();
  return cloneMysqlConfig(runtimeMysqlConfig);
}

async function clearMysqlRuntimeConfig(options = {}) {
  runtimeMysqlConfig = null;
  if (options.persist !== false) {
    deleteStoredMysqlConfig();
  }
  await resetPool();
}

function getMysqlRuntimeConfig() {
  return cloneMysqlConfig(runtimeMysqlConfig);
}

async function getPool() {
  if (!isMysqlEnabled()) return null;
  if (pool) return pool;
  const effectiveConfig = getEffectiveMysqlConfig();
  mysql = mysql || require('mysql2/promise');
  pool = mysql.createPool(toPoolConfig(effectiveConfig));
  return pool;
}

async function query(sql, params) {
  const activePool = await getPool();
  if (!activePool) {
    throw new Error(
      isMysqlStorageMode()
        ? 'MySQL is not configured. Set MYSQL_HOST/MYSQL_URL or use Update and Download settings.'
        : 'MySQL query requested while JSON file storage mode is enabled.'
    );
  }
  return activePool.query(sql, params);
}

module.exports = {
  getPool,
  query,
  isMysqlEnabled,
  resetPool,
  testMysqlConnection,
  setMysqlRuntimeConfig,
  clearMysqlRuntimeConfig,
  getMysqlRuntimeConfig,
  getEffectiveMysqlConfig,
  getMysqlConfigSource,
  normalizeMysqlConfig,
  maskMysqlConfig
};
