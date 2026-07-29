const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, FLAVORS_DIR, ENV_FILE, DATA_DIR } = require('../core/runtime/paths');
const { DEFAULT_FEATURES, FEATURE_LABELS, normalizeFeatures } = require('../core/config/flavor-features');

const projectRoot = PROJECT_ROOT;
const flavorPath = path.join(projectRoot, 'flavor.config.json');
const examplePath = path.join(projectRoot, 'flavor.config.example.json');
const flavorsDir = FLAVORS_DIR;
const envPath = ENV_FILE;
const dataDir = DATA_DIR;
const mysqlConfigPath = path.join(dataDir, 'mysql-config.json');
const mysqlConfigBackupPath = path.join(dataDir, 'mysql-config.backup.json');
const masterKeyPath = path.join(dataDir, 'master-key.json');
const masterKeyBackupPath = path.join(dataDir, 'master-key.backup.json');
const flavorFeaturesPath = path.join(dataDir, 'flavor-features.json');
const cloudflaredConfigPath = path.join(projectRoot, '.cloudflared', 'config.yml');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const shouldInit = args.has('--init');
const shouldList = args.has('--list');
const shouldNew = args.has('--new');
const shouldUse = args.has('--use');
const shouldImportEnv = args.has('--import-env');
const skipRuntime = args.has('--env-only');

function getArgValue(flag) {
  const index = rawArgs.indexOf(flag);
  if (index >= 0 && rawArgs[index + 1] && !rawArgs[index + 1].startsWith('--')) {
    return rawArgs[index + 1];
  }
  return rawArgs.find((arg) => !arg.startsWith('--')) || '';
}

function normalizeFlavorName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) {
    throw new Error('Flavor name is required. Example: npm run flavor:new -- acme-fiber');
  }
  if (normalized === '.' || normalized === '..' || normalized.includes('..')) {
    throw new Error('Flavor name is invalid.');
  }
  return normalized;
}

function getNamedFlavorPath(name) {
  return path.join(flavorsDir, `${normalizeFlavorName(name)}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readCurrentOrExampleFlavor() {
  if (fs.existsSync(flavorPath)) return readJson(flavorPath);
  if (fs.existsSync(envPath)) return buildFlavorFromEnvFile(envPath);
  return readJson(examplePath);
}

function secretHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function get(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function envLine(key, value) {
  const stringValue = String(value ?? '');
  const escaped = stringValue
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

function buildFlavorFromEnvFile(filePath = envPath) {
  const env = readEnvFile(filePath);
  const sourceFolder = path.dirname(filePath);
  const upstreamHost = get(env.CUSTOMER_UPSTREAM_HOST, '127.0.0.1');
  const upstreamPort = Number(get(env.CUSTOMER_UPSTREAM_PORT, 4002));
  const storageDriver = get(env.STORAGE_DRIVER, 'mysql').toLowerCase() === 'json' ? 'json' : 'mysql';
  return {
    app: {
      nodeEnv: get(env.NODE_ENV, 'development'),
      timezone: get(env.TZ, 'Asia/Manila'),
      port: Number(get(env.PORT, 3000)),
      sessionCookieName: get(env.SESSION_COOKIE_NAME, 'billingSession'),
      publicBaseUrl: get(env.PUBLIC_BASE_URL, 'http://localhost:3000'),
      centralUrl: get(env.CENTRAL_URL, get(env.PUBLIC_BASE_URL, 'http://localhost:3000')),
      appBaseUrl: get(env.APP_BASE_URL, get(env.PUBLIC_BASE_URL, 'http://localhost:3000'))
    },
    customerUpstream: {
      enableStub: String(get(env.ENABLE_CUSTOMER_UPSTREAM_STUB, 'true')).toLowerCase() !== 'false',
      host: upstreamHost,
      port: upstreamPort,
      url: get(env.CUSTOMER_UPSTREAM_URL, `http://${upstreamHost}:${upstreamPort}`)
    },
    storage: {
      driver: storageDriver
    },
    mysql: {
      host: get(env.MYSQL_HOST, '127.0.0.1'),
      port: Number(get(env.MYSQL_PORT, 3306)),
      user: get(env.MYSQL_USER, 'root'),
      password: get(env.MYSQL_PASSWORD, ''),
      database: get(env.MYSQL_DATABASE, 'billing_system'),
      connLimit: Number(get(env.MYSQL_CONN_LIMIT, 10))
    },
    secrets: {
      configMasterKey: get(env.CONFIG_MASTER_KEY, secretHex(32)),
      sessionTokenSecret: get(env.SESSION_TOKEN_SECRET, secretHex(32)),
      infoApiUser: get(env.INFO_API_USER, 'collector-sync'),
      infoApiPass: get(env.INFO_API_PASS, secretHex(16))
    },
    initialAdmin: {
      username: get(env.INITIAL_ADMIN_USERNAME, 'archiecd'),
      password: get(env.INITIAL_ADMIN_PASSWORD, 'finley123!'),
      branchName: get(env.INITIAL_BRANCH_NAME, 'MAIN'),
      structureOwnerId: get(env.STRUCTURE_OWNER_ID, '1')
    },
    features: normalizeFeatures(DEFAULT_FEATURES),
    cloudflared: readCloudflaredConfigFromFolder(sourceFolder)
  };
}

