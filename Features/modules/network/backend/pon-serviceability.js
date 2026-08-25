const crypto = require('crypto');
const { getPool } = require('../../../../core/data/db');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { normalizeCustomerMapPin } = require('../../customer-management/backend/customers');

const JSON_STORE_KEY = 'pon-state';
const DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1000;
const MAX_RESERVATION_TTL_MS = 30 * 60 * 1000;
const MAX_JSON_RESERVATION_HISTORY = 1000;
const branchMutationTails = new Map();
let relationalSchemaPromise = null;

const text = (value) => String(value ?? '').trim();
const keyOf = (value) => text(value).toLowerCase();

const createServiceError = (statusCode, message, details = {}) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
};

const positiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const finiteNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeOltStatus = (value) => {
  const normalized = keyOf(value);
  if (['online', 'up', 'active', 'connected'].includes(normalized)) return 'online';
  if (['offline', 'down', 'inactive', 'disconnected'].includes(normalized)) return 'offline';
  return 'maintenance';
};

const splitCapacity = (value) => {
  const match = text(value).replace('/', ':').match(/^1:(8|16|24|32)$/);
  return match ? Number(match[1]) : 16;
};

const normalizePonRef = (value) => {
  const raw = text(value);
  const match = raw.replace(/\s+/g, '').match(/^pon-?(\d+)$/i);
  if (match) return `PON-${Number(match[1])}`;
  if (/^\d+$/.test(raw)) return `PON-${Number(raw)}`;
  return raw;
};

const normalizePonPortNames = (value) => {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const result = {};
  Object.entries(source).forEach(([ponRef, label]) => {
    const normalizedRef = normalizePonRef(ponRef);
    const normalizedLabel = text(label).slice(0, 80);
    if (normalizedRef && normalizedLabel) result[normalizedRef] = normalizedLabel;
  });
  return result;
};

const parseCoordinate = (value) => {
  try {
    const normalized = normalizeCustomerMapPin(value);
    if (!normalized) return null;
    const [latitude, longitude] = normalized.split(',').map((part) => Number(part.trim()));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, normalized };
  } catch {
    return null;
  }
};

