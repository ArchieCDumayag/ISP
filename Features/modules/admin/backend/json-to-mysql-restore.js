const crypto = require('crypto');
const { encryptJson, getMasterKeySource } = require('../../../../core/data/db-secrets');
const { hashPassword, isHashedPassword } = require('../../../../core/security/passwords');
const { serializePlanProfileBindings } = require('../../billing/backend/plan-profile-utils');

const DEFAULT_BRANCH_NAME = String(process.env.INITIAL_BRANCH_NAME || 'Main').trim() || 'Main';
const MYSQL_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

const REQUIRED_TABLE_COLUMNS = Object.freeze({
  branches: ['id', 'name', 'code', 'is_active', 'created_at', 'updated_at'],
  users: ['id', 'username', 'password_hash', 'role', 'name', 'branch_id', 'created_at', 'is_active'],
  customers: [
    'account_number', 'branch_id', 'first_name', 'last_name', 'name', 'email', 'mobile', 'mobile_raw',
    'street', 'barangay', 'municipality', 'province', 'area', 'map_pin', 'status', 'remarks', 'since',
    'activation_date', 'plan_id', 'plan_name', 'plan_amount', 'plan_billing', 'plan_category',
    'customer_start_type', 'scheduled_plan_id', 'scheduled_plan_name', 'scheduled_plan_amount',
    'scheduled_plan_billing', 'scheduled_plan_category', 'scheduled_plan_apply_at', 'scheduled_pppoe_profile',
    'bill_date', 'due_date', 'prepaid_expiration_at', 'due_offset', 'credit_limit', 'login_username',
    'login_password_hash', 'pppoe_mode', 'mikrotik_id', 'pppoe_username', 'pppoe_password', 'pppoe_profile',
    'created_at', 'updated_at'
  ],
  plans: [
    'branch_id', 'plan_id', 'name', 'label', 'category', 'description', 'profile', 'profile_bindings',
    'price', 'price_suffix', 'validity', 'created_at', 'updated_at'
  ],
  payment_entries: [
    'id', 'branch_id', 'account_number', 'amount', 'date', 'kind', 'direction', 'reference', 'or_number',
    'description', 'type', 'recorded_at', 'recorded_by_user_id', 'recorded_by_username',
    'recorded_by_name', 'recorded_by_role', 'payer', 'status', 'payment_method', 'fingerprint', 'xendit_id'
  ],
  app_store: ['store_key', 'payload'],
  coverage_areas: [
    'branch_id', 'name', 'category', 'lat', 'lng', 'status', 'notes', 'area_code', 'mikrotik_id',
    'created_at', 'updated_at'
  ],
  collector_assignments: ['branch_id', 'coverage_id', 'area_name', 'collector_user_id'],
  pon_olts: [
    'branch_id', 'client_uid', 'name', 'technology', 'site', 'status', 'pon_ports', 'pon_code_prefix',
    'pon_port_names_json'
  ],
  pon_naps: [
    'branch_id', 'olt_id', 'client_uid', 'code', 'area', 'coordinate', 'splitter', 'pon_ref',
    'pon_capacity', 'capacity', 'used', 'optical_power'
  ],
  pon_nap_connections: [
    'nap_id', 'customer_account_number', 'customer_name', 'customer_ref', 'port', 'optical_info'
  ],
  activity_logs: ['id', 'branch_id', 'message', 'meta', 'timestamp', 'user_id', 'username'],
  business_profiles: [
    'branch_id', 'business_name', 'tagline', 'support_email', 'contact', 'address', 'logo_base64', 'updated_at'
  ],
  integration_settings: ['branch_id', 'provider', 'secret_json'],
  tickets: [
    'id', 'branch_id', 'subject', 'description', 'customer_name', 'account_number', 'contact', 'status',
    'assigned_to', 'source', 'created_at', 'updated_at', 'history_job_id', 'history_job_created_at', 'ticket_number'
  ],
  jobs: [
    'id', 'branch_id', 'type', 'technician', 'priority', 'schedule', 'status', 'done_at', 'notes',
    'description', 'created_at', 'updated_at', 'ticket_id', 'ticket_number', 'ticket_subject', 'origin'
  ]
});

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const toText = (value, maxLength = 0) => {
  const text = String(value == null ? '' : value).trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
};
const toNullableText = (value, maxLength = 0) => toText(value, maxLength) || null;
const toPositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};
const toFiniteNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseDateOnly = (value) => {
  const raw = toText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
};
const parseDateTime = (value, fallback = null) => {
  const raw = toText(value);
  if (!raw) return fallback;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 19).replace('T', ' ')
    : fallback;
};
const nowMysql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const normalizeRole = (account) => {
  const explicit = toText(account?.role, 20);
  if (explicit) return explicit;
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  return toText(roles[0], 20) || 'Collector';
};
const normalizePasswordHash = (value, fallback = 'changeme') => {
  const password = toText(value) || fallback;
  return isHashedPassword(password) ? password : hashPassword(password);
};
const normalizedStore = (parsedStores, fileName, fallback) => (
  parsedStores instanceof Map && parsedStores.has(fileName)
    ? parsedStores.get(fileName)
    : fallback
);
const deterministicPaymentId = (accountNumber, index, entry) => {
  const digest = crypto
    .createHash('sha256')
    .update(`${accountNumber}\n${index}\n${JSON.stringify(entry || {})}`)
    .digest('hex');
  return `legacy-${digest.slice(0, 56)}`;
};
const normalizeBranchId = (value, fallback) => toPositiveInt(value, fallback);
const branchKey = (branchId, value) => `${branchId}:${toText(value).toLowerCase()}`;
const normalizePonTechnology = (value) => (toText(value).toLowerCase().includes('gpon') ? 'gpon' : 'epon');
const normalizePonStatus = (value) => {
  const raw = toText(value).toLowerCase();
  if (['online', 'up', 'active', 'connected'].includes(raw)) return 'online';
  if (['offline', 'down', 'inactive', 'disconnected'].includes(raw)) return 'offline';
  return 'maintenance';
};
const normalizePonRef = (value) => {
  const raw = toText(value);
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(/^pon-?(\d+)$/i);
  if (match) return `PON-${Number(match[1])}`;
  if (/^\d+$/.test(compact)) return `PON-${Number(compact)}`;
  return raw;
};
const normalizeSplitter = (value) => {
  const normalized = toText(value).replace('/', ':');
  return ['1:8', '1:16', '1:24', '1:32'].includes(normalized) ? normalized : '1:16';
};
const normalizeJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const normalizePonConnection = (entry) => {
  const port = toPositiveInt(entry?.port || entry?.portNumber);
  if (!port) return null;
  const customerId = toText(entry?.customerId || entry?.accountNumber);
  const customerName = toText(entry?.customerName || entry?.name);
  const customerRef = toText(entry?.customerRef || customerId || customerName);
  if (!customerId && !customerName && !customerRef) return null;
  return {
    port,
    customerId,
    customerName,
    customerRef,
    opticalInfo: toText(entry?.opticalInfo || entry?.optical || entry?.signal || entry?.rxPower)
  };
};
const normalizePonState = (state) => ({
  olts: (Array.isArray(state?.olts) ? state.olts : []).map((row, index) => ({
    id: toText(row?.id || row?.client_uid) || `olt-${index + 1}`,
    name: toText(row?.name),
    technology: normalizePonTechnology(row?.technology || row?.vendor),
    site: toText(row?.site),
    status: normalizePonStatus(row?.status),
    ponCodePrefix: toText(row?.ponCodePrefix || row?.pon_code_prefix, 40).toUpperCase() || 'PON',
    ponPorts: Math.min(toNonNegativeInt(row?.ponPorts || row?.pon_ports, 0), 4096),
    ponPortNames: normalizeJsonObject(row?.ponPortNames || row?.pon_port_names_json || row?.pon_port_names)
  })),
  naps: (Array.isArray(state?.naps) ? state.naps : []).map((row, index) => ({
    id: toText(row?.id || row?.client_uid) || `nap-${index + 1}`,
    code: toText(row?.code).toUpperCase(),
    location: toText(row?.location || row?.area),
    coordinate: toText(row?.coordinate || row?.coordinates || row?.coords),
    splitter: normalizeSplitter(row?.splitter),
    linkedOlt: toText(row?.linkedOlt || row?.linked_olt),
    ponRef: normalizePonRef(row?.ponRef || row?.pon_ref),
    ponCapacity: toPositiveInt(row?.ponCapacity || row?.pon_capacity, 64),
    capacity: toPositiveInt(row?.capacity, 16),
    used: toNonNegativeInt(row?.used, Array.isArray(row?.connections) ? row.connections.length : 0),
    opticalPower: toText(row?.opticalPower || row?.optical_power),
    connections: (Array.isArray(row?.connections) ? row.connections : []).map(normalizePonConnection).filter(Boolean)
  }))
});

