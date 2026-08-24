const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { verifyPassword } = require('../../../../core/security/passwords');
const { accountHasRole } = require('../../../../core/security/role-utils');
const { beginMaintenance, endMaintenance } = require('../../../../core/runtime/maintenance-state');
const { waitForPendingWrites } = require('../../../../core/data/data-store');
const { loadAccounts } = require('./accounts-store');
const {
  RESTORE_CONFIRMATION_PHRASE,
  createSystemBackupService
} = require('./system-backup-service');

const router = express.Router();
const service = createSystemBackupService();
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const preparedImports = new Map();
let restoreInProgress = false;

const requireAdmin = (req, res, next) => {
  if (!req.user || !accountHasRole(req.user, 'Admin')) {
    return res.status(403).json({ ok: false, error: 'Admin access required.' });
  }
  return next();
};

const safeDecodeFilename = (value) => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
};

const disposePreparedToken = async (token) => {
  const entry = preparedImports.get(token);
  if (!entry) return;
  preparedImports.delete(token);
  if (entry.timer) clearTimeout(entry.timer);
  await service.cleanupPrepared(entry.prepared).catch(() => {});
};

const retainPrepared = async (prepared, user) => {
  const userId = String(user?.id || '');
  const previousTokens = [...preparedImports.values()]
    .filter((entry) => entry.userId === userId)
    .map((entry) => entry.token);
  for (const previousToken of previousTokens) await disposePreparedToken(previousToken);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  const timer = setTimeout(() => {
    disposePreparedToken(token).catch(() => {});
  }, PREVIEW_TTL_MS);
  timer.unref?.();
  preparedImports.set(token, {
    token,
    prepared,
    userId,
    expiresAt,
    timer
  });
  return { token, expiresAt };
};

const findAuthorizingAdmin = async (req, password) => {
  const accounts = await loadAccounts({ includeSystem: true });
  const current = (Array.isArray(accounts) ? accounts : []).find(
    (account) => String(account.id) === String(req.user?.id)
  );
  if (!current || current.isActive === false || !accountHasRole(current, 'Admin')) return null;
  if (!verifyPassword(String(password || ''), String(current.password || ''))) return null;
  return current;
};

router.use(requireAdmin);

router.get('/export', async (_req, res) => {
  let archive = null;
  try {
    archive = await service.createTemporaryArchive();
    const validation = await service.validateGeneratedArchive(archive);
    res.set({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archive.fileName}"`,
      'Content-Length': String(validation.bytes),
      'X-Backup-Snapshot-Id': validation.manifest.snapshotId,
      'X-Content-Type-Options': 'nosniff'
    });
    await pipeline(fs.createReadStream(archive.destinationPath), res);
  } catch (error) {
    console.error('Full-system backup export failed:', error);
    if (!res.headersSent) {
      res.status(Number(error?.statusCode || 500)).json({
        ok: false,
        error: error.message || 'Full-system backup export failed.'
      });
    } else {
      res.destroy(error);
    }
  } finally {
    if (archive?.tempRoot) await service.cleanupPrepared({ stageRoot: archive.tempRoot }).catch(() => {});
  }
});

router.post('/preview', async (req, res) => {
  if (restoreInProgress) {
    return res.status(409).json({ ok: false, error: 'A full-system restore is already running.' });
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/octet-stream') && !contentType.includes('application/zip')) {
    return res.status(415).json({ ok: false, error: 'Upload the backup archive as a ZIP file.' });
  }
  let received = null;
  try {
    received = await service.receiveArchive(req);
    const prepared = await service.validateArchive(received);
    const current = await service.inspectCurrent();
    const retained = await retainPrepared(prepared, req.user);
    const originalFilename = path.basename(safeDecodeFilename(req.headers['x-backup-filename'])) || 'backup.isp-backup.zip';
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      restoreToken: retained.token,
      expiresAt: new Date(retained.expiresAt).toISOString(),
      confirmationPhrase: RESTORE_CONFIRMATION_PHRASE,
      archive: {
        fileName: originalFilename,
        kind: prepared.manifest.kind,
        schemaVersion: prepared.manifest.schemaVersion,
        snapshotId: prepared.manifest.snapshotId,
        createdAt: prepared.manifest.createdAt,
        applicationVersion: prepared.manifest.applicationVersion,
        storageDriver: prepared.manifest.storageDriver,
        ...prepared.summary,
        excluded: prepared.manifest.excluded || [],
        warnings: prepared.manifest.warnings || []
      },
      current,
      automaticPreImportBackup: true,
      replacementMode: 'complete'
    });
  } catch (error) {
    if (received?.stageRoot) await service.cleanupPrepared(received).catch(() => {});
    console.error('Full-system backup preview failed:', error);
    return res.status(Number(error?.statusCode || 400)).json({
      ok: false,
      error: error.message || 'Unable to validate the selected full-system backup.'
    });
  }
});

router.post('/restore', async (req, res) => {
  if (restoreInProgress) {
    return res.status(409).json({ ok: false, error: 'A full-system restore is already running.' });
  }
  const restoreToken = String(req.body?.restoreToken || '').trim();
  const password = String(req.body?.password || '');
  const confirmation = String(req.body?.confirmation || '').trim();
  const acknowledged = req.body?.acknowledgeReplacement === true;
  const retained = preparedImports.get(restoreToken);
  if (!retained || retained.expiresAt <= Date.now()) {
    if (retained) await disposePreparedToken(restoreToken);
    return res.status(410).json({ ok: false, error: 'Backup preview expired. Select the backup file again.' });
  }
  if (retained.userId !== String(req.user?.id || '')) {
    return res.status(403).json({ ok: false, error: 'This backup preview belongs to a different Admin session.' });
  }
  if (!password || confirmation !== RESTORE_CONFIRMATION_PHRASE || !acknowledged) {
    return res.status(400).json({
      ok: false,
      error: `Enter your current Admin password, type ${RESTORE_CONFIRMATION_PHRASE}, and accept the replacement warning.`
    });
  }

  let maintenanceToken = null;
  try {
    const admin = await findAuthorizingAdmin(req, password);
    if (!admin) return res.status(403).json({ ok: false, error: 'The current Admin password is incorrect.' });
    maintenanceToken = beginMaintenance('full-system restore', {
      actorId: String(req.user?.id || ''),
      snapshotId: String(retained.prepared?.manifest?.snapshotId || '')
    });
    restoreInProgress = true;
    await waitForPendingWrites();
    preparedImports.delete(restoreToken);
    if (retained.timer) clearTimeout(retained.timer);
    const result = await service.restorePrepared(retained.prepared);
    await service.cleanupPrepared(retained.prepared).catch(() => {});
    return res.json({
      ok: true,
      message: 'Full-system backup restored. All server sessions were invalidated; sign in again.',
      sessionsInvalidated: true,
      ...result
    });
  } catch (error) {
    await service.cleanupPrepared(retained.prepared).catch(() => {});
    console.error('Full-system backup restore failed:', error);
    return res.status(Number(error?.statusCode || 500)).json({
      ok: false,
      error: error.message || 'Full-system backup restore failed.',
      preImportBackup: error?.preImportBackup || null
    });
  } finally {
    restoreInProgress = false;
    if (maintenanceToken) endMaintenance(maintenanceToken);
  }
});

router.isRestoreInProgress = () => restoreInProgress;
router.disposePreparedToken = disposePreparedToken;
router.service = service;

module.exports = router;
