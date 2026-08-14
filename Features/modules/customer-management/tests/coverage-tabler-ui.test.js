const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parse5 = require('parse5');

const coveragePage = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'coverage.html'),
  'utf8'
);
const coverageTablerCss = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'css', 'coverage-tabler.css'),
  'utf8'
);

assert.equal(coveragePage.includes('css/coverage-tabler.css?v=3.0'), true);
assert.equal(coveragePage.includes('href="coverage.css'), false);
assert.equal(coveragePage.includes('class="page-header d-print-none mb-3 coverage-page-header"'), true);
assert.equal(coveragePage.includes('class="table table-vcenter table-hover card-table coverage-table mb-0"'), true);
assert.equal(coveragePage.includes('class="card-footer d-flex align-items-center justify-content-between gap-2 flex-wrap coverage-footer"'), true);
assert.equal(coveragePage.includes('class="form-control form-control-sm" id="coverageAreaName"'), true);
assert.equal(coveragePage.includes('class="form-select form-select-sm" name="mikrotikId"'), true);
assert.equal(coveragePage.includes("const API = '/api/coverage';"), true);
assert.equal(coveragePage.includes("const API_CUSTOMERS = '/api/customers';"), true);

for (const match of coveragePage.matchAll(/<button\b[\s\S]*?>/g)) {
  assert.match(match[0], /class="[^"]*\bbtn\b[^"]*"/);
  assert.match(match[0], /class="[^"]*\bbtn-sm\b[^"]*"/);
}

assert.equal(coverageTablerCss.includes('page-scoped layout additions for native Tabler components'), true);
assert.equal(coverageTablerCss.includes('.coverage-summary-strip {'), true);
assert.equal(coverageTablerCss.includes('.coverage-toolbar {'), true);
assert.equal(coverageTablerCss.includes('.coverage-table tbody tr[data-id] {'), true);
assert.equal(coverageTablerCss.includes('#coverageModal.coverage-editor-modal.show {'), true);
assert.equal(coverageTablerCss.includes('.section-toolbar'), false);
assert.equal(coverageTablerCss.includes('.map-frame'), false);
assert.equal(coverageTablerCss.includes('#coverageMap'), false);
assert.equal(coverageTablerCss.includes('.footer-btn'), false);

const inlineScripts = [...coveragePage.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: `coverage-inline-${index + 1}.js` });
});

parse5.parse(coveragePage);
const staticMarkup = coveragePage.replace(/<script[\s\S]*?<\/script>/gi, '');
const ids = [...staticMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length);
assert.equal((coverageTablerCss.match(/\{/g) || []).length, (coverageTablerCss.match(/\}/g) || []).length);

console.log('Coverage Tabler UI tests passed.');
