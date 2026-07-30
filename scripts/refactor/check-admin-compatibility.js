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
  ['accounts-store.js', 'accounts-store'],
  ['accounts.js', 'accounts'],
  ['activity-log-visibility.js', 'activity-log-visibility'],
  ['activity-log.js', 'activity-log'],
  ['app-downloads-store.js', 'app-downloads-store'],
  ['app-downloads.js', 'app-downloads'],
  ['auth.js', 'auth'],
  ['business-profile.js', 'business-profile'],
  ['info-api.js', 'info-api'],
  ['integration-settings.js', 'integration-settings'],
  ['setup-installer.js', 'setup-installer']
];

const backend = loadModuleBackend('admin', { required: true, fresh: true });
assert.strictEqual(backend.id, 'admin');
assert.strictEqual(typeof backend.load, 'function');
assert.strictEqual(Object.keys(backend.entries).length, backendPairs.length);

backendPairs.forEach(([legacyFile, canonicalName]) => {
  const legacyPath = path.join(projectRoot, legacyFile);
  const canonicalPath = path.join(
    projectRoot,
    'Features/modules/admin/backend',
    canonicalName
  );
  assert(!fs.existsSync(legacyPath), `Obsolete root entry must be removed: ${legacyFile}`);
  assert(fs.existsSync(`${canonicalPath}.js`), `Missing Admin backend: ${canonicalName}.js`);
  require(canonicalPath);
  console.log(`PASS retired Admin root entry ${legacyFile}`);
});

const integrationSettings = require(path.join(
  projectRoot,
  'Features/modules/admin/backend/integration-settings'
));
const ipBrowserFixture = {
  ipBrowser: {
    autoLoginEnabled: true,
    username: 'fallback-admin',
    password: 'fallback-secret',
    profiles: [
      {
        id: 'north-range',
        label: 'North range',
        matches: ['10.20.0.0/16'],
        username: 'north-admin',
        password: 'north-secret'
      },
      {
        id: 'wildcard-range',
        label: 'Wildcard range',
        matches: ['192.168.50.*'],
        username: 'wild-admin',
        password: 'wild-secret'
      },
      {
        id: 'exact-router',
        label: 'Exact router',
        matches: ['10.20.30.40:8080'],
        username: 'exact-admin',
        password: 'exact-secret'
      }
    ]
  }
};
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, 'http://10.20.30.40:8080/')?.id,
  'exact-router',
  'Exact IP:port profile must outrank a matching CIDR profile'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, '10.20.99.8')?.id,
  'north-range',
  'CIDR profile must match an assigned IP in its subnet'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, 'http://192.168.50.77/')?.id,
  'wildcard-range',
  'Wildcard profile must match an assigned IP'
);
assert.strictEqual(
  integrationSettings.resolveIpBrowserProfile(ipBrowserFixture, '192.168.60.77'),
  null,
  'Unmatched IPs must retain the legacy default credential fallback'
);
const sanitizedIpBrowser = integrationSettings.sanitizeIntegrationSettingsForClient(ipBrowserFixture).ipBrowser;
assert.strictEqual(sanitizedIpBrowser.password, '', 'Default IP Browser password must be redacted');
assert.strictEqual(sanitizedIpBrowser.passwordSet, true, 'Default password presence must be reported without disclosure');
assert.strictEqual(sanitizedIpBrowser.profiles[0].username, '', 'Profile username must be redacted');
assert.strictEqual(sanitizedIpBrowser.profiles[0].usernameSet, true, 'Profile username presence must be reported');
assert.strictEqual(sanitizedIpBrowser.profiles[0].password, '', 'Profile password must be redacted');
assert.strictEqual(sanitizedIpBrowser.profiles[0].passwordSet, true, 'Profile password presence must be reported');
const preservedIpBrowserProfiles = integrationSettings.preserveIpBrowserProfileSecrets(
  [{ id: 'north-range', label: 'Renamed', matches: ['10.20.0.0/16'], username: '', password: '' }],
  ipBrowserFixture.ipBrowser.profiles
);
assert.strictEqual(preservedIpBrowserProfiles[0].username, 'north-admin', 'Blank profile username update must retain saved value');
assert.strictEqual(preservedIpBrowserProfiles[0].password, 'north-secret', 'Blank profile password update must retain saved value');
console.log('PASS IP Browser router profile matching and secret redaction');

const webRoot = getModuleWebRoot('admin', { required: true });
const webFiles = [
  'accounts.html',
  'accounts.js',
  'css/accounts.css',
  'css/login.css',
  'flavors.html',
  'install-guide.html',
  'js/install-guide.js',
  'login.html',
  'setup.html',
  'update-download.html'
];

webFiles.forEach((relativePath) => {
  assert(fs.existsSync(path.join(webRoot, relativePath)), `Missing Admin web asset: ${relativePath}`);
  assert(
    !fs.existsSync(path.join(projectRoot, 'public', relativePath)),
    `Legacy Admin web asset must be removed: public/${relativePath}`
  );
});
console.log(`PASS Admin web root (${webFiles.length} files)`);

const accountsHtml = fs.readFileSync(path.join(webRoot, 'accounts.html'), 'utf8');
const accountsJs = fs.readFileSync(path.join(webRoot, 'accounts.js'), 'utf8');
assert(accountsHtml.includes('id="ip-browser-profile-body"'));
assert(accountsHtml.includes('id="ipBrowserProfileModal"'));
assert(accountsHtml.includes('Gateway / assigned IP matches'));
assert(accountsJs.includes('const normalizeIpBrowserMatchList = (value) => {'));
assert(accountsJs.includes('profiles: ipBrowserProfiles.map((profile) => ({'));
assert(accountsJs.includes("button.dataset.ipBrowserProfileAction === 'remove'"));
console.log('PASS IP Browser profile editor structure');

const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
assert(serverSource.includes('const MODULE_RUNTIMES = loadModuleRuntimes({'));
assert(serverSource.includes("requireModuleRuntime('admin')"));
assert(serverSource.includes('const MODULE_WEB_ROOTS = Object.freeze('));
assert(serverSource.includes('MODULE_WEB_ROOTS.forEach((webRoot) => {'));
assert(serverSource.includes('.map((webRoot) => path.join(webRoot, filename))'));
assert(!serverSource.includes("path.join(__dirname, 'public', 'login.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'update-download.html')"));
assert(!serverSource.includes("path.join(__dirname, 'public', 'flavors.html')"));
assert(serverSource.includes('const { loadIntegrationSettings, resolveIpBrowserProfile } = integrationSettingsRouter;'));
assert(serverSource.includes('loadIpBrowserAutoLoginSettings(req, targetUrl)'));
assert(serverSource.includes('normalizeIpBrowserAutoLoginSettings(settings, targetUrl)'));
console.log('PASS Admin server loader and web routing');

const installerSource = fs.readFileSync(
  path.join(projectRoot, 'Features/modules/admin/backend/setup-installer.js'),
  'utf8'
);
assert(installerSource.includes("const rootDir = PROJECT_ROOT;"));
assert(!installerSource.includes("  'setup-installer.js',"));
assert(installerSource.includes("'Features/modules/admin/backend/setup-installer.js'"));
assert(installerSource.includes("'Features/modules/admin/web/update-download.html'"));
console.log('PASS Admin installer root and package paths');
console.log('ADMIN COMPATIBILITY PASSED');