function readCloudflaredConfigFromFolder(folderPath) {
  const configPath = path.join(folderPath, '.cloudflared', 'config.yml');
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const hostnameMatch = raw.match(/^\s*-\s*hostname:\s*['"]?([^'"\s#]+)['"]?\s*$/m) ||
      raw.match(/^\s*hostname:\s*['"]?([^'"\s#]+)['"]?\s*$/m);
    const tunnelMatch = raw.match(/^\s*tunnel:\s*['"]?([^'"\s#]+)['"]?\s*$/m);
    const credentialsMatch = raw.match(/^\s*credentials-file:\s*['"]?([^'"\r\n]+)['"]?\s*$/m);
    const serviceMatch = raw.match(/^\s*service:\s*['"]?(http:\/\/[^'"\r\n]+)['"]?\s*$/m);
    return {
      tunnel: String(tunnelMatch?.[1] || '').trim(),
      credentialsFile: String(credentialsMatch?.[1] || '').trim(),
      hostname: String(hostnameMatch?.[1] || '').trim(),
      service: String(serviceMatch?.[1] || '').trim()
    };
  } catch {
    return {};
  }
}

function normalizeFlavor(input) {
  const app = input.app || {};
  const customerUpstream = input.customerUpstream || {};
  const storage = input.storage || {};
  const mysql = input.mysql || {};
  const secrets = input.secrets || {};
  const initialAdmin = input.initialAdmin || {};
  const cloudflared = input.cloudflared || {};
  const businessProfile = input.businessProfile || {};
  const firebase = input.firebase || {};
  const features = normalizeFeatures(input.features || DEFAULT_FEATURES);
  const publicBaseUrl = get(app.publicBaseUrl, 'http://localhost:3000');
  const masterKey = String(get(secrets.configMasterKey, '')).trim();
  const sessionSecret = String(get(secrets.sessionTokenSecret, '')).trim();
  const storageDriver = String(get(storage.driver, storage.mode || 'mysql')).trim().toLowerCase() === 'json'
    ? 'json'
    : 'mysql';

  if (!masterKey) {
    throw new Error('secrets.configMasterKey is required in flavor.config.json.');
  }
  if (!sessionSecret) {
    throw new Error('secrets.sessionTokenSecret is required in flavor.config.json.');
  }
  if (storageDriver === 'mysql' && !String(get(mysql.host, '')).trim()) {
    throw new Error('mysql.host is required in flavor.config.json.');
  }
  if (storageDriver === 'mysql' && !String(get(mysql.user, '')).trim()) {
    throw new Error('mysql.user is required in flavor.config.json.');
  }
  if (storageDriver === 'mysql' && !String(get(mysql.database, '')).trim()) {
    throw new Error('mysql.database is required in flavor.config.json.');
  }

  return {
    app: {
      nodeEnv: get(app.nodeEnv, 'development'),
      timezone: get(app.timezone, 'Asia/Manila'),
      port: Number(get(app.port, 3000)),
      sessionCookieName: get(app.sessionCookieName, 'billingSession'),
      publicBaseUrl,
      centralUrl: get(app.centralUrl, publicBaseUrl),
      appBaseUrl: get(app.appBaseUrl, publicBaseUrl)
    },
    customerUpstream: {
      enableStub: customerUpstream.enableStub !== false,
      host: get(customerUpstream.host, '127.0.0.1'),
      port: Number(get(customerUpstream.port, 4002)),
      url: get(customerUpstream.url, 'http://127.0.0.1:4002')
    },
    storage: {
      driver: storageDriver
    },
    mysql: {
      host: get(mysql.host, storageDriver === 'json' ? '' : '127.0.0.1'),
      port: Number(get(mysql.port, 3306)),
      user: get(mysql.user, storageDriver === 'json' ? '' : 'root'),
      password: get(mysql.password, ''),
      database: get(mysql.database, storageDriver === 'json' ? '' : 'billing_system'),
      connLimit: Number(get(mysql.connLimit, 10))
    },
    secrets: {
      configMasterKey: masterKey,
      sessionTokenSecret: sessionSecret,
      infoApiUser: get(secrets.infoApiUser, 'collector-sync'),
      infoApiPass: get(secrets.infoApiPass, '')
    },
    firebase: {
      serviceAccountPath: get(firebase.serviceAccountPath, ''),
      androidChannelId: get(firebase.androidChannelId, '')
    },
    initialAdmin: {
      username: get(initialAdmin.username, 'archiecd'),
      password: get(initialAdmin.password, 'finley123!'),
      branchName: get(initialAdmin.branchName, 'MAIN'),
      structureOwnerId: get(initialAdmin.structureOwnerId, '1')
    },
    features
    ,
    cloudflared: {
      tunnel: get(cloudflared.tunnel, ''),
      credentialsFile: get(cloudflared.credentialsFile, ''),
      hostname: get(cloudflared.hostname, ''),
      service: get(cloudflared.service, `http://localhost:${Number(get(app.port, 3000))}`)
    },
    businessProfile: {
      businessName: get(businessProfile.businessName, get(initialAdmin.branchName, '')),
      supportEmail: get(businessProfile.supportEmail, ''),
      contact: get(businessProfile.contact, ''),
      address: get(businessProfile.address, '')
    }
  };
}

