const crypto = require('crypto');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { getPool } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { getStorageDriver } = require('../../../../core/config/storage-mode');
const { DATA_DIR, PUBLIC_ROOT } = require('../../../../core/runtime/paths');
const { verifyPassword } = require('../../../../core/security/passwords');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { loadAccounts, saveAccounts } = require('./accounts-store');

const router = express.Router();

const CONFIRMATION_PHRASE = 'CLEAR ALL DATA';
const RESET_AUDIT_STORE_KEY = 'factory_reset_audit';
const RESET_AUDIT_VERSION = 1;
const STORE_TABLE_PATTERN = /^[A-Za-z0-9_]+$/;

const STORE_RESETTERS = Object.freeze({
  'activity-log': (now) => ({
    logs: [{
      id: crypto.randomBytes(8).toString('hex'),
      message: 'All project business records were cleared.',
      meta: 'Factory reset completed',
      timestamp: now,
      username: 'System'
    }],
    updatedAt: now
  }),
  'billing-clock-guard': () => ({}),
  collector_followups: (now) => ({ records: [], updatedAt: now }),
  collector_remittances: (now) => ({ records: [], updatedAt: now }),
  collectors: () => ({ assignments: {} }),
  coverage: () => [],
  customer_archives: () => [],
  customer_draft_submissions: () => [],
  customer_fcm_tokens: () => ({ tokens: {} }),
  customer_notification_inbox: () => ({ accounts: {} }),
  customer_sessions: (now) => ({ sessions: {}, updatedAt: now }),
  customers: () => [],
  disconnection_decisions: () => ({}),
  jobs: () => [],
  messenger_reminders: () => ({ version: 1, branches: {} }),
  payment_breakdown_adjustments: () => ({}),
  payment_import_unmatched: () => ({}),
  gcash_transaction_history: () => ({ version: 1, branches: {} }),
  payments: () => ({}),
  plans: () => [],
  'pon-state': () => ({}),
  public_applications: () => [],
  referral_registry: () => ({ version: 1, branches: {} }),
  sessions: (now) => ({ sessions: {}, updatedAt: now }),
  sms_automation_runs: () => [],
  sms_messages: () => [],
  temp_workspace_isolated_v1: () => ({
    schemaVersion: 3,
    locationName: 'Secondary Location',
    customers: [],
    payments: [],
    sequences: { customer: 0, payment: 0 },
    updatedAt: null
  }),
  tickets: () => []
});

const DYNAMIC_STORE_RESETTERS = Object.freeze([
  { prefix: 'finance_expenses_branch_', reset: () => [] },
  { prefix: 'finance_payroll_branch_', reset: () => [] },
  { prefix: 'genieacs_customer_bindings_', reset: () => ({ devices: {} }) },
  { prefix: 'genieacs_device_snapshot_', reset: () => ({}) },
  { prefix: 'lock:', reset: () => ({}) },
  { prefix: 'map:', reset: () => ({}) },
  { prefix: 'seq:', reset: () => ({}) }
]);

const PRESERVED_DATA = Object.freeze([
  'Admin accounts and active Admin sessions',
  'Branches, business profile, and account-number settings',
  'Integration credentials and provider configuration',
  'Customer App and collector option configuration',
  'Application download assets and source code'
]);

const RELATIONAL_DELETE_ORDER = Object.freeze([
  'payment_entries',
  'payment_confirmation_queue',
  'customer_draft_submissions',
  'customer_archives',
  'jobs',
  'tickets',
  'sms_automation_runs',
  'sms_messages',
  'sms_schedules',
  'sms_automations',
  'sms_templates',
  'finance_expenses',
  'finance_payroll',
  'collector_assignments',
  'pon_nap_connections',
  'pon_naps',
  'pon_olts',
  'customers',
  'plans',
  'coverage_areas',
  'activity_logs'
]);

const RELATIONAL_LABELS = Object.freeze({
  payment_entries: 'Payment and billing entries',
  payment_confirmation_queue: 'Payment confirmation records',
  customer_draft_submissions: 'Customer drafts',
  customer_archives: 'Customer archives',
  jobs: 'Technician jobs',
  tickets: 'Support tickets',
  sms_automation_runs: 'SMS automation history',
  sms_messages: 'SMS message history',
  sms_schedules: 'SMS schedules',
  sms_automations: 'SMS automations',
  sms_templates: 'SMS templates',
  finance_expenses: 'Expense records',
  finance_payroll: 'Payroll records',
  collector_assignments: 'Collector assignments',
  pon_nap_connections: 'PON client connections',
  pon_naps: 'PON NAP records',
  pon_olts: 'PON OLT records',
  customers: 'Customers',
  plans: 'Plans',
  coverage_areas: 'Coverage areas',
  activity_logs: 'Activity history'
});

