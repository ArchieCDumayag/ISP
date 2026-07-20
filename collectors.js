const express = require('express');
const { loadAccounts } = require('./accounts-store');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { accountHasRole } = require('./role-utils');

const STORE_KEYS = {
  collectors: 'collectors',
  customers: 'customers',
  coverage: 'coverage',
  payments: 'payments'
};

const router = express.Router();

const buildAssignmentsMap = (rows = []) => {
  const assignments = {};
  (rows || []).forEach((row) => {
    const areaName = String(row.areaName || row.area_name || '').trim();
    const collectorId = String(row.collectorId || row.collector_user_id || '').trim();
    if (!areaName || !collectorId) return;
    if (!assignments[areaName]) assignments[areaName] = [];
    if (!assignments[areaName].includes(collectorId)) assignments[areaName].push(collectorId);
  });
  return assignments;
};

const normalizeAssignmentsMap = (assignments = {}) => {
  const normalized = {};
  Object.entries(assignments || {}).forEach(([area, value]) => {
    const areaName = String(area || '').trim();
    if (!areaName) return;
    const ids = Array.isArray(value) ? value : [value];
    normalized[areaName] = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  });
  return normalized;
};

const isPrepaidCustomer = (customer) => {
  const explicit = String(customer?.planCategory || customer?.planType || '').trim().toLowerCase();
  if (explicit === 'prepaid') return true;
  if (explicit === 'postpaid') return false;
  const billing = String(customer?.planBilling || '').trim().toLowerCase();
  if (billing.includes('prepaid')) return true;
  if (billing.includes('postpaid')) return false;
  return false;
};

// GET /api/collectors - return current assignments and available collectors
router.get('/', async (req, res) => {
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const accounts = await loadAccounts();
    const collectorAccounts = (accounts || [])
      .filter(a => accountHasRole(a, 'Collector') && String(a.branchId || '') === String(branchId))
      .map(a => ({
        id: String(a.id),
        username: a.username,
        role: a.role || 'Collector',
        name: a.name || a.username,
        created: a.created,
      }));
    const [rows] = await query(
      `SELECT area_name AS areaName, collector_user_id AS collectorId
       FROM collector_assignments WHERE branch_id = ?`,
      [branchId]
    );
    const assignments = buildAssignmentsMap(rows);
    return res.json({ ok: true, assignments, accounts: collectorAccounts });
  }

  const accounts = await loadAccounts();
  const collectorAccounts = (accounts || [])
    .filter(a => accountHasRole(a, 'Collector'))
    .map(a => ({
      id: String(a.id),
      username: a.username,
      role: a.role || 'Collector',
      name: a.name || a.username,
      created: a.created,
    }));
  const collectorsFile = await readJson(STORE_KEYS.collectors, { assignments: {} });
  res.json({ ok: true, assignments: normalizeAssignmentsMap(collectorsFile.assignments || {}), accounts: collectorAccounts });
});

