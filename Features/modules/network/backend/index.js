const entries = Object.freeze({
  mikrotikAuditLog: './mikrotik-audit-log',
  mikrotikClient: './mikrotik-client',
  mikrotikEndpoint: './mikrotik-endpoint',
  mikrotik: './mikrotik',
  ponManagement: './pon-management-api',
  ponServiceability: './pon-serviceability',
  pppoeAccountUtils: './pppoe-account-utils'
});

function load(entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Unknown Network backend entry: ${entryName}`);
  return require(entry);
}

module.exports = Object.freeze({
  id: 'network',
  entries,
  load
});
