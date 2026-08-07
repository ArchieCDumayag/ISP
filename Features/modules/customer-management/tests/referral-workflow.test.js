const assert = require('assert/strict');

const {
  buildReferralDiscountMap,
  buildReferralLedger,
  buildReferralOptionMap,
  summarizeReferralLedger
} = require('../backend/referral-engine');

const customers = [
  {
    accountNumber: 'REFERRER-001',
    firstName: 'Rita',
    lastName: 'Referrer',
    planName: 'Fiber 1000',
    planAmount: 1000,
    activationDate: '2026-01-10'
  },
  {
    accountNumber: 'REFERRED-001',
    firstName: 'Nico',
    lastName: 'New Client',
    planName: 'Fiber 800',
    planAmount: 800,
    activationDate: '2026-05-15',
    billDate: '2026-06-01'
  }
];

const payments = {
  'REFERRED-001': {
    history: [
      {
        id: 'bill-1',
        amount: 800,
        date: '2026-06-01',
        kind: 'charge',
        direction: 'debit'
      },
      {
        id: 'payment-1',
        amount: 800,
        date: '2026-06-05',
        kind: 'payment',
        direction: 'credit'
      }
    ]
  }
};

const baseReferral = {
  id: 'referral-test-1',
  sourceType: 'customer',
  referrerAccountNumber: 'REFERRER-001',
  referrerName: 'Rita Referrer',
  referredAccountNumber: 'REFERRED-001',
  createdAt: '2026-05-15T08:00:00.000Z',
  applications: [],
  audit: []
};

const build = (overrides = {}) => buildReferralLedger({
  customers,
  payments,
  registry: [{ ...baseReferral, ...overrides }],
  now: new Date('2026-08-07T00:00:00.000Z')
});

const pendingLedger = build({ approvalStatus: 'pending' });
assert.equal(pendingLedger[0].eligibilityStatus, 'successful');
assert.equal(pendingLedger[0].status, 'pending');
assert.deepEqual(buildReferralDiscountMap(pendingLedger), {});
assert.deepEqual(buildReferralOptionMap(pendingLedger), {});

const eligibleLedger = build({ approvalStatus: 'approved' });
assert.equal(eligibleLedger[0].status, 'eligible');
assert.equal(eligibleLedger[0].discountAmount, 500);
assert.equal(buildReferralOptionMap(eligibleLedger)['REFERRER-001'][0].referralId, 'referral-test-1');
assert.deepEqual(buildReferralDiscountMap(eligibleLedger), {});

const approvedWithoutPayment = buildReferralLedger({
  customers,
  payments: {},
  registry: [{
    ...baseReferral,
    approvalStatus: 'approved',
    approvedDiscountAmount: 375,
    approvedAt: '2026-08-07T08:00:00.000Z',
    applyFromMonth: '2026-10'
  }],
  now: new Date('2026-08-07T09:00:00.000Z')
});
assert.equal(approvedWithoutPayment[0].eligibilityStatus, 'waiting-payment');
assert.equal(approvedWithoutPayment[0].status, 'eligible');
assert.equal(approvedWithoutPayment[0].discountAmount, 375);
assert.equal(approvedWithoutPayment[0].applyFromMonth, '2026-10');

const appliedLedger = build({
  approvalStatus: 'approved',
  applications: [{
    id: 'application-1',
    billingMonth: '2026-08',
    referrerAccountNumber: 'REFERRER-001',
    amount: 500,
    status: 'applied',
    appliedAt: '2026-08-01T08:00:00.000Z',
    applyReason: 'Approved August referral credit'
  }]
});
assert.equal(appliedLedger[0].status, 'applied');
const appliedMap = buildReferralDiscountMap(appliedLedger);
assert.equal(appliedMap['REFERRER-001'].length, 1);
assert.equal(appliedMap['REFERRER-001'][0].applicationId, 'application-1');
assert.equal(appliedMap['REFERRER-001'][0].appliedMonth, '2026-08');
assert.equal(appliedMap['REFERRER-001'][0].discountAmount, 500);
assert.equal(summarizeReferralLedger(appliedLedger).discountValue, 500);

const reversedLedger = build({
  approvalStatus: 'approved',
  applications: [{
    id: 'application-1',
    billingMonth: '2026-08',
    referrerAccountNumber: 'REFERRER-001',
    amount: 500,
    status: 'reversed',
    appliedAt: '2026-08-01T08:00:00.000Z',
    reversedAt: '2026-08-02T08:00:00.000Z'
  }]
});
assert.equal(reversedLedger[0].status, 'reversed');
assert.deepEqual(buildReferralDiscountMap(reversedLedger), {});
assert.equal(buildReferralOptionMap(reversedLedger)['REFERRER-001'][0].status, 'reversed');

console.log('PASS Admin approval immediately queues a locked referral discount without waiting for payment');
