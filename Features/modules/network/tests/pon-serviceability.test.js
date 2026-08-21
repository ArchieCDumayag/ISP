const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCoordinate,
  haversineMeters,
  buildNearbyCandidates,
  assertReservationCustomer,
  assertFinalizeEventReplay,
  withPonBranchLock
} = require('../backend/pon-serviceability');

test('normalizes valid customer and NAP coordinates', () => {
  assert.deepEqual(parseCoordinate('17.966700, 121.758300'), {
    latitude: 17.9667,
    longitude: 121.7583,
    normalized: '17.966700, 121.758300'
  });
  assert.equal(parseCoordinate('not-a-coordinate'), null);
});

test('ranks only online NAPs with exact free ports by real distance', () => {
  const result = buildNearbyCandidates({
    latitude: 17.9667,
    longitude: 121.7583,
    limit: 5,
    maxDistanceMeters: 5000,
    nowMs: Date.parse('2026-08-16T12:00:00.000Z'),
    state: {
      olts: [
        { name: 'OLT-A', status: 'online', ponPortNames: { 'PON-1': 'Baggao North' } },
        { name: 'OLT-B', status: 'offline' }
      ],
      naps: [
        {
          id: 'nap-near', code: 'NAP-01', linkedOlt: 'OLT-A', ponRef: 'PON-1',
          coordinate: '17.967000, 121.758300', splitter: '1:8', capacity: 8,
          connections: [{ port: 1 }, { port: 3 }]
        },
        {
          id: 'nap-far', code: 'NAP-02', linkedOlt: 'OLT-A', ponRef: 'PON-1',
          coordinate: '17.975000, 121.758300', splitter: '1:8', capacity: 8,
          connections: []
        },
        {
          id: 'nap-offline', code: 'NAP-03', linkedOlt: 'OLT-B', ponRef: 'PON-1',
          coordinate: '17.966800, 121.758300', splitter: '1:8', capacity: 8,
          connections: []
        },
        {
          id: 'nap-invalid', code: 'NAP-04', linkedOlt: 'OLT-A', ponRef: 'PON-1',
          coordinate: 'missing', splitter: '1:8', capacity: 8,
          connections: []
        }
      ],
      reservations: [
        {
          napId: 'nap-near', port: 2, status: 'active',
          expiresAt: '2026-08-16T12:10:00.000Z'
        }
      ]
    }
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.napId), ['nap-near', 'nap-far']);
  assert.equal(result.candidates[0].usedPorts, 2);
  assert.equal(result.candidates[0].reservedPorts, 1);
  assert.deepEqual(result.candidates[0].availablePortNumbers, [4, 5, 6, 7, 8]);
  assert.equal(result.candidates[0].ponPortName, 'Baggao North');
  assert.equal(result.skippedInvalidCoordinates, 1);
});

test('haversine distance is stable for nearby field coordinates', () => {
  const distance = haversineMeters(17.9667, 121.7583, 17.9677, 121.7583);
  assert.ok(distance > 110 && distance < 112);
});

test('reservation mutations stay bound to the authorized customer', () => {
  assert.equal(
    assertReservationCustomer({ customerAccountNumber: '30010001' }, '30010001'),
    '30010001'
  );
  assert.throws(
    () => assertReservationCustomer({ customer_ref: '30010002' }, '30010001'),
    (error) => error.statusCode === 409 && /does not belong/.test(error.message)
  );
});

test('finalize replay accepts only the original idempotency event', () => {
  assert.doesNotThrow(() => assertFinalizeEventReplay({
    status: 'finalized',
    finalizeEventId: 'finalize-1'
  }, 'finalize-1'));
  assert.throws(
    () => assertFinalizeEventReplay({
      status: 'finalized',
      finalize_event_id: 'finalize-1'
    }, 'finalize-2'),
    (error) => error.statusCode === 409 && /different clientEventId/.test(error.message)
  );
});

test('branch lock serializes same-branch mutations while allowing completion', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = withPonBranchLock(7, async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
  });
  const second = withPonBranchLock(7, async () => {
    order.push('second');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});
