const express = require('express');
const workspaceStore = require('./workspace-store');

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

router.get('/export', async (_req, res) => {
  try {
    const payload = await workspaceStore.createExport();
    const date = payload.exportedAt.slice(0, 10);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="temp-workspace-${date}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/import', async (req, res) => {
  try {
    const snapshot = await workspaceStore.replaceFromExport(req.body || {});
    return res.json({
      ...snapshot,
      message: `Imported ${snapshot.summary.customerCount} Temp customers and ${snapshot.summary.paymentCount} transactions.`
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
