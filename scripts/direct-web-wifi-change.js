#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DEFAULT_WIFI_PAGES = [
  '/',
  '/admin/login.asp',
  '/admin/wlan_basic.asp',
  '/wlan_basic.asp',
  '/admin/wireless.asp',
  '/wireless.asp',
  '/wifi.asp',
  '/wlbasic.asp',
  '/wlwpa.asp',
  '/wlsecurity.asp',
  '/wlsec.asp',
  '/wlencrypt.asp',
  '/wl_encrypt.asp',
  '/wireless_security.asp',
  '/wlan_security.asp',
  '/wlan.asp',
  '/net_wlan.asp',
  '/admin/wlcfg.html',
  '/wlcfg.html'
];

const YOTC_M2_2050_TEMPLATE = {
  name: 'm2-2050-yotc',
  label: 'M2-2050 YOTC',
  wifiPages: [
    '/wlbasic.asp',
    '/wlwpa.asp'
  ],
  selectors: {
    wifi: {
      ssid24: 'input[name="ssid"]',
      password24: 'input[name="pskValue"], input#wpapsk'
    }
  }
};

const MODEM_TEMPLATES = new Map([
  ['m2-2050-yotc', YOTC_M2_2050_TEMPLATE],
  ['yotc-m2-2050', YOTC_M2_2050_TEMPLATE],
  ['m22050-yotc', YOTC_M2_2050_TEMPLATE],
  ['realtek-wlbasic-wlwpa', YOTC_M2_2050_TEMPLATE]
]);
const DEFAULT_MODEM_TEMPLATE = YOTC_M2_2050_TEMPLATE;

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./
];

const usage = () => {
  console.log(`
Direct router/ONU WiFi changer

Dry-run first:
  node scripts\\direct-web-wifi-change.js --url http://192.168.15.202 --admin-user admin --admin-password admin --ssid24 "ARCHIE-2G" --password24 "newpass123"

Apply change:
  node scripts\\direct-web-wifi-change.js --url http://192.168.15.202 --admin-user admin --admin-password admin --ssid24 "ARCHIE-2G" --password24 "newpass123" --apply

Visible browser for debugging:
  node scripts\\direct-web-wifi-change.js --url http://192.168.15.202 --admin-user admin --admin-password admin --ssid "ARCHIE-WIFI" --wifi-password "newpass123" --show --apply

Optional selector config:
  node scripts\\direct-web-wifi-change.js --config data\\direct-web-wifi.json --apply

Config shape:
  {
    "url": "http://192.168.15.202",
    "adminUser": "admin",
    "adminPassword": "admin",
    "modemTemplate": "m2-2050-yotc",
    "ssid24": "ARCHIE-2G",
    "password24": "newpass123",
    "wifiPage": "/admin/wlan_basic.asp",
    "selectors": {
      "login": {
        "username": "input[name='username']",
        "password": "input[name='password']",
        "submit": "input[type='submit']"
      },
      "wifi": {
        "ssid24": "input[name='wlSsid']",
        "password24": "input[name='wlWpaPsk']",
        "submit": "input[value='Apply']"
      }
    }
  }
`);
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const raw = token.slice(2);
    const equalIndex = raw.indexOf('=');
    if (equalIndex >= 0) {
      args[raw.slice(0, equalIndex)] = raw.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[raw] = true;
      continue;
    }
    args[raw] = next;
    index += 1;
  }
  return args;
};

const readJsonFile = (filePath) => {
  if (!filePath) return {};
  const resolved = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
};

const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
};

const normalizeUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('--url is required.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return new URL(withProtocol);
};

const isPrivateTarget = (url) => {
  const host = String(url.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(host));
};