const FILE_TARGETS = Object.freeze([
  { root: DATA_DIR, target: path.join(DATA_DIR, 'backups'), label: 'Saved data backups' },
  { root: DATA_DIR, target: path.join(DATA_DIR, 'payment-backups'), label: 'Payment backup files' },
  { root: DATA_DIR, target: path.join(DATA_DIR, 'pdf-cache'), label: 'Generated PDF cache' },
  { root: DATA_DIR, target: path.join(DATA_DIR, 'uploads'), label: 'Legacy record uploads' },
  { root: path.join(PUBLIC_ROOT, 'uploads'), target: path.join(PUBLIC_ROOT, 'uploads', 'payment-proofs'), label: 'Payment proof images' }
]);

const JSON_FILE_EXCLUSIONS = new Set([
  'mysql-config',
  'mysql-config.backup',
  RESET_AUDIT_STORE_KEY
]);

const cloneJson = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const getDynamicStoreResetter = (key) => {
  const normalized = String(key || '').trim();
  return DYNAMIC_STORE_RESETTERS.find((entry) => normalized.startsWith(entry.prefix)) || null;
};

const shouldResetStoreKey = (key) => (
  Object.prototype.hasOwnProperty.call(STORE_RESETTERS, String(key || '').trim())
  || Boolean(getDynamicStoreResetter(key))
);

const buildResetValue = (key, now) => {
  const normalized = String(key || '').trim();
  const exact = STORE_RESETTERS[normalized];
  if (exact) return exact(now);
  const dynamic = getDynamicStoreResetter(normalized);
  return dynamic ? dynamic.reset(now) : undefined;
};

const countArrayCollections = (value) => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((total, child) => total + countArrayCollections(child), 0);
};

const countStoreRecords = (key, value) => {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== 'object') return 0;
  if (Array.isArray(value.records)) return value.records.length;
  if (Array.isArray(value.logs)) return value.logs.length;
  if (key === 'sessions' || key === 'customer_sessions') return Object.keys(value.sessions || {}).length;
  if (key === 'customer_fcm_tokens') return Object.keys(value.tokens || {}).length;
  if (key === 'customer_notification_inbox') {
    return Object.values(value.accounts || {}).reduce(
      (total, notifications) => total + (Array.isArray(notifications) ? notifications.length : 0),
      0
    );
  }
  if (key === 'collectors') {
    return Object.values(value.assignments || {}).reduce(
      (total, assignments) => total + (Array.isArray(assignments) ? assignments.length : (assignments ? 1 : 0)),
      0
    );
  }
  if (key === 'messenger_reminders') {
    return Object.values(value.branches || {}).reduce((total, branch) => (
      total
      + Object.keys(branch?.preferences || {}).length
      + Object.keys(branch?.reminders || {}).length
    ), 0);
  }
  if (key === 'temp_workspace_isolated_v1') {
    return (Array.isArray(value.customers) ? value.customers.length : 0)
      + (Array.isArray(value.payments) ? value.payments.length : 0);
  }
  const nestedArrays = countArrayCollections(value);
  if (nestedArrays > 0) return nestedArrays;
  return Object.keys(value).length;
};

const normalizeStoreTableName = () => {
  const configured = String(process.env.MYSQL_STORE_TABLE || 'app_store').trim() || 'app_store';
  if (!STORE_TABLE_PATTERN.test(configured)) {
    throw new Error('MYSQL_STORE_TABLE contains unsupported characters.');
  }
  return configured;
};

