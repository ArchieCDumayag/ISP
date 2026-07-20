const express = require('express');
const {
  readAppDownloadsConfig,
  readAppDownloadAsset,
  normalizeSlotNumber
} = require('./app-downloads-store');

const router = express.Router();

const sanitizeDownloadName = (value, fallback) => {
  const cleaned = String(value || '')
    .replace(/[\/\\?%*:|"<>]/g, '-')
    .trim();
  return cleaned || fallback;
};

router.get('/', async (_req, res, next) => {
  try {
    const config = await readAppDownloadsConfig();
    return res.json({
      ok: true,
      enabled: config.enabled,
      configuredSlots: config.configuredSlots,
      slots: config.slots.map((slot) => ({
        slot: slot.slot,
        name: slot.name,
        iconUrl: slot.iconUrl,
        appUrl: slot.appUrl,
        appFileName: slot.appFileName,
        appSizeBytes: slot.appSizeBytes,
        updatedAt: slot.updatedAt
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slot/icon', async (req, res, next) => {
  try {
    const slotNumber = normalizeSlotNumber(req.params.slot);
    if (!slotNumber) {
      return res.status(404).json({ ok: false, error: 'Unknown app slot.' });
    }

    const asset = await readAppDownloadAsset(slotNumber, 'icon');
    if (!asset || !asset.buffer?.length) {
      return res.status(404).json({ ok: false, error: 'Icon not found.' });
    }

    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(asset.buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(asset.buffer);
  } catch (error) {
    return next(error);
  }
});

router.get('/:slot/file', async (req, res, next) => {
  try {
    const slotNumber = normalizeSlotNumber(req.params.slot);
    if (!slotNumber) {
      return res.status(404).json({ ok: false, error: 'Unknown app slot.' });
    }

    const asset = await readAppDownloadAsset(slotNumber, 'file');
    if (!asset || !asset.buffer?.length) {
      return res.status(404).json({ ok: false, error: 'App file not found.' });
    }

    const downloadName = sanitizeDownloadName(asset.fileName, `app-${slotNumber}`);
    res.setHeader('Content-Type', asset.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', String(asset.buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(asset.buffer);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
