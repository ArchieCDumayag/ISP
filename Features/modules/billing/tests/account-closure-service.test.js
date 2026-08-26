const assert = require('assert/strict');

const stores = { payments: {} };
const canonicalBase = new Map([
  ['100000356', 1250],
  ['100000357', -300],
  ['100000358', 0],
  ['100000359', 800]
]);
const refreshEvents = [];
const relationalEntries = new Map();
let relationalMode = false;

function replaceModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
}

replaceModule('../../../../core/data/data-store', {
  readJson: async (key, fallback) => structuredClone(stores[key] ?? fallback),
  writeJson: async (key, payload) => {
    stores[key] = structuredClone(payload);
  }
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalMode
});
replaceModule('../backend/payment-numbering', {
  withTransaction: async (operation) => operation({
    query: async (sql, params = []) => {
      if (/^\s*SELECT/i.test(sql)) {
        const stored = relationalEntries.get(String(params[1] || ''));
        return [stored ? [stored] : []];
      }
      if (/^\s*INSERT/i.test(sql)) {
        const entry = {
          id: params[0],
          accountNumber: params[2],
          amount: params[3],
          date: params[4],
          kind: params[5],
          direction: params[6],
          reference: params[7],
          description: params[9],
          recordedAt: params[11]
        };
        relationalEntries.set(String(entry.id), entry);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected relational closure query: ${sql}`);
    }
  })
});
replaceModule('../backend/payment-service-refresh', {
  triggerBranchServiceRefresh: (branchId, source) => refreshEvents.push({ branchId, source })
});
replaceModule('../backend/payment-records', {
  buildPaymentRecordForAccount: async (accountNumber) => {
    const base = Number(canonicalBase.get(accountNumber));
    if (!Number.isFinite(base)) return null;
    const credits = (stores.payments?.[accountNumber]?.history || [])
      .filter((entry) => entry?.direction === 'credit')
      .reduce((sum, entry) => sum + (Number(entry?.amount) || 0), 0);
    return {
      accountNumber,
      billingSummary: {
        version: 2,
        available: true,
        endingBalance: Number((base - credits).toFixed(2))
      }
    };
  }
});

const servicePath = require.resolve('../backend/account-closure-service');
delete require.cache[servicePath];
const closureService = require(servicePath);
const { calculatePaymentBreakdownEndingBalance } = require('../backend/payment-breakdown-balance');
const { upsertBranchDisconnection } = require('../backend/disconnection-store');

const request = (overrides = {}) => closureService.recordAccountClosureWriteOff({
  branchId: 1,
  accountNumber: '100000356',
  closureId: 'closed-customer-a',
  closureDate: '2026-08-26',
  reason: 'Customer requested permanent disconnection',
  actor: { id: 'admin-1', username: 'archiecd', name: 'Archie Admin', role: 'Admin' },
  confirmed: true,
  ...overrides
});

async function run() {
  await assert.rejects(
    () => request({ closureId: 'closed-customer-unconfirmed', confirmed: false }),
    /Confirm the audited write-off of ₱1250\.00/i
  );
  assert.equal(stores.payments['100000356'], undefined);

  const created = await request();
  assert.equal(created.inserted, true);
  assert.equal(created.amount, 1250);
  const history = stores.payments['100000356'].history;
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, 'discount');
  assert.equal(history[0].direction, 'credit');
  assert.equal(history[0].paymentMethod, 'Account Closure Adjustment');
  assert.match(history[0].description, /Account closure write-off/);

  const replay = await request();
  assert.equal(replay.idempotent, true);
  assert.equal(stores.payments['100000356'].history.length, 1);
  assert.equal(refreshEvents.length, 1);

  await assert.rejects(
    () => request({ accountNumber: '100000357', closureId: 'closed-customer-advance' }),
    /advance balance of ₱300\.00/i
  );
  const zero = await request({ accountNumber: '100000358', closureId: 'closed-customer-zero', confirmed: false });
  assert.equal(zero.amount, 0);
  assert.equal(zero.inserted, false);
  assert.equal(stores.payments['100000358'], undefined);

  relationalMode = true;
  const relational = await request({
    accountNumber: '100000359',
    closureId: 'closed-customer-mysql-datetime'
  });
  assert.equal(relational.inserted, true);
  assert.match(relational.entry.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const storedRelational = relationalEntries.get(relational.entry.id);
  assert.match(storedRelational.recordedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.doesNotMatch(storedRelational.recordedAt, /[TZ]/);
  const relationalReplay = await request({
    accountNumber: '100000359',
    closureId: 'closed-customer-mysql-datetime'
  });
  assert.equal(relationalReplay.idempotent, true);
  assert.equal(relationalEntries.size, 1);

  const canonicalBreakdown = calculatePaymentBreakdownEndingBalance({
    accountNumber: '100000359',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planAmount: 800,
    billDate: '2026-07-01',
    dueDate: '2026-07-01',
    disconnection: {
      status: 'disconnected',
      billingPolicy: 'stop',
      disconnectedAt: '2026-08-26T00:00:00+08:00',
      billingThroughDate: '2026-07-01'
    },
    history: [
      {
        id: 'closure-writeoff-breakdown',
        amount: 800,
        date: '2026-08-26',
        recordedAt: '2026-08-26T11:00:00+08:00',
        kind: 'discount',
        type: 'discount',
        direction: 'credit',
        paymentMethod: 'Account Closure Adjustment',
        status: 'Approved'
      }
    ]
  });
  assert.equal(canonicalBreakdown.endingBalance, 0);
  assert.equal(canonicalBreakdown.rows.at(-1).amountPaid, 800);
  assert.equal(canonicalBreakdown.rows.length, 1);

  const closureDisconnection = await upsertBranchDisconnection(1, '100000359', {
    status: 'disconnected',
    billingPolicy: 'stop',
    disconnectedAt: '2026-08-26T00:00:00+08:00',
    billingThroughDate: '2026-07-01'
  });
  assert.equal(closureDisconnection.billingThroughDate, '2026-07-01');
  const ordinaryLifecycleUpdate = await upsertBranchDisconnection(1, '100000359', {
    status: 'kept-active',
    billingPolicy: 'continue',
    reconnectedAt: '2026-08-27T00:00:00+08:00'
  });
  assert.equal(ordinaryLifecycleUpdate.billingThroughDate, null);

  console.log('PASS idempotent audited account-closure write-offs, MySQL-safe timestamps, canonical discount balance, closure-only billing cutoff lifecycle, confirmation guard, advance guard, and zero-balance close');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
