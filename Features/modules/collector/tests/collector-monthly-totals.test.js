const assert = require('assert/strict');
const express = require('express');

const ACCOUNTS = [
  { id: 'admin-1', role: 'Admin', branchId: 'branch-1', name: 'Admin' },
  { id: 'collector-1', role: 'Collector', branchId: 'branch-1', name: 'Collector One' },
  { id: 'collector-2', role: 'Collector', branchId: 'branch-1', name: 'Collector Two' }
];

const CUSTOMERS = [
  { accountNumber: 'PRE-100', area: 'North', branchId: 'branch-1', planCategory: 'Prepaid' },
  { accountNumber: 'POST-200', area: 'South', branchId: 'branch-1', planCategory: 'Postpaid' }
];

const APPROVED_PREPAID = {
  id: 'payment-prepaid-approved',
  accountNumber: 'PRE-100',
  amount: 800,
  date: '2026-08-09',
  kind: 'payment',
  type: 'payment',
  direction: 'credit',
  status: 'approved',
  recordedBy: { id: 'collector-1', role: 'Collector' },
  recordedByUserId: 'collector-1',
  recordedByRole: 'Collector'
};

const APPROVED_POSTPAID = {
  id: 'payment-postpaid-approved',
  accountNumber: 'POST-200',
  amount: 1000,
  date: '2026-08-10',
  kind: 'payment',
  type: 'payment',
  direction: 'credit',
  status: 'approved',
  recordedBy: { id: 'collector-2', role: 'Collector' },
  recordedByUserId: 'collector-2',
  recordedByRole: 'Collector'
};

const JSON_PAYMENTS = {
  'PRE-100': {
    history: [
      APPROVED_PREPAID,
      { ...APPROVED_PREPAID, id: 'payment-pending', amount: 900, status: 'pending_approval' },
      { ...APPROVED_PREPAID, id: 'payment-pending-gcash', amount: 650, status: 'pending_gcash_verification', paymentMethod: 'GCash' },
      { ...APPROVED_PREPAID, id: 'payment-rejected', amount: 700, status: 'rejected' },
      { ...APPROVED_PREPAID, id: 'credit-adjustment', amount: 50, kind: 'adjustment', type: 'adjustment' },
      { ...APPROVED_PREPAID, id: 'renewal-debit', amount: 800, kind: 'billing', type: 'billing', direction: 'debit' }
    ]
  },
  'POST-200': { history: [APPROVED_POSTPAID] }
};

let relationalReady = false;

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
  readJson: async (key, fallback) => {
    if (key === 'customers') return structuredClone(CUSTOMERS);
    if (key === 'payments') return structuredClone(JSON_PAYMENTS);
    return structuredClone(fallback);
  },
  writeJson: async () => {}
});
replaceModule('../../../../core/data/db-relational', {
  isRelationalReady: async () => relationalReady
});
replaceModule('../../../../core/data/db', {
  query: async (sql) => {
    if (/FROM customers/i.test(sql)) {
      return [structuredClone(CUSTOMERS)];
    }
    if (/FROM payment_entries/i.test(sql)) {
      return [[
        APPROVED_PREPAID,
        APPROVED_POSTPAID,
        { ...APPROVED_PREPAID, id: 'rel-pending', amount: 900, status: 'pending_approval' },
        { ...APPROVED_PREPAID, id: 'rel-pending-gcash', amount: 650, status: 'pending_gcash_verification', paymentMethod: 'GCash' },
        { ...APPROVED_PREPAID, id: 'rel-adjustment', amount: 50, kind: 'adjustment', type: 'adjustment' }
      ].map((entry) => ({ ...entry, recordedBy: undefined }))];
    }
    throw new Error(`Unexpected relational query: ${sql}`);
  }
});
replaceModule('../../admin/backend/accounts-store', {
  loadAccounts: async () => structuredClone(ACCOUNTS)
});

const routerPath = require.resolve('../backend/collectors');
delete require.cache[routerPath];
const collectorsRouter = require(routerPath);

async function run() {
  const app = express();
  app.use((req, res, next) => {
    req.user = { ...ACCOUNTS[0] };
    next();
  });
  app.use('/collectors', collectorsRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/collectors/report`;

  try {
    for (const mode of ['json', 'relational']) {
      relationalReady = mode === 'relational';
      const response = await fetch(baseUrl);
      const body = await response.json();
      assert.equal(response.status, 200, `${mode} report should load`);
      assert.equal(body.report['collector-1']['2026-08'], 800, `${mode} should include approved prepaid cash once`);
      assert.equal(body.report['collector-2']['2026-08'], 1000, `${mode} should include approved postpaid cash once`);
      assert.equal(body.areaReport.North.months['2026-08'], 800, `${mode} should retain prepaid area totals`);
      assert.equal(body.areaReport.South.months['2026-08'], 1000, `${mode} should retain postpaid area totals`);
    }

    const pageSource = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'web', 'js', 'collectors-page.js'),
      'utf8'
    );
    assert.match(
      pageSource,
      /function getCollectorMonthTotal[\s\S]*loadReport\.lastReport\?\.\[String\(collectorId\)\]\?\.\[monthKey\]/,
      'collector cards should use the collector report total by actual recorder identity'
    );
    assert.match(pageSource, /pending_gcash_verification/, 'Collector Operations must exclude unverified Admin GCash entries');
    const historySource = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'web', 'js', 'collectors-history.js'),
      'utf8'
    );
    assert.match(historySource, /pending_gcash_verification/, 'Collector History must exclude unverified Admin GCash entries');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('COLLECTOR MONTHLY TOTALS PASSED');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
