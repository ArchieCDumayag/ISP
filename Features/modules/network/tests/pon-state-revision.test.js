#!/usr/bin/env node

const assert = require('assert');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
const dataStorePath = require.resolve(path.join(projectRoot, 'core/data/data-store'));
const storageModePath = require.resolve(path.join(projectRoot, 'core/config/storage-mode'));
const ponModulePath = require.resolve(path.join(
  projectRoot,
  'Features/modules/network/backend/pon-management-api'
));
const ponServiceabilityPath = require.resolve(path.join(
  projectRoot,
  'Features/modules/network/backend/pon-serviceability'
));

const clone = (value) => JSON.parse(JSON.stringify(value));
const stores = new Map();

require.cache[dataStorePath] = {
  id: dataStorePath,
  filename: dataStorePath,
  loaded: true,
  exports: {
    readJson: async (key, fallback) => clone(stores.has(key) ? stores.get(key) : fallback),
    writeJson: async (key, value) => {
      stores.set(key, clone(value));
    }
  }
};
require.cache[storageModePath] = {
  id: storageModePath,
  filename: storageModePath,
  loaded: true,
  exports: { isJsonStorageMode: () => true }
};
delete require.cache[ponModulePath];
delete require.cache[ponServiceabilityPath];

const pon = require(ponModulePath);
const ponServiceability = require(ponServiceabilityPath);

const baseBranch = () => ({
  olts: [{
    id: 'olt-1',
    name: 'OLT Alpha',
    technology: 'epon',
    site: 'Central Office',
    status: 'online',
    ponPorts: 1,
    ponCodePrefix: 'PON',
    ponPortNames: {}
  }],
  naps: [{
    id: 'nap-1',
    code: 'NAP-01',
    location: 'Zone 1',
    coordinate: '17.92663, 121.78047',
    splitter: '1:8',
    linkedOlt: 'OLT Alpha',
    ponRef: 'PON-1',
    ponCapacity: 64,
    capacity: 8,
    used: 0,
    opticalPower: '',
    connections: []
  }]
});

