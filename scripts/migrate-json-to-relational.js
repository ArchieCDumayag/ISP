require('../core/config/env-loader');

const fs = require('fs');
const path = require('path');
const { query, isMysqlEnabled } = require('../core/data/db');
const { encryptJson, getMasterKeySource } = require('../core/data/db-secrets');
const { hashPassword, isHashedPassword } = require('../core/security/passwords');
const { clearRelationalCache } = require('../core/data/db-relational');
const { DATA_DIR } = require('../core/runtime/paths');
const { backfillManualJobNumbers } = require('../Features/modules/technician/backend/job-numbering');
const { serializePlanProfileBindings } = require('../Features/modules/billing/backend/plan-profile-utils');

const BRANCH_NAME = String(process.env.INITIAL_BRANCH_NAME || 'Main').trim() || 'Main';
const RESET_DB = String(process.env.RESET_DB || '').trim().toLowerCase() === 'true' || process.env.RESET_DB === '1';

const readJsonFile = (name, fallback) => {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const parseDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const normalizeOnuSerialNumber = (value) => {
  const normalized = String(value == null ? '' : value)
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  if (normalized.length > 160) {
    throw new Error('ONU serial number must be 160 characters or fewer.');
  }
  return normalized || null;
};

async function resetTables() {
  const tables = [
    'sms_automation_runs',
    'sms_automations',
    'sms_schedules',
    'sms_templates',
    'sms_messages',
    'pon_nap_connections',
    'pon_naps',
    'pon_olts',
    'finance_payroll',
    'finance_expenses',
    'payment_entries',
    'jobs',
    'tickets',
    'collector_assignments',
    'coverage_areas',
    'customers',
    'plans',
    'activity_logs',
    'integration_settings',
    'business_profiles',
    'sessions',
    'users',
    'branches'
  ];
  await query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of tables) {
    await query(`TRUNCATE TABLE ${table}`);
  }
  await query('SET FOREIGN_KEY_CHECKS=1');
}

async function ensureBranch(name) {
  const [rows] = await query('SELECT id FROM branches WHERE name = ? LIMIT 1', [name]);
  if (rows.length) return rows[0].id;
  await query('INSERT INTO branches (name, code) VALUES (?, ?)', [name, name.toLowerCase().replace(/\s+/g, '-')]);
  const [created] = await query('SELECT id FROM branches WHERE name = ? LIMIT 1', [name]);
  return created[0].id;
}

async function upsertUser(user, branchId) {
  const password = String(user.password || '');
  const hash = password ? (isHashedPassword(password) ? password : hashPassword(password)) : hashPassword('changeme');
  await query(
    `INSERT INTO users (id, username, password_hash, role, name, branch_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       password_hash = VALUES(password_hash),
       role = VALUES(role),
       name = VALUES(name),
       branch_id = VALUES(branch_id)`,
    [
      String(user.id),
      user.username || '',
      hash,
      user.role || 'Collector',
      user.name || user.username || null,
      branchId,
      parseDateTime(user.created) || new Date().toISOString().slice(0, 19).replace('T', ' ')
    ]
  );
}

