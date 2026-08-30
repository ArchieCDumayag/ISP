const crypto = require('crypto');
const express = require('express');
const { getPool } = require('../../../../core/data/db');
const { assertRelationalReady } = require('../../../../core/data/db-relational');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { isJsonStorageMode } = require('../../../../core/config/storage-mode');
const { loadBranchActivePppoeLookup } = require('./mikrotik');
const { readCoverage } = require('../../customer-management/backend/api_coverage');
const { readVisibleCustomers: readCustomers, sanitizeCustomerForAdmin } = require('../../customer-management/backend/customers');
const {
  withPonBranchLock,
  ensureRelationalReservationSchema
} = require('./pon-serviceability');

const router = express.Router();
const MAX_OLTS = 400;
const MAX_NAPS = 4000;
const MAX_CONNECTIONS_PER_NAP = 128;
const ALLOWED_SPLITTERS = new Set(['1:8', '1:16', '1:24', '1:32']);
const REQUIRED_PON_TABLES = ['pon_olts', 'pon_naps', 'pon_nap_connections'];
const LIVE_PPPOE_LOOKUP_TIMEOUT_MS = 2500;
const JSON_STORE_KEY = 'pon-state';
let tempNetworkCustomersProvider = null;

const configureTempNetworkCustomersProvider = (provider) => {
  tempNetworkCustomersProvider = typeof provider === 'function' ? provider : null;
};

const toText = (value) => String(value || '').trim();
const normalizeNameKey = (value) => toText(value).toLowerCase();

const makeError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toPositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizePonTechnology = (value) => {
  const raw = toText(value).toLowerCase();
  if (raw.includes('gpon')) return 'gpon';
  return 'epon';
};
const normalizePonCodePrefix = (value) => {
  const cleaned = toText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'PON';
};

const getPonCapacityByTechnology = (value) => (normalizePonTechnology(value) === 'gpon' ? 128 : 64);

const normalizeOltStatus = (value) => {
  const raw = toText(value).toLowerCase();
  if (!raw) return 'maintenance';
  if (['online', 'up', 'active', 'connected'].includes(raw)) return 'online';
  if (['offline', 'down', 'inactive', 'disconnected'].includes(raw)) return 'offline';
  return 'maintenance';
};

const normalizeSplitter = (value) => {
  const raw = toText(value).replace('/', ':');
  if (ALLOWED_SPLITTERS.has(raw)) return raw;
  return '1:16';
};

