const express = require('express');
const createError = require('http-errors');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { accountHasRole } = require('./role-utils');

const router = express.Router();
const STORE_KEY_PREFIX = 'finance_expenses_branch_';
const legacyImportByBranch = new Map();

const toSafeText = (value, maxLen = 0) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    if (maxLen > 0) return text.slice(0, maxLen);
    return text;
};

const normalizeDateOnly = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const normalizeAmount = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Number(amount.toFixed(2));
};

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

const toIsoDateTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) return raw;
    return parsed.toISOString();
};

const resolveBranchId = (req) => {
    const branchId = Number(req.user?.branchId || 0);
    return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
};

const buildStoreKey = (branchId) => `${STORE_KEY_PREFIX}${branchId}`;

const mapExpenseRow = (row = {}) => ({
    id: toSafeText(row.id, 80),
    date: normalizeDateOnly(row.expense_date || row.date),
    category: toSafeText(row.category, 80),
    payee: toSafeText(row.payee, 120),
    description: toSafeText(row.description, 400),
    amount: normalizeAmount(row.amount) || 0,
    createdAt: toIsoDateTime(row.created_at || row.createdAt),
    updatedAt: toIsoDateTime(row.updated_at || row.updatedAt),
    createdBy: toSafeText(row.created_by_username || row.createdBy, 100)
});

const upsertLegacyExpense = async (branchId, source = {}) => {
    const date = normalizeDateOnly(source?.date);
    const category = toSafeText(source?.category, 80);
    const amount = normalizeAmount(source?.amount);
    if (!date || !category || amount == null || amount <= 0) return;

    const payee = toSafeText(source?.payee, 120);
    const description = toSafeText(source?.description, 400);
    const id = toSafeText(source?.id, 80) || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = toMysqlDateTime(source?.createdAt || source?.created_at, { fallbackToNow: true });
    const updatedAt = toMysqlDateTime(source?.updatedAt || source?.updated_at || source?.createdAt || source?.created_at, { fallbackToNow: true });
    const createdByUserId = source?.createdByUserId != null ? String(source.createdByUserId).trim() : null;
    const createdByUsername = toSafeText(source?.createdBy || source?.createdByUsername || source?.created_by_username, 100) || null;
    const createdByName = toSafeText(source?.createdByName || source?.created_by_name, 120) || null;

    await query(
        `INSERT INTO finance_expenses (
            id, branch_id, expense_date, category, payee, description, amount,
            created_at, updated_at, created_by_user_id, created_by_username, created_by_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            expense_date = VALUES(expense_date),
            category = VALUES(category),
            payee = VALUES(payee),
            description = VALUES(description),
            amount = VALUES(amount),
            updated_at = VALUES(updated_at),
            created_by_user_id = VALUES(created_by_user_id),
            created_by_username = VALUES(created_by_username),
            created_by_name = VALUES(created_by_name)`,
        [
            id,
            branchId,
            date,
            category,
            payee || null,
            description || null,
            amount,
            createdAt,
            updatedAt,
            createdByUserId || null,
            createdByUsername,
            createdByName
        ]
    );
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
    const items = Array.isArray(parsed) ? parsed.map((item) => mapExpenseRow(item)) : [];
    return sortByDateDesc(items);
};

const writeExpenseItems = async (branchId, items = []) => {
    const normalized = Array.isArray(items) ? items.map((item) => mapExpenseRow(item)) : [];
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
            `SELECT
                id,
                expense_date,
                category,
                payee,
                description,
                amount,
                created_at,
                updated_at,
                created_by_user_id,
                created_by_username,
                created_by_name
             FROM finance_expenses
             WHERE branch_id = ?
             ORDER BY expense_date DESC, updated_at DESC, id DESC`,
            [req.branchId]
        );
        const items = Array.isArray(rows) ? rows.map((row) => mapExpenseRow(row)) : [];
        return res.json({ ok: true, items: sortByDateDesc(items) });
    } catch (error) {
        return next(error);
    }
});

