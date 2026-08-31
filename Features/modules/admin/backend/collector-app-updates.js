const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const yauzl = require('yauzl');
const { DATA_DIR } = require('../../../../core/runtime/paths');
const { appendActivityLog } = require('./activity-log');

const publicRouter = express.Router();
const adminRouter = express.Router();

const UPDATE_DIR = path.join(DATA_DIR, 'collector-updates');
const MANIFEST_PATH = path.join(UPDATE_DIR, 'update.json');
const PACKAGE_NAME = 'com.example.myapplication';
const MAX_APK_BYTES = 80 * 1024 * 1024;
const ALLOWED_APK_SOURCE_HOST = 'raw.githubusercontent.com';
const ALLOWED_APK_SOURCE_PREFIX = '/ArchieCDumayag/CollectorApp/';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const APK_FILE_PATTERN = /^THRE3J-Collector-[A-Za-z0-9._-]+\.apk$/;
let publishInProgress = false;

const asText = (value, maxLength = 0) => {
  const text = String(value ?? '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
};

const parsePositiveInteger = (value, fieldName, { allowZero = false } = {}) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) {
    const error = new Error(`${fieldName} must be ${allowZero ? 'zero or a positive integer' : 'a positive integer'}.`);
    error.statusCode = 400;
    throw error;
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    const error = new Error(`${fieldName} is outside the supported range.`);
    error.statusCode = 400;
    throw error;
  }
  return number;
};

const parseBoolean = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

const validateApkSourceUrl = (value) => {
  let url;
  try {
    url = new URL(asText(value, 1000));
  } catch {
    const error = new Error('APK source must be a valid HTTPS URL.');
    error.statusCode = 400;
    throw error;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== ALLOWED_APK_SOURCE_HOST
    || !url.pathname.startsWith(ALLOWED_APK_SOURCE_PREFIX)
    || !url.pathname.toLowerCase().endsWith('.apk')
    || url.username
    || url.password
    || url.port
  ) {
    const error = new Error('APK source must be a raw CollectorApp GitHub HTTPS URL.');
    error.statusCode = 400;
    throw error;
  }
  return url.toString();
};

const downloadApkFromSource = async (sourceUrl) => {
  const url = validateApkSourceUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    if (!response.ok || !response.body) {
      const error = new Error(`APK source returned HTTP ${response.status}.`);
      error.statusCode = 400;
      throw error;
    }
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_APK_BYTES) {
      const error = new Error('APK exceeds the 80 MB upload limit.');
      error.statusCode = 413;
      throw error;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_APK_BYTES) {
        const error = new Error('APK exceeds the 80 MB upload limit.');
        error.statusCode = 413;
        throw error;
      }
      chunks.push(Buffer.from(chunk));
    }
    if (!total) {
      const error = new Error('APK source returned an empty file.');
      error.statusCode = 400;
      throw error;
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('APK source download timed out.');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeManifest = (incoming = {}) => {
  const versionCode = parsePositiveInteger(incoming.versionCode, 'Version code');
  const versionName = asText(incoming.versionName, 40);
  const fileName = asText(incoming.fileName, 180);
  const sha256 = asText(incoming.sha256, 64).toLowerCase();
  const fileSize = parsePositiveInteger(incoming.fileSize, 'APK file size');
  const minimumVersionCode = parsePositiveInteger(
    incoming.minimumVersionCode ?? 0,
    'Minimum version code',
    { allowZero: true }
  );
  if (!versionName) {
    const error = new Error('Version name is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!APK_FILE_PATTERN.test(fileName) || path.basename(fileName) !== fileName) {
    const error = new Error('Stored APK file name is invalid.');
    error.statusCode = 500;
    throw error;
  }
  if (!SHA256_PATTERN.test(sha256)) {
    const error = new Error('Stored APK checksum is invalid.');
    error.statusCode = 500;
    throw error;
  }
  if (minimumVersionCode > versionCode) {
    const error = new Error('Minimum version code cannot exceed the published version code.');
    error.statusCode = 400;
    throw error;
  }
  return {
    versionCode,
    versionName,
    packageName: PACKAGE_NAME,
    fileName,
    sha256,
    fileSize,
    required: Boolean(incoming.required),
    minimumVersionCode,
    releaseNotes: asText(incoming.releaseNotes, 2000),
    publishedAt: asText(incoming.publishedAt, 40) || new Date().toISOString(),
    publishedBy: asText(incoming.publishedBy, 120)
  };
};

const ensureUpdateDir = async () => {
  await fs.promises.mkdir(UPDATE_DIR, { recursive: true });
};

const readPublishedManifest = async () => {
  let raw;
  try {
    raw = await fs.promises.readFile(MANIFEST_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const manifest = normalizeManifest(JSON.parse(raw));
  const apkPath = path.join(UPDATE_DIR, manifest.fileName);
  const stat = await fs.promises.stat(apkPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat?.isFile() || stat.size !== manifest.fileSize) {
    const error = new Error('Published Collector APK is missing or does not match its manifest.');
    error.statusCode = 503;
    throw error;
  }
  return manifest;
};

const validateApkArchive = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: false }, (openError, zipFile) => {
    if (openError || !zipFile) {
      const error = new Error('The uploaded file is not a readable APK archive.');
      error.statusCode = 400;
      reject(error);
      return;
    }

    let settled = false;
    let hasManifest = false;
    let hasExecutableContent = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      const error = new Error(message);
      error.statusCode = 400;
      reject(error);
    };

    zipFile.on('error', () => fail('The uploaded APK archive is damaged.'));
    zipFile.on('entry', (entry) => {
      if (entry.fileName === 'AndroidManifest.xml') hasManifest = true;
      if (/^(?:classes(?:\d+)?\.dex|resources\.arsc)$/.test(entry.fileName)) hasExecutableContent = true;
      zipFile.readEntry();
    });
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      zipFile.close();
      if (!hasManifest || !hasExecutableContent) {
        const error = new Error('The uploaded archive is not a valid Android APK.');
        error.statusCode = 400;
        reject(error);
        return;
      }
      resolve();
    });
    zipFile.readEntry();
  });
});

