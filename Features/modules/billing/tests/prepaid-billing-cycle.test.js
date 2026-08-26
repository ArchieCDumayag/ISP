const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const {
  calculatePaymentBreakdownEndingBalance
} = require('../backend/payment-breakdown-balance');
const {
  getEffectivePaymentEntries
} = require('../backend/payment-entry-normalizer');
const {
  resolvePrepaidScheduledBillDate
} = require('../backend/billing-scheduler');

const formatLocalDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')
].join('-');

const payment = (id, amount, recordedAt) => ({
  id,
  amount,
  date: recordedAt.slice(0, 10),
  recordedAt,
  kind: 'payment',
  type: 'payment',
  direction: 'credit'
});

const legacyRenewalCharge = (id, amount, recordedAt) => ({
  id,
  amount,
  date: recordedAt.slice(0, 10),
  recordedAt,
  kind: 'charge',
  type: 'charge',
  direction: 'debit',
  description: 'Prepaid renewal charge'
});

const monthlyCharge = (accountNumber, month, amount, recordedAt) => ({
  id: `bill-${accountNumber}-${month}`,
  amount,
  date: `${month}-01`,
  recordedAt,
  kind: 'charge',
  type: 'charge',
  direction: 'debit',
  description: 'Monthly Recurring Charge'
});

{
  const history = [
    payment('payment-1', 300, '2026-08-03T08:00:00+08:00'),
    legacyRenewalCharge('legacy-charge-1', 300, '2026-08-03T08:00:00+08:00')
  ];
  const effective = getEffectivePaymentEntries(history);
  assert.deepEqual(effective.map((entry) => entry.id), ['payment-1']);
}

