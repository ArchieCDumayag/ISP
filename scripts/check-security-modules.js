const path = require('path');
require('../core/config/env-loader');
const { resetPool } = require('../core/data/db');
const { PROJECT_ROOT } = require('../core/runtime/paths');
const { loadModuleBackend } = require('../core/runtime/module-loader');

const modules = [
  ['passwords', () => require(path.join(PROJECT_ROOT, 'core/security/passwords'))],
  ['rate-limiter', () => require(path.join(PROJECT_ROOT, 'core/security/rate-limiter'))],
  ['accounts-store', () => loadModuleBackend('admin', { required: true }).load('accountsStore')],
  ['session-cache', () => require(path.join(PROJECT_ROOT, 'core/security/session-cache'))],
  ['info-api', () => loadModuleBackend('admin', { required: true }).load('infoApi')],
  ['customers', () => loadModuleBackend('customer-management', { required: true }).load('customers')],
  ['customer-upstream', () => loadModuleBackend('customer-app', { required: true }).load('customerUpstream')],
  ['payments', () => loadModuleBackend('billing', { required: true }).load('payments')]
];

async function main() {
  try {
    modules.forEach(([name, load], idx) => {
      console.log(`req${idx + 1} ${name}`);
      load();
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
