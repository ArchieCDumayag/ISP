require('./core/config/env-loader');

if (!process.env.TZ) {
    process.env.TZ = 'Asia/Manila';
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const { execFile, spawn } = require('child_process');
const cors = require('cors');
const { createRateLimiter } = require('./core/security/rate-limiter');
const { loadModuleRuntimes } = require('./core/runtime/module-loader');
const { PROJECT_ROOT, PUBLIC_ROOT, DATA_DIR } = require('./core/runtime/paths');

const MODULE_RUNTIMES = loadModuleRuntimes({
    requireBackend: true,
    requireWeb: true
});
const requireModuleRuntime = (moduleId) => {
    const runtime = MODULE_RUNTIMES.get(moduleId);
    if (!runtime) throw new Error(`Required module runtime is missing: ${moduleId}`);
    return runtime;
};
const { backend: adminBackend, webRoot: ADMIN_WEB_ROOT } = requireModuleRuntime('admin');
const { backend: customerManagementBackend, webRoot: CUSTOMER_MANAGEMENT_WEB_ROOT } = requireModuleRuntime('customer-management');
const { backend: billingBackend, webRoot: BILLING_WEB_ROOT } = requireModuleRuntime('billing');
const { backend: networkBackend, webRoot: NETWORK_WEB_ROOT } = requireModuleRuntime('network');
const { backend: collectorBackend, webRoot: COLLECTOR_WEB_ROOT } = requireModuleRuntime('collector');
const { backend: technicianBackend, webRoot: TECHNICIAN_WEB_ROOT } = requireModuleRuntime('technician');
const { backend: financeBackend, webRoot: FINANCE_WEB_ROOT } = requireModuleRuntime('finance');
const { backend: customerAppBackend, webRoot: CUSTOMER_APP_WEB_ROOT } = requireModuleRuntime('customer-app');
const { backend: tempBackend } = requireModuleRuntime('temp');
const MODULE_WEB_ROOTS = Object.freeze(
    [...MODULE_RUNTIMES.values()].map((runtime) => runtime.webRoot).filter(Boolean)
);

// Import API routers
const plansRouter = billingBackend.load('plans');
const paymentsRouter = billingBackend.load('payments');
const paymentsWebhookHandler = paymentsRouter.handleXenditWebhook;
const customersModule = customerManagementBackend.load('customers');
const customersRouter = customersModule.router || customersModule;
const customersPublicRouter = customersModule.publicRouter || require('express').Router();
const getCustomerFromSession = customersModule.getCustomerFromSession;
const {
    deduplicateCustomerFullTables,
    filterCustomerFullImportProtectedRows,
    filterCustomerFullImportRows,
    findCustomerFullImportClosedAccountConflicts,
    getCustomerFullImportAccountNumbers,
    getCustomerFullImportPaymentIds,
    getCustomerFullPaymentSecondaryAliases,
    isCustomerFullImportBlockingConflict,
    importCustomerFullJsonData
} = customerManagementBackend.load('customerFullJsonImport');
const {
    ensurePaymentNumberingStore,
    lockPaymentAccount,
    serializePaymentMutationRequest
} = billingBackend.load('paymentNumbering');
const paymentRecordsRouter = billingBackend.load('paymentRecords');
const {
    buildFirstBillAdjustmentExportRows,
    extractLegacyFirstBillAdjustmentRows,
    mergeFirstBillAdjustmentRows
} = billingBackend.load('firstBillAdjustmentTransfer');
const disconnectionsRouter = billingBackend.load('disconnections');
const referralsRouter = customerManagementBackend.load('referrals');
const coverageRouter = customerManagementBackend.load('coverage');
const ponManagementRouter = networkBackend.load('ponManagement');
const smsRouter = customerAppBackend.load('sms');
const collectorsRouter = collectorBackend.load('collectors');
const expensesRouter = financeBackend.load('expenses');
const payrollRouter = financeBackend.load('payroll');
const { scheduleBilling, runMonthlyBillingOnce, enforcePppoeGracePeriod } = billingBackend.load('billingScheduler');
const { scheduleSmsRunner } = customerAppBackend.load('smsScheduler');
const { router: authRouter, getUserFromSession, getUserFromBasicAuth, requireAuth, requireCollectorOrAdminAuth } = adminBackend.load('auth');
const accountsRouter = adminBackend.load('accounts');
const infoRouter = adminBackend.load('infoApi');
const collectorPaymentsRouter = collectorBackend.load('collectorPayments');
const businessProfileRouter = adminBackend.load('businessProfile');
const factoryResetRouter = adminBackend.load('factoryReset');
const systemBackupRouter = adminBackend.load('systemBackup');
const appDownloadsRouter = adminBackend.load('appDownloads');
const { loadActivityLog, appendActivityLog, clearActivityLog } = adminBackend.load('activityLog');
const integrationSettingsRouter = adminBackend.load('integrationSettings');
const { loadIntegrationSettings, resolveIpBrowserProfile } = integrationSettingsRouter;
const paymentConfirmationsRouter = billingBackend.load('paymentConfirmations');
const mikrotikRouter = networkBackend.load('mikrotik');
const jobsRouter = technicianBackend.load('jobs');
const tempWorkspaceRouter = tempBackend.load('workspace');
const philippinesAddresses = customerManagementBackend.load('philippinesAddresses');
const customerDraftSubmissionsModule = customerManagementBackend.load('customerDraftSubmissions');
const customerDraftAdminRouter = customerDraftSubmissionsModule.adminRouter || require('express').Router();
const customerDraftTechnicianRouter = customerDraftSubmissionsModule.technicianRouter || require('express').Router();
const customerDraftTechnicianAuthRouter = customerDraftSubmissionsModule.technicianAuthRouter || require('express').Router();
const technicianInstallationsRouter = technicianBackend.load('technicianInstallations');
const technicianAssignmentsRouter = technicianBackend.load('technicianAssignments');
const customerAppModule = customerAppBackend.load('customerAppApi');
const customerAppRouter = customerAppModule.router || require('express').Router();
const customerAppPublicRouter = customerAppModule.publicRouter || require('express').Router();
const messengerBotRouter = customerAppBackend.load('messengerBot');
const messengerRemindersRouter = customerAppBackend.load('messengerReminders');
const ticketsModule = technicianBackend.load('tickets');
const ticketsRouter = ticketsModule.router || ticketsModule;
const ticketsPublicRouter = ticketsModule.publicRouter || require('express').Router();
const { startCustomerUpstream } = customerAppBackend.load('customerUpstream');
const { getSession: getCachedSession, verifyToken } = require('./core/security/session-cache');
const { router: structureRouter } = adminBackend.load('setupInstaller');
const { assertRelationalReady, isRelationalReady } = require('./core/data/db-relational');
const { query, getPool } = require('./core/data/db');
const { readJson, writeJson } = require('./core/data/data-store');
const { normalizePppoeUsernameKey } = networkBackend.load('pppoeAccountUtils');
const { accountHasRole } = require('./core/security/role-utils');
const { isJsonStorageMode, getStorageDriver } = require('./core/config/storage-mode');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_UPLOADS_DIR = path.join(PUBLIC_ROOT, 'uploads');
const LEGACY_UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STRUCTURE_OWNER_ID = String(process.env.STRUCTURE_OWNER_ID || '1').trim() || '1';
const NODE_ENV = String(process.env.NODE_ENV || '').trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === 'production';
const parsePositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
};
let cachedCloudflaredHostname;

const parseHostOnly = (hostValue = '') => {
    const value = String(hostValue || '').trim().toLowerCase();
    if (!value) return '';
    if (value.startsWith('[')) {
        const closeIndex = value.indexOf(']');
        return closeIndex >= 0 ? value.slice(0, closeIndex + 1) : value;
    }
    const colonIndex = value.indexOf(':');
    return colonIndex >= 0 ? value.slice(0, colonIndex) : value;
};

const readCloudflaredHostname = () => {
    if (cachedCloudflaredHostname !== undefined) return cachedCloudflaredHostname;
    try {
        const filePath = path.join(PROJECT_ROOT, '.cloudflared', 'config.yml');
        const raw = fs.readFileSync(filePath, 'utf8');
        const match = raw.match(/^\s*-\s*hostname:\s*([^\s#]+)\s*$/m) || raw.match(/^\s*hostname:\s*([^\s#]+)\s*$/m);
        const host = String(match?.[1] || '').trim().toLowerCase();
        cachedCloudflaredHostname = host || '';
    } catch {
        cachedCloudflaredHostname = '';
    }
    return cachedCloudflaredHostname;
};

const parseFirstIp = (value = '') => String(value || '').split(',')[0].trim().toLowerCase();
const isLoopbackIp = (value = '') => LOOPBACK_IPS.has(parseFirstIp(value));
const isAdminUser = (user) => Boolean(user) && accountHasRole(user, 'Admin');
const isStructureOwnerUser = (user) => isAdminUser(user) && String(user.id || '').trim() === STRUCTURE_OWNER_ID;
const requireMessengerReminderAccess = async (req, res, next) => {
    const sessionUser = await getUserFromSession(req);
    if (sessionUser && accountHasRole(sessionUser, 'Collector')) {
        req.user = sessionUser;
        return next();
    }
    return requireCollectorOrAdminAuth(req, res, next);
};
const IP_BROWSER_PROXY_PREFIX = '/api/ip-browser/proxy';
const IP_BROWSER_ABSOLUTE_PATH_PREFIXES = [
    '/boaform',
    '/goform',
    '/cgi-bin',
    '/login.cgi',
    '/formWanEth',
    '/formLogin',
    '/admin/formLogin'
];
const IP_BROWSER_ABSOLUTE_PROXY_EXTENSIONS = new Set([
    '.asp',
    '.cgi',
    '.css',
    '.gif',
    '.htm',
    '.ico',
    '.jpg',
    '.jpeg',
    '.js',
    '.png',
    '.svg',
    '.webp',
    '.xml'
]);
const IP_BROWSER_PROXY_TIMEOUT_MS = parsePositiveInteger(process.env.IP_BROWSER_PROXY_TIMEOUT_MS, 20000);
const IP_BROWSER_PROXY_MAX_TEXT_BYTES = parsePositiveInteger(process.env.IP_BROWSER_PROXY_MAX_TEXT_BYTES, 4 * 1024 * 1024);
const IP_BROWSER_PROXY_MAX_ATTEMPTS = parsePositiveInteger(process.env.IP_BROWSER_PROXY_MAX_ATTEMPTS, 2);
const IP_BROWSER_PROXY_RETRY_DELAY_MS = parsePositiveInteger(process.env.IP_BROWSER_PROXY_RETRY_DELAY_MS, 350);
const IP_BROWSER_PROXY_ALLOW_PUBLIC = String(process.env.IP_BROWSER_PROXY_ALLOW_PUBLIC || '').trim().toLowerCase() === 'true';

const stripIpv6Brackets = (value = '') => String(value || '').trim().replace(/^\[|\]$/g, '');

const isAllowedIpBrowserProxyHost = (hostname = '') => {
    const host = stripIpv6Brackets(hostname).toLowerCase();
    const ipVersion = net.isIP(host);
    if (!ipVersion) return false;
    if (IP_BROWSER_PROXY_ALLOW_PUBLIC) return !isLoopbackIp(host);
    if (ipVersion === 4) {
        const parts = host.split('.').map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return false;
        }
        const [a, b] = parts;
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT ranges often used by ISPs.
        return false;
    }
    return host.startsWith('fc') || host.startsWith('fd');
};

const normalizeIpBrowserProxyProtocol = (value = '') => {
    const protocol = String(value || '').trim().toLowerCase().replace(/:$/, '');
    return protocol === 'http' || protocol === 'https' ? protocol : '';
};

const parseIpBrowserProxyTarget = (req) => {
    const originalUrl = String(req.originalUrl || req.url || '');
    const prefixIndex = originalUrl.indexOf(IP_BROWSER_PROXY_PREFIX);
    const afterPrefix = prefixIndex >= 0
        ? originalUrl.slice(prefixIndex + IP_BROWSER_PROXY_PREFIX.length)
        : '';
    const queryIndex = afterPrefix.indexOf('?');
    const rawPath = queryIndex >= 0 ? afterPrefix.slice(0, queryIndex) : afterPrefix;
    const rawQuery = queryIndex >= 0 ? afterPrefix.slice(queryIndex + 1) : '';
    const segments = rawPath.split('/');
    const protocol = normalizeIpBrowserProxyProtocol(decodeURIComponent(segments[1] || ''));
    const hostPort = decodeURIComponent(segments[2] || '').trim();
    const restPath = segments.slice(3).join('/');
    if (!protocol || !hostPort) {
        throw Object.assign(new Error('Invalid browser proxy target.'), { statusCode: 400 });
    }
    const targetUrl = new URL(`${protocol}://${hostPort}/${restPath}${rawQuery ? `?${rawQuery}` : ''}`);
    if (!isAllowedIpBrowserProxyHost(targetUrl.hostname)) {
        throw Object.assign(new Error('Only private LAN or CGNAT IP targets are allowed.'), { statusCode: 400 });
    }
    return targetUrl;
};

const parseIpBrowserProxyTargetFromReferer = (req) => {
    const referer = String(req.headers.referer || req.headers.referrer || '').trim();
    if (!referer) return null;
    try {
        const refererUrl = new URL(referer);
        if (!refererUrl.pathname.includes(IP_BROWSER_PROXY_PREFIX)) return null;
        const refererTarget = parseIpBrowserProxyTarget({
            originalUrl: `${refererUrl.pathname}${refererUrl.search || ''}`
        });
        const requestPath = String(req.originalUrl || req.url || '/');
        const targetUrl = new URL(requestPath, `${refererTarget.protocol}//${refererTarget.host}`);
        if (!isAllowedIpBrowserProxyHost(targetUrl.hostname)) return null;
        return targetUrl;
    } catch {
        return null;
    }
};

const isIpBrowserAbsoluteProxyCandidate = (req) => {
    const pathname = String(req.path || '').trim();
    if (!pathname || pathname === '/' || pathname.startsWith('/api/')) return false;
    if (IP_BROWSER_ABSOLUTE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        return true;
    }
    const extension = path.posix.extname(pathname).toLowerCase();
    if (IP_BROWSER_ABSOLUTE_PROXY_EXTENSIONS.has(extension)) return true;
    return /^\/(?:admin|apply|form|login|logout|menu|multi[_-]?wan|network|reboot|save|status|system|user|wan|wlan|wireless)\b/i.test(pathname);
};

const buildIpBrowserProxyUrl = (targetUrl) => {
    const url = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl || ''));
    const protocol = normalizeIpBrowserProxyProtocol(url.protocol);
    const host = encodeURIComponent(url.host);
    const pathname = url.pathname || '/';
    return `${IP_BROWSER_PROXY_PREFIX}/${protocol}/${host}${pathname}${url.search || ''}`;
};

const buildIpBrowserProxyCookiePrefix = (targetUrl) => {
    const safeOrigin = `${normalizeIpBrowserProxyProtocol(targetUrl.protocol)}_${targetUrl.host}`
        .replace(/[^A-Za-z0-9_]/g, '_')
        .slice(0, 80);
    return `ipbp_${safeOrigin}_`;
};

const buildIpBrowserProxyCookiePath = (targetUrl) =>
    `${IP_BROWSER_PROXY_PREFIX}/${normalizeIpBrowserProxyProtocol(targetUrl.protocol)}/${encodeURIComponent(targetUrl.host)}`;

const pickIpBrowserProxyCookieHeader = (req, targetUrl) => {
    const rawCookie = String(req.headers.cookie || '').trim();
    if (!rawCookie) return '';
    const prefix = buildIpBrowserProxyCookiePrefix(targetUrl);
    const cookies = rawCookie
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const equalIndex = part.indexOf('=');
            if (equalIndex <= 0) return '';
            const name = part.slice(0, equalIndex).trim();
            const value = part.slice(equalIndex + 1);
            if (!name.startsWith(prefix)) return '';
            return `${name.slice(prefix.length)}=${value}`;
        })
        .filter(Boolean);
    return cookies.join('; ');
};

const rewriteIpBrowserProxySetCookieHeaders = (setCookieHeader, targetUrl) => {
    const values = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : (setCookieHeader ? [setCookieHeader] : []);
    if (!values.length) return [];
    const prefix = buildIpBrowserProxyCookiePrefix(targetUrl);
    const proxyPath = buildIpBrowserProxyCookiePath(targetUrl);
    return values.map((cookie) => {
        const parts = String(cookie || '').split(';');
        const pair = parts.shift() || '';
        const equalIndex = pair.indexOf('=');
        if (equalIndex <= 0) return cookie;
        const name = pair.slice(0, equalIndex).trim();
        const value = pair.slice(equalIndex + 1);
        const attrs = parts
            .map((part) => part.trim())
            .filter(Boolean)
            .filter((part) => !/^domain=/i.test(part))
            .map((part) => (/^path=/i.test(part) ? `Path=${proxyPath}` : part));
        if (!attrs.some((part) => /^path=/i.test(part))) attrs.push(`Path=${proxyPath}`);
        return `${prefix}${name}=${value}; ${attrs.join('; ')}`;
    });
};

const escapeHtmlAttribute = (value = '') => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const safeDecodeURIComponent = (value = '') => {
    let text = String(value || '');
    for (let index = 0; index < 2; index += 1) {
        try {
            const decoded = decodeURIComponent(text);
            if (decoded === text) break;
            text = decoded;
        } catch {
            break;
        }
    }
    return text;
};

const looksLikeTemplateUrlValue = (value = '') => {
    const text = safeDecodeURIComponent(value).trim();
    return /\$\{[^}]*\}/.test(text)
        || /\{\{[^}]*\}\}/.test(text)
        || /<%[^%]*%>/.test(text);
};

const normalizeIpBrowserAutoLoginSettings = (settings = {}, target = null) => {
    const defaults = settings?.ipBrowser && typeof settings.ipBrowser === 'object' ? settings.ipBrowser : {};
    const matchedProfile = typeof resolveIpBrowserProfile === 'function'
        ? resolveIpBrowserProfile(settings, target)
        : null;
    const raw = matchedProfile
        ? {
            ...defaults,
            ...matchedProfile,
            autoLoginEnabled: defaults.autoLoginEnabled,
            usernameSelector: matchedProfile.usernameSelector || defaults.usernameSelector,
            passwordSelector: matchedProfile.passwordSelector || defaults.passwordSelector,
            submitSelector: matchedProfile.submitSelector || defaults.submitSelector,
            delayMs: matchedProfile.delayMs ?? defaults.delayMs
        }
        : defaults;
    const username = String(raw.username || '').trim();
    const password = raw.password != null ? String(raw.password) : '';
    const fallbackPasswords = Array.isArray(raw.passwordFallbacks)
        ? raw.passwordFallbacks
        : String(raw.passwordFallbacks || '').split(/[\r\n,;]+/);
    const passwordCandidates = Array.from(new Set(
        [password, ...fallbackPasswords]
            .map((entry) => String(entry ?? '').trim())
            .filter(Boolean)
    ));
    const delayMs = Number(raw.delayMs);
    return {
        enabled: Boolean(raw.autoLoginEnabled && username && passwordCandidates.length),
        username,
        password,
        passwordCandidates,
        usernameSelector: String(raw.usernameSelector || '').trim(),
        passwordSelector: String(raw.passwordSelector || '').trim(),
        submitSelector: String(raw.submitSelector || '').trim(),
        delayMs: Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 5000 ? delayMs : 600,
        profileId: String(matchedProfile?.id || '').trim(),
        profileLabel: String(matchedProfile?.label || '').trim()
    };
};

const loadIpBrowserAutoLoginSettings = async (req, target = null) => {
    try {
        return normalizeIpBrowserAutoLoginSettings(
            await loadIntegrationSettings(req.user?.branchId || null),
            target
        );
    } catch (error) {
        console.warn('IP browser auto-login disabled because settings could not be loaded:', error.message || error);
        return normalizeIpBrowserAutoLoginSettings({});
    }
};

const injectIpBrowserAutoLoginScript = (html, autoLoginSettings = {}, targetUrl) => {
    if (!autoLoginSettings?.enabled) return html;
    const config = {
        username: autoLoginSettings.username,
        password: autoLoginSettings.password,
        passwords: Array.isArray(autoLoginSettings.passwordCandidates) && autoLoginSettings.passwordCandidates.length
            ? autoLoginSettings.passwordCandidates
            : [autoLoginSettings.password].filter(Boolean),
        usernameSelector: autoLoginSettings.usernameSelector,
        passwordSelector: autoLoginSettings.passwordSelector,
        submitSelector: autoLoginSettings.submitSelector,
        delayMs: autoLoginSettings.delayMs,
        targetKey: `${targetUrl.protocol}//${targetUrl.host}:${autoLoginSettings.username}`
    };
    const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
    const script = `
<script data-archie-ip-browser-autologin>
(() => {
  const config = ${configJson};
  const passwords = (Array.isArray(config.passwords) ? config.passwords : [config.password])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!config.username || !passwords.length) return;
  const passwordAttempts = [passwords[0], ...passwords];
  const ATTEMPT_SESSION_MS = 5 * 60 * 1000;
  const RELOAD_RETRY_PAUSE_MS = 2000;
  const FALLBACK_WITHOUT_ERROR_PAUSE_MS = 60000;
  const LOGIN_FAILURE_PATTERN = /(?:invalid|incorrect|wrong|failed|failure|denied|unauthori[sz]ed|authentication\\s+failed|password\\s+error|login\\s+error|try\\s+again)/i;
  const visible = (element) => {
    if (!element || element.disabled || element.readOnly) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  };
  const firstMatch = (selectors) => {
    for (const selector of selectors.filter(Boolean)) {
      try {
        const match = Array.from(document.querySelectorAll(selector)).find(visible);
        if (match) return match;
      } catch {}
    }
    return null;
  };
  const setNativeValue = (element, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sessionGet = (key, fallback = '') => {
    try {
      return sessionStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  };
  const sessionSet = (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  };
  const getPageText = () => [
    document.title,
    document.body?.innerText,
    location.pathname,
    location.search
  ].join(' ');
  const clickLoginLinkIfPresent = () => {
    const key = 'archie-ip-browser-login-link:' + config.targetKey + ':' + location.pathname;
    const previous = Number(sessionGet(key, '0') || 0);
    if (previous && Date.now() - previous < 8000) return false;
    const pageText = [
      document.title,
      document.body?.innerText,
      location.pathname
    ].join(' ').toLowerCase();
    if (!/(please\\s+login|not\\s+logined|not\\s+logged|login|log\\s*in)/i.test(pageText)) return false;
    const candidates = Array.from(document.querySelectorAll('a[href], button, input[type="button"], input[type="submit"]'));
    const loginControl = candidates.find((element) => {
      if (!visible(element)) return false;
      const text = [
        element.textContent,
        element.value,
        element.name,
        element.id,
        element.getAttribute('href'),
        element.getAttribute('onclick')
      ].join(' ');
      return /admin\\/login|login\\.asp|login|log\\s*in/i.test(text);
    });
    if (!loginControl) return false;
    sessionSet(key, String(Date.now()));
    if (typeof loginControl.click === 'function') {
      loginControl.click();
      return true;
    }
    const href = loginControl.getAttribute && loginControl.getAttribute('href');
    if (href) {
      location.href = href;
      return true;
    }
    return false;
  };
  const run = () => {
    const passwordInput = firstMatch([
      config.passwordSelector,
      'input[type="password"]',
      'input[name="password"]',
      'input[name="passwd"]',
      'input[name="psd"]',
      'input[name="pwd"]',
      'input[name*="pass" i]',
      'input[id*="pass" i]'
    ]);
    if (!passwordInput) {
      clickLoginLinkIfPresent();
      return;
    }
    const usernameInput = firstMatch([
      config.usernameSelector,
      'input[name="username"]',
      'input[name="userName"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[name="loginUsername"]',
      'input[name="account"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[id*="login" i]',
      'input[type="text"]'
    ]);
    if (!usernameInput) return;
    const form = passwordInput.form || usernameInput.form || document.querySelector('form');
    const submit = firstMatch([
      config.submitSelector,
      'button[type="submit"]',
      'input[type="submit"]',
      'button[name*="login" i]',
      'input[type="button"][name*="login" i]',
      'input[type="button"][value*="login" i]',
      'button:not([type])'
    ]);
    const visibleFields = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible);
    const context = [
      location.pathname,
      location.search,
      document.title,
      form?.id,
      form?.name,
      form?.getAttribute('action'),
      submit?.id,
      submit?.name,
      submit?.value,
      submit?.textContent,
      usernameInput.id,
      usernameInput.name,
      passwordInput.id,
      passwordInput.name
    ].join(' ').toLowerCase();
    const explicitLogin = /(?:formlogin|login|logon|sign\s*in|signin|authenticate|auth)/i.test(context);
    const settingsForm = /(?:multi[_-]?wan|formwan|waneth|pppoe|wlan|wifi|dhcp|firewall|routing|route|bridge|tr069|acs|voip|config|setup|apply|save)/i.test(context);
    const compactCredentialPage = visibleFields.length <= 8 && !settingsForm;
    if (!explicitLogin && !compactCredentialPage) return;
    if (settingsForm && !explicitLogin) return;
    const key = 'archie-ip-browser-autologin:' + config.targetKey + ':' + location.pathname;
    let state = {};
    try {
      state = JSON.parse(sessionGet(key, '{}')) || {};
    } catch {}
    const now = Date.now();
    const previousStartedAt = Number(state.startedAt || 0);
    if (!previousStartedAt || now - previousStartedAt > ATTEMPT_SESSION_MS || Number(state.total || 0) !== passwordAttempts.length) {
      state = { startedAt: now, attempt: 0, total: passwordAttempts.length };
    }
    const lastAt = Number(state.lastAt || 0);
    const hasLoginFailure = LOGIN_FAILURE_PATTERN.test(getPageText());
    const attemptIndex = Math.max(0, Number(state.attempt || 0));
    if (attemptIndex >= passwordAttempts.length) return;
    const elapsedSinceLast = lastAt ? now - lastAt : Infinity;
    const waitMs = attemptIndex >= 2 && !hasLoginFailure
      ? FALLBACK_WITHOUT_ERROR_PAUSE_MS
      : RELOAD_RETRY_PAUSE_MS;
    if (lastAt && !hasLoginFailure && elapsedSinceLast < waitMs) {
      window.setTimeout(run, Math.max(500, waitMs - elapsedSinceLast));
      return;
    }
    state.attempt = attemptIndex + 1;
    state.lastAt = now;
    state.total = passwordAttempts.length;
    sessionSet(key, JSON.stringify(state));
    if (usernameInput) setNativeValue(usernameInput, config.username);
    setNativeValue(passwordInput, passwordAttempts[attemptIndex]);
    const delay = Number(config.delayMs);
    window.setTimeout(() => {
      if (submit && typeof submit.click === 'function') {
        submit.click();
      } else if (form?.requestSubmit) {
        form.requestSubmit();
      } else if (form?.submit) {
        form.submit();
      }
      if (state.attempt < passwordAttempts.length) {
        window.setTimeout(run, RELOAD_RETRY_PAUSE_MS);
      }
    }, Number.isFinite(delay) ? delay : 600);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
</script>`;
    if (/<\/body\s*>/i.test(html)) {
        return html.replace(/<\/body\s*>/i, `${script}</body>`);
    }
    return `${html}${script}`;
};

const rewriteIpBrowserProxyText = (body, targetUrl, contentType = '', options = {}) => {
    const type = String(contentType || '').toLowerCase();
    const shouldRewriteHtml = type.includes('text/html') || type.includes('application/xhtml');
    const shouldRewriteCss = type.includes('text/css');
    if (!shouldRewriteHtml && !shouldRewriteCss) return body;

    const toProxyUrl = (rawValue) => {
        const value = String(rawValue || '').trim();
        if (!value || value.startsWith('#') || /^(?:data|blob|mailto|tel|javascript):/i.test(value)) return rawValue;
        if (looksLikeTemplateUrlValue(value)) return rawValue;
        try {
            const parsed = new URL(value, targetUrl);
            const protocol = normalizeIpBrowserProxyProtocol(parsed.protocol);
            if (!protocol || !isAllowedIpBrowserProxyHost(parsed.hostname)) return rawValue;
            return buildIpBrowserProxyUrl(parsed);
        } catch {
            return rawValue;
        }
    };

    let rewritten = String(body || '').replace(
        /\b(src|href|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^'"\s>]+))/gi,
        (match, attr, doubleValue, singleValue, unquotedValue) => {
            const original = doubleValue !== undefined
                ? doubleValue
                : (singleValue !== undefined ? singleValue : unquotedValue);
            const next = escapeHtmlAttribute(toProxyUrl(original));
            if (doubleValue !== undefined) return `${attr}="${next}"`;
            if (singleValue !== undefined) return `${attr}='${next}'`;
            return `${attr}="${next}"`;
        }
    ).replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, value) => {
        const next = toProxyUrl(value);
        return `url(${quote || ''}${next}${quote || ''})`;
    });

    if (shouldRewriteHtml && !/<base\b/i.test(rewritten)) {
        const baseUrl = escapeHtmlAttribute(buildIpBrowserProxyUrl(new URL('.', targetUrl)));
        const baseTag = `<base href="${baseUrl}">`;
        rewritten = /<head[^>]*>/i.test(rewritten)
            ? rewritten.replace(/<head[^>]*>/i, (headTag) => `${headTag}${baseTag}`)
            : `${baseTag}${rewritten}`;
    }
    if (shouldRewriteHtml) {
        rewritten = injectIpBrowserAutoLoginScript(rewritten, options.autoLoginSettings, targetUrl);
    }
    return rewritten;
};

const buildProxyRequestBody = (req) => {
    const method = String(req.method || 'GET').trim().toUpperCase();
    if (method === 'GET' || method === 'HEAD') return null;
    if (Buffer.isBuffer(req.rawBodyBuffer)) return req.rawBodyBuffer;
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (typeof req.rawBody === 'string' && req.rawBody) return Buffer.from(req.rawBody);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/x-www-form-urlencoded') && req.body && typeof req.body === 'object') {
        return Buffer.from(new URLSearchParams(req.body).toString());
    }
    if (contentType.includes('application/json') && req.body && typeof req.body === 'object') {
        return Buffer.from(JSON.stringify(req.body));
    }
    return null;
};

const isIpBrowserFaviconTarget = (targetUrl) =>
    String(targetUrl?.pathname || '').toLowerCase().endsWith('/favicon.ico');

const getIpBrowserProxyRequestOrigin = (targetUrl) => `${targetUrl.protocol}//${targetUrl.host}`;

const rewriteIpBrowserProxyRefererHeader = (req, targetUrl) => {
    const referer = String(req.headers.referer || req.headers.referrer || '').trim();
    if (!referer) return '';
    try {
        const refererUrl = new URL(referer);
        if (refererUrl.pathname.includes(IP_BROWSER_PROXY_PREFIX)) {
            return parseIpBrowserProxyTarget({
                originalUrl: `${refererUrl.pathname}${refererUrl.search || ''}`
            }).href;
        }
    } catch {
        // Use the current target URL when the browser referer cannot be parsed.
    }
    return targetUrl.href;
};

const pickIpBrowserProxyHeaders = (req, targetUrl, bodyBuffer) => {
    const headers = {};
    ['accept', 'accept-language', 'content-type', 'user-agent', 'x-requested-with'].forEach((name) => {
        const value = req.headers[name];
        if (value) headers[name] = value;
    });
    const cookieHeader = pickIpBrowserProxyCookieHeader(req, targetUrl);
    if (cookieHeader) headers.cookie = cookieHeader;
    if (req.headers.origin) headers.origin = getIpBrowserProxyRequestOrigin(targetUrl);
    const refererHeader = rewriteIpBrowserProxyRefererHeader(req, targetUrl);
    if (refererHeader) headers.referer = refererHeader;
    headers.host = targetUrl.host;
    headers['accept-encoding'] = 'identity';
    if (bodyBuffer) headers['content-length'] = String(bodyBuffer.length);
    return headers;
};

const isLegacyIpBrowserHttp09Error = (error, targetUrl) => {
    const message = String(error?.message || '');
    return targetUrl?.protocol === 'http:' && /Expected HTTP\/,\s*RTSP\/ or ICE\//i.test(message);
};

const serializeIpBrowserProxyHeaderValue = (value) => {
    if (Array.isArray(value)) return value.map(serializeIpBrowserProxyHeaderValue).join(', ');
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
};

const inferLegacyIpBrowserContentType = (targetUrl, bodyBuffer) => {
    const extension = path.posix.extname(String(targetUrl?.pathname || '')).toLowerCase();
    const byExtension = {
        '.css': 'text/css; charset=utf-8',
        '.gif': 'image/gif',
        '.htm': 'text/html; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.ico': 'image/x-icon',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.js': 'application/javascript; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml; charset=utf-8',
        '.webp': 'image/webp',
        '.xml': 'application/xml; charset=utf-8'
    };
    if (byExtension[extension]) return byExtension[extension];
    const prefix = Buffer.isBuffer(bodyBuffer)
        ? bodyBuffer.slice(0, 80).toString('utf8').trimStart()
        : '';
    if (/^<(?:!doctype\s+html|html|head|body|script|style)\b/i.test(prefix)) {
        return 'text/html; charset=utf-8';
    }
    return 'application/octet-stream';
};

const parseRawLegacyIpBrowserResponse = (targetUrl, rawBuffer) => {
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.alloc(0);
    const prefix = buffer.slice(0, Math.min(buffer.length, 8192)).toString('latin1');
    if (!prefix.startsWith('HTTP/')) {
        return {
            statusCode: 200,
            headers: {
                'content-type': inferLegacyIpBrowserContentType(targetUrl, buffer)
            },
            body: buffer,
            http09: true
        };
    }

    const doubleCrLf = prefix.indexOf('\r\n\r\n');
    const doubleLf = doubleCrLf >= 0 ? -1 : prefix.indexOf('\n\n');
    const headerEnd = doubleCrLf >= 0 ? doubleCrLf + 4 : (doubleLf >= 0 ? doubleLf + 2 : -1);
    if (headerEnd < 0) {
        return {
            statusCode: 502,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            body: Buffer.from('Legacy device response headers were incomplete.')
        };
    }

    const headerText = buffer.slice(0, headerEnd).toString('latin1');
    const lines = headerText.split(/\r?\n/).filter(Boolean);
    const statusMatch = lines.shift()?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 200;
    const headers = {};
    lines.forEach((line) => {
        const separator = line.indexOf(':');
        if (separator <= 0) return;
        const name = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (!name || !value) return;
        headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
    });
    return {
        statusCode: Number.isInteger(statusCode) ? statusCode : 200,
        headers,
        body: buffer.slice(headerEnd),
        http09: false
    };
};

const handleLegacyIpBrowserHttp09Response = (req, res, targetUrl, bodyBuffer) => new Promise((resolve) => {
    const method = String(req.method || 'GET').trim().toUpperCase() || 'GET';
    const requestPath = `${targetUrl.pathname || '/'}${targetUrl.search || ''}`;
    const headers = {
        ...pickIpBrowserProxyHeaders(req, targetUrl, bodyBuffer),
        connection: 'close'
    };
    delete headers['accept-encoding'];
    const headerLines = Object.entries(headers)
        .filter(([, value]) => value != null && value !== '')
        .map(([name, value]) => `${name}: ${serializeIpBrowserProxyHeaderValue(value)}`);
    const rawRequest = Buffer.concat([
        Buffer.from(`${method} ${requestPath} HTTP/1.0\r\n${headerLines.join('\r\n')}\r\n\r\n`, 'latin1'),
        bodyBuffer || Buffer.alloc(0)
    ]);
    const socket = net.createConnection({
        host: targetUrl.hostname,
        port: Number(targetUrl.port || 80)
    });
    const chunks = [];
    let totalBytes = 0;
    let done = false;

    const finish = async (ok, errorMessage = '') => {
        if (done) return;
        done = true;
        socket.destroy();
        if (!ok) {
            if (!res.headersSent) {
                res.status(502).json({ ok: false, error: errorMessage || 'Unable to read legacy device response.' });
            } else {
                res.end();
            }
            resolve(false);
            return;
        }

        const rawBuffer = Buffer.concat(chunks);
        const parsed = parseRawLegacyIpBrowserResponse(targetUrl, rawBuffer);
        const statusCode = parsed.statusCode || 200;
        const locationHeader = parsed.headers.location;
        if (statusCode >= 300 && statusCode < 400 && locationHeader) {
            try {
                const redirectUrl = new URL(String(locationHeader), targetUrl);
                if (isAllowedIpBrowserProxyHost(redirectUrl.hostname)) {
                    res.setHeader('Location', buildIpBrowserProxyUrl(redirectUrl));
                    res.status(statusCode).end();
                    resolve(true);
                    return;
                }
            } catch {
                // Fall through and return the body when the legacy redirect is malformed.
            }
        }

        const contentType = String(parsed.headers['content-type'] || inferLegacyIpBrowserContentType(targetUrl, parsed.body));
        const rewriteable = /(?:text\/html|application\/xhtml|text\/css)/i.test(contentType);
        res.setHeader('Cache-Control', 'no-store');
        if (!rewriteable || method === 'HEAD') {
            res.status(statusCode).type(contentType);
            if (method === 'HEAD') {
                res.end();
            } else {
                res.send(parsed.body);
            }
            resolve(true);
            return;
        }

        try {
            const autoLoginSettings = await loadIpBrowserAutoLoginSettings(req, targetUrl);
            const rewritten = rewriteIpBrowserProxyText(parsed.body.toString('utf8'), targetUrl, contentType, { autoLoginSettings });
            res.status(statusCode).type(contentType || 'text/html').send(rewritten);
            resolve(true);
        } catch (error) {
            if (!res.headersSent) {
                res.status(502).type('text/plain').send(error.message || 'Browser proxy failed while rewriting the legacy device response.');
            } else {
                res.end();
            }
            resolve(false);
        }
    };

    socket.setTimeout(IP_BROWSER_PROXY_TIMEOUT_MS, () => {
        finish(false, 'Legacy device request timed out.');
    });
    socket.on('connect', () => {
        socket.write(rawRequest);
    });
    socket.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > IP_BROWSER_PROXY_MAX_TEXT_BYTES) {
            finish(false, 'Legacy device response is too large to proxy.');
            return;
        }
        chunks.push(chunk);
    });
    socket.on('end', () => {
        finish(true);
    });
    socket.on('error', (error) => {
        finish(false, error.message || 'Unable to read legacy device response.');
    });
    socket.on('close', () => {
        if (!done) finish(chunks.length > 0, chunks.length ? '' : 'Legacy device closed the connection without a response.');
    });
});