function writeEnv(flavor) {
  const lines = [
    '# Generated by npm run flavor:apply. Edit flavor.config.json, not this file.',
    '',
    envLine('NODE_ENV', flavor.app.nodeEnv),
    envLine('TZ', flavor.app.timezone),
    envLine('PORT', flavor.app.port),
    envLine('SESSION_COOKIE_NAME', flavor.app.sessionCookieName),
    envLine('PUBLIC_BASE_URL', flavor.app.publicBaseUrl),
    envLine('CENTRAL_URL', flavor.app.centralUrl),
    envLine('APP_BASE_URL', flavor.app.appBaseUrl),
    envLine('ENABLE_CUSTOMER_UPSTREAM_STUB', flavor.customerUpstream.enableStub ? 'true' : 'false'),
    envLine('CUSTOMER_UPSTREAM_HOST', flavor.customerUpstream.host),
    envLine('CUSTOMER_UPSTREAM_PORT', flavor.customerUpstream.port),
    envLine('CUSTOMER_UPSTREAM_URL', flavor.customerUpstream.url),
    envLine('STORAGE_DRIVER', flavor.storage?.driver || 'mysql'),
    envLine('MYSQL_HOST', flavor.mysql.host),
    envLine('MYSQL_PORT', flavor.mysql.port),
    envLine('MYSQL_USER', flavor.mysql.user),
    envLine('MYSQL_PASSWORD', flavor.mysql.password),
    envLine('MYSQL_DATABASE', flavor.mysql.database),
    envLine('MYSQL_CONN_LIMIT', flavor.mysql.connLimit),
    envLine('CONFIG_MASTER_KEY', flavor.secrets.configMasterKey),
    envLine('SESSION_TOKEN_SECRET', flavor.secrets.sessionTokenSecret),
    envLine('INFO_API_USER', flavor.secrets.infoApiUser),
    envLine('INFO_API_PASS', flavor.secrets.infoApiPass),
    envLine('FIREBASE_SERVICE_ACCOUNT_PATH', flavor.firebase?.serviceAccountPath || ''),
    envLine('FIREBASE_ANDROID_CHANNEL_ID', flavor.firebase?.androidChannelId || ''),
    envLine('INITIAL_ADMIN_USERNAME', flavor.initialAdmin.username),
    envLine('INITIAL_ADMIN_PASSWORD', flavor.initialAdmin.password),
    envLine('INITIAL_BRANCH_NAME', flavor.initialAdmin.branchName),
    envLine('STRUCTURE_OWNER_ID', flavor.initialAdmin.structureOwnerId),
    envLine('BUSINESS_NAME', flavor.businessProfile?.businessName || flavor.initialAdmin.branchName),
    envLine('BUSINESS_SUPPORT_EMAIL', flavor.businessProfile?.supportEmail || ''),
    envLine('BUSINESS_CONTACT', flavor.businessProfile?.contact || ''),
    envLine('BUSINESS_ADDRESS', flavor.businessProfile?.address || ''),
    envLine('FLAVOR_FEATURES', JSON.stringify(flavor.features)),
    ''
  ];
  fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
}

