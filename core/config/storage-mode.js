const normalizeStorageDriver = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || ['json', 'file', 'files', 'local', 'local-json'].includes(normalized)) {
    return 'json';
  }
  if (normalized === 'mysql') return 'mysql';
  throw new Error(`Unsupported storage driver: ${normalized}`);
};

const getStorageDriver = () => normalizeStorageDriver(process.env.STORAGE_DRIVER || process.env.DATA_STORE_DRIVER);
const isJsonStorageMode = () => getStorageDriver() === 'json';
const isMysqlStorageMode = () => getStorageDriver() === 'mysql';

module.exports = {
  getStorageDriver,
  isJsonStorageMode,
  isMysqlStorageMode,
  normalizeStorageDriver
};