const isRetryableIpBrowserProxyRequest = (req, attempt) => {
    const method = String(req.method || 'GET').trim().toUpperCase();
    return (method === 'GET' || method === 'HEAD') && attempt < Math.max(1, IP_BROWSER_PROXY_MAX_ATTEMPTS);
};

const handleIpBrowserProxyRequest = (req, res, targetUrl, attempt = 1) => {
    const bodyBuffer = buildProxyRequestBody(req);
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const autoLoginSettingsPromise = loadIpBrowserAutoLoginSettings(req, targetUrl);
    const proxyReq = transport.request(targetUrl, {
        method: req.method,
        headers: pickIpBrowserProxyHeaders(req, targetUrl, bodyBuffer),
        timeout: IP_BROWSER_PROXY_TIMEOUT_MS
    }, (proxyRes) => {
        const statusCode = Number(proxyRes.statusCode) || 502;
        const contentType = String(proxyRes.headers['content-type'] || '');
        const locationHeader = proxyRes.headers.location;
        if (statusCode >= 400) {
            console.warn('[ip-browser] device returned error:', {
                method: req.method,
                target: targetUrl.host,
                path: targetUrl.pathname,
                statusCode
            });
        }

        if (statusCode >= 300 && statusCode < 400 && locationHeader) {
            try {
                const redirectUrl = new URL(String(locationHeader), targetUrl);
                if (isAllowedIpBrowserProxyHost(redirectUrl.hostname)) {
                    res.setHeader('Location', buildIpBrowserProxyUrl(redirectUrl));
                    return res.status(statusCode).end();
                }
            } catch {
                // Fall through and proxy the response body when Location is malformed.
            }
        }

        const rewriteable = /(?:text\/html|application\/xhtml|text\/css)/i.test(contentType);
        const blockedHeaders = new Set([
            'connection',
            'content-encoding',
            'content-length',
            'content-security-policy',
            'content-security-policy-report-only',
            'keep-alive',
            'proxy-authenticate',
            'proxy-authorization',
            'te',
            'trailer',
            'transfer-encoding',
            'upgrade',
            'x-frame-options'
        ]);

        Object.entries(proxyRes.headers || {}).forEach(([name, value]) => {
            const lower = String(name || '').toLowerCase();
            if (blockedHeaders.has(lower)) return;
            if (lower === 'set-cookie') {
                const rewrittenCookies = rewriteIpBrowserProxySetCookieHeaders(value, targetUrl);
                if (rewrittenCookies.length) res.setHeader('Set-Cookie', rewrittenCookies);
                return;
            }
            if (value !== undefined) res.setHeader(name, value);
        });
        res.setHeader('Cache-Control', 'no-store');

        if (!rewriteable || req.method === 'HEAD') {
            res.status(statusCode);
            return proxyRes.pipe(res);
        }

        const chunks = [];
        let totalBytes = 0;
        proxyRes.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes <= IP_BROWSER_PROXY_MAX_TEXT_BYTES) {
                chunks.push(chunk);
            }
        });
        proxyRes.on('end', async () => {
            if (totalBytes > IP_BROWSER_PROXY_MAX_TEXT_BYTES) {
                return res.status(502).type('text/plain').send('Browser proxy response is too large to rewrite.');
            }
            try {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                const autoLoginSettings = await autoLoginSettingsPromise;
                const rewritten = rewriteIpBrowserProxyText(rawBody, targetUrl, contentType, { autoLoginSettings });
                res.status(statusCode).type(contentType || 'text/html').send(rewritten);
            } catch (error) {
                if (!res.headersSent) {
                    res.status(502).type('text/plain').send(error.message || 'Browser proxy failed while rewriting the device response.');
                } else {
                    res.end();
                }
            }
        });
        proxyRes.on('error', () => {
            if (!res.headersSent) {
                res.status(502).type('text/plain').send('Browser proxy failed while reading the device response.');
            } else {
                res.end();
            }
        });
    });

    proxyReq.on('timeout', () => {
        proxyReq.destroy(new Error('Device request timed out.'));
    });
    proxyReq.on('error', (error) => {
        if (res.headersSent) return res.end();
        const message = error.message || 'Unable to reach assigned IP from the billing server.';
        console.warn('[ip-browser] proxy request failed:', {
            method: req.method,
            target: targetUrl.host,
            path: `${targetUrl.pathname || '/'}${targetUrl.search || ''}`,
            attempt,
            maxAttempts: IP_BROWSER_PROXY_MAX_ATTEMPTS,
            error: message
        });
        const method = String(req.method || 'GET').trim().toUpperCase();
        if ((method === 'GET' || method === 'HEAD') && isLegacyIpBrowserHttp09Error(error, targetUrl)) {
            console.warn('[ip-browser] using legacy HTTP/0.9 fallback:', {
                method: req.method,
                target: targetUrl.host,
                path: `${targetUrl.pathname || '/'}${targetUrl.search || ''}`
            });
            return handleLegacyIpBrowserHttp09Response(req, res, targetUrl, bodyBuffer);
        }
        if (isRetryableIpBrowserProxyRequest(req, attempt)) {
            return setTimeout(() => {
                handleIpBrowserProxyRequest(req, res, targetUrl, attempt + 1);
            }, IP_BROWSER_PROXY_RETRY_DELAY_MS);
        }
        return res.status(502).json({
            ok: false,
            error: message
        });
    });

    if (bodyBuffer) {
        proxyReq.end(bodyBuffer);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
        proxyReq.end();
    } else {
        req.pipe(proxyReq);
    }
};
const groupRowsByKey = (rows = [], keyName) => {
    const grouped = Object.create(null);
    if (!Array.isArray(rows) || !keyName) return grouped;
    rows.forEach((row) => {
        const key = String(row?.[keyName] || '').trim();
        if (!key) return;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
    });
    return grouped;
};
const normalizeExportCellValue = (value) => {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' && !Number.isFinite(value)) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
};
const normalizeExportRows = (rows = []) => {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return { value: normalizeExportCellValue(row) };
        }
        const normalized = {};
        Object.entries(row).forEach(([key, value]) => {
            normalized[key] = normalizeExportCellValue(value);
        });
        return normalized;
    });
};
const sanitizeSheetName = (rawName, fallback = 'Sheet') => {
    const base = String(rawName || '').trim() || fallback;
    const cleaned = base.replace(/[\[\]\*\/\\\?\:]/g, '_').replace(/\s+/g, ' ');
    const trimmed = cleaned.slice(0, 31).trim();
    return trimmed || fallback;
};
const toCustomerDisplayName = (customer = {}) => {
    const explicitName = String(customer?.name || '').trim();
    if (explicitName) return explicitName;
    const firstName = String(customer?.first_name || customer?.firstName || '').trim();
    const lastName = String(customer?.last_name || customer?.lastName || '').trim();
    const combined = `${firstName} ${lastName}`.trim();
    if (combined) return combined;
    const account = String(customer?.account_number || customer?.accountNumber || '').trim();
    if (account) return `Account ${account}`;
    return 'Unnamed customer';
};
const CLIENTS_EXPORT_HEADERS = Object.freeze([
    'Account Number',
    'Activation Date',
    'Plan Type',
    'Status',
    'Plan',
    'First Name',
    'Middle Name',
    'Last Name',
    'Mobile Number',
    'Email',
    'Street/House No.',
    'Province',
    'Municipality/City',
    'Barangay',
    'Area / Cluster',
    'Coordinates',
    'PPPoE',
    'REFERRED BY',
    'Billing Date',
    'Credit Limit',
    'Facebook Username'
]);
const CLIENTS_EXPORT_COLUMN_WIDTHS = Object.freeze([
    18, 16, 14, 14, 22, 18, 18, 18, 18, 28, 26, 20, 24, 22, 20, 24, 22, 30, 16, 14, 24
]);
const normalizeClientExportText = (value) => {
    if (value == null) return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'object') return '';
    return String(value).trim();
};
const getClientExportValue = (record = {}, keys = []) => {
    for (const key of keys) {
        if (!key || !Object.prototype.hasOwnProperty.call(record || {}, key)) continue;
        const value = record[key];
        if (value === 0) return value;
        const text = normalizeClientExportText(value);
        if (text) return value;
    }
    return '';
};
const getClientExportText = (record = {}, keys = []) =>
    normalizeClientExportText(getClientExportValue(record, keys));
const normalizeClientLookupKey = (value) => normalizeClientExportText(value).toLowerCase();
const formatClientExportDate = (value) => {
    if (!value) return '';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const yyyy = value.getFullYear();
        const mm = String(value.getMonth() + 1).padStart(2, '0');
        const dd = String(value.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const text = normalizeClientExportText(value);
    if (!text) return '';
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const parsed = new Date(text.replace(' ', 'T'));
    if (!Number.isNaN(parsed.getTime())) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    return text;
};
const titleCaseClientExportLabel = (value) => {
    const text = normalizeClientExportText(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (!text) return '';
    return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
};
const normalizeClientPlanCategory = (value) => {
    const text = normalizeClientExportText(value).toLowerCase();
    if (text === 'prepaid' || text.includes('prepaid')) return 'Prepaid';
    if (text === 'postpaid' || text.includes('postpaid')) return 'Postpaid';
    return '';
};
const buildClientExportPlanLookup = (plans = []) => {
    const byId = new Map();
    const byName = new Map();
    (Array.isArray(plans) ? plans : []).forEach((plan) => {
        if (!plan || typeof plan !== 'object') return;
        const id = getClientExportText(plan, ['id', 'planId', 'plan_id']);
        const name = getClientExportText(plan, ['name', 'label', 'planName', 'plan_name']);
        if (id) byId.set(normalizeClientLookupKey(id), plan);
        if (name) byName.set(normalizeClientLookupKey(name), plan);
    });
    return { byId, byName };
};
const resolveClientExportPlan = (customer = {}, planLookup = { byId: new Map(), byName: new Map() }) => {
    const planId = getClientExportText(customer, ['planId', 'plan_id']);
    const planName = getClientExportText(customer, ['planName', 'plan_name', 'plan', 'planValue']);
    const matchedPlan = (planId && planLookup.byId.get(normalizeClientLookupKey(planId)))
        || (planName && planLookup.byName.get(normalizeClientLookupKey(planName)))
        || null;
    const name = planName || getClientExportText(matchedPlan || {}, ['name', 'label']);
    const category = normalizeClientPlanCategory(
        getClientExportText(customer, ['planCategory', 'plan_category', 'planType', 'plan_type'])
        || getClientExportText(matchedPlan || {}, ['category', 'planCategory', 'plan_category'])
        || getClientExportText(customer, ['planBilling', 'plan_billing', 'billingCycle', 'billing_cycle'])
    ) || 'Postpaid';
    return { name, category };
};
const resolveClientExportNameParts = (customer = {}) => {
    const explicitFirst = getClientExportText(customer, ['firstName', 'first_name', 'givenName', 'given_name']);
    const explicitMiddle = getClientExportText(customer, ['middleName', 'middle_name']);
    const explicitLast = getClientExportText(customer, ['lastName', 'last_name', 'surname']);
    if (explicitFirst || explicitMiddle || explicitLast) {
        return { firstName: explicitFirst, middleName: explicitMiddle, lastName: explicitLast };
    }
    const fullName = getClientExportText(customer, ['name', 'fullName', 'full_name', 'customerName', 'customer_name']);
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (!parts.length) return { firstName: '', middleName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
    if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
    return {
        firstName: parts[0],
        middleName: parts.slice(1, -1).join(' '),
        lastName: parts[parts.length - 1]
    };
};
const resolveClientExportCoordinates = (customer = {}) => {
    const direct = getClientExportText(customer, ['mapPin', 'map_pin', 'coordinates', 'coordinate', 'coords']);
    if (direct) return direct;
    const lat = getClientExportText(customer, ['lat', 'latitude']);
    const lng = getClientExportText(customer, ['lng', 'lon', 'longitude']);
    return lat && lng ? `${lat}, ${lng}` : '';
};
const formatClientExportCreditLimit = (customer = {}) => {
    const raw = getClientExportValue(customer, ['creditLimit', 'credit_limit']);
    const text = normalizeClientExportText(raw);
    if (!text) return '';
    const numeric = Number(text.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : text;
};
const resolveClientExportReferral = (customer = {}, customersByAccount = new Map()) => {
    const sourceType = getClientExportText(customer, [
        'referralSourceType',
        'referral_source_type',
        'referredByType',
        'referred_by_type'
    ]).toLowerCase();
    const customerAccount = getClientExportText(customer, [
        'referralCustomerAccountNumber',
        'referral_customer_account_number',
        'referredByAccountNumber',
        'referred_by_account_number'
    ]);
    const customerName = getClientExportText(customer, [
        'referralCustomerName',
        'referral_customer_name',
        'referredByCustomerName',
        'referred_by_customer_name'
    ]);
    const agentName = getClientExportText(customer, ['referralAgentName', 'referral_agent_name']);
    const explicit = getClientExportText(customer, ['referredBy', 'referred_by', 'referral', 'agent']);
    if (sourceType === 'agent' || agentName) return agentName || explicit;
    if (sourceType === 'customer' || customerAccount) {
        const referredCustomer = customerAccount ? customersByAccount.get(customerAccount) : null;
        const resolvedName = customerName || (referredCustomer ? toCustomerDisplayName(referredCustomer) : '');
        if (resolvedName && customerAccount && !resolvedName.includes(customerAccount)) {
            return `${resolvedName} (${customerAccount})`;
        }
        return resolvedName || explicit || customerAccount;
    }
    return explicit;
};
const buildClientsExportRows = (customers = [], plans = []) => {
    const planLookup = buildClientExportPlanLookup(plans);
    const sourceCustomers = Array.isArray(customers) ? customers.slice() : [];
    const customersByAccount = new Map();
    sourceCustomers.forEach((customer) => {
        const accountNumber = getClientExportText(customer, ['accountNumber', 'account_number', 'id']);
        if (accountNumber && !customersByAccount.has(accountNumber)) {
            customersByAccount.set(accountNumber, customer);
        }
    });
    sourceCustomers.sort((left, right) => {
        const leftAccount = getClientExportText(left, ['accountNumber', 'account_number', 'id']);
        const rightAccount = getClientExportText(right, ['accountNumber', 'account_number', 'id']);
        const accountCompare = leftAccount.localeCompare(rightAccount, undefined, { numeric: true, sensitivity: 'base' });
        if (accountCompare) return accountCompare;
        return toCustomerDisplayName(left).localeCompare(toCustomerDisplayName(right), undefined, { sensitivity: 'base' });
    });
    return sourceCustomers.map((customer) => {
        const nameParts = resolveClientExportNameParts(customer);
        const plan = resolveClientExportPlan(customer, planLookup);
        const status = titleCaseClientExportLabel(getClientExportText(customer, ['status', 'customerStatus', 'subscriberStatus'])) || 'Active';
        return [
            getClientExportText(customer, ['accountNumber', 'account_number', 'id']),
            formatClientExportDate(getClientExportValue(customer, ['activationDate', 'activation_date', 'since'])),
            plan.category,
            status,
            plan.name,
            nameParts.firstName,
            nameParts.middleName,
            nameParts.lastName,
            getClientExportText(customer, ['mobileRaw', 'mobile_raw', 'mobile', 'contactNumber', 'contact_number']),
            getClientExportText(customer, ['email', 'emailAddress', 'email_address']),
            getClientExportText(customer, ['street', 'streetHouseNo', 'street_house_no', 'address']),
            getClientExportText(customer, ['province']),
            getClientExportText(customer, ['municipality', 'municipalityCity', 'municipality_city', 'city']),
            getClientExportText(customer, ['barangay']),
            getClientExportText(customer, ['area', 'cluster', 'coverageArea', 'coverage_area']),
            resolveClientExportCoordinates(customer),
            getClientExportText(customer, ['pppoeUsername', 'pppoe_username', 'pppoeAccount', 'pppoe_account', 'pppoe']),
            resolveClientExportReferral(customer, customersByAccount),
            formatClientExportDate(getClientExportValue(customer, ['billDate', 'bill_date', 'billingDate', 'billing_date', 'billingCycle', 'billing_cycle'])),
            formatClientExportCreditLimit(customer),
            getClientExportText(customer, ['facebookUsername', 'facebook_username', 'facebook', 'fbUsername', 'fb_username'])
        ];
    });
};
const createClientsExportWorkbookBuffer = (xlsx, customers = [], plans = []) => {
    const workbook = xlsx.utils.book_new();
    const rows = buildClientsExportRows(customers, plans);
    const worksheet = xlsx.utils.aoa_to_sheet([CLIENTS_EXPORT_HEADERS, ...rows]);
    worksheet['!cols'] = CLIENTS_EXPORT_COLUMN_WIDTHS.map((wch) => ({ wch }));
    worksheet['!autofilter'] = {
        ref: xlsx.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: rows.length, c: CLIENTS_EXPORT_HEADERS.length - 1 }
        })
    };
    xlsx.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName('CLIENTS LIST'));
    return xlsx.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
        compression: true
    });
};
const toPrettyJsonText = (value) => {
    try {
        return JSON.stringify(value ?? [], null, 2);
    } catch {
        return '[]';
    }
};
const toNumericAmount = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
};
const resolvePaymentDirection = (entry = {}) => {
    const explicit = String(entry?.direction || '').trim().toLowerCase();
    if (explicit === 'debit' || explicit === 'credit') return explicit;
    const kind = String(entry?.kind || '').trim().toLowerCase();
    if (kind === 'charge' || kind === 'debit' || kind === 'bill') return 'debit';
    return 'credit';
};
const summarizeCustomerBalance = (entries = []) => {
    const safeEntries = Array.isArray(entries) ? entries : [];
    let totalDebits = 0;
    let totalCreditsAll = 0;
    let totalPayments = 0;
    let lastPaymentDate = '';
    let lastPaymentAmount = 0;
    let lastPaymentTime = -1;

    safeEntries.forEach((entry) => {
        const amount = Math.abs(toNumericAmount(entry?.amount));
        const direction = resolvePaymentDirection(entry);
        if (direction === 'debit') {
            totalDebits += amount;
        } else {
            totalCreditsAll += amount;
            if (String(entry?.kind || '').trim().toLowerCase() === 'payment') {
                totalPayments += amount;
                const whenRaw = entry?.recorded_at || entry?.recordedAt || entry?.date || '';
                const when = new Date(String(whenRaw || '').replace(' ', 'T'));
                const time = when.getTime();
                if (Number.isFinite(time) && time > lastPaymentTime) {
                    lastPaymentTime = time;
                    lastPaymentDate = String(whenRaw || '');
                    lastPaymentAmount = amount;
                }
            }
        }
    });

    const balance = Number((totalDebits - totalCreditsAll).toFixed(2));
    return {
        balance,
        total_debits: Number(totalDebits.toFixed(2)),
        total_credits_all: Number(totalCreditsAll.toFixed(2)),
        total_payments: Number(totalPayments.toFixed(2)),
        last_payment_date: lastPaymentDate,
        last_payment_amount: Number(lastPaymentAmount.toFixed(2))
    };
};
const toSnakeCase = (value) => String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
const camelToSnakeRow = (row = {}) => {
    const normalized = {};
    Object.entries(row && typeof row === 'object' ? row : {}).forEach(([key, value]) => {
        normalized[toSnakeCase(key)] = value;
    });
    return normalized;
};
const normalizeJsonCustomerExportRow = (customer = {}) => ({
    ...camelToSnakeRow(customer),
    account_number: customer.accountNumber || customer.account_number || '',
    branch_id: customer.branchId || customer.branch_id || 1,
    first_name: customer.firstName || customer.first_name || '',
    last_name: customer.lastName || customer.last_name || '',
    mobile_raw: customer.mobileRaw ?? customer.mobile_raw ?? null,
    map_pin: customer.mapPin || customer.map_pin || '',
    activation_date: customer.activationDate || customer.activation_date || '',
    plan_id: customer.planId || customer.plan_id || '',
    plan_name: customer.planName || customer.plan_name || '',
    plan_amount: customer.planAmount ?? customer.plan_amount ?? '',
    plan_billing: customer.planBilling || customer.plan_billing || '',
    plan_category: customer.planCategory || customer.plan_category || '',
    bill_date: customer.billDate || customer.bill_date || '',
    due_date: customer.dueDate || customer.due_date || '',
    prepaid_expiration_at: customer.prepaidExpirationAt || customer.prepaid_expiration_at || '',
    due_offset: customer.dueOffset ?? customer.due_offset ?? '',
    credit_limit: customer.creditLimit ?? customer.credit_limit ?? '',
    login_username: customer.loginUsername || customer.login_username || '',
    pppoe_mode: customer.pppoeMode || customer.pppoe_mode || '',
    mikrotik_id: customer.mikrotikId || customer.mikrotik_id || '',
    pppoe_username: customer.pppoeUsername || customer.pppoe_username || '',
    pppoe_password: customer.pppoePassword || customer.pppoe_password || '',
    pppoe_profile: customer.pppoeProfile || customer.pppoe_profile || '',
    created_at: customer.createdAt || customer.created_at || '',
    updated_at: customer.updatedAt || customer.updated_at || ''
});
const normalizeJsonPlanExportRow = (plan = {}) => ({
    ...camelToSnakeRow(plan),
    plan_id: plan.id || plan.planId || plan.plan_id || '',
    price_suffix: '/ month',
    validity: '',
    created_at: plan.createdAt || plan.created_at || '',
    updated_at: plan.updatedAt || plan.updated_at || ''
});
const normalizeJsonPaymentExportRow = (entry = {}, accountNumber = '', branchId = 1) => ({
    ...camelToSnakeRow(entry),
    id: entry.id || '',
    branch_id: entry.branchId || entry.branch_id || branchId,
    account_number: entry.accountNumber || entry.account_number || accountNumber,
    or_number: entry.orNumber || entry.or_number || '',
    recorded_at: entry.recordedAt || entry.recorded_at || entry.date || '',
    recorded_by_user_id: entry.recordedByUserId || entry.recorded_by_user_id || entry.recordedBy?.id || '',
    recorded_by_username: entry.recordedByUsername || entry.recorded_by_username || entry.recordedBy?.username || '',
    recorded_by_name: entry.recordedByName || entry.recorded_by_name || entry.recordedBy?.name || '',
    recorded_by_role: entry.recordedByRole || entry.recorded_by_role || entry.recordedBy?.role || '',
    payment_method: entry.paymentMethod || entry.payment_method || '',
    xendit_id: entry.xenditId || entry.xendit_id || ''
});
const normalizeJsonRelatedExportRow = (entry = {}, branchId = 1) => ({
    ...camelToSnakeRow(entry),
    branch_id: entry.branchId || entry.branch_id || branchId
});
const readJsonCustomerFullExportData = async (branchId = 1) => {
    const [
        rawCustomers,
        rawPlans,
        rawPayments,
        rawTickets,
        rawJobs,
        rawSmsMessages,
        rawSmsAutomationRuns,
        rawPonState
    ] = await Promise.all([
        readJson('customers', []),
        readJson('plans', []),
        readJson('payments', {}),
        readJson('tickets', []),
        readJson('jobs', []),
        readJson('sms_messages', []),
        readJson('sms_automation_runs', []),
        readJson('pon-state', {})
    ]);
    const customers = (Array.isArray(rawCustomers) ? rawCustomers : [])
        .filter((customer) => !customer?.branchId || Number(customer.branchId) === Number(branchId))
        .map(normalizeJsonCustomerExportRow)
        .sort((left, right) => String(left.account_number || '').localeCompare(String(right.account_number || '')));
    const planRows = (Array.isArray(rawPlans) ? rawPlans : []).map(normalizeJsonPlanExportRow);
    const accountNumberSet = new Set(customers.map((customer) => String(customer.account_number || '').trim()).filter(Boolean));
    const paymentEntries = [];
    if (rawPayments && typeof rawPayments === 'object' && !Array.isArray(rawPayments)) {
        Object.entries(rawPayments).forEach(([accountNumber, accountData]) => {
            if (accountNumberSet.size && !accountNumberSet.has(String(accountNumber))) return;
            const history = Array.isArray(accountData?.history) ? accountData.history : [];
            history.forEach((entry) => {
                paymentEntries.push(normalizeJsonPaymentExportRow(entry, accountNumber, branchId));
            });
        });
    }
    const ticketRows = (Array.isArray(rawTickets) ? rawTickets : [])
        .filter((ticket) => !ticket?.branchId || Number(ticket.branchId) === Number(branchId))
        .map((ticket) => normalizeJsonRelatedExportRow(ticket, branchId));
    const jobRows = (Array.isArray(rawJobs) ? rawJobs : [])
        .filter((job) => !job?.branchId || Number(job.branchId) === Number(branchId))
        .map((job) => normalizeJsonRelatedExportRow(job, branchId));
    const smsMessages = (Array.isArray(rawSmsMessages) ? rawSmsMessages : [])
        .filter((message) => !message?.branchId || Number(message.branchId) === Number(branchId))
        .map((message) => normalizeJsonRelatedExportRow(message, branchId));
    const smsAutomationRuns = (Array.isArray(rawSmsAutomationRuns) ? rawSmsAutomationRuns : [])
        .filter((run) => !run?.branchId || Number(run.branchId) === Number(branchId))
        .map((run) => normalizeJsonRelatedExportRow(run, branchId));
    const safePonState = rawPonState && typeof rawPonState === 'object' && !Array.isArray(rawPonState)
        ? rawPonState
        : {};
    const scopedPonState = safePonState?.branches?.[String(branchId)] || safePonState?.default || null;
    const ponStateJson = scopedPonState && typeof scopedPonState === 'object'
        ? JSON.stringify(scopedPonState)
        : '';
    const ponStateChunks = ponStateJson ? ponStateJson.match(/[\s\S]{1,30000}/g) || [] : [];
    const ponStateRows = ponStateChunks.map((stateJsonChunk, index) => ({
        branch_id: branchId,
        chunk_index: index + 1,
        chunk_count: ponStateChunks.length,
        state_json_chunk: stateJsonChunk
    }));
    const ponNapConnections = [];
    (Array.isArray(scopedPonState?.naps) ? scopedPonState.naps : []).forEach((nap) => {
        (Array.isArray(nap?.connections) ? nap.connections : []).forEach((connection, index) => {
            const accountNumber = String(
                connection?.customerId
                || connection?.customerAccountNumber
                || connection?.customer_account_number
                || ''
            ).trim();
            ponNapConnections.push({
                ...camelToSnakeRow(connection),
                id: connection?.id || `${String(nap?.id || nap?.code || 'nap')}:${Number(connection?.port || index + 1)}:${accountNumber}`,
                branch_id: branchId,
                nap_id: nap?.id || nap?.napId || nap?.nap_id || '',
                nap_client_uid: nap?.id || '',
                nap_code: nap?.code || '',
                customer_account_number: accountNumber,
                customer_name: connection?.customerName || connection?.customer_name || '',
                customer_ref: connection?.customerRef || connection?.customer_ref || '',
                port: connection?.port || '',
                optical_info: connection?.opticalInfo || connection?.optical_info || ''
            });
        });
    });
    return {
        branch: {
            id: branchId,
            name: process.env.BUSINESS_NAME || process.env.INITIAL_BRANCH_NAME || 'MAIN',
            code: String(process.env.BUSINESS_NAME || process.env.INITIAL_BRANCH_NAME || 'main')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
        },
        customers,
        planRows,
        paymentEntries,
        tickets: ticketRows,
        jobs: jobRows,
        smsMessages,
        smsAutomationRuns,
        ponNapConnections,
        ponStateRows
    };
};
const toNonEmptyString = (value) => {
    const text = String(value == null ? '' : value).trim();
    return text || '';
};
const resolveMysqlStoreTableName = () => {
    const tableName = String(process.env.MYSQL_STORE_TABLE || 'app_store').trim() || 'app_store';
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
        throw new Error('MYSQL_STORE_TABLE contains unsupported characters.');
    }
    return tableName;
};
const toNullableString = (value) => {
    const text = toNonEmptyString(value);
    return text || null;
};
const toNullableNumber = (value) => {
    if (value === '' || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const pickRowValue = (row, keys = []) => {
    if (!row || typeof row !== 'object') return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined) {
            return row[key];
        }
    }
    return undefined;
};
const toMysqlDateOnly = (value) => {
    if (value === '' || value == null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};
const toMysqlDateTime = (value) => {
    if (value === '' || value == null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString().slice(0, 19).replace('T', ' ');
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};
const ensureArrayOfObjects = (value) => filterCustomerFullImportRows(value);
const decodeHeaderFileName = (headerValue = '') => {
    const raw = String(headerValue || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
};
const loadExportTablesFromWorkbook = (workbook) => {
    const readSheet = (...names) => {
        for (const name of names) {
            const sheet = workbook?.Sheets?.[name];
            if (!sheet) continue;
            return xlsxModule.utils.sheet_to_json(sheet, { defval: null, raw: true });
        }
        return [];
    };
    const customers = readSheet('customers', 'customer_all_data', 'customers_full');
    const explicitFirstBillAdjustments = readSheet('payment_breakdown_adjustments');
    const legacyFirstBillAdjustments = extractLegacyFirstBillAdjustmentRows([
        ...readSheet('customers'),
        ...readSheet('customer_all_data'),
        ...readSheet('customers_full')
    ]);
    return {
        customers,
        plans: readSheet('plans'),
        payment_entries: readSheet('payment_entries'),
        tickets: readSheet('tickets'),
        jobs: readSheet('jobs'),
        sms_messages: readSheet('sms_messages'),
        sms_automation_runs: readSheet('sms_automation_runs'),
        pon_nap_connections: readSheet('pon_nap_connections'),
        pon_state: readSheet('pon_state'),
        payment_breakdown_adjustments: explicitFirstBillAdjustments.length
            ? explicitFirstBillAdjustments
            : legacyFirstBillAdjustments
    };
};
const parseImportTablesFromBuffer = (buffer, filename = '') => {
    const lower = String(filename || '').trim().toLowerCase();
    const parseJson = () => {
        const text = Buffer.from(buffer || []).toString('utf8').trim();
        if (!text) {
            throw new Error('Import file is empty.');
        }
        const parsed = JSON.parse(text);
        const tablesRoot = parsed && typeof parsed === 'object' && parsed.tables && typeof parsed.tables === 'object'
            ? parsed.tables
            : parsed;
        if (!tablesRoot || typeof tablesRoot !== 'object') {
            throw new Error('Invalid JSON import format.');
        }
        const customers = ensureArrayOfObjects(tablesRoot.customers);
        const explicitFirstBillAdjustments = ensureArrayOfObjects(
            tablesRoot.payment_breakdown_adjustments || tablesRoot.paymentBreakdownAdjustments
        );
        return {
            source: 'json',
            tables: {
                customers,
                plans: ensureArrayOfObjects(tablesRoot.plans),
                payment_entries: ensureArrayOfObjects(tablesRoot.payment_entries || tablesRoot.payments),
                tickets: ensureArrayOfObjects(tablesRoot.tickets),
                jobs: ensureArrayOfObjects(tablesRoot.jobs),
                sms_messages: ensureArrayOfObjects(tablesRoot.sms_messages),
                sms_automation_runs: ensureArrayOfObjects(tablesRoot.sms_automation_runs),
                pon_nap_connections: ensureArrayOfObjects(tablesRoot.pon_nap_connections),
                pon_state: ensureArrayOfObjects(tablesRoot.pon_state),
                payment_breakdown_adjustments: explicitFirstBillAdjustments.length
                    ? explicitFirstBillAdjustments
                    : extractLegacyFirstBillAdjustmentRows(customers)
            }
        };
    };
    const parseWorkbook = () => {
        if (!xlsxModule) xlsxModule = require('xlsx');
        const workbook = xlsxModule.read(Buffer.from(buffer || []), { type: 'buffer' });
        return {
            source: 'xlsx',
            tables: loadExportTablesFromWorkbook(workbook)
        };
    };

    if (lower.endsWith('.json')) return parseJson();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseWorkbook();

    try {
        return parseWorkbook();
    } catch {
        return parseJson();
    }
};
const chunkArray = (items = [], size = 200) => {
    if (!Array.isArray(items) || !items.length) return [];
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
};

const isLocalhostRequest = (req) => {
    const hostHeader = parseHostOnly(req.headers.host || '');
    const hostname = parseHostOnly(req.hostname || '');
    const forwardedHost = parseHostOnly(req.headers['x-forwarded-host'] || '');
    const hostIsLocalhost = [hostHeader, hostname, forwardedHost].some((value) => LOCALHOST_HOSTS.has(value));
    if (!hostIsLocalhost) return false;

    const forwardedIps = [];
    if (req.headers['cf-connecting-ip']) forwardedIps.push(req.headers['cf-connecting-ip']);
    if (req.headers['x-real-ip']) forwardedIps.push(req.headers['x-real-ip']);
    if (req.headers['x-forwarded-for']) forwardedIps.push(req.headers['x-forwarded-for']);
    if (req.ip) forwardedIps.push(req.ip);
    if (req.socket && req.socket.remoteAddress) forwardedIps.push(req.socket.remoteAddress);
    if (req.connection && req.connection.remoteAddress) forwardedIps.push(req.connection.remoteAddress);

    const parsedIps = forwardedIps.map(parseFirstIp).filter(Boolean);
    if (!parsedIps.length) return false;
    return parsedIps.every((ip) => isLoopbackIp(ip));
};
const requireStructureOwnerAccess = async (req, res, next) => {
    if (!isLocalhostRequest(req)) {
        return res.status(404).send('Not Found');
    }
    const user = await getUserFromSession(req);
    if (!isStructureOwnerUser(user)) {
        return res.status(404).send('Not Found');
    }
    req.user = user;
    return next();
};

const SYSTEM_UPDATE_COMMIT_LIMIT = 50;
const SYSTEM_UPDATE_GIT_TIMEOUT_MS = 15000;
const SYSTEM_UPDATE_FETCH_TIMEOUT_MS = 30000;
const SYSTEM_UPDATE_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const SYSTEM_UPDATE_RESTART_DELAY_MS = 1800;
const SYSTEM_UPDATE_REPOSITORY_FALLBACK_URL = 'https://github.com/ArchieCDumayag/ISP';
let systemUpdateRestartScheduled = false;
let systemUpdateRunState = {
    running: false,
    status: 'idle',
    startedAt: '',
    finishedAt: '',
    currentStep: '',
    message: '',
    logs: ''
};

const makeSystemUpdateError = (message, statusCode = 500) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const normalizeGitCommandOutput = (value) => String(value || '').replace(/\s+$/g, '');

const summarizeGitError = (error, fallback = 'Git command failed.') => {
    const stderr = normalizeGitCommandOutput(error?.stderr || '');
    const stdout = normalizeGitCommandOutput(error?.stdout || '');
    const message = normalizeGitCommandOutput(stderr || stdout || error?.message || fallback);
    if (error?.killed || error?.signal === 'SIGTERM') {
        return 'Git command timed out.';
    }
    return message || fallback;
};

const runGitCommand = (args = [], options = {}) => new Promise((resolve, reject) => {
    execFile('git', args, {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        timeout: options.timeout || SYSTEM_UPDATE_GIT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer || 1024 * 1024
    }, (error, stdout, stderr) => {
        if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            return reject(error);
        }
        return resolve(normalizeGitCommandOutput(stdout));
    });
});

const runGitCommandOrEmpty = async (args = [], options = {}) => {
    try {
        return await runGitCommand(args, options);
    } catch {
        return '';
    }
};

const parseOsRelease = () => {
    if (process.platform !== 'linux') return {};
    try {
        const raw = fs.readFileSync('/etc/os-release', 'utf8');
        return raw.split(/\r?\n/).reduce((acc, line) => {
            const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (!match) return acc;
            const key = match[1];
            const value = match[2].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
            acc[key] = value;
            return acc;
        }, {});
    } catch {
        return {};
    }
};

const getSystemUpdatePlatformInfo = () => {
    const osRelease = parseOsRelease();
    const distroId = String(osRelease.ID || '').trim().toLowerCase();
    const distroName = String(osRelease.PRETTY_NAME || osRelease.NAME || '').trim();
    const isUbuntu = process.platform === 'linux'
        && (distroId === 'ubuntu' || distroName.toLowerCase().includes('ubuntu'));
    const isWindows = process.platform === 'win32';
    const enabled = isUbuntu || isWindows;
    const platformLabel = isWindows ? 'Windows' : (isUbuntu ? 'Ubuntu' : (distroName || process.platform));
    return {
        platform: process.platform,
        distroId,
        distroName,
        isUbuntu,
        isWindows,
        enabled,
        message: enabled
            ? `Automatic updates are enabled on this ${platformLabel} install.`
            : 'Automatic updates run only on Windows or Ubuntu installs.'
    };
};

const normalizeGitWebUrl = (remoteUrl = '') => {
    const raw = String(remoteUrl || '').trim();
    if (!raw) return '';
    const sshMatch = raw.match(/^git@([^:]+):(.+)$/i);
    if (sshMatch) {
        return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/i, '')}`;
    }
    if (/^https?:\/\//i.test(raw)) {
        return raw.replace(/\.git(?:\/)?$/i, '').replace(/\/+$/g, '');
    }
    return '';
};

const repositoryNameFromUrl = (repoUrl = '') => {
    const normalized = String(repoUrl || '').trim().replace(/\/+$/g, '');
    const githubMatch = normalized.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i);
    if (githubMatch) return githubMatch[1];
    const pathName = normalized.replace(/^https?:\/\/[^/]+\//i, '');
    return pathName || 'Repository';
};

const splitUpstreamRef = (upstreamRef = '') => {
    const ref = String(upstreamRef || '').trim();
    const slashIndex = ref.indexOf('/');
    if (slashIndex < 0) return { remoteName: '', remoteBranch: ref };
    return {
        remoteName: ref.slice(0, slashIndex),
        remoteBranch: ref.slice(slashIndex + 1)
    };
};

const normalizeRemoteBranchName = (value = '') => String(value || '')
    .trim()
    .replace(/^refs\/heads\//i, '')
    .replace(/^refs\/remotes\/[^/]+\//i, '');

const parseGitCommitLine = (line = '', repoUrl = '') => {
    const [hash = '', shortHash = '', timestampText = '', author = '', ...subjectParts] = String(line || '').split('\x1f');
    const timestamp = Number(timestampText);
    const committedAt = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : '';
    const fullHash = String(hash || '').trim();
    return {
        hash: fullHash,
        shortHash: String(shortHash || fullHash.slice(0, 7)).trim(),
        committedAt,
        author: String(author || '').trim(),
        subject: subjectParts.join('\x1f').trim(),
        url: repoUrl && fullHash ? `${repoUrl}/commit/${fullHash}` : ''
    };
};

const parseGitCommitLog = (output = '', repoUrl = '') => String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseGitCommitLine(line, repoUrl))
    .filter((commit) => Boolean(commit.hash));

const appendSystemUpdateLog = (chunk = '') => {
    const text = String(chunk || '');
    if (!text) return;
    systemUpdateRunState.logs = `${systemUpdateRunState.logs || ''}${text}`;
    if (systemUpdateRunState.logs.length > 20000) {
        systemUpdateRunState.logs = systemUpdateRunState.logs.slice(systemUpdateRunState.logs.length - 20000);
    }
};

const cloneSystemUpdateRunState = () => ({
    running: Boolean(systemUpdateRunState.running),
    status: systemUpdateRunState.status || 'idle',
    startedAt: systemUpdateRunState.startedAt || '',
    finishedAt: systemUpdateRunState.finishedAt || '',
    currentStep: systemUpdateRunState.currentStep || '',
    message: systemUpdateRunState.message || '',
    logs: systemUpdateRunState.logs || ''
});

const runSystemUpdateStep = (label, command, args = [], options = {}) => new Promise((resolve, reject) => {
    systemUpdateRunState.currentStep = label;
    appendSystemUpdateLog(`\n[${new Date().toISOString()}] ${label}\n$ ${[command, ...args].join(' ')}\n`);
    execFile(command, args, {
        cwd: PROJECT_ROOT,
        windowsHide: true,
        timeout: options.timeout || SYSTEM_UPDATE_GIT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer || 2 * 1024 * 1024
    }, (error, stdout, stderr) => {
        if (stdout) appendSystemUpdateLog(stdout);
        if (stderr) appendSystemUpdateLog(stderr);
        if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            return reject(error);
        }
        return resolve({ stdout: normalizeGitCommandOutput(stdout), stderr: normalizeGitCommandOutput(stderr) });
    });
});

const getSystemUpdateNpmCommand = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

const scheduleWindowsSystemUpdateRestart = () => {
    const npmExecPath = String(process.env.npm_execpath || '').trim();
    const npmStart = npmExecPath && fs.existsSync(npmExecPath)
        ? { command: process.execPath, args: [npmExecPath, 'start'] }
        : { command: getSystemUpdateNpmCommand(), args: ['start'] };
    const restartScript = `
const { spawn } = require('child_process');
setTimeout(() => {
  const child = spawn(${JSON.stringify(npmStart.command)}, ${JSON.stringify(npmStart.args)}, {
    cwd: ${JSON.stringify(PROJECT_ROOT)},
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}, ${SYSTEM_UPDATE_RESTART_DELAY_MS + 2500});
`;
    const child = spawn(process.execPath, ['-e', restartScript], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    child.unref();
};

const scheduleSystemUpdateRestart = () => {
    if (systemUpdateRestartScheduled) return;
    systemUpdateRestartScheduled = true;
    if (process.platform === 'win32') {
        scheduleWindowsSystemUpdateRestart();
    }
    const timer = setTimeout(() => {
        const restartTarget = process.platform === 'win32'
            ? 'the Windows launcher'
            : 'the Ubuntu service manager';
        console.log(`[system-update] Update applied. Exiting so ${restartTarget} can restart the app.`);
        process.exit(0);
    }, SYSTEM_UPDATE_RESTART_DELAY_MS);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
};

const applySystemUpdateIfAvailable = async () => {
    if (systemUpdateRunState.running) {
        throw makeSystemUpdateError('A system update is already running.', 409);
    }

    const platformInfo = getSystemUpdatePlatformInfo();
    if (!platformInfo.enabled) {
        throw makeSystemUpdateError(platformInfo.message, 409);
    }

    const status = await buildSystemUpdateStatus();
    if (status.comparison?.unableToVerify) {
        throw makeSystemUpdateError(
            status.comparison.fetchError
                ? `Unable to check GitHub for updates: ${status.comparison.fetchError}`
                : 'Unable to check GitHub for updates.',
            502
        );
    }
    if (!status.comparison?.updateAvailable) {
        systemUpdateRunState = {
            ...systemUpdateRunState,
            running: false,
            status: 'idle',
            currentStep: '',
            message: 'Already up to date.'
        };
        return {
            applied: false,
            message: 'Already up to date.',
            status
        };
    }

    if (status.workingTree?.dirty) {
        throw makeSystemUpdateError(
            `Working tree has ${status.workingTree.changedFileCount || 0} local file change(s). Commit or stash them before automatic update.`,
            409
        );
    }

    systemUpdateRunState = {
        running: true,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: '',
        currentStep: 'Starting update',
        message: 'Applying update...',
        logs: ''
    };

    try {
        const remoteName = status.branch?.remote || 'origin';
        const remoteBranch = status.branch?.remoteBranch || status.branch?.local || 'main';
        await runSystemUpdateStep('Fetch remote updates', 'git', ['fetch', remoteName, remoteBranch], {
            timeout: SYSTEM_UPDATE_FETCH_TIMEOUT_MS
        });
        await runSystemUpdateStep('Fast-forward tracked branch', 'git', ['pull', '--ff-only', remoteName, remoteBranch], {
            timeout: SYSTEM_UPDATE_FETCH_TIMEOUT_MS
        });

        const hasPackageLock = fs.existsSync(path.join(PROJECT_ROOT, 'package-lock.json'));
        const npmArgs = hasPackageLock
            ? ['ci', '--omit=dev']
            : ['install', '--omit=dev'];
        await runSystemUpdateStep('Install production dependencies', getSystemUpdateNpmCommand(), npmArgs, {
            timeout: SYSTEM_UPDATE_INSTALL_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024
        });

        systemUpdateRunState.running = false;
        systemUpdateRunState.status = 'restart-pending';
        systemUpdateRunState.finishedAt = new Date().toISOString();
        systemUpdateRunState.currentStep = 'Restart pending';
        systemUpdateRunState.message = 'Update applied. Restarting the app now.';
        appendSystemUpdateLog(`\n[${systemUpdateRunState.finishedAt}] Update applied. Restart pending.\n`);

        scheduleSystemUpdateRestart();

        return {
            applied: true,
            message: 'Update applied. The app is restarting now; refresh this tab after it comes back.',
            status,
            updateRun: cloneSystemUpdateRunState()
        };
    } catch (error) {
        systemUpdateRunState.running = false;
        systemUpdateRunState.status = 'failed';
        systemUpdateRunState.finishedAt = new Date().toISOString();
        systemUpdateRunState.currentStep = '';
        systemUpdateRunState.message = summarizeGitError(error, 'Automatic update failed.');
        appendSystemUpdateLog(`\n[${systemUpdateRunState.finishedAt}] Failed: ${systemUpdateRunState.message}\n`);
        throw makeSystemUpdateError(systemUpdateRunState.message, 500);
    }
};

const buildSystemUpdateStatus = async () => {
    const warnings = [];
    const gitRoot = await runGitCommandOrEmpty(['rev-parse', '--show-toplevel']);
    if (!gitRoot) {
        throw makeSystemUpdateError('This server folder is not a Git checkout.', 409);
    }

    const currentBranchRaw = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
    const detached = currentBranchRaw === 'HEAD';
    if (detached) {
        throw makeSystemUpdateError('This server checkout is detached. Check out a tracked branch before using system updates.', 409);
    }

    const currentBranch = currentBranchRaw;
    const upstreamRef = await runGitCommandOrEmpty(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const splitUpstream = splitUpstreamRef(upstreamRef);
    const configuredRemote = await runGitCommandOrEmpty(['config', '--get', `branch.${currentBranch}.remote`]);
    const configuredMerge = await runGitCommandOrEmpty(['config', '--get', `branch.${currentBranch}.merge`]);
    const remoteName = configuredRemote || splitUpstream.remoteName || 'origin';
    const remoteBranch = normalizeRemoteBranchName(configuredMerge) || splitUpstream.remoteBranch || currentBranch;
    const remoteRef = upstreamRef || `${remoteName}/${remoteBranch}`;

    if (!upstreamRef) {
        warnings.push(`Branch ${currentBranch} has no configured upstream; using ${remoteRef}.`);
    }

    let fetchedAt = '';
    let fetchError = '';
    try {
        await runGitCommand(['fetch', '--quiet', '--prune', remoteName], {
            timeout: SYSTEM_UPDATE_FETCH_TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024
        });
        fetchedAt = new Date().toISOString();
    } catch (error) {
        fetchError = summarizeGitError(error);
        warnings.push(`Remote fetch failed: ${fetchError}`);
    }

    const remoteUrlRaw = await runGitCommandOrEmpty(['config', '--get', `remote.${remoteName}.url`])
        || await runGitCommandOrEmpty(['config', '--get', 'remote.origin.url']);
    const repositoryUrl = normalizeGitWebUrl(remoteUrlRaw) || SYSTEM_UPDATE_REPOSITORY_FALLBACK_URL;
    const localCommitOutput = await runGitCommandOrEmpty([
        'log',
        '-1',
        '--pretty=format:%H%x1f%h%x1f%ct%x1f%an%x1f%s',
        'HEAD'
    ]);
    const localCommit = parseGitCommitLine(localCommitOutput, repositoryUrl);
    const remoteHead = await runGitCommandOrEmpty(['rev-parse', remoteRef]);
    if (!remoteHead) {
        throw makeSystemUpdateError(`Remote branch ${remoteRef} is not available on this server.`, 409);
    }

    let ahead = 0;
    let behind = 0;
    const countOutput = await runGitCommandOrEmpty(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
    if (countOutput) {
        const [aheadText, behindText] = countOutput.trim().split(/\s+/);
        ahead = Math.max(0, Number(aheadText) || 0);
        behind = Math.max(0, Number(behindText) || 0);
    } else {
        warnings.push(`Could not compare HEAD with ${remoteRef}.`);
    }

    const commitsOutput = await runGitCommand([
        'log',
        `-${SYSTEM_UPDATE_COMMIT_LIMIT}`,
        '--pretty=format:%H%x1f%h%x1f%ct%x1f%an%x1f%s',
        remoteRef
    ], { maxBuffer: 2 * 1024 * 1024 });
    const commits = parseGitCommitLog(commitsOutput, repositoryUrl);

    const statusOutput = await runGitCommandOrEmpty(['status', '--porcelain']);
    const dirtyCount = statusOutput
        ? statusOutput.split(/\r?\n/).filter((line) => line.trim()).length
        : 0;

    const remoteStatusVerified = Boolean(fetchedAt);

    return {
        repository: {
            name: repositoryNameFromUrl(repositoryUrl),
            url: repositoryUrl,
            remoteUrl: remoteUrlRaw || ''
        },
        branch: {
            local: currentBranch,
            upstream: upstreamRef || remoteRef,
            remote: remoteName,
            remoteBranch,
            remoteRef,
            fetchedAt
        },
        local: localCommit,
        remote: {
            hash: remoteHead,
            shortHash: remoteHead.slice(0, 7),
            commit: commits[0] || null
        },
        comparison: {
            ahead,
            behind,
            updateAvailable: remoteStatusVerified && behind > 0,
            upToDate: remoteStatusVerified && behind === 0,
            unableToVerify: !remoteStatusVerified,
            fetchError
        },
        workingTree: {
            dirty: dirtyCount > 0,
            changedFileCount: dirtyCount
        },
        autoUpdate: getSystemUpdatePlatformInfo(),
        updateRun: cloneSystemUpdateRunState(),
        commits,
        warnings
    };
};

const parseCookieHeader = (cookieHeader = '') =>
    cookieHeader.split(';').reduce((acc, part) => {
        const [key, ...rest] = part.trim().split('=');
        if (!key) return acc;
        acc[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '');
        return acc;
    }, {});

const getBaseUrl = (req) => {
    const protoHeader = String(req.headers['x-forwarded-proto'] || '');
    const isSecure = req.secure || protoHeader.includes('https');
    return `${isSecure ? 'https' : 'http'}://${req.get('host')}`;
};

const PDF_CACHE_TTL_MS = 5 * 60 * 1000;
const PDF_DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PDF_CACHE_DIR = path.join(DATA_DIR, 'pdf-cache');
const STATEMENT_PDF_LAYOUT_VERSION = 'print-v6-ready-fresh-cache';
const STATEMENT_PDF_TIME_ZONE = 'Asia/Manila';
const STATEMENT_PDF_VIEWPORT = Object.freeze({
    width: 1365,
    height: 2000,
    deviceScaleFactor: 1
});
const STATEMENT_READY_TIMEOUT_MS = 30000;
fs.mkdirSync(PDF_CACHE_DIR, { recursive: true });
const pdfCache = new Map();
let pdfBrowser = null;
let pdfBrowserPromise = null;
let puppeteerModule = null;
let xlsxModule = null;

const toSafeCacheKey = (cacheKey) => String(cacheKey || '').replace(/[^0-9a-z_-]/gi, '_');
const getPdfCachePath = (cacheKey) => path.join(PDF_CACHE_DIR, `${toSafeCacheKey(cacheKey)}.pdf`);
const getTemplateVersionToken = (templateName) => {
    const safeName = String(templateName || '').replace(/[^0-9a-z._-]/gi, '');
    if (!safeName) return '0';
    try {
        const fullPath = path.join(BILLING_WEB_ROOT, safeName);
        const stats = fs.statSync(fullPath);
        return String(Math.floor(stats.mtimeMs || 0));
    } catch {
        return '0';
    }
};

const getCachedPdf = (cacheKey) => {
    const entry = pdfCache.get(cacheKey);
    if (entry) {
        if (Date.now() - entry.createdAt <= PDF_CACHE_TTL_MS) {
            return entry.buffer;
        }
        pdfCache.delete(cacheKey);
    }
    const filePath = getPdfCachePath(cacheKey);
    try {
        const stats = fs.statSync(filePath);
        if (Date.now() - stats.mtimeMs > PDF_DISK_CACHE_TTL_MS) {
            fs.unlinkSync(filePath);
            return null;
        }
        const buffer = fs.readFileSync(filePath);
        pdfCache.set(cacheKey, { buffer, createdAt: stats.mtimeMs });
        return buffer;
    } catch {
        return null;
    }
};

const setCachedPdf = (cacheKey, buffer) => {
    pdfCache.set(cacheKey, { buffer, createdAt: Date.now() });
    try {
        fs.writeFileSync(getPdfCachePath(cacheKey), buffer);
    } catch (error) {
        console.warn('Failed to write PDF cache:', error.message);
    }
};

const sendPdfResponse = (res, buffer, filename) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.send(buffer);
};

const getRequestFreshToken = (req) =>
    String(req.query?.t || req.query?.downloadId || '').trim().replace(/[^0-9a-z._-]/gi, '').slice(0, 80);

const waitForStatementReady = async (page) => {
    await page.waitForFunction(
        () => document.body && document.body.dataset.statementReady === 'true',
        { timeout: STATEMENT_READY_TIMEOUT_MS }
    );
    await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready.catch(() => {});
        }
    });
};

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getStatementDataToken = async (accountNumber, branchId = null) => {
    const normalizedAccount = String(accountNumber || '').trim();
    if (!normalizedAccount) return 'no-account';

    try {
        const hasBranchScope = branchId !== null && branchId !== undefined && String(branchId).trim() !== '';
        const normalizedBranchId = hasBranchScope ? Number(branchId) : null;
        const customerSql = hasBranchScope
            ? `SELECT
                COALESCE(UNIX_TIMESTAMP(updated_at), 0) AS customer_updated_ts
             FROM customers
             WHERE account_number = ?
               AND branch_id = ?
             LIMIT 1`
            : `SELECT
                COALESCE(UNIX_TIMESTAMP(updated_at), 0) AS customer_updated_ts
             FROM customers
             WHERE account_number = ?
             LIMIT 1`;
        const customerParams = hasBranchScope
            ? [normalizedAccount, normalizedBranchId]
            : [normalizedAccount];
        const [rows] = await query(
            customerSql,
            customerParams
        );
        const customerUpdatedTs = toFiniteNumber(rows?.[0]?.customer_updated_ts, 0);

        const paymentSql = hasBranchScope
            ? `SELECT
                COUNT(*) AS payment_count,
                COALESCE(UNIX_TIMESTAMP(MAX(COALESCE(recorded_at, CONCAT(date, ' 00:00:00')))), 0) AS payment_latest_ts,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(direction, '')) = 'debit' THEN amount
                        WHEN LOWER(COALESCE(direction, '')) = 'credit' THEN -amount
                        ELSE amount
                    END
                ), 0) AS payment_net_signature
             FROM payment_entries
             WHERE account_number = ?
               AND branch_id = ?`
            : `SELECT
                COUNT(*) AS payment_count,
                COALESCE(UNIX_TIMESTAMP(MAX(COALESCE(recorded_at, CONCAT(date, ' 00:00:00')))), 0) AS payment_latest_ts,
                COALESCE(SUM(
                    CASE
                        WHEN LOWER(COALESCE(direction, '')) = 'debit' THEN amount
                        WHEN LOWER(COALESCE(direction, '')) = 'credit' THEN -amount
                        ELSE amount
                    END
                ), 0) AS payment_net_signature
             FROM payment_entries
             WHERE account_number = ?`;
        const paymentParams = hasBranchScope
            ? [normalizedAccount, normalizedBranchId]
            : [normalizedAccount];
        const [paymentRows] = await query(
            paymentSql,
            paymentParams
        );

        const paymentCount = Math.max(0, Math.trunc(toFiniteNumber(paymentRows?.[0]?.payment_count, 0)));
        const paymentLatestTs = toFiniteNumber(paymentRows?.[0]?.payment_latest_ts, 0);
        const paymentNetSignature = toFiniteNumber(paymentRows?.[0]?.payment_net_signature, 0).toFixed(2);

        return `v1-${customerUpdatedTs}-${paymentCount}-${paymentLatestTs}-${paymentNetSignature}`;
    } catch (error) {
        console.warn('Failed to build statement data token:', error.message || error);
        // Fallback to a per-request token to avoid stale PDF reuse when metadata query fails.
        return `v1-fallback-${Date.now()}`;
    }
};