const haversineMeters = (leftLatitude, leftLongitude, rightLatitude, rightLongitude) => {
  const radians = (degrees) => degrees * (Math.PI / 180);
  const earthRadiusMeters = 6371000;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const leftRadians = radians(leftLatitude);
  const rightRadians = radians(rightLatitude);
  const haversine = (Math.sin(latitudeDelta / 2) ** 2)
    + (Math.cos(leftRadians) * Math.cos(rightRadians) * (Math.sin(longitudeDelta / 2) ** 2));
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

const napCapacity = (nap = {}) => {
  const connections = Array.isArray(nap.connections) ? nap.connections : [];
  const highestAssigned = connections.reduce(
    (highest, connection) => Math.max(highest, positiveInt(connection?.port, 0) || 0),
    0
  );
  return Math.max(
    splitCapacity(nap.splitter),
    positiveInt(nap.capacity, 0) || 0,
    highestAssigned,
    1
  );
};

const activeReservation = (reservation, nowMs = Date.now()) => (
  keyOf(reservation?.status || 'active') === 'active'
  && new Date(reservation?.expiresAt || reservation?.expires_at || 0).getTime() > nowMs
);

const isoDateOr = (value, fallback = Date.now()) => {
  const parsed = new Date(value ?? fallback);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return new Date(fallback).toISOString();
};

const sanitizeReservation = (reservation = {}) => ({
  reservationId: text(reservation.id || reservation.reservationId),
  napId: text(reservation.napId),
  port: positiveInt(reservation.port),
  customerAccountNumber: text(reservation.customerAccountNumber || reservation.customerRef),
  technicianUserId: text(reservation.technicianUserId),
  clientEventId: text(reservation.clientEventId),
  finalizeEventId: text(reservation.finalizeEventId),
  status: keyOf(reservation.status || 'active'),
  expiresAt: isoDateOr(reservation.expiresAt),
  createdAt: isoDateOr(reservation.createdAt),
  finalizedAt: reservation.finalizedAt ? isoDateOr(reservation.finalizedAt) : '',
  opticalInfo: text(reservation.opticalInfo)
});

const withPonBranchLock = async (branchId, task) => {
  const branchKey = String(positiveInt(branchId) || 'default');
  const previous = branchMutationTails.get(branchKey) || Promise.resolve();
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  branchMutationTails.set(branchKey, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    releaseGate();
    if (branchMutationTails.get(branchKey) === tail) branchMutationTails.delete(branchKey);
  }
};

const jsonBranchState = (allState, branchId, { create = false } = {}) => {
  const root = allState && typeof allState === 'object' && !Array.isArray(allState) ? allState : {};
  const branchKey = String(branchId);
  if (!root.branches || typeof root.branches !== 'object' || Array.isArray(root.branches)) {
    if (!create) return root.default && typeof root.default === 'object' ? root.default : {};
    root.branches = {};
  }
  if (!root.branches[branchKey] && create) {
    const fallback = root.default && typeof root.default === 'object' ? root.default : {};
    const fallbackOlts = Array.isArray(fallback.olts)
      ? fallback.olts.map((entry) => ({ ...entry }))
      : [];
    const fallbackNaps = Array.isArray(fallback.naps)
      ? fallback.naps.map((entry) => ({
        ...entry,
        connections: Array.isArray(entry?.connections)
          ? entry.connections.map((connection) => ({ ...connection }))
          : []
      }))
      : [];
    root.branches[branchKey] = {
      ...fallback,
      olts: fallbackOlts,
      naps: fallbackNaps,
      reservations: Array.isArray(fallback.reservations)
        ? fallback.reservations.map((entry) => ({ ...entry }))
        : []
    };
  }
  return root.branches?.[branchKey] || {};
};

const pruneJsonReservations = (branch, nowMs = Date.now()) => {
  const reservations = (Array.isArray(branch.reservations) ? branch.reservations : [])
    .map(sanitizeReservation)
    .map((reservation) => (
      reservation.status === 'active' && new Date(reservation.expiresAt).getTime() <= nowMs
        ? { ...reservation, status: 'expired' }
        : reservation
    ));
  const active = reservations.filter((reservation) => reservation.status === 'active');
  const history = reservations
    .filter((reservation) => reservation.status !== 'active')
    .sort((left, right) => new Date(right.finalizedAt || right.createdAt).getTime()
      - new Date(left.finalizedAt || left.createdAt).getTime())
    .slice(0, MAX_JSON_RESERVATION_HISTORY);
  branch.reservations = [...active, ...history];
  return branch.reservations;
};

const buildNearbyCandidates = ({
  state,
  latitude,
  longitude,
  limit = 3,
  maxDistanceMeters = 10000,
  includeOffline = false,
  includeUnavailable = false,
  allowExpandedLimit = false,
  nowMs = Date.now()
}) => {
  const originLatitude = finiteNumber(latitude);
  const originLongitude = finiteNumber(longitude);
  if (originLatitude == null || originLatitude < -90 || originLatitude > 90) {
    throw createServiceError(400, 'Latitude must be between -90 and 90.');
  }
  if (originLongitude == null || originLongitude < -180 || originLongitude > 180) {
    throw createServiceError(400, 'Longitude must be between -180 and 180.');
  }
  const safeLimit = Math.min(Math.max(positiveInt(limit, 3), 1), allowExpandedLimit ? 500 : 10);
  const safeRadius = Math.min(Math.max(finiteNumber(maxDistanceMeters, 10000), 100), 100000);
  const olts = Array.isArray(state?.olts) ? state.olts : [];
  const naps = Array.isArray(state?.naps) ? state.naps : [];
  const reservations = Array.isArray(state?.reservations) ? state.reservations : [];
  const oltByName = new Map(olts.map((olt) => [keyOf(olt?.name), olt]));
  let skippedInvalidCoordinates = 0;

  const candidates = naps.map((nap) => {
    const coordinates = parseCoordinate(nap?.coordinate || nap?.coordinates || nap?.coords);
    if (!coordinates) {
      skippedInvalidCoordinates += 1;
      return null;
    }
    const olt = oltByName.get(keyOf(nap?.linkedOlt)) || {};
    const oltStatus = normalizeOltStatus(olt?.status);
    if (!includeOffline && oltStatus !== 'online') return null;
    const distanceMeters = haversineMeters(
      originLatitude,
      originLongitude,
      coordinates.latitude,
      coordinates.longitude
    );
    if (distanceMeters > safeRadius) return null;
    const capacity = napCapacity(nap);
    const connections = Array.isArray(nap?.connections) ? nap.connections : [];
    const occupiedByPort = new Map(connections
      .map((connection) => [positiveInt(connection?.port), connection])
      .filter(([port]) => Boolean(port)));
    const activeReservations = reservations.filter((reservation) => (
      activeReservation(reservation, nowMs) && text(reservation?.napId) === text(nap?.id)
    ));
    const reservedByPort = new Map(activeReservations
      .map((reservation) => [positiveInt(reservation?.port), reservation])
      .filter(([port]) => Boolean(port)));
    const availablePortNumbers = [];
    const ports = [];
    for (let port = 1; port <= capacity; port += 1) {
      const connection = occupiedByPort.get(port);
      const reservation = reservedByPort.get(port);
      let status = 'available';
      if (connection) status = 'occupied';
      else if (reservation) status = 'reserved';
      else if (oltStatus !== 'online') status = 'unavailable';
      const available = status === 'available';
      if (available) availablePortNumbers.push(port);
      ports.push({
        port,
        status,
        available,
        ...(connection ? {
          customerAccountNumber: text(
            connection?.customerAccountNumber || connection?.customerId || connection?.customerRef
          ),
          customerName: text(connection?.customerName)
        } : {}),
        ...(!connection && reservation ? {
          customerAccountNumber: text(
            reservation?.customerAccountNumber || reservation?.customerRef || reservation?.customer_ref
          ),
          customerName: text(reservation?.customerName)
        } : {})
      });
    }
    if (!includeUnavailable && !availablePortNumbers.length) return null;
    const ponRef = normalizePonRef(nap?.ponRef);
    const ponPortNames = normalizePonPortNames(olt?.ponPortNames || olt?.pon_port_names_json);
    return {
      napId: text(nap?.id),
      napCode: text(nap?.code),
      location: text(nap?.location || nap?.area),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      distanceMeters: Math.round(distanceMeters),
      linkedOlt: text(nap?.linkedOlt || olt?.name),
      ponRef,
      ponPortName: text(ponPortNames[ponRef]) || ponRef,
      capacity,
      usedPorts: occupiedByPort.size,
      reservedPorts: reservedByPort.size,
      availablePorts: availablePortNumbers.length,
      availablePortNumbers,
      ports,
      oltStatus,
      opticalPower: text(nap?.opticalPower)
    };
  }).filter(Boolean)
    .sort((left, right) => left.distanceMeters - right.distanceMeters
      || (right.availablePorts - left.availablePorts)
      || left.napCode.localeCompare(right.napCode))
    .slice(0, safeLimit);

  return { candidates, skippedInvalidCoordinates, radiusMeters: safeRadius };
};

const ensureRelationalReservationSchema = async () => {
  if (relationalSchemaPromise) return relationalSchemaPromise;
  relationalSchemaPromise = (async () => {
    const pool = await getPool();
    const [columnRows] = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'pon_olts'
          AND column_name = 'pon_port_names_json'
        LIMIT 1`
    );
    if (!columnRows.length) {
      try {
        await pool.query(
          `ALTER TABLE pon_olts
           ADD COLUMN pon_port_names_json LONGTEXT NULL AFTER pon_code_prefix`
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
      }
    }
    const [tableRows] = await pool.query(
      `SELECT 1
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'pon_port_reservations'
        LIMIT 1`
    );
    if (tableRows.length) return;
    await pool.query(
      `CREATE TABLE IF NOT EXISTS pon_port_reservations (
         id VARCHAR(64) NOT NULL PRIMARY KEY,
         branch_id INT NOT NULL,
         nap_id BIGINT NOT NULL,
         port INT NOT NULL,
         customer_ref VARCHAR(200) NOT NULL,
         technician_user_id VARCHAR(64) NOT NULL,
         client_event_id VARCHAR(100) NOT NULL,
         finalize_event_id VARCHAR(100) NULL,
         status VARCHAR(20) NOT NULL DEFAULT 'active',
         active_flag TINYINT NULL DEFAULT 1,
         optical_info VARCHAR(120) NULL,
         expires_at DATETIME NOT NULL,
         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         finalized_at DATETIME NULL,
         UNIQUE KEY uniq_pon_reservation_active_port (nap_id, port, active_flag),
         UNIQUE KEY uniq_pon_reservation_event (branch_id, technician_user_id, client_event_id),
         UNIQUE KEY uniq_pon_reservation_finalize_event (branch_id, technician_user_id, finalize_event_id),
         KEY idx_pon_reservation_branch_status (branch_id, status, expires_at),
         CONSTRAINT fk_pon_reservation_nap FOREIGN KEY (nap_id) REFERENCES pon_naps(id) ON DELETE CASCADE
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
  })().catch((error) => {
    relationalSchemaPromise = null;
    throw error;
  });
  return relationalSchemaPromise;
};

const mysqlDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const lockRelationalPonBranch = async (connection, branchId) => {
  await connection.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId]);
};

