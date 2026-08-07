const assert = require('assert/strict');

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeMonthKey = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
};
const normalizeActor = (actor = null) => actor && typeof actor === 'object'
  ? {
      id: actor.id || null,
      username: String(actor.username || '').trim(),
      name: String(actor.name || actor.username || '').trim()
    }
  : null;

const customers = [{
  accountNumber: 'REFERRER-001',
  firstName: 'Rita',
  lastName: 'Referrer',
  planName: 'Fiber 1000',
  planAmount: 1000,
  activationDate: '2026-01-01'
}];

let registry = Array.from({ length: 5 }, (_, index) => {
  const sequence = index + 1;
  const referredAccountNumber = `REFERRED-00${sequence}`;
  customers.push({
    accountNumber: referredAccountNumber,
    firstName: `Client ${sequence}`,
    planName: 'Fiber 800',
    planAmount: 800,
    activationDate: '2026-08-01'
  });
  return {
    id: `referral-${sequence}`,
    sourceType: 'customer',
    referrerAccountNumber: 'REFERRER-001',
    referrerName: 'Rita Referrer',
    referredAccountNumber,
    approvalStatus: 'approved',
    approvalReason: 'Approved by Admin',
    approvedDiscountAmount: 500,
    approvedAt: `2026-08-0${sequence}T08:00:00.000Z`,
    applyFromMonth: sequence === 5 ? '2026-09' : '',
    createdAt: `2026-08-0${sequence}T07:00:00.000Z`,
    updatedAt: `2026-08-0${sequence}T08:00:00.000Z`,
    applications: [],
    audit: []
  };
});

const customerModulePath = require.resolve('../backend/customers');
const referralStorePath = require.resolve('../backend/referral-store');
const accountsStorePath = require.resolve('../../admin/backend/accounts-store');
const referralsModulePath = require.resolve('../backend/referrals');

require.cache[customerModulePath] = {
  id: customerModulePath,
  filename: customerModulePath,
  loaded: true,
  exports: {
    readVisibleCustomers: async () => clone(customers),
    readPayments: async () => ({})
  }
};
require.cache[accountsStorePath] = {
  id: accountsStorePath,
  filename: accountsStorePath,
  loaded: true,
  exports: { loadAccounts: async () => [] }
};
require.cache[referralStorePath] = {
  id: referralStorePath,
  filename: referralStorePath,
  loaded: true,
  exports: {
    readReferralRegistry: async () => clone(registry),
    normalizeActor,
    normalizeMonthKey,
    mutateReferralRegistry: async (_branchId, mutator) => {
      const working = clone(registry);
      const mutation = await mutator(working);
      if (mutation?.changed !== false) registry = clone(mutation?.records || working);
      return mutation?.result;
    }
  }
};
delete require.cache[referralsModulePath];
const referrals = require(referralsModulePath);

const target = (billingMonth) => ({
  referrerAccountNumber: 'REFERRER-001',
  billingMonth,
  referralCapacity: 1000
});
const activeForMonth = (billingMonth) => registry.flatMap((record) => (
  record.applications.filter((application) => (
    application.status === 'applied' && application.billingMonth === billingMonth
  )).map((application) => ({ referralId: record.id, ...application }))
));

(async () => {
  await referrals.setReferralApplyFromMonth({
    branchId: 'branch-1',
    referralId: 'referral-5',
    applyFromMonth: '2026-10',
    reason: 'Admin selected a later billing month',
    user: { id: 'admin-1', username: 'admin', name: 'Admin' },
    now: new Date('2026-08-07T08:00:00.000Z')
  });
  const scheduledReferral = registry.find((record) => record.id === 'referral-5');
  assert.equal(scheduledReferral.applyFromMonth, '2026-10');
  assert.match(scheduledReferral.audit.at(-1).reason, /2026-09 -> 2026-10/);
  await assert.rejects(
    referrals.setReferralApplyFromMonth({
      branchId: 'branch-1',
      referralId: 'referral-5',
      applyFromMonth: '2026-07',
      reason: 'Invalid past selection',
      user: { id: 'admin-1', username: 'admin', name: 'Admin' },
      now: new Date('2026-08-07T08:00:00.000Z')
    }),
    (error) => error?.status === 400
  );

  const august = await referrals.allocateQueuedReferralDiscounts({
    branchId: 'branch-1',
    billingTargets: [target('2026-08')]
  });
  assert.equal(august.changed, true);
  assert.deepEqual(activeForMonth('2026-08').map((entry) => entry.referralId), [
    'referral-1',
    'referral-2'
  ]);
  await assert.rejects(
    referrals.setReferralApplyFromMonth({
      branchId: 'branch-1',
      referralId: 'referral-2',
      applyFromMonth: '2026-10',
      reason: 'Attempt to move an applied discount',
      user: { id: 'admin-1', username: 'admin', name: 'Admin' },
      now: new Date('2026-08-07T08:00:00.000Z')
    }),
    (error) => error?.status === 409
  );

  const augustRepeat = await referrals.allocateQueuedReferralDiscounts({
    branchId: 'branch-1',
    billingTargets: [target('2026-08')]
  });
  assert.equal(augustRepeat.changed, false);
  assert.equal(activeForMonth('2026-08').length, 2);

  await referrals.applyReferralDiscount({
    branchId: 'branch-1',
    referrerAccountNumber: 'REFERRER-001',
    referralId: 'referral-1',
    billingMonth: '2026-08',
    action: 'reverse',
    reason: 'Admin correction',
    user: { id: 'admin-1', username: 'admin', name: 'Admin' }
  });

  await referrals.allocateQueuedReferralDiscounts({
    branchId: 'branch-1',
    billingTargets: [target('2026-08')]
  });
  assert.deepEqual(activeForMonth('2026-08').map((entry) => entry.referralId), [
    'referral-2',
    'referral-3'
  ]);

  await referrals.allocateQueuedReferralDiscounts({
    branchId: 'branch-1',
    billingTargets: [target('2026-09')]
  });
  assert.deepEqual(activeForMonth('2026-09').map((entry) => entry.referralId), [
    'referral-1',
    'referral-4'
  ]);
  assert.equal(activeForMonth('2026-09').some((entry) => entry.referralId === 'referral-5'), false);

  await referrals.allocateQueuedReferralDiscounts({
    branchId: 'branch-1',
    billingTargets: [target('2026-10')]
  });
  assert.deepEqual(activeForMonth('2026-10').map((entry) => entry.referralId), ['referral-5']);
  assert(activeForMonth('2026-08').every((entry) => entry.automatic === true));
  assert(activeForMonth('2026-09').every((entry) => entry.automatic === true));
  assert(activeForMonth('2026-10').every((entry) => entry.automatic === true));

  console.log('PASS Admin Apply From Month defers FIFO allocation while two-per-month carryover remains automatic');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