const buildUniquePdfFilename = (prefix, accountNumber) => {
    const safePrefix = String(prefix || 'statement').replace(/[^0-9a-z_-]/gi, '') || 'statement';
    const safeAccount = String(accountNumber || 'account').replace(/[^0-9a-z_-]/gi, '') || 'account';
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    return `${safePrefix}-${safeAccount}-${uniqueSuffix}.pdf`;
};

const getPdfBrowser = async () => {
    if (pdfBrowser) return pdfBrowser;
    if (pdfBrowserPromise) return pdfBrowserPromise;
    pdfBrowserPromise = (async () => {
        try {
            const browser = await puppeteerModule.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            browser.on('disconnected', () => {
                pdfBrowser = null;
                pdfBrowserPromise = null;
            });
            pdfBrowser = browser;
            return browser;
        } catch (error) {
            pdfBrowser = null;
            pdfBrowserPromise = null;
            throw error;
        }
    })();
    return pdfBrowserPromise;
};

const extractBearerToken = (req) => {
    const header = req.headers.authorization || req.headers.Authorization || '';
    if (!header) return null;
    const match = header.match(/Bearer\s+(.+)/i);
    return match ? match[1] : null;
};

const getStatementContext = async (req, res = null) => {
    const basicUser = getUserFromBasicAuth ? getUserFromBasicAuth(req) : null;
    if (basicUser) return { user: basicUser };
    const user = await getUserFromSession(req);
    if (user) return { user };
    const bearer = extractBearerToken(req);
    if (bearer) {
        const payload = verifyToken(bearer);
        if (payload) {
            const cachedSession = getCachedSession(bearer);
            if (cachedSession) {
                req.upstreamSession = cachedSession;
                const customerMeta = cachedSession.meta?.customer || cachedSession.meta?.user || null;
                if (customerMeta) {
                    return { customer: customerMeta };
                }
            }
        }
    }
    if (getCustomerFromSession) {
        const customer = await getCustomerFromSession(req, res);
        if (customer) return { customer };
    }
    return {};
};

const requireStatementAccess = async (req, res, next) => {
    try {
        const { user, customer } = await getStatementContext(req, res);
        if (!user && !customer) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (user && !isAdminUser(user)) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.user = user;
        req.customer = customer;
        next();
    } catch (error) {
        next(error);
    }
};

// --- Middleware ---
// Trust proxy headers so req.secure and x-forwarded-proto are honored behind Cloudflare
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Basic security headers (avoid CSP for now because the UI uses inline scripts).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    if (IS_PRODUCTION && req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});

// CORS is disabled by default. Set CORS_ORIGINS="https://example.com,https://app.example.com" if needed.
const corsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
if (corsOrigins.length) {
    app.use('/api', cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true);
            if (corsOrigins.includes(origin)) return callback(null, true);
            return callback(null, false);
        },
        credentials: true
    }));
}

// Basic rate limits for auth endpoints to slow brute-force attacks.
const adminLoginLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 25,
    message: 'Too many login attempts. Please try again later.'
});
const customerLoginLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 40,
    message: 'Too many attempts. Please try again later.'
});
const customerProofSubmissionLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 30,
    message: 'Too many payment proof submissions. Please try again later.'
});
const publicApplicationLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 12,
    message: 'Too many application attempts. Please try again later.'
});
const factoryResetLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many factory reset attempts. Please wait before trying again.'
});
const systemBackupLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many backup or restore attempts. Please wait before trying again.'
});
app.use('/api/auth/login', adminLoginLimiter);
app.use('/api/auth/collector-login', adminLoginLimiter);
app.use('/api/auth/technician-login', adminLoginLimiter);
app.use('/api/technician/customer-drafts/auth/login', adminLoginLimiter);
app.use('/api/customers/login', customerLoginLimiter);
app.use('/api/customers/quick-payment', customerLoginLimiter);
app.use('/api/customers/payments/proof', customerProofSubmissionLimiter);
const captureRawRequestBody = (req, _res, buf, encoding) => {
    req.rawBodyBuffer = Buffer.from(buf);
    req.rawBody = buf.toString(encoding || 'utf8');
};
const jsonParser = express.json({
    limit: '6mb',
    verify: captureRawRequestBody
});
app.use(jsonParser); // for parsing application/json
app.use(express.urlencoded({
    extended: true,
    limit: '6mb',
    verify: captureRawRequestBody
})); // for parsing application/x-www-form-urlencoded
app.use('/api', (req, res, next) => {
    if (!systemBackupRouter.isRestoreInProgress?.() || req.path.startsWith('/system-backup/')) {
        return next();
    }
    res.set('Retry-After', '5');
    return res.status(503).json({
        ok: false,
        error: 'A full-system restore is in progress. Record changes are temporarily paused.'
    });
});
app.use('/webhooks/messenger', messengerBotRouter);

// --- Auth Routes ---
app.use('/api/auth', authRouter);
app.use('/api/structure', requireStructureOwnerAccess, structureRouter);
app.get('/api/system-update/status', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required.' });
    }

    try {
        const status = await buildSystemUpdateStatus();
        return res.json({
            ok: true,
            checkedAt: new Date().toISOString(),
            ...status
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        console.error('Failed to load system update status:', error);
        return res.status(statusCode).json({
            ok: false,
            error: error.message || 'Failed to load system update status.'
        });
    }
});
app.post('/api/system-update/check-and-apply', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required.' });
    }

    try {
        const result = await applySystemUpdateIfAvailable();
        return res.json({
            ok: true,
            checkedAt: new Date().toISOString(),
            ...result,
            updateRun: result.updateRun || cloneSystemUpdateRunState()
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        console.error('Failed to apply system update:', error);
        return res.status(statusCode).json({
            ok: false,
            error: error.message || 'Failed to apply system update.',
            updateRun: cloneSystemUpdateRunState()
        });
    }
});

// Hard lock runtime API routes only when the app is explicitly using MySQL.
// JSON file mode is schema-free and persists through data-store.js.
if (!isJsonStorageMode()) {
    app.use('/api', async (req, res, next) => {
        try {
            await assertRelationalReady();
            return next();
        } catch (error) {
            return res.status(503).json({
                ok: false,
                error: 'Relational schema not initialized. Run schema update first.'
            });
        }
    });
}

app.use(IP_BROWSER_PROXY_PREFIX, requireAuth, (req, res) => {
    let targetUrl;
    try {
        targetUrl = parseIpBrowserProxyTarget(req);
    } catch (error) {
        return res.status(error.statusCode || 400).json({ ok: false, error: error.message || 'Invalid browser proxy target.' });
    }

    if (isIpBrowserFaviconTarget(targetUrl)) {
        return res.status(204).end();
    }

    return handleIpBrowserProxyRequest(req, res, targetUrl);
});

app.use((req, res, next) => {
    if (!isIpBrowserAbsoluteProxyCandidate(req)) return next();
    const targetUrl = parseIpBrowserProxyTargetFromReferer(req);
    if (!targetUrl) return next();
    if (isIpBrowserFaviconTarget(targetUrl)) {
        return res.status(204).end();
    }
    return requireAuth(req, res, () => handleIpBrowserProxyRequest(req, res, targetUrl));
});

// Serve uploaded assets (e.g., saved logos)
fs.mkdirSync(PUBLIC_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(LEGACY_UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(PUBLIC_UPLOADS_DIR, { maxAge: '30d', etag: true }));
app.use('/uploads', express.static(LEGACY_UPLOADS_DIR, { maxAge: '30d', etag: true }));

const setStaticAssetCacheHeaders = (res) => {
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
};

app.get('/styles.css', (_req, res) => {
    res.type('text/css');
    setStaticAssetCacheHeaders(res);
    return res.sendFile(path.join(PUBLIC_ROOT, 'styles.css'));
});

app.get('/theme-init.js', (_req, res) => {
    res.type('application/javascript');
    setStaticAssetCacheHeaders(res);
    return res.sendFile(path.join(PUBLIC_ROOT, 'theme-init.js'));
});

app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use('/css', express.static(path.join(PUBLIC_ROOT, 'css'), {
    etag: true,
    setHeaders: setStaticAssetCacheHeaders
}));

app.use('/js', express.static(path.join(PUBLIC_ROOT, 'js'), {
    etag: true,
    setHeaders: setStaticAssetCacheHeaders
}));

app.use('/images', express.static(path.join(PUBLIC_ROOT, 'images'), {
    etag: true,
    setHeaders: setStaticAssetCacheHeaders
}));

app.use('/assets', express.static(path.join(PUBLIC_ROOT, 'assets'), {
    etag: true,
    setHeaders: setStaticAssetCacheHeaders
}));

// Serve root static assets before page guards so CSS/JS never fall through to HTML routes.
app.get(/^\/[^/]+\.(?:css|js|mjs|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|map)$/i, (req, res, next) => {
    const filename = path.basename(req.path);
    const publicPath = path.join(PUBLIC_ROOT, filename);
    const moduleWebPath = MODULE_WEB_ROOTS
        .map((webRoot) => path.join(webRoot, filename))
        .find((candidate) => fs.existsSync(candidate));
    if (fs.existsSync(publicPath)) {
        setStaticAssetCacheHeaders(res);
        return res.sendFile(publicPath);
    }
    if (moduleWebPath) {
        setStaticAssetCacheHeaders(res);
        return res.sendFile(moduleWebPath);
    }
    return next();
});

// --- Page guard middleware for HTML pages (BEFORE static files) ---
const PROTECTED_PAGES = new Set([
    'index.html',
    'update-download.html',
    'customers.html',
    'customer-archive.html',
    'payments.html',
    'disconnections.html',
    'referrals.html',
    'payment-history.html',
    'payment-breakdown.html',
    'expenses.html',
    'payroll.html',
    'gcash-transaction.html',
    'payment-confirmation-queue.html',
    'payment-confirmation-queue-history.html',
    'customer-draft-queue.html',
    'plans.html',
    'coverage.html',
    'coverage-map.html',
    'coverage-map-app.html',
    'genieacs.html',
    'sms.html',
    'customer-app.html',
    'customer-app-chats.html',
    'customer-app-popup-reminder.html',
    'messenger-reminders.html',
    'customer-portal.html',
    'customer-payment-proof.html',
    'accounts.html',
    'temp.html',
    'thermal-print.html',
    'billing-statement.html',
    'account-statement.html',
    'monthly-collection-trend.html',
    'collectors.html',
    'collectors-history.html',
    'pppoe.html',
    'pon-management.html',
    'technicians.html',
    'job-history.html',
    'tickets.html'
]);
const CUSTOMER_PAGES = new Set([
    'customer-portal.html',
    'customer-payment-proof.html',
    'billing-statement.html',
    'account-statement.html'
]);


app.use(async (req, res, next) => {
    // Only enforce for GET requests (pages)
    if (req.method !== 'GET') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    const pathname = req.path;

    if (pathname === '/' || pathname === '') {
        return next();
    }

    // Determine which HTML page this request would resolve to. Handle:
    // - explicit .html requests (e.g. /index.html)
    // - root request / -> index.html
    // - pretty routes without extension (e.g. /payments -> payments.html)
    const raw = pathname.split('/').pop();
    let pageToCheck;
    if (pathname === '/' || raw === '') {
        pageToCheck = 'index.html';
    } else if (pathname.endsWith('.html')) {
        pageToCheck = raw;
    } else {
        // map '/payments' -> 'payments.html'
        pageToCheck = `${raw}.html`;
    }

    // Reports page has been deprecated; keep the URL from 404-ing by sending users back home.
    if (pageToCheck === 'reports.html') {
        return res.redirect('/index.html');
    }
    if (!PROTECTED_PAGES.has(pageToCheck)) return next();

    if (pageToCheck === 'customer-app-chats.html') {
        return res.redirect('/customer-app-popup-reminder.html');
    }

    if (pageToCheck === 'coverage-map-app.html') {
        return next();
    }

    if (pageToCheck === 'update-download.html') {
        if (!isLocalhostRequest(req)) {
            return res.status(404).send('Not Found');
        }
        const updateOwner = await getUserFromSession(req);
        if (!isStructureOwnerUser(updateOwner)) {
            return res.status(404).send('Not Found');
        }
        return next();
    }

    const user = await getUserFromSession(req);
    const isAdmin = isAdminUser(user);
    if (isAdmin) {
        return next();
    }

    if (pageToCheck === 'messenger-reminders.html' && user && accountHasRole(user, 'Collector')) {
        return next();
    }

    if (CUSTOMER_PAGES.has(pageToCheck) && getCustomerFromSession) {
        const customer = await getCustomerFromSession(req, res);
        if (customer) {
            return next();
        }
        return res.redirect('/customer-login.html');
    }

    if (user) {
        return res.redirect('/login.html');
    }

    return res.redirect('/login.html');
});

// --- Cache control for dynamic files ---
app.use((req, res, next) => {
    // HTML remains uncached so auth redirects and page shells are always fresh.
    if (req.path.endsWith('.html')) {
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
    }
    next();
});

// Serve module-owned and shared public files (AFTER auth check).
// Keep index disabled so "/" is handled by the explicit route below.
MODULE_WEB_ROOTS.forEach((webRoot) => {
    app.use(express.static(webRoot, { index: false }));
});
app.use(express.static(PUBLIC_ROOT, { index: false }));

// Friendly page routes (optional but helpful)
app.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'company-info.html'));
});
// Serve a fresh login page (avoid caching old JS behavior)
app.get('/login.html', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(ADMIN_WEB_ROOT, 'login.html'));
});
app.get('/customer-login', (_req, res) => {
    return res.redirect('/customer-login.html');
});
app.get('/customer-login.html', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'customer-login.html'));
});
app.get('/quick-payment', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(BILLING_WEB_ROOT, 'quick-payment.html'));
});
app.get('/public', (_req, res) => {
    return res.redirect('/privacy-terms');
});
app.get('/privacy-terms', (_req, res) => {
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'privacy-terms.html'));
});
app.get('/terms-of-use', (_req, res) => {
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'terms-of-use.html'));
});
app.get('/company-info', (_req, res) => {
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'company-info.html'));
});
app.get('/apply-now', (req, res) => {
    const plan = String(req.query?.plan || '').trim();
    const target = plan ? `/apply-now.html?plan=${encodeURIComponent(plan)}` : '/apply-now.html';
    return res.redirect(target);
});
app.get('/coverage-map-app', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(NETWORK_WEB_ROOT, 'coverage-map-app.html'));
});
// Specific route for index.html to ensure protection
app.get('/index.html', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(PUBLIC_ROOT, 'index.html'));
});
app.get('/payments', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(BILLING_WEB_ROOT, 'payments.html'));
});
app.get('/expenses', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(FINANCE_WEB_ROOT, 'expenses.html'));
});
app.get('/payroll', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(FINANCE_WEB_ROOT, 'payroll.html'));
});
const XENDIT_RETURN_TARGET_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const parseXenditReturnTarget = (value) => {
    const rawValue = String(value || '').trim();
    return XENDIT_RETURN_TARGET_PATTERN.test(rawValue) ? rawValue : '';
};
const receiptText = (value) => String(value ?? '').trim();
const normalizeReceiptAccountNumber = (value) => {
    const raw = receiptText(value);
    const digits = raw.replace(/\D+/g, '');
    return digits || raw;
};
const extractReceiptAccountFromIdentifier = (value) => {
    const normalized = receiptText(value);
    if (!normalized) return '';
    if (/^\d{5,20}$/.test(normalized)) return normalized;
    const tagged = normalized.match(/^(?:acct|cust)-(.+)$/i);
    if (tagged && tagged[1]) {
        const firstToken = String(tagged[1]).split('-')[0].trim();
        if (firstToken) return firstToken;
    }
    const numericFallback = normalized.match(/\d{5,20}/);
    return numericFallback?.[0] || '';
};
const extractReceiptReferenceFromIdentifier = (value) => {
    const normalized = receiptText(value);
    if (!normalized) return '';
    const tagged = normalized.match(/^(?:acct|cust)-([^-]+)-(.+)$/i);
    if (!tagged || !tagged[2]) return normalized;
    const trailingToken = String(tagged[2]).split('-').filter(Boolean).pop();
    return receiptText(trailingToken || tagged[2]);
};
const normalizeReceiptAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : 0;
};
const normalizeReceiptMethodLabel = (value) => {
    const raw = receiptText(value);
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const labels = {
        gcash: 'GCash',
        phgcash: 'GCash',
        grab: 'GrabPay',
        grabpay: 'GrabPay',
        phgrabpay: 'GrabPay',
        shopee: 'ShopeePay',
        shopeepay: 'ShopeePay',
        phshopeepay: 'ShopeePay',
        maya: 'Maya',
        paymaya: 'Maya',
        phpaymaya: 'Maya',
        xendit: 'Xendit'
    };
    return labels[key] || raw || 'Online Payment';
};
const normalizeReceiptDateTime = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    const raw = receiptText(value);
    if (!raw) return new Date().toISOString();
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
};
const buildReceiptCustomerName = (row = {}, fallback = '') => {
    const name = toCustomerDisplayName({
        name: row.customerName || row.name,
        firstName: row.firstName,
        lastName: row.lastName,
        accountNumber: row.accountNumber
    });
    if (name && name !== 'Unnamed customer') return name;
    return receiptText(fallback) || 'Customer';
};
const findReceiptCustomer = async (accountNumber) => {
    const account = normalizeReceiptAccountNumber(accountNumber);
    if (!account || !(await isRelationalReady())) return null;
    const [rows] = await query(
        `SELECT
            account_number AS accountNumber,
            branch_id AS branchId,
            name AS customerName,
            first_name AS firstName,
            last_name AS lastName
         FROM customers
         WHERE account_number = ?
         LIMIT 1`,
        [account]
    );
    return Array.isArray(rows) && rows.length ? rows[0] : null;
};
const findReceiptPaymentEntry = async ({ accountNumber = '', reference = '', xenditId = '', amount = 0 } = {}) => {
    if (!(await isRelationalReady())) return null;
    const account = normalizeReceiptAccountNumber(accountNumber);
    const ref = receiptText(reference);
    const xendit = receiptText(xenditId);
    const amountValue = normalizeReceiptAmount(amount);
    if (!account && !ref && !xendit) return null;

    const conditions = [
        "LOWER(COALESCE(pe.kind, '')) = 'payment'",
        "LOWER(COALESCE(pe.direction, 'credit')) = 'credit'"
    ];
    const params = [];
    if (account) {
        conditions.push('pe.account_number = ?');
        params.push(account);
    }
    if (ref) {
        conditions.push('(pe.reference = ? OR pe.or_number = ? OR pe.id = ? OR pe.xendit_id = ?)');
        params.push(ref, ref, ref, ref);
    } else if (xendit) {
        conditions.push('pe.xendit_id = ?');
        params.push(xendit);
    } else if (account && amountValue > 0) {
        conditions.push('ABS(pe.amount - ?) < 0.01');
        params.push(amountValue);
    }

    const [rows] = await query(
        `SELECT
            pe.id,
            pe.branch_id AS branchId,
            pe.account_number AS accountNumber,
            pe.amount,
            pe.reference,
            pe.or_number AS orNumber,
            pe.description,
            pe.recorded_at AS recordedAt,
            pe.payer,
            pe.status,
            pe.payment_method AS paymentMethod,
            pe.xendit_id AS xenditId,
            c.name AS customerName,
            c.first_name AS firstName,
            c.last_name AS lastName
         FROM payment_entries pe
         LEFT JOIN customers c
           ON c.account_number = pe.account_number
          AND c.branch_id = pe.branch_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY pe.recorded_at DESC, pe.date DESC
         LIMIT 1`,
        params
    );
    return Array.isArray(rows) && rows.length ? rows[0] : null;
};
const buildPaymentReceiptPayload = async (req) => {
    const xenditIdentifier = receiptText(
        req.query.external_id || req.query.externalId || req.query.reference_id || req.query.referenceId || ''
    );
    const accountNumber = normalizeReceiptAccountNumber(
        req.query.accountNumber || req.query.account || req.query.customer || ''
    ) || extractReceiptAccountFromIdentifier(xenditIdentifier);
    const reference = receiptText(req.query.reference || req.query.ref || req.query.receipt || '')
        || extractReceiptReferenceFromIdentifier(xenditIdentifier);
    const xenditId = receiptText(req.query.xenditId || req.query.xendit_id || req.query.id || '');
    const amount = normalizeReceiptAmount(req.query.amount);
    const method = receiptText(req.query.method || req.query.paymentMethod || '');
    const description = receiptText(req.query.description || req.query.for || req.query.paymentFor || '');
    const paidBy = receiptText(req.query.paidBy || req.query.payer || '');

    const entry = await findReceiptPaymentEntry({ accountNumber, reference, xenditId, amount });
    const customer = entry ? null : await findReceiptCustomer(accountNumber);
    const branchId = Number(entry?.branchId || customer?.branchId || 0) || null;
    const profile = typeof businessProfileRouter.readProfile === 'function'
        ? await businessProfileRouter.readProfile(branchId).catch(() => ({}))
        : {};
    const businessName = receiptText(profile?.businessName) || 'Archie Fiber';
    const resolvedAccount = receiptText(entry?.accountNumber || customer?.accountNumber || accountNumber);
    const resolvedReference = receiptText(entry?.orNumber || entry?.reference || reference || entry?.id || xenditId);
    const resolvedDescription = receiptText(entry?.description || description)
        || (resolvedAccount ? `Internet payment for account ${resolvedAccount}` : 'Internet payment');

    return {
        status: 'paid',
        verified: Boolean(entry),
        businessName,
        amountPaid: normalizeReceiptAmount(entry?.amount ?? amount),
        paidBy: buildReceiptCustomerName(entry || customer || { accountNumber: resolvedAccount }, paidBy || entry?.payer),
        accountNumber: resolvedAccount,
        paymentFor: resolvedDescription,
        paymentMethod: normalizeReceiptMethodLabel(entry?.paymentMethod || method),
        referenceNumber: resolvedReference || 'Processing',
        dateTime: normalizeReceiptDateTime(entry?.recordedAt || req.query.dateTime || req.query.paidAt || new Date()),
        receivedBy: businessName,
        target: parseXenditReturnTarget(req.query.target)
    };
};
const renderXenditReturnPage = (res, options = {}) => {
    const status = String(options.status || '').trim().toLowerCase() === 'paid' ? 'paid' : 'failed';
    const target = parseXenditReturnTarget(options.target);
    const pageTitle = status === 'paid' ? 'Payment complete' : 'Payment failed';
    const headingText = status === 'paid' ? 'Payment complete' : 'Payment failed';

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.type('html');
    return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${pageTitle}</title>
  <style>
    body { margin:0; font-family: Arial, sans-serif; background:#0f172a; color:#e2e8f0; }
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { max-width:420px; width:100%; background:#111827; border:1px solid #1f2937; border-radius:12px; padding:20px; text-align:center; }
    h1 { margin:0 0 8px; font-size:18px; }
    p { margin:0; color:#cbd5e1; font-size:14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${headingText}</h1>
      <p id="statusText">Finalizing payment status.</p>
      <p id="manualOpenWrap" style="display:none; margin-top:12px;">
        <a id="manualOpenLink" href="#" style="color:#93c5fd; text-decoration:none; font-weight:600;">Open app</a>
      </p>
    </div>
  </div>
  <script>
    (function () {
      const status = ${JSON.stringify(status)};
      const target = ${JSON.stringify(target)};
      const statusText = document.getElementById('statusText');
      const manualOpenWrap = document.getElementById('manualOpenWrap');
      const manualOpenLink = document.getElementById('manualOpenLink');
      if (target) {
        if (manualOpenLink) {
          manualOpenLink.setAttribute('href', target);
        }
        if (manualOpenWrap) manualOpenWrap.style.display = 'block';
        if (statusText) {
          statusText.textContent = status === 'paid'
            ? 'Payment recorded. Tap Open app to continue.'
            : 'Payment failed or was canceled. Tap Open app to retry.';
        }
        return;
      }
      if (statusText) {
        statusText.textContent = status === 'paid'
          ? 'Payment recorded. You can now close this page.'
          : 'Payment failed or was canceled. You can close this page and try again.';
      }
    })();
  </script>
</body>
</html>`);
};
app.get('/api/payment-receipt', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        const receipt = await buildPaymentReceiptPayload(req);
        return res.json({ ok: true, receipt });
    } catch (error) {
        next(error);
    }
});
app.get('/payment/success', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(BILLING_WEB_ROOT, 'payment-receipt.html'));
});
app.get('/payment-receipt', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(path.join(BILLING_WEB_ROOT, 'payment-receipt.html'));
});
app.get('/payment/failed', (req, res) => {
    return renderXenditReturnPage(res, {
        status: 'failed',
        target: req.query.target
    });
});
app.get('/xendit-return', (req, res) => {
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const status = rawStatus === 'paid' ? 'paid' : 'failed';
    const redirectPath = status === 'paid' ? '/payment/success' : '/payment/failed';
    const params = new URLSearchParams();
    Object.entries(req.query || {}).forEach(([key, value]) => {
        if (key === 'status') return;
        if (Array.isArray(value)) {
            value.forEach((item) => params.append(key, String(item)));
            return;
        }
        if (value !== undefined && value !== null) params.set(key, String(value));
    });
    const queryString = params.toString();
    return res.redirect(302, `${redirectPath}${queryString ? `?${queryString}` : ''}`);
});
app.get([
    '/payment-confirmation-queue',
    '/payment-confirmation-queue.html',
    '/payment-confirmation-queue-history',
    '/payment-confirmation-queue-history.html'
], async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    return res.redirect(302, '/gcash-transaction.html');
});
app.get('/gcash-transaction', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    return res.sendFile(path.join(BILLING_WEB_ROOT, 'gcash-transaction.html'));
});
app.get('/customer-draft-queue', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    return res.sendFile(path.join(CUSTOMER_MANAGEMENT_WEB_ROOT, 'customer-draft-queue.html'));
});
app.get('/customer-archive', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    return res.sendFile(path.join(CUSTOMER_MANAGEMENT_WEB_ROOT, 'customer-archive.html'));
});
app.get('/technician-customer-drafts', (_req, res) => {
    return res.sendFile(path.join(TECHNICIAN_WEB_ROOT, 'technician-customer-drafts.html'));
});
app.get('/update-download', requireStructureOwnerAccess, async (req, res) => {
    res.sendFile(path.join(ADMIN_WEB_ROOT, 'update-download.html'));
});
app.get('/tickets', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(TECHNICIAN_WEB_ROOT, 'tickets.html'));
});
app.get('/customer-app', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.redirect('/customer-app-popup-reminder.html');
});
app.get('/customer-app-chats', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.redirect('/customer-app-popup-reminder.html');
});
app.get('/customer-app-popup-reminder', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'customer-app-popup-reminder.html'));
});
app.get('/messenger-reminders', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!user || (!isAdminUser(user) && !accountHasRole(user, 'Collector'))) {
        return res.redirect('/login.html');
    }
    return res.sendFile(path.join(CUSTOMER_APP_WEB_ROOT, 'messenger-reminders.html'));
});

app.get('/collectors', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(COLLECTOR_WEB_ROOT, 'collectors.html'));
});
app.get('/collectors-history', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(COLLECTOR_WEB_ROOT, 'collectors-history.html'));
});
app.get('/pppoe', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(NETWORK_WEB_ROOT, 'pppoe.html'));
});
app.get('/genieacs', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(NETWORK_WEB_ROOT, 'genieacs.html'));
});
app.get('/pon-management', async (req, res) => {
    const user = await getUserFromSession(req);
    if (!isAdminUser(user)) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(NETWORK_WEB_ROOT, 'pon-management.html'));
});

// --- API Routes ---
const sanitizeGenieacsHost = (value = '') => String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .trim();

const normalizeGenieacsPort = (value, fallback = '7557') => {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? String(parsed) : fallback;
};

const normalizeGenieacsProtocol = (value) => {
    const protocol = String(value || '').trim().toLowerCase();
    return protocol === 'https' ? 'https' : 'http';
};

const buildGenieacsNbiUrl = (settings = {}, pathName = '/devices') => {
    const host = sanitizeGenieacsHost(settings.host);
    if (!host) return '';
    const port = normalizeGenieacsPort(settings.nbiPort, '7557');
    const protocol = normalizeGenieacsProtocol(settings.protocol);
    const cleanPath = String(pathName || '/devices').startsWith('/')
        ? String(pathName || '/devices')
        : `/${pathName}`;
    return `${protocol}://${host}:${port}${cleanPath}`;
};

const GENIEACS_BINDINGS_STORE_PREFIX = 'genieacs_customer_bindings';
const GENIEACS_SNAPSHOT_STORE_PREFIX = 'genieacs_device_snapshot';
const GENIEACS_BACKGROUND_REFRESH_MS = parsePositiveInteger(
    process.env.GENIEACS_BACKGROUND_REFRESH_MS,
    3 * 60 * 1000
);
const GENIEACS_BACKGROUND_SUMMON_LIMIT = parsePositiveInteger(
    process.env.GENIEACS_BACKGROUND_SUMMON_LIMIT,
    250
);
const GENIEACS_BACKGROUND_CONCURRENCY = parsePositiveInteger(
    process.env.GENIEACS_BACKGROUND_CONCURRENCY,
    5
);
const genieacsSnapshots = new Map();
let genieacsRefreshTimer = null;
let genieacsRefreshRunning = false;

const getGenieacsBindingsStoreKey = (branchId) => `${GENIEACS_BINDINGS_STORE_PREFIX}_${Number(branchId) || 0}`;
const getGenieacsSnapshotStoreKey = (branchId) => `${GENIEACS_SNAPSHOT_STORE_PREFIX}_${Number(branchId) || 0}`;

const loadGenieacsCustomerBindings = async (branchId) => {
    const store = await readJson(getGenieacsBindingsStoreKey(branchId), { devices: {} });
    return store && typeof store === 'object' && store.devices && typeof store.devices === 'object'
        ? store
        : { devices: {} };
};

const saveGenieacsCustomerBindings = async (branchId, store) => {
    const safeStore = store && typeof store === 'object' ? store : { devices: {} };
    await writeJson(getGenieacsBindingsStoreKey(branchId), {
        devices: safeStore.devices && typeof safeStore.devices === 'object' ? safeStore.devices : {}
    });
};

const normalizeGenieacsMikrotikStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['online', 'up', 'active', 'connected'].includes(normalized)) return 'online';
    if (['offline', 'down', 'inactive', 'disabled', 'disconnected'].includes(normalized)) return 'offline';
    return '';
};

const normalizeGenieacsPppoeUsernameKey = (value) => String(value || '').trim().toLowerCase();

const buildGenieacsMikrotikStatusLookup = async (branchId) => {
    const [settingsResult, customersResult] = await Promise.allSettled([
        loadIntegrationSettings(branchId || null),
        customersModule.readVisibleCustomers(branchId)
    ]);
    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : {};
    const customers = customersResult.status === 'fulfilled' && Array.isArray(customersResult.value)
        ? customersResult.value
        : [];
    const accounts = Array.isArray(settings?.pppoe?.accounts) ? settings.pppoe.accounts : [];
    const byAccount = new Map();
    const byUsername = new Map();

    accounts.forEach((entry) => {
        const username = String(entry?.username || entry?.name || '').trim();
        const status = normalizeGenieacsMikrotikStatus(entry?.status);
        const accountNumber = String(entry?.customerAccount || entry?.accountNumber || entry?.customerId || '').trim();
        if (username && !byUsername.has(normalizeGenieacsPppoeUsernameKey(username))) {
            byUsername.set(normalizeGenieacsPppoeUsernameKey(username), { username, status });
        }
        if (accountNumber && !byAccount.has(accountNumber)) {
            byAccount.set(accountNumber, { username, status });
        }
    });

    customers.forEach((customer) => {
        const accountNumber = String(customer?.accountNumber || '').trim();
        const username = String(customer?.pppoeUsername || '').trim();
        if (!accountNumber || byAccount.has(accountNumber)) return;
        const status = byUsername.get(normalizeGenieacsPppoeUsernameKey(username))?.status || '';
        byAccount.set(accountNumber, { username, status });
    });

    return {
        getForAccount(accountNumber = '') {
            const account = String(accountNumber || '').trim();
            if (!account) return { bindingStatus: 'unbound', mikrotikStatus: '', pppoeUsername: '' };
            const entry = byAccount.get(account) || null;
            const username = String(entry?.username || '').trim();
            const status = normalizeGenieacsMikrotikStatus(entry?.status);
            return {
                bindingStatus: status === 'online' ? 'online' : 'offline',
                mikrotikStatus: status || 'offline',
                pppoeUsername: username
            };
        }
    };
};

const decodeGenieacsDeviceId = (value = '') => {
    let decoded = String(value || '').trim();
    for (let i = 0; i < 3; i += 1) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
        } catch {
            break;
        }
    }
    return decoded;
};

