'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parse5 = require('parse5');

const moduleRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(moduleRoot, relativePath), 'utf8');
const archivePage = read('web/customer-archive.html');
const archiveCss = read('web/css/customer-archive.css');
const archiveScript = read('web/js/customer-archive.js');
const draftPage = read('web/customer-draft-queue.html');
const draftCss = read('web/css/customer-draft-queue.css');
const draftScript = read('web/js/customer-draft-queue.js');

const getAttribute = (node, name) => node?.attrs?.find((entry) => entry.name === name)?.value || '';
const findElementById = (node, id) => {
  if (!node) return null;
  if (getAttribute(node, 'id') === id) return node;
  for (const child of node.childNodes || []) {
    const match = findElementById(child, id);
    if (match) return match;
  }
  return null;
};

const assertNativeModalHierarchy = (documentNode, modalId) => {
  const modal = findElementById(documentNode, modalId);
  assert.ok(modal, `${modalId} must exist.`);
  const dialog = (modal.childNodes || []).find((node) => getAttribute(node, 'class').split(/\s+/).includes('modal-dialog'));
  assert.ok(dialog, `${modalId} must have a direct modal-dialog child.`);
  const content = (dialog.childNodes || []).find((node) => getAttribute(node, 'class').split(/\s+/).includes('modal-content'));
  assert.ok(content, `${modalId} modal-dialog must have a direct modal-content child.`);
};

const assertStaticButtonsUseTabler = (page, { allowNavLinks = false } = {}) => {
  const staticMarkup = page.replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const match of staticMarkup.matchAll(/<button\b[\s\S]*?>/g)) {
    if (allowNavLinks && /class="[^"]*\bnav-link\b/.test(match[0])) continue;
    assert.match(match[0], /class="[^"]*\bbtn\b[^"]*"/, `Expected Tabler btn class: ${match[0]}`);
    assert.match(match[0], /class="[^"]*\bbtn-sm\b[^"]*"/, `Expected compact Tabler button: ${match[0]}`);
  }
};

const archiveDocument = parse5.parse(archivePage);
const draftDocument = parse5.parse(draftPage);

