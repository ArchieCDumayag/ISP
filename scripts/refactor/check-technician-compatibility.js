#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  ['technician-inventory.js', 'technician-inventory'],
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

const dispatchWorkflow = require(path.join(
  projectRoot,
  'Features/modules/technician/backend/dispatch-workflow'
));
assert.strictEqual(dispatchWorkflow.normalizeDispatchStatus('in-progress', { technician: 'tech.one' }), 'accepted');
assert.strictEqual(dispatchWorkflow.normalizeDispatchStatus('done'), 'completed');
assert.strictEqual(dispatchWorkflow.normalizeDispatchStatus('scheduled', { technician: '' }), 'unassigned');
assert.strictEqual(dispatchWorkflow.normalizeDispatchStatus('scheduled', { technician: 'tech.one' }), 'assigned');
assert.strictEqual(dispatchWorkflow.canTechnicianTransition('assigned', 'accepted'), true);
assert.strictEqual(dispatchWorkflow.canTechnicianTransition('assigned', 'completed'), true);
assert.strictEqual(dispatchWorkflow.canTechnicianTransition('accepted', 'completed'), true);
assert.strictEqual(dispatchWorkflow.canTechnicianTransition('traveling', 'completed'), true);
assert.strictEqual(dispatchWorkflow.toLegacyJobStatus('on_site'), 'in-progress');
assert.strictEqual(dispatchWorkflow.toLegacyJobStatus('completed'), 'done');

const normalizedDispatch = dispatchWorkflow.normalizeDispatchFields({
  customerAccountNumber: '100000001',
  customerName: 'Dispatch Test',
  customerPhone: '09170000000',
  serviceAddress: 'Test Street',
  mapPin: '14.5995, 120.9842',
  planName: 'Fiber 100',
  technician: 'tech.one',
  priority: 'urgent',
  appointmentStart: '2026-08-08T01:00:00.000Z',
  appointmentEnd: '2026-08-08T03:00:00.000Z',
  slaDueAt: '2026-08-08T05:00:00.000Z',
  dispatchPayload: {
    instructions: 'Restore service',
    equipment: [{ name: 'ONU', quantity: 1, serialNumber: 'ONU-001' }],
    materials: [{ name: 'Fiber cable', quantity: 25, unit: 'meter' }]
  }
});
assert.strictEqual(normalizedDispatch.schemaVersion, 1);
assert.strictEqual(normalizedDispatch.workflowStatus, 'assigned');
assert.strictEqual(normalizedDispatch.latitude, 14.5995);
assert.strictEqual(normalizedDispatch.longitude, 120.9842);
assert.strictEqual(normalizedDispatch.dispatchPayload.equipment[0].serialNumber, 'ONU-001');
const clearedDispatchCoordinates = dispatchWorkflow.normalizeDispatchFields(
  { mapPin: '' },
  { latitude: 14.5995, longitude: 120.9842 }
);
assert.strictEqual(clearedDispatchCoordinates.latitude, null);
assert.strictEqual(clearedDispatchCoordinates.longitude, null);
assert.strictEqual(dispatchWorkflow.validateCoordinateInput({ mapPin: '' }), '');
assert.strictEqual(dispatchWorkflow.validateCoordinateInput({ mapPin: '14.5995, 120.9842' }), '');
const dmsCoordinates = dispatchWorkflow.parseCoordinatePair(`17°58'6.21"N121°45'30.43"E`);
assert.strictEqual(Number(dmsCoordinates.latitude.toFixed(6)), 17.968392);
assert.strictEqual(Number(dmsCoordinates.longitude.toFixed(6)), 121.758453);
assert.strictEqual(dispatchWorkflow.validateCoordinateInput({ mapPin: `17°58'6.21"N121°45'30.43"E` }), '');
assert.match(
  dispatchWorkflow.validateCoordinateInput({ mapPin: 'invalid location' }),
  /valid latitude and longitude/
);
assert.strictEqual(dispatchWorkflow.validateAppointmentWindow(normalizedDispatch), '');
assert.strictEqual(dispatchWorkflow.validateAppointmentWindow({
  appointmentStart: '2026-08-08T03:00:00.000Z',
  appointmentEnd: '2026-08-08T02:00:00.000Z'
}), 'Appointment end must be later than the start.');

const event = dispatchWorkflow.buildJobEvent({
  branchId: 1,
  jobId: 25,
  jobNumber: 'JOB-00000025',
  eventType: 'status_changed',
  fromStatus: 'assigned',
  toStatus: 'accepted',
  actorType: 'technician',
  actor: { id: 'tech-1', username: 'tech.one' },
  clientEventId: 'offline-event-1',
  eventAt: '2026-08-08T01:30:00.000Z'
});
assert.strictEqual(event.clientEventId, 'offline-event-1');
assert.strictEqual(event.toStatus, 'accepted');
assert.strictEqual(event.actorName, 'tech.one');
console.log('PASS dispatch status, appointment, field payload, transition, and event contracts');

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
  ['Features/modules/technician/backend/jobs.js', '../../../../core/security/role-utils'],
  ['Features/modules/technician/backend/jobs.js', '../../customer-management/backend/customers'],
  ['Features/modules/technician/backend/tickets.js', '../../customer-management/backend/customers'],
  [
    'Features/modules/technician/backend/technician-assignments.js',
    '../../customer-management/backend/customer-draft-submissions'
  ],
  ['Features/modules/technician/backend/technician-inventory.js', '../../../../core/data/data-store'],
  ['Features/modules/technician/backend/technician-inventory.js', './jobs'],
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

