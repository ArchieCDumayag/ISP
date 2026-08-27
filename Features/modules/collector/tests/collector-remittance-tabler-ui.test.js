const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const collectorRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(collectorRoot, 'web', 'collectors.html'), 'utf8');
const browserSource = fs.readFileSync(path.join(collectorRoot, 'web', 'js', 'collectors-page.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(collectorRoot, 'web', 'css', 'collectors-tabler.css'), 'utf8');

const statusTabs = html.match(/data-collector-remittance-filter="(?:pending|remitted|rejected|archived)"/g) || [];
assert.equal(statusTabs.length, 4, 'all four remittance status tabs must remain available');
assert.match(html, /class="nav nav-tabs collector-remittance-tabs"/);
assert.match(html, /class="table table-vcenter table-nowrap card-table mb-0 collector-remittance-table"/);
assert.match(html, /<tbody id="collectorRemittanceList" aria-live="polite"><\/tbody>/);
assert.match(html, /id="collectorRemittanceReviewAudit" hidden/);
assert.doesNotMatch(html, /class="collector-remittance-list"/);

assert.match(browserSource, /document\.createElement\('tr'\)/);
assert.match(browserSource, /data-label="Collector"/);
assert.match(browserSource, /data-label="Status \/ Batch"/);
assert.match(browserSource, /data-collector-remittance-action="view"/);
assert.match(browserSource, /data-collector-remittance-action="delete"/);
assert.match(browserSource, /Delete Archived Remittance/);
assert.match(browserSource, /Deletion reason is required\./);
assert.match(browserSource, /Customer payments were preserved\./);
assert.match(browserSource, /collectorRemittanceReviewSubmit\.hidden = viewing/);
assert.match(browserSource, /\['view', 'confirm', 'reject', 'delete'\]\.includes\(action\)/);
assert.match(html, /js\/collectors-page\.js\?v=3\.21/);
assert.doesNotMatch(browserSource, /collector-remittance-record__/);

assert.match(stylesheet, /\.collector-remittance-table\s*\{/);
assert.match(stylesheet, /\.collector-remittance-tabs \.nav-link\s*\{/);
assert.doesNotMatch(stylesheet, /\.collector-remittance-record/);

console.log('PASS compact Tabler remittance tabs, guarded archived delete action, audit details modal, and preserved action hooks');