// POST /api/collectors/assign - body { area, collectorId } or { areas, collectorId }
router.post('/assign', async (req, res) => {
  const { area, areas, collectorId } = req.body || {};
  const areaList = (Array.isArray(areas) ? areas : [area]).map((item) => String(item || '').trim()).filter(Boolean);
  const replaceForCollector = Array.isArray(areas);
  if (!areaList.length && !replaceForCollector) return res.status(400).json({ ok: false, error: 'area is required' });
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    if (collectorId === null || collectorId === undefined || collectorId === '') {
      const [result] = await query(
        'DELETE FROM collector_assignments WHERE branch_id = ? AND area_name IN (?)',
        [branchId, areaList]
      );
      const [rows] = await query(
        `SELECT area_name AS areaName, collector_user_id AS collectorId
         FROM collector_assignments WHERE branch_id = ?`,
        [branchId]
      );
      const assignments = buildAssignmentsMap(rows);
      return res.json({
        ok: true,
        assignments,
        message: result && result.affectedRows ? 'Assignment removed' : 'No assignment found for that area',
      });
    }

    const safeCollectorId = String(collectorId);
    const accounts = await loadAccounts();
    const collectorAccount = (accounts || []).find(
      (account) =>
        String(account.id) === safeCollectorId &&
        accountHasRole(account, 'Collector') &&
        String(account.branchId || '') === String(branchId)
    );
    if (!collectorAccount) {
      return res.status(403).json({ ok: false, error: 'Collector account is not assigned to this branch.' });
    }

    if (replaceForCollector) {
      await query(
        areaList.length
          ? 'DELETE FROM collector_assignments WHERE branch_id = ? AND collector_user_id = ? AND area_name NOT IN (?)'
          : 'DELETE FROM collector_assignments WHERE branch_id = ? AND collector_user_id = ?',
        areaList.length ? [branchId, safeCollectorId, areaList] : [branchId, safeCollectorId]
      );
    }
    for (const areaName of areaList) {
      const [coverageRows] = await query(
        'SELECT id FROM coverage_areas WHERE branch_id = ? AND name = ? LIMIT 1',
        [branchId, areaName]
      );
      const coverageId = coverageRows && coverageRows.length ? coverageRows[0].id : null;
      const [existing] = await query(
        'SELECT id FROM collector_assignments WHERE branch_id = ? AND area_name = ? AND collector_user_id = ? LIMIT 1',
        [branchId, areaName, safeCollectorId]
      );
      if (!existing || !existing.length) {
        await query(
          'INSERT INTO collector_assignments (branch_id, coverage_id, area_name, collector_user_id) VALUES (?, ?, ?, ?)',
          [branchId, coverageId, areaName, safeCollectorId]
        );
      }
    }
    const [rows] = await query(
      `SELECT area_name AS areaName, collector_user_id AS collectorId
       FROM collector_assignments WHERE branch_id = ?`,
      [branchId]
    );
    const assignments = buildAssignmentsMap(rows);
    return res.json({ ok: true, assignments });
  }

  const collectorsFile = await readJson(STORE_KEYS.collectors, { assignments: {} });
  collectorsFile.assignments = normalizeAssignmentsMap(collectorsFile.assignments || {});

  if (collectorId === null || collectorId === undefined || collectorId === '') {
    let existed = false;
    areaList.forEach((areaName) => {
      existed = existed || Object.prototype.hasOwnProperty.call(collectorsFile.assignments, areaName);
      delete collectorsFile.assignments[areaName];
    });
    await writeJson(STORE_KEYS.collectors, collectorsFile);
    return res.json({
      ok: true,
      assignments: collectorsFile.assignments,
      message: existed ? 'Assignment removed' : 'No assignment found for that area',
    });
  }

  if (replaceForCollector) {
    Object.keys(collectorsFile.assignments).forEach((areaName) => {
      collectorsFile.assignments[areaName] = (collectorsFile.assignments[areaName] || [])
        .filter((id) => String(id) !== String(collectorId));
      if (!collectorsFile.assignments[areaName].length) delete collectorsFile.assignments[areaName];
    });
  }
  areaList.forEach((areaName) => {
    collectorsFile.assignments[areaName] = collectorsFile.assignments[areaName] || [];
    if (!collectorsFile.assignments[areaName].includes(String(collectorId))) {
      collectorsFile.assignments[areaName].push(String(collectorId));
    }
  });
  await writeJson(STORE_KEYS.collectors, collectorsFile);
  res.json({ ok: true, assignments: collectorsFile.assignments });
});

// DELETE /api/collectors/assign/:area - remove assignment for area
router.delete('/assign/:area', async (req, res) => {
  const area = req.params.area;
  const collectorId = String(req.query?.collectorId || '').trim();
  if (!area) return res.status(400).json({ ok: false, error: 'area is required' });
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const [result] = collectorId
      ? await query(
          'DELETE FROM collector_assignments WHERE branch_id = ? AND area_name = ? AND collector_user_id = ?',
          [branchId, area, collectorId]
        )
      : await query(
          'DELETE FROM collector_assignments WHERE branch_id = ? AND area_name = ?',
          [branchId, area]
        );
    const [rows] = await query(
      `SELECT area_name AS areaName, collector_user_id AS collectorId
       FROM collector_assignments WHERE branch_id = ?`,
      [branchId]
    );
    const assignments = buildAssignmentsMap(rows);
    return res.json({
      ok: true,
      assignments,
      message: result && result.affectedRows ? 'Assignment removed' : 'No assignment found for that area',
    });
  }

  const collectorsFile = await readJson(STORE_KEYS.collectors, { assignments: {} });
  collectorsFile.assignments = collectorsFile.assignments || {};
  const currentIds = Array.isArray(collectorsFile.assignments[area])
    ? collectorsFile.assignments[area]
    : [collectorsFile.assignments[area]].filter(Boolean);
  const existed = currentIds.length > 0;
  if (existed && collectorId) {
    collectorsFile.assignments[area] = currentIds.filter((id) => String(id) !== collectorId);
    if (!collectorsFile.assignments[area].length) delete collectorsFile.assignments[area];
    await writeJson(STORE_KEYS.collectors, collectorsFile);
  } else if (existed) {
    delete collectorsFile.assignments[area];
    await writeJson(STORE_KEYS.collectors, collectorsFile);
  }
  res.json({
    ok: true,
    assignments: collectorsFile.assignments,
    message: existed ? 'Assignment removed' : 'No assignment found for that area',
  });
});