const schemaSource = fs.readFileSync(path.join(projectRoot, 'scripts/schema.sql'), 'utf8');
[
  'workflow_status VARCHAR(30)',
  'appointment_end DATETIME',
  'sla_due_at DATETIME',
  'customer_account_number VARCHAR(20)',
  'dispatch_payload_json LONGTEXT',
  'record_version INT',
  'CREATE TABLE IF NOT EXISTS technician_job_events',
  'uq_job_events_branch_client',
  'archived_at DATETIME',
  'archived_by VARCHAR(120)'
].forEach((contract) => {
  assert(schemaSource.includes(contract), `Technician dispatch schema must include ${contract}`);
});
const migrationSource = fs.readFileSync(path.join(projectRoot, 'scripts/migrate-json-to-schema.js'), 'utf8');
assert(migrationSource.includes('async function ensureTechnicianDispatchSchema()'));
assert(migrationSource.includes('await ensureTechnicianDispatchSchema();'));
assert(migrationSource.includes('async function ensureTicketArchiveColumns()'));
assert(migrationSource.includes('await ensureTicketArchiveColumns();'));

const techniciansHtml = fs.readFileSync(path.join(webRoot, 'technicians.html'), 'utf8');
[
  'id="metricActive"',
  'id="technicianWorkloadList"',
  'id="dispatchMap"',
  'id="dispatchMapEmptyAction"',
  'id="jobMapReviewMissing"',
  'id="jobMapShowJobs"',
  'id="jobMapShowNaps"',
  'id="jobMapShowLinks"',
  'id="jobMapFitLayers"',
  'id="jobMapNetworkSummary"',
  'id="jobCustomer"',
  'id="jobMapPin"',
  'id="jobAppointmentStart"',
  'id="jobSlaDue"',
  'id="jobDetailsStatus"',
  'id="jobEventTimeline"'
].forEach((contract) => {
  assert(techniciansHtml.includes(contract), `Technician dispatch dashboard must include ${contract}`);
});
[
  'body class="layout-fluid layout-fluid-vertical"',
  'class="app-main page-wrapper"',
  'class="row row-deck row-cards mt-0 mb-3"',
  'table table-vcenter table-hover card-table',
  'class="form-select"',
  'class="btn btn-primary"',
  'class="modal modal-blur fade technician-modal"'
].forEach((contract) => {
  assert(techniciansHtml.includes(contract), `Technician dashboard must use Tabler contract ${contract}`);
});
[
  'modal-overlay',
  'modal-container',
  'primary-btn',
  'ghost-btn',
  'ghost-icon',
  'dispatch-metric-card',
  'dispatch-workspace',
  'section-frame'
].forEach((legacyClass) => {
  assert(!techniciansHtml.includes(legacyClass), `Technician dashboard must not retain legacy UI class ${legacyClass}`);
});
const techniciansClientSource = fs.readFileSync(path.join(webRoot, 'js/technicians.js'), 'utf8');
assert(techniciansClientSource.includes("requestJson('/api/jobs/dispatch-summary')"));
assert(techniciansClientSource.includes("requestJson('/api/customers')"));
assert(techniciansClientSource.includes("requestJson('/api/pon/state')"));
assert(techniciansClientSource.includes('/status`'));
assert(techniciansClientSource.includes('clientEventId: createClientEventId()'));
assert(techniciansClientSource.includes('window.openDispatchJobDetails'));
assert(techniciansClientSource.includes("title: 'No open jobs have GPS coordinates'"));
assert(techniciansClientSource.includes('openLocationEditor'));
assert(techniciansClientSource.includes('Map tiles unavailable. Check the internet connection.'));
assert(techniciansClientSource.includes("job.latitude == null || job.latitude === ''"));
assert(techniciansClientSource.includes('Decimal and DMS coordinates are accepted.'));
assert(techniciansClientSource.includes('parsedMapPin.latitude.toFixed(6)'));
assert(techniciansClientSource.includes('return `<span class="badge bg-${color}-lt text-${color}">'));
assert(techniciansClientSource.includes("window.L.divIcon({"));
assert(techniciansClientSource.includes("className: 'technician-map-marker'"));
assert(techniciansClientSource.includes("html: '<i class=\"ti ti-map-pin\" aria-hidden=\"true\"></i>'"));
assert.match(
  techniciansClientSource,
  /className: 'technician-map-marker'[\s\S]{0,200}iconAnchor: \[16, 16\]/,
  'Job Map work-order marker must stay center-anchored to its route endpoint'
);
assert(techniciansClientSource.includes('const NETWORK_LINKS_MIN_ZOOM = 14;'));
assert(techniciansClientSource.includes("className: `technician-nap-marker${isFallback ? ' is-fallback' : ''}`"));
assert(techniciansClientSource.includes("className: `technician-work-order-link ${route.assigned ? 'is-assigned' : 'is-fallback'}`"));
assert(techniciansClientSource.includes('window.L.polyline(linePoints'));
assert(techniciansClientSource.includes('highlightJobNetworkPath(job)'));
assert(techniciansClientSource.includes('initializeMapLayerPreferences();'));
assert(techniciansClientSource.includes('const groupedJobs = new Map();'));
assert(techniciansClientSource.includes('const usedPortKeys = new Set(routes'));
assert(techniciansClientSource.includes('<div class="subheader">Used NAP Ports</div>'));
assert(techniciansClientSource.includes('<div class="subheader">Work Order Link</div>'));
assert(!techniciansClientSource.includes('findCustomerPointForConnection'));
assert(!techniciansClientSource.includes('dispatch-status-badge'));
assert(!techniciansClientSource.includes('dispatch-priority'));
const techniciansCssSource = fs.readFileSync(path.join(webRoot, 'css/technicians.css'), 'utf8');
assert(techniciansCssSource.includes('.leaflet-marker-icon.technician-nap-marker'));
assert(techniciansCssSource.includes('.technician-work-order-link'));
assert(techniciansCssSource.includes('.technician-network-link--focus'));
console.log('PASS dispatch dashboard, workload, map, customer snapshot, SLA, and audit UI contracts');

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
  'markJobDoneForTechnician',
  'readJobById',
  'changeJobWorkflowStatus',
  'readJobEvents',
  'normalizeDispatchStatus'
].forEach((contractName) => assert.strictEqual(typeof jobs[contractName], 'function'));