const loadRelationalCandidateState = async (branchId) => {
  await ensureRelationalReservationSchema();
  const pool = await getPool();
  const [oltRows] = await pool.query(
    `SELECT client_uid AS id, name, status, pon_ports AS ponPorts,
            pon_code_prefix AS ponCodePrefix, pon_port_names_json AS ponPortNames
       FROM pon_olts WHERE branch_id = ? ORDER BY id ASC`,
    [branchId]
  );
  const [napRows] = await pool.query(
    `SELECT n.id AS databaseId, n.client_uid AS id, n.code, n.area AS location,
            n.coordinate, n.splitter, n.pon_ref AS ponRef, n.capacity,
            n.optical_power AS opticalPower, o.name AS linkedOlt
       FROM pon_naps n
       INNER JOIN pon_olts o ON o.id = n.olt_id
      WHERE n.branch_id = ?
      ORDER BY n.id ASC`,
    [branchId]
  );
  const [connectionRows] = await pool.query(
    `SELECT n.client_uid AS napId, c.port,
            c.customer_account_number AS customerAccountNumber,
            c.customer_ref AS customerRef,
            c.customer_name AS customerName
       FROM pon_nap_connections c
       INNER JOIN pon_naps n ON n.id = c.nap_id
      WHERE n.branch_id = ?`,
    [branchId]
  );
  const [reservationRows] = await pool.query(
    `SELECT n.client_uid AS napId, r.port, r.customer_ref AS customerAccountNumber,
            r.expires_at AS expiresAt, r.status
       FROM pon_port_reservations r
       INNER JOIN pon_naps n ON n.id = r.nap_id
      WHERE r.branch_id = ? AND r.status = 'active' AND r.expires_at > CURRENT_TIMESTAMP`,
    [branchId]
  );
  const connectionsByNap = new Map();
  connectionRows.forEach((row) => {
    const list = connectionsByNap.get(text(row.napId)) || [];
    list.push({
      port: positiveInt(row.port),
      customerAccountNumber: text(row.customerAccountNumber),
      customerRef: text(row.customerRef),
      customerName: text(row.customerName)
    });
    connectionsByNap.set(text(row.napId), list);
  });
  return {
    olts: oltRows.map((row) => ({
      ...row,
      ponPortNames: normalizePonPortNames(row.ponPortNames)
    })),
    naps: napRows.map((row) => ({
      ...row,
      connections: connectionsByNap.get(text(row.id)) || []
    })),
    reservations: reservationRows
  };
};

