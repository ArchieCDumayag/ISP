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

  console.log('PASS PON revision hashes are deterministic and assignment-sensitive');
  console.log('PASS stale JSON admin snapshots cannot erase technician assignments');
  console.log('PASS active technician reservations block conflicting Admin port assignments');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