assert.match(archivePage, /css\/tabler-app\.css\?v=3\.2[\s\S]*css\/customer-archive\.css\?v=2\.1/);
assert.match(archivePage, /class="card overflow-hidden"/);
assert.match(archivePage, /class="card-header p-0"[\s\S]*class="overflow-x-auto w-100"[\s\S]*class="nav nav-tabs nav-fill flex-nowrap w-100"/);
assert.equal((archivePage.match(/class="nav-item flex-fill"/g) || []).length, 2, 'Archive tabs must share the card width equally.');
assert.match(archivePage, /id="deletedArchiveTab"[\s\S]*ti ti-trash[\s\S]*id="deletedArchiveCount">0<\/span>/);
assert.match(archivePage, /id="closedAccountsTab"[\s\S]*ti ti-user-off[\s\S]*id="closedAccountsCount">0<\/span>/);
assert.match(archivePage, /js\/customer-archive\.js\?v=2\.6/);
assert.match(archivePage, /class="input-icon"[\s\S]*id="archiveSearch"/);
assert.match(archivePage, /class="table table-vcenter table-hover card-table mb-0 archive-table"/);
assert.equal((archivePage.match(/class="table table-vcenter table-hover card-table mb-0 archive-table"/g) || []).length, 2);
assert.match(archivePage, /class="alert alert-info/);
assert.match(archivePage, /class="alert alert-warning/);
assertNativeModalHierarchy(archiveDocument, 'reopenAccountModal');
assertStaticButtonsUseTabler(archivePage, { allowNavLinks: true });
for (const legacyClass of ['section-frame', 'ghost-btn', 'footer-btn', 'archive-notice', 'archive-search-field', 'select-wrapper', 'page-size-control', 'customer-archive-page', 'archive-workspace', 'archive-tabs', 'archive-panel', 'archive-toolbar', 'archive-table-wrap', 'archive-empty', 'closed-accounts-table']) {
  assert.doesNotMatch(archivePage, new RegExp(`class="[^"]*\\b${legacyClass}\\b[^"]*"`), `Archive must not retain ${legacyClass}.`);
}
assert.match(archiveScript, /class="btn btn-icon btn-outline-success btn-sm"/);
assert.match(archiveScript, /class="btn btn-icon btn-outline-danger btn-sm"/);
assert.match(archiveScript, /class="badge bg-blue-lt text-blue font-monospace"/);
assert.match(archiveScript, /getElementById\('deletedArchiveCount'\)/);
assert.match(archiveScript, /countBadge\.textContent = String\(total\)/);
assert.match(archiveScript, /badge\.classList\.toggle\('bg-primary-lt', active\)/);
assert.doesNotMatch(archiveScript, /archive-icon-btn|archive-status-pill|archive-pill|archive-subscriber|archive-plan-|archive-date|archive-time|archive-countdown|archive-warning|archive-actions|archive-row-select|class="account-tag"/);
assert.match(archiveCss, /^\/\* Customer Archive: only integration rules not supplied by native Tabler\. \*\//);
assert.match(archiveCss, /#reopenAccountModal\.show\s*\{[^}]*z-index:\s*1055/s);
assert.doesNotMatch(archiveCss, /\.customer-archive-page|\.archive-workspace|\.archive-tabs|\.archive-panel|\.archive-toolbar|\.archive-table-wrap|\.archive-empty|\.archive-subscriber|\.subscriber-|\.archive-plan|\.archive-date|\.archive-time|\.archive-countdown|\.archive-warning|\.archive-actions|\.closed-accounts-table|body\.theme-dark/);
assert.equal((archiveCss.match(/\{/g) || []).length, 9, 'Archive CSS must stay limited to table sizing and functional integration rules.');

assert.match(draftPage, /css\/tabler-app\.css\?v=3\.2[\s\S]*css\/customer-draft-queue\.css\?v=3\.0/);
assert.match(draftPage, /class="card draft-queue-panel"/);
assert.match(draftPage, /class="input-icon"[\s\S]*id="draftQueueSearch"/);
assert.match(draftPage, /class="table table-vcenter table-hover card-table mb-0 draft-table"/);
assert.match(draftPage, /class="[^"]*\balert\b[^"]*\balert-warning\b[^"]*" id="draftQueueBulkToolbar"/);
assert.match(draftPage, /id="draftReviewModal"[\s\S]*class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"/);
assertNativeModalHierarchy(draftDocument, 'draftReviewModal');
assertStaticButtonsUseTabler(draftPage);
for (const legacyClass of ['section-frame', 'ghost-btn', 'primary-btn', 'footer-btn', 'draft-search-field', 'select-wrapper', 'page-size-control', 'form-card', 'form-field', 'form-section', 'secure-input-row', 'map-pin-card', 'draft-modal__content', 'modal-subtitle']) {
  assert.equal(draftPage.includes(legacyClass), false, `Draft Queue must not retain ${legacyClass}.`);
}
assert.match(draftScript, /class="btn btn-icon btn-outline-primary btn-sm"/);
assert.match(draftScript, /class="btn btn-icon btn-outline-danger btn-sm"/);
assert.match(draftScript, /class="badge \$\{escapeHtml\(statusUi\.className\)\}"/);
assert.doesNotMatch(draftScript, /fa-(?:solid|regular|spinner|trash|eye)|ghost-icon|status-pill|plan-pill|class="account-tag"/);
assert.match(draftCss, /^\/\* Customer Draft Queue: page-specific layout for native Tabler components\. \*\//);
assert.match(draftCss, /\.modal\.draft-modal\.show\s*\{[^}]*display:\s*block;[^}]*z-index:\s*1055/s);
assert.doesNotMatch(draftCss, /(?:^|\n)\.modal\s*\{|(?:^|\n)\.modal-content\s*\{|\.form-card|\.form-field|\.form-section|\.ghost-icon|body\.theme-dark/);

for (const [label, page] of [['Archive', archivePage], ['Draft Queue', draftPage]]) {
  const staticMarkup = page.replace(/<script[\s\S]*?<\/script>/gi, '');
  const ids = [...staticMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${label} static IDs must be unique.`);
}

for (const [label, documentNode, script] of [
  ['Archive', archiveDocument, archiveScript],
  ['Draft Queue', draftDocument, draftScript]
]) {
  const referencedIds = [...script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  referencedIds.forEach((id) => assert.ok(findElementById(documentNode, id), `${label} script references missing #${id}.`));
}

new vm.Script(archiveScript, { filename: 'customer-archive.js' });
new vm.Script(draftScript, { filename: 'customer-draft-queue.js' });
assert.equal((archiveCss.match(/\{/g) || []).length, (archiveCss.match(/\}/g) || []).length);
assert.equal((draftCss.match(/\{/g) || []).length, (draftCss.match(/\}/g) || []).length);

console.log('Customer Archive and Draft Queue Tabler UI tests passed.');
