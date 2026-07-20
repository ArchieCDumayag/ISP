const crypto = require('crypto');
const { readJson, writeJson } = require('./data-store');
const { getPool, query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { hashPassword } = require('./passwords');
const { isHiddenActivityUser } = require('./activity-log-visibility');
const { normalizeRoles, rolesToStoredValue } = require('./role-utils');

const STORE_KEY = 'accounts';
const DEFAULT_ADMIN_USERNAME = String(process.env.INITIAL_ADMIN_USERNAME || 'archiecd').trim() || 'archiecd';
const DEFAULT_ADMIN_PASSWORD = String(process.env.INITIAL_ADMIN_PASSWORD || 'finley123!');
const SYSTEM_ADMIN_ID = 'sys-admin';
const BACKUP_ADMIN_ID = 'backup-admin';
const BACKUP_ADMIN_USERNAME = 'admin';
const BACKUP_ADMIN_PASSWORD = 'admin';
const DEFAULT_BRANCH_NAME = String(process.env.INITIAL_BRANCH_NAME || 'Main').trim() || 'Main';

const isTruthyEnv = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y' || normalized === 'on';
};

const buildSystemAdminAccount = () => {
  // Disabled by default. Enable only when explicitly configured.
  if (!isTruthyEnv(process.env.ENABLE_SYSTEM_ADMIN_ACCOUNT)) return null;
  const username = String(process.env.SYSTEM_ADMIN_USERNAME || '').trim();
  const password = String(process.env.SYSTEM_ADMIN_PASSWORD || '');
  if (!username || !password) {
    console.warn('[warn] ENABLE_SYSTEM_ADMIN_ACCOUNT is set but SYSTEM_ADMIN_USERNAME/PASSWORD is missing; skipping system admin.');
    return null;
  }
  return Object.freeze({
    id: SYSTEM_ADMIN_ID,
    username,
    password: hashPassword(password),
    role: 'Admin',
    isActive: true,
    created: 'system',
    hidden: true,
    system: true,
    locked: true
  });
};

const buildSeedAdminAccount = () => {
  const username = DEFAULT_ADMIN_USERNAME;
  const password = DEFAULT_ADMIN_PASSWORD;

  if (!process.env.INITIAL_ADMIN_PASSWORD) {
    console.warn(`[setup] No accounts found. Created initial admin "${username}".`);
    console.warn('[setup] Using default initial admin password from code.');
  }

  return {
    id: '1',
    username,
    password: hashPassword(password),
    role: 'Admin',
    isActive: true,
    created: new Date().toISOString()
  };
};

const buildBackupAdminAccount = () => ({
  id: BACKUP_ADMIN_ID,
  username: BACKUP_ADMIN_USERNAME,
  password: hashPassword(BACKUP_ADMIN_PASSWORD),
  role: 'Admin',
  isActive: true,
  created: new Date().toISOString(),
  locked: true
});

function isSystemAccountId(id) {
  return String(id) === SYSTEM_ADMIN_ID;
}

function isSystemAccount(account) {
  return Boolean(account && isSystemAccountId(account.id));
}

function isBackupAdminId(id) {
  return String(id) === BACKUP_ADMIN_ID;
}

function normalizeIsActive(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (Number.isFinite(num)) return num !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'true' || normalized === 'yes' || normalized === 'enabled' || normalized === 'active') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'disabled' || normalized === 'inactive') return false;
  return fallback;
}

function normalizeAccount(account) {
  const normalized = { ...account, id: String(account.id) };
  normalized.role = rolesToStoredValue(account?.roles || account?.role, account?.role || 'User');
  normalized.roles = normalizeRoles(normalized.role, ['User']);
  normalized.isActive = normalizeIsActive(account?.isActive, true);
  return normalized;
}

function ensureBackupAdminInList(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  const hasBackup = list.some((acc) => String(acc.id) === BACKUP_ADMIN_ID);
  if (hasBackup) return list;
  const usernameTaken = list.some(
    (acc) => String(acc.username || '').trim().toLowerCase() === BACKUP_ADMIN_USERNAME
  );
  if (usernameTaken) {
    console.warn('[warn] Backup admin not created because username "admin" is already taken.');
    return list;
  }
  return [...list, normalizeAccount(buildBackupAdminAccount())];
}

