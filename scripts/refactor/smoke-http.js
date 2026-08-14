#!/usr/bin/env node

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const appPort = Number(process.env.REFACTOR_SMOKE_PORT || 3190);
const upstreamPort = Number(process.env.REFACTOR_SMOKE_UPSTREAM_PORT || 4190);
const baseUrl = `http://127.0.0.1:${appPort}`;

const checks = [
  { path: '/styles.css', status: 200, bodyIncludes: '.app-shell' },
  { path: '/theme-init.js', status: 200, bodyIncludes: 'localStorage' },
  { path: '/layout.js', status: 200, bodyIncludes: 'loadPartial' },
  { path: '/sidebar.html', status: 200, bodyIncludes: 'sidebar' },
  { path: '/vendor/tabler/css/tabler.min.css', status: 200, bodyIncludes: '--tblr-' },
  { path: '/server.js', status: 404 },
  { path: '/login.html', status: 200, bodyIncludes: '<title>Log In' },
  { path: '/css/login.css', status: 200, bodyIncludes: 'body.login-body' },
  { path: '/css/accounts.css', status: 200, bodyIncludes: '.settings-hero' },
  { path: '/css/factory-reset.css', status: 200, bodyIncludes: '.factory-reset-panel' },
  { path: '/accounts.js', status: 200, bodyIncludes: "fetch('/api/accounts'" },
  { path: '/js/factory-reset.js', status: 200, bodyIncludes: "fetchJson('/api/admin-data-reset/preview')" },
  { path: '/temp.css', status: 200, bodyIncludes: '.isolation-notice' },
  { path: '/temp.js', status: 200, bodyIncludes: "const API_ROOT = '/api/temp'" },
  { path: '/install-guide.html', status: 200, bodyIncludes: '<title>Download Apps' },
  { path: '/js/install-guide.js', status: 200, bodyIncludes: '/api/app-downloads' },
  { path: '/apply-now.html', status: 200, bodyIncludes: '<title>Apply Now' },
  { path: '/js/apply-now.js', status: 200, bodyIncludes: '/api/public/applications' },
  { path: '/coverage.css', status: 200, bodyIncludes: '.coverage-page' },
  { path: '/coverage.js', status: 200, bodyIncludes: "const API_URL = 'http://localhost:3000/api/coverage'" },
  { path: '/css/customers.css', status: 200, bodyIncludes: '.customers-page' },
  { path: '/quick-payment.html', status: 200, bodyIncludes: '<title>Quick Payment' },
  { path: '/js/quick-payment.js', status: 200, bodyIncludes: 'quickPayLookupForm' },
  { path: '/payment-receipt', status: 200, bodyIncludes: '<title>Payment Receipt' },
  { path: '/payment/success', status: 200, bodyIncludes: '<title>Payment Receipt' },
  { path: '/css/payment-receipt.css', status: 200, bodyIncludes: '--brand:' },
  { path: '/js/payment-current-bill.js', status: 200, bodyIncludes: 'MAX_SYNTHETIC_ROWS' },
  { path: '/payments.js', status: 200, bodyIncludes: 'openPaymentModalBtn' },
  { path: '/plans.js', status: 200, bodyIncludes: "const API_ENDPOINT = '/api/plans'" },
  { path: '/payment-confirmation-queue.js', status: 200, bodyIncludes: 'queueTableBody' },
  { path: '/js/pppoe.js', status: 200, bodyIncludes: 'pppoe-form' },
  { path: '/css/pon-management.css', status: 200, bodyIncludes: '.pon-page' },
  { path: '/js/pon-management.js', status: 200, bodyIncludes: "const PON_API_BASE = '/api/pon'" },
  { path: '/css/genieacs.css', status: 200, bodyIncludes: '.genieacs-header' },
  { path: '/js/genieacs.js', status: 200, bodyIncludes: 'genieacs-status-dot' },
  { path: '/css/collectors.css', status: 200, bodyIncludes: '--brand-1:' },
  { path: '/css/collectors-tabler.css', status: 200, bodyIncludes: '.collector-assignment-shell' },
  { path: '/js/collectors-page.js', status: 200, bodyIncludes: 'collectorApprovalList' },
  { path: '/js/collectors-history.js', status: 200, bodyIncludes: 'historyTableBody' },
  { path: '/css/technicians.css', status: 200, bodyIncludes: '.technician-page' },
  { path: '/css/tickets.css', status: 200, bodyIncludes: '.ticket-card' },
  { path: '/css/technician-customer-drafts.css', status: 200, bodyIncludes: 'body.tech-drafts-body' },
  { path: '/js/tickets.js', status: 200, bodyIncludes: 'ticketTableBody' },
  { path: '/js/technicians.js', status: 200, bodyIncludes: 'jobTableBody' },
  { path: '/js/job-history.js', status: 200, bodyIncludes: 'historyTableBody' },
  { path: '/js/technician-customer-drafts.js', status: 200, bodyIncludes: 'technicianCustomerDraftToken' },
  { path: '/css/finance.css', status: 200, bodyIncludes: '.finance-page' },
  { path: '/css/monthly-collection-trend.css', status: 200, bodyIncludes: '.chart-container' },
  { path: '/css/reports.css', status: 200, bodyIncludes: '.reports-page' },
  { path: '/js/expenses.js', status: 200, bodyIncludes: 'expensesTableBody' },
  { path: '/js/payroll.js', status: 200, bodyIncludes: 'payrollTableBody' },
  { path: '/js/monthly-collection-trend.js', status: 200, bodyIncludes: 'monthlyTrendChart' },
  { path: '/reports.js', status: 200, bodyIncludes: 'reportsRefreshBtn' },
  { path: '/css/customer-app.css', status: 200, bodyIncludes: '.customer-app-page' },
  { path: '/css/messenger-reminders.css', status: 200, bodyIncludes: '.messenger-reminders-page' },
  { path: '/css/customer-portal.css', status: 200, bodyIncludes: '--portal-bg:' },
  { path: '/css/public-pages.css', status: 200, bodyIncludes: '--public-bg:' },
  { path: '/css/sms.css', status: 200, bodyIncludes: '.sms-container' },
  { path: '/css/sms.js', status: 200 },
  { path: '/sms.js', status: 200, bodyIncludes: 'SMS_ACTIVE_TAB_STORAGE_KEY' },
  { path: '/js/company-info.js', status: 200, bodyIncludes: 'PUBLIC_PLANS_ENDPOINT' },
  { path: '/js/customer-app-popup-reminder.js', status: 200, bodyIncludes: 'openPushModalBtn' },
  { path: '/js/messenger-reminders.js', status: 200, bodyIncludes: "const API_BASE = '/api/messenger-reminders'" },
  { path: '/js/customer-portal-login.js', status: 200, bodyIncludes: 'customerLoginForm' },
  { path: '/js/customer-portal.js', status: 200, bodyIncludes: 'notificationTotalCount' },
  { path: '/setup.html', status: 200 },
  { path: '/accounts.html', status: 302, locationIncludes: '/login.html' },
  { path: '/temp.html', status: 302, locationIncludes: '/login.html' },
  { path: '/update-download.html', status: 404 },
  { path: '/flavors.html', status: 404 },
  { path: '/flavors', status: 404 },
  { path: '/customers.html', status: 302, locationIncludes: '/login.html' },
  { path: '/coverage.html', status: 302, locationIncludes: '/login.html' },
  { path: '/customer-draft-queue.html', status: 302, locationIncludes: '/login.html' },
  { path: '/customer-archive.html', status: 302, locationIncludes: '/login.html' },
  { path: '/referrals.html', status: 302, locationIncludes: '/login.html' },
  { path: '/plans.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payments.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-history.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-breakdown.html', status: 302, locationIncludes: '/login.html' },
  { path: '/gcash-transaction.html', status: 302, locationIncludes: '/login.html' },
  { path: '/gcash-transaction', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-confirmation-queue', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-confirmation-queue.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-confirmation-queue-history.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payment-confirmation-queue-history', status: 302, locationIncludes: '/login.html' },
  { path: '/disconnections.html', status: 302, locationIncludes: '/login.html' },
  { path: '/thermal-print.html', status: 302, locationIncludes: '/login.html' },
  { path: '/billing-statement.html', status: 302, locationIncludes: '/customer-login.html' },
  { path: '/account-statement.html', status: 302, locationIncludes: '/customer-login.html' },
  { path: '/pppoe.html', status: 302, locationIncludes: '/login.html' },
  { path: '/pon-management.html', status: 302, locationIncludes: '/login.html' },
  { path: '/genieacs.html', status: 302, locationIncludes: '/login.html' },
  { path: '/coverage-map.html', status: 302, locationIncludes: '/login.html' },
  { path: '/coverage-map-app.html', status: 200, bodyIncludes: '<title>Coverage Map' },
  { path: '/coverage-map-app', status: 200, bodyIncludes: '<title>Coverage Map' },
  { path: '/collectors.html', status: 302, locationIncludes: '/login.html' },
  { path: '/collectors-history.html', status: 302, locationIncludes: '/login.html' },
  { path: '/collectors', status: 302, locationIncludes: '/login.html' },
  { path: '/collectors-history', status: 302, locationIncludes: '/login.html' },
  { path: '/tickets.html', status: 302, locationIncludes: '/login.html' },
  { path: '/technicians.html', status: 302, locationIncludes: '/login.html' },
  { path: '/job-history.html', status: 302, locationIncludes: '/login.html' },
  {
    path: '/technician-customer-drafts.html',
    status: 200,
    bodyIncludes: '<title>Technician Customer Drafts'
  },
  {
    path: '/technician-customer-drafts',
    status: 200,
    bodyIncludes: '<title>Technician Customer Drafts'
  },
  { path: '/tickets', status: 302, locationIncludes: '/login.html' },
  { path: '/expenses.html', status: 302, locationIncludes: '/login.html' },
  { path: '/payroll.html', status: 302, locationIncludes: '/login.html' },
  { path: '/expenses', status: 302, locationIncludes: '/login.html' },
  { path: '/payroll', status: 302, locationIncludes: '/login.html' },
  { path: '/', status: 200, bodyIncludes: '<title>Company Info' },
  { path: '/company-info.html', status: 200, bodyIncludes: '<title>Company Info' },
  { path: '/company-info', status: 200, bodyIncludes: '<title>Company Info' },
  { path: '/privacy-terms.html', status: 200, bodyIncludes: '<title>Privacy & Terms' },
  { path: '/terms-of-use.html', status: 200, bodyIncludes: '<title>Terms of Use' },
  { path: '/terms-of-use', status: 200, bodyIncludes: '<title>Terms of Use' },
  { path: '/customer-login.html', status: 200, bodyIncludes: '<title>Customer Portal Login' },
  { path: '/customer-portal.html', status: 302, locationIncludes: '/customer-login.html' },
  { path: '/customer-portal', status: 302, locationIncludes: '/customer-login.html' },
  { path: '/customer-app.html', status: 302, locationIncludes: '/login.html' },
  { path: '/customer-app-popup-reminder.html', status: 302, locationIncludes: '/login.html' },
  { path: '/customer-app-popup-reminder', status: 302, locationIncludes: '/login.html' },
  { path: '/messenger-reminders.html', status: 302, locationIncludes: '/login.html' },
  { path: '/messenger-reminders', status: 302, locationIncludes: '/login.html' },
  { path: '/customer-app', status: 302, locationIncludes: '/login.html' },
  { path: '/sms.html', status: 302, locationIncludes: '/login.html' },
  { path: '/sms', status: 302, locationIncludes: '/login.html' },
  { path: '/privacy-terms', status: 200 },
  { path: '/apply-now', status: 200, followRedirects: true },
  { path: '/customer-login', status: 200, followRedirects: true },
  { path: '/api/public/philippines/provinces', status: 200 },
  { path: '/api/public/coverage-areas', status: 200 },
  { path: '/api/public/plans', status: 200 },
  { path: '/api/public/coverage-map/customers', status: 200 },
  { path: '/api/public/coverage-map/pon-state', status: 200 },
  { path: '/api/auth/me', status: 401 },
  { path: '/api/flavor/features', status: 404 },
  { path: '/api/flavors/features', status: 404 },
  { path: '/api/accounts', status: 401 },
  { path: '/api/admin-data-reset/preview', status: 401 },
  { path: '/api/customers', status: 401 },
  { path: '/api/temp/workspace', status: 401 },
  { path: '/api/coverage', status: 401 },
  { path: '/api/referrals', status: 401 },
  { path: '/api/customer-drafts', status: 401 },
  { path: '/api/plans', status: 401 },
  { path: '/api/payments', status: 401 },
  { path: '/api/payment-records', status: 401 },
  { path: '/api/disconnections', status: 401 },
  { path: '/api/payment-confirmations', status: 401 },
  { path: '/api/mikrotik/info', status: 401 },
  { path: '/api/pon/state', status: 401 },
  { path: '/api/genieacs/status', status: 401 },
  { path: '/api/collectors', status: 401 },
  { path: '/api/collector/payments/options', status: 401 },
  { path: '/api/auth/collector-me', status: 401 },
  { path: '/api/auth/collector-transactions', status: 401 },
  { path: '/api/auth/collector-map-data', status: 401 },
  { path: '/api/tickets/categories', status: 200 },
  { path: '/api/tickets', status: 401 },
  { path: '/api/jobs', status: 401 },
  { path: '/api/technician/jobs', status: 401 },
  { path: '/api/technician/installations/pon/overview', status: 401 },
  { path: '/api/technician/customer-drafts/auth/me', status: 401 },
  { path: '/api/technician/customer-drafts', status: 401 },
  { path: '/api/expenses', status: 401 },
  { path: '/api/payroll', status: 401 },
  { path: '/api/customer-app/popup-reminder', status: 401 },
  { path: '/api/customer-app/settings', status: 401 },
  { path: '/api/messenger-reminders', status: 401 },
  { path: '/api/sms/history', status: 401 }
];

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => reject(new Error(`Port ${port} is unavailable: ${error.message}`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer(child, output, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before readiness (code ${child.exitCode}).\n${output.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/login.html`, { redirect: 'manual' });
      if (response.status === 200) return;
    } catch (_error) {
      // The listener is still starting.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output.join('')}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    wait(3000).then(() => false)
  ]);
  if (!exited && child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  await assertPortAvailable(appPort);
  await assertPortAvailable(upstreamPort);

  const output = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      STORAGE_DRIVER: 'json',
      ISOLATED_RUNTIME_CONFIG: '1',
      PORT: String(appPort),
      PUBLIC_BASE_URL: baseUrl,
      CUSTOMER_UPSTREAM_PORT: String(upstreamPort),
      DISABLE_CLOUDFLARED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    await waitForServer(child, output);
    for (const check of checks) {
      const response = await fetch(`${baseUrl}${check.path}`, {
        redirect: check.followRedirects ? 'follow' : 'manual'
      });
      const body = await response.text();
      if (response.status !== check.status) {
        throw new Error(`${check.path}: expected HTTP ${check.status}, received ${response.status}`);
      }
      if (check.bodyIncludes && !body.includes(check.bodyIncludes)) {
        throw new Error(`${check.path}: response did not include ${JSON.stringify(check.bodyIncludes)}`);
      }
      const location = response.headers.get('location') || '';
      if (check.locationIncludes && !location.includes(check.locationIncludes)) {
        throw new Error(`${check.path}: location did not include ${JSON.stringify(check.locationIncludes)}`);
      }
      console.log(`PASS ${response.status} ${check.path}`);
    }
    console.log(`HTTP SMOKE PASSED (${appPort}/${upstreamPort})`);
  } finally {
    await stopChild(child);
  }
}

main().catch((error) => {
  console.error(`HTTP SMOKE FAILED: ${error.message}`);
  process.exitCode = 1;
});
