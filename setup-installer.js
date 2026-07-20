const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const archiver = require('archiver');
const { getUserFromSession, getUserFromBasicAuth } = require('./auth');
const {
  getMysqlRuntimeConfig,
  getEffectiveMysqlConfig,
  getMysqlConfigSource,
  isMysqlEnabled,
  setMysqlRuntimeConfig,
  clearMysqlRuntimeConfig,
  testMysqlConnection,
  normalizeMysqlConfig,
  maskMysqlConfig
} = require('./db');
const {
  setMasterKey,
  clearMasterKey,
  getMasterKeySource
} = require('./db-secrets');
const { clearRelationalCache } = require('./db-relational');
const { readJson, writeJson } = require('./data-store');
const { accountHasRole } = require('./role-utils');
const {
  APP_DOWNLOAD_SLOT_COUNT,
  DEFAULT_APP_NAME,
  normalizeSlotNumber,
  readAppDownloadsConfig,
  writeAppDownloadsConfig,
  writeAppDownloadAsset
} = require('./app-downloads-store');

const router = express.Router();
const rootDir = __dirname;
const releaseDir = path.join(rootDir, 'releases');
const applyBackupDir = path.join(releaseDir, 'apply-backups');
const applyStateFile = path.join(releaseDir, 'apply-state.json');
const latestPackageName = 'billing-system-structure-latest.zip';
const latestPackagePath = path.join(releaseDir, latestPackageName);
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const APPLY_BACKUP_RETAIN_COUNT = 1;
const SUPPORTED_SCHEMA_VERSION = 1;
const SCHEMA_SCRIPT = path.join(rootDir, 'scripts', 'migrate-json-to-schema.js');
const MIGRATE_SCRIPT = path.join(rootDir, 'scripts', 'migrate-json-to-relational.js');
const APPLY_TEMP_PREFIX = 'billing-structure-apply-';
let schemaRunPromise = null;
let migrationRunPromise = null;
const PROJECT_ARCHIVE_PREFIX = 'billing-system-project';
const STRUCTURE_ARCHIVE_PREFIX = 'billing-system-structure';
const CLOUDFLARED_DIR = path.join(rootDir, '.cloudflared');
const CLOUDFLARED_CONFIG_FILE = path.join(CLOUDFLARED_DIR, 'config.yml');
const DEFAULT_CLOUDFLARED_SERVICE = 'http://127.0.0.1:3000';
const DEFAULT_CLOUDFLARED_CONFIG = Object.freeze({
  tunnelId: '',
  credentialsFile: '',
  hostname: '',
  service: DEFAULT_CLOUDFLARED_SERVICE,
  warpRoutingEnabled: false
});
const ACCOUNT_NUMBER_SETTINGS_KEY = 'account_number_settings';
const ACCOUNT_PREFIX_ID_DIGITS = 3;
const APP_ICON_MAX_BYTES = 12 * 1024 * 1024;
const APP_ICON_MIME_TO_EXTENSION = Object.freeze({
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg'
});
const APP_ICON_ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const APP_FILE_ALLOWED_EXTENSIONS = new Set(['.apk', '.xapk', '.aab', '.ipa', '.zip']);

const ZIP_CONTENT_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
];

const STRUCTURE_MANIFEST_FILE = 'structure-manifest.json';
const REQUIRED_FILES = [
  'server.js',
  'package.json',
  'setup-installer.js',
  'public/update-download.html'
];
const OPTIONAL_STRUCTURE_FILES = [STRUCTURE_MANIFEST_FILE];
const UPDATE_SCOPE_ALL = 'all';
const UPDATE_SCOPE_PAGES = 'pages';
const APPLY_BLOCKED_PREFIXES = [
  '.git/',
  '.cloudflared/',
  'releases/',
  'logs/',
  'node_modules/',
  'data/',
  'public/uploads/'
];
const APPLY_BLOCKED_ROOT_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i
];
const SHARED_ARCHIVE_IGNORE = [
  '**/.git/**',
  '**/.cloudflared/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/logs/**',
  '**/releases/**',
  '**/.tmp/**',
  '**/.tmp-*/**',
  '**/coverage/**',
  '**/*.log',
  'caches/**',
  'gradle/**',
  'wrapper/**',
  'daemon/**',
  'kotlin-profile/**',
  'android/**',
  'native/**'
];
const STRUCTURE_ARCHIVE_IGNORE = [
  ...SHARED_ARCHIVE_IGNORE,
  '**/node_modules/**',
  'data/**',
  'public/uploads/**',
  STRUCTURE_MANIFEST_FILE
];
const PROJECT_ARCHIVE_IGNORE_BASE = [
  ...SHARED_ARCHIVE_IGNORE
];
const PROJECT_ARCHIVE_CLEAN_IGNORE = [
  'data/**',
  '**/data/**',
  'public/uploads/**',
  '**/mysql-config.json',
  '**/master-key.json',
  '.env',
  '.env.*'
];

const makeError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
};
const normalizeUpdateScope = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === UPDATE_SCOPE_PAGES ? UPDATE_SCOPE_PAGES : UPDATE_SCOPE_ALL;
};
const normalizePageKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
const normalizePageKeyList = (values) => {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  const normalized = [];
  values.forEach((value) => {
    const key = normalizePageKey(value);
    if (!key || unique.has(key)) return;
    unique.add(key);
    normalized.push(key);
  });
  return normalized;
};
const parseSelectedPagesFromRequest = (value) => {
  if (Array.isArray(value)) {
    const combined = value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(',');
    return normalizePageKeyList(combined.split(','));
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizePageKeyList(parsed);
      }
    } catch {
      // Fallback to comma-separated format.
    }
    return normalizePageKeyList(raw.split(','));
  }
  return [];
};
const normalizePrefixId = (value) =>
  String(value || '')
    .replace(/\D/g, '')
    .slice(0, ACCOUNT_PREFIX_ID_DIGITS);

const isValidGeneratedPrefixId = (value) =>
  new RegExp(`^[1-9]\\d{${ACCOUNT_PREFIX_ID_DIGITS - 1}}$`).test(normalizePrefixId(value));

const normalizeAccountNumberSettings = (incoming = {}) => ({
  prefixId: normalizePrefixId(incoming?.prefixId || incoming?.serverPrefixId || incoming?.prefix || '')
});

const readAccountNumberSettings = async () => {
  if (!isMysqlEnabled()) {
    return normalizeAccountNumberSettings({});
  }
  const stored = await readJson(ACCOUNT_NUMBER_SETTINGS_KEY, {});
  const settings = normalizeAccountNumberSettings(stored);
  return {
    prefixId: isValidGeneratedPrefixId(settings.prefixId) ? settings.prefixId : ''
  };
};
const buildStructureManifest = (overrides = {}) => ({
  type: 'billing-structure',
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  ...overrides
});

const appendLimited = (current, chunk, limit = 12000) => {
  const next = `${current}${chunk}`;
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
};