router.post('/', async (req, res, next) => {
    try {
        const date = normalizeDateOnly(req.body?.date);
        const category = toSafeText(req.body?.category, 80);
        const payee = toSafeText(req.body?.payee, 120);
        const description = toSafeText(req.body?.description, 400);
        const amount = normalizeAmount(req.body?.amount);

        if (!date) return next(createError(400, 'Date is required.'));
        if (!category) return next(createError(400, 'Category is required.'));
        if (amount == null || amount <= 0) return next(createError(400, 'Amount must be greater than zero.'));

        const nowIso = new Date().toISOString();
        const nowSql = toMysqlDateTime(nowIso, { fallbackToNow: true });
        const entry = {
            id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            date,
            category,
            payee,
            description,
            amount,
            createdAt: nowIso,
            updatedAt: nowIso,
            createdBy: req.user?.username || req.user?.name || String(req.user?.id || 'admin')
        };

        if (!await isRelationalReady()) {
            const items = await readExpenseItems(req.branchId);
            items.unshift(entry);
            await writeExpenseItems(req.branchId, items);
            return res.status(201).json({ ok: true, item: entry });
        }

        await query(
            `INSERT INTO finance_expenses (
                id, branch_id, expense_date, category, payee, description, amount,
                created_at, updated_at, created_by_user_id, created_by_username, created_by_name
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                req.branchId,
                entry.date,
                entry.category,
                entry.payee || null,
                entry.description || null,
                entry.amount,
                nowSql,
                nowSql,
                req.user?.id != null ? String(req.user.id) : null,
                req.user?.username ? String(req.user.username) : null,
                req.user?.name ? String(req.user.name) : null
            ]
        );

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

            const current = items[index];
            const date = normalizeDateOnly(req.body?.date || current.date);
            const category = toSafeText(req.body?.category ?? current.category, 80);
            const payee = toSafeText(req.body?.payee ?? current.payee, 120);
            const description = toSafeText(req.body?.description ?? current.description, 400);
            const amount = normalizeAmount(req.body?.amount ?? current.amount);

            if (!date) return next(createError(400, 'Date is required.'));
            if (!category) return next(createError(400, 'Category is required.'));
            if (amount == null || amount <= 0) return next(createError(400, 'Amount must be greater than zero.'));

            const updated = {
                ...current,
                date,
                category,
                payee,
                description,
                amount,
                updatedAt: new Date().toISOString()
            };
            items[index] = updated;
            await writeExpenseItems(req.branchId, items);
            return res.json({ ok: true, item: updated });
        }

        const [rows] = await query(
            `SELECT id, expense_date, category, payee, description, amount, created_at, updated_at, created_by_username
             FROM finance_expenses
             WHERE id = ? AND branch_id = ?
             LIMIT 1`,
            [entryId, req.branchId]
        );
        if (!rows || !rows.length) return next(createError(404, 'Expense entry not found.'));

        const current = mapExpenseRow(rows[0]);
        const date = normalizeDateOnly(req.body?.date || current.date);
        const category = toSafeText(req.body?.category ?? current.category, 80);
        const payee = toSafeText(req.body?.payee ?? current.payee, 120);
        const description = toSafeText(req.body?.description ?? current.description, 400);
        const amount = normalizeAmount(req.body?.amount ?? current.amount);

        if (!date) return next(createError(400, 'Date is required.'));
        if (!category) return next(createError(400, 'Category is required.'));
        if (amount == null || amount <= 0) return next(createError(400, 'Amount must be greater than zero.'));

        const updated = {
            ...current,
            date,
            category,
            payee,
            description,
            amount,
            updatedAt: new Date().toISOString()
        };
        await query(
            `UPDATE finance_expenses
             SET expense_date = ?,
                 category = ?,
                 payee = ?,
                 description = ?,
                 amount = ?,
                 updated_at = ?
             WHERE id = ? AND branch_id = ?`,
            [
                updated.date,
                updated.category,
                updated.payee || null,
                updated.description || null,
                updated.amount,
                toMysqlDateTime(updated.updatedAt, { fallbackToNow: true }),
                entryId,
                req.branchId
            ]
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
