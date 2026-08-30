const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeDraftPayload,
  applyFirstBillDefaults,
  computeFirstBillCollection,
  applyReferralDefaults,
  computeFirstBillProration,
  preserveInstallationCompletion,
  listAllCustomerDraftSubmissions,
  withDraftSubmissionLock,
  draftSubmissionFingerprint,
  selectRecoverableOwnedInProgressDraft,
  buildDraftDuplicateConflict
} = require('../backend/customer-draft-submissions');

test('technician onboarding keeps structured identity, address, payment, and referral input', () => {
  const draft = normalizeDraftPayload({
    firstName: 'Ana',
    middleName: 'Reyes',
    lastName: 'Santos',
    street: 'House 12',
    province: 'Cagayan',
    provinceCode: '015',
    municipality: 'Baggao',
    municipalityCode: '01506',
    barangay: 'San Jose',
    barangayCode: '01506001',
    serviceAddress: 'House 12, San Jose, Baggao, Cagayan',
    facebookAccount: 'ana.santos',
    facebookConfirmed: true,
    firstBillPaid: true,
    firstBillAmountReceived: 500,
    referralCustomerAccountNumber: '100000001',
    referralCustomerName: 'Existing Customer'
  });
  assert.equal(draft.name, 'Ana Reyes Santos');
  assert.equal(draft.middleName, 'Reyes');
  assert.equal(draft.provinceCode, '015');
  assert.equal(draft.municipalityCode, '01506');
  assert.equal(draft.barangayCode, '01506001');
  assert.equal(draft.serviceAddress, 'House 12, San Jose, Baggao, Cagayan');
  assert.equal(draft.facebookAccount, 'ana.santos');
  assert.equal(draft.facebookConfirmed, true);
  assert.equal(draft.firstBillPaid, true);
  assert.equal(draft.firstBillAmountReceived, 500);
  assert.equal(draft.referralCustomerAccountNumber, '100000001');
});

test('postpaid technician first bill is recomputed server-side through month end', () => {
  const proration = computeFirstBillProration('2026-08-24', 1000);
  assert.deepEqual(proration, {
    periodStart: '2026-08-24',
    periodEnd: '2026-08-31',
    activeDays: 8,
    daysInMonth: 31,
    amount: 258
  });
  const draft = applyFirstBillDefaults({
    planCategory: 'postpaid',
    planAmount: 1000,
    activationDate: '2026-08-24',
    billDate: '2030-01-01',
    firstBillProratedAmount: 1,
    firstBillPaid: true
  });
  assert.equal(draft.billDate, '2026-08-31');
  assert.equal(draft.dueDate, '2026-08-31');
  assert.equal(draft.firstBillProratedAmount, 258);
  assert.equal(draft.firstBillAmountReceived, 258);
  assert.equal(draft.firstBillAppliedAmount, 258);
  assert.equal(draft.firstBillBalanceDue, 0);
  assert.equal(draft.firstBillAdvanceCredit, 0);
  assert.equal(draft.firstBillPaymentStatus, 'paid');
  assert.equal(draft.firstBillPaid, true);
});

test('technician first-bill collection supports partial and advance amounts', () => {
  assert.deepEqual(computeFirstBillCollection(161, 100), {
    firstBillAmountReceived: 100,
    firstBillAppliedAmount: 100,
    firstBillBalanceDue: 61,
    firstBillAdvanceCredit: 0,
    firstBillPaymentStatus: 'partially_paid',
    firstBillPaid: false
  });
  assert.deepEqual(computeFirstBillCollection(161, 500), {
    firstBillAmountReceived: 500,
    firstBillAppliedAmount: 161,
    firstBillBalanceDue: 0,
    firstBillAdvanceCredit: 339,
    firstBillPaymentStatus: 'paid_with_advance',
    firstBillPaid: true
  });

  const advanceDraft = applyFirstBillDefaults({
    planCategory: 'postpaid',
    planAmount: 1000,
    activationDate: '2026-08-27',
    firstBillAmountReceived: 500,
    firstBillPaid: false
  });
  assert.equal(advanceDraft.firstBillProratedAmount, 161);
  assert.equal(advanceDraft.firstBillAdvanceCredit, 339);
  assert.equal(advanceDraft.firstBillPaymentStatus, 'paid_with_advance');
  assert.equal(advanceDraft.firstBillPaid, true);
});

