const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('../../../../core/data/data-store');
const { query } = require('../../../../core/data/db');
const { isRelationalReady } = require('../../../../core/data/db-relational');
const { accountHasRole } = require('../../../../core/security/role-utils');
const {
    toSafeText,
    mapExpenseRecord,
    buildExpenseRecord
} = require('./expense-record');

const router = express.Router();
const STORE_KEY_PREFIX = 'finance_expenses_branch_';
const legacyImportByBranch = new Map();
const EXPENSE_DB_COLUMNS = [
    'id',
    'branch_id',
    'expense_date',
    'category',
    'vendor',
    'payee',
    'description',
    'amount',
    'payment_method',
    'reference_number',
    'receipt_url',
    'receipt_name',
    'status',
    'created_at',
    'updated_at',
    'approved_at',
    'created_by_user_id',
    'created_by_username',
    'created_by_name',
    'updated_by_user_id',
    'updated_by_username',
    'updated_by_name',
    'approved_by_user_id',
    'approved_by_username',
    'approved_by_name'
];
const EXPENSE_SELECT_COLUMNS = EXPENSE_DB_COLUMNS.join(', ');

const toMysqlDateTime = (value, { fallbackToNow = false } = {}) => {
    const raw = String(value || '').trim();
    if (!raw) {
        if (!fallbackToNow) return null;
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) {
        if (!fallbackToNow) return null;
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    return parsed.toISOString().slice(0, 19).replace('T', ' ');
};

const nullable = (value) => {
    const text = String(value == null ? '' : value).trim();
    return text || null;
};

const resolveBranchId = (req) => {
    const branchId = Number(req.user?.branchId || 0);
    return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
};

const buildStoreKey = (branchId) => `${STORE_KEY_PREFIX}${branchId}`;

const mapExpenseRow = (row = {}, branchId = null) => mapExpenseRecord(row, { branchId });

const expenseDbValues = (record) => [
    record.id,
    record.branchId,
    record.date,
    record.category,
    nullable(record.vendor),
    nullable(record.payee),
    nullable(record.description),
    record.amount,
    record.paymentMethod,
    nullable(record.referenceNumber),
    nullable(record.receiptUrl),
    nullable(record.receiptName),
    record.status,
    toMysqlDateTime(record.createdAt, { fallbackToNow: true }),
    toMysqlDateTime(record.updatedAt, { fallbackToNow: true }),
    toMysqlDateTime(record.approvedAt),
    nullable(record.createdByUserId),
    nullable(record.createdBy),
    nullable(record.createdByName),
    nullable(record.updatedByUserId),
    nullable(record.updatedBy),
    nullable(record.updatedByName),
    nullable(record.approvedByUserId),
    nullable(record.approvedBy),
    nullable(record.approvedByName)
];

const insertExpenseRecord = async (record, { upsert = false } = {}) => {
    const placeholders = EXPENSE_DB_COLUMNS.map(() => '?').join(', ');
    const updateClause = EXPENSE_DB_COLUMNS
        .slice(2)
        .map((column) => `${column} = VALUES(${column})`)
        .join(', ');
    const sql = `INSERT INTO finance_expenses (${EXPENSE_SELECT_COLUMNS})
        VALUES (${placeholders})${upsert ? ` ON DUPLICATE KEY UPDATE ${updateClause}` : ''}`;
    await query(sql, expenseDbValues(record));
};

const upsertLegacyExpense = async (branchId, source = {}) => {
    const now = new Date().toISOString();
    const mapped = mapExpenseRow(source, branchId);
    if (!mapped.date || !mapped.category || mapped.amount <= 0) return;

    const record = {
        ...mapped,
        id: mapped.id || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        branchId,
        createdAt: mapped.createdAt || now,
        updatedAt: mapped.updatedAt || mapped.createdAt || now
    };
    await insertExpenseRecord(record, { upsert: true });
};

const ensureLegacyExpensesImported = async (branchId) => {
    if (!branchId) return;
    if (!await isRelationalReady()) return;
    if (legacyImportByBranch.has(branchId)) {
        return legacyImportByBranch.get(branchId);
    }

    const promise = (async () => {
        const [countRows] = await query(
            'SELECT COUNT(*) AS total FROM finance_expenses WHERE branch_id = ?',
            [branchId]
        );
        const existingTotal = Number(countRows?.[0]?.total || 0);
        if (existingTotal > 0) return;

        const storeKey = buildStoreKey(branchId);
        const legacyItems = await readJson(storeKey, []);
        const list = Array.isArray(legacyItems) ? legacyItems : [];
        for (const item of list) {
            await upsertLegacyExpense(branchId, item);
        }
    })();

    legacyImportByBranch.set(branchId, promise);
    try {
        await promise;
    } catch (error) {
        legacyImportByBranch.delete(branchId);
        throw error;
    }
};

const sortByDateDesc = (rows = []) =>
    rows.slice().sort((left, right) => {
        const leftTs = new Date(left?.date || left?.updatedAt || left?.createdAt || 0).getTime();
        const rightTs = new Date(right?.date || right?.updatedAt || right?.createdAt || 0).getTime();
        return rightTs - leftTs;
    });

const readExpenseItems = async (branchId) => {
    const parsed = await readJson(buildStoreKey(branchId), []);
    const items = Array.isArray(parsed) ? parsed.map((item) => mapExpenseRow(item, branchId)) : [];
    return sortByDateDesc(items);
};

const writeExpenseItems = async (branchId, items = []) => {
    const normalized = Array.isArray(items)
        ? items.map((item) => mapExpenseRow(item, branchId))
        : [];
    await writeJson(buildStoreKey(branchId), sortByDateDesc(normalized));
};

router.use((req, _res, next) => {
    if (!accountHasRole(req.user, 'Admin')) {
        return next(createError(403, 'Admin access required.'));
    }
    const branchId = resolveBranchId(req);
    if (!branchId) {
        return next(createError(400, 'Branch assignment missing for this admin account.'));
    }
    req.branchId = branchId;
    return ensureLegacyExpensesImported(branchId)
        .then(() => next())
        .catch(next);
});

router.get('/', async (req, res, next) => {
    try {
        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            return res.json({ ok: true, items });
        }

        const [rows] = await query(
            `SELECT ${EXPENSE_SELECT_COLUMNS}
             FROM finance_expenses
             WHERE branch_id = ?
             ORDER BY expense_date DESC, updated_at DESC, id DESC`,
            [req.branchId]
        );
        const items = Array.isArray(rows)
            ? rows.map((row) => mapExpenseRow(row, req.branchId))
            : [];
        return res.json({ ok: true, items: sortByDateDesc(items) });
    } catch (error) {
        return next(error);
    }
});