const buildArchiveStamp = () => {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${iso}-${suffix}`;
};

const normalizeArchivePath = (value) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+|\/+$/g, '');

const SHARED_SKIPPED_DIR_NAMES = new Set([
  '.git',
  '.cloudflared',
  '.idea',
  '.vscode',
  '.tmp',
  'logs',
  'releases',
  'coverage',
  'caches',
  'gradle',
  'wrapper',
  'daemon',
  'kotlin-profile',
  'android',
  'native'
]);
const STRUCTURE_SKIPPED_ROOT_FILE_NAMES = new Set([
  'base64.txt',
  'cookies.txt',
  'customer-cookie.txt',
  'login.json',
  'tmp-cookie.txt',
  'tmp-login.json',
  'tmp-login-new.json',
  'tmp-login-space.json',
  'tmp-update.json',
  'tmp.txt',
  'tree.txt'
]);
const STRUCTURE_SKIPPED_FILE_EXTENSIONS = new Set([
  '.msi',
  '.pdf'
]);
const STRUCTURE_SKIPPED_ROOT_FILE_PATTERNS = [
  /^\.?tmp[-_.]/i
];

const shouldSkipArchiveDirectory = (relativePath, options = {}) => {
  const normalized = normalizeArchivePath(relativePath);
  if (!normalized) return false;

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return false;

  const name = parts[parts.length - 1];
  if (!name) return false;
  if (SHARED_SKIPPED_DIR_NAMES.has(name)) return true;
  if (/^\.tmp-/i.test(name)) return true;
  if (!options.includeNodeModules && name === 'node_modules') return true;
  if (!options.includeData && parts[0] === 'data') return true;
  if (parts[0] === 'public' && parts[1] === 'uploads') return true;
  if (options.includeData && parts[0] === 'data' && parts[1] === 'pdf-cache') return true;

  return false;
};

const shouldSkipArchiveFile = (relativePath, options = {}) => {
  const normalized = normalizeArchivePath(relativePath);
  if (!normalized) return true;

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return true;

  const name = parts[parts.length - 1];
  if (!name) return true;
  if (name === STRUCTURE_MANIFEST_FILE) return true;
  if (/\.log$/i.test(name)) return true;
  if (!options.includeNodeModules && parts.includes('node_modules')) return true;
  if (!options.includeData && parts[0] === 'data') return true;
  if (parts[0] === 'public' && parts[1] === 'uploads') return true;
  if (options.includeData && parts[0] === 'data' && parts[1] === 'pdf-cache') return true;
  if (options.excludeSensitiveEnv && parts.length === 1 && (name === '.env' || name.startsWith('.env.'))) {
    return true;
  }
  if (options.excludeSensitiveDataFiles && /(^|\/)(mysql-config|master-key)\.json$/i.test(normalized)) {
    return true;
  }
  if (options.structurePackage) {
    const extension = path.extname(name).toLowerCase();
    if (STRUCTURE_SKIPPED_FILE_EXTENSIONS.has(extension)) {
      return true;
    }
    if (parts.length === 1) {
      const lowerName = name.toLowerCase();
      if (STRUCTURE_SKIPPED_ROOT_FILE_NAMES.has(lowerName)) {
        return true;
      }
      if (STRUCTURE_SKIPPED_ROOT_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
        return true;
      }
    }
  }

  return false;
};

const appendArchiveTree = async (archive, sourceDir, relativeDir = '', options = {}) => {
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = normalizeArchivePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    const absolutePath = path.join(sourceDir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipArchiveDirectory(relativePath, options)) continue;
      await appendArchiveTree(archive, absolutePath, relativePath, options);
      continue;
    }

    if (!entry.isFile()) continue;
    if (shouldSkipArchiveFile(relativePath, options)) continue;
    archive.file(absolutePath, { name: relativePath });
  }
};

const collectArchiveTreeFiles = async (sourceDir, relativeDir = '', options = {}) => {
  const files = [];
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = normalizeArchivePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    const absolutePath = path.join(sourceDir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipArchiveDirectory(relativePath, options)) continue;
      files.push(...await collectArchiveTreeFiles(absolutePath, relativePath, options));
      continue;
    }

    if (!entry.isFile()) continue;
    if (shouldSkipArchiveFile(relativePath, options)) continue;
    files.push(relativePath);
  }

  return files;
};

const cloneDefaultCloudflaredConfig = () => ({ ...DEFAULT_CLOUDFLARED_CONFIG });

const unquoteYamlScalar = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
};

const toYamlSingleQuoted = (value) => `'${String(value || '').replace(/'/g, "''")}'`;

const parseCloudflaredConfig = (rawText) => {
  const raw = String(rawText || '');
  const parsed = cloneDefaultCloudflaredConfig();

  const tunnelMatch = raw.match(/^\s*tunnel:\s*(.+)$/im);
  if (tunnelMatch && tunnelMatch[1]) {
    parsed.tunnelId = unquoteYamlScalar(tunnelMatch[1]);
  }

  const credentialsMatch = raw.match(/^\s*credentials-file:\s*(.+)$/im);
  if (credentialsMatch && credentialsMatch[1]) {
    parsed.credentialsFile = unquoteYamlScalar(credentialsMatch[1]);
  }

  const ingressMatch = raw.match(/^\s*-\s*hostname:\s*(.+?)\s*[\r\n]+\s*service:\s*(.+)$/im);
  if (ingressMatch && ingressMatch[1]) {
    parsed.hostname = unquoteYamlScalar(ingressMatch[1]).toLowerCase();
    const ingressService = unquoteYamlScalar(ingressMatch[2]);
    if (/^https?:\/\/\S+$/i.test(ingressService)) {
      parsed.service = ingressService;
    }
  }

  if (!parsed.service) {
    const serviceLines = raw.match(/^\s*service:\s*(.+)$/gim) || [];
    for (const line of serviceLines) {
      const value = unquoteYamlScalar(String(line).replace(/^\s*service:\s*/i, ''));
      if (/^https?:\/\/\S+$/i.test(value)) {
        parsed.service = value;
        break;
      }
    }
  }

  const warpMatch = raw.match(/warp-routing:\s*[\r\n]+[\s\S]*?^\s*enabled:\s*(true|false)\s*$/im);
  if (warpMatch && warpMatch[1]) {
    parsed.warpRoutingEnabled = String(warpMatch[1]).toLowerCase() === 'true';
  }

  if (!parsed.service) {
    parsed.service = DEFAULT_CLOUDFLARED_SERVICE;
  }

  return parsed;
};

const isLikelyValidHostname = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 253) return false;
  if (!normalized.includes('.')) return false;
  if (!/^[a-z0-9.-]+$/i.test(normalized)) return false;
  if (normalized.startsWith('.') || normalized.endsWith('.')) return false;
  const segments = normalized.split('.');
  if (segments.some((part) => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))) {
    return false;
  }
  return true;
};

const getDefaultCloudflaredCredentialsPath = (tunnelId) =>
  path.join(os.homedir(), '.cloudflared', `${String(tunnelId || '').trim()}.json`);

const normalizeCloudflaredConfigInput = (incoming) => {
  const payload = incoming && typeof incoming === 'object' ? incoming : {};
  const tunnelId = String(payload.tunnelId || payload.tunnel || '').trim();
  const providedCredentialsFile = String(payload.credentialsFile || payload.credentialsPath || '').trim();
  const hostname = String(payload.hostname || '').trim().toLowerCase();
  const service = String(payload.service || payload.localService || DEFAULT_CLOUDFLARED_SERVICE).trim();
  const warpRoutingEnabled = payload.warpRoutingEnabled === true || toBool(payload.warpRoutingEnabled);

  if (!tunnelId) {
    throw makeError('Tunnel ID is required.');
  }
  if (!/^[a-z0-9-]{8,120}$/i.test(tunnelId)) {
    throw makeError('Tunnel ID looks invalid. Use the exact value from Cloudflare.');
  }
  if (!hostname) {
    throw makeError('Public hostname is required.');
  }
  if (!isLikelyValidHostname(hostname)) {
    throw makeError('Public hostname is invalid. Example: app.example.com');
  }
  if (!/^https?:\/\/\S+$/i.test(service)) {
    throw makeError('Local service must be a valid http:// or https:// URL.');
  }
  const credentialsFile = providedCredentialsFile || getDefaultCloudflaredCredentialsPath(tunnelId);

  return {
    tunnelId,
    credentialsFile,
    hostname,
    service,
    warpRoutingEnabled
  };
};

const renderCloudflaredConfig = (incoming) => {
  const config = normalizeCloudflaredConfigInput(incoming);
  return [
    '# Generated from owner setup page. Keep this file private.',
    `tunnel: ${toYamlSingleQuoted(config.tunnelId)}`,
    `credentials-file: ${toYamlSingleQuoted(config.credentialsFile)}`,
    '',
    'ingress:',
    `  - hostname: ${toYamlSingleQuoted(config.hostname)}`,
    `    service: ${toYamlSingleQuoted(config.service)}`,
    '  - service: http_status:404',
    '',
    '# Optional origin request tuning for Express behind Cloudflare.',
    'warp-routing:',
    `  enabled: ${config.warpRoutingEnabled ? 'true' : 'false'}`,
    ''
  ].join('\n');
};

const buildCloudflaredCommands = (config) => {
  const source = config && typeof config === 'object' ? config : {};
  const tunnelId = String(source.tunnelId || '').trim() || '<TUNNEL_ID>';
  const hostname = String(source.hostname || '').trim() || '<app.example.com>';
  return [
    'winget install --id Cloudflare.cloudflared -e',
    'cloudflared tunnel login',
    `cloudflared tunnel route dns ${tunnelId} ${hostname}`,
    'npm start'
  ];
};

const readCloudflaredConfigFile = async () => {
  try {
    const raw = await fsp.readFile(CLOUDFLARED_CONFIG_FILE, 'utf8');
    return {
      configExists: true,
      config: parseCloudflaredConfig(raw)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        configExists: false,
        config: cloneDefaultCloudflaredConfig()
      };
    }
    throw error;
  }
};

