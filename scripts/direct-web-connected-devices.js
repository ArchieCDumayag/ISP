#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');

const DEFAULT_DEVICE_PAGES = [
  '/wlstatbl.asp',
  '/admin/wlstatbl.asp',
  '/wlan_client.asp',
  '/wlan_clients.asp',
  '/wireless_clients.asp',
  '/wifi_clients.asp',
  '/sta_info.asp',
  '/stainfo.asp',
  '/wlstatus.asp',
  '/status_wlan.asp',
  '/dhcp_clients.asp',
  '/lan_dhcp_clients.asp',
  '/status_lan.asp',
  '/status.asp',
  '/admin/status.asp',
  '/'
];

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./
];

const MAC_RE = /\b([0-9a-f]{2}(?::|-)){5}[0-9a-f]{2}\b/i;
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logMessage = (options, message) => {
  const logger = typeof options?.logger === 'function' ? options.logger : console.log;
  logger(message);
};

const normalizeDevicePages = (value) => {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\r\n,;]+/);
  return source
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
};

const normalizeUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Target URL is required.');
  return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
};

const isPrivateTarget = (url) => {
  const host = String(url.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host))) return true;
  return host.startsWith('fc') || host.startsWith('fd');
};

const buildOptions = (raw = {}) => {
  const url = normalizeUrl(raw.url || raw.targetUrl || raw.ip);
  const adminPassword = raw.adminPassword != null ? String(raw.adminPassword) : '';
  const adminPasswords = Array.isArray(raw.adminPasswords)
    ? raw.adminPasswords
    : String(raw.adminPasswords || '').split(/[\r\n,;]+/);
  const passwordCandidates = Array.from(new Set(
    [adminPassword, ...adminPasswords]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  ));
  const timeoutMs = Math.max(8000, Math.min(45000, Number(raw.timeoutMs || 15000) || 15000));
  return {
    url,
    adminUser: String(raw.adminUser || raw.username || '').trim(),
    adminPassword,
    adminPasswords: passwordCandidates,
    selectors: raw.selectors && typeof raw.selectors === 'object' ? raw.selectors : {},
    devicePages: normalizeDevicePages(raw.devicePages || raw.devicePage).length
      ? normalizeDevicePages(raw.devicePages || raw.devicePage)
      : DEFAULT_DEVICE_PAGES,
    allowPublic: Boolean(raw.allowPublic),
    show: Boolean(raw.show),
    timeoutMs,
    logger: typeof raw.logger === 'function' ? raw.logger : null
  };
};

