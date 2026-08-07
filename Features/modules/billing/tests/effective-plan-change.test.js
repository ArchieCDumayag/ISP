const assert = require('assert/strict');

const {
  buildEffectivePlanChangeEntry,
  buildPaymentRecord
} = require('../backend/payment-records');

const billingPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const todayParts = billingPartsFormatter.formatToParts(new Date());
const currentYear = Number(todayParts.find((part) => part.type === 'year')?.value);
const currentMonth = Number(todayParts.find((part) => part.type === 'month')?.value);
const currentMonthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
const previousDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1, 12, 0, 0));
const previousMonthKey = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, '0')}`;

const charge = (id, amount, monthKey) => ({
  id,
  amount,
  date: `${monthKey}-01`,
  recordedAt: `${monthKey}-01T00:00:00+08:00`,
  kind: 'charge',
  type: 'charge',
  direction: 'debit',
  description: 'Monthly Recurring Charge'
});
const payment = (id, amount, monthKey) => ({
  id,
  amount,
  date: `${monthKey}-02`,
  recordedAt: `${monthKey}-02T08:00:00+08:00`,
  kind: 'payment',
  type: 'payment',
  direction: 'credit',
  paymentMethod: 'Cash'
});
const customer = {
  accountNumber: 'PLAN-HISTORY-TEST',
  firstName: 'Plan',
  lastName: 'History',
  status: 'active',
  planId: 'new-1500',
  planName: 'Plan 1500',
  planAmount: 1500,
  planCategory: 'prepaid',
  billingCycle: 'Every first of the month',
  activationDate: `${previousMonthKey}-01`,
  billDate: `${previousMonthKey}-01`,
  dueDate: `${currentMonthKey}-01`
};
const history = [
  charge('bill-previous', 1000, previousMonthKey),
  payment('payment-previous', 1000, previousMonthKey),
  charge('bill-current', 1000, currentMonthKey)
];

const upgrade = buildEffectivePlanChangeEntry({
  effectiveMonth: previousMonthKey,
  selectedPlan: {
    planId: 'new-1500',
    planName: 'Plan 1500',
    planAmount: 1500,
    planCategory: 'prepaid'
  },
  previousPlan: {
    planId: 'old-1000',
    planName: 'Plan 1000',
    planAmount: 1000,
    planCategory: 'prepaid'
  },
  rows: [
    { billingMonthKey: previousMonthKey, planAmount: 1000, paymentStatus: 'paid' },
    { billingMonthKey: currentMonthKey, planAmount: 1000, paymentStatus: 'unpaid' }
  ],
  changedBy: { id: 1, username: 'admin', name: 'Admin' },
  reason: 'Missed upgrade correction'
});

assert.equal(upgrade.billingEffectiveMonth, currentMonthKey);
assert.equal(upgrade.retroactiveAdjustment, 500);
assert.deepEqual(upgrade.protectedPaidMonths, [previousMonthKey]);
assert.equal(upgrade.previousPlan.planName, 'Plan 1000');

const upgradedRecord = buildPaymentRecord(
  customer,
  { [customer.accountNumber]: { history } },
  [],
  { global: { [customer.accountNumber]: { planChanges: [upgrade] } } }
);
const previousUpgradeRow = upgradedRecord.billingSummary.rows.find((row) => row.billingMonthKey === previousMonthKey);
const currentUpgradeRow = upgradedRecord.billingSummary.rows.find((row) => row.billingMonthKey === currentMonthKey);
assert.equal(previousUpgradeRow.planAmount, 1000, 'a finalized paid bill must retain its original amount');
assert.equal(previousUpgradeRow.planLabel, 'Plan 1000', 'a finalized paid bill must retain its original plan label');
assert.equal(currentUpgradeRow.planAmount, 1500, 'the first unpaid month must use the corrected plan');
assert.equal(currentUpgradeRow.planChangeAdjustment, 500, 'the paid-month difference must be a separate debit');
assert.equal(currentUpgradeRow.previousBalance, 500);
assert.equal(currentUpgradeRow.due, 2000);
assert.equal(upgradedRecord.planHistory[0].status, 'active');

const downgrade = buildEffectivePlanChangeEntry({
  effectiveMonth: previousMonthKey,
  selectedPlan: {
    planId: 'new-500',
    planName: 'Plan 500',
    planAmount: 500,
    planCategory: 'prepaid'
  },
  previousPlan: {
    planId: 'old-1000',
    planName: 'Plan 1000',
    planAmount: 1000,
    planCategory: 'prepaid'
  },
  rows: [
    { billingMonthKey: previousMonthKey, planAmount: 1000, paymentStatus: 'paid' },
    { billingMonthKey: currentMonthKey, planAmount: 1000, paymentStatus: 'unpaid' }
  ],
  reason: 'Missed downgrade correction'
});
assert.equal(downgrade.retroactiveAdjustment, -500);

const downgradedRecord = buildPaymentRecord(
  { ...customer, planId: 'new-500', planName: 'Plan 500', planAmount: 500 },
  { [customer.accountNumber]: { history } },
  [],
  { global: { [customer.accountNumber]: { planChanges: [downgrade] } } }
);
const currentDowngradeRow = downgradedRecord.billingSummary.rows.find((row) => row.billingMonthKey === currentMonthKey);
assert.equal(currentDowngradeRow.planAmount, 500);
assert.equal(currentDowngradeRow.planChangeAdjustment, -500, 'the paid-month difference must be a separate credit');
assert.equal(currentDowngradeRow.advance, 500);
assert.equal(currentDowngradeRow.due, 0);

assert.throws(() => buildEffectivePlanChangeEntry({
  effectiveMonth: currentMonthKey,
  selectedPlan: { planName: 'Postpaid 1500', planAmount: 1500, planCategory: 'postpaid' },
  previousPlan: { planName: 'Prepaid 1000', planAmount: 1000, planCategory: 'prepaid' },
  reason: 'Unsafe category switch'
}), /subscriber editor/i);

console.log('EFFECTIVE PLAN CHANGE TESTS PASSED');
