#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

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
  ['first-bill-adjustment-transfer.js', 'first-bill-adjustment-transfer'],
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
  'gcash-transaction.html',
  'payment-breakdown.html',
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
const paymentsCssSource = fs.readFileSync(path.join(webRoot, 'css/payments.css'), 'utf8');
const breakdownHtmlSource = fs.readFileSync(path.join(webRoot, 'payment-breakdown.html'), 'utf8');
const breakdownBrowserSource = fs.readFileSync(path.join(webRoot, 'js/payment-breakdown.js'), 'utf8');
const breakdownCssSource = fs.readFileSync(path.join(webRoot, 'css/payment-breakdown.css'), 'utf8');
assert(paymentsHtmlSource.includes('id="paymentBreakdownModal"'));
assert(paymentsHtmlSource.includes('id="paymentBreakdownModalTableBody"'));
assert(paymentsHtmlSource.includes('id="paymentBreakdownModalAddPayment"'));
assert(paymentsHtmlSource.includes('js/payment-breakdown-table.js'));
assert(paymentsHtmlSource.includes('id="paymentCustomerSearch"'));
assert(paymentsHtmlSource.includes('aria-controls="paymentCustomerSuggestions"'));
assert(paymentsHtmlSource.includes('id="paymentCustomerSuggestions"'));
assert(paymentsHtmlSource.includes('role="listbox" aria-label="Customer suggestions"'));
assert(paymentsHtmlSource.includes('id="customerSelect" name="accountNumber" required hidden'));
assert(paymentsHtmlSource.includes('id="paymentReferenceHint" role="alert"'));
assert(breakdownHtmlSource.includes('js/payment-breakdown-table.js'));
assert(breakdownHtmlSource.includes('id="breakdownPlanReason"'));
assert(breakdownHtmlSource.includes('id="breakdownPlanConfirmed"'));
assert(breakdownHtmlSource.includes('id="breakdownPlanHistory"'));
assert(breakdownHtmlSource.includes('id="breakdownAdjustmentModal"'));
assert(breakdownHtmlSource.includes('id="breakdownPlanModal"'));
assert(breakdownHtmlSource.includes('data-tabler-modal'));
assert(breakdownHtmlSource.includes('id="breakdownAdjustmentClose"'));
assert(breakdownHtmlSource.includes('id="breakdownPlanClose"'));
assert(breakdownHtmlSource.includes('id="breakdownReferralReason"'));
assert(breakdownHtmlSource.includes('id="breakdownReferralReverse"'));
assert(breakdownHtmlSource.includes('id="breakdownReferralQueue"'));
assert(breakdownHtmlSource.includes('id="breakdownReferralQueueList"'));
assert(breakdownHtmlSource.includes('id="breakdownComplimentaryModal"'));
assert(breakdownHtmlSource.includes('id="breakdownComplimentaryEffectiveMonth"'));
assert(breakdownHtmlSource.includes('id="breakdownComplimentaryBalanceTreatment"'));
assert(breakdownHtmlSource.includes('id="breakdownComplimentaryConfirmed"'));
assert(breakdownHtmlSource.includes('id="breakdownReconnectModal"'));
assert(breakdownHtmlSource.includes('id="breakdownReconnectBalanceTreatment"'));
assert(breakdownHtmlSource.includes('id="breakdownReconnectChargePolicy"'));
assert(breakdownHtmlSource.includes('<option value="full-month">'));
assert(breakdownHtmlSource.includes('id="breakdownReconnectActivationPolicy"'));
assert(breakdownHtmlSource.includes('id="breakdownReconnectConfirmed"'));
assert(!breakdownHtmlSource.includes('id="breakdownAdjustmentReferral"'));
assert(paymentsBrowserSource.includes('openPaymentBreakdownModal(accountNumber, breakdownLink)'));
assert(paymentsBrowserSource.includes('openPaymentModalForAccount(targetAccount, { lockCustomer: true })'));
assert(paymentsBrowserSource.includes('refreshPaymentBreakdown: true'));
assert(paymentsBrowserSource.includes('function renderPaymentCustomerSuggestions()'));
assert(paymentsBrowserSource.includes('function selectPaymentCustomer(accountNumber)'));
assert(paymentsBrowserSource.includes("paymentCustomerSearch?.addEventListener('input'"));
assert(paymentsBrowserSource.includes("paymentCustomerSearch?.addEventListener('keydown'"));
assert(paymentsBrowserSource.includes('Amount due ${formatCurrency(amountDue)}'));
assert(paymentsBrowserSource.includes('/api/payments/reference-availability?reference='));
assert(paymentsBrowserSource.includes('validatePaymentReferenceAvailability()'));
assert(paymentsBrowserSource.includes('paymentReferenceInput.setCustomValidity(text)'));
assert(paymentsCssSource.includes('.payment-customer-suggestions'));
assert(paymentsCssSource.includes('.payment-customer-option__amount'));
assert(paymentsBrowserSource.includes('/api/payment-records/${encodeURIComponent(accountNumber)}'));
assert(!paymentsBrowserSource.includes('window.location.assign(buildPaymentBreakdownUrl(accountNumber))'));
assert(breakdownBrowserSource.includes('breakdownTableRenderer.render({'));
assert(!breakdownBrowserSource.includes('const renderBillCell ='));
assert(breakdownBrowserSource.includes('planChange: {'));
assert(breakdownBrowserSource.includes('confirmed: true'));
assert(breakdownBrowserSource.includes('const showBillingModal ='));
assert(breakdownBrowserSource.includes('showBillingModal(adjustmentToolbar.modal)'));
assert(breakdownBrowserSource.includes('showBillingModal(planToolbar.modal)'));
assert(!breakdownBrowserSource.includes('Hide adjustment'));
assert(!breakdownBrowserSource.includes('Hide plan'));
assert(breakdownCssSource.includes('z-index: 1080 !important'));
assert(breakdownCssSource.includes('.payment-breakdown-form-modal.show'));
assert(breakdownCssSource.includes('pointer-events: auto !important'));
assert(breakdownBrowserSource.includes('referralApplication: {'));
assert(breakdownBrowserSource.includes("void saveReferralApplication('reverse')"));
assert(breakdownBrowserSource.includes('const renderReferralQueue ='));
assert(breakdownBrowserSource.includes('Next available generated unpaid month'));
assert(breakdownBrowserSource.includes("complimentaryAccount: action === 'disable'"));
assert(breakdownBrowserSource.includes('Save complimentary policy'));
assert(breakdownBrowserSource.includes('async function saveReconnectSettlement()'));
assert(breakdownBrowserSource.includes('requiredPaymentAmount'));
assert(breakdownBrowserSource.includes('Stopped months will not be back-billed'));
assert(breakdownBrowserSource.includes('full-month reconnection charge'));
assert(!breakdownHtmlSource.includes('id="breakdownReferralSave"'));
assert(!breakdownBrowserSource.includes('saveBreakdownAdjustmentPatch({ monthlyReferrals })'));
assert(!breakdownBrowserSource.includes('saveBreakdownAdjustmentPatch({ planChanges })'));

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
const pendingDisplayRows = tableRenderer.createDisplayRows(
  { planName: 'Test Plan', billingCycle: 'Every 1st of the month' },
  [{
    billDate: '2026-08-01',
    planType: 'prepaid',
    planAmount: 1000,
    previousBalance: 0,
    advance: 0,
    referral: 0,
    due: 1000,
    amountPaid: 0,
    paymentStatus: 'unpaid',
    balanceAfterPayment: 1000,
    pendingPaymentDetails: [{ amount: 1000, mode: 'GCash', date: '2026-08-16', statusLabel: 'Pending' }]
  }]
);
const pendingMockTableBody = { innerHTML: '' };
tableRenderer.render({ tbody: pendingMockTableBody, rows: pendingDisplayRows });
assert(pendingMockTableBody.innerHTML.includes('₱1,000.00'));
assert(pendingMockTableBody.innerHTML.includes('GCash · Pending'));
assert(!pendingMockTableBody.innerHTML.includes('<span class="badge bg-warning-lt text-warning ms-1">Pending</span>'));
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
assert(!serverSource.includes("billingBackend.load('paymentBridge')"));
assert(!serverSource.includes("billingBackend.load('gcashGmailImporter')"));
assert(!serverSource.includes("'/api/payment-bridge'"));
assert(serverSource.includes('BILLING_WEB_ROOT'));
assert(serverSource.includes('.map((webRoot) => path.join(webRoot, filename))'));
assert(serverSource.includes("'gcash-transaction.html'"));
assert(serverSource.includes("'/payment-confirmation-queue-history.html'"));
assert(serverSource.includes("res.redirect(302, '/gcash-transaction.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'quick-payment.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'payment-receipt.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', safeName)"));
console.log('PASS Billing server loader, web routing, and statement template paths');

const proofStoreSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmation-queue-store.js'),
  'utf8'
);
assert(proofStoreSource.includes("path.join(PUBLIC_ROOT, 'uploads', ...relativePath.split('/'))"));
const paymentQueueHtmlSource = fs.readFileSync(path.join(webRoot, 'gcash-transaction.html'), 'utf8');
const paymentQueueBrowserSource = fs.readFileSync(path.join(webRoot, 'payment-confirmation-queue.js'), 'utf8');
const paymentConfirmationsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payment-confirmations.js'),
  'utf8'
);
const gcashHistoryStoreSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/gcash-transaction-history-store.js'),
  'utf8'
);
assert(!fs.existsSync(path.join(webRoot, 'payment-confirmation-queue.html')));
assert(!fs.existsSync(path.join(webRoot, 'payment-confirmation-queue-history.html')));
assert(!fs.existsSync(path.join(webRoot, 'payment-confirmation-queue-history.js')));
assert(!fs.existsSync(path.join(webRoot, 'css/payment-confirmation-queue-history.css')));
assert(paymentQueueHtmlSource.includes('<title>GCash Transactions'));
assert(paymentQueueHtmlSource.includes('<h1>GCash Transactions</h1>'));
assert(paymentQueueHtmlSource.includes('id="queueLockGcashModal"'));
assert(paymentQueueHtmlSource.includes('id="queueGcashPendingTab"'));
assert(paymentQueueHtmlSource.includes('id="queueBindPendingGcashModal"'));
assert(!paymentQueueHtmlSource.includes('<option value="remarked">Not for Posting</option>'));
assert(paymentQueueHtmlSource.includes('data-gcash-history-type="remarked"'));
assert(paymentQueueHtmlSource.includes('id="queueGcashNotForPostingCount"'));
assert(paymentQueueBrowserSource.includes("if (type === 'remarked') return category === 'remarked'"));
assert(paymentQueueBrowserSource.includes("return category !== 'debit' && category !== 'remarked'"));
assert(paymentQueueBrowserSource.includes('data-action="lock-gcash"'));
assert(paymentQueueBrowserSource.includes('data-action="unlock-gcash"'));
assert(paymentQueueBrowserSource.includes("fetch('/api/payments/gcash-pending'"));
assert(paymentQueueBrowserSource.includes('data-action="bind-pending-gcash"'));
assert(paymentConfirmationsSource.includes("'/gcash-history/:reference/lock-posting'"));
assert(paymentConfirmationsSource.includes("'/gcash-history/:reference/unlock-posting'"));
assert(gcashHistoryStoreSource.includes("error.code = 'GCASH_TRANSACTION_POSTING_LOCKED'"));
assert(gcashHistoryStoreSource.includes('if (postingLock) throw createPostingLockConflictError(postingLock)'));
const sidebarSource = fs.readFileSync(path.join(projectRoot, 'public/sidebar.html'), 'utf8');
assert(sidebarSource.includes('href="gcash-transaction.html"'));
assert(sidebarSource.includes('GCash Transactions'));
assert(!sidebarSource.includes('payment-confirmation-queue-history.html'));
assert(!fs.existsSync(path.join(projectRoot, 'Features/modules/billing/backend/payment-bridge.js')));
assert(!fs.existsSync(path.join(projectRoot, 'Features/modules/billing/backend/gcash-notification-bridge-store.js')));
assert(!fs.existsSync(path.join(projectRoot, 'Features/modules/billing/backend/gcash-gmail-importer.js')));
assert(!paymentQueueHtmlSource.includes('queueBridgePanel'));
assert(!paymentQueueHtmlSource.includes('queueGmailPanel'));
assert(!paymentQueueBrowserSource.includes('/api/payment-bridge'));
assert(!paymentQueueBrowserSource.includes('/gcash-gmail/'));
const paymentsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payments.js'),
  'utf8'
);
assert(paymentsSource.includes("path.join(DATA_DIR, 'payment-backups')"));
assert(paymentsSource.includes("path.join(PROJECT_ROOT, '.cloudflared', 'config.yml')"));
assert(paymentsSource.includes("router.get('/gcash-pending'"));
assert(paymentsSource.includes("router.post('/gcash-pending/:accountNumber/:entryId/bind'"));
assert(paymentsSource.includes("router.get('/reference-availability'"));
assert(paymentsSource.includes("const PENDING_GCASH_STATUS = 'pending_gcash_verification'"));
assert(paymentsSource.includes("error.code = 'PAYMENT_REFERENCE_ALREADY_USED'"));
assert(paymentsSource.includes('await assertManualPaymentReferenceAvailable({'));
console.log('PASS repository-root proof uploads, backups, and tunnel configuration paths');

