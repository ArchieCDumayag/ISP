#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['expenses.js', 'expenses'],
  ['payroll.js', 'payroll']
];

const backend = loadModuleBackend('finance', { required: true, fresh: true });
assert.strictEqual(backend.id, 'finance');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/finance/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Finance backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Finance root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('finance', { required: true });
const webFiles = [
  'expenses.html',
  'payroll.html',
  'reports.js',
  'css/finance.css',
  'css/monthly-collection-trend.css',
  'css/reports.css',
  'js/expenses.js',
  'js/monthly-collection-trend.js',
  'js/payroll.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Finance web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Finance web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Finance web root (${webFiles.length} files)`);

const expenseRecord = require(path.join(
  projectRoot,
  'Features/modules/finance/backend/expense-record'
));
const createdExpense = expenseRecord.buildExpenseRecord({
  id: 'exp-contract-1',
  branchId: 3,
  input: {
    date: '2026-08-07',
    category: 'Equipment',
    vendor: 'Network Supply Co.',
    amount: 1250.5,
    paymentMethod: 'gcash',
    referenceNumber: 'GC-123',
    receiptUrl: '/receipts/gc-123.jpg',
    receiptName: 'gc-123.jpg',
    status: 'approved'
  },
  actor: { id: 9, username: 'admin.finance', name: 'Finance Admin' },
  now: '2026-08-07T08:00:00.000Z'
});
assert.strictEqual(createdExpense.schemaVersion, 1);
assert.strictEqual(createdExpense.branchId, 3);
assert.strictEqual(createdExpense.vendor, 'Network Supply Co.');
assert.strictEqual(createdExpense.payee, 'Network Supply Co.');
assert.strictEqual(createdExpense.paymentMethod, 'gcash');
assert.strictEqual(createdExpense.status, 'approved');
assert.strictEqual(createdExpense.createdBy, 'admin.finance');
assert.strictEqual(createdExpense.updatedBy, 'admin.finance');
assert.strictEqual(createdExpense.approvedBy, 'admin.finance');
assert.strictEqual(createdExpense.approvedAt, '2026-08-07T08:00:00.000Z');

const pendingExpense = expenseRecord.buildExpenseRecord({
  id: createdExpense.id,
  branchId: 3,
  input: { status: 'pending', amount: 1300 },
  current: createdExpense,
  actor: { id: 10, username: 'admin.reviewer', name: 'Review Admin' },
  now: '2026-08-07T09:00:00.000Z'
});
assert.strictEqual(pendingExpense.createdAt, createdExpense.createdAt);
assert.strictEqual(pendingExpense.createdBy, createdExpense.createdBy);
assert.strictEqual(pendingExpense.updatedBy, 'admin.reviewer');
assert.strictEqual(pendingExpense.status, 'pending');
assert.strictEqual(pendingExpense.approvedAt, '');
assert.strictEqual(pendingExpense.approvedBy, '');

const legacyExpense = expenseRecord.mapExpenseRecord({
  id: 'legacy-expense',
  date: '2026-07-01',
  category: 'Utilities',
  payee: 'Electric Company',
  amount: 900
}, { branchId: 3 });
assert.strictEqual(legacyExpense.vendor, 'Electric Company');
assert.strictEqual(legacyExpense.payee, 'Electric Company');
assert.strictEqual(legacyExpense.paymentMethod, 'other');
assert.strictEqual(legacyExpense.status, 'paid');
assert.throws(() => expenseRecord.buildExpenseRecord({
  id: 'invalid-expense',
  branchId: 3,
  input: { date: '2026-08-07', category: 'Equipment', amount: 100 },
  actor: { id: 9 }
}), /Vendor \/ payee is required/);
assert.throws(() => expenseRecord.buildExpenseRecord({
  id: 'invalid-status-expense',
  branchId: 3,
  input: {
    date: '2026-08-07',
    category: 'Equipment',
    vendor: 'Network Supply Co.',
    amount: 100,
    status: 'unknown-status'
  },
  actor: { id: 9 }
}), /Expense status is invalid/);
console.log('PASS standardized expense record, audit, approval, and legacy defaults');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('finance')"));
assert(serverSource.includes("financeBackend.load('expenses')"));
assert(serverSource.includes("financeBackend.load('payroll')"));
assert(serverSource.includes('FINANCE_WEB_ROOT'));
assert(serverSource.includes("app.get('/api/dashboard/collection-breakdown', requireAuth"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'expenses.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'payroll.html')"));
console.log('PASS Finance server loader, page routing, and shared dashboard contract');

const sourceChecks = [
  ['Features/modules/finance/backend/expenses.js', '../../../../core/data/data-store'],
  ['Features/modules/finance/backend/expenses.js', '../../../../core/data/db-relational'],
  ['Features/modules/finance/backend/expenses.js', '../../../../core/security/role-utils'],
  ['Features/modules/finance/backend/expenses.js', './expense-record'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/data/data-store'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/data/db'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/security/role-utils'],
  ['Features/modules/finance/backend/payroll.js', '../../../../core/config/storage-mode']
];
sourceChecks.forEach(([relativePath, expectedPath]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expectedPath), `${relativePath} must use canonical dependency ${expectedPath}`);
});
console.log('PASS canonical Core data, security, and configuration dependencies');

const schemaSource = fs.readFileSync(path.join(projectRoot, 'scripts/schema.sql'), 'utf8');
[
  'payee VARCHAR(160)',
  'vendor VARCHAR(160)',
  'payment_method VARCHAR(30)',
  'reference_number VARCHAR(120)',
  'receipt_url VARCHAR(500)',
  'status VARCHAR(30)',
  'updated_by_user_id VARCHAR(32)',
  'approved_by_user_id VARCHAR(32)',
  'idx_fin_exp_branch_status'
].forEach((contract) => {
  assert(schemaSource.includes(contract), `Finance schema must include ${contract}`);
});
const migrationSource = fs.readFileSync(path.join(projectRoot, 'scripts/migrate-json-to-schema.js'), 'utf8');
assert(migrationSource.includes('async function ensureFinanceExpenseColumns()'));
assert(migrationSource.includes('await ensureFinanceExpenseColumns();'));

const expensesHtml = fs.readFileSync(path.join(webRoot, 'expenses.html'), 'utf8');
[
  'id="expenseVendor"',
  'id="expensePaymentMethod"',
  'id="expenseReferenceNumber"',
  'id="expenseStatus"',
  'id="expenseReceiptUrl"'
].forEach((contract) => {
  assert(expensesHtml.includes(contract), `Expenses form must include ${contract}`);
});
const expensesClientSource = fs.readFileSync(path.join(webRoot, 'js/expenses.js'), 'utf8');
assert(expensesClientSource.includes('vendor: vendorInput.value'));
assert(expensesClientSource.includes('paymentMethod: paymentMethodInput.value'));
assert(expensesClientSource.includes('status: statusInput.value'));
console.log('PASS expense schema migration and admin form contracts');

const routeContracts = (router) => router.stack
  .filter((layer) => layer.route)
  .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

assert.deepStrictEqual(routeContracts(backend.load('expenses')), [
  'GET /',
  'POST /',
  'PUT /:id',
  'DELETE /',
  'DELETE /:id'
]);
assert.deepStrictEqual(routeContracts(backend.load('payroll')), [
  'GET /',
  'POST /',
  'PUT /:id',
  'DELETE /:id'
]);

const reportsSource = fs.readFileSync(path.join(webRoot, 'reports.js'), 'utf8');
assert(reportsSource.includes("fetch('/api/payment-records'"));
assert(reportsSource.includes("fetch('/api/collectors'"));
const trendSource = fs.readFileSync(path.join(webRoot, 'js/monthly-collection-trend.js'), 'utf8');
assert(trendSource.includes("getElementById('monthlyTrendChart')"));
console.log('PASS expense, payroll, and reporting route/asset contracts');
console.log('FINANCE COMPATIBILITY PASSED');
