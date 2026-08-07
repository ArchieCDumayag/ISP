#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['billing-scheduler.js', 'billing-scheduler'],
  ['disconnection-store.js', 'disconnection-store'],
  ['disconnections.js', 'disconnections'],
  ['payment-breakdown-balance.js', 'payment-breakdown-balance'],
  ['payment-confirmation-queue-store.js', 'payment-confirmation-queue-store'],
  ['payment-confirmations.js', 'payment-confirmations'],
  ['payment-entry-normalizer.js', 'payment-entry-normalizer'],
  ['payment-numbering.js', 'payment-numbering'],
  ['payment-records.js', 'payment-records'],
  ['payment-service-refresh.js', 'payment-service-refresh'],
  ['payments.js', 'payments'],
  ['plan-profile-utils.js', 'plan-profile-utils'],
  ['plans.js', 'plans']
];

const backend = loadModuleBackend('billing', { required: true, fresh: true });
assert.strictEqual(backend.id, 'billing');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/billing/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Billing backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Billing root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('billing', { required: true });
const webFiles = [
  'account-statement.html',
  'billing-statement.html',
  'disconnections.html',
  'payment-breakdown.html',
  'payment-confirmation-queue-history.html',
  'payment-confirmation-queue-history.js',
  'payment-confirmation-queue.html',
  'payment-confirmation-queue.js',
  'payment-history.html',
  'payment-receipt.html',
  'payments.html',
  'payments.js',
  'plans.html',
  'plans.js',
  'quick-payment.html',
  'thermal-print.html',
  'css/billing-statement.css',
  'css/disconnections.css',
  'css/payment-breakdown.css',
  'css/payment-breakdown-table.css',
  'css/payment-confirmation-queue-history.css',
  'css/payment-confirmation-queue.css',
  'css/payment-history.css',
  'css/payment-receipt.css',
  'css/payments.css',
  'css/plans-tabler.css',
  'css/plans.css',
  'css/quick-payment.css',
  'css/statements.css',
  'js/disconnections.js',
  'js/payment-breakdown.js',
  'js/payment-breakdown-table.js',
  'js/payment-current-bill.js',
  'js/payment-history.js',
  'js/payment-receipt.js',
  'js/quick-payment.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Billing web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Billing web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Billing web root (${webFiles.length} files)`);

const paymentsHtmlSource = fs.readFileSync(path.join(webRoot, 'payments.html'), 'utf8');
const paymentsBrowserSource = fs.readFileSync(path.join(webRoot, 'payments.js'), 'utf8');
const breakdownHtmlSource = fs.readFileSync(path.join(webRoot, 'payment-breakdown.html'), 'utf8');
const breakdownBrowserSource = fs.readFileSync(path.join(webRoot, 'js/payment-breakdown.js'), 'utf8');
assert(paymentsHtmlSource.includes('id="paymentBreakdownModal"'));
assert(paymentsHtmlSource.includes('id="paymentBreakdownModalTableBody"'));
assert(paymentsHtmlSource.includes('id="paymentBreakdownModalAddPayment"'));
assert(paymentsHtmlSource.includes('js/payment-breakdown-table.js'));
assert(breakdownHtmlSource.includes('js/payment-breakdown-table.js'));
assert(paymentsBrowserSource.includes('openPaymentBreakdownModal(accountNumber, breakdownLink)'));
assert(paymentsBrowserSource.includes('openPaymentModalForAccount(targetAccount, { lockCustomer: true })'));
assert(paymentsBrowserSource.includes('refreshPaymentBreakdown: true'));
assert(paymentsBrowserSource.includes('/api/payment-records/${encodeURIComponent(accountNumber)}'));
assert(!paymentsBrowserSource.includes('window.location.assign(buildPaymentBreakdownUrl(accountNumber))'));
assert(breakdownBrowserSource.includes('breakdownTableRenderer.render({'));
assert(!breakdownBrowserSource.includes('const renderBillCell ='));

const sharedBreakdownSource = fs.readFileSync(path.join(webRoot, 'js/payment-breakdown-table.js'), 'utf8');
const browserSandbox = { window: {}, Intl, Date, Number, Object, String, Array, Math };
vm.runInNewContext(sharedBreakdownSource, browserSandbox, { filename: 'payment-breakdown-table.js' });
const tableRenderer = browserSandbox.window.PaymentBreakdownTable;
assert.strictEqual(typeof tableRenderer?.createDisplayRows, 'function');
assert.strictEqual(typeof tableRenderer?.render, 'function');
const displayRows = tableRenderer.createDisplayRows(
  { planName: 'Test Plan', billingCycle: 'Every 1st of the month' },
  [{
    billDate: '2026-08-01',
    planType: 'prepaid',
    planAmount: 1000,
    previousBalance: 0,
    advance: 0,
    referral: 0,
    due: 1000,
    amountPaid: 1000,
    paymentStatus: 'paid',
    balanceAfterPayment: 0,
    paymentDetails: [{ amount: 1000, mode: 'Cash', date: '2026-08-01' }]
  }]
);
const mockTableBody = { innerHTML: '' };
tableRenderer.render({ tbody: mockTableBody, rows: displayRows });
assert(mockTableBody.innerHTML.includes('Aug 2026'));
assert(mockTableBody.innerHTML.includes('Every 1st of the month'));
assert(mockTableBody.innerHTML.includes('is-paid'));
assert(mockTableBody.innerHTML.includes('Cash'));
console.log('PASS shared Payment Breakdown table renderer and Payments modal wiring');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('billing')"));
assert(serverSource.includes("billingBackend.load('plans')"));
assert(serverSource.includes("billingBackend.load('payments')"));
assert(serverSource.includes("billingBackend.load('paymentRecords')"));
assert(serverSource.includes("billingBackend.load('disconnections')"));
assert(serverSource.includes("billingBackend.load('billingScheduler')"));
assert(serverSource.includes("billingBackend.load('paymentConfirmations')"));
assert(serverSource.includes('BILLING_WEB_ROOT'));
assert(serverSource.includes('.map((webRoot) => path.join(webRoot, filename))'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'quick-payment.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'payment-receipt.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', safeName)"));
console.log('PASS Billing server loader, web routing, and statement template paths');

const proofStoreSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmation-queue-store.js'),
  'utf8'
);
assert(proofStoreSource.includes("path.join(PUBLIC_ROOT, 'uploads', ...relativePath.split('/'))"));
const paymentsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payments.js'),
  'utf8'
);
assert(paymentsSource.includes("path.join(DATA_DIR, 'payment-backups')"));
assert(paymentsSource.includes("path.join(PROJECT_ROOT, '.cloudflared', 'config.yml')"));
console.log('PASS repository-root proof uploads, backups, and tunnel configuration paths');

const normalizer = backend.load('paymentEntryNormalizer');
assert.strictEqual(normalizer.normalizePaymentEntryDirection({ kind: 'payment' }), 'credit');
assert.strictEqual(normalizer.normalizePaymentEntryDirection({ kind: 'bill' }), 'debit');
assert.deepStrictEqual(
  normalizer.normalizePaymentEntry({ direction: 'credit', amount: 250 }),
  { direction: 'credit', amount: 250, kind: 'payment', type: 'payment' }
);

const profiles = backend.load('planProfileUtils');
const plan = {
  profile: 'default-profile',
  profileBindings: { router_a: 'router-profile' }
};
assert.strictEqual(profiles.resolvePlanProfileForRouter(plan, 'router_a'), 'router-profile');
assert.strictEqual(profiles.resolvePlanProfileForRouter(plan), 'default-profile');

const breakdown = backend.load('paymentBreakdownBalance');
assert.strictEqual(breakdown.roundMoney(123.456), 123.46);
console.log('PASS Billing normalization, plan-profile, and balance helper behavior');
console.log('BILLING COMPATIBILITY PASSED');
