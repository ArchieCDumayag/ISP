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

async function main() {
  const backend = loadModuleBackend('temp', { required: true, fresh: true });
  assert.strictEqual(backend.id, 'temp');
  assert.strictEqual(typeof backend.load, 'function');
  assert.deepStrictEqual(Object.keys(backend.entries), ['workspace']);
  assert.strictEqual(typeof backend.load('workspace'), 'function');
  assert.throws(() => backend.load('customers'), /Unknown Temp backend entry/);
  console.log('PASS Temp isolated backend descriptor');

  const storeModule = require(path.join(projectRoot, 'Features/modules/temp/backend/workspace-store'));
  assert.strictEqual(storeModule.STORE_KEY, 'temp_workspace_isolated_v1');
  assert(!['customers', 'payments', 'plans'].includes(storeModule.STORE_KEY));

  const mainCustomerSentinel = [{ accountNumber: 'MAIN-001', firstName: 'Main', lastName: 'Location' }];
  const mainPaymentSentinel = { 'MAIN-001': { history: [{ amount: 999 }] } };
  const memory = new Map([
    ['customers', mainCustomerSentinel],
    ['payments', mainPaymentSentinel]
  ]);
  const touchedKeys = [];
  let clockTick = 0;
  let paymentUuidTick = 0;
  const isolatedStore = storeModule.createWorkspaceStore({
    readJson: async (key, fallback) => memory.has(key) ? memory.get(key) : fallback,
    writeJson: async (key, value) => {
      touchedKeys.push(key);
      memory.set(key, JSON.parse(JSON.stringify(value)));
    },
    now: () => `2026-07-30T00:00:${String(clockTick++).padStart(2, '0')}.000Z`,
    uuid: () => `temp-payment-id-${++paymentUuidTick}`
  });

  const customer = await isolatedStore.createCustomer({
    firstName: 'Other',
    lastName: 'Location',
    planName: 'Temp Plan',
    monthlyRate: 1000,
    openingBalance: 500,
    billingDay: 12
  });
  assert.strictEqual(customer.accountNumber, 'TMP000001');
  await isolatedStore.createPayment({
    accountNumber: customer.accountNumber,
    kind: 'charge',
    amount: 1000,
    date: '2026-07-30',
    paymentMethod: 'Other'
  }, 'Admin');
  await isolatedStore.createPayment({
    accountNumber: customer.accountNumber,
    kind: 'payment',
    amount: 700,
    date: '2026-07-30',
    paymentMethod: 'Cash'
  }, 'Admin');
  const snapshot = await isolatedStore.getSnapshot();
  assert.strictEqual(snapshot.customers.length, 1);
  assert.strictEqual(snapshot.payments.length, 2);
  assert.strictEqual(snapshot.customers[0].balance, 800);
  assert(touchedKeys.length >= 3);
  assert(touchedKeys.every((key) => key === storeModule.STORE_KEY));
  assert.deepStrictEqual(memory.get('customers'), mainCustomerSentinel);
  assert.deepStrictEqual(memory.get('payments'), mainPaymentSentinel);
  await assert.rejects(
    isolatedStore.deleteCustomer(customer.accountNumber),
    (error) => error.statusCode === 409
  );
  console.log('PASS Temp customer/payment storage isolation and balance behavior');

  const exported = await isolatedStore.createExport();
  assert.strictEqual(exported.kind, storeModule.EXPORT_KIND);
  assert.strictEqual(exported.data.customers.length, 1);
  assert.strictEqual(exported.data.payments.length, 2);
  await assert.rejects(
    isolatedStore.replaceFromExport({ kind: 'main-customer-export', data: exported.data }),
    /valid Temp workspace export/
  );
  console.log('PASS Temp-only export/import contract');

  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'Features/modules/temp/module.json'), 'utf8'));
  assert.deepStrictEqual(manifest.apiPrefixes, ['/api/temp']);

  const webRoot = getModuleWebRoot('temp', { required: true });
  const webFiles = fs.readdirSync(webRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  assert.deepStrictEqual(webFiles, ['temp.css', 'temp.html', 'temp.js']);

  const tempHtml = fs.readFileSync(path.join(webRoot, 'temp.html'), 'utf8');
  const tempCss = fs.readFileSync(path.join(webRoot, 'temp.css'), 'utf8');
  const tempJs = fs.readFileSync(path.join(webRoot, 'temp.js'), 'utf8');
  assert(tempHtml.includes('<title>Secondary Location Workspace</title>'));
  assert(tempHtml.includes('id="customersPanel"'));
  assert(tempHtml.includes('id="billingPanel"'));
  assert(tempHtml.includes('Isolated data'));
  assert(tempHtml.includes('/temp.js?v=1.5'));
  assert(tempHtml.includes('/temp.css?v=1.3'));
  [
    ['Old plan', '700'],
    ['Basic', '800'],
    ['Standard', '1000'],
    ['Premium', '1200']
  ].forEach(([planName, rate]) => {
    assert(tempHtml.includes(`<option value="${planName}">${planName} (${rate})</option>`));
    assert(tempHtml.includes(`<option value="${rate}">${rate}</option>`));
  });
  ['Poblacion', 'Masical'].forEach((address) => {
    assert(tempHtml.includes(`<option value="${address}">${address}</option>`));
  });
  assert(tempJs.includes("const TEMP_SERVICE_ADDRESSES = Object.freeze(['Poblacion', 'Masical']);"));
  assert(tempJs.includes("TEMP_SERVICE_ADDRESSES.includes(customer?.address)"));
  assert(tempJs.includes('const TEMP_PLAN_RATES = Object.freeze({'));
  assert(tempJs.includes("synchronizeCustomerPlanAndRate('plan')"));
  assert(tempJs.includes("synchronizeCustomerPlanAndRate('rate')"));
  assert(tempHtml.includes('Ledger &amp; payment history'));
  assert(tempJs.includes('id="customerLedgerTable"'));
  assert(tempJs.includes('id="paymentHistoryHeading">Payment history</h4>'));
  assert(tempJs.includes('id="customerPaymentHistory"'));
  assert(tempJs.includes("payment.kind === 'payment'"));
  assert(tempJs.includes('Payments received from this customer only.'));
  assert.strictEqual((tempHtml.match(/data-sort-group="customer"/g) || []).length, 7);
  assert.strictEqual((tempHtml.match(/data-sort-group="payment"/g) || []).length, 4);
  ['account', 'name', 'address', 'plan', 'billing', 'balance', 'status'].forEach((column) => {
    assert(tempHtml.includes(`data-sort-group="customer" data-sort-column="${column}"`));
  });
  ['date', 'receipt', 'customer', 'amount'].forEach((column) => {
    assert(tempHtml.includes(`data-sort-group="payment" data-sort-column="${column}"`));
  });
  assert(!tempHtml.includes('id="customerSort"'));
  assert(!tempHtml.includes('id="paymentSort"'));
  assert(tempHtml.includes('aria-sort="ascending"'));
  assert(tempHtml.includes('aria-sort="descending"'));
  assert(tempJs.includes('function sortCustomerRows(customers, sortKey)'));
  assert(tempJs.includes('function sortPaymentRows(payments, sortKey)'));
  assert(tempJs.includes("const tableSortState = { customer: 'name-asc', payment: 'date-desc' };"));
  assert(tempJs.includes('function renderSortHeaders(group)'));
  assert(tempJs.includes('function handleTableSort(event)'));
  assert(tempJs.includes("document.querySelectorAll('[data-sort-group]').forEach"));

  const sortHelperStart = tempJs.indexOf('const compareText =');
  const sortHelperEnd = tempJs.indexOf('function showToast');
  assert(sortHelperStart >= 0 && sortHelperEnd > sortHelperStart, 'Temp sort helper block is missing');
  const sortSandbox = {};
  vm.runInNewContext(`${tempJs.slice(sortHelperStart, sortHelperEnd)}
    globalThis.sortCustomerRows = sortCustomerRows;
    globalThis.sortPaymentRows = sortPaymentRows;`, sortSandbox);
  const customerSamples = [
    { accountNumber: 'TMP2', fullName: 'Alpha Client', address: 'Masical', monthlyRate: 800, billingDay: 20, balance: 100, status: 'inactive' },
    { accountNumber: 'TMP10', fullName: 'Bravo Client', address: 'Poblacion', monthlyRate: 1200, billingDay: 5, balance: -50, status: 'active' },
    { accountNumber: 'TMP1', fullName: 'Charlie Client', address: 'Poblacion', monthlyRate: 700, billingDay: 10, balance: 500, status: 'active' }
  ];
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'account-asc'), (item) => item.accountNumber), ['TMP1', 'TMP2', 'TMP10']);
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'plan-asc'), (item) => item.monthlyRate), [700, 800, 1200]);
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'balance-desc'), (item) => item.balance), [500, 100, -50]);
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'address-poblacion'), (item) => item.address), ['Poblacion', 'Poblacion', 'Masical']);
  assert.strictEqual(sortSandbox.sortCustomerRows(customerSamples, 'status-inactive')[0].status, 'inactive');

  const paymentSamples = [
    { id: 'p1', receiptNumber: 'TMP-2', customerName: 'Zulu Client', date: '2026-01-01', createdAt: '2026-01-01T08:00:00.000Z', amount: 100 },
    { id: 'p2', receiptNumber: 'TMP-10', customerName: 'Alpha Client', date: '2026-02-01', createdAt: '2026-02-01T08:00:00.000Z', amount: 50 },
    { id: 'p3', receiptNumber: 'TMP-1', customerName: 'Mike Client', date: '2026-02-01', createdAt: '2026-02-01T09:00:00.000Z', amount: 500 }
  ];
  assert.deepStrictEqual(Array.from(sortSandbox.sortPaymentRows(paymentSamples, 'date-desc'), (item) => item.id), ['p3', 'p2', 'p1']);
  assert.deepStrictEqual(Array.from(sortSandbox.sortPaymentRows(paymentSamples, 'amount-asc'), (item) => item.amount), [50, 100, 500]);
  assert.deepStrictEqual(Array.from(sortSandbox.sortPaymentRows(paymentSamples, 'receipt-desc'), (item) => item.receiptNumber), ['TMP-10', 'TMP-2', 'TMP-1']);
  assert.deepStrictEqual(Array.from(sortSandbox.sortPaymentRows(paymentSamples, 'customer-asc'), (item) => item.customerName), ['Alpha Client', 'Mike Client', 'Zulu Client']);
  console.log('PASS Temp customer and transaction sorting behavior');

  assert(tempCss.includes('.statement-summary'));
  assert(tempCss.includes('.statement-section'));
  assert(tempCss.includes('.statement-table--payments'));
  assert(tempCss.includes('.temp-dialog--statement[open]'));
  assert(tempCss.includes('.table-sort-button.active'));
  assert(tempCss.includes('var(--tblr-font-sans-serif'));
  assert(tempJs.includes("const API_ROOT = '/api/temp'"));
  assert(!tempHtml.includes('<iframe'), 'Temp must not embed canonical business pages');
  [tempHtml, tempCss, tempJs].forEach((source) => {
    assert(!source.includes('/customers.html'), 'Temp must not open or embed the main customer page');
    assert(!source.includes('/payments.html'), 'Temp must not open or embed the main payment page');
    assert(!source.includes('/api/customers'), 'Temp must not call the main customer API');
    assert(!source.includes('/api/payments'), 'Temp must not call the main payment API');
  });
  console.log('PASS standalone one-page Customer and Billing workspace');

  ['public/sidebar.html', 'public/topbar.html', 'public/index.html'].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    assert(!source.includes('temp.html'), `${relativePath} must not expose the hidden Temp page`);
  });
  console.log('PASS Temp page absent from shared navigation');

  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const protectedPagesBlock = serverSource.match(/const PROTECTED_PAGES = new Set\(\[([\s\S]*?)\]\);/);
  assert(protectedPagesBlock, 'Protected-page registry is missing');
  assert(protectedPagesBlock[1].includes("'temp.html'"), 'temp.html must use the shared Admin page guard');
  assert(serverSource.includes("const { backend: tempBackend } = requireModuleRuntime('temp');"));
  assert(serverSource.includes("const tempWorkspaceRouter = tempBackend.load('workspace');"));
  assert(serverSource.includes("app.use('/api/temp', requireAuth, tempWorkspaceRouter);"));
  console.log('PASS Temp page and API shared Admin authentication guard');
  console.log('TEMP COMPATIBILITY PASSED');
}

main().catch((error) => {
  console.error(`TEMP COMPATIBILITY FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
