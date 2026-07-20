const crypto = require('crypto');

const PREFIX = 'scrypt$';
const SALT_BYTES = 16;
const KEY_LEN = 64;

// Keep parameters moderate so login remains fast even on low-powered hosts.
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

function isHashedPassword(stored = '') {
  return String(stored || '').startsWith(PREFIX);
}

function hashPassword(password) {
  const plain = String(password || '');
  if (!plain) throw new Error('Password is required');
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(plain, salt, KEY_LEN, SCRYPT_OPTIONS);
  return `${PREFIX}${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const plain = String(password || '');
  const value = String(stored || '');
  if (!plain || !value) return false;

  // Legacy plaintext support (auto-migrate elsewhere on successful login).
  if (!isHashedPassword(value)) {
    const a = Buffer.from(value);
    const b = Buffer.from(plain);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  const parts = value.split('$');
  if (parts.length !== 3) return false;
  const saltB64 = parts[1];
  const hashB64 = parts[2];
  let salt;
  let expected;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = crypto.scryptSync(plain, salt, expected.length, SCRYPT_OPTIONS);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isHashedPassword
};
