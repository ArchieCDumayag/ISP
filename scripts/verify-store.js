const { readJson, readJsonFile } = require('../core/data/data-store');
const { resetPool } = require('../core/data/db');

const KEYS = [
  'accounts',
  'activity-log',
  'business-profile',
  'collectors',
  'coverage',
  'customers',
  'integrations',
  'jobs',
  'payments',
  'plans',
  'sessions',
  'tickets'
];

const countEntries = (value) => {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.logs)) return value.logs.length;
    if (value.sessions && typeof value.sessions === 'object') {
      return Object.keys(value.sessions).length;
    }
    return Object.keys(value).length;
  }
  return 0;
};

async function run() {
  console.log('Store verification (db vs file):');
  for (const key of KEYS) {
    const dbValue = await readJson(key, null);
    const fileValue = await readJsonFile(key, null);
    const dbCount = dbValue == null ? 'n/a' : String(countEntries(dbValue));
    const fileCount = fileValue == null ? 'n/a' : String(countEntries(fileValue));
    const status = dbCount === fileCount ? 'ok' : 'diff';
    console.log(`[${key}] db=${dbCount} file=${fileCount} ${status}`);
  }
}

async function main() {
  try {
    await run();
  } catch (err) {
    console.error('Verification failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    try {
      await resetPool();
    } catch (error) {
      console.warn('verify-store-cleanup-failed:', error?.message || error);
    }
  }
}

main().catch((err) => {
  console.error('Verification failed:', err.message || err);
  process.exitCode = 1;
});