function writeRuntimeFiles(flavor) {
  if (flavor.storage?.driver === 'mysql') {
    const mysqlConfig = {
      mysqlUrl: '',
      host: flavor.mysql.host,
      port: flavor.mysql.port,
      user: flavor.mysql.user,
      password: flavor.mysql.password,
      database: flavor.mysql.database,
      connLimit: flavor.mysql.connLimit
    };
    writeJson(mysqlConfigPath, mysqlConfig);
    writeJson(mysqlConfigBackupPath, mysqlConfig);
  }
  writeJson(masterKeyPath, { value: flavor.secrets.configMasterKey });
  writeJson(masterKeyBackupPath, { value: flavor.secrets.configMasterKey });
  writeJson(flavorFeaturesPath, {
    features: flavor.features,
    checklist: Object.keys(DEFAULT_FEATURES).map((key) => ({
      key,
      label: FEATURE_LABELS[key] || key,
      enabled: Boolean(flavor.features[key])
    }))
  });
  writeCloudflaredConfig(flavor);
}

function quoteYaml(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function writeCloudflaredConfig(flavor) {
  const config = flavor.cloudflared || {};
  const hostname = String(config.hostname || '').trim();
  const tunnel = String(config.tunnel || '').trim();
  const credentialsFile = String(config.credentialsFile || '').trim();
  if (!hostname || !tunnel || !credentialsFile) return;
  const service = String(config.service || `http://localhost:${flavor.app.port}`).trim();
  const lines = [
    `# Generated by npm run flavor:apply for ${flavor.initialAdmin.branchName}.`,
    `tunnel: ${quoteYaml(tunnel)}`,
    `credentials-file: ${quoteYaml(credentialsFile)}`,
    '',
    'ingress:',
    `  - hostname: ${quoteYaml(hostname)}`,
    `    service: ${quoteYaml(service)}`,
    '  - service: http_status:404',
    ''
  ];
  fs.mkdirSync(path.dirname(cloudflaredConfigPath), { recursive: true });
  fs.writeFileSync(cloudflaredConfigPath, lines.join('\n'), 'utf8');
}

if (shouldInit) {
  if (fs.existsSync(flavorPath)) {
    console.log('flavor.config.json already exists. No changes made.');
    process.exit(0);
  }
  const source = fs.existsSync(envPath) ? buildFlavorFromEnvFile(envPath) : readJson(examplePath);
  writeJson(flavorPath, source);
  console.log('Created flavor.config.json.');
  process.exit(0);
}

if (shouldList) {
  if (!fs.existsSync(flavorsDir)) {
    console.log('No named flavors yet.');
    process.exit(0);
  }
  const names = fs.readdirSync(flavorsDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.basename(name, '.json'))
    .sort();
  console.log(names.length ? names.join('\n') : 'No named flavors yet.');
  process.exit(0);
}

if (shouldNew) {
  const name = normalizeFlavorName(getArgValue('--new'));
  const targetPath = getNamedFlavorPath(name);
  if (fs.existsSync(targetPath)) {
    throw new Error(`Flavor already exists: ${path.relative(projectRoot, targetPath)}`);
  }
  const source = normalizeFlavor(readCurrentOrExampleFlavor());
  writeJson(targetPath, source);
  console.log(`Created ${path.relative(projectRoot, targetPath)}.`);
  console.log(`Edit it, then run: npm run flavor:use -- ${name}`);
  process.exit(0);
}

if (shouldUse) {
  const name = normalizeFlavorName(getArgValue('--use'));
  const sourcePath = getNamedFlavorPath(name);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Named flavor not found: ${path.relative(projectRoot, sourcePath)}`);
  }
  const namedFlavor = normalizeFlavor(readJson(sourcePath));
  writeJson(flavorPath, namedFlavor);
  writeEnv(namedFlavor);
  if (!skipRuntime) {
    writeRuntimeFiles(namedFlavor);
  }
  console.log(`Applied flavor "${name}" to flavor.config.json, .env${skipRuntime ? '' : ', and data runtime config files'}.`);
  process.exit(0);
}

if (shouldImportEnv) {
  const name = normalizeFlavorName(getArgValue('--import-env'));
  const sourceFolder = rawArgs[rawArgs.indexOf('--import-env') + 2];
  if (!sourceFolder || sourceFolder.startsWith('--')) {
    throw new Error('Source folder is required. Example: npm run flavor:import-env -- client-name "C:\\path\\to\\copy"');
  }
  const resolvedFolder = path.resolve(sourceFolder);
  const sourceEnvPath = path.join(resolvedFolder, '.env');
  if (!fs.existsSync(sourceEnvPath)) {
    throw new Error(`Source .env not found: ${sourceEnvPath}`);
  }
  const importedFlavor = normalizeFlavor(buildFlavorFromEnvFile(sourceEnvPath));
  const cloudflaredConfig = readCloudflaredConfigFromFolder(resolvedFolder);
  if (cloudflaredConfig.hostname) {
    const baseUrl = `https://${cloudflaredConfig.hostname}`;
    importedFlavor.app.publicBaseUrl = baseUrl;
    importedFlavor.app.centralUrl = baseUrl;
    importedFlavor.app.appBaseUrl = baseUrl;
    importedFlavor.cloudflared = cloudflaredConfig;
  }
  const targetPath = getNamedFlavorPath(name);
  if (fs.existsSync(targetPath) && !args.has('--force')) {
    throw new Error(`Flavor already exists: ${path.relative(projectRoot, targetPath)}. Add --force to overwrite.`);
  }
  writeJson(targetPath, importedFlavor);
  console.log(`Imported ${path.relative(projectRoot, targetPath)} from ${sourceEnvPath}.`);
  process.exit(0);
}

if (!fs.existsSync(flavorPath)) {
  throw new Error('Missing flavor.config.json. Run npm run flavor:init first.');
}

const flavor = normalizeFlavor(readJson(flavorPath));
writeEnv(flavor);
if (!skipRuntime) {
  writeRuntimeFiles(flavor);
}

console.log(`Applied flavor config to .env${skipRuntime ? '' : ' and data runtime config files'}.`);
