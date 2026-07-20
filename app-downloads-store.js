const { getPool, isMysqlEnabled } = require('./db');
const { readJson, writeJson } = require('./data-store');

const APP_DOWNLOADS_STORE_KEY = 'app_downloads';
const APP_DOWNLOAD_SLOT_COUNT = 3;
const DEFAULT_APP_NAME = 'Official Mobile App';
const APP_DOWNLOADS_PUBLIC_API_PREFIX = '/api/app-downloads';
const APP_DOWNLOAD_ASSETS_TABLE = 'app_download_assets';
let appDownloadAssetsTableReady = null;

const asText = (value) => String(value ?? '').trim();

const normalizeSlotNumber = (value) => {
  const number = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(number)) return 0;
  if (number < 1 || number > APP_DOWNLOAD_SLOT_COUNT) return 0;
  return number;
};

const normalizeAssetKind = (value) => {
  const kind = asText(value).toLowerCase();
  return kind === 'icon' || kind === 'file' ? kind : '';
};

const normalizePublicAssetUrl = (value) => {
  const text = asText(value);
  if (!text) return '';
  return text.startsWith(`${APP_DOWNLOADS_PUBLIC_API_PREFIX}/`) || text.startsWith('/uploads/app-downloads/')
    ? text
    : '';
};

const normalizeAppSize = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
};

const buildAppDownloadAssetUrl = (slot, assetKind, version = '') => {
  const slotNumber = normalizeSlotNumber(slot);
  const kind = normalizeAssetKind(assetKind);
  if (!slotNumber || !kind) return '';
  const versionText = asText(version);
  return `${APP_DOWNLOADS_PUBLIC_API_PREFIX}/${slotNumber}/${kind}${versionText ? `?v=${encodeURIComponent(versionText)}` : ''}`;
};

const buildDefaultSlot = (slot) => ({
  slot,
  name: DEFAULT_APP_NAME,
  iconUrl: '',
  iconFileName: '',
  iconMimeType: '',
  appUrl: '',
  appFileName: '',
  appMimeType: '',
  appSizeBytes: 0,
  updatedAt: ''
});

const decorateSlotUrls = (slot) => ({
  ...slot,
  iconUrl: slot.iconFileName ? buildAppDownloadAssetUrl(slot.slot, 'icon', slot.updatedAt) : '',
  appUrl: slot.appFileName ? buildAppDownloadAssetUrl(slot.slot, 'file', slot.updatedAt) : ''
});

const normalizeStoredSlot = (slot, incoming = {}) => {
  const updatedAt = asText(incoming.updatedAt);
  const normalized = {
    ...buildDefaultSlot(slot),
    name: asText(incoming.name).slice(0, 120) || DEFAULT_APP_NAME,
    iconUrl: normalizePublicAssetUrl(incoming.iconUrl),
    iconFileName: asText(incoming.iconFileName).slice(0, 255),
    iconMimeType: asText(incoming.iconMimeType).slice(0, 120),
    appUrl: normalizePublicAssetUrl(incoming.appUrl),
    appFileName: asText(incoming.appFileName).slice(0, 255),
    appMimeType: asText(incoming.appMimeType).slice(0, 120),
    appSizeBytes: normalizeAppSize(incoming.appSizeBytes),
    updatedAt
  };

  return decorateSlotUrls(normalized);
};

const normalizeAppDownloadsConfig = (incoming = {}, options = {}) => {
  const enabled = options.enabled !== false;
  const bySlot = new Map();
  if (Array.isArray(incoming?.slots)) {
    incoming.slots.forEach((entry) => {
      const slot = normalizeSlotNumber(entry?.slot);
      if (!slot) return;
      bySlot.set(slot, normalizeStoredSlot(slot, entry));
    });
  }

  const slots = [];
  for (let slot = 1; slot <= APP_DOWNLOAD_SLOT_COUNT; slot += 1) {
    slots.push(bySlot.get(slot) || decorateSlotUrls(buildDefaultSlot(slot)));
  }

  const configuredSlots = slots.filter((slot) => Boolean(slot.appFileName)).length;
  return {
    enabled,
    configuredSlots,
    slots
  };
};

const buildDefaultAppDownloadsConfig = (options = {}) =>
  normalizeAppDownloadsConfig({}, options);

async function ensureAppDownloadAssetsTable() {
  if (!isMysqlEnabled()) return;
  if (appDownloadAssetsTableReady) return appDownloadAssetsTableReady;

  appDownloadAssetsTableReady = (async () => {
    const pool = await getPool();
    if (!pool) return;
    const sql = `
      CREATE TABLE IF NOT EXISTS \`${APP_DOWNLOAD_ASSETS_TABLE}\` (
        slot TINYINT NOT NULL,
        asset_kind VARCHAR(10) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        file_size BIGINT NOT NULL,
        file_blob LONGBLOB NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (slot, asset_kind)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `;
    await pool.query(sql);
  })();

  return appDownloadAssetsTableReady;
}