test('technician first-bill collection rejects invalid amounts', () => {
  assert.throws(
    () => normalizeDraftPayload({ firstBillAmountReceived: -1 }),
    /between PHP 0 and PHP 10,000,000/
  );
  assert.throws(
    () => normalizeDraftPayload({ firstBillAmountReceived: 10000000.01 }),
    /between PHP 0 and PHP 10,000,000/
  );
});

test('legacy paid-checkbox fingerprints match the equivalent exact amount', () => {
  const legacy = {
    firstBillPaid: true,
    firstBillProratedAmount: 258
  };
  const current = {
    ...legacy,
    firstBillAmountReceived: 258,
    firstBillAppliedAmount: 258,
    firstBillBalanceDue: 0,
    firstBillAdvanceCredit: 0,
    firstBillPaymentStatus: 'paid'
  };
  assert.equal(draftSubmissionFingerprint(legacy), draftSubmissionFingerprint(current));
});

test('referral selection is resolved from the branch customer list', () => {
  const resolved = applyReferralDefaults({
    referralCustomerAccountNumber: '100000001',
    referralCustomerName: 'Untrusted Name'
  }, [{ accountNumber: '100000001', name: 'Canonical Customer' }]);
  assert.equal(resolved.referralSourceType, 'customer');
  assert.equal(resolved.referralCustomerName, 'Canonical Customer');
  assert.equal(resolved.referredBy, 'Canonical Customer');
  assert.throws(
    () => applyReferralDefaults({ referralCustomerAccountNumber: 'missing' }, []),
    /no longer exists/i
  );
});

test('technician draft normalizes paired GPS coordinates and metadata', () => {
  const draft = normalizeDraftPayload({
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    latitude: 17.9667123,
    longitude: 121.7583456,
    gpsAccuracyMeters: 4.257,
    gpsCapturedAt: '2026-08-16T12:00:00+08:00',
    locationSource: 'gps',
    planName: 'Plan 999'
  });
  assert.equal(draft.mapPin, '17.966712, 121.758346');
  assert.equal(draft.latitude, 17.966712);
  assert.equal(draft.longitude, 121.758346);
  assert.equal(draft.gpsAccuracyMeters, 4.26);
  assert.equal(draft.gpsCapturedAt, '2026-08-16T04:00:00.000Z');
  assert.equal(draft.locationSource, 'gps');
});

test('technician draft keeps a stable submission event for safe retry', () => {
  const first = normalizeDraftPayload({
    clientEventId: 'install-event-1',
    name: 'Juan Dela Cruz',
    mobile: '09171234567',
    latitude: 17.9667,
    longitude: 121.7583,
    planName: 'Fiber 100'
  });
  const retry = normalizeDraftPayload({
    client_event_id: 'install-event-1',
    name: '  Juan   Dela Cruz ',
    mobile: '+639171234567',
    mapPin: '17.966700, 121.758300',
    planName: 'fiber 100'
  });
  assert.equal(first.clientEventId, 'install-event-1');
  assert.equal(retry.clientEventId, 'install-event-1');
  assert.equal(draftSubmissionFingerprint(first), draftSubmissionFingerprint(retry));
});

