const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const customersPage = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'customers.html'),
  'utf8'
);
const customersTablerCss = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'css', 'customers-tabler.css'),
  'utf8'
);

assert.equal(customersPage.includes('css/customers-tabler.css?v=1.1'), true);
assert.equal(customersPage.includes('href="css/customers.css'), false);
assert.equal(
  customersPage.indexOf('css/account-view-shared.css?v=2.4')
    < customersPage.indexOf('css/customers-tabler.css?v=1.1'),
  true
);
assert.equal(customersPage.includes('class="table table-vcenter table-hover card-table customer-table"'), true);
assert.equal(customersPage.includes('class="form-control form-control-sm" type="search" id="customerSearch"'), true);
assert.equal(customersPage.includes('class="btn btn-primary btn-sm" id="openModalBtn"'), true);
assert.equal(customersPage.includes('class="btn btn-icon btn-outline-primary btn-sm view-customer"'), true);
assert.equal(customersTablerCss.includes('layout additions for native Tabler components'), true);
assert.equal(customersPage.includes('class="view-panel view-panel--account"'), true);
assert.equal(customersPage.includes('class="view-panel view-panel--billing"'), true);
assert.equal(customersPage.includes('class="view-panel view-panel--network view-panel--pppoe-grid"'), true);
assert.equal(customersPage.includes('class="view-panel view-panel--nap"'), true);
assert.equal(customersPage.includes('Billing Schedule'), true);
assert.equal(customersPage.includes('table table-vcenter table-hover view-table__table mb-0'), true);
assert.equal(customersTablerCss.includes('View Customer Account: compact Tabler detail workspace.'), true);
assert.equal(customersTablerCss.includes('grid-template-columns: 248px minmax(0, 1fr);'), true);
assert.equal(customersTablerCss.includes('grid-template-columns: repeat(12, minmax(0, 1fr));'), true);
assert.equal(customersTablerCss.includes('.view-panel--history {'), true);
assert.equal(customersTablerCss.includes('grid-column: 1 / -1;'), true);
assert.match(customersPage, /id="mapPinPickerModal" class="[^"]*\bmap-pin-picker-modal\b/);
assert.match(customersPage, /id="useCurrentMapPinLocationBtn"/);
assert.match(customersPage, /navigator\?\.geolocation/);
assert.match(customersPage, /enableHighAccuracy:\s*true/);
assert.match(customersPage, /useCurrentMapPinLocationBtn\.addEventListener\('click', useCurrentMapPinLocation\)/);
assert.match(customersTablerCss, /\.map-pin-picker-modal\s*>\s*\.modal-content\s*\{[^}]*width:\s*min\(760px,/s);

for (const match of customersPage.matchAll(/<button\b[\s\S]*?>/g)) {
  assert.match(match[0], /class="[^"]*\bbtn\b[^"]*"/);
  assert.match(match[0], /class="[^"]*\bbtn-sm\b[^"]*"/);
}

const inlineScripts = [...customersPage.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: `customers-inline-${index + 1}.js` });
});

const staticMarkup = customersPage.replace(/<script[\s\S]*?<\/script>/gi, '');
const ids = [...staticMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length);
assert.equal((customersTablerCss.match(/\{/g) || []).length, (customersTablerCss.match(/\}/g) || []).length);

console.log('Customers Tabler UI tests passed.');
