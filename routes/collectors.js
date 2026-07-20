const express = require("express");
const router = express.Router();
const db = require("../db"); // mysql2/promise pool or wrapper

// GET /api/collectors
router.get("/collectors", async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM collectors ORDER BY name ASC"
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/areas (coverage_areas)
router.get("/areas", async (req, res, next) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM coverage_areas ORDER BY name ASC"
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/collector-areas (current assignment list)
router.get("/collector-areas", async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT ca.id,
             ca.area_id   AS areaId,
             a.name       AS areaName,
             ca.collector_id AS collectorId,
             c.name       AS collectorName,
             'active'     AS status
      FROM collector_areas ca
      JOIN coverage_areas a ON a.id = ca.area_id
      LEFT JOIN collectors c ON c.id = ca.collector_id
      ORDER BY a.name ASC
    `);
    res.json({ assignments: rows });
  } catch (e) { next(e); }
});

// POST /api/collector-areas { areaId, collectorId }
router.post("/collector-areas", async (req, res, next) => {
  try {
    const { areaId, collectorId } = req.body || {};
    if (!areaId || !collectorId) {
      return res.status(400).json({ error: "areaId and collectorId are required" });
    }
    // One collector per area. If unique by area_id, use upsert.
    await db.query(
      `INSERT INTO collector_areas (area_id, collector_id, assigned_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE collector_id = VALUES(collector_id), assigned_at = VALUES(assigned_at)`,
      [areaId, collectorId]
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/reports/collector-monthly?year=2025&month=11
router.get("/reports/collector-monthly", async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    if (!year || !month) return res.status(400).json({ error: "year & month required" });

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end   = new Date(Date.UTC(year, month, 1));

    // Prefer payments.collector_id if existing; else compute via current area assignments
    // -- A: direct by payments.collector_id
    const [hasCollectorId] = await db.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME='collector_id'
      LIMIT 1
    `);

    let rows, areasCount;
    if (hasCollectorId.length) {
      // Per-collector totals this month
      [rows] = await db.query(`
        SELECT c.id AS collectorId, c.name AS collectorName, 
               COALESCE(SUM(p.amount), 0) AS total
        FROM collectors c
        LEFT JOIN payments p 
          ON p.collector_id = c.id
         AND p.status = 'paid'
         AND p.paid_at >= ? AND p.paid_at < ?
        GROUP BY c.id, c.name
        ORDER BY total DESC, c.name ASC
      `, [start, end]);
    } else {
      // Fallback: sum by current area assignment (customers -> area -> collector)
      [rows] = await db.query(`
        SELECT ca.collector_id AS collectorId, c.name AS collectorName,
               COALESCE(SUM(p.amount), 0) AS total
        FROM collector_areas ca
        JOIN collectors c ON c.id = ca.collector_id
        JOIN customers u ON u.area_id = ca.area_id
        JOIN payments p ON p.customer_id = u.id
        WHERE p.status = 'paid'
          AND p.paid_at >= ? AND p.paid_at < ?
        GROUP BY ca.collector_id, c.name
        ORDER BY total DESC, c.name ASC
      `, [start, end]);
    }

    // Areas assigned per collector (for table's "Areas" column)
    ;[areasCount] = await db.query(`
      SELECT ca.collector_id AS collectorId, COUNT(*) AS areasAssigned
      FROM collector_areas ca
      GROUP BY ca.collector_id
    `);

    const mapAreas = Object.fromEntries(areasCount.map(r => [r.collectorId, r.areasAssigned]));
    const totals = rows.map(r => ({
      collectorId: r.collectorId,
      collectorName: r.collectorName,
      total: Number(r.total || 0),
      areasAssigned: mapAreas[r.collectorId] || 0,
    }));

    const monthLabel = new Date(year, month - 1, 1)
      .toLocaleDateString("en-PH", { month: "long", year: "numeric" });

    res.json({ monthLabel, totals });
  } catch (e) { next(e); }
});

module.exports = router;