test('technician draft creation lock serializes same-branch duplicate checks and writes', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = withDraftSubmissionLock(7, async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
  });
  const second = withDraftSubmissionLock(7, async () => {
    order.push('second');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('technician draft rejects partial or invalid GPS input', () => {
  assert.throws(
    () => normalizeDraftPayload({ firstName: 'A', latitude: 17.9 }),
    /Both latitude and longitude/
  );
  assert.throws(
    () => normalizeDraftPayload({ firstName: 'A', latitude: 91, longitude: 121 }),
    /Map Pin must contain a valid latitude/
  );
  assert.throws(
    () => normalizeDraftPayload({ firstName: 'A', mapPin: 'not a coordinate' }),
    /Map Pin must contain a valid latitude/
  );
  const blank = normalizeDraftPayload({ firstName: 'A', latitude: '', longitude: null });
  assert.equal(blank.mapPin, '');
});

test('admin approval preserves trusted installation completion evidence', () => {
  const trustedCompletion = {
    clientEventId: 'install-complete-1',
    onuSerialNumber: ' onu 1001 ',
    opticalSignal: '-21.4 dBm',
    fingerprint: 'trusted-fingerprint',
    ponAssignment: { napCode: 'NP08', port: 3 }
  };
  const reviewed = preserveInstallationCompletion(
    normalizeDraftPayload({
      name: 'Juan Dela Cruz',
      mobile: '09171234567',
      planName: 'Fiber 100'
    }),
    { installationCompletion: trustedCompletion }
  );
  assert.deepEqual(reviewed.installationCompletion, trustedCompletion);
  assert.notEqual(reviewed.installationCompletion, trustedCompletion);
  assert.equal(reviewed.onuSerialNumber, 'ONU1001');

  const attemptedOverride = preserveInstallationCompletion(
    {
      name: 'Edited',
      onuSerialNumber: 'ADMIN-INJECTED-ONU',
      onu_serial_number: 'ADMIN-INJECTED-SNAKE',
      installationCompletion: { fingerprint: 'admin-override' }
    },
    { installationCompletion: trustedCompletion }
  );
  assert.equal(attemptedOverride.installationCompletion.fingerprint, 'trusted-fingerprint');
  assert.equal(attemptedOverride.onuSerialNumber, 'ONU1001');
  assert.equal(Object.hasOwn(attemptedOverride, 'onu_serial_number'), false);
});

test('draft retry fingerprint covers material installation and account fields', () => {
  const base = normalizeDraftPayload({
    clientEventId: 'event-2',
    name: 'Juan Dela Cruz',
    mobile: '09171234567',
    latitude: 17.9,
    longitude: 121.7,
    gpsAccuracyMeters: 5,
    planName: 'Fiber 100',
    planAmount: 999,
    loginUsername: 'juan',
    pppoeProfile: 'fiber-100'
  });
  const changed = { ...base, planAmount: 1299 };
  assert.notEqual(draftSubmissionFingerprint(base), draftSubmissionFingerprint(changed));
  assert.notEqual(
    draftSubmissionFingerprint(base),
    draftSubmissionFingerprint({ ...base, gpsAccuracyMeters: 25 })
  );
  assert.notEqual(
    draftSubmissionFingerprint(base),
    draftSubmissionFingerprint({ ...base, loginUsername: 'another-user' })
  );
  assert.notEqual(
    draftSubmissionFingerprint(base),
    draftSubmissionFingerprint({ ...base, firstBillAmountReceived: 500 })
  );
});

test('draft event and duplicate scans paginate beyond 200 rows', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: `draft-${index}` }));
  const calls = [];
  const result = await listAllCustomerDraftSubmissions(
    { branchId: 1, status: 'all' },
    async ({ limit, offset }) => {
      calls.push({ limit, offset });
      return {
        items: rows.slice(offset, offset + limit),
        pagination: { total: rows.length, limit, offset }
      };
    }
  );
  assert.equal(result.length, 205);
  assert.deepEqual(calls, [{ limit: 200, offset: 0 }, { limit: 200, offset: 200 }]);
});

test('same technician can recover one matching incomplete draft without bypassing real duplicates', () => {
  const ownedIncomplete = {
    type: 'pending-draft',
    id: 'cds-incomplete-1',
    accountNumber: '100000321',
    status: 'in-progress',
    submittedByUserId: 'tech-7'
  };
  assert.deepEqual(
    selectRecoverableOwnedInProgressDraft([ownedIncomplete], 'tech-7'),
    ownedIncomplete
  );
  assert.equal(selectRecoverableOwnedInProgressDraft([ownedIncomplete], 'tech-8'), null);
  assert.equal(selectRecoverableOwnedInProgressDraft([
    ownedIncomplete,
    { type: 'customer', accountNumber: '100000001', status: 'active' }
  ], 'tech-7'), null);
  assert.equal(selectRecoverableOwnedInProgressDraft([
    { ...ownedIncomplete, status: 'pending' }
  ], 'tech-7'), null);
  assert.match(buildDraftDuplicateConflict([ownedIncomplete]), /Incomplete drafts/i);
});

