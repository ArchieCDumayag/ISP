const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const liveUpdates = require('../backend/collector-live-updates');

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.writableEnded = false;
    this.destroyed = false;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  set(headers) {
    Object.assign(this.headers, headers);
    return this;
  }

  flushHeaders() {}

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }
}

function emittedUpdates(response) {
  return response.chunks.join('').split('\n\n').filter((chunk) => chunk.includes('event: collector-update'));
}

async function run() {
  liveUpdates._test.reset();

  const branchOne = new FakeResponse();
  const branchTwo = new FakeResponse();
  liveUpdates.subscribeCollectorLiveUpdates({ user: { branchId: 1 } }, branchOne);
  liveUpdates.subscribeCollectorLiveUpdates({ user: { branchId: 2 } }, branchTwo);

  assert.strictEqual(branchOne.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.strictEqual(branchOne.headers['X-Accel-Buffering'], 'no');
  assert.ok(branchOne.chunks.join('').includes('event: collector-ready'));

  const first = liveUpdates.publishCollectorLiveUpdate(
    { collector: { branchId: 1 } },
    ['approvals', 'remittances', 'unknown', 'approvals']
  );
  assert.deepStrictEqual(first.topics, ['approvals', 'remittances']);
  assert.strictEqual(first.version, 1);
  assert.strictEqual(emittedUpdates(branchOne).length, 1);
  assert.strictEqual(emittedUpdates(branchTwo).length, 0, 'events must remain branch-scoped');

  const second = liveUpdates.publishCollectorLiveUpdate({ user: { branchId: 2 } }, ['assignments']);
  assert.strictEqual(second.version, 1, 'each branch must keep an independent reconnect version');
  assert.strictEqual(emittedUpdates(branchTwo).length, 1);

  const mutationResponse = new FakeResponse();
  const mutationRequest = {
    method: 'POST',
    originalUrl: '/api/collector/payments/approvals/entry-1/approve',
    user: { branchId: 1 }
  };
  let middlewareContinued = false;
  liveUpdates.notifyCollectorMutation(liveUpdates.resolveCollectorPaymentMutationTopics)(
    mutationRequest,
    mutationResponse,
    () => { middlewareContinued = true; }
  );
  mutationResponse.emit('finish');
  assert.strictEqual(middlewareContinued, true);
  assert.ok(emittedUpdates(branchOne).at(-1).includes('"priorities"'));
  assert.ok(emittedUpdates(branchOne).at(-1).includes('"reschedules"'));

  const failedMutationResponse = new FakeResponse();
  failedMutationResponse.statusCode = 409;
  liveUpdates.notifyCollectorMutation(['priorities'])(
    { method: 'DELETE', user: { branchId: 1 } },
    failedMutationResponse,
    () => {}
  );
  const beforeFailure = emittedUpdates(branchOne).length;
  failedMutationResponse.emit('finish');
  assert.strictEqual(emittedUpdates(branchOne).length, beforeFailure, 'failed writes must not publish');

  const moduleRoot = path.resolve(__dirname, '..');
  const browserSource = fs.readFileSync(path.join(moduleRoot, 'web/js/collectors-page.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(moduleRoot, 'web/collectors.html'), 'utf8');
  const collectorsRouterSource = fs.readFileSync(path.join(moduleRoot, 'backend/collectors.js'), 'utf8');
  const paymentsRouterSource = fs.readFileSync(path.join(moduleRoot, 'backend/collector-payments.js'), 'utf8');

  assert.ok(browserSource.includes("new window.EventSource('/api/collectors/events'"));
  assert.ok(browserSource.includes('queueCollectorLiveTopics(payload.topics || [])'));
  assert.ok(browserSource.includes('version !== collectorLiveLastVersion'));
  assert.ok(browserSource.includes('COLLECTOR_FALLBACK_REFRESH_INTERVAL_MS = 30000'));
  assert.ok(browserSource.includes('if (!document.hidden && collectorLivePendingTopics.size)'));
  assert.ok(!browserSource.includes('startCollectorAutoRefresh'));
  assert.ok(!browserSource.includes('auto-refresh every 30 seconds'));
  assert.ok(pageSource.includes('Connecting live updates&hellip;'));
  assert.ok(collectorsRouterSource.includes("router.get('/events', subscribeCollectorLiveUpdates)"));
  assert.ok(paymentsRouterSource.includes('notifyCollectorMutation(resolveCollectorPaymentMutationTopics)'));

  branchOne.emit('close');
  branchTwo.emit('close');
  liveUpdates._test.reset();
  console.log('Collector live-update tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
