const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { PROJECT_ROOT, FLAVORS_DIR } = require('../core/runtime/paths');

const projectRoot = PROJECT_ROOT;
const flavorsDir = FLAVORS_DIR;
const desktopDir = path.resolve(projectRoot, '..');

function normalizeFlavorName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('..')) {
    throw new Error('Flavor name is required.');
  }
  return normalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getFlavorPath(name) {
  return path.join(flavorsDir, `${normalizeFlavorName(name)}.json`);
}

function listFlavorNames() {
  if (!fs.existsSync(flavorsDir)) return [];
  return fs.readdirSync(flavorsDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.basename(name, '.json'))
    .sort();
}

function loadFlavor(name) {
  const filePath = getFlavorPath(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Flavor not found: ${path.relative(projectRoot, filePath)}`);
  }
  return readJson(filePath);
}

function summarizeFlavor(name) {
  const flavor = loadFlavor(name);
  return {
    name,
    branch: flavor.initialAdmin?.branchName || '',
    port: Number(flavor.app?.port || 0),
    upstreamPort: Number(flavor.customerUpstream?.port || 0),
    publicBaseUrl: String(flavor.app?.publicBaseUrl || ''),
    mysqlDatabase: String(flavor.mysql?.database || ''),
    mysqlUser: String(flavor.mysql?.user || ''),
    tunnelHostname: String(flavor.cloudflared?.hostname || ''),
    tunnelId: String(flavor.cloudflared?.tunnel || '')
  };
}

function allFlavorSummaries() {
  return listFlavorNames().map(summarizeFlavor);
}

function findDuplicateIssues(summaries = allFlavorSummaries()) {
  const checks = [
    ['port', 'PORT'],
    ['upstreamPort', 'CUSTOMER_UPSTREAM_PORT'],
    ['mysqlDatabase', 'MySQL database'],
    ['tunnelHostname', 'Cloudflared hostname']
  ];
  const issues = [];
  checks.forEach(([key, label]) => {
    const seen = new Map();
    summaries.forEach((item) => {
      const value = item[key];
      if (value === undefined || value === null || value === '') return;
      const normalized = String(value).trim().toLowerCase();
      if (!normalized || normalized === '0') return;
      const existing = seen.get(normalized);
      if (existing) {
        issues.push(`${label} "${value}" is shared by ${existing} and ${item.name}.`);
      } else {
        seen.set(normalized, item.name);
      }
    });
  });
  return issues;
}

function checkPortOpen(port, host = '127.0.0.1', timeoutMs = 450) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function findRuntimeIssues(targetName) {
  const target = summarizeFlavor(targetName);
  const issues = [];
  if (target.port && await checkPortOpen(target.port)) {
    issues.push(`PORT ${target.port} is already in use.`);
  }
  if (target.upstreamPort && await checkPortOpen(target.upstreamPort)) {
    issues.push(`CUSTOMER_UPSTREAM_PORT ${target.upstreamPort} is already in use.`);
  }
  return issues;
}

function renderBat({ name, title, color = '0B' }) {
  const normalized = normalizeFlavorName(name);
  const flavor = loadFlavor(normalized);
  const label = title || flavor.initialAdmin?.branchName || normalized.toUpperCase();
  const port = flavor.app?.port || 3000;
  const url = flavor.app?.publicBaseUrl || `http://localhost:${port}`;
  return `@echo off
title ${label} BILLING SYSTEM - SERVER RUNNING
color ${color}

echo ==========================================
echo        ${label} BILLING SYSTEM
echo ==========================================
echo.
echo Starting isolated ${label} flavor...
echo Folder: ${projectRoot}
echo Local URL: http://localhost:${port}
echo Public Domain: ${url}
echo.
echo DO NOT CLOSE THIS WINDOW while using the system.
echo ==========================================
echo.

cd /d "${projectRoot}"
call npm.cmd run flavor:start -- ${normalized}

pause
`;
}

function writeLauncher(name, options = {}) {
  const normalized = normalizeFlavorName(name);
  const flavor = loadFlavor(normalized);
  const label = options.title || flavor.initialAdmin?.branchName || normalized.toUpperCase();
  const filename = options.filename || `Start_${String(label).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_Billing.bat`;
  const targetPath = path.join(options.dir || desktopDir, filename);
  fs.writeFileSync(targetPath, renderBat({ name: normalized, title: label, color: options.color || '0B' }), 'utf8');
  return targetPath;
}

function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const label = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(label, (answer) => {
      rl.close();
      resolve(String(answer || defaultValue).trim());
    });
  });
}

async function createFlavorInteractively(name) {
  const normalized = normalizeFlavorName(name || await prompt('Flavor name'));
  const targetPath = getFlavorPath(normalized);
  if (fs.existsSync(targetPath)) {
    throw new Error(`Flavor already exists: ${path.relative(projectRoot, targetPath)}`);
  }
  const baseName = listFlavorNames()[0];
  const base = baseName ? loadFlavor(baseName) : readJson(path.join(projectRoot, 'flavor.config.example.json'));
  const next = JSON.parse(JSON.stringify(base));
  const title = await prompt('Branch/display name', normalized.toUpperCase());
  const port = Number(await prompt('App port', '3000'));
  const upstreamPort = Number(await prompt('Customer upstream port', String(port + 1001)));
  const url = await prompt('Public base URL', `http://localhost:${port}`);
  const db = await prompt('MySQL database', normalized.replace(/-/g, '_'));
  const dbUser = await prompt('MySQL user', next.mysql?.user || 'root');
  const dbPassword = await prompt('MySQL password', next.mysql?.password || '');

  next.app = {
    ...(next.app || {}),
    port,
    publicBaseUrl: url,
    centralUrl: url,
    appBaseUrl: url,
    sessionCookieName: `${normalized.replace(/[^a-z0-9]/g, '')}Session`
  };
  next.customerUpstream = {
    ...(next.customerUpstream || {}),
    port: upstreamPort,
    url: `http://127.0.0.1:${upstreamPort}`
  };
  next.mysql = {
    ...(next.mysql || {}),
    user: dbUser,
    password: dbPassword,
    database: db
  };
  next.initialAdmin = {
    ...(next.initialAdmin || {}),
    branchName: title
  };
  next.cloudflared = {
    ...(next.cloudflared || {}),
    hostname: url.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''),
    service: `http://localhost:${port}`
  };

  writeJson(targetPath, next);
  return targetPath;
}

module.exports = {
  allFlavorSummaries,
  createFlavorInteractively,
  findDuplicateIssues,
  findRuntimeIssues,
  getFlavorPath,
  listFlavorNames,
  loadFlavor,
  normalizeFlavorName,
  projectRoot,
  summarizeFlavor,
  writeLauncher
};
