const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  buildPaymentRecord
} = require('../backend/payment-records');

const projectRoot = path.resolve(__dirname, '../../../..');
const datePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const todayParts = datePartsFormatter.formatToParts(new Date());
const currentYear = Number(todayParts.find((part) => part.type === 'year')?.value);
const currentMonth = Number(todayParts.find((part) => part.type === 'month')?.value);
const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
const monthEndDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
const monthEnd = `${monthKey}-${String(monthEndDay).padStart(2, '0')}`;
const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;
const nextMonthEndDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
const nextMonthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextMonthEndDay).padStart(2, '0')}`;

const charge = (id, amount, date) => ({
  id,
  amount,
  date,
  recordedAt: `${date}T00:00:00+08:00`,
  kind: 'charge',
  type: 'charge',
  direction: 'debit',
  description: 'Monthly Recurring Charge'
});
const payment = (id, amount, day) => ({
  id,
  amount,
  date: `${monthKey}-${String(day).padStart(2, '0')}`,
  recordedAt: `${monthKey}-${String(day).padStart(2, '0')}T08:00:00+08:00`,
  kind: 'payment',
  type: 'payment',
  direction: 'credit',
  paymentMethod: 'Cash'
});

{
  const accountNumber = 'CANONICAL-PREPAID';
  const record = buildPaymentRecord({
    accountNumber,
    firstName: 'Canonical',
    lastName: 'Prepaid',
    status: 'active',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planName: 'Prepaid 1000',
    planAmount: 1000,
    activationDate: `${monthKey}-01`,
    billDate: `${monthKey}-01`,
    dueDate: `${monthKey}-01`
  }, {
    [accountNumber]: {
      history: [
        charge('bill-current', 1000, `${monthKey}-01`),
        payment('payment-one', 600, 2),
        payment('payment-two', 400, 3)
      ]
    }
  });

  assert.equal(record.billingSummary.version, 2);
  assert.equal(record.billingSummary.source, 'payment-breakdown-backend');
  assert.equal(record.billingSummary.available, true);
  assert.equal(record.billingSummary.planType, 'prepaid');
  assert.equal(record.billingSummary.currentCycle.billDate, `${monthKey}-01`);
  assert.equal(record.billingSummary.currentCycle.amountPaid, 1000);
  assert.equal(record.billingSummary.currentCycle.balanceAfterPayment, 0);
  assert.equal(record.billingSummary.currentCycle.paymentStatus, 'paid');
  assert.equal(record.billingSummary.endingBalance, 0);
  assert.equal(record.billingSummary.billingStatus, 'paid');
  assert.equal(record.billingSummary.dueDate, `${monthKey}-01`);
  assert.equal(record.billingSummary.reconciliation.status, 'clean');
  assert.equal(record.endingBalance, record.billingSummary.endingBalance);
  assert.match(record.billingSummary.nextCycleDate, /^\d{4}-\d{2}-01$/);
  assert.equal(record.billingSummary.rows.length, 1, 'two payments in one month must remain one cycle row');
}

{
  const accountNumber = 'CANONICAL-PENDING-GCASH';
  const pendingEntry = {
    ...payment('pending-gcash-one', 1000, 4),
    paymentMethod: 'GCash',
    reference: 'ENTERED-REFERENCE',
    status: 'pending_gcash_verification',
    description: 'Pending GCash verification'
  };
  const record = buildPaymentRecord({
    accountNumber,
    firstName: 'Pending',
    lastName: 'GCash',
    status: 'active',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planName: 'Prepaid 1000',
    planAmount: 1000,
    activationDate: `${monthKey}-01`,
    billDate: `${monthKey}-01`,
    dueDate: `${monthKey}-01`
  }, {
    [accountNumber]: {
      history: [
        charge('pending-gcash-bill', 1000, `${monthKey}-01`),
        pendingEntry
      ]
    }
  });

  assert.equal(record.history.length, 2, 'pending GCash must remain visible in raw Payment History');
  assert.equal(record.totalCredits, 0, 'pending GCash must not count as collected');
  assert.equal(record.billingSummary.currentCycle.amountPaid, 0, 'pending GCash must not increase Amount Paid');
  assert.equal(record.billingSummary.currentCycle.balanceAfterPayment, 1000, 'pending GCash must not reduce the balance');
  assert.equal(record.billingSummary.currentCycle.paymentStatus, 'unpaid');
  assert.equal(record.billingSummary.endingBalance, 1000);
  assert.equal(record.billingSummary.pendingGcashPayments.length, 1);
  assert.equal(record.billingSummary.currentCycle.pendingPaymentDetails.length, 1);
  assert.equal(record.billingSummary.currentCycle.pendingPaymentDetails[0].statusLabel, 'Pending');
}

{
  const accountNumber = 'CANONICAL-POSTPAID';
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const previousMonthKey = `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
  const previousMonthEndDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  const previousMonthEnd = `${previousMonthKey}-${String(previousMonthEndDay).padStart(2, '0')}`;
  const record = buildPaymentRecord({
    accountNumber,
    firstName: 'Canonical',
    lastName: 'Postpaid',
    status: 'active',
    planCategory: 'postpaid',
    billingCycle: 'Every last day of the month',
    planName: 'Postpaid 1000',
    planAmount: 1000,
    activationDate: previousMonthEnd,
    billDate: previousMonthEnd,
    dueDate: previousMonthEnd
  }, {
    [accountNumber]: {
      history: [charge('bill-previous', 1000, previousMonthEnd)]
    }
  });

  const currentCycle = record.billingSummary.rows.find((row) => row.billDate === monthEnd);
  assert.ok(currentCycle, 'postpaid month-end cycle must remain represented');
  assert.equal(currentCycle.paymentStatus, 'not-generated');
  assert.equal(currentCycle.planAmount, 0, 'postpaid bill remains view-only before month end');
  assert.equal(record.billingSummary.nextCycleDate, nextMonthEnd);
  assert.equal(record.billingSummary.billingStatus, 'overdue');
  assert.equal(record.billingSummary.dueDate, previousMonthEnd);
  assert.equal(record.billingSummary.reconciliation.status, 'clean');
}

