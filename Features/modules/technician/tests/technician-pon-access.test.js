const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const installationsRouter = require('../backend/technician-installations');

test('installation completion evidence is normalized and replay-safe', () => {
  const completion = installationsRouter.normalizeInstallationCompletion({
    clientEventId: 'install-event-1',
    onuSerialNumber: ' onu-001 ',
    onuBrand: 'Huawei',
    opticalSignal: '-18.4 dBm',
    cableMeterStart: '100.5',
    cableMeterEnd: '143',
    cableLengthMeters: '999',
    installationMaterials: {
      indoorOpticalOutletInstalled: true,
      patchCordInstalled: true,
      patchCordType: 'upc-to-apc',
      patchCordQuantity: 1,
      scConnectorQuantity: 2,
      cClipQuantity: 10,
      cableClipQuantity: 8,
      cableTieQuantity: 4,
      fClampQuantity: 1
    },
    materials: [{ name: 'Drop cable', quantity: 42.5, unit: 'm' }],
    notes: 'Speed test passed.'
  });
  assert.equal(completion.onuSerialNumber, 'ONU-001');
  assert.equal(completion.cableLengthMeters, 42.5);
  assert.equal(completion.onuBrand, 'Huawei');
  assert.equal(completion.installationMaterials.patchCordType, 'upc-to-apc');
  assert.equal(completion.installationMaterials.scConnectorQuantity, 2);
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

test('installation completion rejects reversed meter readings and incomplete patch-cord evidence', () => {
  const base = {
    clientEventId: 'install-event-materials',
    onuSerialNumber: 'ONU-003',
    onuBrand: 'ZTE',
    opticalSignal: '-19.2 dBm'
  };
  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      ...base,
      cableMeterStart: 200,
      cableMeterEnd: 150
    }),
    (error) => error.statusCode === 400 && /meter readings/.test(error.message)
  );
  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      ...base,
      installationMaterials: { patchCordInstalled: true, patchCordQuantity: 1 }
    }),
    (error) => error.statusCode === 400 && /Patch cord type/.test(error.message)
  );
  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      ...base,
      onuBrand: 'Unsupported'
    }),
    (error) => error.statusCode === 400 && /ONU brand/.test(error.message)
  );
});

test('new installation completion requires only a stable event and normalized ONU serial', () => {
  const completion = installationsRouter.normalizeInstallationCompletion({
    clientEventId: 'install-event-2',
    onuSerialNumber: ' zte f680-abc123 '
  });
  assert.equal(completion.onuSerialNumber, 'ZTEF680-ABC123');
  assert.deepEqual(completion, {
    clientEventId: 'install-event-2',
    onuSerialNumber: 'ZTEF680-ABC123'
  });

  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      onuSerialNumber: 'ONU-002'
    }),
    (error) => error.statusCode === 400 && /clientEventId/.test(error.message)
  );
  assert.throws(
    () => installationsRouter.normalizeInstallationCompletion({
      clientEventId: 'install-event-3'
    }),
    (error) => error.statusCode === 400 && /ONU serial/.test(error.message)
  );
});

test('case normalization keeps legacy mixed-case completion retries compatible', () => {
  const normalized = installationsRouter.normalizeInstallationCompletion({
    clientEventId: 'install-event-legacy-case',
    onuSerialNumber: 'onu-legacy-1'
  });
  const legacyCompletion = {
    ...normalized,
    onuSerialNumber: 'onu-legacy-1',
    macAddress: '',
    opticalSignal: '',
    cableLengthMeters: null,
    materials: [],
    notes: ''
  };
  const existing = {
    ...legacyCompletion,
    fingerprint: installationsRouter.installationCompletionFingerprint(legacyCompletion)
  };
  assert.equal(normalized.onuSerialNumber, 'ONU-LEGACY-1');
  assert.equal(
    installationsRouter.assertInstallationCompletionReplay(existing, normalized),
    true
  );
});

test('technician customer access predicates require draft ownership or matching branch job', () => {
  assert.equal(installationsRouter.technicianOwnsPendingDraft({
    status: 'in-progress',
    submittedBy: { id: 'tech-1' }
  }, { id: 'tech-1' }), true);
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
  assert.equal(installationsRouter.technicianOwnsApprovedDraft({
    status: 'approved',
    submittedBy: { id: 'tech-1' }
  }, { id: 'tech-1' }), true);
  assert.equal(installationsRouter.technicianOwnsApprovedDraft({
    status: 'approved',
    submittedBy: { id: 'tech-2' }
  }, { id: 'tech-1' }), false);

  const job = { branchId: 7, customerAccountNumber: '30010001' };
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 7, '30010001'), true);
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 8, '30010001'), false);
  assert.equal(installationsRouter.jobGrantsCustomerAccess(job, 7, '30010002'), false);
  assert.equal(installationsRouter.jobGrantsCustomerAccess({ customerAccountNumber: '30010001' }, 7, '30010001'), false);
});

