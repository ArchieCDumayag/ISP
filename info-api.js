const express = require('express');
const basicAuth = require('basic-auth');
const { readJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { resolveCollectorNextDue } = require('./collector-next-due');
const { normalizePaymentEntry } = require('./payment-entry-normalizer');
const { readProfile } = require('./business-profile');
const { accountHasRole } = require('./role-utils');

const router = express.Router();
const STORE_KEYS = {
  customers: 'customers',
  payments: 'payments',
  plans: 'plans',
  coverage: 'coverage',
  accounts: 'accounts',
  collectors: 'collectors'
};

const KNOWN_SECTIONS = ['customers', 'payments', 'plans', 'coverage', 'accounts', 'collectors', 'business'];
const INFO_API_USER = String(process.env.INFO_API_USER || '').trim();
const INFO_API_PASS = String(process.env.INFO_API_PASS || '');
const INFO_API_ENABLED = Boolean(INFO_API_USER && INFO_API_PASS);

function infoApiAuth(req, res, next) {
  if (!INFO_API_ENABLED) {
    return res.status(404).json({ error: 'Not Found' });
  }
  const creds = basicAuth(req);
  if (!creds || creds.name !== INFO_API_USER || creds.pass !== INFO_API_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="info-api"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function parseSectionsParam(raw) {
  if (!raw) return new Set(KNOWN_SECTIONS);
  const parts = String(raw)
    .split(',')
    .map(section => {
      const normalized = section.trim().toLowerCase();
      if (['businessprofile', 'business-profile', 'businessinfo', 'business-info'].includes(normalized)) {
        return 'business';
      }
      return normalized;
    })
    .filter(Boolean);
  if (!parts.length || parts.includes('all')) return new Set(KNOWN_SECTIONS);
  return new Set(parts.filter(section => KNOWN_SECTIONS.includes(section)));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCoordinates(latValue, lngValue) {
  const lat = toFiniteNumber(latValue);
  const lng = toFiniteNumber(lngValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function extractCoordinatesFromDms(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/[\u00BA\u02DA]/g, '\u00B0')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasDmsMarkers = /[NSEW]/i.test(normalized) && /[\u00B0'"]|\d+\s+[NSEW]|\b[NSEW]\s*\d/i.test(normalized);
  if (!hasDmsMarkers) return null;

  const parseDmsSegment = (segment) => {
    const text = String(segment || '').trim().toUpperCase();
    if (!text) return null;
    const hemisphereMatch = text.match(/[NSEW]/);
    const hemisphere = hemisphereMatch ? hemisphereMatch[0] : '';
    if (!hemisphere) return null;

    const numericParts = text.replace(/[NSEW]/g, ' ').match(/-?\d+(?:\.\d+)?/g) || [];
    if (!numericParts.length) return null;

    const degrees = Number(numericParts[0]);
    const minutes = Number(numericParts[1] || 0);
    const seconds = Number(numericParts[2] || 0);
    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

    let decimal = Math.abs(degrees) + (minutes / 60) + (seconds / 3600);
    if (String(numericParts[0] || '').trim().startsWith('-')) {
      decimal *= -1;
    }
    if (hemisphere === 'S' || hemisphere === 'W') {
      decimal = -Math.abs(decimal);
    } else {
      decimal = Math.abs(decimal);
    }

    return { value: decimal, hemisphere };
  };

  const segments = normalized.match(/(?:[NSEW][^NSEW]+|[^NSEW]+[NSEW])/gi) || [];
  const parsedSegments = segments.map(parseDmsSegment).filter(Boolean);
  const latEntry = parsedSegments.find((entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S');
  const lngEntry = parsedSegments.find((entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W');
  if (!latEntry || !lngEntry) return null;

  return normalizeCoordinates(latEntry.value, lngEntry.value);
}

function extractCoordinatesFromMapPin(mapPin) {
  const raw = String(mapPin || '').trim();
  if (!raw) return null;

  // Support direct pair: "14.123456, 120.987654"
  const directPair = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (directPair && directPair[1] && directPair[2]) {
    const normalized = normalizeCoordinates(directPair[1], directPair[2]);
    if (normalized) return normalized;
  }

  // Support map URLs with q=lat,lng or query=lat,lng
  try {
    const parsed = new URL(raw);
    const queryCandidate = parsed.searchParams.get('q') || parsed.searchParams.get('query') || '';
    if (queryCandidate) {
      const pair = queryCandidate.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (pair && pair[1] && pair[2]) {
        const normalized = normalizeCoordinates(pair[1], pair[2]);
        if (normalized) return normalized;
      }
    }
  } catch {
    // non-URL map pins are handled by regex parsing above.
  }

  const dmsCoordinates = extractCoordinatesFromDms(raw);
  if (dmsCoordinates) return dmsCoordinates;

  return null;
}

function attachCustomerCoordinates(customer) {
  if (!customer || typeof customer !== 'object') return customer;
  const fromMapPin = extractCoordinatesFromMapPin(customer.mapPin);
  if (fromMapPin) return { ...customer, coordinates: fromMapPin };
  return { ...customer, coordinates: null };
}

function shapeInfoCustomer(customer) {
  if (!customer || typeof customer !== 'object') return customer;
  const { loginPassword, ...rest } = customer;
  const baseCustomer = {
    ...rest,
    loginPasswordSet: Boolean(String(loginPassword || '').trim()),
    nextDue: resolveCollectorNextDue(rest)
  };
  return attachCustomerCoordinates(baseCustomer);
}

function attachCoverageCoordinates(area) {
  if (!area || typeof area !== 'object') return area;
  const normalized = normalizeCoordinates(area.lat, area.lng);
  return {
    ...area,
    lat: normalized ? normalized.lat : null,
    lng: normalized ? normalized.lng : null,
    coordinates: normalized
  };
}

async function loadCustomers(branchId = null) {
  if (await isRelationalReady()) {
    const sql = `
      SELECT
        account_number AS accountNumber,
        branch_id AS branchId,
        first_name AS firstName,
        last_name AS lastName,
        name,
        email,
        mobile,
        mobile_raw AS mobileRaw,
        street,
        barangay,
        municipality,
        province,
        area,
        map_pin AS mapPin,
        status,
        remarks,
        since,
        plan_name AS planName,
        plan_amount AS planAmount,
        plan_billing AS planBilling,
        plan_category AS planCategory,
        bill_date AS billDate,
        due_date AS dueDate,
        due_offset AS dueOffset,
        credit_limit AS creditLimit,
        login_username AS loginUsername,
        login_password_hash AS loginPassword,
        pppoe_mode AS pppoeMode,
        pppoe_username AS pppoeUsername,
        pppoe_password AS pppoePassword,
        pppoe_profile AS pppoeProfile
      FROM customers
      ${branchId ? 'WHERE branch_id = ?' : ''}`;
    const [rows] = await query(sql, branchId ? [branchId] : []);
    return (rows || []).map((customer) => shapeInfoCustomer(customer));
  }
  const data = await readJson(STORE_KEYS.customers, []);
  return (Array.isArray(data) ? data : []).map((customer) => shapeInfoCustomer(customer));
}

async function loadPayments(branchId = null) {
  if (await isRelationalReady()) {
    const sql = `
      SELECT
        id,
        branch_id AS branchId,
        account_number AS accountNumber,
        amount,
        date,
        kind,
        direction,
        reference,
        description,
        type,
        recorded_at AS recordedAt,
        recorded_by_user_id AS recordedByUserId,
        recorded_by_username AS recordedByUsername,
        recorded_by_name AS recordedByName,
        recorded_by_role AS recordedByRole,
        payer,
        status,
        payment_method AS paymentMethod,
        fingerprint,
        xendit_id AS xenditId
      FROM payment_entries
      ${branchId ? 'WHERE branch_id = ?' : ''}
      ORDER BY recorded_at DESC`;
    const [rows] = await query(sql, branchId ? [branchId] : []);
    const grouped = {};
    (rows || []).forEach((row) => {
      const acct = String(row.accountNumber || '');
      if (!grouped[acct]) grouped[acct] = { history: [] };
      grouped[acct].history.push(normalizePaymentEntry({
        id: row.id,
        amount: row.amount != null ? Number(row.amount) : 0,
        date: row.date || row.recordedAt || null,
        kind: row.kind || undefined,
        reference: row.reference || undefined,
        description: row.description || undefined,
        type: row.type || undefined,
        direction: row.direction || undefined,
        recordedAt: row.recordedAt || undefined,
        recordedBy: row.recordedByUserId ? {
          id: row.recordedByUserId,
          username: row.recordedByUsername || undefined,
          name: row.recordedByName || undefined,
          role: row.recordedByRole || undefined
        } : undefined,
        payer: row.payer || undefined,
        fingerprint: row.fingerprint || undefined,
        status: row.status || undefined,
        paymentMethod: row.paymentMethod || undefined,
        xenditId: row.xenditId || undefined
      }));
    });
    return grouped;
  }
  const data = await readJson(STORE_KEYS.payments, {});
  const rawPayments = data && typeof data === 'object' ? data : {};
  return Object.fromEntries(
    Object.entries(rawPayments).map(([accountNumber, accountData]) => [
      accountNumber,
      {
        ...accountData,
        history: (Array.isArray(accountData?.history) ? accountData.history : []).map((entry) => normalizePaymentEntry(entry))
      }
    ])
  );
}

async function loadPlans(branchId = null) {
  if (await isRelationalReady()) {
    const sql = `
      SELECT
        plan_id AS id,
        branch_id AS branchId,
        category,
        label,
        name,
        description,
        profile,
        price,
        price_suffix AS priceSuffix,
        validity,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM plans
      ${branchId ? 'WHERE branch_id = ?' : ''}`;
    const [rows] = await query(sql, branchId ? [branchId] : []);
    return (rows || []).map((plan) => ({
      ...plan,
      priceSuffix: '/ month',
      validity: null
    }));
  }
  const data = await readJson(STORE_KEYS.plans, []);
  return Array.isArray(data)
    ? data.map((plan) => ({
      ...plan,
      priceSuffix: '/ month',
      validity: null
    }))
    : [];
}

async function loadCoverage(branchId = null) {
  if (await isRelationalReady()) {
    const sql = `
      SELECT id, branch_id AS branchId, name, category, lat, lng, status, notes, area_code AS areaCode
      FROM coverage_areas
      ${branchId ? 'WHERE branch_id = ?' : ''}`;
    const [rows] = await query(sql, branchId ? [branchId] : []);
    return (rows || []).map((row) => attachCoverageCoordinates(row));
  }
  const data = await readJson(STORE_KEYS.coverage, []);
  return (Array.isArray(data) ? data : []).map((row) => attachCoverageCoordinates(row));
}

async function loadAccounts(branchId = null) {
  if (await isRelationalReady()) {
    const sql = `
      SELECT id, username, role, name, branch_id AS branchId, created_at AS created
      FROM users
      ${branchId ? 'WHERE branch_id = ?' : ''}`;
    const [rows] = await query(sql, branchId ? [branchId] : []);
    return (rows || []).map(acc => ({
      id: acc.id,
      username: acc.username,
      role: acc.role,
      created: acc.created,
      name: acc.name || null,
      branchId: acc.branchId
    }));
  }
  const data = await readJson(STORE_KEYS.accounts, []);
  return (Array.isArray(data) ? data : []).map(acc => ({
    id: acc.id,
    username: acc.username,
    role: acc.role,
    created: acc.created,
    name: acc.name || null,
  }));
}

async function loadCollectors(branchId = null) {
  if (await isRelationalReady()) {
    const [rows] = await query(
      `SELECT area_name AS areaName, collector_user_id AS collectorId
       FROM collector_assignments
       ${branchId ? 'WHERE branch_id = ?' : ''}`,
      branchId ? [branchId] : []
    );
    const assignments = {};
    (rows || []).forEach((row) => {
      if (row.areaName) assignments[row.areaName] = String(row.collectorId);
    });
    return { assignments };
  }
  const data = await readJson(STORE_KEYS.collectors, { assignments: {} });
  return data && typeof data === 'object' ? data : { assignments: {} };
}

async function loadBusinessProfile(branchId = null) {
  return readProfile(branchId);
}

function normalizeAreaEntry(area) {
  return (area && (area.name || area.areaName || area.area || area.label)) || null;
}

function isPrepaidCustomer(customer) {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid') return true;
  if (explicit === 'postpaid') return false;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return true;
  if (billing.includes('postpaid')) return false;
  return false;
}

// Filter outbound payload down to the areas assigned to this collector
function filterPayloadForCollector(payload, collectorId, collectorAccount, collectorsData) {
  const assignments = (collectorsData && collectorsData.assignments) || {};
  const areas = Object.keys(assignments).filter(area => String(assignments[area]) === String(collectorId));
  const areaSet = new Set(areas);

  if (payload.collectors !== undefined) {
    const ownAssignments = {};
    for (const area of areas) {
      ownAssignments[area] = String(collectorId);
    }
    payload.collectors = {
      assignments: ownAssignments,
      collector: collectorAccount ? {
        id: collectorAccount.id,
        username: collectorAccount.username,
        name: collectorAccount.name || collectorAccount.username,
      } : undefined,
    };
  }

  if (payload.customers !== undefined) {
    payload.customers = (payload.customers || []).filter((c) => c.area && areaSet.has(c.area) && !isPrepaidCustomer(c));
  }

  const allowedAccounts = new Set(
    Array.isArray(payload.customers) ? payload.customers.map(c => String(c.accountNumber)) : []
  );

  if (payload.payments !== undefined) {
    if (!allowedAccounts.size) {
      payload.payments = {};
    } else {
      const filteredPayments = {};
      for (const [acct, data] of Object.entries(payload.payments || {})) {
        if (allowedAccounts.has(String(acct))) {
          filteredPayments[acct] = data;
        }
      }
      payload.payments = filteredPayments;
    }
  }

  if (payload.coverage !== undefined) {
    payload.coverage = (payload.coverage || []).filter(area => {
      const name = normalizeAreaEntry(area);
      return name && areaSet.has(name);
    });
  }

  if (!areas.length) {
    if (payload.customers !== undefined) payload.customers = [];
    if (payload.payments !== undefined) payload.payments = {};
    if (payload.coverage !== undefined) payload.coverage = [];
  }
}

router.get('/', infoApiAuth, async (req, res, next) => {
  try {
    const sections = parseSectionsParam(req.query.sections);
    const collectorId = (req.query.collectorId || '').trim();

    let accountsCache = null;
    let collectorsCache = null;
    let collectorAccount = null;
    let branchId = null;

    if (collectorId) {
      accountsCache = await loadAccounts();
      collectorAccount = (accountsCache || []).find(acc =>
        String(acc.id) === String(collectorId) &&
        accountHasRole(acc, 'Collector')
      );
      if (!collectorAccount) {
        return res.status(403).json({ error: 'Invalid collectorId' });
      }
      branchId = collectorAccount.branchId || null;
      collectorsCache = await loadCollectors(branchId);
    }

    const payload = { sections: Array.from(sections) };

    if (sections.has('customers')) {
      payload.customers = await loadCustomers(branchId);
    }
    if (sections.has('payments')) {
      payload.payments = await loadPayments(branchId);
    }
    if (sections.has('plans')) {
      payload.plans = await loadPlans(branchId);
    }
    if (sections.has('coverage')) {
      payload.coverage = await loadCoverage(branchId);
    }
    if (sections.has('accounts')) {
      payload.accounts = accountsCache || await loadAccounts(branchId);
    }
    if (sections.has('collectors') || collectorId) {
      collectorsCache = collectorsCache || await loadCollectors(branchId);
      if (sections.has('collectors')) {
        payload.collectors = collectorsCache;
      }
    }
    if (sections.has('business') || collectorId) {
      payload.business = await loadBusinessProfile(branchId);
      payload.businessProfile = payload.business;
    }

    if (collectorId) {
      filterPayloadForCollector(payload, collectorId, collectorAccount, collectorsCache);
    }

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