const findNearbyPonNaps = async ({
  branchId,
  latitude,
  longitude,
  limit = 3,
  maxDistanceMeters = 10000,
  includeOffline = false,
  includeUnavailable = false,
  allowExpandedLimit = false
}) => withPonBranchLock(branchId, async () => {
  let state;
  if (isJsonStorageMode()) {
    const allState = await readJson(JSON_STORE_KEY, {});
    const branch = jsonBranchState(allState, branchId);
    state = {
      olts: Array.isArray(branch.olts) ? branch.olts : [],
      naps: Array.isArray(branch.naps) ? branch.naps : [],
      reservations: Array.isArray(branch.reservations) ? branch.reservations : []
    };
  } else {
    state = await loadRelationalCandidateState(branchId);
  }
  return buildNearbyCandidates({
    state,
    latitude,
    longitude,
    limit,
    maxDistanceMeters,
    includeOffline,
    includeUnavailable,
    allowExpandedLimit
  });
});

const validateReservationInput = (input = {}) => {
  const branchId = positiveInt(input.branchId);
  const napId = text(input.napId);
  const port = positiveInt(input.port);
  const customerAccountNumber = text(input.customerAccountNumber).slice(0, 200);
  const technicianUserId = text(input.technicianUserId).slice(0, 64);
  const clientEventId = text(input.clientEventId).slice(0, 100);
  if (!branchId) throw createServiceError(400, 'Branch is required.');
  if (!napId) throw createServiceError(400, 'NAP is required.');
  if (!port) throw createServiceError(400, 'A valid port is required.');
  if (!customerAccountNumber) throw createServiceError(400, 'Customer account is required.');
  if (!technicianUserId) throw createServiceError(401, 'Technician identity is required.');
  if (!clientEventId) throw createServiceError(400, 'clientEventId is required.');
  const requestedTtl = finiteNumber(input.ttlMs, DEFAULT_RESERVATION_TTL_MS);
  const ttlMs = Math.min(Math.max(requestedTtl, 60 * 1000), MAX_RESERVATION_TTL_MS);
  return { branchId, napId, port, customerAccountNumber, technicianUserId, clientEventId, ttlMs };
};

const findCustomerConnectionInJson = (naps, accountNumber) => {
  const accountKey = keyOf(accountNumber);
  for (const nap of naps) {
    const connection = (Array.isArray(nap?.connections) ? nap.connections : []).find((entry) => (
      [entry?.customerId, entry?.customerRef, entry?.accountNumber].some((value) => keyOf(value) === accountKey)
    ));
    if (connection) return { nap, connection };
  }
  return null;
};

const publicReservation = (reservation) => ({
  reservationId: reservation.reservationId,
  napId: reservation.napId,
  port: reservation.port,
  customerAccountNumber: reservation.customerAccountNumber,
  status: reservation.status,
  expiresAt: reservation.expiresAt
});

const assertReservationCustomer = (reservation = {}, customerAccountNumber = '') => {
  const actual = text(reservation.customerAccountNumber || reservation.customer_ref);
  const expected = text(customerAccountNumber);
  if (!actual || !expected || keyOf(actual) !== keyOf(expected)) {
    throw createServiceError(409, 'Reservation does not belong to the requested customer.');
  }
  return actual;
};

const assertFinalizeEventReplay = (reservation = {}, clientEventId = '') => {
  const status = keyOf(reservation.status);
  const storedEventId = text(reservation.finalizeEventId || reservation.finalize_event_id);
  const requestedEventId = text(clientEventId);
  if (status === 'finalized' && storedEventId && storedEventId !== requestedEventId) {
    throw createServiceError(409, 'Reservation was already finalized by a different clientEventId.');
  }
};