test('draft decisions serialize JSON and claim MySQL state before destructive cleanup', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/customer-draft-submissions.js'),
    'utf8'
  );
  const approve = source.slice(
    source.indexOf("adminRouter.post('/:id/approve'"),
    source.indexOf("adminRouter.post('/:id/reject'")
  );
  const reject = source.slice(
    source.indexOf("adminRouter.post('/:id/reject'"),
    source.indexOf("adminRouter.delete('/:id'")
  );
  const deletion = source.slice(
    source.indexOf('const deletePendingDraftSubmission = async'),
    source.indexOf('const validateDraftPayload')
  );
  assert.match(approve, /return await withDraftSubmissionLock/);
  assert.match(approve, /recordDraftFirstBillPayment/);
  assert.match(source, /advancePayment: collection\.firstBillAmountReceived/);
  assert.match(approve, /createPendingDraftReferral/);
  assert.equal((approve.match(/trustedOnuSerialNumber:\s*reviewedDraft\.onuSerialNumber/g) || []).length, 4);
  assert.match(reject, /return await withDraftSubmissionLock/);
  assert.match(reject, /FOR UPDATE/);
  assert.ok(reject.indexOf('await connection.commit()')
    < reject.lastIndexOf('cleanupRejectedOrDeletedDraftResources'));
  assert.match(deletion, /branchLockHeld/);
  assert.match(deletion, /\['in-progress', 'pending'\]\.includes\(deletableStatus\)/);
  assert.ok(deletion.indexOf('deleteCustomerDraftSubmissionRow')
    < deletion.indexOf('cleanupRejectedOrDeletedDraftResources'));
  assert.ok(deletion.indexOf('await connection.commit()')
    < deletion.lastIndexOf('cleanupRejectedOrDeletedDraftResources'));
});

test('Admin draft review explains partial payments and advance credit', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../web/js/customer-draft-queue.js'),
    'utf8'
  );
  assert.match(source, /firstBillAmountReceived/);
  assert.match(source, /partial first-bill payment/);
  assert.match(source, /becomes advance credit on approval/);
  assert.match(source, /loadReviewPonOptions/);
  assert.match(source, /selectedNapId/);
  assert.match(source, /technician request is available now but is not reserved/i);
});

test('Admin approval atomically finalizes the reviewed requested NAP port', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/customer-draft-submissions.js'),
    'utf8'
  );
  const approve = source.slice(
    source.indexOf("adminRouter.post('/:id/approve'"),
    source.indexOf("adminRouter.post('/:id/reject'")
  );
  assert.match(approve, /prepareDraftPonHoldForAdmin/);
  assert.match(approve, /finalizeDraftPonSelectionForAdmin/);
  assert.ok(approve.indexOf('prepareDraftPonHoldForAdmin')
    < approve.indexOf('createCustomerRecord'));
  assert.ok(approve.indexOf('finalizeDraftPonSelectionForAdmin')
    < approve.indexOf("status: 'approved'"));
  assert.match(source, /finalizeRequestedPonAssignment/);
  assert.match(source, /releasePonDraftHold/);
  assert.match(source, /adminRouter\.get\('\/:id\/pon-options'/);
});

test('technician submits customer, billing, GPS, requested port, and ONU in one draft request', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/customer-draft-submissions.js'),
    'utf8'
  );
  const technicianPost = source.slice(
    source.indexOf("technicianRouter.post('/'"),
    source.indexOf("adminRouter.get('/'")
  );
  assert.match(source, /const buildTechnicianCompletedDraft = async/);
  assert.match(source, /status:\s*'requested'/);
  assert.match(source, /availableAtSubmission/);
  assert.doesNotMatch(source.slice(
    source.indexOf('const buildTechnicianCompletedDraft = async'),
    source.indexOf('const listAllCustomerDraftSubmissions')
  ), /reservePonPort|submitPonReservationForAdmin/);
  assert.match(technicianPost, /buildTechnicianCompletedDraft/);
  assert.match(technicianPost, /selectRecoverableOwnedInProgressDraft/);
  assert.match(technicianPost, /updateCustomerDraftSubmissionDraftDataByAccountNumber/);
  assert.match(technicianPost, /recovered:\s*true/);
  assert.ok(technicianPost.indexOf("replay.rawStatus")
    < technicianPost.indexOf('clientEventId was already used for a different customer draft'));
  assert.match(technicianPost, /transitionToPending:\s*true/);
});
