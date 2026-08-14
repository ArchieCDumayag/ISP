const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parse5 = require('parse5');

const webRoot = path.join(__dirname, '..', 'web');
const pageSource = fs.readFileSync(path.join(webRoot, 'messenger-reminders.html'), 'utf8');
const scriptSource = fs.readFileSync(path.join(webRoot, 'js', 'messenger-reminders.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(webRoot, 'css', 'messenger-reminders.css'), 'utf8');

assert.equal(pageSource.includes('css/messenger-reminders.css?v=2.0'), true);
assert.equal(pageSource.includes('class="page-header d-print-none mb-3 messenger-page-header"'), true);
assert.equal(pageSource.includes('class="card card-sm messenger-metrics mb-3"'), true);
assert.equal(pageSource.includes('class="card messenger-queue-shell"'), true);
assert.equal(pageSource.includes('class="table table-vcenter table-hover card-table messenger-table mb-0"'), true);
assert.equal(pageSource.includes('class="form-control form-control-sm" type="search" id="queueSearch"'), true);
assert.equal(pageSource.includes('class="modal-dialog modal-dialog-centered modal-dialog-scrollable messenger-modal-dialog"'), true);
assert.equal(pageSource.includes('class="form-check-input" type="checkbox" id="consentAllowedInput"'), true);

for (const match of pageSource.matchAll(/<button\b[\s\S]*?>/g)) {
  assert.match(match[0], /class="[^"]*\bbtn\b[^"]*"/);
  assert.match(match[0], /class="[^"]*\bbtn-sm\b[^"]*"/);
}

for (const match of scriptSource.matchAll(/<button\b[\s\S]*?>/g)) {
  assert.match(match[0], /class="[^"]*\bbtn\b[^"]*"/);
  assert.match(match[0], /class="[^"]*\bbtn-sm\b[^"]*"/);
}

assert.equal(scriptSource.includes("const API_BASE = '/api/messenger-reminders';"), true);
assert.equal(scriptSource.includes('data-reminder-id='), true);
assert.equal(scriptSource.includes('data-action="setup"'), true);
assert.equal(scriptSource.includes('graph.facebook.com'), false);

assert.equal(cssSource.includes('page-scoped layout additions for native Tabler components'), true);
assert.equal(cssSource.includes('.messenger-metrics {'), true);
assert.equal(cssSource.includes('.messenger-toolbar {'), true);
assert.equal(cssSource.includes('.messenger-table tbody tr[data-reminder-id] {'), true);
assert.equal(cssSource.includes('.messenger-modal-dialog {'), true);
assert.equal(cssSource.includes('.primary-btn'), false);
assert.equal(cssSource.includes('.ghost-btn'), false);
assert.equal(cssSource.includes('.ghost-icon'), false);
assert.equal(cssSource.includes('.messenger-modal-card'), false);

new vm.Script(scriptSource, { filename: 'messenger-reminders.js' });
parse5.parse(pageSource);

const ids = [...pageSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length);
assert.equal((cssSource.match(/\{/g) || []).length, (cssSource.match(/\}/g) || []).length);

console.log('Messenger Reminders Tabler UI tests passed.');