async function ensureSeedBranch() {
  const [rows] = await query('SELECT id FROM branches WHERE name = ? LIMIT 1', [DEFAULT_BRANCH_NAME]);
  if (rows && rows.length) return rows[0].id;
  await query('INSERT INTO branches (name, code) VALUES (?, ?)', [
    DEFAULT_BRANCH_NAME,
    DEFAULT_BRANCH_NAME.toLowerCase().replace(/\s+/g, '-')
  ]);
  const [created] = await query('SELECT id FROM branches WHERE name = ? LIMIT 1', [DEFAULT_BRANCH_NAME]);
  return created[0].id;
}

async function loadAccountsFromDb(includeSystem) {
  let rows = [];
  try {
    const result = await query('SELECT id, username, password_hash, role, name, branch_id, created_at, is_active FROM users');
    rows = result[0] || [];
  } catch (error) {
    if (/unknown column/i.test(String(error?.message || ''))) {
      const fallbackResult = await query('SELECT id, username, password_hash, role, name, branch_id, created_at FROM users');
      rows = fallbackResult[0] || [];
    } else {
      throw error;
    }
  }

  let loginRows = [];
  try {
    const result = await query(
      `SELECT user_id, MAX(timestamp) AS last_login
       FROM activity_logs
       WHERE user_id IS NOT NULL
         AND (LOWER(message) LIKE '%signed in%' OR LOWER(meta) LIKE '%login%')
       GROUP BY user_id`
    );
    loginRows = result[0] || [];
  } catch (error) {
    if (!/doesn't exist|unknown table/i.test(String(error?.message || ''))) {
      console.warn('Unable to load account login history:', error?.message || error);
    }
  }
  const loginByUser = new Map(
    (loginRows || [])
      .map((row) => [String(row.user_id), row.last_login ? new Date(row.last_login).toISOString() : null])
      .filter(([userId]) => !isHiddenActivityUser({ userId }))
      .filter(([userId]) => Boolean(userId))
  );
  let accounts = (rows || []).map((row) => normalizeAccount({
    id: String(row.id),
    username: row.username,
    password: row.password_hash,
    role: row.role,
    name: row.name || null,
    branchId: row.branch_id,
    created: row.created_at ? new Date(row.created_at).toISOString() : null,
    isActive: normalizeIsActive(row.is_active, true),
    lastLogin: loginByUser.get(String(row.id)) || null
  }));
  accounts = accounts.map((account) =>
    isBackupAdminId(account.id) ? { ...account, locked: true } : account
  );

  if (!accounts.length) {
    const branchId = await ensureSeedBranch();
    const seed = buildSeedAdminAccount();
    await query(
      `INSERT INTO users (id, username, password_hash, role, name, branch_id, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seed.id,
        seed.username,
        seed.password,
        seed.role,
        seed.name || seed.username,
        branchId,
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        1
      ]
    );
    accounts = [normalizeAccount({
      id: seed.id,
      username: seed.username,
      password: seed.password,
      role: seed.role,
      name: seed.name || seed.username,
      branchId,
      created: seed.created,
      isActive: true,
      lastLogin: null
    })];
  }

  const hasBackupAdmin = accounts.some((acc) => String(acc.id) === BACKUP_ADMIN_ID);
  const usernameTaken = accounts.some(
    (acc) => String(acc.username || '').trim().toLowerCase() === BACKUP_ADMIN_USERNAME
  );
  if (!hasBackupAdmin && !usernameTaken) {
    const branchId = accounts[0]?.branchId || await ensureSeedBranch();
    const backup = buildBackupAdminAccount();
    await query(
      `INSERT INTO users (id, username, password_hash, role, name, branch_id, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         password_hash = VALUES(password_hash),
         role = VALUES(role),
         name = VALUES(name),
         branch_id = VALUES(branch_id),
         is_active = VALUES(is_active)`,
      [
        backup.id,
        backup.username,
        backup.password,
        backup.role,
        backup.name || backup.username,
        branchId,
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        1
      ]
    );
    accounts.push(normalizeAccount({
      id: backup.id,
      username: backup.username,
      password: backup.password,
      role: backup.role,
      name: backup.name || backup.username,
      branchId,
      created: backup.created,
      isActive: true,
      lastLogin: null,
      locked: true
    }));
  }

  if (includeSystem) {
    const sys = buildSystemAdminAccount();
    return sys ? [...accounts, { ...sys }] : accounts;
  }
  return accounts;
}

function sanitizePersistedAccounts(data) {
  const accounts = Array.isArray(data) ? data : [];
  return accounts.map(normalizeAccount).filter((account) => !isSystemAccount(account));
}

async function loadAccounts(options = {}) {
  const includeSystem = Boolean(options.includeSystem);
  if (await isRelationalReady()) {
    return loadAccountsFromDb(includeSystem);
  }
  const data = await readJson(STORE_KEY, null);
  const accounts = sanitizePersistedAccounts(data).map((account) =>
    isBackupAdminId(account.id) ? { ...account, locked: true } : account
  );
  let persisted = accounts;
  let shouldPersist = !Array.isArray(data);
  if (!accounts.length) {
    persisted = [normalizeAccount(buildSeedAdminAccount())];
    shouldPersist = true;
  }
  const withBackup = ensureBackupAdminInList(persisted);
  if (withBackup.length !== persisted.length) {
    shouldPersist = true;
  }
  persisted = withBackup;
  if (shouldPersist || JSON.stringify(data) !== JSON.stringify(persisted)) {
    await writeJson(STORE_KEY, persisted);
  }
  if (includeSystem) {
    const sys = buildSystemAdminAccount();
    return sys ? [...persisted, { ...sys }] : persisted;
  }
  return persisted;
}

async function saveAccounts(accounts) {
  let normalized = sanitizePersistedAccounts(accounts);
  normalized = ensureBackupAdminInList(normalized);
  if (await isRelationalReady()) {
    for (const account of normalized) {
      const activeFlag = normalizeIsActive(account?.isActive, true) ? 1 : 0;
      const storedRole = rolesToStoredValue(account?.roles || account?.role, account?.role || 'Collector');
      await query(
        `INSERT INTO users (id, username, password_hash, role, name, branch_id, created_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           username = VALUES(username),
           password_hash = VALUES(password_hash),
           role = VALUES(role),
           name = VALUES(name),
           branch_id = VALUES(branch_id),
           is_active = VALUES(is_active)`,
        [
          String(account.id),
          account.username,
          account.password,
          storedRole,
          account.name || account.username || null,
          account.branchId || (await ensureSeedBranch()),
          account.created ? new Date(account.created).toISOString().slice(0, 19).replace('T', ' ') : null,
          activeFlag
        ]
      );
    }
    return normalized;
  }
  await writeJson(STORE_KEY, normalized);
  return normalized;
}

async function deleteAccountById(id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;

  if (await isRelationalReady()) {
    const accounts = await loadAccounts({ includeSystem: false });
    const account = accounts.find((item) => String(item.id) === normalizedId);
    if (!account) return null;

    const pool = await getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM collector_assignments WHERE collector_user_id = ?', [normalizedId]);
      await connection.query('DELETE FROM users WHERE id = ?', [normalizedId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    return account;
  }

  const accounts = await loadAccounts();
  const index = accounts.findIndex((account) => String(account.id) === normalizedId);
  if (index < 0) return null;
  const [removed] = accounts.splice(index, 1);
  await saveAccounts(accounts);
  return removed || null;
}

async function nextId(accounts) {
  if (await isRelationalReady()) {
    const [rows] = await query('SELECT MAX(CAST(id AS UNSIGNED)) AS maxId FROM users');
    const max = rows && rows[0] && rows[0].maxId ? Number(rows[0].maxId) : 0;
    return String(max + 1);
  }
  const ids = (accounts || []).map(a => parseInt(a.id, 10) || 0);
  const max = ids.length ? Math.max(...ids) : 0;
  return String(max + 1);
}

module.exports = {
  loadAccounts,
  saveAccounts,
  deleteAccountById,
  nextId,
  isSystemAccountId,
  isSystemAccount,
  isBackupAdminId,
  DEFAULT_ADMIN_USERNAME,
  BACKUP_ADMIN_ID,
  BACKUP_ADMIN_USERNAME,
  SYSTEM_ADMIN_ID,
};
