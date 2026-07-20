const express = require('express');
const { readJson, writeJson } = require('./data-store');
const { requireAuth } = require('./auth');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');

const router = express.Router();
const STORE_KEY = 'coverage';
let coverageMikrotikIdColumnChecked = false;
let coverageMikrotikIdColumnAvailable = false;

const normalizeAreaName = (value) => String(value || '').trim().toLowerCase();
const normalizeRouterId = (value) => String(value || '').trim();
const getAreaName = (area) => area?.name || area?.areaName || '';
const getAreaRouterId = (area) => normalizeRouterId(area?.mikrotikId || area?.routerId);
const isForeignKeyConstraintError = (error) => {
    const code = String(error?.code || '').toUpperCase();
    return code === 'ER_ROW_IS_REFERENCED' || code === 'ER_ROW_IS_REFERENCED_2';
};

const hasCoverageMikrotikIdColumn = async () => {
    if (coverageMikrotikIdColumnChecked) return coverageMikrotikIdColumnAvailable;
    const [rows] = await query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'coverage_areas'
           AND column_name = 'mikrotik_id'
         LIMIT 1`
    );
    coverageMikrotikIdColumnAvailable = Boolean(rows && rows.length);
    coverageMikrotikIdColumnChecked = true;
    return coverageMikrotikIdColumnAvailable;
};

const ensureCoverageMikrotikIdColumn = async () => {
    if (await hasCoverageMikrotikIdColumn()) return true;
    await query(
        'ALTER TABLE coverage_areas ADD COLUMN mikrotik_id VARCHAR(120) NULL AFTER area_code'
    );
    coverageMikrotikIdColumnAvailable = true;
    coverageMikrotikIdColumnChecked = true;
    return true;
};

// Helper function to read coverage areas from the JSON file
const readCoverage = async (branchId = null) => {
    if (await isRelationalReady()) {
        if (!branchId) return [];
        const selectColumns = [
            'id',
            'name',
            'category',
            'lat',
            'lng',
            'status',
            'notes',
            'area_code AS areaCode'
        ];
        if (await hasCoverageMikrotikIdColumn()) {
            selectColumns.push('mikrotik_id AS mikrotikId');
        }
        selectColumns.push('created_at AS created', 'updated_at AS updated');
        const [rows] = await query(
            `SELECT ${selectColumns.join(', ')} FROM coverage_areas WHERE branch_id = ? ORDER BY id DESC`,
            [branchId]
        );
        return rows || [];
    }
    const coverageAreas = await readJson(STORE_KEY, []);
    return (Array.isArray(coverageAreas) ? coverageAreas : []).map((area) => ({
        ...area,
        mikrotikId: getAreaRouterId(area)
    }));
};

const writeCoverage = async (coverageAreas) => writeJson(STORE_KEY, coverageAreas);

/**
 * @route   GET /api/coverage
 * @desc    Get all coverage areas
 */
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const coverageAreas = await readCoverage(req.user?.branchId || null);
        res.json(coverageAreas);
    } catch (error) {
        next(error);
    }
});

/**
 * @route   POST /api/coverage
 * @desc    Add a new coverage area
 */
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const branchId = req.user?.branchId;
        const coverageAreas = await readCoverage(branchId);
        const { name, category, lat, lng, status, notes, created, areaCode } = req.body;
        const mikrotikId = getAreaRouterId(req.body);

        if (!name) {
            return res.status(400).json({ msg: 'Please include a name' });
        }

        const cleanName = String(name).trim();
        const normalizedName = normalizeAreaName(cleanName);
        const duplicate = coverageAreas.some(area => normalizeAreaName(getAreaName(area)) === normalizedName);
        if (duplicate) {
            return res.status(409).json({ msg: 'Coverage area name must be unique' });
        }

        const newArea = {
            name: cleanName,
            areaCode: areaCode ? String(areaCode).trim() : '',
            mikrotikId,
            category,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            status: status || 'Active',
            notes,
            created: created || new Date().toISOString().slice(0, 10),
            updated: new Date().toISOString().slice(0, 16).replace('T', ' ')
        };
        if (await isRelationalReady()) {
            if (newArea.mikrotikId) {
                await ensureCoverageMikrotikIdColumn();
            }
            const supportsMikrotikId = await hasCoverageMikrotikIdColumn();
            const insertColumns = [
                'branch_id',
                'name',
                'category',
                'lat',
                'lng',
                'status',
                'notes',
                'area_code'
            ];
            const insertValues = [
                branchId,
                newArea.name,
                newArea.category || null,
                newArea.lat,
                newArea.lng,
                newArea.status || 'Active',
                newArea.notes || null,
                newArea.areaCode || ''
            ];
            if (supportsMikrotikId) {
                insertColumns.push('mikrotik_id');
                insertValues.push(newArea.mikrotikId || null);
            }
            insertColumns.push('created_at', 'updated_at');
            insertValues.push(
                newArea.created ? `${newArea.created} 00:00:00` : null,
                newArea.updated ? newArea.updated.replace('T', ' ') : null
            );
            const [result] = await query(
                `INSERT INTO coverage_areas (${insertColumns.join(', ')})
                 VALUES (${insertColumns.map(() => '?').join(', ')})`,
                insertValues
            );
            newArea.id = result.insertId;
            return res.status(201).json(newArea);
        }
        coverageAreas.unshift({ id: coverageAreas.reduce((maxId, area) => Math.max(area.id || 0, maxId), 0) + 1, ...newArea });
        await writeCoverage(coverageAreas);
        res.status(201).json(newArea);
    } catch (error) {
        next(error);
    }
});

/**
 * @route   PUT /api/coverage/:id
 * @desc    Update a coverage area
 */
router.put('/:id', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, category, lat, lng, status, notes, areaCode } = req.body;
        const requestedMikrotikId = Object.prototype.hasOwnProperty.call(req.body || {}, 'mikrotikId')
            || Object.prototype.hasOwnProperty.call(req.body || {}, 'routerId');
        const mikrotikId = requestedMikrotikId ? getAreaRouterId(req.body) : undefined;
        if (await isRelationalReady()) {
            const branchId = req.user?.branchId;
            if (mikrotikId) {
                await ensureCoverageMikrotikIdColumn();
            }
            const supportsMikrotikId = await hasCoverageMikrotikIdColumn();
            const selectColumns = [
                'id',
                'name',
                'category',
                'lat',
                'lng',
                'status',
                'notes',
                'area_code AS areaCode',
                'created_at AS created'
            ];
            if (supportsMikrotikId) {
                selectColumns.push('mikrotik_id AS mikrotikId');
            }
            const [existingRows] = await query(
                `SELECT ${selectColumns.join(', ')} FROM coverage_areas WHERE id = ? AND branch_id = ? LIMIT 1`,
                [id, branchId]
            );
            if (!existingRows.length) {
                return res.status(404).json({ msg: `Coverage area with id ${id} not found` });
            }
            const area = existingRows[0];
            const candidateName = (name !== undefined && name !== null) ? String(name).trim() : area.name;
            if (candidateName) {
                const normalizedCandidate = normalizeAreaName(candidateName);
                const [dups] = await query(
                    'SELECT id FROM coverage_areas WHERE branch_id = ? AND LOWER(name) = ? AND id <> ?',
                    [branchId, normalizedCandidate, id]
                );
                if (dups.length) {
                    return res.status(409).json({ msg: 'Coverage area name must be unique' });
                }
            }
            const updated = {
                name: candidateName || area.name,
                category: category || area.category,
                areaCode: areaCode !== undefined ? String(areaCode || '').trim() : (area.areaCode || ''),
                mikrotikId: requestedMikrotikId
                    ? mikrotikId
                    : getAreaRouterId(area),
                lat: lat ? parseFloat(lat) : area.lat,
                lng: lng ? parseFloat(lng) : area.lng,
                status: status || area.status,
                notes: notes || area.notes,
                updated: new Date().toISOString().slice(0, 19).replace('T', ' ')
            };
            const updateAssignments = [
                'name = ?',
                'category = ?',
                'lat = ?',
                'lng = ?',
                'status = ?',
                'notes = ?',
                'area_code = ?'
            ];
            const updateValues = [
                updated.name,
                updated.category,
                updated.lat,
                updated.lng,
                updated.status,
                updated.notes,
                updated.areaCode
            ];
            if (supportsMikrotikId) {
                updateAssignments.push('mikrotik_id = ?');
                updateValues.push(updated.mikrotikId || null);
            }
            updateAssignments.push('updated_at = ?');
            updateValues.push(updated.updated, id, branchId);
            await query(
                `UPDATE coverage_areas
                 SET ${updateAssignments.join(', ')}
                 WHERE id = ? AND branch_id = ?`,
                updateValues
            );
            return res.json({ id: Number(id), ...updated });
        }
        let coverageAreas = await readCoverage();
        const areaIndex = coverageAreas.findIndex(a => a.id === parseInt(id));

        if (areaIndex === -1) {
            return res.status(404).json({ msg: `Coverage area with id ${id} not found` });
        }

        const area = coverageAreas[areaIndex];
        const candidateName = (name !== undefined && name !== null) ? String(name).trim() : area.name;
        if (candidateName) {
            const normalizedCandidate = normalizeAreaName(candidateName);
            const duplicate = coverageAreas.some(a =>
                a.id !== area.id && normalizeAreaName(getAreaName(a)) === normalizedCandidate
            );
            if (duplicate) {
                return res.status(409).json({ msg: 'Coverage area name must be unique' });
            }
        }

        area.name = candidateName || area.name;
        area.category = category || area.category;
        if (areaCode !== undefined) {
            area.areaCode = String(areaCode || '').trim();
        }
        if (requestedMikrotikId) {
            area.mikrotikId = mikrotikId;
        } else if (area.mikrotikId === undefined) {
            area.mikrotikId = getAreaRouterId(area);
        }
        area.lat = lat ? parseFloat(lat) : area.lat;
        area.lng = lng ? parseFloat(lng) : area.lng;
        area.status = status || area.status;
        area.notes = notes || area.notes;
        if (!area.created) {
            area.created = new Date().toISOString().slice(0, 10);
        }
        area.updated = new Date().toISOString().slice(0, 16).replace('T', ' ');

        if (area.areaCode === undefined) {
            area.areaCode = '';
        }

        await writeCoverage(coverageAreas);
        res.json(area);
    } catch (error) {
        if (isForeignKeyConstraintError(error)) {
            return res.status(409).json({
                msg: 'Coverage area is still linked to other records. Remove or reassign those links first.'
            });
        }
        next(error);
    }
});

/**
 * @route   DELETE /api/coverage/:id
 * @desc    Delete a coverage area
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        if (await isRelationalReady()) {
            const branchId = req.user?.branchId;
            const [existingRows] = await query(
                'SELECT id FROM coverage_areas WHERE id = ? AND branch_id = ? LIMIT 1',
                [id, branchId]
            );
            if (!existingRows.length) {
                return res.status(404).json({ msg: `Coverage area with id ${id} not found` });
            }
            await query(
                'UPDATE collector_assignments SET coverage_id = NULL WHERE coverage_id = ?',
                [id]
            );
            const [result] = await query('DELETE FROM coverage_areas WHERE id = ? AND branch_id = ?', [id, branchId]);
            if (!result.affectedRows) {
                return res.status(404).json({ msg: `Coverage area with id ${id} not found` });
            }
            return res.json({ msg: `Coverage area with id ${id} deleted`, id });
        }
        let coverageAreas = await readCoverage();
        const initialLength = coverageAreas.length;
        coverageAreas = coverageAreas.filter(area => area.id !== parseInt(id));

        if (coverageAreas.length === initialLength) {
            return res.status(404).json({ msg: `Coverage area with id ${id} not found` });
        }

        await writeCoverage(coverageAreas);
        res.json({ msg: `Coverage area with id ${id} deleted`, id });
    } catch (error) {
        if (isForeignKeyConstraintError(error)) {
            return res.status(409).json({
                msg: 'Coverage area is still linked to other records. Remove or reassign those links first.'
            });
        }
        next(error);
    }
});

module.exports = router;
module.exports.readCoverage = readCoverage;