const mask = (value = '') => {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text[0]}${'*'.repeat(Math.min(text.length - 2, 8))}${text[text.length - 1]}`;
};

const buildOptions = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }
  return buildOptionsFromRaw(args, readJsonFile(args.config));
};

const normalizeWifiPages = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
};

const normalizeSelectors = (raw = {}) => ({
  ...(raw || {}),
  login: { ...(raw?.login || {}) },
  wifi: { ...(raw?.wifi || {}) }
});

const normalizeList = (value) => {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,;]+/);
  return Array.from(new Set(
    source.map((entry) => String(entry ?? '').trim()).filter(Boolean)
  ));
};

const compactObject = (raw = {}) => Object.fromEntries(
  Object.entries(raw || {}).filter(([, value]) => String(value ?? '').trim() !== '')
);

const normalizeTemplateName = (value = '') => String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');

const buildOptionsFromRaw = (raw = {}, config = {}) => {
  const templateName = normalizeTemplateName(pick(
    raw['modem-template'],
    raw.modemTemplate,
    raw.template,
    config.modemTemplate,
    config.template,
    DEFAULT_MODEM_TEMPLATE.name
  ));
  const template = templateName && !['none', 'off', 'disable', 'disabled'].includes(templateName)
    ? (MODEM_TEMPLATES.get(templateName) || DEFAULT_MODEM_TEMPLATE)
    : {};
  const selectors = {
    ...compactObject(template.selectors),
    ...compactObject(config.selectors),
    ...compactObject(raw.selectors),
    login: {
      ...compactObject(template.selectors?.login),
      ...compactObject(config.selectors?.login),
      ...compactObject(raw.selectors?.login)
    },
    wifi: {
      ...compactObject(template.selectors?.wifi),
      ...compactObject(config.selectors?.wifi),
      ...compactObject(raw.selectors?.wifi)
    }
  };
  const adminPasswordCandidates = Array.from(new Set([
    String(pick(raw['admin-password'], raw.adminPassword, raw.password, config.adminPassword, config.password)),
    ...normalizeList(pick(raw['admin-passwords'], raw.adminPasswords, raw.passwords, config.adminPasswords, config.passwords))
  ].map((entry) => String(entry ?? '').trim()).filter(Boolean)));

  return {
    url: normalizeUrl(pick(raw.url, config.url, raw.ip, config.ip)),
    adminUser: String(pick(raw['admin-user'], raw.adminUser, raw.username, config.adminUser, config.username)).trim(),
    adminPassword: adminPasswordCandidates[0] || '',
    adminPasswords: adminPasswordCandidates,
    ssid24: String(pick(raw.ssid24, raw['ssid-24'], raw.ssid, config.ssid24, config.ssid)).trim(),
    password24: String(pick(raw.password24, raw['password-24'], raw['wifi-password'], raw.wifiPassword, config.password24, config.wifiPassword)).trim(),
    ssid5: String(pick(raw.ssid5, raw['ssid-5'], raw.ssid, config.ssid5, config.ssid)).trim(),
    password5: String(pick(raw.password5, raw['password-5'], raw['wifi-password'], raw.wifiPassword, config.password5, config.wifiPassword)).trim(),
    wifiPages: normalizeWifiPages(pick(
      raw['wifi-page'],
      raw.wifiPage,
      raw.wifiPages,
      config.wifiPage,
      config.wifiPages,
      template.wifiPages
    )),
    selectors: normalizeSelectors(selectors),
    apply: toBool(raw.apply, toBool(config.apply, false)),
    show: toBool(raw.show, toBool(config.show, false)),
    inspect: toBool(raw.inspect, toBool(config.inspect, false)),
    allowPublic: toBool(raw['allow-public'], toBool(raw.allowPublic, toBool(config.allowPublic, false))),
    timeoutMs: Math.max(3000, Number(pick(raw.timeout, raw.timeoutMs, config.timeoutMs, 15000)) || 15000),
    verifyTimeoutMs: Math.max(3000, Number(pick(raw.verifyTimeoutMs, raw['verify-timeout'], config.verifyTimeoutMs, 10000)) || 10000),
    fallbackWifiPages: toBool(
      raw.fallbackWifiPages ?? raw['fallback-wifi-pages'],
      toBool(config.fallbackWifiPages ?? config['fallback-wifi-pages'], false)
    ),
    modemTemplate: template.name || '',
    modemTemplateLabel: template.label || template.name || '',
    logger: typeof raw.logger === 'function' ? raw.logger : null
  };
};

const logMessage = (options, message) => {
  const logger = typeof options?.logger === 'function' ? options.logger : console.log;
  logger(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cssEscape = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

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
    await Promise.race([
      navigation,
      sleep(Math.min(timeoutMs, settleMs))
    ]);
  }
  await sleep(700);
};

const confirmSuccessPageIfPresent = async (page, options) => {
  const status = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const button = Array.from(document.querySelectorAll('input[type="button"], button')).find((element) => {
      const label = [element.value, element.textContent, element.getAttribute('onclick')].join(' ');
      return /ok|continue|back|return/i.test(label);
    });
    return {
      successPage: /change setting successfully|successfully|setting.*success/i.test(text),
      hasButton: Boolean(button)
    };
  }).catch(() => ({ successPage: false, hasButton: false }));
  if (!status.successPage) return false;
  logMessage(options, '[confirm] router returned success page');
  if (!status.hasButton) return true;
  await activateAndWait(page, async () => {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('input[type="button"], button')).find((element) => {
        const label = [element.value, element.textContent, element.getAttribute('onclick')].join(' ');
        return /ok|continue|back|return/i.test(label);
      });
      if (button) button.click();
    });
  }, 10000).catch(() => {});
  logMessage(options, '[confirm] clicked router success OK');
  return true;
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

const visibleInputs = async (page) => {
  const handles = await page.$$('input, textarea, select');
  const rows = [];
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!await elementVisible(page, handle)) continue;
    const details = await page.evaluate((element, visibleIndex) => {
      const label = element.id
        ? (document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '')
        : '';
      const parentText = element.closest('label, tr, p, div')?.textContent || '';
      return {
        visibleIndex,
        tag: element.tagName.toLowerCase(),
        type: String(element.type || '').toLowerCase(),
        id: element.id || '',
        name: element.getAttribute('name') || '',
        placeholder: element.getAttribute('placeholder') || '',
        value: element.value || '',
        label,
        parentText
      };
    }, handle, rows.length);
    const type = String(details.type || '').toLowerCase();
    const tag = String(details.tag || '').toLowerCase();
    const fillableInputTypes = new Set(['', 'text', 'password', 'search', 'tel', 'email', 'url', 'number']);
    if (tag === 'input' && !fillableInputTypes.has(type)) continue;
    if (tag === 'select' && !/ssid|wifi|wireless|wlan|wpa|psk|pass|key/i.test([
      details.id,
      details.name,
      details.placeholder,
      details.label,
      details.parentText
    ].join(' '))) continue;
    rows.push({ handle, details });
  }
  return rows;
};

const scoreField = (details, purpose) => {
  const haystack = [
    details.id,
    details.name,
    details.placeholder,
    details.label,
    details.parentText
  ].join(' ').toLowerCase();
  let score = 0;

  if (purpose.includes('ssid')) {
    if (haystack.includes('ssid')) score += 50;
    if (haystack.includes('wifi') || haystack.includes('wireless') || haystack.includes('wlan')) score += 12;
    if (haystack.includes('name')) score += 6;
    if (details.type === 'password') score -= 50;
    if (details.type === 'submit' || details.type === 'button' || details.tag === 'select') score -= 80;
  } else {
    if (haystack.includes('passphrase') || haystack.includes('pre-shared') || haystack.includes('preshared')) score += 50;
    if (haystack.includes('wpa') || haystack.includes('psk') || haystack.includes('key')) score += 35;
    if (haystack.includes('password') || haystack.includes('passwd')) score += 20;
    if (haystack.includes('wifi') || haystack.includes('wireless') || haystack.includes('wlan')) score += 12;
    if (haystack.includes('login') || haystack.includes('admin')) score -= 30;
    if (details.tag === 'select' || details.type === 'submit' || details.type === 'button') score -= 80;
  }

  if (purpose.includes('24')) {
    if (/2\.4|24g|2g|wlan0|wl0|ssid1|_1\b|\b1\b/.test(haystack)) score += 12;
    if (/5g|5ghz|ssid5|ssid2|wlan1|wl1/.test(haystack)) score -= 8;
  }
  if (purpose.includes('5')) {
    if (/5g|5ghz|ssid5|ssid2|wlan1|wl1|_5\b/.test(haystack)) score += 12;
    if (/2\.4|24g|2g|wlan0|wl0/.test(haystack)) score -= 8;
  }
  return score;
};

const describeField = (entry) => {
  if (!entry) return 'not found';
  const d = entry.details;
  return `${d.tag}[type=${d.type || '-'} name="${d.name}" id="${d.id}" placeholder="${d.placeholder}"]`;
};

const chooseFieldBySelectors = async (page, selector) => {
  if (!selector) return null;
  const match = await queryFirstVisible(page, [selector]);
  if (!match) return null;
  const detailRows = await visibleInputs(page);
  const row = detailRows.find((entry) => entry.handle === match.handle);
  return row || { handle: match.handle, details: { tag: 'input', type: '', name: selector, id: '', placeholder: '' } };
};

const chooseGenericField = (inputs, purpose, used = new Set()) => {
  const ranked = inputs
    .map((entry) => ({ entry, score: scoreField(entry.details, purpose) }))
    .filter(({ entry, score }) => score > 0 && !used.has(entry.handle))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.entry || null;
};

const buildWifiPlan = async (page, options) => {
  const inputs = await visibleInputs(page);
  const used = new Set();
  const fields = {};
  const wifiSelectors = options.selectors?.wifi || {};

  const choose = async (key, purpose) => {
    const explicit = await chooseFieldBySelectors(page, wifiSelectors[key]);
    const selected = explicit || chooseGenericField(inputs, purpose, used);
    if (selected) used.add(selected.handle);
    return selected;
  };

  if (options.ssid24) fields.ssid24 = await choose('ssid24', 'ssid24');
  if (options.password24) fields.password24 = await choose('password24', 'password24');
  if (options.ssid5) fields.ssid5 = await choose('ssid5', 'ssid5');
  if (options.password5) fields.password5 = await choose('password5', 'password5');
  return { inputs, fields };
};

const prepareWifiSecurityControls = async (page, options) => {
  if (!options.password24 && !options.password5) return null;
  const result = await page.evaluate(() => {
    const select = document.querySelector('select[name="security_method"], select#security_method');
    if (!select) return null;
    const selectedText = select.options?.[select.selectedIndex]?.textContent || '';
    const hasPskField = Boolean(document.querySelector('input[name="pskValue"], input#wpapsk, input[name*="psk" i], input[name*="key" i]'));
    const option = Array.from(select.options || []).find((entry) => /wpa2 mixed/i.test(entry.textContent || ''))
      || Array.from(select.options || []).find((entry) => /wpa2/i.test(entry.textContent || ''))
      || Array.from(select.options || []).find((entry) => /\bwpa\b/i.test(entry.textContent || ''));
    if (!option || (hasPskField && !/none/i.test(selectedText))) return null;
    select.value = option.value;
    option.selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (typeof select.onchange === 'function') select.onchange();

    const passphraseFormat = document.querySelector('select[name="pskFormat"], select#psk_fmt');
    if (passphraseFormat) {
      const passphraseOption = Array.from(passphraseFormat.options || []).find((entry) => /passphrase/i.test(entry.textContent || ''));
      if (passphraseOption) {
        passphraseFormat.value = passphraseOption.value;
        passphraseOption.selected = true;
        passphraseFormat.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    ['ciphersuite_a', 'wpa2ciphersuite_a'].forEach((name) => {
      const checkbox = document.querySelector(`input[type="checkbox"][name="${name}"]`);
      if (checkbox) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    return { value: option.value, text: option.textContent || '' };
  }).catch(() => null);
  if (result) {
    logMessage(options, `[security] selected ${String(result.text || result.value || 'WPA/WPA2').trim()} to reveal password field`);
    await sleep(500);
  }
  return result;
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
      if (/apply/.test(text)) value += 40;
      if (/save/.test(text)) value += 35;
      if (/submit/.test(text)) value += 30;
      if (/login|log in|sign in/.test(text)) value += 30;
      if (/\bok\b|confirm|commit/.test(text)) value += 20;
      return value;
    }, handle);
    if (score > 0) {
      const waitsForSubmit = await page.evaluate((element) => {
        const tag = String(element.tagName || '').toLowerCase();
        const type = String(element.type || '').toLowerCase();
        return (tag === 'input' && type === 'submit') || (tag === 'button' && (!type || type === 'submit'));
      }, handle).catch(() => false);
      await activateAndWait(page, () => handle.click(), timeoutMs, 2500, waitsForSubmit);
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
    return /not logined|please login|you have not logined|\blogin\b/.test(text)
      && !document.querySelector('input[name="ssid"], input[name="pskValue"], input#wpapsk');
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
    }
  }
  if (!passwordMatch) return false;
  const passwordCandidates = Array.isArray(options.adminPasswords) && options.adminPasswords.length
    ? options.adminPasswords
    : [options.adminPassword].filter(Boolean);
  if (!passwordCandidates.length) {
    throw new Error('Router login page detected. Provide --admin-password.');
  }

  for (let index = 0; index < passwordCandidates.length; index += 1) {
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
    await setInputValue(page, passwordMatch.handle, passwordCandidates[index]);

    const submitted = await clickSubmit(page, loginSelectors.submit);
    if (!submitted) {
      await activateAndWait(page, () => page.keyboard.press('Enter'), 10000);
    }
    logMessage(options, `[login] submitted router login as ${options.adminUser || '(no username field)'}${passwordCandidates.length > 1 ? ` (${index + 1}/${passwordCandidates.length})` : ''}`);
    if (returnAfterLogin && !/\/admin\/login\.asp(?:[?#].*)?$/i.test(returnAfterLogin)) {
      await gotoSafe(page, returnAfterLogin, options.timeoutMs);
    }
    await sleep(400);
    if (!await isLoggedOutPage(page, loginSelectors)) {
      return true;
    }
    if (index < passwordCandidates.length - 1) {
      await gotoSafe(page, new URL('/admin/login.asp', options.url), options.timeoutMs).catch(() => {});
    }
  }
  throw new Error('Router login failed for all saved IP Browser passwords.');
};

const buildCandidateUrls = (baseUrl, pageList, includeDefaultPages = false) => {
  const seen = new Set();
  const pages = pageList.length
    ? (includeDefaultPages ? [...pageList, ...DEFAULT_WIFI_PAGES] : pageList)
    : DEFAULT_WIFI_PAGES;
  return pages.map((entry) => {
    const url = new URL(entry || '/', baseUrl);
    const key = url.href;
    if (seen.has(key)) return null;
    seen.add(key);
    return url;
  }).filter(Boolean);
};

const collectInspectionSummary = async (page) => {
  const inputs = await visibleInputs(page);
  return inputs.map((entry) => ({
    field: describeField(entry),
    value: entry.details.type === 'password' ? mask(entry.details.value) : entry.details.value
  }));
};

const collectPageInspectionSummary = async (page) => page.evaluate(() => {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0';
  };
  const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
  const controls = Array.from(document.querySelectorAll('input, textarea, select, button'))
    .filter(visible)
    .slice(0, 60)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: String(element.type || '').toLowerCase(),
      name: element.getAttribute('name') || '',
      id: element.id || '',
      value: String(element.type || '').toLowerCase() === 'password' ? '[password]' : String(element.value || '').slice(0, 80),
      text: normalizeText(element.closest('tr, label, p, div, form')?.textContent || element.textContent || '').slice(0, 140),
      formAction: element.form?.getAttribute('action') || ''
    }));
  const links = Array.from(document.querySelectorAll('a, frame, iframe'))
    .filter((element) => element.tagName.toLowerCase() === 'frame' || element.tagName.toLowerCase() === 'iframe' || visible(element))
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent || element.getAttribute('name') || element.getAttribute('title') || '').slice(0, 100),
      href: element.getAttribute('href') || element.getAttribute('src') || ''
    }))
    .filter((entry) => /wl|wlan|wifi|wireless|security|pass|psk|key/i.test(`${entry.text} ${entry.href}`))
    .slice(0, 40);
  return {
    href: window.location.href,
    title: document.title || '',
    controls,
    links
  };
}).catch((error) => ({ error: error.message || String(error), controls: [], links: [] }));

const logPageInspectionSummary = async (page, options, candidateUrl) => {
  const summary = await collectPageInspectionSummary(page);
  logMessage(options, `[inspect-page] ${candidateUrl.href} -> ${summary.href || '(unknown href)'} ${summary.title || ''}`.trim());
  (summary.controls || []).forEach((control) => {
    const value = control.type === 'password' ? mask(control.value) : control.value;
    logMessage(options, `[inspect-control] ${control.tag}[type=${control.type || '-'} name="${control.name}" id="${control.id}" value="${value}" action="${control.formAction}"] ${control.text || ''}`);
  });
  (summary.links || []).forEach((link) => {
    logMessage(options, `[inspect-link] ${link.tag} text="${link.text}" href="${link.href}"`);
  });
};

const getRequestedAssignments = (options) => [
    ['ssid24', options.ssid24],
    ['password24', options.password24],
    ['ssid5', options.ssid5],
    ['password5', options.password5]
  ].filter(([, value]) => value);

const logPlanFields = (plan, options, assignments) => {
  const missing = assignments.filter(([key]) => !plan.fields[key]);
  if (missing.length) {
    logMessage(options, `[fields] missing: ${missing.map(([key]) => key).join(', ')}`);
  }
  assignments.forEach(([key, value]) => {
    logMessage(options, `[fields] ${key}: ${describeField(plan.fields[key])} -> ${key.includes('password') ? mask(value) : value}`);
  });
  return {
    foundKeys: assignments.filter(([key]) => plan.fields[key]).map(([key]) => key),
    missingKeys: missing.map(([key]) => key)
  };
};

const fillPlan = async (page, plan, options, requestedKeys = null) => {
  const allowedKeys = requestedKeys ? new Set(requestedKeys) : null;
  const assignments = getRequestedAssignments(options).filter(([key]) => !allowedKeys || allowedKeys.has(key));
  const { foundKeys, missingKeys } = logPlanFields(plan, options, assignments);
  const canChange = assignments.length > 0 && !missingKeys.length;
  if (!canChange) return { changed: false, appliedKeys: foundKeys };
  if (!options.apply) {
    logMessage(options, '[dry-run] no changes submitted. Add --apply to save.');
    return { changed: true, appliedKeys: foundKeys };
  }

  for (const [key, value] of assignments) {
    const field = plan.fields[key];
    if (!field) continue;
    await setInputValue(page, field.handle, value);
  }
  const submitTimeoutMs = foundKeys.some((key) => key.includes('ssid'))
    ? Math.max(20000, options.timeoutMs)
    : Math.max(12000, options.timeoutMs);
  const submitted = await clickSubmit(page, options.selectors?.wifi?.submit || '', submitTimeoutMs);
  if (!submitted) throw new Error('Could not find Apply/Save button. Use selectors.wifi.submit in config.');
  await confirmSuccessPageIfPresent(page, options);
  logMessage(options, `[apply] WiFi change submitted for ${foundKeys.join(', ')}. The modem may briefly disconnect WiFi clients.`);
  return { changed: true, appliedKeys: foundKeys };
};

const verifyAppliedKeys = async (page, options, keys = []) => {
  if (!options.apply || !keys.some((key) => key.includes('ssid'))) return true;
  const expected = options.ssid24 || options.ssid5 || '';
  if (!expected) return true;

  const deadline = Date.now() + Math.min(Math.max(options.verifyTimeoutMs || 10000, 3000), 15000);
  let current = '';
  while (Date.now() < deadline) {
    await gotoSafe(page, new URL('/wlbasic.asp', options.url), options.timeoutMs).catch(() => null);
    await maybeLogin(page, options).catch(() => null);
    await sleep(500);
    current = await page.$eval('input[name="ssid"]', (element) => String(element.value || '').trim()).catch(() => '');
    if (current === expected) {
      logMessage(options, `[verify] SSID changed to ${expected}`);
      return true;
    }
    await sleep(1000);
  }
  logMessage(options, `[verify] SSID still ${current || '(blank)'}, expected ${expected}`);
  return false;
};

const verifyPasswordApplied = async (page, options) => {
  if (!options.apply || !options.password24) return true;
  await gotoSafe(page, new URL('/wlwpa.asp', options.url), options.timeoutMs).catch(() => null);
  await maybeLogin(page, options).catch(() => null);
  await sleep(500);
  await prepareWifiSecurityControls(page, options);
  const current = await page.$eval(
    'input[name="pskValue"], input#wpapsk',
    (element) => String(element.value || '').trim()
  ).catch(() => '');
  if (!current || current === options.password24) {
    logMessage(options, current ? '[verify] WiFi password field matches requested value' : '[verify] WiFi password field not readable after apply');
    return true;
  }
  logMessage(options, `[verify] WiFi password field did not match requested value (${mask(current)}).`);
  return false;
};

const setSelectorValue = async (page, selector, value) => page.$eval(selector, (element, nextValue) => {
  element.focus();
  element.value = nextValue;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}, value);

const clickM22050Apply = async (page, timeoutMs = 15000) => {
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null),
    page.click('input[name="save"], input[type="submit"], button[type="submit"]')
  ]);
  await sleep(3000);
};

const runM22050YotcApplyFlow = async (page, options, requestedAssignments = []) => {
  const appliedUrls = [];
  const needsSsid = requestedAssignments.some(([key]) => key === 'ssid24');
  const needsPassword = requestedAssignments.some(([key]) => key === 'password24');

  if (needsSsid) {
    const ssidUrl = new URL('/wlbasic.asp', options.url);
    logMessage(options, `[open] ${ssidUrl.href}`);
    await gotoSafe(page, ssidUrl, options.timeoutMs);
    await maybeLogin(page, options);
    await sleep(500);
    const ssidSelector = options.selectors?.wifi?.ssid24 || 'input[name="ssid"]';
    const current = await page.$eval(ssidSelector, (element) => String(element.value || '').trim()).catch(() => '');
    logMessage(options, `[fields] ssid24: ${ssidSelector} ${current ? `(current ${current})` : ''}-> ${options.ssid24}`);
    try {
      await setSelectorValue(page, ssidSelector, options.ssid24);
      await clickM22050Apply(page, Math.max(20000, options.timeoutMs));
    } catch (_error) {
      throw new Error(`Could not apply ssid24 on ${ssidUrl.href}.`);
    }
    logMessage(options, '[apply] WiFi change submitted for ssid24. The modem may briefly disconnect WiFi clients.');
    const verified = await verifyAppliedKeys(page, options, ['ssid24']);
    if (!verified) {
      throw new Error('SSID apply was submitted but the router still reports the old WiFi name.');
    }
    appliedUrls.push(ssidUrl.href);
  }

  if (needsPassword) {
    const passwordUrl = new URL('/wlwpa.asp', options.url);
    logMessage(options, `[open] ${passwordUrl.href}`);
    await gotoSafe(page, passwordUrl, options.timeoutMs);
    await maybeLogin(page, options);
    await sleep(500);
    await prepareWifiSecurityControls(page, options);
    const passwordSelector = options.selectors?.wifi?.password24 || 'input[name="pskValue"], input#wpapsk';
    logMessage(options, `[fields] password24: ${passwordSelector} -> ${mask(options.password24)}`);
    try {
      await setSelectorValue(page, passwordSelector, options.password24);
      await clickM22050Apply(page, Math.max(12000, options.timeoutMs));
    } catch (_error) {
      throw new Error(`Could not apply password24 on ${passwordUrl.href}.`);
    }
    logMessage(options, '[apply] WiFi change submitted for password24. The modem may briefly disconnect WiFi clients.');
    const verified = await verifyPasswordApplied(page, options);
    if (!verified) {
      throw new Error('Password apply was submitted but the router did not report the requested password.');
    }
    appliedUrls.push(passwordUrl.href);
  }

  return {
    ok: true,
    applied: true,
    target: options.url.href,
    matchedUrl: appliedUrls.join(', '),
    matchedUrls: appliedUrls
  };
};

const runDirectWebWifiChange = async (rawOptions = {}) => {
  const messages = [];
  const externalLogger = typeof rawOptions.logger === 'function' ? rawOptions.logger : null;
  const options = buildOptionsFromRaw(rawOptions, rawOptions.config ? readJsonFile(rawOptions.config) : {});
  options.logger = (message) => {
    messages.push(String(message || ''));
    if (externalLogger) {
      externalLogger(message);
    } else {
      console.log(message);
    }
  };

  if (!isPrivateTarget(options.url) && !options.allowPublic) {
    throw new Error('Target must be a private/CGNAT IP. Use --allow-public only for an owned public router.');
  }
  if (!options.ssid24 && !options.password24 && !options.ssid5 && !options.password5) {
    throw new Error('Provide at least one of --ssid24, --password24, --ssid5, --password5, --ssid, or --wifi-password.');
  }

  logMessage(options, `[target] ${options.url.href}`);
  logMessage(options, `[mode] ${options.apply ? 'APPLY' : 'DRY-RUN'}${options.show ? ' visible-browser' : ''}`);
  if (options.modemTemplateLabel) {
    logMessage(options, `[template] ${options.modemTemplateLabel}`);
  }

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

    const requestedAssignments = getRequestedAssignments(options);
    if (
      options.apply
      && options.modemTemplate === 'm2-2050-yotc'
      && !requestedAssignments.some(([key]) => key === 'ssid5' || key === 'password5')
    ) {
      const result = await runM22050YotcApplyFlow(page, options, requestedAssignments);
      return { ...result, messages };
    }

    const candidateUrls = buildCandidateUrls(options.url, options.wifiPages, options.fallbackWifiPages);
    const pendingKeys = new Set(requestedAssignments.map(([key]) => key));
    const discoveredPages = [];

    for (const candidateUrl of candidateUrls) {
      logMessage(options, `[open] ${candidateUrl.href}`);
      await gotoSafe(page, candidateUrl, options.timeoutMs);
      await maybeLogin(page, options);
      await sleep(500);
      await prepareWifiSecurityControls(page, options);
      if (options.inspect) {
        await logPageInspectionSummary(page, options, candidateUrl);
      }

      const plan = await buildWifiPlan(page, options);
      const relevantAssignments = requestedAssignments.filter(([key]) => pendingKeys.has(key));
      const { foundKeys } = logPlanFields(plan, options, relevantAssignments);
      const newKeys = foundKeys.filter((key) => pendingKeys.has(key));
      if (newKeys.length) {
        discoveredPages.push({ url: candidateUrl.href, keys: newKeys });
        newKeys.forEach((key) => pendingKeys.delete(key));
        logMessage(options, `[discover] ${candidateUrl.href} can update ${newKeys.join(', ')}`);
      }
      if (!pendingKeys.size) break;
    }

    if (pendingKeys.size) {
      logMessage(options, `[fields] unresolved: ${Array.from(pendingKeys).join(', ')}`);
    } else if (!options.apply) {
      logMessage(options, '[dry-run] all requested WiFi fields were found. Add --apply to save.');
      return {
        ok: true,
        applied: false,
        target: options.url.href,
        matchedUrl: discoveredPages.map((entry) => entry.url).join(', '),
        matchedUrls: discoveredPages.map((entry) => entry.url),
        messages
      };
    } else {
      const appliedUrls = [];
      for (const entry of discoveredPages) {
        const applyUrl = new URL(entry.url);
        logMessage(options, `[apply-open] ${applyUrl.href}`);
        await gotoSafe(page, applyUrl, options.timeoutMs);
        await maybeLogin(page, options);
        await sleep(500);
        await prepareWifiSecurityControls(page, options);
        const plan = await buildWifiPlan(page, options);
        const result = await fillPlan(page, plan, options, entry.keys);
        if (!result.changed || entry.keys.some((key) => !result.appliedKeys.includes(key))) {
          throw new Error(`Could not apply ${entry.keys.join(', ')} on ${applyUrl.href}.`);
        }
        const verified = await verifyAppliedKeys(page, options, entry.keys);
        if (!verified) {
          throw new Error(`SSID apply was submitted but the router still reports the old WiFi name.`);
        }
        appliedUrls.push(applyUrl.href);
      }
      return {
        ok: true,
        applied: true,
        target: options.url.href,
        matchedUrl: appliedUrls.join(', '),
        matchedUrls: appliedUrls,
        messages
      };
    }

    if (pendingKeys.size && options.inspect) {
      throw new Error(`Could not resolve WiFi fields automatically: ${Array.from(pendingKeys).join(', ')}.`);
    }

    if (pendingKeys.size) {
      for (let index = Math.max(candidateUrls.length - 2, 0); index < candidateUrls.length; index += 1) {
        const inspectUrl = candidateUrls[index];
        if (!inspectUrl) continue;
        await gotoSafe(page, inspectUrl, options.timeoutMs).catch(() => {});
        await maybeLogin(page, options).catch(() => {});
        await sleep(300);
        await logPageInspectionSummary(page, options, inspectUrl).catch(() => {});
      }
    }

    logMessage(options, '[inspect] visible inputs on last page:');
    const summary = await collectInspectionSummary(page);
    if (externalLogger) {
      summary.forEach((entry) => logMessage(options, `[inspect] ${entry.field} = ${entry.value}`));
    } else {
      console.table(summary);
    }
    throw new Error('Could not resolve WiFi fields automatically. Run with --show, then add selectors.wifi in a config file.');
  } catch (error) {
    error.automationMessages = messages;
    throw error;
  } finally {
    if (!options.show) await browser.close();
  }
};

const main = async () => runDirectWebWifiChange(buildOptions());

if (require.main === module) {
  main().catch((error) => {
    console.error(`[error] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  buildOptionsFromRaw,
  runDirectWebWifiChange
};