async function readAppDownloadsConfig() {
  const enabled = isMysqlEnabled();
  if (!enabled) {
    return buildDefaultAppDownloadsConfig({ enabled: false });
  }
  const stored = await readJson(APP_DOWNLOADS_STORE_KEY, {});
  return normalizeAppDownloadsConfig(stored, { enabled: true });
}

async function writeAppDownloadsConfig(incoming) {
  if (!isMysqlEnabled()) {
    throw new Error('MySQL is not configured.');
  }
  const normalized = normalizeAppDownloadsConfig(incoming, { enabled: true });
  await writeJson(APP_DOWNLOADS_STORE_KEY, {
    slots: normalized.slots.map((slot) => ({
      slot: slot.slot,
      name: slot.name,
      iconFileName: slot.iconFileName,
      iconMimeType: slot.iconMimeType,
      appFileName: slot.appFileName,
      appMimeType: slot.appMimeType,
      appSizeBytes: slot.appSizeBytes,
      updatedAt: slot.updatedAt
    }))
  });
  return normalized;
}

async function readAppDownloadAsset(slot, assetKind) {
  const slotNumber = normalizeSlotNumber(slot);
  const kind = normalizeAssetKind(assetKind);
  if (!slotNumber || !kind || !isMysqlEnabled()) {
    return null;
  }

  await ensureAppDownloadAssetsTable();
  const pool = await getPool();
  if (!pool) return null;

  const [rows] = await pool.query(
    `SELECT file_name, mime_type, file_size, file_blob, updated_at
       FROM \`${APP_DOWNLOAD_ASSETS_TABLE}\`
      WHERE slot = ? AND asset_kind = ?
      LIMIT 1`,
    [slotNumber, kind]
  );

  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;

  return {
    slot: slotNumber,
    assetKind: kind,
    fileName: asText(row.file_name).slice(0, 255),
    mimeType: asText(row.mime_type).slice(0, 120) || 'application/octet-stream',
    fileSizeBytes: normalizeAppSize(row.file_size),
    buffer: Buffer.isBuffer(row.file_blob) ? row.file_blob : Buffer.from(row.file_blob || ''),
    updatedAt: asText(row.updated_at)
  };
}

async function writeAppDownloadAsset(slot, assetKind, incoming = {}) {
  const slotNumber = normalizeSlotNumber(slot);
  const kind = normalizeAssetKind(assetKind);
  if (!slotNumber || !kind) {
    throw new Error('Invalid app download asset target.');
  }
  if (!isMysqlEnabled()) {
    throw new Error('MySQL is not configured.');
  }

  const buffer = Buffer.isBuffer(incoming.buffer) ? incoming.buffer : Buffer.from(incoming.buffer || '');
  if (!buffer.length) {
    throw new Error('Uploaded file is empty.');
  }

  const fileName = asText(incoming.fileName).slice(0, 255) || `${kind}-${slotNumber}`;
  const mimeType = asText(incoming.mimeType).slice(0, 120) || 'application/octet-stream';

  await ensureAppDownloadAssetsTable();
  const pool = await getPool();
  if (!pool) {
    throw new Error('MySQL connection is not available.');
  }

  await pool.query(
    `INSERT INTO \`${APP_DOWNLOAD_ASSETS_TABLE}\` (
        slot,
        asset_kind,
        file_name,
        mime_type,
        file_size,
        file_blob
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        file_name = VALUES(file_name),
        mime_type = VALUES(mime_type),
        file_size = VALUES(file_size),
        file_blob = VALUES(file_blob),
        updated_at = CURRENT_TIMESTAMP`,
    [slotNumber, kind, fileName, mimeType, buffer.length, buffer]
  );

  return readAppDownloadAsset(slotNumber, kind);
}

module.exports = {
  APP_DOWNLOADS_STORE_KEY,
  APP_DOWNLOAD_SLOT_COUNT,
  APP_DOWNLOADS_PUBLIC_API_PREFIX,
  APP_DOWNLOAD_ASSETS_TABLE,
  DEFAULT_APP_NAME,
  normalizeSlotNumber,
  normalizeAppDownloadsConfig,
  buildDefaultAppDownloadsConfig,
  buildAppDownloadAssetUrl,
  readAppDownloadsConfig,
  writeAppDownloadsConfig,
  ensureAppDownloadAssetsTable,
  readAppDownloadAsset,
  writeAppDownloadAsset
};
