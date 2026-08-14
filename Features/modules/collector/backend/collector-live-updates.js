const ALLOWED_TOPICS = new Set([
  'approvals',
  'remittances',
  'priorities',
  'reschedules',
  'assignments'
]);
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEARTBEAT_INTERVAL_MS = 25000;
const subscribersByBranch = new Map();
const versionByBranch = new Map();

function resolveBranchKey(source = {}) {
  const actor = source.collector || source.user || source;
  const branchId = actor?.branchId ?? actor?.branch_id;
  const normalized = String(branchId ?? '').trim();
  return normalized || 'json-default';
}

function normalizeTopics(topics = []) {
  const values = Array.isArray(topics) ? topics : [topics];
  return [...new Set(values
    .map((topic) => String(topic || '').trim().toLowerCase())
    .filter((topic) => ALLOWED_TOPICS.has(topic)))];
}

function writeSseEvent(res, { event, id, data }) {
  if (id !== undefined && id !== null) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function subscribeCollectorLiveUpdates(req, res) {
  const branchKey = resolveBranchKey(req);
  const subscribers = subscribersByBranch.get(branchKey) || new Set();
  subscribers.add(res);
  subscribersByBranch.set(branchKey, subscribers);

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write('retry: 10000\n\n');
  writeSseEvent(res, {
    event: 'collector-ready',
    id: versionByBranch.get(branchKey) || 0,
    data: { version: versionByBranch.get(branchKey) || 0, connectedAt: new Date().toISOString() }
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const unsubscribe = () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
    if (!subscribers.size) subscribersByBranch.delete(branchKey);
  };
  res.once('close', unsubscribe);
}

function publishCollectorLiveUpdate(source, topics) {
  const normalizedTopics = normalizeTopics(topics);
  if (!normalizedTopics.length) return null;

  const branchKey = resolveBranchKey(source);
  const eventVersion = (versionByBranch.get(branchKey) || 0) + 1;
  versionByBranch.set(branchKey, eventVersion);
  const event = {
    version: eventVersion,
    topics: normalizedTopics,
    changedAt: new Date().toISOString()
  };
  const subscribers = subscribersByBranch.get(branchKey);
  for (const res of subscribers || []) {
    if (res.writableEnded || res.destroyed) {
      subscribers.delete(res);
      continue;
    }
    writeSseEvent(res, { event: 'collector-update', id: eventVersion, data: event });
  }
  return event;
}

function notifyCollectorMutation(topicResolver) {
  return (req, res, next) => {
    if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return next();
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return;
      const topics = typeof topicResolver === 'function' ? topicResolver(req) : topicResolver;
      publishCollectorLiveUpdate(req, topics);
    });
    return next();
  };
}

function resolveCollectorPaymentMutationTopics(req = {}) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].toLowerCase();
  if (path.includes('/priorities')) return ['priorities'];
  if (path.includes('/reschedules')) return ['reschedules'];
  if (path.includes('/approvals')) {
    return ['approvals', 'remittances', 'assignments', 'priorities', 'reschedules'];
  }
  if (path.includes('/remittances')) return ['remittances'];
  return ['approvals', 'remittances'];
}

module.exports = {
  notifyCollectorMutation,
  publishCollectorLiveUpdate,
  resolveCollectorPaymentMutationTopics,
  subscribeCollectorLiveUpdates,
  _test: {
    normalizeTopics,
    resolveBranchKey,
    reset() {
      subscribersByBranch.clear();
      versionByBranch.clear();
    }
  }
};