const run = async () => {
  const branch = baseBranch();
  const revision = pon.createPonStateRevision(branch);
  const reordered = {
    naps: [...branch.naps].reverse(),
    olts: [...branch.olts].reverse()
  };
  assert.strictEqual(pon.createPonStateRevision(reordered), revision);

  const finalized = clone(branch);
  finalized.naps[0].connections.push({
    customerId: 'TEMP-1001',
    customerName: 'Test Client',
    customerRef: 'TEMP-1001',
    port: 1,
    opticalInfo: '-20 dBm'
  });
  finalized.naps[0].used = 1;
  assert.notStrictEqual(pon.createPonStateRevision(finalized), revision);

  assert.throws(
    () => pon.assertExpectedPonRevision('', revision),
    (error) => error.statusCode === 428 && error.code === 'PON_REVISION_REQUIRED'
  );
  assert.throws(
    () => pon.assertExpectedPonRevision('pon-v1-stale', revision),
    (error) => (
      error.statusCode === 409
      && error.code === 'PON_STATE_CONFLICT'
      && error.currentRevision === revision
    )
  );
  assert.strictEqual(pon.assertExpectedPonRevision(revision, revision), revision);

  const relationalQueries = [];
  const relationalSnapshot = await pon.loadRelationalRevisionSnapshot({
    query: async (sql) => {
      relationalQueries.push(sql);
      if (sql.includes('FROM pon_olts')) {
        return [[{
          id: 'olt-1',
          name: 'OLT Alpha',
          technology: 'epon',
          site: 'Central Office',
          status: 'online',
          ponPorts: 1,
          ponCodePrefix: 'PON',
          ponPortNames: '{}'
        }]];
      }
      if (sql.includes('FROM pon_naps')) {
        return [[{
          databaseId: 10,
          id: 'nap-1',
          code: 'NAP-01',
          location: 'Zone 1',
          coordinate: '17.92663, 121.78047',
          splitter: '1:8',
          ponRef: 'PON-1',
          ponCapacity: 64,
          capacity: 8,
          used: 0,
          opticalPower: '',
          linkedOlt: 'OLT Alpha'
        }]];
      }
      return [[]];
    }
  }, 1, { lockRows: true });
  assert.strictEqual(pon.createPonStateRevision(relationalSnapshot), revision);
  assert(relationalQueries.every((sql) => sql.trimEnd().endsWith('FOR UPDATE')));

  stores.set('pon-state', { branches: { 1: clone(branch) } });
  const adminLoad = await pon.loadPonStateForBranch(1);
  assert.strictEqual(adminLoad.revision, revision);

  const technicianState = clone(stores.get('pon-state'));
  technicianState.branches[1] = finalized;
  stores.set('pon-state', technicianState);

  await assert.rejects(
    pon.savePonStateForBranch(1, {
      expectedRevision: adminLoad.revision,
      olts: adminLoad.olts,
      naps: adminLoad.naps
    }),
    (error) => error.statusCode === 409 && error.code === 'PON_STATE_CONFLICT'
  );
  assert.strictEqual(stores.get('pon-state').branches[1].naps[0].connections.length, 1);

  const freshLoad = await pon.loadPonStateForBranch(1);
  const saved = await pon.savePonStateForBranch(1, {
    expectedRevision: freshLoad.revision,
    olts: freshLoad.olts.map((olt) => ({ ...olt, site: 'Updated Site' })),
    naps: freshLoad.naps
  });
  assert.match(saved.revision, /^pon-v1-[a-f0-9]{64}$/);
  assert.notStrictEqual(saved.revision, freshLoad.revision);
  assert.strictEqual(stores.get('pon-state').branches[1].olts[0].site, 'Updated Site');

  const tempCustomers = [{
    accountNumber: 'TMP000010',
    name: 'Shahien Gamata',
    napId: 'nap-1',
    napCode: 'NAP-01',
    napPort: 3
  }];
  stores.set('pon-state', { branches: { 1: clone(baseBranch()) } });
  ponServiceability.configureTempNetworkCustomersProvider(async () => tempCustomers);
  const tempAwareCoverage = await ponServiceability.findNearbyPonNaps({
    branchId: 1,
    latitude: 17.92663,
    longitude: 121.78047,
    limit: 500,
    maxDistanceMeters: 600,
    includeOffline: true,
    includeUnavailable: true,
    allowExpandedLimit: true
  });
  assert.strictEqual(tempAwareCoverage.candidates[0].availablePorts, 7);
  assert.strictEqual(tempAwareCoverage.candidates[0].ports[2].status, 'occupied');
  assert.strictEqual(tempAwareCoverage.candidates[0].ports[2].customerAccountNumber, 'TMP000010');
  await assert.rejects(
    ponServiceability.reservePonPort({
      branchId: 1,
      technicianUserId: 'tech-temp-guard',
      customerAccountNumber: 'TEMP-TECH-1',
      napId: 'nap-1',
      port: 3,
      clientEventId: 'reserve-temp-occupied'
    }),
    (error) => error.statusCode === 409 && /no longer available/.test(error.message)
  );

  ponServiceability.configureTempNetworkCustomersProvider(null);
  const reservationBlockedAtFinalize = await ponServiceability.reservePonPort({
    branchId: 1,
    technicianUserId: 'tech-temp-guard',
    customerAccountNumber: 'TEMP-TECH-2',
    napId: 'nap-1',
    port: 2,
    clientEventId: 'reserve-before-temp-assignment'
  });
  ponServiceability.configureTempNetworkCustomersProvider(async () => [{
    ...tempCustomers[0],
    napPort: 2
  }]);
  await assert.rejects(
    ponServiceability.finalizePonAssignment({
      branchId: 1,
      reservationId: reservationBlockedAtFinalize.reservationId,
      technicianUserId: 'tech-temp-guard',
      customerAccountNumber: 'TEMP-TECH-2',
      clientEventId: 'finalize-after-temp-assignment',
      customerName: 'Technician Draft'
    }),
    (error) => error.statusCode === 409 && /already assigned/.test(error.message)
  );
  ponServiceability.configureTempNetworkCustomersProvider(null);

  stores.set('pon-state', { branches: { 1: clone(baseBranch()) } });
  const beforeReservation = await pon.loadPonStateForBranch(1);
  const reservation = await ponServiceability.reservePonPort({
    branchId: 1,
    technicianUserId: 'tech-1',
    customerAccountNumber: 'TEMP-1002',
    napId: 'nap-1',
    port: 1,
    clientEventId: 'reserve-1'
  });
  assert.equal(reservation.status, 'active');

  const conflictingNaps = clone(beforeReservation.naps);
  conflictingNaps[0].connections = [{
    customerId: '30010099',
    customerName: 'Other Customer',
    customerRef: '30010099',
    port: 1,
    opticalInfo: ''
  }];
  conflictingNaps[0].used = 1;
  await assert.rejects(
    pon.savePonStateForBranch(1, {
      expectedRevision: beforeReservation.revision,
      olts: beforeReservation.olts,
      naps: conflictingNaps
    }),
    (error) => (
      error.statusCode === 409
      && error.code === 'PON_ACTIVE_RESERVATION_CONFLICT'
      && error.reservationConflict?.reservationId === reservation.reservationId
    )
  );
  assert.equal(stores.get('pon-state').branches[1].naps[0].connections.length, 0);
  assert.equal(stores.get('pon-state').branches[1].reservations[0].status, 'active');

  const unrelatedSave = await pon.savePonStateForBranch(1, {
    expectedRevision: beforeReservation.revision,
    olts: beforeReservation.olts.map((olt) => ({ ...olt, site: 'Reservation-safe edit' })),
    naps: beforeReservation.naps
  });
  assert.match(unrelatedSave.revision, /^pon-v1-[a-f0-9]{64}$/);
  assert.equal(stores.get('pon-state').branches[1].reservations[0].reservationId, reservation.reservationId);

  stores.set('pon-state', { branches: { 1: clone(baseBranch()) } });
  ponServiceability.configureTempNetworkCustomersProvider(async () => []);
  const requestedAssignment = await ponServiceability.finalizeRequestedPonAssignment({
    branchId: 1,
    customerAccountNumber: '30010200',
    customerName: 'Requested Draft Customer',
    napId: 'nap-1',
    port: 4,
    clientEventId: 'admin-requested-draft-1'
  });
  assert.equal(requestedAssignment.duplicate, false);
  assert.equal(requestedAssignment.assignment.port, 4);
  assert.equal(stores.get('pon-state').branches[1].naps[0].connections[0].customerId, '30010200');
  assert.equal((stores.get('pon-state').branches[1].reservations || []).length, 0);
  const requestedReplay = await ponServiceability.finalizeRequestedPonAssignment({
    branchId: 1,
    customerAccountNumber: '30010200',
    customerName: 'Requested Draft Customer',
    napId: 'nap-1',
    port: 4,
    clientEventId: 'admin-requested-draft-1'
  });
  assert.equal(requestedReplay.duplicate, true);
  await assert.rejects(
    ponServiceability.finalizeRequestedPonAssignment({
      branchId: 1,
      customerAccountNumber: '30010201',
      customerName: 'Conflicting Draft Customer',
      napId: 'nap-1',
      port: 4,
      clientEventId: 'admin-requested-draft-2'
    }),
    (error) => error.statusCode === 409 && /already assigned/.test(error.message)
  );

  stores.set('pon-state', { branches: { 1: clone(baseBranch()) } });
  const submittedReservation = await ponServiceability.reservePonPort({
    branchId: 1,
    technicianUserId: 'tech-draft-hold',
    customerAccountNumber: 'TEMP-2001',
    napId: 'nap-1',
    port: 1,
    clientEventId: 'reserve-draft-hold'
  });
  const submittedHold = await ponServiceability.submitPonReservationForAdmin({
    branchId: 1,
    reservationId: submittedReservation.reservationId,
    technicianUserId: 'tech-draft-hold',
    customerAccountNumber: 'TEMP-2001',
    clientEventId: 'submit-draft-hold'
  });
  assert.equal(submittedHold.hold.status, 'draft-held');
  assert.equal(submittedHold.hold.expiresAt, null);
  assert.equal(stores.get('pon-state').branches[1].reservations[0].expiresAt, '');
  const heldAdminLoad = await pon.loadPonStateForBranch(1);
  const heldConflictNaps = clone(heldAdminLoad.naps);
  heldConflictNaps[0].connections = [{
    customerId: '30010100',
    customerName: 'Conflicting Admin Customer',
    customerRef: '30010100',
    port: 1,
    opticalInfo: ''
  }];
  await assert.rejects(
    pon.savePonStateForBranch(1, {
      expectedRevision: heldAdminLoad.revision,
      olts: heldAdminLoad.olts,
      naps: heldConflictNaps
    }),
    (error) => error.statusCode === 409 && error.code === 'PON_ACTIVE_RESERVATION_CONFLICT'
  );
  await assert.rejects(
    ponServiceability.releasePonPortReservation({
      branchId: 1,
      reservationId: submittedReservation.reservationId,
      technicianUserId: 'tech-draft-hold',
      customerAccountNumber: 'TEMP-2001'
    }),
    (error) => error.statusCode === 409 && /only be changed by Admin/.test(error.message)
  );
  const reassignedHold = await ponServiceability.reassignPonDraftHold({
    branchId: 1,
    reservationId: submittedReservation.reservationId,
    customerAccountNumber: 'TEMP-2001',
    napId: 'nap-1',
    port: 2,
    reassignedByUserId: 'admin-1'
  });
  assert.equal(reassignedHold.selection.port, 2);
  const heldCoverage = await ponServiceability.findNearbyPonNaps({
    branchId: 1,
    latitude: 17.92663,
    longitude: 121.78047,
    limit: 10,
    maxDistanceMeters: 600,
    includeUnavailable: true
  });
  assert.equal(heldCoverage.candidates[0].ports[0].status, 'available');
  assert.equal(heldCoverage.candidates[0].ports[1].status, 'reserved');
  const finalizedHold = await ponServiceability.finalizePonDraftHold({
    branchId: 1,
    reservationId: submittedReservation.reservationId,
    customerAccountNumber: 'TEMP-2001',
    customerName: 'Durable Draft Customer',
    clientEventId: 'admin-draft-finalize'
  });
  assert.equal(finalizedHold.assignment.port, 2);
  assert.equal(stores.get('pon-state').branches[1].naps[0].connections[0].port, 2);
  const finalizedReplay = await ponServiceability.finalizePonDraftHold({
    branchId: 1,
    reservationId: submittedReservation.reservationId,
    customerAccountNumber: 'TEMP-2001',
    customerName: 'Durable Draft Customer',
    clientEventId: 'admin-draft-finalize'
  });
  assert.equal(finalizedReplay.duplicate, true);

  const rejectedReservation = await ponServiceability.reservePonPort({
    branchId: 1,
    technicianUserId: 'tech-draft-reject',
    customerAccountNumber: 'TEMP-2002',
    napId: 'nap-1',
    port: 3,
    clientEventId: 'reserve-draft-reject'
  });
  await ponServiceability.submitPonReservationForAdmin({
    branchId: 1,
    reservationId: rejectedReservation.reservationId,
    technicianUserId: 'tech-draft-reject',
    customerAccountNumber: 'TEMP-2002',
    clientEventId: 'submit-draft-reject'
  });
  await ponServiceability.releasePonDraftHold({
    branchId: 1,
    reservationId: rejectedReservation.reservationId,
    customerAccountNumber: 'TEMP-2002'
  });
  assert.equal(
    stores.get('pon-state').branches[1].reservations
      .find((entry) => entry.reservationId === rejectedReservation.reservationId).status,
    'released'
  );

  console.log('PASS PON revision hashes are deterministic and assignment-sensitive');
  console.log('PASS stale JSON admin snapshots cannot erase technician assignments');
  console.log('PASS active technician reservations block conflicting Admin port assignments');
  console.log('PASS technician coverage and mutations treat mapped Temp ports as occupied');
  console.log('PASS submitted technician ports become non-expiring Admin-held drafts with atomic reassignment');
  console.log('PASS Admin atomically assigns requested draft ports without creating reservations');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