const getGenieacsDeviceIdCandidates = (...values) => {
    const candidates = [];
    const add = (value) => {
        const text = String(value || '').trim();
        if (text && !candidates.includes(text)) candidates.push(text);
    };
    values.forEach((value) => {
        const raw = String(value || '').trim();
        if (!raw) return;
        add(raw);
        add(decodeGenieacsDeviceId(raw));
        try {
            add(encodeURIComponent(decodeGenieacsDeviceId(raw)));
        } catch {
            // Ignore malformed URI values.
        }
        const decoded = decodeGenieacsDeviceId(raw);
        const parts = decoded.split('-');
        if (parts.length > 3) {
            add(`${parts[0]}-${parts.slice(1).join('%2D')}`);
            add(`${parts[0]}-${parts.slice(1, -1).join('%2D')}-${parts[parts.length - 1]}`);
        }
    });
    return candidates;
};

const findGenieacsCustomerBinding = (bindings = {}, ...values) => {
    const devices = bindings?.devices && typeof bindings.devices === 'object' ? bindings.devices : {};
    const candidates = getGenieacsDeviceIdCandidates(...values);
    for (const candidate of candidates) {
        if (devices[candidate]) return devices[candidate];
    }
    return null;
};

const GENIEACS_WIFI_PARAMETER_PATHS = [
    'InternetGatewayDevice.DeviceInfo.Manufacturer',
    'InternetGatewayDevice.DeviceInfo.ModelName',
    'InternetGatewayDevice.DeviceInfo.ProductClass',
    'InternetGatewayDevice.DeviceInfo.SerialNumber',
    'InternetGatewayDevice.DeviceInfo.SoftwareVersion',
    'InternetGatewayDevice.DeviceInfo.HostName',
    'InternetGatewayDevice.DeviceInfo.Name',
    'InternetGatewayDevice.DeviceInfo.X_HW_HostName',
    'InternetGatewayDevice.DeviceInfo.X_HW_DeviceName',
    'Device.DeviceInfo.Manufacturer',
    'Device.DeviceInfo.ModelName',
    'Device.DeviceInfo.ProductClass',
    'Device.DeviceInfo.SerialNumber',
    'Device.DeviceInfo.SoftwareVersion',
    'Device.DeviceInfo.HostName',
    'Device.DeviceInfo.Name',
    'Device.DeviceInfo.X_HW_HostName',
    'Device.DeviceInfo.X_HW_DeviceName',
    'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
    'Device.ManagementServer.ConnectionRequestURL',
    'InternetGatewayDevice.LANDevice.1.Hosts.',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.',
    'Device.Hosts.',
    'Device.WiFi.',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress',
    'Device.IP.Interface.1.IPv4Address.1.IPAddress',
    'Device.Ethernet.Interface.1.MACAddress',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.UserName',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Name',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower',
    'InternetGatewayDevice.WANDevice.1.X_HW_RxPower',
    'InternetGatewayDevice.WANDevice.1.X_HW_OpticalPower',
    'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_RxPower',
    'Device.Optical.Interface.1.RXPower',
    'Device.XPON.Interface.1.RXPower',
    'Device.XPON.Interface.1.Stats.RXPower',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.TotalAssociations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.TotalAssociations',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.TotalAssociations',
    'Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries',
    'Device.WiFi.AccessPoint.2.AssociatedDeviceNumberOfEntries',
    'Device.WiFi.AccessPoint.5.AssociatedDeviceNumberOfEntries',
    'Device.WiFi.AccessPoint.6.AssociatedDeviceNumberOfEntries',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_WPAKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_CT-COM_Password',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_HW_PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_HW_WPAKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_CT-COM_Password',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_WPAKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_CT-COM_Password',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.SSID',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.PreSharedKey.1.KeyPassphrase',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.PreSharedKey.1.PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_HW_PreSharedKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_HW_WPAKey',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.X_CT-COM_Password',
    'Device.WiFi.SSID.1.SSID',
    'Device.WiFi.SSID.2.SSID',
    'Device.WiFi.SSID.5.SSID',
    'Device.WiFi.SSID.6.SSID',
    'Device.WiFi.AccessPoint.1.Security.KeyPassphrase',
    'Device.WiFi.AccessPoint.1.Security.PreSharedKey',
    'Device.WiFi.AccessPoint.2.Security.KeyPassphrase',
    'Device.WiFi.AccessPoint.2.Security.PreSharedKey',
    'Device.WiFi.AccessPoint.5.Security.KeyPassphrase',
    'Device.WiFi.AccessPoint.5.Security.PreSharedKey',
    'Device.WiFi.AccessPoint.6.Security.KeyPassphrase',
    'Device.WiFi.AccessPoint.6.Security.PreSharedKey'
];

const unwrapGenieacsValue = (value) => {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_value')) {
        return value._value;
    }
    return value;
};

const toGenieacsDisplayText = (value) => {
    let cursor = value;
    const seen = new Set();
    while (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, '_value')) {
        if (seen.has(cursor)) return '';
        seen.add(cursor);
        cursor = cursor._value;
    }
    if (cursor == null) return '';
    if (cursor instanceof Date) return cursor.toISOString();
    if (typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean') {
        return String(cursor).trim();
    }
    return '';
};

const collectGenieacsValueIndex = (source = {}) => {
    const index = new Map();
    const timestamps = new Map();
    const visit = (value, pathParts = []) => {
        if (value == null) return;
        const path = pathParts.join('.');
        const unwrapped = unwrapGenieacsValue(value);
        if (unwrapped !== value) {
            const text = toGenieacsDisplayText(unwrapped);
            if (text && path) index.set(path.toLowerCase(), text);
            const timestamp = toGenieacsDisplayText(value?._timestamp);
            if (timestamp && path) timestamps.set(path.toLowerCase(), timestamp);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((entry, idx) => visit(entry, [...pathParts, String(idx)]));
            return;
        }
        if (typeof value === 'object') {
            Object.entries(value).forEach(([key, child]) => {
                visit(child, [...pathParts, key]);
            });
            return;
        }
        const text = toGenieacsDisplayText(value);
        if (text && path) index.set(path.toLowerCase(), text);
    };
    visit(source, []);
    index._timestamps = timestamps;
    return index;
};

const isFreshGenieacsTimestamp = (timestamp, maxAgeMs = 10 * 60 * 1000) => {
    const raw = String(timestamp || '').trim();
    if (!raw) return false;
    const parsed = new Date(raw);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) return false;
    const age = Date.now() - time;
    return age >= -60 * 1000 && age <= maxAgeMs;
};

const isGenieacsOnlineStatus = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'up', 'online', 'active', 'authenticated', 'associated'].includes(text);
};

const isGenieacsOnlineStatusFresh = (value, timestamp = '') => {
    if (!isGenieacsOnlineStatus(value)) return false;
    const rawTimestamp = String(timestamp || '').trim();
    return !rawTimestamp || isFreshGenieacsTimestamp(rawTimestamp);
};

const readGenieacsValue = (source, pathOptions = [], valueIndex = null) => {
    if (!source || typeof source !== 'object') return '';
    for (const pathOption of pathOptions) {
        const parts = Array.isArray(pathOption) ? pathOption : String(pathOption || '').split('.');
        let cursor = source;
        for (const part of parts) {
            if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
                cursor = undefined;
                break;
            }
            cursor = cursor[part];
        }
        cursor = unwrapGenieacsValue(cursor);
        const value = toGenieacsDisplayText(cursor);
        if (value) return value;
    }
    if (valueIndex instanceof Map) {
        for (const pathOption of pathOptions) {
            const candidate = (Array.isArray(pathOption) ? pathOption.join('.') : String(pathOption || '')).toLowerCase();
            if (!candidate) continue;
            const exact = valueIndex.get(candidate);
            if (exact) return exact;
            const suffix = `.${candidate}`;
            for (const [key, value] of valueIndex.entries()) {
                if (key.endsWith(suffix) || key.endsWith(candidate)) {
                    return value;
                }
            }
        }
    }
    return '';
};

const readGenieacsWifiPassword = (valueIndex, indexes = []) => {
    if (!(valueIndex instanceof Map)) return '';
    const normalizedIndexes = indexes.map((idx) => String(idx || '').trim()).filter(Boolean);
    const passwordTokens = [
        'keypassphrase',
        'presharedkey',
        'pre_shared_key',
        'password',
        'wpakey',
        'wpa_key',
        'wepkey',
        'wep_key',
        'x_hw_presharedkey',
        'x_hw_wpakey',
        'x_ct-com_password',
        'x_ctcom_password',
        'x_zte-com_password',
        'x_zte_password',
        'x_gpon_password',
        'x_cu_wpakey'
    ];
    const keyHasIndexScope = (key, idx) => {
        const patterns = [
            `.wlanconfiguration.${idx}.`,
            `.wifi.ssid.${idx}.`,
            `.wifi.accesspoint.${idx}.`,
            `.accesspoint.${idx}.`,
            `.wlanssid.${idx}.`
        ];
        return patterns.some((pattern) => key.includes(pattern));
    };
    const keyLooksLikePassword = (key) => {
        const tail = key.split('.').pop() || '';
        return passwordTokens.some((token) => tail === token || key.endsWith(`.${token}`));
    };
    for (const idx of normalizedIndexes) {
        for (const [key, value] of valueIndex.entries()) {
            if (keyHasIndexScope(key, idx) && keyLooksLikePassword(key) && value) {
                return value;
            }
        }
    }
    return '';
};

const normalizeGenieacsModelKey = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

const getGenieacsWifiBandIndexes = (model) => {
    const modelKey = normalizeGenieacsModelKey(model);
    if (modelKey.includes('m2-2050-g40')) {
        return { wifi24: ['6'], wifi5: ['1'] };
    }
    if (modelKey.includes('eg8145v5')) {
        return { wifi24: ['1'], wifi5: ['5'] };
    }
    return { wifi24: ['6'], wifi5: ['1', '2', '5'] };
};

const buildGenieacsWifiSsidPaths = (indexes = [], includeGenericFallback = false) => {
    const paths = [];
    indexes.forEach((idx) => {
        paths.push(
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'SSID'],
            ['Device', 'WiFi', 'SSID', idx, 'SSID'],
            `WLANConfiguration.${idx}.SSID`,
            `WiFi.SSID.${idx}.SSID`,
            `SSID.${idx}.SSID`
        );
    });
    if (includeGenericFallback) paths.push('SSID');
    return paths;
};

const buildGenieacsWifiPasswordPaths = (indexes = []) => {
    const paths = [];
    indexes.forEach((idx) => {
        paths.push(
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'KeyPassphrase'],
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'PreSharedKey', '1', 'KeyPassphrase'],
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'PreSharedKey', '1', 'PreSharedKey'],
            ['Device', 'WiFi', 'AccessPoint', idx, 'Security', 'KeyPassphrase'],
            ['Device', 'WiFi', 'AccessPoint', idx, 'Security', 'PreSharedKey'],
            `WLANConfiguration.${idx}.KeyPassphrase`,
            `WLANConfiguration.${idx}.PreSharedKey.1.KeyPassphrase`,
            `WLANConfiguration.${idx}.PreSharedKey.1.PreSharedKey`,
            `WiFi.AccessPoint.${idx}.Security.KeyPassphrase`,
            `WiFi.AccessPoint.${idx}.Security.PreSharedKey`
        );
    });
    return paths;
};

const GENIEACS_WIFI_CONFIG_PATHS = {
    '2.4G': [
        {
            index: '6',
            ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.SSID',
            password: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.KeyPassphrase'
        },
        {
            index: '1',
            ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
            password: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase'
        },
        {
            index: '6',
            ssid: 'Device.WiFi.SSID.6.SSID',
            password: 'Device.WiFi.AccessPoint.6.Security.KeyPassphrase'
        },
        {
            index: '1',
            ssid: 'Device.WiFi.SSID.1.SSID',
            password: 'Device.WiFi.AccessPoint.1.Security.KeyPassphrase'
        }
    ],
    '5G': [
        {
            index: '5',
            ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
            password: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase'
        },
        {
            index: '2',
            ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID',
            password: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase'
        },
        {
            index: '1',
            ssid: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
            password: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase'
        },
        {
            index: '5',
            ssid: 'Device.WiFi.SSID.5.SSID',
            password: 'Device.WiFi.AccessPoint.5.Security.KeyPassphrase'
        },
        {
            index: '2',
            ssid: 'Device.WiFi.SSID.2.SSID',
            password: 'Device.WiFi.AccessPoint.2.Security.KeyPassphrase'
        },
        {
            index: '1',
            ssid: 'Device.WiFi.SSID.1.SSID',
            password: 'Device.WiFi.AccessPoint.1.Security.KeyPassphrase'
        }
    ]
};

const getGenieacsIndexedPath = (valueIndex, pathOptions = [], currentValue = '') => {
    if (!(valueIndex instanceof Map)) return pathOptions[0] || null;
    const normalizedCurrent = String(currentValue || '').trim();
    if (normalizedCurrent) {
        const matched = pathOptions.find((option) => {
            const value = valueIndex.get(String(option.ssid || '').toLowerCase());
            return value && String(value).trim() === normalizedCurrent;
        });
        if (matched) return matched;
    }
    return pathOptions.find((option) => valueIndex.has(String(option.ssid || '').toLowerCase())) || pathOptions[0] || null;
};

const readGenieacsWifiOnlineCount = (device, valueIndex, indexes = []) => {
    const normalizedIndexes = indexes.map((idx) => String(idx || '').trim()).filter(Boolean);
    const directPathOptions = [];
    normalizedIndexes.forEach((idx) => {
        directPathOptions.push(
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'AssociatedDeviceNumberOfEntries'],
            ['InternetGatewayDevice', 'LANDevice', '1', 'WLANConfiguration', idx, 'TotalAssociations'],
            ['Device', 'WiFi', 'AccessPoint', idx, 'AssociatedDeviceNumberOfEntries'],
            `WLANConfiguration.${idx}.AssociatedDeviceNumberOfEntries`,
            `WLANConfiguration.${idx}.TotalAssociations`,
            `WiFi.AccessPoint.${idx}.AssociatedDeviceNumberOfEntries`
        );
    });
    const countCandidates = [];
    if (!(valueIndex instanceof Map)) return null;
    const timestamps = valueIndex._timestamps instanceof Map ? valueIndex._timestamps : new Map();
    directPathOptions.forEach((pathOption) => {
        const rawCount = readGenieacsValue(device, [pathOption], valueIndex);
        const parsed = Number(rawCount);
        if (Number.isFinite(parsed) && parsed >= 0) {
            countCandidates.push(Math.trunc(parsed));
        }
    });

    const keyHasIndexScope = (key, idx) => [
        `.wlanconfiguration.${idx}.associateddevice.`,
        `.wifi.accesspoint.${idx}.associateddevice.`
    ].some((pattern) => key.includes(pattern));

    for (const idx of normalizedIndexes) {
        const activeEntries = new Map();
        for (const [key, value] of valueIndex.entries()) {
            if (!keyHasIndexScope(key, idx)) continue;
            const match = key.match(/associateddevice\.(\d+)\./);
            const entryId = match?.[1] || '';
            if (!entryId) continue;
            if (key.endsWith('.active')) {
                activeEntries.set(entryId, isGenieacsOnlineStatusFresh(value, timestamps.get(key) || ''));
            }
        }
        const activeCount = Array.from(activeEntries.values()).filter(Boolean).length;
        countCandidates.push(activeCount);
    }
    return countCandidates.length ? Math.max(...countCandidates) : null;
};

const readGenieacsOpticalPower = (device, valueIndex) => {
    const directValue = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'WANDevice', '1', 'X_CT-COM_EponInterfaceConfig', 'RXPower'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'X_CT-COM_GponInterfaceConfig', 'RXPower'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'X_HW_RxPower'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'X_HW_OpticalPower'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'X_ZTE-COM_RxPower'],
        ['Device', 'Optical', 'Interface', '1', 'RXPower'],
        ['Device', 'XPON', 'Interface', '1', 'RXPower'],
        ['Device', 'XPON', 'Interface', '1', 'Stats', 'RXPower'],
        'RXPower',
        'RxPower',
        'OpticalPower',
        'ReceivePower'
    ], valueIndex);
    if (directValue) return directValue;
    if (!(valueIndex instanceof Map)) return '';

    const keyLooksOptical = (key) => (
        key.includes('rxpower')
        || key.includes('receivepower')
        || key.includes('receivedpower')
        || key.includes('opticalpower')
        || key.includes('optical.power')
    );
    const valueLooksOptical = (value) => {
        const text = String(value || '').trim();
        if (!text) return false;
        if (/dbm/i.test(text)) return true;
        const parsed = Number(text);
        return Number.isFinite(parsed) && parsed < 10 && parsed > -80;
    };

    for (const [key, value] of valueIndex.entries()) {
        if (keyLooksOptical(key) && valueLooksOptical(value)) {
            return value;
        }
    }
    return '';
};

const readGenieacsAssociatedDevices = (valueIndex, indexes = []) => {
    if (!(valueIndex instanceof Map)) return [];
    const timestamps = valueIndex._timestamps instanceof Map ? valueIndex._timestamps : new Map();
    const normalizedIndexes = indexes.map((idx) => String(idx || '').trim()).filter(Boolean);
    const results = [];
    const seen = new Set();
    const keyHasIndexScope = (key, idx) => [
        `.wlanconfiguration.${idx}.associateddevice.`,
        `.wifi.accesspoint.${idx}.associateddevice.`
    ].some((pattern) => key.includes(pattern));

    normalizedIndexes.forEach((idx) => {
        const entries = new Map();
        for (const [key, value] of valueIndex.entries()) {
            if (!keyHasIndexScope(key, idx)) continue;
            const match = key.match(/associateddevice\.(\d+)\.([^.]+)$/);
            if (!match) continue;
            const entryId = match[1];
            const field = match[2].toLowerCase();
            if (!entries.has(entryId)) entries.set(entryId, {});
            const entry = entries.get(entryId);
            if (field === 'macaddress' || field === 'associateddevicemacaddress' || field === 'associateddeviceaddress') entry.macAddress = value;
            if (field === 'hostname' || field === 'host' || field === 'name' || field === 'alias' || field === 'associateddevicehostname' || field === 'x_hw_hostname') entry.hostname = value;
            if (field === 'ipaddress' || field === 'associateddeviceipaddress') entry.ipAddress = value;
            if (field === 'active' || field === 'associateddeviceactive' || field === 'associateddeviceauthenticationstate') entry.active = value;
            if (field === 'active' || field === 'associateddeviceactive' || field === 'associateddeviceauthenticationstate') entry.activeTimestamp = timestamps.get(key) || '';
            if (field === 'signalstrength' || field === 'rssi') entry.signal = value;
            if (field === 'lastdatadownlinkrate') entry.downlinkRate = value;
            if (field === 'lastdatauplinkrate') entry.uplinkRate = value;
        }
        Array.from(entries.values()).forEach((entry) => {
            const macAddress = String(entry.macAddress || '').trim();
            const hostname = String(entry.hostname || '').trim();
            if (!macAddress && !hostname) return;
            const key = `${idx}:${macAddress || hostname}`.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            const online = isGenieacsOnlineStatusFresh(entry.active, entry.activeTimestamp);
            results.push({
                hostname,
                macAddress,
                ipAddress: String(entry.ipAddress || '').trim(),
                online,
                signal: String(entry.signal || '').trim(),
                downlinkRate: String(entry.downlinkRate || '').trim(),
                uplinkRate: String(entry.uplinkRate || '').trim(),
                lastSeen: String(entry.activeTimestamp || '').trim(),
                wlanIndex: idx
            });
        });
    });
    return results;
};

const readGenieacsHostDevices = (valueIndex) => {
    if (!(valueIndex instanceof Map)) return [];
    const timestamps = valueIndex._timestamps instanceof Map ? valueIndex._timestamps : new Map();
    const entries = new Map();
    for (const [key, value] of valueIndex.entries()) {
        const match = key.match(/(?:^|\.)hosts\.host\.(\d+)\.([^.]+)$/);
        if (!match) continue;
        const entryId = match[1];
        const field = match[2].toLowerCase();
        if (!entries.has(entryId)) entries.set(entryId, {});
        const entry = entries.get(entryId);
        if (field === 'hostname' || field === 'host' || field === 'name' || field === 'alias' || field === 'x_hw_hostname') entry.hostname = value;
        if (field === 'physaddress' || field === 'macaddress' || field === 'mac') entry.macAddress = value;
        if (field === 'ipaddress' || field === 'address') entry.ipAddress = value;
        if (field === 'active' || field === 'enable' || field === 'status') entry.active = value;
        if (field === 'active' || field === 'enable' || field === 'status') entry.activeTimestamp = timestamps.get(key) || '';
        if (field === 'interfacetype') entry.interfaceType = value;
        if (field === 'layer2interface') entry.layer2Interface = value;
        if (field === 'layer1interface' || field === 'layer2interface' || field === 'layer3interface') entry.interfacePath = value;
        if (field === 'addresssource') entry.addressSource = value;
    }

    const seen = new Set();
    return Array.from(entries.values()).map((entry) => {
        const macAddress = String(entry.macAddress || '').trim();
        const hostname = String(entry.hostname || '').trim();
        const ipAddress = String(entry.ipAddress || '').trim();
        if (!macAddress && !hostname && !ipAddress) return null;
        const online = String(entry.active ?? '').trim()
            ? isGenieacsOnlineStatusFresh(entry.active, entry.activeTimestamp)
            : false;
        const key = `${macAddress || ipAddress || hostname}`.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);
        return {
            hostname,
            macAddress,
            ipAddress,
            online,
            signal: '',
            interfaceType: String(entry.interfaceType || '').trim(),
            layer2Interface: String(entry.layer2Interface || '').trim(),
            interfacePath: String(entry.interfacePath || '').trim(),
            addressSource: String(entry.addressSource || '').trim(),
            lastSeen: String(entry.activeTimestamp || '').trim()
        };
    }).filter(Boolean);
};

const normalizeGenieacsDevice = (device = {}) => {
    const valueIndex = collectGenieacsValueIndex(device);
    const id = String(device?._id || '').trim();
    const serialNumber = readGenieacsValue(device, [
        ['DeviceID', 'SerialNumber'],
        ['DeviceID', '_SerialNumber'],
        ['InternetGatewayDevice', 'DeviceInfo', 'SerialNumber'],
        ['Device', 'DeviceInfo', 'SerialNumber'],
        'SerialNumber'
    ], valueIndex);
    const manufacturer = readGenieacsValue(device, [
        ['DeviceID', 'Manufacturer'],
        ['DeviceID', '_Manufacturer'],
        ['InternetGatewayDevice', 'DeviceInfo', 'Manufacturer'],
        ['Device', 'DeviceInfo', 'Manufacturer'],
        'Manufacturer'
    ], valueIndex);
    const model = readGenieacsValue(device, [
        ['DeviceID', 'ProductClass'],
        ['DeviceID', '_ProductClass'],
        ['InternetGatewayDevice', 'DeviceInfo', 'ModelName'],
        ['InternetGatewayDevice', 'DeviceInfo', 'ProductClass'],
        ['Device', 'DeviceInfo', 'ModelName'],
        ['Device', 'DeviceInfo', 'ProductClass'],
        'ModelName',
        'ProductClass'
    ], valueIndex);
    const hostname = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'DeviceInfo', 'HostName'],
        ['InternetGatewayDevice', 'DeviceInfo', 'Name'],
        ['InternetGatewayDevice', 'DeviceInfo', 'X_HW_HostName'],
        ['InternetGatewayDevice', 'DeviceInfo', 'X_HW_DeviceName'],
        ['Device', 'DeviceInfo', 'HostName'],
        ['Device', 'DeviceInfo', 'Name'],
        ['Device', 'DeviceInfo', 'X_HW_HostName'],
        ['Device', 'DeviceInfo', 'X_HW_DeviceName'],
        'HostName',
        'Hostname',
        'DeviceName',
        'Name'
    ], valueIndex);
    const softwareVersion = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'DeviceInfo', 'SoftwareVersion'],
        ['Device', 'DeviceInfo', 'SoftwareVersion'],
        'SoftwareVersion'
    ], valueIndex);
    const oui = readGenieacsValue(device, [
        ['DeviceID', 'OUI'],
        ['DeviceID', '_OUI'],
        'OUI'
    ], valueIndex);
    const ipAddress = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANIPConnection', '1', 'ExternalIPAddress'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANPPPConnection', '1', 'ExternalIPAddress'],
        ['Device', 'IP', 'Interface', '1', 'IPv4Address', '1', 'IPAddress'],
        'ExternalIPAddress',
        'IPAddress'
    ], valueIndex);
    const macAddress = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANIPConnection', '1', 'MACAddress'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANPPPConnection', '1', 'MACAddress'],
        ['Device', 'Ethernet', 'Interface', '1', 'MACAddress'],
        'MACAddress'
    ], valueIndex);
    const connectionRequestUrl = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'ManagementServer', 'ConnectionRequestURL'],
        ['Device', 'ManagementServer', 'ConnectionRequestURL'],
        'ConnectionRequestURL'
    ], valueIndex);
    const pppoeUsername = readGenieacsValue(device, [
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANPPPConnection', '1', 'Username'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANPPPConnection', '1', 'UserName'],
        ['InternetGatewayDevice', 'WANDevice', '1', 'WANConnectionDevice', '1', 'WANPPPConnection', '1', 'Name'],
        ['Device', 'PPP', 'Interface', '1', 'Username'],
        ['Device', 'PPP', 'Interface', '1', 'UserName'],
        'WANPPPConnection.1.Username',
        'WANPPPConnection.1.UserName',
        'PPP.Interface.1.Username',
        'PPP.Interface.1.UserName'
    ], valueIndex);
    const opticalPower = readGenieacsOpticalPower(device, valueIndex);
    const bandIndexes = getGenieacsWifiBandIndexes(model);
    const ssid24 = readGenieacsValue(device, buildGenieacsWifiSsidPaths(bandIndexes.wifi24, true), valueIndex);
    const ssid5 = readGenieacsValue(device, buildGenieacsWifiSsidPaths(bandIndexes.wifi5), valueIndex);
    const ssid24Password = readGenieacsValue(device, buildGenieacsWifiPasswordPaths(bandIndexes.wifi24), valueIndex)
        || readGenieacsWifiPassword(valueIndex, bandIndexes.wifi24);
    const ssid5Password = readGenieacsValue(device, buildGenieacsWifiPasswordPaths(bandIndexes.wifi5), valueIndex)
        || readGenieacsWifiPassword(valueIndex, bandIndexes.wifi5);
    const wifi24OnlineCount = readGenieacsWifiOnlineCount(device, valueIndex, bandIndexes.wifi24);
    const wifi5OnlineCount = readGenieacsWifiOnlineCount(device, valueIndex, bandIndexes.wifi5);
    let wifi24Clients = readGenieacsAssociatedDevices(valueIndex, bandIndexes.wifi24);
    let wifi5Clients = readGenieacsAssociatedDevices(valueIndex, bandIndexes.wifi5);
    const wifiLanClients = readGenieacsHostDevices(valueIndex);
    const wifiClientIdentity = (client = {}) => {
        const mac = String(client.macAddress || '').trim().toLowerCase();
        if (mac) return `mac:${mac}`;
        const ip = String(client.ipAddress || '').trim().toLowerCase();
        if (ip) return `ip:${ip}`;
        const hostname = String(client.hostname || '').trim().toLowerCase();
        return hostname ? `host:${hostname}` : '';
    };
    const getClientBandFromHostPath = (client = {}) => {
        const text = [
            client.layer2Interface,
            client.interfacePath,
            client.interfaceType
        ].join(' ').toLowerCase();
        const match = text.match(/wlanconfiguration\.(\d+)/);
        if (!match) return '';
        const idx = match[1];
        if (bandIndexes.wifi24.map(String).includes(idx)) return '2.4G';
        if (bandIndexes.wifi5.map(String).includes(idx)) return '5G';
        return '';
    };
    const hostByIdentity = new Map();
    wifiLanClients.forEach((client) => {
        const key = wifiClientIdentity(client);
        if (key) hostByIdentity.set(key, client);
    });
    const applyHostOnlineState = (clients = []) => clients.map((client) => {
        const host = hostByIdentity.get(wifiClientIdentity(client));
        if (!host) return client;
        return {
            ...client,
            hostname: String(client.hostname || host.hostname || '').trim(),
            online: Boolean(host.online),
            lastSeen: String(host.lastSeen || client.lastSeen || '').trim()
        };
    });
    if (wifiLanClients.length) {
        wifi24Clients = applyHostOnlineState(wifi24Clients);
        wifi5Clients = applyHostOnlineState(wifi5Clients);
    }
    const unifiedWifiClients = new Map();
    [...wifi24Clients, ...wifi5Clients, ...wifiLanClients].forEach((client, index) => {
        const key = wifiClientIdentity(client) || `row:${index}`;
        const existing = unifiedWifiClients.get(key);
        unifiedWifiClients.set(key, {
            online: Boolean(existing?.online || client.online)
        });
    });
    const hostOnlineClients = wifiLanClients.filter((client) => client.online);
    const hostOnlineCountByBand = hostOnlineClients.reduce((counts, client) => {
        const band = getClientBandFromHostPath(client);
        if (band === '2.4G') counts.wifi24 += 1;
        if (band === '5G') counts.wifi5 += 1;
        return counts;
    }, { wifi24: 0, wifi5: 0 });
    const shouldPreferHostOnlineCounts = wifiLanClients.length > 0;
    const resolvedWifi24OnlineCount = wifi24Clients.length
        ? wifi24Clients.filter((client) => client.online).length
        : wifi24OnlineCount;
    const resolvedWifi5OnlineCount = wifi5Clients.length
        ? wifi5Clients.filter((client) => client.online).length
        : wifi5OnlineCount;
    const finalWifi24OnlineCount = shouldPreferHostOnlineCounts
        ? hostOnlineCountByBand.wifi24
        : resolvedWifi24OnlineCount;
    const finalWifi5OnlineCount = shouldPreferHostOnlineCounts
        ? hostOnlineCountByBand.wifi5
        : resolvedWifi5OnlineCount;
    const wifiTotalCandidates = [
        [finalWifi24OnlineCount, finalWifi5OnlineCount].some((value) => value != null)
            ? Number(finalWifi24OnlineCount || 0) + Number(finalWifi5OnlineCount || 0)
            : null,
        shouldPreferHostOnlineCounts ? null : Array.from(unifiedWifiClients.values()).filter((client) => client.online).length,
        hostOnlineClients.length
    ].filter((value) => Number.isFinite(value) && value >= 0);
    const wifiTotalOnlineCount = shouldPreferHostOnlineCounts
        ? hostOnlineClients.length
        : (wifiTotalCandidates.length ? Math.max(...wifiTotalCandidates) : null);
    const lastInform = String(device?._lastInform || '').trim();
    const registered = String(device?._registered || '').trim();
    return {
        id,
        serialNumber,
        manufacturer,
        model,
        hostname,
        softwareVersion,
        oui,
        ipAddress,
        macAddress,
        connectionRequestUrl,
        pppoeUsername,
        opticalPower,
        ssid24,
        ssid5,
        ssid24Password,
        ssid5Password,
        wifi24OnlineCount: finalWifi24OnlineCount,
        wifi5OnlineCount: finalWifi5OnlineCount,
        wifiTotalOnlineCount,
        wifi24Clients,
        wifi5Clients,
        wifiLanClients,
        lastInform,
        registered
    };
};

