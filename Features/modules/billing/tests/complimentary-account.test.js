#!/usr/bin/env node

const assert = require('assert');
const {
  buildComplimentaryAccountSummary,
  isComplimentaryMonth,
  sanitizeComplimentaryPeriods
} = require('../backend/complimentary-account');
const { calculatePaymentBreakdownEndingBalance } = require('../backend/payment-breakdown-balance');
const paymentRecords = require('../backend/payment-records');
const { buildReminderCandidates } = require('../../customer-app/backend/messenger-reminders');

const currentMonth = '2026-08';
const baseCustomer = {
  accountNumber: 'FREE-001',
  firstName: 'Free',
  lastName: 'Subscriber',
  status: 'active',
  planId: 'prepaid-1000',
  planName: 'Prepaid 1000',
  planAmount: 1000,
  planCategory: 'prepaid',
  planBilling: 'Every 1st of the month',
  activationDate: '2026-07-01',
  billDate: '2026-08-01',
  dueDate: '2026-08-01'
};
const paymentHistory = [{
  id: 'bill-free-001-2026-07',
  amount: 1000,
  date: '2026-07-01',
  kind: 'charge',
  type: 'charge',
  direction: 'debit',
  description: 'Monthly Recurring Charge'
}];

const keepPeriod = sanitizeComplimentaryPeriods([{
  periodId: 'complimentary-keep',
  effectiveMonth: currentMonth,
  balanceTreatment: 'keep',
  reason: 'Company-sponsored service',
  changedBy: { id: 1, username: 'admin', name: 'Admin' }
}]);
assert.strictEqual(keepPeriod.length, 1);
assert.strictEqual(isComplimentaryMonth(keepPeriod, currentMonth), true);
assert.strictEqual(isComplimentaryMonth(keepPeriod, '2026-07'), false);
const activeSummary = buildComplimentaryAccountSummary(keepPeriod, {
  currentMonth,
  planType: 'prepaid'
});
assert.strictEqual(activeSummary.active, true);
assert.strictEqual(activeSummary.billingSuppressed, true);
assert.strictEqual(activeSummary.nextBillableCycleDate, null);

const keepBreakdown = calculatePaymentBreakdownEndingBalance({
  ...baseCustomer,
  history: paymentHistory,
  paymentBreakdownAdjustment: { complimentaryPeriods: keepPeriod }
});
assert.strictEqual(keepBreakdown.endingBalance, 1000, 'Keep must preserve an older unpaid balance.');
assert.strictEqual(keepBreakdown.rows.at(-1).sourceType, 'complimentary');
assert.strictEqual(keepBreakdown.rows.at(-1).planAmount, 0, 'A complimentary month must not create a recurring charge.');
assert.strictEqual(keepBreakdown.rows.at(-1).paymentStatus, 'complimentary');

const writeOffPeriod = sanitizeComplimentaryPeriods([{
  ...keepPeriod[0],
  periodId: 'complimentary-write-off',
  balanceTreatment: 'write-off',
  writeOffAmount: 1000
}]);
const writeOffBreakdown = calculatePaymentBreakdownEndingBalance({
  ...baseCustomer,
  history: paymentHistory,
  paymentBreakdownAdjustment: { complimentaryPeriods: writeOffPeriod }
});
assert.strictEqual(writeOffBreakdown.endingBalance, 0, 'Write-off must clear the captured balance without creating advance.');
assert.strictEqual(writeOffBreakdown.rows.at(-1).complimentaryWriteOff, 1000);
assert.strictEqual(writeOffBreakdown.rows.at(-1).balanceAfterPayment, 0);

const adjustments = {
  branch_a: {
    [baseCustomer.accountNumber]: {
      complimentaryPeriods: keepPeriod
    }
  }
};
const canonicalRecord = paymentRecords.buildPaymentRecord(
  baseCustomer,
  { [baseCustomer.accountNumber]: { history: paymentHistory } },
  [{ id: 'prepaid-1000', name: 'Prepaid 1000', price: 1000, category: 'prepaid' }],
  adjustments,
  'branch_a',
  {},
  {},
  {}
);
assert.strictEqual(canonicalRecord.complimentaryAccount.active, true);
assert.strictEqual(canonicalRecord.billingSummary.billingStatus, 'complimentary');
assert.strictEqual(canonicalRecord.billingSummary.dueDate, null);
assert.strictEqual(canonicalRecord.billingSummary.nextCycleDate, null);
assert.strictEqual(canonicalRecord.planName, 'Prepaid 1000', 'The actual subscriber plan must remain unchanged.');
assert.strictEqual(canonicalRecord.billingSummary.reconciliation.issues.some((issue) => issue.code === 'missing-charge'), false);
assert.deepStrictEqual(buildReminderCandidates({
  records: [canonicalRecord],
  branchId: 'branch_a',
  now: new Date('2026-08-01T12:00:00+08:00')
}), [], 'Complimentary accounts must not enter the billing reminder queue.');

const temporarySummary = buildComplimentaryAccountSummary([{
  periodId: 'temporary',
  effectiveMonth: '2026-08',
  endMonth: '2026-09',
  balanceTreatment: 'keep'
}], { currentMonth: '2026-08', planType: 'postpaid' });
assert.strictEqual(temporarySummary.nextBillableCycleDate, '2026-10-31');
assert.strictEqual(isComplimentaryMonth(temporarySummary.periods, '2026-09'), true);
assert.strictEqual(isComplimentaryMonth(temporarySummary.periods, '2026-10'), false);

const cancelledScheduled = sanitizeComplimentaryPeriods([{
  periodId: 'cancelled-scheduled',
  effectiveMonth: '2026-10',
  cancelledAt: '2026-08-07T00:00:00.000Z',
  cancelledFromMonth: '2026-10',
  endReason: 'Schedule cancelled before it started'
}]);
assert.strictEqual(isComplimentaryMonth(cancelledScheduled, '2026-10'), false);
assert.strictEqual(buildComplimentaryAccountSummary(cancelledScheduled, { currentMonth }).scheduledPeriod, null);

console.log('PASS complimentary account periods, kept balances, audited write-offs, and canonical Billing status');