const resolvePublicBaseUrl = (req) => {
  const configured = asText(process.env.COLLECTOR_UPDATE_PUBLIC_BASE_URL, 500).replace(/\/+$/, '');
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol !== 'https:') throw new Error('HTTPS is required.');
      return url.toString().replace(/\/+$/, '');
    } catch {
      throw new Error('COLLECTOR_UPDATE_PUBLIC_BASE_URL must be a valid HTTPS URL.');
    }
  }
  return `${req.protocol}://${req.get('host')}/collector-updates`;
};

const toPublicManifest = (req, manifest) => ({
  versionCode: manifest.versionCode,
  versionName: manifest.versionName,
  packageName: PACKAGE_NAME,
  apkUrl: `${resolvePublicBaseUrl(req)}/${encodeURIComponent(manifest.fileName)}`,
  sha256: manifest.sha256,
  fileSize: manifest.fileSize,
  required: manifest.required,
  minimumVersionCode: manifest.minimumVersionCode,
  releaseNotes: manifest.releaseNotes,
  publishedAt: manifest.publishedAt
});

const writeManifestAtomically = async (manifest) => {
  const temporaryPath = path.join(UPDATE_DIR, `.update-${crypto.randomUUID()}.json.tmp`);
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o640,
    flag: 'wx'
  });
  try {
    await fs.promises.rename(temporaryPath, MANIFEST_PATH);
  } catch (error) {
    if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(error?.code)) {
      await fs.promises.unlink(temporaryPath).catch(() => {});
      throw error;
    }
    const previousPath = path.join(UPDATE_DIR, `.update-${crypto.randomUUID()}.previous.json`);
    await fs.promises.rename(MANIFEST_PATH, previousPath);
    try {
      await fs.promises.rename(temporaryPath, MANIFEST_PATH);
      await fs.promises.unlink(previousPath).catch(() => {});
    } catch (replaceError) {
      await fs.promises.rename(previousPath, MANIFEST_PATH).catch(() => {});
      await fs.promises.unlink(temporaryPath).catch(() => {});
      throw replaceError;
    }
  }
};