const normalizeBranchRows = (parsedStores) => {
  const accounts = normalizedStore(parsedStores, 'accounts.json', []);
  const customers = normalizedStore(parsedStores, 'customers.json', []);
  const ponState = normalizedStore(parsedStores, 'pon-state.json', {});
  const explicit = normalizedStore(parsedStores, 'branches.json', []);
  const ids = new Set();
  (Array.isArray(accounts) ? accounts : []).forEach((row) => {
    const id = toPositiveInt(row?.branchId || row?.branch_id);
    if (id) ids.add(id);
  });
  (Array.isArray(customers) ? customers : []).forEach((row) => {
    const id = toPositiveInt(row?.branchId || row?.branch_id);
    if (id) ids.add(id);
  });
  for (const [fileName, fallback] of [
    ['plans.json', []],
    ['coverage.json', []],
    ['tickets.json', []],
    ['jobs.json', []]
  ]) {
    const rows = normalizedStore(parsedStores, fileName, fallback);
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = toPositiveInt(row?.branchId || row?.branch_id);
      if (id) ids.add(id);
    });
  }
  const activity = normalizedStore(parsedStores, 'activity-log.json', { logs: [] });
  const activityRows = Array.isArray(activity) ? activity : activity?.logs;
  (Array.isArray(activityRows) ? activityRows : []).forEach((row) => {
    const id = toPositiveInt(row?.branchId || row?.branch_id);
    if (id) ids.add(id);
  });
  if (ponState?.branches && typeof ponState.branches === 'object' && !Array.isArray(ponState.branches)) {
    Object.keys(ponState.branches).forEach((value) => {
      const id = toPositiveInt(value);
      if (id) ids.add(id);
    });
  }
  (Array.isArray(explicit) ? explicit : []).forEach((row) => {
    const id = toPositiveInt(row?.id || row?.branchId);
    if (id) ids.add(id);
  });
  if (!ids.size) ids.add(1);
  const sortedIds = [...ids].sort((left, right) => left - right);
  const primaryBranchId = sortedIds[0];
  const explicitById = new Map(
    (Array.isArray(explicit) ? explicit : [])
      .map((row) => [toPositiveInt(row?.id || row?.branchId), row])
      .filter(([id]) => Boolean(id))
  );
  const names = new Set();
  const codes = new Set();
  const rows = sortedIds.map((id) => {
    const source = explicitById.get(id) || {};
    let name = toText(source.name, 100) || (id === primaryBranchId ? DEFAULT_BRANCH_NAME : `Branch ${id}`);
    if (names.has(name.toLowerCase())) name = `${name} ${id}`.slice(0, 100);
    names.add(name.toLowerCase());
    let code = toText(source.code, 50) || (id === primaryBranchId ? 'main' : `branch-${id}`);
    if (codes.has(code.toLowerCase())) code = `branch-${id}`;
    codes.add(code.toLowerCase());
    return {
      id,
      name,
      code,
      isActive: source.isActive === false || source.is_active === 0 ? 0 : 1,
      createdAt: parseDateTime(source.createdAt || source.created_at, nowMysql()),
      updatedAt: parseDateTime(source.updatedAt || source.updated_at, nowMysql())
    };
  });
  return { rows, primaryBranchId, branchIds: new Set(sortedIds) };
};