const loadGenieacsSettingsForRequest = async (req) => {
    let allSettings;
    try {
        allSettings = await loadIntegrationSettings(req.user?.branchId || null);
    } catch (error) {
        // Re-throw with proper HTTP status codes
        if (error?.name === 'IntegrationSettingsUnreadableError') {
            const wrappedError = new Error(error.message);
            wrappedError.statusCode = 400;
            wrappedError.configured = false;
            throw wrappedError;
        }
        // Default database/connection errors
        const wrappedError = new Error(error?.message || 'Failed to load integration settings.');
        wrappedError.statusCode = 500;
        wrappedError.configured = false;
        throw wrappedError;
    }
    const settings = allSettings?.genieacs || {};
    const host = sanitizeGenieacsHost(settings.host);
    const username = String(settings.username || '').trim();
    const password = String(settings.password || '');
    const enabled = Boolean(settings.enabled);
    if (!enabled || !host || !username || !password) {
        const error = new Error('GenieACS host, username, password, and enabled state are required.');
        error.statusCode = 400;
        error.configured = false;
        throw error;
    }
    if (typeof fetch !== 'function') {
        const error = new Error('Server fetch API is unavailable.');
        error.statusCode = 500;
        error.configured = true;
        throw error;
    }
    return { settings, username, password };
};

const fetchGenieacsNbi = async (settings, username, password, pathName, timeoutMs = 12000, options = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const url = buildGenieacsNbiUrl(settings, pathName);
    const authToken = Buffer.from(`${username}:${password}`).toString('base64');
    const method = String(options.method || 'GET').trim().toUpperCase() || 'GET';
    const hasBody = options.body !== undefined;
    try {
        const response = await fetch(url, {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Basic ${authToken}`,
                ...(hasBody ? { 'Content-Type': 'application/json' } : {})
            },
            ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
            signal: controller.signal
        });
        const bodyText = await response.text().catch(() => '');
        let parsed = null;
        try {
            parsed = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            parsed = null;
        }
        return { response, parsed };
    } finally {
        clearTimeout(timeoutId);
    }
};

const fetchGenieacsDeviceById = async (settings, username, password, deviceIds = [], timeoutMs = 12000) => {
    const candidates = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    let lastResponse = null;
    for (const candidate of candidates) {
        const id = String(candidate || '').trim();
        if (!id) continue;
        const queryText = encodeURIComponent(JSON.stringify({ _id: id }));
        const { response, parsed } = await fetchGenieacsNbi(settings, username, password, `/devices?query=${queryText}`, timeoutMs);
        lastResponse = response;
        const devices = Array.isArray(parsed) ? parsed : [];
        if (response.ok && devices[0]) {
            return { response, device: devices[0], devices, matchedId: id };
        }
        if (!response.ok) {
            return { response, device: null, devices: [], matchedId: id };
        }
    }
    return { response: lastResponse || { ok: true, status: 200 }, device: null, devices: [], matchedId: '' };
};

const chunkGenieacsParameters = (values = [], chunkSize = 40) => {
    const unique = Array.from(new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
    const chunks = [];
    for (let index = 0; index < unique.length; index += chunkSize) {
        chunks.push(unique.slice(index, index + chunkSize));
    }
    return chunks;
};

const queueGenieacsSummonTasks = async (settings, username, password, deviceId, timeoutMs = 15000) => {
    const encodedDeviceId = encodeURIComponent(deviceId);
    const taskPath = `/devices/${encodedDeviceId}/tasks?connection_request`;
    const objectNames = [
        'InternetGatewayDevice.LANDevice.1.Hosts.',
        'InternetGatewayDevice.LANDevice.1.Hosts',
        'InternetGatewayDevice.LANDevice.1.Hosts.Host.',
        'InternetGatewayDevice.LANDevice.1.Hosts.Host',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice.',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.AssociatedDevice.',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.AssociatedDevice',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice.',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.AssociatedDevice.',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6.AssociatedDevice',
        'Device.Hosts.',
        'Device.Hosts',
        'Device.Hosts.Host.',
        'Device.Hosts.Host',
        'Device.WiFi.',
        'Device.WiFi',
        'Device.WiFi.AccessPoint.1.AssociatedDevice.',
        'Device.WiFi.AccessPoint.1.AssociatedDevice',
        'Device.WiFi.AccessPoint.2.AssociatedDevice.',
        'Device.WiFi.AccessPoint.2.AssociatedDevice',
        'Device.WiFi.AccessPoint.5.AssociatedDevice.',
        'Device.WiFi.AccessPoint.5.AssociatedDevice',
        'Device.WiFi.AccessPoint.6.AssociatedDevice.',
        'Device.WiFi.AccessPoint.6.AssociatedDevice'
    ];
    const parameterBatches = chunkGenieacsParameters(GENIEACS_WIFI_PARAMETER_PATHS);
    const taskResults = [];
    const refreshTasks = await Promise.allSettled(objectNames.map((objectName) => fetchGenieacsNbi(
        settings,
        username,
        password,
        taskPath,
        timeoutMs,
        {
            method: 'POST',
            body: {
                name: 'refreshObject',
                objectName
            }
        }
    ).then(({ response, parsed }) => ({
        type: 'refreshObject',
        objectName,
        status: response.status,
        ok: response.ok,
        task: parsed || null
    }))));
    refreshTasks.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            taskResults.push(result.value);
            return;
        }
        const error = result.reason;
        taskResults.push({
            type: 'refreshObject',
            objectName: objectNames[index],
            status: 0,
            ok: false,
            error: error?.name === 'AbortError' ? 'Refresh timed out.' : (error?.message || 'Refresh failed.')
        });
    });

    const parameterTasks = await Promise.allSettled(parameterBatches.map((parameterNames, index) => fetchGenieacsNbi(
        settings,
        username,
        password,
        taskPath,
        timeoutMs,
        {
            method: 'POST',
            body: {
                name: 'getParameterValues',
                parameterNames
            }
        }
    ).then(({ response, parsed }) => ({
        type: 'getParameterValues',
        batch: index + 1,
        parameterCount: parameterNames.length,
        status: response.status,
        ok: response.ok,
        task: parsed || null
    }))));
    parameterTasks.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            taskResults.push(result.value);
            return;
        }
        const error = result.reason;
        taskResults.push({
            type: 'getParameterValues',
            batch: index + 1,
            parameterCount: parameterBatches[index]?.length || 0,
            status: 0,
            ok: false,
            error: error?.name === 'AbortError' ? 'Parameter refresh timed out.' : (error?.message || 'Parameter refresh failed.')
        });
    });

    const refreshSucceeded = taskResults.some((result) => result.ok);
    return {
        ok: refreshSucceeded,
        failed: refreshSucceeded ? null : taskResults.find((result) => !result.ok),
        tasks: taskResults
    };
};

const queueGenieacsWifiChangeTask = async ({
    settings,
    username,
    password,
    device,
    deviceIdCandidates = [],
    bands = [],
    timeoutMs = 15000
} = {}) => {
    const candidates = Array.isArray(deviceIdCandidates) ? deviceIdCandidates : [deviceIdCandidates];
    const targetDeviceId = candidates.map((value) => String(value || '').trim()).find(Boolean)
        || String(device?._id || '').trim();
    if (!targetDeviceId) {
        const error = new Error('Device ID is required.');
        error.statusCode = 400;
        throw error;
    }

    const requestedBands = (Array.isArray(bands) ? bands : []).filter((band) => (
        band
        && (String(band.ssid || '').trim() || String(band.password || '').trim())
        && GENIEACS_WIFI_CONFIG_PATHS[band.label]
    ));
    if (!requestedBands.length) {
        const error = new Error('Enter at least one WiFi name or password.');
        error.statusCode = 400;
        throw error;
    }
    const invalidPassword = requestedBands.find((band) => {
        const nextPassword = String(band.password || '').trim();
        return nextPassword && nextPassword.length < 8;
    });
    if (invalidPassword) {
        const error = new Error(`${invalidPassword.label} password must be at least 8 characters.`);
        error.statusCode = 400;
        throw error;
    }

    const valueIndex = collectGenieacsValueIndex(device);
    const parameterValues = [];
    const resolved = [];
    requestedBands.forEach((band) => {
        const selected = getGenieacsIndexedPath(
            valueIndex,
            GENIEACS_WIFI_CONFIG_PATHS[band.label],
            String(band.currentSsid || '').trim()
        );
        if (!selected) return;
        const nextSsid = String(band.ssid || '').trim();
        const nextPassword = String(band.password || '').trim();
        if (nextSsid) parameterValues.push([selected.ssid, nextSsid, 'xsd:string']);
        if (nextPassword) parameterValues.push([selected.password, nextPassword, 'xsd:string']);
        resolved.push({
            band: band.label,
            index: selected.index,
            ssidPath: selected.ssid,
            passwordPath: selected.password
        });
    });

    if (!parameterValues.length) {
        const error = new Error('No WiFi parameters could be resolved for this modem.');
        error.statusCode = 400;
        throw error;
    }

    const encodedDeviceId = encodeURIComponent(targetDeviceId);
    const task = await fetchGenieacsNbi(
        settings,
        username,
        password,
        `/devices/${encodedDeviceId}/tasks`,
        timeoutMs,
        {
            method: 'POST',
            body: {
                name: 'setParameterValues',
                parameterValues
            }
        }
    );
    if (!task.response.ok) {
        const error = new Error(`GenieACS returned HTTP ${task.response.status} while changing WiFi settings.`);
        error.statusCode = 502;
        error.status = task.response.status;
        error.task = task.parsed || null;
        throw error;
    }

    const commitObjects = [
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.',
        'Device.WiFi.'
    ];
    const commitResults = await Promise.allSettled(commitObjects.map((objectName) => fetchGenieacsNbi(
        settings,
        username,
        password,
        `/devices/${encodedDeviceId}/tasks?connection_request`,
        8000,
        {
            method: 'POST',
            body: {
                name: 'refreshObject',
                objectName
            }
        }
    ).then(({ response: commitResponse, parsed: commitParsed }) => ({
        objectName,
        status: commitResponse.status,
        ok: commitResponse.ok,
        task: commitParsed || null
    }))));

    return {
        resolved,
        task: task.parsed || null,
        commit: commitResults.map((result, index) => (
            result.status === 'fulfilled'
                ? result.value
                : {
                    objectName: commitObjects[index],
                    status: 0,
                    ok: false,
                    error: result.reason?.name === 'AbortError' ? 'Refresh timed out.' : (result.reason?.message || 'Refresh failed.')
                }
        ))
    };
};

const isGenieacsTaskTimeoutError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || error?.statusCode);
    return error?.name === 'AbortError'
        || status === 408
        || status === 504
        || message.includes('timed out')
        || message.includes('timeout');
};

const buildGenieacsDeviceSnapshot = async (branchId, options = {}) => {
    const normalizedBranchId = Number(branchId) || 1;
    const { settings, username, password } = await loadGenieacsSettingsForBranch(normalizedBranchId);
    const bindings = await loadGenieacsCustomerBindings(normalizedBranchId).catch(() => ({ devices: {} }));
    const mikrotikStatusLookup = await buildGenieacsMikrotikStatusLookup(normalizedBranchId);
    const limit = Number(options.limit || 0);
    const pathName = Number.isInteger(limit) && limit > 0
        ? `/devices?limit=${Math.min(limit, 500)}`
        : '/devices';
    const { response, parsed } = await fetchGenieacsNbi(settings, username, password, pathName, 20000);
    if (!response.ok) {
        const error = new Error(`GenieACS NBI returned HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
    }
    const rawDevices = Array.isArray(parsed) ? parsed : [];
    const devices = rawDevices.map((device) => {
        const normalized = normalizeGenieacsDevice(device);
        const binding = findGenieacsCustomerBinding(
            bindings,
            normalized.id,
            device?._id,
            normalized.serialNumber,
            normalized.macAddress
        );
        const customerAccountNumber = String(binding?.accountNumber || '').trim();
        const boundStatus = mikrotikStatusLookup.getForAccount(customerAccountNumber);
        return {
            ...normalized,
            customerAccountNumber,
            bindingStatus: boundStatus.bindingStatus,
            mikrotikStatus: boundStatus.mikrotikStatus,
            pppoeBoundUsername: boundStatus.pppoeUsername
        };
    });
    return {
        ok: true,
        configured: true,
        branchId: normalizedBranchId,
        devices,
        count: devices.length,
        rawCount: rawDevices.length,
        updatedAt: new Date().toISOString(),
        error: ''
    };
};

const loadGenieacsSettingsForBranch = async (branchId) => {
    let allSettings;
    try {
        allSettings = await loadIntegrationSettings(branchId || null);
    } catch (error) {
        if (error?.name === 'IntegrationSettingsUnreadableError') {
            const wrappedError = new Error(error.message);
            wrappedError.statusCode = 400;
            wrappedError.configured = false;
            throw wrappedError;
        }
        const wrappedError = new Error(error?.message || 'Failed to load integration settings.');
        wrappedError.statusCode = 500;
        wrappedError.configured = false;
        throw wrappedError;
    }
    const settings = allSettings?.genieacs || {};
    const host = sanitizeGenieacsHost(settings.host);
    const username = String(settings.username || '').trim();
    const password = String(settings.password || '');
    const enabled = Boolean(settings.enabled);
    if (!enabled || !host || !username || !password) {
        const error = new Error('GenieACS host, username, password, and enabled state are required.');
        error.statusCode = 400;
        error.configured = false;
        throw error;
    }
    if (typeof fetch !== 'function') {
        const error = new Error('Server fetch API is unavailable.');
        error.statusCode = 500;
        error.configured = true;
        throw error;
    }
    return { settings, username, password };
};

const saveGenieacsSnapshot = async (snapshot) => {
    const branchId = Number(snapshot?.branchId || 0) || 1;
    genieacsSnapshots.set(branchId, snapshot);
    await writeJson(getGenieacsSnapshotStoreKey(branchId), snapshot);
    return snapshot;
};

const loadGenieacsSnapshot = async (branchId) => {
    const normalizedBranchId = Number(branchId) || 1;
    const cached = genieacsSnapshots.get(normalizedBranchId);
    if (cached) return cached;
    const stored = await readJson(getGenieacsSnapshotStoreKey(normalizedBranchId), null).catch(() => null);
    if (stored && typeof stored === 'object') {
        genieacsSnapshots.set(normalizedBranchId, stored);
        return stored;
    }
    return null;
};

const sanitizeGenieacsClientForCustomer = (client = {}) => ({
    hostname: String(client.hostname || '').trim(),
    macAddress: String(client.macAddress || '').trim(),
    ipAddress: String(client.ipAddress || '').trim(),
    online: Boolean(client.online),
    lastSeen: String(client.lastSeen || client.activeTimestamp || '').trim(),
    layer2Interface: String(client.layer2Interface || '').trim(),
    interfacePath: String(client.interfacePath || '').trim(),
    interfaceType: String(client.interfaceType || '').trim(),
    wlanIndex: String(client.wlanIndex || '').trim()
});

const inferGenieacsClientBand = (client = {}, device = {}) => {
    const explicitBand = String(client.band || '').trim();
    if (explicitBand) return explicitBand;

    const bandIndexes = getGenieacsWifiBandIndexes(device?.model);
    const text = [
        client.wlanIndex,
        client.layer2Interface,
        client.interfacePath,
        client.interfaceType
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();

    const directIndex = String(client.wlanIndex || '').trim();
    const matchedIndex = directIndex || (text.match(/wlanconfiguration\.(\d+)/)?.[1] || text.match(/(?:wifi\.)?(?:ssid|accesspoint)\.(\d+)/)?.[1] || '');
    if (matchedIndex) {
        if (bandIndexes.wifi24.map(String).includes(matchedIndex)) return '2.4G';
        if (bandIndexes.wifi5.map(String).includes(matchedIndex)) return '5G';
    }

    if (/\b2\.?4g\b|\b24g\b/.test(text)) return '2.4G';
    if (/\b5g\b|\b5ghz\b/.test(text)) return '5G';
    if (text.includes('ethernet') || text.includes('lan')) return 'LAN';
    return 'LAN/WiFi';
};

const buildCustomerConnectedDevices = (device = {}) => {
    const seen = new Set();
    const addBand = (clients = [], band = '') => (Array.isArray(clients) ? clients : []).map((client) => ({
        ...sanitizeGenieacsClientForCustomer(client),
        band: band || inferGenieacsClientBand(client, device)
    }));
    return [
        ...addBand(device.wifi24Clients, '2.4G'),
        ...addBand(device.wifi5Clients, '5G'),
        ...addBand(device.wifiLanClients)
    ].filter((client, index) => {
        const key = [
            client.macAddress,
            client.ipAddress,
            client.hostname
        ].map((value) => String(value || '').trim().toLowerCase()).join('|') || `row:${index}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return Boolean(client.macAddress || client.ipAddress || client.hostname);
    });
};

const sanitizeGenieacsDeviceForCustomer = (device = {}) => {
    const wifi24Clients = (Array.isArray(device.wifi24Clients) ? device.wifi24Clients : []).map(sanitizeGenieacsClientForCustomer);
    const wifi5Clients = (Array.isArray(device.wifi5Clients) ? device.wifi5Clients : []).map(sanitizeGenieacsClientForCustomer);
    const wifiLanClients = (Array.isArray(device.wifiLanClients) ? device.wifiLanClients : []).map(sanitizeGenieacsClientForCustomer);
    return {
        id: String(device.id || '').trim(),
        serialNumber: String(device.serialNumber || '').trim(),
        manufacturer: String(device.manufacturer || '').trim(),
        model: String(device.model || '').trim(),
        hostname: String(device.hostname || '').trim(),
        ipAddress: String(device.ipAddress || '').trim(),
        macAddress: String(device.macAddress || '').trim(),
        pppoeUsername: String(device.pppoeUsername || device.pppoeBoundUsername || '').trim(),
        opticalPower: String(device.opticalPower || '').trim(),
        ssid24: String(device.ssid24 || '').trim(),
        ssid5: String(device.ssid5 || '').trim(),
        wifi24OnlineCount: Number.isFinite(Number(device.wifi24OnlineCount)) ? Number(device.wifi24OnlineCount) : null,
        wifi5OnlineCount: Number.isFinite(Number(device.wifi5OnlineCount)) ? Number(device.wifi5OnlineCount) : null,
        wifiTotalOnlineCount: Number.isFinite(Number(device.wifiTotalOnlineCount)) ? Number(device.wifiTotalOnlineCount) : null,
        wifi24Clients,
        wifi5Clients,
        wifiLanClients,
        connectedDevices: buildCustomerConnectedDevices(device),
        lastInform: String(device.lastInform || '').trim(),
        registered: String(device.registered || '').trim(),
        bindingStatus: String(device.bindingStatus || '').trim(),
        mikrotikStatus: String(device.mikrotikStatus || '').trim()
    };
};

const findCustomerGenieacsDevice = (snapshot, customer = {}) => {
    const devices = Array.isArray(snapshot?.devices) ? snapshot.devices : [];
    const accountNumber = String(customer?.accountNumber || customer?.id || '').trim();
    if (accountNumber) {
        const byAccount = devices.find((device) =>
            String(device?.customerAccountNumber || '').trim() === accountNumber
        );
        if (byAccount) return byAccount;
    }
    return null;
};

const listGenieacsBranchIds = async () => {
    if (await isRelationalReady().catch(() => false)) {
        const [rows] = await query('SELECT id FROM branches ORDER BY id');
        const ids = (rows || [])
            .map((row) => Number(row.id))
            .filter((id) => Number.isInteger(id) && id > 0);
        return ids.length ? ids : [1];
    }
    return [1];
};

const queueGenieacsBackgroundSummons = async (branchId, snapshot) => {
    const devices = Array.isArray(snapshot?.devices) ? snapshot.devices : [];
    const ids = devices
        .map((device) => String(device?.id || '').trim())
        .filter(Boolean)
        .slice(0, GENIEACS_BACKGROUND_SUMMON_LIMIT);
    if (!ids.length) return { requested: 0, queued: 0, failed: 0 };

    const { settings, username, password } = await loadGenieacsSettingsForBranch(branchId);
    let nextIndex = 0;
    let queued = 0;
    let failed = 0;
    const workerCount = Math.min(GENIEACS_BACKGROUND_CONCURRENCY, ids.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < ids.length) {
            const deviceId = ids[nextIndex];
            nextIndex += 1;
            try {
                const result = await queueGenieacsSummonTasks(settings, username, password, deviceId, 12000);
                if (result?.ok) queued += 1;
                else failed += 1;
            } catch {
                failed += 1;
            }
        }
    });
    await Promise.all(workers);
    return { requested: ids.length, queued, failed };
};

const refreshGenieacsBranchSnapshot = async (branchId, options = {}) => {
    const normalizedBranchId = Number(branchId) || 1;
    try {
        const snapshot = await buildGenieacsDeviceSnapshot(normalizedBranchId);
        if (options.queueSummon !== false) {
            snapshot.backgroundSummon = await queueGenieacsBackgroundSummons(normalizedBranchId, snapshot);
        }
        await saveGenieacsSnapshot(snapshot);
        return snapshot;
    } catch (error) {
        const previous = await loadGenieacsSnapshot(normalizedBranchId).catch(() => null);
        const failedSnapshot = {
            ...(previous && typeof previous === 'object' ? previous : {}),
            ok: false,
            configured: error?.configured !== false,
            branchId: normalizedBranchId,
            devices: Array.isArray(previous?.devices) ? previous.devices : [],
            count: Array.isArray(previous?.devices) ? previous.devices.length : 0,
            error: error?.message || 'Failed to refresh GenieACS devices.',
            lastRefreshFailedAt: new Date().toISOString()
        };
        await saveGenieacsSnapshot(failedSnapshot).catch(() => {});
        return failedSnapshot;
    }
};

const runGenieacsBackgroundRefreshOnce = async () => {
    if (genieacsRefreshRunning) return;
    genieacsRefreshRunning = true;
    try {
        const branchIds = await listGenieacsBranchIds();
        for (const branchId of branchIds) {
            await refreshGenieacsBranchSnapshot(branchId);
        }
    } catch (error) {
        console.warn('GenieACS background refresh failed:', error?.message || error);
    } finally {
        genieacsRefreshRunning = false;
    }
};

const scheduleGenieacsBackgroundRefresh = () => {
    if (genieacsRefreshTimer) return;
    setTimeout(() => {
        runGenieacsBackgroundRefreshOnce().catch((error) => {
            console.warn('Initial GenieACS background refresh failed:', error?.message || error);
        });
    }, 5000);
    genieacsRefreshTimer = setInterval(() => {
        runGenieacsBackgroundRefreshOnce().catch((error) => {
            console.warn('GenieACS background refresh failed:', error?.message || error);
        });
    }, GENIEACS_BACKGROUND_REFRESH_MS);
};

app.get('/api/genieacs/status', requireAuth, async (req, res) => {
    try {
        const { settings, username, password } = await loadGenieacsSettingsForRequest(req);
        const { response, parsed } = await fetchGenieacsNbi(settings, username, password, '/devices?limit=1', 8000);
        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                configured: true,
                reachable: false,
                status: response.status,
                error: `GenieACS NBI returned HTTP ${response.status}.`
            });
        }
        return res.json({
            ok: true,
            configured: true,
            reachable: true,
            status: response.status,
            sampleCount: Array.isArray(parsed) ? parsed.length : null
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            reachable: false,
            error: aborted ? 'GenieACS NBI request timed out.' : (error.message || 'Failed to reach GenieACS NBI.')
        });
    }
});

app.get('/api/genieacs/devices', requireAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        const branchId = Number(req.user?.branchId || 0);
        const requestedLimit = Number(req.query?.limit);
        const hasLimit = String(req.query?.limit || '').trim() !== '' && Number.isFinite(requestedLimit);
        const limit = hasLimit
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500)
            : null;
        const snapshot = await buildGenieacsDeviceSnapshot(branchId, { limit });
        if (!limit) await saveGenieacsSnapshot(snapshot).catch(() => {});
        return res.json({
            ok: true,
            devices: snapshot.devices,
            count: snapshot.count,
            limit,
            updatedAt: snapshot.updatedAt
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            error: aborted ? 'GenieACS devices request timed out.' : (error.message || 'Failed to load GenieACS devices.')
        });
    }
});

const handleCustomerModemInfoRequest = async (req, res) => {
    try {
        const branchId = Number(req.customer?.branchId || 1);
        let snapshot = await loadGenieacsSnapshot(branchId);
        const updatedAt = snapshot?.updatedAt ? new Date(snapshot.updatedAt).getTime() : 0;
        const isStale = !updatedAt || (Date.now() - updatedAt) > (GENIEACS_BACKGROUND_REFRESH_MS * 2);
        if (!snapshot || isStale) {
            refreshGenieacsBranchSnapshot(branchId).catch((error) => {
                console.warn('Customer modem GenieACS refresh failed:', error?.message || error);
            });
        }
        if (!snapshot) {
            snapshot = await refreshGenieacsBranchSnapshot(branchId, { queueSummon: false });
        }
        let device = findCustomerGenieacsDevice(snapshot, req.customer);
        let fetchedLive = false;
        if (device?.id) {
            try {
                const { settings, username, password } = await loadGenieacsSettingsForBranch(branchId);
                const deviceIdCandidates = getGenieacsDeviceIdCandidates(device.id, device.serialNumber, device.macAddress);
                const { response, device: freshDevice } = await fetchGenieacsDeviceById(settings, username, password, deviceIdCandidates, 12000);
                if (response?.ok && freshDevice) {
                    device = {
                        ...normalizeGenieacsDevice(freshDevice),
                        customerAccountNumber: device.customerAccountNumber,
                        customerName: device.customerName,
                        bindingStatus: device.bindingStatus,
                        mikrotikStatus: device.mikrotikStatus,
                        pppoeBoundUsername: device.pppoeBoundUsername
                    };
                    fetchedLive = true;
                }
            } catch (error) {
                console.warn('Customer modem live GenieACS fetch failed:', error?.message || error);
            }
        }
        return res.json({
            ok: true,
            modem: device ? sanitizeGenieacsDeviceForCustomer(device) : null,
            supported: Boolean(device),
            supportStatus: device ? 'Supported' : 'Not Supported',
            updatedAt: snapshot?.updatedAt || null,
            stale: isStale,
            fetchedLive,
            configured: snapshot?.configured !== false,
            error: device
                ? (snapshot?.ok === false ? (snapshot?.error || '') : '')
                : 'No GenieACS ONU is bound to this customer account.'
        });
    } catch (error) {
        return res.status(502).json({
            ok: false,
            modem: null,
            error: error?.message || 'Failed to load modem information.'
        });
    }
};

app.get('/api/customer-app/modem', customersModule.requireCustomer, handleCustomerModemInfoRequest);
app.get('/api/customers/me/modem', customersModule.requireCustomer, handleCustomerModemInfoRequest);

const parseCustomerWifiPasswordBands = (payload = {}, device = {}) => {
    const mode = String(payload.band || payload.applyTo || payload.target || 'both').trim().toLowerCase();
    const sharedPassword = String(payload.password || payload.newPassword || payload.wifiPassword || '').trim();
    const sharedSsid = String(payload.ssid || payload.username || payload.wifiName || '').trim();
    const wants24 = ['both', 'all', '2.4g', '24g', '24', 'wifi24', 'wifi_24'].includes(mode);
    const wants5 = ['both', 'all', '5g', '5', 'wifi5', 'wifi_5'].includes(mode);
    const wifi24Password = String(payload?.wifi24?.password || payload?.wifi24Password || (wants24 ? sharedPassword : '')).trim();
    const wifi5Password = String(payload?.wifi5?.password || payload?.wifi5Password || (wants5 ? sharedPassword : '')).trim();
    const wifi24Ssid = String(payload?.wifi24?.ssid || payload?.wifi24?.username || payload?.wifi24Ssid || payload?.wifi24Username || (wants24 ? sharedSsid : '')).trim();
    const wifi5Ssid = String(payload?.wifi5?.ssid || payload?.wifi5?.username || payload?.wifi5Ssid || payload?.wifi5Username || (wants5 ? sharedSsid : '')).trim();
    return [
        {
            label: '2.4G',
            ssid: wifi24Ssid,
            password: wifi24Password,
            currentSsid: String(payload?.wifi24?.currentSsid || device?.ssid24 || '').trim()
        },
        {
            label: '5G',
            ssid: wifi5Ssid,
            password: wifi5Password,
            currentSsid: String(payload?.wifi5?.currentSsid || device?.ssid5 || '').trim()
        }
    ].filter((band) => band.ssid || band.password);
};

const handleCustomerModemWifiPasswordChange = async (req, res) => {
    try {
        const branchId = Number(req.customer?.branchId || 1);
        let snapshot = await loadGenieacsSnapshot(branchId);
        if (!snapshot) {
            snapshot = await refreshGenieacsBranchSnapshot(branchId, { queueSummon: false });
        }
        const modem = findCustomerGenieacsDevice(snapshot, req.customer);
        if (!modem?.id) {
            return res.status(404).json({
                ok: false,
                supported: false,
                supportStatus: 'Not Supported',
                error: 'No GenieACS ONU is bound to this customer account.'
            });
        }

        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const bands = parseCustomerWifiPasswordBands(payload, modem);
        if (!bands.length) {
            return res.status(400).json({ ok: false, error: 'Enter the new WiFi name or password.' });
        }

        const { settings, username, password } = await loadGenieacsSettingsForBranch(branchId);
        const deviceIdCandidates = getGenieacsDeviceIdCandidates(modem.id, modem.serialNumber, modem.macAddress);
        const { response, device, matchedId } = await fetchGenieacsDeviceById(settings, username, password, deviceIdCandidates, 12000);
        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                configured: true,
                status: response.status,
                error: `GenieACS NBI returned HTTP ${response.status} while loading modem parameters.`
            });
        }
        if (!device) {
            return res.status(404).json({
                ok: false,
                configured: true,
                error: 'Modem was not found in GenieACS.'
            });
        }

        let result = null;
        try {
            result = await queueGenieacsWifiChangeTask({
                settings,
                username,
                password,
                device,
                deviceIdCandidates: getGenieacsDeviceIdCandidates(matchedId, modem.id),
                bands,
                timeoutMs: 15000
            });
        } catch (taskError) {
            if (!isGenieacsTaskTimeoutError(taskError)) {
                throw taskError;
            }
            refreshGenieacsBranchSnapshot(branchId, { queueSummon: true }).catch((error) => {
                console.warn('Customer modem GenieACS refresh after timed out WiFi change failed:', error?.message || error);
            });
            return res.status(202).json({
                ok: true,
                pending: true,
                message: 'WiFi password change request was sent to GenieACS. Please wait a moment for the modem to refresh.',
                warning: 'GenieACS did not return confirmation before the request timed out.'
            });
        }
        refreshGenieacsBranchSnapshot(branchId, { queueSummon: true }).catch((error) => {
            console.warn('Customer modem GenieACS refresh after WiFi change failed:', error?.message || error);
        });
        return res.json({
            ok: true,
            message: 'WiFi password change was sent to the modem.',
            resolved: result.resolved,
            task: result.task,
            commit: result.commit
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            status: error.status || undefined,
            task: error.task || undefined,
            error: aborted ? 'GenieACS WiFi password change request timed out.' : (error.message || 'Failed to change WiFi password.')
        });
    }
};

app.put('/api/customer-app/modem/wifi-password', customersModule.requireCustomer, handleCustomerModemWifiPasswordChange);
app.post('/api/customer-app/modem/wifi-password', customersModule.requireCustomer, handleCustomerModemWifiPasswordChange);
app.put('/api/customers/me/modem/wifi-password', customersModule.requireCustomer, handleCustomerModemWifiPasswordChange);

app.get('/api/genieacs/customer-bindings', requireAuth, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        const branchId = Number(req.user?.branchId || 0);
        const bindings = await loadGenieacsCustomerBindings(branchId);
        return res.json({ ok: true, bindings: bindings.devices || {} });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Failed to load GenieACS customer bindings.' });
    }
});

app.put('/api/genieacs/devices/:deviceId/customer', requireAuth, async (req, res) => {
    try {
        const branchId = Number(req.user?.branchId || 0);
        if (!Number.isInteger(branchId) || branchId <= 0) {
            return res.status(400).json({ ok: false, error: 'Branch context is required.' });
        }
        const deviceId = decodeGenieacsDeviceId(req.params.deviceId);
        if (!deviceId) {
            return res.status(400).json({ ok: false, error: 'Device ID is required.' });
        }
        const accountNumber = String(req.body?.accountNumber || '').trim();
        if (accountNumber) {
            const customers = await customersModule.readVisibleCustomers(branchId);
            const exists = (Array.isArray(customers) ? customers : [])
                .some((customer) => String(customer?.accountNumber || '').trim() === accountNumber);
            if (!exists) {
                return res.status(404).json({ ok: false, error: 'Customer account was not found in this branch.' });
            }
        }
        const bindings = await loadGenieacsCustomerBindings(branchId);
        if (!bindings.devices || typeof bindings.devices !== 'object') bindings.devices = {};
        if (accountNumber) {
            const binding = {
                accountNumber,
                updatedAt: new Date().toISOString(),
                updatedBy: String(req.user?.id || req.user?.username || '').trim()
            };
            getGenieacsDeviceIdCandidates(deviceId).forEach((candidate) => {
                bindings.devices[candidate] = binding;
            });
        } else {
            getGenieacsDeviceIdCandidates(deviceId).forEach((candidate) => {
                delete bindings.devices[candidate];
            });
        }
        await saveGenieacsCustomerBindings(branchId, bindings);
        const mikrotikStatusLookup = await buildGenieacsMikrotikStatusLookup(branchId);
        const boundStatus = mikrotikStatusLookup.getForAccount(accountNumber);
        return res.json({
            ok: true,
            deviceId,
            accountNumber,
            bindingStatus: boundStatus.bindingStatus,
            mikrotikStatus: boundStatus.mikrotikStatus,
            pppoeBoundUsername: boundStatus.pppoeUsername
        });
    } catch (error) {
        return res.status(500).json({ ok: false, error: error.message || 'Failed to save GenieACS customer binding.' });
    }
});

app.post('/api/genieacs/devices/summon', requireAuth, async (req, res) => {
    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const deviceIds = Array.isArray(payload.deviceIds)
            ? payload.deviceIds.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        const uniqueIds = [...new Set(deviceIds)];
        if (!uniqueIds.length) {
            return res.status(400).json({ ok: false, error: 'At least one device ID is required.' });
        }
        const { settings, username, password } = await loadGenieacsSettingsForRequest(req);
        const results = [];
        const processDevice = async (requestedId) => {
            try {
                const deviceId = decodeGenieacsDeviceId(requestedId);
                const deviceIdCandidates = getGenieacsDeviceIdCandidates(requestedId, deviceId);
                const { response, device, matchedId } = await fetchGenieacsDeviceById(settings, username, password, deviceIdCandidates, 10000);
                if (!response.ok) {
                    results.push({
                        deviceId: requestedId,
                        ok: false,
                        status: response.status,
                        error: `GenieACS NBI returned HTTP ${response.status} while loading modem parameters.`
                    });
                    return;
                }
                if (!device) {
                    results.push({
                        deviceId: requestedId,
                        ok: false,
                        status: 404,
                        error: 'Modem was not found in GenieACS.'
                    });
                    return;
                }
                const queued = await queueGenieacsSummonTasks(settings, username, password, matchedId || deviceIdCandidates[0] || deviceId, 15000);
                results.push({
                    deviceId: requestedId,
                    matchedId: matchedId || deviceIdCandidates[0] || deviceId,
                    ok: queued.ok,
                    status: queued.failed?.status || 200,
                    error: queued.failed
                        ? `GenieACS summon returned HTTP ${queued.failed.status} while refreshing ${queued.failed.objectName || 'root object'}.`
                        : '',
                    tasks: queued.tasks
                });
            } catch (error) {
                results.push({
                    deviceId: requestedId,
                    ok: false,
                    status: error?.name === 'AbortError' ? 0 : 500,
                    error: error?.name === 'AbortError' ? 'Summon timed out.' : (error?.message || 'Summon failed.')
                });
            }
        };
        let nextIndex = 0;
        const workerCount = Math.min(10, uniqueIds.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < uniqueIds.length) {
                const requestedId = uniqueIds[nextIndex];
                nextIndex += 1;
                await processDevice(requestedId);
            }
        });
        await Promise.all(workers);
        const queuedCount = results.filter((result) => result.ok).length;
        return res.json({
            ok: queuedCount > 0,
            requested: uniqueIds.length,
            queued: queuedCount,
            failed: results.length - queuedCount,
            results
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            error: aborted ? 'GenieACS summon request timed out.' : (error.message || 'Failed to summon GenieACS modems.')
        });
    }
});

app.post('/api/genieacs/devices/:deviceId/summon', requireAuth, async (req, res) => {
    try {
        const deviceId = decodeGenieacsDeviceId(req.params.deviceId);
        const rawDeviceId = String(req.body?.rawDeviceId || '').trim();
        if (!deviceId) {
            return res.status(400).json({ ok: false, error: 'Device ID is required.' });
        }
        const { settings, username, password } = await loadGenieacsSettingsForRequest(req);
        const deviceIdCandidates = getGenieacsDeviceIdCandidates(rawDeviceId, req.params.deviceId, deviceId);
        const { response, device, matchedId } = await fetchGenieacsDeviceById(settings, username, password, deviceIdCandidates, 12000);
        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                configured: true,
                status: response.status,
                error: `GenieACS NBI returned HTTP ${response.status} while loading modem parameters.`
            });
        }
        if (!device) {
            return res.status(404).json({
                ok: false,
                configured: true,
                error: 'Modem was not found in GenieACS.'
            });
        }
        const queued = await queueGenieacsSummonTasks(settings, username, password, matchedId || deviceIdCandidates[0] || deviceId, 15000);
        if (!queued.ok) {
            const failed = queued.failed || {};
            return res.status(502).json({
                ok: false,
                configured: true,
                status: failed.status,
                error: `GenieACS summon returned HTTP ${failed.status} while refreshing ${failed.objectName || 'root object'}.`,
                tasks: queued.tasks
            });
        }
        return res.json({
            ok: true,
            message: 'Summon tasks queued.',
            tasks: queued.tasks
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            error: aborted ? 'GenieACS summon request timed out.' : (error.message || 'Failed to summon GenieACS modem.')
        });
    }
});

app.post('/api/genieacs/devices/:deviceId/wifi', requireAuth, async (req, res) => {
    try {
        const deviceId = decodeGenieacsDeviceId(req.params.deviceId);
        if (!deviceId) {
            return res.status(400).json({ ok: false, error: 'Device ID is required.' });
        }
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const rawDeviceId = String(payload?.rawDeviceId || '').trim();
        const bands = [
            {
                label: '2.4G',
                ssid: String(payload?.wifi24?.ssid || '').trim(),
                password: String(payload?.wifi24?.password || '').trim(),
                currentSsid: String(payload?.wifi24?.currentSsid || '').trim()
            },
            {
                label: '5G',
                ssid: String(payload?.wifi5?.ssid || '').trim(),
                password: String(payload?.wifi5?.password || '').trim(),
                currentSsid: String(payload?.wifi5?.currentSsid || '').trim()
            }
        ];
        const requestedBands = bands.filter((band) => band.ssid || band.password);
        if (!requestedBands.length) {
            return res.status(400).json({ ok: false, error: 'Enter at least one WiFi name or password.' });
        }
        const invalidPassword = requestedBands.find((band) => band.password && band.password.length < 8);
        if (invalidPassword) {
            return res.status(400).json({ ok: false, error: `${invalidPassword.label} password must be at least 8 characters.` });
        }

        const { settings, username, password } = await loadGenieacsSettingsForRequest(req);
        const deviceIdCandidates = getGenieacsDeviceIdCandidates(rawDeviceId, req.params.deviceId, deviceId);
        const { response, device, matchedId } = await fetchGenieacsDeviceById(settings, username, password, deviceIdCandidates, 12000);
        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                configured: true,
                status: response.status,
                error: `GenieACS NBI returned HTTP ${response.status} while loading modem parameters.`
            });
        }
        if (!device) {
            return res.status(404).json({
                ok: false,
                configured: true,
                error: 'Modem was not found in GenieACS.'
            });
        }
        const result = await queueGenieacsWifiChangeTask({
            settings,
            username,
            password,
            device,
            deviceIdCandidates: [matchedId || deviceIdCandidates[0] || deviceId],
            bands: requestedBands,
            timeoutMs: 15000
        });
        return res.json({
            ok: true,
            message: 'WiFi change and refresh tasks queued.',
            resolved: result.resolved,
            task: result.task,
            commit: result.commit
        });
    } catch (error) {
        const aborted = error?.name === 'AbortError';
        return res.status(error.statusCode || 502).json({
            ok: false,
            configured: error.configured !== false,
            error: aborted ? 'GenieACS WiFi change request timed out.' : (error.message || 'Failed to change WiFi settings.')
        });
    }
});

app.get('/api/public/philippines/provinces', (_req, res) => {
    try {
        return res.json({
            ok: true,
            version: philippinesAddresses.dataVersion,
            provinces: philippinesAddresses.listProvinces()
        });
    } catch (error) {
        console.error('Failed to load public Philippine provinces:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load provinces.' });
    }
});
app.get('/api/public/philippines/municipalities', (req, res) => {
    try {
        const provinceCode = String(req.query?.provinceCode || '').trim();
        if (!provinceCode) {
            return res.status(400).json({ ok: false, error: 'provinceCode is required.' });
        }

        return res.json({
            ok: true,
            municipalities: philippinesAddresses.listMunicipalities(provinceCode)
        });
    } catch (error) {
        console.error('Failed to load public Philippine municipalities:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load municipalities.' });
    }
});
app.get('/api/public/philippines/barangays', (req, res) => {
    try {
        const municipalityCode = String(req.query?.municipalityCode || '').trim();
        if (!municipalityCode) {
            return res.status(400).json({ ok: false, error: 'municipalityCode is required.' });
        }

        return res.json({
            ok: true,
            barangays: philippinesAddresses.listBarangays(municipalityCode)
        });
    } catch (error) {
        console.error('Failed to load public Philippine barangays:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load barangays.' });
    }
});
app.get('/api/public/plans', async (_req, res) => {
    try {
        const relational = await isRelationalReady();
        let branchId = null;
        if (relational) {
            const [branchRows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
            branchId = branchRows && branchRows.length ? branchRows[0].id : null;
        }

        if (relational && !branchId) {
            return res.json({ ok: true, plans: { postpaid: [], prepaid: [] } });
        }

        const rows = typeof plansRouter.loadPlans === 'function'
            ? await plansRouter.loadPlans(branchId)
            : [];

        const plans = { postpaid: [], prepaid: [] };
        (rows || []).forEach((row) => {
            const category = String(row?.category || '').trim().toLowerCase() === 'prepaid'
                ? 'prepaid'
                : 'postpaid';
            const priceNumber = Number(row?.price);
            const plan = {
                id: String(row?.id || '').trim(),
                category,
                label: String(row?.label || row?.name || '').trim(),
                name: String(row?.name || row?.label || '').trim(),
                description: String(row?.description || '').trim(),
                profile: String(row?.profile || '').trim(),
                priceSuffix: '/ month',
                validity: null
            };

            if (Number.isFinite(priceNumber)) {
                plan.price = priceNumber;
            }
            if (!plan.description) delete plan.description;
            if (!plan.profile) delete plan.profile;
            if (plan.validity == null) delete plan.validity;

            plans[category].push(plan);
        });

        return res.json({ ok: true, plans });
    } catch (error) {
        console.error('Failed to load public plans:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load public plans.' });
    }
});
app.get('/api/public/coverage-areas', async (_req, res) => {
    try {
        const relational = await isRelationalReady();
        let branchId = null;
        if (relational) {
            const [branchRows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
            branchId = branchRows && branchRows.length ? branchRows[0].id : null;
        }
        const coverageAreas = typeof coverageRouter.readCoverage === 'function'
            ? await coverageRouter.readCoverage(branchId)
            : [];

        const areas = Array.from(new Set(
            (coverageAreas || [])
                .map((area) => String(area?.name || area?.areaName || '').trim())
                .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right));

        return res.json({ ok: true, areas });
    } catch (error) {
        console.error('Failed to load public coverage areas:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load coverage areas.' });
    }
});

const PUBLIC_MAP_COORDINATE_KEYS = [
    'mapPin',
    'map_pin',
    'coordinate',
    'coordinates',
    'coords',
    'pin',
    'locationPin',
    'gps',
    'gpsCoordinates'
];

const toPublicMapText = (value, maxLen = 0) => {
    const text = String(value ?? '').trim();
    return maxLen > 0 ? text.slice(0, maxLen) : text;
};

const toPublicMapNumber = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const hasPublicMapCoordinateValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.length >= 2;
    if (typeof value === 'object') {
        const lat = toPublicMapNumber(value.lat ?? value.latitude);
        const lng = toPublicMapNumber(value.lng ?? value.lon ?? value.longitude);
        return lat !== null && lng !== null;
    }
    return Boolean(String(value).trim());
};

const normalizePublicMapCoordinateValue = (value) => {
    if (typeof value === 'string' || typeof value === 'number') {
        return toPublicMapText(value, 160);
    }
    if (Array.isArray(value)) return value.slice(0, 2);
    if (value && typeof value === 'object') {
        return {
            lat: value.lat ?? value.latitude ?? null,
            lng: value.lng ?? value.lon ?? value.longitude ?? null
        };
    }
    return '';
};

const resolvePublicMapBranchId = async () => {
    if (await isRelationalReady()) {
        const [branchRows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
        return branchRows && branchRows.length ? branchRows[0].id : null;
    }
    return isJsonStorageMode() ? 1 : null;
};

const getPublicMapCoordinateValue = (source = {}) => {
    if (!source || typeof source !== 'object') return '';
    for (const key of PUBLIC_MAP_COORDINATE_KEYS) {
        const value = source?.[key];
        if (hasPublicMapCoordinateValue(value)) {
            return normalizePublicMapCoordinateValue(value);
        }
    }
    return '';
};

const hasPublicMapCoordinate = (source = {}) => {
    if (!source || typeof source !== 'object') return false;
    const lat = toPublicMapNumber(source.lat ?? source.latitude);
    const lng = toPublicMapNumber(source.lng ?? source.lon ?? source.longitude);
    return (lat !== null && lng !== null) || hasPublicMapCoordinateValue(getPublicMapCoordinateValue(source));
};

const sanitizePublicMapCustomer = (customer = {}) => {
    if (!customer || typeof customer !== 'object') return null;
    const firstName = toPublicMapText(customer.firstName || customer.first_name, 80);
    const lastName = toPublicMapText(customer.lastName || customer.last_name, 80);
    const name = toPublicMapText(customer.name || [firstName, lastName].filter(Boolean).join(' '), 160);
    const accountNumber = toPublicMapText(
        customer.accountNumber || customer.account_number || customer.account || customer.id,
        40
    );
    const coordinate = getPublicMapCoordinateValue(customer);
    const lat = toPublicMapNumber(customer.lat ?? customer.latitude);
    const lng = toPublicMapNumber(customer.lng ?? customer.lon ?? customer.longitude);

    return {
        accountNumber,
        account: accountNumber,
        id: accountNumber,
        firstName,
        lastName,
        name,
        mapPin: coordinate,
        coordinate,
        coordinates: coordinate,
        lat,
        lng,
        status: toPublicMapText(customer.status, 40),
        mikrotikStatus: toPublicMapText(customer.mikrotikStatus || customer.status, 40)
    };
};

const sanitizePublicMapConnection = (connection = {}) => ({
    customerId: toPublicMapText(connection.customerId || connection.accountNumber || connection.id, 40),
    customerName: toPublicMapText(connection.customerName || connection.name || connection.customer, 160),
    customerRef: toPublicMapText(connection.customerRef || connection.customerId || connection.accountNumber || connection.name, 160),
    port: toPublicMapNumber(connection.port || connection.customerPort || connection.slot),
    subscriberStatus: toPublicMapText(connection.subscriberStatus || connection.status, 40)
});

const sanitizePublicMapNap = (nap = {}) => {
    if (!nap || typeof nap !== 'object') return null;
    const coordinate = getPublicMapCoordinateValue(nap);
    const connections = Array.isArray(nap.connections)
        ? nap.connections.map(sanitizePublicMapConnection).filter((entry) => (
            entry.customerId || entry.customerName || entry.customerRef
        ))
        : [];

    return {
        id: toPublicMapText(nap.id || nap.client_uid, 80),
        code: toPublicMapText(nap.code || 'NAP', 80),
        location: toPublicMapText(nap.location || nap.area, 160),
        coordinate,
        coordinates: coordinate,
        splitter: toPublicMapText(nap.splitter, 20),
        linkedOlt: toPublicMapText(nap.linkedOlt || nap.linked_olt, 120),
        ponRef: toPublicMapText(nap.ponRef || nap.pon_ref, 80),
        capacity: toPublicMapNumber(nap.capacity),
        used: toPublicMapNumber(nap.used),
        totalPorts: toPublicMapNumber(nap.totalPorts),
        usedPorts: toPublicMapNumber(nap.usedPorts),
        availablePorts: toPublicMapNumber(nap.availablePorts),
        onlineSubscribers: toPublicMapNumber(nap.onlineSubscribers),
        offlineSubscribers: toPublicMapNumber(nap.offlineSubscribers),
        subscriberStatusAvailable: Boolean(nap.subscriberStatusAvailable),
        connections
    };
};

const isMissingPublicMapPonState = (error) => (
    /PON schema is not initialized/i.test(String(error?.message || '')) ||
    error?.code === 'ER_NO_SUCH_TABLE' ||
    /doesn't exist/i.test(String(error?.message || ''))
);

app.get('/api/public/coverage-map/customers', async (_req, res) => {
    try {
        const branchId = await resolvePublicMapBranchId();
        if (!branchId && !isJsonStorageMode()) {
            return res.json({ ok: true, customers: [] });
        }

        const readVisibleCustomers = typeof customersModule.readVisibleCustomers === 'function'
            ? customersModule.readVisibleCustomers
            : customersModule.readCustomers;
        const customers = typeof readVisibleCustomers === 'function'
            ? await readVisibleCustomers(branchId)
            : [];
        const publicCustomers = (Array.isArray(customers) ? customers : [])
            .map(sanitizePublicMapCustomer)
            .filter((customer) => customer && hasPublicMapCoordinate(customer));

        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, customers: publicCustomers });
    } catch (error) {
        console.error('Failed to load public coverage map customers:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load coverage map customers.' });
    }
});

app.get('/api/public/coverage-map/pon-state', async (_req, res) => {
    try {
        const branchId = await resolvePublicMapBranchId();
        if (!branchId) {
            return res.json({
                ok: true,
                schemaReady: false,
                olts: [],
                naps: [],
                subscriberStatusAvailable: false
            });
        }

        if (!isJsonStorageMode()) {
            if (!await isRelationalReady()) {
                return res.json({
                    ok: true,
                    schemaReady: false,
                    olts: [],
                    naps: [],
                    subscriberStatusAvailable: false
                });
            }
            const hasPonTables = typeof ponManagementRouter.hasPonTables === 'function'
                ? await ponManagementRouter.hasPonTables()
                : true;
            if (!hasPonTables) {
                return res.json({
                    ok: true,
                    schemaReady: false,
                    olts: [],
                    naps: [],
                    subscriberStatusAvailable: false
                });
            }
        }

        const loadPonStateForBranch = ponManagementRouter.loadPonStateForBranch;
        const state = typeof loadPonStateForBranch === 'function'
            ? await loadPonStateForBranch(branchId)
            : { olts: [], naps: [], subscriberStatusAvailable: false };
        const naps = (Array.isArray(state?.naps) ? state.naps : [])
            .map(sanitizePublicMapNap)
            .filter(Boolean);

        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            schemaReady: state?.schemaReady !== false,
            subscriberStatusAvailable: Boolean(state?.subscriberStatusAvailable),
            olts: [],
            naps
        });
    } catch (error) {
        if (isMissingPublicMapPonState(error)) {
            return res.json({
                ok: true,
                schemaReady: false,
                olts: [],
                naps: [],
                subscriberStatusAvailable: false
            });
        }
        console.error('Failed to load public coverage map NAP state:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load coverage map NAP state.' });
    }
});
app.post('/api/public/applications', publicApplicationLimiter, async (req, res) => {
    try {
        const cleanText = (value, maxLen = 0) => {
            const text = String(value ?? '').trim().replace(/\s+/g, ' ');
            return maxLen > 0 ? text.slice(0, maxLen) : text;
        };

        const firstName = cleanText(req.body?.firstName, 100);
        const lastName = cleanText(req.body?.lastName, 100);
        const contactNumber = cleanText(req.body?.contactNumber, 50);
        const street = cleanText(req.body?.street, 150);
        const barangay = cleanText(req.body?.barangay, 150);
        const municipality = cleanText(req.body?.municipality, 150);
        const province = cleanText(req.body?.province, 150);
        const planName = cleanText(req.body?.planName, 120);
        const address = [street, barangay, municipality, province].filter(Boolean).join(', ').slice(0, 255);
        const applicantName = [firstName, lastName].filter(Boolean).join(' ').trim();

        if (!firstName || !lastName || !contactNumber || !street || !barangay || !municipality || !province || !planName) {
            return res.status(400).json({ ok: false, error: 'First name, last name, contact number, street, barangay, municipality, province, and plan are required.' });
        }

        const [branchRows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
        const branchId = branchRows && branchRows.length ? branchRows[0].id : null;
        if (!branchId) {
            return res.status(500).json({ ok: false, error: 'No active branch is available to receive the application.' });
        }

        const now = new Date().toISOString();
        const jobDescription = [
            applicantName ? `Applicant: ${applicantName}` : '',
            contactNumber ? `Contact: ${contactNumber}` : '',
            planName ? `Plan: ${planName}` : '',
            address ? `Address: ${address}` : ''
        ]
            .filter(Boolean)
            .join('\n');

        const savedJob = await jobsRouter.addJobEntry({
            type: 'install',
            technician: '',
            priority: 'normal',
            schedule: now,
            status: 'scheduled',
            doneAt: null,
            notes: `Public application from ${applicantName || 'Applicant'}`.slice(0, 400),
            description: jobDescription.slice(0, 4000),
            createdAt: now,
            updatedAt: now,
            origin: 'public-application'
        }, branchId);

        const existing = await readJson('public_applications', []);
        const items = Array.isArray(existing) ? existing : [];
        const application = {
            id: `public-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            firstName,
            lastName,
            contactNumber,
            street,
            barangay,
            municipality,
            province,
            address,
            planName,
            applicantName,
            jobId: savedJob?.id || null,
            jobNumber: String(savedJob?.jobNumber || '').trim(),
            status: 'new',
            submittedAt: now
        };

        await writeJson('public_applications', [application, ...items].slice(0, 500));
        return res.status(201).json({
            ok: true,
            message: 'Application submitted. We will contact you soon.',
            jobNumber: String(savedJob?.jobNumber || '').trim()
        });
    } catch (error) {
        console.error('Failed to save public application:', error);
        return res.status(500).json({ ok: false, error: 'Unable to submit your application right now.' });
    }
});
app.use('/api/plans', requireAuth, plansRouter);
if (paymentsWebhookHandler) {
    app.post('/api/payments/xendit/webhook', paymentsWebhookHandler);
}
app.use('/api/payments', requireAuth, paymentsRouter);
app.use('/api/disconnections', requireAuth, disconnectionsRouter);
app.use('/api/referrals', requireAuth, referralsRouter);
app.use('/api/technician/customer-drafts/auth', customerDraftTechnicianAuthRouter);
app.use('/api/technician/customer-drafts', customerDraftTechnicianRouter);
app.use('/api/technician/installations', technicianInstallationsRouter);
app.use('/api/technician', technicianAssignmentsRouter);
[
    '/api/payment-confirmations',
    '/gcash-transaction/api/payment-confirmations',
    '/gcash-transaction.html/api/payment-confirmations',
    '/payment-confirmation-queue/api/payment-confirmations',
    '/payment-confirmation-queue.html/api/payment-confirmations'
].forEach((mountPath) => {
    app.use(mountPath, requireAuth, paymentConfirmationsRouter);
});
app.use('/api/customer-drafts', requireAuth, customerDraftAdminRouter);
app.use('/api/collector/payments', requireCollectorOrAdminAuth, collectorPaymentsRouter);
app.use('/api/customer-app', customerAppPublicRouter);
app.use('/api/customer-app', requireAuth, customerAppRouter);
app.use('/api/messenger-reminders', requireMessengerReminderAccess, messengerRemindersRouter);

app.get('/api/sidebar/work-counts', requireAuth, async (req, res) => {
    try {
        const branchId = Number(req.user?.branchId || 0);
        if (!Number.isInteger(branchId) || branchId <= 0) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
        }

        if (!await isRelationalReady()) {
            return res.json({
                ok: true,
                counts: { tickets: 0, jobs: 0, total: 0 }
            });
        }

        const closedTicketStatuses = ['resolved', 'closed', 'done', 'completed', 'cancelled'];
        const closedJobStatuses = ['done', 'closed', 'resolved', 'completed', 'cancelled'];
        const unassignedJobValues = ['', 'pending assignment', 'unassigned'];
        const adminJobOrigins = ['job', 'admin', 'manual'];

        const [ticketRows] = await query(
            `SELECT COUNT(*) AS count
             FROM tickets
             WHERE branch_id = ?
               AND LOWER(TRIM(COALESCE(source, ''))) <> 'admin'
               AND LOWER(TRIM(COALESCE(source, ''))) <> ''
               AND TRIM(COALESCE(assigned_to, '')) = ''
               AND LOWER(TRIM(COALESCE(status, ''))) NOT IN (${closedTicketStatuses.map(() => '?').join(', ')})`,
            [branchId, ...closedTicketStatuses]
        );

        const [jobRows] = await query(
            `SELECT COUNT(*) AS count
             FROM jobs
             WHERE branch_id = ?
               AND LOWER(TRIM(COALESCE(technician, ''))) IN (${unassignedJobValues.map(() => '?').join(', ')})
               AND LOWER(TRIM(COALESCE(status, ''))) NOT IN (${closedJobStatuses.map(() => '?').join(', ')})
               AND (
                    LOWER(TRIM(COALESCE(origin, ''))) NOT IN (${adminJobOrigins.map(() => '?').join(', ')})
                    OR LOWER(TRIM(COALESCE(notes, ''))) LIKE 'public application from%'
               )`,
            [branchId, ...unassignedJobValues, ...closedJobStatuses, ...adminJobOrigins]
        );

        const tickets = Number(ticketRows?.[0]?.count || 0);
        const jobs = Number(jobRows?.[0]?.count || 0);

        return res.json({
            ok: true,
            counts: {
                tickets: Number.isFinite(tickets) ? tickets : 0,
                jobs: Number.isFinite(jobs) ? jobs : 0,
                total: (Number.isFinite(tickets) ? tickets : 0) + (Number.isFinite(jobs) ? jobs : 0)
            }
        });
    } catch (error) {
        console.error('Failed to load sidebar work counts:', error);
        return res.status(500).json({ ok: false, error: 'Failed to load sidebar work counts.' });
    }
});

// Public customer login (no auth)
const DIRECT_WIFI_UNAVAILABLE_TARGETS = new Set(['', '-', '--', 'n/a', 'na', 'none', 'not set', 'offline']);

const sanitizeDirectWifiTargetValue = (value = '') => {
    const text = String(value || '').trim();
    if (!text || DIRECT_WIFI_UNAVAILABLE_TARGETS.has(text.toLowerCase())) return '';
    return text;
};

const resolveDirectWifiTargetFromSources = (customer = {}, payload = {}) => {
    const candidates = [
        payload?.url,
        payload?.targetUrl,
        payload?.ip,
        payload?.assignedIp,
        customer?.pppoeAssignedIp,
        customer?.assignedIp,
        customer?.assignedIP,
        customer?.activeAddress,
        customer?.remoteAddress,
        customer?.ipAddress,
        customer?.ip_address,
        customer?.ip,
        customer?.routerIp,
        customer?.routerIP,
        customer?.modemIp,
        customer?.modemIP,
        customer?.onuIp,
        customer?.onuIP,
        customer?.cpeIp,
        customer?.cpeIP,
        customer?.deviceIp,
        customer?.deviceIP
    ];
    for (const candidate of candidates) {
        const normalized = sanitizeDirectWifiTargetValue(candidate);
        if (normalized) return normalized;
    }
    return '';
};

const resolveDirectWifiLivePppoeTarget = async ({ customer = {}, branchId = null, settings = null } = {}) => {
    const username = String(customer?.pppoeUsername || customer?.pppoe_user || customer?.pppoeUser || '').trim();
    const usernameKey = normalizePppoeUsernameKey(username);
    if (!usernameKey) return { target: '', reason: 'Customer has no PPPoE username.' };

    const routerId = String(
        customer?.mikrotikId
        || customer?.routerId
        || customer?.mikrotikRouterId
        || customer?.router_id
        || ''
    ).trim();
    const getSnapshot = mikrotikRouter?.getRouterActivePppoeSnapshot;
    if (typeof getSnapshot !== 'function') {
        return { target: '', reason: 'MikroTik active-session reader is not available.' };
    }

    const snapshot = await getSnapshot({
        branchId,
        settings,
        routerId,
        includeInfo: false
    });
    const sessions = [
        ...(Array.isArray(snapshot?.activeSessions) ? snapshot.activeSessions : []),
        ...(Array.isArray(snapshot?.active) ? snapshot.active : [])
    ];
    const session = sessions.find((entry) =>
        normalizePppoeUsernameKey(entry?.username || entry?.name || entry?.user) === usernameKey
    ) || null;
    const target = sanitizeDirectWifiTargetValue(
        session?.address
        || session?.['remote-address']
        || session?.activeAddress
        || session?.remoteAddress
        || ''
    );
    return {
        target,
        routerId: snapshot?.routerId || routerId || '',
        reason: target ? '' : 'Customer has no active PPPoE session right now.'
    };
};

const normalizeDirectWifiBandPayload = (payload = {}) => ({
    ssid: String(payload?.ssid || payload?.name || '').trim(),
    password: String(payload?.password || payload?.wifiPassword || '').trim()
});

const hasDirectWifiBandPayload = (band = {}) => Boolean(band?.ssid || band?.password);
const chooseDirectWifiSingleBandPayload = (wifi24 = {}, wifi5 = {}) => {
    if (hasDirectWifiBandPayload(wifi24)) return { ...wifi24, sourceLabel: 'WiFi' };
    if (hasDirectWifiBandPayload(wifi5)) return { ...wifi5, sourceLabel: 'WiFi' };
    return { ssid: '', password: '', sourceLabel: 'WiFi' };
};

const loadDirectWifiChanger = () => {
    const scriptPath = require.resolve('./scripts/direct-web-wifi-change');
    delete require.cache[scriptPath];
    const directWifiModule = require(scriptPath);
    if (typeof directWifiModule.runDirectWebWifiChange !== 'function') {
        throw new Error('Direct web WiFi changer is not available.');
    }
    return directWifiModule.runDirectWebWifiChange;
};

const loadDirectConnectedDevicesReader = () => {
    const scriptPath = require.resolve('./scripts/direct-web-connected-devices');
    delete require.cache[scriptPath];
    const directDevicesModule = require(scriptPath);
    if (typeof directDevicesModule.runDirectWebConnectedDevices !== 'function') {
        throw new Error('Direct web connected devices reader is not available.');
    }
    return directDevicesModule.runDirectWebConnectedDevices;
};

const normalizeDirectWifiQueueLimit = (value, fallback, minValue = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minValue, Math.floor(parsed));
};