// GET /api/collectors/areas - return unique areas from customers
router.get('/areas', async (req, res) => {
  if (await isRelationalReady()) {
    const branchId = req.user?.branchId || null;
    if (!branchId) {
      return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
    }
    const [rows] = await query(
      'SELECT name FROM coverage_areas WHERE branch_id = ?',
      [branchId]
    );
    let names = (rows || []).map(row => row.name).filter(Boolean);
    if (!names.length) {
      const [customerRows] = await query(
        'SELECT DISTINCT area FROM customers WHERE branch_id = ? AND area IS NOT NULL',
        [branchId]
      );
      names = (customerRows || []).map(row => row.area).filter(Boolean);
    }
    names = Array.from(new Set(names));
    names.sort((a, b) => a.localeCompare(b));
    return res.json({ ok: true, areas: names });
  }

  const coverageEntries = await readJson(STORE_KEYS.coverage, []);
  const coverageNames = (coverageEntries || [])
    .map(area => area && (area.name || area.areaName || area.area || area.label))
    .filter(Boolean);
  let names = Array.from(new Set(coverageNames));

  if (!names.length) {
    const customersFallback = await readJson(STORE_KEYS.customers, []);
    names = Array.from(new Set((customersFallback || []).map(c => c.area).filter(Boolean)));
  }

  names.sort((a, b) => a.localeCompare(b));
  res.json({ ok: true, areas: names });
});