const gotoSafe = async (page, url, timeoutMs) => {
  try {
    await page.goto(String(url), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (error) {
    const message = String(error?.message || '');
    if (!/Navigation timeout|net::ERR_ABORTED/i.test(message)) throw error;
  }
  await sleep(500);
};

const activateAndWait = async (page, action, timeoutMs = 15000, settleMs = 2500, waitForNavigation = false) => {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null);
  await action();
  if (waitForNavigation) {
    await navigation;
  } else {
    await Promise.race([navigation, sleep(Math.min(timeoutMs, settleMs))]);
  }
  await sleep(600);
};

const elementVisible = async (page, handle) => page.evaluate((element) => {
  if (!element || element.disabled || element.readOnly) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0';
}, handle).catch(() => false);

const queryFirstVisible = async (page, selectors = []) => {
  for (const selector of selectors.filter(Boolean)) {
    const handles = await page.$$(selector).catch(() => []);
    for (const handle of handles) {
      if (await elementVisible(page, handle)) return { handle, selector };
    }
  }
  return null;
};

const setInputValue = async (page, handle, value) => {
  await page.evaluate((element, nextValue) => {
    element.focus();
    element.value = nextValue;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, handle, value);
};

const clickSubmit = async (page, selectorConfig = '', timeoutMs = 15000) => {
  const explicit = selectorConfig ? await queryFirstVisible(page, [selectorConfig]) : null;
  if (explicit?.handle) {
    await activateAndWait(page, () => explicit.handle.click(), timeoutMs, 2500, true);
    return true;
  }

  const buttons = await page.$$('button, input[type="submit"], input[type="button"], a');
  for (const handle of buttons) {
    if (!await elementVisible(page, handle)) continue;
    const score = await page.evaluate((element) => {
      const text = [
        element.textContent,
        element.value,
        element.title,
        element.getAttribute('aria-label'),
        element.id,
        element.getAttribute('name'),
        element.getAttribute('onclick')
      ].join(' ').toLowerCase();
      if (/cancel|close|back|reset|delete|remove|logout/.test(text)) return -100;
      let value = 0;
      if (/login|log in|sign in/.test(text)) value += 40;
      if (/submit/.test(text)) value += 30;
      if (/\bok\b|confirm/.test(text)) value += 15;
      return value;
    }, handle);
    if (score > 0) {
      await activateAndWait(page, () => handle.click(), timeoutMs, 2500, true);
      return true;
    }
  }
  return false;
};

const findPasswordField = async (page, loginSelectors = {}) => queryFirstVisible(page, [
  loginSelectors.password,
  'input[type="password"]',
  'input[name="password"]',
  'input[name="passwd"]',
  'input[name="pwd"]',
  'input[name*="pass" i]',
  'input[id*="pass" i]'
]);

const openLoginPageIfPresent = async (page, options) => {
  const loginLink = await queryFirstVisible(page, ['a[href*="login" i], a']);
  const loginHref = loginLink?.handle
    ? await page.evaluate((element) => {
        const text = String(element.textContent || element.getAttribute('href') || '').trim().toLowerCase();
        if (!/login/.test(text)) return '';
        return element.href || element.getAttribute('href') || '';
      }, loginLink.handle).catch(() => '')
    : '';
  if (!loginHref) return false;
  await gotoSafe(page, new URL(loginHref, options.url), options.timeoutMs);
  return true;
};

const isLoggedOutPage = async (page, loginSelectors = {}) => {
  const passwordMatch = await findPasswordField(page, loginSelectors);
  if (passwordMatch) return true;
  return page.evaluate(() => {
    const text = `${document.title || ''} ${document.body?.innerText || ''}`.toLowerCase();
    return /not logined|please login|you have not logined|\blogin\b/.test(text);
  }).catch(() => false);
};

const maybeLogin = async (page, options) => {
  const loginSelectors = options.selectors?.login || {};
  const requestedUrl = page.url();
  let returnAfterLogin = '';
  let passwordMatch = await findPasswordField(page, loginSelectors);
  if (!passwordMatch) {
    if (await openLoginPageIfPresent(page, options)) {
      returnAfterLogin = requestedUrl;
      passwordMatch = await findPasswordField(page, loginSelectors);
    } else if (await isLoggedOutPage(page, loginSelectors)) {
      returnAfterLogin = requestedUrl;
      await gotoSafe(page, new URL('/admin/login.asp', options.url), options.timeoutMs).catch(() => {});
      passwordMatch = await findPasswordField(page, loginSelectors);
    }
  }
  if (!passwordMatch) return false;
  if (!options.adminPasswords.length) throw new Error('Router login page detected. Set IP Browser password first.');

  for (let index = 0; index < options.adminPasswords.length; index += 1) {
    passwordMatch = await findPasswordField(page, loginSelectors);
    if (!passwordMatch && await openLoginPageIfPresent(page, options)) {
      passwordMatch = await findPasswordField(page, loginSelectors);
    }
    if (!passwordMatch) return false;

    const usernameMatch = await queryFirstVisible(page, [
      loginSelectors.username,
      'input[name="username"]',
      'input[name="userName"]',
      'input[name="user"]',
      'input[name="login"]',
      'input[name="account"]',
      'input[id*="user" i]',
      'input[type="text"]'
    ]);
    if (usernameMatch && options.adminUser) {
      await setInputValue(page, usernameMatch.handle, options.adminUser);
    }
    await setInputValue(page, passwordMatch.handle, options.adminPasswords[index]);

    const submitted = await clickSubmit(page, loginSelectors.submit, options.timeoutMs);
    if (!submitted) await activateAndWait(page, () => page.keyboard.press('Enter'), 10000);
    logMessage(options, `[login] submitted router login as ${options.adminUser || '(no username field)'}${options.adminPasswords.length > 1 ? ` (${index + 1}/${options.adminPasswords.length})` : ''}`);
    if (returnAfterLogin && !/\/admin\/login\.asp(?:[?#].*)?$/i.test(returnAfterLogin)) {
      await gotoSafe(page, returnAfterLogin, options.timeoutMs);
    }
    await sleep(400);
    if (!await isLoggedOutPage(page, loginSelectors)) return true;
    if (index < options.adminPasswords.length - 1) {
      await gotoSafe(page, new URL('/admin/login.asp', options.url), options.timeoutMs).catch(() => {});
    }
  }
  throw new Error('Router login failed for all saved IP Browser passwords.');
};

const normalizeMac = (value = '') => {
  const match = String(value || '').match(MAC_RE);
  return match ? match[0].replace(/-/g, ':').toUpperCase() : '';
};

const normalizeIp = (value = '') => {
  const match = String(value || '').match(IP_RE);
  return match ? match[0] : '';
};

const inferBand = (source = {}) => {
  const text = [source.url, source.title, source.heading].join(' ').toLowerCase();
  if (/\b5g\b|5ghz/.test(text)) return '5G';
  if (/2\.?4g|24g/.test(text)) return '2.4G';
  if (/dhcp|lan/.test(text)) return 'LAN/WiFi';
  if (/wl|wlan|wireless|wifi|station|sta/.test(text)) return 'WiFi';
  return '';
};

const cleanCell = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const pickHostname = (cells = [], text = '') => {
  const skip = /mac|ip address|address|status|state|signal|rate|rx|tx|time|lease|interface|band|mode|connect/i;
  const candidate = cells.find((cell) => {
    const value = cleanCell(cell);
    return value
      && !MAC_RE.test(value)
      && !IP_RE.test(value)
      && !skip.test(value)
      && value.length <= 80;
  });
  if (candidate) return cleanCell(candidate);
  const hostMatch = String(text || '').match(/(?:host\s*name|hostname|name)\s*[:=]\s*([^\n\r,;]+)/i);
  return hostMatch ? cleanCell(hostMatch[1]).slice(0, 80) : '';
};

const pickSignal = (text = '') => {
  const match = String(text || '').match(/(?:signal|rssi)?\s*(-\d{2,3})\s*(?:dbm|db)?/i);
  return match ? `${match[1]} dBm` : '';
};

const parseClientCandidates = (snapshots = []) => {
  const clients = [];
  snapshots.forEach((snapshot) => {
    const band = inferBand(snapshot);
    (snapshot.rows || []).forEach((row) => {
      const cells = Array.isArray(row.cells) ? row.cells.map(cleanCell).filter(Boolean) : [];
      const text = cleanCell(row.text || cells.join(' '));
      if (!text || /mac\s*address.*ip\s*address/i.test(text)) return;
      const macAddress = normalizeMac(text);
      const ipAddress = normalizeIp(text);
      if (!macAddress && !ipAddress) return;
      const online = !/\boffline\b|inactive|disabled|expired/i.test(text);
      clients.push({
        hostname: pickHostname(cells, text),
        macAddress,
        ipAddress,
        band,
        signal: pickSignal(text),
        online,
        source: snapshot.url || ''
      });
    });
  });

  const seen = new Set();
  return clients.filter((client, index) => {
    const key = [
      client.macAddress,
      client.ipAddress,
      client.hostname
    ].map((value) => String(value || '').trim().toLowerCase()).join('|') || `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const collectPageSnapshot = async (page) => {
  const snapshots = [];
  for (const frame of page.frames()) {
    const snapshot = await frame.evaluate(() => {
      const normalize = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
      const rows = Array.from(document.querySelectorAll('tr')).map((row) => ({
        cells: Array.from(row.querySelectorAll('th,td')).map((cell) => normalize(cell.textContent)),
        text: normalize(row.textContent)
      })).filter((row) => row.text || row.cells.length);
      const looseRows = Array.from(document.body?.querySelectorAll('p,li,div') || [])
        .map((node) => normalize(node.textContent))
        .filter((text) => /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}|\b\d{1,3}(?:\.\d{1,3}){3}\b/i.test(text))
        .slice(0, 80)
        .map((text) => ({ cells: [], text }));
      return {
        url: window.location.href,
        title: document.title || '',
        heading: normalize(document.querySelector('h1,h2,h3,legend,caption')?.textContent || ''),
        rows: [...rows, ...looseRows],
        links: Array.from(document.querySelectorAll('a[href], frame[src], iframe[src]')).map((element) => ({
          text: normalize(element.textContent || element.getAttribute('name') || element.getAttribute('title') || ''),
          href: element.getAttribute('href') || element.getAttribute('src') || ''
        }))
      };
    }).catch(() => null);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
};

const collectCandidateLinks = async (page, baseUrl) => {
  const snapshots = await collectPageSnapshot(page);
  const links = [];
  snapshots.forEach((snapshot) => {
    (snapshot.links || []).forEach((link) => {
      const text = `${link.text || ''} ${link.href || ''}`.toLowerCase();
      if (!/(client|station|associated|dhcp|host|lan|wlan|wireless|wifi|status|sta)/i.test(text)) return;
      try {
        links.push(new URL(link.href, snapshot.url || baseUrl).pathname);
      } catch {}
    });
  });
  return Array.from(new Set(links)).slice(0, 16);
};

const buildCandidateUrls = (baseUrl, pages = []) => {
  const seen = new Set();
  return pages.map((entry) => {
    const url = new URL(entry || '/', baseUrl);
    if (seen.has(url.href)) return null;
    seen.add(url.href);
    return url;
  }).filter(Boolean);
};

const runDirectWebConnectedDevices = async (rawOptions = {}) => {
  const messages = [];
  const externalLogger = typeof rawOptions.logger === 'function' ? rawOptions.logger : null;
  const options = buildOptions({
    ...rawOptions,
    logger: (message) => {
      messages.push(String(message || ''));
      if (externalLogger) externalLogger(message);
    }
  });

  if (!isPrivateTarget(options.url) && !options.allowPublic) {
    throw new Error('Target must be a private/CGNAT IP. Use allowPublic only for an owned public router.');
  }

  logMessage(options, `[target] ${options.url.href}`);
  logMessage(options, `[mode] connected-devices${options.show ? ' visible-browser' : ''}`);

  const browser = await puppeteer.launch({
    headless: !options.show,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors'
    ]
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.on('dialog', async (dialog) => {
      logMessage(options, `[dialog] ${dialog.type()}: ${dialog.message()}`);
      await dialog.accept().catch(() => {});
    });

    await gotoSafe(page, options.url, options.timeoutMs);
    await maybeLogin(page, options);
    const discoveredLinks = await collectCandidateLinks(page, options.url).catch(() => []);
    const candidateUrls = buildCandidateUrls(options.url, [...options.devicePages, ...discoveredLinks]);
    const snapshots = [];

    for (const candidateUrl of candidateUrls) {
      logMessage(options, `[open] ${candidateUrl.href}`);
      await gotoSafe(page, candidateUrl, options.timeoutMs);
      await maybeLogin(page, options);
      await sleep(500);
      const pageSnapshots = await collectPageSnapshot(page);
      const pageClients = parseClientCandidates(pageSnapshots);
      snapshots.push(...pageSnapshots);
      if (pageClients.length) {
        logMessage(options, `[discover] ${candidateUrl.href} reported ${pageClients.length} device(s)`);
      }
    }

    const devices = parseClientCandidates(snapshots);
    if (!devices.length) {
      logMessage(options, '[devices] no connected device rows were found on inspected pages');
    }

    return {
      ok: true,
      target: options.url.href,
      matchedUrl: devices[0]?.source || '',
      devices,
      onlineCount: devices.filter((device) => device.online).length,
      totalCount: devices.length,
      messages
    };
  } catch (error) {
    error.automationMessages = messages;
    throw error;
  } finally {
    if (!options.show) await browser.close();
  }
};

module.exports = {
  runDirectWebConnectedDevices
};