const normalizePonRows = (parsedStores, branchRows, customerBranchByAccount, warnings) => {
  const source = normalizedStore(parsedStores, 'pon-state.json', {});
  const scopes = [];
  if (source?.branches && typeof source.branches === 'object' && !Array.isArray(source.branches)) {
    Object.entries(source.branches).forEach(([rawBranchId, state]) => {
      const branchId = normalizeBranchId(rawBranchId, branchRows.primaryBranchId);
      scopes.push({ branchId, state });
    });
  } else if (source && typeof source === 'object') {
    scopes.push({ branchId: branchRows.primaryBranchId, state: source });
  }

  const olts = [];
  const naps = [];
  for (const scope of scopes) {
    if (!branchRows.branchIds.has(scope.branchId)) continue;
    const canonical = normalizePonState(scope.state || {});
    const oltNames = new Set();
    for (const olt of canonical.olts) {
      const clientUid = toText(olt.id, 80);
      const name = toText(olt.name, 150);
      if (!clientUid || !name) throw new Error('JSON backup contains an invalid PON OLT record.');
      const nameKey = name.toLowerCase();
      if (oltNames.has(nameKey)) throw new Error(`JSON backup repeats PON OLT name ${name}.`);
      oltNames.add(nameKey);
      olts.push({
        branchId: scope.branchId,
        clientUid,
        name,
        technology: toText(olt.technology, 20) || 'epon',
        site: toNullableText(olt.site, 180),
        status: toNullableText(olt.status, 30),
        ponPorts: Math.min(toNonNegativeInt(olt.ponPorts, 0), 4096),
        ponCodePrefix: toText(olt.ponCodePrefix, 40) || 'PON',
        ponPortNamesJson: JSON.stringify(olt.ponPortNames || {})
      });
    }
    const napIds = new Set();
    for (const nap of canonical.naps) {
      const clientUid = toText(nap.id, 80);
      const code = toText(nap.code, 180).toUpperCase();
      const linkedOlt = toText(nap.linkedOlt, 150);
      if (!clientUid || !code || !linkedOlt || !oltNames.has(linkedOlt.toLowerCase())) {
        throw new Error(`JSON backup contains an invalid PON NAP record${code ? ` (${code})` : ''}.`);
      }
      if (napIds.has(clientUid.toLowerCase())) throw new Error(`JSON backup repeats PON NAP id ${clientUid}.`);
      napIds.add(clientUid.toLowerCase());
      const connections = [];
      for (const entry of Array.isArray(nap.connections) ? nap.connections : []) {
        const accountCandidate = toText(entry.customerId || entry.customerRef, 20);
        const linkedAccount = customerBranchByAccount.get(accountCandidate) === scope.branchId
          ? accountCandidate
          : null;
        if (accountCandidate && !linkedAccount) {
          warnings.push(`PON ${code} port ${entry.port} kept its customer reference but could not link an unknown account.`);
        }
        connections.push({
          customerAccountNumber: linkedAccount,
          customerName: toNullableText(entry.customerName, 200),
          customerRef: toNullableText(entry.customerRef || entry.customerId || entry.customerName, 200),
          port: toPositiveInt(entry.port),
          opticalInfo: toNullableText(entry.opticalInfo, 120)
        });
      }
      naps.push({
        branchId: scope.branchId,
        clientUid,
        code,
        linkedOlt,
        area: toNullableText(nap.location, 180),
        coordinate: toNullableText(nap.coordinate, 120),
        splitter: toText(nap.splitter, 20) || '1:16',
        ponRef: toText(nap.ponRef, 40) || 'PON-1',
        ponCapacity: Math.max(toPositiveInt(nap.ponCapacity, 64), 1),
        capacity: Math.max(toPositiveInt(nap.capacity, 16), 1),
        used: toNonNegativeInt(nap.used, connections.length),
        opticalPower: toNullableText(nap.opticalPower, 80),
        connections: connections.filter((entry) => entry.port)
      });
    }
  }
  return { olts, naps };
};

