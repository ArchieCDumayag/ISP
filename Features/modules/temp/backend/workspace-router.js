const express = require('express');
const workspaceStore = require('./workspace-store');
const {
  EXCEL_MIME_TYPE,
  buildWorkspaceExcelBuffer,
  parseWorkspaceExcelBuffer
} = require('./workspace-excel');

const router = express.Router();

const sendError = (res, error) => {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) console.error('Temp workspace request failed:', error);
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? 'Unable to update the Temp workspace.' : error.message
  });
};

router.get('/workspace', async (_req, res) => {
  try {
    return res.json(await workspaceStore.getSnapshot());
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/customers', async (req, res) => {
  try {
    const customer = await workspaceStore.createCustomer(req.body || {});
    return res.status(201).json({ ok: true, customer });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/customers/:accountNumber', async (req, res) => {
  try {
    const customer = await workspaceStore.updateCustomer(req.params.accountNumber, req.body || {});
    return res.json({ ok: true, customer });
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/customers/:accountNumber', async (req, res) => {
  try {
    return res.json(await workspaceStore.deleteCustomer(req.params.accountNumber));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/payments', async (req, res) => {
  try {
    const payment = await workspaceStore.createPayment(req.body || {}, req.user?.name || req.user?.username || 'Admin');
    return res.status(201).json({ ok: true, payment });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put('/payments/:paymentId', async (req, res) => {
  try {
    const payment = await workspaceStore.updatePayment(
      req.params.paymentId,
      req.body || {},
      req.user?.name || req.user?.username || 'Admin'
    );
    return res.json({ ok: true, payment });
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/payments/:paymentId', async (req, res) => {
  try {
    return res.json(await workspaceStore.deletePayment(req.params.paymentId));
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/workspace', async (_req, res) => {
  try {
    const snapshot = await workspaceStore.clearAllData();
    return res.json({ ...snapshot, message: 'All Temp customers and transactions were cleared.' });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/export', async (req, res) => {
  try {
    const payload = await workspaceStore.createExport();
    const date = payload.exportedAt.slice(0, 10);
    const format = String(req.query.format || 'json').trim().toLowerCase();
    if (format === 'xlsx' || format === 'excel') {
      const workbook = buildWorkspaceExcelBuffer(payload);
      res.set('Content-Type', EXCEL_MIME_TYPE);
      res.set('Content-Disposition', `attachment; filename="temp-workspace-${date}.xlsx"`);
      res.set('Content-Length', String(workbook.length));
      return res.send(workbook);
    }
    if (format !== 'json') {
      throw new workspaceStore.WorkspaceValidationError('Export format must be JSON or Excel.');
    }
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="temp-workspace-${date}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return sendError(res, error);
  }
});

const importedSnapshotResponse = (res, snapshot) => res.json({
  ...snapshot,
  message: `Imported ${snapshot.summary.customerCount} Temp customers and ${snapshot.summary.paymentCount} transactions.`
});

router.post('/import', async (req, res) => {
  try {
    const snapshot = await workspaceStore.replaceFromExport(req.body || {});
    return importedSnapshotResponse(res, snapshot);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/import-file', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new workspaceStore.WorkspaceValidationError('Select a JSON or Excel Temp workspace export file.');
    }
    let filename = String(req.get('X-Import-Filename') || '').trim();
    try {
      filename = decodeURIComponent(filename);
    } catch (_error) {
      throw new workspaceStore.WorkspaceValidationError('The import filename is invalid.');
    }
    const extension = filename.toLowerCase().match(/\.(json|xlsx|xls)$/)?.[1] || '';
    let payload;
    if (extension === 'json') {
      try {
        payload = JSON.parse(req.body.toString('utf8').replace(/^\uFEFF/, ''));
      } catch (_error) {
        throw new workspaceStore.WorkspaceValidationError('Select a valid Temp workspace JSON export file.');
      }
    } else if (extension === 'xlsx' || extension === 'xls') {
      payload = parseWorkspaceExcelBuffer(req.body);
    } else {
      throw new workspaceStore.WorkspaceValidationError('Only exported Temp JSON, XLSX, or XLS files can be imported.');
    }
    const snapshot = await workspaceStore.replaceFromExport(payload);
    return importedSnapshotResponse(res, snapshot);
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