const detectCloudflaredBinary = () => new Promise((resolve) => {
  let stdout = '';
  let stderr = '';
  let finished = false;

  const complete = (result) => {
    if (finished) return;
    finished = true;
    resolve(result);
  };

  const child = spawn('cloudflared', ['--version'], {
    cwd: rootDir,
    windowsHide: true
  });

  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // best effort
    }
    complete({
      installed: false,
      version: '',
      error: 'Timed out while checking cloudflared.'
    });
  }, 3500);

  child.stdout.on('data', (data) => {
    stdout = appendLimited(stdout, data.toString(), 2000);
  });
  child.stderr.on('data', (data) => {
    stderr = appendLimited(stderr, data.toString(), 2000);
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    if (error && error.code === 'ENOENT') {
      return complete({
        installed: false,
        version: '',
        error: 'cloudflared command not found.'
      });
    }
    return complete({
      installed: false,
      version: '',
      error: error.message || 'Failed to check cloudflared.'
    });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) {
      return complete({
        installed: true,
        version: String(stdout || stderr || '').trim(),
        error: ''
      });
    }
    const output = String(stderr || stdout || '').trim();
    return complete({
      installed: false,
      version: '',
      error: output || `cloudflared exited with code ${code}.`
    });
  });
});

const runSchemaUpdate = async (options = {}) => {
  if (schemaRunPromise) {
    throw makeError('Schema update already running.', 409);
  }
  if (migrationRunPromise) {
    throw makeError('JSON migration already running.', 409);
  }
  const reset = options.reset === true;
  const branchName = String(options.branchName || '').trim();
  const env = { ...process.env };
  if (reset) env.RESET_DB = 'true';
  if (branchName) env.INITIAL_BRANCH_NAME = branchName;

  const startedAt = Date.now();
  schemaRunPromise = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [SCHEMA_SCRIPT], {
      cwd: rootDir,
      env
    });
    child.stdout.on('data', (data) => {
      stdout = appendLimited(stdout, data.toString());
    });
    child.stderr.on('data', (data) => {
      stderr = appendLimited(stderr, data.toString());
    });
    child.on('error', (error) => {
      schemaRunPromise = null;
      reject(makeError(`Failed to start schema update: ${error.message}`, 500));
    });
    child.on('close', (code) => {
      schemaRunPromise = null;
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        return resolve({ stdout, stderr, durationMs });
      }
      const combined = (stderr || stdout || '').trim();
      const tail = combined ? ` ${combined}` : '';
      return reject(makeError(`Schema update failed (exit code ${code}).${tail}`, 500));
    });
  });

  return schemaRunPromise;
};

const runJsonMigration = async (options = {}) => {
  if (migrationRunPromise) {
    throw makeError('JSON migration already running.', 409);
  }
  if (schemaRunPromise) {
    throw makeError('Schema update already running.', 409);
  }
  const reset = options.reset === true;
  const branchName = String(options.branchName || '').trim();
  const env = { ...process.env };
  if (reset) env.RESET_DB = 'true';
  if (branchName) env.INITIAL_BRANCH_NAME = branchName;

  const startedAt = Date.now();
  migrationRunPromise = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [MIGRATE_SCRIPT], {
      cwd: rootDir,
      env
    });
    child.stdout.on('data', (data) => {
      stdout = appendLimited(stdout, data.toString());
    });
    child.stderr.on('data', (data) => {
      stderr = appendLimited(stderr, data.toString());
    });
    child.on('error', (error) => {
      migrationRunPromise = null;
      reject(makeError(`Failed to start JSON migration: ${error.message}`, 500));
    });
    child.on('close', (code) => {
      migrationRunPromise = null;
      const durationMs = Date.now() - startedAt;
      if (code === 0) {
        return resolve({ stdout, stderr, durationMs });
      }
      const combined = (stderr || stdout || '').trim();
      const tail = combined ? ` ${combined}` : '';
      return reject(makeError(`JSON migration failed (exit code ${code}).${tail}`, 500));
    });
  });

  return migrationRunPromise;
};

const buildMysqlConfigForSave = (incoming, currentConfig) => {
  const payload = incoming && typeof incoming === 'object' ? incoming : {};
  const normalized = normalizeMysqlConfig(payload);

  const preservePassword = payload.preservePassword !== false;
  const clearPassword = payload.clearPassword === true;
  const incomingPassword = hasOwn(payload, 'password') ? String(payload.password || '') : '';
  const currentPassword = currentConfig && hasOwn(currentConfig, 'password')
    ? String(currentConfig.password || '')
    : '';

  if (clearPassword) {
    normalized.password = '';
  } else if (preservePassword && incomingPassword === '' && currentPassword) {
    normalized.password = currentPassword;
  }

  return normalized;
};

async function resolveAuthorizedUser(req) {
  const basicUser = getUserFromBasicAuth ? getUserFromBasicAuth(req) : null;
  if (basicUser) {
    return { ok: true, user: basicUser };
  }

  const user = await getUserFromSession(req);
  if (!user) {
    return { ok: false, statusCode: 401, error: 'Unauthorized' };
  }

  if (!accountHasRole(user, 'Admin')) {
    return { ok: false, statusCode: 403, error: 'Admin access required' };
  }

  return { ok: true, user };
}

const sanitizeBaseName = (name) => {
  const stripped = String(name || '')
    .trim()
    .replace(/\.zip$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return stripped || 'uploaded-structure';
};

const sanitizeUploadStem = (name, fallback = 'upload') => {
  const stripped = String(name || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return stripped || fallback;
};

const parseUploadedFileName = (value, fallback = 'upload') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    return path.basename(decoded.replace(/["']/g, '')) || fallback;
  } catch {
    return path.basename(raw.replace(/["']/g, '')) || fallback;
  }
};

const resolveImageUploadExtension = (fileName, contentType) => {
  const normalizedType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (APP_ICON_MIME_TO_EXTENSION[normalizedType]) {
    return APP_ICON_MIME_TO_EXTENSION[normalizedType];
  }
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (APP_ICON_ALLOWED_EXTENSIONS.has(extension)) {
    return extension === '.jpeg' ? '.jpg' : extension;
  }
  throw makeError('Unsupported icon file type. Upload JPG, PNG, WEBP, GIF, or SVG.', 415);
};

const resolveAppUploadExtension = (fileName) => {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (APP_FILE_ALLOWED_EXTENSIONS.has(extension)) {
    return extension;
  }
  throw makeError('Unsupported app file type. Upload APK, XAPK, AAB, IPA, or ZIP.', 415);
};

const getAppSlotByNumber = (config, slotNumber) =>
  Array.isArray(config?.slots) ? config.slots.find((entry) => Number(entry?.slot) === slotNumber) || null : null;

const buildAppDownloadsConfigWithSlotPatch = (config, slotNumber, patch = {}) => ({
  slots: Array.isArray(config?.slots)
    ? config.slots.map((slot) => {
      if (Number(slot?.slot) !== slotNumber) return slot;
      return {
        ...slot,
        ...patch,
        slot: slotNumber,
        name: String(patch.name ?? slot.name ?? DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME,
        updatedAt: new Date().toISOString()
      };
    })
    : []
});

const hasZipSignature = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
};

const readBinaryBody = (req, maxBytes = MAX_UPLOAD_BYTES) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;

  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      reject(makeError(`File is too large. Max ${Math.round(maxBytes / (1024 * 1024))}MB`, 413));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    resolve(Buffer.concat(chunks));
  });

  req.on('error', (error) => {
    reject(error);
  });
});

const normalizeEntryName = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');

const findEndOfCentralDirectoryOffset = (zipBuffer) => {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, zipBuffer.length - 0xffff - 22);
  for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  return -1;
};

const parseZipEntries = (zipBuffer) => {
  const eocdOffset = findEndOfCentralDirectoryOffset(zipBuffer);
  if (eocdOffset < 0) {
    throw makeError('Invalid ZIP file: central directory not found');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let cursor = centralDirOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    const sig = zipBuffer.readUInt32LE(cursor);
    if (sig !== 0x02014b50) {
      throw makeError('Invalid ZIP file: malformed central directory');
    }

    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const filenameLength = zipBuffer.readUInt16LE(cursor + 28);
    const extraLength = zipBuffer.readUInt16LE(cursor + 30);
    const commentLength = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);
    const filenameStart = cursor + 46;
    const filenameEnd = filenameStart + filenameLength;
    const name = normalizeEntryName(zipBuffer.toString('utf8', filenameStart, filenameEnd));

    const localSig = zipBuffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw makeError('Invalid ZIP file: malformed local file header');
    }

    const localFilenameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      dataOffset
    });

    cursor = filenameEnd + extraLength + commentLength;
  }

  return entries;
};