const routeContracts = (router) => router.stack
  .filter((layer) => layer.route)
  .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
assert.deepStrictEqual(routeContracts(jobs), [
  'GET /',
  'GET /dispatch-summary',
  'GET /export.csv',
  'GET /:id/events',
  'PATCH /:id/status',
  'POST /',
  'PATCH /:id',
  'PATCH /:id/done',
  'PATCH /:id/assign',
  'PATCH /:id/undo',
  'DELETE /:id'
]);

const tickets = backend.load('tickets');
assert.strictEqual(typeof tickets.router, 'function');
assert.strictEqual(typeof tickets.publicRouter, 'function');
assert.strictEqual(typeof tickets.readTicketsForTechnician, 'function');
assert.strictEqual(typeof tickets.isOpenTicketStatus, 'function');
assert.strictEqual(typeof tickets.normalizeTicketStatus, 'function');
assert.strictEqual(typeof tickets.updateTicketStatusForTechnician, 'function');
assert.strictEqual(typeof backend.load('technicianAssignments'), 'function');
const technicianInventory = backend.load('technicianInventory');
assert.strictEqual(typeof technicianInventory, 'function');
assert.strictEqual(typeof technicianInventory.createInventoryService, 'function');
assert.deepStrictEqual(routeContracts(technicianInventory), [
  'GET /',
  'GET /stock',
  'GET /transactions',
  'POST /transactions',
  'POST /use',
  'POST /return'
]);
const technicianInstallations = backend.load('technicianInstallations');
assert.strictEqual(typeof technicianInstallations, 'function');
assert.strictEqual(typeof technicianInstallations.normalizeInstallationCompletion, 'function');
assert.strictEqual(typeof technicianInstallations.installationCompletionFingerprint, 'function');
assert.strictEqual(typeof technicianInstallations.assertInstallationCompletionReplay, 'function');
assert.deepStrictEqual(routeContracts(backend.load('technicianAssignments')), [
  'GET /jobs',
  'GET /tickets',
  'POST /jobs/sync',
  'PATCH /jobs/:id/status',
  'PATCH /jobs/:id/done',
  'PATCH /tickets/:id/status'
]);
const installationRoutes = routeContracts(technicianInstallations);
[
  'GET /pon/nearby',
  'POST /pon/reservations',
  'DELETE /pon/reservations/:reservationId',
  'POST /pon/reservations/:reservationId/finalize',
  'POST /pon/assignments'
].forEach((contract) => {
  assert(installationRoutes.includes(contract), `Technician installation API must include ${contract}`);
});
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/technician/tests/technician-pon-access.test.js')
], { stdio: 'inherit' });
execFileSync(process.execPath, [
  path.join(projectRoot, 'Features/modules/technician/tests/technician-inventory.test.js')
], { stdio: 'inherit' });
console.log('PASS job-numbering, jobs, tickets, assignments, and installations contracts');
console.log('TECHNICIAN COMPATIBILITY PASSED');