const assertContainedDirectory = (rootPath, targetPath) => {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe factory reset directory target: ${target}`);
  }
  return target;
};

const inspectDirectory = async (target) => {
  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { files: 0, bytes: 0 };
    throw error;
  }
  let files = 0;
  let bytes = 0;
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      const nested = await inspectDirectory(entryPath);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      try {
        const stat = await fs.lstat(entryPath);
        bytes += Number(stat.size || 0);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return { files, bytes };
};

const previewFiles = async () => {
  const categories = [];
  for (const item of FILE_TARGETS) {
    const target = assertContainedDirectory(item.root, item.target);
    const result = await inspectDirectory(target);
    categories.push({ key: `files:${item.label}`, label: item.label, count: result.files, bytes: result.bytes });
  }
  return categories;
};

const clearFiles = async () => {
  const cleared = [];
  const warnings = [];
  for (const item of FILE_TARGETS) {
    const target = assertContainedDirectory(item.root, item.target);
    let entries = [];
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        cleared.push({ label: item.label, count: 0 });
        continue;
      }
      warnings.push(`${item.label}: ${error.message}`);
      continue;
    }
    let count = 0;
    for (const entry of entries) {
      try {
        const entryPath = assertContainedDirectory(item.root, path.join(target, entry.name));
        const inspected = entry.isDirectory() ? await inspectDirectory(entryPath) : { files: 1 };
        await fs.rm(entryPath, { recursive: true, force: true });
        count += Number(inspected.files || 0);
      } catch (error) {
        warnings.push(`${item.label}/${entry.name}: ${error.message}`);
      }
    }
    cleared.push({ label: item.label, count });
  }
  return { cleared, warnings };
};

const listJsonStoreKeys = async () => {
  let entries = [];
  try {
    entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name.slice(0, -5))
    .filter((key) => !JSON_FILE_EXCLUSIONS.has(key));
};

const getExistingRelationalTables = async (connection) => {
  const [rows] = await connection.query(
    `SELECT table_name AS tableName
     FROM information_schema.tables
     WHERE table_schema = DATABASE()`
  );
  return new Set((rows || []).map((row) => String(row.tableName || row.TABLE_NAME || '')));
};

const sumCounts = (categories) => categories.reduce((total, item) => total + Number(item.count || 0), 0);

const buildAuditPayload = ({ actor, storageDriver, recordsCleared, filesCleared, warnings, resetAt }) => ({
  version: RESET_AUDIT_VERSION,
  lastReset: {
    id: `factory-reset-${crypto.randomUUID()}`,
    resetAt,
    actor: {
      id: String(actor?.id || ''),
      username: String(actor?.username || ''),
      name: String(actor?.name || actor?.username || '')
    },
    storageDriver,
    recordsCleared: Number(recordsCleared || 0),
    filesCleared: Number(filesCleared || 0),
    warnings: Array.isArray(warnings) ? warnings.slice(0, 20) : []
  }
});

function createFactoryResetService(options = {}) {
  const readStore = options.readJson || readJson;
  const writeStore = options.writeJson || writeJson;
  const loadAccountRecords = options.loadAccounts || loadAccounts;
  const saveAccountRecords = options.saveAccounts || saveAccounts;
  const relationalReady = options.isRelationalReady || isRelationalReady;
  const acquirePool = options.getPool || getPool;
  const storageDriver = options.getStorageDriver || getStorageDriver;
  const listStoreKeys = options.listJsonStoreKeys || listJsonStoreKeys;
  const inspectFiles = options.previewFiles || previewFiles;
  const deleteFiles = options.clearFiles || clearFiles;

  const listAdminAccounts = async () => {
    const accounts = await loadAccountRecords({ includeSystem: true });
    const persisted = (Array.isArray(accounts) ? accounts : []).filter((account) => !account?.system);
    const admins = persisted.filter((account) => accountHasRole(account, 'Admin'));
    if (!admins.length) throw new Error('Factory reset stopped because no persistent Admin account was found.');
    return { accounts: persisted, admins, removed: persisted.filter((account) => !accountHasRole(account, 'Admin')) };
  };

  const previewJson = async () => {
    const storeKeys = (await listStoreKeys()).filter(shouldResetStoreKey);
    const categories = [];
    for (const key of storeKeys) {
      const value = await readStore(key, null);
      categories.push({ key, label: key.replace(/[_-]+/g, ' '), count: countStoreRecords(key, value) });
    }
    const accountScope = await listAdminAccounts();
    if (accountScope.removed.length) {
      categories.push({ key: 'non-admin-accounts', label: 'Non-Admin staff accounts', count: accountScope.removed.length });
    }
    const fileCategories = await inspectFiles();
    return {
      ok: true,
      storageDriver: storageDriver(),
      confirmationPhrase: CONFIRMATION_PHRASE,
      categories: [...categories, ...fileCategories],
      recordCount: sumCounts(categories),
      fileCount: sumCounts(fileCategories),
      preserved: [...PRESERVED_DATA]
    };
  };

  const previewRelational = async () => {
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    try {
      const existingTables = await getExistingRelationalTables(connection);
      const categories = [];
      for (const tableName of RELATIONAL_DELETE_ORDER) {
        if (!existingTables.has(tableName)) continue;
        const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
        categories.push({
          key: tableName,
          label: RELATIONAL_LABELS[tableName] || tableName,
          count: Number(rows?.[0]?.count || 0)
        });
      }
      const accountScope = await listAdminAccounts();
      if (accountScope.removed.length) {
        categories.push({ key: 'non-admin-accounts', label: 'Non-Admin staff accounts', count: accountScope.removed.length });
      }

      const storeTable = normalizeStoreTableName();
      if (existingTables.has(storeTable)) {
        const [storeRows] = await connection.query(`SELECT store_key, payload FROM \`${storeTable}\``);
        (storeRows || [])
          .filter((row) => shouldResetStoreKey(row.store_key))
          .forEach((row) => {
            let payload = null;
            try {
              payload = JSON.parse(row.payload);
            } catch {
              payload = row.payload;
            }
            categories.push({
              key: `store:${row.store_key}`,
              label: String(row.store_key).replace(/[_-]+/g, ' '),
              count: countStoreRecords(row.store_key, payload)
            });
          });
      }
      const fileCategories = await inspectFiles();
      return {
        ok: true,
        storageDriver: storageDriver(),
        confirmationPhrase: CONFIRMATION_PHRASE,
        categories: [...categories, ...fileCategories],
        recordCount: sumCounts(categories),
        fileCount: sumCounts(fileCategories),
        preserved: [...PRESERVED_DATA]
      };
    } finally {
      connection.release();
    }
  };

  const preview = async () => (await relationalReady() ? previewRelational() : previewJson());

  const resetJson = async (actor) => {
    const resetAt = new Date().toISOString();
    const storeKeys = (await listStoreKeys()).filter(shouldResetStoreKey);
    const originalStores = new Map();
    const accountScope = await listAdminAccounts();
    let recordsCleared = accountScope.removed.length;

    for (const key of storeKeys) {
      const original = await readStore(key, null);
      originalStores.set(key, cloneJson(original));
      recordsCleared += countStoreRecords(key, original);
    }

    try {
      await saveAccountRecords(accountScope.admins);
      const adminIds = new Set(accountScope.admins.map((account) => String(account.id)));
      for (const key of storeKeys) {
        if (key === 'sessions') {
          const original = originalStores.get(key) || {};
          const sessions = Object.fromEntries(
            Object.entries(original.sessions || {}).filter(([, session]) => adminIds.has(String(session?.userId || '')))
          );
          await writeStore(key, { sessions, updatedAt: resetAt });
          continue;
        }
        await writeStore(key, buildResetValue(key, resetAt));
      }
    } catch (error) {
      await saveAccountRecords(accountScope.accounts).catch(() => {});
      for (const [key, original] of originalStores.entries()) {
        await writeStore(key, original).catch(() => {});
      }
      throw error;
    }

    const fileResult = await deleteFiles();
    const filesCleared = sumCounts(fileResult.cleared || []);
    const audit = buildAuditPayload({
      actor,
      storageDriver: storageDriver(),
      recordsCleared,
      filesCleared,
      warnings: fileResult.warnings,
      resetAt
    });
    await writeStore(RESET_AUDIT_STORE_KEY, audit);
    return { recordsCleared, filesCleared, warnings: fileResult.warnings || [], resetAt, audit: audit.lastReset };
  };

  const resetRelational = async (actor) => {
    const resetAt = new Date().toISOString();
    const accountScope = await listAdminAccounts();
    const adminIds = new Set(accountScope.admins.map((account) => String(account.id)));
    const removableIds = accountScope.removed.map((account) => String(account.id));
    const pool = await acquirePool();
    if (!pool) throw new Error('MySQL connection is not available.');
    const connection = await pool.getConnection();
    let recordsCleared = 0;
    try {
      const existingTables = await getExistingRelationalTables(connection);
      const storeTable = normalizeStoreTableName();
      await connection.beginTransaction();

      for (const tableName of RELATIONAL_DELETE_ORDER) {
        if (!existingTables.has(tableName)) continue;
        const [result] = await connection.query(`DELETE FROM \`${tableName}\``);
        recordsCleared += Number(result?.affectedRows || 0);
      }

      if (existingTables.has('sessions') && adminIds.size) {
        const placeholders = [...adminIds].map(() => '?').join(', ');
        const [result] = await connection.query(
          `DELETE FROM sessions WHERE user_id NOT IN (${placeholders})`,
          [...adminIds]
        );
        recordsCleared += Number(result?.affectedRows || 0);
      }

      if (existingTables.has('users') && removableIds.length) {
        const placeholders = removableIds.map(() => '?').join(', ');
        const [result] = await connection.query(
          `DELETE FROM users WHERE id IN (${placeholders})`,
          removableIds
        );
        recordsCleared += Number(result?.affectedRows || 0);
      }

      if (existingTables.has(storeTable)) {
        const [storeRows] = await connection.query(`SELECT store_key FROM \`${storeTable}\``);
        const resetKeys = (storeRows || [])
          .map((row) => String(row.store_key || ''))
          .filter(shouldResetStoreKey);
        if (resetKeys.length) {
          const placeholders = resetKeys.map(() => '?').join(', ');
          const [result] = await connection.query(
            `DELETE FROM \`${storeTable}\` WHERE store_key IN (${placeholders})`,
            resetKeys
          );
          recordsCleared += Number(result?.affectedRows || 0);
        }
      }

      if (existingTables.has('activity_logs')) {
        const branchId = Number(actor?.branchId || accountScope.admins[0]?.branchId || 0);
        if (Number.isInteger(branchId) && branchId > 0) {
          await connection.query(
            `INSERT INTO activity_logs (id, branch_id, message, meta, timestamp, user_id, username)
             VALUES (?, ?, ?, ?, NOW(), NULL, 'System')`,
            [
              crypto.randomBytes(8).toString('hex'),
              branchId,
              'All project business records were cleared.',
              'Factory reset completed'
            ]
          );
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }

    const fileResult = await deleteFiles();
    const filesCleared = sumCounts(fileResult.cleared || []);
    const audit = buildAuditPayload({
      actor,
      storageDriver: storageDriver(),
      recordsCleared,
      filesCleared,
      warnings: fileResult.warnings,
      resetAt
    });
    await writeStore(RESET_AUDIT_STORE_KEY, audit);
    return { recordsCleared, filesCleared, warnings: fileResult.warnings || [], resetAt, audit: audit.lastReset };
  };

  const reset = async (actor) => (await relationalReady() ? resetRelational(actor) : resetJson(actor));

  return Object.freeze({ preview, reset, listAdminAccounts });
}

const factoryResetService = createFactoryResetService();
let resetInProgress = false;

const requireAdmin = (req, res, next) => {
  if (!req.user || !accountHasRole(req.user, 'Admin')) {
    return res.status(403).json({ ok: false, error: 'Admin access required.' });
  }
  return next();
};

router.use(requireAdmin);

router.get('/preview', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(await factoryResetService.preview());
  } catch (error) {
    console.error('Failed to preview factory reset:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Unable to inspect project records.' });
  }
});

