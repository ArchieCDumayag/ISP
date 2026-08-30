const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parse5 = require('parse5');

const customersPage = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'customers.html'),
  'utf8'
);
const customersTablerCss = fs.readFileSync(
  path.join(__dirname, '..', 'web', 'css', 'customers-tabler.css'),
  'utf8'
);

const customersDocument = parse5.parse(customersPage);
const getAttribute = (node, name) => node?.attrs?.find((attribute) => attribute.name === name)?.value || '';
const findElementById = (node, id) => {
  if (getAttribute(node, 'id') === id) return node;
  for (const child of node?.childNodes || []) {
    const match = findElementById(child, id);
    if (match) return match;
  }
  return null;
};

assert.equal(customersPage.includes('css/customers-tabler.css?v=2.1'), true);
assert.equal(customersPage.includes('href="css/customers.css'), false);
assert.equal(
  customersPage.indexOf('css/account-view-shared.css?v=2.4')
    < customersPage.indexOf('css/customers-tabler.css?v=2.1'),
  true
);
assert.equal(customersPage.includes('class="table table-vcenter table-hover card-table customer-table"'), true);
assert.equal(customersPage.includes('class="form-control form-control-sm" type="search" id="customerSearch"'), true);
assert.equal(customersPage.includes('class="btn btn-primary btn-sm" id="openModalBtn"'), true);
assert.equal(customersPage.includes('class="btn btn-icon btn-outline-primary btn-sm view-customer"'), true);
assert.equal(customersTablerCss.includes('layout additions for native Tabler components'), true);
assert.match(customersPage, /class="[^"]*\bcard\b[^"]*\bview-panel\b[^"]*\bview-panel--account\b/);
assert.match(customersPage, /class="[^"]*\bcard\b[^"]*\bview-panel\b[^"]*\bview-panel--billing\b/);
assert.match(customersPage, /class="[^"]*\bcard\b[^"]*\bview-panel\b[^"]*\bview-panel--network\b[^"]*\bview-panel--pppoe-grid\b/);
assert.equal(customersPage.includes('Network Details'), true);
assert.match(customersPage, /ONU Serial Number[\s\S]*data-view="onuSerialNumber">Not recorded</);
assert.match(customersPage, /data-copy-field="onuSerialNumber"/);
assert.match(customersPage, /onuSerialNumber:\s*String\([\s\S]*liveCustomerData\.onuSerialNumber/);
assert.match(customersPage, /setViewValue\('onuSerialNumber', formatViewText\(viewState\.onuSerialNumber, 'Not recorded'\)\)/);
assert.match(customersPage, /liveCustomerData = \{[\s\S]*currentViewCustomer[\s\S]*recordOverride/);
assert.match(customersPage, /mikrotikPanel\.style\.display = ''/);
assert.match(customersPage, /querySelectorAll\('\[data-view-pppoe-row\]'\)/);
assert.match(customersPage, /class="[^"]*\bcard\b[^"]*\bview-panel\b[^"]*\bview-panel--nap\b/);
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
assert.match(customersPage, /id="mapPinPickerModal"[\s\S]*?<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable coordinate-picker-dialog" role="document">[\s\S]*?<div class="modal-content">/);
assert.match(customersPage, /id="napMapPreviewModal"[\s\S]*?<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">[\s\S]*?<div class="modal-content">/);
assert.doesNotMatch(customersTablerCss, /#mapPinPickerModal\s*>\s*\.coordinate-picker-dialog\s*\{/);
assert.doesNotMatch(customersTablerCss, /#mapPinPickerModal\s*>\s*\.modal-content\s*\{/);
assert.match(customersTablerCss, /#mapPinPickerModal\s+\.map-picker-search\s*\{[^}]*flex:\s*1 1 100%/s);
assert.match(customersTablerCss, /\.map-picker-canvas\s*\{[^}]*height:\s*min\(58vh,\s*480px\);[^}]*min-height:\s*320px/s);
assert.doesNotMatch(customersTablerCss, /#mapPinPickerMap\s*\{[^}]*height:/s);
assert.match(customersPage, /html:\s*`<span class="map-picker-tabler-pin map-picker-tabler-pin--\$\{variant\}"[^>]*><i class="ti ti-map-pin"><\/i><\/span>`/);
assert.match(customersPage, /window\.L\.map\('mapPinPickerMap'/);
assert.match(customersPage, /server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery/);
assert.match(customersPage, /tile\.openstreetmap\.org/);
assert.match(customersPage, /tile\.opentopomap\.org/);
assert.match(customersPage, /nominatim\.openstreetmap\.org\/search/);
assert.match(customersPage, /window\.L\.marker\(latLng,[\s\S]*?draggable:\s*true,[\s\S]*?createMapPickerPinIcon\('customer'\)/);
assert.match(customersPage, /window\.L\.map\('mapPinPickerMap',[\s\S]*?zoomAnimation:\s*false,[\s\S]*?markerZoomAnimation:\s*false/);
assert.match(customersPage, /mapPinPickerMap\.invalidateSize\(\{\s*pan:\s*false\s*\}\);[\s\S]*?setMapPinPickerSelection\(existingCoordinates\.lat/);
assert.match(customersPage, /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?mapPinPickerMap\?\.invalidateSize\(\{\s*pan:\s*false\s*\}\);[\s\S]*?mapPinPickerMarker\.setIcon\(createMapPickerPinIcon\('customer'\)\);[\s\S]*?\},\s*80\);/);
assert.doesNotMatch(customersPage, /maps\.googleapis\.com|GOOGLE_MAPS_BROWSER_API_KEY|GOOGLE_MAPS_MAP_ID|AdvancedMarkerElement/);
assert.doesNotMatch(customersPage, /const svg\s*=\s*`[\s\S]*?<svg xmlns=/);
assert.match(customersTablerCss, /\.map-picker-tabler-pin\s*\{[^}]*--map-picker-pin-color:[^}]*drop-shadow/s);
assert.match(customersTablerCss, /\.map-picker-tabler-pin\s*>\s*\.ti\s*\{[^}]*font-size:\s*2\.5rem/s);
assert.match(customersTablerCss, /\.leaflet-marker-icon\.map-picker-transparent-icon[\s\S]*?width:\s*34px\s*!important;[\s\S]*?height:\s*42px\s*!important;[\s\S]*?margin-top:\s*-40px\s*!important;[\s\S]*?margin-left:\s*-17px\s*!important;[\s\S]*?padding:\s*0\s*!important;[\s\S]*?border:\s*0\s*!important;[\s\S]*?background:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important/);
for (const modalId of ['customerModal', 'portalSetupModal', 'mapPinPickerModal', 'napMapPreviewModal', 'creditOverrideModal', 'customerViewModal', 'importWarningModal']) {
  const modalNode = findElementById(customersDocument, modalId);
  assert.ok(modalNode, `${modalId} must exist.`);
  const dialogNode = modalNode.childNodes.find((node) => getAttribute(node, 'class').split(/\s+/).includes('modal-dialog'));
  assert.ok(dialogNode, `${modalId} must use a direct Tabler modal-dialog child.`);
  const contentNode = dialogNode.childNodes.find((node) => getAttribute(node, 'class').split(/\s+/).includes('modal-content'));
  assert.ok(contentNode, `${modalId} modal-dialog must own the modal-content.`);
}
assert.match(customersPage, /id="modalBackdrop" class="modal-backdrop fade d-none"/);
assert.match(customersPage, /class="alert alert-info[^"]*" id="creditOverrideSummary"/);
assert.match(customersPage, /class="alert alert-warning[^"]*" id="importWarningSummary"/);
assert.match(customersPage, /class="table table-vcenter table-sm card-table mb-0 import-warning-table"/);
assert.match(customersPage, /class="input-icon map-picker-search"[\s\S]*?class="input-icon-addon"[\s\S]*?id="mapPinSearchInput"/);
assert.match(customersPage, /id="toast"[\s\S]*?<div class="toast-body" id="toastMessage">/);
assert.doesNotMatch(customersTablerCss, /\.modal\.customer-modal\s*\{|\.credit-override-summary\s*\{|\.plan-pill\s*\{|\.map-layer-btn\.is-active\s*\{/);
const backdropStack = customersTablerCss.match(/#modalBackdrop\s*\{[^}]*z-index:\s*(\d+)/s);
const customerModalStack = customersTablerCss.match(/\.modal\.customer-modal\.show,[\s\S]*?\.modal\.account-closure-modal\.show\s*\{[^}]*display:\s*block;[^}]*z-index:\s*(\d+)/s);
assert.ok(backdropStack, 'The shared Customers backdrop must have an explicit stacking level.');
assert.ok(customerModalStack, 'Active customer dialogs must have an explicit stacking level.');
assert.ok(Number(customerModalStack[1]) > Number(backdropStack[1]), 'Active customer dialogs must remain above the backdrop so their controls receive pointer input.');
assert.match(customersTablerCss, /body\.modal-open\s*\{[^}]*overflow:\s*hidden/s);
assert.match(customersPage, /id="closeAccountModal" class="[^"]*\baccount-closure-modal\b/);
assert.match(customersPage, /class="[^"]*\bclose-customer-account\b[^"]*"/);
assert.match(customersPage, /\/api\/customers\/\$\{encodeURIComponent\(accountNumber\)\}\/close-account/);
assert.match(customersPage, /id="closeAccountFinalBalance"/);
assert.match(customersPage, /id="closeAccountFinalBalanceHint"/);
assert.match(customersPage, /Final Closed Customer Balance\. Billing history is not changed\./);
assert.doesNotMatch(customersPage, /closeAccountAdjustmentConfirmed|balanceAdjustmentConfirmed/);
assert.doesNotMatch(customersPage, /Confirm the audited|non-cash ledger entry/);
assert.doesNotMatch(customersPage, /id="closeAccountReason"[^>]*required/);
assert.match(customersPage, /No customer records will be deleted\./);
assert.match(customersPage, /const customerCoordinates = parseCoordinateValue\(customer\?\.mapPin\);/);
assert.match(customersPage, /const locationBadge = customerCoordinates[\s\S]*class="badge bg-green-lt text-green customer-location-badge"[\s\S]*ti ti-map-pin-check[\s\S]*:\s*'';/);
assert.match(customersPage, /title="Location Set · Coordinates: \$\{escapeHtml\(coordinateLabel\)\}"/);
assert.doesNotMatch(customersPage, /<span>Location Set<\/span>/);
assert.match(customersPage, /<div class="customer-area-heading">/);
assert.match(customersTablerCss, /\.customer-location-badge\s*\{/);
assert.match(customersPage, /const isCustomerPppoeBound = \(customer = \{\}\) => \{/);
assert.match(customersPage, /entry\?\.customerAccount \|\| entry\?\.accountNumber \|\| entry\?\.customerId/);
assert.match(customersPage, /customerRouterId && entryRouterId && customerRouterId !== entryRouterId/);
assert.match(customersPage, /const pppoeBoundIcon = isCustomerPppoeBound\(customer\)/);
assert.match(customersPage, /title="PPPoE Bound"[\s\S]*ti ti-plug-connected/);
assert.match(customersPage, /\$\{pppoeBoundIcon\}[\s\S]*data-copy-account-number/);
assert.match(customersPage, /pppoeAccountsAll = accounts;[\s\S]*if \(allCustomers\.length\) renderCustomersPage\(\);/);
assert.doesNotMatch(customersTablerCss, /\.modal-backdrop\s*\{|\.modal\.account-closure-modal\s*\{/);
assert.match(customersPage, /bodyElement\.classList\.toggle\('modal-open', hasOpenModal\)/);

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
