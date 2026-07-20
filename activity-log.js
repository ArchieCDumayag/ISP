const crypto = require('crypto');
const { readJson, writeJson } = require('./data-store');
const { query } = require('./db');
const { isRelationalReady } = require('./db-relational');
const { shouldHideActivityLogEntry } = require('./activity-log-visibility');

const STORE_KEY = 'activity-log';
const MAX_LOG_ITEMS = 200;
const LOAD_LOG_SCAN_LIMIT = MAX_LOG_ITEMS * 4;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MANILA_OFFSET_SUFFIX = '+08:00';
const SQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_DATETIME_NO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const pad2 = (value) => String(value).padStart(2, '0');

const parseTimestamp = (value) => {
    if (!value && value !== 0) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (SQL_DATETIME_RE.test(raw)) {
        const parsed = new Date(raw.replace(' ', 'T') + MANILA_OFFSET_SUFFIX);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (ISO_DATETIME_NO_TZ_RE.test(raw)) {
        const parsed = new Date(`${raw}${MANILA_OFFSET_SUFFIX}`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoTimestamp = (value, fallback = new Date().toISOString()) => {
    const parsed = parseTimestamp(value);
    return parsed ? parsed.toISOString() : fallback;
};

const toStoredTimestamp = (value) => {
    const parsed = parseTimestamp(value);
    if (!parsed) return null;
    const manilaTime = new Date(parsed.getTime() + MANILA_OFFSET_MS);
    return `${manilaTime.getUTCFullYear()}-${pad2(manilaTime.getUTCMonth() + 1)}-${pad2(manilaTime.getUTCDate())} ${pad2(manilaTime.getUTCHours())}:${pad2(manilaTime.getUTCMinutes())}:${pad2(manilaTime.getUTCSeconds())}`;
};

const getDefaultBranchId = async () => {
    const [rows] = await query('SELECT id FROM branches ORDER BY id LIMIT 1');
    return rows && rows.length ? rows[0].id : null;
};

const resolveBranchId = async (branchId, userId) => {
    if (branchId) return branchId;
    if (userId) {
        const [rows] = await query('SELECT branch_id FROM users WHERE id = ? LIMIT 1', [String(userId)]);
        if (rows && rows.length) return rows[0].branch_id;
    }
    return getDefaultBranchId();
};

const readLogEntries = async (branchId = null) => {
    try {
        if (await isRelationalReady()) {
            const resolvedBranch = await resolveBranchId(branchId);
            if (!resolvedBranch) return [];
            const [rows] = await query(
                `SELECT id, message, meta, timestamp, user_id, username
                 FROM activity_logs
                 WHERE branch_id = ?
                 ORDER BY timestamp DESC
                 LIMIT ?`,
                [resolvedBranch, LOAD_LOG_SCAN_LIMIT]
            );
            return (rows || [])
                .map((row) => ({
                    id: row.id,
                    message: row.message,
                    meta: row.meta || '',
                    timestamp: toIsoTimestamp(row.timestamp),
                    userId: row.user_id ? String(row.user_id) : undefined,
                    username: row.username || undefined
                }))
                .filter((entry) => !shouldHideActivityLogEntry(entry))
                .slice(0, MAX_LOG_ITEMS);
        }
        const parsed = await readJson(STORE_KEY, { logs: [] });
        const logs = Array.isArray(parsed?.logs) ? parsed.logs : [];
        return logs
            .filter((entry) => entry && typeof entry.message === 'string')
            .map((entry) => ({
                id: entry.id || crypto.randomBytes(8).toString('hex'),
                message: entry.message,
                meta: entry.meta || '',
                timestamp: entry.timestamp || new Date().toISOString(),
                userId: entry.userId ? String(entry.userId) : undefined,
                username: entry.username || undefined
            }))
            .filter((entry) => !shouldHideActivityLogEntry(entry))
            .slice(0, MAX_LOG_ITEMS);
    } catch (e) {
        console.warn('Failed to read activity log:', e.message);
        return [];
    }
};

const writeLogEntries = async (logs, branchId = null) => {
    try {
        const visibleLogs = (Array.isArray(logs) ? logs : []).filter((entry) => !shouldHideActivityLogEntry(entry));
        if (await isRelationalReady()) {
            const resolvedBranch = await resolveBranchId(branchId);
            if (!resolvedBranch) return;
            await query('DELETE FROM activity_logs WHERE branch_id = ?', [resolvedBranch]);
            for (const entry of visibleLogs) {
                await query(
                    `INSERT INTO activity_logs (id, branch_id, message, meta, timestamp, user_id, username)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        entry.id || crypto.randomBytes(8).toString('hex'),
                        resolvedBranch,
                        entry.message,
                        entry.meta || '',
                        toStoredTimestamp(entry.timestamp),
                        entry.userId ? String(entry.userId) : null,
                        entry.username || null
                    ]
                );
            }
            return;
        }
        await writeJson(
            STORE_KEY,
            {
                logs: visibleLogs.slice(0, MAX_LOG_ITEMS),
                updatedAt: new Date().toISOString()
            }
        );
    } catch (e) {
        console.warn('Failed to persist activity log:', e.message);
    }
};

const loadActivityLog = async (branchId = null) => readLogEntries(branchId);

const appendActivityLog = async ({ message, meta, userId, username, timestamp, branchId }) => {
    if (!message) return null;
    const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        message: String(message).slice(0, 300),
        meta: meta ? String(meta).slice(0, 200) : '',
        timestamp: timestamp || new Date().toISOString(),
        userId: userId ? String(userId) : undefined,
        username: username || undefined
    };
    if (shouldHideActivityLogEntry(entry)) return null;
    if (await isRelationalReady()) {
        const resolvedBranch = await resolveBranchId(branchId, userId);
        if (!resolvedBranch) return entry;
        await query(
            `INSERT INTO activity_logs (id, branch_id, message, meta, timestamp, user_id, username)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.id,
                resolvedBranch,
                entry.message,
                entry.meta || '',
                toStoredTimestamp(entry.timestamp),
                entry.userId ? String(entry.userId) : null,
                entry.username || null
            ]
        );
        return entry;
    }
    const logs = await readLogEntries();
    logs.unshift(entry);
    const trimmed = logs.slice(0, MAX_LOG_ITEMS);
    await writeLogEntries(trimmed);
    return entry;
};

const clearActivityLog = async (branchId = null) => {
    await writeLogEntries([], branchId);
    return true;
};

module.exports = {
    loadActivityLog,
    appendActivityLog,
    clearActivityLog
};
