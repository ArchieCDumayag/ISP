#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
require(path.join(projectRoot, 'core/config/env-loader'));

const { loadModuleBackend, getModuleWebRoot } = require(path.join(
  projectRoot,
  'core/runtime/module-loader'
));

const backendPairs = [
  ['job-numbering.js', 'job-numbering'],
  ['jobs.js', 'jobs'],
  ['technician-assignments.js', 'technician-assignments'],
  ['technician-installations.js', 'technician-installations'],
  ['tickets.js', 'tickets']
];

const backend = loadModuleBackend('technician', { required: true, fresh: true });
assert.strictEqual(backend.id, 'technician');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(projectRoot, 'Features/modules/technician/backend', canonicalName);
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Technician backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Technician root entry ${legacyFile}`);
});

const webRoot = getModuleWebRoot('technician', { required: true });
const webFiles = [
  'job-history.html',
  'technician-customer-drafts.html',
  'technicians.html',
  'tickets.html',
  'css/technician-customer-drafts.css',
  'css/technicians.css',
  'css/tickets.css',
  'js/job-history.js',
  'js/technician-customer-drafts.js',
  'js/technicians.js',
  'js/tickets.js'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Technician web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Technician web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Technician web root (${webFiles.length} files)`);

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('technician')"));
assert(serverSource.includes("technicianBackend.load('jobs')"));
assert(serverSource.includes("technicianBackend.load('technicianAssignments')"));
assert(serverSource.includes("technicianBackend.load('technicianInstallations')"));
assert(serverSource.includes("technicianBackend.load('tickets')"));
assert(serverSource.includes('TECHNICIAN_WEB_ROOT'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'tickets.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'technician-customer-drafts.html')"));
console.log('PASS Technician server loader and web routing');

const sourceChecks = [
  ['Features/modules/technician/backend/job-numbering.js', '../../../../core/data/db'],
  ['Features/modules/technician/backend/jobs.js', '../../../../core/data/data-store'],
  ['Features/modules/technician/backend/tickets.js', '../../customer-management/backend/customers'],
  [
    'Features/modules/technician/backend/technician-assignments.js',
    '../../customer-management/backend/customer-draft-submissions'
  ],
  ['Features/modules/technician/backend/technician-installations.js', '../../../../core/data/db-relational'],
  ['Features/modules/technician/backend/technician-installations.js', '../../network/backend/mikrotik-client'],
  ['Features/modules/technician/backend/technician-installations.js', '../../network/backend/pon-management-api'],
  ['Features/modules/technician/backend/technician-installations.js', '../../network/backend/pppoe-account-utils'],
  ['Features/modules/technician/backend/technician-installations.js', '../../network/backend/mikrotik'],
  [
    'Features/modules/technician/backend/technician-installations.js',
    '../../customer-management/backend/customer-draft-submissions-store'
  ],
  ['Features/modules/technician/backend/technician-installations.js', '../../admin/backend/integration-settings'],
  ['Features/modules/technician/backend/technician-installations.js', '../../billing/backend/plan-profile-utils']
];
sourceChecks.forEach(([relativePath, expectedPath]) => {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  assert(source.includes(expectedPath), `${relativePath} must use canonical dependency ${expectedPath}`);
});
console.log('PASS canonical Core, Customer Management, Network, Admin, and Billing dependencies');

const jobNumbering = backend.load('jobNumbering');
assert.strictEqual(jobNumbering.formatJobNumber(42), 'JOB-00000042');
assert.strictEqual(jobNumbering.formatJobNumber('JOB-00000007'), 'JOB-00000007');
assert.strictEqual(jobNumbering.isTicketOriginJob({ ticketId: 1 }), true);
assert.strictEqual(jobNumbering.toJobNumberLabel({ id: 12, origin: 'job' }), 'JOB-00000012');
assert.strictEqual(jobNumbering.toJobNumberLabel({ id: 12, origin: 'ticket' }), '');

const jobs = backend.load('jobs');
assert.strictEqual(typeof jobs, 'function');
[
  'addHistoryJobFromTicket',
  'addJobEntry',
  'removeHistoryJobForTicket',
  'readJobsForTechnician',
  'isOpenJobStatus',
  'deriveJobStatus',
  'markJobDoneForTechnician'
].forEach((contractName) => assert.strictEqual(typeof jobs[contractName], 'function'));

const tickets = backend.load('tickets');
assert.strictEqual(typeof tickets.router, 'function');
assert.strictEqual(typeof tickets.publicRouter, 'function');
assert.strictEqual(typeof tickets.readTicketsForTechnician, 'function');
assert.strictEqual(typeof tickets.isOpenTicketStatus, 'function');
assert.strictEqual(typeof tickets.normalizeTicketStatus, 'function');
assert.strictEqual(typeof tickets.updateTicketStatusForTechnician, 'function');
assert.strictEqual(typeof backend.load('technicianAssignments'), 'function');
assert.strictEqual(typeof backend.load('technicianInstallations'), 'function');
console.log('PASS job-numbering, jobs, tickets, assignments, and installations contracts');
console.log('TECHNICIAN COMPATIBILITY PASSED');
