const test = require('node:test');
const assert = require('node:assert/strict');

const installationsRouter = require('../backend/technician-installations');

test('installation completion evidence is normalized and replay-safe', () => {
  const completion = installationsRouter.normalizeInstallationCompletion({
    clientEventId: 'install-event-1',
    onuSerialNumber: 'ONU-001',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    opticalSignal: '-18.4 dBm',
    cableLengthMeters: '42.5',
    materials: [{ name: 'Drop cable', quantity: 42.5, unit: 'm' }],
    notes: 'Speed test passed.'
  });
  assert.equal(completion.cableLengthMeters, 42.5);
  assert.equal(completion.materials[0].quantity, 42.5);
  const existing = {
    ...completion,
    fingerprint: installationsRouter.installationCompletionFingerprint(completion)
  };
  assert.equal(
    installationsRouter.assertInstallationCompletionReplay(existing, completion),
    true
  );
  assert.throws(
    () => installationsRouter.assertInstallationCompletionReplay(existing, {
      ...completion,
      notes: 'Different evidence'
    }),
    (error) => error.statusCode === 409 && /different evidence/.test(error.message)
  );
});

test('installation completion requires stable event, ONU, and optical signal', () => {
  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      clientEventId: 'install-event-2',
      onuSerialNumber: 'ONU-002'
    }),
    (error) => error.statusCode === 400 && /Optical signal/.test(error.message)
  );
});

test('technician customer access predicates require draft ownership or matching branch job', () => {
  assert.equal(installationsRouter.technicianOwnsPendingDraft({
    status: 'pending',
    submittedBy: { id: 'tech-1' }
  }, { id: 'tech-1' }), true);
  assert.equal(installationsRouter.technicianOwnsPendingDraft({
    status: 'pending',
    submittedBy: { id: 'tech-2' }
  }, { id: 'tech-1' }), false);
  assert.equal(installationsRouter.technicianOwnsPendingDraft({
    status: 'approved',
    submittedBy: { id: 'tech-1' }
  }, { id: 'tech-1' }), false);

  const job = { branchId: 7, customerAccountNumber: '30010001' };
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 7, '30010001'), true);
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 8, '30010001'), false);
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 7, '30010002'), false);
  assert.equal(installationsRouter.jobGrantsCustomerAccess({ customerAccountNumber: '30010001' }, 7, '30010001'), false);
});

test('technician PON overview redacts every other subscriber identity', () => {
  const safe = installationsRouter.sanitizeTechnicianPonOverview({
    olts: [{ id: 'olt-1', name: 'OLT-A', status: 'online', ponPorts: 1 }],
    naps: [{
      id: 'nap-1',
      code: 'NAP-01',
      capacity: 8,
      used: 2,
      connections: [
        { port: 1, customerId: '30010001', customerName: 'Allowed', opticalInfo: '-19 dBm' },
        { port: 2, customerId: '30010099', customerName: 'Private', opticalInfo: '-20 dBm' }
      ],
      ports: [
        { port: 1, occupied: true, customerId: '30010001', customerName: 'Allowed' },
        { port: 2, occupied: true, customerId: '30010099', customerName: 'Private' },
        { port: 3, occupied: false }
      ]
    }]
  }, '30010001');

  assert.equal(safe.naps[0].connections[0].customerId, '30010001');
  assert.equal(safe.naps[0].connections[1].occupied, true);
  assert.equal('customerId' in safe.naps[0].connections[1], false);
  assert.equal('customerName' in safe.naps[0].connections[1], false);
  assert.equal('opticalInfo' in safe.naps[0].connections[1], false);
  assert.equal(safe.naps[0].ports[1].occupied, true);
  assert.equal('customerId' in safe.naps[0].ports[1], false);
});

test('technician PON assignment rejects replace, move, force, and override flags', () => {
  for (const payload of [
    { replaceExistingPort: true },
    { moveExistingCustomer: 'yes' },
    { force: 1 },
    { override: 'true' }
  ]) {
    assert.throws(
      () => installationsRouter.assertPonOverrideFlagsDenied(payload),
      (error) => error.statusCode === 403 && /cannot replace occupied ports/.test(error.message)
    );
  }
  assert.doesNotThrow(() => installationsRouter.assertPonOverrideFlagsDenied({
    replaceExistingPort: false,
    moveExistingCustomer: false
  }));
});

test('technician PON router exposes nearby, reservation, release, and finalize contracts', () => {
  const paths = installationsRouter.stack
    .map((layer) => layer?.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes('/pon/nearby'));
  assert.ok(paths.includes('/pon/reservations'));
  assert.ok(paths.includes('/pon/reservations/:reservationId/release'));
  assert.ok(paths.includes('/pon/reservations/:reservationId/finalize'));
  assert.ok(paths.includes('/pon/assign'));
});
