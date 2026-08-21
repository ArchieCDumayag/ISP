const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webRoot, 'tickets.html'), 'utf8');
const client = fs.readFileSync(path.join(webRoot, 'js', 'tickets.js'), 'utf8');
const css = fs.readFileSync(path.join(webRoot, 'css', 'tickets.css'), 'utf8');

[
  'vendor/tabler/css/tabler.min.css',
  'vendor/tabler/js/tabler.min.js',
  'class="card ticket-queue-card"',
  'class="nav nav-tabs card-header-tabs',
  'class="table table-vcenter table-hover card-table',
  'class="modal modal-blur fade ticket-modal"',
  'data-ticket-filter="waiting-customer"',
  'data-ticket-filter="escalated"',
  'data-ticket-filter="archived"',
  'id="workOrderModal"',
  'id="workOrderForm"'
].forEach((contract) => assert.ok(html.includes(contract), `Missing Tickets Tabler contract: ${contract}`));

[
  'section-frame',
  'settings-table',
  'modal-overlay',
  'modal-container',
  'primary-btn',
  'ghost-btn',
  'icon-btn'
].forEach((legacyClass) => assert.ok(!html.includes(legacyClass), `Retired Tickets class remains: ${legacyClass}`));

assert.ok(client.includes("'/api/tickets?includeArchived=1'"));
assert.ok(client.includes("/work-order`"));
assert.ok(client.includes("/${verb}`"));
assert.ok(client.includes("data-action=\"archive\""));
assert.ok(client.includes("data-action=\"restore\""));
assert.ok(!client.includes("method: 'DELETE'"));
assert.ok(!client.includes('data-action="delete"'));
assert.ok(css.includes('.ticket-modal.active'));
assert.ok(css.includes('@media (max-width: 767.98px)'));

console.log('PASS native Tabler Tickets tabs, dialogs, actions, archive UI, and responsive contracts');
