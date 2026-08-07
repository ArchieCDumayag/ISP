const assert = require('assert/strict');

const { calculatePaymentBreakdownEndingBalance } = require('../backend/payment-breakdown-balance');
const { buildAutomaticReferralTarget } = require('../backend/payment-records');

const buildRecord = (referralDiscounts) => ({
  accountNumber: 'REFERRER-001',
  name: 'Rita Referrer',
  planName: 'Fiber 1000',
  planAmount: 1000,
  planType: 'prepaid',
  planCategory: 'prepaid',
  billingCycle: 'Every first of the month',
  activationDate: '2026-08-01',
  billDate: '2026-08-01',
  dueDate: '2026-08-01',
  referralDiscounts,
  history: [{
    id: 'august-bill',
    amount: 1000,
    date: '2026-08-01',
    recordedAt: '2026-08-01T00:00:00+08:00',
    kind: 'charge',
    type: 'charge',
    direction: 'debit',
    description: 'Monthly Recurring Charge'
  }]
});

const appliedReferral = {
  id: 'referral-test-1',
  referralId: 'referral-test-1',
  applicationId: 'application-1',
  appliedMonth: '2026-08',
  referredAccountNumber: 'REFERRED-001',
  referredName: 'Nico New Client',
  appliedAt: '2026-08-07T08:00:00.000Z',
  discountAmount: 500
};

const applied = calculatePaymentBreakdownEndingBalance(buildRecord([appliedReferral]));
const augustRow = applied.rows.find((row) => row.billingMonthKey === '2026-08');
assert(augustRow, 'Expected an August billing row');
assert.equal(augustRow.referral, 500);
assert.equal(augustRow.due, 500);
assert.equal(augustRow.referralDetails[0].referralId, 'referral-test-1');
assert.equal(augustRow.referralDetails[0].applicationId, 'application-1');

const unapplied = calculatePaymentBreakdownEndingBalance(buildRecord([{
  ...appliedReferral,
  applicationId: '',
  appliedMonth: ''
}]));
const unappliedAugustRow = unapplied.rows.find((row) => row.billingMonthKey === '2026-08');
assert.equal(unappliedAugustRow.referral, 0);
assert.equal(unappliedAugustRow.due, 1000);

const wrongMonth = calculatePaymentBreakdownEndingBalance(buildRecord([{
  ...appliedReferral,
  applicationId: 'application-july',
  appliedMonth: '2026-07'
}]));
const wrongMonthAugustRow = wrongMonth.rows.find((row) => row.billingMonthKey === '2026-08');
assert.equal(wrongMonthAugustRow.referral, 0);
assert.equal(wrongMonthAugustRow.due, 1000);

const queueTarget = buildAutomaticReferralTarget({
  accountNumber: 'REFERRER-001',
  planAmount: 1000,
  billingSummary: {
    rows: [
      {
        billingMonthKey: '2026-07',
        billDate: '2026-07-01',
        sourceType: 'monthly',
        paymentStatus: 'unpaid',
        planAmount: 1000,
        balanceAfterPayment: 1000,
        referral: 0,
        referralDetails: []
      },
      {
        billingMonthKey: '2026-08',
        billDate: '2026-08-01',
        sourceType: 'monthly',
        paymentStatus: 'unpaid',
        planAmount: 1000,
        balanceAfterPayment: 500,
        referral: 500,
        referralDetails: [{ applicationId: 'application-1', amount: 500 }]
      }
    ]
  }
});
assert.deepEqual(queueTarget, {
  referrerAccountNumber: 'REFERRER-001',
  billingMonth: '2026-08',
  referralCapacity: 1000
});

const noRetroactiveTarget = buildAutomaticReferralTarget({
  accountNumber: 'REFERRER-001',
  planAmount: 1000,
  billingSummary: {
    rows: [
      {
        billingMonthKey: '2026-07',
        billDate: '2026-07-01',
        sourceType: 'monthly',
        paymentStatus: 'unpaid',
        planAmount: 1000,
        balanceAfterPayment: 1000
      },
      {
        billingMonthKey: '2026-08',
        billDate: '2026-08-01',
        sourceType: 'monthly',
        paymentStatus: 'paid',
        planAmount: 1000,
        balanceAfterPayment: 0
      }
    ]
  }
});
assert.equal(noRetroactiveTarget, null);

console.log('PASS approved referrals need only an exact-month audited application, not a referred-client payment');