test('approved-draft ONU reconciliation is no-op while pending and promotes after approval', async () => {
  const calls = [];
  const updateCustomer = async (...args) => {
    calls.push(args);
    return { accountNumber: args[0], onuSerialNumber: args[2].trustedOnuSerialNumber };
  };
  const completion = { clientEventId: 'install-race-1', onuSerialNumber: ' onu race-1 ' };

  const pendingResult = await installationsRouter.promoteApprovedDraftOnuSerial({
    completionUpdate: {
      item: {
        status: 'pending',
        draftAccountNumber: '30010001'
      }
    },
    completion,
    branchId: 7,
    updateCustomer
  });
  assert.equal(pendingResult, null);
  assert.equal(calls.length, 0);

  const approvedResult = await installationsRouter.promoteApprovedDraftOnuSerial({
    completionUpdate: {
      item: {
        status: 'approved',
        draftAccountNumber: '30010001',
        approvedCustomerAccountNumber: '30010009'
      }
    },
    completion,
    branchId: 7,
    updateCustomer
  });
  assert.equal(approvedResult.onuSerialNumber, 'ONURACE-1');
  assert.deepEqual(calls, [[
    '30010009',
    {},
    {
      branchId: 7,
      refreshSource: 'technician-installation-onu-reconcile',
      trustedOnuSerialNumber: 'ONURACE-1'
    }
  ]]);
});

test('finalize contract preflights ONU duplicates and supports approval-first completion convergence', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/technician-installations.js'),
    'utf8'
  );
  const finalizeSource = source.slice(
    source.indexOf('const finalizePonAssignmentHandler = async'),
    source.indexOf("router.post('/pon/reservations/:reservationId/finalize'")
  );
  assert.match(finalizeSource, /allowApprovedDraftReplay:\s*true/);
  assert.match(finalizeSource, /access\.accessType === 'own-approved-draft'/);
  assert.match(finalizeSource, /if \(existingCompletion\)\s*\{\s*assertInstallationCompletionReplay/);
  assert.match(finalizeSource, /findCustomerOnuSerialDuplicate\(/);
  assert.ok(finalizeSource.indexOf('findCustomerOnuSerialDuplicate(')
    < finalizeSource.indexOf('await finalizePonAssignment('));
  assert.match(finalizeSource, /statuses:\s*\['pending', 'approved'\]/);
  assert.match(finalizeSource, /const completionRecord = existingCompletion \|\| \{/);
  assert.match(finalizeSource, /promoteApprovedDraftOnuSerial\(/);
});

test('new-installation submission creates a durable Admin hold instead of a canonical assignment', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/technician-installations.js'),
    'utf8'
  );
  const submitSource = source.slice(
    source.indexOf('const submitPonDraftHoldHandler = async'),
    source.indexOf('const finalizePonAssignmentHandler = async')
  );
  assert.match(submitSource, /submitPonReservationForAdmin/);
  assert.match(submitSource, /transitionToPending:\s*true/);
  assert.match(submitSource, /statuses:\s*\['in-progress', 'pending', 'approved'\]/);
  assert.match(submitSource, /status:\s*'draft-held'/);
  assert.doesNotMatch(submitSource, /finalizePonAssignment\(/);
  assert.match(source, /statuses:\s*\['in-progress', 'pending'\]/);
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

test('technician coverage-map candidates expose only safe port client labels', () => {
  assert.equal(installationsRouter.TECHNICIAN_COVERAGE_RADIUS_METERS, 600);
  const safe = installationsRouter.sanitizeTechnicianNearbyCandidate({
    napId: 'nap-1',
    napCode: 'NAP-01',
    latitude: 17.9,
    longitude: 121.9,
    capacity: 4,
    availablePorts: 1,
    availablePortNumbers: [4],
    ports: [
      {
        port: 1,
        status: 'occupied',
        customerAccountNumber: '30010001',
        customerName: 'Client One',
        opticalInfo: '-19 dBm',
        technicianUserId: 'private-tech-id'
      },
      { port: 2, status: 'reserved', customerAccountNumber: '30010002' },
      { port: 3, status: 'unavailable' },
      { port: 4, status: 'available', customerAccountNumber: 'must-not-leak' }
    ]
  }, { includeClientLabels: true });

  assert.equal(safe.ports[0].customerName, 'Client One');
  assert.equal(safe.ports[0].customerAccountNumber, '30010001');
  assert.equal('opticalInfo' in safe.ports[0], false);
  assert.equal('technicianUserId' in safe.ports[0], false);
  assert.equal('customerAccountNumber' in safe.ports[3], false);
  assert.equal(safe.ports[3].available, true);

  const legacyNearby = installationsRouter.sanitizeTechnicianNearbyCandidate({
    ports: [{ port: 1, status: 'occupied', customerAccountNumber: '30010001' }]
  });
  assert.equal('customerAccountNumber' in legacyNearby.ports[0], false);
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

test('technician PON router exposes nearby, reservation, Admin submission, release, and legacy finalize contracts', () => {
  const paths = installationsRouter.stack
    .map((layer) => layer?.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes('/pon/nearby'));
  assert.ok(paths.includes('/pon/reservations'));
  assert.ok(paths.includes('/pon/reservations/:reservationId/release'));
  assert.ok(paths.includes('/pon/reservations/:reservationId/submit'));
  assert.ok(paths.includes('/pon/submissions'));
  assert.ok(paths.includes('/pon/assignments'));
  assert.ok(paths.includes('/pon/reservations/:reservationId/finalize'));
  assert.ok(paths.includes('/pon/assign'));
});

test('coverage map permits a new local draft before any server account exists', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../backend/technician-installations.js'),
    'utf8'
  );
  const nearby = source.slice(
    source.indexOf("router.get('/pon/nearby'"),
    source.indexOf("router.post('/pon/reservations'")
  );
  assert.match(nearby, /accessType:\s*'new-draft-selection'/);
  assert.match(nearby, /const access = customerAccountNumber/);
  assert.match(nearby, /customer:\s*access\.customer\s*\?/);
});
