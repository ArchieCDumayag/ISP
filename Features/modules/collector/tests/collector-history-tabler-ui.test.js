const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const collectorRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(collectorRoot, 'web', 'collectors-history.html'), 'utf8');
const browserSource = fs.readFileSync(path.join(collectorRoot, 'web', 'js', 'collectors-history.js'), 'utf8');
const stylesheet = fs.readFileSync(path.join(collectorRoot, 'web', 'css', 'collectors-history-tabler.css'), 'utf8');

[
  'data-history-sort="date"',
  'data-history-sort="customerName"',
  'data-history-sort="collectorName"',
  'data-history-sort="area"',
  'data-history-sort="amount"',
  '>Method</th>',
  '>Reference</th>',
  '>Actions</th>',
].forEach((contract) => assert(html.includes(contract), `compact history table must include ${contract}`));

assert.match(html, /One row per approved payment recorded by a collector./);
assert.match(html, /css\/collectors-history-tabler\.css\?v=3\.0/);
assert.match(html, /js\/collectors-history\.js\?v=3\.0/);
assert.doesNotMatch(html, /Service Areas/);
assert.doesNotMatch(html, /data-history-sort="payments"/);

assert.match(browserSource, /function buildCollectorTransactionRows\(records = \[\], accountsMap = \{\}, collectorIds = new Set\(\)\)/);
assert.match(browserSource, /kind === 'payment'/);
assert.match(browserSource, /status === 'approved'/);
assert.match(browserSource, /collectorIds\.size && !collectorIds\.has\(collectorId\)/);
assert.match(browserSource, /data-label="Customer"/);
assert.match(browserSource, /data-label="Reference"/);
assert.match(browserSource, /data-history-view=/);
assert.match(browserSource, /function openPaymentDetails\(row, trigger\)/);
assert.match(browserSource, /\['Date', 'Customer', 'Account Number', 'Collector', 'Area', 'Amount', 'Method', 'Reference'\]/);
assert.doesNotMatch(browserSource, /data-history-month-toggle/);
assert.doesNotMatch(browserSource, /collection-history-month-row/);

assert.match(stylesheet, /\.collection-history-table thead th\s*\{[\s\S]*position: sticky;/);
assert.match(stylesheet, /@media \(max-width: 760px\)[\s\S]*\.collection-history-table tbody tr\s*\{[\s\S]*display: block;/);
assert.match(stylesheet, /content: attr\(data-label\);/);
assert.match(stylesheet, /\.collection-history-detail-grid\s*\{/);

console.log('PASS compact Tabler Collector History payment table, detail modal, filters, export, and mobile cards');
