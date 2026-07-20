require('../env-loader');

const { readJsonFile, writeJson } = require('../data-store');

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

async function migrate() {
  for (const key of KEYS) {
    const data = await readJsonFile(key, null);
    if (data === null || typeof data === 'undefined') {
      console.log(`[skip] ${key} (no file data)`);
      continue;
    }
    await writeJson(key, data);
    console.log(`[ok] ${key}`);
  }
}

migrate()
  .then(() => {
    console.log('Migration complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
