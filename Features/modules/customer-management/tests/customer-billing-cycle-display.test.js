const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const customersPage = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'customers.html'),
  'utf8'
);

assert.equal(customersPage.includes('function resolvePrepaidCycleDisplay(customer = {})'), true);
assert.equal(customersPage.includes("resolveCanonicalCycleDisplay(customer, 'prepaid')"), true);
assert.equal(customersPage.includes("resolveCanonicalCycleDisplay(customer, 'postpaid')"), true);
assert.equal(customersPage.includes('paymentRecord?.paymentBreakdownEndingBalance'), false);
assert.equal(customersPage.includes('Number(billingSummary?.version) >= 2'), true);
assert.equal(customersPage.includes('billingSummary?.available === true'), true);
assert.equal(customersPage.includes('display: `Current:'), true);
assert.equal(customersPage.includes('meta: billingSummary.nextCycleDate'), true);
assert.equal(customersPage.includes('const paymentRecordsPromise = loadPaymentRecords();'), true);
assert.equal(customersPage.includes('await paymentRecordsPromise;'), true);

const tableRenderStart = customersPage.indexOf('function renderCustomers(customers)');
const prepaidBranchStart = customersPage.indexOf("if (planCategory === 'prepaid')", tableRenderStart);
const postpaidBranchStart = customersPage.indexOf(
  '} else {',
  prepaidBranchStart
);
assert.ok(tableRenderStart >= 0 && prepaidBranchStart > tableRenderStart && postpaidBranchStart > prepaidBranchStart);
const prepaidBranch = customersPage.slice(prepaidBranchStart, postpaidBranchStart);
assert.equal(prepaidBranch.includes('resolvePrepaidCycleDisplay(customer)'), true);
assert.equal(prepaidBranch.includes('customer.dueDate'), false);

const postpaidBranchEnd = customersPage.indexOf('const customerDataString', postpaidBranchStart);
const postpaidBranch = customersPage.slice(postpaidBranchStart, postpaidBranchEnd);
assert.equal(postpaidBranch.includes("resolveCanonicalCycleDisplay(customer, 'postpaid')"), true);
assert.equal(postpaidBranch.includes('canonicalPostpaidCycle.display'), true);
assert.equal(postpaidBranch.includes('canonicalPostpaidCycle.meta'), true);
assert.equal(postpaidBranch.includes('customer.dueDate'), false);

assert.equal(customersPage.includes("billingCycleDisplay = 'Every last of the month';"), false);
assert.equal(customersPage.includes('Canonical backend result required'), true);

console.log('Customer Billing Cycle display tests passed.');