async function upsertCustomer(customer, branchId) {
  const loginPassword = String(customer.loginPassword || '').trim() || null;
  const accountNumber = String(customer.accountNumber || '').trim();
  const customerColumns = [
    'first_name', 'last_name', 'name', 'email', 'mobile', 'mobile_raw',
    'street', 'barangay', 'municipality', 'province', 'area', 'map_pin', 'status', 'remarks', 'since',
    'activation_date', 'plan_name', 'plan_amount', 'plan_billing', 'plan_category',
    'scheduled_plan_id', 'scheduled_plan_name', 'scheduled_plan_amount', 'scheduled_plan_billing',
    'scheduled_plan_category', 'scheduled_plan_apply_at', 'scheduled_pppoe_profile',
    'bill_date', 'due_date', 'prepaid_expiration_at', 'due_offset', 'credit_limit',
    'login_username', 'login_password_hash', 'pppoe_mode', 'mikrotik_id', 'pppoe_username',
    'pppoe_password', 'pppoe_profile', 'onu_serial_number'
  ];
  const customerValues = [
      customer.firstName || null,
      customer.lastName || null,
      customer.name || null,
      customer.email || null,
      customer.mobile || null,
      customer.mobileRaw || null,
      customer.street || null,
      customer.barangay || null,
      customer.municipality || null,
      customer.province || null,
      customer.area || null,
      customer.mapPin || null,
      customer.status || null,
      customer.remarks || null,
      customer.since || null,
      parseDateOnly(customer.activationDate || customer.activation_date),
      customer.planName || null,
      customer.planAmount != null ? Number(customer.planAmount) : null,
      customer.planBilling || null,
      customer.planCategory || null,
      customer.scheduledPlanId || null,
      customer.scheduledPlanName || null,
      customer.scheduledPlanAmount != null ? Number(customer.scheduledPlanAmount) : null,
      customer.scheduledPlanBilling || null,
      customer.scheduledPlanCategory || null,
      parseDateTime(customer.scheduledPlanApplyAt),
      customer.scheduledPppoeProfile || null,
      parseDateOnly(customer.billDate),
      parseDateOnly(customer.dueDate),
      parseDateTime(customer.prepaidExpirationAt || customer.prepaid_expiration_at),
      Number.isFinite(Number(customer.dueOffset)) ? Number(customer.dueOffset) : null,
      Number.isFinite(Number(customer.creditLimit)) ? Number(customer.creditLimit) : null,
      customer.loginUsername || null,
      loginPassword,
      customer.pppoeMode || null,
      customer.mikrotikId || customer.routerId || null,
      customer.pppoeUsername || null,
      customer.pppoePassword != null ? String(customer.pppoePassword) : null,
      customer.pppoeProfile || null,
      normalizeOnuSerialNumber(
        customer.onuSerialNumber ?? customer.onu_serial_number ?? customer.onuSerial
      )
  ];
  const [existingRows] = await query(
    'SELECT account_number, branch_id FROM customers WHERE account_number = ? LIMIT 1',
    [accountNumber]
  );
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (existing && Number(existing.branch_id) !== Number(branchId)) {
    throw new Error(`Customer account ${accountNumber} already belongs to another branch.`);
  }
  if (existing) {
    const assignments = customerColumns.map((column) => (
      column === 'onu_serial_number'
        ? `${column} = COALESCE(?, ${column})`
        : `${column} = ?`
    ));
    await query(
      `UPDATE customers
       SET ${assignments.join(', ')}
       WHERE account_number = ?
         AND branch_id = ?`,
      [...customerValues, accountNumber, branchId]
    );
    return;
  }
  const insertColumns = ['account_number', 'branch_id', ...customerColumns];
  await query(
    `INSERT INTO customers (${insertColumns.join(', ')})
     VALUES (${insertColumns.map(() => '?').join(', ')})`,
    [accountNumber, branchId, ...customerValues]
  );
}

async function upsertPlan(plan, branchId) {
  await query(
    `INSERT INTO plans (
        branch_id, plan_id, name, label, category, description, profile, profile_bindings, price, price_suffix, validity, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        label = VALUES(label),
        category = VALUES(category),
        description = VALUES(description),
        profile = VALUES(profile),
        profile_bindings = VALUES(profile_bindings),
        price = VALUES(price),
        price_suffix = VALUES(price_suffix),
        validity = VALUES(validity),
        updated_at = VALUES(updated_at)`,
    [
      branchId,
      plan.id || plan.plan_id || plan.name || '',
      plan.name || null,
      plan.label || null,
      plan.category || null,
      plan.description || null,
      plan.profile || null,
      serializePlanProfileBindings(plan.profileBindings || plan.profile_bindings),
      plan.price != null ? Number(plan.price) : null,
      '/ month',
      null,
      parseDateTime(plan.createdAt) || null,
      parseDateTime(plan.updatedAt) || null
    ]
  );
}

async function upsertCoverage(area, branchId) {
     await query(
     `INSERT INTO coverage_areas (
         branch_id, name, category, lat, lng, status, notes, area_code, mikrotik_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
         category = VALUES(category),
         lat = VALUES(lat),
         lng = VALUES(lng),
         status = VALUES(status),
         notes = VALUES(notes),
         area_code = VALUES(area_code),
         mikrotik_id = VALUES(mikrotik_id),
         updated_at = VALUES(updated_at)`,
    [
      branchId,
      area.name || area.area || area.label || '',
      area.category || null,
      area.lat != null ? Number(area.lat) : null,
      area.lng != null ? Number(area.lng) : null,
      area.status || null,
      area.notes || null,
      area.areaCode || null,
      area.mikrotikId || area.routerId || null,
      parseDateTime(area.created) || null,
      parseDateTime(area.updated) || null
    ]
  );
}

