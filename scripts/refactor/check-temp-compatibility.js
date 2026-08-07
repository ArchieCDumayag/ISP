#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');

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
  const cycleModule = require(path.join(projectRoot, 'Features/modules/temp/backend/billing-cycle'));
  const excelModule = require(path.join(projectRoot, 'Features/modules/temp/backend/workspace-excel'));
  assert.strictEqual(storeModule.STORE_KEY, 'temp_workspace_isolated_v1');
  assert.strictEqual(storeModule.SCHEMA_VERSION, 3);
  assert(!['customers', 'payments', 'plans'].includes(storeModule.STORE_KEY));
  assert.deepStrictEqual(Array.from(cycleModule.PLAN_TYPES).sort(), ['postpaid', 'prepaid', 'prorate']);
  assert.deepStrictEqual(Array.from(cycleModule.BILLING_SCHEDULE_MODES).sort(), ['date', 'day']);
  const prorateState = cycleModule.resolveInitialCycleState({
    planType: 'prorate',
    billingScheduleMode: 'day',
    activationDate: '2026-07-20',
    billingDay: 5
  }, '2026-07-30');
  assert.deepStrictEqual(prorateState, {
    billingCycleInitialized: true,
    billingScheduleConfigured: true,
    nextBillingDate: '2026-08-05',
    proratePending: true
  });
  assert.deepStrictEqual(cycleModule.resolveCycleCharge({
    planType: 'prorate',
    billingScheduleMode: 'day',
    activationDate: '2026-07-20',
    billingDay: 5,
    monthlyRate: 1000,
    proratePending: true
  }, '2026-08-05'), {
    amount: 516,
    prorated: true,
    periodStart: '2026-07-20',
    periodEnd: '2026-08-04'
  });
  const exactDateState = cycleModule.resolveInitialCycleState({
    planType: 'prepaid',
    billingScheduleMode: 'date',
    nextBillingDate: '2026-08-15',
    billingDay: 1
  }, '2026-07-30');
  assert.deepStrictEqual(exactDateState, {
    billingCycleInitialized: true,
    billingScheduleConfigured: true,
    nextBillingDate: '2026-08-15',
    proratePending: false,
    billingDay: 15
  });
  assert.deepStrictEqual(cycleModule.resolveCycleCharge({
    planType: 'prorate',
    billingScheduleMode: 'date',
    monthlyRate: 1000,
    proratePending: true
  }, '2026-08-15'), {
    amount: 1000,
    prorated: false,
    periodStart: '',
    periodEnd: ''
  });
  console.log('PASS Temp billing-cycle calculation helpers');

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
  assert.strictEqual(customer.planType, 'postpaid');
  assert.strictEqual(customer.billingScheduleMode, 'day');
  assert.strictEqual(customer.billingScheduleConfigured, true);
  assert.strictEqual(customer.activationDate, '2026-07-30');
  assert.strictEqual(customer.nextBillingDate, '2026-08-12');
  const editedCustomer = await isolatedStore.updateCustomer(customer.accountNumber, {
    firstName: 'Other Edited',
    lastName: 'Location',
    planName: 'Temp Plan',
    planType: 'postpaid',
    monthlyRate: 1000,
    openingBalance: 500,
    activationDate: '2026-07-30',
    billingScheduleMode: 'date',
    nextBillingDate: '2026-08-20',
    status: 'active'
  });
  assert.strictEqual(editedCustomer.firstName, 'Other Edited');
  assert.strictEqual(editedCustomer.billingScheduleMode, 'date');
  assert.strictEqual(editedCustomer.nextBillingDate, '2026-08-20');
  assert.strictEqual(editedCustomer.billingDay, 20);
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

  const cycleMemory = new Map();
  let cycleToday = '2026-07-30';
  let cycleClock = 0;
  let cycleUuid = 0;
  const cycleStore = storeModule.createWorkspaceStore({
    readJson: async (key, fallback) => cycleMemory.has(key) ? cycleMemory.get(key) : fallback,
    writeJson: async (key, value) => cycleMemory.set(key, JSON.parse(JSON.stringify(value))),
    today: () => cycleToday,
    now: () => `${cycleToday}T00:00:${String(cycleClock++).padStart(2, '0')}.000Z`,
    uuid: () => `cycle-manual-${++cycleUuid}`
  });
  const prepaidCustomer = await cycleStore.createCustomer({
    firstName: 'Prepaid',
    lastName: 'Client',
    planType: 'prepaid',
    activationDate: '2026-07-30',
    planName: 'Old plan',
    monthlyRate: 700,
    openingBalance: 125,
    billingScheduleMode: 'date',
    nextBillingDate: '2026-08-15'
  });
  const prepaidDayCustomer = await cycleStore.createCustomer({
    firstName: 'Prepaid Day',
    lastName: 'Client',
    planType: 'prepaid',
    activationDate: '2026-07-30',
    planName: 'Old plan',
    monthlyRate: 700,
    openingBalance: 0,
    billingScheduleMode: 'day',
    billingDay: 2
  });
  const postpaidCustomer = await cycleStore.createCustomer({
    firstName: 'Postpaid',
    lastName: 'Client',
    planType: 'postpaid',
    activationDate: '2026-07-30',
    planName: 'Basic',
    monthlyRate: 800,
    openingBalance: 50,
    billingScheduleMode: 'day',
    billingDay: 31
  });
  const prorateCustomer = await cycleStore.createCustomer({
    firstName: 'Prorate',
    lastName: 'Client',
    planType: 'prorate',
    activationDate: '2026-07-20',
    planName: 'Standard',
    monthlyRate: 1000,
    openingBalance: 250,
    billingScheduleMode: 'day',
    billingDay: 5
  });
  assert.strictEqual(prepaidCustomer.nextBillingDate, '2026-08-15');
  assert.strictEqual(prepaidCustomer.billingDay, 15);
  assert.strictEqual(prepaidDayCustomer.nextBillingDate, '2026-08-02');
  assert.strictEqual(postpaidCustomer.nextBillingDate, '2026-07-31');
  assert.strictEqual(prorateCustomer.nextBillingDate, '2026-08-05');
  assert.strictEqual((await cycleStore.getSnapshot()).payments.length, 0);

  cycleToday = '2026-07-31';
  let cycleSnapshot = await cycleStore.getSnapshot();
  let postpaidCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === postpaidCustomer.accountNumber);
  assert.strictEqual(postpaidCharges.length, 1);
  assert.strictEqual(postpaidCharges[0].amount, 800);
  assert.strictEqual(postpaidCharges[0].date, '2026-07-31');
  assert.strictEqual(postpaidCharges[0].systemGenerated, true);
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === postpaidCustomer.accountNumber).balance, 850);

  cycleToday = '2026-08-02';
  cycleSnapshot = await cycleStore.getSnapshot();
  const prepaidDayCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === prepaidDayCustomer.accountNumber);
  assert.strictEqual(prepaidDayCharges.length, 1);
  assert.strictEqual(prepaidDayCharges[0].amount, 700);
  assert.strictEqual(prepaidDayCharges[0].date, '2026-08-02');
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidDayCustomer.accountNumber).nextBillingDate, '2026-09-02');

  cycleToday = '2026-08-05';
  cycleSnapshot = await cycleStore.getSnapshot();
  const prorateCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === prorateCustomer.accountNumber);
  assert.strictEqual(prorateCharges.length, 1);
  assert.strictEqual(prorateCharges[0].amount, 516);
  assert.match(prorateCharges[0].description, /Prorated recurring charge/);
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prorateCustomer.accountNumber).balance, 766);
  assert.strictEqual(cycleSnapshot.payments.filter((entry) => entry.accountNumber === prepaidCustomer.accountNumber).length, 0);
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidCustomer.accountNumber).balance, 125);
  const paymentCountAfterFirstProrate = cycleSnapshot.payments.length;
  assert.strictEqual((await cycleStore.getSnapshot()).payments.length, paymentCountAfterFirstProrate);

  cycleToday = '2026-08-15';
  cycleSnapshot = await cycleStore.getSnapshot();
  let prepaidDateCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === prepaidCustomer.accountNumber);
  assert.strictEqual(prepaidDateCharges.length, 1);
  assert.strictEqual(prepaidDateCharges[0].amount, 700);
  assert.strictEqual(prepaidDateCharges[0].date, '2026-08-15');
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidCustomer.accountNumber).balance, 825);
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidCustomer.accountNumber).nextBillingDate, '2026-09-15');
  const paymentCountAfterExactDateCharge = cycleSnapshot.payments.length;
  assert.strictEqual((await cycleStore.getSnapshot()).payments.length, paymentCountAfterExactDateCharge);

  cycleToday = '2026-09-05';
  cycleSnapshot = await cycleStore.getSnapshot();
  const updatedProrate = cycleSnapshot.customers.find((entry) => entry.accountNumber === prorateCustomer.accountNumber);
  const updatedProrateCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === prorateCustomer.accountNumber);
  assert.deepStrictEqual(updatedProrateCharges.map((entry) => entry.amount).sort((left, right) => left - right), [516, 1000]);
  assert.strictEqual(updatedProrate.nextBillingDate, '2026-10-05');
  assert.strictEqual(updatedProrate.balance, 1766);
  assert.strictEqual(cycleSnapshot.payments.filter((entry) => entry.accountNumber === prepaidCustomer.accountNumber).length, 1);

  cycleToday = '2026-09-15';
  cycleSnapshot = await cycleStore.getSnapshot();
  prepaidDateCharges = cycleSnapshot.payments.filter((entry) => entry.accountNumber === prepaidCustomer.accountNumber);
  assert.deepStrictEqual(prepaidDateCharges.map((entry) => entry.amount), [700, 700]);
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidCustomer.accountNumber).nextBillingDate, '2026-10-15');
  assert.strictEqual(cycleSnapshot.customers.find((entry) => entry.accountNumber === prepaidCustomer.accountNumber).balance, 1525);
  console.log('PASS isolated Date/Number schedules and automatic Prepaid, Postpaid, and Prorate cycle behavior');

  const legacyMemory = new Map([[storeModule.STORE_KEY, {
    schemaVersion: 2,
    customers: [{
      accountNumber: 'TMP000001',
      firstName: 'Legacy',
      lastName: 'Prepaid',
      planType: 'prepaid',
      planName: 'Old plan',
      monthlyRate: 700,
      billingDay: 15,
      activationDate: '2026-07-01',
      nextBillingDate: '',
      billingCycleInitialized: true,
      openingBalance: 700,
      status: 'active'
    }],
    payments: [],
    sequences: { customer: 1, payment: 0 }
  }]]);
  const legacyStore = storeModule.createWorkspaceStore({
    readJson: async (key, fallback) => legacyMemory.has(key) ? legacyMemory.get(key) : fallback,
    writeJson: async (key, value) => legacyMemory.set(key, JSON.parse(JSON.stringify(value))),
    today: () => '2026-07-30',
    now: () => '2026-07-30T00:00:00.000Z'
  });
  const legacySnapshot = await legacyStore.getSnapshot();
  assert.strictEqual(legacySnapshot.payments.length, 0);
  assert.strictEqual(legacySnapshot.customers[0].billingScheduleMode, 'day');
  assert.strictEqual(legacySnapshot.customers[0].billingScheduleConfigured, true);
  assert.strictEqual(legacySnapshot.customers[0].nextBillingDate, '2026-08-15');
  assert.strictEqual(legacySnapshot.customers[0].balance, 700);
  console.log('PASS legacy Prepaid migration starts at the next future cycle without back-billing');

  const exported = await isolatedStore.createExport();
  assert.strictEqual(exported.kind, storeModule.EXPORT_KIND);
  assert.strictEqual(exported.data.customers.length, 1);
  assert.strictEqual(exported.data.payments.length, 2);
  const excelBuffer = excelModule.buildWorkspaceExcelBuffer(exported);
  assert(Buffer.isBuffer(excelBuffer));
  assert.strictEqual(excelBuffer[0], 0x50);
  assert.strictEqual(excelBuffer[1], 0x4b);
  const parsedExcelExport = excelModule.parseWorkspaceExcelBuffer(excelBuffer);
  assert.deepStrictEqual(parsedExcelExport, exported);
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  assert.deepStrictEqual(workbook.SheetNames, [
    excelModule.SHEET_NAMES.metadata,
    excelModule.SHEET_NAMES.customers,
    excelModule.SHEET_NAMES.payments
  ]);
  assert.deepStrictEqual(
    XLSX.utils.sheet_to_json(workbook.Sheets[excelModule.SHEET_NAMES.customers], { header: 1 })[0],
    Array.from(excelModule.CUSTOMER_FIELDS)
  );
  assert.deepStrictEqual(
    XLSX.utils.sheet_to_json(workbook.Sheets[excelModule.SHEET_NAMES.payments], { header: 1 })[0],
    Array.from(excelModule.PAYMENT_FIELDS)
  );
  const collectorReport = excelModule.buildCollectorRows(exported, { reportDate: '2026-08-15' });
  assert.strictEqual(collectorReport.rows.length, 1);
  assert.deepStrictEqual(collectorReport.rows[0], {
    Account: customer.accountNumber,
    Customer: 'Other Edited Location',
    'Service address': '',
    Plan: 'Temp Plan (1000)',
    'Plan type': 'Postpaid',
    Billing: 'Date 2026-08-20',
    Balance: 800,
    Due: 800
  });
  const pendingCollectorPayload = JSON.parse(JSON.stringify(exported));
  pendingCollectorPayload.data.customers[0].nextBillingDate = '2026-08-15';
  const billingDateReachedReport = excelModule.buildCollectorRows(
    pendingCollectorPayload,
    { reportDate: '2026-08-15' }
  );
  assert.strictEqual(billingDateReachedReport.rows[0].Balance, 800);
  assert.strictEqual(billingDateReachedReport.rows[0].Due, 1800);

  const generatedCollectorPayload = JSON.parse(JSON.stringify(pendingCollectorPayload));
  generatedCollectorPayload.data.customers[0].nextBillingDate = '2026-09-15';
  generatedCollectorPayload.data.payments.push({
    id: 'collector-cycle-2026-08-15',
    receiptNumber: 'TMP-0000003',
    accountNumber: customer.accountNumber,
    kind: 'charge',
    amount: 1000,
    date: '2026-08-15',
    paymentMethod: 'System',
    reference: '',
    description: 'Monthly recurring charge',
    recordedBy: 'Temp billing cycle',
    systemGenerated: true,
    cycleKey: `${customer.accountNumber}:2026-08-15`,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  });
  const generatedCollectorReport = excelModule.buildCollectorRows(
    generatedCollectorPayload,
    { reportDate: '2026-08-15' }
  );
  assert.strictEqual(generatedCollectorReport.rows[0].Balance, 1800);
  assert.strictEqual(generatedCollectorReport.rows[0].Due, 1800);
  generatedCollectorPayload.exportedAt = '2026-08-14T16:30:00.000Z';
  const manilaBoundaryCollectorReport = excelModule.buildCollectorRows(generatedCollectorPayload);
  assert.strictEqual(manilaBoundaryCollectorReport.reportDate, '2026-08-15');
  assert.strictEqual(manilaBoundaryCollectorReport.rows[0].Balance, 1800);
  assert.strictEqual(manilaBoundaryCollectorReport.rows[0].Due, 1800);
  const collectorBuffer = excelModule.buildCollectorExcelBuffer(exported, { reportDate: '2026-08-15' });
  assert(Buffer.isBuffer(collectorBuffer));
  assert.strictEqual(collectorBuffer[0], 0x50);
  assert.strictEqual(collectorBuffer[1], 0x4b);
  const collectorWorkbook = XLSX.read(collectorBuffer, { type: 'buffer' });
  assert.deepStrictEqual(collectorWorkbook.SheetNames, [excelModule.SHEET_NAMES.collector]);
  const collectorMatrix = XLSX.utils.sheet_to_json(
    collectorWorkbook.Sheets[excelModule.SHEET_NAMES.collector],
    { header: 1, raw: true }
  );
  assert.deepStrictEqual(collectorMatrix[0], Array.from(excelModule.COLLECTOR_HEADERS));
  assert.deepStrictEqual(collectorMatrix[1], Object.values(collectorReport.rows[0]));
  console.log('PASS Collector Excel Manila-date current balance and billing-date-gated due calculation');
  const excelRestore = await isolatedStore.replaceFromExport(parsedExcelExport);
  assert.strictEqual(excelRestore.summary.customerCount, 1);
  assert.strictEqual(excelRestore.summary.paymentCount, 2);
  const jsonRestore = await isolatedStore.replaceFromExport(JSON.parse(JSON.stringify(exported)));
  assert.strictEqual(jsonRestore.summary.customerCount, 1);
  assert.strictEqual(jsonRestore.summary.paymentCount, 2);
  assert.throws(
    () => excelModule.parseWorkspaceExcelBuffer(Buffer.from('not an Excel workbook')),
    /valid Temp workspace Excel export file|Excel file must contain/
  );
  assert.throws(
    () => excelModule.buildWorkspaceExcelBuffer({ ...exported, kind: 'main-customer-export' }),
    /valid Temp workspace export file/
  );
  await assert.rejects(
    isolatedStore.replaceFromExport({ kind: 'main-customer-export', data: exported.data }),
    /valid Temp workspace export/
  );
  console.log('PASS complete Temp JSON and Excel export/import round-trip contract');

  const clearedSnapshot = await isolatedStore.clearAllData();
  assert.strictEqual(clearedSnapshot.summary.customerCount, 0);
  assert.strictEqual(clearedSnapshot.summary.paymentCount, 0);
  assert.deepStrictEqual(memory.get(storeModule.STORE_KEY).sequences, { customer: 0, payment: 0 });
  assert.deepStrictEqual(memory.get('customers'), mainCustomerSentinel);
  assert.deepStrictEqual(memory.get('payments'), mainPaymentSentinel);
  console.log('PASS confirmed clear-all storage contract remains Temp-only');

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
  assert(tempHtml.includes('/temp.js?v=2.1'));
  assert(tempHtml.includes('/temp.css?v=1.9'));
  assert(tempHtml.includes('id="clearWorkspaceBtn"'));
  assert(tempHtml.includes('id="exportCollectorBtn"'));
  assert(tempHtml.includes('Collector Excel'));
  assert(tempHtml.includes('id="exportFormatDialog"'));
  assert(tempHtml.includes('id="exportJsonBtn"'));
  assert(tempHtml.includes('id="exportExcelBtn"'));
  assert(tempHtml.includes('.json,.xlsx,.xls'));
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
  ['prepaid', 'postpaid', 'prorate'].forEach((planType) => {
    assert(tempHtml.includes(`<option value="${planType}"`));
  });
  assert(tempHtml.includes('id="customerPlanType"'));
  assert(tempHtml.includes('id="customerActivationDate"'));
  assert(tempHtml.includes('id="customerBillingScheduleMode"'));
  assert(tempHtml.includes('id="customerNextBillingDate"'));
  assert(tempHtml.includes('id="customerBillingDayField" hidden'));
  assert(tempHtml.includes('<option value="date" selected>Date — exact next bill</option>'));
  assert(tempHtml.includes('<option value="day">Number — monthly billing day</option>'));
  assert(tempHtml.includes('id="customerCycleHint"'));
  assert(tempJs.includes("const TEMP_SERVICE_ADDRESSES = Object.freeze(['Poblacion', 'Masical']);"));
  assert(tempJs.includes("const TEMP_PLAN_TYPES = Object.freeze(['prepaid', 'postpaid', 'prorate']);"));
  assert(tempJs.includes("const TEMP_BILLING_SCHEDULE_MODES = Object.freeze(['date', 'day']);"));
  assert(tempJs.includes('const filenameFromDisposition ='));
  assert(tempJs.includes("async function exportWorkspace(format)"));
  assert(tempJs.includes("exportWorkspace('json')"));
  assert(tempJs.includes("exportWorkspace('xlsx')"));
  assert(tempJs.includes("fetch(`${API_ROOT}/import-file`"));
  assert(tempJs.includes("'Content-Type': 'application/octet-stream'"));
  assert(tempJs.includes('replace every Temp customer and transaction'));
  assert(tempJs.includes('async function clearWorkspaceData()'));
  assert(tempJs.includes('async function exportCollectorWorkbook()'));
  assert(tempJs.includes("fetch(`${API_ROOT}/collector-export`"));
  assert(tempJs.includes("showToast('Collector Excel exported.')"));
  assert(tempJs.includes('Permanently delete all'));
  assert(tempJs.includes('This cannot be undone. Export a backup first'));
  assert(tempJs.includes("api('/workspace', { method: 'DELETE' })"));
  assert(tempJs.includes('function updateCustomerBillingScheduleFields()'));
  assert(tempJs.includes('The first automatic full monthly charge is on'));
  assert(!tempJs.includes('Manual renewal'));
  assert(!tempJs.includes('Prepaid has no automatic monthly charge'));
  assert(tempJs.includes("dialog.addEventListener('cancel', (event) => {"));
  assert(tempJs.includes('event.preventDefault();'));
  assert(!tempJs.includes('if (event.target === dialog) dialog.close()'));
  assert(tempJs.includes("document.querySelectorAll('[data-close-dialog]').forEach"));
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
  assert(tempHtml.includes('data-sort-column="plan-type" data-sort-label="Plan type">Plan type'));
  assert(tempJs.includes('plan-type-pill--${escapeHtml(planType)}'));
  assert.strictEqual((tempHtml.match(/data-sort-group="customer"/g) || []).length, 8);
  assert.strictEqual((tempHtml.match(/data-sort-group="payment"/g) || []).length, 4);
  ['account', 'name', 'address', 'plan', 'plan-type', 'billing', 'balance', 'status'].forEach((column) => {
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
    { accountNumber: 'TMP2', fullName: 'Alpha Client', address: 'Masical', planType: 'prorate', monthlyRate: 800, billingDay: 20, balance: 100, status: 'inactive' },
    { accountNumber: 'TMP10', fullName: 'Bravo Client', address: 'Poblacion', planType: 'postpaid', monthlyRate: 1200, billingDay: 5, balance: -50, status: 'active' },
    { accountNumber: 'TMP1', fullName: 'Charlie Client', address: 'Poblacion', planType: 'prepaid', monthlyRate: 700, billingDay: 10, balance: 500, status: 'active' }
  ];
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'account-asc'), (item) => item.accountNumber), ['TMP1', 'TMP2', 'TMP10']);
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'plan-asc'), (item) => item.monthlyRate), [700, 800, 1200]);
  assert.deepStrictEqual(Array.from(sortSandbox.sortCustomerRows(customerSamples, 'plan-type-asc'), (item) => item.planType), ['postpaid', 'prepaid', 'prorate']);
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
  assert(tempCss.includes('.cycle-hint--prorate'));
  assert(tempCss.includes('.plan-type-pill--prepaid'));
  assert(tempCss.includes('.plan-type-pill--postpaid'));
  assert(tempCss.includes('.plan-type-pill--prorate'));
  assert(tempCss.includes('.form-field[hidden]'));
  assert(tempCss.includes('.temp-dialog--export'));
  assert(tempCss.includes('.export-format-grid'));
  assert(tempCss.includes('.export-format-option'));
  assert(tempCss.includes('grid-template-columns: repeat(5, 1fr)'));
  assert(tempCss.includes('var(--tblr-font-sans-serif'));
  assert(tempJs.includes("const API_ROOT = '/api/temp'"));
  assert(!tempHtml.includes('<iframe'), 'Temp must not embed canonical business pages');
  [tempHtml, tempCss, tempJs].forEach((source) => {
    assert(!source.includes('/customers.html'), 'Temp must not open or embed the main customer page');
    assert(!source.includes('/payments.html'), 'Temp must not open or embed the main payment page');
    assert(!source.includes('/api/customers'), 'Temp must not call the main customer API');
    assert(!source.includes('/api/payments'), 'Temp must not call the main payment API');
  });
  const routerSource = fs.readFileSync(
    path.join(projectRoot, 'Features/modules/temp/backend/workspace-router.js'),
    'utf8'
  );
  assert(routerSource.includes("req.query.format || 'json'"));
  assert(routerSource.includes("router.post('/import-file'"));
  assert(routerSource.includes("router.delete('/workspace'"));
  assert(routerSource.includes('workspaceStore.clearAllData()'));
  assert(routerSource.includes("router.get('/collector-export'"));
  assert(routerSource.includes('buildCollectorExcelBuffer(payload, { reportDate })'));
  assert(routerSource.includes("express.raw({ type: 'application/octet-stream', limit: '20mb' })"));
  assert(routerSource.includes('parseWorkspaceExcelBuffer(req.body)'));
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