const DIRECT_WIFI_MAX_CONCURRENT = normalizeDirectWifiQueueLimit(
    process.env.DIRECT_WIFI_MAX_CONCURRENT,
    2,
    1
);
const DIRECT_WIFI_MAX_QUEUE = normalizeDirectWifiQueueLimit(
    process.env.DIRECT_WIFI_MAX_QUEUE,
    20,
    0
);
const directWifiQueue = [];
let directWifiRunning = 0;
const directWifiActiveTargets = new Set();

const createDirectWifiQueueError = (message) => {
    const error = new Error(message);
    error.statusCode = 429;
    return error;
};

const getDirectWifiQueueKey = (targetUrl, accountNumber) => {
    const rawTarget = String(targetUrl || '').trim();
    if (rawTarget) {
        try {
            return new URL(rawTarget).hostname.toLowerCase();
        } catch (_) {
            return rawTarget.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        }
    }
    return String(accountNumber || '').trim().toLowerCase();
};

const drainDirectWifiQueue = () => {
    while (directWifiRunning < DIRECT_WIFI_MAX_CONCURRENT && directWifiQueue.length) {
        const nextIndex = directWifiQueue.findIndex((job) => !directWifiActiveTargets.has(job.key));
        if (nextIndex < 0) break;

        const [job] = directWifiQueue.splice(nextIndex, 1);
        directWifiRunning += 1;
        directWifiActiveTargets.add(job.key);

        Promise.resolve()
            .then(job.task)
            .then(job.resolve, job.reject)
            .finally(() => {
                directWifiRunning = Math.max(0, directWifiRunning - 1);
                directWifiActiveTargets.delete(job.key);
                drainDirectWifiQueue();
            });
    }
};

const runQueuedDirectWifiJob = ({ key, task }) => new Promise((resolve, reject) => {
    if (typeof task !== 'function') {
        reject(createDirectWifiQueueError('Direct modem task is invalid.'));
        return;
    }

    const queueKey = key || `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const canStartImmediately = directWifiQueue.length === 0
        && directWifiRunning < DIRECT_WIFI_MAX_CONCURRENT
        && !directWifiActiveTargets.has(queueKey);

    if (!canStartImmediately && directWifiQueue.length >= DIRECT_WIFI_MAX_QUEUE) {
        reject(createDirectWifiQueueError('Direct modem automation is busy. Please try again in a minute.'));
        return;
    }

    directWifiQueue.push({
        key: queueKey,
        task,
        resolve,
        reject
    });
    drainDirectWifiQueue();
});

app.post('/api/customers/:accountNumber/direct-connected-devices', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required.' });
    }

    const branchId = Number(req.user?.branchId || 0);
    if (!Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }

    const accountNumber = String(req.params.accountNumber || '').trim();
    if (!accountNumber) {
        return res.status(400).json({ ok: false, error: 'Account number is required.' });
    }

    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const customers = await customersModule.readVisibleCustomers(branchId);
        const customer = (Array.isArray(customers) ? customers : []).find((entry) =>
            String(entry?.accountNumber || entry?.id || '').trim() === accountNumber
        );
        if (!customer) {
            return res.status(404).json({ ok: false, error: 'Customer was not found in this branch.' });
        }

        const settings = await loadIntegrationSettings(branchId || null);
        let targetUrl = resolveDirectWifiTargetFromSources(customer, payload);
        if (!targetUrl) {
            try {
                const liveTarget = await resolveDirectWifiLivePppoeTarget({ customer, branchId, settings });
                targetUrl = liveTarget.target;
                if (!targetUrl && liveTarget.reason) {
                    return res.status(400).json({ ok: false, error: liveTarget.reason });
                }
            } catch (error) {
                return res.status(502).json({
                    ok: false,
                    error: `Unable to read live Assigned IP from MikroTik: ${error?.mikrotikMessage || error?.message || error}`
                });
            }
        }
        if (!targetUrl) {
            return res.status(400).json({
                ok: false,
                error: 'Assigned IP is missing. Open Customer View until the PPPoE Assigned IP appears, then try again.'
            });
        }

        const ipBrowser = normalizeIpBrowserAutoLoginSettings(settings, targetUrl);
        if (!ipBrowser.username || !ipBrowser.password) {
            return res.status(400).json({
                ok: false,
                error: 'Add a matching IP Browser router profile or default username/password in Accounts > Integrations first.'
            });
        }

        const runDirectWebConnectedDevices = loadDirectConnectedDevicesReader();
        const queueKey = getDirectWifiQueueKey(targetUrl, accountNumber);
        const result = await runQueuedDirectWifiJob({
            key: queueKey,
            task: () => runDirectWebConnectedDevices({
                url: targetUrl,
                adminUser: ipBrowser.username,
                adminPassword: ipBrowser.password,
                adminPasswords: ipBrowser.passwordCandidates,
                selectors: {
                    login: {
                        username: ipBrowser.usernameSelector,
                        password: ipBrowser.passwordSelector,
                        submit: ipBrowser.submitSelector
                    }
                },
                devicePages: payload.devicePages || payload.devicePage,
                show: false,
                allowPublic: String(process.env.DIRECT_WIFI_ALLOW_PUBLIC || '').trim().toLowerCase() === 'true',
                timeoutMs: Math.max(8000, Math.min(45000, Number(payload.timeoutMs || 15000) || 15000)),
                logger: () => {}
            })
        });

        return res.json({
            ok: true,
            target: result.target,
            matchedUrl: result.matchedUrl,
            devices: Array.isArray(result.devices) ? result.devices : [],
            onlineCount: Number.isFinite(Number(result.onlineCount)) ? Number(result.onlineCount) : 0,
            totalCount: Number.isFinite(Number(result.totalCount)) ? Number(result.totalCount) : 0,
            logs: (result.messages || []).slice(-40)
        });
    } catch (error) {
        const logs = Array.isArray(error?.automationMessages) ? error.automationMessages.slice(-40) : [];
        console.warn('[direct-connected-devices] read failed:', {
            accountNumber,
            error: error?.message || error,
            logs
        });
        return res.status(error.statusCode || 502).json({
            ok: false,
            error: error.message || 'Direct web connected devices read failed.',
            logs
        });
    }
});

app.post('/api/customers/:accountNumber/direct-wifi', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required.' });
    }

    const branchId = Number(req.user?.branchId || 0);
    if (!Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }

    const accountNumber = String(req.params.accountNumber || '').trim();
    if (!accountNumber) {
        return res.status(400).json({ ok: false, error: 'Account number is required.' });
    }

    try {
        const payload = req.body && typeof req.body === 'object' ? req.body : {};
        const customers = await customersModule.readVisibleCustomers(branchId);
        const customer = (Array.isArray(customers) ? customers : []).find((entry) =>
            String(entry?.accountNumber || entry?.id || '').trim() === accountNumber
        );
        if (!customer) {
            return res.status(404).json({ ok: false, error: 'Customer was not found in this branch.' });
        }

        const wifi24 = normalizeDirectWifiBandPayload(payload.wifi24 || payload.band24 || {});
        const wifi5 = normalizeDirectWifiBandPayload(payload.wifi5 || payload.band5 || {});
        const directWifi = chooseDirectWifiSingleBandPayload(wifi24, wifi5);
        if (!hasDirectWifiBandPayload(directWifi)) {
            return res.status(400).json({ ok: false, error: 'Enter at least one WiFi name or password.' });
        }
        if (directWifi.password && directWifi.password.length < 8) {
            return res.status(400).json({ ok: false, error: 'WiFi password must be at least 8 characters.' });
        }

        const settings = await loadIntegrationSettings(branchId || null);
        let targetUrl = resolveDirectWifiTargetFromSources(customer, payload);
        if (!targetUrl) {
            try {
                const liveTarget = await resolveDirectWifiLivePppoeTarget({ customer, branchId, settings });
                targetUrl = liveTarget.target;
                if (!targetUrl && liveTarget.reason) {
                    return res.status(400).json({ ok: false, error: liveTarget.reason });
                }
            } catch (error) {
                return res.status(502).json({
                    ok: false,
                    error: `Unable to read live Assigned IP from MikroTik: ${error?.mikrotikMessage || error?.message || error}`
                });
            }
        }
        if (!targetUrl) {
            return res.status(400).json({
                ok: false,
                error: 'Assigned IP is missing. Open Customer View until the PPPoE Assigned IP appears, then try again.'
            });
        }

        const ipBrowser = normalizeIpBrowserAutoLoginSettings(settings, targetUrl);
        if (!ipBrowser.username || !ipBrowser.password) {
            return res.status(400).json({
                ok: false,
                error: 'Add a matching IP Browser router profile or default username/password in Accounts > Integrations first.'
            });
        }

        const runDirectWebWifiChange = loadDirectWifiChanger();
        const directWifiPages = ['/wlbasic.asp', '/wlwpa.asp'];
        const directWifiSelectors = {
            ssid24: 'input[name="ssid"]',
            password24: 'input[name="pskValue"], input#wpapsk'
        };
        const queueKey = getDirectWifiQueueKey(targetUrl, accountNumber);
        const result = await runQueuedDirectWifiJob({
            key: queueKey,
            task: () => runDirectWebWifiChange({
                url: targetUrl,
                adminUser: ipBrowser.username,
                adminPassword: ipBrowser.password,
                adminPasswords: ipBrowser.passwordCandidates,
                ssid24: directWifi.ssid,
                password24: directWifi.password,
                ssid5: '',
                password5: '',
                selectors: {
                    login: {
                        username: ipBrowser.usernameSelector,
                        password: ipBrowser.passwordSelector,
                        submit: ipBrowser.submitSelector
                    },
                    wifi: {
                        ...directWifiSelectors,
                        ...(payload?.selectors?.wifi || {})
                    }
                },
                wifiPages: payload.wifiPages || payload.wifiPage || directWifiPages,
                modemTemplate: 'm2-2050-yotc',
                fallbackWifiPages: false,
                apply: true,
                show: false,
                allowPublic: String(process.env.DIRECT_WIFI_ALLOW_PUBLIC || '').trim().toLowerCase() === 'true',
                timeoutMs: Math.max(8000, Math.min(45000, Number(payload.timeoutMs || 15000) || 15000)),
                logger: () => {}
            })
        });

        return res.json({
            ok: true,
            message: 'Direct web WiFi change submitted.',
            target: result.target,
            matchedUrl: result.matchedUrl,
            logs: (result.messages || []).slice(-40)
        });
    } catch (error) {
        const logs = Array.isArray(error?.automationMessages) ? error.automationMessages.slice(-40) : [];
        console.warn('[direct-wifi] change failed:', {
            accountNumber,
            error: error?.message || error,
            logs
        });
        return res.status(error.statusCode || 502).json({
            ok: false,
            error: error.message || 'Direct web WiFi change failed.',
            logs
        });
    }
});

app.use('/api/customers', customersPublicRouter);
// Protected customer routes
app.use('/api/customers', requireAuth, customersRouter);
// Hidden secondary-location workspace. Its router owns a distinct storage key
// and never delegates to the canonical customer or billing data stores.
app.use('/api/temp', requireAuth, tempWorkspaceRouter);
// Public ticket submission (no auth)
app.use('/api/tickets', ticketsPublicRouter);
// Protected ticket routes
app.use('/api/tickets', requireAuth, ticketsRouter);
app.use('/api/payment-records', requireAuth, paymentRecordsRouter);
app.use('/api/coverage', requireAuth, coverageRouter);
app.use('/api/pon', requireAuth, ponManagementRouter);
app.use('/api/sms', requireAuth, smsRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/payroll', requireAuth, payrollRouter);
app.use('/api/info', infoRouter);
app.use('/api/accounts', requireAuth, accountsRouter);
app.use(
    '/api/admin-data-reset',
    requireAuth,
    (req, res, next) => (req.method === 'POST' ? factoryResetLimiter(req, res, next) : next()),
    factoryResetRouter
);
app.use('/api/system-backup', requireAuth, systemBackupLimiter, systemBackupRouter);
app.use('/api/collectors', requireAuth, collectorsRouter);
app.use('/api/business-profile', businessProfileRouter);
app.use('/api/app-downloads', appDownloadsRouter);
app.use('/api/integrations', integrationSettingsRouter);
app.use('/api/mikrotik', mikrotikRouter);
app.use('/api/jobs', requireAuth, jobsRouter);

app.get('/api/export/clients', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const branchId = Number(req.user?.branchId || (isJsonStorageMode() ? 1 : 0));
    if (!Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }

    try {
        if (!xlsxModule) {
            try {
                xlsxModule = require('xlsx');
            } catch (loadError) {
                return res.status(500).json({ ok: false, error: 'Excel exporter not installed. Run: npm install xlsx' });
            }
        }

        const [customers, plans] = await Promise.all([
            customersModule.readVisibleCustomers(branchId),
            customersModule.readPlans(branchId)
        ]);
        const workbookBuffer = createClientsExportWorkbookBuffer(xlsxModule, customers, plans);
        const dateStamp = new Date().toISOString().slice(0, 10);
        const filename = `clients-export-${dateStamp}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', workbookBuffer.length);
        return res.status(200).send(workbookBuffer);
    } catch (error) {
        console.error('Failed to export clients:', error);
        return res.status(500).json({ ok: false, error: 'Failed to export clients.' });
    }
});

