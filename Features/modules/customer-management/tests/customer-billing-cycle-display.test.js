const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const customersPage = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'customers.html'),
  'utf8'
);

assert.equal(customersPage.includes('function resolvePrepaidCycleDisplay(customer = {})'), true);
assert.equal(customersPage.includes('paymentRecord?.paymentBreakdownEndingBalance'), true);
assert.equal(customersPage.includes('display: `Current:'), true);
assert.equal(customersPage.includes('meta: `Next:'), true);
assert.equal(customersPage.includes('const paymentRecordsPromise = loadPaymentRecords();'), true);
assert.equal(customersPage.includes('await paymentRecordsPromise;'), true);

const tableRenderStart = customersPage.indexOf('function renderCustomers(customers)');
const prepaidBranchStart = customersPage.indexOf("if (planCategory === 'prepaid')", tableRenderStart);
const postpaidBranchStart = customersPage.indexOf(
  '} else if (billDate && !isNaN(billDate)) {',
  prepaidBranchStart
);
assert.ok(tableRenderStart >= 0 && prepaidBranchStart > tableRenderStart && postpaidBranchStart > prepaidBranchStart);
const prepaidBranch = customersPage.slice(prepaidBranchStart, postpaidBranchStart);
assert.equal(prepaidBranch.includes('resolvePrepaidCycleDisplay(customer)'), true);
assert.equal(prepaidBranch.includes('customer.dueDate'), false);

assert.equal(customersPage.includes("billingCycleDisplay = 'Every last of the month';"), true);
assert.equal(customersPage.includes('billingCycleMeta = `Next due:'), true);

console.log('Customer Billing Cycle display tests passed.');