const reservePonPortJson = async (input) => {
  const allState = await readJson(JSON_STORE_KEY, {});
  const branch = jsonBranchState(allState, input.branchId, { create: true });
  const reservations = pruneJsonReservations(branch);
  const existingEvent = reservations.find((reservation) => (
    reservation.technicianUserId === input.technicianUserId
    && reservation.clientEventId === input.clientEventId
  ));
  if (existingEvent) {
    if (
      existingEvent.napId !== input.napId
      || existingEvent.port !== input.port
      || keyOf(existingEvent.customerAccountNumber) !== keyOf(input.customerAccountNumber)
    ) {
      throw createServiceError(409, 'clientEventId was already used for a different reservation.');
    }
    return publicReservation(existingEvent);
  }
  const naps = Array.isArray(branch.naps) ? branch.naps : [];
  const nap = naps.find((entry) => text(entry?.id) === input.napId);
  if (!nap) throw createServiceError(404, 'NAP was not found.');
  const olt = (Array.isArray(branch.olts) ? branch.olts : [])
    .find((entry) => keyOf(entry?.name) === keyOf(nap?.linkedOlt));
  if (normalizeOltStatus(olt?.status) !== 'online') {
    throw createServiceError(409, 'The selected NAP is not currently serviceable.');
  }
  const capacity = napCapacity(nap);
  if (input.port > capacity) throw createServiceError(400, `Port ${input.port} is outside the NAP capacity.`);
  const assigned = findCustomerConnectionInJson(naps, input.customerAccountNumber);
  if (assigned) {
    throw createServiceError(409, 'Customer already has a NAP assignment.', {
      currentAssignment: {
        napId: text(assigned.nap?.id),
        napCode: text(assigned.nap?.code),
        port: positiveInt(assigned.connection?.port)
      }
    });
  }
  const occupied = (Array.isArray(nap.connections) ? nap.connections : [])
    .some((entry) => positiveInt(entry?.port) === input.port);
  const held = reservations.some((reservation) => (
    activeReservation(reservation)
    && reservation.napId === input.napId
    && reservation.port === input.port
  ));
  if (occupied || held) throw createServiceError(409, 'The selected port is no longer available.');
  const now = new Date();
  const reservation = sanitizeReservation({
    id: crypto.randomUUID(),
    napId: input.napId,
    port: input.port,
    customerAccountNumber: input.customerAccountNumber,
    technicianUserId: input.technicianUserId,
    clientEventId: input.clientEventId,
    status: 'active',
    expiresAt: new Date(now.getTime() + input.ttlMs),
    createdAt: now
  });
  branch.reservations.push(reservation);
  branch.updatedAt = now.toISOString();
  await writeJson(JSON_STORE_KEY, allState);
  return publicReservation(reservation);
};