router.post('/', async (req, res) => {
  if (resetInProgress) {
    return res.status(409).json({ ok: false, error: 'A factory reset is already running.' });
  }

  const password = String(req.body?.password || '');
  const confirmation = String(req.body?.confirmation || '').trim();
  const acknowledged = req.body?.acknowledgeIrreversible === true;
  if (!password || confirmation !== CONFIRMATION_PHRASE || !acknowledged) {
    return res.status(400).json({
      ok: false,
      error: `Enter your current Admin password, type ${CONFIRMATION_PHRASE}, and accept the irreversible-data warning.`
    });
  }

  try {
    const accounts = await loadAccounts({ includeSystem: true });
    const current = (Array.isArray(accounts) ? accounts : []).find(
      (account) => String(account.id) === String(req.user.id)
    );
    if (!current || current?.isActive === false || !accountHasRole(current, 'Admin')) {
      return res.status(403).json({ ok: false, error: 'The current Admin account cannot authorize this reset.' });
    }
    if (!verifyPassword(password, String(current.password || ''))) {
      return res.status(403).json({ ok: false, error: 'The Admin password is incorrect.' });
    }

    resetInProgress = true;
    const result = await factoryResetService.reset(req.user);
    return res.json({
      ok: true,
      message: 'All project business records were cleared. Admin access and configuration were preserved.',
      ...result
    });
  } catch (error) {
    console.error('Factory reset failed:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Factory reset failed.' });
  } finally {
    resetInProgress = false;
  }
});

module.exports = router;
module.exports.CONFIRMATION_PHRASE = CONFIRMATION_PHRASE;
module.exports.RESET_AUDIT_STORE_KEY = RESET_AUDIT_STORE_KEY;
module.exports.STORE_RESETTERS = STORE_RESETTERS;
module.exports.shouldResetStoreKey = shouldResetStoreKey;
module.exports.countStoreRecords = countStoreRecords;
module.exports.createFactoryResetService = createFactoryResetService;