const normalizeEntriesForValidation = (entries) => {
  const fileNames = entries
    .map((entry) => normalizeEntryName(entry.name))
    .filter((name) => Boolean(name) && !name.endsWith('/'));

  if (!fileNames.length) return [];

  const firstSegments = fileNames
    .map((name) => name.split('/')[0])
    .filter(Boolean);
  const uniqueSegments = [...new Set(firstSegments)];

  const hasRootLevelFiles = fileNames.some((name) => !name.includes('/'));
  if (uniqueSegments.length === 1 && !hasRootLevelFiles) {
    const prefix = `${uniqueSegments[0]}/`;
    return fileNames.map((name) => name.startsWith(prefix) ? name.slice(prefix.length) : name);
  }

  return fileNames;
};

const isSafeRelativePath = (value) => {
  const normalized = normalizeEntryName(value);
  if (!normalized) return false;
  if (normalized.includes('\0')) return false;
  if (/^[a-z]:/i.test(normalized)) return false;
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return false;
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return false;
  }
  return true;
};

const assertSafeRelativePath = (value) => {
  const normalized = normalizeEntryName(value);
  if (!isSafeRelativePath(normalized)) {
    throw makeError(`Unsafe path in structure package: ${String(value || '')}`);
  }
  return normalized;
};

const resolvePathWithin = (basePath, relativePath) => {
  const safeRelative = assertSafeRelativePath(relativePath);
  const baseResolved = path.resolve(basePath);
  const targetResolved = path.resolve(baseResolved, safeRelative);
  const relative = path.relative(baseResolved, targetResolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw makeError(`Unsafe extraction path: ${safeRelative}`);
  }
  return targetResolved;
};

const pathExists = async (filePath) => {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isPathWithin = (basePath, targetPath) => {
  const baseResolved = path.resolve(basePath);
  const targetResolved = path.resolve(targetPath);
  const relative = path.relative(baseResolved, targetResolved);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const getPathSizeBytes = async (targetPath) => {
  const stats = await fsp.stat(targetPath);
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;

  let total = 0;
  const stack = [targetPath];
  while (stack.length) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(childPath);
      } else if (entry.isFile()) {
        const childStats = await fsp.stat(childPath);
        total += childStats.size;
      }
    }
  }
  return total;
};

const isOldStructureArchiveName = (fileName) => {
  const lowerName = String(fileName || '').toLowerCase();
  if (lowerName === latestPackageName.toLowerCase()) return false;
  return lowerName.endsWith('.zip');
};

const isStructureTempArchiveName = (fileName) => {
  const lowerName = String(fileName || '').toLowerCase();
  return lowerName.startsWith(`${latestPackageName.toLowerCase()}.`) && lowerName.endsWith('.tmp');
};

const cleanupStructureReleaseArtifacts = async (options = {}) => {
  const summary = {
    deletedFiles: 0,
    deletedDirectories: 0,
    deletedBytes: 0,
    errors: []
  };

  const removePath = async (targetPath, { recursive = false } = {}) => {
    if (!isPathWithin(releaseDir, targetPath)) {
      throw makeError(`Refusing to delete path outside releases: ${targetPath}`, 500);
    }
    const bytes = await getPathSizeBytes(targetPath).catch(() => 0);
    await fsp.rm(targetPath, { recursive, force: true });
    summary.deletedBytes += bytes;
    if (recursive) {
      summary.deletedDirectories += 1;
    } else {
      summary.deletedFiles += 1;
    }
  };

  try {
    await fsp.mkdir(releaseDir, { recursive: true });
    const entries = await fsp.readdir(releaseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isOldStructureArchiveName(entry.name) && !isStructureTempArchiveName(entry.name)) continue;
      try {
        await removePath(path.join(releaseDir, entry.name));
      } catch (error) {
        summary.errors.push(`${entry.name}: ${error.message || error}`);
      }
    }
  } catch (error) {
    summary.errors.push(`release archives: ${error.message || error}`);
  }

  try {
    if (await pathExists(applyBackupDir)) {
      const backupEntries = await fsp.readdir(applyBackupDir, { withFileTypes: true });
      const backupDirs = [];
      for (const entry of backupEntries) {
        if (!entry.isDirectory() || !String(entry.name || '').startsWith('apply-')) continue;
        const backupPath = path.join(applyBackupDir, entry.name);
        const stats = await fsp.stat(backupPath);
        backupDirs.push({ name: entry.name, path: backupPath, mtimeMs: stats.mtimeMs });
      }

      backupDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const keepNames = new Set(
        backupDirs.slice(0, APPLY_BACKUP_RETAIN_COUNT).map((entry) => entry.name)
      );
      const keepApplyBackupDir = options.keepApplyBackupDir
        ? path.basename(String(options.keepApplyBackupDir))
        : '';
      if (keepApplyBackupDir) {
        keepNames.add(keepApplyBackupDir);
      }

      for (const entry of backupDirs) {
        if (keepNames.has(entry.name)) continue;
        try {
          await removePath(entry.path, { recursive: true });
        } catch (error) {
          summary.errors.push(`${entry.name}: ${error.message || error}`);
        }
      }
    }
  } catch (error) {
    summary.errors.push(`apply backups: ${error.message || error}`);
  }

  summary.deletedCount = summary.deletedFiles + summary.deletedDirectories;
  return summary;
};

const buildNormalizedEntryRecords = (entries, normalizedNames) => {
  if (!Array.isArray(entries) || !Array.isArray(normalizedNames) || entries.length !== normalizedNames.length) {
    throw makeError('Invalid ZIP file structure.');
  }
  const seen = new Set();
  return normalizedNames.map((normalizedName, index) => {
    const safeName = assertSafeRelativePath(normalizedName);
    const lowerName = safeName.toLowerCase();
    if (seen.has(lowerName)) {
      throw makeError(`Duplicate file path in structure package: ${safeName}`);
    }
    seen.add(lowerName);
    return {
      entry: entries[index],
      normalizedName: safeName
    };
  });
};