const normalizer = backend.load('paymentEntryNormalizer');
assert.strictEqual(normalizer.normalizePaymentEntryDirection({ kind: 'payment' }), 'credit');
assert.strictEqual(normalizer.normalizePaymentEntryDirection({ kind: 'bill' }), 'debit');
assert.strictEqual(normalizer.isEffectivePaymentEntryStatus({ status: 'pending_gcash_verification' }), false);
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
const paymentRecordsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payment-records.js'),
  'utf8'
);
const billingSchedulerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/billing-scheduler.js'),
  'utf8'
);
const disconnectionsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/disconnections.js'),
  'utf8'
);
const customersSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/customer-management/backend/customers.js'),
  'utf8'
);
assert(paymentRecordsSource.includes('buildEffectivePlanChangeEntry'));
assert(paymentRecordsSource.includes('synchronizeCustomerPlanHistory'));
assert(paymentRecordsSource.includes("Plan changes must be submitted through the audited planChange request."));
assert(paymentRecordsSource.includes('allocateQueuedReferralDiscounts'));
assert(paymentRecordsSource.includes('Approved referrals are applied automatically in queue order.'));
assert(paymentRecordsSource.includes('Complimentary periods must be submitted through the audited complimentaryAccount request.'));
assert(billingSchedulerSource.includes('isComplimentaryMonth(complimentaryPeriods, billMonth)'));
assert(disconnectionsSource.includes('complimentaryAccount.active'));
assert(disconnectionsSource.includes('buildReconnectionSettlement'));
assert(disconnectionsSource.includes('getPendingReconnectionSettlement'));
assert(disconnectionsSource.includes('normalizeChargePolicy'));
assert(paymentRecordsSource.includes('buildReconnectionSummary'));
assert(paymentRecordsSource.includes('Full-month reconnection charge'));
assert(paymentsSource.includes('activatePendingReconnectionSettlement'));
assert(paymentsSource.includes('A payment used to activate a reconnection cannot be deleted'));
assert(customersSource.includes('planChangeEffectiveAt = null'));
assert(customersSource.includes('hasFutureEffectivePlanChange'));
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/effective-plan-change.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/referral-application.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/complimentary-account.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/reconnection-settlement.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/customer-payment-proof.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/gcash-transaction-history.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/payment-deletion-archive-store.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/billing/tests/payment-deletion-recovery.test.js')
], { stdio: 'inherit' });
console.log('PASS Billing normalization, plan-profile, and balance helper behavior');
console.log('BILLING COMPATIBILITY PASSED');