async function upsertPaymentEntry(entry, accountNumber, branchId) {
  const recordedBy = entry.recordedBy || {};
  await query(
    `INSERT INTO payment_entries (
        id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description, type,
        recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name, recorded_by_role,
        payer, status, payment_method, fingerprint, xendit_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        amount = VALUES(amount),
        date = VALUES(date),
        kind = VALUES(kind),
        direction = VALUES(direction),
        reference = VALUES(reference),
        or_number = VALUES(or_number),
        description = VALUES(description),
        type = VALUES(type),
        recorded_at = VALUES(recorded_at),
        recorded_by_user_id = VALUES(recorded_by_user_id),
        recorded_by_username = VALUES(recorded_by_username),
        recorded_by_name = VALUES(recorded_by_name),
        recorded_by_role = VALUES(recorded_by_role),
        payer = VALUES(payer),
        status = VALUES(status),
        payment_method = VALUES(payment_method),
        fingerprint = VALUES(fingerprint),
        xendit_id = VALUES(xendit_id)`,
    [
      String(entry.id || `${accountNumber}-${Date.now()}`),
      branchId,
      String(accountNumber),
      Number(entry.amount) || 0,
      parseDateOnly(entry.date) || parseDateOnly(entry.recordedAt),
      entry.kind || null,
      entry.direction || null,
      entry.reference || null,
      entry.orNumber || entry.or_number || null,
      entry.description || null,
      entry.type || null,
      parseDateTime(entry.recordedAt || entry.date),
      recordedBy.id ? String(recordedBy.id) : null,
      recordedBy.username || null,
      recordedBy.name || null,
      recordedBy.role || null,
      entry.payer || null,
      entry.status || null,
      entry.paymentMethod || null,
      entry.fingerprint || null,
      entry.xenditId || null
    ]
  );
}

async function upsertTicket(ticket, branchId) {
  await query(
    `INSERT INTO tickets (
        id, branch_id, subject, description, customer_name, account_number, contact, status,
        assigned_to, source, created_at, updated_at, history_job_id, history_job_created_at, ticket_number
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        subject = VALUES(subject),
        description = VALUES(description),
        customer_name = VALUES(customer_name),
        account_number = VALUES(account_number),
        contact = VALUES(contact),
        status = VALUES(status),
        assigned_to = VALUES(assigned_to),
        source = VALUES(source),
        created_at = VALUES(created_at),
        updated_at = VALUES(updated_at),
        history_job_id = VALUES(history_job_id),
        history_job_created_at = VALUES(history_job_created_at),
        ticket_number = VALUES(ticket_number)`,
    [
      ticket.id || null,
      branchId,
      ticket.subject || null,
      ticket.description || null,
      ticket.customerName || null,
      ticket.accountNumber || null,
      ticket.contact || null,
      ticket.status || null,
      ticket.assignedTo || null,
      ticket.source || null,
      parseDateTime(ticket.createdAt) || null,
      parseDateTime(ticket.updatedAt) || null,
      ticket.historyJobId || null,
      parseDateTime(ticket.historyJobCreatedAt) || null,
      ticket.ticketNumber || null
    ]
  );
}

async function upsertJob(job, branchId) {
  await query(
    `INSERT INTO jobs (
        id, branch_id, type, technician, priority, schedule, status, done_at, notes, description,
        created_at, updated_at, ticket_id, ticket_number, ticket_subject, origin
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        type = VALUES(type),
        technician = VALUES(technician),
        priority = VALUES(priority),
        schedule = VALUES(schedule),
        status = VALUES(status),
        done_at = VALUES(done_at),
        notes = VALUES(notes),
        description = VALUES(description),
        created_at = VALUES(created_at),
        updated_at = VALUES(updated_at),
        ticket_id = VALUES(ticket_id),
        ticket_number = VALUES(ticket_number),
        ticket_subject = VALUES(ticket_subject),
        origin = VALUES(origin)`,
    [
      job.id || null,
      branchId,
      job.type || null,
      job.technician || null,
      job.priority || null,
      parseDateTime(job.schedule) || null,
      job.status || null,
      parseDateTime(job.doneAt) || null,
      job.notes || null,
      job.description || null,
      parseDateTime(job.createdAt) || null,
      parseDateTime(job.updatedAt) || null,
      job.ticketId || null,
      job.ticketNumber || null,
      job.ticketSubject || null,
      job.origin || null
    ]
  );
}

async function upsertActivityLog(entry, branchId) {
  await query(
    `INSERT INTO activity_logs (id, branch_id, message, meta, timestamp, user_id, username)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       message = VALUES(message),
       meta = VALUES(meta),
       timestamp = VALUES(timestamp),
       user_id = VALUES(user_id),
       username = VALUES(username)`,
    [
      entry.id || null,
      branchId,
      entry.message || null,
      entry.meta || null,
      parseDateTime(entry.timestamp) || null,
      entry.userId || null,
      entry.username || null
    ]
  );
}

async function upsertBusinessProfile(profile, branchId) {
  await query(
    `INSERT INTO business_profiles (
        branch_id, business_name, tagline, support_email, contact, address, logo_base64, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        business_name = VALUES(business_name),
        tagline = VALUES(tagline),
        support_email = VALUES(support_email),
        contact = VALUES(contact),
        address = VALUES(address),
        logo_base64 = VALUES(logo_base64),
        updated_at = VALUES(updated_at)`,
    [
      branchId,
      profile.businessName || null,
      profile.tagline || null,
      profile.supportEmail || null,
      profile.contact || null,
      profile.address || null,
      profile.logoUrl || profile.logoBase64 || null,
      new Date().toISOString().slice(0, 19).replace('T', ' ')
    ]
  );
}