const shouldApplyStructurePath = (relativePath) => {
  const normalized = assertSafeRelativePath(relativePath).toLowerCase();
  if (APPLY_BLOCKED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (!normalized.includes('/')) {
    return !APPLY_BLOCKED_ROOT_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
  }
  return true;
};

const titleFromPageKey = (value) =>
  String(value || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Page';

const buildPackagePageTargets = (normalizedEntries) => {
  const entries = Array.isArray(normalizedEntries) ? normalizedEntries : [];
  const applyPathByLower = new Map();

  entries.forEach((item) => {
    const relativePath = assertSafeRelativePath(item?.normalizedName || '');
    if (!shouldApplyStructurePath(relativePath)) return;
    applyPathByLower.set(relativePath.toLowerCase(), relativePath);
  });

  const pageMap = new Map();

  applyPathByLower.forEach((relativePath) => {
    const htmlMatch = /^public\/([^/]+)\.html$/i.exec(relativePath);
    if (!htmlMatch || !htmlMatch[1]) return;

    const key = normalizePageKey(htmlMatch[1]);
    if (!key) return;

    if (!pageMap.has(key)) {
      pageMap.set(key, {
        key,
        label: titleFromPageKey(key),
        htmlPath: relativePath,
        paths: new Set([relativePath])
      });
    } else {
      pageMap.get(key).paths.add(relativePath);
    }
  });

  const includeRelatedPath = (page, candidatePath) => {
    const matched = applyPathByLower.get(candidatePath.toLowerCase());
    if (!matched) return;
    page.paths.add(matched);
  };

  pageMap.forEach((page) => {
    const key = page.key;
    [
      `public/${key}.js`,
      `public/${key}.css`,
      `public/js/${key}.js`,
      `public/css/${key}.css`
    ].forEach((candidatePath) => includeRelatedPath(page, candidatePath));
  });

  return [...pageMap.values()]
    .map((page) => ({
      key: page.key,
      label: page.label,
      htmlPath: page.htmlPath,
      paths: [...page.paths].sort((a, b) => a.localeCompare(b)),
      pathCount: page.paths.size
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const normalizeManagedPathList = (values) => {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  const normalized = [];
  values.forEach((value) => {
    const text = normalizeEntryName(value);
    if (!isSafeRelativePath(text)) return;
    if (!shouldApplyStructurePath(text)) return;
    const key = text.toLowerCase();
    if (unique.has(key)) return;
    unique.add(key);
    normalized.push(text);
  });
  return normalized;
};

const loadApplyState = async () => {
  try {
    const raw = await fsp.readFile(applyStateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      managedPaths: normalizeManagedPathList(parsed?.managedPaths)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, managedPaths: [] };
    }
    return { exists: false, managedPaths: [] };
  }
};

const saveApplyState = async (managedPaths) => {
  const normalized = normalizeManagedPathList(managedPaths).sort((a, b) => a.localeCompare(b));
  await fsp.mkdir(releaseDir, { recursive: true });
  await fsp.writeFile(
    applyStateFile,
    `${JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      managedPaths: normalized
    }, null, 2)}\n`,
    'utf8'
  );
};

const collectRelativeFilesUnder = async (basePath, startRelativeDir) => {
  const files = [];
  const safeStart = assertSafeRelativePath(startRelativeDir);
  const startAbsolute = resolvePathWithin(basePath, safeStart);
  if (!await pathExists(startAbsolute)) return files;

  const queue = [{ rel: safeStart, abs: startAbsolute }];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = await fsp.readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry || !entry.name) continue;
      const relative = normalizeEntryName(`${current.rel}/${entry.name}`);
      if (!isSafeRelativePath(relative)) continue;
      const absolute = resolvePathWithin(basePath, relative);
      if (entry.isDirectory()) {
        queue.push({ rel: relative, abs: absolute });
      } else if (entry.isFile()) {
        if (shouldApplyStructurePath(relative)) {
          files.push(relative);
        }
      }
    }
  }

  return files;
};

const computeStalePathsFromPackageScope = async (nextManagedPaths) => {
  const nextSet = new Set(
    nextManagedPaths
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const topLevelDirs = [...new Set(
    nextManagedPaths
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((entry) => entry.includes('/'))
      .map((entry) => entry.split('/')[0])
      .filter(Boolean)
  )];

  const stale = new Set();
  for (const topDir of topLevelDirs) {
    if (!shouldApplyStructurePath(topDir)) continue;
    const existingFiles = await collectRelativeFilesUnder(rootDir, topDir);
    existingFiles.forEach((relativePath) => {
      if (!nextSet.has(relativePath.toLowerCase())) {
        stale.add(relativePath);
      }
    });
  }

  return [...stale].sort((a, b) => a.localeCompare(b));
};

const extractEntryBuffer = (zipBuffer, entry) => {
  const start = entry.dataOffset;
  const end = start + entry.compressedSize;
  const compressed = zipBuffer.subarray(start, end);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }

  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressed);
  }

  throw makeError(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
};

const readJsonEntry = (zipBuffer, entries, normalizedNames, expectedPath) => {
  const normalizedPath = normalizeEntryName(expectedPath);
  const index = normalizedNames.indexOf(normalizedPath);
  if (index < 0) {
    throw makeError(`Missing required file: ${normalizedPath}`);
  }

  const raw = extractEntryBuffer(zipBuffer, entries[index]);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw makeError(`Invalid JSON in ${normalizedPath}`);
  }
  return parsed;
};

const validateManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object') {
    throw makeError('Invalid structure-manifest.json');
  }

  if (String(manifest.type || '').trim().toLowerCase() !== 'billing-structure') {
    throw makeError('Invalid manifest type. Expected type="billing-structure".');
  }

  const schemaVersion = Number(manifest.schemaVersion);
  if (!Number.isInteger(schemaVersion)) {
    throw makeError('Invalid manifest schemaVersion. Expected an integer value.');
  }

  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw makeError(
      `Unsupported manifest schemaVersion ${schemaVersion}. Supported version is ${SUPPORTED_SCHEMA_VERSION}.`
    );
  }
};

const validateZipStructure = (zipBuffer) => {
  const entries = parseZipEntries(zipBuffer).filter((entry) => !entry.name.endsWith('/'));
  const normalizedNames = normalizeEntriesForValidation(entries);
  const normalizedEntries = buildNormalizedEntryRecords(entries, normalizedNames);

  const missing = REQUIRED_FILES.filter((required) => !normalizedNames.includes(required));
  if (missing.length) {
    throw makeError(`Invalid structure package. Missing required files: ${missing.join(', ')}`);
  }

  const manifestPath = STRUCTURE_MANIFEST_FILE;
  const hasManifest = normalizedNames.includes(manifestPath);
  const manifest = hasManifest
    ? readJsonEntry(zipBuffer, entries, normalizedNames, manifestPath)
    : buildStructureManifest({ source: 'legacy-upload' });
  if (hasManifest) {
    validateManifest(manifest);
  }

  const packageJson = readJsonEntry(zipBuffer, entries, normalizedNames, 'package.json');
  if (!packageJson || typeof packageJson !== 'object' || !String(packageJson.name || '').trim()) {
    throw makeError('Invalid package.json in uploaded structure');
  }

  return {
    entryCount: entries.length,
    manifest,
    manifestProvided: hasManifest,
    normalizedEntries
  };
};

async function getLatestPackageInfo() {
  const stats = await fsp.stat(latestPackagePath);
  return {
    name: latestPackageName,
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString()
  };
}

async function saveUploadedPackage(buffer, originalName) {
  await fsp.mkdir(releaseDir, { recursive: true });

  const safeBase = sanitizeBaseName(originalName);
  const tempName = `${latestPackageName}.${safeBase}-${process.pid}-${Date.now()}.tmp`;
  const tempPath = path.join(releaseDir, tempName);

  try {
    await fsp.writeFile(tempPath, buffer);
    await fsp.copyFile(tempPath, latestPackagePath);
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }

  return getLatestPackageInfo();
}