{
  const accountNumber = 'CANONICAL-POSTPAID-PRORATION';
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const previousMonthKey = `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
  const previousMonthEndDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  const activationDay = Math.max(2, previousMonthEndDay - 1);
  const activationDate = `${previousMonthKey}-${String(activationDay).padStart(2, '0')}`;
  const previousMonthEnd = `${previousMonthKey}-${String(previousMonthEndDay).padStart(2, '0')}`;
  const activeDays = previousMonthEndDay - activationDay + 1;
  const proratedAmount = Math.round((1000 / previousMonthEndDay) * activeDays);
  const record = buildPaymentRecord({
    accountNumber,
    firstName: 'Prorated',
    lastName: 'Postpaid',
    status: 'active',
    planCategory: 'postpaid',
    billingCycle: 'Every last day of the month',
    planName: 'Postpaid 1000',
    planAmount: 1000,
    activationDate,
    billDate: previousMonthEnd,
    dueDate: previousMonthEnd
  }, {
    [accountNumber]: {
      history: [payment('postpaid-proration-payment', proratedAmount, 2)]
    }
  });

  const activationCycle = record.billingSummary.rows.find((row) => row.billDate === previousMonthEnd);
  assert.ok(activationCycle, 'the stored activation cycle must not disappear when payment is recorded later');
  assert.equal(activationCycle.sourceType, 'activation-proration');
  assert.equal(activationCycle.isProrated, true);
  assert.equal(activationCycle.planAmount, proratedAmount);
  assert.equal(activationCycle.amountPaid, proratedAmount);
  assert.equal(activationCycle.paymentStatus, 'paid');
  assert.equal(activationCycle.balanceAfterPayment, 0);
  assert.equal(record.billingSummary.endingBalance, 0);
  assert.equal(record.billingSummary.advance, 0);
  assert.equal(record.billingSummary.billingStatus, 'paid');
  assert.equal(record.billingSummary.reconciliation.status, 'clean');
}

{
  const accountNumber = 'CANONICAL-DUPLICATE';
  const record = buildPaymentRecord({
    accountNumber,
    status: 'active',
    planCategory: 'prepaid',
    planAmount: 1000,
    activationDate: `${monthKey}-01`,
    billDate: `${monthKey}-01`,
    dueDate: `${monthKey}-01`
  }, {
    [accountNumber]: {
      history: [
        charge('duplicate-bill-one', 1000, `${monthKey}-01`),
        charge('duplicate-bill-two', 1000, `${monthKey}-01`)
      ]
    }
  });
  assert.equal(record.billingSummary.reconciliation.status, 'error');
  assert.ok(record.billingSummary.reconciliation.issues.some((issue) => issue.code === 'duplicate-cycle'));
}

{
  const accountNumber = 'CANONICAL-MISSING-CHARGE';
  const record = buildPaymentRecord({
    accountNumber,
    status: 'active',
    planCategory: 'prepaid',
    planAmount: 0,
    activationDate: `${monthKey}-01`,
    billDate: `${monthKey}-01`,
    dueDate: `${monthKey}-01`
  }, { [accountNumber]: { history: [] } });
  assert.equal(record.billingSummary.reconciliation.status, 'warning');
  assert.ok(record.billingSummary.reconciliation.issues.some((issue) => issue.code === 'missing-charge'));
}

const pageContracts = [
  ['Features/modules/billing/web/payments.js', 'readCanonicalBreakdownForPayments'],
  ['Features/modules/billing/web/js/payment-breakdown.js', 'readCanonicalBreakdown'],
  ['Features/modules/customer-management/web/customers.html', 'billingSummary?.currentCycle'],
  ['Features/modules/billing/web/js/payment-history.js', "fetchJSON('/api/payment-records')"]
];

pageContracts.forEach(([relativePath, expectedSource]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert.ok(source.includes(expectedSource), `${relativePath} must consume the canonical billing source`);
});

const paymentsPageSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/web/payments.js'),
  'utf8'
);
const breakdownPageSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/web/js/payment-breakdown.js'),
  'utf8'
);
const paymentRecordsSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/billing/backend/payment-records.js'),
  'utf8'
);
assert.equal(paymentsPageSource.includes('if (canonicalBreakdown) return canonicalBreakdown;'), false);
assert.equal(breakdownPageSource.includes('readCanonicalBreakdown(record) || buildBreakdownRows(record, customers)'), false);
assert.equal(paymentRecordsSource.includes("router.get('/reconciliation/report'"), true);

console.log('CANONICAL BILLING SUMMARY TESTS PASSED');
