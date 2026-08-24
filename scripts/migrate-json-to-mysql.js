require('../core/config/env-loader');

const fs = require('fs').promises;
const path = require('path');
const { writeJson } = require('../core/data/data-store');
const { DATA_DIR } = require('../core/runtime/paths');

const EXCLUDED_JSON_FILES = new Set([
  'customer_sessions.json',
  'master-key.backup.json',
  'master-key.json',
  'mysql-config.backup.json',
  'mysql-config.json',
  'sessions.json'
]);

const isSensitiveJsonFile = (fileName) => {
  const normalized = String(fileName || '').trim().toLowerCase();
  if (!normalized || EXCLUDED_JSON_FILES.has(normalized)) return true;
  return normalized.includes('firebase-service-account')
    || normalized.startsWith('service-account')
    || normalized.includes('-service-account');
};

async function listJsonStores() {
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json') && !isSensitiveJsonFile(fileName))
    .sort((left, right) => left.localeCompare(right));
}

async function migrate() {
  const storeFiles = await listJsonStores();
  for (const fileName of storeFiles) {
    const key = path.basename(fileName, path.extname(fileName));
    const raw = await fs.readFile(path.join(DATA_DIR, fileName), 'utf8');
    const data = JSON.parse(raw);
    await writeJson(key, data);
    console.log(`[ok] ${key}`);
  }
  return storeFiles.length;
}

migrate()
  .then((storeCount) => {
    console.log(`Migration complete (${storeCount} JSON stores).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
