function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs) || 60_000;
  const max = Number(options.max) || 60;
  const message = String(options.message || 'Too many requests');
  const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : (req) => req.ip;

  const hits = new Map(); // key -> { count, resetAt }
  const MAX_KEYS = Number(options.maxKeys) || 10_000;
  let lastPruneAt = 0;

  const prune = (now) => {
    for (const [key, entry] of hits.entries()) {
      if (!entry || entry.resetAt <= now) hits.delete(key);
    }
    // Simple safety valve to avoid unbounded memory growth.
    if (hits.size > MAX_KEYS) {
      let removed = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        removed += 1;
        if (hits.size <= MAX_KEYS) break;
        if (removed > MAX_KEYS) break;
      }
    }
  };

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    if (now - lastPruneAt > windowMs) {
      prune(now);
      lastPruneAt = now;
    }

    const key = String(keyGenerator(req) || '').trim();
    if (!key) return next();

    const existing = hits.get(key);
    const entry = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    hits.set(key, entry);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(max - entry.count, 0)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return res.status(429).json({ ok: false, error: message });
    }
    return next();
  };
}

module.exports = {
  createRateLimiter
};