{
  const record = {
    accountNumber: 'PREPAID-1',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planAmount: 800,
    billDate: '2026-08-01',
    dueDate: '2026-08-01',
    disconnection: {
      status: 'disconnected',
      disconnectedAt: '2026-08-31',
      billingPolicy: 'stop'
    },
    history: [
      payment('payment-1', 300, '2026-08-03T08:00:00+08:00'),
      legacyRenewalCharge('legacy-charge-1', 300, '2026-08-03T08:00:00+08:00'),
      payment('payment-2', 500, '2026-08-05T08:00:00+08:00'),
      legacyRenewalCharge('legacy-charge-2', 500, '2026-08-05T08:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].billDate.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(result.rows[0].due, 800);
  assert.equal(result.rows[0].amountPaid, 800);
  assert.equal(result.rows[0].balanceAfterPayment, 0);
}

{
  const accountNumber = 'PREPAID-2';
  const record = {
    accountNumber,
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planAmount: 800,
    billDate: '2026-08-01',
    history: [
      monthlyCharge(accountNumber, '2026-08', 800, '2026-08-01T00:00:00+08:00'),
      payment('payment-1', 1000, '2026-08-03T08:00:00+08:00'),
      payment('payment-2', 800, '2026-08-05T08:00:00+08:00'),
      monthlyCharge(accountNumber, '2026-09', 800, '2026-09-01T00:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amountPaid, 1800);
  assert.equal(result.rows[0].balanceAfterPayment, -1000);
  assert.equal(result.rows[1].advance, 1000);
  assert.equal(result.rows[1].balanceAfterPayment, -200);
}

{
  const record = {
    accountNumber: 'PREPAID-FIRST-PAYMENT',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planAmount: 1000,
    billDate: '2026-07-01',
    dueDate: '2026-08-01',
    activationDate: '2024-12-02',
    disconnection: {
      status: 'disconnected',
      disconnectedAt: '2026-08-31',
      billingPolicy: 'stop'
    },
    history: [
      payment('first-payment', 2000, '2026-08-06T12:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].billDate.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(result.rows[0].balanceAfterPayment, 1000);
  assert.equal(result.rows[1].billDate.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(result.rows[1].due, 2000);
  assert.equal(result.rows[1].amountPaid, 2000);
  assert.equal(result.rows[1].advance, 0);
  assert.equal(result.rows[1].balanceAfterPayment, 0);
  assert.equal(result.endingBalance, 0);
}

{
  const record = {
    accountNumber: 'PREPAID-STOPPED-SETTLEMENT',
    planCategory: 'prepaid',
    billingCycle: 'Every first of the month',
    planAmount: 1000,
    billDate: '2026-01-01',
    dueDate: '2026-07-01',
    activationDate: '2026-01-01',
    disconnection: {
      status: 'disconnected',
      disconnectedAt: '2026-07-24T10:07:49.193Z',
      billingPolicy: 'stop'
    },
    history: [
      payment('january-payment', 1000, '2026-01-02T08:00:00+08:00'),
      payment('april-payment', 2000, '2026-04-06T08:00:00+08:00'),
      payment('may-payment', 1000, '2026-05-18T08:00:00+08:00'),
      payment('post-stop-settlement', 3000, '2026-08-12T06:10:24+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  const lastRow = result.rows[result.rows.length - 1];
  assert.equal(result.rows.length, 7);
  assert.equal(lastRow.billDate.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(lastRow.due, 3000);
  assert.equal(lastRow.amountPaid, 3000);
  assert.equal(lastRow.paymentStatus, 'paid');
  assert.equal(lastRow.balanceAfterPayment, 0);
  assert.equal(lastRow.paymentDetails.length, 1);
  assert.equal(lastRow.paymentDetails[0].amount, 3000);
  assert.equal(result.endingBalance, 0);
}

{
  const record = {
    accountNumber: 'POSTPAID-1',
    planCategory: 'postpaid',
    billingCycle: 'Every last day of the month',
    planAmount: 800,
    billDate: '2026-08-31',
    history: [
      {
        ...monthlyCharge('POSTPAID-1', '2026-08', 800, '2026-08-31T00:00:00+08:00'),
        date: '2026-08-31'
      },
      payment('postpaid-payment', 800, '2026-08-05T08:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].billDate.toISOString().slice(0, 10), '2026-08-31');
  assert.equal(result.rows[0].amountPaid, 800);
  assert.equal(result.rows[0].balanceAfterPayment, 0);
}

{
  const record = {
    accountNumber: 'POSTPAID-ACTIVATION-CURRENT',
    planCategory: 'postpaid',
    billingCycle: 'Every last day of the month',
    planAmount: 800,
    activationDate: '2026-08-03',
    billDate: '2026-08-31',
    dueDate: '2026-08-31',
    history: [
      payment('postpaid-current-proration-payment', 748, '2026-08-05T08:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sourceType, 'activation-proration');
  assert.equal(result.rows[0].isProrated, true);
  assert.equal(result.rows[0].planAmount, 748);
  assert.equal(result.rows[0].amountPaid, 748);
  assert.equal(result.rows[0].paymentStatus, 'paid');
  assert.equal(result.endingBalance, 0);
}

{
  const record = {
    accountNumber: 'POSTPAID-ACTIVATION-LATE-PAYMENT',
    planCategory: 'postpaid',
    billingCycle: 'Every last day of the month',
    planAmount: 800,
    activationDate: '2026-07-30',
    billDate: '2026-07-31',
    dueDate: '2026-07-31',
    history: [
      payment('postpaid-late-proration-payment', 52, '2026-08-06T08:00:00+08:00')
    ]
  };
  const result = calculatePaymentBreakdownEndingBalance(record);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].billDate.toISOString().slice(0, 10), '2026-07-31');
  assert.equal(result.rows[0].sourceType, 'activation-proration');
  assert.equal(result.rows[0].planAmount, 52);
  assert.equal(result.rows[0].amountPaid, 52);
  assert.equal(result.rows[0].balanceAfterPayment, 0);
  assert.equal(result.rows[1].sourceType, 'pending-postpaid');
  assert.equal(result.rows[1].planAmount, 0);
  assert.equal(result.endingBalance, 0);
}

{
  const explicitCycle = resolvePrepaidScheduledBillDate({
    billDate: '2026-07-18',
    activationDate: '2026-06-12'
  }, new Date('2026-08-05T00:00:00Z'));
  assert.equal(formatLocalDate(explicitCycle), '2026-07-01');

  const activationAlignedCycle = resolvePrepaidScheduledBillDate({
    activationDate: '2026-07-18'
  }, new Date('2026-08-05T00:00:00Z'));
  assert.equal(formatLocalDate(activationAlignedCycle), '2026-08-01');
}

{
  const paymentsSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'payments.js'), 'utf8');
  assert.equal(paymentsSource.includes("description: 'Prepaid renewal charge'"), false);
  assert.equal(paymentsSource.includes('const queuePppoeEnableForCustomer ='), true);
  assert.equal(paymentsSource.includes('await enablePppoeForCustomer('), false);
}

{
  const paymentsPageSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'payments.js'), 'utf8');
  const breakdownPageSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'payment-breakdown.js'), 'utf8');
  assert.equal(paymentsPageSource.includes('billingCycleDisplay = `Current:'), true);
  assert.equal(paymentsPageSource.includes('billingCycleMeta = customer.billingSummary.nextCycleDate'), true);
  assert.equal(paymentsPageSource.includes('billingCycleMeta = `Paid through:'), false);
  assert.equal(paymentsPageSource.includes('function resetPaymentFormState()'), true);
  assert.equal(
    paymentsPageSource.includes('closeModal({ force: true, refreshPaymentBreakdown: true, resetForm: true });'),
    true
  );
  assert.equal(paymentsPageSource.includes('void loadPaymentRecords();'), true);
  assert.equal(breakdownPageSource.includes("setSubscriberText(subscriberInfo.billingCycleLabel, 'Current Cycle')"), true);
  assert.equal(breakdownPageSource.includes("setSubscriberText(subscriberInfo.dueDateLabel, 'Next Cycle')"), true);
}

console.log('Prepaid billing cycle tests passed.');
