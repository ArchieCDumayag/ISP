const ROLE_ORDER = ['Admin', 'Collector', 'Technician', 'User'];
const ROLE_ALIASES = {
  admin: 'Admin',
  administrator: 'Admin',
  collector: 'Collector',
  collections: 'Collector',
  collection: 'Collector',
  technician: 'Technician',
  tech: 'Technician',
  user: 'User'
};

const normalizeRoleName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return ROLE_ALIASES[key] || '';
};

const parseRoleTokens = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseRoleTokens(item));
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value.roles)) return parseRoleTokens(value.roles);
    if (Object.prototype.hasOwnProperty.call(value, 'role')) return parseRoleTokens(value.role);
  }
  return String(value || '')
    .split(/[,/|;]+|\s+\+\s+|\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
};

const collectRoles = (value) => {
  const found = new Set();
  parseRoleTokens(value).forEach((token) => {
    const role = normalizeRoleName(token);
    if (role) found.add(role);
  });
  return ROLE_ORDER.filter((role) => found.has(role));
};

const normalizeRoles = (value, fallback = []) => {
  const roles = collectRoles(value);
  return roles.length ? roles : collectRoles(fallback);
};

const rolesToStoredValue = (value, fallback = 'User') => {
  const roles = normalizeRoles(value, fallback ? [fallback] : []);
  return roles.length ? roles.join(', ') : '';
};

const accountHasRole = (accountOrRole, role) => {
  const wanted = normalizeRoleName(role);
  if (!wanted) return false;
  return normalizeRoles(accountOrRole).includes(wanted);
};

const accountHasAnyRole = (accountOrRole, roles = []) => (
  normalizeRoles(roles).some((role) => accountHasRole(accountOrRole, role))
);

const getPrimaryRole = (accountOrRole, fallback = 'User') => (
  normalizeRoles(accountOrRole, fallback ? [fallback] : [])[0] || fallback
);

module.exports = {
  ROLE_ORDER,
  normalizeRoleName,
  normalizeRoles,
  rolesToStoredValue,
  accountHasRole,
  accountHasAnyRole,
  getPrimaryRole
};