const getSplitCapacity = (splitter) => {
  const parts = normalizeSplitter(splitter).split(':');
  const parsed = Number(parts[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 16;
};

const normalizePonRef = (value) => {
  const raw = toText(value);
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const ponMatch = compact.match(/^pon-?(\d+)$/i);
  if (ponMatch) return `PON-${Number(ponMatch[1])}`;
  if (/^\d+$/.test(compact)) return `PON-${Number(compact)}`;
  return raw;
};

const normalizePonPortNames = (value, totalPorts = 0) => {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = {};
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  const maxPorts = clamp(toNonNegativeInt(totalPorts, 0), 0, 4096);
  const normalized = {};
  Object.entries(source).forEach(([key, label]) => {
    const ponRef = normalizePonRef(key);
    if (!ponRef) return;
    const orderMatch = ponRef.match(/^pon-(\d+)$/i);
    const order = orderMatch ? Number(orderMatch[1]) : null;
    if (maxPorts && Number.isInteger(order) && order > maxPorts) return;

    const displayName = toText(label).slice(0, 80);
    if (!displayName || displayName.toLowerCase() === ponRef.toLowerCase()) return;
    normalized[ponRef] = displayName;
  });
  return normalized;
};

const getPonPortDisplayName = (olt, ponRef) => {
  const normalizedRef = normalizePonRef(ponRef);
  if (!normalizedRef) return '';
  const names = normalizePonPortNames(olt?.ponPortNames, olt?.ponPorts);
  return toText(names[normalizedRef]) || normalizedRef;
};

const normalizeLookupKey = (value) => toText(value).toLowerCase();
const normalizeSubscriberStatus = (value) => {
  const raw = toText(value).toLowerCase();
  if (['online', 'up', 'active', 'connected'].includes(raw)) return 'online';
  if (['offline', 'down', 'inactive', 'disconnected'].includes(raw)) return 'offline';
  return '';
};

const branchIdFromRequest = (req) => {
  const branchId = toPositiveInt(req.user?.branchId);
  if (!branchId) {
    throw makeError('Branch context is required.', 400);
  }
  return branchId;
};

const resolveConnectionSubscriberStatus = (entry, customerPppoeByAccount, livePppoeLookup) => {
  if (!livePppoeLookup?.available) return '';
  const accountCandidates = [
    toText(entry?.customerId),
    toText(entry?.customerRef)
  ].filter(Boolean);
  let pppoeUsername = '';
  for (const accountNumber of accountCandidates) {
    const mapped = toText(customerPppoeByAccount.get(accountNumber));
    if (mapped) {
      pppoeUsername = mapped;
      break;
    }
  }
  if (!pppoeUsername) return 'offline';
  const usernameKey = normalizeLookupKey(pppoeUsername);
  if (!usernameKey) return 'offline';
  return livePppoeLookup.usernamesLower.has(usernameKey) ? 'online' : 'offline';
};

const placeholders = (count) => Array.from({ length: count }, () => '?').join(', ');
const isMissingPonTableError = (error) =>
  Boolean(error) && (
    error.code === 'ER_NO_SUCH_TABLE' ||
    /doesn't exist/i.test(String(error.message || ''))
  );

const hasPonTables = async () => {
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (${placeholders(REQUIRED_PON_TABLES.length)})`,
    REQUIRED_PON_TABLES
  );
  const found = new Set(
    (rows || []).map((row) => toText(row.table_name || row.TABLE_NAME).toLowerCase())
  );
  return REQUIRED_PON_TABLES.every((name) => found.has(name));
};
let ponMetadataColumnsReady = false;

const withTimeout = async (promise, timeoutMs, fallbackValue) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const ensurePonCodePrefixColumn = async () => {
  if (ponMetadataColumnsReady) return;
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'pon_olts'
       AND column_name IN ('pon_code_prefix', 'pon_port_names_json')`
  );
  const columns = new Set((rows || []).map((row) => toText(row.column_name).toLowerCase()));
  if (!columns.has('pon_code_prefix')) {
    try {
      await pool.query(
        `ALTER TABLE pon_olts
         ADD COLUMN pon_code_prefix VARCHAR(40) NOT NULL DEFAULT 'PON' AFTER pon_ports`
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') {
        throw error;
      }
    }
  }
  if (!columns.has('pon_port_names_json')) {
    try {
      await pool.query(
        `ALTER TABLE pon_olts
         ADD COLUMN pon_port_names_json LONGTEXT NULL AFTER pon_code_prefix`
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  ponMetadataColumnsReady = true;
};

const normalizeConnection = (raw) => {
  const port = toPositiveInt(raw?.port || raw?.customerPort || raw?.slot);
  if (!port) return null;
  const customerId = toText(raw?.customerId || raw?.accountNumber || raw?.id);
  const customerName = toText(raw?.customerName || raw?.name || raw?.customer);
  const customerRef = toText(raw?.customerRef || customerId || customerName);
  if (!customerRef && !customerId && !customerName) return null;
  const opticalInfo = toText(raw?.opticalInfo || raw?.optical || raw?.signal || raw?.rxPower || '');
  return {
    port,
    customerId,
    customerName,
    customerRef: customerRef || customerId || customerName,
    opticalInfo
  };
};

const normalizeOltRecord = (raw, index) => {
  const id = toText(raw?.id) || `olt-${Date.now()}-${index}`;
  const name = toText(raw?.name);
  if (!name) {
    throw makeError(`OLT name is required (record ${index + 1}).`);
  }
  const ponPorts = clamp(toNonNegativeInt(raw?.ponPorts, 0), 0, 4096);
  return {
    id,
    name,
    technology: normalizePonTechnology(raw?.technology || raw?.vendor),
    site: toText(raw?.site),
    status: normalizeOltStatus(raw?.status),
    ponCodePrefix: normalizePonCodePrefix(raw?.ponCodePrefix || raw?.pon_code_prefix),
    ponPorts,
    ponPortNames: normalizePonPortNames(raw?.ponPortNames || raw?.pon_port_names, ponPorts)
  };
};

const normalizeNapRecord = (raw, index) => {
  const id = toText(raw?.id) || `nap-${Date.now()}-${index}`;
  const code = toText(raw?.code).toUpperCase();
  const linkedOlt = toText(raw?.linkedOlt);
  const ponRef = normalizePonRef(raw?.ponRef);
  if (!code) {
    throw makeError(`NAP code is required (record ${index + 1}).`);
  }
  if (!linkedOlt) {
    throw makeError(`Linked OLT is required for NAP ${code}.`);
  }
  if (!ponRef) {
    throw makeError(`PON reference is required for NAP ${code}.`);
  }

  const splitter = normalizeSplitter(raw?.splitter);
  const connectionsRaw = Array.isArray(raw?.connections) ? raw.connections : [];
  const normalizedConnectionsMap = new Map();
  connectionsRaw.forEach((entry) => {
    const normalized = normalizeConnection(entry);
    if (!normalized) return;
    normalizedConnectionsMap.set(normalized.port, normalized);
  });
  const connections = [...normalizedConnectionsMap.values()]
    .sort((a, b) => a.port - b.port)
    .slice(0, MAX_CONNECTIONS_PER_NAP);

  const parsedCapacity = toPositiveInt(raw?.capacity);
  const capacityBase = parsedCapacity || getSplitCapacity(splitter);
  const capacity = Math.max(capacityBase, connections.length || 1);
  const usedInput = Number(raw?.used);
  const used = clamp(
    Number.isFinite(usedInput) ? Math.round(usedInput) : connections.length,
    0,
    capacity
  );

  return {
    id,
    code,
    location: toText(raw?.location),
    coordinate: toText(raw?.coordinate || raw?.coordinates || raw?.coords),
    splitter,
    linkedOlt,
    ponRef,
    ponCapacity: clamp(toPositiveInt(raw?.ponCapacity, 64), 1, 100000),
    capacity,
    used,
    opticalPower: toText(raw?.opticalPower || raw?.opticalInfo || raw?.signal || raw?.rxPower),
    connections
  };
};

const normalizePayload = (payload) => {
  const rawOlts = Array.isArray(payload?.olts) ? payload.olts : [];
  const rawNaps = Array.isArray(payload?.naps) ? payload.naps : [];
  if (rawOlts.length > MAX_OLTS) {
    throw makeError(`Maximum OLT records exceeded (${MAX_OLTS}).`);
  }
  if (rawNaps.length > MAX_NAPS) {
    throw makeError(`Maximum NAP records exceeded (${MAX_NAPS}).`);
  }

  const olts = rawOlts.map((row, index) => normalizeOltRecord(row, index));
  const naps = rawNaps.map((row, index) => normalizeNapRecord(row, index));

  const seenOltIds = new Set();
  const seenOltNames = new Set();
  olts.forEach((olt) => {
    const idKey = normalizeNameKey(olt.id);
    const nameKey = normalizeNameKey(olt.name);
    if (!idKey || seenOltIds.has(idKey)) {
      throw makeError(`Duplicate OLT id detected: ${olt.id}`);
    }
    if (!nameKey || seenOltNames.has(nameKey)) {
      throw makeError(`Duplicate OLT name detected: ${olt.name}`);
    }
    seenOltIds.add(idKey);
    seenOltNames.add(nameKey);
  });

  const seenNapIds = new Set();
  const seenNapCodes = new Set();
  naps.forEach((nap) => {
    const idKey = normalizeNameKey(nap.id);
    const codeKey = normalizeNameKey(nap.code);
    if (!idKey || seenNapIds.has(idKey)) {
      throw makeError(`Duplicate NAP id detected: ${nap.id}`);
    }
    if (!codeKey || seenNapCodes.has(codeKey)) {
      throw makeError(`Duplicate NAP code detected: ${nap.code}`);
    }
    if (!seenOltNames.has(normalizeNameKey(nap.linkedOlt))) {
      throw makeError(`NAP ${nap.code} references unknown OLT: ${nap.linkedOlt}`);
    }
    seenNapIds.add(idKey);
    seenNapCodes.add(codeKey);
  });

  return { olts, naps };
};

const sortByCanonicalJson = (left, right) => (
  JSON.stringify(left).localeCompare(JSON.stringify(right))
);

const canonicalPonRevisionState = (state = {}) => {
  const olts = (Array.isArray(state?.olts) ? state.olts : [])
    .map((raw) => {
      const ponPorts = clamp(toNonNegativeInt(raw?.ponPorts ?? raw?.pon_ports, 0), 0, 4096);
      const ponPortNames = normalizePonPortNames(
        raw?.ponPortNames ?? raw?.pon_port_names_json ?? raw?.pon_port_names,
        ponPorts
      );
      return {
        id: toText(raw?.id ?? raw?.client_uid),
        name: toText(raw?.name),
        technology: normalizePonTechnology(raw?.technology),
        site: toText(raw?.site),
        status: normalizeOltStatus(raw?.status),
        ponCodePrefix: normalizePonCodePrefix(raw?.ponCodePrefix ?? raw?.pon_code_prefix),
        ponPorts,
        ponPortNames: Object.fromEntries(
          Object.entries(ponPortNames).sort(([left], [right]) => left.localeCompare(right))
        )
      };
    })
    .sort(sortByCanonicalJson);

  const naps = (Array.isArray(state?.naps) ? state.naps : [])
    .map((raw) => {
      const connections = (Array.isArray(raw?.connections) ? raw.connections : [])
        .map(normalizeConnection)
        .filter(Boolean)
        .sort(sortByCanonicalJson);
      return {
        id: toText(raw?.id ?? raw?.client_uid),
        code: toText(raw?.code).toUpperCase(),
        location: toText(raw?.location ?? raw?.area),
        coordinate: toText(raw?.coordinate ?? raw?.coordinates ?? raw?.coords),
        splitter: normalizeSplitter(raw?.splitter),
        linkedOlt: toText(raw?.linkedOlt ?? raw?.linked_olt),
        ponRef: normalizePonRef(raw?.ponRef ?? raw?.pon_ref),
        ponCapacity: clamp(toPositiveInt(raw?.ponCapacity ?? raw?.pon_capacity, 64), 1, 100000),
        capacity: Math.max(toNonNegativeInt(raw?.capacity, 0), 0),
        used: Math.max(toNonNegativeInt(raw?.used, 0), 0),
        opticalPower: toText(raw?.opticalPower ?? raw?.optical_power),
        connections
      };
    })
    .sort(sortByCanonicalJson);

  return { olts, naps };
};

const createPonStateRevision = (state = {}) => {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPonRevisionState(state)))
    .digest('hex');
  return `pon-v1-${digest}`;
};

const createPonRevisionConflict = (currentRevision) => {
  const error = makeError(
    'PON data changed after this page was loaded. Reload the latest state and retry your change.',
    409
  );
  error.code = 'PON_STATE_CONFLICT';
  error.currentRevision = currentRevision;
  return error;
};

const assertExpectedPonRevision = (expectedRevision, currentRevision) => {
  const expected = toText(expectedRevision);
  if (!expected) {
    const error = makeError('expectedRevision is required when saving PON state.', 428);
    error.code = 'PON_REVISION_REQUIRED';
    throw error;
  }
  if (expected !== currentRevision) {
    throw createPonRevisionConflict(currentRevision);
  }
  return currentRevision;
};

const createActiveReservationConflict = (reservation = {}, reason = '') => {
  const napId = toText(reservation?.napId ?? reservation?.nap_id);
  const port = toPositiveInt(reservation?.port);
  const location = [napId ? `NAP ${napId}` : 'the reserved NAP', port ? `port ${port}` : '']
    .filter(Boolean)
    .join(' ');
  const error = makeError(
    reason || `${location} is held for a submitted technician draft. Finalize, reassign, reject, or delete that draft before changing it.`,
    409
  );
  error.code = 'PON_ACTIVE_RESERVATION_CONFLICT';
  error.reservationConflict = {
    reservationId: toText(reservation?.reservationId ?? reservation?.id),
    napId,
    port,
    expiresAt: reservation?.expiresAt ?? reservation?.expires_at ?? null
  };
  return error;
};

const activeReservationRows = (reservations = [], nowMs = Date.now()) => (
  (Array.isArray(reservations) ? reservations : []).filter((reservation) => {
    const status = toText(reservation?.status || 'active').toLowerCase();
    if (status === 'draft-held') return true;
    const expiresAtMs = new Date(reservation?.expiresAt ?? reservation?.expires_at ?? 0).getTime();
    return status === 'active' && Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  })
);

const assertActiveReservationCompatibility = (reservations = [], naps = [], { nowMs = Date.now() } = {}) => {
  const napById = new Map(
    (Array.isArray(naps) ? naps : []).map((nap) => [toText(nap?.id ?? nap?.client_uid), nap])
  );
  const active = activeReservationRows(reservations, nowMs);
  active.forEach((reservation) => {
    const napId = toText(reservation?.napId ?? reservation?.nap_id);
    const port = toPositiveInt(reservation?.port);
    const nap = napById.get(napId);
    if (!nap) {
      throw createActiveReservationConflict(
        reservation,
        `${napId ? `NAP ${napId}` : 'A NAP'} has an active technician reservation and cannot be removed yet.`
      );
    }
    const capacity = Math.max(
      getSplitCapacity(nap?.splitter),
      toNonNegativeInt(nap?.capacity, 0),
      1
    );
    if (!port || port > capacity) {
      throw createActiveReservationConflict(
        reservation,
        `NAP ${napId} cannot be reduced below its actively reserved port ${port || ''}.`.trim()
      );
    }
    const portOccupied = (Array.isArray(nap?.connections) ? nap.connections : [])
      .some((connection) => toPositiveInt(connection?.port) === port);
    if (portOccupied) {
      throw createActiveReservationConflict(
        reservation,
        `NAP ${napId} port ${port} is temporarily reserved by a technician and cannot be assigned from PON Management.`
      );
    }
  });
  return active.length;
};

const getJsonScopedState = (allState, branchId) => (
  allState?.branches?.[String(branchId)] || allState?.default || {}
);

const loadRelationalRevisionSnapshot = async (queryable, branchId, { lockRows = false } = {}) => {
  const lockClause = lockRows ? ' FOR UPDATE' : '';
  const [oltsRows] = await queryable.query(
    `SELECT client_uid AS id, name, technology, site, status,
            pon_ports AS ponPorts, pon_code_prefix AS ponCodePrefix,
            pon_port_names_json AS ponPortNames
       FROM pon_olts
      WHERE branch_id = ?
      ORDER BY id ASC${lockClause}`,
    [branchId]
  );
  const [napRows] = await queryable.query(
    `SELECT n.id AS databaseId, n.client_uid AS id, n.code, n.area AS location,
            n.coordinate, n.splitter, n.pon_ref AS ponRef, n.pon_capacity AS ponCapacity,
            n.capacity, n.used, n.optical_power AS opticalPower, o.name AS linkedOlt
       FROM pon_naps n
       INNER JOIN pon_olts o ON o.id = n.olt_id
      WHERE n.branch_id = ?
      ORDER BY n.id ASC${lockClause}`,
    [branchId]
  );
  const [connectionRows] = await queryable.query(
    `SELECT c.nap_id AS napDatabaseId, c.customer_account_number AS customerId,
            c.customer_name AS customerName, c.customer_ref AS customerRef,
            c.port, c.optical_info AS opticalInfo
       FROM pon_nap_connections c
       INNER JOIN pon_naps n ON n.id = c.nap_id
      WHERE n.branch_id = ?
      ORDER BY c.nap_id ASC, c.port ASC${lockClause}`,
    [branchId]
  );
  const connectionsByNapId = new Map();
  (connectionRows || []).forEach((row) => {
    const key = Number(row.napDatabaseId);
    const rows = connectionsByNapId.get(key) || [];
    rows.push(row);
    connectionsByNapId.set(key, rows);
  });
  return {
    olts: oltsRows || [],
    naps: (napRows || []).map((nap) => ({
      ...nap,
      connections: connectionsByNapId.get(Number(nap.databaseId)) || []
    }))
  };
};

const loadState = async (branchId) => {
  if (isJsonStorageMode()) {
    const allState = await readJson(JSON_STORE_KEY, {});
    const scoped = getJsonScopedState(allState, branchId);
    const olts = Array.isArray(scoped?.olts) ? scoped.olts : [];
    const naps = Array.isArray(scoped?.naps) ? scoped.naps : [];
    return {
      olts,
      naps,
      revision: createPonStateRevision({ olts, naps }),
      schemaReady: true,
      storageDriver: 'json',
      subscriberStatusAvailable: false
    };
  }

  const pool = await getPool();
  await ensurePonCodePrefixColumn();
  const [oltsRows] = await pool.query(
    `SELECT client_uid, name, technology, site, status, pon_ports, pon_code_prefix, pon_port_names_json
     FROM pon_olts
     WHERE branch_id = ?
     ORDER BY id ASC`,
    [branchId]
  );
  const [napRows] = await pool.query(
    `SELECT n.id, n.client_uid, n.code, n.area, n.coordinate, n.splitter, n.pon_ref,
            n.pon_capacity, n.capacity, n.used, n.optical_power, o.name AS linked_olt
     FROM pon_naps n
     INNER JOIN pon_olts o ON o.id = n.olt_id
     WHERE n.branch_id = ?
     ORDER BY n.id DESC`,
    [branchId]
  );
  const [connectionRows] = await pool.query(
    `SELECT c.nap_id, c.customer_account_number, c.customer_name, c.customer_ref, c.port, c.optical_info
     FROM pon_nap_connections c
     INNER JOIN pon_naps n ON n.id = c.nap_id
     WHERE n.branch_id = ?
     ORDER BY c.nap_id ASC, c.port ASC`,
    [branchId]
  );
  const [customerRows] = await pool.query(
    `SELECT account_number, pppoe_username
     FROM customers
     WHERE branch_id = ?`,
    [branchId]
  );

  let livePppoeLookup = {
    available: false,
    usernames: new Set(),
    usernamesLower: new Set(),
    routerIds: [],
    reason: 'unavailable'
  };
  try {
    livePppoeLookup = await withTimeout(
      loadBranchActivePppoeLookup(branchId),
      LIVE_PPPOE_LOOKUP_TIMEOUT_MS,
      {
        available: false,
        usernames: new Set(),
        usernamesLower: new Set(),
        routerIds: [],
        reason: 'timeout'
      }
    );
  } catch {
    // Leave live subscriber metrics unavailable when MikroTik lookup fails.
  }

  const byNapId = new Map();
  (connectionRows || []).forEach((row) => {
    const key = Number(row.nap_id);
    if (!byNapId.has(key)) byNapId.set(key, []);
    byNapId.get(key).push({
      customerId: toText(row.customer_account_number),
      customerName: toText(row.customer_name),
      customerRef: toText(row.customer_ref),
      port: toPositiveInt(row.port),
      opticalInfo: toText(row.optical_info)
    });
  });

  const customerPppoeByAccount = new Map();
  (customerRows || []).forEach((row) => {
    const accountNumber = toText(row.account_number);
    if (!accountNumber) return;
    customerPppoeByAccount.set(accountNumber, toText(row.pppoe_username));
  });

  const olts = (oltsRows || []).map((row) => ({
    id: toText(row.client_uid),
    name: toText(row.name),
    technology: normalizePonTechnology(row.technology),
    site: toText(row.site),
    status: normalizeOltStatus(row.status),
    ponCodePrefix: normalizePonCodePrefix(row.pon_code_prefix),
    ponPorts: clamp(toNonNegativeInt(row.pon_ports, 0), 0, 4096),
    ponPortNames: normalizePonPortNames(row.pon_port_names_json, row.pon_ports)
  }));

  const naps = (napRows || []).map((row) => {
    const connections = (byNapId.get(Number(row.id)) || [])
      .filter((entry) => entry.port)
      .map((entry) => ({
        ...entry,
        subscriberStatus: resolveConnectionSubscriberStatus(entry, customerPppoeByAccount, livePppoeLookup)
      }));
    const splitter = normalizeSplitter(row.splitter);
    const baseCapacity = toPositiveInt(row.capacity, getSplitCapacity(splitter));
    const highestAssignedPort = connections.reduce((max, entry) => Math.max(max, toPositiveInt(entry.port, 0) || 0), 0);
    const totalPorts = Math.max(getSplitCapacity(splitter), baseCapacity, highestAssignedPort);
    const usedPorts = Math.max(toNonNegativeInt(row.used, 0), connections.length);
    const subscriberStatusAvailable = Boolean(livePppoeLookup?.available);
    let onlineSubscribers = null;
    let offlineSubscribers = null;

    if (subscriberStatusAvailable) {
      let onlineCount = 0;
      let offlineCount = 0;
      connections.forEach((entry) => {
        const subscriberStatus = normalizeSubscriberStatus(entry.subscriberStatus);
        if (subscriberStatus === 'online') {
          onlineCount += 1;
          return;
        }
        if (subscriberStatus === 'offline') {
          offlineCount += 1;
        }
      });
      onlineSubscribers = onlineCount;
      offlineSubscribers = offlineCount;
    }

    return {
      id: toText(row.client_uid),
      code: toText(row.code),
      location: toText(row.area),
      coordinate: toText(row.coordinate),
      splitter,
      linkedOlt: toText(row.linked_olt),
      ponRef: normalizePonRef(row.pon_ref),
      ponCapacity: toPositiveInt(row.pon_capacity, 64),
      capacity: baseCapacity,
      used: toPositiveInt(row.used, 0),
      opticalPower: toText(row.optical_power),
      connections,
      totalPorts,
      usedPorts,
      availablePorts: Math.max(totalPorts - usedPorts, 0),
      onlineSubscribers,
      offlineSubscribers,
      subscriberStatusAvailable,
      ports: buildNapPortEntries({
        splitter,
        capacity: baseCapacity,
        connections,
        subscriberStatusAvailable
      })
    };
  });

  return {
    olts,
    naps,
    revision: createPonStateRevision({ olts, naps }),
    subscriberStatusAvailable: Boolean(livePppoeLookup?.available),
    activePppoeUsernames: livePppoeLookup?.available ? [...livePppoeLookup.usernames] : []
  };
};

const getNapEffectiveUsed = (nap = {}) => {
  const capacity = Math.max(toNonNegativeInt(nap?.capacity, 0), 0);
  const storedUsed = clamp(Math.max(toNonNegativeInt(nap?.used, 0), 0), 0, capacity || Number.MAX_SAFE_INTEGER);
  const connectedCount = Array.isArray(nap?.connections) ? nap.connections.length : 0;
  return Math.max(storedUsed, connectedCount);
};

const buildNapPortEntries = (nap = {}) => {
  const splitterCapacity = getSplitCapacity(nap?.splitter);
  const configuredCapacity = Math.max(toNonNegativeInt(nap?.capacity, 0), 0);
  const connections = Array.isArray(nap?.connections) ? nap.connections : [];
  const highestAssignedPort = connections.reduce(
    (max, entry) => Math.max(max, toPositiveInt(entry?.port, 0) || 0),
    0
  );
  const totalPorts = Math.max(splitterCapacity, configuredCapacity, highestAssignedPort, 1);
  const subscriberStatusAvailable = Boolean(nap?.subscriberStatusAvailable);
  const connectionByPort = new Map();

  connections.forEach((entry) => {
    const port = toPositiveInt(entry?.port, 0);
    if (!port) return;
    connectionByPort.set(port, entry);
  });

  return Array.from({ length: totalPorts }, (_, index) => {
    const port = index + 1;
    const entry = connectionByPort.get(port);
    const opticalInfo = toText(entry?.opticalInfo || entry?.opticalPower || (entry ? nap?.opticalPower : ''));
    const subscriberStatus = normalizeSubscriberStatus(entry?.subscriberStatus);
    return {
      port,
      portLabel: `Port-${String(port).padStart(2, '0')}`,
      occupied: Boolean(entry),
      assignmentStatus: entry ? 'used' : 'empty',
      customerId: toText(entry?.customerId),
      customerName: toText(entry?.customerName),
      customerRef: toText(entry?.customerRef),
      workspace: toText(entry?.workspace),
      readOnly: entry?.readOnly === true,
      opticalInfo,
      opticalPower: opticalInfo,
      subscriberStatus: subscriberStatusAvailable ? (subscriberStatus || 'offline') : '',
      status: entry
        ? (subscriberStatusAvailable ? (subscriberStatus || 'offline') : 'assigned')
        : 'empty'
    };
  });
};

const mergeTempNetworkAssignments = (state = {}, tempCustomers = []) => {
  const naps = (Array.isArray(state?.naps) ? state.naps : []).map((nap) => ({
    ...nap,
    connections: Array.isArray(nap?.connections) ? nap.connections.map((entry) => ({ ...entry })) : []
  }));
  const napById = new Map(naps.map((nap) => [toText(nap?.id), nap]));
  const napByCode = new Map(naps.map((nap) => [normalizeNameKey(nap?.code), nap]));

  (Array.isArray(tempCustomers) ? tempCustomers : []).forEach((customer) => {
    const nap = napById.get(toText(customer?.napId))
      || napByCode.get(normalizeNameKey(customer?.napCode));
    const port = toPositiveInt(customer?.napPort);
    if (!nap || !port) return;
    const occupied = nap.connections.some((connection) => toPositiveInt(connection?.port) === port);
    if (occupied) return;
    nap.connections.push({
      customerId: toText(customer?.accountNumber),
      customerName: toText(customer?.name),
      customerRef: toText(customer?.accountNumber) || toText(customer?.name),
      port,
      opticalInfo: '',
      subscriberStatus: '',
      workspace: 'temp',
      readOnly: true
    });
    nap.connections.sort((left, right) => toPositiveInt(left?.port, 0) - toPositiveInt(right?.port, 0));
  });

  naps.forEach((nap) => {
    const totalPorts = Math.max(
      getSplitCapacity(nap?.splitter),
      toNonNegativeInt(nap?.capacity, 0),
      nap.connections.reduce((highest, connection) => (
        Math.max(highest, toPositiveInt(connection?.port, 0) || 0)
      ), 0),
      1
    );
    const usedPorts = Math.max(toNonNegativeInt(nap?.used, 0), nap.connections.length);
    nap.totalPorts = totalPorts;
    nap.usedPorts = usedPorts;
    nap.availablePorts = Math.max(totalPorts - usedPorts, 0);
    nap.ports = buildNapPortEntries(nap);
  });
  return { ...state, naps };
};

const getPonRefOrder = (value) => {
  const normalized = normalizePonRef(value);
  const match = normalized.match(/^pon-(\d+)$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]);
};

const buildPortList = (olts = [], naps = []) => {
  const groups = [];

  (Array.isArray(olts) ? olts : []).forEach((olt) => {
    const map = new Map();
    const linkedOlt = toText(olt?.name);
    if (!linkedOlt) return;

    const oltId = toText(olt?.id);
    const totalPorts = Math.max(toNonNegativeInt(olt?.ponPorts, 0), 0);
    const defaultPonCapacity = getPonCapacityByTechnology(olt?.technology);

    for (let port = 1; port <= totalPorts; port += 1) {
      const ponRef = `PON-${port}`;
      const key = `${linkedOlt}||${ponRef}`;
      map.set(key, {
        key,
        oltId,
        linkedOlt,
        ponRef,
        ponPortName: getPonPortDisplayName(olt, ponRef),
        ponPortNo: port,
        ponCapacity: defaultPonCapacity,
        napCount: 0,
        totalCapacity: 0,
        totalUsed: 0,
        totalCustomers: 0,
        napIds: [],
        napCodes: [],
        naps: []
      });
    }

    (Array.isArray(naps) ? naps : []).forEach((nap) => {
      if (normalizeNameKey(nap?.linkedOlt) !== normalizeNameKey(linkedOlt)) return;
      const ponRef = normalizePonRef(nap?.ponRef) || 'PON-?';
      const key = `${linkedOlt}||${ponRef}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          oltId,
          linkedOlt,
          ponRef,
          ponPortName: getPonPortDisplayName(olt, ponRef),
          ponPortNo: Number.isFinite(getPonRefOrder(ponRef)) ? getPonRefOrder(ponRef) : null,
          ponCapacity: defaultPonCapacity,
          napCount: 0,
          totalCapacity: 0,
          totalUsed: 0,
          totalCustomers: 0,
          napIds: [],
          napCodes: [],
          naps: []
        });
      }
      const group = map.get(key);
      const customerCount = Array.isArray(nap?.connections) ? nap.connections.length : 0;
      group.ponCapacity = Math.max(group.ponCapacity, Math.max(toNonNegativeInt(nap?.ponCapacity, 0), 0));
      group.napCount += 1;
      group.totalCapacity += Math.max(toNonNegativeInt(nap?.capacity, 0), 0);
      group.totalUsed += getNapEffectiveUsed(nap);
      group.totalCustomers += customerCount;
      group.napIds.push(toText(nap?.id));
      group.napCodes.push(toText(nap?.code));
      group.naps.push({
        id: toText(nap?.id),
        code: toText(nap?.code),
        location: toText(nap?.location),
        capacity: Math.max(toNonNegativeInt(nap?.capacity, 0), 0),
        used: getNapEffectiveUsed(nap),
        opticalPower: toText(nap?.opticalPower),
        customerCount,
        onlineSubscribers: toNonNegativeInt(nap?.onlineSubscribers, 0),
        offlineSubscribers: toNonNegativeInt(nap?.offlineSubscribers, 0),
        subscriberStatusAvailable: Boolean(nap?.subscriberStatusAvailable),
        connections: Array.isArray(nap?.connections) ? nap.connections : [],
        ports: Array.isArray(nap?.ports) ? nap.ports : buildNapPortEntries(nap)
      });
    });

    groups.push(
      ...[...map.values()].sort((left, right) => {
        const leftOrder = getPonRefOrder(left.ponRef);
        const rightOrder = getPonRefOrder(right.ponRef);
        if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        if (Number.isFinite(leftOrder) !== Number.isFinite(rightOrder)) {
          return Number.isFinite(leftOrder) ? -1 : 1;
        }
        return String(left.ponRef || '').localeCompare(String(right.ponRef || ''));
      })
    );
  });

  return groups;
};

const loadOverview = async (branchId) => {
  const state = await loadState(branchId);
  const [customersResult, coverageAreasResult, tempCustomersResult] = await Promise.allSettled([
    readCustomers(branchId),
    readCoverage(branchId),
    tempNetworkCustomersProvider ? tempNetworkCustomersProvider(branchId) : Promise.resolve([])
  ]);
  const customers = customersResult.status === 'fulfilled' ? customersResult.value : [];
  const coverageAreas = coverageAreasResult.status === 'fulfilled' ? coverageAreasResult.value : [];
  const tempCustomers = tempCustomersResult.status === 'fulfilled' ? tempCustomersResult.value : [];
  const mergedState = mergeTempNetworkAssignments(state, tempCustomers);
  return {
    ...mergedState,
    ports: buildPortList(mergedState?.olts, mergedState?.naps),
    customers: [
      ...(Array.isArray(customers) ? customers : []).map((customer) => sanitizeCustomerForAdmin(customer)),
      ...(Array.isArray(tempCustomers) ? tempCustomers : [])
    ],
    coverageAreas: Array.isArray(coverageAreas) ? coverageAreas : []
  };
};

const saveStateUnlocked = async (branchId, payload) => {
  const { olts, naps } = normalizePayload(payload);
  if (isJsonStorageMode()) {
    const allState = await readJson(JSON_STORE_KEY, {});
    const currentState = getJsonScopedState(allState, branchId);
    const currentRevision = createPonStateRevision(currentState);
    assertExpectedPonRevision(payload?.expectedRevision, currentRevision);
    assertActiveReservationCompatibility(currentState?.reservations, naps);
    const nextState = allState && typeof allState === 'object' && !Array.isArray(allState)
      ? allState
      : {};
    const branchKey = String(branchId || 'default');
    nextState.branches = nextState.branches && typeof nextState.branches === 'object'
      ? nextState.branches
      : {};
    nextState.branches[branchKey] = {
      ...(nextState.branches[branchKey] && typeof nextState.branches[branchKey] === 'object'
        ? nextState.branches[branchKey]
        : currentState),
      olts,
      naps,
      updatedAt: new Date().toISOString()
    };
    await writeJson(JSON_STORE_KEY, nextState);
    return {
      olts: olts.length,
      naps: naps.length,
      revision: createPonStateRevision(nextState.branches[branchKey])
    };
  }

  const pool = await getPool();
  await ensurePonCodePrefixColumn();
  await ensureRelationalReservationSchema();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM branches WHERE id = ? FOR UPDATE', [branchId]);
    const currentState = await loadRelationalRevisionSnapshot(connection, branchId, { lockRows: true });
    const currentRevision = createPonStateRevision(currentState);
    assertExpectedPonRevision(payload?.expectedRevision, currentRevision);
    const [reservationRows] = await connection.query(
      `SELECT r.id AS reservationId, n.client_uid AS napId, r.port,
              r.customer_ref AS customerAccountNumber, r.expires_at AS expiresAt, r.status
         FROM pon_port_reservations r
         INNER JOIN pon_naps n ON n.id = r.nap_id
        WHERE r.branch_id = ?
          AND (
            r.status = 'draft-held'
            OR (r.status = 'active' AND r.expires_at > CURRENT_TIMESTAMP)
          )
        FOR UPDATE`,
      [branchId]
    );
    assertActiveReservationCompatibility(reservationRows, naps);

    for (const olt of olts) {
      await connection.query(
        `INSERT INTO pon_olts (
            branch_id, client_uid, name, technology, site, status, pon_ports, pon_code_prefix, pon_port_names_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            technology = VALUES(technology),
            site = VALUES(site),
            status = VALUES(status),
            pon_ports = VALUES(pon_ports),
            pon_code_prefix = VALUES(pon_code_prefix),
            pon_port_names_json = VALUES(pon_port_names_json),
            updated_at = CURRENT_TIMESTAMP`,
        [
          branchId,
          olt.id,
          olt.name,
          olt.technology,
          olt.site || null,
          olt.status,
          olt.ponPorts,
          olt.ponCodePrefix,
          JSON.stringify(normalizePonPortNames(olt.ponPortNames, olt.ponPorts))
        ]
      );
    }

    const [branchOlts] = await connection.query(
      'SELECT id, name FROM pon_olts WHERE branch_id = ?',
      [branchId]
    );
    const oltIdByName = new Map((branchOlts || []).map((row) => [normalizeNameKey(row.name), Number(row.id)]));
    const [branchCustomers] = await connection.query(
      'SELECT account_number FROM customers WHERE branch_id = ?',
      [branchId]
    );
    const validCustomerIds = new Set((branchCustomers || []).map((row) => normalizeNameKey(row.account_number)));

    for (const nap of naps) {
      const oltId = oltIdByName.get(normalizeNameKey(nap.linkedOlt));
      if (!oltId) {
        throw makeError(`Unable to resolve OLT for NAP ${nap.code}: ${nap.linkedOlt}`);
      }
      await connection.query(
        `INSERT INTO pon_naps (
            branch_id, olt_id, client_uid, code, area, coordinate, splitter, pon_ref, pon_capacity, capacity, used, optical_power
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            olt_id = VALUES(olt_id),
            code = VALUES(code),
            area = VALUES(area),
            coordinate = VALUES(coordinate),
            splitter = VALUES(splitter),
            pon_ref = VALUES(pon_ref),
            pon_capacity = VALUES(pon_capacity),
            capacity = VALUES(capacity),
            used = VALUES(used),
            optical_power = VALUES(optical_power),
            updated_at = CURRENT_TIMESTAMP`,
        [
          branchId,
          oltId,
          nap.id,
          nap.code,
          nap.location || null,
          nap.coordinate || null,
          nap.splitter,
          nap.ponRef,
          nap.ponCapacity,
          nap.capacity,
          nap.used,
          nap.opticalPower || null
        ]
      );
    }

    if (naps.length) {
      await connection.query(
        `DELETE c
         FROM pon_nap_connections c
         INNER JOIN pon_naps n ON n.id = c.nap_id
         WHERE n.branch_id = ?`,
        [branchId]
      );

      const napIds = naps.map((item) => item.id);
      const [branchNaps] = await connection.query(
        `SELECT id, client_uid FROM pon_naps
         WHERE branch_id = ? AND client_uid IN (${placeholders(napIds.length)})`,
        [branchId, ...napIds]
      );
      const napIdByClientUid = new Map((branchNaps || []).map((row) => [toText(row.client_uid), Number(row.id)]));

      for (const nap of naps) {
        const napDbId = napIdByClientUid.get(nap.id);
        if (!napDbId) continue;
        for (const entry of nap.connections) {
          const customerAccount = validCustomerIds.has(normalizeNameKey(entry.customerId))
            ? entry.customerId
            : null;
          await connection.query(
            `INSERT INTO pon_nap_connections (
                nap_id, customer_account_number, customer_name, customer_ref, port, optical_info
             ) VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                customer_account_number = VALUES(customer_account_number),
                customer_name = VALUES(customer_name),
                customer_ref = VALUES(customer_ref),
                optical_info = VALUES(optical_info),
                updated_at = CURRENT_TIMESTAMP`,
            [
              napDbId,
              customerAccount,
              entry.customerName || null,
              entry.customerRef || null,
              entry.port,
              entry.opticalInfo || null
            ]
          );
        }
      }

      await connection.query(
        `DELETE FROM pon_naps
         WHERE branch_id = ? AND client_uid NOT IN (${placeholders(napIds.length)})`,
        [branchId, ...napIds]
      );
    } else {
      await connection.query('DELETE FROM pon_naps WHERE branch_id = ?', [branchId]);
    }

    if (olts.length) {
      const oltIds = olts.map((item) => item.id);
      await connection.query(
        `DELETE FROM pon_olts
         WHERE branch_id = ? AND client_uid NOT IN (${placeholders(oltIds.length)})`,
        [branchId, ...oltIds]
      );
    } else {
      await connection.query('DELETE FROM pon_olts WHERE branch_id = ?', [branchId]);
    }

    const savedState = await loadRelationalRevisionSnapshot(connection, branchId);
    const revision = createPonStateRevision(savedState);
    await connection.commit();
    return { olts: olts.length, naps: naps.length, revision };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback errors.
    }
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw makeError('Duplicate OLT/NAP data detected while saving PON state.', 409);
    }
    throw error;
  } finally {
    connection.release();
  }
};

const saveState = async (branchId, payload) => withPonBranchLock(
  branchId,
  () => saveStateUnlocked(branchId, payload)
);

router.get('/state', async (req, res, next) => {
  try {
    if (isJsonStorageMode()) {
      const branchId = branchIdFromRequest(req);
      const state = await loadState(branchId);
      return res.json(state);
    }

    await assertRelationalReady();
    const branchId = branchIdFromRequest(req);
    const ponTablesReady = await hasPonTables();
    if (!ponTablesReady) {
      return res.json({
        olts: [],
        naps: [],
        schemaReady: false,
        message: 'PON schema is not initialized. Run Schema Update from owner page.'
      });
    }
    const state = await loadState(branchId);
    return res.json(state);
  } catch (error) {
    if (
      /Relational schema not initialized/i.test(String(error?.message || '')) ||
      isMissingPonTableError(error)
    ) {
      error.message = 'PON schema is not initialized. Run Schema Update from owner page.';
      error.statusCode = 503;
    }
    return next(error);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    if (isJsonStorageMode()) {
      const branchId = branchIdFromRequest(req);
      const overview = await loadOverview(branchId);
      return res.json({
        ok: true,
        schemaReady: true,
        storageDriver: 'json',
        ...overview
      });
    }

    await assertRelationalReady();
    const branchId = branchIdFromRequest(req);
    const ponTablesReady = await hasPonTables();
    if (!ponTablesReady) {
      const [customers, coverageAreas] = await Promise.all([
        readCustomers(branchId),
        readCoverage(branchId)
      ]);
      return res.json({
        ok: true,
        schemaReady: false,
        message: 'PON schema is not initialized. Run Schema Update from owner page.',
        olts: [],
        naps: [],
        ports: [],
        subscriberStatusAvailable: false,
        activePppoeUsernames: [],
        customers: (Array.isArray(customers) ? customers : []).map((customer) => sanitizeCustomerForAdmin(customer)),
        coverageAreas: Array.isArray(coverageAreas) ? coverageAreas : []
      });
    }
    const overview = await loadOverview(branchId);
    return res.json({
      ok: true,
      schemaReady: true,
      ...overview
    });
  } catch (error) {
    if (
      /Relational schema not initialized/i.test(String(error?.message || '')) ||
      isMissingPonTableError(error)
    ) {
      error.message = 'PON schema is not initialized. Run Schema Update from owner page.';
      error.statusCode = 503;
    }
    return next(error);
  }
});

router.put('/state', async (req, res, next) => {
  try {
    if (isJsonStorageMode()) {
      const branchId = branchIdFromRequest(req);
      const summary = await saveState(branchId, req.body || {});
      return res.json({ ok: true, storageDriver: 'json', ...summary });
    }

    await assertRelationalReady();
    const branchId = branchIdFromRequest(req);
    const ponTablesReady = await hasPonTables();
    if (!ponTablesReady) {
      throw makeError('PON schema is not initialized. Run Schema Update from owner page.', 503);
    }
    const summary = await saveState(branchId, req.body || {});
    return res.json({ ok: true, ...summary });
  } catch (error) {
    if (
      error?.code === 'PON_STATE_CONFLICT'
      || error?.code === 'PON_REVISION_REQUIRED'
      || error?.code === 'PON_ACTIVE_RESERVATION_CONFLICT'
    ) {
      return res.status(error.statusCode || 409).json({
        ok: false,
        code: error.code,
        error: error.message,
        ...(error.currentRevision ? { currentRevision: error.currentRevision } : {}),
        ...(error.reservationConflict ? { reservationConflict: error.reservationConflict } : {})
      });
    }
    if (
      /Relational schema not initialized/i.test(String(error?.message || '')) ||
      isMissingPonTableError(error)
    ) {
      error.message = 'PON schema is not initialized. Run Schema Update from owner page.';
      error.statusCode = 503;
    }
    return next(error);
  }
});

module.exports = router;
module.exports.hasPonTables = hasPonTables;
module.exports.loadPonStateForBranch = loadState;
module.exports.savePonStateForBranch = saveState;
module.exports.loadPonOverviewForBranch = loadOverview;
module.exports.canonicalPonRevisionState = canonicalPonRevisionState;
module.exports.createPonStateRevision = createPonStateRevision;
module.exports.assertExpectedPonRevision = assertExpectedPonRevision;
module.exports.loadRelationalRevisionSnapshot = loadRelationalRevisionSnapshot;
module.exports.assertActiveReservationCompatibility = assertActiveReservationCompatibility;
module.exports.configureTempNetworkCustomersProvider = configureTempNetworkCustomersProvider;
module.exports.mergeTempNetworkAssignments = mergeTempNetworkAssignments;
