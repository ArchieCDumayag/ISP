let activeMaintenance = null;

const beginMaintenance = (kind, details = {}) => {
  if (activeMaintenance) {
    const error = new Error(`System maintenance is already active: ${activeMaintenance.kind}.`);
    error.code = 'SYSTEM_MAINTENANCE_ACTIVE';
    error.statusCode = 503;
    throw error;
  }
  const token = Symbol(String(kind || 'maintenance'));
  activeMaintenance = {
    token,
    kind: String(kind || 'maintenance'),
    startedAt: new Date().toISOString(),
    details: { ...details }
  };
  return token;
};

const endMaintenance = (token) => {
  if (!activeMaintenance || activeMaintenance.token !== token) return false;
  activeMaintenance = null;
  return true;
};

const getMaintenance = () => {
  if (!activeMaintenance) return null;
  return {
    kind: activeMaintenance.kind,
    startedAt: activeMaintenance.startedAt,
    details: { ...activeMaintenance.details }
  };
};

const assertDataWritesAllowed = () => {
  if (!activeMaintenance) return;
  const error = new Error(`Data changes are temporarily paused during ${activeMaintenance.kind}.`);
  error.code = 'SYSTEM_MAINTENANCE_ACTIVE';
  error.statusCode = 503;
  throw error;
};

module.exports = {
  beginMaintenance,
  endMaintenance,
  getMaintenance,
  assertDataWritesAllowed
};