router.post('/', async (req, res, next) => {
    try {
        const now = new Date().toISOString();
        const entry = buildExpenseRecord({
            id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            branchId: req.branchId,
            input: req.body,
            actor: req.user,
            now
        });

        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            items.unshift(entry);
            await writeExpenseItems(req.branchId, items);
            return res.status(201).json({ ok: true, item: entry });
        }

        await insertExpenseRecord(entry);
        return res.status(201).json({ ok: true, item: entry });
    } catch (error) {
        return next(error);
    }
});

router.put('/:id', async (req, res, next) => {
    try {
        const entryId = toSafeText(req.params?.id, 80);
        if (!entryId) return next(createError(400, 'Expense ID is required.'));

        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            const index = items.findIndex((item) => String(item?.id || '') === entryId);
            if (index < 0) return next(createError(404, 'Expense entry not found.'));

            const updated = buildExpenseRecord({
                id: entryId,
                branchId: req.branchId,
                input: req.body,
                current: items[index],
                actor: req.user
            });
            items[index] = updated;
            await writeExpenseItems(req.branchId, items);
            return res.json({ ok: true, item: updated });
        }

        const [rows] = await query(
            `SELECT ${EXPENSE_SELECT_COLUMNS}
             FROM finance_expenses
             WHERE id = ? AND branch_id = ?
             LIMIT 1`,
            [entryId, req.branchId]
        );
        if (!rows || !rows.length) return next(createError(404, 'Expense entry not found.'));

        const current = mapExpenseRow(rows[0], req.branchId);
        const updated = buildExpenseRecord({
            id: entryId,
            branchId: req.branchId,
            input: req.body,
            current,
            actor: req.user
        });
        const updateColumns = EXPENSE_DB_COLUMNS.slice(2);
        await query(
            `UPDATE finance_expenses
             SET ${updateColumns.map((column) => `${column} = ?`).join(', ')}
             WHERE id = ? AND branch_id = ?`,
            [...expenseDbValues(updated).slice(2), entryId, req.branchId]
        );

        return res.json({ ok: true, item: updated });
    } catch (error) {
        return next(error);
    }
});

router.delete('/', async (req, res, next) => {
    try {
        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            await writeExpenseItems(req.branchId, []);
            return res.json({ ok: true, deletedCount: items.length });
        }

        const [result] = await query(
            'DELETE FROM finance_expenses WHERE branch_id = ?',
            [req.branchId]
        );
        return res.json({ ok: true, deletedCount: Number(result?.affectedRows || 0) });
    } catch (error) {
        return next(error);
    }
});

router.delete('/:id', async (req, res, next) => {
    try {
        const entryId = toSafeText(req.params?.id, 80);
        if (!entryId) return next(createError(400, 'Expense ID is required.'));

        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            const index = items.findIndex((item) => String(item?.id || '') === entryId);
            if (index < 0) return next(createError(404, 'Expense entry not found.'));
            items.splice(index, 1);
            await writeExpenseItems(req.branchId, items);
            return res.json({ ok: true });
        }

        const [result] = await query(
            'DELETE FROM finance_expenses WHERE id = ? AND branch_id = ?',
            [entryId, req.branchId]
        );
        if (!result || Number(result.affectedRows || 0) === 0) {
            return next(createError(404, 'Expense entry not found.'));
        }
        return res.json({ ok: true });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
