const express = require('express');
const {
  loadAccounts,
  saveAccounts,
  deleteAccountById,
  nextId,
  isSystemAccountId,
  isBackupAdminId,
  BACKUP_ADMIN_ID
} = require('./accounts-store');
const { hashPassword } = require('../../../../core/security/passwords');
const { normalizeRoles, rolesToStoredValue } = require('../../../../core/security/role-utils');

const router = express.Router();
const PRIMARY_ADMIN_ID = '1';

function isProtectedAccountId(id) {
  const normalized = String(id);
  return normalized === PRIMARY_ADMIN_ID || isSystemAccountId(normalized) || isBackupAdminId(normalized);
}

function sanitizeAccountForResponse(account) {
  if (!account || typeof account !== 'object') return account;
  const { password, ...rest } = account;
  const roles = normalizeRoles(rest.roles || rest.role, rest.role || 'User');
  return { ...rest, role: rolesToStoredValue(roles, rest.role || 'User'), roles, passwordSet: Boolean(String(password || '').trim()) };
}

// List accounts
router.get('/', async (req, res) => {
  const accounts = await loadAccounts();
  const visible = accounts.filter((account) => String(account.id) !== PRIMARY_ADMIN_ID);
  res.json({ ok: true, accounts: visible.map(sanitizeAccountForResponse) });
});

// Create account
router.post('/', async (req, res) => {
  const { username, password } = req.body || {};
  const roles = normalizeRoles(req.body?.roles || req.body?.role);
  const role = rolesToStoredValue(roles, '');
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  const accounts = await loadAccounts({ includeSystem: true });
  const usernameLower = String(username).trim().toLowerCase();
  if (accounts.some(a => String(a.username).trim().toLowerCase() === usernameLower)) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const id = await nextId(accounts);
  const created = new Date().toISOString();
  const acc = { id, username, password: hashPassword(password), role, roles, branchId: req.user?.branchId || null, isActive: true, created };
  accounts.push(acc);
  await saveAccounts(accounts);
  res.status(201).json({ ok: true, account: sanitizeAccountForResponse(acc) });
});

// Update account
router.put('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (isSystemAccountId(id)) return res.status(403).json({ error: 'System account cannot be modified' });
  const { username, password } = req.body || {};
  const requestedRoles = normalizeRoles(req.body?.roles || req.body?.role);
  const role = rolesToStoredValue(requestedRoles, '');
  const accounts = await loadAccounts({ includeSystem: true });
  const idx = accounts.findIndex(a => String(a.id) === id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });

  const nextUsername = typeof username === 'string' ? username.trim() : '';
  if (nextUsername) {
    const duplicate = accounts.some((a, i) => i !== idx && String(a.username).trim().toLowerCase() === nextUsername.toLowerCase());
    if (duplicate) return res.status(409).json({ error: 'Username already exists' });
  }

  if (id === PRIMARY_ADMIN_ID || id === BACKUP_ADMIN_ID) {
    // protected admin accounts cannot change role; but username/password can change
    const updated = { ...accounts[idx] };
    if (nextUsername) updated.username = nextUsername;
    if (password) updated.password = hashPassword(password);
    updated.role = 'Admin';
    updated.roles = ['Admin'];
    accounts[idx] = updated;
  } else {
    if (nextUsername) accounts[idx].username = nextUsername;
    if (password) accounts[idx].password = hashPassword(password);
    if (role) accounts[idx].role = role;
    if (role) accounts[idx].roles = requestedRoles;
  }
  await saveAccounts(accounts);
  res.json({ ok: true, account: sanitizeAccountForResponse(accounts[idx]) });
});

// Delete account (except id 1)
router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (isProtectedAccountId(id)) {
    const error = isSystemAccountId(id)
      ? 'System account cannot be deleted'
      : 'Admin account cannot be deleted';
    return res.status(400).json({ error });
  }
  const removed = await deleteAccountById(id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, removed });
});

module.exports = router;
