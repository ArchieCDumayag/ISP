const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const rawSecret = String(process.env.SESSION_TOKEN_SECRET || '').trim();
const isEphemeralSessionSecret = !rawSecret || rawSecret === 'change-this-secret';
let SESSION_TOKEN_SECRET = rawSecret;
if (!SESSION_TOKEN_SECRET || SESSION_TOKEN_SECRET === 'change-this-secret') {
  if (NODE_ENV === 'production') {
    throw new Error('SESSION_TOKEN_SECRET must be set in production.');
  }
  SESSION_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] SESSION_TOKEN_SECRET is not set; using a random secret for this process.');
}
const parsePositiveSeconds = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};
const SESSION_TTL_SECONDS = parsePositiveSeconds(process.env.SESSION_TOKEN_TTL_SECONDS, 24 * 60 * 60); // 1 day default

const activeSessions = new Map(); // token -> { cookie, meta, expiresAt }

function issueToken(payload = {}, options = {}) {
  const expiresIn = parsePositiveSeconds(options.expiresIn, SESSION_TTL_SECONDS);
  return jwt.sign(payload, SESSION_TOKEN_SECRET, { expiresIn });
}

function storeSession(token, cookie, meta = {}, options = {}) {
  if (!token || !cookie) return;
  const ttlSeconds = parsePositiveSeconds(options.ttlSeconds, SESSION_TTL_SECONDS);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  activeSessions.set(token, { cookie, meta, expiresAt });
}

function getSession(token) {
  if (!token) return null;
  const entry = activeSessions.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    activeSessions.delete(token);
    return null;
  }
  return entry;
}

function verifyToken(token) {
  const result = verifyTokenDetailed(token);
  return result.ok ? result.payload : null;
}

function verifyTokenDetailed(token) {
  if (!token) {
    return {
      ok: false,
      reason: 'missing',
      payload: null,
      error: null
    };
  }
  try {
    return {
      ok: true,
      reason: 'valid',
      payload: jwt.verify(token, SESSION_TOKEN_SECRET),
      error: null
    };
  } catch (error) {
    const reason = error?.name === 'TokenExpiredError' ? 'expired' : 'invalid';
    return {
      ok: false,
      reason,
      payload: reason === 'expired' ? jwt.decode(token) : null,
      error
    };
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, entry] of activeSessions.entries()) {
    if (entry.expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
}

module.exports = {
  issueToken,
  storeSession,
  getSession,
  verifyToken,
  verifyTokenDetailed,
  cleanupExpiredSessions,
  isEphemeralSessionSecret,
  SESSION_TTL_SECONDS,
};
