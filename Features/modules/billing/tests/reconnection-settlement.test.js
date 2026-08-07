#!/usr/bin/env node

const assert = require('assert');
const {
  activatePendingReconnectionSettlement,
  buildInstallmentSchedule,
  buildReconnectionSettlement,
  buildReconnectionSummary,
  calculateProration,
  isBillingDateSuppressedByReconnection,
  sanitizeReconnectionHistory
} = require('../backend/reconnection-settlement');
const { calculatePaymentBreakdownEndingBalance } = require('../backend/payment-breakdown-balance');

const baseOptions = {
  accountNumber: 'RECONNECT-001',
  disconnectedAt: '2026-06-05T08:00:00.000Z',
  effectiveDate: '2026-08-07',
  planType: 'postpaid',
  planId: 'postpaid-1000',
  planName: 'Postpaid 1000',
  planAmount: 1000,
  previousBalance: 2000,
  chargePolicy: 'prorated',
  activationPolicy: 'immediate',
  requiredPaymentAmount: 0,
  dueOffset: 0,
  reason: 'Approved reconnection settlement',
  changedBy: { id: 1, username: 'admin', name: 'Admin' },
  now: new Date('2026-08-07T08:00:00.000Z')
};

const proration = calculateProration({ effectiveDate: '2026-08-07', planAmount: 1000 });
assert.deepStrictEqual(proration, {
  amount: 806,
  periodStart: '2026-08-07',
  periodEnd: '2026-08-31'
});

const keepSettlement = buildReconnectionSettlement({
  ...baseOptions,
  balanceTreatment: 'keep'
});
assert.strictEqual(keepSettlement.nextRegularCycleDate, '2026-09-30');
assert.strictEqual(keepSettlement.prorationAmount, 806);
assert.strictEqual(isBillingDateSuppressedByReconnection(keepSettlement, '2026-06-30'), true);
assert.strictEqual(isBillingDateSuppressedByReconnection(keepSettlement, '2026-07-31'), true);
assert.strictEqual(isBillingDateSuppressedByReconnection(keepSettlement, '2026-08-31'), true);
assert.strictEqual(isBillingDateSuppressedByReconnection(keepSettlement, '2026-09-30'), false);

const baseRecord = {
  accountNumber: 'RECONNECT-001',
  status: 'active',
  planId: 'postpaid-1000',
  planName: 'Postpaid 1000',
  planAmount: 1000,
  planCategory: 'postpaid',
  planBilling: 'Every last day of the month',
  activationDate: '2026-05-01',
  billDate: '2026-09-30',
  dueDate: '2026-09-30',
  history: [{
    id: 'bill-before-disconnect',
    amount: 2000,
    date: '2026-05-31',
    recordedAt: '2026-05-31T12:00:00+08:00',
    kind: 'charge',
    type: 'charge',
    direction: 'debit',
    description: 'Previous disconnected balance'
  }]
};

const calculateFor = (settlement) => calculatePaymentBreakdownEndingBalance({
  ...baseRecord,
  billDate: settlement.nextRegularCycleDate,
  dueDate: settlement.nextDueDate,
  disconnection: {
    accountNumber: baseRecord.accountNumber,
    status: 'kept-active',
    billingPolicy: 'continue',
    reconnectionHistory: [settlement]
  }
});

const keepBreakdown = calculateFor(keepSettlement);
const keepRow = keepBreakdown.rows.find((row) => row.sourceType === 'reconnection-proration');
assert(keepRow, 'The reconnection marker row must be present.');
assert.strictEqual(keepRow.reconnectionPreviousBalance, 2000);
assert.strictEqual(keepRow.previousBalance, 2000);
assert.strictEqual(keepRow.planAmount, 806);
assert.strictEqual(keepRow.due, 2806);
assert.strictEqual(keepBreakdown.endingBalance, 2806);

const writeOffSettlement = buildReconnectionSettlement({
  ...baseOptions,
  balanceTreatment: 'write-off'
});
const writeOffBreakdown = calculateFor(writeOffSettlement);
const writeOffRow = writeOffBreakdown.rows.find((row) => row.sourceType === 'reconnection-proration');
assert.strictEqual(writeOffRow.reconnectionPreviousBalance, 2000);
assert.strictEqual(writeOffRow.reconnectionWriteOff, 2000);
assert.strictEqual(writeOffRow.previousBalance, 0);
assert.strictEqual(writeOffRow.due, 806);
assert.strictEqual(writeOffBreakdown.endingBalance, 806);

const installmentSettlement = buildReconnectionSettlement({
  ...baseOptions,
  balanceTreatment: 'installment',
  installmentMonths: 3
});
assert.deepStrictEqual(
  installmentSettlement.installmentSchedule.map((item) => item.amount),
  [666.67, 666.67, 666.66]
);
const installmentBreakdown = calculateFor(installmentSettlement);
const installmentRow = installmentBreakdown.rows.find((row) => row.sourceType === 'reconnection-proration');
assert.strictEqual(installmentRow.reconnectionDeferredBalance, 2000);
assert.strictEqual(installmentRow.reconnectionInstallment, 666.67);
assert.strictEqual(installmentRow.due, 1472.67);
assert.strictEqual(installmentBreakdown.endingBalance, 1472.67);