publicRouter.get('/update.json', async (req, res, next) => {
  try {
    const manifest = await readPublishedManifest();
    if (!manifest) {
      res.set('Cache-Control', 'no-store');
      return res.status(404).json({ ok: false, error: 'No Collector app update has been published.' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.json(toPublicManifest(req, manifest));
  } catch (error) {
    return next(error);
  }
});

publicRouter.get('/:fileName', async (req, res, next) => {
  try {
    const manifest = await readPublishedManifest();
    if (!manifest || req.params.fileName !== manifest.fileName) {
      return res.status(404).json({ ok: false, error: 'Collector APK not found.' });
    }
    const apkPath = path.join(UPDATE_DIR, manifest.fileName);
    res.set({
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(manifest.fileSize),
      'Content-Disposition': `attachment; filename="${manifest.fileName}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"sha256-${manifest.sha256}"`
    });
    return res.sendFile(apkPath);
  } catch (error) {
    return next(error);
  }
});

adminRouter.get('/', async (req, res, next) => {
  try {
    const manifest = await readPublishedManifest();
    return res.json({
      ok: true,
      available: Boolean(manifest),
      update: manifest ? toPublicManifest(req, manifest) : null,
      manifestUrl: `${resolvePublicBaseUrl(req)}/update.json`,
      limits: { maxApkBytes: MAX_APK_BYTES }
    });
  } catch (error) {
    return next(error);
  }
});

const publishUpdate = async (req, buffer) => {
  let apkPath = '';
  try {
    if (!buffer.length) {
      const error = new Error('Select a non-empty APK file to publish.');
      error.statusCode = 400;
      throw error;
    }
    if (buffer.length > MAX_APK_BYTES) {
      const error = new Error('APK exceeds the 80 MB upload limit.');
      error.statusCode = 413;
      throw error;
    }
    await validateApkArchive(buffer);

    const versionCode = parsePositiveInteger(req.query.versionCode, 'Version code');
    const versionName = asText(req.query.versionName, 40);
    if (!versionName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(versionName)) {
      const error = new Error('Version name may contain only letters, numbers, dots, underscores, and hyphens.');
      error.statusCode = 400;
      throw error;
    }
    const minimumVersionCode = parsePositiveInteger(
      req.query.minimumVersionCode ?? 0,
      'Minimum version code',
      { allowZero: true }
    );
    if (minimumVersionCode > versionCode) {
      const error = new Error('Minimum version code cannot exceed the published version code.');
      error.statusCode = 400;
      throw error;
    }

    const current = await readPublishedManifest();
    if (current && versionCode < current.versionCode) {
      const error = new Error(`Version code must be ${current.versionCode} or higher.`);
      error.statusCode = 409;
      throw error;
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileName = `THRE3J-Collector-v${versionName}-${versionCode}-${sha256.slice(0, 12)}.apk`;
    await ensureUpdateDir();
    apkPath = path.join(UPDATE_DIR, fileName);
    await fs.promises.writeFile(apkPath, buffer, { mode: 0o640, flag: 'wx' });

    const manifest = normalizeManifest({
      versionCode,
      versionName,
      fileName,
      sha256,
      fileSize: buffer.length,
      required: parseBoolean(req.query.required),
      minimumVersionCode,
      releaseNotes: asText(req.query.releaseNotes, 2000),
      publishedAt: new Date().toISOString(),
      publishedBy: req.user?.username || req.user?.name || req.user?.id || 'Admin'
    });
    await writeManifestAtomically(manifest);
    apkPath = '';

    await appendActivityLog({
      message: `Published THRE3J Collector ${manifest.versionName} (version code ${manifest.versionCode})`,
      meta: `APK ${manifest.fileSize} bytes; SHA-256 ${manifest.sha256.slice(0, 16)}…`,
      userId: req.user?.id,
      username: req.user?.username,
      branchId: req.user?.branchId
    }).catch((error) => {
      console.warn('Failed to record Collector app update activity:', error.message);
    });

    return {
      ok: true,
      message: `THRE3J Collector ${manifest.versionName} is now published.`,
      update: toPublicManifest(req, manifest),
      manifestUrl: `${resolvePublicBaseUrl(req)}/update.json`
    };
  } catch (error) {
    if (apkPath) await fs.promises.unlink(apkPath).catch(() => {});
    throw error;
  }
};

const runPublish = async (req, res, next, loadBuffer) => {
  if (publishInProgress) {
    return res.status(409).json({ ok: false, error: 'Another Collector app update is being published.' });
  }
  publishInProgress = true;
  try {
    const result = await publishUpdate(req, await loadBuffer());
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  } finally {
    publishInProgress = false;
  }
};

adminRouter.post('/publish', (req, res, next) => runPublish(
  req,
  res,
  next,
  async () => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0))
));

adminRouter.post('/publish-url', (req, res, next) => runPublish(
  req,
  res,
  next,
  async () => downloadApkFromSource(req.body?.sourceUrl)
));

module.exports = {
  publicRouter,
  adminRouter,
  MAX_APK_BYTES,
  PACKAGE_NAME,
  normalizeManifest,
  readPublishedManifest,
  validateApkArchive,
  validateApkSourceUrl
};