// GET /api/collectors/report - aggregated collected amounts per collector per month
router.get('/report', async (req, res) => {
  try {
    if (await isRelationalReady()) {
      const branchId = req.user?.branchId || null;
      if (!branchId) {
        return res.status(400).json({ ok: false, error: 'Branch assignment missing for this admin account.' });
      }

      const accounts = await loadAccounts();
      const collectorIds = new Set(
        (accounts || [])
          .filter((account) => accountHasRole(account, 'Collector') && String(account?.branchId || '') === String(branchId))
          .map((account) => String(account.id || '').trim())
          .filter(Boolean)
      );
      const accountsMap = {};
      for (const account of accounts || []) {
        const accountId = String(account?.id || '').trim();
        if (!accountId) continue;
        if (!collectorIds.has(accountId)) continue;
        accountsMap[accountId] = account;
      }

      const [customerRows] = await query(
        `SELECT
           account_number AS accountNumber,
           area,
           plan_category AS planCategory,
           plan_billing AS planBilling
         FROM customers
         WHERE branch_id = ?`,
        [branchId]
      );
      const accountMeta = {};
      (customerRows || []).forEach((row) => {
        if (isPrepaidCustomer(row)) return;
        const accountNumber = String(row.accountNumber || '').trim();
        if (!accountNumber) return;
        accountMeta[accountNumber] = { area: String(row.area || '').trim() || 'Unassigned' };
      });

      const [paymentRows] = await query(
        `SELECT account_number AS accountNumber, amount, date, recorded_at AS recordedAt, direction, recorded_by_user_id AS recordedByUserId, recorded_by_role AS recordedByRole
         FROM payment_entries WHERE branch_id = ?`,
        [branchId]
      );

      const result = {};
      const areaReport = {};
      const collectorAreaReport = {};
      (paymentRows || []).forEach((row) => {
        const meta = accountMeta[String(row.accountNumber)];
        if (!meta) return;
        if (String(row.direction || '').toLowerCase() !== 'credit') return;
        const dateValue = row.date || row.recordedAt;
        if (!dateValue) return;
        const d = new Date(dateValue);
        if (isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const amount = Number(row.amount || 0);
        const collectorId = String(row.recordedByUserId || '').trim();
        const recordedByRole = String(row.recordedByRole || '').trim().toLowerCase();
        if (!collectorId) return;
        if (recordedByRole !== 'collector' && !collectorIds.has(collectorId)) return;
        result[collectorId] = result[collectorId] || {};
        result[collectorId][key] = (result[collectorId][key] || 0) + amount;

        areaReport[meta.area] = areaReport[meta.area] || { collectorId: collectorId, months: {} };
        areaReport[meta.area].collectorId = collectorId;
        areaReport[meta.area].months[key] = (areaReport[meta.area].months[key] || 0) + amount;

        collectorAreaReport[collectorId] = collectorAreaReport[collectorId] || {};
        collectorAreaReport[collectorId][meta.area] = collectorAreaReport[collectorId][meta.area] || {};
        collectorAreaReport[collectorId][meta.area][key] = (collectorAreaReport[collectorId][meta.area][key] || 0) + amount;
      });

      return res.json({ ok: true, report: result, areaReport, collectorAreaReport, accountsMap });
    }

    const customers = await readJson(STORE_KEYS.customers, []);
    const payments = await readJson(STORE_KEYS.payments, {});
    const accounts = await loadAccounts();
    const collectorIds = new Set(
      (accounts || [])
        .filter((account) => accountHasRole(account, 'Collector'))
        .map((account) => String(account.id || '').trim())
        .filter(Boolean)
    );
    const accountsMap = {};
    for (const account of accounts || []) {
      const accountId = String(account?.id || '').trim();
      if (!accountId) continue;
      if (!collectorIds.has(accountId)) continue;
      accountsMap[accountId] = account;
    }

    // Build mapping accountNumber -> { area }
    const accountMeta = {};
    for (const c of customers) {
      if (isPrepaidCustomer(c)) continue;
      const accountNumber = String(c?.accountNumber || '').trim();
      if (!accountNumber) continue;
      accountMeta[accountNumber] = { area: String(c?.area || '').trim() || 'Unassigned' };
    }

    // collectorId -> { 'YYYY-MM': amount }
    const result = {};
    // area -> { collectorId, months: { 'YYYY-MM': amount } }
    const areaReport = {};
    // collectorId -> area -> { 'YYYY-MM': amount }
    const collectorAreaReport = {};
    for (const [acct, bucket] of Object.entries(payments || {})) {
      const meta = accountMeta[acct];
      if (!meta) continue;
      const area = meta.area;
      for (const h of (bucket.history || [])) {
        // Count only payments (credits) as collected amounts
        if (String(h.direction || '').toLowerCase() !== 'credit') continue;

        const date = h.date || h.recordedAt;
        if (!date) continue;
        const d = new Date(date);
        if (isNaN(d)) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const amount = Number(h.amount || 0);

        const collectorId = String(h?.recordedBy?.id || '').trim();
        const recordedByRole = String(h?.recordedBy?.role || '').trim().toLowerCase();
        if (!collectorId) continue;
        if (recordedByRole !== 'collector' && !collectorIds.has(collectorId)) continue;

        result[collectorId] = result[collectorId] || {};
        result[collectorId][key] = (result[collectorId][key] || 0) + amount;

        areaReport[area] = areaReport[area] || { collectorId, months: {} };
        areaReport[area].collectorId = collectorId;
        areaReport[area].months[key] = (areaReport[area].months[key] || 0) + amount;

        collectorAreaReport[collectorId] = collectorAreaReport[collectorId] || {};
        collectorAreaReport[collectorId][area] = collectorAreaReport[collectorId][area] || {};
        collectorAreaReport[collectorId][area][key] = (collectorAreaReport[collectorId][area][key] || 0) + amount;
      }
    }

    // result is already in the shape { collectorId: { 'YYYY-MM': amount } }
    res.json({ ok: true, report: result, areaReport, collectorAreaReport, accountsMap });
  } catch (e) {
    console.error('collector report failed', e);
    res.status(500).json({ ok: false, error: 'failed to generate report' });
  }
});

module.exports = router;