const nextCycleInstallment = buildReconnectionSettlement({
  ...baseOptions,
  balanceTreatment: 'installment',
  installmentMonths: 2,
  chargePolicy: 'next-cycle'
});
const nextCycleBreakdown = calculateFor(nextCycleInstallment);
const nextCycleMarker = nextCycleBreakdown.rows.find((row) => row.sourceType === 'reconnection-opening');
const pendingNextBill = nextCycleBreakdown.rows.find((row) => row.sourceType === 'pending-postpaid');
assert(nextCycleMarker, 'Next-cycle reconnection must retain a separate opening marker.');
assert(pendingNextBill, 'The next postpaid bill must remain a separate pending row.');
assert.strictEqual(nextCycleMarker.reconnectionDeferredBalance, 2000);
assert.strictEqual(nextCycleMarker.reconnectionInstallment, 0);
assert.strictEqual(pendingNextBill.reconnectionInstallment, 0, 'A future installment must not become due before bill generation.');
assert.strictEqual(nextCycleBreakdown.endingBalance, 0);

const schedule = buildInstallmentSchedule({ amount: 1000, months: 3, firstMonth: '2026-09' });
assert.deepStrictEqual(schedule, [
  { number: 1, monthKey: '2026-09', amount: 333.34 },
  { number: 2, monthKey: '2026-10', amount: 333.33 },
  { number: 3, monthKey: '2026-11', amount: 333.33 }
]);

const pendingHistory = sanitizeReconnectionHistory([{
  ...keepSettlement,
  activationPolicy: 'after-payment',
  requiredPaymentAmount: 1000,
  activatedAt: '',
  activationPayments: [
    { entryId: 'pay-1', amount: 400, recordedAt: '2026-08-07T09:00:00Z' },
    { entryId: 'pay-2', amount: 100, recordedAt: '2026-08-07T10:00:00Z' }
  ]
}]);
const pendingSummary = buildReconnectionSummary({ reconnectionHistory: pendingHistory });
assert.strictEqual(pendingSummary.pendingPayment, true);
assert.strictEqual(pendingSummary.paidTowardActivation, 500);
assert.strictEqual(pendingSummary.remainingActivationPayment, 500);
const pendingBreakdown = calculateFor(pendingHistory[0]);
assert.strictEqual(
  pendingBreakdown.rows.some((row) => String(row.sourceType || '').startsWith('reconnection-')),
  false,
  'A pending reconnection must not charge the subscriber before service activation.'
);

const delayedActivation = activatePendingReconnectionSettlement(pendingHistory[0], {
  effectiveDate: '2026-09-10',
  dueOffset: 5,
  activationPayments: [
    ...pendingHistory[0].activationPayments,
    { entryId: 'pay-3', amount: 500, recordedAt: '2026-09-10T02:00:00Z' }
  ],
  activatedBy: { id: 1, username: 'admin', name: 'Admin' },
  now: new Date('2026-09-10T02:00:00Z')
});
assert(delayedActivation, 'A pending settlement must activate from the actual service date.');
assert.strictEqual(delayedActivation.reconnectionId, pendingHistory[0].reconnectionId);
assert.strictEqual(delayedActivation.requestedAt, pendingHistory[0].requestedAt);
assert.strictEqual(delayedActivation.status, 'active');
assert.strictEqual(delayedActivation.effectiveDate, '2026-09-10');
assert.strictEqual(delayedActivation.prorationAmount, 700);
assert.strictEqual(delayedActivation.nextRegularCycleDate, '2026-10-31');
assert.strictEqual(delayedActivation.nextDueDate, '2026-11-05');
assert.strictEqual(delayedActivation.paidTowardActivation, 1000);

const activationPaymentHistory = [
  ...baseRecord.history,
  {
    id: 'pay-before-activation-1',
    amount: 400,
    date: '2026-08-07',
    recordedAt: '2026-08-07T09:00:00Z',
    kind: 'payment',
    direction: 'credit'
  },
  {
    id: 'pay-before-activation-2',
    amount: 600,
    date: '2026-09-10',
    recordedAt: '2026-09-10T02:00:00Z',
    kind: 'payment',
    direction: 'credit'
  }
];
const activateTreatmentForPayments = (balanceTreatment, installmentMonths = 0) => {
  const pending = buildReconnectionSettlement({
    ...baseOptions,
    balanceTreatment,
    installmentMonths,
    activationPolicy: 'after-payment',
    requiredPaymentAmount: 1000
  });
  return activatePendingReconnectionSettlement(pending, {
    effectiveDate: '2026-09-10',
    activationPayments: [
      { entryId: 'pay-before-activation-1', amount: 400, recordedAt: '2026-08-07T09:00:00Z' },
      { entryId: 'pay-before-activation-2', amount: 600, recordedAt: '2026-09-10T02:00:00Z' }
    ],
    now: new Date('2026-09-10T02:00:00Z')
  });
};
const calculateActivatedPayments = (settlement) => calculatePaymentBreakdownEndingBalance({
  ...baseRecord,
  billDate: settlement.nextRegularCycleDate,
  dueDate: settlement.nextDueDate,
  history: activationPaymentHistory,
  disconnection: {
    accountNumber: baseRecord.accountNumber,
    status: 'kept-active',
    billingPolicy: 'continue',
    reconnectionHistory: [settlement]
  }
});
const paidWriteOffBreakdown = calculateActivatedPayments(activateTreatmentForPayments('write-off'));
assert.strictEqual(paidWriteOffBreakdown.endingBalance, -300, 'New activation payments must remain as credit after the captured balance is written off.');
const paidInstallmentBreakdown = calculateActivatedPayments(activateTreatmentForPayments('installment', 2));
assert.strictEqual(paidInstallmentBreakdown.endingBalance, 700, 'Activation payments must reduce the exact deferred balance without being discarded.');

console.log('PASS reconnection cycle suppression, balance treatments, proration, installments, and activation summary');