const applyStructurePackage = async (zipBuffer, validation = {}, options = {}) => {
  const normalizedEntries = Array.isArray(validation.normalizedEntries)
    ? validation.normalizedEntries
    : [];
  const scope = normalizeUpdateScope(options.scope);
  const requestedPageKeys = normalizePageKeyList(options.selectedPages);
  const packagePageTargets = buildPackagePageTargets(normalizedEntries);
  const packagePageTargetMap = new Map(packagePageTargets.map((item) => [item.key, item]));

  let selectedPathLowerSet = null;
  if (scope === UPDATE_SCOPE_PAGES) {
    if (!requestedPageKeys.length) {
      throw makeError('Select at least one page to update.', 400);
    }
    const missingPageKeys = requestedPageKeys.filter((key) => !packagePageTargetMap.has(key));
    if (missingPageKeys.length) {
      throw makeError(`Selected pages are not available in this package: ${missingPageKeys.join(', ')}`, 400);
    }
    selectedPathLowerSet = new Set();
    requestedPageKeys.forEach((key) => {
      const target = packagePageTargetMap.get(key);
      (target?.paths || []).forEach((pathText) => {
        selectedPathLowerSet.add(String(pathText || '').toLowerCase());
      });
    });
    if (!selectedPathLowerSet.size) {
      throw makeError('No files matched the selected pages in this package.', 400);
    }
  }

  const applyEntries = [];
  const skippedPaths = [];
  const filteredPaths = [];

  normalizedEntries.forEach((item) => {
    const relativePath = assertSafeRelativePath(item?.normalizedName || '');
    const lowerRelativePath = relativePath.toLowerCase();

    if (!shouldApplyStructurePath(relativePath)) {
      skippedPaths.push(relativePath);
      return;
    }

    if (selectedPathLowerSet && !selectedPathLowerSet.has(lowerRelativePath)) {
      filteredPaths.push(relativePath);
      return;
    }

    applyEntries.push({
      entry: item.entry,
      relativePath
    });
  });

  if (!applyEntries.length) {
    if (scope === UPDATE_SCOPE_PAGES) {
      throw makeError('No eligible files matched the selected pages.', 400);
    }
    throw makeError('No eligible files to apply. The package only contains protected paths.', 400);
  }

  const shouldDeleteStale = scope === UPDATE_SCOPE_ALL;
  const nextManagedPaths = [...new Set(applyEntries.map((item) => item.relativePath))]
    .sort((a, b) => a.localeCompare(b));
  const nextManagedLowerSet = new Set(nextManagedPaths.map((item) => item.toLowerCase()));
  const previousApplyState = shouldDeleteStale
    ? await loadApplyState()
    : { exists: false, managedPaths: [] };
  const stalePaths = shouldDeleteStale
    ? (
      previousApplyState.exists
        ? previousApplyState.managedPaths.filter((item) => !nextManagedLowerSet.has(String(item || '').toLowerCase()))
        : await computeStalePathsFromPackageScope(nextManagedPaths)
    )
    : [];

  await fsp.mkdir(applyBackupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(applyBackupDir, `apply-${stamp}`);
  const backupFilesDir = path.join(backupDir, 'files');

  let tempRoot = '';
  const backupSet = new Set();
  const writtenPaths = [];
  const deletedPaths = [];

  try {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), APPLY_TEMP_PREFIX));
    const stagedRoot = path.join(tempRoot, 'staged');
    await fsp.mkdir(stagedRoot, { recursive: true });
    await fsp.mkdir(backupFilesDir, { recursive: true });

    for (const item of applyEntries) {
      const stagedPath = resolvePathWithin(stagedRoot, item.relativePath);
      await fsp.mkdir(path.dirname(stagedPath), { recursive: true });
      await fsp.writeFile(stagedPath, extractEntryBuffer(zipBuffer, item.entry));
    }

    const backupTargets = [...new Set([...nextManagedPaths, ...stalePaths])];
    for (const relativePath of backupTargets) {
      const targetPath = resolvePathWithin(rootDir, relativePath);
      if (!await pathExists(targetPath)) continue;
      const backupPath = resolvePathWithin(backupFilesDir, relativePath);
      await fsp.mkdir(path.dirname(backupPath), { recursive: true });
      await fsp.copyFile(targetPath, backupPath);
      backupSet.add(relativePath.toLowerCase());
    }

    for (const item of applyEntries) {
      const stagedPath = resolvePathWithin(stagedRoot, item.relativePath);
      const targetPath = resolvePathWithin(rootDir, item.relativePath);
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(stagedPath, targetPath);
      writtenPaths.push(item.relativePath);
    }

    for (const relativePath of stalePaths) {
      const targetPath = resolvePathWithin(rootDir, relativePath);
      if (!await pathExists(targetPath)) continue;
      await fsp.rm(targetPath, { force: true });
      deletedPaths.push(relativePath);
    }

    if (shouldDeleteStale) {
      await saveApplyState(nextManagedPaths);
    }

    const applyMeta = {
      appliedAt: new Date().toISOString(),
      scope,
      selectedPages: requestedPageKeys,
      appliedCount: writtenPaths.length,
      deletedCount: deletedPaths.length,
      staleCount: stalePaths.length,
      skippedCount: skippedPaths.length,
      filteredCount: filteredPaths.length,
      skippedPaths,
      filteredPaths,
      stalePaths,
      hasPreviousApplyState: previousApplyState.exists
    };
    await fsp.writeFile(
      path.join(backupDir, 'apply-meta.json'),
      `${JSON.stringify(applyMeta, null, 2)}\n`,
      'utf8'
    );

    return {
      scope,
      selectedPages: requestedPageKeys,
      appliedCount: writtenPaths.length,
      deletedCount: deletedPaths.length,
      staleCount: stalePaths.length,
      skippedCount: skippedPaths.length,
      filteredCount: filteredPaths.length,
      backupDir,
      restartRequired: true
    };
  } catch (error) {
    const rollbackErrors = [];
    const rollbackPaths = [...new Set([...writtenPaths, ...deletedPaths])];
    for (let idx = rollbackPaths.length - 1; idx >= 0; idx -= 1) {
      const relativePath = rollbackPaths[idx];
      const targetPath = resolvePathWithin(rootDir, relativePath);
      try {
        if (backupSet.has(relativePath.toLowerCase())) {
          const backupPath = resolvePathWithin(backupFilesDir, relativePath);
          await fsp.mkdir(path.dirname(targetPath), { recursive: true });
          await fsp.copyFile(backupPath, targetPath);
        } else {
          await fsp.rm(targetPath, { force: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${relativePath}: ${rollbackError.message || rollbackError}`);
      }
    }

    if (rollbackErrors.length) {
      throw makeError(
        `${error.message || 'Failed to apply structure package.'} Rollback failed: ${rollbackErrors.join(' | ')}`,
        500
      );
    }
    throw makeError(error.message || 'Failed to apply structure package.', error.statusCode || 500);
  } finally {
    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
};

const appendStructureArchiveEntries = async (archive) => {
  await appendArchiveTree(archive, rootDir, '', {
    includeData: false,
    includeNodeModules: false,
    structurePackage: true
  });
  archive.append(
    `${JSON.stringify(buildStructureManifest({ source: 'structure-download' }), null, 2)}\n`,
    { name: STRUCTURE_MANIFEST_FILE }
  );
};

const structureArchiveOptions = Object.freeze({
  includeData: false,
  includeNodeModules: false,
  structurePackage: true
});

const buildCurrentStructurePageTargets = async () => {
  const files = await collectArchiveTreeFiles(rootDir, '', structureArchiveOptions);
  return buildPackagePageTargets(files.map((normalizedName) => ({ normalizedName })));
};

const appendSelectedStructureArchiveEntries = async (archive, selectedPages = []) => {
  const pageTargets = await buildCurrentStructurePageTargets();
  const pageTargetMap = new Map(pageTargets.map((item) => [item.key, item]));
  const requestedPageKeys = normalizePageKeyList(selectedPages);
  if (!requestedPageKeys.length) {
    throw makeError('Select at least one page to download.', 400);
  }

  const missingPageKeys = requestedPageKeys.filter((key) => !pageTargetMap.has(key));
  if (missingPageKeys.length) {
    throw makeError(`Selected pages are not available: ${missingPageKeys.join(', ')}`, 400);
  }

  const selectedPaths = new Set(REQUIRED_FILES);
  requestedPageKeys.forEach((key) => {
    const target = pageTargetMap.get(key);
    (target?.paths || []).forEach((relativePath) => selectedPaths.add(relativePath));
  });

  [...selectedPaths]
    .sort((a, b) => a.localeCompare(b))
    .forEach((relativePath) => {
      const safePath = assertSafeRelativePath(relativePath);
      const absolutePath = resolvePathWithin(rootDir, safePath);
      archive.file(absolutePath, { name: safePath });
    });

  archive.append(
    `${JSON.stringify(buildStructureManifest({
      source: 'structure-page-download',
      scope: UPDATE_SCOPE_PAGES,
      selectedPages: requestedPageKeys
    }), null, 2)}\n`,
    { name: STRUCTURE_MANIFEST_FILE }
  );

  return {
    selectedPages: requestedPageKeys,
    includedCount: selectedPaths.size
  };
};

router.get('/status', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    let packageInfo = null;
    try {
      packageInfo = await getLatestPackageInfo();
    } catch {
      packageInfo = null;
    }

    return res.json({
      ok: true,
      mode: 'update-and-download',
      package: packageInfo,
      downloadablePages: (await buildCurrentStructurePageTargets()).map((page) => ({
        key: page.key,
        label: page.label,
        htmlPath: page.htmlPath,
        pathCount: page.pathCount
      })),
      uploadRules: {
        requiredFiles: REQUIRED_FILES,
        optionalFiles: OPTIONAL_STRUCTURE_FILES,
        manifest: {
          type: 'billing-structure',
          schemaVersion: SUPPORTED_SCHEMA_VERSION
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/app-downloads', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const config = await readAppDownloadsConfig();
    return res.json({
      ok: true,
      enabled: config.enabled,
      configuredSlots: config.configuredSlots,
      slots: config.slots
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load app downloads.' });
  }
});

router.put('/app-downloads', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const current = await readAppDownloadsConfig();
    if (!current.enabled) {
      return res.status(400).json({ ok: false, error: 'Configure MySQL first.' });
    }

    const payloadSlots = Array.isArray(req.body?.slots) ? req.body.slots : [];
    const bySlot = new Map();
    payloadSlots.forEach((entry) => {
      const slot = normalizeSlotNumber(entry?.slot);
      if (!slot) return;
      bySlot.set(slot, String(entry?.name || '').trim() || DEFAULT_APP_NAME);
    });

    const next = {
      slots: current.slots.map((slot) => ({
        ...slot,
        name: bySlot.get(slot.slot) || slot.name || DEFAULT_APP_NAME
      }))
    };
    const saved = await writeAppDownloadsConfig(next);
    return res.json({
      ok: true,
      message: 'Download apps saved.',
      enabled: saved.enabled,
      configuredSlots: saved.configuredSlots,
      slots: saved.slots
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Failed to save app downloads.' });
  }
});

router.post('/app-downloads/:slot/icon', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const slotNumber = normalizeSlotNumber(req.params.slot);
    if (!slotNumber) {
      return res.status(404).json({ ok: false, error: 'Unknown app slot.' });
    }

    const current = await readAppDownloadsConfig();
    if (!current.enabled) {
      return res.status(400).json({ ok: false, error: 'Configure MySQL first.' });
    }

    const binary = await readBinaryBody(req, APP_ICON_MAX_BYTES);
    if (!binary.length) {
      return res.status(400).json({ ok: false, error: 'Uploaded icon file is empty.' });
    }

    const uploadedFileName = parseUploadedFileName(req.headers['x-file-name'], `app-${slotNumber}-icon`);
    const contentType = String(req.headers['content-type'] || '').trim().toLowerCase();
    const extension = resolveImageUploadExtension(uploadedFileName, contentType);
    const currentSlot = getAppSlotByNumber(current, slotNumber) || { slot: slotNumber, name: DEFAULT_APP_NAME };
    await writeAppDownloadAsset(slotNumber, 'icon', {
      fileName: sanitizeUploadStem(path.basename(uploadedFileName, path.extname(uploadedFileName)), `app-${slotNumber}-icon`) + extension,
      mimeType: String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
      buffer: binary
    });
    const saved = await writeAppDownloadsConfig(buildAppDownloadsConfigWithSlotPatch(current, slotNumber, {
      iconFileName: sanitizeUploadStem(path.basename(uploadedFileName, path.extname(uploadedFileName)), `app-${slotNumber}-icon`) + extension,
      iconMimeType: String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
      name: currentSlot.name || DEFAULT_APP_NAME
    }));
    return res.json({
      ok: true,
      message: `App ${slotNumber} icon uploaded.`,
      enabled: saved.enabled,
      configuredSlots: saved.configuredSlots,
      slot: getAppSlotByNumber(saved, slotNumber),
      slots: saved.slots
    });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/app-downloads/:slot/file', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const slotNumber = normalizeSlotNumber(req.params.slot);
    if (!slotNumber) {
      return res.status(404).json({ ok: false, error: 'Unknown app slot.' });
    }

    const current = await readAppDownloadsConfig();
    if (!current.enabled) {
      return res.status(400).json({ ok: false, error: 'Configure MySQL first.' });
    }

    const binary = await readBinaryBody(req, MAX_UPLOAD_BYTES);
    if (!binary.length) {
      return res.status(400).json({ ok: false, error: 'Uploaded app file is empty.' });
    }

    const uploadedFileName = parseUploadedFileName(req.headers['x-file-name'], `app-${slotNumber}`);
    const extension = resolveAppUploadExtension(uploadedFileName);
    const currentSlot = getAppSlotByNumber(current, slotNumber) || { slot: slotNumber, name: DEFAULT_APP_NAME };
    const safeOriginalName = `${sanitizeUploadStem(path.basename(uploadedFileName, path.extname(uploadedFileName)), `app-${slotNumber}`)}${extension}`;
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    await writeAppDownloadAsset(slotNumber, 'file', {
      fileName: safeOriginalName,
      mimeType: contentType,
      buffer: binary
    });
    const saved = await writeAppDownloadsConfig(buildAppDownloadsConfigWithSlotPatch(current, slotNumber, {
      appFileName: safeOriginalName,
      appMimeType: contentType,
      appSizeBytes: binary.length,
      name: currentSlot.name || DEFAULT_APP_NAME
    }));
    return res.json({
      ok: true,
      message: `App ${slotNumber} package uploaded.`,
      enabled: saved.enabled,
      configuredSlots: saved.configuredSlots,
      slot: getAppSlotByNumber(saved, slotNumber),
      slots: saved.slots
    });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.get('/mysql-config', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const source = getMysqlConfigSource();
    const runtimeConfig = getMysqlRuntimeConfig();
    const effectiveConfig = getEffectiveMysqlConfig();

    return res.json({
      ok: true,
      enabled: isMysqlEnabled(),
      source,
      runtimeConfigured: Boolean(runtimeConfig),
      runtimeConfig: maskMysqlConfig(runtimeConfig),
      config: maskMysqlConfig(effectiveConfig)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/mysql-config/test', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const currentConfig = getMysqlRuntimeConfig() || getEffectiveMysqlConfig();
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const hasPayload = Object.keys(payload).length > 0;
    const configToTest = hasPayload
      ? buildMysqlConfigForSave(payload, currentConfig)
      : currentConfig;

    await testMysqlConnection(configToTest);

    return res.json({
      ok: true,
      message: 'MySQL connection test passed.'
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'MySQL connection test failed.' });
  }
});

router.put('/mysql-config', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const currentConfig = getMysqlRuntimeConfig();
    const nextConfig = buildMysqlConfigForSave(payload, currentConfig);
    const verify = payload.verify !== false;

    const saved = await setMysqlRuntimeConfig(nextConfig, {
      verify,
      persist: true
    });

    return res.json({
      ok: true,
      message: verify
        ? 'MySQL config saved and verified.'
        : 'MySQL config saved.',
      enabled: isMysqlEnabled(),
      source: getMysqlConfigSource(),
      config: maskMysqlConfig(saved)
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Failed to save MySQL config.' });
  }
});

router.delete('/mysql-config', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    await clearMysqlRuntimeConfig({ persist: true });
    const effective = getEffectiveMysqlConfig();

    return res.json({
      ok: true,
      message: 'Stored MySQL config removed. Environment config is now active.',
      enabled: isMysqlEnabled(),
      source: getMysqlConfigSource(),
      config: maskMysqlConfig(effective)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/account-number-settings', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const enabled = isMysqlEnabled();
    const settings = await readAccountNumberSettings();
    return res.json({
      ok: true,
      enabled,
      configured: Boolean(settings.prefixId),
      prefixId: settings.prefixId
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load account number settings.' });
  }
});

router.put('/account-number-settings', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    if (!isMysqlEnabled()) {
      return res.status(400).json({ ok: false, error: 'MySQL is not configured.' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = normalizeAccountNumberSettings(payload);
    if (settings.prefixId && !isValidGeneratedPrefixId(settings.prefixId)) {
      return res.status(400).json({
        ok: false,
        error: 'Prefix ID must be 3 digits and start with 1-9.'
      });
    }
    await writeJson(ACCOUNT_NUMBER_SETTINGS_KEY, settings);

    return res.json({
      ok: true,
      message: settings.prefixId
        ? 'Account prefix ID saved.'
        : 'Account prefix ID cleared.',
      enabled: true,
      configured: Boolean(settings.prefixId),
      prefixId: settings.prefixId
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Failed to save account number settings.' });
  }
});

router.get('/master-key', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const source = getMasterKeySource();
    return res.json({
      ok: true,
      configured: source !== 'none',
      source
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load master key status.' });
  }
});

router.put('/master-key', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const value = String(payload.masterKey || payload.value || payload.key || '').trim();
    if (!value) {
      return res.status(400).json({ ok: false, error: 'Master key is required.' });
    }
    const persist = payload.persist !== false;
    setMasterKey(value, { persist });

    return res.json({
      ok: true,
      message: persist ? 'Master key saved.' : 'Master key set for this session.',
      configured: true,
      source: getMasterKeySource()
    });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Failed to save master key.' });
  }
});

router.delete('/master-key', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    clearMasterKey({ persist: true });
    return res.json({
      ok: true,
      message: 'Master key cleared.',
      configured: false,
      source: getMasterKeySource()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to clear master key.' });
  }
});

router.get('/cloudflared', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const [binaryState, configState] = await Promise.all([
      detectCloudflaredBinary(),
      readCloudflaredConfigFile()
    ]);
    const config = configState.config || cloneDefaultCloudflaredConfig();

    return res.json({
      ok: true,
      installed: Boolean(binaryState.installed),
      version: String(binaryState.version || ''),
      installError: String(binaryState.error || ''),
      configExists: Boolean(configState.configExists),
      configPath: CLOUDFLARED_CONFIG_FILE,
      config,
      commands: buildCloudflaredCommands(config)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to load cloudflared status.' });
  }
});

router.put('/cloudflared', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const config = normalizeCloudflaredConfigInput(payload);

    await fsp.mkdir(CLOUDFLARED_DIR, { recursive: true });
    const renderedConfig = renderCloudflaredConfig(config);
    await fsp.writeFile(CLOUDFLARED_CONFIG_FILE, renderedConfig, 'utf8');

    const binaryState = await detectCloudflaredBinary();
    return res.json({
      ok: true,
      message: 'Cloudflared config saved.',
      installed: Boolean(binaryState.installed),
      version: String(binaryState.version || ''),
      installError: String(binaryState.error || ''),
      configExists: true,
      configPath: CLOUDFLARED_CONFIG_FILE,
      config,
      commands: buildCloudflaredCommands(config)
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ ok: false, error: error.message || 'Failed to save cloudflared config.' });
  }
});

router.get('/project-zip', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const includeData = toBool(req.query.includeData);
    const includeNodeModules = hasOwn(req.query, 'includeNodeModules')
      ? toBool(req.query.includeNodeModules)
      : toBool(req.query.includeNodes);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const modeLabel = includeData || includeNodeModules ? 'full' : 'clean';
    const filename = `${PROJECT_ARCHIVE_PREFIX}-${modeLabel}-${stamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => {
      console.warn('Archive warning:', err.message || err);
    });
    archive.on('error', (err) => {
      console.error('Archive error:', err.message || err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Failed to create archive.' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    const ignore = [...PROJECT_ARCHIVE_IGNORE_BASE, STRUCTURE_MANIFEST_FILE];
    if (!includeNodeModules) {
      ignore.push('**/node_modules/**');
    }
    if (!includeData) {
      ignore.push(...PROJECT_ARCHIVE_CLEAN_IGNORE);
    } else {
      ignore.push('data/pdf-cache/**');
    }

    archive.glob('**/*', {
      cwd: rootDir,
      dot: true,
      ignore
    });
    archive.append(
      `${JSON.stringify(buildStructureManifest({ source: 'project-zip' }), null, 2)}\n`,
      { name: STRUCTURE_MANIFEST_FILE }
    );

    await archive.finalize();
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ ok: false, error: error.message || 'Failed to download project.' });
  }
});

router.post('/mysql-schema', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    if (!isMysqlEnabled()) {
      return res.status(400).json({ ok: false, error: 'MySQL is not configured.' });
    }
    if (getMasterKeySource() === 'none') {
      return res.status(400).json({ ok: false, error: 'CONFIG_MASTER_KEY is not configured.' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const reset = payload.reset === true;
    let branchName = String(payload.branchName || '').trim();
    if (branchName.length > 80) {
      branchName = branchName.slice(0, 80);
    }

    const result = await runSchemaUpdate({ reset, branchName });
    clearRelationalCache();

    return res.json({
      ok: true,
      message: 'Schema update complete.',
      durationMs: result.durationMs,
      output: String(result.stdout || '').trim(),
      errorOutput: String(result.stderr || '').trim()
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      ok: false,
      error: error.message || 'Schema update failed.'
    });
  }
});

router.post('/mysql-migrate', async (req, res) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    if (!isMysqlEnabled()) {
      return res.status(400).json({ ok: false, error: 'MySQL is not configured.' });
    }
    if (getMasterKeySource() === 'none') {
      return res.status(400).json({ ok: false, error: 'CONFIG_MASTER_KEY is not configured.' });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const reset = payload.reset === true;
    let branchName = String(payload.branchName || '').trim();
    if (branchName.length > 80) {
      branchName = branchName.slice(0, 80);
    }

    const result = await runJsonMigration({ reset, branchName });
    clearRelationalCache();

    return res.json({
      ok: true,
      message: 'JSON migration complete.',
      durationMs: result.durationMs,
      output: String(result.stdout || '').trim(),
      errorOutput: String(result.stderr || '').trim()
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      ok: false,
      error: error.message || 'JSON migration failed.'
    });
  }
});

router.post('/update/preview', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const supportedContentType = ZIP_CONTENT_TYPES.some((value) => contentType.includes(value));
    if (!supportedContentType) {
      return res.status(415).json({
        ok: false,
        error: 'Unsupported content type. Upload a .zip file using application/zip or application/octet-stream.'
      });
    }

    const binary = await readBinaryBody(req);
    if (!binary.length) {
      return res.status(400).json({ ok: false, error: 'Uploaded file is empty' });
    }
    if (!hasZipSignature(binary)) {
      return res.status(400).json({ ok: false, error: 'Invalid ZIP file' });
    }

    const validation = validateZipStructure(binary);
    const pages = buildPackagePageTargets(validation.normalizedEntries).map((page) => ({
      key: page.key,
      label: page.label,
      htmlPath: page.htmlPath,
      pathCount: page.pathCount
    }));

    return res.json({
      ok: true,
      message: 'Package analyzed.',
      pages,
      validation: {
        manifestType: validation.manifest.type,
        schemaVersion: validation.manifest.schemaVersion,
        entryCount: validation.entryCount,
        manifestProvided: validation.manifestProvided
      }
    });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/update', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const supportedContentType = ZIP_CONTENT_TYPES.some((value) => contentType.includes(value));
    if (!supportedContentType) {
      return res.status(415).json({
        ok: false,
        error: 'Unsupported content type. Upload a .zip file using application/zip or application/octet-stream.'
      });
    }

    const binary = await readBinaryBody(req);
    if (!binary.length) {
      return res.status(400).json({ ok: false, error: 'Uploaded file is empty' });
    }

    if (!hasZipSignature(binary)) {
      return res.status(400).json({ ok: false, error: 'Invalid ZIP file' });
    }

    const applyNow = hasOwn(req.query, 'apply') ? toBool(req.query.apply) : true;
    const scope = normalizeUpdateScope(req.query.scope);
    const selectedPages = parseSelectedPagesFromRequest(req.headers['x-structure-pages']);
    if (applyNow && scope === UPDATE_SCOPE_PAGES && !selectedPages.length) {
      return res.status(400).json({ ok: false, error: 'Select at least one page to update.' });
    }

    const validation = validateZipStructure(binary);
    const originalName = String(req.headers['x-package-name'] || '').trim() || 'uploaded-structure.zip';
    const packageInfo = await saveUploadedPackage(binary, originalName);
    const validationSummary = {
      manifestType: validation.manifest.type,
      schemaVersion: validation.manifest.schemaVersion,
      entryCount: validation.entryCount,
      manifestProvided: validation.manifestProvided
    };

    let applyResult = null;
    if (applyNow) {
      try {
        applyResult = await applyStructurePackage(binary, validation, { scope, selectedPages });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          ok: false,
          error: error.message || 'Structure package uploaded but apply failed.',
          package: packageInfo,
          validation: validationSummary
        });
      }
    }

    const cleanup = await cleanupStructureReleaseArtifacts({
      keepApplyBackupDir: applyResult?.backupDir || null
    });
    if (cleanup.errors.length) {
      console.warn('Structure upload cleanup warnings:', cleanup.errors.join(' | '));
    }

    return res.status(201).json({
      ok: true,
      message: applyNow
        ? 'Structure package uploaded and applied. Restart server to load backend changes.'
        : 'Structure package uploaded and saved. Apply step was skipped.',
      package: packageInfo,
      cleanup,
      validation: validationSummary,
      apply: {
        requested: applyNow,
        applied: Boolean(applyResult),
        scope,
        selectedPages,
        ...(applyResult || {})
      }
    });
  } catch (error) {
    if (error && error.statusCode) {
      return res.status(error.statusCode).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.get('/download', async (req, res, next) => {
  try {
    const auth = await resolveAuthorizedUser(req);
    if (!auth.ok) {
      return res.status(auth.statusCode).json({ ok: false, error: auth.error });
    }

    const scope = normalizeUpdateScope(req.query.scope);
    const selectedPages = parseSelectedPagesFromRequest(req.query.pages);
    const isPageDownload = scope === UPDATE_SCOPE_PAGES;
    if (isPageDownload && !selectedPages.length) {
      return res.status(400).json({ ok: false, error: 'Select at least one page to download.' });
    }

    const pageLabel = isPageDownload
      ? `pages-${selectedPages.slice(0, 3).join('-')}${selectedPages.length > 3 ? `-${selectedPages.length}` : ''}`
      : '';
    const filename = isPageDownload
      ? `${STRUCTURE_ARCHIVE_PREFIX}-${pageLabel}-${buildArchiveStamp()}.zip`
      : `${STRUCTURE_ARCHIVE_PREFIX}-${buildArchiveStamp()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', (err) => {
      console.warn('Structure download warning:', err.message || err);
    });
    archive.on('error', (err) => {
      console.error('Structure download error:', err.message || err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Failed to create structure package.' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);
    if (isPageDownload) {
      await appendSelectedStructureArchiveEntries(archive, selectedPages);
    } else {
      await appendStructureArchiveEntries(archive);
    }
    await archive.finalize();
    return undefined;
  } catch (error) {
    return next(error);
  }
});

module.exports = {
  router
};
