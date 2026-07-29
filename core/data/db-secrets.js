const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../runtime/paths');

const MASTER_ENV = 'CONFIG_MASTER_KEY';
const KEY_BYTES = 32;
const MASTER_KEY_FILE = path.join(DATA_DIR, 'master-key.json');
const MASTER_KEY_BACKUP_FILE = path.join(DATA_DIR, 'master-key.backup.json');

let cachedKey = null;

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

function deriveKey(raw) {
  const buf = Buffer.from(String(raw || ''), 'utf8');
  if (buf.length === KEY_BYTES) return buf;
  // Derive a fixed 32-byte key from arbitrary length input
  return crypto.createHash('sha256').update(buf).digest();
}

function extractPersistedMasterKey(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(payload.value || payload.masterKey || '').trim();
}

function readPersistedMasterKey() {
  const primary = readJsonFileSafe(MASTER_KEY_FILE);
  const primaryValue = extractPersistedMasterKey(primary.value);
  if (primaryValue) {
    try {
      writeJsonAtomic(MASTER_KEY_BACKUP_FILE, { value: primaryValue });
    } catch {
      // best effort backup refresh
    }
    return primaryValue;
  }

  const backup = readJsonFileSafe(MASTER_KEY_BACKUP_FILE);
  const backupValue = extractPersistedMasterKey(backup.value);
  if (!backupValue) return '';

  // Primary is missing/corrupt; restore it from backup.
  try {
    writeJsonAtomic(MASTER_KEY_FILE, { value: backupValue });
  } catch {
    // best effort restore; still use backup in memory
  }
  return backupValue;
}

function persistMasterKey(value) {
  const payload = { value };
  writeJsonAtomic(MASTER_KEY_FILE, payload);
  writeJsonAtomic(MASTER_KEY_BACKUP_FILE, payload);
}

function removePersistedMasterKey() {
  deleteFileIfExists(MASTER_KEY_FILE);
  deleteFileIfExists(MASTER_KEY_BACKUP_FILE);
}

function getMasterKey() {
  if (cachedKey) return cachedKey;
  let raw = String(process.env[MASTER_ENV] || '').trim();
  if (!raw) {
    const persisted = readPersistedMasterKey();
    if (persisted) {
      raw = persisted;
      process.env[MASTER_ENV] = persisted;
    }
  }
  if (!raw) {
    throw new Error(`${MASTER_ENV} is required to encrypt/decrypt sensitive config.`);
  }
  cachedKey = deriveKey(raw);
  return cachedKey;
}

function setMasterKey(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error(`${MASTER_ENV} is required to encrypt/decrypt sensitive config.`);
  }
  process.env[MASTER_ENV] = raw;
  cachedKey = deriveKey(raw);
  if (options.persist !== false) {
    persistMasterKey(raw);
  }
  return true;
}

function clearMasterKey(options = {}) {
  cachedKey = null;
  delete process.env[MASTER_ENV];
  if (options.persist !== false) {
    removePersistedMasterKey();
  }
}

function getMasterKeySource() {
  const envRaw = String(process.env[MASTER_ENV] || '').trim();
  if (envRaw) return 'env';
  const persisted = readPersistedMasterKey();
  if (persisted) return 'file';
  return 'none';
}

function encryptJson(payload) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(payload ?? null);
  let data = cipher.update(plaintext, 'utf8', 'base64');
  data += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data
  };
}

function decryptJson(encrypted) {
  if (!encrypted) return null;
  const payload = typeof encrypted === 'string' ? JSON.parse(encrypted) : encrypted;
  if (!payload || !payload.data || !payload.iv || !payload.tag) return null;
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let text = decipher.update(String(payload.data), 'base64', 'utf8');
  text += decipher.final('utf8');
  return JSON.parse(text);
}

module.exports = {
  encryptJson,
  decryptJson,
  getMasterKey,
  setMasterKey,
  clearMasterKey,
  getMasterKeySource
};