function buildJsonToMysqlPlan(parsedStores) {
  if (!(parsedStores instanceof Map)) throw new Error('Validated JSON stores are required for MySQL conversion.');
  const warnings = [];
  const branchRows = normalizeBranchRows(parsedStores);
  const primaryBranchId = branchRows.primaryBranchId;
  const defaultBranch = (value) => normalizeBranchId(value, primaryBranchId);

  const appStoreRows = [...parsedStores.entries()]
    .filter(([fileName]) => fileName.toLowerCase().endsWith('.json'))
    .map(([fileName, payload]) => ({
      storeKey: fileName.slice(0, -5).replace(/[\\/]/g, '_'),
      payload: JSON.stringify(payload ?? null)
    }))
    .sort((left, right) => left.storeKey.localeCompare(right.storeKey));

  const accounts = normalizedStore(parsedStores, 'accounts.json', []);
  if (!Array.isArray(accounts)) throw new Error('JSON backup accounts store must be an array.');
  const userIds = new Set();
  const usernames = new Set();
  const users = accounts.map((account) => {
    const id = toText(account?.id, 32);
    const username = toText(account?.username, 100);
    if (!id || !username) throw new Error('JSON backup contains an account without an id or username.');
    if (userIds.has(id)) throw new Error(`JSON backup repeats account id ${id}.`);
    if (usernames.has(username.toLowerCase())) throw new Error(`JSON backup repeats username ${username}.`);
    userIds.add(id);
    usernames.add(username.toLowerCase());
    return {
      id,
      username,
      passwordHash: normalizePasswordHash(account.password),
      role: normalizeRole(account),
      name: toNullableText(account.name || account.username, 120),
      branchId: defaultBranch(account.branchId || account.branch_id),
      createdAt: parseDateTime(account.created || account.createdAt, nowMysql()),
      isActive: account.isActive === false || account.is_active === 0 ? 0 : 1
    };
  });

  const planSource = normalizedStore(parsedStores, 'plans.json', []);
  if (!Array.isArray(planSource)) throw new Error('JSON backup plans store must be an array.');
  const plans = [];
  const planKeys = new Set();
  for (const source of planSource) {
    const planId = toText(source?.id || source?.plan_id || source?.name, 80);
    if (!planId) throw new Error('JSON backup contains a plan without an id.');
    const targetBranchIds = toPositiveInt(source?.branchId || source?.branch_id)
      ? [defaultBranch(source.branchId || source.branch_id)]
      : [...branchRows.branchIds];
    for (const branchId of targetBranchIds) {
      const key = branchKey(branchId, planId);
      if (planKeys.has(key)) throw new Error(`JSON backup repeats plan ${planId} for branch ${branchId}.`);
      planKeys.add(key);
      plans.push({
        branchId,
        planId,
        name: toNullableText(source.name, 120),
        label: toNullableText(source.label, 120),
        category: toNullableText(source.category, 20),
        description: toNullableText(source.description),
        profile: toNullableText(source.profile, 120),
        profileBindings: serializePlanProfileBindings(source.profileBindings || source.profile_bindings),
        price: toFiniteNumber(source.price),
        priceSuffix: toNullableText(source.priceSuffix || source.price_suffix || '/ month', 40),
        validity: toNonNegativeInt(source.validity, null),
        createdAt: parseDateTime(source.createdAt || source.created_at),
        updatedAt: parseDateTime(source.updatedAt || source.updated_at)
      });
    }
  }

  const customerSource = normalizedStore(parsedStores, 'customers.json', []);
  if (!Array.isArray(customerSource)) throw new Error('JSON backup customers store must be an array.');
  const customerAccounts = new Set();
  const customerBranchByAccount = new Map();
  const customers = customerSource.map((customer) => {
    const accountNumber = toText(customer?.accountNumber || customer?.account_number, 20);
    if (!accountNumber) throw new Error('JSON backup contains a customer without an account number.');
    if (customerAccounts.has(accountNumber)) throw new Error(`JSON backup repeats customer account ${accountNumber}.`);
    customerAccounts.add(accountNumber);
    const branchId = defaultBranch(customer.branchId || customer.branch_id);
    customerBranchByAccount.set(accountNumber, branchId);
    const createdAt = parseDateTime(customer.createdAt || customer.created_at, nowMysql());
    return {
      accountNumber,
      branchId,
      firstName: toNullableText(customer.firstName || customer.first_name, 100),
      lastName: toNullableText(customer.lastName || customer.last_name, 100),
      name: toNullableText(customer.name || [customer.firstName, customer.lastName].filter(Boolean).join(' '), 200),
      email: toNullableText(customer.email, 150),
      mobile: toNullableText(customer.mobile, 32),
      mobileRaw: toNullableText(customer.mobileRaw || customer.mobile_raw, 32),
      street: toNullableText(customer.street, 150),
      barangay: toNullableText(customer.barangay, 150),
      municipality: toNullableText(customer.municipality, 150),
      province: toNullableText(customer.province, 150),
      area: toNullableText(customer.area, 150),
      mapPin: toNullableText(customer.mapPin || customer.map_pin, 50),
      status: toNullableText(customer.status, 30),
      remarks: toNullableText(customer.remarks),
      since: toNullableText(customer.since, 50),
      activationDate: parseDateOnly(customer.activationDate || customer.activation_date),
      planId: toNullableText(customer.planId || customer.plan_id, 80),
      planName: toNullableText(customer.planName || customer.plan_name, 120),
      planAmount: toFiniteNumber(customer.planAmount ?? customer.plan_amount),
      planBilling: toNullableText(customer.planBilling || customer.plan_billing, 30),
      planCategory: toNullableText(customer.planCategory || customer.plan_category, 20),
      customerStartType: toNullableText(customer.customerStartType || customer.customer_start_type, 20),
      scheduledPlanId: toNullableText(customer.scheduledPlanId || customer.scheduled_plan_id, 80),
      scheduledPlanName: toNullableText(customer.scheduledPlanName || customer.scheduled_plan_name, 120),
      scheduledPlanAmount: toFiniteNumber(customer.scheduledPlanAmount ?? customer.scheduled_plan_amount),
      scheduledPlanBilling: toNullableText(customer.scheduledPlanBilling || customer.scheduled_plan_billing, 30),
      scheduledPlanCategory: toNullableText(customer.scheduledPlanCategory || customer.scheduled_plan_category, 20),
      scheduledPlanApplyAt: parseDateTime(customer.scheduledPlanApplyAt || customer.scheduled_plan_apply_at),
      scheduledPppoeProfile: toNullableText(customer.scheduledPppoeProfile || customer.scheduled_pppoe_profile, 120),
      billDate: parseDateOnly(customer.billDate || customer.bill_date),
      dueDate: parseDateOnly(customer.dueDate || customer.due_date),
      prepaidExpirationAt: parseDateTime(customer.prepaidExpirationAt || customer.prepaid_expiration_at),
      dueOffset: Number.isFinite(Number(customer.dueOffset ?? customer.due_offset))
        ? Number(customer.dueOffset ?? customer.due_offset)
        : null,
      creditLimit: toFiniteNumber(customer.creditLimit ?? customer.credit_limit),
      loginUsername: toNullableText(customer.loginUsername || customer.login_username, 120),
      loginPasswordHash: customer.loginPassword || customer.login_password_hash
        ? normalizePasswordHash(customer.loginPassword || customer.login_password_hash)
        : null,
      pppoeMode: toNullableText(customer.pppoeMode || customer.pppoe_mode, 30),
      mikrotikId: toNullableText(customer.mikrotikId || customer.routerId || customer.mikrotik_id, 120),
      pppoeUsername: toNullableText(customer.pppoeUsername || customer.pppoe_username, 120),
      pppoePassword: toNullableText(customer.pppoePassword || customer.pppoe_password, 120),
      pppoeProfile: toNullableText(customer.pppoeProfile || customer.pppoe_profile, 120),
      createdAt,
      updatedAt: parseDateTime(customer.updatedAt || customer.updated_at, createdAt)
    };
  });

  const coverageSource = normalizedStore(parsedStores, 'coverage.json', []);
  const coverage = (Array.isArray(coverageSource) ? coverageSource : []).map((area) => ({
    branchId: defaultBranch(area?.branchId || area?.branch_id),
    name: toText(area?.name || area?.area || area?.label, 150),
    category: toNullableText(area?.category, 50),
    lat: toFiniteNumber(area?.lat),
    lng: toFiniteNumber(area?.lng),
    status: toNullableText(area?.status, 30),
    notes: toNullableText(area?.notes),
    areaCode: toNullableText(area?.areaCode || area?.area_code, 50),
    mikrotikId: toNullableText(area?.mikrotikId || area?.routerId || area?.mikrotik_id, 120),
    createdAt: parseDateTime(area?.created || area?.createdAt || area?.created_at),
    updatedAt: parseDateTime(area?.updated || area?.updatedAt || area?.updated_at)
  })).filter((area) => area.name);

  const collectorStore = normalizedStore(parsedStores, 'collectors.json', { assignments: {} });
  const assignmentSource = collectorStore && typeof collectorStore === 'object'
    ? collectorStore.assignments || {}
    : {};
  const collectorAssignments = [];
  for (const [areaName, rawCollectorIds] of Object.entries(assignmentSource)) {
    const collectorIds = Array.isArray(rawCollectorIds)
      ? rawCollectorIds
      : String(rawCollectorIds || '').split(',');
    for (const rawCollectorId of collectorIds) {
      const collectorUserId = toText(rawCollectorId, 32);
      if (!collectorUserId) continue;
      if (!userIds.has(collectorUserId)) {
        warnings.push(`Collector assignment for ${areaName} skipped unknown user ${collectorUserId}.`);
        continue;
      }
      const account = users.find((user) => user.id === collectorUserId);
      collectorAssignments.push({
        branchId: account?.branchId || primaryBranchId,
        areaName: toText(areaName, 150),
        collectorUserId
      });
    }
  }

  const paymentSource = normalizedStore(parsedStores, 'payments.json', {});
  if (!paymentSource || typeof paymentSource !== 'object' || Array.isArray(paymentSource)) {
    throw new Error('JSON backup payments store must be an object keyed by customer account.');
  }
  const paymentIds = new Map();
  const payments = [];
  for (const [storeAccountNumber, payload] of Object.entries(paymentSource)) {
    const history = Array.isArray(payload) ? payload : (Array.isArray(payload?.history) ? payload.history : []);
    history.forEach((entry, index) => {
      const accountNumber = toText(entry?.accountNumber || entry?.account_number || storeAccountNumber, 20);
      if (!customerAccounts.has(accountNumber)) {
        warnings.push(`Payment history for unknown account ${accountNumber || '(blank)'} remains preserved in app_store only.`);
        return;
      }
      const id = toText(entry?.id, 64) || deterministicPaymentId(accountNumber, index, entry);
      const canonical = JSON.stringify(entry || {});
      if (paymentIds.has(id)) {
        if (paymentIds.get(id) !== canonical) throw new Error(`JSON backup contains conflicting duplicate payment id ${id}.`);
        warnings.push(`Exact duplicate payment id ${id} was collapsed during MySQL conversion.`);
        return;
      }
      paymentIds.set(id, canonical);
      const recordedBy = entry?.recordedBy || entry?.recorded_by || {};
      payments.push({
        id,
        branchId: customerBranchByAccount.get(accountNumber) || primaryBranchId,
        accountNumber,
        amount: toFiniteNumber(entry?.amount, 0),
        date: parseDateOnly(entry?.date || entry?.recordedAt || entry?.recorded_at),
        kind: toNullableText(entry?.kind, 20),
        direction: toNullableText(entry?.direction, 10),
        reference: toNullableText(entry?.reference, 32),
        orNumber: toNullableText(entry?.orNumber || entry?.or_number, 20),
        description: toNullableText(entry?.description),
        type: toNullableText(entry?.type, 20),
        recordedAt: parseDateTime(entry?.recordedAt || entry?.recorded_at || entry?.date),
        recordedByUserId: toNullableText(recordedBy.id || entry?.recorded_by_user_id, 32),
        recordedByUsername: toNullableText(recordedBy.username || entry?.recorded_by_username, 100),
        recordedByName: toNullableText(recordedBy.name || entry?.recorded_by_name, 100),
        recordedByRole: toNullableText(recordedBy.role || entry?.recorded_by_role, 30),
        payer: toNullableText(entry?.payer, 100),
        status: toNullableText(entry?.status, 30),
        paymentMethod: toNullableText(entry?.paymentMethod || entry?.payment_method, 40),
        fingerprint: toNullableText(entry?.fingerprint, 200),
        xenditId: toNullableText(entry?.xenditId || entry?.xendit_id, 120)
      });
    });
  }

  const activityStore = normalizedStore(parsedStores, 'activity-log.json', { logs: [] });
  const activitySource = Array.isArray(activityStore) ? activityStore : activityStore?.logs;
  const activityLogs = (Array.isArray(activitySource) ? activitySource : []).map((entry, index) => ({
    id: toText(entry?.id, 32) || crypto.createHash('sha256').update(`activity:${index}:${JSON.stringify(entry || {})}`).digest('hex').slice(0, 32),
    branchId: defaultBranch(entry?.branchId || entry?.branch_id),
    message: toNullableText(entry?.message),
    meta: typeof entry?.meta === 'string' ? entry.meta : (entry?.meta == null ? null : JSON.stringify(entry.meta)),
    timestamp: parseDateTime(entry?.timestamp, nowMysql()),
    userId: toNullableText(entry?.userId || entry?.user_id, 32),
    username: toNullableText(entry?.username, 120)
  }));

  const businessSource = normalizedStore(parsedStores, 'business-profile.json', null);
  const businessProfiles = businessSource && typeof businessSource === 'object' && !Array.isArray(businessSource)
    ? [{
        branchId: primaryBranchId,
        businessName: toNullableText(businessSource.businessName || businessSource.business_name, 200),
        tagline: toNullableText(businessSource.tagline, 200),
        supportEmail: toNullableText(businessSource.supportEmail || businessSource.support_email, 150),
        contact: toNullableText(businessSource.contact, 50),
        address: toNullableText(businessSource.address, 250),
        logoBase64: toNullableText(businessSource.logoUrl || businessSource.logoBase64 || businessSource.logo_base64),
        updatedAt: parseDateTime(businessSource.updatedAt || businessSource.updated_at, nowMysql())
      }]
    : [];

  const integrations = normalizedStore(parsedStores, 'integrations.json', null);
  const integrationSettings = integrations && typeof integrations === 'object'
    ? [{ branchId: primaryBranchId, provider: 'core', settings: cloneJson(integrations) }]
    : [];
  if (integrationSettings.length && getMasterKeySource() === 'none') {
    throw new Error('CONFIG_MASTER_KEY is required before converting protected JSON integration settings to MySQL.');
  }

  const ticketSource = normalizedStore(parsedStores, 'tickets.json', []);
  const tickets = [];
  for (const ticket of Array.isArray(ticketSource) ? ticketSource : []) {
    const id = toPositiveInt(ticket?.id);
    if (!id) {
      warnings.push('A non-numeric legacy ticket remains preserved in app_store only.');
      continue;
    }
    tickets.push({
      id,
      branchId: defaultBranch(ticket.branchId || ticket.branch_id),
      subject: toNullableText(ticket.subject, 200),
      description: toNullableText(ticket.description),
      customerName: toNullableText(ticket.customerName || ticket.customer_name, 200),
      accountNumber: toNullableText(ticket.accountNumber || ticket.account_number, 20),
      contact: toNullableText(ticket.contact, 50),
      status: toNullableText(ticket.status, 20),
      assignedTo: toNullableText(ticket.assignedTo || ticket.assigned_to, 120),
      source: toNullableText(ticket.source, 20),
      createdAt: parseDateTime(ticket.createdAt || ticket.created_at),
      updatedAt: parseDateTime(ticket.updatedAt || ticket.updated_at),
      historyJobId: toPositiveInt(ticket.historyJobId || ticket.history_job_id),
      historyJobCreatedAt: parseDateTime(ticket.historyJobCreatedAt || ticket.history_job_created_at),
      ticketNumber: toNullableText(ticket.ticketNumber || ticket.ticket_number, 50)
    });
  }

  const jobSource = normalizedStore(parsedStores, 'jobs.json', []);
  const jobs = [];
  for (const job of Array.isArray(jobSource) ? jobSource : []) {
    const id = toPositiveInt(job?.id);
    if (!id) {
      warnings.push('A non-numeric legacy job remains preserved in app_store only.');
      continue;
    }
    jobs.push({
      id,
      branchId: defaultBranch(job.branchId || job.branch_id),
      type: toNullableText(job.type, 50),
      technician: toNullableText(job.technician, 120),
      priority: toNullableText(job.priority, 20),
      schedule: parseDateTime(job.schedule),
      status: toNullableText(job.status, 20),
      doneAt: parseDateTime(job.doneAt || job.done_at),
      notes: toNullableText(job.notes),
      description: toNullableText(job.description),
      createdAt: parseDateTime(job.createdAt || job.created_at),
      updatedAt: parseDateTime(job.updatedAt || job.updated_at),
      ticketId: toPositiveInt(job.ticketId || job.ticket_id),
      ticketNumber: toNullableText(job.ticketNumber || job.ticket_number, 50),
      ticketSubject: toNullableText(job.ticketSubject || job.ticket_subject, 200),
      origin: toNullableText(job.origin, 50)
    });
  }

  const pon = normalizePonRows(parsedStores, branchRows, customerBranchByAccount, warnings);
  const requiredTables = new Set(['branches', 'users', 'customers', 'plans', 'payment_entries', 'app_store']);
  if (coverage.length) requiredTables.add('coverage_areas');
  if (collectorAssignments.length) requiredTables.add('collector_assignments');
  if (pon.olts.length || pon.naps.length) {
    requiredTables.add('pon_olts');
    requiredTables.add('pon_naps');
    requiredTables.add('pon_nap_connections');
  }
  if (activityLogs.length) requiredTables.add('activity_logs');
  if (businessProfiles.length) requiredTables.add('business_profiles');
  if (integrationSettings.length) requiredTables.add('integration_settings');
  if (tickets.length) requiredTables.add('tickets');
  if (jobs.length) requiredTables.add('jobs');

  const plan = {
    sourceStorageDriver: 'json',
    targetStorageDriver: 'mysql',
    branches: branchRows.rows,
    users,
    customers,
    plans,
    coverage,
    collectorAssignments,
    payments,
    ponOlts: pon.olts,
    ponNaps: pon.naps,
    activityLogs,
    businessProfiles,
    integrationSettings,
    tickets,
    jobs,
    appStoreRows,
    warnings: [...new Set(warnings)],
    requiredTables: [...requiredTables]
  };
  plan.relationalRecordCount = [
    plan.branches, plan.users, plan.customers, plan.plans, plan.coverage, plan.collectorAssignments,
    plan.payments, plan.ponOlts, plan.ponNaps, plan.activityLogs, plan.businessProfiles,
    plan.integrationSettings, plan.tickets, plan.jobs, plan.appStoreRows
  ].reduce((total, rows) => total + rows.length, 0)
    + plan.ponNaps.reduce((total, nap) => total + nap.connections.length, 0);
  return plan;
}

