const path = require('path');
require('../env-loader');
const { resetPool } = require('../db');

const modules = [
  'passwords',
  'rate-limiter',
  'accounts-store',
  'session-cache',
  'info-api',
  'customers',
  'customer-upstream',
  'payments'
];

async function main() {
  try {
    modules.forEach((name, idx) => {
      console.log(`req${idx + 1} ${name}`);
      require(path.join(__dirname, '..', name));
    });
    console.log('security-modules-ok');
  } catch (error) {
    console.error('security-modules-failed:', error?.message || error);
    process.exitCode = 1;
  } finally {
    try {
      await resetPool();
    } catch (error) {
      console.warn('security-modules-cleanup-failed:', error?.message || error);
    }
  }
}

main().catch((error) => {
  console.error('security-modules-failed:', error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  process.exit(process.exitCode || 0);
});