app.get('/api/export/customers-full', requireAuth, async (req, res) => {
    if (!isAdminUser(req.user)) {
        return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    const branchId = Number(req.user?.branchId || (isJsonStorageMode() ? 1 : 0));
    if (!Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }

    try {
        const exportedAt = new Date().toISOString();
        let branch = { id: branchId };
        let customers = [];
        let planRows = [];
        let paymentEntries = [];
        let tickets = [];
        let jobs = [];
        let smsMessages = [];
        let smsAutomationRuns = [];
        let ponNapConnections = [];
        let ponStateRows = [];
        let firstBillAdjustmentRows = [];

        if (isJsonStorageMode()) {
            const jsonExportData = await readJsonCustomerFullExportData(branchId);
            branch = jsonExportData.branch;
            customers = jsonExportData.customers;
            planRows = jsonExportData.planRows;
            paymentEntries = jsonExportData.paymentEntries;
            tickets = jsonExportData.tickets;
            jobs = jsonExportData.jobs;
            smsMessages = jsonExportData.smsMessages;
            smsAutomationRuns = jsonExportData.smsAutomationRuns;
            ponNapConnections = jsonExportData.ponNapConnections;
            ponStateRows = jsonExportData.ponStateRows;
        } else {
            const [branchRows] = await query(
                'SELECT id, name, code FROM branches WHERE id = ? LIMIT 1',
                [branchId]
            );
            branch = (branchRows && branchRows[0]) || { id: branchId };

            const [customerRows] = await query(
                'SELECT * FROM customers WHERE branch_id = ? ORDER BY account_number ASC',
                [branchId]
            );
            customers = Array.isArray(customerRows) ? customerRows : [];
        }

        const accountNumbers = [...new Set(
            customers
                .map((entry) => String(entry?.account_number || '').trim())
                .filter(Boolean)
        )];
        firstBillAdjustmentRows = buildFirstBillAdjustmentExportRows({
            adjustments: await readJson('payment_breakdown_adjustments', {}),
            branchId,
            accountNumbers
        });

        if (!isJsonStorageMode()) {
            const [loadedPlanRows] = await query(
                'SELECT * FROM plans WHERE branch_id = ? ORDER BY name ASC',
                [branchId]
            );
            planRows = Array.isArray(loadedPlanRows) ? loadedPlanRows : [];
        }

        if (!isJsonStorageMode() && accountNumbers.length) {
            const placeholders = accountNumbers.map(() => '?').join(', ');

            const [paymentRows] = await query(
                `SELECT *
                 FROM payment_entries
                 WHERE branch_id = ?
                   AND account_number IN (${placeholders})
                 ORDER BY recorded_at DESC, id DESC`,
                [branchId, ...accountNumbers]
            );
            paymentEntries = Array.isArray(paymentRows) ? paymentRows : [];
        }

        if (!isJsonStorageMode()) {
            const [ticketRows] = await query(
                `SELECT *
                 FROM tickets
                 WHERE branch_id = ?
                 ORDER BY created_at DESC, id DESC`,
                [branchId]
            );
            tickets = Array.isArray(ticketRows) ? ticketRows : [];

            const [jobRows] = await query(
                `SELECT
                    j.*,
                    t.account_number AS account_number
                 FROM jobs j
                 LEFT JOIN tickets t
                    ON t.id = j.ticket_id
                   AND t.branch_id = j.branch_id
                 WHERE j.branch_id = ?
                 ORDER BY j.created_at DESC, j.id DESC`,
                [branchId]
            );
            jobs = Array.isArray(jobRows) ? jobRows : [];

            const [smsMessageRows] = await query(
                `SELECT *
                 FROM sms_messages
                 WHERE branch_id = ?
                 ORDER BY created_at DESC, id DESC`,
                [branchId]
            );
            smsMessages = Array.isArray(smsMessageRows) ? smsMessageRows : [];

            const [automationRunRows] = await query(
                `SELECT *
                 FROM sms_automation_runs
                 WHERE branch_id = ?
                 ORDER BY created_at DESC, id DESC`,
                [branchId]
            );
            smsAutomationRuns = Array.isArray(automationRunRows) ? automationRunRows : [];

            const [ponRows] = await query(
                `SELECT
                    c.*,
                    n.branch_id AS branch_id
                 FROM pon_nap_connections c
                 INNER JOIN pon_naps n ON n.id = c.nap_id
                 WHERE n.branch_id = ?
                 ORDER BY c.created_at DESC, c.id DESC`,
                [branchId]
            );
            ponNapConnections = Array.isArray(ponRows) ? ponRows : [];
        }

        const exportIntegrity = deduplicateCustomerFullTables({
            customers,
            plans: planRows,
            payment_entries: paymentEntries,
            tickets,
            jobs,
            sms_messages: smsMessages,
            sms_automation_runs: smsAutomationRuns,
            pon_nap_connections: ponNapConnections,
            pon_state: ponStateRows,
            payment_breakdown_adjustments: firstBillAdjustmentRows
        });
        if (exportIntegrity.conflictCount) {
            return res.status(409).json({
                ok: false,
                error: 'Export stopped because conflicting stable record identities were found. Resolve the listed records before exporting.',
                conflicts: exportIntegrity.conflicts,
                conflictCount: exportIntegrity.conflictCount
            });
        }
        customers = exportIntegrity.tables.customers;
        planRows = exportIntegrity.tables.plans;
        paymentEntries = exportIntegrity.tables.payment_entries;
        tickets = exportIntegrity.tables.tickets;
        jobs = exportIntegrity.tables.jobs;
        smsMessages = exportIntegrity.tables.sms_messages;
        smsAutomationRuns = exportIntegrity.tables.sms_automation_runs;
        ponNapConnections = exportIntegrity.tables.pon_nap_connections;
        ponStateRows = exportIntegrity.tables.pon_state;
        firstBillAdjustmentRows = exportIntegrity.tables.payment_breakdown_adjustments;

        const paymentsByAccount = groupRowsByKey(paymentEntries, 'account_number');
        const ticketsByAccount = groupRowsByKey(tickets, 'account_number');
        const jobsByAccount = groupRowsByKey(jobs, 'account_number');
        const smsByAccount = groupRowsByKey(smsMessages, 'customer_account_number');
        const automationRunsByAccount = groupRowsByKey(smsAutomationRuns, 'customer_account_number');
        const ponByAccount = groupRowsByKey(ponNapConnections, 'customer_account_number');
        const balanceSummaryByAccount = Object.create(null);
        accountNumbers.forEach((accountNumber) => {
            balanceSummaryByAccount[accountNumber] = summarizeCustomerBalance(paymentsByAccount[accountNumber] || []);
        });

        const customersFull = customers.map((customer) => {
            const accountNumber = String(customer?.account_number || '').trim();
            const balanceSummary = balanceSummaryByAccount[accountNumber] || summarizeCustomerBalance([]);
            return {
                ...customer,
                customer_name: toCustomerDisplayName(customer),
                ...balanceSummary,
                payment_entries_count: (paymentsByAccount[accountNumber] || []).length,
                tickets_count: (ticketsByAccount[accountNumber] || []).length,
                jobs_count: (jobsByAccount[accountNumber] || []).length,
                sms_messages_count: (smsByAccount[accountNumber] || []).length,
                sms_automation_runs_count: (automationRunsByAccount[accountNumber] || []).length,
                pon_nap_connections_count: (ponByAccount[accountNumber] || []).length
            };
        });

        const customerNames = customers.map((customer, index) => ({
            no: index + 1,
            account_number: String(customer?.account_number || '').trim(),
            customer_name: toCustomerDisplayName(customer)
        }));

        const customerList = customers.map((customer) => {
            const accountNumber = String(customer?.account_number || '').trim();
            const balanceSummary = balanceSummaryByAccount[accountNumber] || summarizeCustomerBalance([]);
            return {
                account_number: accountNumber,
                customer_name: toCustomerDisplayName(customer),
                status: customer?.status || '',
                plan_name: customer?.plan_name || '',
                plan_amount: customer?.plan_amount ?? '',
                area: customer?.area || '',
                mobile: customer?.mobile || '',
                email: customer?.email || '',
                ...balanceSummary,
                payment_entries_count: (paymentsByAccount[accountNumber] || []).length,
                tickets_count: (ticketsByAccount[accountNumber] || []).length,
                jobs_count: (jobsByAccount[accountNumber] || []).length,
                sms_messages_count: (smsByAccount[accountNumber] || []).length,
                sms_automation_runs_count: (automationRunsByAccount[accountNumber] || []).length,
                pon_nap_connections_count: (ponByAccount[accountNumber] || []).length
            };
        });

        const customerAllData = customers.map((customer) => {
            const accountNumber = String(customer?.account_number || '').trim();
            const relatedPayments = paymentsByAccount[accountNumber] || [];
            const relatedTickets = ticketsByAccount[accountNumber] || [];
            const relatedJobs = jobsByAccount[accountNumber] || [];
            const relatedSmsMessages = smsByAccount[accountNumber] || [];
            const relatedSmsRuns = automationRunsByAccount[accountNumber] || [];
            const relatedPonConnections = ponByAccount[accountNumber] || [];
            const balanceSummary = balanceSummaryByAccount[accountNumber] || summarizeCustomerBalance([]);
            return {
                ...customer,
                customer_name: toCustomerDisplayName(customer),
                ...balanceSummary,
                payment_entries_count: relatedPayments.length,
                tickets_count: relatedTickets.length,
                jobs_count: relatedJobs.length,
                sms_messages_count: relatedSmsMessages.length,
                sms_automation_runs_count: relatedSmsRuns.length,
                pon_nap_connections_count: relatedPonConnections.length,
                payment_entries_json: toPrettyJsonText(relatedPayments),
                tickets_json: toPrettyJsonText(relatedTickets),
                jobs_json: toPrettyJsonText(relatedJobs),
                sms_messages_json: toPrettyJsonText(relatedSmsMessages),
                sms_automation_runs_json: toPrettyJsonText(relatedSmsRuns),
                pon_nap_connections_json: toPrettyJsonText(relatedPonConnections)
            };
        });

        const customerBalances = customers.map((customer) => {
            const accountNumber = String(customer?.account_number || '').trim();
            const balanceSummary = balanceSummaryByAccount[accountNumber] || summarizeCustomerBalance([]);
            return {
                account_number: accountNumber,
                customer_name: toCustomerDisplayName(customer),
                ...balanceSummary
            };
        });

        if (!xlsxModule) {
            try {
                xlsxModule = require('xlsx');
            } catch (loadError) {
                return res.status(500).json({ ok: false, error: 'Excel exporter not installed. Run: npm install xlsx' });
            }
        }

        const workbook = xlsxModule.utils.book_new();
        const usedSheetNames = new Set();
        const appendSheet = (name, rows) => {
            const baseName = sanitizeSheetName(name);
            let sheetName = baseName;
            let suffix = 1;
            while (usedSheetNames.has(sheetName)) {
                const marker = `_${suffix++}`;
                sheetName = `${baseName.slice(0, 31 - marker.length)}${marker}`;
            }
            usedSheetNames.add(sheetName);
            const normalizedRows = normalizeExportRows(rows);
            const worksheet = xlsxModule.utils.json_to_sheet(
                normalizedRows.length ? normalizedRows : [{ note: 'No records' }]
            );
            xlsxModule.utils.book_append_sheet(workbook, worksheet, sheetName);
        };

        appendSheet('metadata', [{
            backup_schema_version: 3,
            exported_at: exportedAt,
            branch_id: branch?.id || branchId,
            branch_name: branch?.name || '',
            branch_code: branch?.code || '',
            customers: customers.length,
            customer_names: customerNames.length,
            customer_balances: customerBalances.length,
            customer_list: customerList.length,
            customer_all_data: customerAllData.length,
            customers_full: customersFull.length,
            plans: planRows.length,
            payment_entries: paymentEntries.length,
            tickets: tickets.length,
            jobs: jobs.length,
            sms_messages: smsMessages.length,
            sms_automation_runs: smsAutomationRuns.length,
            pon_nap_connections: ponNapConnections.length,
            pon_state_rows: ponStateRows.length,
            payment_breakdown_adjustments: firstBillAdjustmentRows.length,
            duplicate_rows_removed: exportIntegrity.duplicateCount,
            import_identity_policy: 'upsert stable IDs; skip exact duplicates; reject conflicting identities'
        }]);
        appendSheet('customer_names', customerNames);
        appendSheet('customer_balances', customerBalances);
        appendSheet('customer_list', customerList);
        appendSheet('customer_all_data', customerAllData);
        appendSheet('customers', customers);
        appendSheet('customers_full', customersFull);
        appendSheet('plans', planRows);
        appendSheet('payment_entries', paymentEntries);
        appendSheet('tickets', tickets);
        appendSheet('jobs', jobs);
        appendSheet('sms_messages', smsMessages);
        appendSheet('sms_automation_runs', smsAutomationRuns);
        appendSheet('pon_nap_connections', ponNapConnections);
        appendSheet('pon_state', ponStateRows);
        appendSheet('payment_breakdown_adjustments', firstBillAdjustmentRows);

        const workbookBuffer = xlsxModule.write(workbook, {
            type: 'buffer',
            bookType: 'xlsx',
            compression: true
        });

        const dateStamp = exportedAt.replace(/[:T]/g, '-').replace(/\..+$/, '');
        const branchSlug = String(branch?.name || `branch-${branchId}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || `branch-${branchId}`;
        const filename = `customers-full-export-${branchSlug}-${dateStamp}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', workbookBuffer.length);
        return res.status(200).send(workbookBuffer);
    } catch (error) {
        console.error('Failed to export full customer data:', error);
        return res.status(500).json({ ok: false, error: 'Failed to export full customer data.' });
    }
});

app.post(
    '/api/import/customers-full',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: '80mb' }),
    serializePaymentMutationRequest,
    async (req, res) => {
        if (!isAdminUser(req.user)) {
            return res.status(403).json({ ok: false, error: 'Admin access required' });
        }

        const branchId = Number(req.user?.branchId || (isJsonStorageMode() ? 1 : 0));
        if (!Number.isInteger(branchId) || branchId <= 0) {
            return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
        }

        let importBuffer = Buffer.isBuffer(req.body) ? req.body : null;
        if (!importBuffer && req.body && typeof req.body === 'object' && typeof req.body.fileBase64 === 'string') {
            try {
                importBuffer = Buffer.from(req.body.fileBase64, 'base64');
            } catch {
                importBuffer = null;
            }
        }
        if (!importBuffer || !importBuffer.length) {
            return res.status(400).json({ ok: false, error: 'Import file is empty.' });
        }

        const importFileName = decodeHeaderFileName(req.headers['x-import-filename']);
        let parsedImport;
        try {
            parsedImport = parseImportTablesFromBuffer(importBuffer, importFileName);
        } catch (error) {
            return res.status(400).json({
                ok: false,
                error: `Failed to read import file: ${error?.message || 'Invalid file format.'}`
            });
        }

        const rawTables = parsedImport?.tables || {};
        const importIntegrity = deduplicateCustomerFullTables(rawTables);
        if (importIntegrity.conflictCount) {
            return res.status(409).json({
                ok: false,
                error: 'Import stopped because the file contains conflicting records with the same stable identity. No records were changed.',
                conflicts: importIntegrity.conflicts,
                conflictCount: importIntegrity.conflictCount
            });
        }
        let tables = importIntegrity.tables;
        let importPlans = ensureArrayOfObjects(tables.plans);
        let importCustomers = ensureArrayOfObjects(tables.customers);
        let importPayments = ensureArrayOfObjects(tables.payment_entries);
        let importTickets = ensureArrayOfObjects(tables.tickets);
        let importJobs = ensureArrayOfObjects(tables.jobs);
        let importSmsMessages = ensureArrayOfObjects(tables.sms_messages);
        let importSmsAutomationRuns = ensureArrayOfObjects(tables.sms_automation_runs);
        let importPonConnections = ensureArrayOfObjects(tables.pon_nap_connections);
        let importPonState = ensureArrayOfObjects(tables.pon_state);
        let importFirstBillAdjustments = ensureArrayOfObjects(tables.payment_breakdown_adjustments);

        if (
            !importCustomers.length &&
            !importPayments.length &&
            !importTickets.length &&
            !importJobs.length &&
            !importSmsMessages.length &&
            !importSmsAutomationRuns.length &&
            !importPonConnections.length &&
            !importPonState.length &&
            !importFirstBillAdjustments.length
        ) {
            return res.status(400).json({
                ok: false,
                error: 'No importable customer data found in the file.'
            });
        }

        const importedAccountNumbers = getCustomerFullImportAccountNumbers(tables);
        const importedPaymentIds = getCustomerFullImportPaymentIds(tables);
        let closedAccountConflicts = [];
        try {
            const closedAccountStore = await readJson('closed_customer_accounts', {
                version: 1,
                branches: {}
            });
            if (!closedAccountStore || typeof closedAccountStore !== 'object' || Array.isArray(closedAccountStore)) {
                throw new Error('Closed-account audit store is invalid.');
            }
            if (!closedAccountStore.branches || typeof closedAccountStore.branches !== 'object' || Array.isArray(closedAccountStore.branches)) {
                throw new Error('Closed-account audit branches are invalid.');
            }
            const closedAccountRecords = Object.entries(closedAccountStore.branches).flatMap(([storeBranchId, entry]) => (
                Array.isArray(entry?.records)
                    ? entry.records.map((record) => ({ ...record, _storeBranchId: storeBranchId }))
                    : []
            ));
            const [currentCustomers, currentPayments] = await Promise.all([
                customersModule.readCustomers(null),
                customersModule.readPayments(null)
            ]);
            closedAccountConflicts = findCustomerFullImportClosedAccountConflicts({
                branchId,
                tables,
                closedAccountRecords,
                currentCustomers,
                currentPayments
            });
        } catch (error) {
            console.error('Failed to verify protected closed-account history before full customer import:', error);
            return res.status(500).json({
                ok: false,
                code: 'CUSTOMER_FULL_IMPORT_PROTECTION_CHECK_FAILED',
                error: 'Import stopped because protected closed-account history could not be verified. No records were changed.'
            });
        }
        const blockingClosedAccountConflicts = closedAccountConflicts.filter(
            isCustomerFullImportBlockingConflict
        );
        if (blockingClosedAccountConflicts.length) {
            return res.status(409).json({
                ok: false,
                code: 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT',
                error: 'Import stopped because it would modify records with protected closed-account history. No records were changed.',
                conflicts: blockingClosedAccountConflicts,
                conflictCount: blockingClosedAccountConflicts.length
            });
        }
        const protectedHistoryFilter = filterCustomerFullImportProtectedRows({
            tables,
            conflicts: closedAccountConflicts
        });
        tables = protectedHistoryFilter.tables;
        importPlans = ensureArrayOfObjects(tables.plans);
        importCustomers = ensureArrayOfObjects(tables.customers);
        importPayments = ensureArrayOfObjects(tables.payment_entries);
        importTickets = ensureArrayOfObjects(tables.tickets);
        importJobs = ensureArrayOfObjects(tables.jobs);
        importSmsMessages = ensureArrayOfObjects(tables.sms_messages);
        importSmsAutomationRuns = ensureArrayOfObjects(tables.sms_automation_runs);
        importPonConnections = ensureArrayOfObjects(tables.pon_nap_connections);
        importPonState = ensureArrayOfObjects(tables.pon_state);
        importFirstBillAdjustments = ensureArrayOfObjects(tables.payment_breakdown_adjustments);

        const imported = {
            plans: 0,
            customers: 0,
            payment_entries: 0,
            tickets: 0,
            jobs: 0,
            sms_messages: 0,
            sms_automation_runs: 0,
            pon_nap_connections: 0,
            payment_breakdown_adjustments: 0
        };
        const duplicatesSkipped = { ...importIntegrity.duplicatesSkipped };
        const warnings = [...protectedHistoryFilter.warnings];
        const pushWarning = (message) => {
            if (!message) return;
            if (warnings.length >= 200) return;
            warnings.push(String(message));
        };

        if (isJsonStorageMode()) {
            try {
                const jsonResult = await importCustomerFullJsonData({ branchId, tables });
                Object.entries(jsonResult.duplicatesSkipped || {}).forEach(([tableName, count]) => {
                    duplicatesSkipped[tableName] = Number(duplicatesSkipped[tableName] || 0) + Number(count || 0);
                });
                const combinedWarnings = [...warnings, ...(jsonResult.warnings || [])].slice(0, 200);
                return res.json({
                    ok: true,
                    message: 'Import completed successfully.',
                    source: parsedImport.source,
                    imported: jsonResult.imported,
                    duplicatesSkipped,
                    duplicateCount: Object.values(duplicatesSkipped).reduce((total, count) => total + Number(count || 0), 0),
                    warnings: combinedWarnings,
                    warningCount: combinedWarnings.length
                });
            } catch (error) {
                console.error('Failed to import full customer data into JSON storage:', error);
                if (error?.code === 'CUSTOMER_FULL_IMPORT_CONFLICT') {
                    return res.status(409).json({
                        ok: false,
                        error: `${error.message} No records were changed.`,
                        conflicts: error.conflicts || [],
                        conflictCount: Array.isArray(error.conflicts) ? error.conflicts.length : 0
                    });
                }
                if (error?.code === 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT') {
                    return res.status(409).json({
                        ok: false,
                        code: error.code,
                        error: `${error.message} No records were changed.`,
                        conflicts: error.conflicts || [],
                        conflictCount: Array.isArray(error.conflicts) ? error.conflicts.length : 0
                    });
                }
                return res.status(500).json({ ok: false, error: 'Failed to import full customer data.' });
            }
        }

        const nowDateTime = toMysqlDateTime(new Date()) || new Date().toISOString().slice(0, 19).replace('T', ' ');
        const importedAccounts = new Set();
        const importedTicketIds = new Set();

        let connection = null;
        try {
            if (importFirstBillAdjustments.length) {
                await readJson('payment_breakdown_adjustments', {});
            }
            const pool = await getPool();
            if (!pool) {
                return res.status(503).json({
                    ok: false,
                    error: 'MySQL storage is selected, but no connection is available. Configure MySQL or set STORAGE_DRIVER=json and restart the server.'
                });
            }
            connection = await pool.getConnection();
            await ensurePaymentNumberingStore(connection);
            await connection.beginTransaction();

            for (const accountNumber of importedAccountNumbers) {
                await lockPaymentAccount(connection, branchId, accountNumber);
            }

            const lockedCustomerRows = [];
            for (const chunk of chunkArray(importedAccountNumbers, 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT account_number AS accountNumber, branch_id AS branchId
                     FROM customers
                     WHERE account_number IN (${placeholders})
                     FOR UPDATE`,
                    chunk
                );
                lockedCustomerRows.push(...(rows || []));
            }

            const lockedPaymentRowsById = new Map();
            const paymentSnapshotColumns = `
                id,
                branch_id AS branchId,
                account_number AS accountNumber,
                kind,
                direction,
                reference,
                description,
                type,
                payment_method AS paymentMethod,
                fingerprint`;
            for (const chunk of chunkArray(importedAccountNumbers, 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT ${paymentSnapshotColumns}
                     FROM payment_entries
                     WHERE account_number IN (${placeholders})
                     FOR UPDATE`,
                    chunk
                );
                (rows || []).forEach((row) => lockedPaymentRowsById.set(String(row.id || '').trim(), row));
            }
            for (const chunk of chunkArray(importedPaymentIds, 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT ${paymentSnapshotColumns}
                     FROM payment_entries
                     WHERE id IN (${placeholders})
                     FOR UPDATE`,
                    chunk
                );
                (rows || []).forEach((row) => lockedPaymentRowsById.set(String(row.id || '').trim(), row));
            }

            const lockedRelatedRecords = {
                tickets: [],
                jobs: [],
                sms_messages: [],
                sms_automation_runs: [],
                pon_nap_connections: []
            };
            const importedStableIds = (rows = []) => [...new Set(rows
                .map((row) => toNullableNumber(pickRowValue(row, ['id'])))
                .filter(Number.isFinite)
                .map((value) => Math.trunc(value))
                .filter((value) => value > 0))].sort((left, right) => left - right);
            const loadLockedRowsById = async (rows, queryPrefix, destination) => {
                for (const chunk of chunkArray(importedStableIds(rows), 200)) {
                    if (!chunk.length) continue;
                    const placeholders = chunk.map(() => '?').join(', ');
                    const [loadedRows] = await connection.query(
                        `${queryPrefix} (${placeholders}) FOR UPDATE`,
                        chunk
                    );
                    destination.push(...(loadedRows || []));
                }
            };
            await loadLockedRowsById(
                importTickets,
                `SELECT id, branch_id AS branchId, account_number AS accountNumber
                 FROM tickets WHERE id IN`,
                lockedRelatedRecords.tickets
            );
            await loadLockedRowsById(
                importJobs,
                `SELECT j.id, j.branch_id AS branchId,
                        COALESCE(j.customer_account_number, t.account_number) AS accountNumber,
                        j.ticket_id AS ticketId
                 FROM jobs j
                 LEFT JOIN tickets t ON t.id = j.ticket_id AND t.branch_id = j.branch_id
                 WHERE j.id IN`,
                lockedRelatedRecords.jobs
            );
            await loadLockedRowsById(
                importSmsMessages,
                `SELECT id, branch_id AS branchId, customer_account_number AS accountNumber
                 FROM sms_messages WHERE id IN`,
                lockedRelatedRecords.sms_messages
            );
            await loadLockedRowsById(
                importSmsAutomationRuns,
                `SELECT id, branch_id AS branchId, customer_account_number AS accountNumber
                 FROM sms_automation_runs WHERE id IN`,
                lockedRelatedRecords.sms_automation_runs
            );

            const lockedPonConnectionsById = new Map();
            for (const chunk of chunkArray(importedStableIds(importPonConnections), 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT c.id, c.nap_id AS napId, c.port,
                            c.customer_account_number AS accountNumber,
                            n.branch_id AS branchId
                     FROM pon_nap_connections c
                     INNER JOIN pon_naps n ON n.id = c.nap_id
                     WHERE c.id IN (${placeholders})
                     FOR UPDATE`,
                    chunk
                );
                (rows || []).forEach((row) => lockedPonConnectionsById.set(String(row.id || '').trim(), row));
            }
            const importedPonNapIds = [...new Set(importPonConnections
                .map((row) => toNullableNumber(pickRowValue(row, ['nap_id', 'napId'])))
                .filter(Number.isFinite)
                .map((value) => Math.trunc(value))
                .filter((value) => value > 0))].sort((left, right) => left - right);
            for (const chunk of chunkArray(importedPonNapIds, 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT c.id, c.nap_id AS napId, c.port,
                            c.customer_account_number AS accountNumber,
                            n.branch_id AS branchId
                     FROM pon_nap_connections c
                     INNER JOIN pon_naps n ON n.id = c.nap_id
                     WHERE n.branch_id = ? AND c.nap_id IN (${placeholders})
                     FOR UPDATE`,
                    [branchId, ...chunk]
                );
                (rows || []).forEach((row) => lockedPonConnectionsById.set(String(row.id || '').trim(), row));
            }
            lockedRelatedRecords.pon_nap_connections.push(...lockedPonConnectionsById.values());

            const storeTableName = resolveMysqlStoreTableName();
            await connection.query(
                `INSERT IGNORE INTO \`${storeTableName}\` (store_key, payload) VALUES (?, ?)`,
                ['closed_customer_accounts', JSON.stringify({ version: 1, branches: {} })]
            );
            const [closedAccountStoreRows] = await connection.query(
                `SELECT payload FROM \`${storeTableName}\` WHERE store_key = ? LIMIT 1 FOR UPDATE`,
                ['closed_customer_accounts']
            );
            let lockedClosedAccountStore;
            try {
                lockedClosedAccountStore = closedAccountStoreRows?.[0]?.payload
                    ? JSON.parse(closedAccountStoreRows[0].payload)
                    : { version: 1, branches: {} };
            } catch {
                throw new Error('The protected closed-account audit store is invalid; import stopped without changing records.');
            }
            if (
                !lockedClosedAccountStore
                || typeof lockedClosedAccountStore !== 'object'
                || Array.isArray(lockedClosedAccountStore)
                || !lockedClosedAccountStore.branches
                || typeof lockedClosedAccountStore.branches !== 'object'
                || Array.isArray(lockedClosedAccountStore.branches)
            ) {
                throw new Error('The protected closed-account audit store is invalid; import stopped without changing records.');
            }
            const lockedClosedAccountRecords = Object.entries(lockedClosedAccountStore.branches).flatMap(([storeBranchId, entry]) => (
                Array.isArray(entry?.records)
                    ? entry.records.map((record) => ({ ...record, _storeBranchId: storeBranchId }))
                    : []
            ));
            const lockedClosedAccountConflicts = findCustomerFullImportClosedAccountConflicts({
                branchId,
                tables,
                closedAccountRecords: lockedClosedAccountRecords,
                currentCustomers: lockedCustomerRows,
                currentPayments: [...lockedPaymentRowsById.values()],
                currentRelatedRecords: lockedRelatedRecords
            });
            // The outer preflight already stripped every known non-blocking
            // protected row. Any conflict still visible under these database
            // locks is either blocking or protection created by another app
            // instance after preflight, so fail closed before the first write.
            if (lockedClosedAccountConflicts.length) {
                const conflictError = new Error(
                    'Import stopped because it would modify records with protected closed-account history.'
                );
                conflictError.code = 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT';
                conflictError.status = 409;
                conflictError.conflicts = lockedClosedAccountConflicts;
                throw conflictError;
            }

            for (const row of importPlans) {
                const planId = toNonEmptyString(pickRowValue(row, ['plan_id', 'planId', 'id']));
                if (!planId) continue;
                const price = toNullableNumber(pickRowValue(row, ['price']));
                await connection.query(
                    `INSERT INTO plans (
                        branch_id, plan_id, name, label, category, description, profile,
                        price, price_suffix, validity, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        name = VALUES(name),
                        label = VALUES(label),
                        category = VALUES(category),
                        description = VALUES(description),
                        profile = VALUES(profile),
                        price = VALUES(price),
                        price_suffix = VALUES(price_suffix),
                        validity = VALUES(validity),
                        created_at = VALUES(created_at),
                        updated_at = VALUES(updated_at)`,
                    [
                        branchId,
                        planId,
                        toNullableString(pickRowValue(row, ['name'])),
                        toNullableString(pickRowValue(row, ['label'])),
                        toNullableString(pickRowValue(row, ['category'])),
                        toNullableString(pickRowValue(row, ['description'])),
                        toNullableString(pickRowValue(row, ['profile'])),
                        price,
                        '/ month',
                        null,
                        toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime,
                        toMysqlDateTime(pickRowValue(row, ['updated_at', 'updatedAt'])) || nowDateTime
                    ]
                );
                imported.plans += 1;
            }

            for (const row of importCustomers) {
                const accountNumber = toNonEmptyString(pickRowValue(row, ['account_number', 'accountNumber']));
                if (!accountNumber) continue;

                const firstName = toNullableString(pickRowValue(row, ['first_name', 'firstName']));
                const lastName = toNullableString(pickRowValue(row, ['last_name', 'lastName']));
                const explicitName = toNullableString(pickRowValue(row, ['name', 'customer_name', 'customerName']));
                const derivedName = explicitName || [firstName, lastName].filter(Boolean).join(' ').trim() || null;

                await connection.query(
                    `INSERT INTO customers (
                        account_number, branch_id, first_name, last_name, name, email, mobile, mobile_raw,
                        street, barangay, municipality, province, area, map_pin, status, remarks, since,
                        activation_date, plan_name, plan_amount, plan_billing, plan_category, bill_date, due_date, prepaid_expiration_at, due_offset,
                        credit_limit, login_username, login_password_hash, pppoe_mode, pppoe_username,
                        pppoe_password, pppoe_profile, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        first_name = VALUES(first_name),
                        last_name = VALUES(last_name),
                        name = VALUES(name),
                        email = VALUES(email),
                        mobile = VALUES(mobile),
                        mobile_raw = VALUES(mobile_raw),
                        street = VALUES(street),
                        barangay = VALUES(barangay),
                        municipality = VALUES(municipality),
                        province = VALUES(province),
                        area = VALUES(area),
                        map_pin = VALUES(map_pin),
                        status = VALUES(status),
                        remarks = VALUES(remarks),
                        since = VALUES(since),
                        activation_date = VALUES(activation_date),
                        plan_name = VALUES(plan_name),
                        plan_amount = VALUES(plan_amount),
                        plan_billing = VALUES(plan_billing),
                        plan_category = VALUES(plan_category),
                        bill_date = VALUES(bill_date),
                        due_date = VALUES(due_date),
                        prepaid_expiration_at = VALUES(prepaid_expiration_at),
                        due_offset = VALUES(due_offset),
                        credit_limit = VALUES(credit_limit),
                        login_username = VALUES(login_username),
                        login_password_hash = VALUES(login_password_hash),
                        pppoe_mode = VALUES(pppoe_mode),
                        pppoe_username = VALUES(pppoe_username),
                        pppoe_password = VALUES(pppoe_password),
                        pppoe_profile = VALUES(pppoe_profile),
                        created_at = VALUES(created_at),
                        updated_at = VALUES(updated_at)`,
                    [
                        accountNumber,
                        branchId,
                        firstName,
                        lastName,
                        derivedName,
                        toNullableString(pickRowValue(row, ['email'])),
                        toNullableString(pickRowValue(row, ['mobile'])),
                        toNullableString(pickRowValue(row, ['mobile_raw', 'mobileRaw'])),
                        toNullableString(pickRowValue(row, ['street'])),
                        toNullableString(pickRowValue(row, ['barangay'])),
                        toNullableString(pickRowValue(row, ['municipality'])),
                        toNullableString(pickRowValue(row, ['province'])),
                        toNullableString(pickRowValue(row, ['area'])),
                        toNullableString(pickRowValue(row, ['map_pin', 'mapPin'])),
                        toNullableString(pickRowValue(row, ['status'])),
                        toNullableString(pickRowValue(row, ['remarks'])),
                        toNullableString(pickRowValue(row, ['since'])),
                        toMysqlDateOnly(pickRowValue(row, ['activation_date', 'activationDate'])),
                        toNullableString(pickRowValue(row, ['plan_name', 'planName'])),
                        toNullableNumber(pickRowValue(row, ['plan_amount', 'planAmount'])),
                        toNullableString(pickRowValue(row, ['plan_billing', 'planBilling'])),
                        toNullableString(pickRowValue(row, ['plan_category', 'planCategory'])),
                        toMysqlDateOnly(pickRowValue(row, ['bill_date', 'billDate'])),
                        toMysqlDateOnly(pickRowValue(row, ['due_date', 'dueDate'])),
                        toMysqlDateTime(pickRowValue(row, ['prepaid_expiration_at', 'prepaidExpirationAt', 'expiry_datetime', 'expiryDateTime'])),
                        (() => {
                            const value = toNullableNumber(pickRowValue(row, ['due_offset', 'dueOffset']));
                            return Number.isFinite(value) ? Math.trunc(value) : null;
                        })(),
                        toNullableNumber(pickRowValue(row, ['credit_limit', 'creditLimit'])),
                        toNullableString(pickRowValue(row, ['login_username', 'loginUsername'])),
                        toNullableString(pickRowValue(row, ['login_password_hash', 'loginPassword', 'login_password'])),
                        toNullableString(pickRowValue(row, ['pppoe_mode', 'pppoeMode'])),
                        toNullableString(pickRowValue(row, ['pppoe_username', 'pppoeUsername'])),
                        toNullableString(pickRowValue(row, ['pppoe_password', 'pppoePassword'])),
                        toNullableString(pickRowValue(row, ['pppoe_profile', 'pppoeProfile'])),
                        toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime,
                        toMysqlDateTime(pickRowValue(row, ['updated_at', 'updatedAt'])) || nowDateTime
                    ]
                );
                importedAccounts.add(accountNumber);
                imported.customers += 1;
            }

            const referencedAccounts = new Set();
            importPayments.forEach((row) => {
                const account = toNonEmptyString(pickRowValue(row, ['account_number', 'accountNumber']));
                if (account) referencedAccounts.add(account);
            });
            importSmsMessages.forEach((row) => {
                const account = toNonEmptyString(pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber']));
                if (account) referencedAccounts.add(account);
            });
            importSmsAutomationRuns.forEach((row) => {
                const account = toNonEmptyString(pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber']));
                if (account) referencedAccounts.add(account);
            });
            importPonConnections.forEach((row) => {
                const account = toNonEmptyString(pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber']));
                if (account) referencedAccounts.add(account);
            });
            importFirstBillAdjustments.forEach((row) => {
                const account = toNonEmptyString(pickRowValue(row, ['account_number', 'accountNumber', 'customer_account_number', 'customerAccountNumber']));
                if (account) referencedAccounts.add(account);
            });

            const toCheck = [...referencedAccounts].filter((account) => !importedAccounts.has(account));
            for (const chunk of chunkArray(toCheck, 200)) {
                if (!chunk.length) continue;
                const placeholders = chunk.map(() => '?').join(', ');
                const [rows] = await connection.query(
                    `SELECT account_number FROM customers WHERE branch_id = ? AND account_number IN (${placeholders})`,
                    [branchId, ...chunk]
                );
                (rows || []).forEach((row) => importedAccounts.add(String(row.account_number || '').trim()));
            }

            if (importFirstBillAdjustments.length) {
                const storeTableName = resolveMysqlStoreTableName();
                await connection.query(
                    `INSERT IGNORE INTO \`${storeTableName}\` (store_key, payload) VALUES (?, ?)`,
                    ['payment_breakdown_adjustments', '{}']
                );
                const [storeRows] = await connection.query(
                    `SELECT payload FROM \`${storeTableName}\` WHERE store_key = ? LIMIT 1 FOR UPDATE`,
                    ['payment_breakdown_adjustments']
                );
                let storedAdjustments = {};
                try {
                    storedAdjustments = storeRows?.[0]?.payload
                        ? JSON.parse(storeRows[0].payload)
                        : {};
                } catch {
                    throw new Error('The existing first-bill adjustment store is invalid; import stopped without changing records.');
                }
                const firstBillMerge = mergeFirstBillAdjustmentRows({
                    adjustments: storedAdjustments,
                    branchId,
                    rows: importFirstBillAdjustments,
                    validAccountNumbers: [...importedAccounts],
                    now: new Date(`${nowDateTime.replace(' ', 'T')}Z`)
                });
                imported.payment_breakdown_adjustments = firstBillMerge.imported;
                duplicatesSkipped.payment_breakdown_adjustments = Number(
                    duplicatesSkipped.payment_breakdown_adjustments || 0
                ) + firstBillMerge.skipped;
                firstBillMerge.warnings.forEach(pushWarning);
                if (firstBillMerge.imported) {
                    await connection.query(
                        `INSERT INTO \`${storeTableName}\` (store_key, payload)
                         VALUES (?, ?)
                         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
                        ['payment_breakdown_adjustments', JSON.stringify(firstBillMerge.adjustments)]
                    );
                }
            }

            const [existingPaymentIdentityRows] = await connection.query(
                `SELECT id, fingerprint, xendit_id
                 FROM payment_entries
                 WHERE branch_id = ?
                   AND (
                       (fingerprint IS NOT NULL AND fingerprint <> '')
                       OR (xendit_id IS NOT NULL AND xendit_id <> '')
                   )`,
                [branchId]
            );
            const existingPaymentAliases = new Map();
            (existingPaymentIdentityRows || []).forEach((entry) => {
                const existingId = toNonEmptyString(entry?.id);
                getCustomerFullPaymentSecondaryAliases(entry).forEach(({ alias, type }) => {
                    if (!existingPaymentAliases.has(alias)) {
                        existingPaymentAliases.set(alias, { id: existingId, type });
                    }
                });
            });

            for (const row of importPayments) {
                const paymentId = toNonEmptyString(pickRowValue(row, ['id']));
                const accountNumber = toNonEmptyString(pickRowValue(row, ['account_number', 'accountNumber']));
                if (!paymentId || !accountNumber) continue;
                if (!importedAccounts.has(accountNumber)) {
                    pushWarning(`Skipped payment ${paymentId}: customer ${accountNumber} not found in branch ${branchId}.`);
                    continue;
                }
                const duplicateIdentity = getCustomerFullPaymentSecondaryAliases(row)
                    .map(({ alias, type }) => ({ existing: existingPaymentAliases.get(alias), type }))
                    .find(({ existing }) => existing && existing.id !== paymentId);
                if (duplicateIdentity) {
                    duplicatesSkipped.payment_entries += 1;
                    pushWarning(
                        `Skipped duplicate payment ${paymentId}: ${duplicateIdentity.type} already belongs to another payment.`
                    );
                    continue;
                }

                await connection.query(
                    `INSERT INTO payment_entries (
                        id, branch_id, account_number, amount, date, kind, direction, reference, or_number, description,
                        type, recorded_at, recorded_by_user_id, recorded_by_username, recorded_by_name,
                        recorded_by_role, payer, status, payment_method, fingerprint, xendit_id
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        branch_id = VALUES(branch_id),
                        account_number = VALUES(account_number),
                        amount = VALUES(amount),
                        date = VALUES(date),
                        kind = VALUES(kind),
                        direction = VALUES(direction),
                        reference = VALUES(reference),
                        or_number = VALUES(or_number),
                        description = VALUES(description),
                        type = VALUES(type),
                        recorded_at = VALUES(recorded_at),
                        recorded_by_user_id = VALUES(recorded_by_user_id),
                        recorded_by_username = VALUES(recorded_by_username),
                        recorded_by_name = VALUES(recorded_by_name),
                        recorded_by_role = VALUES(recorded_by_role),
                        payer = VALUES(payer),
                        status = VALUES(status),
                        payment_method = VALUES(payment_method),
                        fingerprint = VALUES(fingerprint),
                        xendit_id = VALUES(xendit_id)`,
                    [
                        paymentId,
                        branchId,
                        accountNumber,
                        toNullableNumber(pickRowValue(row, ['amount'])) ?? 0,
                        toMysqlDateOnly(pickRowValue(row, ['date'])),
                        toNullableString(pickRowValue(row, ['kind'])),
                        toNullableString(pickRowValue(row, ['direction'])),
                        toNullableString(pickRowValue(row, ['reference'])),
                        toNullableString(pickRowValue(row, ['or_number', 'orNumber'])),
                        toNullableString(pickRowValue(row, ['description'])),
                        toNullableString(pickRowValue(row, ['type'])),
                        toMysqlDateTime(pickRowValue(row, ['recorded_at', 'recordedAt'])) || null,
                        toNullableString(pickRowValue(row, ['recorded_by_user_id', 'recordedByUserId'])),
                        toNullableString(pickRowValue(row, ['recorded_by_username', 'recordedByUsername'])),
                        toNullableString(pickRowValue(row, ['recorded_by_name', 'recordedByName'])),
                        toNullableString(pickRowValue(row, ['recorded_by_role', 'recordedByRole'])),
                        toNullableString(pickRowValue(row, ['payer'])),
                        toNullableString(pickRowValue(row, ['status'])),
                        toNullableString(pickRowValue(row, ['payment_method', 'paymentMethod'])),
                        toNullableString(pickRowValue(row, ['fingerprint'])),
                        toNullableString(pickRowValue(row, ['xendit_id', 'xenditId']))
                    ]
                );
                getCustomerFullPaymentSecondaryAliases(row).forEach(({ alias, type }) => {
                    existingPaymentAliases.set(alias, { id: paymentId, type });
                });
                imported.payment_entries += 1;
            }

            for (const row of importTickets) {
                const ticketIdRaw = toNullableNumber(pickRowValue(row, ['id']));
                if (!Number.isFinite(ticketIdRaw)) continue;
                const ticketId = Math.trunc(ticketIdRaw);
                if (ticketId <= 0) continue;

                const createdAt = toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime;
                const updatedAt = toMysqlDateTime(pickRowValue(row, ['updated_at', 'updatedAt'])) || createdAt;

                await connection.query(
                    `INSERT INTO tickets (
                        id, branch_id, subject, description, customer_name, account_number, contact,
                        status, assigned_to, source, created_at, updated_at, history_job_id, history_job_created_at, ticket_number
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        branch_id = VALUES(branch_id),
                        subject = VALUES(subject),
                        description = VALUES(description),
                        customer_name = VALUES(customer_name),
                        account_number = VALUES(account_number),
                        contact = VALUES(contact),
                        status = VALUES(status),
                        assigned_to = VALUES(assigned_to),
                        source = VALUES(source),
                        created_at = VALUES(created_at),
                        updated_at = VALUES(updated_at),
                        history_job_id = VALUES(history_job_id),
                        history_job_created_at = VALUES(history_job_created_at),
                        ticket_number = VALUES(ticket_number)`,
                    [
                        ticketId,
                        branchId,
                        toNullableString(pickRowValue(row, ['subject'])),
                        toNullableString(pickRowValue(row, ['description'])),
                        toNullableString(pickRowValue(row, ['customer_name', 'customerName'])),
                        toNullableString(pickRowValue(row, ['account_number', 'accountNumber'])),
                        toNullableString(pickRowValue(row, ['contact'])),
                        toNullableString(pickRowValue(row, ['status'])),
                        toNullableString(pickRowValue(row, ['assigned_to', 'assignedTo'])),
                        toNullableString(pickRowValue(row, ['source'])),
                        createdAt,
                        updatedAt,
                        (() => {
                            const value = toNullableNumber(pickRowValue(row, ['history_job_id', 'historyJobId']));
                            return Number.isFinite(value) ? Math.trunc(value) : null;
                        })(),
                        toMysqlDateTime(pickRowValue(row, ['history_job_created_at', 'historyJobCreatedAt'])),
                        toNullableString(pickRowValue(row, ['ticket_number', 'ticketNumber']))
                    ]
                );
                importedTicketIds.add(ticketId);
                imported.tickets += 1;
            }

            for (const row of importJobs) {
                const jobIdRaw = toNullableNumber(pickRowValue(row, ['id']));
                if (!Number.isFinite(jobIdRaw)) continue;
                const jobId = Math.trunc(jobIdRaw);
                if (jobId <= 0) continue;

                const ticketIdRaw = toNullableNumber(pickRowValue(row, ['ticket_id', 'ticketId']));
                const ticketId = Number.isFinite(ticketIdRaw) ? Math.trunc(ticketIdRaw) : null;
                const safeTicketId = ticketId && importedTicketIds.has(ticketId) ? ticketId : null;

                const createdAt = toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime;
                const updatedAt = toMysqlDateTime(pickRowValue(row, ['updated_at', 'updatedAt'])) || createdAt;
                const importedTechnician = toNullableString(pickRowValue(row, ['technician']));
                const importedStatus = toNullableString(pickRowValue(row, ['status'])) || 'scheduled';
                const workflowInput = toNonEmptyString(pickRowValue(row, ['workflow_status', 'workflowStatus']))
                    .toLowerCase()
                    .replace(/[\s-]+/g, '_');
                const validWorkflowStatuses = new Set([
                    'unassigned', 'assigned', 'accepted', 'traveling', 'on_site', 'completed',
                    'failed', 'rescheduled', 'needs_team', 'rejected', 'cancelled'
                ]);
                const importedWorkflowStatus = validWorkflowStatuses.has(workflowInput)
                    ? workflowInput
                    : ['done', 'closed', 'resolved', 'completed'].includes(importedStatus.toLowerCase())
                        ? 'completed'
                        : importedTechnician ? 'assigned' : 'unassigned';
                const rawDispatchPayload = pickRowValue(row, ['dispatch_payload_json', 'dispatchPayloadJson', 'dispatchPayload']);
                const dispatchPayloadJson = rawDispatchPayload && typeof rawDispatchPayload === 'object'
                    ? JSON.stringify(rawDispatchPayload)
                    : toNullableString(rawDispatchPayload);
                const recordVersion = Math.max(
                    1,
                    Math.trunc(toNullableNumber(pickRowValue(row, ['record_version', 'version'])) || 1)
                );

                await connection.query(
                    `INSERT INTO jobs (
                        id, branch_id, type, technician, priority, schedule, appointment_end, sla_due_at,
                        status, workflow_status, done_at, notes, description,
                        customer_account_number, customer_name, customer_phone, service_address,
                        latitude, longitude, plan_name, dispatch_payload_json, record_version,
                        created_at, updated_at, ticket_id, ticket_number, ticket_subject, origin
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        branch_id = VALUES(branch_id),
                        type = VALUES(type),
                        technician = VALUES(technician),
                        priority = VALUES(priority),
                        schedule = VALUES(schedule),
                        appointment_end = VALUES(appointment_end),
                        sla_due_at = VALUES(sla_due_at),
                        status = VALUES(status),
                        workflow_status = VALUES(workflow_status),
                        done_at = VALUES(done_at),
                        notes = VALUES(notes),
                        description = VALUES(description),
                        customer_account_number = VALUES(customer_account_number),
                        customer_name = VALUES(customer_name),
                        customer_phone = VALUES(customer_phone),
                        service_address = VALUES(service_address),
                        latitude = VALUES(latitude),
                        longitude = VALUES(longitude),
                        plan_name = VALUES(plan_name),
                        dispatch_payload_json = VALUES(dispatch_payload_json),
                        record_version = VALUES(record_version),
                        created_at = VALUES(created_at),
                        updated_at = VALUES(updated_at),
                        ticket_id = VALUES(ticket_id),
                        ticket_number = VALUES(ticket_number),
                        ticket_subject = VALUES(ticket_subject),
                        origin = VALUES(origin)`,
                    [
                        jobId,
                        branchId,
                        toNullableString(pickRowValue(row, ['type'])),
                        importedTechnician,
                        toNullableString(pickRowValue(row, ['priority'])),
                        toMysqlDateTime(pickRowValue(row, ['schedule', 'appointment_start', 'appointmentStart'])),
                        toMysqlDateTime(pickRowValue(row, ['appointment_end', 'appointmentEnd'])),
                        toMysqlDateTime(pickRowValue(row, ['sla_due_at', 'slaDueAt'])),
                        importedStatus,
                        importedWorkflowStatus,
                        toMysqlDateTime(pickRowValue(row, ['done_at', 'doneAt'])),
                        toNullableString(pickRowValue(row, ['notes'])),
                        toNullableString(pickRowValue(row, ['description'])),
                        toNullableString(pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber'])),
                        toNullableString(pickRowValue(row, ['customer_name', 'customerName'])),
                        toNullableString(pickRowValue(row, ['customer_phone', 'customerPhone', 'contact'])),
                        toNullableString(pickRowValue(row, ['service_address', 'serviceAddress', 'address'])),
                        toNullableNumber(pickRowValue(row, ['latitude'])),
                        toNullableNumber(pickRowValue(row, ['longitude'])),
                        toNullableString(pickRowValue(row, ['plan_name', 'planName'])),
                        dispatchPayloadJson,
                        recordVersion,
                        createdAt,
                        updatedAt,
                        safeTicketId,
                        toNullableString(pickRowValue(row, ['ticket_number', 'ticketNumber'])),
                        toNullableString(pickRowValue(row, ['ticket_subject', 'ticketSubject'])),
                        toNullableString(pickRowValue(row, ['origin']))
                    ]
                );
                imported.jobs += 1;
            }

            for (const row of importSmsMessages) {
                const messageIdRaw = toNullableNumber(pickRowValue(row, ['id']));
                if (!Number.isFinite(messageIdRaw)) continue;
                const messageId = Math.trunc(messageIdRaw);
                if (messageId <= 0) continue;

                const accountRef = toNonEmptyString(
                    pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber'])
                );
                const customerAccount = accountRef && importedAccounts.has(accountRef) ? accountRef : null;
                const recipient = toNonEmptyString(pickRowValue(row, ['recipient'])) || customerAccount || `customer-${messageId}`;
                const messageText = toNonEmptyString(pickRowValue(row, ['message_text', 'messageText'])) || '(imported message)';
                const status = toNonEmptyString(pickRowValue(row, ['status'])) || 'queued';

                await connection.query(
                    `INSERT INTO sms_messages (
                        id, branch_id, schedule_id, provider, recipient, recipient_label, customer_account_number,
                        recipient_area, sender_name, message_text, status, provider_message_id, provider_response,
                        error_message, created_by_user_id, created_by_username, created_at
                     ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        branch_id = VALUES(branch_id),
                        schedule_id = VALUES(schedule_id),
                        provider = VALUES(provider),
                        recipient = VALUES(recipient),
                        recipient_label = VALUES(recipient_label),
                        customer_account_number = VALUES(customer_account_number),
                        recipient_area = VALUES(recipient_area),
                        sender_name = VALUES(sender_name),
                        message_text = VALUES(message_text),
                        status = VALUES(status),
                        provider_message_id = VALUES(provider_message_id),
                        provider_response = VALUES(provider_response),
                        error_message = VALUES(error_message),
                        created_by_user_id = VALUES(created_by_user_id),
                        created_by_username = VALUES(created_by_username),
                        created_at = VALUES(created_at)`,
                    [
                        messageId,
                        branchId,
                        toNonEmptyString(pickRowValue(row, ['provider'])) || 'semaphore',
                        recipient,
                        toNullableString(pickRowValue(row, ['recipient_label', 'recipientLabel'])),
                        customerAccount,
                        toNullableString(pickRowValue(row, ['recipient_area', 'recipientArea'])),
                        toNullableString(pickRowValue(row, ['sender_name', 'senderName'])),
                        messageText,
                        status,
                        toNullableString(pickRowValue(row, ['provider_message_id', 'providerMessageId'])),
                        toNullableString(pickRowValue(row, ['provider_response', 'providerResponse'])),
                        toNullableString(pickRowValue(row, ['error_message', 'errorMessage'])),
                        toNullableString(pickRowValue(row, ['created_by_username', 'createdByUsername'])),
                        toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime
                    ]
                );
                imported.sms_messages += 1;
            }

            if (importPonConnections.length) {
                const napIdCandidates = [...new Set(
                    importPonConnections
                        .map((row) => {
                            const raw = toNullableNumber(pickRowValue(row, ['nap_id', 'napId']));
                            return Number.isFinite(raw) ? Math.trunc(raw) : null;
                        })
                        .filter((value) => Number.isInteger(value) && value > 0)
                )];
                const existingNapIds = new Set();
                for (const chunk of chunkArray(napIdCandidates, 200)) {
                    if (!chunk.length) continue;
                    const placeholders = chunk.map(() => '?').join(', ');
                    const [rows] = await connection.query(
                        `SELECT id FROM pon_naps WHERE branch_id = ? AND id IN (${placeholders})`,
                        [branchId, ...chunk]
                    );
                    (rows || []).forEach((entry) => existingNapIds.add(Number(entry.id)));
                }

                for (const row of importPonConnections) {
                    const connectionIdRaw = toNullableNumber(pickRowValue(row, ['id']));
                    if (!Number.isFinite(connectionIdRaw)) continue;
                    const connectionId = Math.trunc(connectionIdRaw);
                    if (connectionId <= 0) continue;

                    const napIdRaw = toNullableNumber(pickRowValue(row, ['nap_id', 'napId']));
                    const napId = Number.isFinite(napIdRaw) ? Math.trunc(napIdRaw) : null;
                    if (!napId || !existingNapIds.has(napId)) {
                        pushWarning(`Skipped PON connection ${connectionId}: NAP is missing in this branch.`);
                        continue;
                    }

                    const portRaw = toNullableNumber(pickRowValue(row, ['port']));
                    const port = Number.isFinite(portRaw) ? Math.trunc(portRaw) : null;
                    if (!port || port <= 0) {
                        pushWarning(`Skipped PON connection ${connectionId}: port is invalid.`);
                        continue;
                    }

                    const accountRef = toNonEmptyString(
                        pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber'])
                    );
                    const customerAccount = accountRef && importedAccounts.has(accountRef) ? accountRef : null;

                    await connection.query(
                        `INSERT INTO pon_nap_connections (
                            id, nap_id, customer_account_number, customer_name, customer_ref,
                            port, optical_info, created_at, updated_at
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            nap_id = VALUES(nap_id),
                            customer_account_number = VALUES(customer_account_number),
                            customer_name = VALUES(customer_name),
                            customer_ref = VALUES(customer_ref),
                            port = VALUES(port),
                            optical_info = VALUES(optical_info),
                            created_at = VALUES(created_at),
                            updated_at = VALUES(updated_at)`,
                        [
                            connectionId,
                            napId,
                            customerAccount,
                            toNullableString(pickRowValue(row, ['customer_name', 'customerName'])),
                            toNullableString(pickRowValue(row, ['customer_ref', 'customerRef'])),
                            port,
                            toNullableString(pickRowValue(row, ['optical_info', 'opticalInfo'])),
                            toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime,
                            toMysqlDateTime(pickRowValue(row, ['updated_at', 'updatedAt'])) || nowDateTime
                        ]
                    );
                    imported.pon_nap_connections += 1;
                }
            }

            if (importSmsAutomationRuns.length) {
                const automationIdCandidates = [...new Set(
                    importSmsAutomationRuns
                        .map((row) => {
                            const raw = toNullableNumber(pickRowValue(row, ['automation_id', 'automationId']));
                            return Number.isFinite(raw) ? Math.trunc(raw) : null;
                        })
                        .filter((value) => Number.isInteger(value) && value > 0)
                )];
                const existingAutomationIds = new Set();
                for (const chunk of chunkArray(automationIdCandidates, 200)) {
                    if (!chunk.length) continue;
                    const placeholders = chunk.map(() => '?').join(', ');
                    const [rows] = await connection.query(
                        `SELECT id FROM sms_automations WHERE branch_id = ? AND id IN (${placeholders})`,
                        [branchId, ...chunk]
                    );
                    (rows || []).forEach((entry) => existingAutomationIds.add(Number(entry.id)));
                }

                for (const row of importSmsAutomationRuns) {
                    const runIdRaw = toNullableNumber(pickRowValue(row, ['id']));
                    if (!Number.isFinite(runIdRaw)) continue;
                    const runId = Math.trunc(runIdRaw);
                    if (runId <= 0) continue;

                    const automationIdRaw = toNullableNumber(pickRowValue(row, ['automation_id', 'automationId']));
                    const automationId = Number.isFinite(automationIdRaw) ? Math.trunc(automationIdRaw) : null;
                    if (!automationId || !existingAutomationIds.has(automationId)) {
                        pushWarning(`Skipped automation run ${runId}: automation is missing in this branch.`);
                        continue;
                    }

                    const accountRef = toNonEmptyString(
                        pickRowValue(row, ['customer_account_number', 'customerAccountNumber', 'account_number', 'accountNumber'])
                    );
                    const customerAccount = accountRef && importedAccounts.has(accountRef) ? accountRef : null;
                    const deliveryMethod = toNonEmptyString(pickRowValue(row, ['delivery_method', 'deliveryMethod'])) || 'sms';
                    const status = toNonEmptyString(pickRowValue(row, ['status'])) || 'pending';
                    const payloadValue = pickRowValue(row, ['payload']);
                    const payloadText = payloadValue == null || payloadValue === ''
                        ? null
                        : (typeof payloadValue === 'string' ? payloadValue : JSON.stringify(payloadValue));

                    await connection.query(
                        `INSERT INTO sms_automation_runs (
                            id, automation_id, branch_id, customer_account_number, recipient, delivery_method,
                            status, error_message, payload, created_at
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            automation_id = VALUES(automation_id),
                            branch_id = VALUES(branch_id),
                            customer_account_number = VALUES(customer_account_number),
                            recipient = VALUES(recipient),
                            delivery_method = VALUES(delivery_method),
                            status = VALUES(status),
                            error_message = VALUES(error_message),
                            payload = VALUES(payload),
                            created_at = VALUES(created_at)`,
                        [
                            runId,
                            automationId,
                            branchId,
                            customerAccount,
                            toNullableString(pickRowValue(row, ['recipient'])),
                            deliveryMethod,
                            status,
                            toNullableString(pickRowValue(row, ['error_message', 'errorMessage'])),
                            payloadText,
                            toMysqlDateTime(pickRowValue(row, ['created_at', 'createdAt'])) || nowDateTime
                        ]
                    );
                    imported.sms_automation_runs += 1;
                }
            }

            await connection.commit();
            return res.json({
                ok: true,
                message: 'Import completed successfully.',
                source: parsedImport.source,
                imported,
                duplicatesSkipped,
                duplicateCount: Object.values(duplicatesSkipped).reduce((total, count) => total + Number(count || 0), 0),
                warnings,
                warningCount: warnings.length
            });
        } catch (error) {
            if (connection) {
                try {
                    await connection.rollback();
                } catch {
                    // ignore rollback errors
                }
            }
            console.error('Failed to import full customer data:', error);
            if (error?.code === 'CUSTOMER_FULL_IMPORT_PROTECTED_CLOSED_ACCOUNT') {
                return res.status(409).json({
                    ok: false,
                    code: error.code,
                    error: `${error.message} No records were changed.`,
                    conflicts: error.conflicts || [],
                    conflictCount: Array.isArray(error.conflicts) ? error.conflicts.length : 0
                });
            }
            return res.status(500).json({ ok: false, error: 'Failed to import full customer data.' });
        } finally {
            if (connection) connection.release();
        }
    }
);

app.get('/api/statements/account/:accountNumber/pdf', requireStatementAccess, async (req, res) => {
    const accountNumber = String(req.params.accountNumber || '').trim();
    if (!accountNumber) {
        return res.status(400).json({ error: 'Account number is required' });
    }
    if (req.customer) {
        const customerAccount = String(req.customer.accountNumber || '').trim();
        if (!customerAccount || customerAccount !== accountNumber) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    try {
        if (!puppeteerModule) {
            puppeteerModule = require('puppeteer');
        }
    } catch (error) {
        return res.status(500).json({ error: 'PDF generator not installed. Run npm install puppeteer.' });
    }

    const baseUrl = getBaseUrl(req);
    const scopeBranchId = req.customer?.branchId || req.user?.branchId || null;
    const statementDataToken = await getStatementDataToken(accountNumber, scopeBranchId);
    const freshToken = getRequestFreshToken(req);
    const targetUrl = `${baseUrl}/account-statement.html?account=${encodeURIComponent(accountNumber)}&pdf=1&v=${encodeURIComponent(statementDataToken)}&download=${encodeURIComponent(freshToken || Date.now())}`;
    const cookieHeader = req.upstreamSession?.cookie || req.headers.cookie || '';
    const cookieMap = parseCookieHeader(cookieHeader);
    const cookies = Object.entries(cookieMap).map(([name, value]) => ({
        name,
        value,
        url: baseUrl
    }));

    const templateToken = getTemplateVersionToken('account-statement.html');
    const scopeKey = String(scopeBranchId || 'all');
    const cacheKey = `account-${scopeKey}-${accountNumber}-${statementDataToken}-${STATEMENT_PDF_LAYOUT_VERSION}-${templateToken}`;
    const downloadFilename = buildUniquePdfFilename('account-statement', accountNumber);
    const cached = freshToken ? null : getCachedPdf(cacheKey);
    if (cached) {
        return sendPdfResponse(res, cached, downloadFilename);
    }

    let browser;
    try {
        browser = await getPdfBrowser();
        const page = await browser.newPage();
        await page.setViewport(STATEMENT_PDF_VIEWPORT);
        if (typeof page.emulateTimezone === 'function') {
            await page.emulateTimezone(STATEMENT_PDF_TIME_ZONE).catch(() => {});
        }
        await page.setCacheEnabled(false);
        if (cookies.length) {
            await page.setCookie(...cookies);
        }
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await waitForStatementReady(page);
        await page.emulateMediaType('print');

        const pdfBuffer = await page.pdf({
            printBackground: true,
            preferCSSPageSize: true
        });
        await page.close();

        if (!freshToken) {
            setCachedPdf(cacheKey, pdfBuffer);
        }
        return sendPdfResponse(res, pdfBuffer, downloadFilename);
    } catch (error) {
        console.error('PDF generation failed:', error);
        return res.status(500).json({ error: 'Failed to generate PDF' });
    } finally {
        // Keep browser warm to reduce subsequent latency.
    }
});

app.get('/api/statements/billing/:accountNumber/pdf', requireStatementAccess, async (req, res) => {
    const accountNumber = String(req.params.accountNumber || '').trim();
    if (!accountNumber) {
        return res.status(400).json({ error: 'Account number is required' });
    }
    if (req.customer) {
        const customerAccount = String(req.customer.accountNumber || '').trim();
        if (!customerAccount || customerAccount !== accountNumber) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }

    try {
        if (!puppeteerModule) {
            puppeteerModule = require('puppeteer');
        }
    } catch (error) {
        return res.status(500).json({ error: 'PDF generator not installed. Run npm install puppeteer.' });
    }

    const baseUrl = getBaseUrl(req);
    const scopeBranchId = req.customer?.branchId || req.user?.branchId || null;
    const statementDataToken = await getStatementDataToken(accountNumber, scopeBranchId);
    const templatePage = 'billing-statement.html';
    const freshToken = getRequestFreshToken(req);
    const targetUrl = `${baseUrl}/${templatePage}?account=${encodeURIComponent(accountNumber)}&pdf=1&v=${encodeURIComponent(statementDataToken)}&download=${encodeURIComponent(freshToken || Date.now())}`;
    const cookieHeader = req.upstreamSession?.cookie || req.headers.cookie || '';
    const cookieMap = parseCookieHeader(cookieHeader);
    const cookies = Object.entries(cookieMap).map(([name, value]) => ({
        name,
        value,
        url: baseUrl
    }));

    const templateToken = getTemplateVersionToken(templatePage);
    const scopeKey = String(scopeBranchId || 'all');
    const cacheKey = `billing-${scopeKey}-${accountNumber}-${statementDataToken}-${STATEMENT_PDF_LAYOUT_VERSION}-billing-layout-${templateToken}`;
    const downloadFilename = buildUniquePdfFilename('billing-statement', accountNumber);
    const cached = freshToken ? null : getCachedPdf(cacheKey);
    if (cached) {
        return sendPdfResponse(res, cached, downloadFilename);
    }

    let browser;
    try {
        browser = await getPdfBrowser();
        const page = await browser.newPage();
        await page.setViewport(STATEMENT_PDF_VIEWPORT);
        if (typeof page.emulateTimezone === 'function') {
            await page.emulateTimezone(STATEMENT_PDF_TIME_ZONE).catch(() => {});
        }
        await page.setCacheEnabled(false);
        if (cookies.length) {
            await page.setCookie(...cookies);
        }
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await waitForStatementReady(page);
        await page.emulateMediaType('print');

        const pdfBuffer = await page.pdf({
            printBackground: true,
            preferCSSPageSize: true
        });
        await page.close();

        if (!freshToken) {
            setCachedPdf(cacheKey, pdfBuffer);
        }
        return sendPdfResponse(res, pdfBuffer, downloadFilename);
    } catch (error) {
        console.error('PDF generation failed:', error);
        return res.status(500).json({ error: 'Failed to generate PDF' });
    } finally {
        // Keep browser warm to reduce subsequent latency.
    }
});

// --- Activity Log API ---
app.get('/api/activity-log', requireAuth, async (req, res) => {
    try {
        const logs = await loadActivityLog();
        res.json({ ok: true, logs });
    } catch (error) {
        console.error('Failed to load activity log:', error);
        res.status(500).json({ ok: false, error: 'Failed to load activity log' });
    }
});

app.post('/api/activity-log', requireAuth, async (req, res) => {
    const { message, meta } = req.body || {};
    if (!message || !String(message).trim()) {
        return res.status(400).json({ ok: false, error: 'Message is required' });
    }
    try {
        const entry = await appendActivityLog({
            message: String(message).trim().slice(0, 300),
            meta: meta ? String(meta).trim().slice(0, 200) : '',
            userId: req.user?.id,
            username: req.user?.username
        });
        res.json({ ok: true, entry });
    } catch (error) {
        console.error('Failed to append activity log:', error);
        res.status(500).json({ ok: false, error: 'Failed to record activity' });
    }
});

app.delete('/api/activity-log', requireAuth, async (req, res) => {
    try {
        await clearActivityLog();
        res.json({ ok: true });
    } catch (error) {
        console.error('Failed to clear activity log:', error);
        res.status(500).json({ ok: false, error: 'Failed to clear activity log' });
    }
});

// --- Dashboard API Endpoints ---
// Collection breakdown data for dashboard
app.get('/api/dashboard/collection-breakdown', requireAuth, async (req, res) => {
    try {
        // Sample data - in a real app, this would come from database
        const collectionData = [
            {
                month: 'Oct 2025',
                billed: 9491.00,
                collected: 9491.00,
                collectionRate: 100.0,
                growth: 5.2,
                outstanding: 0.00
            },
            {
                month: 'Sep 2025',
                billed: 9020.00,
                collected: 8950.00,
                collectionRate: 99.2,
                growth: 3.1,
                outstanding: 70.00
            },
            {
                month: 'Aug 2025',
                billed: 8750.00,
                collected: 8680.00,
                collectionRate: 99.2,
                growth: 2.8,
                outstanding: 70.00
            },
            {
                month: 'Jul 2025',
                billed: 8520.00,
                collected: 8460.00,
                collectionRate: 99.3,
                growth: 1.9,
                outstanding: 60.00
            },
            {
                month: 'Jun 2025',
                billed: 8360.00,
                collected: 8300.00,
                collectionRate: 99.3,
                growth: 2.4,
                outstanding: 60.00
            },
            {
                month: 'May 2025',
                billed: 8160.00,
                collected: 8100.00,
                collectionRate: 99.3,
                growth: 1.8,
                outstanding: 60.00
            }
        ];

        res.json({
            success: true,
            data: collectionData
        });
    } catch (error) {
        console.error('Error fetching collection breakdown:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch collection breakdown data'
        });
    }
});

// Debug route to check theme file headers
app.get('/debug/theme-headers', requireAuth, (req, res) => {
    res.json({
        message: 'Cache headers should prevent caching on live site',
        timestamp: new Date().toISOString(),
        cacheHeaders: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
        }
    });
});

// Development helper: trigger a one-time billing run
// Disabled by default; enable only when explicitly requested.
const ENABLE_BILLING_RUN_ONCE = String(process.env.ENABLE_BILLING_RUN_ONCE || '').trim().toLowerCase() === 'true';
const ALLOW_REMOTE_BILLING_RUN_ONCE = String(process.env.ALLOW_REMOTE_BILLING_RUN_ONCE || '').trim().toLowerCase() === 'true';
const requireBillingRunOnceAccess = async (req, res, next) => {
    if (!ENABLE_BILLING_RUN_ONCE) {
        return res.status(404).send('Not Found');
    }
    if (!ALLOW_REMOTE_BILLING_RUN_ONCE && !isLocalhostRequest(req)) {
        return res.status(404).send('Not Found');
    }
    return requireAuth(req, res, next);
};

app.post('/api/billing/run-once', requireBillingRunOnceAccess, async (req, res) => {
    try {
        const changed = await runMonthlyBillingOnce();
        const enforced = await enforcePppoeGracePeriod();
        res.json({ ok: true, changed, enforced });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'Billing run failed' });
    }
});
app.get('/api/billing/run-once', requireBillingRunOnceAccess, async (req, res) => {
    try {
        const changed = await runMonthlyBillingOnce();
        const enforced = await enforcePppoeGracePeriod();
        res.json({ ok: true, changed, enforced });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || 'Billing run failed' });
    }
});

// --- Error Handling Middleware ---
// Handle malformed JSON bodies before the generic error handler so they stay clear and consistent.
app.use((err, req, res, next) => {
    if (
        err instanceof SyntaxError &&
        err.status === 400 &&
        'body' in err &&
        (err.type === 'entity.parse.failed' || /JSON/.test(err.message))
    ) {
        return res.status(400).json({
            error: 'Invalid JSON payload'
        });
    }
    next(err);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.status || err.statusCode || 500;
    const isServerError = statusCode >= 500;
    const message = (IS_PRODUCTION && isServerError)
        ? 'Internal Server Error'
        : (err.message || 'Internal Server Error');
    res.status(statusCode).json({
        ok: false,
        error: message,
        status: statusCode,
        details: {
            message,
            status: statusCode
        }
    });
});

// --- Start Server ---
startCustomerUpstream();

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`[info] Storage driver: ${getStorageDriver()}`);
    if (isJsonStorageMode()) {
        console.log(`[info] JSON data directory: ${DATA_DIR}`);
    }
});

if (isJsonStorageMode()) {
    console.log('[info] Relational background jobs are disabled in JSON file storage mode.');
} else {
    // Start background billing scheduler
    scheduleBilling();
    // Start background SMS scheduler
    scheduleSmsRunner();
    // Start PPPoE session history recorder while the server is running
    mikrotikRouter.startPppoeSessionHistoryRecorder?.();
    // Start customer-app push notification scheduler
    customerAppModule.schedulePushScheduler?.();
    // Start GenieACS modem snapshot refresh for customer app visibility
    scheduleGenieacsBackgroundRefresh();
    // Start archived customer cleanup scheduler
    customersModule.scheduleCustomerArchiveCleanupWithPppoe?.();
}