const reservePonPortMysql = async (input) => {
  await ensureRelationalReservationSchema();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockRelationalPonBranch(connection, input.branchId);
    await connection.query('SELECT id FROM pon_olts WHERE branch_id = ? FOR UPDATE', [input.branchId]);
    await connection.query(
      `UPDATE pon_port_reservations
          SET status = 'expired', active_flag = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE branch_id = ? AND status = 'active' AND expires_at <= CURRENT_TIMESTAMP`,
      [input.branchId]
    );
    const [eventRows] = await connection.query(
      `SELECT r.id, n.client_uid AS napId, r.port, r.customer_ref AS customerAccountNumber,
              r.status, r.expires_at AS expiresAt
         FROM pon_port_reservations r
         INNER JOIN pon_naps n ON n.id = r.nap_id
        WHERE r.branch_id = ? AND r.technician_user_id = ? AND r.client_event_id = ?
        LIMIT 1`,
      [input.branchId, input.technicianUserId, input.clientEventId]
    );
    if (eventRows.length) {
      const existing = eventRows[0];
      if (
        text(existing.napId) !== input.napId
        || Number(existing.port) !== input.port
        || keyOf(existing.customerAccountNumber) !== keyOf(input.customerAccountNumber)
      ) {
        throw createServiceError(409, 'clientEventId was already used for a different reservation.');
      }
      await connection.commit();
      return publicReservation({
        reservationId: text(existing.id),
        napId: text(existing.napId),
        port: Number(existing.port),
        customerAccountNumber: text(existing.customerAccountNumber),
        status: keyOf(existing.status),
        expiresAt: new Date(existing.expiresAt).toISOString()
      });
    }
    const [napRows] = await connection.query(
      `SELECT n.id, n.client_uid, n.capacity, n.splitter, o.status
         FROM pon_naps n
         INNER JOIN pon_olts o ON o.id = n.olt_id
        WHERE n.branch_id = ? AND n.client_uid = ?
        LIMIT 1`,
      [input.branchId, input.napId]
    );
    if (!napRows.length) throw createServiceError(404, 'NAP was not found.');
    const nap = napRows[0];
    if (normalizeOltStatus(nap.status) !== 'online') {
      throw createServiceError(409, 'The selected NAP is not currently serviceable.');
    }
    const capacity = Math.max(positiveInt(nap.capacity, 0) || 0, splitCapacity(nap.splitter), 1);
    if (input.port > capacity) throw createServiceError(400, `Port ${input.port} is outside the NAP capacity.`);
    const [assignmentRows] = await connection.query(
      `SELECT n.client_uid AS napId, n.code AS napCode, c.port
         FROM pon_nap_connections c
         INNER JOIN pon_naps n ON n.id = c.nap_id
        WHERE n.branch_id = ?
          AND (LOWER(COALESCE(c.customer_account_number, '')) = ? OR LOWER(COALESCE(c.customer_ref, '')) = ?)
        LIMIT 1`,
      [input.branchId, keyOf(input.customerAccountNumber), keyOf(input.customerAccountNumber)]
    );
    if (assignmentRows.length) {
      throw createServiceError(409, 'Customer already has a NAP assignment.', {
        currentAssignment: assignmentRows[0]
      });
    }
    const [occupiedRows] = await connection.query(
      'SELECT id FROM pon_nap_connections WHERE nap_id = ? AND port = ? LIMIT 1',
      [nap.id, input.port]
    );
    if (occupiedRows.length) throw createServiceError(409, 'The selected port is no longer available.');
    const reservationId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + input.ttlMs);
    try {
      await connection.query(
        `INSERT INTO pon_port_reservations (
           id, branch_id, nap_id, port, customer_ref, technician_user_id,
           client_event_id, status, active_flag, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`,
        [
          reservationId,
          input.branchId,
          nap.id,
          input.port,
          input.customerAccountNumber,
          input.technicianUserId,
          input.clientEventId,
          mysqlDateTime(expiresAt)
        ]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw createServiceError(409, 'The selected port is no longer available.');
      }
      throw error;
    }
    await connection.commit();
    return publicReservation({
      reservationId,
      napId: input.napId,
      port: input.port,
      customerAccountNumber: input.customerAccountNumber,
      status: 'active',
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const reservePonPort = async (rawInput = {}) => {
  const input = validateReservationInput(rawInput);
  return withPonBranchLock(input.branchId, () => (
    isJsonStorageMode() ? reservePonPortJson(input) : reservePonPortMysql(input)
  ));
};

const releasePonPortReservationJson = async (input) => {
  const allState = await readJson(JSON_STORE_KEY, {});
  const branch = jsonBranchState(allState, input.branchId, { create: true });
  const reservations = pruneJsonReservations(branch);
  const reservation = reservations.find((entry) => entry.reservationId === input.reservationId);
  if (!reservation || reservation.technicianUserId !== input.technicianUserId) {
    throw createServiceError(404, 'Reservation was not found.');
  }
  assertReservationCustomer(reservation, input.customerAccountNumber);
  if (reservation.status === 'finalized') throw createServiceError(409, 'Finalized reservations cannot be released.');
  if (reservation.status === 'released') return { reservationId: reservation.reservationId, released: true };
  reservation.status = 'released';
  branch.updatedAt = new Date().toISOString();
  await writeJson(JSON_STORE_KEY, allState);
  return { reservationId: reservation.reservationId, released: true };
};

const releasePonPortReservationMysql = async (input) => {
  await ensureRelationalReservationSchema();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockRelationalPonBranch(connection, input.branchId);
    const [rows] = await connection.query(
      `SELECT status, customer_ref FROM pon_port_reservations
        WHERE id = ? AND branch_id = ? AND technician_user_id = ? LIMIT 1 FOR UPDATE`,
      [input.reservationId, input.branchId, input.technicianUserId]
    );
    if (!rows.length) throw createServiceError(404, 'Reservation was not found.');
    if (keyOf(rows[0].status) === 'finalized') {
      throw createServiceError(409, 'Finalized reservations cannot be released.');
    }
    assertReservationCustomer(rows[0], input.customerAccountNumber);
    await connection.query(
      `UPDATE pon_port_reservations
          SET status = 'released', active_flag = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND branch_id = ? AND technician_user_id = ?`,
      [input.reservationId, input.branchId, input.technicianUserId]
    );
    await connection.commit();
    return { reservationId: input.reservationId, released: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const releasePonPortReservation = async ({
  branchId,
  reservationId,
  technicianUserId,
  customerAccountNumber
}) => {
  const safeBranchId = positiveInt(branchId);
  const safeReservationId = text(reservationId);
  const safeTechnicianUserId = text(technicianUserId);
  const safeCustomerAccountNumber = text(customerAccountNumber).slice(0, 200);
  if (!safeBranchId || !safeReservationId || !safeTechnicianUserId || !safeCustomerAccountNumber) {
    throw createServiceError(400, 'Branch, reservation, technician, and customer account are required.');
  }
  return withPonBranchLock(safeBranchId, () => (
    isJsonStorageMode()
      ? releasePonPortReservationJson({
        branchId: safeBranchId,
        reservationId: safeReservationId,
        technicianUserId: safeTechnicianUserId,
        customerAccountNumber: safeCustomerAccountNumber
      })
      : releasePonPortReservationMysql({
        branchId: safeBranchId,
        reservationId: safeReservationId,
        technicianUserId: safeTechnicianUserId,
        customerAccountNumber: safeCustomerAccountNumber
      })
  ));
};

const assignmentPayload = (nap, connection, reservation) => ({
  napId: text(nap?.id || reservation?.napId),
  napCode: text(nap?.code),
  linkedOlt: text(nap?.linkedOlt),
  ponRef: normalizePonRef(nap?.ponRef),
  location: text(nap?.location),
  port: positiveInt(connection?.port || reservation?.port),
  customerAccountNumber: text(connection?.customerId || connection?.customerRef || reservation?.customerAccountNumber),
  opticalInfo: text(connection?.opticalInfo || reservation?.opticalInfo)
});

const finalizePonAssignmentJson = async (input) => {
  const allState = await readJson(JSON_STORE_KEY, {});
  const branch = jsonBranchState(allState, input.branchId, { create: true });
  const reservations = pruneJsonReservations(branch);
  const reservation = reservations.find((entry) => entry.reservationId === input.reservationId);
  if (!reservation || reservation.technicianUserId !== input.technicianUserId) {
    throw createServiceError(404, 'Reservation was not found.');
  }
  assertReservationCustomer(reservation, input.customerAccountNumber);
  const naps = Array.isArray(branch.naps) ? branch.naps : [];
  const nap = naps.find((entry) => text(entry?.id) === reservation.napId);
  if (!nap) throw createServiceError(404, 'NAP was not found.');
  if (reservation.status === 'finalized') {
    assertFinalizeEventReplay(reservation, input.clientEventId);
    const existing = (Array.isArray(nap.connections) ? nap.connections : [])
      .find((entry) => positiveInt(entry?.port) === reservation.port);
    return {
      reservationId: reservation.reservationId,
      duplicate: true,
      assignment: assignmentPayload(nap, existing, reservation)
    };
  }
  if (reservation.status !== 'active' || !activeReservation(reservation)) {
    throw createServiceError(409, 'Reservation has expired or is no longer active.');
  }
  const currentCustomerAssignment = findCustomerConnectionInJson(naps, reservation.customerAccountNumber);
  if (currentCustomerAssignment) {
    throw createServiceError(409, 'Customer already has a NAP assignment.', {
      currentAssignment: assignmentPayload(
        currentCustomerAssignment.nap,
        currentCustomerAssignment.connection,
        reservation
      )
    });
  }
  nap.connections = Array.isArray(nap.connections) ? nap.connections : [];
  if (nap.connections.some((entry) => positiveInt(entry?.port) === reservation.port)) {
    throw createServiceError(409, 'The reserved port is already assigned.');
  }
  const connection = {
    customerId: reservation.customerAccountNumber,
    customerName: text(input.customerName).slice(0, 200),
    customerRef: reservation.customerAccountNumber,
    port: reservation.port,
    opticalInfo: text(input.opticalInfo).slice(0, 120)
  };
  nap.connections.push(connection);
  nap.connections.sort((left, right) => Number(left.port) - Number(right.port));
  nap.used = nap.connections.length;
  reservation.status = 'finalized';
  reservation.finalizeEventId = text(input.clientEventId).slice(0, 100);
  reservation.finalizedAt = new Date().toISOString();
  reservation.opticalInfo = connection.opticalInfo;
  branch.updatedAt = reservation.finalizedAt;
  await writeJson(JSON_STORE_KEY, allState);
  return {
    reservationId: reservation.reservationId,
    duplicate: false,
    assignment: assignmentPayload(nap, connection, reservation)
  };
};

const finalizePonAssignmentMysql = async (input) => {
  await ensureRelationalReservationSchema();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockRelationalPonBranch(connection, input.branchId);
    await connection.query('SELECT id FROM pon_olts WHERE branch_id = ? FOR UPDATE', [input.branchId]);
    const [reservationRows] = await connection.query(
      `SELECT r.*, n.client_uid AS napClientId, n.code AS napCode, n.area AS location,
              n.pon_ref AS ponRef, o.name AS linkedOlt
         FROM pon_port_reservations r
         INNER JOIN pon_naps n ON n.id = r.nap_id
         INNER JOIN pon_olts o ON o.id = n.olt_id
        WHERE r.id = ? AND r.branch_id = ? AND r.technician_user_id = ?
        LIMIT 1 FOR UPDATE`,
      [input.reservationId, input.branchId, input.technicianUserId]
    );
    if (!reservationRows.length) throw createServiceError(404, 'Reservation was not found.');
    const reservation = reservationRows[0];
    assertReservationCustomer(reservation, input.customerAccountNumber);
    const nap = {
      id: text(reservation.napClientId),
      code: text(reservation.napCode),
      location: text(reservation.location),
      ponRef: text(reservation.ponRef),
      linkedOlt: text(reservation.linkedOlt)
    };
    if (keyOf(reservation.status) === 'finalized') {
      assertFinalizeEventReplay(reservation, input.clientEventId);
      const [existingRows] = await connection.query(
        `SELECT port, customer_account_number AS customerId, customer_ref AS customerRef,
                customer_name AS customerName, optical_info AS opticalInfo
           FROM pon_nap_connections WHERE nap_id = ? AND port = ? LIMIT 1`,
        [reservation.nap_id, reservation.port]
      );
      await connection.commit();
      return {
        reservationId: input.reservationId,
        duplicate: true,
        assignment: assignmentPayload(nap, existingRows[0], {
          napId: nap.id,
          port: reservation.port,
          customerAccountNumber: reservation.customer_ref,
          opticalInfo: reservation.optical_info
        })
      };
    }
    if (
      keyOf(reservation.status) !== 'active'
      || new Date(reservation.expires_at).getTime() <= Date.now()
    ) {
      throw createServiceError(409, 'Reservation has expired or is no longer active.');
    }
    const accountKey = keyOf(reservation.customer_ref);
    const [customerAssignmentRows] = await connection.query(
      `SELECT n.client_uid AS napId, n.code AS napCode, c.port
         FROM pon_nap_connections c
         INNER JOIN pon_naps n ON n.id = c.nap_id
        WHERE n.branch_id = ?
          AND (LOWER(COALESCE(c.customer_account_number, '')) = ? OR LOWER(COALESCE(c.customer_ref, '')) = ?)
        LIMIT 1`,
      [input.branchId, accountKey, accountKey]
    );
    if (customerAssignmentRows.length) {
      throw createServiceError(409, 'Customer already has a NAP assignment.', {
        currentAssignment: customerAssignmentRows[0]
      });
    }
    const [occupiedRows] = await connection.query(
      'SELECT id FROM pon_nap_connections WHERE nap_id = ? AND port = ? LIMIT 1',
      [reservation.nap_id, reservation.port]
    );
    if (occupiedRows.length) throw createServiceError(409, 'The reserved port is already assigned.');
    const [customerRows] = await connection.query(
      'SELECT account_number FROM customers WHERE branch_id = ? AND account_number = ? LIMIT 1',
      [input.branchId, reservation.customer_ref]
    );
    const canonicalAccountNumber = customerRows.length ? reservation.customer_ref : null;
    const opticalInfo = text(input.opticalInfo).slice(0, 120);
    await connection.query(
      `INSERT INTO pon_nap_connections (
         nap_id, customer_account_number, customer_name, customer_ref, port, optical_info
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        reservation.nap_id,
        canonicalAccountNumber,
        text(input.customerName).slice(0, 200) || null,
        reservation.customer_ref,
        reservation.port,
        opticalInfo || null
      ]
    );
    await connection.query(
      `UPDATE pon_naps
          SET used = (SELECT COUNT(*) FROM pon_nap_connections WHERE nap_id = ?),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [reservation.nap_id, reservation.nap_id]
    );
    try {
      await connection.query(
        `UPDATE pon_port_reservations
            SET status = 'finalized', active_flag = NULL, finalize_event_id = ?,
                optical_info = ?, finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [text(input.clientEventId).slice(0, 100) || null, opticalInfo || null, input.reservationId]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw createServiceError(409, 'clientEventId was already used to finalize another assignment.');
      }
      throw error;
    }
    await connection.commit();
    return {
      reservationId: input.reservationId,
      duplicate: false,
      assignment: assignmentPayload(nap, {
        port: reservation.port,
        customerId: canonicalAccountNumber,
        customerRef: reservation.customer_ref,
        customerName: input.customerName,
        opticalInfo
      }, {
        napId: nap.id,
        port: reservation.port,
        customerAccountNumber: reservation.customer_ref,
        opticalInfo
      })
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

const finalizePonAssignment = async (rawInput = {}) => {
  const branchId = positiveInt(rawInput.branchId);
  const reservationId = text(rawInput.reservationId);
  const technicianUserId = text(rawInput.technicianUserId).slice(0, 64);
  const clientEventId = text(rawInput.clientEventId).slice(0, 100);
  const customerAccountNumber = text(rawInput.customerAccountNumber).slice(0, 200);
  if (!branchId || !reservationId || !technicianUserId || !clientEventId || !customerAccountNumber) {
    throw createServiceError(
      400,
      'Branch, reservation, technician, customer account, and clientEventId are required.'
    );
  }
  const input = {
    branchId,
    reservationId,
    technicianUserId,
    clientEventId,
    customerAccountNumber,
    customerName: text(rawInput.customerName),
    opticalInfo: text(rawInput.opticalInfo)
  };
  return withPonBranchLock(branchId, () => (
    isJsonStorageMode() ? finalizePonAssignmentJson(input) : finalizePonAssignmentMysql(input)
  ));
};

module.exports = {
  DEFAULT_RESERVATION_TTL_MS,
  createServiceError,
  parseCoordinate,
  haversineMeters,
  buildNearbyCandidates,
  assertReservationCustomer,
  assertFinalizeEventReplay,
  withPonBranchLock,
  lockRelationalPonBranch,
  ensureRelationalReservationSchema,
  findNearbyPonNaps,
  reservePonPort,
  releasePonPortReservation,
  finalizePonAssignment
};