async function upsertIntegrationSettings(settings, branchId) {
  const encrypted = encryptJson(settings || {});
  await query(
    `INSERT INTO integration_settings (branch_id, provider, secret_json)
     VALUES (?, 'core', ?)
     ON DUPLICATE KEY UPDATE
       secret_json = VALUES(secret_json)`,
    [branchId, JSON.stringify(encrypted)]
  );
}

async function upsertSessions(sessions) {
  const entries = Object.entries(sessions || {});
  for (const [sid, value] of entries) {
    await query(
      `INSERT INTO sessions (session_id, user_id, created_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         created_at = VALUES(created_at)`,
      [sid, String(value.userId || ''), Number(value.createdAt) || Date.now()]
    );
  }
}

async function upsertCollectorAssignments(assignments, branchId) {
  if (!assignments || typeof assignments !== 'object') return;
  const [areas] = await query('SELECT id, name FROM coverage_areas WHERE branch_id = ?', [branchId]);
  const [users] = await query('SELECT id FROM users WHERE branch_id = ?', [branchId]);
  const areaMap = new Map((areas || []).map((row) => [String(row.name), row.id]));
  const userIds = new Set((users || []).map((row) => String(row.id)));
  let skippedOrphans = 0;
  for (const [areaName, collectorId] of Object.entries(assignments)) {
    if (!collectorId) continue;
    if (!userIds.has(String(collectorId))) {
      skippedOrphans += 1;
      continue;
    }
    const coverageId = areaMap.get(String(areaName)) || null;
    await query(
      `INSERT INTO collector_assignments (branch_id, coverage_id, area_name, collector_user_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         coverage_id = VALUES(coverage_id),
         collector_user_id = VALUES(collector_user_id),
         area_name = VALUES(area_name)`,
      [branchId, coverageId, areaName, String(collectorId)]
    );
  }
  if (skippedOrphans) {
    console.warn(`[warn] Skipped ${skippedOrphans} orphaned collector assignment(s) with no matching user.`);
  }
}

async function migrate() {
  if (!isMysqlEnabled()) {
    throw new Error('MySQL is not configured. Set MYSQL_* env or save config first.');
  }
  if (getMasterKeySource() === 'none') {
    throw new Error('CONFIG_MASTER_KEY is required before migrating JSON data.');
  }

  if (RESET_DB) {
    await resetTables();
  }

  const branchId = await ensureBranch(BRANCH_NAME);

  const accounts = readJsonFile('accounts.json', []);
  for (const account of accounts || []) {
    await upsertUser(account, branchId);
  }

  const customers = readJsonFile('customers.json', []);
  for (const customer of customers || []) {
    await upsertCustomer(customer, branchId);
  }

  const plans = readJsonFile('plans.json', []);
  for (const plan of plans || []) {
    await upsertPlan(plan, branchId);
  }

  const coverage = readJsonFile('coverage.json', []);
  for (const area of coverage || []) {
    await upsertCoverage(area, branchId);
  }

  const collectors = readJsonFile('collectors.json', { assignments: {} });
  await upsertCollectorAssignments(collectors.assignments || {}, branchId);

  const payments = readJsonFile('payments.json', {});
  for (const [accountNumber, payload] of Object.entries(payments || {})) {
    const history = payload && Array.isArray(payload.history) ? payload.history : [];
    for (const entry of history) {
      await upsertPaymentEntry(entry, accountNumber, branchId);
    }
  }

  const tickets = readJsonFile('tickets.json', []);
  for (const ticket of tickets || []) {
    await upsertTicket(ticket, branchId);
  }

  const jobs = readJsonFile('jobs.json', []);
  for (const job of jobs || []) {
    await upsertJob(job, branchId);
  }
  await backfillManualJobNumbers();

  const activity = readJsonFile('activity-log.json', { logs: [] });
  for (const entry of activity.logs || []) {
    await upsertActivityLog(entry, branchId);
  }

  const businessProfile = readJsonFile('business-profile.json', null);
  if (businessProfile) {
    await upsertBusinessProfile(businessProfile, branchId);
  }

  const integrations = readJsonFile('integrations.json', null);
  if (integrations) {
    await upsertIntegrationSettings(integrations, branchId);
  }

  const sessions = readJsonFile('sessions.json', { sessions: {} });
  await upsertSessions(sessions.sessions || {});

  clearRelationalCache();
  console.log('JSON migration complete.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err?.message || err);
    process.exit(1);
  });