function getRequiredTableColumns(plan) {
  const result = {};
  for (const tableName of plan?.requiredTables || []) {
    if (!REQUIRED_TABLE_COLUMNS[tableName]) throw new Error(`No JSON conversion schema is defined for ${tableName}.`);
    result[tableName] = [...REQUIRED_TABLE_COLUMNS[tableName]];
  }
  return result;
}

const quoteIdentifier = (value) => {
  const name = String(value || '').trim();
  if (!MYSQL_NAME_PATTERN.test(name)) throw new Error(`Unsafe MySQL identifier: ${name || '(blank)'}`);
  return `\`${name}\``;
};

async function insertRows(connection, tableName, columns, rows, mapValues) {
  if (!rows.length) return;
  const chunkSize = 100;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const params = chunk.flatMap((row) => mapValues(row));
    await connection.query(
      `INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES ${placeholders}`,
      params
    );
  }
}

async function applyJsonToMysqlPlan(connection, plan, options = {}) {
  const storeTable = String(options.storeTable || 'app_store').trim();
  quoteIdentifier(storeTable);
  await insertRows(connection, 'branches', REQUIRED_TABLE_COLUMNS.branches, plan.branches, (row) => [
    row.id, row.name, row.code, row.isActive, row.createdAt, row.updatedAt
  ]);
  await insertRows(connection, 'users', REQUIRED_TABLE_COLUMNS.users, plan.users, (row) => [
    row.id, row.username, row.passwordHash, row.role, row.name, row.branchId, row.createdAt, row.isActive
  ]);
  await insertRows(connection, 'plans', REQUIRED_TABLE_COLUMNS.plans, plan.plans, (row) => [
    row.branchId, row.planId, row.name, row.label, row.category, row.description, row.profile, row.profileBindings,
    row.price, row.priceSuffix, row.validity, row.createdAt, row.updatedAt
  ]);
  await insertRows(connection, 'customers', REQUIRED_TABLE_COLUMNS.customers, plan.customers, (row) => [
    row.accountNumber, row.branchId, row.firstName, row.lastName, row.name, row.email, row.mobile, row.mobileRaw,
    row.street, row.barangay, row.municipality, row.province, row.area, row.mapPin, row.status, row.remarks, row.since,
    row.activationDate, row.planId, row.planName, row.planAmount, row.planBilling, row.planCategory,
    row.customerStartType, row.scheduledPlanId, row.scheduledPlanName, row.scheduledPlanAmount,
    row.scheduledPlanBilling, row.scheduledPlanCategory, row.scheduledPlanApplyAt, row.scheduledPppoeProfile,
    row.billDate, row.dueDate, row.prepaidExpirationAt, row.dueOffset, row.creditLimit, row.loginUsername,
    row.loginPasswordHash, row.pppoeMode, row.mikrotikId, row.pppoeUsername, row.pppoePassword, row.pppoeProfile,
    row.createdAt, row.updatedAt
  ]);
  await insertRows(connection, 'coverage_areas', REQUIRED_TABLE_COLUMNS.coverage_areas, plan.coverage, (row) => [
    row.branchId, row.name, row.category, row.lat, row.lng, row.status, row.notes, row.areaCode, row.mikrotikId,
    row.createdAt, row.updatedAt
  ]);

  const coverageIdByKey = new Map();
  if (plan.collectorAssignments.length) {
    const [coverageRows] = await connection.query('SELECT id, branch_id, name FROM coverage_areas');
    (coverageRows || []).forEach((row) => coverageIdByKey.set(branchKey(row.branch_id, row.name), row.id));
  }
  await insertRows(
    connection,
    'collector_assignments',
    REQUIRED_TABLE_COLUMNS.collector_assignments,
    plan.collectorAssignments,
    (row) => [row.branchId, coverageIdByKey.get(branchKey(row.branchId, row.areaName)) || null, row.areaName, row.collectorUserId]
  );
  await insertRows(connection, 'payment_entries', REQUIRED_TABLE_COLUMNS.payment_entries, plan.payments, (row) => [
    row.id, row.branchId, row.accountNumber, row.amount, row.date, row.kind, row.direction, row.reference, row.orNumber,
    row.description, row.type, row.recordedAt, row.recordedByUserId, row.recordedByUsername, row.recordedByName,
    row.recordedByRole, row.payer, row.status, row.paymentMethod, row.fingerprint, row.xenditId
  ]);
  await insertRows(connection, 'tickets', REQUIRED_TABLE_COLUMNS.tickets, plan.tickets, (row) => [
    row.id, row.branchId, row.subject, row.description, row.customerName, row.accountNumber, row.contact, row.status,
    row.assignedTo, row.source, row.createdAt, row.updatedAt, row.historyJobId, row.historyJobCreatedAt, row.ticketNumber
  ]);
  await insertRows(connection, 'jobs', REQUIRED_TABLE_COLUMNS.jobs, plan.jobs, (row) => [
    row.id, row.branchId, row.type, row.technician, row.priority, row.schedule, row.status, row.doneAt, row.notes,
    row.description, row.createdAt, row.updatedAt, row.ticketId, row.ticketNumber, row.ticketSubject, row.origin
  ]);
  await insertRows(connection, 'pon_olts', REQUIRED_TABLE_COLUMNS.pon_olts, plan.ponOlts, (row) => [
    row.branchId, row.clientUid, row.name, row.technology, row.site, row.status, row.ponPorts, row.ponCodePrefix,
    row.ponPortNamesJson
  ]);

  const oltIdByKey = new Map();
  if (plan.ponNaps.length) {
    const [oltRows] = await connection.query('SELECT id, branch_id, name FROM pon_olts');
    (oltRows || []).forEach((row) => oltIdByKey.set(branchKey(row.branch_id, row.name), row.id));
  }
  await insertRows(connection, 'pon_naps', REQUIRED_TABLE_COLUMNS.pon_naps, plan.ponNaps, (row) => [
    row.branchId, oltIdByKey.get(branchKey(row.branchId, row.linkedOlt)), row.clientUid, row.code, row.area,
    row.coordinate, row.splitter, row.ponRef, row.ponCapacity, row.capacity, row.used, row.opticalPower
  ]);

  const napIdByKey = new Map();
  if (plan.ponNaps.some((nap) => nap.connections.length)) {
    const [napRows] = await connection.query('SELECT id, branch_id, client_uid FROM pon_naps');
    (napRows || []).forEach((row) => napIdByKey.set(branchKey(row.branch_id, row.client_uid), row.id));
  }
  const connectionRows = plan.ponNaps.flatMap((nap) => nap.connections.map((entry) => ({
    ...entry,
    napId: napIdByKey.get(branchKey(nap.branchId, nap.clientUid))
  })));
  await insertRows(
    connection,
    'pon_nap_connections',
    REQUIRED_TABLE_COLUMNS.pon_nap_connections,
    connectionRows,
    (row) => [row.napId, row.customerAccountNumber, row.customerName, row.customerRef, row.port, row.opticalInfo]
  );
  await insertRows(connection, 'activity_logs', REQUIRED_TABLE_COLUMNS.activity_logs, plan.activityLogs, (row) => [
    row.id, row.branchId, row.message, row.meta, row.timestamp, row.userId, row.username
  ]);
  await insertRows(
    connection,
    'business_profiles',
    REQUIRED_TABLE_COLUMNS.business_profiles,
    plan.businessProfiles,
    (row) => [row.branchId, row.businessName, row.tagline, row.supportEmail, row.contact, row.address, row.logoBase64, row.updatedAt]
  );
  await insertRows(
    connection,
    'integration_settings',
    REQUIRED_TABLE_COLUMNS.integration_settings,
    plan.integrationSettings,
    (row) => [row.branchId, row.provider, JSON.stringify(encryptJson(row.settings))]
  );
  await insertRows(
    connection,
    storeTable,
    REQUIRED_TABLE_COLUMNS.app_store,
    plan.appStoreRows,
    (row) => [row.storeKey, row.payload]
  );

  return {
    sourceStorageDriver: 'json',
    targetStorageDriver: 'mysql',
    relationalRecordCount: plan.relationalRecordCount,
    warnings: [...plan.warnings]
  };
}

module.exports = {
  REQUIRED_TABLE_COLUMNS,
  buildJsonToMysqlPlan,
  getRequiredTableColumns,
  applyJsonToMysqlPlan
};
